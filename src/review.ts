import { fmtKm, fmtPace } from './format';

export interface ReviewRun {
  id: number;
  date: string;
  name: string;
  distance_m: number;
  moving_time_s: number;
  avg_hr: number | null;
  score: number | null;
  plan_id: number | null;
  /** evaluation.comments の先頭数件 */
  comments: string[];
  /** トレーニング負荷 (COROS の TL に近づけた簡易計算) */
  tl?: number;
}

/** 時間 × (平均心拍 / 乳酸閾値心拍)^2 × 1.5。43分・心拍123・LTHR174 で約 32 (COROS と同程度) */
export function trainingLoad(moving_time_s: number, avg_hr: number | null, lthr: number): number {
  if (!avg_hr || !lthr) return Math.round((moving_time_s / 60) * 0.55);
  return Math.round((moving_time_s / 60) * (avg_hr / lthr) ** 2 * 1.5);
}

export interface ReviewPlan {
  id: number;
  date: string;
  type: string;
  distance_m: number | null;
}

export interface PeriodTotals {
  runs: number;
  km: number;
}

export interface Review {
  from: string;
  to: string;
  runs: number;
  run_days: number;
  km: number;
  time_s: number;
  avg_pace_s: number | null;
  avg_hr: number | null;
  avg_score: number | null;
  planned_km: number;
  completion: number | null; // 実績km / 計画km
  quality: { planned: number; done: number };
  longest_km: number;
  long_runs_28: number; // 28km 以上の回数
  best: ReviewRun | null;
  worst: ReviewRun | null;
  prev: PeriodTotals | null;
  delta_km_pct: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | null;
  comments: string[];
  next: string[];
  list: ReviewRun[];
  tl: number;
  /** 日ごとの距離 (ストラバ風の丸い表示用) */
  days: { date: string; km: number; runs: number }[];
}

const QUALITY = ['m', 'lt', 'interval', 'race'];

/** 期間内のラン・計画から、集計とルールベースのコメントを作る (AI の API は使わない) */
export function buildReview(
  from: string,
  to: string,
  runs: ReviewRun[],
  plans: ReviewPlan[],
  prev: PeriodTotals | null,
  kind: 'day' | 'week' | 'month',
): Review {
  const km = runs.reduce((s, r) => s + r.distance_m, 0) / 1000;
  const time = runs.reduce((s, r) => s + r.moving_time_s, 0);
  const scored = runs.filter((r) => r.score != null);
  const hrRuns = runs.filter((r) => r.avg_hr);
  const hrDist = hrRuns.reduce((s, r) => s + r.distance_m, 0);
  const planned = plans.filter((p) => p.type !== 'rest').reduce((s, p) => s + (p.distance_m ?? 0), 0) / 1000;
  const qPlans = plans.filter((p) => QUALITY.includes(p.type));
  const linked = new Set(runs.map((r) => r.plan_id).filter((x) => x != null));
  const quality = { planned: qPlans.length, done: qPlans.filter((p) => linked.has(p.id)).length };
  const longest = Math.max(0, ...runs.map((r) => r.distance_m / 1000));
  const sortedByScore = [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const completion = planned > 0 ? km / planned : null;
  const avgScore = scored.length ? Math.round(scored.reduce((s, r) => s + (r.score ?? 0), 0) / scored.length) : null;
  const delta = prev && prev.km > 0 ? (km / prev.km - 1) * 100 : null;

  const comments: string[] = [];
  const next: string[] = [];
  const unit = kind === 'day' ? '今日' : kind === 'week' ? '今週' : '今月';

  if (runs.length === 0) {
    comments.push(planned > 0 ? `${unit}は計画 ${fmtKm(planned * 1000)}km に対して、まだ記録がありません。` : `${unit}の記録はありません。`);
  } else {
    comments.push(`${runs.length}回・${fmtKm(km * 1000)}km を走りました${avgScore != null ? `(平均 ${avgScore} 点)` : ''}。`);
  }
  if (completion != null && runs.length > 0) {
    const pct = Math.round(completion * 100);
    if (completion >= 0.9 && completion <= 1.1) comments.push(`距離は計画どおりです (${pct}%)。`);
    else if (completion < 0.8) {
      comments.push(`距離は計画の ${pct}% にとどまりました。`);
      next.push('取り戻そうとして一度に増やさず、次は計画どおりに戻す。');
    } else if (completion > 1.15) {
      comments.push(`距離は計画より多めです (${pct}%)。`);
      next.push('疲労がたまりやすいので、次の Easy は計画より短くてもよい。');
    }
  }
  if (kind !== 'day' && delta != null) {
    if (delta > 20) {
      comments.push(`前の${kind === 'week' ? '週' : '月'}より ${Math.round(delta)}% 増えています。`);
      next.push('増やしすぎのサイン。次は据え置きか、1〜2割減らす。');
    } else if (delta < -30 && km > 0) comments.push(`前の${kind === 'week' ? '週' : '月'}より ${Math.round(-delta)}% 減っています (調整・疲労抜きなら問題なし)。`);
  }
  if (quality.planned > 0) {
    comments.push(`ポイント練習は ${quality.done}/${quality.planned} 回できました。`);
    if (quality.done < quality.planned) next.push('抜けたポイント練習は、翌日に詰め込まず次の枠で。');
  }
  if (kind === 'month') {
    const long28 = runs.filter((r) => r.distance_m >= 28000).length;
    comments.push(long28 > 0 ? `28km 以上のロング走は ${long28} 回。` : '28km 以上のロング走はありません。');
  } else if (kind === 'week' && longest >= 25) comments.push(`最長は ${longest.toFixed(1)}km でした。`);
  const low = scored.filter((r) => (r.score ?? 100) < 60);
  for (const r of low.slice(0, 2)) {
    comments.push(`${r.date.slice(5).replace('-', '/')} は ${r.score} 点${r.comments[0] ? `: ${r.comments[0]}` : ''}`);
  }
  if (avgScore != null && avgScore >= 85) comments.push('評価は高めで、狙いどおりに走れています。');
  if (avgScore != null && avgScore < 65 && scored.length >= 3) next.push('ペースと心拍が目安から外れがち。Easy は心拍を優先してゆっくり。');
  if (next.length === 0 && runs.length > 0) next.push('この調子で計画どおりに進める。');

  let grade: Review['grade'] = null;
  if (runs.length > 0) {
    let pts = avgScore ?? 70;
    if (completion != null) pts -= Math.min(30, Math.abs(1 - completion) * 60);
    if (quality.planned > 0) pts -= (1 - quality.done / quality.planned) * 15;
    grade = pts >= 85 ? 'A' : pts >= 70 ? 'B' : pts >= 55 ? 'C' : 'D';
  }

  const days: Review['days'] = [];
  for (let d = from; d <= to; d = new Date(Date.parse(d) + 86400_000).toISOString().slice(0, 10)) {
    const day = runs.filter((r) => r.date === d);
    days.push({ date: d, km: Math.round(day.reduce((a, r) => a + r.distance_m, 0) / 100) / 10, runs: day.length });
  }
  return {
    tl: runs.reduce((a, r) => a + (r.tl ?? 0), 0),
    days,
    from,
    to,
    runs: runs.length,
    run_days: new Set(runs.map((r) => r.date)).size,
    km: Math.round(km * 10) / 10,
    time_s: time,
    avg_pace_s: km > 0 ? time / km : null,
    avg_hr: hrDist > 0 ? Math.round(hrRuns.reduce((s, r) => s + (r.avg_hr ?? 0) * r.distance_m, 0) / hrDist) : null,
    avg_score: avgScore,
    planned_km: Math.round(planned * 10) / 10,
    completion,
    quality,
    longest_km: Math.round(longest * 10) / 10,
    long_runs_28: runs.filter((r) => r.distance_m >= 28000).length,
    best: sortedByScore[0] ?? null,
    worst: sortedByScore.length > 1 ? sortedByScore[sortedByScore.length - 1] : null,
    prev,
    delta_km_pct: delta == null ? null : Math.round(delta),
    grade,
    comments,
    next,
    list: [...runs].sort((a, b) => (a.date < b.date ? 1 : -1)),
  };
}

export const paceText = (s: number | null) => (s == null ? '-' : fmtPace(s));
