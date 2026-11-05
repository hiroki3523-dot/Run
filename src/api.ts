import { cleanPurposes } from './shoes';
import { Hono } from 'hono';
import { addDays, weekStart } from './format';
import { ingestActivity, morningBriefing, SHOE_TOTAL_SQL } from './process';
import { notify } from './notify';
import { weatherDays, raceWeather, weatherAdvice } from './weather';
import { DEFAULT_PLACE, forecast, searchPlaces } from './forecast';
import { generatePlan, type PlannerRace } from './planner';
import { buildReview, growthOf, trainingLoad, type ReviewPlan, type ReviewRun } from './review';
import { getActivity, getSeries } from './strava';
import { buildRunReview, normalizeFb } from './runreview';
import { analyzeRun, groupOf, type Snapshot } from './analysis';
import { cleanText, legacyText } from './evaluate';
import { probeFit, probeLapJson } from './fitprobe';
import { runningNews } from './news';
import { applyCoach, askCoach, coachBrief, BRIEF_Q } from './coach';
import { autoFillRace, cleanRaceInfo, entryHistory, extractRaceInfo } from './raceinfo';
import { findOfficialSite } from './sitefind';
import { corosDisconnect, getAuth as getCorosAuth, corosStatus, corosTool, extractJson, enqueueCoros, processCorosQueue, removeCorosDuplicates, startCorosFullScan, syncCorosFitness } from './coros';
import { buildInsights, predictFromRuns, timeForVdot } from './insights';
import { buildAptitude } from './aptitude';
import { applyDerived } from './derive-apply';
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
    coros_connected: (await getCorosAuth(c.env)) != null,
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
      long_per_week: Math.min(3, Math.max(0, Math.round(Number(pp.long_per_week) || 0))),
      long_day: Math.min(6, Math.max(0, Math.round(Number(pp.long_day) || 0))),
      rest_per_week: Math.min(3, Math.max(0, Math.round(Number(pp.rest_per_week) || 0))),
      rest_days: [...new Set((pp.rest_days ?? []).map(Number).filter((n) => n >= 0 && n <= 6))],
      blocked: [...new Set((pp.blocked ?? []).filter((d) => isDate(d) && d >= addDays(today, -1)))].sort(),
    };
  }
  if (body.predict) {
    const pr = body.predict;
    const fs = Number(pr.full_s);
    body.predict = { source: pr.source === 'manual' ? 'manual' : pr.source === 'coros' ? 'coros' : 'auto', full_s: fs >= 3600 && fs <= 8 * 3600 ? Math.round(fs) : null };
  }
  if (body.source !== undefined) body.source = body.source === 'coros' ? 'coros' : 'strava';
  if (body.paces_auto !== undefined) body.paces_auto = !!body.paces_auto;
  // 手でペース帯などを保存したら、自動はやめる
  if (body.paces && body.paces_auto === undefined) body.paces_auto = false;
  if ((body as any).checklist_template !== undefined) {
    const t = (body as any).checklist_template;
    (body as any).checklist_template = Array.isArray(t)
      ? t.filter((x: any) => x && ['prep', 'morning'].includes(x.cat) && typeof x.text === 'string' && x.text.trim())
        .slice(0, 60).map((x: any) => ({ cat: x.cat, id: String(x.id).slice(0, 20), text: x.text.trim().slice(0, 60) }))
      : null;
  }
  if (body.weather_place) {
    const w = body.weather_place;
    const lat = Number(w.lat), lon = Number(w.lon);
    if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) return c.json({ error: '場所の座標が不正です' }, 400);
    body.weather_place = { name: String(w.name || '現在地').slice(0, 30), lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 };
  }
  await saveSettings(c.env, { ...(await getSettings(c.env)), ...body });
  // 自動のときは、出どころ (予測・取り込み元) を変えたらすぐ決め直す
  if ((await getSettings(c.env)).paces_auto !== false && (body.predict || body.source || body.paces_auto)) await applyDerived(c.env, false).catch(() => null);
  return c.json(await getSettings(c.env));
});

/**
 * 評価の基準 (ペース帯・心拍の目標・最大心拍・閾値心拍・目標ピッチ) だけを標準に戻す。
 * 取り込み元・予測タイムの出どころ・週の配置の回数・天気の場所・COROS から取り込んだ値はそのまま残す
 */
api.post('/settings/reset', async (c) => {
  const cur = await getSettings(c.env);
  const d = DEFAULT_SETTINGS;
  await saveSettings(c.env, { ...cur, paces: d.paces, hr_targets: d.hr_targets, max_hr: d.max_hr, lthr: cur.coros?.lthr ?? d.lthr, target_cadence: d.target_cadence });
  return c.json(await getSettings(c.env));
});

// ---------------------------------------------------------------- races

api.get('/races', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM races ORDER BY date').all();
  return c.json(results);
});
/** 大会の公式サイトを探す (Wikipedia の公式サイト欄・検索結果の候補) */
api.get('/races/find-site', async (c) => {
  const name = String(c.req.query('name') || '').slice(0, 60);
  if (!name) return c.json({ error: '大会名が必要です' }, 400);
  try { return c.json({ list: await findOfficialSite(c.env, name) }); } catch (e) { return c.json({ list: [], error: (e as Error).message }); }
});
/** 大会ごとの例年のエントリー時期 (公式サイトを読んだときに覚えたもの) */
api.get('/races/entry-history', async (c) => c.json(await entryHistory(c.env)));

function raceValues(b: Record<string, unknown>) {
  if (!b.name || !isDate(b.date) || !num(b.distance_m)) throw new Error('name, date, distance_m は必須です');
  const status = ['candidate', 'entered', 'confirmed'].includes(String(b.status)) ? String(b.status) : 'confirmed';
  const url = typeof b.url === 'string' && /^https?:\/\//.test(b.url.trim()) ? b.url.trim().slice(0, 500) : null;
  const info = b.info == null || b.info === '' ? null : JSON.stringify(cleanRaceInfo(typeof b.info === 'string' ? JSON.parse(b.info) : b.info));
  return [b.name, b.date, num(b.distance_m), num(b.goal_time_s), b.priority ?? 'A', num(b.result_time_s), b.notes ?? null, status, url, info];
}

api.post('/races', async (c) => {
  const body = await c.req.json<any>();
  const row = await c.env.DB.prepare(
    'INSERT INTO races (name, date, distance_m, goal_time_s, priority, result_time_s, notes, status, url, info) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
  )
    .bind(...raceValues(body))
    .first<any>();
  await applyDerived(c.env, false).catch(() => null); // M ペース・レースのペース帯は目標タイムから
  // 公式サイトがあれば、裏で大会情報 (日付・エントリー期間など) を読み取っておく
  if (row?.url && !body.no_auto) c.executionCtx.waitUntil(autoFillRace(c.env, row.id).catch(() => null));
  return c.json(row, 201);
});

api.put('/races/:id', async (c) => {
  const body = await c.req.json<any>();
  const before = await c.env.DB.prepare('SELECT url FROM races WHERE id = ?').bind(c.req.param('id')).first<{ url: string | null }>();
  const row = await c.env.DB.prepare(
    `UPDATE races SET name = ?, date = ?, distance_m = ?, goal_time_s = ?, priority = ?, result_time_s = ?, notes = ?, status = ?, url = ?, info = ?
     WHERE id = ? RETURNING *`,
  )
    .bind(...raceValues(body), c.req.param('id'))
    .first<any>();
  await applyDerived(c.env, false).catch(() => null);
  // 公式サイトを新しく入れた・変えたときは、裏で読み取る
  if (row?.url && row.url !== before?.url && !body.no_auto) c.executionCtx.waitUntil(autoFillRace(c.env, row.id).catch(() => null));
  return row ? c.json(row) : c.notFound();
});

/** レースの結果: その日の実績からいちばん近い距離のランを結び付け、目標との差・前半/後半のペース・次の目標の目安を出す */
api.post('/races/:id/result', async (c) => {
  const race = await c.env.DB.prepare('SELECT * FROM races WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!race) return c.notFound();
  const b = await c.req.json<{ activity_id?: number; result_time_s?: number }>().catch(() => ({} as any));
  let act: any = null;
  if (b.activity_id) act = await c.env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(b.activity_id).first();
  else {
    const { results } = await c.env.DB.prepare("SELECT * FROM activities WHERE date = ? AND sport_type LIKE '%Run%'").bind(race.date).all<any>();
    act = results.sort((x, y) => Math.abs(x.distance_m - race.distance_m) - Math.abs(y.distance_m - race.distance_m))[0] ?? null;
    if (act && Math.abs(act.distance_m - race.distance_m) > race.distance_m * 0.15) act = null;
  }
  const result = Number(b.result_time_s) > 0 ? Math.round(Number(b.result_time_s)) : act ? act.elapsed_time_s ?? act.moving_time_s : null;
  if (!result) return c.json({ error: 'その日にレースの距離に近いランが見つかりません。結果タイムを入力してください' }, 400);
  await c.env.DB.prepare('UPDATE races SET result_time_s = ?, activity_id = ? WHERE id = ?').bind(result, act?.id ?? race.activity_id ?? null, race.id).run();
  return c.json({ ok: true, result_time_s: result, activity_id: act?.id ?? null });
});
api.get('/races/:id/result', async (c) => {
  const race = await c.env.DB.prepare('SELECT * FROM races WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!race || !race.result_time_s) return c.json(null);
  const km = race.distance_m / 1000;
  const out: any = { goal_s: race.goal_time_s, result_s: race.result_time_s, diff_s: race.goal_time_s ? race.result_time_s - race.goal_time_s : null, activity_id: race.activity_id };
  if (race.activity_id) {
    try {
      const a: any = await getActivity(c.env, race.activity_id);
      const sp = (a.splits_metric ?? []).filter((x: any) => x.distance > 900);
      if (sp.length >= 6) {
        const h = Math.floor(sp.length / 2);
        const pc = (xs: any[]) => xs.reduce((t: number, x: any) => t + x.moving_time, 0) / (xs.reduce((t: number, x: any) => t + x.distance, 0) / 1000);
        out.first_pace = Math.round(pc(sp.slice(0, h))); out.second_pace = Math.round(pc(sp.slice(h)));
        const paces = sp.map((x: any) => (x.moving_time / x.distance) * 1000);
        const goalP = race.goal_time_s ? race.goal_time_s / km : null;
        out.km_paces = paces.map((p: number) => Math.round(p));
        if (goalP) { const k = paces.findIndex((p: number, i: number) => i >= 5 && p > goalP + 10); out.fade_km = k >= 0 ? k + 1 : null; }
      }
    } catch { /* ラップが取れなくても結果は出す */ }
  }
  // 次の目標の目安: 結果から同じ力の目安 (VDOT)。フルは 2〜3% の改善を次の目標に
  const vd = vdotOf(km * 1000, race.result_time_s);
  out.next_goal_s = vd ? Math.round(timeForVdot(vd, 42195) * 0.98) : null;
  out.vdot = vd ? Math.round(vd * 10) / 10 : null;
  return c.json(out);
});

/** 大会を探す画面の詳細: 一覧の大会の公式サイトを読む (保存しない。同じ URL は 1 週間覚えておく) */
api.post('/races/preview', async (c) => {
  const { name, date, url } = await c.req.json<{ name: string; date: string; url: string }>();
  if (!url || !/^https?:\/\//.test(url)) return c.json({ error: '公式サイトの URL が必要です' }, 400);
  const key = `rprev:${url}`;
  const hit = await kvGet(c.env, key);
  if (hit) { try { const o = JSON.parse(hit); if (Date.now() - o.at < 7 * 86400_000) return c.json(o.info); } catch {} }
  try {
    const info = await extractRaceInfo(c.env, { name: String(name).slice(0, 60), date: String(date).slice(0, 10) }, { url });
    await kvSet(c.env, key, JSON.stringify({ at: Date.now(), info }));
    return c.json(info);
  } catch (e) {
    const m = (e as Error).message;
    return c.json({ error: /neuron|quota|4006/i.test(m) ? 'AI の 1 日の無料枠を使い切りました。明日 9:00 に戻ります' : m }, 500);
  }
});

/** 公式サイト (または貼り付けた文章) から大会情報を読み取る。保存はしない (画面で確かめてから) */
api.post('/races/:id/extract', async (c) => {
  const race = await c.env.DB.prepare('SELECT * FROM races WHERE id = ?').bind(c.req.param('id')).first<any>();
  if (!race) return c.notFound();
  const { url, text } = await c.req.json<{ url?: string; text?: string }>();
  try {
    return c.json(await extractRaceInfo(c.env, { name: race.name, date: race.date }, { url: url || race.url || undefined, text }));
  } catch (e) {
    const m = (e as Error).message;
    return c.json({ error: /neuron|quota|4006/i.test(m) ? 'AI の 1 日の無料枠を使い切りました。明日 9:00 に戻ります' : m }, 500);
  }
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
        `SELECT id, date, name, distance_m, moving_time_s, avg_hr, score, plan_id, evaluation, json_extract(evaluation, '$.role') AS role, COALESCE(json_extract(evaluation, '$.eff_type'), json_extract(evaluation, '$.type')) AS type,
           (SELECT p.type FROM plans p WHERE p.id = activities.plan_id) AS plan_type
         FROM activities WHERE date BETWEEN ? AND ? ORDER BY start_date_local`,
      ).bind(a, b).all<Omit<ReviewRun, 'comments'> & { evaluation: string | null }>(),
      c.env.DB.prepare('SELECT id, date, type, distance_m FROM plans WHERE date BETWEEN ? AND ?').bind(a, b).all<ReviewPlan>(),
    ]);
    const list: ReviewRun[] = runs.results.map(({ evaluation, ...r }) => {
      let comments: string[] = [];
      try { comments = evaluation ? (JSON.parse(evaluation).comments ?? []).map(cleanText).filter(Boolean).slice(0, 3) : []; } catch { /* 古い形式は無視 */ }
      return { ...r, comments, tl: trainingLoad(r.moving_time_s, r.avg_hr, lthr) };
    });
    return { list, plans: plans.results };
  };
  const span = daysSpan(from, to);
  const prevTo = addDays(from, -1);
  // 月は「前の月 (1 日〜末日)」と比べる。日数で戻すと 31 日の月で 1 日ずれる (11 月の前月が 10/2〜10/31 になっていた)
  const prevFrom = k === 'month' ? `${prevTo.slice(0, 7)}-01` : addDays(prevTo, -(span - 1));
  const [cur, prv] = await Promise.all([load(from, to), k === 'day' ? null : load(prevFrom, prevTo)]);
  const prev = prv ? { runs: prv.list.length, km: prv.list.reduce((a, r) => a + r.distance_m, 0) / 1000 } : null;
  // 前の期間の平均 (先週・先月からの変化の表示用)
  const avgOf = (rs: ReviewRun[]) => { const d = rs.reduce((a, r) => a + r.distance_m, 0), t = rs.reduce((a, r) => a + r.moving_time_s, 0); const h = rs.filter((r) => r.avg_hr); const hd = h.reduce((a, r) => a + r.distance_m, 0); return { km: Math.round(d / 100) / 10, runs: rs.length, avg_pace_s: d > 0 ? Math.round(t / (d / 1000)) : null, avg_hr: hd > 0 ? Math.round(h.reduce((a, r) => a + r.avg_hr! * r.distance_m, 0) / hd) : null }; };
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const { results: races } = await c.env.DB.prepare("SELECT name, date, priority, distance_m FROM races WHERE date BETWEEN ? AND ? AND COALESCE(status, 'confirmed') != 'candidate'").bind(addDays(from, -8), addDays(to, 15)).all<any>();
  const rv = buildReview(from, to, cur.list, cur.plans, prev, k, { today, races });
  return c.json({ ...rv, prev_detail: prv ? avgOf(prv.list) : null, growth: k === 'day' ? null : growthOf(cur.list, prv?.list ?? []) });
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
  const out = Array.from({ length: weeks }, (_, i) => ({ week: addDays(first, i * 7), km: 0, tl: 0, runs: 0 }));
  for (const r of results) {
    const i = Math.floor(daysSpan(first, r.date) - 1) / 7 | 0;
    if (out[i]) {
      out[i].km += r.distance_m / 1000;
      out[i].runs += 1;
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
  // 大会はランの日から見た次の大会 (今日ではなく)。分析と同じ条件
  const race = await nextRaceFor(c.env, row.date);
  let raw: any = {};
  try { raw = JSON.parse((await kvGet(c.env, `fb:${id}`)) ?? '{}'); } catch { /* 無視 */ }
  if (raw.v !== 2 && !raw.rpe) { const old = await kvGet(c.env, `rpe:${id}`); if (old) raw.rpe = Number(old); }
  const fb = normalizeFb(raw);
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
  const series = await getSeries(c.env, id, paceBoundsOf(st), [0.8, 0.9, 0.95, 1.017, 1.057].map((r) => Math.round(st.coros.lthr * r))).catch(() => null);
  const review = buildRunReview({
    score: row.score ?? 0,
    sub: { pace: ev?.pace?.score ?? null, hr: ev?.hr?.score ?? null, form: ev?.form?.score ?? null },
    main: { distance_m: row.distance_m, moving_time_s: row.moving_time_s, avg_hr: row.avg_hr, max_hr: row.max_hr },
    parts: sib,
    splits, series,
    lthr: st.coros.lthr ?? st.lthr, max_hr: st.max_hr,
    band: plan?.pace_min_s && plan?.pace_max_s ? { min: plan.pace_min_s, max: plan.pace_max_s } : null,
    race: race ?? null, today: row.date, // 大会までの日数は、ランの日から数える
    fb,
  });
  return c.json({ ...review, fb });
});

/** 距離とタイムから VDOT (Daniels) */
function vdotOf(distM: number, timeS: number): number | null {
  if (!distM || !timeS) return null;
  const min = timeS / 60, v = distM / min;
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * min) + 0.2989558 * Math.exp(-0.1932605 * min);
  return vo2 / pct;
}

/** その日・その時間の気温 (Open-Meteo。直近は予報 API の過去分、古い日は過去データ API) */
async function runTemp(place: { lat: number; lon: number }, startLocal: string): Promise<number | null> {
  const d = startLocal.slice(0, 10), h = Number(startLocal.slice(11, 13));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const ago = (Date.now() - Date.parse(`${d}T00:00:00Z`)) / 86400_000;
  const base = ago < 80 ? 'https://api.open-meteo.com/v1/forecast' : 'https://archive-api.open-meteo.com/v1/archive';
  const q = new URLSearchParams({ latitude: String(place.lat), longitude: String(place.lon), start_date: d, end_date: d, hourly: 'temperature_2m', timezone: 'Asia/Tokyo' });
  const res = await fetch(`${base}?${q}`, { cf: { cacheTtl: 86400, cacheEverything: true } } as RequestInit);
  if (!res.ok) return null;
  const j: any = await res.json();
  const v = j?.hourly?.temperature_2m?.[Math.max(0, Math.min(23, h))];
  return typeof v === 'number' ? Math.round(v * 10) / 10 : null;
}

/**
 * そのランの日から見た次の大会。ランのレビューと分析で同じ条件を使う:
 * ランの日以降・エントリー候補は除く・優先度 C は除く (未設定は A とみなす)。日・週・月の評価 (review.ts) も候補と C を除く
 */
async function nextRaceFor(env: Env, date: string): Promise<{ name: string; date: string; goal_time_s: number | null; distance_m: number } | null> {
  return env.DB.prepare("SELECT name, date, goal_time_s, distance_m FROM races WHERE date >= ? AND COALESCE(status, 'confirmed') != 'candidate' AND COALESCE(priority, 'A') != 'C' ORDER BY date LIMIT 1").bind(date).first<any>();
}

/** 過去 180 日のランの要約 (比較用)。DB の値に、分析したときに保存した詳しい要約 (snap:) を重ねる */
async function pastSnapshots(env: Env, beforeDate: string, easyMin: number): Promise<Snapshot[]> {
  const from = addDays(beforeDate, -180);
  const [{ results: rows }, { results: snaps }, { results: fbs }] = await Promise.all([
    env.DB.prepare(`SELECT id, date, distance_m, moving_time_s, avg_hr, avg_cadence_spm, COALESCE(json_extract(evaluation, '$.eff_type'), json_extract(evaluation, '$.type')) AS type, json_extract(evaluation, '$.pace.details.half_diff_s') AS hd, json_extract(evaluation, '$.role') AS role
      FROM activities WHERE date BETWEEN ? AND ? AND sport_type LIKE '%Run%' AND distance_m >= 1500 ORDER BY date DESC LIMIT 400`).bind(from, beforeDate).all<any>(),
    env.DB.prepare(`SELECT key, value FROM kv WHERE key LIKE 'snap:%'`).all<{ key: string; value: string }>(),
    env.DB.prepare(`SELECT key, value FROM kv WHERE key LIKE 'fb:%'`).all<{ key: string; value: string }>(),
  ]);
  const snapOf = new Map(snaps.map((r) => { try { return [Number(r.key.slice(5)), JSON.parse(r.value)] as const; } catch { return [0, null] as const; } }));
  const rpeOf = new Map(fbs.map((r) => { try { return [Number(r.key.slice(3)), JSON.parse(r.value)?.rpe ?? null] as const; } catch { return [0, null] as const; } }));
  return rows.filter((r) => r.role !== 'warmup' && r.role !== 'cooldown').map((r) => {
    const pace = r.moving_time_s / (r.distance_m / 1000);
    const base: Snapshot = { id: r.id, date: r.date, km: Math.round(r.distance_m / 10) / 100, pace: Math.round(pace), hr: r.avg_hr ? Math.round(r.avg_hr) : null, group: groupOf(r.type, pace, easyMin),
      rpe: rpeOf.get(r.id) ?? null, half_diff: r.hd ?? null, cad: r.avg_cadence_spm ? Math.round(r.avg_cadence_spm) : null /* DB の値はすでに両足の spm */, stride: null, gct: null, vo: null, power: null, elev_per_km: null, drift: null };
    return { ...base, ...(snapOf.get(r.id) ?? {}), id: r.id, date: r.date };
  });
}

/** ランの分析: 練習達成度・走力評価・ペースと心拍・過去との比較・フォーム */
api.get('/activities/:id/analysis', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await c.env.DB.prepare('SELECT * FROM activities WHERE id = ?').bind(id).first<Record<string, any>>();
  if (!row) return c.notFound();
  const st = await getSettings(c.env);
  const ev = row.evaluation ? legacyText(JSON.parse(row.evaluation), { distance_m: row.distance_m, moving_time_s: row.moving_time_s }) : null;
  const plan = row.plan_id ? await c.env.DB.prepare('SELECT type FROM plans WHERE id = ?').bind(row.plan_id).first<{ type: string }>() : null;
  let fb: any = null;
  try { const raw = JSON.parse((await kvGet(c.env, `fb:${id}`)) ?? 'null'); if (raw) fb = normalizeFb(raw); } catch { /* 無視 */ }
  const lthr = st.coros?.lthr ?? st.lthr;
  const series = await getSeries(c.env, id, paceBoundsOf(st), [0.8, 0.9, 0.95, 1.017, 1.057].map((r) => Math.round(lthr * r)), 240).catch(() => null);
  const past = await pastSnapshots(c.env, row.date, st.paces.easy.min);
  // 走った時間の気温 (比較の条件をそろえるため)。一度調べたら要約に保存して、次からは調べない
  let temp: number | null = null;
  try { const old = JSON.parse((await kvGet(c.env, `snap:${id}`)) || '{}'); if (typeof old.temp === 'number') temp = old.temp; } catch { /* 無視 */ }
  if (temp == null) temp = await runTemp(st.weather_place ?? DEFAULT_PLACE, String(row.start_date_local)).catch(() => null);
  // 次の大会 (このランの日から)・その日と翌朝の体調・記録元 (表示と評価の基準をそろえるため)
  const [nextRace, condRows, extRow] = await Promise.all([
    nextRaceFor(c.env, row.date).catch(() => null),
    c.env.DB.prepare("SELECT key, value FROM kv WHERE key IN (?, ?)").bind(`cond:${row.date}`, `cond:${addDays(row.date, 1)}`).all<{ key: string; value: string }>().catch(() => ({ results: [] as { key: string; value: string }[] })),
    c.env.DB.prepare("SELECT 1 AS x FROM ext_activities WHERE id = ? AND data NOT LIKE '{\"dup_of\"%'").bind(id).first().catch(() => null),
  ]);
  const condOf = (k: string) => { const r = condRows.results.find((x) => x.key === k); try { return r ? JSON.parse(r.value) : null; } catch { return null; } };
  const cond = condOf(`cond:${addDays(row.date, 1)}`) ?? condOf(`cond:${row.date}`);
  const race = nextRace ? { name: nextRace.name, date: nextRace.date, goal_s: nextRace.goal_time_s ?? null, distance_m: nextRace.distance_m || 42195, days: Math.round((Date.parse(nextRace.date) - Date.parse(row.date)) / 86400_000) } : null;
  const input = {
    race, cond, elapsed_time_s: row.elapsed_time_s ?? null, source: extRow ? 'COROS' : row.id > 0 ? 'Strava' : null,
    temp, id, date: row.date, distance_m: row.distance_m, moving_time_s: row.moving_time_s, avg_hr: row.avg_hr, avg_cad_spm: row.avg_cadence_spm,
    elev_gain: series?.elev_gain ?? null, ev, plan_type: plan?.type ?? null, has_plan: !!plan, fb, series, easy_min: st.paces.easy.min, lthr, past,
  };
  let a = analyzeRun(input);
  // 比べたランの気温が分からなければ調べて保存し、もう一度比べる (気温の近いランを優先するため)
  const noTemp = (a.compare?.runs ?? []).filter((r: any) => r.temp == null).slice(0, 6);
  if (noTemp.length) {
    const rows2 = await Promise.all(noTemp.map((r) => c.env.DB.prepare('SELECT start_date_local FROM activities WHERE id = ?').bind(r.id).first<{ start_date_local: string }>()));
    const temps = await Promise.all(rows2.map((r) => (r ? runTemp(st.weather_place ?? DEFAULT_PLACE, r.start_date_local).catch(() => null) : null)));
    let changed = false;
    for (let k = 0; k < noTemp.length; k++) {
      if (temps[k] == null) continue;
      const pr = past.find((x) => x.id === noTemp[k].id);
      if (pr) { pr.temp = temps[k]; changed = true; }
      const old = JSON.parse((await kvGet(c.env, `snap:${noTemp[k].id}`)) || 'null');
      if (old) await kvSet(c.env, `snap:${noTemp[k].id}`, JSON.stringify({ ...old, temp: temps[k] })).catch(() => null);
      else if (pr) { const { id: _a, date: _b, ...rest } = pr; await kvSet(c.env, `snap:${noTemp[k].id}`, JSON.stringify(rest)).catch(() => null); }
    }
    if (changed) a = analyzeRun(input);
  }
  // 次から比較に使えるよう、この走りの要約を保存
  const { id: _i, date: _d, ...snap } = a.snapshot;
  await kvSet(c.env, `snap:${id}`, JSON.stringify(snap)).catch(() => null);
  // ペースと心拍を重ねたグラフ用 (120 点に間引く)
  const chart = series ? (() => { const step = Math.max(1, Math.ceil(series.d.length / 120)); const pick = <T,>(xs: T[]) => xs.filter((_, k) => k % step === 0); return { d: pick(series.d), pace: pick(series.pace), hr: pick(series.hr) }; })() : null;
  return c.json({ ...a, chart });
});

/** ふりかえり (呼吸・脚・全体のきつさ・フォーム・痛み・余裕・メモ・コンディション) を保存する */
api.put('/activities/:id/feedback', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<Record<string, unknown>>();
  const fb = normalizeFb({ ...b, v: 2 });
  await kvSet(c.env, `fb:${id}`, JSON.stringify({ v: 2, ...fb }));
  return c.json({ ok: true });
});

/** 実績詳細のグラフ用の時系列 (ペース・心拍・ピッチ・ストライド・標高) とゾーン分布 */
api.get('/activities/:id/series', async (c) => {
  try {
    const st = await getSettings(c.env);
    const lt = st.coros.lt_pace_s;
    // COROS と同じ境界: 閾値ペース 4:07 → 5:45 / 4:46 / 4:26 / 4:02 / 3:42
    const paceBounds = paceBoundsOf(st);
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
/** 予定の相談 (AI)。返事と計画の変更案を返す (まだ反映しない) */
api.post('/coach', async (c) => {
  const { messages } = await c.req.json<{ messages: any[] }>();
  try {
    return c.json(await askCoach(c.env, Array.isArray(messages) ? messages : []));
  } catch (e) {
    const m = (e as Error).message;
    return c.json({ error: /neuron|quota|limit|4006/i.test(m) ? 'AI の 1 日の無料枠を使い切りました。明日 9:00 に戻ります' : m }, 500);
  }
});
/** 今週の見立て (計画画面を開いたときに出す。同じ状況ならキャッシュ) */
api.post('/coach/brief', async (c) => {
  const { force } = await c.req.json<{ force?: boolean }>().catch(() => ({ force: false }));
  try { return c.json({ ...(await coachBrief(c.env, !!force)), q: BRIEF_Q }); }
  catch (e) { const m = (e as Error).message; return c.json({ error: /neuron|quota|limit|4006/i.test(m) ? 'AI の 1 日の無料枠を使い切りました。明日 9:00 に戻ります' : m }, 500); }
});
/** 相談で出た変更案を計画に反映 */
api.post('/coach/apply', async (c) => {
  const { changes } = await c.req.json<{ changes: any[] }>();
  return c.json({ applied: await applyCoach(c.env, Array.isArray(changes) ? changes : []) });
});

api.post('/plans/generate', async (c) => {
  const b = await c.req.json<{ race_id?: number; overwrite?: boolean; commit?: boolean; from?: string; to?: string }>();
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const start = isDate(b.from) ? b.from : today;
  const race = b.race_id
    ? await c.env.DB.prepare('SELECT * FROM races WHERE id = ?').bind(b.race_id).first<PlannerRace & { id: number }>()
    : await c.env.DB.prepare("SELECT * FROM races WHERE date > ? AND priority IN ('A','B') AND COALESCE(status, 'confirmed') != 'candidate' ORDER BY date LIMIT 1").bind(start).first<PlannerRace & { id: number }>();
  if (!race) return c.json({ error: '対象のレースがありません。レースを登録してください' }, 400);
  if (race.date < start) return c.json({ error: 'レースの日付が過ぎています' }, 400);

  const [{ results: others }, recent, lastWeek, lastRace, settings] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM races WHERE date >= ? AND date < ? AND COALESCE(status, 'confirmed') != 'candidate' ORDER BY date").bind(start, race.date).all<PlannerRace>(),
    c.env.DB.prepare('SELECT COALESCE(SUM(distance_m), 0) AS m FROM activities WHERE date BETWEEN ? AND ?').bind(addDays(start, -28), addDays(start, -1)).first<{ m: number }>(),
    c.env.DB.prepare(
      `SELECT (SELECT COALESCE(SUM(distance_m), 0) FROM activities WHERE date BETWEEN ?1 AND ?2) AS done,
              (SELECT COALESCE(SUM(distance_m), 0) FROM plans WHERE date BETWEEN ?1 AND ?2 AND type != 'rest') AS planned`,
    ).bind(addDays(start, -7), addDays(start, -1)).first<{ done: number; planned: number }>(),
    c.env.DB.prepare("SELECT date FROM races WHERE date < ? AND date >= ? AND COALESCE(status, 'confirmed') != 'candidate' AND (priority IN ('A', 'B') OR distance_m >= 30000) ORDER BY date DESC LIMIT 1").bind(start, addDays(start, -10)).first<{ date: string }>(),
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
// ---------------------------------------------------------------- COROS

api.get('/coros/status', async (c) => c.json({ ...(await corosStatus(c.env)), fitness_raw: (await kvGet(c.env, 'coros_fitness_raw')) || null, fit_fields: JSON.parse((await kvGet(c.env, 'coros_fit_fields')) || 'null') }));
/** 取り込み済みのランを取り直す (ランニングダイナミクス・歩幅を後から入れるため)。1 日 50 件まで */
api.post('/coros/reimport', async (c) => {
  const { days } = await c.req.json<{ days?: number }>().catch(() => ({ days: 14 }));
  const t = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const from = new Date(Date.parse(t) - Math.min(90, Math.max(1, Number(days) || 14)) * 86400_000).toISOString().slice(0, 10);
  return c.json({ queued: await enqueueCoros(c.env, from, t, true) });
});
/** 新しいランを確認して、少し取り込む */
api.post('/coros/sync', async (c) => {
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const removed = await removeCorosDuplicates(c.env);
  const added = await enqueueCoros(c.env, addDays(today, -6), today);
  const imported = await processCorosQueue(c.env, 3);
  return c.json({ added, imported, removed, ...(await corosStatus(c.env)) });
});
/** 過去のランを順番待ちに入れる (毎分少しずつ取り込む。FIT は 1 日 50 件まで) */
api.post('/coros/backfill', async (c) => {
  const { days, all } = await c.req.json<{ days?: number; all?: boolean }>();
  await removeCorosDuplicates(c.env);
  if (all) { await startCorosFullScan(c.env); return c.json({ added: 0, scanning: true, ...(await corosStatus(c.env)) }); }
  const n = Math.min(400, Math.max(1, Math.round(Number(days) || 30)));
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const added = await enqueueCoros(c.env, addDays(today, -n), today);
  return c.json({ added, ...(await corosStatus(c.env)) });
});
api.post('/coros/fitness', async (c) => {
  try {
    const f = await syncCorosFitness(c.env);
    await kvSet(c.env, 'coros_fitness_err', '');
    return c.json(f);
  } catch (e) {
    await kvSet(c.env, 'coros_fitness_err', (e as Error).message.slice(0, 200));
    throw e;
  }
});
api.post('/coros/disconnect', async (c) => { await corosDisconnect(c.env); return c.json({ ok: true }); });
/** 診断用: ランの一覧を条件を変えて呼び、それぞれ何件返るかを並べる (取り込みが少ない原因を切り分ける) */
api.get('/coros/probe', async (c) => {
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const ymd = (d: string) => d.replace(/-/g, '');
  const ago = (n: number) => ymd(addDays(today, -n));
  const cases: [string, Record<string, unknown>][] = [
    ['指定なし (直近 7 日)', {}],
    ['7 日・日付だけ', { startDate: ago(6), endDate: ago(0) }],
    ['7 日・種類つき', { startDate: ago(6), endDate: ago(0), sportTypeCodes: [100, 101, 102, 103, 104] }],
    ['7 日・件数 50', { startDate: ago(6), endDate: ago(0), limit: 50 }],
    ['30 日・日付だけ', { startDate: ago(29), endDate: ago(0) }],
    ['30 日・件数 100', { startDate: ago(29), endDate: ago(0), limit: 100 }],
    ['1 年前の 7 日', { startDate: ago(371), endDate: ago(365) }],
  ];
  const out = [];
  for (const [label, args] of cases) {
    try {
      const r = await corosTool(c.env, 'querySportRecords', args);
      const head = r.text.split('\n')[0].slice(0, 90);
      out.push(`${label}: ${(r.text.match(/LabelId/gi) ?? []).length} 件 | ${head}`);
    } catch (e) {
      out.push(`${label}: エラー ${(e as Error).message.slice(0, 120)}`);
    }
  }
  return c.json({ text: out.join('\n') });
});

/** 診断用: COROS の応答をそのまま見る (読み取りのツールだけ) */
api.get('/coros/debug', async (c) => {
  const tool = c.req.query('tool') ?? 'querySportRecords';
  if (!['querySportRecords', 'queryFitnessAssessmentOverview', 'queryActivityLapData', 'queryActivityFitFileDownloadUrls', 'queryUserInfo'].includes(tool)) return c.json({ error: 'このツールは使えません' }, 400);
  const args = JSON.parse(c.req.query('args') ?? '{}');
  const r = await corosTool(c.env, tool, args);
  return c.json({ text: r.text.slice(0, 6000), structured: r.structured });
});

/**
 * 【調査用・読み取りのみ】このランの COROS のデータに、ワークアウトの区間 (アップ・メイン・ダウン・レスト) の情報があるかを調べる。
 * ラップの API と FIT ファイルを読み直して形をまとめるだけで、保存・取り込み・評価は何も変えない。
 * COROS の FIT のダウンロードは 1 日の回数に上限があるので、ボタンを押したときだけ動く。
 */
api.get('/activities/:id/coros-segments', async (c) => {
  const id = Number(c.req.param('id'));
  const ext = await c.env.DB.prepare('SELECT ext_id, json_extract(data, \'$.act.sport_type\') AS st, json_extract(data, \'$.act.laps\') AS laps FROM ext_activities WHERE id = ?').bind(id).first<{ ext_id: string; st: string; laps: string | null }>();
  if (!ext) return c.json({ error: 'COROS から取り込んだランではありません' }, 404);
  const sportType = ext.st === 'TrailRun' ? 102 : ext.st === 'VirtualRun' ? 101 : 100;
  const out: Record<string, unknown> = { labelId_suffix: ext.ext_id.slice(-4), saved_laps: (() => { try { return (JSON.parse(ext.laps || '[]') as any[]).map((l) => ({ dist_m: Math.round(l.distance), time_s: l.moving_time })); } catch { return null; } })() };
  try {
    const r = await corosTool(c.env, 'queryActivityLapData', { labelId: ext.ext_id, sportType });
    out.lap_api = probeLapJson(extractJson(r.text) ?? r.structured);
  } catch (e) { out.lap_api_error = (e as Error).message.slice(0, 200); }
  try {
    const urls = await corosTool(c.env, 'queryActivityFitFileDownloadUrls', { labelId: ext.ext_id, sportType });
    const link = (urls.text.match(/https?:\/\/[^\s)"'\]<>]+/g) ?? [])[0] ?? JSON.stringify(urls.structured ?? '').match(/https?:\/\/[^\s)"'\]<>\\]+/)?.[0];
    if (!link) out.fit_error = 'FIT のダウンロード先が見つかりません';
    else { const res = await fetch(link); out.fit = res.ok ? probeFit(await res.arrayBuffer()) : { error: `FIT の取得に失敗 (${res.status})` }; }
  } catch (e) { out.fit_error = (e as Error).message.slice(0, 200); }
  return c.json(out);
});

/** 評価の基準をデータから決めて保存 (自動のとき) */
api.post('/settings/derive', async (c) => c.json(await applyDerived(c.env, true)));

/** 実績から見た課題と、次にやる練習 (目標タイムのある次のレースに向けて) */
api.get('/insights', async (c) => {
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const st = await getSettings(c.env);
  const [runs, race] = await Promise.all([
    c.env.DB.prepare(
      `SELECT a.date, a.distance_m, a.moving_time_s, a.avg_hr, a.avg_cadence_spm, p.type AS plan_type,
         json_extract(a.evaluation, '$.role') AS role, json_extract(a.evaluation, '$.hr.details.drift_pct') AS drift_pct
       FROM activities a LEFT JOIN plans p ON p.id = a.plan_id WHERE a.date BETWEEN ? AND ?`,
    ).bind(addDays(today, -56), today).all<any>(),
    c.env.DB.prepare("SELECT name, date, distance_m, goal_time_s FROM races WHERE date >= ? AND COALESCE(status, 'confirmed') != 'candidate' ORDER BY goal_time_s IS NULL, date LIMIT 1").bind(today).first<any>(),
  ]);
  // 予測タイム: 入力した値 (COROS など) か、Strava の記録 (ペースと心拍) からの推定
  const src = st.predict?.source ?? 'auto';
  const manual = src === 'manual', fromCoros = src === 'coros';
  const auto = manual || fromCoros ? null : predictFromRuns(runs.results, st.max_hr || 190, today);
  const predicted = manual ? st.predict?.full_s ?? null : fromCoros ? st.coros?.predicted_s?.full ?? null : auto?.full_s ?? null;
  const ins = buildInsights({
    today, runs: runs.results, race: race ?? null,
    predicted_full_s: predicted,
    predicted_label: manual ? '予測 (入力)' : fromCoros ? 'COROS 予測' : auto ? '予測 (Strava から)' : '予測',
    target_cadence: st.target_cadence ?? 180,
  });
  // マラソン適性 (6 つの能力) と予測の根拠・信頼度
  const { results: rs } = await c.env.DB.prepare(
    `SELECT a.id, a.date, a.distance_m, a.moving_time_s, a.avg_hr, COALESCE(json_extract(a.evaluation, '$.eff_type'), p.type, json_extract(a.evaluation, '$.type')) AS type, json_extract(a.evaluation, '$.role') AS role,
       json_extract(a.evaluation, '$.hr.details.drift_pct') AS drift, json_extract(a.evaluation, '$.pace.details.half_diff_s') AS half_diff, json_extract(a.evaluation, '$.form.score') AS form_score
     FROM activities a LEFT JOIN plans p ON p.id = a.plan_id WHERE a.date BETWEEN ? AND ? AND a.sport_type LIKE '%Run%'`,
  ).bind(addDays(today, -90), today).all<any>();
  const { results: kvs } = await c.env.DB.prepare(`SELECT key, value FROM kv WHERE key LIKE 'fb:%' OR key LIKE 'cond:%'`).all<{ key: string; value: string }>();
  const fbOf = new Map<number, any>(), condOf = new Map<string, any>();
  for (const k of kvs) { try { if (k.key.startsWith('fb:')) fbOf.set(Number(k.key.slice(3)), normalizeFb(JSON.parse(k.value))); else condOf.set(k.key.slice(5), JSON.parse(k.value)); } catch { /* 無視 */ } }
  const apt = buildAptitude({
    today,
    runs: rs.map((r) => { const f = fbOf.get(r.id); return { ...r, leg: f?.leg ?? null, rpe: f?.rpe ?? null, pain: f?.pain ?? null, reserve: f?.reserve ?? null, leg_next: condOf.get(addDays(r.date, 1))?.leg ?? null }; }),
    goal_s: race?.goal_time_s ?? null, race_km: race ? race.distance_m / 1000 : 42.195,
    predicted_s: predicted, source: manual ? '時計 (COROS など) の予測を手で入力した値' : fromCoros ? 'COROS のレース予測 (体力評価)' : auto ? `Strava の記録 ${auto.n} 本 (心拍の高い 5km 以上のラン) のペースと心拍から推定 (VDOT)` : '予測なし',
    lt_pace_s: st.coros?.lt_pace_s ?? null, vo2max: st.coros?.vo2max ?? null, lthr: st.coros?.lthr ?? st.lthr,
  });
  return c.json({ ...ins, aptitude: apt });
});


// ---------------------------------------------------------------- 回復 (毎朝の体調)

const n10 = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(10, Math.round(Number(v)))));
/** その日の朝の体調 (脚の疲労・筋肉の張り・痛み・睡眠・全身の疲労)。cond:YYYY-MM-DD */
api.get('/condition', async (c) => {
  const to = c.req.query('to') || new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const from = c.req.query('from') || addDays(to, -13);
  const { results } = await c.env.DB.prepare("SELECT key, value FROM kv WHERE key >= ? AND key <= ? AND key LIKE 'cond:%'").bind(`cond:${from}`, `cond:${to}`).all<{ key: string; value: string }>();
  return c.json(Object.fromEntries(results.map((r) => [r.key.slice(5), JSON.parse(r.value)])));
});
api.put('/condition/:date', async (c) => {
  const d = c.req.param('date');
  if (!isDate(d)) return c.json({ error: '日付が不正です' }, 400);
  const b = await c.req.json<Record<string, unknown>>();
  const v = { leg: n10(b.leg), tight: n10(b.tight), pain: n10(b.pain), pain_part: Array.isArray(b.pain_part) ? (b.pain_part as string[]).filter((x) => typeof x === 'string').slice(0, 6) : [], sleep: n10(b.sleep), fatigue: n10(b.fatigue), memo: String(b.memo ?? '').slice(0, 300) };
  await kvSet(c.env, `cond:${d}`, JSON.stringify(v));
  return c.json(v);
});

// ---------------------------------------------------------------- シューズの相性

/** シューズごとに、同じ種類のランでの ペース・心拍・ピッチ・接地時間・主観 (走りやすさ・呼吸・脚・痛み)・翌朝の脚 を比べる */
api.get('/shoes/compare', async (c) => {
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const st = await getSettings(c.env);
  const [{ results: rows }, { results: shoes }, { results: kvs }] = await Promise.all([
    c.env.DB.prepare(`SELECT a.id, a.date, a.distance_m, a.moving_time_s, a.avg_hr, a.avg_cadence_spm, a.shoe_id, COALESCE(p.type, json_extract(a.evaluation, '$.type')) AS type, json_extract(a.evaluation, '$.role') AS role
      FROM activities a LEFT JOIN plans p ON p.id = a.plan_id WHERE a.shoe_id IS NOT NULL AND a.date >= ? AND a.sport_type LIKE '%Run%' AND a.distance_m >= 2000`).bind(addDays(today, -365)).all<any>(),
    c.env.DB.prepare('SELECT id, name, retired FROM shoes').all<{ id: number; name: string; retired: number }>(),
    c.env.DB.prepare("SELECT key, value FROM kv WHERE key LIKE 'fb:%' OR key LIKE 'snap:%' OR key LIKE 'cond:%'").all<{ key: string; value: string }>(),
  ]);
  const fb = new Map<number, any>(), snap = new Map<number, any>(), cond = new Map<string, any>();
  for (const k of kvs) { try { const v = JSON.parse(k.value); if (k.key.startsWith('fb:')) fb.set(Number(k.key.slice(3)), normalizeFb(v)); else if (k.key.startsWith('snap:')) snap.set(Number(k.key.slice(5)), v); else cond.set(k.key.slice(5), v); } catch { /* 無視 */ } }
  const avg = (xs: (number | null | undefined)[]) => { const v = xs.filter((x): x is number => x != null && Number.isFinite(x)); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };
  const groups: Record<string, any[]> = {};
  for (const r of rows.filter((x) => x.role !== 'warmup' && x.role !== 'cooldown')) {
    const pace = r.moving_time_s / (r.distance_m / 1000);
    const g = groupOf(r.type, pace, st.paces.easy.min);
    (groups[g] ??= []).push({ ...r, pace, f: fb.get(r.id), s: snap.get(r.id), next: cond.get(addDays(r.date, 1)) });
  }
  // ピッチ: ランの記録の値 (両足の歩数/分) を使う。分析の要約 (snap) は古い版で 2 倍になっているものがあるため、記録に値が無いときだけ使う。
  // 人のランとしてありえない値 (120 未満・230 超) は平均に入れない
  const okCad = (v: unknown) => (typeof v === 'number' && v >= 120 && v <= 230 ? v : null);
  const cadOf = (r: any) => okCad(r.avg_cadence_spm) ?? okCad(r.s?.cad);
  // ストライド: 距離 ÷ 歩数 (同じピッチから計算するので、表のピッチ・ペースと食い違わない)。無ければ要約の値
  const strideOf = (r: any) => {
    const cad = cadOf(r);
    const v = cad && r.moving_time_s > 0 ? (r.distance_m / (r.moving_time_s / 60) / cad) * 100 : r.s?.stride;
    return typeof v === 'number' && v >= 50 && v <= 220 ? Math.round(v * 10) / 10 : null;
  };
  const out: Record<string, any[]> = {};
  for (const [g, list] of Object.entries(groups)) {
    const by = new Map<number, any[]>();
    for (const r of list) by.set(r.shoe_id, [...(by.get(r.shoe_id) ?? []), r]);
    const rowsG = [...by.entries()].filter(([, xs]) => xs.length >= 2).map(([sid, xs]) => ({
      shoe_id: sid, name: shoes.find((x) => x.id === sid)?.name ?? '?', retired: shoes.find((x) => x.id === sid)?.retired ?? 0, n: xs.length,
      km: Math.round(xs.reduce((a, r) => a + r.distance_m, 0) / 1000),
      pace: avg(xs.map((r) => r.pace)), hr: avg(xs.map((r) => r.avg_hr)), cad: avg(xs.map(cadOf)),
      stride: avg(xs.map(strideOf)), gct: avg(xs.map((r) => r.s?.gct)),
      form: avg(xs.map((r) => r.f?.form)), breath: avg(xs.map((r) => r.f?.breath)), leg: avg(xs.map((r) => r.f?.leg)),
      pain_n: xs.filter((r) => (r.f?.pain ?? 0) >= 3).length, next_leg: avg(xs.map((r) => r.next?.leg)),
    }));
    if (rowsG.length) out[g] = rowsG.sort((a, b) => b.n - a.n);
  }
  return c.json(out);
});

// ---------------------------------------------------------------- バックアップ (書き出し・読み込み)

const BACKUP_TABLES = ['activities', 'plans', 'races', 'shoes', 'kv'] as const;
/** すべての記録を JSON で書き出す (COROS の 1 秒ごとの記録は大きいので除く。COROS から取り直せる) */
api.get('/backup', async (c) => {
  const out: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) {
    const q = t === 'kv' ? "SELECT * FROM kv WHERE key NOT LIKE 'coros_%' AND key NOT LIKE 'strava_%' AND key NOT LIKE 'oauth%' AND key NOT LIKE 'rprev:%' AND key NOT LIKE 'site:%'" : `SELECT * FROM ${t}`;
    out[t] = (await c.env.DB.prepare(q).all()).results;
  }
  c.header('Content-Disposition', `attachment; filename="stride-backup-${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}.json"`);
  return c.json({ app: 'STRIDE', version: 1, exported_at: new Date().toISOString(), tables: out });
});
/** バックアップを読み込む。同じ id / key の行は上書き、無い行は追加 (今のデータは消さない) */
api.post('/backup', async (c) => {
  const body = await c.req.json<{ app?: string; tables?: Record<string, Record<string, unknown>[]> }>();
  if (body?.app !== 'STRIDE' || !body.tables) return c.json({ error: 'STRIDE のバックアップファイルではありません' }, 400);
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    const rows = body.tables[t];
    if (!Array.isArray(rows) || !rows.length) continue;
    const { results: cols } = await c.env.DB.prepare(`PRAGMA table_info(${t})`).all<{ name: string }>();
    const allowed = new Set(cols.map((x) => x.name));
    const stmts: D1PreparedStatement[] = [];
    for (const r of rows) {
      const keys = Object.keys(r).filter((k) => allowed.has(k));
      if (!keys.length) continue;
      stmts.push(c.env.DB.prepare(`INSERT OR REPLACE INTO ${t} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`).bind(...keys.map((k) => (r[k] === undefined ? null : r[k] as any))));
    }
    for (let k = 0; k < stmts.length; k += 80) await c.env.DB.batch(stmts.slice(k, k + 80));
    counts[t] = stmts.length;
  }
  return c.json({ ok: true, counts });
});

/**
 * ランニングのニュース。Google ニュースを 8 回ほど読むので遅い (数秒)。
 * 読んだ結果を kv (news_cache) に置き、20 分以内ならそれを返す。古ければ古い分をすぐ返して、裏で読み直す。
 * 読み直しで 1 件も取れなかったとき (Google の一時的な失敗) は、前の結果を消さない
 */
const NEWS_FRESH_MS = 20 * 60_000;
api.get('/news', async (c) => {
  c.header('Cache-Control', 'private, max-age=300');
  // 次の大会 (エントリー済み・出場決定) の名前でも探す
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const race = await c.env.DB.prepare("SELECT name FROM races WHERE date >= ? AND COALESCE(status, 'confirmed') != 'candidate' ORDER BY date LIMIT 1").bind(today).first<{ name: string }>().catch(() => null);
  const name = race?.name?.replace(/\s*\d{4}\s*$|^\s*\d{4}\s*/g, '').replace(/^第\d+回\s*/, '').trim() || '';
  const raw = await c.env.DB.prepare("SELECT value FROM kv WHERE key = 'news_cache'").first<{ value: string }>().catch(() => null);
  let cached: { at: number; key: string; items: unknown[] } | null = null;
  try { cached = raw ? JSON.parse(raw.value) : null; } catch { cached = null; }
  const refresh = async () => {
    const items = await runningNews(15, name ? [['大会', `"${name}"`]] : []);
    if (items.length) await c.env.DB.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('news_cache', ?)").bind(JSON.stringify({ at: Date.now(), key: name, items })).run();
    return items;
  };
  if (cached && cached.key === name && cached.items?.length) {
    if (Date.now() - cached.at > NEWS_FRESH_MS) c.executionCtx.waitUntil(refresh().catch(() => null));
    return c.json(cached.items);
  }
  const items = await refresh().catch(() => []);
  return c.json(items.length ? items : cached?.items ?? []);
});

api.get('/race-weather', async (c) => {
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const race = await c.env.DB.prepare("SELECT name, date FROM races WHERE date >= ? AND COALESCE(status, 'confirmed') != 'candidate' ORDER BY date LIMIT 1")
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

/** ペースゾーンの境界 (遅い→速い)。COROS から取り込んだゾーンがあればそれ、無ければ閾値ペースからの比率 */
function paceBoundsOf(st: Settings): number[] {
  const z = st.coros?.zones_s, lt = st.coros.lt_pace_s;
  if (z?.aerobic && z.threshold && z.speed) return [z.aerobic[1], z.aerobic[0] - 1, z.threshold[1], z.speed[1], z.speed[0] - 1];
  return [lt * 1.397, lt * 1.154, lt * 1.073, lt * 0.98, lt * 0.899].map(Math.round);
}

// ---------------------------------------------------------------- activities

api.get('/activities', async (c) => {
  const { from, to } = c.req.query();
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.date, a.name, a.sport_type, a.distance_m, a.moving_time_s, a.avg_hr, a.avg_cadence_spm,
       a.score, a.plan_id, a.start_date_local, json_extract(a.evaluation, '$.role') AS role, p.type AS plan_type, s.name AS shoe_name,
       COALESCE(json_extract(a.evaluation, '$.eff_type'), json_extract(a.evaluation, '$.type')) AS eff_type
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
  // COROS のデータがあれば、その記録 (labelId・種目) も返す (COROS へのリンク用)
  const ext = await c.env.DB.prepare(`SELECT ext_id, json_extract(data, '$.act.sport_type') AS st, json_extract(data, '$.act.coros_extra') AS ex FROM ext_activities WHERE id = ? AND data NOT LIKE '{"dup_of"%'`).bind(row.id).first<{ ext_id: string; st: string; ex: string | null }>();
  const coros = ext ? { label_id: ext.ext_id, sport_type: ext.st === 'TrailRun' ? 102 : ext.st === 'VirtualRun' ? 101 : 100, extra: ext.ex ? JSON.parse(ext.ex) : null } : null;
  // 古い評価に残っている「null%」などは、表示前に取り除く
  const evx = row.evaluation ? legacyText(JSON.parse(row.evaluation as string), { distance_m: row.distance_m as number, moving_time_s: row.moving_time_s as number }) : null;
  if (evx) { evx.comments = (evx.comments ?? []).map(cleanText).filter(Boolean); if (evx.focus) evx.focus = evx.focus.map(cleanText).filter(Boolean); for (const k of ['pace', 'hr', 'cadence', 'volume', 'form']) if (evx[k]?.summary) evx[k].summary = cleanText(evx[k].summary) ?? ''; }
  return c.json({ ...row, evaluation: evx, plan, siblings, coros });
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
  const { results } = await c.env.DB.prepare(`${SHOE_TOTAL_SQL} ORDER BY s.retired, s.id`).all<any>();
  // 走った感覚の評価 (クッション・軽さ・反発・安定・自然さ・脚への負担・走りやすさ) と呼び名
  const { results: feels } = await c.env.DB.prepare("SELECT key, value FROM kv WHERE key LIKE 'shoefeel:%'").all<{ key: string; value: string }>();
  const fm = new Map(feels.map((f) => { try { return [Number(f.key.slice(9)), JSON.parse(f.value)] as const; } catch { return [0, null] as const; } }));
  // 最後に使った日・使った回数 (一覧の表示用。2026-11 追加)
  const { results: use } = await c.env.DB.prepare('SELECT shoe_id, MAX(date) AS last_date, MIN(date) AS first_date, COUNT(*) AS runs FROM activities WHERE shoe_id IS NOT NULL GROUP BY shoe_id').all<{ shoe_id: number; last_date: string; first_date: string; runs: number }>();
  const um = new Map(use.map((u) => [u.shoe_id, u]));
  return c.json(results.map((r) => ({ ...r, feel: fm.get(r.id) ?? null, last_date: um.get(r.id)?.last_date ?? null, first_date: um.get(r.id)?.first_date ?? null, runs: um.get(r.id)?.runs ?? 0 })));
});

/** シューズの詳細: 使ったラン・月ごとの距離・レースでの使用 (読み取りのみ。2026-11 追加) */
api.get('/shoes/:id/history', async (c) => {
  const id = Number(c.req.param('id'));
  const shoe = await c.env.DB.prepare(`${SHOE_TOTAL_SQL} WHERE s.id = ?`).bind(id).first<any>();
  if (!shoe) return c.notFound();
  const { results: runs } = await c.env.DB.prepare(
    `SELECT a.id, a.date, a.name, a.distance_m, a.moving_time_s, a.avg_hr, a.score, json_extract(a.evaluation, '$.role') AS role,
       COALESCE(json_extract(a.evaluation, '$.eff_type'), json_extract(a.evaluation, '$.type')) AS type, p.type AS plan_type,
       (SELECT r.name FROM races r WHERE r.activity_id = a.id LIMIT 1) AS race_name
     FROM activities a LEFT JOIN plans p ON p.id = a.plan_id WHERE a.shoe_id = ? ORDER BY a.start_date_local DESC`,
  ).bind(id).all<any>();
  const feel = await kvGet(c.env, `shoefeel:${id}`);
  const months = new Map<string, number>();
  for (const r of runs) months.set(r.date.slice(0, 7), (months.get(r.date.slice(0, 7)) ?? 0) + r.distance_m / 1000);
  return c.json({
    shoe: { ...shoe, feel: feel ? JSON.parse(feel) : null },
    runs: runs.slice(0, 60), total_runs: runs.length,
    first_date: runs.length ? runs[runs.length - 1].date : null, last_date: runs[0]?.date ?? null,
    months: [...months].sort((a, b) => a[0].localeCompare(b[0])).slice(-12).map(([month, km]) => ({ month, km: Math.round(km * 10) / 10 })),
    races: runs.filter((r) => r.race_name || r.type === 'race').map((r) => ({ id: r.id, date: r.date, name: r.race_name || r.name, km: Math.round(r.distance_m / 10) / 100, time_s: r.moving_time_s })),
  });
});
api.put('/shoes/:id/feel', async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const v: Record<string, unknown> = {};
  for (const k of ['cushion', 'light', 'rebound', 'stable', 'natural', 'load', 'overall']) { const x = n10(b[k]); if (x != null) v[k] = x; }
  v.label = String(b.label ?? '').slice(0, 20);
  v.memo = String(b.memo ?? '').slice(0, 200);
  await kvSet(c.env, `shoefeel:${c.req.param('id')}`, JSON.stringify(v));
  return c.json(v);
});

function shoeValues(b: Record<string, unknown>) {
  if (!b.name) throw new Error('name は必須です');
  const image = typeof b.image === 'string' && b.image.startsWith('data:image/') && b.image.length < 400_000 ? b.image : null;
  // retired: 0 使用中 / 1 引退 / 2 予備 (おすすめには出さない)
  const st = typeof b.retired === 'boolean' ? (b.retired ? 1 : 0) : [0, 1, 2].includes(Number(b.retired)) ? Number(b.retired) : 0;
  const brand = typeof b.brand === 'string' && b.brand.trim() ? b.brand.trim().slice(0, 40) : null;
  return [b.name, cleanPurposes(b.purpose), b.strava_gear_id || null, num(b.limit_km) ?? 700, num(b.initial_km) ?? 0, st, image, brand];
}

api.post('/shoes', async (c) => {
  const row = await c.env.DB.prepare(
    'INSERT INTO shoes (name, purpose, strava_gear_id, limit_km, initial_km, retired, image, brand) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
  )
    .bind(...shoeValues(await c.req.json()))
    .first();
  return c.json(row, 201);
});

api.put('/shoes/:id', async (c) => {
  const row = await c.env.DB.prepare(
    `UPDATE shoes SET name = ?, purpose = ?, strava_gear_id = ?, limit_km = ?, initial_km = ?, retired = ?, image = ?, brand = ?, alert_sent = 0
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
  if (/daily row read limit|exceeded D1/i.test(err.message)) {
    return c.json({ error: 'データベースの無料枠 (1日の読み取り上限) に達しました。毎朝 9:00 にリセットされます。' }, 503);
  }
  return c.json({ error: err.message }, 400);
});
