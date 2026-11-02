/**
 * COROS 公式の MCP (https://mcp.coros.com/mcp) との連携。申請不要・無料。
 * - ログイン: OAuth 2.0 (クライアント登録 → PKCE → トークン)。手順は COROS 公式の Skill (coros_mcp_login.py) に合わせている
 * - 取得: tools/call (querySportRecords・queryActivityLapData・queryActivityFitFileDownloadUrls・queryFitnessAssessmentOverview)
 * - 新しいランは知らせてもらえないので、cron で定期的に取りに行く
 */
import { extIdToNumber, saveExt, type ExtActivity } from './ext';
import { parseFit, type FitData } from './fit';
import { ingestActivity } from './process';
import { getSettings, kvGet, kvSet, saveSettings } from './settings';
import type { Env } from './types';

const DEFAULT_ISSUER = 'https://mcp.coros.com';
const SCOPES = 'openid offline_access mcp.tools';
/** COROS のランの種目コード: 100 ロード / 101 室内 / 102 トレイル / 103 トラック / 104 トレッドミル */
export const RUN_SPORTS = [100, 101, 102, 103, 104];
const SPORT_NAME: Record<number, string> = { 100: 'Run', 101: 'VirtualRun', 102: 'TrailRun', 103: 'Run', 104: 'VirtualRun' };

interface CorosAuth {
  issuer: string; mcp_url: string; client_id: string; redirect_uri: string;
  access_token: string; refresh_token: string; token_type: string; expires_at: number;
}

const b64url = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const now = () => Math.floor(Date.now() / 1000);

async function getAuth(env: Env): Promise<CorosAuth | null> {
  const raw = await kvGet(env, 'coros_auth');
  return raw ? (JSON.parse(raw) as CorosAuth) : null;
}

/** 国・地域ごとの窓口を調べる (失敗したら共通の窓口) */
async function discoverIssuer(): Promise<string> {
  try {
    const res = await fetch(`${DEFAULT_ISSUER}/.well-known/openid-configuration`);
    if (res.ok) {
      const j = (await res.json()) as { issuer?: string };
      if (j.issuer?.startsWith('https://')) return j.issuer.replace(/\/$/, '');
    }
  } catch { /* 共通の窓口を使う */ }
  return DEFAULT_ISSUER;
}

/** ログイン画面の URL を作る (アプリの登録 → PKCE) */
export async function corosAuthorizeUrl(env: Env): Promise<string> {
  const issuer = await discoverIssuer();
  const redirect = `${env.APP_URL.replace(/\/$/, '')}/auth/coros/callback`;
  const reg = await fetch(`${issuer}/connect/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'STRIDE', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], scope: SCOPES, token_endpoint_auth_method: 'none',
    }),
  });
  const rj = (await reg.json().catch(() => ({}))) as { client_id?: string };
  if (!reg.ok || !rj.client_id) throw new Error(`COROS のアプリ登録に失敗しました (${reg.status})`);
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = crypto.randomUUID();
  await kvSet(env, 'coros_pending', JSON.stringify({ state, verifier, client_id: rj.client_id, issuer, redirect }));
  const q = new URLSearchParams({
    response_type: 'code', client_id: rj.client_id, redirect_uri: redirect, scope: SCOPES,
    code_challenge: challenge, code_challenge_method: 'S256', resource: `${issuer}/mcp`, state,
  });
  return `${issuer}/oauth2/authorize?${q}`;
}

export async function corosFinishAuth(env: Env, code: string, state: string): Promise<void> {
  const p = JSON.parse((await kvGet(env, 'coros_pending')) ?? '{}') as { state?: string; verifier: string; client_id: string; issuer: string; redirect: string };
  if (!p.state || p.state !== state) throw new Error('state が一致しません。もう一度連携してください');
  const res = await fetch(`${p.issuer}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: p.client_id, code, redirect_uri: p.redirect, code_verifier: p.verifier }),
  });
  const t = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || !t.access_token) throw new Error(`COROS のトークン取得に失敗しました (${res.status})`);
  const auth: CorosAuth = {
    issuer: p.issuer, mcp_url: `${p.issuer}/mcp`, client_id: p.client_id, redirect_uri: p.redirect,
    access_token: t.access_token, refresh_token: t.refresh_token ?? '', token_type: t.token_type ?? 'Bearer',
    expires_at: now() + Number(t.expires_in ?? 3600),
  };
  await kvSet(env, 'coros_auth', JSON.stringify(auth));
  await kvSet(env, 'coros_pending', '');
}

async function refresh(env: Env, a: CorosAuth): Promise<CorosAuth> {
  const res = await fetch(`${a.issuer}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: a.client_id, refresh_token: a.refresh_token }),
  });
  const t = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || !t.access_token) throw new Error('COROS の連携が切れました。設定から連携し直してください');
  const next = { ...a, access_token: t.access_token, refresh_token: t.refresh_token ?? a.refresh_token, token_type: t.token_type ?? a.token_type, expires_at: now() + Number(t.expires_in ?? 3600) };
  await kvSet(env, 'coros_auth', JSON.stringify(next));
  return next;
}

/** SSE (text/event-stream) か JSON の応答を読む */
async function readRpc(res: Response): Promise<any> {
  const raw = await res.text();
  if (!raw) return {};
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const events: string[] = [];
    let cur: string[] = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line) { if (cur.length) { events.push(cur.join('\n')); cur = []; } continue; }
      if (line.startsWith('data:')) cur.push(line.slice(5).trimStart());
    }
    if (cur.length) events.push(cur.join('\n'));
    return events.length ? JSON.parse(events[events.length - 1]) : {};
  }
  return JSON.parse(raw);
}

export class CorosQuotaError extends Error {}

/** MCP のツールを呼ぶ。返り値は {text, structured} */
export async function corosTool(env: Env, name: string, args: Record<string, unknown> = {}): Promise<{ text: string; structured: any; raw: any }> {
  let a = await getAuth(env);
  if (!a) throw new Error('COROS が未連携です');
  if (a.expires_at - 120 < now()) a = await refresh(env, a);
  const post = (auth: CorosAuth, body: unknown) => fetch(auth.mcp_url, {
    method: 'POST',
    headers: { Authorization: `${auth.token_type} ${auth.access_token}`, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'STRIDE', version: '1.0.0' } } };
  let r = await post(a, init);
  if (r.status === 401) { a = await refresh(env, a); r = await post(a, init); }
  if (!r.ok) throw new Error(`COROS に接続できません (${r.status})`);
  await readRpc(r);
  const res = await post(a, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
  const j = await readRpc(res);
  if (!res.ok || j.error) {
    const msg = JSON.stringify(j.error ?? j).slice(0, 300);
    if (res.status === 429 || /quota|limit|上限|限额|次数/i.test(msg)) throw new CorosQuotaError(msg);
    throw new Error(`COROS ${name} が失敗しました: ${msg}`);
  }
  const result = j.result ?? {};
  const text = (result.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
  if (result.isError) {
    if (/quota|limit|上限|限额|次数/i.test(text)) throw new CorosQuotaError(text.slice(0, 300));
    throw new Error(`COROS ${name}: ${text.slice(0, 300)}`);
  }
  return { text, structured: result.structuredContent ?? null, raw: result };
}

// ---------------------------------------------------------------- 応答の読み取り

/** 文章か JSON の中から、最初の JSON を取り出す */
export function extractJson(text: string): any {
  const i = text.search(/[{[]/);
  if (i < 0) return null;
  for (let end = text.length; end > i; end = text.lastIndexOf(text[i] === '{' ? '}' : ']', end - 1)) {
    try { return JSON.parse(text.slice(i, end + 1)); } catch { /* 短くして再挑戦 */ }
    if (end <= i) break;
  }
  return null;
}

const toSec = (s: string) => s.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);

export interface CorosRecord { labelId: string; sportType: number; date: string | null; name: string | null; dist_m?: number | null; dur_s?: number | null }

/** querySportRecords の結果からランの一覧を取り出す (JSON でも文章でも) */
export function parseRecords(text: string, structured: any): CorosRecord[] {
  const out: CorosRecord[] = [];
  const walk = (x: any) => {
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach(walk); return; }
    const id = x.labelId ?? x.label_id ?? x.activityId;
    const st = Number(x.sportType ?? x.sport_type ?? x.sport);
    if (id != null && Number.isFinite(st)) {
      const d = String(x.date ?? x.startTime ?? x.start_time ?? '');
      const m = d.match(/(\d{4})-?(\d{2})-?(\d{2})/);
      const dm = Number(x.distance ?? x.distanceM ?? NaN), du = Number(x.totalTime ?? x.duration ?? x.durationSeconds ?? NaN);
      out.push({ labelId: String(id), sportType: st, date: m ? `${m[1]}-${m[2]}-${m[3]}` : null, name: x.name ?? null, ...(Number.isFinite(dm) ? { dist_m: dm } : {}), ...(Number.isFinite(du) ? { dur_s: du } : {}) });
      return;
    }
    Object.values(x).forEach(walk);
  };
  walk(structured);
  if (!out.length) walk(extractJson(text));
  if (out.length) return out;
  // 文章: 「1. Sport(100) — 2026-10-03 ... labelId: 4759...」のような塊ごとに読む
  const blocks = text.split(/\n(?=\s*\d+[.)]\s)/);
  for (const b of blocks) {
    const id = b.match(/label\s*id[^0-9]{0,6}(\d{6,})/i)?.[1] ?? b.match(/\bID[^0-9]{0,4}(\d{8,})/i)?.[1] ?? b.match(/\b(\d{15,})\b/)?.[1];
    const st = b.match(/sport\s*type[^0-9]{0,6}(\d{2,5})/i)?.[1] ?? b.match(/Sport\((\d{2,5})\)/)?.[1];
    if (!id || !st) continue;
    const d = b.match(/(\d{4})-(\d{2})-(\d{2})/) ?? b.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
    const km = b.match(/distance[^0-9]{0,6}(\d+(?:\.\d+)?)\s*km/i)?.[1] ?? b.match(/(\d+(?:\.\d+)?)\s*km\b/i)?.[1];
    const du = b.match(/duration[^0-9]{0,6}(\d{1,2}:\d{2}(?::\d{2})?)/i)?.[1];
    out.push({ labelId: id, sportType: Number(st), date: d ? `${d[1]}-${d[2]}-${d[3]}` : null, name: null, dist_m: km ? Math.round(Number(km) * 1000) : null, dur_s: du ? toSec(du) : null });
  }
  return out;
}


export interface CorosFitness {
  predicted_s: Partial<Record<'5k' | '10k' | 'half' | 'full', number>>;
  lt_pace_s: number | null; lthr: number | null; vo2max: number | null; running_level: number | null;
}

/** queryFitnessAssessmentOverview の結果から、予測タイム・閾値ペース・閾値心拍・VO2max を取り出す */
export function parseFitness(text: string, structured: any): CorosFitness {
  const src = structured ? `${JSON.stringify(structured)}\n${text}` : text;
  const f: CorosFitness = { predicted_s: {}, lt_pace_s: null, lthr: null, vo2max: null, running_level: null };
  for (const line of src.split(/\n|,(?=\s*")/)) {
    const l = line.toLowerCase();
    const time = line.match(/(\d{1,2}:\d{2}:\d{2}|\d{1,2}:\d{2}(?!\s*\/))/)?.[1];
    if (time && /predict|race|予測|预测|marathon|マラソン|半|half|5\s?k|10\s?k|km/i.test(line) && !/pace|ペース|配速|\/km/i.test(l)) {
      const sec = toSec(time);
      if (/half|半程|半马|ハーフ/.test(l)) f.predicted_s.half = sec;
      else if (/marathon|全程|全马|马拉松|マラソン|フル|42/.test(l)) f.predicted_s.full = sec;
      else if (/10\s?k|10\s?km|10公里|10キロ/.test(l)) f.predicted_s['10k'] = sec;
      else if (/\b5\s?k|5\s?km|5公里|5キロ/.test(l)) f.predicted_s['5k'] = sec;
    }
    if (/threshold|閾値|阈值|lactate|乳酸/.test(l)) {
      const pace = line.match(/(\d{1,2}):(\d{2})\s*(?:\/|min\/|per)\s*km/i) ?? (/pace|ペース|配速/.test(l) ? line.match(/(\d{1,2}):(\d{2})/) : null);
      if (pace) f.lt_pace_s = Number(pace[1]) * 60 + Number(pace[2]);
      const hr = line.match(/(\d{3})\s*bpm/i) ?? (/heart|心拍|心率|hr/.test(l) ? line.match(/\b(1\d{2}|20\d)\b/) : null);
      if (hr) f.lthr = Number(hr[1]);
    }
    if (/vo2/.test(l)) { const m = line.match(/vo2\s*max[^0-9]{0,10}(\d{2}(?:\.\d)?)/i); if (m) f.vo2max = Number(m[1]); }
    if (/running level|ランニングレベル|跑力|running_level|runninglevel/.test(l)) { const m = line.match(/(?:level|レベル|跑力)[^0-9]{0,10}(\d{2,3}(?:\.\d)?)/i); if (m) f.running_level = Number(m[1]); }
  }
  return f;
}

/** 体力評価を取り込んで設定に保存 (予測タイム・閾値ペース・閾値心拍・VO2max) */
export async function syncCorosFitness(env: Env): Promise<CorosFitness> {
  const r = await corosTool(env, 'queryFitnessAssessmentOverview');
  const f = parseFitness(r.text, r.structured);
  const st = await getSettings(env);
  const c = st.coros;
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  st.coros = {
    ...c,
    updated: today,
    predicted_s: { ...c.predicted_s, ...f.predicted_s },
    lt_pace_s: f.lt_pace_s ?? c.lt_pace_s,
    lthr: f.lthr ?? c.lthr,
    vo2max: f.vo2max ?? c.vo2max,
    running_level: f.running_level ?? c.running_level,
  };
  if (f.lthr) st.lthr = f.lthr;
  await saveSettings(env, st);
  await kvSet(env, 'coros_fitness_raw', r.text.slice(0, 4000));
  return f;
}

// ---------------------------------------------------------------- ランの取り込み

interface Queue { items: CorosRecord[]; pause_until?: number; last_sync?: string; last_error?: string; done: number; skipped?: number; scan_to?: string | null; scan_empty?: number }
const loadQueue = async (env: Env): Promise<Queue> => ({ items: [], done: 0, ...JSON.parse((await kvGet(env, 'coros_queue')) ?? '{}') });
const saveQueue = (env: Env, q: Queue) => kvSet(env, 'coros_queue', JSON.stringify(q));
const ymd = (d: string) => d.replace(/-/g, '');
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const jstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

/** 期間内のランを調べ、まだ取り込んでいないものを順番待ちに入れる (30 日ずつ) */
export async function enqueueCoros(env: Env, from: string, to: string): Promise<number> {
  const found: CorosRecord[] = [];
  for (let end = to; end >= from; end = addDays(end, -30)) {
    const start = addDays(end, -29) < from ? from : addDays(end, -29);
    const r = await corosTool(env, 'querySportRecords', { startDate: ymd(start), endDate: ymd(end), sportTypeCodes: RUN_SPORTS, limit: 100 });
    found.push(...parseRecords(r.text, r.structured).filter((x) => RUN_SPORTS.includes(x.sportType)));
  }
  if (!found.length) return 0;
  const ids = [...new Set(found.map((x) => x.labelId))];
  const have = new Set<string>();
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    const { results } = await env.DB.prepare(`SELECT ext_id FROM ext_activities WHERE ext_id IN (${part.map(() => '?').join(',')})`).bind(...part).all<{ ext_id: string }>();
    results.forEach((r) => have.add(r.ext_id));
  }
  const q = await loadQueue(env);
  const queued = new Set(q.items.map((x) => x.labelId));
  let add = found.filter((x) => !have.has(x.labelId) && !queued.has(x.labelId));
  // Strava から取り込み済みの同じラン (同じ日・距離がほぼ同じ) は取り込まない。COROS の上限も使わない
  const keep: CorosRecord[] = [];
  for (const x of add) {
    const dup = x.date && x.dist_m ? await stravaTwin(env, x.date, x.dist_m) : null;
    if (dup) { await markDuplicate(env, x.labelId, dup); q.skipped = (q.skipped ?? 0) + 1; } else keep.push(x);
  }
  add = keep;
  const uniq = [...new Map(add.map((x) => [x.labelId, x])).values()].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  q.items = [...uniq, ...q.items]; // 新しいものを先に
  q.last_sync = new Date().toISOString();
  await saveQueue(env, q);
  return uniq.length;
}

/** 同じ日に、距離がほぼ同じ (±3%・最大 300m) Strava のランがあればその id */
async function stravaTwin(env: Env, date: string, distM: number, startLocal?: string): Promise<number | null> {
  const { results } = await env.DB.prepare('SELECT id, distance_m, start_date_local FROM activities WHERE date = ? AND id > 0').bind(date).all<{ id: number; distance_m: number; start_date_local: string }>();
  const tol = Math.min(300, Math.max(80, distM * 0.03));
  const t = startLocal ? Date.parse(startLocal) : null;
  const hit = results.find((r) => Math.abs(r.distance_m - distM) <= tol && (t == null || Math.abs(Date.parse(r.start_date_local) - t) <= 15 * 60_000));
  return hit?.id ?? null;
}

/** Strava と重なった COROS のランは「取り込み済み (重複)」として記録だけ残す (次から調べない) */
async function markDuplicate(env: Env, labelId: string, stravaId: number): Promise<void> {
  await env.DB.prepare('INSERT INTO ext_activities (id, ext_id, data) VALUES (?, ?, ?) ON CONFLICT(ext_id) DO NOTHING')
    .bind(extIdToNumber(labelId), labelId, JSON.stringify({ dup_of: stravaId }))
    .run();
}

/** 前に COROS から取り込んで、Strava と重なっているランを消す (Strava のほうは残す) */
export async function removeCorosDuplicates(env: Env): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT c.id AS cid, s.id AS sid, e.ext_id FROM activities c
     JOIN activities s ON s.date = c.date AND s.id > 0 AND ABS(s.distance_m - c.distance_m) <= MAX(80, MIN(300, c.distance_m * 0.03))
     JOIN ext_activities e ON e.id = c.id
     WHERE c.id < 0`,
  ).all<{ cid: number; sid: number; ext_id: string }>();
  for (const r of results) {
    await env.DB.prepare('DELETE FROM activities WHERE id = ?').bind(r.cid).run();
    await env.DB.prepare('UPDATE ext_activities SET data = ? WHERE id = ?').bind(JSON.stringify({ dup_of: r.sid }), r.cid).run();
  }
  return results.length;
}

const timeName = (h: number) => (h < 10 ? '朝のランニング' : h < 14 ? 'ランチタイム ランニング' : h < 17 ? '午後のランニング' : h < 20 ? '夕方のランニング' : '夜のランニング');

/** FIT とラップから、Strava と同じ形の activity と streams を作る */
export function buildExt(rec: CorosRecord, fit: FitData | null, lapsJson: any): ExtActivity {
  const id = extIdToNumber(rec.labelId);
  const s = fit?.session;
  const tz = fit?.tz_offset_s ?? 9 * 3600;
  const start = s?.start ?? fit?.records[0]?.t ?? (rec.date ? Date.parse(`${rec.date}T00:00:00Z`) / 1000 - 9 * 3600 : now());
  const local = new Date((start + tz) * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  const recs = (fit?.records ?? []).filter((r) => r.t >= start);
  // ラップ (JSON) が FIT より詳しいことがあるので、無ければ FIT のラップ
  const lapList: any[] = (() => {
    const groups = lapsJson?.lapGroups ?? lapsJson?.data?.lapGroups;
    if (Array.isArray(groups) && groups.length) return [...groups].sort((a, b) => (b.laps?.length ?? 0) - (a.laps?.length ?? 0))[0].laps ?? [];
    return [];
  })();
  const laps = lapList.length
    ? lapList.map((l) => {
      const dist = Number(l.distance) / 100; // cm → m
      const t = Number(l.time ?? l.totalLength ?? 0);
      return { distance: dist, moving_time: t, elapsed_time: t, average_speed: t ? dist / t : 0, average_heartrate: l.avgHr || undefined, max_heartrate: l.maxHr || undefined, average_cadence: l.avgCadence ? l.avgCadence / 2 : undefined };
    })
    : (fit?.laps ?? []).map((l) => ({ distance: l.dist, moving_time: l.timer, elapsed_time: l.elapsed, average_speed: l.avg_speed ?? (l.timer ? l.dist / l.timer : 0), average_heartrate: l.avg_hr, max_heartrate: l.max_hr, average_cadence: l.avg_cad }));
  const lapDist = laps.reduce((a, l) => a + l.distance, 0), lapTime = laps.reduce((a, l) => a + l.moving_time, 0);
  const distance = s?.dist || recs[recs.length - 1]?.dist || lapDist;
  const moving = s?.timer || lapTime || (recs.length ? recs[recs.length - 1].t - start : 0);

  // 1 秒ごとの記録 → Strava の streams と同じ形 (最大 3600 点に間引く)
  let raw: ExtActivity['raw'] = null;
  if (recs.length > 10 && recs.some((r) => r.dist != null)) {
    const step = Math.max(1, Math.ceil(recs.length / 3600));
    const pick = recs.filter((_, i) => i % step === 0 || i === recs.length - 1);
    let lastD = 0;
    const dist = pick.map((r) => (lastD = r.dist ?? lastD));
    raw = {
      time: { data: pick.map((r) => r.t - start) },
      distance: { data: dist },
      velocity_smooth: { data: pick.map((r, i) => r.speed ?? (i ? Math.max(0, (dist[i] - dist[i - 1]) / Math.max(1, r.t - pick[i - 1].t)) : 0)) },
      ...(pick.some((r) => r.hr) ? { heartrate: { data: pick.map((r) => r.hr ?? 0) } } : {}),
      ...(pick.some((r) => r.cad) ? { cadence: { data: pick.map((r) => r.cad ?? 0) } } : {}),
      ...(pick.some((r) => r.alt != null) ? { altitude: { data: pick.map((r) => Math.round((r.alt ?? 0) * 10) / 10) } } : {}),
    };
  }
  // 1km ごとのスプリット (詳細画面・レビュー用)
  const splits: any[] = [];
  if (raw) {
    const t = raw.time.data, d = raw.distance.data, hr = raw.heartrate?.data, alt = raw.altitude?.data;
    let i0 = 0;
    for (let k = 1; k * 1000 <= d[d.length - 1] + 1; k++) {
      let i = i0;
      while (i < d.length - 1 && d[i] < k * 1000) i++;
      const hrs = hr ? hr.slice(i0, i + 1).filter((x) => x > 0) : [];
      splits.push({ distance: d[i] - d[i0], moving_time: t[i] - t[i0], elevation_difference: alt ? alt[i] - alt[i0] : 0, average_heartrate: hrs.length ? hrs.reduce((a, b) => a + b, 0) / hrs.length : undefined });
      i0 = i;
    }
    const restD = d[d.length - 1] - d[i0];
    if (restD > 50) splits.push({ distance: restD, moving_time: t[t.length - 1] - t[i0], elevation_difference: alt ? alt[alt.length - 1] - alt[i0] : 0 });
  }
  // 合計欄に心拍・ピッチが無い FIT もあるので、1 秒ごとの記録から補う
  const hrs = recs.map((r) => r.hr ?? 0).filter((x) => x > 0), cads = recs.map((r) => r.cad ?? 0).filter((x) => x > 0);
  const avgHr = s?.avg_hr ?? (hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : undefined);
  const maxHr = s?.max_hr ?? (hrs.length ? Math.max(...hrs) : undefined);
  const avgCad = s?.avg_cad || (cads.length ? cads.reduce((a, b) => a + b, 0) / cads.length : undefined);
  const hour = Number(local.slice(11, 13));
  return {
    act: {
      id, name: rec.name || timeName(hour), sport_type: SPORT_NAME[rec.sportType] ?? 'Run', workout_type: null,
      start_date: new Date(start * 1000).toISOString(), start_date_local: local,
      distance, moving_time: Math.round(moving), elapsed_time: Math.round(s?.elapsed || moving),
      average_heartrate: avgHr, max_heartrate: maxHr,
      average_cadence: avgCad, gear_id: null, laps, splits_metric: splits,
      calories: s?.calories ?? undefined, total_elevation_gain: s?.ascent ?? undefined, source: 'coros', ext_id: rec.labelId,
    },
    raw,
  };
}

/** 順番待ちのランを 1 件取り込む (FIT は 1 日 50 件までなので、上限に当たったら待つ) */
async function importOne(env: Env, rec: CorosRecord, notifyNew: boolean): Promise<void> {
  let lapsJson: any = null;
  try { lapsJson = extractJson((await corosTool(env, 'queryActivityLapData', { labelId: rec.labelId, sportType: rec.sportType })).text); } catch (e) { if (e instanceof CorosQuotaError) throw e; }
  const urls = await corosTool(env, 'queryActivityFitFileDownloadUrls', { labelId: rec.labelId, sportType: rec.sportType });
  const link = (urls.text.match(/https?:\/\/[^\s)"'\]<>]+/g) ?? [])[0] ?? JSON.stringify(urls.structured ?? '').match(/https?:\/\/[^\s)"'\]<>\\]+/)?.[0];
  let fit: FitData | null = null;
  if (link) {
    const res = await fetch(link);
    if (res.ok) fit = parseFit(await res.arrayBuffer());
  }
  if (!fit && !lapsJson) throw new Error(`COROS のラン ${rec.labelId} のデータを取得できませんでした`);
  const ext = buildExt(rec, fit, lapsJson);
  const twin = await stravaTwin(env, ext.act.start_date_local.slice(0, 10), ext.act.distance, ext.act.start_date_local);
  if (twin) { await markDuplicate(env, rec.labelId, twin); return; }
  await saveExt(env, ext.act.id, rec.labelId, ext);
  await ingestActivity(env, ext.act.id, { notify: notifyNew });
}

/** cron から: 順番待ちを少しずつ取り込む */
export async function processCorosQueue(env: Env, max = 2): Promise<number> {
  const q = await loadQueue(env);
  if (!q.items.length || (q.pause_until && q.pause_until > now())) return 0;
  let n = 0;
  const recent = addDays(jstToday(), -1);
  while (q.items.length && n < max) {
    const rec = q.items[0];
    try {
      await importOne(env, rec, (rec.date ?? '') >= recent);
      q.items.shift();
      q.done = (q.done ?? 0) + 1;
      q.last_error = undefined;
      n++;
    } catch (e) {
      if (e instanceof CorosQuotaError) { q.pause_until = now() + 3 * 3600; q.last_error = '1 日の取得上限 (50 件) に達したので、時間をおいて続けます'; break; }
      q.last_error = (e as Error).message.slice(0, 200);
      q.items.push(q.items.shift()!); // 失敗したものは後回し
      break;
    }
  }
  await saveQueue(env, q);
  return n;
}

export async function corosStatus(env: Env) {
  const a = await getAuth(env);
  const q = await loadQueue(env);
  return {
    connected: !!a, region: a?.issuer ?? null, queue: q.items.length, done: q.done ?? 0,
    pause_until: q.pause_until && q.pause_until > now() ? new Date(q.pause_until * 1000).toISOString() : null,
    last_sync: q.last_sync ?? null, last_error: q.last_error ?? null, skipped: q.skipped ?? 0, scan_to: q.scan_to ?? null,
  };
}

/** 全期間の取り込みを始める (cron が 1 分に 30 日ずつさかのぼって調べる) */
export async function startCorosFullScan(env: Env): Promise<void> {
  const q = await loadQueue(env);
  q.scan_to = jstToday();
  q.scan_empty = 0;
  await saveQueue(env, q);
}

/** さかのぼりを 1 歩 (30 日) 進める。2 年 (24 回) 続けてランが無ければ、そこで終わり */
async function scanStep(env: Env): Promise<void> {
  const q0 = await loadQueue(env);
  if (!q0.scan_to) return;
  const end = q0.scan_to, start = addDays(end, -29);
  const r = await corosTool(env, 'querySportRecords', { startDate: ymd(start), endDate: ymd(end), sportTypeCodes: RUN_SPORTS, limit: 100 });
  const n = parseRecords(r.text, r.structured).filter((x) => RUN_SPORTS.includes(x.sportType)).length;
  await enqueueCoros(env, start, end);
  const q = await loadQueue(env);
  q.scan_empty = n ? 0 : (q.scan_empty ?? 0) + 1;
  q.scan_to = q.scan_empty >= 24 || start <= '2012-01-01' ? null : addDays(start, -1);
  await saveQueue(env, q);
}

export async function corosDisconnect(env: Env): Promise<void> {
  await kvSet(env, 'coros_auth', '');
  await kvSet(env, 'coros_queue', '');
}

/** cron (毎分) から。取り込み元が COROS のとき: 15 分ごとに新しいランを確認、毎分順番待ちを取り込む、1 日 1 回体力評価 */
export async function corosTick(env: Env, minute: number): Promise<void> {
  if (!(await kvGet(env, 'coros_auth'))) return;
  const st = await getSettings(env);
  if (st.source === 'coros' && minute % 15 === 0) await enqueueCoros(env, addDays(jstToday(), -2), jstToday()).catch((e) => console.error('coros enqueue', e));
  // 全期間の取り込み中: 30 日ずつさかのぼる / 取り込み待ちがあれば少しずつ取り込む (取り込み元に関係なく)
  await scanStep(env).catch((e) => console.error('coros scan', e));
  await processCorosQueue(env, 2).catch((e) => console.error('coros queue', e));
  if (st.source !== 'coros' && st.predict?.source !== 'coros') return;
  const today = jstToday();
  if (st.coros?.updated !== today && minute % 30 === 5) await syncCorosFitness(env).catch((e) => console.error('coros fitness', e));
}
