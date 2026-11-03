import { describe, it, expect } from 'vitest';
import { buildReview, trainingLoad } from '../src/review';

const run = (date: string, km: number) => ({
  id: 1, date, name: 'r', distance_m: km * 1000, moving_time_s: km * 330, avg_hr: 140, score: 80, plan_id: null, comments: [], tl: 50,
});

describe('review', () => {
  it('TL は COROS の例に近い', () => {
    const tl = trainingLoad(42 * 60 + 57, 123, 174);
    expect(tl > 28 && tl < 36).toBe(true);
  });
  it('週の集計と日ごとの丸', () => {
    const r = buildReview('2026-10-26', '2026-11-01', [run('2026-10-26', 6), run('2026-10-28', 10), run('2026-10-28', 9.6)], [], null, 'week');
    expect(r.km).toBe(25.6);
    expect(r.days.length).toBe(7);
    expect(r.days[2].runs).toBe(2);
    expect(r.tl).toBe(150);
  });
});

import { growthOf, kindGroup } from '../src/review';

describe('実績の週・月 (2026-11 追加)', () => {
  const r = (date: string, km: number, pace: number, hr: number | null, type: string | null, role: string | null = null, id = Math.random()) => ({
    id, date, name: 'r', distance_m: km * 1000, moving_time_s: km * pace, avg_hr: hr, score: 80, plan_id: null, comments: [], tl: 50, type, role,
  });
  it('日ごとの計画距離・メインの種類・内訳が出る (アップ・ダウンは「アップ・ダウン」)', () => {
    const rv = buildReview('2026-10-26', '2026-11-01', [r('2026-11-01', 5, 314, 140, 'jog', 'warmup'), r('2026-11-01', 12, 269, 165, 'm', 'work'), r('2026-10-28', 8, 330, 142, 'easy')],
      [{ id: 1, date: '2026-11-01', type: 'm', distance_m: 18000 }, { id: 2, date: '2026-10-28', type: 'easy', distance_m: 8000 }], { runs: 3, km: 20 }, 'week');
    const d = rv.days.find((x) => x.date === '2026-11-01')!;
    expect(d.plan_km).toBe(18);
    expect(d.main_type).toBe('m');
    expect(rv.breakdown!.map((x) => x.key)).toEqual(['point', 'easy', 'link']);
    expect(rv.breakdown!.find((x) => x.key === 'link')!.km).toBe(5);
    expect(rv.next_period!.length).toBeGreaterThan(0);
  });
  it('レースが 7 日以内なら、翌週の提案はレースの準備', () => {
    const rv = buildReview('2026-10-26', '2026-11-01', [r('2026-10-28', 8, 330, 142, 'easy')], [], { runs: 1, km: 8 }, 'week', { today: '2026-11-03', races: [{ name: '福岡マラソン', date: '2026-11-08', priority: 'A', distance_m: 42195 }] });
    expect(rv.next_period![0]).toContain('福岡マラソン');
  });
  it('種類のまとまり', () => {
    expect(kindGroup('m', 'work', 12)).toBe('point');
    expect(kindGroup('jog', 'warmup', 5)).toBe('link');
    expect(kindGroup(null, null, 22)).toBe('long');
    expect(kindGroup('easy', null, 8)).toBe('easy');
  });
  it('成長: 同じペースにそろえた心拍の差。少なければ保留', () => {
    const cur = [r('2026-10-02', 8, 330, 142, 'easy'), r('2026-10-05', 8, 330, 143, 'easy')];
    const prev = [r('2026-09-02', 8, 335, 147, 'easy'), r('2026-09-05', 8, 335, 148, 'easy')];
    const g = growthOf(cur, prev);
    const e = g.find((x) => x.key === 'hr_easy')!;
    expect(e.trend).toBe('up');
    expect(g.find((x) => x.key === 'hr_point')!.trend).toBe('hold');
  });
});
