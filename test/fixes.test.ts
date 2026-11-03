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

describe('シューズの相性のピッチ・ストライド (2026-11-04 ユーザー報告)', () => {
  it('古い分析の要約 (snap) に 2 倍のピッチが残っていても、ランの記録の値を使う。ストライドは距離÷歩数', async () => {
    await call(env, 'POST', '/shoes', { name: 'B', strava_gear_id: 'gb' });
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) ids.push(await addRun(env, { date: `2026-10-0${i + 1}`, km: 10, segs: [{ km: 10, pace: 300, spm: 180 }], gear_id: 'gb' }));
    // 古い版で保存された要約: ピッチ 2 倍・ストライド半分
    for (const id of ids.slice(0, 2)) await env.DB.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').bind(`snap:${id}`, JSON.stringify({ cad: 360, stride: 55.6 })).run();
    const r = (await call(env, 'GET', '/shoes/compare')).json;
    const row = Object.values(r).flat().find((x: any) => x.name === 'B') as any;
    expect(row.cad).toBe(180);
    expect(row.stride).toBeCloseTo(111.1, 1); // 10km / 50分 = 200m/分 ÷ 180歩
  });
});

describe('月の評価の「前月」は前の月の 1 日〜末日 (2026-11-04 ユーザー報告)', () => {
  it('11 月の前月に 10/1 を含む・10 月の前月に 8/31 を含まない', async () => {
    await addRun(env, { date: '2026-08-31', km: 3, segs: [{ km: 3, pace: 330, spm: 178 }] });
    await addRun(env, { date: '2026-09-30', km: 5, segs: [{ km: 5, pace: 330, spm: 178 }] });
    await addRun(env, { date: '2026-10-01', km: 15, segs: [{ km: 15, pace: 330, spm: 178 }] });
    await addRun(env, { date: '2026-10-31', km: 10, segs: [{ km: 10, pace: 330, spm: 178 }] });
    const nov = (await call(env, 'GET', '/review?from=2026-11-01&to=2026-11-30&kind=month')).json;
    expect(nov.prev_detail.km).toBe(25);
    const oct = (await call(env, 'GET', '/review?from=2026-10-01&to=2026-10-31&kind=month')).json;
    expect(oct.prev_detail.km).toBe(5);
    expect(oct.delta_km_pct).toBe(400); // 25km / 5km - 1
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

describe('K-09 レース詳細の補給・ペースの型・スタートロスが保存される', () => {
  it('PUT /races の info の fuel・pace_mode・pace_adj・start_loss_s が残る (大会情報も消えない)', async () => {
    const r = (await call(env, 'POST', '/races', { name: 'x', date: '2026-12-13', distance_m: 42195, goal_time_s: 11400, no_auto: true, info: { venue: '福岡市', start_time: '8:20' } })).json;
    await call(env, 'PUT', `/races/${r.id}`, { ...r, info: { ...JSON.parse(r.info), fuel: [{ km: 25, item: '塩タブレット' }, { km: 10, item: 'ジェル' }, { km: 'x', item: 'だめ' }], pace_mode: 'negative', pace_adj: [0, -3, 99], start_loss_s: 75 }, no_auto: true });
    const inf = JSON.parse((await call(env, 'GET', '/races')).json[0].info);
    expect(inf.fuel).toEqual([{ km: 10, item: 'ジェル' }, { km: 25, item: '塩タブレット' }]);
    expect(inf.pace_mode).toBe('negative');
    expect(inf.pace_adj).toEqual([0, -3, 60]);
    expect(inf.start_loss_s).toBe(75);
    expect(inf.venue).toBe('福岡市');
    expect(inf.start_time).toBe('8:20');
  });
});

describe('大会の写真 (自分で選んだもの)', () => {
  it('画面で縮小した画像だけ保存し、ほかの文字列や大きすぎる画像は保存しない', async () => {
    const r = (await call(env, 'POST', '/races', { name: 'x', date: '2026-12-13', distance_m: 42195, no_auto: true })).json;
    const put = async (image: unknown) => { await call(env, 'PUT', `/races/${r.id}`, { ...r, info: { image }, no_auto: true }); return JSON.parse((await call(env, 'GET', '/races')).json[0].info).image; };
    expect(await put('data:image/jpeg;base64,AAAA')).toBe('data:image/jpeg;base64,AAAA');
    expect(await put('https://example.com/a.jpg')).toBeUndefined();
    expect(await put('data:image/jpeg;base64,' + 'A'.repeat(400_000))).toBeUndefined();
    expect(await put(null)).toBeUndefined();
    // 見出しの画像の選び方は決まった値だけ
    await call(env, 'PUT', `/races/${r.id}`, { ...r, info: { hero: 'coast' }, no_auto: true });
    expect(JSON.parse((await call(env, 'GET', '/races')).json[0].info).hero).toBe('coast');
    await call(env, 'PUT', `/races/${r.id}`, { ...r, info: { hero: '<script>' }, no_auto: true });
    expect(JSON.parse((await call(env, 'GET', '/races')).json[0].info).hero).toBeUndefined();
  });
});
