/**
 * 監査 (docs/AUDIT.md) で見つけた不具合の「正しい動き」を書いたテスト。
 * まだ直していないのでスキップにしてある (合格扱いにはしない)。直したら skip を外す。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { addRun, blockNetwork, call, makeEnv } from './helpers/fixtures';

let env: any;
beforeEach(() => { ({ env } = makeEnv()); blockNetwork(); });

describe('既知の不具合 (未修正)', () => {
  it.skip('[K-01] 過去との比較で、過去のピッチが 2 倍にならない', async () => {
    for (let i = 0; i < 4; i++) await addRun(env, { date: `2026-10-1${i}`, km: 10, segs: [{ km: 10, pace: 300, spm: 180 }] });
    const now = await addRun(env, { date: '2026-10-20', km: 10, segs: [{ km: 10, pace: 300, spm: 180 }] });
    const an = (await call(env, 'GET', `/activities/${now}/analysis`)).json;
    expect(an.compare.metrics.find((m: any) => m.key === 'cad').past).toBe('180spm');
  });
  it.skip('[K-02] 分析の文章のペースが「4:60」にならない', async () => {
    // 299.6 秒/km 前後のランで、一定ペース区間の表示が 4:60 にならないこと
    const id = await addRun(env, { date: '2026-10-21', km: 10, segs: [{ km: 10, pace: 299.6, hr: 150 }] });
    const an = (await call(env, 'GET', `/activities/${id}/analysis`)).json;
    expect(JSON.stringify(an)).not.toContain(':60');
  });
});
