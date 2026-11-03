/**
 * 監査 (docs/AUDIT.md) で見つけた不具合の「正しい動き」を書いたテスト。
 * まだ直していないのでスキップにしてある (合格扱いにはしない)。直したら skip を外す。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { addRun, blockNetwork, call, makeEnv } from './helpers/fixtures';

let env: any;
beforeEach(() => { ({ env } = makeEnv()); blockNetwork(); });

describe('既知の不具合 (未修正)', () => {
  // [S-01] 計画にステップが無いとき、評価は「目標帯の遅い側 +20 秒より速い記録」だけを使う。
  // そのため、メインの途中で 20 秒以上落ちた区間がアップ・ダウンと一緒に除かれ、失速が採点に入らない (docs/SEGMENTS.md)
  it.skip('[S-01] 3km+10km+2km の 1 記録: メイン後半の失速 (4:55) が評価区間に残り、失速として出る', async () => {
    await call(env, 'POST', '/plans', { date: '2026-10-25', type: 'm', distance_m: 10000, pace_min_s: 268, pace_max_s: 272 });
    const id = await addRun(env, { date: '2026-10-25', km: 15, segs: [{ km: 3, pace: 330, hr: 140 }, { km: 8, pace: 270, hr: 162 }, { km: 2, pace: 295, hr: 166 }, { km: 2, pace: 340, hr: 145 }] });
    const ev = (await call(env, 'GET', `/activities/${id}`)).json.evaluation;
    expect(ev.pace.details.work_km).toBeGreaterThan(9.5);
    expect(ev.pace.details.half_diff_s).toBeGreaterThan(3);
  });
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
