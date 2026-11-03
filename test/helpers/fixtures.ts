/**
 * テスト用のデータと環境。本番の API (Strava・COROS・天気など) には接続しない:
 * fetch を差し替えて、外へのアクセスはすべて失敗させる (うっかり本番に触れないように)。
 * ランは COROS から取り込んだ形 (ext_activities) で入れるので、評価の処理はネットワークなしで動く。
 */
import { makeD1 } from './fake-d1';
import { api } from '../../src/api';
import { ingestActivity } from '../../src/process';

export const TOKEN = 'test-token';
let blocked: string[] = [];
export function blockNetwork() {
  blocked = [];
  (globalThis as any).fetch = async (url: unknown) => { blocked.push(String(url)); throw new Error(`テスト中は外部に接続しません: ${String(url).slice(0, 80)}`); };
  return () => blocked;
}

export function makeEnv() {
  const { DB, sqlite } = makeD1();
  const env: any = {
    DB, APP_TOKEN: TOKEN, APP_URL: 'http://localhost', STRAVA_CLIENT_ID: 'x', STRAVA_CLIENT_SECRET: 'x', STRAVA_VERIFY_TOKEN: 'x',
    AI: { run: async () => { throw new Error('AI はテストでは使いません'); } },
  };
  return { env, sqlite };
}

const ctx = { waitUntil: (p: Promise<unknown>) => { p?.catch?.(() => null); }, passThroughOnException: () => {}, props: {} };

/** API を呼ぶ (認証のあとの /api 部分を直接) */
export async function call(env: any, method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res: Response = await (api as any).request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx);
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}

export interface RunSpec {
  id?: number; date: string; time?: string; km: number;
  /** 区間ごとのペース (秒/km)。合計が km になるように最後の区間で調整 */
  segs: { km: number; pace: number; hr?: number; spm?: number }[];
  gear_id?: string | null; name?: string; elapsed_extra_s?: number;
}

let nextId = -1000;
/** COROS から取り込んだ形のランを作って保存し、取り込み処理 (評価・計画との紐付け) を通す */
export async function addRun(env: any, r: RunSpec, opts: { planId?: number | null } = {}): Promise<number> {
  const id = r.id ?? nextId--;
  const time: number[] = [0], dist: number[] = [0], vel: number[] = [0], hr: number[] = [r.segs[0].hr ?? 150], cad: number[] = [(r.segs[0].spm ?? 180) / 2];
  let t = 0, d = 0;
  for (const s of r.segs) {
    const secs = Math.round(s.pace * s.km);
    const v = (s.km * 1000) / secs;
    for (let i = 0; i < secs; i++) { t++; d += v; time.push(t); dist.push(Math.round(d * 10) / 10); vel.push(v); hr.push(s.hr ?? 150); cad.push((s.spm ?? 180) / 2); }
  }
  const avgHr = hr.reduce((a, b) => a + b, 0) / hr.length;
  const act = {
    id, name: r.name ?? 'テストラン', sport_type: 'Run', workout_type: null,
    start_date_local: `${r.date}T${r.time ?? '07:00'}:00Z`, distance: Math.round(d * 10) / 10, moving_time: t, elapsed_time: t + (r.elapsed_extra_s ?? 0),
    average_heartrate: Math.round(avgHr * 10) / 10, max_heartrate: Math.max(...hr), average_cadence: (r.segs[0].spm ?? 180) / 2,
    gear_id: r.gear_id ?? null, laps: [], splits_metric: [],
  };
  const raw = { time: { data: time }, distance: { data: dist }, velocity_smooth: { data: vel }, heartrate: { data: hr }, cadence: { data: cad } };
  await env.DB.prepare('INSERT INTO ext_activities (id, ext_id, data) VALUES (?, ?, ?)').bind(id, `test-${-id}`, JSON.stringify({ act, raw })).run();
  await ingestActivity(env, id, opts.planId !== undefined ? { planId: opts.planId } : {});
  return id;
}

/** 11/1 の 12km M ペース走 (12.01km・53:50・平均 4:29/km・後半にペースアップ) を再現したデータ */
export const NOV1 = {
  date: '2026-11-01', km: 12.01,
  segs: [
    { km: 1, pace: 285, hr: 152, spm: 182 },
    { km: 7, pace: 270, hr: 164, spm: 182 },
    { km: 4.01, pace: 263.1, hr: 170, spm: 184 },
  ],
};
