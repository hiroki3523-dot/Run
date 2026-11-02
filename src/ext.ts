/** Strava 以外 (COROS) から取り込んだランの保存場所。id は負の数にして Strava の id と重ならないようにする */
import type { Env } from './types';

export interface ExtActivity {
  /** Strava の activity と同じ形 (評価・詳細画面がそのまま使える) */
  act: Record<string, any>;
  /** Strava の streams と同じ形 (time / distance / velocity_smooth / heartrate / cadence / altitude) */
  raw: Record<string, { data: number[] }> | null;
}

export async function loadExt(env: Env, id: number): Promise<ExtActivity | null> {
  const row = await env.DB.prepare('SELECT data FROM ext_activities WHERE id = ?').bind(id).first<{ data: string }>();
  return row ? (JSON.parse(row.data) as ExtActivity) : null;
}

export async function saveExt(env: Env, id: number, extId: string, data: ExtActivity): Promise<void> {
  await env.DB.prepare('INSERT INTO ext_activities (id, ext_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
    .bind(id, extId, JSON.stringify(data))
    .run();
}

/** COROS の labelId (数字の文字列) から、負の整数の id を作る (同じ labelId なら毎回同じ) */
export function extIdToNumber(labelId: string): number {
  let h = 0n;
  if (/^\d+$/.test(labelId)) h = BigInt(labelId) % 9_000_000_000_000_000n;
  else for (const ch of labelId) h = (h * 131n + BigInt(ch.charCodeAt(0))) % 9_000_000_000_000_000n;
  return -Number(h % 9_007_199_254_740_000n) || -1;
}
