import { fmtPace, fmtDuration } from './format';
import type { Series } from './strava';

/** 1km ごとのラップ */
export interface Split {
  km: number;
  time_s: number;
  pace_s: number | null;
  hr: number | null;
}

export interface ReviewIn {
  score: number;
  sub: { pace?: number | null; hr?: number | null; form?: number | null };
  main: { distance_m: number; moving_time_s: number; avg_hr: number | null; max_hr: number | null };
  parts: { role: string | null; distance_m: number; moving_time_s: number; avg_hr: number | null }[];
  splits: Split[];
  series: Series | null;
  lthr: number;
  max_hr: number;
  band: { min: number; max: number } | null;
  race: { name: string; date: string; goal_time_s: number | null; distance_m: number } | null;
  today: string;
  rpe: number | null; // 1 かなり余裕 / 2 余裕 / 3 ややきつい / 4 かなりきつい
}

export interface RunReview {
  grade: string;
  headline: string;
  race: { name: string; goal: string; need_pace: string | null; days: number } | null;
  rows: [string, string][];
  pace: { title: string; laps: (number | null)[]; first_avg: number | null; last_avg: number | null; first_n: number; chips: [string, string, string][]; text: string[] } | null;
  hr: { title: string; rows: [string, number][]; text: string[] } | null;
  form: { title: string; stats: [string, string, string][]; text: string[] } | null;
  verdict: { title: string; text: string[]; table: [string, string][] } | null;
}

const RPE_LABEL = ['', 'かなり余裕あり', '余裕あり', 'ややきつい', 'かなりきつい'];

export function gradeOf(score: number): string {
  return score >= 95 ? 'A+' : score >= 90 ? 'A' : score >= 85 ? 'A−' : score >= 80 ? 'B+' : score >= 75 ? 'B' : score >= 70 ? 'B−' : score >= 60 ? 'C' : 'D';
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sec = (n: number) => `${Math.round(n)}秒`;
const mmss = (n: number) => `${Math.floor(n / 60)}'${String(Math.round(n % 60)).padStart(2, '0')}"`;

export function buildRunReview(i: ReviewIn): RunReview {
  const avgPace = i.main.moving_time_s / (i.main.distance_m / 1000);
  const daysLeft = i.race ? Math.round((Date.parse(i.race.date) - Date.parse(i.today)) / 86400_000) : null;
  const raceKm = i.race ? i.race.distance_m / 1000 : null;
  const goalPace = i.race?.goal_time_s && raceKm ? i.race.goal_time_s / raceKm : null;
  const isMarathon = !!i.race && i.race.distance_m >= 40000;

  // ---- 総合評価
  const good: string[] = [];
  if ((i.sub.pace ?? 0) >= 85) good.push('ペース');
  if ((i.sub.form ?? 0) >= 80) good.push('フォーム');
  if ((i.sub.hr ?? 100) >= 80) good.push('心拍');
  const bad = (i.sub.hr ?? 100) < 70 ? '心拍に注意' : (i.sub.pace ?? 100) < 70 ? 'ペースにばらつき' : '';
  const headline = good.length ? `${good.join('・')}は良好${bad ? `。${bad}` : ''}` : bad || '内容を確認しましょう';

  const rows: [string, string][] = [];
  const NAME: Record<string, string> = { warmup: 'アップ', work: 'メイン', cooldown: 'ダウン' };
  if (i.parts.length > 1) {
    for (const p of i.parts) rows.push([NAME[p.role ?? ''] ?? '走行', `${(p.distance_m / 1000).toFixed(2)}km ・ ${mmss(p.moving_time_s / (p.distance_m / 1000))}/km`]);
  }
  rows.push([i.parts.length > 1 ? 'メイン平均心拍' : '平均心拍', i.main.avg_hr ? `${Math.round(i.main.avg_hr)}bpm` : '-']);
  if (i.main.max_hr) rows.push([i.parts.length > 1 ? 'メイン最大心拍' : '最大心拍', `${Math.round(i.main.max_hr)}bpm`]);
  if (i.series?.avg.cad) rows.push(['ピッチ', `${i.series.avg.cad}spm`]);
  if (i.series?.avg.stride) rows.push(['ストライド', `${i.series.avg.stride}cm`]);

  // ---- 後半の走り (ラップ推移)
  const laps = i.splits.filter((s) => s.pace_s && s.km >= 0.95);
  let pace: RunReview['pace'] = null;
  let diff = 0;
  if (laps.length >= 4) {
    const n = laps.length;
    const lastN = Math.max(2, Math.round(n / 3));
    const first = laps.slice(0, n - lastN), last = laps.slice(n - lastN);
    const fa = mean(first.map((s) => s.pace_s!)), la = mean(last.map((s) => s.pace_s!));
    diff = fa - la;
    const spread = Math.max(...first.map((s) => s.pace_s!)) - Math.min(...first.map((s) => s.pace_s!));
    const fast = laps.reduce((a, b) => (b.pace_s! < a.pace_s! ? b : a));
    const fastIdx = laps.indexOf(fast) + 1;
    const text: string[] = [];
    text.push(`最初の${first.length}kmは ${mmss(fa)}/km 前後で、${spread <= 6 ? 'ほぼ一定' : `最大 ${sec(spread)} のばらつき`}。`);
    if (diff >= 5) text.push(`${first.length + 1}km 以降は ${sec(diff)}/km ペースアップ (ネガティブスプリット)。${fastIdx > first.length ? `${fastIdx}km目には ${mmss(fast.pace_s!)} まで上がっている。` : ''}`);
    else if (diff <= -5) text.push(`後半は ${sec(-diff)}/km 落ちている。後半の粘りが課題。`);
    else text.push('後半もペースはほぼ変わらず、終始一定で走れている。');
    if (i.band) {
      const dev = avgPace < i.band.min - 3 ? `${sec(i.band.min - avgPace)} 速い` : avgPace > i.band.max + 3 ? `${sec(avgPace - i.band.max)} 遅い` : '範囲内';
      text.push(`メイン平均 ${mmss(avgPace)}/km は、計画 ${mmss(i.band.min)}〜${mmss(i.band.max)} に対して ${dev}。`);
    }
    if (diff >= 8 && goalPace && la < goalPace - 3) text.push('ここにスピードの余裕が感じられる。ただし、この距離での余裕と、レース距離を維持する力は別なので慎重に判断したい。');
    pace = {
      title: diff >= 5 ? '一番良かったのは後半の走り' : diff <= -5 ? '後半にペースが落ちている' : 'ペースは安定している',
      laps: laps.map((s) => s.pace_s),
      first_avg: Math.round(fa), last_avg: Math.round(la), first_n: first.length,
      chips: [[`1〜${first.length}km 平均`, `${mmss(fa)}/km`, spread <= 6 ? '安定した巡航' : 'ばらつきあり'], [`${first.length + 1}〜${n}km 平均`, `${mmss(la)}/km`, diff >= 5 ? `約${Math.round(diff)}秒/km ペースアップ` : diff <= -5 ? `約${Math.round(-diff)}秒/km ダウン` : '変化なし']],
      text,
    };
  }

  // ---- 心拍
  let hr: RunReview['hr'] = null;
  const hrLaps = laps.filter((s) => s.hr);
  if (hrLaps.length >= 4 && i.main.avg_hr) {
    const n = hrLaps.length;
    const idx = [...new Set([2, Math.round(n * 0.4), Math.round(n * 0.65), n - 2, n - 1, n])].filter((x) => x >= 1 && x <= n).sort((a, b) => a - b);
    const rows2: [string, number][] = idx.map((k) => [`${k}km`, hrLaps[k - 1].hr!]);
    const avg = i.main.avg_hr, lastHr = hrLaps[n - 1].hr!;
    const text: string[] = [];
    text.push(`最大心拍数 ${i.max_hr}bpm を基準にすると、平均 ${Math.round(avg)}bpm は約 ${Math.round((avg / i.max_hr) * 100)}%、終盤 ${lastHr}bpm は約 ${Math.round((lastHr / i.max_hr) * 100)}%。閾値心拍 ${i.lthr}bpm 比では平均 ${Math.round((avg / i.lthr) * 100)}%。`);
    const mid = hrLaps.slice(Math.floor(n * 0.3), Math.floor(n * 0.7)).map((s) => s.hr!);
    if (mid.length >= 2 && Math.max(...mid) - Math.min(...mid) <= 5) text.push(`中盤は ${Math.round(mean(mid))}bpm 前後で安定していて悪くない。`);
    const rise = lastHr - hrLaps[1].hr!;
    if (diff >= 5 && rise > 3) text.push(`終盤に心拍が上昇しているのは、ペースアップの影響もあるため、心拍ドリフトだけで持久力不足とは判断できない。`);
    else if (rise > 6) text.push(`ペースがほぼ同じで心拍が +${rise}bpm 上がっている (ドリフト)。暑さ・疲労・水分の影響も考えたい。`);
    if (i.series) {
      const tot = i.series.hr_zone_s.reduce((a, b) => a + b, 0) || 1;
      const th = Math.round((i.series.hr_zone_s[3] / tot) * 100), pw = Math.round((i.series.hr_zone_s[2] / tot) * 100);
      text.push(`心拍ゾーンでは、閾値ゾーンに ${th}%、有酸素パワーに ${pw}%。`);
    }
    const ratio = avg / i.lthr;
    if (goalPace && isMarathon && ratio >= 0.93 && Math.abs(avgPace - goalPace) <= 10) text.push(`平均心拍 ${Math.round(avg)} は、フルマラソンの序盤から維持するには少し慎重になりたい数値。本番では、目標ペースを走るのにどれくらいの負荷がかかっているかが重要になる。`);
    if (i.rpe) text.push(`主観は「${RPE_LABEL[i.rpe]}」。${i.rpe <= 2 && ratio >= 0.93 ? '心拍が高めでも楽に感じられていたのは好材料。' : i.rpe >= 3 && ratio >= 0.93 ? '心拍も高く、きつさも感じていたので、疲労が残っていないか注意。' : i.rpe >= 3 ? '心拍のわりにきつく感じていたので、体調や疲労を確認したい。' : ''}`);
    hr = { title: ratio >= 0.97 ? '心拍数は高め' : ratio >= 0.93 ? '心拍数はやや高め' : ratio >= 0.85 ? '心拍数は想定の範囲内' : '心拍数は余裕あり', rows: rows2, text };
  }

  // ---- フォーム
  let form: RunReview['form'] = null;
  const sr = i.series;
  if (sr && sr.cad.some((v) => v) && sr.avg.cad) {
    const third = (a: (number | null)[], from: number, to: number) => {
      const xs = a.slice(Math.floor(a.length * from), Math.floor(a.length * to)).filter((v): v is number => v != null);
      return xs.length ? mean(xs) : null;
    };
    const c1 = third(sr.cad, 0.1, 0.4), c2 = third(sr.cad, 0.7, 1);
    const s1 = third(sr.stride, 0.1, 0.4), s2 = third(sr.stride, 0.7, 1);
    const dc = c1 != null && c2 != null ? c2 - c1 : 0, ds = s1 != null && s2 != null ? s2 - s1 : 0;
    const stable = Math.abs(dc) <= 3 && Math.abs(ds) <= 4;
    const text: string[] = [];
    text.push(stable ? 'ピッチ・ストライドとも、走り出しから終盤まで大きな乱れが小さい。' : `終盤は ピッチ ${dc >= 0 ? '+' : ''}${Math.round(dc)}spm、ストライド ${ds >= 0 ? '+' : ''}${Math.round(ds)}cm の変化。`);
    if (diff >= 5) text.push(`終盤にペースを上げても、ピッチ ${dc >= 0 ? '+' : ''}${Math.round(dc)}spm・ストライド ${ds >= 0 ? '+' : ''}${Math.round(ds)}cm と、${stable ? '大きな乱れは見られない' : '変化がある'}。`);
    if (sr.avg.cad < 176) text.push(`平均ピッチ ${sr.avg.cad}spm は目標の 180 をやや下回る。`);
    text.push('フォームの数値が良いことだけでは、42km 後半の脚持ちまで保証はできない。');
    form = {
      title: stable ? 'フォームは安定している' : 'フォームに変化がある',
      stats: [['平均ピッチ', String(sr.avg.cad), 'spm'], ...(sr.avg.stride ? [['平均ストライド', String(sr.avg.stride), 'cm'] as [string, string, string]] : []), ...(sr.max.cad ? [['最大ピッチ', String(sr.max.cad), 'spm'] as [string, string, string]] : [])],
      text: isMarathon ? text : text.slice(0, -1),
    };
  }

  // ---- レースに向けた判断
  let verdict: RunReview['verdict'] = null;
  if (i.race && daysLeft != null && daysLeft >= 0 && daysLeft <= 60) {
    const text: string[] = [];
    text.push(daysLeft === 0 ? '今日がレース当日。' : `${i.race.name}まであと ${daysLeft}日。`);
    if (goalPace) {
      const gap = goalPace - avgPace; // 正 = 目標より速い
      const speedOk = (diff >= 5 ? mean(laps.slice(-Math.max(2, Math.round(laps.length / 3))).map((s) => s.pace_s!)) : avgPace) <= goalPace + 2;
      text.push(speedOk ? `今回のメインを見る限り、目標 ${fmtDuration(i.race.goal_time_s)} に必要なスピードは十分にある (メイン平均は目標ペースより ${gap >= 0 ? sec(gap) + ' 速い' : sec(-gap) + ' 遅い'})。` : `メイン平均は目標ペース ${mmss(goalPace)} より ${sec(avgPace - goalPace)} 遅い。まだスピードを詰める余地がある。`);
      if (isMarathon) text.push(`課題は、${mmss(goalPace)}/km を ${raceKm!.toFixed(3).replace(/\.?0+$/, '')}km 維持できるかどうか。`);
    }
    if (daysLeft <= 10) text.push('この期間はもう走力を上げようとする必要はない。ここからは疲労を抜き、脚をフレッシュにすることを最優先にしたい。');
    const table: [string, string][] = [];
    if (goalPace && isMarathon) {
      const r = (a: number, b: number) => `${mmss(goalPace + a)}〜${mmss(goalPace + b)}`;
      table.push(['0〜5km', r(3, 5)], ['5〜15km', r(-1, 1)], ['15〜30km', r(-2, 0)], ['30km以降', '余裕があれば維持・微増速']);
      text.push('現時点では、このような組み立てが良いと思う。');
    }
    verdict = { title: `${i.race.name}に向けた判断`, text, table };
  }

  return {
    grade: gradeOf(i.score),
    headline,
    race: i.race && daysLeft != null && daysLeft >= 0 ? { name: i.race.name, goal: fmtDuration(i.race.goal_time_s), need_pace: goalPace ? `約 ${mmss(goalPace)}/km` : null, days: daysLeft } : null,
    rows, pace, hr, form, verdict,
  };
}

export { fmtPace };
