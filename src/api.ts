import { cleanPurposes } from './shoes';
import { Hono } from 'hono';
import { addDays, weekStart } from './format';
import { ingestActivity, morningBriefing, SHOE_TOTAL_SQL } from './process';
import { notify } from './notify';
import { seedInitial } from './seed';
import { weatherDays, raceWeather, weatherAdvice } from './weather';
import { DEFAULT_PLACE, forecast, searchPlaces } from './forecast';
import { generatePlan, type PlannerRace } from './planner';
import { buildReview, trainingLoad, type ReviewPlan, type ReviewRun } from './review';
import { getActivity, getSeries } from './strava';
import { buildRunReview } from './runreview';
import { getSettings, kvGet, kvSet, saveSettings } from './settings';
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
  if (body.plan_prefs) {
    const pp = body.plan_prefs;
    const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
    body.plan_prefs = {
      points_per_week: Math.min(3, Math.max(0, Math.round(Number(pp.points_per_week) || 0))),
      long_per_week: Number(pp.long_per_week) > 0 ? 1 : 0,
      long_day: Math.min(6, Math.max(0, Math.round(Number(pp.long_day) || 0))),
      rest_per_week: Math.min(3, Math.max(0, Math.round(Number(pp.rest_per_week) || 0))),
      rest_days: [...new Set((pp.rest_days ?? []).map(Number).filter((n) => n >= 0 && n <= 6))],
      blocked: [...new Set((pp.blocked ?? []).filter((d) => isDate(d) && d >= addDays(today, -1)))].sort(),
    };
  }
  if (body.weather_place) {
    const w = body.weather_place;
    const lat = Number(w.lat), lon = Number(w.lon);
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return c.json({ error: '場所の座標が不正です' }, 400);
    body.weather_place = { name: String(w.name || '現在地').slice(0, 30), lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 };
  }
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
    `SELECT p.*,
       (SELECT a.id FROM activities a WHERE a.plan_id = p.id ORDER BY a.distance_m DESC LIMIT 1) AS activity_id,
       (SELECT a.score FROM activities a WHERE a.plan_id = p.id ORDER BY a.distance_m DESC LIMIT 1) AS score,
       (SELECT SUM(a.distance_m) FROM activities a WHERE a.plan_id = p.id) AS actual_distance_m,
       (SELECT COUNT(*) FROM activities a WHERE a.plan_id = p.id) AS activity_count
     FROM plans p WHERE p.date BETWEEN ? AND ? ORDER BY p.date, p.id`,
  )
    .bind(from, to)
    .all();
  return c.json(results);
});

function planValues(b: Record<string, unknown>) {
  if (!isDate(b.date) || !PLAN_TYPES.includes(b.type as Plan['type'])) throw new Error('date と type は必須です');
  return [b.date, b.type, num(b.distance_m), num(b.pace_min_s), num(b.pace_max_s), num(b.hr_max), b.notes || null, stepsJson(b.steps)];
}

/** steps は配列を JSON 文字列にして保存 (最大 20 ステップ) */
function stepsJson(v: unknown): string | null {
  if (v == null || v === '') return null;
  const arr = typeof v === 'string' ? JSON.parse(v) : v;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return JSON.stringify(arr.slice(0, 20));
}

api.post('/plans', async (c) => {
  const row = await c.env.DB.prepare(
    'INSERT INTO plans (date, type, distance_m, pace_min_s, pace_max_s, hr_max, notes, steps) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
  )
    .bind(...planValues(await c.req.json()))
    .first();
  return c.json(row, 201);
});

api.put('/plans/:id', async (c) => {
  const row = await c.env.DB.prepare(
    `UPDATE plans SET date = ?, type = ?, distance_m = ?, pace_min_s = ?, pace_max_s = ?, hr_max = ?, notes = ?, steps = ?
     WHERE id = ? RETURNING *`,
  )
    .bind(...planValues(await c.req.json()), c.req.param('id'))
    .first();
  if (!row) return c.notFound();
  // 計画を直したら、その計画に紐づく実績も新しい内容で評価し直す
  try {
    const { results } = await c.env.DB.prepare('SELECT id FROM activities WHERE plan_id = ? ORDER BY distance_m DESC LIMIT 6').bind(c.req.param('id')).all<{ id: number }>();
    for (const r of results) await ingestActivity(c.env, r.id, { planId: Number(c.req.param('id')) });
  } catch (e) {
    console.warn('re-evaluate after plan update failed', e);
  }
  return c.json(row);
});

api.delete('/plans/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM plans WHERE id = ?').bind(c.req.param('id')).run();
  return c.body(null, 204);
});

/** 同じ日・同じ内容の計画の重複を消す (走った実績が付いている方、なければ古い方を残す) */
api.post('/plans/dedupe', async (c) => {
  // 実績が付いていない計画だけを消す。同じ内容の別の計画が残っていることが条件
  const r = await c.env.DB.prepare(
    `DELETE FROM plans WHERE id IN (
       SELECT p.id FROM plans p
       WHERE NOT EXISTS (SELECT 1 FROM activities a WHERE a.plan_id = p.id)
         AND EXISTS (
           SELECT 1 FROM plans q
           WHERE q.id != p.id AND q.date = p.date AND q.type = p.type
             AND COALESCE(q.distance_m, -1) = COALESCE(p.distance_m, -1) AND COALESCE(q.notes, '') = COALESCE(p.notes, '')
             AND (q.id < p.id OR EXISTS (SELECT 1 FROM activities a WHERE a.plan_id = q.id))
         )
     )`,
  ).run();
  return c.json({ removed: r.meta.changes ?? 0 });
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
    'INSERT INTO plans (date, type, distance_m, pace_min_s, pace_max_s, hr_max, notes, steps) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );
  if (results.length > 0) {
    await c.env.DB.batch(
      results.map((p) => stmt.bind(addDays(p.date, offset), p.type, p.distance_m, p.pace_min_s, p.pace_max_s, p.hr_max, p.notes, p.steps ?? null)),
    );
  }
  return c.json({ copied: results.length });
});

// ---------------------------------------------------------------- 振り返り (日・週・月)

api.get('/review', async (c) => {
  const { from, to, kind } = c.req.query();
  if (!isDate(from) || !isDate(to)) return c.json({ error: 'from/to が必要です' }, 400);
  const k = kind === 'day' || kind === 'month' ? kind : 'week';
  const lthr = (await getSettings(c.env)).coros.lthr;
  const load = async (a: string, b: string) => {
    const [runs, plans] = await Promise.all([
      c.env.DB.prepare(
        `SELECT id, date, name, distance_m, moving_time_s, avg_hr, score, plan_id, evaluation
         FROM activities WHERE date BETWEEN ? AND ? ORDER BY start_date_local`,
      ).bind(a, b).all<Omit<ReviewRun, 'comments'> & { evaluation: string | null }>(),
      c.env.DB.prepare('SELECT id, date, type, distance_m FROM plans WHERE date BETWEEN ? AND ?').bind(a, b).all<ReviewPlan>(),
    ]);
    const list: ReviewRun[] = runs.results.map(({ evaluation, ...r }) => {
      let comments: string[] = [];
      try { comments = evaluation ? (JSON.parse(evaluation).comments ?? []).slice(0, 3) : []; } catch { /* 古い形式は無視 */ }
      return { ...r, comments, tl: trainingLoad(r.moving_time_s, r.avg_hr, lthr) };
    });
    return { list, plans: plans.results };
  };
  const span = daysSpan(from, to);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(span - 1));
  const [cur, prv] = await Promise.all([load(from, to), k === 'day' ? null : load(prevFrom, prevTo)]);
  const prev = prv ? { runs: prv.list.length, km: prv.list.reduce((a, r) => a + r.distance_m, 0) / 1000 } : null;
  return c.json(buildReview(from, to, cur.list, cur.plans, prev, k));
});

/** 直近 N 週間 (月曜始まり) の週ごとの距離と負荷。Strava の「過去12週間」グラフ用 */
api.get('/trend', async (c) => {
  const weeks = Math.min(26, Math.max(4, Number(c.req.query('weeks')) || 12));
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const dow = (Date.parse(today) / 86400_000 + 3) % 7; // 月曜=0
  const thisMon = addDays(today, -Math.floor(dow));
  const first = addDays(thisMon, -7 * (weeks - 1));
  const lthr = (await getSettings(c.env)).coros.lthr;
  const { results } = await c.env.DB.prepare(
    'SELECT date, distance_m, moving_time_s, avg_hr FROM activities WHERE date >= ?',
  ).bind(first).all<{ date: string; distance_m: number; moving_time_s: number; avg_hr: number | null }>();
  const out = Array.from({ length: weeks }, (_, i) => ({ week: addDays(first, i * 7), km: 0, tl: 0 }));
  for (const r of results) {
    const i = Math.floor(daysSpan(first, r.date) - 1) / 7 | 0;
    if (out[i]) {
      out[i].km += r.distance_m / 1000;
      out[i].tl += trainingLoad(r.moving_time_s, r.avg_hr, lthr);
    }
  }
  return c.json(out.map((w) => ({ ...w, km: Math.round(w.km * 10) / 10 })));
});

/** 1km ごとのスプリット (Strava から取得。ペース・心拍・標高差) */
api.get('/activities/:id/splits', async (c) => {
  try {
    const a = (await getActivity(c.env, Number(c.req.param('id')))) as unknown as {
      splits_metric?: { distance: number; moving_time: number; elevation_difference: number; average_heartrate?: number }[];
    };
    return c.json(
      (a.splits_metric ?? []).map((x) => ({
        km: Math.round(x.distance) / 1000,
        time_s: Math.round(x.moving_time),
        pace_s: x.distance > 0 ? Math.round((x.moving_time / x.distance) * 1000) : null,
        elev: Math.round(x.elevation_difference ?? 0),
        hr: x.average_heartrate ? Math.round(x.average_heartrate) : null,
      })),
    );
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

/** ランのレビュー (アップ・メイン・ダウンの内訳、ラップ推移、心拍、フォーム、レースに向けた判断) */
api.get('/activities/:id/review', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(id).first<Record<string, any>>();
  if (!row) return c.notFound();
  const ev = row.evaluation ? JSON.parse(row.evaluation) : null;
  if (ev?.role === 'warmup' || ev?.role === 'cooldown') {
    const m = await c.env.DB.prepare(`SELECT id FROM activities WHERE date = ? AND json_extract(evaluation, '$.role') = 'work' ORDER BY distance_m DESC LIMIT 1`).bind(row.date).first<{ id: number }>();
    return c.json({ role: ev.role, main_id: m?.id ?? null });
  }
  const st = await getSettings(c.env);
  const plan = row.plan_id ? await c.env.DB.prepare('SELECT * FROM plans WHERE id = ?').bind(row.plan_id).first<Plan>() : null;
  const { results: sib } = await c.env.DB.prepare(
    `SELECT distance_m, moving_time_s, avg_hr, json_extract(evaluation, '$.role') AS role FROM activities WHERE date = ? ORDER BY start_date_local`,
  ).bind(row.date).all<{ distance_m: number; moving_time_s: number; avg_hr: number | null; role: string | null }>();
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const race = await c.env.DB.prepare(`SELECT name, date, goal_time_s, distance_m FROM races WHERE date >= ? AND priority IN ('A','B') ORDER BY date LIMIT 1`).bind(today).first<any>();
  const rpeRaw = await kvGet(c.env, `rpe:${id}`);
  let splits: { km: number; time_s: number; pace_s: number | null; hr: number | null }[] = [];
  try {
    const a = (await getActivity(c.env, id)) as unknown as { splits_metric?: { distance: number; moving_time: number; average_heartrate?: number }[] };
    splits = (a.splits_metric ?? []).map((x) => ({
      km: Math.round(x.distance) / 1000, time_s: Math.round(x.moving_time),
      pace_s: x.distance > 0 ? Math.round((x.moving_time / x.distance) * 1000) : null,
      hr: x.average_heartrate ? Math.round(x.average_heartrate) : null,
    }));
  } catch { /* ラップが取れなくても、あるぶんでレビューする */ }
  const lt = st.coros.lt_pace_s;
  const series = await getSeries(c.env, id, [lt * 1.397, lt * 1.154, lt * 1.073, lt * 0.98, lt * 0.899].map(Math.round), [0.8, 0.9, 0.95, 1.017, 1.057].map((r) => Math.round(st.coros.lthr * r))).catch(() => null);
  const review = buildRunReview({
    score: row.score ?? 0,
    sub: { pace: ev?.pace?.score ?? null, hr: ev?.hr?.score ?? null, form: ev?.form?.score ?? null },
    main: { distance_m: row.distance_m, moving_time_s: row.moving_time_s, avg_hr: row.avg_hr, max_hr: row.max_hr },
    parts: sib,
    splits, series,
    lthr: st.coros.lthr ?? st.lthr, max_hr: st.max_hr,
    band: plan?.pace_min_s && plan?.pace_max_s ? { min: plan.pace_min_s, max: plan.pace_max_s } : null,
    race: race ?? null, today,
    rpe: rpeRaw ? Number(rpeRaw) : null,
  });
  return c.json({ ...review, rpe: rpeRaw ? Number(rpeRaw) : null, shoe_id: row.shoe_id });
});

/** 走ったときの主観的なきつさ (1〜4) を残す */
api.put('/activities/:id/rpe', async (c) => {
  const b = await c.req.json<{ rpe?: number }>();
  const v = Number(b.rpe);
  if (![1, 2, 3, 4].includes(v)) return c.json({ error: 'rpe は 1〜4' }, 400);
  await kvSet(c.env, `rpe:${Number(c.req.param('id'))}`, String(v));
  return c.json({ ok: true });
});

/** 実績詳細のグラフ用の時系列 (ペース・心拍・ピッチ・ストライド・標高) とゾーン分布 */
api.get('/activities/:id/series', async (c) => {
  try {
    const st = await getSettings(c.env);
    const lt = st.coros.lt_pace_s;
    // COROS と同じ境界: 閾値ペース 4:07 → 5:45 / 4:46 / 4:26 / 4:02 / 3:42
    const paceBounds = [lt * 1.397, lt * 1.154, lt * 1.073, lt * 0.98, lt * 0.899].map(Math.round);
    const l = st.coros.lthr;
    const hrBounds = [0.8, 0.9, 0.95, 1.017, 1.057].map((r) => Math.round(l * r));
    const s = await getSeries(c.env, Number(c.req.param('id')), paceBounds, hrBounds);
    if (!s) return c.json({ error: 'データがありません' }, 404);
    return c.json({ ...s, pace_bounds: paceBounds, hr_bounds: hrBounds });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502);
  }
});

const daysSpan = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400_000) + 1;

// ---------------------------------------------------------------- 計画の自動作成

/**
 * 直近の実績と目標レースから、レースまでの日別メニューを作る。
 * commit が false ならプレビューだけ返し、true なら登録する。
 */
api.post('/plans/generate', async (c) => {
  const b = await c.req.json<{ race_id?: number; overwrite?: boolean; commit?: boolean; from?: string; to?: string }>();
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const start = isDate(b.from) ? b.from : today;
  const race = b.race_id
    ? await c.env.DB.prepare('SELECT * FROM races WHERE id = ?').bind(b.race_id).first<PlannerRace & { id: number }>()
    : await c.env.DB.prepare("SELECT * FROM races WHERE date > ? AND priority IN ('A','B') ORDER BY date LIMIT 1").bind(start).first<PlannerRace & { id: number }>();
  if (!race) return c.json({ error: '対象のレースがありません。レースを登録してください' }, 400);
  if (race.date < start) return c.json({ error: 'レースの日付が過ぎています' }, 400);

  const [{ results: others }, recent, lastWeek, lastRace, settings] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM races WHERE date >= ? AND date < ? ORDER BY date').bind(start, race.date).all<PlannerRace>(),
    c.env.DB.prepare('SELECT COALESCE(SUM(distance_m), 0) AS m FROM activities WHERE date BETWEEN ? AND ?').bind(addDays(start, -28), addDays(start, -1)).first<{ m: number }>(),
    c.env.DB.prepare(
      `SELECT (SELECT COALESCE(SUM(distance_m), 0) FROM activities WHERE date BETWEEN ?1 AND ?2) AS done,
              (SELECT COALESCE(SUM(distance_m), 0) FROM plans WHERE date BETWEEN ?1 AND ?2 AND type != 'rest') AS planned`,
    ).bind(addDays(start, -7), addDays(start, -1)).first<{ done: number; planned: number }>(),
    c.env.DB.prepare('SELECT date FROM races WHERE date < ? AND date >= ? ORDER BY date DESC LIMIT 1').bind(start, addDays(start, -10)).first<{ date: string }>(),
    getSettings(c.env),
  ]);
  const weekly = recent && recent.m > 0 ? recent.m / 1000 / 4 : null;
  // 週の途中から作る場合、その週にすでに走った分を渡す
  const wsStart = weekStart(start);
  let week_done: { km: number; points: number; long: boolean } | undefined;
  if (start > wsStart) {
    const { results: did } = await c.env.DB.prepare(
      `SELECT a.distance_m, a.plan_id, p.type FROM activities a LEFT JOIN plans p ON p.id = a.plan_id WHERE a.date >= ? AND a.date < ?`,
    ).bind(wsStart, start).all<{ distance_m: number; plan_id: number | null; type: string | null }>();
    week_done = {
      km: did.reduce((a, r) => a + r.distance_m, 0) / 1000,
      points: new Set(did.filter((r) => r.type && ['m', 'lt', 'interval', 'race'].includes(r.type)).map((r) => r.plan_id)).size,
      long: did.some((r) => r.type === 'long' || r.distance_m >= 18000),
    };
  }
  let rows = generatePlan({
    week_done,
    start,
    race,
    others,
    weekly_km: weekly,
    last_completion: lastWeek && lastWeek.planned > 0 ? lastWeek.done / lastWeek.planned : null,
    last_race: lastRace?.date ?? null,
    settings,
  });
  const until = isDate(b.to) ? b.to : race.date;
  rows = rows.filter((r) => r.date <= until);

  // 週ごとの距離 (月曜はじまり)
  const weeks = new Map<string, number>();
  for (const r of rows) weeks.set(weekStart(r.date), (weeks.get(weekStart(r.date)) ?? 0) + (r.distance_m ?? 0) / 1000);
  const summary = {
    race: race.name,
    race_date: race.date,
    from: start,
    days: rows.length,
    base_weekly_km: weekly == null ? null : Math.round(weekly),
    weeks: [...weeks].map(([week, km]) => ({ week, km: Math.round(km) })),
  };
  if (!b.commit) return c.json({ summary, rows });

  const stmts: D1PreparedStatement[] = [];
  if (b.overwrite) {
    stmts.push(
      c.env.DB.prepare(
        `DELETE FROM plans WHERE date BETWEEN ? AND ? AND id NOT IN (SELECT plan_id FROM activities WHERE plan_id IS NOT NULL)`,
      ).bind(start, until < race.date ? until : race.date),
    );
  }
  // 置き換えでも、走った実績が付いていて残した日には新しい計画を足さない (二重表示の原因)
  const have = b.overwrite
    ? new Set((await c.env.DB.prepare('SELECT DISTINCT date FROM plans WHERE date BETWEEN ? AND ? AND id IN (SELECT plan_id FROM activities WHERE plan_id IS NOT NULL)').bind(start, until).all<{ date: string }>()).results.map((r) => r.date))
    : new Set((await c.env.DB.prepare('SELECT DISTINCT date FROM plans WHERE date BETWEEN ? AND ?').bind(start, until).all<{ date: string }>()).results.map((r) => r.date));
  const ins = c.env.DB.prepare('INSERT INTO plans (date, type, distance_m, pace_min_s, pace_max_s, notes) VALUES (?, ?, ?, ?, ?, ?)');
  const fresh = rows.filter((r) => !have.has(r.date));
  for (let i = 0; i < fresh.length; i += 90) {
    // D1 は 1 バッチあたりの件数に余裕を持たせる
    stmts.push(...fresh.slice(i, i + 90).map((r) => ins.bind(r.date, r.type, r.distance_m, r.pace_min_s, r.pace_max_s, r.notes)));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ summary, added: fresh.length, skipped: rows.length - fresh.length });
});

// ---------------------------------------------------------------- 天気

// ---------------------------------------------------------------- 準備物チェックリスト・月間目標 (kv に保存)

api.get('/checklist/:race', async (c) => {
  const raw = await kvGet(c.env, `checklist:${Number(c.req.param('race'))}`);
  return c.json(raw ? JSON.parse(raw) : { checked: [], custom: [] });
});

api.put('/checklist/:race', async (c) => {
  const b = await c.req.json<{ checked?: string[]; custom?: { id: string; cat: string; text: string }[] }>();
  const clean = {
    checked: [...new Set((b.checked ?? []).map(String))].slice(0, 200),
    custom: (b.custom ?? []).slice(0, 40).map((x) => ({ id: String(x.id).slice(0, 40), cat: String(x.cat || 'other').slice(0, 20), text: String(x.text).slice(0, 60) })).filter((x) => x.text),
  };
  await kvSet(c.env, `checklist:${Number(c.req.param('race'))}`, JSON.stringify(clean));
  return c.json(clean);
});

/** 月間の走行距離の目標 (month は YYYY-MM) */
api.get('/goals/:month', async (c) => {
  const m = c.req.param('month');
  if (!/^\d{4}-\d{2}$/.test(m)) return c.json({ error: 'month は YYYY-MM' }, 400);
  const raw = await kvGet(c.env, `goal:${m}`);
  return c.json(raw ? JSON.parse(raw) : { km: null });
});

api.put('/goals/:month', async (c) => {
  const m = c.req.param('month');
  if (!/^\d{4}-\d{2}$/.test(m)) return c.json({ error: 'month は YYYY-MM' }, 400);
  const b = await c.req.json<{ km?: number | null }>();
  const km = b.km == null ? null : Math.min(1000, Math.max(0, Math.round(Number(b.km) || 0)));
  await kvSet(c.env, `goal:${m}`, JSON.stringify({ km }));
  return c.json({ km });
});

/** 過去 7 日〜先 15 日の天気 (予定表・ホーム用) */
api.get('/weather/week', async (c) => {
  try {
    const place = (await getSettings(c.env)).weather_place ?? DEFAULT_PLACE;
    return c.json(await weatherDays(place));
  } catch (e) {
    console.error('weather week failed', e);
    return c.json(null);
  }
});

/** 場所の検索 (地名から緯度経度) */
api.get('/weather/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (!q) return c.json([]);
  try {
    return c.json(await searchPlaces(q));
  } catch {
    return c.json([]);
  }
});

/** 詳しい予報 (時間別・7 日・暑さ指数・走りやすさ・おすすめ時間帯) */
api.get('/weather/forecast', async (c) => {
  try {
    const place = (await getSettings(c.env)).weather_place ?? DEFAULT_PLACE;
    return c.json(await forecast(place));
  } catch (e) {
    console.error('forecast failed', e);
    return c.json(null);
  }
});

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
       a.score, a.plan_id, a.start_date_local, json_extract(a.evaluation, '$.role') AS role, p.type AS plan_type, s.name AS shoe_name
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
  const { results: siblings } = await c.env.DB.prepare(
    `SELECT id, name, start_date_local, distance_m, moving_time_s, avg_hr, score, plan_id, json_extract(evaluation, '$.role') AS role FROM activities WHERE date = ? ORDER BY start_date_local`,
  ).bind(row.date).all();
  return c.json({ ...row, evaluation: row.evaluation ? JSON.parse(row.evaluation as string) : null, plan, siblings });
});

/** 計画の付け替え・シューズ変更 (計画を変えたら再評価) */
api.put('/activities/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ plan_id?: number | null; shoe_id?: number | null }>();
  if ('shoe_id' in body) {
    await c.env.DB.prepare('UPDATE activities SET shoe_id = ? WHERE id = ?').bind(body.shoe_id ?? null, id).run();
  }
  if ('plan_id' in body) {
    if (body.plan_id == null) {
      await ingestActivity(c.env, id, { planId: null });
    } else {
      // 同じ日に走ったランは、まとめて同じメニューに紐づける (距離の長い順に評価)
      const me = await c.env.DB.prepare('SELECT date FROM activities WHERE id = ?').bind(id).first<{ date: string }>();
      const { results } = await c.env.DB.prepare('SELECT id FROM activities WHERE date = ? ORDER BY distance_m DESC LIMIT 6')
        .bind(me?.date ?? '').all<{ id: number }>();
      const ids = results.length ? results.map((r) => r.id) : [id];
      for (const aid of ids) await ingestActivity(c.env, aid, { planId: body.plan_id });
    }
  }
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
  // retired: 0 使用中 / 1 引退 / 2 予備 (おすすめには出さない)
  const st = typeof b.retired === 'boolean' ? (b.retired ? 1 : 0) : [0, 1, 2].includes(Number(b.retired)) ? Number(b.retired) : 0;
  return [b.name, cleanPurposes(b.purpose), b.strava_gear_id || null, num(b.limit_km) ?? 700, num(b.initial_km) ?? 0, st, image];
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
  return c.json(await startBackfill(c.env, Number.isFinite(d) && d > 0 ? d : null, c.req.query('force') === '1'));
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
