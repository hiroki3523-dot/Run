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
    split_fast_s: splits.length ? round(Math.min(...splits), 0) : null,
    split_slow_s: splits.length ? round(Math.max(...splits), 0) : null,
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
    comments: buildComments(type, pace, hr, cadence, volume, form, settings),
    focus: buildFocus(type, pace, hr, cadence, form, settings),
  };
}

/** サブ3 に必要なペース (秒/km) */
const SUB3_PACE_S = Math.round(10800 / 42.195);

const mmss = (sec: number) => fmtPace(sec);

/**
 * 数字を入れた具体的なコメント。
 * 1) 指標ごとの実測値と基準との差 (ピッチ・心拍・ペース・歩幅)
 * 2) 問題があればその理由
 */
function buildComments(
  type: EvalType,
  pace: MetricResult,
  hr: MetricResult,
  cad: MetricResult,
  vol: MetricResult,
  form: MetricResult,
  settings: Settings,
): string[] {
  const c: string[] = [];
  const pd = pace.details;
  const hd = hr.details;
  const label = type === 'free' ? 'フリーラン' : PLAN_LABELS[type];
  const easyLike = EASY_TYPES.includes(type) || type === 'long';

  // ---- ペース
  if (pace.score != null && pd.avg_pace != null) {
    const avg = pd.avg_pace as number;
    const gap = avg - SUB3_PACE_S;
    const base = `平均ペース ${mmss(avg)}/km (サブ3の ${mmss(SUB3_PACE_S)} に対して ${gap >= 0 ? '+' : '-'}${mmss(Math.abs(gap))})`;
    const fast = pd.split_fast_s as number | null;
    const slow = pd.split_slow_s as number | null;
    const cv = pd.split_cv_pct as number | null;
    const spread = fast != null && slow != null ? `。1km ごとは ${mmss(fast)}〜${mmss(slow)} (ばらつき ${cv}%)` : '';
    c.push(base + spread);
    if (pd.in_band_pct != null && !easyLike) {
      c.push(`${label}の目標帯 ${pd.target} に入っていた時間は ${pd.in_band_pct}%。`);
    }
    const hdiff = pd.half_diff_s as number | null;
    if (hdiff != null && Math.abs(hdiff) >= 3) {
      c.push(hdiff > 0 ? `後半は前半より ${hdiff}秒/km 遅くなっています。` : `後半は前半より ${-hdiff}秒/km 速く、ネガティブスプリットです。`);
    }
    const lastDrop = pd.last_km_drop_s as number | undefined;
    if (lastDrop != null && lastDrop > 10) c.push(`最後の 1km は平均より ${lastDrop}秒/km 遅くなっています。`);
  }

  if (type === 'interval' && pd.reps != null) {
    c.push(`${pd.reps}本: ${pd.rep_paces} (目標 ${pd.target}・帯に入った本 ${pd.in_band_pct}%)`);
    if ((pd.fade_pct as number) > 3) c.push(`最終本が 1 本目より ${pd.fade_pct}% 遅くなっています。`);
  }

  // ---- 心拍
  if (hr.score != null && hd.avg_hr != null) {
    const avgHr = hd.avg_hr as number;
    const pct = Math.round((avgHr / settings.lthr) * 100);
    const zone = hrZone(avgHr, settings.lthr);
    let line = `平均心拍 ${avgHr}bpm (乳酸閾値心拍 ${settings.lthr} の ${pct}%・ゾーン${zone})`;
    if (hd.drift_pct != null) line += `。ドリフト ${hd.drift_pct}%`;
    c.push(line);
    if (easyLike && pct > 85) c.push(`${label}で ${pct}% は高め。ゾーン1〜2 (${Math.round(settings.lthr * 0.85)}bpm 未満) に収めたい強度です。`);
    if (hd.drift_pct != null && (hd.drift_pct as number) > 5) c.push('同じペースでも後半に心拍が上がっています。暑さ・脱水・疲労の影響が考えられます。');
  }

  // ---- ピッチ
  if (cad.score != null) {
    const avg = cad.details.avg_spm as number;
    const target = cad.details.target_spm as number;
    const diff = avg - target;
    let line = `ピッチ ${avg}spm (目標 ${target}・${diff >= 0 ? '+' : ''}${diff})`;
    const fade = cad.details.fade_spm as number | null;
    if (fade != null && fade > 2) line += `。後半は前半より ${fade}spm 低下`;
    c.push(line);
  }

  // ---- 歩幅
  if (form.score != null) {
    const fd = form.details;
    let line = `歩幅 ${fd.stride_m}m・ピッチのばらつき ${fd.cadence_cv_pct}%`;
    if ((fd.stride_shrink_pct as number) > 2) line += `。後半は歩幅が ${fd.stride_shrink_pct}% 縮んでいます`;
    c.push(line);
  }

  if (vol.score != null && (vol.details.ratio_pct as number) < 85) c.push(`距離は計画の ${vol.details.ratio_pct}% でした (参考)。`);
  if (c.length === 0) c.push('ストリームデータがなく、詳しい評価はできませんでした。');
  return c;
}

/**
 * 「次に意識すること」。減点の大きい指標から最大 3 つ、数字つきで具体的な行動を示す。
 * サブ3 のペース (4:16/km) で走るのに必要な歩幅・ピッチも添える。
 */
function buildFocus(type: EvalType, pace: MetricResult, hr: MetricResult, cad: MetricResult, form: MetricResult, settings: Settings): string[] {
  const items: { loss: number; text: string }[] = [];
  const easyLike = EASY_TYPES.includes(type) || type === 'long';
  const need = (SUB3_PACE_S ? 1000 / SUB3_PACE_S : 0) / (settings.target_cadence / 60); // サブ3 ペース・目標ピッチでの歩幅

  if (cad.score != null) {
    const avg = cad.details.avg_spm as number;
    const target = cad.details.target_spm as number;
    const fade = cad.details.fade_spm as number | null;
    if (avg < target - 1) {
      items.push({
        loss: 100 - cad.score,
        text: `ピッチを ${avg}→${target}spm へ。歩幅を伸ばすより、足を体の真下に着いて回転を上げる意識で (サブ3 のペースは歩幅 ${need.toFixed(2)}m × ${settings.target_cadence}spm で走れます)。`,
      });
    } else if (fade != null && fade > 2) {
      items.push({ loss: 100 - cad.score, text: `後半にピッチが ${fade}spm 落ちています。残り 1/3 で腕振りをコンパクトに速くして、ピッチを保つ練習を。` });
    }
  }
  if (hr.score != null) {
    const d = hr.details;
    if (d.drift_pct != null && (d.drift_pct as number) > 4) {
      items.push({ loss: 100 - hr.score, text: `心拍ドリフト ${d.drift_pct}%。前半を ${Math.max(5, Math.round(((d.drift_pct as number) * 2) / 1))}秒/km ほど抑えて入り、補水とジェルを 5km ごとに。` });
    } else if (easyLike && d.avg_hr != null && (d.avg_hr as number) / settings.lthr > 0.85) {
      items.push({ loss: 100 - hr.score, text: `心拍 ${d.avg_hr}bpm は高め。${Math.round(settings.lthr * 0.8)}〜${Math.round(settings.lthr * 0.85)}bpm になるまでペースを落として走る。` });
    }
  }
  if (pace.score != null) {
    const d = pace.details;
    const cv = d.split_cv_pct as number | null;
    const hdiff = d.half_diff_s as number | null;
    if (hdiff != null && hdiff > 4) {
      items.push({ loss: 100 - pace.score, text: `後半 +${hdiff}秒/km の失速。最初の 3km を目標より 5〜8秒/km 遅く入って、後半に同じペースで走り切る。` });
    } else if (cv != null && cv > (EASY_TYPES.includes(type) ? 4 : 2.5)) {
      items.push({ loss: 100 - pace.score, text: `1km ごとのばらつき ${cv}%。時計のラップペースを見て、±5秒/km に収まるように刻む。` });
    } else if (!easyLike && d.in_band_pct != null && (d.in_band_pct as number) < 80) {
      items.push({ loss: 100 - pace.score, text: `目標帯 ${d.target} に入った時間は ${d.in_band_pct}%。設定ペースの感覚を体に覚えさせる繰り返しを。` });
    }
  }
  if (form.score != null) {
    const fd = form.details;
    if ((fd.stride_shrink_pct as number) > 2) {
      items.push({ loss: 100 - form.score, text: `後半に歩幅が ${fd.stride_shrink_pct}% 縮んでいます。疲れても、お尻とハムストリングで地面を押す意識でフォームを保つ。` });
    } else if ((fd.cadence_cv_pct as number) > 5) {
      items.push({ loss: 100 - form.score, text: `ピッチのばらつき ${fd.cadence_cv_pct}%。信号待ちや坂のあとも、すぐ同じリズムに戻す。` });
    }
  }
  items.sort((a, b) => b.loss - a.loss);
  const out = items.slice(0, 3).map((i) => i.text);
  if (out.length === 0) out.push('大きな課題はありません。次回も同じ内容を再現し、ペースか心拍のどちらか 1 つだけ改善を狙いましょう。');
  return out;
}
