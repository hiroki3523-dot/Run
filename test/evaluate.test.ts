import { describe, expect, it } from 'vitest';
import { evaluateRun, hrZone, resolveTargets } from '../src/evaluate';
import { DEFAULT_SETTINGS, type ActivityInput, type Lap, type Plan, type Streams } from '../src/types';

interface Segment {
  sec: number;
  pace: number; // 秒/km
  hr: number;
  hrEnd?: number; // 区間内で線形に変化させる
  spm: number;
}

/** 1 秒ごとの streams を合成する */
function makeStreams(segments: Segment[]): Streams {
  const s: Required<Streams> = { time: [0], distance: [0], velocity_smooth: [0], heartrate: [segments[0].hr], cadence: [segments[0].spm / 2] };
  let t = 0;
  let d = 0;
  for (const seg of segments) {
    for (let i = 0; i < seg.sec; i++) {
      t += 1;
      const v = 1000 / seg.pace;
      d += v;
      s.time.push(t);
      s.distance.push(d);
      s.velocity_smooth.push(v);
      s.heartrate.push(Math.round(seg.hr + ((seg.hrEnd ?? seg.hr) - seg.hr) * (i / seg.sec)));
      s.cadence.push(seg.spm / 2);
    }
  }
  return s;
}

function input(segments: Segment[], laps: Lap[] = []): ActivityInput {
  const streams = makeStreams(segments);
  return {
    distance_m: streams.distance[streams.distance.length - 1],
    moving_time_s: streams.time[streams.time.length - 1],
    laps,
    streams,
  };
}

const plan = (p: Partial<Plan>): Plan => ({
  id: 1,
  date: '2026-11-01',
  type: 'easy',
  distance_m: null,
  pace_min_s: null,
  pace_max_s: null,
  hr_max: null,
  notes: null,
  ...p,
});

const S = DEFAULT_SETTINGS; // LTHR 174, cadence 180

describe('evaluateRun', () => {
  it('Easy を守った走りは高得点', () => {
    const ev = evaluateRun(input([{ sec: 3600, pace: 320, hr: 140, hrEnd: 143, spm: 176 }]), plan({ type: 'easy', distance_m: 11250 }), S);
    expect(ev.score).toBeGreaterThanOrEqual(90);
    expect(ev.pace.details.in_band_pct).toBe(100);
    expect(ev.hr.details.in_range_pct).toBe(100);
  });

  it('Easy で速すぎ・心拍高すぎは減点しコメントを出す', () => {
    const ev = evaluateRun(input([{ sec: 3000, pace: 265, hr: 162, spm: 182 }]), plan({ type: 'easy' }), S);
    expect(ev.pace.score!).toBeLessThan(50);
    expect(ev.hr.score!).toBeLessThan(50);
    expect(ev.comments.some((c) => c.includes('速すぎ'))).toBe(true);
  });

  it('M ペース走はアップ・ダウンを除いて評価する', () => {
    const ev = evaluateRun(
      input([
        { sec: 900, pace: 340, hr: 135, spm: 172 },
        { sec: 3400, pace: 253, hr: 158, spm: 184 },
        { sec: 600, pace: 350, hr: 140, spm: 170 },
      ]),
      plan({ type: 'm', distance_m: 20000 }),
      S,
    );
    expect(ev.pace.details.in_band_pct).toBeGreaterThan(95);
    expect(ev.pace.score!).toBeGreaterThanOrEqual(90);
    // 心拍・ケイデンスも本練習部分の値になる
    expect(ev.hr.details.avg_hr).toBe(158);
    expect(ev.cadence.details.avg_spm).toBe(184);
    expect(ev.comments.some((c) => c.includes('キープ'))).toBe(true);
  });

  it('M ペース走の後半失速を検出する', () => {
    const ev = evaluateRun(
      input([
        { sec: 2000, pace: 250, hr: 158, spm: 184 },
        { sec: 2000, pace: 268, hr: 165, spm: 176 },
      ]),
      plan({ type: 'm' }),
      S,
    );
    expect(ev.pace.details.half_diff_s as number).toBeGreaterThan(8);
    expect(ev.comments.some((c) => c.includes('失速'))).toBe(true);
  });

  it('心拍ドリフトを計算する', () => {
    const ev = evaluateRun(input([{ sec: 5400, pace: 290, hr: 140, hrEnd: 160, spm: 180 }]), plan({ type: 'long' }), S);
    expect(ev.hr.details.drift_pct as number).toBeGreaterThan(5);
    expect(ev.comments.some((c) => c.includes('ドリフト'))).toBe(true);
  });

  it('インターバルはラップで本数・失速を評価する', () => {
    const rep = (pace: number): Lap => ({ distance: 1000, moving_time: pace, average_speed: 1000 / pace, average_heartrate: 168 });
    const rest: Lap = { distance: 300, moving_time: 120, average_speed: 2.5 };
    const good = [rep(232), rest, rep(233), rest, rep(231), rest, rep(233), rest, rep(232)];
    const bad = [rep(229), rest, rep(235), rest, rep(242), rest, rep(249), rest, rep(257)];
    const segs = [{ sec: 1200, pace: 330, hr: 150, spm: 178 }];
    const evGood = evaluateRun(input(segs, good), plan({ type: 'interval' }), S);
    const evBad = evaluateRun(input(segs, bad), plan({ type: 'interval' }), S);
    expect(evGood.pace.details.reps).toBe(5);
    expect(evGood.pace.score!).toBeGreaterThanOrEqual(90);
    expect(evBad.pace.score!).toBeLessThan(evGood.pace.score! - 30);
    expect(evBad.comments.some((c) => c.includes('最終本'))).toBe(true);
  });

  it('ケイデンス低下と後半の落ち込みを減点する', () => {
    const ev = evaluateRun(
      input([
        { sec: 1800, pace: 255, hr: 158, spm: 178 },
        { sec: 1800, pace: 255, hr: 160, spm: 166 },
      ]),
      plan({ type: 'm' }),
      S,
    );
    expect(ev.cadence.score!).toBeLessThan(60);
    expect(ev.comments.some((c) => c.includes('ケイデンス'))).toBe(true);
  });

  it('計画なしはフリーラン、距離評価なし', () => {
    const ev = evaluateRun(input([{ sec: 2400, pace: 300, hr: 145, spm: 178 }]), null, S);
    expect(ev.type).toBe('free');
    expect(ev.volume.score).toBeNull();
    expect(ev.score).toBeGreaterThan(80);
  });

  it('心拍・streams が無くても評価できる', () => {
    const ev = evaluateRun(
      { distance_m: 10000, moving_time_s: 3200, laps: [{ distance: 10000, moving_time: 3200, average_speed: 3.125, average_cadence: 88 }], streams: null },
      plan({ type: 'easy', distance_m: 10000 }),
      S,
    );
    expect(ev.hr.score).toBeNull();
    expect(ev.cadence.details.avg_spm).toBe(176);
    expect(ev.score).toBeGreaterThan(0);
  });

  it('計画距離に届かないと減点', () => {
    const ev = evaluateRun(input([{ sec: 1800, pace: 320, hr: 140, spm: 178 }]), plan({ type: 'easy', distance_m: 15000 }), S);
    expect(ev.volume.score!).toBeLessThan(50);
    expect(ev.comments).toContain('計画距離に届いていません。');
  });
});

describe('resolveTargets', () => {
  it('計画の値が既定値より優先される', () => {
    const t = resolveTargets(plan({ type: 'm', pace_min_s: 245, pace_max_s: 250, hr_max: 165 }), S);
    expect(t.band).toEqual({ min: 245, max: 250 });
    expect(t.hrRange!.max).toBe(165);
  });
  it('休養日はフリーラン扱い', () => {
    expect(resolveTargets(plan({ type: 'rest' }), S).type).toBe('free');
  });
});

describe('hrZone', () => {
  it('LTHR 比でゾーン分けする', () => {
    expect(hrZone(140, 170)).toBe(1);
    expect(hrZone(150, 170)).toBe(2);
    expect(hrZone(160, 170)).toBe(3);
    expect(hrZone(165, 170)).toBe(4);
    expect(hrZone(172, 170)).toBe(5);
  });
});
