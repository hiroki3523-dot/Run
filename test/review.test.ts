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
