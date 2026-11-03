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
  /** 紐づいた計画の種類 (表示用。2026-11 追加) */
  plan_type?: string | null;
  /** evaluation.comments の先頭数件 */
  comments: string[];
  /** トレーニング負荷 (COROS の TL に近づけた簡易計算) */
  tl?: number;
  /** アップ・メイン・ダウン (ステップのある計画のとき) */
  role?: string | null;
  /** 評価の種類 (easy / m / long / race …) */
  type?: string | null;
}

/** 期間の前後のレース (調整期・回復期の判断用) */
export interface ReviewCtx { today: string; races: { name: string; date: string; priority: string; distance_m: number }[] }
export interface GradePart { key: string; label: string; score: number | null; weight: number; reason: string }

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
  /** 等級の内訳 (平均点 − 距離のずれ − ポイント練習の未実施 = 評価点) */
  grade_calc: { avg: number; dist_penalty: number; quality_penalty: number; pts: number } | null;
  /** 期間がまだ終わっていない (途中経過) */
  in_progress: boolean;
  /** 調整期 (レース前) / 回復期 (レース後) */
  phase: 'taper' | 'recovery' | null;
  phase_note: string | null;
  /** 評価の内訳 (項目・重み・理由) */
  parts: GradePart[];
  /** 今日までの計画 (途中経過のときの比較対象) */
  due_km: number;
  /** レースの距離 (通常の練習とは分けて集計) */
  race_km: number;
  comments: string[];
  next: string[];
  list: ReviewRun[];
  tl: number;
  /** 日ごとの距離 (ストラバ風の丸い表示用)。plan_km: その日の計画・main_type: その日のメインの種類 (2026-11 追加) */
  days: { date: string; km: number; runs: number; plan_km?: number; main_type?: string | null; score?: number | null }[];
  /** 練習の内訳 (種類ごとの回数と距離。アップ・ダウンは「つなぎ」) (2026-11 追加) */
  breakdown?: { key: string; label: string; runs: number; km: number }[];
  /** 次の期間への提案 (週: 翌週・月: 翌月) (2026-11 追加) */
  next_period?: string[];
}

/** 練習の種類のまとまり (内訳用) */
export function kindGroup(type: string | null | undefined, role: string | null | undefined, km: number): string {
  if (role === 'warmup' || role === 'cooldown') return 'link';
  if (type === 'race') return 'race';
  if (type === 'm' || type === 'lt' || type === 'interval') return 'point';
  if (type === 'long' || km >= 20) return 'long';
  if (type === 'easy' || type === 'jog') return 'easy';
  return 'free';
}
export const KIND_LABEL: Record<string, string> = { point: 'ポイント練', long: 'ロング走', easy: 'Easy・Jog', race: 'レース', free: 'フリー', link: 'アップ・ダウン' };

/** 成長の比較: 同じくらいのペースで走ったときの心拍が、前の期間よりどう変わったか (気温差などを含む参考値) */
export interface Growth { key: string; label: string; now: string; past: string; diff: string; trend: 'up' | 'same' | 'down' | 'hold'; note: string }
export function growthOf(cur: ReviewRun[], prev: ReviewRun[]): Growth[] {
  const out: Growth[] = [];
  const pace = (r: ReviewRun) => r.moving_time_s / (r.distance_m / 1000);
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
  const sel = (rs: ReviewRun[], g: string) => rs.filter((r) => r.avg_hr && r.distance_m >= 3000 && kindGroup(r.type, r.role, r.distance_m / 1000) === g);
  for (const [g, label] of [['easy', 'Easy・Jog'], ['point', 'ポイント練']] as const) {
    const a = sel(cur, g), b = sel(prev, g);
    if (a.length < 2 || b.length < 2) { out.push({ key: `hr_${g}`, label: `${label}: 同じペースでの心拍`, now: '-', past: '-', diff: '-', trend: 'hold', note: `比べるランが足りない (今 ${a.length} 本・前 ${b.length} 本。2 本ずつ必要)` }); continue; }
    // 両方の期間の中央のペースにそろえる (心拍 ∝ 速さ とみなす)
    const ref = med([...a, ...b].map(pace));
    const adj = (rs: ReviewRun[]) => med(rs.map((r) => r.avg_hr! * (pace(r) / ref)));
    const now = adj(a), past = adj(b), d = now - past;
    out.push({ key: `hr_${g}`, label: `${label}: ${fmtPace(ref)}/km での心拍`, now: `${Math.round(now)}bpm`, past: `${Math.round(past)}bpm`, diff: `${d >= 0 ? '+' : ''}${Math.round(d)}`, trend: d <= -2 ? 'up' : d >= 3 ? 'down' : 'same', note: `今 ${a.length} 本・前 ${b.length} 本の中央値。気温・疲れの違いも含む参考値` });
  }
  return out;
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
  ctx: ReviewCtx = { today: '9999-12-31', races: [] },
): Review {
  const inProgress = to >= ctx.today && from <= ctx.today;
  // 途中経過: 今日までの計画だけを比べる (まだ来ていない日を未達成にしない)
  const plansDue = inProgress ? plans.filter((p) => p.date <= ctx.today) : plans;
  // 調整期・回復期: A/B レースの 14 日前〜当日 / A レースの後 7 日
  const dd = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400_000);
  const taperRace = ctx.races.find((r) => r.priority !== 'C' && r.date >= from && dd(to, r.date) <= 14);
  const recRace = ctx.races.find((r) => r.priority === 'A' && r.date < from && dd(r.date, from) <= 7);
  const phase: Review['phase'] = taperRace ? 'taper' : recRace ? 'recovery' : null;
  const phaseNote = taperRace ? `${taperRace.name} (${taperRace.date.slice(5).replace('-', '/')}) に向けた調整期。距離が少ないのは狙いどおりなので減点しません。` : recRace ? `${recRace.name}のあとの回復期。距離・強度が少ないのは狙いどおりなので減点しません。` : null;
  // 練習の質はメインのランで見る (アップ・ダウンは除く)
  const mains = runs.filter((r) => r.role !== 'warmup' && r.role !== 'cooldown');
  const km = runs.reduce((s, r) => s + r.distance_m, 0) / 1000;
  const time = runs.reduce((s, r) => s + r.moving_time_s, 0);
  const scored = runs.filter((r) => r.score != null && r.role !== 'warmup' && r.role !== 'cooldown');
  const hrRuns = runs.filter((r) => r.avg_hr);
  const hrDist = hrRuns.reduce((s, r) => s + r.distance_m, 0);
  const planned = plans.filter((p) => p.type !== 'rest').reduce((s, p) => s + (p.distance_m ?? 0), 0) / 1000;
  const due = plansDue.filter((p) => p.type !== 'rest').reduce((s, p) => s + (p.distance_m ?? 0), 0) / 1000;
  const qPlans = plansDue.filter((p) => QUALITY.includes(p.type));
  const linked = new Set(runs.map((r) => r.plan_id).filter((x) => x != null));
  const quality = { planned: qPlans.length, done: qPlans.filter((p) => linked.has(p.id)).length };
  const longest = Math.max(0, ...runs.map((r) => r.distance_m / 1000));
  const sortedByScore = [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  // 今日の分は、まだ走っていなければ比べない
  const kmDue = inProgress ? runs.filter((r) => r.date <= ctx.today).reduce((a, r) => a + r.distance_m, 0) / 1000 : km;
  const dueAdj = inProgress && !runs.some((r) => r.date === ctx.today) ? plansDue.filter((p) => p.type !== 'rest' && p.date < ctx.today).reduce((s, p) => s + (p.distance_m ?? 0), 0) / 1000 : due;
  const completion = dueAdj > 0 ? kmDue / dueAdj : null;
  const raceKm = runs.filter((r) => r.type === 'race').reduce((a, r) => a + r.distance_m, 0) / 1000;
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
  if (inProgress && kind !== 'day') comments.unshift(`途中経過です (${Number(ctx.today.slice(5, 7))}/${Number(ctx.today.slice(8))} まで)。まだ来ていない日の計画は比べていません。`);
  if (phaseNote) comments.push(phaseNote);
  if (completion != null && runs.length > 0) {
    const pct = Math.round(completion * 100);
    if (phase && completion < 0.9) comments.push(`距離は${inProgress ? '今日までの' : ''}計画の ${pct}%。${phase === 'taper' ? '調整期なので' : '回復期なので'}問題ありません。`);
    else if (completion >= 0.9 && completion <= 1.1) comments.push(`距離は${inProgress ? '今日までの' : ''}計画どおりです (${pct}%)。`);
    else if (completion < 0.8) {
      comments.push(`距離は計画の ${pct}% にとどまりました。`);
      next.push('取り戻そうとして一度に増やさず、次は計画どおりに戻す。');
    } else if (completion > 1.15) {
      comments.push(`距離は計画より多めです (${pct}%)。`);
      next.push('疲労がたまりやすいので、次の Easy は計画より短くてもよい。');
    }
  }
  if (kind !== 'day' && delta != null && !inProgress) {
    if (delta > 20) {
      comments.push(`前の${kind === 'week' ? '週' : '月'}より ${Math.round(delta)}% 増えています。`);
      next.push('増やしすぎのサイン。次は据え置きか、1〜2割減らす。');
    } else if (delta < -30 && km > 0 && !inProgress && !phase) comments.push(`前の${kind === 'week' ? '週' : '月'}より ${Math.round(-delta)}% 減っています (調整・疲労抜きなら問題なし)。`);
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

  // ---- 評価 (日次: その日の練習の達成度 / 週次: 構成・負荷・回復 / 月次: 継続と長期の練習内容)
  const parts: GradePart[] = [];
  const add = (key: string, label: string, score: number | null, weight: number, reason: string) => parts.push({ key, label, score: score == null ? null : Math.round(Math.max(0, Math.min(100, score))), weight, reason });
  add('quality', kind === 'day' ? 'メイン練習の評価' : '練習の質 (メインのランの平均点)', avgScore, kind === 'day' ? 80 : 40, avgScore == null ? '評価のあるランがない' : kind === 'day' ? `メインのラン${runs.length > mains.length ? ' (アップ・ダウンは除く)' : ''}` : `${scored.length} 本の平均${runs.length > mains.length ? ' (アップ・ダウンは除く)' : ''}`);
  if (kind !== 'day') {
    const qs = quality.planned ? (quality.done / quality.planned) * 100 : null;
    add('points', 'ポイント練習の実施', qs, 25, quality.planned ? `${inProgress ? '今日までの' : ''}ポイント練 ${quality.done}/${quality.planned} 回` : `${inProgress ? '今日までに' : ''}ポイント練の計画なし`);
  }
  const distScore = completion == null ? null : phase && completion < 1.15 ? 100 : 100 - Math.max(0, Math.abs(1 - completion) - 0.1) * 120;
  add('volume', kind === 'day' ? '距離' : '計画との距離のずれ', distScore, kind === 'day' ? 20 : 20, completion == null ? '計画の距離がない' : `${inProgress ? '今日までの計画' : '計画'} ${Math.round(dueAdj * 10) / 10}km に対して ${Math.round(kmDue * 10) / 10}km (${Math.round(completion * 100)}%)${phase ? '・調整期/回復期は少なくても減点なし' : ''}`);
  if (kind !== 'day') {
    let ls: number | null = null, lr = '前の期間の記録がない';
    if (inProgress) lr = '期間が終わってから評価 (途中で増減を判断しない)';
    else if (delta != null) { ls = phase ? 100 : delta > 20 ? 100 - (delta - 20) * 2 : 100; lr = `前の${kind === 'week' ? '週' : '月'}比 ${delta >= 0 ? '+' : ''}${Math.round(delta)}%${phase ? '・調整期/回復期' : '・+20% までなら問題なし'}`; }
    add('load', '負荷の増え方', ls, 15, lr);
  }
  const usable = parts.filter((x) => x.score != null);
  const wsum = usable.reduce((a, x) => a + x.weight, 0);
  let grade: Review['grade'] = null;
  let gradeCalc: Review['grade_calc'] = null;
  // 評価できる材料が少ないときは保留
  if (runs.length > 0 && usable.some((x) => x.key === 'quality') && wsum >= 50) {
    const pts = usable.reduce((a, x) => a + x.score! * x.weight, 0) / wsum;
    grade = pts >= 85 ? 'A' : pts >= 70 ? 'B' : pts >= 55 ? 'C' : 'D';
    gradeCalc = { avg: Math.round(avgScore ?? 0), dist_penalty: 0, quality_penalty: 0, pts: Math.round(pts) };
  }

  const days: Review['days'] = [];
  for (let d = from; d <= to; d = new Date(Date.parse(d) + 86400_000).toISOString().slice(0, 10)) {
    const day = runs.filter((r) => r.date === d);
    const main = day.filter((r) => r.role !== 'warmup' && r.role !== 'cooldown').sort((a, b) => b.distance_m - a.distance_m)[0] ?? null;
    const pk = plans.filter((p) => p.date === d && p.type !== 'rest').reduce((a, p) => a + (p.distance_m ?? 0), 0) / 1000;
    days.push({ date: d, km: Math.round(day.reduce((a, r) => a + r.distance_m, 0) / 100) / 10, runs: day.length, plan_km: Math.round(pk * 10) / 10, main_type: main?.type ?? null, score: main?.score ?? null });
  }
  // 練習の内訳
  const bk = new Map<string, { runs: number; km: number }>();
  for (const r of runs) { const g = kindGroup(r.type, r.role, r.distance_m / 1000); const x = bk.get(g) ?? { runs: 0, km: 0 }; x.runs++; x.km += r.distance_m / 1000; bk.set(g, x); }
  const breakdown = ['point', 'long', 'easy', 'race', 'free', 'link'].filter((k) => bk.has(k)).map((k) => ({ key: k, label: KIND_LABEL[k], runs: bk.get(k)!.runs, km: Math.round(bk.get(k)!.km * 10) / 10 }));
  // 次の期間への提案 (週・月)。事実 (距離・ポイント練・レース) から決める
  const nextPeriod: string[] = [];
  if (kind !== 'day') {
    const nextRace = ctx.races.filter((r) => r.priority !== 'C' && r.date > to).sort((a, b) => a.date.localeCompare(b.date))[0];
    const daysTo = nextRace ? dd(to, nextRace.date) : null;
    if (nextRace && daysTo != null && daysTo <= 7) nextPeriod.push(`${nextRace.date.slice(5).replace('-', '/')} は${nextRace.name}。距離を減らし、疲れを抜くことと当日の準備を優先する。`);
    else if (nextRace && daysTo != null && daysTo <= 21) nextPeriod.push(`${nextRace.name}まで ${daysTo} 日。距離は増やさず、目標ペースの練習で感覚を確かめる。`);
    if (!inProgress && completion != null && completion > 1.15 && !phase) nextPeriod.push(`計画より ${Math.round((completion - 1) * 100)}% 多く走った。次は計画どおりの距離に戻す。`);
    if (!inProgress && completion != null && completion < 0.8 && !phase) nextPeriod.push('計画より少なかった。取り戻そうとして一度に増やさず、計画どおりに戻す。');
    if (!inProgress && delta != null && delta > 20 && !phase) nextPeriod.push(`前の${kind === 'week' ? '週' : '月'}より ${Math.round(delta)}% 増えた。次は据え置きか、1〜2 割減らす。`);
    if (quality.planned > quality.done && !inProgress) nextPeriod.push('できなかったポイント練は、詰め込まずに次の枠で。');
    if (!nextPeriod.length && runs.length) nextPeriod.push('今の流れを保ち、計画どおりに進める。');
  }
  return {
    tl: runs.reduce((a, r) => a + (r.tl ?? 0), 0),
    days,
    breakdown,
    next_period: nextPeriod,
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
    grade_calc: gradeCalc,
    in_progress: inProgress,
    phase,
    phase_note: phaseNote,
    parts,
    due_km: Math.round(dueAdj * 10) / 10,
    race_km: Math.round(raceKm * 10) / 10,
    comments,
    next,
    list: [...runs].sort((a, b) => (a.date < b.date ? 1 : -1)),
  };
}

export const paceText = (s: number | null) => (s == null ? '-' : fmtPace(s));
