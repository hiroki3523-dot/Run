import { loadExt } from './ext';
import type { Env, Lap, Streams } from './types';

const API = 'https://www.strava.com/api/v3';
const OAUTH = 'https://www.strava.com/oauth';

export const SCOPES = 'read,activity:read_all,profile:read_all';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  athlete?: { id: number };
}

export function authorizeUrl(env: Env, state: string): string {
  const q = new URLSearchParams({
    client_id: env.STRAVA_CLIENT_ID,
    redirect_uri: `${env.APP_URL}/auth/strava/callback`,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: SCOPES,
    state,
  });
  return `${OAUTH}/authorize?${q}`;
}

async function tokenRequest(env: Env, params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${OAUTH}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      ...params,
    }),
  });
  if (!res.ok) throw new Error(`Strava token error ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function exchangeCode(env: Env, code: string): Promise<void> {
  const t = await tokenRequest(env, { code, grant_type: 'authorization_code' });
  if (!t.athlete) throw new Error('athlete missing in token response');
  await env.DB.prepare(
    `INSERT INTO strava_tokens (id, athlete_id, access_token, refresh_token, expires_at)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET athlete_id = excluded.athlete_id, access_token = excluded.access_token,
       refresh_token = excluded.refresh_token, expires_at = excluded.expires_at`,
  )
    .bind(t.athlete.id, t.access_token, t.refresh_token, t.expires_at)
    .run();
}

export async function getAthleteId(env: Env): Promise<number | null> {
  const row = await env.DB.prepare('SELECT athlete_id FROM strava_tokens WHERE id = 1').first<{ athlete_id: number }>();
  return row?.athlete_id ?? null;
}

/** 有効なアクセストークンを返す (期限 5 分前で更新) */
async function accessToken(env: Env): Promise<string> {
  const row = await env.DB.prepare('SELECT * FROM strava_tokens WHERE id = 1').first<{
    access_token: string;
    refresh_token: string;
    expires_at: number;
  }>();
  if (!row) throw new Error('Strava が未連携です');
  if (row.expires_at - 300 > Date.now() / 1000) return row.access_token;

  const t = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: row.refresh_token });
  await env.DB.prepare('UPDATE strava_tokens SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = 1')
    .bind(t.access_token, t.refresh_token, t.expires_at)
    .run();
  return t.access_token;
}

/** Strava の利用上限 (15 分 100 回 / 1 日 1,000 回) に達した */
export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

async function get<T>(env: Env, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await accessToken(env)}` } });
  if (res.status === 429) throw new RateLimitError(`Strava の利用上限に達しました (${path})`);
  if (!res.ok) throw new Error(`Strava GET ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

export interface StravaActivity {
  id: number;
  name: string;
  sport_type: string;
  workout_type: number | null;
  start_date: string; // UTC
  start_date_local: string; // 末尾 Z だがローカル時刻
  distance: number;
  moving_time: number;
  elapsed_time: number;
  average_heartrate?: number;
  max_heartrate?: number;
  average_cadence?: number;
  gear_id: string | null;
  laps?: Lap[];
}

export const RUN_TYPES = ['Run', 'TrailRun', 'VirtualRun'];

/** id が負の数のものは COROS から取り込んだラン (ext_activities に保存してある) */
export const getActivity = async (env: Env, id: number): Promise<StravaActivity> => {
  if (id < 0) {
    const x = await loadExt(env, id);
    if (!x) throw new Error('このランの元データがありません');
    return x.act as StravaActivity;
  }
  return get<StravaActivity>(env, `/activities/${id}?include_all_efforts=false`);
};

/** streams (time・distance・速度・心拍・ピッチ・標高)。COROS のランは保存した記録から */
async function rawStreams(env: Env, id: number, keys: string): Promise<Record<string, { data: number[] }> | null> {
  if (id < 0) return (await loadExt(env, id))?.raw ?? null;
  return get<Record<string, { data: number[] }>>(env, `/activities/${id}/streams?keys=${keys}&key_by_type=true`);
}

export async function getStreams(env: Env, id: number): Promise<Streams | null> {
  const keys = 'time,distance,velocity_smooth,heartrate,cadence';
  try {
    const raw = await rawStreams(env, id, keys);
    if (!raw || !raw.time || !raw.distance) return null;
    return {
      time: raw.time.data,
      distance: raw.distance.data,
      velocity_smooth: raw.velocity_smooth?.data,
      heartrate: raw.heartrate?.data,
      cadence: raw.cadence?.data,
    };
  } catch (e) {
    // 上限に達した場合は streams なしで保存せず、呼び出し元に伝えて後でやり直す
    if (e instanceof RateLimitError) throw e;
    console.warn('streams unavailable', id, e);
    return null;
  }
}

export const listActivities = (env: Env, after: number, page = 1, perPage = 30) =>
  get<StravaActivity[]>(env, `/athlete/activities?after=${after}&page=${page}&per_page=${perPage}`);

export const getGear = (env: Env, id: string) => get<{ id: string; name: string; distance: number }>(env, `/gear/${id}`);

/** Webhook の購読を作成 (アプリにつき 1 つまで) */
export async function createSubscription(env: Env): Promise<unknown> {
  const res = await fetch(`${API}/push_subscriptions`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: env.STRAVA_CLIENT_ID,
      client_secret: env.STRAVA_CLIENT_SECRET,
      callback_url: `${env.APP_URL}/webhook`,
      verify_token: env.STRAVA_VERIFY_TOKEN,
    }),
  });
  return { status: res.status, body: await res.json() };
}

export async function viewSubscription(env: Env): Promise<unknown> {
  const q = new URLSearchParams({ client_id: env.STRAVA_CLIENT_ID, client_secret: env.STRAVA_CLIENT_SECRET });
  const res = await fetch(`${API}/push_subscriptions?${q}`);
  return res.json();
}

/** 実績詳細のグラフ用。ペース・心拍・ピッチ・標高を一定の点数にまとめ、ゾーンごとの秒数も数える */
export interface Series {
  n: number;
  dist_m: number;
  d: number[]; // km
  pace: (number | null)[];
  hr: (number | null)[];
  cad: (number | null)[]; // 両足 spm
  stride: (number | null)[]; // cm
  alt: (number | null)[];
  pace_zone_s: number[]; // 6 ゾーン (遅い→速い)
  hr_zone_s: number[];
  avg: { pace: number | null; hr: number | null; cad: number | null; stride: number | null };
  max: { hr: number | null; cad: number | null };
  fast_km_s: number | null;
  elev_gain: number | null;
  elev_loss: number | null;
  alt_min: number | null;
  alt_max: number | null;
  calories: number | null;
}

export async function getSeries(env: Env, id: number, paceBounds: number[], hrBounds: number[], points = 120): Promise<Series | null> {
  const keys = 'time,distance,velocity_smooth,heartrate,cadence,altitude';
  const [raw, act] = await Promise.all([
    rawStreams(env, id, keys).catch(() => null),
    (id < 0 ? getActivity(env, id) : get<{ calories?: number; total_elevation_gain?: number }>(env, `/activities/${id}`)).catch(() => null) as Promise<{ calories?: number; total_elevation_gain?: number } | null>,
  ]);
  if (!raw || !raw.time || !raw.distance) return null;
  const t = raw.time.data, dist = raw.distance.data, v = raw.velocity_smooth?.data, hr = raw.heartrate?.data, cad = raw.cadence?.data, alt = raw.altitude?.data;
  const N = t.length;
  const paceZ = new Array(6).fill(0), hrZ = new Array(6).fill(0);
  const zoneOf = (x: number, b: number[], rev: boolean) => {
    // b: 境界 (昇順/降順)。rev=true: 値が小さいほど上位ゾーン (ペース)
    let z = 0;
    for (const k of b) if (rev ? x <= k : x >= k) z++;
    return z;
  };
  const buckets = Math.min(points, N);
  const sum = (a: number[], b: number) => a.reduce((x, y) => x + y, 0) / Math.max(1, b);
  const out: Series = {
    n: buckets, dist_m: dist[N - 1] ?? 0, d: [], pace: [], hr: [], cad: [], stride: [], alt: [],
    pace_zone_s: paceZ, hr_zone_s: hrZ, avg: { pace: null, hr: null, cad: null, stride: null }, max: { hr: null, cad: null },
    fast_km_s: null, elev_gain: act?.total_elevation_gain ?? null, elev_loss: null, alt_min: null, alt_max: null, calories: act?.calories ?? null,
  };
  let hrSum = 0, hrT = 0, cadSum = 0, cadT = 0, strideSum = 0, strideT = 0, maxHr = 0, maxCad = 0;
  for (let i = 1; i < N; i++) {
    const dt = Math.min(5, t[i] - t[i - 1]);
    if (v && v[i] > 0.8) paceZ[zoneOf(1000 / v[i], paceBounds, true)] += dt;
    if (hr && hr[i] > 40) { hrZ[zoneOf(hr[i], hrBounds, false)] += dt; hrSum += hr[i] * dt; hrT += dt; maxHr = Math.max(maxHr, hr[i]); }
    if (cad && cad[i] > 60) { cadSum += cad[i] * 2 * dt; cadT += dt; maxCad = Math.max(maxCad, cad[i] * 2);
      if (v && v[i] > 0.8) { strideSum += ((v[i] / (cad[i] * 2 / 60)) * 100) * dt; strideT += dt; } }
  }
  for (let b = 0; b < buckets; b++) {
    const a = Math.floor((b * N) / buckets), e = Math.max(a + 1, Math.floor(((b + 1) * N) / buckets));
    const idx = Array.from({ length: e - a }, (_, k) => a + k);
    const vs = v ? idx.map((i) => v[i]).filter((x) => x > 0.8) : [];
    const hs = hr ? idx.map((i) => hr[i]).filter((x) => x > 40) : [];
    const cs = cad ? idx.map((i) => cad[i]).filter((x) => x > 60) : [];
    const as = alt ? idx.map((i) => alt[i]) : [];
    out.d.push(Math.round(((dist[a] ?? 0) / 1000) * 100) / 100);
    const mv = vs.length ? sum(vs, vs.length) : 0;
    out.pace.push(mv ? Math.min(600, Math.round(1000 / mv)) : null);
    out.hr.push(hs.length ? Math.round(sum(hs, hs.length)) : null);
    const mc = cs.length ? sum(cs, cs.length) * 2 : 0;
    out.cad.push(mc ? Math.round(mc) : null);
    out.stride.push(mc && mv ? Math.round((mv / (mc / 60)) * 100) : null);
    out.alt.push(as.length ? Math.round(sum(as, as.length) * 10) / 10 : null);
  }
  if (hrT) out.avg.hr = Math.round(hrSum / hrT);
  if (cadT) out.avg.cad = Math.round(cadSum / cadT);
  if (strideT) out.avg.stride = Math.round(strideSum / strideT);
  out.max.hr = maxHr || null; out.max.cad = maxCad ? Math.round(maxCad) : null;
  if (alt && alt.length) {
    let up = 0, down = 0;
    let ref = alt[0];
    for (const x of alt) { if (x - ref >= 1) { up += x - ref; ref = x; } else if (ref - x >= 1) { down += ref - x; ref = x; } }
    out.elev_loss = Math.round(down);
    if (out.elev_gain == null) out.elev_gain = Math.round(up);
    out.alt_min = Math.round(Math.min(...alt)); out.alt_max = Math.round(Math.max(...alt));
  }
  // 最速 1km (時間窓)
  let best = Infinity, j = 0;
  for (let i = 0; i < N; i++) {
    while (dist[i] - dist[j] > 1000) j++;
    if (dist[i] - dist[j] >= 995) best = Math.min(best, (t[i] - t[j]) * (1000 / (dist[i] - dist[j])));
  }
  if (isFinite(best)) out.fast_km_s = Math.round(best);
  return out;
}
