import { describe, expect, it, beforeEach } from 'vitest';
import { cleanBody, weightGuide } from '../src/body';
import { blockNetwork, call, makeEnv } from './helpers/fixtures';

describe('からだのデータ: 受け取る値', () => {
  it('ショートカットの形 (割合・コンマ・単位付き・配列) を読み、範囲外や読めない値は保存しない', () => {
    expect(cleanBody({ weight: '72,4 kg', body_fat: 0.152, resting_hr: [50, 48], hrv: '62 ms', sleep_h: 412 })).toEqual({ weight: 72.4, body_fat: 15.2, resting_hr: 48, hrv: 62, sleep_h: 6.9 });
    expect(cleanBody({ weight: 0, body_fat: 95, resting_hr: '', hrv: 'abc' })).toEqual({});
    expect(cleanBody({ weight_kg: 70, sleep_hours: 7.25 })).toEqual({ weight: 70, sleep_h: 7.3 });
    expect(cleanBody({ 'weight ': 71.4, ' Body_Fat': 18.7 })).toEqual({ weight: 71.4, body_fat: 18.7 }); // キーの空白・大文字
    // ヘルスケアサンプルをそのまま文字にしたもの (日時付き)・オブジェクト・空
    expect(cleanBody({ weight: '71.4 kg 2026/11/13 21:09', body_fat: { value: 0.186 }, resting_hr: '' })).toEqual({ weight: 71.4, body_fat: 18.6 });
  });
});

describe('体重と目標タイムの目安', () => {
  const days: Record<string, any> = {};
  for (let i = 0; i < 35; i++) {
    const d = new Date(Date.UTC(2026, 9, 9 + i)).toISOString().slice(0, 10); // 10/9〜11/12
    if (i % 2 === 0) days[d] = { weight: 72 - i * 0.02 };
  }
  it('7 日平均・4 週前との差・1kg あたりの秒数 (体重 1% ≈ タイム 1%)・BMI', () => {
    const g = weightGuide(days, '2026-11-12', 175, 11400)!;
    expect(g.avg7).toBeCloseTo(71.4, 1);
    expect(g.change28).toBeLessThan(0);
    expect(g.sec_per_kg).toBe(Math.round(11400 / g.avg7)); // 約 160 秒
    expect(g.bmi).toBeCloseTo(23.3, 1);
    expect(g.bmi_low_kg).toBeCloseTo(56.7, 1);
    expect(g.lean).toBe(false);
  });
  it('目標タイムが無ければ秒数は出さない・2 週間より前の体重しかなければ出さない・BMI 20 未満は「軽め」', () => {
    expect(weightGuide(days, '2026-11-12', null, null)!.sec_per_kg).toBeNull();
    expect(weightGuide(days, '2026-12-10', 175, 11400)).toBeNull();
    expect(weightGuide({ '2026-11-12': { weight: 58 } }, '2026-11-12', 175, 11400)!.lean).toBe(true);
  });
  it('適正体重: 体脂肪率から 10〜12% のときの体重・目標まであと何 kg・落としたときのタイムの目安', () => {
    const g = weightGuide({ '2026-11-13': { weight: 71.4, body_fat: 18.7 } }, '2026-11-13', null, 11400)!;
    // 除脂肪 71.4 × 0.813 = 58.0kg → 10% なら 64.5kg、12% なら 66.0kg
    expect(g.fit).toEqual({ lo: 64.5, hi: 66, lean: 58 });
    expect(g.target_kg).toBe(66);
    expect(g.target_own).toBe(false);
    expect(g.to_target).toBe(5.4);
    expect(g.gain_s).toBe(Math.round(Math.round(11400 / 71.4) * 5.4)); // 160 秒/kg × 5.4kg ≈ 14 分 24 秒
    // 自分で決めた目標体重があれば、そちらを使う
    const own = weightGuide({ '2026-11-13': { weight: 71.4, body_fat: 18.7 } }, '2026-11-13', null, 11400, 68)!;
    expect([own.target_kg, own.target_own, own.to_target]).toEqual([68, true, 3.4]);
  });
  it('体脂肪率が無ければ適正体重は出さない (推測で埋めない)・適正体重は BMI 18.5 を下回らない・減るペースが速すぎると知らせる', () => {
    const g = weightGuide({ '2026-11-13': { weight: 71.4 } }, '2026-11-13', null, 11400)!;
    expect([g.fit, g.target_kg, g.to_target, g.gain_s]).toEqual([null, null, null, null]);
    const thin = weightGuide({ '2026-11-13': { weight: 58, body_fat: 20 } }, '2026-11-13', 180, null)!;
    expect(thin.fit!.lo).toBeGreaterThanOrEqual(thin.bmi_low_kg!);
    const fast: Record<string, any> = {};
    for (let i = 0; i < 21; i += 3) fast[new Date(Date.UTC(2026, 9, 24 + i)).toISOString().slice(0, 10)] = { weight: 74 - i * 0.2 }; // 週 1.4kg 減
    const f = weightGuide(fast, '2026-11-13', null, null)!;
    expect(f.per_week).toBeCloseTo(-1.4, 1);
    expect(f.too_fast).toBe(true);
    // 記録が少なければ増減のペースは出さない
    expect(g.per_week).toBeNull();
  });
});

describe('からだのデータ: API', () => {
  let env: any;
  beforeEach(() => { ({ env } = makeEnv()); blockNetwork(); });
  it('ショートカットから送った値は項目ごとに上書き (送らなかった項目は残る)・手入力はその日を入れ直す', async () => {
    await call(env, 'POST', '/body', { date: '2026-11-12', weight: 72.4, body_fat: 0.15 });
    const r2 = (await call(env, 'POST', '/body', { date: '2026-11-12', resting_hr: 48 })).json;
    expect([r2.weight, r2.body_fat, r2.resting_hr, r2.source]).toEqual([72.4, 15, 48, 'health']);
    const bad = await call(env, 'POST', '/body', { weight: 'x', note: '' });
    expect(bad.status).toBe(400);
    expect(bad.json.received.weight).toBe('string: "x"'); // 何が届いたかを返す
    const m = (await call(env, 'PUT', '/body/2026-11-12', { weight: '72.0', body_fat: '' })).json;
    expect([m.weight, m.body_fat, m.resting_hr, m.source]).toEqual([72, undefined, undefined, 'manual']);
    await call(env, 'PUT', '/body-profile', { height_cm: 175 });
    // 目標体重だけを送っても、身長は消えない
    await call(env, 'PUT', '/body-profile', { target_kg: 67 });
    expect((await call(env, 'GET', '/body')).json.profile).toEqual({ height_cm: 175, target_kg: 67 });
    const g = (await call(env, 'GET', '/body?from=2026-11-01&to=2026-11-12')).json;
    expect(g.days['2026-11-12'].weight).toBe(72);
    expect(g.profile.height_cm).toBe(175);
    expect(g.guide.avg7).toBe(72);
  });
});
