/**
 * 監査 (docs/AUDIT.md) で見つけた不具合の修正を確かめるテスト (2026-11-03 指示書 v3.0 第2段階)
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeRun } from '../src/analysis';
import { addRun, blockNetwork, call, makeEnv } from './helpers/fixtures';

let env: any;
beforeEach(() => { ({ env } = makeEnv()); blockNetwork(); });

describe('K-01 ピッチを 2 倍しない', () => {
  it('過去との比較で、過去のピッチが 2 倍にならない (DB の値はすでに両足の spm)', async () => {
    for (let i = 0; i < 4; i++) await addRun(env, { date: `2026-10-1${i}`, km: 10, segs: [{ km: 10, pace: 300, spm: 180 }] });
    const now = await addRun(env, { date: '2026-10-20', km: 10, segs: [{ km: 10, pace: 300, spm: 180 }] });
    const an = (await call(env, 'GET', `/activities/${now}/analysis`)).json;
    const cad = an.compare.metrics.find((m: any) => m.key === 'cad');
    expect(cad.past).toBe('180spm');
    expect(cad.now).toBe('180spm');
  });
  it('シューズの相性のピッチも 2 倍にならない', async () => {
    await call(env, 'POST', '/shoes', { name: 'A', strava_gear_id: 'ga' });
    for (let i = 0; i < 3; i++) await addRun(env, { date: `2026-10-0${i + 1}`, km: 10, segs: [{ km: 10, pace: 300, spm: 180 }], gear_id: 'ga' });
    const r = (await call(env, 'GET', '/shoes/compare')).json;
    const cads = JSON.stringify(r).match(/"cad":\s*([\d.]+)/g) ?? [];
    expect(cads.length).toBeGreaterThan(0);
    for (const c of cads) expect(Number(c.split(':')[1])).toBeLessThan(200);
  });
});

describe('K-02 ペースの表示が 4:60 にならない', () => {
  it('299.6 秒/km は 5:00 と表示する', () => {
    const an = analyzeRun({ id: 1, date: '2026-10-01', distance_m: 10000, moving_time_s: 2996, avg_hr: 160, avg_cad_spm: 180, elev_gain: null,
      ev: { type: 'm', eff_type: 'm', score: 80, pace: { score: 80, details: { avg_pace: 299.6, band_min_s: 309.6, band_max_s: 319.6, half_diff_s: 0 } } },
      plan_type: 'm', has_plan: true, fb: null, series: null, easy_min: 330, lthr: 174, past: [] } as any);
    expect(an.overpace!.fact).toContain('5:00/km');
    expect(an.overpace!.fact).toContain('5:10-5:20');
    expect(JSON.stringify(an)).not.toMatch(/\d:60/);
  });
});

describe('K-04 ランのレビューの大会は、ランの日から見た次の大会', () => {
  it('過去のランは、その時点の次の大会と比べる (今日の次の大会ではない)', async () => {
    await call(env, 'POST', '/races', { name: '秋のハーフ', date: '2026-10-12', distance_m: 21097.5, goal_time_s: 5400, priority: 'B', status: 'confirmed', no_auto: true });
    await call(env, 'POST', '/races', { name: '未来のフル', date: '2027-03-01', distance_m: 42195, goal_time_s: 11400, priority: 'A', status: 'confirmed', no_auto: true });
    await call(env, 'POST', '/races', { name: '候補の大会', date: '2026-10-05', distance_m: 42195, goal_time_s: 11000, priority: 'A', status: 'candidate', no_auto: true });
    const id = await addRun(env, { date: '2026-10-02', km: 10, segs: [{ km: 10, pace: 300 }] });
    const rv = (await call(env, 'GET', `/activities/${id}/review`)).json;
    expect(rv.race.name).toBe('秋のハーフ');
    expect(rv.race.days).toBe(10);
    const an = (await call(env, 'GET', `/activities/${id}/analysis`)).json;
    expect(an.ready.race).toContain('秋のハーフ');
    expect(an.ready.days).toBe(10);
  });
});
