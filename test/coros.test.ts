import { describe, expect, it } from 'vitest';
import { buildExt, movingClock, parseFitness, parseRecords, unquote } from '../src/coros';
import { extIdToNumber } from '../src/ext';

describe('coros', () => {
  it('ランの一覧: 文章 (Label ID と Sport(100))', () => {
    const r = parseRecords('1. Sport(100) — 2026-11-01\n   Label ID: 476123456789012345\n\n2. Sport(102) — 2026-10-30\n   labelId: 476123456789000001', null);
    expect(r).toEqual([
      { labelId: '476123456789012345', sportType: 100, date: '2026-11-01', name: null, dist_m: null, dur_s: null },
      { labelId: '476123456789000001', sportType: 102, date: '2026-10-30', name: null, dist_m: null, dur_s: null },
    ]);
  });
  it('ランの一覧: 距離と時間も読む (Strava との重なりの判定に使う)', () => {
    const r = parseRecords('1. Sport(100) — 2026-11-01\n   Label ID: 476123456789012345\n   Duration: 47:12 | Distance: 9.01 km', null);
    expect(r[0].dist_m).toBe(9010);
    expect(r[0].dur_s).toBe(2832);
  });
  it('ランの一覧: COROS の実際の書き方 (Location・startTimestamp・LabelId | SportType)', () => {
    const t = '1. Outdoor Run — 2026-11-01\n   Location: 福岡市 ラン\n   Time Window: startTimestamp=1793522170 | endTimestamp=1793525401\n   Duration: 53:50 | Distance: 12.01 km\n   LabelId: 481446915685253226 | SportType: 100';
    expect(parseRecords(t, null)[0]).toEqual({ labelId: '481446915685253226', sportType: 100, date: '2026-11-01', name: '福岡市 ラン', dist_m: 12010, dur_s: 3230, start: 1793522170 });
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
  it('体力評価: COROS の書き方 (4\'08" のペース・ゾーンの範囲・小数のランニングレベル)', () => {
    const f = parseFitness('Running Level: 89.9\nAerobic Endurance: 89.5 (4\'47"-5\'46"/km)\nLactate Threshold: 88.7 (4\'03"-4\'25"/km)\nSpeed Endurance: 88.7 (3\'42"-4\'02"/km)\nThreshold Pace: 4\'08"/km\nLactate Threshold Heart Rate: 174 bpm\n- 5K: 19:41 (3\'56"/km)\n- Marathon: 3:07:29 (4\'27"/km)', null);
    expect(f.running_level).toBe(89.9);
    expect(f.lt_pace_s).toBe(248);
    expect(f.lthr).toBe(174);
    expect(f.zones_s).toEqual({ aerobic: [287, 346], threshold: [243, 265], speed: [222, 242] });
    expect(f.predicted_s).toEqual({ '5k': 1181, full: 11249 });
  });
  it('JSON の文字列 ("...\\n...") で返ってきても全件読む', () => {
    const t = JSON.stringify('Sport Records (2 records)\n\n1. Outdoor Run — 2026-11-01\n   LabelId: 481446915959980133 | SportType: 100\n\n2. Outdoor Run — 2026-10-30\n   LabelId: 481403404445319172 | SportType: 100');
    expect(parseRecords(t, null).length).toBeLessThan(2);
    expect(parseRecords(unquote(t), null).length).toBe(2);
  });
  it('COROS の id は負の数で、同じ labelId なら同じ', () => {
    expect(extIdToNumber('476123456789012345')).toBeLessThan(0);
    expect(extIdToNumber('476123456789012345')).toBe(extIdToNumber('476123456789012345'));
  });
  // 2km を 1km 5:00 で走り、600m 地点で 50 秒止まった (時計のタイマーは 600 秒)
  const runWithStop = (keepRecording: boolean) => {
    const recs: { t: number; dist: number; hr: number }[] = [];
    let t = 1000, d = 0;
    recs.push({ t, dist: 0, hr: 140 });
    while (d < 2000) {
      t += 1; d = Math.min(2000, d + 1000 / 300);
      recs.push({ t, dist: d, hr: 150 });
      if (Math.abs(d - 600) < 1000 / 600 && !recs.some((r) => r.t > t)) {
        if (keepRecording) for (let k = 0; k < 50; k++) { t += 1; recs.push({ t, dist: d, hr: 120 }); } // 止まっている間も記録が続く
        else t += 50; // オートポーズで記録が途切れる
      }
    }
    return recs;
  };
  it('1km ごとのラップ: 止まっていた時間 (一時停止) は入れない — 記録が途切れる場合', () => {
    const recs = runWithStop(false);
    const mc = movingClock(recs, 600);
    expect(Math.abs(mc[mc.length - 1] - 600)).toBeLessThanOrEqual(2);
    const fit: any = { session: { start: 1000, elapsed: 650, timer: 600, dist: 2000 }, laps: [], records: recs, tz_offset_s: 9 * 3600, fields: [] };
    const a = buildExt({ labelId: '476123456789012345', sportType: 100, date: '2026-11-14' } as any, fit, null);
    const sp = (a as any).act.splits_metric.map((x: any) => x.moving_time);
    expect(sp.length).toBe(2);
    for (const x of sp) expect(Math.abs(x - 300)).toBeLessThanOrEqual(2); // 5:50 ではなく 5:00
    expect((a as any).act.elapsed_time).toBe(650); // 合計の経過時間はそのまま
  });
  it('1km ごとのラップ: 止まっている間も記録が続く場合は、距離が進まない区間をタイマー時間に合わせて除く', () => {
    const recs = runWithStop(true);
    const mc = movingClock(recs, 600);
    expect(Math.abs(mc[mc.length - 1] - 600)).toBeLessThanOrEqual(2);
    // 600m までと、止まったあとの時間は減らさない
    const at = (dist: number) => mc[recs.findIndex((r) => r.dist >= dist)];
    expect(Math.abs(at(1000) - 300)).toBeLessThanOrEqual(2);
    // タイマーが無いとき・止まっていないときは、そのまま
    const plain = runWithStop(true);
    expect(movingClock(plain, null)[plain.length - 1]).toBe(plain[plain.length - 1].t - plain[0].t);
  });
});
