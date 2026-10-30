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

async function get<T>(env: Env, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await accessToken(env)}` } });
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

export const getActivity = (env: Env, id: number) => get<StravaActivity>(env, `/activities/${id}?include_all_efforts=false`);

export async function getStreams(env: Env, id: number): Promise<Streams | null> {
  const keys = 'time,distance,velocity_smooth,heartrate,cadence';
  try {
    const raw = await get<Record<string, { data: number[] }>>(env, `/activities/${id}/streams?keys=${keys}&key_by_type=true`);
    if (!raw.time || !raw.distance) return null;
    return {
      time: raw.time.data,
      distance: raw.distance.data,
      velocity_smooth: raw.velocity_smooth?.data,
      heartrate: raw.heartrate?.data,
      cadence: raw.cadence?.data,
    };
  } catch (e) {
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
