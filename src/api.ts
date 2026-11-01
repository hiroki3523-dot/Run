import { Hono } from 'hono';
import { addDays, weekStart } from './format';
import { ingestActivity, morningBriefing, SHOE_TOTAL_SQL } from './process';
import { notify } from './notify';
import { seedInitial } from './seed';
import { raceWeather, weatherAdvice } from './weather';
import { getSettings, saveSettings } from './settings';
import { DEFAULT_SETTINGS } from './types';
import { getBackfill, startBackfill, stopBackfill } from './backfill';
import { calendarSig } from './calendar';
import { createSubscription, getAthleteId, viewSubscription } from './strava';
import { PLAN_TYPES, type Env, type Plan, type Settings } from './types';

export const api = new Hono<{ Bindings: Env }>();

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const num = (v: unknown) => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// ---------------------------------------------------------------- status / settings

api.get('/status', async (c) => {
  const athlete = await getAthleteId(c.env);
  const sig = await calendarSig(c.env);
  return c.json({
    strava_connected: athlete != null,
    athlete_id: athlete,
    ntfy_topic_set: !!c.env.NTFY_TOPIC,
    bark_set: !!c.env.BARK_KEY,
    backfill: await getBackfill(c.env),
    calendar_url: `${c.env.APP_URL.replace(/\/$/, '')}/cal/${sig}/sub3.ics`,
  });
});

api.get('/settings', async (c) => c.json(await getSettings(c.env)));
api.put('/settings', async (c) => {
  const body = await c.req.json<Settings>();
  await saveSettings(c.env, { ...(await getSettings(c.env)), ...body });
  return c.json(await getSettings(c.env));
});

/** ペース帯・心拍・COROS の値を、標準 (COROS 基準) に戻す */
api.post('/settings/reset', async (c) => {
  await saveSettings(c.env, DEFAULT_SETTINGS);
  return c.json(await getSettings(c.env));
});

// ---------------------------------------------------------------- races

api.get('/races', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM races ORDER BY date').all();
  return c.json(results);
});

function raceValues(b: Record<string, unknown>) {
  if (!b.name || !isDate(b.date) || !num(b.distance_m)) throw new Error('name, date, distance_m は必須です');
  return [b.name, b.date, num(b.distance_m), num(b.goal_time_s), b.priority ?? 'A', num(b.result_time_s), b.notes ?? null];
}

api.post('/races', async (c) => {
  const row = await c.env.DB.prepare(
    'INSERT INTO races (name, date, distance_m, goal_time_s, priority, result_time_s, notes) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
  )
    .bind(...raceValues(await c.req.json()))
    .first();
  return c.json(row, 201);
});

api.put('/races/:id', async (c) => {
  const row = await c.env.DB.prepare(
    `UPDATE races SET name = ?, date = ?, distance_m = ?, goal_time_s = ?, priority = ?, result_time_s = ?, notes = ?
     WHERE id = ? RETURNING *`,
  )
    .bind(...raceValues(await c.req.json()), c.req.param('id'))
    .first();
  return row ? c.json(row) : c.notFound();
});

api.delete('/races/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM races WHERE id = ?').bind(c.req.param('id')).run();
  return c.body(null, 204);
});

// ---------------------------------------------------------------- plans

api.get('/plans', async (c) => {
  const { from, to } = c.req.query();
  if (!isDate(from) || !isDate(to)) return c.json({ error: 'from/to が必要です' }, 400);
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, a.id AS activity_id, a.score, a.distance_m AS actual_distance_m
     FROM plans p LEFT JOIN activities a ON a.plan_id = p.id
     WHERE p.date BETWEEN ? AND ? ORDER BY p.date, p.id`,
  )
    .bind(from, to)
    .all();
  return c.json(results);
});

function planValues(b: Record<string, unknown>) {
  if (!isDate(b.date) || !PLAN_TYPES.includes(b.type as Plan['type'])) throw new Error('date と type は必須です');
  return [b.date, b.type, num(b.distance_m), num(b.pace_min_s), num(b.pace_max_s), num(b.hr_max), b.notes || null];
}

api.post('/plans', async (c) => {
  const row = await c.env.DB.prepare(
    'INSERT INTO plans (date, type, distance_m, pace_min_s, pace_max_s, hr_max, notes) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
  )
    .bind(...planValues(await c.req.json()))
    .first();
  return c.json(row, 201);
});

api.put('/plans/:id', async (c) => {
  const row = await c.env.DB.prepare(
    `UPDATE plans SET date = ?, type = ?, distance_m = ?, pace_min_s = ?, pace_max_s = ?, hr_max = ?, notes = ?
     WHERE id = ? RETURNING *`,
  )
    .bind(...planValues(await c.req.json()), c.req.param('id'))
    .first();
  return row ? c.json(row) : c.notFound();
});

api.delete('/plans/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM plans WHERE id = ?').bind(c.req.param('id')).run();
  return c.body(null, 204);
});

/** 計画をまとめて登録する (JSON 配列)。replace=true なら対象期間の既存計画を先に消す */
api.post('/plans/bulk', async (c) => {
  const body = await c.req.json<{ plans?: Record<string, unknown>[]; replace?: boolean } | Record<string, unknown>[]>();
  const list = Array.isArray(body) ? body : body.plans;
  const replace = !Array.isArray(body) && !!body.replace;
  if (!Array.isArray(list) || list.length === 0) return c.json({ error: '計画の配列が必要です' }, 400);
  if (list.length > 400) return c.json({ error: '一度に登録できるのは 400 件までです' }, 400);
  const rows = list.map((b, i) => {
    try {
      return planValues(b);
    } catch {
      throw new Error(`${i + 1} 件目: date (YYYY-MM-DD) と type (${PLAN_TYPES.join('/')}) が正しくありません`);
    }
  });
  const stmts: D1PreparedStatement[] = [];
  if (replace) {
    const dates = rows.map((r) => r[0] as string).sort();
    stmts.push(c.env.DB.prepare('DELETE FROM plans WHERE date BETWEEN ? AND ?').bind(dates[0], dates[dates.length - 1]));
  }
  const ins = c.env.DB.prepare('INSERT INTO plans (date, type, distance_m, pace_min_s, pace_max_s, hr_max, notes) VALUES (?, ?, ?, ?, ?, ?, ?)');
  rows.forEach((r) => stmts.push(ins.bind(...r)));
  await c.env.DB.batch(stmts);
  return c.json({ imported: rows.length, replaced: replace });
});

/** 週の計画を別の週へ複製する */
api.post('/plans/copy-week', async (c) => {
  const { from, to } = await c.req.json<{ from: string; to: string }>();
  if (!isDate(from) || !isDate(to)) return c.json({ error: 'from/to が必要です' }, 400);
  const src = weekStart(from);
  const dst = weekStart(to);
  const offset = Math.round((Date.parse(dst) - Date.parse(src)) / 86400_000);
  const { results } = await c.env.DB.prepare('SELECT * FROM plans WHERE date BETWEEN ? AND ?')
    .bind(src, addDays(src, 6))
    .all<Plan>();
  const stmt = c.env.DB.prepare(
    'INSERT INTO plans (date, type, distance_m, pace_min_s, pace_max_s, hr_max, notes) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  if (results.length > 0) {
    await c.env.DB.batch(
      results.map((p) => stmt.bind(addDays(p.date, offset), p.type, p.distance_m, p.pace_min_s, p.pace_max_s, p.hr_max, p.notes)),
    );
  }
  return c.json({ copied: results.length });
});

// ---------------------------------------------------------------- 天気

/** 次のレース (16 日以内) の当日予報 */
api.get('/race-weather', async (c) => {
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const race = await c.env.DB.prepare('SELECT name, date FROM races WHERE date >= ? ORDER BY date LIMIT 1')
    .bind(today)
    .first<{ name: string; date: string }>();
  if (!race) return c.json(null);
  try {
    const w = await raceWeather(race.name, race.date);
    return c.json(w ? { race: race.name, ...w, advice: weatherAdvice(w) } : null);
  } catch (e) {
    console.error('weather failed', e);
    return c.json(null);
  }
});

// ---------------------------------------------------------------- activities

api.get('/activities', async (c) => {
  const { from, to } = c.req.query();
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.date, a.name, a.sport_type, a.distance_m, a.moving_time_s, a.avg_hr, a.avg_cadence_spm,
       a.score, a.plan_id, p.type AS plan_type, s.name AS shoe_name
     FROM activities a LEFT JOIN plans p ON p.id = a.plan_id LEFT JOIN shoes s ON s.id = a.shoe_id
     WHERE a.date BETWEEN ? AND ? ORDER BY a.start_date_local DESC`,
  )
    .bind(isDate(from) ? from : '1970-01-01', isDate(to) ? to : '9999-12-31')
    .all();
  return c.json(results);
});

api.get('/activities/:id', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT a.*, s.name AS shoe_name FROM activities a LEFT JOIN shoes s ON s.id = a.shoe_id WHERE a.id = ?`,
  )
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();
  if (!row) return c.notFound();
  const plan = row.plan_id ? await c.env.DB.prepare('SELECT * FROM plans WHERE id = ?').bind(row.plan_id).first() : null;
  return c.json({ ...row, evaluation: row.evaluation ? JSON.parse(row.evaluation as string) : null, plan });
});

/** 計画の付け替え・シューズ変更 (計画を変えたら再評価) */
api.put('/activities/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ plan_id?: number | null; shoe_id?: number | null }>();
  if ('shoe_id' in body) {
    await c.env.DB.prepare('UPDATE activities SET shoe_id = ? WHERE id = ?').bind(body.shoe_id ?? null, id).run();
  }
  if ('plan_id' in body) await ingestActivity(c.env, id, { planId: body.plan_id ?? null });
  return c.json({ ok: true });
});

api.post('/activities/:id/reevaluate', async (c) => {
  await ingestActivity(c.env, Number(c.req.param('id')));
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- summary

/** 週ごとの計画距離と実績距離 */
api.get('/summary', async (c) => {
  const { from, to } = c.req.query();
  if (!isDate(from) || !isDate(to)) return c.json({ error: 'from/to が必要です' }, 400);
  const [plans, acts] = await Promise.all([
    c.env.DB.prepare('SELECT date, type, distance_m FROM plans WHERE date BETWEEN ? AND ?').bind(from, to).all<Plan>(),
    c.env.DB.prepare('SELECT date, distance_m, plan_id, score FROM activities WHERE date BETWEEN ? AND ?')
      .bind(from, to)
      .all<{ date: string; distance_m: number; plan_id: number | null; score: number | null }>(),
  ]);
  const weeks = new Map<string, { week: string; planned_m: number; actual_m: number; points_planned: number; points_done: number; runs: number; score_sum: number }>();
  const w = (date: string) => {
    const k = weekStart(date);
    if (!weeks.has(k)) weeks.set(k, { week: k, planned_m: 0, actual_m: 0, points_planned: 0, points_done: 0, runs: 0, score_sum: 0 });
    return weeks.get(k)!;
  };
  for (const p of plans.results) {
    const e = w(p.date);
    e.planned_m += p.distance_m ?? 0;
    if (['m', 'lt', 'interval', 'race'].includes(p.type)) e.points_planned++;
  }
  const { results: pointPlans } = await c.env.DB.prepare(
    `SELECT a.date FROM activities a JOIN plans p ON p.id = a.plan_id
     WHERE a.date BETWEEN ? AND ? AND p.type IN ('m', 'lt', 'interval', 'race')`,
  )
    .bind(from, to)
    .all<{ date: string }>();
  pointPlans.forEach((r) => w(r.date).points_done++);
  for (const a of acts.results) {
    const e = w(a.date);
    e.actual_m += a.distance_m;
    if (a.score != null) {
      e.runs++;
      e.score_sum += a.score;
    }
  }
  return c.json(
    [...weeks.values()]
      .sort((a, b) => a.week.localeCompare(b.week))
      .map(({ score_sum, ...e }) => ({ ...e, avg_score: e.runs ? Math.round(score_sum / e.runs) : null })),
  );
});

// ---------------------------------------------------------------- shoes

api.get('/shoes', async (c) => {
  const { results } = await c.env.DB.prepare(`${SHOE_TOTAL_SQL} ORDER BY s.retired, s.id`).all();
  return c.json(results);
});

function shoeValues(b: Record<string, unknown>) {
  if (!b.name) throw new Error('name は必須です');
  const image = typeof b.image === 'string' && b.image.startsWith('data:image/') && b.image.length < 400_000 ? b.image : null;
  return [b.name, b.purpose ?? 'daily', b.strava_gear_id || null, num(b.limit_km) ?? 700, num(b.initial_km) ?? 0, b.retired ? 1 : 0, image];
}

api.post('/shoes', async (c) => {
  const row = await c.env.DB.prepare(
    'INSERT INTO shoes (name, purpose, strava_gear_id, limit_km, initial_km, retired, image) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
  )
    .bind(...shoeValues(await c.req.json()))
    .first();
  return c.json(row, 201);
});

api.put('/shoes/:id', async (c) => {
  const row = await c.env.DB.prepare(
    `UPDATE shoes SET name = ?, purpose = ?, strava_gear_id = ?, limit_km = ?, initial_km = ?, retired = ?, image = ?, alert_sent = 0
     WHERE id = ? RETURNING *`,
  )
    .bind(...shoeValues(await c.req.json()), c.req.param('id'))
    .first();
  return row ? c.json(row) : c.notFound();
});

api.delete('/shoes/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM shoes WHERE id = ?').bind(c.req.param('id')).run();
  return c.body(null, 204);
});

// ---------------------------------------------------------------- Strava 管理

api.post('/strava/subscribe', async (c) => c.json(await createSubscription(c.env)));
api.get('/strava/subscription', async (c) => c.json(await viewSubscription(c.env)));

/** 過去データの取り込み。開始すると 1 分ごとの cron が自動で進める */
api.post('/strava/backfill/start', async (c) => {
  const d = Number(c.req.query('days'));
  return c.json(await startBackfill(c.env, Number.isFinite(d) && d > 0 ? d : null));
});
api.get('/strava/backfill/status', async (c) => {
  const db = await c.env.DB.prepare('SELECT COUNT(*) AS count, MIN(date) AS oldest, MAX(date) AS newest FROM activities').first();
  return c.json({ ...((await getBackfill(c.env)) ?? {}), db });
});
api.post('/strava/backfill/stop', async (c) => (await stopBackfill(c.env), c.json(await getBackfill(c.env))));

/** レース5件と福岡までの計画を登録 (登録済みの日付は飛ばす) */
api.post('/seed', async (c) => c.json(await seedInitial(c.env)));

// ---------------------------------------------------------------- 通知テスト

api.post('/notify/test', async (c) => {
  const results = await notify(c.env, { title: 'テスト通知', message: 'sub3-runner から届きました 🏃', tags: ['tada'] });
  return c.json({ ok: results.length > 0 && results.some((r) => r.ok), results });
});

api.post('/notify/morning', async (c) => {
  const b = await morningBriefing(c.env);
  const results = await notify(c.env, b);
  return c.json({ ...b, results });
});

api.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 400);
});
