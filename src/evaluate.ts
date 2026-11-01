import { fmtPace } from './format';
import type { ActivityInput, Evaluation, Lap, MetricResult, PaceBand, Plan, PlanType, Settings } from './types';
import { PLAN_LABELS } from './types';

type EvalType = Exclude<PlanType, 'rest'> | 'free';

/** 種別ごとの重み (pace, hr, cadence, volume, form)。距離(volume)は点数に入れず、実走の質だけで評価する */
const WEIGHTS: Record<EvalType, [number, number, number, number, number]> = {
  easy: [0.15, 0.35, 0.25, 0, 0.25],
  jog: [0.1, 0.4, 0.25, 0, 0.25],
  long: [0.25, 0.3, 0.2, 0, 0.25],
  m: [0.4, 0.15, 0.2, 0, 0.25],
  lt: [0.4, 0.15, 0.2, 0, 0.25],
  interval: [0.45, 0.1, 0.2, 0, 0.25],
  race: [0.5, 0.1, 0.2, 0, 0.2],
  free: [0.2, 0.35, 0.25, 0, 0.2],
};

/** 片側評価 (速すぎだけが問題) の種別 */
const EASY_TYPES: EvalType[] = ['easy', 'jog'];
/** 心拍ドリフトを見る一定ペース系 */
const STEADY_TYPES: EvalType[] = ['easy', 'jog', 'long', 'm', 'race', 'free'];
/** アップ・ダウンを除いた本練習部分で評価する種別 */
const FOCUS_TYPES: EvalType[] = ['m', 'lt', 'race', 'interval'];

const MOVING_SPEED = 1.5; // m/s 未満は停止扱い (約 11:00/km)
const WARMUP_SEC = 300; // 心拍の立ち上がりを除外する時間

interface Sample {
  t: number; // 経過秒
  dt: number;
  d: number; // 累積距離 m
  pace: number; // 秒/km
  hr?: number;
  spm?: number;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const round = (v: number, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits;

function weightedMean(values: number[], weights: number[]): number | null {
  let sum = 0;
  let w = 0;
  values.forEach((v, i) => {
    sum += v * weights[i];
    w += weights[i];
  });
  return w > 0 ? sum / w : null;
}

function cv(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

function toSamples(input: ActivityInput): Sample[] {
  const s = input.streams;
  if (!s || s.time.length < 2) return [];
  const out: Sample[] = [];
  for (let i = 1; i < s.time.length; i++) {
    const dt = s.time[i] - s.time[i - 1];
    if (dt <= 0 || dt > 30) continue; // 一時停止の区間は捨てる
    const speed = s.velocity_smooth?.[i] ?? (s.distance[i] - s.distance[i - 1]) / dt;
    if (!(speed >= MOVING_SPEED)) continue;
    const cad = s.cadence?.[i];
    out.push({
      t: s.time[i],
      dt,
      d: s.distance[i],
      pace: 1000 / speed,
      hr: s.heartrate?.[i] || undefined,
      // Strava のランのケイデンスは片足分なので 2 倍する
      spm: cad ? cad * 2 : undefined,
    });
  }
  return out;
}

/** 1km ごとのスプリット (秒/km) */
function kmSplits(samples: Sample[]): number[] {
  const splits: number[] = [];
  let startD = samples[0]?.d ?? 0;
  let time = 0;
  for (const s of samples) {
    time += s.dt;
    if (s.d - startD >= 1000) {
      splits.push((time / (s.d - startD)) * 1000);
      startD = s.d;
      time = 0;
    }
  }
  return splits;
}

function halves<T>(xs: T[]): [T[], T[]] {
  const mid = Math.floor(xs.length / 2);
  return [xs.slice(0, mid), xs.slice(mid)];
}

const lapPace = (l: Lap) => (l.average_speed > 0 ? 1000 / l.average_speed : Infinity);

// ---------------------------------------------------------------- pace

function evalPace(type: EvalType, band: PaceBand | null, samples: Sample[], laps: Lap[]): MetricResult {
  if (type === 'interval' && band) return evalIntervalPace(band, samples, laps);

  if (samples.length === 0) return { score: null, summary: 'ペースデータなし', details: {} };

  // M/LT/レースはアップ・ダウンを除いた本練習部分で評価する
  const work =
    band && !EASY_TYPES.includes(type) && type !== 'long'
      ? samples.filter((s) => s.pace <= band.max + 20)
      : samples;
  if (work.length === 0) {
    return { score: 10, summary: '目標ペース帯の走行がありません', details: {} };
  }

  const dts = work.map((s) => s.dt);
  const avgPace = weightedMean(work.map((s) => s.pace), dts)!;
  const splits = kmSplits(work);
  const splitCv = cv(splits);
  // 1km ごとのばらつき。1% 以下で満点、3% で 50 点、5% で 0 点 (ジョグはもともと揺れやすいので少し緩め)
  const slack = EASY_TYPES.includes(type) ? 0.025 : 0.01;
  const consistency = splitCv == null ? null : clamp(100 - (splitCv - slack) * 2500);

  const [first, second] = halves(work);
  const p1 = weightedMean(first.map((s) => s.pace), first.map((s) => s.dt));
  const p2 = weightedMean(second.map((s) => s.pace), second.map((s) => s.dt));
  const halfDiff = p1 && p2 ? p2 - p1 : null; // 正なら後半失速

  const details: MetricResult['details'] = {
    avg_pace: round(avgPace, 0),
    split_cv_pct: splitCv == null ? null : round(splitCv * 100),
    half_diff_s: halfDiff == null ? null : round(halfDiff, 0),
    work_km: round(work.reduce((a, s) => a + s.dt / s.pace, 0), 2),
  };

  // 後半の失速 (3秒/km を超えた分) と、最後の 1km の落ち込みを減点
  let penalty = 0;
  if (halfDiff != null && halfDiff > 3) penalty += Math.min(25, (halfDiff - 3) * 1.5);
  if (splits.length >= 4) {
    const lastDrop = splits[splits.length - 1] - splits.slice(0, -1).reduce((a, b) => a + b, 0) / (splits.length - 1);
    details.last_km_drop_s = round(lastDrop, 0);
    if (lastDrop > 10) penalty += Math.min(10, (lastDrop - 10) * 0.5);
  }

  if (!band) {
    return {
      score: consistency == null ? null : round(clamp(consistency - penalty), 0),
      summary: `平均 ${fmtPace(avgPace)}/km`,
      details,
    };
  }

  const tol = 3;
  let inBand: number;
  if (EASY_TYPES.includes(type)) {
    inBand = weightedMean(work.map((s) => (s.pace >= band.min - tol ? 1 : 0)), dts)!;
  } else if (type === 'long') {
    inBand = weightedMean(work.map((s) => (s.pace >= band.min - tol && s.pace <= band.max + 15 ? 1 : 0)), dts)!;
  } else {
    inBand = weightedMean(work.map((s) => (s.pace >= band.min - tol && s.pace <= band.max + tol ? 1 : 0)), dts)!;
  }
  details.in_band_pct = round(inBand * 100);
  details.target = `${fmtPace(band.min)}-${fmtPace(band.max)}`;

  let score = inBand * 100;
  // 目標帯に入っていることが前提。そのうえで刻みの安定度が低いほど減点する
  if (consistency != null) score = score * (0.5 + 0.5 * (consistency / 100));
  score -= penalty;

  return {
    score: round(clamp(score), 0),
    summary: `平均 ${fmtPace(avgPace)}/km・目標帯 ${Math.round(inBand * 100)}%`,
    details,
  };
}

function evalIntervalPace(band: PaceBand, samples: Sample[], laps: Lap[]): MetricResult {
  const work = laps.filter((l) => l.distance >= 100 && lapPace(l) <= band.max + 15);
  if (work.length < 2) {
    // ラップを切っていない場合はサンプルで代用
    const fast = samples.filter((s) => s.pace <= band.max + 15);
    if (fast.length === 0) return { score: 10, summary: '設定ペースの疾走区間がありません', details: {} };
    const dts = fast.map((s) => s.dt);
    const inBand = weightedMean(fast.map((s) => (s.pace >= band.min - 3 && s.pace <= band.max + 3 ? 1 : 0)), dts)!;
    return {
      score: round(clamp(inBand * 100), 0),
      summary: `ラップ未検出・疾走区間の目標帯 ${Math.round(inBand * 100)}%`,
      details: { in_band_pct: round(inBand * 100), target: `${fmtPace(band.min)}-${fmtPace(band.max)}` },
    };
  }

  const paces = work.map(lapPace);
  const inBand = paces.filter((p) => p >= band.min - 3 && p <= band.max + 3).length / paces.length;
  const lapCv = cv(paces) ?? 0;
  const fade = (paces[paces.length - 1] - paces[0]) / paces[0];
  let score = inBand * 70 + clamp(100 - (lapCv - 0.01) * 2000) * 0.3;
  if (fade > 0.03) score -= Math.min(20, (fade - 0.03) * 500);

  return {
    score: round(clamp(score), 0),
    summary: `${work.length}本・平均 ${fmtPace(paces.reduce((a, b) => a + b, 0) / paces.length)}/km・目標帯 ${Math.round(inBand * 100)}%`,
    details: {
      reps: work.length,
      rep_paces: paces.map((p) => fmtPace(p)).join(' '),
      in_band_pct: round(inBand * 100),
      lap_cv_pct: round(lapCv * 100),
      fade_pct: round(fade * 100),
      target: `${fmtPace(band.min)}-${fmtPace(band.max)}`,
    },
  };
}

// ---------------------------------------------------------------- heart rate

export function hrZone(hr: number, lthr: number): number {
  const r = hr / lthr;
  if (r < 0.85) return 1;
  if (r < 0.9) return 2;
  if (r < 0.95) return 3;
  if (r < 1.0) return 4;
  return 5;
}

/** samples は全体 (ゾーン分布用)、focus は評価対象の区間 */
function evalHr(
  type: EvalType,
  range: { min: number; max: number } | null,
  samples: Sample[],
  focus: Sample[],
  settings: Settings,
): MetricResult {
  const all = samples.filter((s) => s.hr && s.t >= WARMUP_SEC);
  const withHr = focus.filter((s) => s.hr && s.t >= WARMUP_SEC);
  if (withHr.length < 10) return { score: null, summary: '心拍データなし', details: {} };

  const dts = withHr.map((s) => s.dt);
  const avgHr = weightedMean(withHr.map((s) => s.hr!), dts)!;
  const zones = [0, 0, 0, 0, 0];
  all.forEach((s) => (zones[hrZone(s.hr!, settings.lthr) - 1] += s.dt));
  const allTotal = all.reduce((a, s) => a + s.dt, 0);
  const total = dts.reduce((a, b) => a + b, 0);

  const details: MetricResult['details'] = {
    avg_hr: round(avgHr, 0),
    max_hr: Math.max(...withHr.map((s) => s.hr!)),
  };
  zones.forEach((z, i) => (details[`z${i + 1}_pct`] = round((z / allTotal) * 100)));

  // 心拍ドリフト (前半/後半の速度÷心拍の低下率)
  let drift: number | null = null;
  if (STEADY_TYPES.includes(type) && total >= 1200) {
    const [a, b] = halves(withHr);
    const ef = (xs: Sample[]) =>
      weightedMean(xs.map((s) => 1000 / s.pace / s.hr!), xs.map((s) => s.dt))!;
    drift = (ef(a) - ef(b)) / ef(a);
    details.drift_pct = round(drift * 100);
  }
  // ドリフト 2% 以下で満点、5% で 70 点、8% で 40 点、12% 以上は 10 点
  const driftScore = drift == null ? null : drift <= 0.02 ? 100 : drift <= 0.12 ? clamp(100 - (drift - 0.02) * 1000, 10) : 10;

  if (!range) {
    return {
      score: driftScore == null ? null : round(driftScore, 0),
      summary: `平均 ${Math.round(avgHr)}bpm${drift != null ? `・ドリフト ${round(drift * 100)}%` : ''}`,
      details,
    };
  }

  details.target = `${range.min}-${range.max}`;
  let target: number;
  if (type === 'interval') {
    // 疾走区間で十分に心拍が上がったか
    target = weightedMean(withHr.map((s) => (s.hr! >= range.min ? 1 : 0)), dts)!;
  } else if (EASY_TYPES.includes(type) || type === 'long') {
    target = weightedMean(withHr.map((s) => (s.hr! <= range.max ? 1 : 0)), dts)!;
  } else {
    target = weightedMean(withHr.map((s) => (s.hr! >= range.min && s.hr! <= range.max ? 1 : 0)), dts)!;
  }
  details.in_range_pct = round(target * 100);

  const score = driftScore == null ? target * 90 : target * 100 * (0.4 + 0.6 * (driftScore / 100));
  return {
    score: round(clamp(score), 0),
    summary: `平均 ${Math.round(avgHr)}bpm・目標域 ${Math.round(target * 100)}%${drift != null ? `・ドリフト ${round(drift * 100)}%` : ''}`,
    details,
  };
}

// ---------------------------------------------------------------- cadence

function evalCadence(type: EvalType, samples: Sample[], laps: Lap[], settings: Settings): MetricResult {
  const withCad = samples.filter((s) => s.spm && s.spm > 100);
  let avg: number | null = null;
  let fadeSpm: number | null = null;

  if (withCad.length >= 10) {
    avg = weightedMean(withCad.map((s) => s.spm!), withCad.map((s) => s.dt));
    const [a, b] = halves(withCad);
    const m1 = weightedMean(a.map((s) => s.spm!), a.map((s) => s.dt))!;
    const m2 = weightedMean(b.map((s) => s.spm!), b.map((s) => s.dt))!;
    fadeSpm = m1 - m2;
  } else {
    const ls = laps.filter((l) => l.average_cadence);
    if (ls.length > 0) {
      avg = weightedMean(ls.map((l) => l.average_cadence! * 2), ls.map((l) => l.moving_time));
    }
  }
  if (avg == null) return { score: null, summary: 'ケイデンスデータなし', details: {} };

  // ゆっくり走る日はケイデンスが下がるのが自然なので目標を少し緩める
  const target = settings.target_cadence - (EASY_TYPES.includes(type) ? 6 : type === 'long' || type === 'free' ? 3 : 0);
  const deficit = target - avg;
  // 目標より 1spm 低いごとに 8 点減。170spm を切るとほぼ 0 点に近づく
  let score = deficit <= 0 ? 100 : 100 - deficit * 8;
  if (fadeSpm != null && fadeSpm > 2) score -= (fadeSpm - 2) * 8;

  return {
    score: round(clamp(score), 0),
    summary: `平均 ${Math.round(avg)}spm (目標 ${target})${fadeSpm != null && fadeSpm > 3 ? `・後半 -${round(fadeSpm, 0)}` : ''}`,
    details: { avg_spm: round(avg, 0), target_spm: target, fade_spm: fadeSpm == null ? null : round(fadeSpm) },
  };
}

// ---------------------------------------------------------------- form

/**
 * フォームの安定度。ケイデンスのばらつき・歩幅(速度÷ピッチ)のばらつき・後半の歩幅の縮みを見る。
 * 歩幅が一定でピッチも安定しているほど、ブレの少ない効率的な走りと判断する。
 */
function evalForm(samples: Sample[]): MetricResult {
  const w = samples.filter((s) => s.spm && s.spm > 100 && s.t >= 120);
  if (w.length < 30) return { score: null, summary: 'フォームデータなし', details: {} };
  const stride = (s: Sample) => 1000 / s.pace / (s.spm! / 60); // m/歩
  const cadCv = cv(w.map((s) => s.spm!)) ?? 0;
  const strCv = cv(w.map(stride)) ?? 0;
  const [a, b] = halves(w);
  const m = (xs: Sample[]) => xs.reduce((t, s) => t + stride(s), 0) / xs.length;
  const shrink = (m(a) - m(b)) / m(a); // 正なら後半に歩幅が縮んだ
  const avgStride = m(w);

  // ピッチ 3% 以下 / 歩幅 8% 以下で満点。超えた分だけ減点
  let score = 100;
  score -= Math.max(0, cadCv - 0.03) * 1000;
  score -= Math.max(0, strCv - 0.08) * 400;
  if (shrink > 0.02) score -= (shrink - 0.02) * 1500;
  return {
    score: round(clamp(score), 0),
    summary: `歩幅 ${round(avgStride, 2)}m・ピッチのばらつき ${round(cadCv * 100)}%${shrink > 0.02 ? `・後半 歩幅 -${round(shrink * 100)}%` : ''}`,
    details: { stride_m: round(avgStride, 2), cadence_cv_pct: round(cadCv * 100), stride_cv_pct: round(strCv * 100), stride_shrink_pct: round(shrink * 100) },
  };
}

// ---------------------------------------------------------------- volume

function evalVolume(plan: Plan | null, distance: number): MetricResult {
  if (!plan?.distance_m) return { score: null, summary: '距離目標なし', details: {} };
  const ratio = distance / plan.distance_m;
  const score = ratio >= 0.95 && ratio <= 1.15 ? 100 : ratio < 0.95 ? 100 - (0.95 - ratio) * 250 : 100 - (ratio - 1.15) * 150;
  return {
    score: round(clamp(score), 0),
    summary: `${round(distance / 1000)}km / 計画 ${round(plan.distance_m / 1000)}km (${Math.round(ratio * 100)}%)`,
    details: { ratio_pct: round(ratio * 100) },
  };
}

// ---------------------------------------------------------------- main

export function resolveTargets(plan: Plan | null, settings: Settings) {
  const type: EvalType = plan && plan.type !== 'rest' ? plan.type : 'free';
  if (type === 'free') return { type, band: null, hrRange: null };
  const def = settings.paces[type];
  const band: PaceBand = { min: plan?.pace_min_s ?? def.min, max: plan?.pace_max_s ?? def.max };
  const ratio = settings.hr_targets[type];
  const hrRange = {
    min: Math.round(settings.lthr * ratio.min),
    max: plan?.hr_max ?? Math.min(settings.max_hr, Math.round(settings.lthr * ratio.max)),
  };
  return { type, band, hrRange };
}

export function evaluateRun(input: ActivityInput, plan: Plan | null, settings: Settings): Evaluation {
  const { type, band, hrRange } = resolveTargets(plan, settings);
  const samples = toSamples(input);

  let focus = samples;
  if (band && FOCUS_TYPES.includes(type)) {
    const w = samples.filter((s) => s.pace <= band.max + (type === 'interval' ? 15 : 20));
    if (w.length > 0) focus = w;
  }

  const pace = evalPace(type, band, samples, input.laps);
  const hr = evalHr(type, hrRange, samples, focus, settings);
  const cadence = evalCadence(type, focus, input.laps, settings);
  const volume = evalVolume(plan, input.distance_m);
  const form = evalForm(focus);

  const metrics = [pace, hr, cadence, volume, form];
  const weights = WEIGHTS[type];
  const present = metrics.map((m, i) => (m.score == null ? 0 : weights[i]));
  const total = weightedMean(metrics.map((m) => m.score ?? 0), present);

  return {
    type,
    score: total == null ? 0 : Math.round(total),
    pace,
    hr,
    cadence,
    volume,
    form,
    comments: buildComments(type, pace, hr, cadence, volume, form),
  };
}

function buildComments(type: EvalType, pace: MetricResult, hr: MetricResult, cad: MetricResult, vol: MetricResult, form: MetricResult): string[] {
  const c: string[] = [];
  const pd = pace.details;
  const hd = hr.details;
  const label = type === 'free' ? 'フリーラン' : PLAN_LABELS[type];

  if (pace.score != null) {
    if (EASY_TYPES.includes(type) && (pd.in_band_pct as number) < 80) {
      c.push(`${label}にしては速すぎる区間が多めです。回復を優先してペースを抑えましょう。`);
    } else if ((type === 'm' || type === 'lt' || type === 'race') && (pd.in_band_pct as number) >= 80) {
      c.push(`${label}は目標ペース帯をしっかりキープできています。`);
    } else if ((type === 'm' || type === 'lt') && pd.in_band_pct != null && (pd.in_band_pct as number) < 60) {
      c.push(`${label}の目標帯 (${pd.target}) から外れる時間が長めです。`);
    } else if ((type === 'm' || type === 'lt') && pd.in_band_pct != null) {
      c.push(`${label}の目標帯 (${pd.target}) 滞在は ${pd.in_band_pct}%。もう一段ペースを安定させたいところです。`);
    }
    if (type === 'interval' && (pd.fade_pct as number) > 3) {
      c.push(`最終本が 1 本目より ${pd.fade_pct}% 遅くなっています。設定か本数の見直しを。`);
    }
    const hdiff = pd.half_diff_s as number | null;
    if (hdiff != null && (type === 'm' || type === 'long' || type === 'race')) {
      if (hdiff <= -2) c.push(`後半が ${-hdiff}秒/km 速いネガティブスプリット。理想的です。`);
      else if (hdiff >= 8) c.push(`後半に ${hdiff}秒/km 失速。前半の入りか補給を見直しましょう。`);
    }
  }

  if (hr.score != null) {
    const drift = hd.drift_pct as number | undefined;
    if (drift != null && drift > 5) c.push(`心拍ドリフトが ${drift}% と大きめ。暑さ・脱水・疲労の可能性があります。`);
    else if (drift != null && drift <= 3 && (type === 'long' || type === 'm')) c.push(`心拍ドリフト ${drift}% で有酸素ベースは良好です。`);
    if ((EASY_TYPES.includes(type) || type === 'long') && (hd.in_range_pct as number) < 70) {
      c.push(`心拍が上限 ${String(hd.target).split('-')[1]}bpm を超える時間が長めです。`);
    }
  }

  if (cad.score != null) {
    const avg = cad.details.avg_spm as number;
    const target = cad.details.target_spm as number;
    const fade = cad.details.fade_spm as number | null;
    if (avg < target - 5) c.push(`ケイデンス ${avg}spm は目標より低め。接地を短く、ピッチを意識しましょう。`);
    if (fade != null && fade > 3) c.push(`後半にケイデンスが ${fade}spm 落ちています。疲労時のフォーム維持が課題です。`);
  }

  if (form.score != null) {
    const fd = form.details;
    if ((fd.cadence_cv_pct as number) > 5) c.push(`ピッチのばらつきが ${fd.cadence_cv_pct}% と大きめ。リズムを一定に保つ意識を。`);
    if ((fd.stride_shrink_pct as number) > 2) c.push(`後半に歩幅が ${fd.stride_shrink_pct}% 縮んでいます。疲れでフォームが小さくなっています。`);
  }
  const cv = pace.details.split_cv_pct as number | null | undefined;
  if (cv != null && cv > (EASY_TYPES.includes(type) ? 4 : 2.5)) c.push(`1km ごとのペースのばらつきが ${cv}%。一定のリズムで刻めていません。`);
  const lastDrop = pace.details.last_km_drop_s as number | undefined;
  if (lastDrop != null && lastDrop > 10) c.push(`最後の 1km が平均より ${lastDrop}秒/km 遅い。最後まで保つ力が課題です。`);
  if (vol.score != null && (vol.details.ratio_pct as number) < 85) c.push('計画距離に届いていません (参考)。');
  if (c.length === 0) c.push('ペース・心拍・ピッチ・歩幅とも安定。目立った減点はありません。');
  return c;
}
