import { describe, expect, it } from 'vitest';
import { buildInsights, predictFromRuns, timeForVdot } from '../src/insights';

describe('insights', () => {
  it('VDOT からのフルのタイムは Daniels の表に近い (VDOT 50 ≒ 3:10)', () => {
    const t = timeForVdot(50, 42195);
    expect(t).toBeGreaterThan(3 * 3600 + 9 * 60);
    expect(t).toBeLessThan(3 * 3600 + 12 * 60);
  });
  it('心拍つきのランが 3 本未満なら推定しない', () => {
    expect(predictFromRuns([{ date: '2026-11-01', distance_m: 12000, moving_time_s: 3220, avg_hr: 165, avg_cadence_spm: null, plan_type: null, role: null, drift_pct: null }], 190, '2026-11-02')).toBeNull();
  });
  it('課題は数字つきで、足りないものから次の練習を出す', () => {
    const r = buildInsights({ today: '2026-11-02', runs: [], race: { name: '熊本城', date: '2027-02-21', distance_m: 42195, goal_time_s: 10800 }, predicted_full_s: 11249, target_cadence: 180 });
    expect(r.gap_s).toBe(449);
    expect(r.items.find((x) => x.key === 'volume')!.level).toBe('bad');
    expect(r.actions.length).toBeGreaterThan(0);
  });
});
