import { describe, expect, it } from 'vitest';
import { parseFitness, parseRecords } from '../src/coros';
import { extIdToNumber } from '../src/ext';

describe('coros', () => {
  it('ランの一覧: 文章 (Label ID と Sport(100))', () => {
    const r = parseRecords('1. Sport(100) — 2026-11-01\n   Label ID: 476123456789012345\n\n2. Sport(102) — 2026-10-30\n   labelId: 476123456789000001', null);
    expect(r).toEqual([
      { labelId: '476123456789012345', sportType: 100, date: '2026-11-01', name: null },
      { labelId: '476123456789000001', sportType: 102, date: '2026-10-30', name: null },
    ]);
  });
  it('ランの一覧: JSON (structuredContent でも文章の中でも)', () => {
    const js = { dataList: [{ labelId: '47', sportType: 100, date: 20261101, name: '朝ラン' }] };
    expect(parseRecords('', js)[0]).toEqual({ labelId: '47', sportType: 100, date: '2026-11-01', name: '朝ラン' });
    expect(parseRecords(`結果: ${JSON.stringify(js)}`, null)[0].labelId).toBe('47');
  });
  it('体力評価: 予測タイム・閾値ペース・閾値心拍', () => {
    const f = parseFitness('VO2max: 55\nRunning Level: 80.5\nThreshold Pace: 4:07 /km\nThreshold Heart Rate: 174 bpm\n- 5K: 19:41\n- 10K: 40:41\n- Half Marathon: 1:30:03\n- Marathon: 3:07:29', null);
    expect(f.predicted_s).toEqual({ '5k': 1181, '10k': 2441, half: 5403, full: 11249 });
    expect(f.lt_pace_s).toBe(247);
    expect(f.lthr).toBe(174);
    expect(f.vo2max).toBe(55);
  });
  it('COROS の id は負の数で、同じ labelId なら同じ', () => {
    expect(extIdToNumber('476123456789012345')).toBeLessThan(0);
    expect(extIdToNumber('476123456789012345')).toBe(extIdToNumber('476123456789012345'));
  });
});
