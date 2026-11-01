import { ingestActivity } from './process';
import { kvGet, kvSet } from './settings';
import { listActivities, RateLimitError, RUN_TYPES } from './strava';
import type { Env } from './types';

/**
 * 1 回の Worker 実行で使えるサブリクエスト数 (無料プランは 50) に収めるため、
 * 1 バッチで取り込むランは少なめにする。
 */
const BATCH = 4;
const PAGE = 30;
const MAX_ERRORS = 5;

export interface BackfillState {
  active: boolean;
  /** 次に取り込む位置 (epoch 秒) */
  after: number;
  imported: number;
  skipped: number;
  started: string;
  finished?: string;
  /** Strava の上限に達したため、この時刻 (epoch 秒) まで待つ */
  pause_until?: number;
  errors: number;
  last_error?: string;
  /** 今の区間が終わったあとに続けて取り込む開始位置 (epoch 秒) */
  then?: number[];
  /** 取り込み済みでも評価し直す (評価基準を変えたとき用) */
  force?: boolean;
}

/** 区間の終わりに達したら、次の区間の開始位置を返す。なければ null (全部終了) */
export function nextSegment(st: Pick<BackfillState, 'then'>): number | null {
  return st.then && st.then.length > 0 ? st.then.shift()! : null;
}

interface BatchResult {
  imported: number[];
  skipped: number;
  next_after: number | null;
  rate_limited: boolean;
}

const epoch = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** 15 分枠 (Strava の集計単位) の次の区切り */
export const nextQuarter = (now: number) => Math.floor(now / 900) * 900 + 900;

/** after 以降のランを最大 BATCH 件取り込む。取り込み済みは飛ばす。 */
export async function backfillBatch(env: Env, after: number, force = false): Promise<BatchResult> {
  let list;
  try {
    list = (await listActivities(env, after, 1, PAGE)).sort((a, b) => a.start_date.localeCompare(b.start_date));
  } catch (e) {
    if (e instanceof RateLimitError) return { imported: [], skipped: 0, next_after: after, rate_limited: true };
    throw e;
  }
  if (list.length === 0) return { imported: [], skipped: 0, next_after: null, rate_limited: false };

  const runs = list.filter((a) => RUN_TYPES.includes(a.sport_type));
  const have = new Set<number>();
  if (runs.length > 0 && !force) {
    const marks = runs.map(() => '?').join(',');
    const { results } = await env.DB.prepare(`SELECT id FROM activities WHERE id IN (${marks})`)
      .bind(...runs.map((r) => r.id))
      .all<{ id: number }>();
    for (const r of results) have.add(r.id);
  }
  const todo = runs.filter((r) => !have.has(r.id));

  const imported: number[] = [];
  let rateLimited = false;
  for (const r of todo.slice(0, BATCH)) {
    try {
      await ingestActivity(env, r.id);
      imported.push(r.id);
    } catch (e) {
      if (e instanceof RateLimitError) {
        rateLimited = true;
        break;
      }
      throw e;
    }
  }

  const rest = todo.slice(imported.length);
  let next: number | null;
  if (rest.length > 0) next = epoch(rest[0].start_date) - 1;
  else next = list.length < PAGE ? null : epoch(list[list.length - 1].start_date) + 1;
  return { imported, skipped: runs.length - todo.length, next_after: next, rate_limited: rateLimited };
}

export async function getBackfill(env: Env): Promise<BackfillState | null> {
  const raw = await kvGet(env, 'backfill');
  return raw ? (JSON.parse(raw) as BackfillState) : null;
}

const save = (env: Env, st: BackfillState) => kvSet(env, 'backfill', JSON.stringify(st));

/** 最初に取り込む直近の日数。画面に新しい記録がすぐ出るようにする */
const RECENT_DAYS = 30;

/** 取り込みを開始する。days が null なら全期間。直近 30 日を先に取り込み、そのあと古い順に進める。 */
export async function startBackfill(env: Env, days: number | null, force = false): Promise<BackfillState> {
  const now = Math.floor(Date.now() / 1000);
  const from = days == null ? 0 : now - days * 86400;
  const recent = now - RECENT_DAYS * 86400;
  const st: BackfillState = {
    active: true,
    after: from < recent ? recent : from,
    then: from < recent ? [from] : [],
    imported: 0,
    skipped: 0,
    started: new Date().toISOString(),
    errors: 0,
    force,
  };
  await save(env, st);
  return st;
}

export async function stopBackfill(env: Env): Promise<void> {
  const st = await getBackfill(env);
  if (st?.active) await save(env, { ...st, active: false, finished: new Date().toISOString() });
}

/** 毎分の Cron から呼ばれる。動いていなければ何もしない。 */
export async function backfillStep(env: Env): Promise<void> {
  const st = await getBackfill(env);
  if (!st?.active) return;
  const now = Math.floor(Date.now() / 1000);
  if (st.pause_until && now < st.pause_until) return;

  try {
    const r = await backfillBatch(env, st.after, !!st.force);
    st.imported += r.imported.length;
    st.skipped += r.skipped;
    st.errors = 0;
    st.last_error = undefined;
    // 上限に達したら次の 15 分枠まで待つ (枠の切り替わり直後は避けて +30 秒)
    st.pause_until = r.rate_limited ? nextQuarter(now) + 30 : undefined;
    if (r.next_after == null) {
      const seg = nextSegment(st);
      if (seg == null) {
        st.active = false;
        st.finished = new Date().toISOString();
      } else {
        st.after = seg;
      }
    } else {
      st.after = r.next_after;
    }
  } catch (e) {
    st.errors += 1;
    st.last_error = (e as Error).message;
    st.pause_until = now + 300;
    if (st.errors >= MAX_ERRORS) {
      st.active = false;
      st.finished = new Date().toISOString();
    }
  }
  await save(env, st);
}
