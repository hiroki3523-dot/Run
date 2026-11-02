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

  const kum = (prefs: Partial<typeof DEFAULT_SETTINGS.plan_prefs>, extra = {}) =>
    generatePlan({
      start: '2026-11-09', race: kumamoto, others: [], weekly_km: 60, last_completion: 1, last_race: '2026-11-08',
      settings: { ...DEFAULT_SETTINGS, plan_prefs: { ...DEFAULT_SETTINGS.plan_prefs, ...prefs } }, ...extra,
    });
  const POINTS = ['m', 'lt', 'interval'];
  const weekOf = (rows: ReturnType<typeof kum>, from: string) => rows.filter((r) => r.date >= from && r.date < new Date(Date.parse(from) + 7 * 86400000).toISOString().slice(0, 10));

  it('休みの回数だけ自動で配置: ロング翌日が休みになり、ポイント走とは重ならない', () => {
    const rows = kum({ points_per_week: 2, long_per_week: 1, rest_per_week: 1, rest_days: [] });
    const wk = weekOf(rows, '2026-12-14');
    expect(wk.filter((r) => r.type === 'rest').length).toBe(1);
    expect(wk.filter((r) => POINTS.includes(r.type)).length).toBe(2);
    expect(wk.filter((r) => r.type === 'long').length).toBe(1);
    expect(weekOf(kum({ rest_per_week: 2, rest_days: [] }), '2026-12-14').filter((r) => r.type === 'rest').length).toBe(2);
  });
  it('希望どおり: ポイント走は週2回・ロング1回・休養日は固定', () => {
    const rows = kum({ points_per_week: 2, long_per_week: 1, rest_days: [1, 5] });
    const wk = weekOf(rows, '2026-12-14'); // 通常週
    expect(wk.filter((r) => POINTS.includes(r.type)).length).toBe(2);
    expect(wk.filter((r) => r.type === 'long').length).toBe(1);
    for (const r of wk) {
      const dow = new Date(r.date + 'T00:00:00Z').getUTCDay();
      if (dow === 1 || dow === 5) expect(r.type).toBe('rest');
    }
  });
  it('ロング走を週2回にできる (2本目は短め、1本目と離れた日)', () => {
    const wk = weekOf(kum({ points_per_week: 1, long_per_week: 2 }), '2026-12-14');
    const longs = wk.filter((r) => r.type === 'long');
    expect(longs.length).toBe(2);
    expect(Math.min(...longs.map((r) => r.distance_m!))).toBeLessThan(Math.max(...longs.map((r) => r.distance_m!)));
  });
  it('ポイント走を週3回にできる / 0回にもできる', () => {
    expect(weekOf(kum({ points_per_week: 3 }), '2026-12-14').filter((r) => POINTS.includes(r.type)).length).toBe(3);
    expect(weekOf(kum({ points_per_week: 0 }), '2026-12-14').filter((r) => POINTS.includes(r.type)).length).toBe(0);
  });
  it('走れない日は休養になり、ロング走は近い日に移る', () => {
    const rows = kum({ blocked: ['2026-12-20'] }); // 日曜
    const sun = rows.find((r) => r.date === '2026-12-20')!;
    expect(sun.type).toBe('rest');
    const wk = weekOf(rows, '2026-12-14');
    expect(wk.filter((r) => r.type === 'long').length).toBe(1);
  });
  it('週の途中からの作り直しは、走った分とポイント済みを差し引く', () => {
    const rows = kum({}, { start: '2026-12-16', last_race: null, week_done: { km: 30, points: 1, long: false } });
    const wk = rows.filter((r) => r.date >= '2026-12-16' && r.date <= '2026-12-20');
    expect(wk.filter((r) => POINTS.includes(r.type)).length).toBe(1);
    expect(wk.filter((r) => r.type === 'long').length).toBe(1);
  });
});
