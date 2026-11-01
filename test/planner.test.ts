import { describe, expect, it } from 'vitest';
import { generatePlan, goalPace, weekVolume } from '../src/planner';
import { DEFAULT_SETTINGS } from '../src/types';

const kumamoto = { date: '2027-02-21', name: '熊本城マラソン', distance_m: 42195, goal_time_s: 10800 };
const fukuoka = { date: '2026-11-08', name: '福岡マラソン', distance_m: 42195, goal_time_s: 11400 };

describe('planner', () => {
  it('目標ペースはタイムから、未設定ならサブ3', () => {
    expect(Math.round(goalPace(fukuoka))).toBe(270);
    expect(goalPace({ ...fukuoka, goal_time_s: null })).toBe(255);
  });
  it('週の距離は少しずつ増え、4週目は減る', () => {
    expect(weekVolume(60, 1)).toBeGreaterThan(weekVolume(60, 0));
    expect(weekVolume(60, 3)).toBeLessThan(weekVolume(60, 2));
  });
  it('レース週は調整メニューで、当日はレース', () => {
    const rows = generatePlan({ start: '2026-11-02', race: fukuoka, others: [], weekly_km: 60, last_completion: 1, last_race: null, settings: DEFAULT_SETTINGS });
    expect(rows.length).toBe(7);
    expect(rows[0].type).toBe('rest'); // 11/2 (D6)
    expect(rows[2].type).toBe('m'); // 11/4 (D4)
    expect(rows[6].type).toBe('race');
    expect(rows[6].date).toBe('2026-11-08');
  });
  it('熊本城まで: 毎日1件、日曜はロング、月曜は休養、直前2週は距離が減る', () => {
    const rows = generatePlan({
      start: '2026-11-09', race: kumamoto,
      others: [{ date: '2026-12-13', name: '青島太平洋マラソン', distance_m: 42195, goal_time_s: null }],
      weekly_km: 60, last_completion: 0.9, last_race: '2026-11-08', settings: DEFAULT_SETTINGS,
    });
    const dates = new Set(rows.map((r) => r.date));
    expect(dates.size).toBe(rows.length);
    expect(rows[rows.length - 1].type).toBe('race');
    expect(rows.find((r) => r.date === '2026-12-13')!.type).toBe('race');
    expect(rows.find((r) => r.date === '2026-11-09')!.type).toBe('rest'); // レース翌日
    const sun = rows.filter((r) => new Date(r.date + 'T00:00:00Z').getUTCDay() === 0 && r.type === 'long');
    expect(sun.length).toBeGreaterThan(5);
    const longest = Math.max(...sun.map((r) => r.distance_m!));
    expect(longest).toBeLessThanOrEqual(32000);
    expect(longest).toBeGreaterThanOrEqual(28000);
    const wk = (from: string) => rows.filter((r) => r.date >= from && r.date < new Date(Date.parse(from) + 7 * 86400000).toISOString().slice(0, 10)).reduce((s, r) => s + (r.distance_m ?? 0), 0) / 1000;
    expect(wk('2027-02-08')).toBeLessThan(wk('2027-01-18')); // テーパー
  });
});
