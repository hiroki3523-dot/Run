/**
 * ChatGPT (GPTs の Actions) 用の入口 (/gpt/*)。拡張機能: 設定で鍵を発行したときだけ使える。
 * - 鍵は APP_TOKEN とは別の「ChatGPT 用の鍵」(kv の gpt_token)。設定で発行・作り直し・停止できる
 * - この鍵で使えるのは、ここにある読み取りと計画の登録だけ。ランの記録・COROS/Strava・設定・バックアップには触れない
 * - 中身は既存の API (/api/*) をそのまま呼んで、ChatGPT が読みやすい小さな形にまとめる (値は変えない・推測で埋めない)
 */
import { Hono } from 'hono';
import { api } from './api';
import { kvGet, kvSet } from './settings';
import type { Env } from './types';

export const GPT_TOKEN_KEY = 'gpt_token';

export const gpt = new Hono<{ Bindings: Env }>();

const jst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const pace = (s: number | null | undefined) => (s && s > 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}/km` : null);
const dur = (s: number | null | undefined) => {
  if (!s || s <= 0) return null;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = Math.round(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`;
};
const km = (m: number | null | undefined) => (m != null ? Math.round(m / 10) / 100 : null);
const PLAN_LABEL: Record<string, string> = { easy: 'Easy', jog: 'Jog', long: 'ロング走', m: 'Mペース走', lt: 'LT走', interval: 'インターバル', race: 'レース', rest: '休養' };

/** 既存の API を内部で呼ぶ (認証は済んでいる前提) */
async function inner(c: any, path: string): Promise<any> {
  const res: Response = await (api as any).request(path, { method: 'GET' }, c.env, c.executionCtx);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------- 鍵の確かめ
gpt.use('*', async (c, next) => {
  const path = new URL(c.req.url).pathname;
  // 書き込めるのは計画の登録 (POST /gpt/plans) だけ
  if (c.req.method !== 'GET' && !(c.req.method === 'POST' && path.endsWith('/plans'))) return c.json({ error: 'not allowed' }, 405);
  if (path.endsWith('/openapi.json')) return next();
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const saved = await kvGet(c.env, GPT_TOKEN_KEY);
  if (!saved || !token || token.length !== saved.length) return c.json({ error: 'unauthorized' }, 401);
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ saved.charCodeAt(i);
  if (diff) return c.json({ error: 'unauthorized' }, 401);
  await next();
});

// ---------------------------------------------------------------- 最近のラン
gpt.get('/runs', async (c) => {
  const days = Math.min(90, Math.max(1, Number(c.req.query('days') || 14)));
  const to = isDate(c.req.query('to')) ? c.req.query('to')! : jst();
  const from = isDate(c.req.query('from')) ? c.req.query('from')! : addDays(to, -(days - 1));
  const list: any[] = await inner(c, `/activities?from=${from}&to=${to}`);
  const runs = list.map((a) => ({
    id: a.id, date: a.date, name: a.name,
    distance_km: km(a.distance_m), time: dur(a.moving_time_s), pace: a.distance_m > 0 ? pace(a.moving_time_s / (a.distance_m / 1000)) : null,
    avg_hr: a.avg_hr != null ? Math.round(a.avg_hr) : null, cadence_spm: a.avg_cadence_spm ?? null,
    plan: a.plan_type ? PLAN_LABEL[a.plan_type] || a.plan_type : null, shoe: a.shoe_name ?? null, score: a.score ?? null,
  }));
  const total = runs.reduce((s, r) => s + (r.distance_km || 0), 0);
  return c.json({ from, to, count: runs.length, total_km: Math.round(total * 10) / 10, runs });
});

// ---------------------------------------------------------------- 1 本のランの詳細
gpt.get('/runs/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);
  const a = await inner(c, `/activities/${id}`);
  const [splits, review] = await Promise.all([inner(c, `/activities/${id}/splits`).catch(() => []), inner(c, `/activities/${id}/review`).catch(() => null)]);
  const ev = a.evaluation || {};
  const part = (k: string) => (ev[k] ? { score: ev[k].score ?? null, summary: ev[k].summary ?? null } : null);
  const fb = review?.fb || {};
  return c.json({
    id: a.id, date: a.date, start: a.start_date_local, name: a.name,
    distance_km: km(a.distance_m), moving_time: dur(a.moving_time_s), elapsed_time: dur(a.elapsed_time_s),
    pace: a.distance_m > 0 ? pace(a.moving_time_s / (a.distance_m / 1000)) : null,
    avg_hr: a.avg_hr != null ? Math.round(a.avg_hr) : null, max_hr: a.max_hr ?? null, cadence_spm: a.avg_cadence_spm ?? null,
    shoe: a.shoe_name ?? null,
    plan: a.plan ? { type: PLAN_LABEL[a.plan.type] || a.plan.type, distance_km: km(a.plan.distance_m), pace_range: a.plan.pace_min_s ? `${pace(a.plan.pace_min_s)}〜${pace(a.plan.pace_max_s)}` : null, notes: a.plan.notes ?? null } : null,
    evaluation: ev.score != null ? { score: ev.score, pace: part('pace'), hr: part('hr'), cadence: part('cadence'), volume: part('volume'), form: part('form'), comments: ev.comments ?? [], focus: ev.focus ?? [] } : null,
    laps_1km: (Array.isArray(splits) ? splits : []).map((s: any, i: number) => ({ lap: i + 1, distance_km: s.km, time: dur(s.time_s), pace: pace(s.pace_s), avg_hr: s.hr ?? null, elevation_m: s.elev ?? null })),
    review: review ? { grade: review.grade ?? null, headline: review.headline ?? null } : null,
    feedback: { breath: fb.breath ?? null, rpe: fb.rpe ?? null, leg: fb.leg ?? null, form: fb.form ?? null, pain: fb.pain ?? null, reserve: fb.reserve ?? null, memo: fb.memo || null, tags: fb.tags ?? [] },
  });
});

// ---------------------------------------------------------------- 計画
gpt.get('/plans', async (c) => {
  const from = isDate(c.req.query('from')) ? c.req.query('from')! : jst();
  const to = isDate(c.req.query('to')) ? c.req.query('to')! : addDays(from, 13);
  const list: any[] = await inner(c, `/plans?from=${from}&to=${to}`);
  const stepText = (raw: unknown) => {
    let st: any[] = [];
    try { st = typeof raw === 'string' ? JSON.parse(raw) : Array.isArray(raw) ? raw : []; } catch { st = []; }
    const tgt = (t: any) => (t ? `${t.by === 'time' ? `${t.value}秒` : t.value >= 1000 ? `${t.value / 1000}km` : `${t.value}m`}${t.pmin ? ` @${pace(t.pmin)}〜${pace(t.pmax)}` : ''}` : '');
    const K: Record<string, string> = { warmup: 'アップ', work: 'メイン', rest: 'レスト', cooldown: 'ダウン' };
    return st.length ? st.map((s) => (s.kind === 'interval' ? `${s.reps}本×(${tgt(s.work)} / レスト ${tgt(s.rest)})` : `${K[s.kind] || s.kind} ${tgt(s)}`)).join(' → ') : null;
  };
  return c.json({
    from, to,
    plans: list.map((p) => ({
      date: p.date, type: PLAN_LABEL[p.type] || p.type, distance_km: km(p.distance_m),
      pace_range: p.pace_min_s ? `${pace(p.pace_min_s)}〜${pace(p.pace_max_s)}` : null,
      steps: stepText(p.steps), notes: p.notes ?? null,
      done: p.activity_count > 0 || p.activity_id != null, actual_km: km(p.actual_distance_m), score: p.score ?? null,
    })),
  });
});

// ---------------------------------------------------------------- 今日 (体調・体重・次のレース・今日と明日の計画)
gpt.get('/today', async (c) => {
  const t = jst();
  const [cond, body, races, plans] = await Promise.all([
    inner(c, `/condition?from=${addDays(t, -6)}&to=${t}`).catch(() => ({})),
    inner(c, `/body?from=${addDays(t, -34)}&to=${t}`).catch(() => null),
    inner(c, '/races').catch(() => []),
    inner(c, `/plans?from=${t}&to=${addDays(t, 1)}`).catch(() => []),
  ]);
  const next = (races as any[]).filter((r) => r.date >= t && r.status !== 'cancelled').sort((a, b) => a.date.localeCompare(b.date))[0];
  const bd = body?.days || {};
  const lastOf = (k: string) => { const ds = Object.keys(bd).filter((d) => bd[d]?.[k] != null).sort(); const d = ds[ds.length - 1]; return d ? { value: bd[d][k], date: d } : null; };
  const g = body?.guide;
  return c.json({
    date: t,
    condition_last7days: cond, // 0〜10。leg=脚の疲労・tight=張り・fatigue=全身の疲労・sleep=睡眠の質 (高いほど良い)・pain=痛み
    body: {
      weight_kg: lastOf('weight'), body_fat_pct: lastOf('body_fat'), resting_hr: lastOf('resting_hr'), hrv_ms: lastOf('hrv'), sleep_h: lastOf('sleep_h'),
      weight_avg7_kg: g?.avg7 ?? null, change_4weeks_kg: g?.change28 ?? null,
      fit_weight_range_kg: g?.fit ? [g.fit.lo, g.fit.hi] : null, target_kg: g?.target_kg ?? null, to_target_kg: g?.to_target ?? null,
    },
    next_race: next ? { name: next.name, date: next.date, days_left: Math.round((Date.parse(next.date) - Date.parse(t)) / 86400_000), distance_km: km(next.distance_m), goal_time: dur(next.goal_time_s), goal_pace: next.goal_time_s && next.distance_m ? pace(next.goal_time_s / (next.distance_m / 1000)) : null } : null,
    plans_today_tomorrow: (plans as any[]).map((p) => ({ date: p.date, type: PLAN_LABEL[p.type] || p.type, distance_km: km(p.distance_m), pace_range: p.pace_min_s ? `${pace(p.pace_min_s)}〜${pace(p.pace_max_s)}` : null, notes: p.notes ?? null })),
  });
});

// ---------------------------------------------------------------- レース・シューズ
gpt.get('/races', async (c) => {
  const list: any[] = await inner(c, '/races');
  return c.json({ races: list.map((r) => ({ name: r.name, date: r.date, distance_km: km(r.distance_m), goal_time: dur(r.goal_time_s), result_time: dur(r.result_time_s), priority: r.priority, status: r.status })) });
});
gpt.get('/shoes', async (c) => {
  const list: any[] = await inner(c, '/shoes');
  return c.json({ shoes: list.map((s) => ({ name: s.brand ? `${s.brand} ${s.name}` : s.name, purpose: s.purpose, total_km: Math.round((s.total_km || 0) * 10) / 10, limit_km: s.limit_km, runs: s.runs, last_date: s.last_date, retired: !!s.retired })) });
});

// ---------------------------------------------------------------- 計画の登録 (置き換え)
/**
 * ChatGPT が作った計画を登録する。中身は画面の「貼り付け」と同じ取り込み (/api/plans/bulk) で、
 * - 今日より前の日は入れない
 * - replace のときは、その期間の計画を置き換える。ただし走った記録と結びついた計画は残す
 * - 種類・距離・ペースが範囲外なら、その日は入れずに理由を返す
 */
const TYPES = ['easy', 'jog', 'long', 'm', 'lt', 'interval', 'race', 'rest'];
const parsePace = (v: unknown): [number, number] | null => {
  const m = String(v ?? '').match(/(\d{1,2}):(\d{2})\s*(?:[-〜~–]\s*(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const a = +m[1] * 60 + +m[2], b = m[3] ? +m[3] * 60 + +m[4] : a;
  return a >= 150 && b <= 600 ? [Math.min(a, b), Math.max(a, b)] : null;
};
gpt.post('/plans', async (c) => {
  let b: any;
  try { b = await c.req.json(); } catch { return c.json({ error: 'JSON が読めません' }, 400); }
  const t = jst();
  const rows: any[] = [], skipped: string[] = [];
  const kind: Record<string, string> = { warmup: 'warmup', main: 'work', work: 'work', rest: 'rest', recovery: 'rest', cooldown: 'cooldown' };
  const tgt = (x: any) => {
    if (!x) return null;
    const out: any = x.distance_m > 0 ? { by: 'dist', value: Math.round(x.distance_m) } : x.distance_km > 0 ? { by: 'dist', value: Math.round(x.distance_km * 1000) } : x.seconds > 0 ? { by: 'time', value: Math.round(x.seconds) } : null;
    if (!out) return null;
    const pr = parsePace(x.pace);
    if (pr) { out.pmin = pr[0]; out.pmax = pr[1]; }
    out.zone = pr ? ((pr[0] + pr[1]) / 2 < 265 ? 3 : (pr[0] + pr[1]) / 2 < 286 ? 2 : (pr[0] + pr[1]) / 2 < 345 ? 1 : 0) : 1;
    return out;
  };
  for (const p of Array.isArray(b?.plans) ? b.plans.slice(0, 120) : []) {
    if (!isDate(p?.date)) { skipped.push(`${p?.date ?? '?'}: 日付が読めません`); continue; }
    if (p.date < t) { skipped.push(`${p.date}: 今日より前の日は入れません`); continue; }
    if (!TYPES.includes(p.type)) { skipped.push(`${p.date}: 種類 ${p.type} は使えません (${TYPES.join('/')})`); continue; }
    const pr = parsePace(p.pace);
    const steps: any[] = [];
    for (const s of Array.isArray(p.steps) ? p.steps : []) {
      if (s?.repeat > 0) { const w = tgt(s.work), r = tgt(s.rest); if (w) steps.push({ kind: 'interval', reps: Math.min(30, Math.round(s.repeat)), work: w, rest: r || { by: 'dist', value: 0, zone: 0 } }); }
      else { const x = tgt(s); if (x && kind[s.kind]) steps.push({ kind: kind[s.kind], ...x }); }
    }
    const distKm = Number(p.distance_km);
    rows.push({
      date: p.date, type: p.type,
      distance_m: p.type === 'rest' || !(distKm > 0 && distKm <= 100) ? null : Math.round(distKm * 1000),
      pace_min_s: pr?.[0] ?? null, pace_max_s: pr?.[1] ?? null,
      notes: typeof p.notes === 'string' ? p.notes.slice(0, 500) : null,
      steps: p.type === 'rest' || !steps.length ? null : steps,
    });
  }
  if (!rows.length) return c.json({ imported: 0, skipped, error: '登録できる計画がありません' }, 400);
  const res: Response = await (api as any).request('/plans/bulk', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plans: rows, replace: b.replace !== false }) }, c.env, c.executionCtx);
  const r: any = await res.json();
  if (!res.ok) return c.json({ error: r?.error || 'failed', skipped }, 400);
  return c.json({ imported: r.imported, replaced: r.replaced, kept_linked_dates: r.kept ?? [], skipped });
});

// ---------------------------------------------------------------- GPTs の Actions に貼る説明書
gpt.get('/openapi.json', (c) => {
  const origin = new URL(c.req.url).origin;
  const get = (summary: string, params: any[] = []) => ({ get: { operationId: '', summary, parameters: params, responses: { '200': { description: 'OK' } } } });
  const q = (name: string, description: string, type = 'string') => ({ name, in: 'query', required: false, description, schema: { type } });
  const paths: Record<string, any> = {
    '/gpt/today': get('今日の状態: 最近 7 日の体調 (0〜10)・体重/体脂肪率・次のレースまでの日数と目標・今日と明日の計画'),
    '/gpt/runs': get('最近のランの一覧 (距離・時間・ペース・心拍・計画の種類・シューズ・評価点)', [q('days', '何日分 (既定 14・最大 90)', 'integer'), q('from', '開始日 YYYY-MM-DD'), q('to', '終了日 YYYY-MM-DD')]),
    '/gpt/runs/{id}': { get: { operationId: '', summary: '1 本のランの詳細: 1km ごとのラップ・評価 (ペース/心拍/ピッチ/フォーム)・ふりかえり・計画', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }], responses: { '200': { description: 'OK' } } } },
    '/gpt/plans': {
      ...get('練習の計画 (種類・距離・ペース範囲・ステップ・メモ・実施済みか)', [q('from', '開始日 YYYY-MM-DD (既定は今日)'), q('to', '終了日 YYYY-MM-DD (既定は 2 週間後)')]),
      post: {
        operationId: 'savePlans',
        summary: '計画を登録する。必ず利用者に内容を見せて「登録してよい」と言われてから呼ぶ。replace=true (既定) なら最初の日から最後の日までの計画を置き換える (走った記録と結びついた計画は残る)。今日より前の日は入らない',
        requestBody: { required: true, content: { 'application/json': { schema: {
          type: 'object', required: ['plans'],
          properties: {
            replace: { type: 'boolean', description: '期間内の計画を置き換える (既定 true)。false なら追加' },
            plans: { type: 'array', maxItems: 120, items: { type: 'object', required: ['date', 'type'], properties: {
              date: { type: 'string', description: 'YYYY-MM-DD' },
              type: { type: 'string', enum: ['easy', 'jog', 'long', 'm', 'lt', 'interval', 'race', 'rest'], description: 'easy=Easy, jog=回復ジョグ, long=ロング走, m=Mペース走, lt=LT走/閾値走, interval=インターバル, race=レース, rest=休養' },
              distance_km: { type: 'number' },
              pace: { type: 'string', description: 'メインのペース範囲 "4:35-4:40"' },
              notes: { type: 'string', description: '名前・目的・注意など (500 文字まで)' },
              steps: { type: 'array', description: 'アップ・メイン・ダウン・繰り返し。1 区間だけなら省略', items: { type: 'object', properties: {
                kind: { type: 'string', enum: ['warmup', 'work', 'rest', 'cooldown'] },
                distance_km: { type: 'number' }, seconds: { type: 'number' }, pace: { type: 'string' },
                repeat: { type: 'integer', description: '繰り返しの本数。このときは work と rest を使う' },
                work: { type: 'object', properties: { distance_km: { type: 'number' }, seconds: { type: 'number' }, pace: { type: 'string' } } },
                rest: { type: 'object', properties: { distance_km: { type: 'number' }, seconds: { type: 'number' }, pace: { type: 'string' } } },
              } } },
            } } },
          },
        } } } },
        responses: { '200': { description: '登録した件数・残した日・入れなかった日と理由' } },
      },
    },
    '/gpt/races': get('レースの予定と結果'),
    '/gpt/shoes': get('シューズ (累計距離・用途・引退)'),
  };
  const ids: Record<string, string> = { '/gpt/today': 'getToday', '/gpt/runs': 'listRuns', '/gpt/runs/{id}': 'getRun', '/gpt/plans': 'listPlans', '/gpt/races': 'listRaces', '/gpt/shoes': 'listShoes' };
  for (const [p, v] of Object.entries(paths)) v.get.operationId = ids[p];
  return c.json({
    openapi: '3.1.0',
    info: { title: 'STRIDE', version: '1.0.0', description: 'マラソン練習の記録 (STRIDE) を読む。書き込めるのは計画の登録だけ。距離は km、ペースは 分:秒/km、日付は日本時間。' },
    servers: [{ url: origin }],
    paths,
    components: { schemas: {}, securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    security: [{ bearer: [] }],
  });
});

