/**
 * ランの分析 (客観データ + 主観評価)。
 * 1. 練習達成度 (計画どおりにできたか) と 走力評価 (どれだけ余裕を持って・最後まで走れたか) を分けて出す
 * 2. ペースと心拍の連動 (一定ペース区間の心拍ドリフト・ペースを上げたときの心拍の反応)
 * 3. 似た条件の過去のランとの比較 (改善・維持・低下)
 * 4. フォームの前半・後半の変化と、ペースアップがピッチ・ストライドのどちらによるものか
 * データが足りない項目は数値にせず「保留」にして、理由を書く。
 */
import type { Fb } from './runreview';
import type { Series } from './strava';

export type Judge = 'good' | 'ok' | 'bad' | 'hold';
export interface AItem { key: string; label: string; score: number | null; judge: Judge; value: string; reason: string }
export interface Snapshot {
  id: number; date: string; km: number; pace: number; hr: number | null; group: string;
  rpe: number | null; half_diff: number | null; cad: number | null; stride: number | null;
  gct: number | null; vo: number | null; power: number | null; elev_per_km: number | null; drift: number | null;
  /** 走った時間の気温 (℃) */ temp?: number | null;
}
/** trend: up=改善 / same=維持 / down=低下 / ref=良し悪しを決めない参考 (ピッチ・ストライドなど) / hold=保留 */
export interface CompareMetric { key: string; label: string; now: string; past: string; diff: string; trend: 'up' | 'same' | 'down' | 'ref' | 'hold'; note?: string }
export interface ReadyRow { label: string; judge: Judge; value: string; reason: string }
export interface Analysis {
  /** 最初に出す 3 つ: 総合評価・最も重要な発見・次に活かすこと */
  top: { overall: string; finding: string; next: string };
  /** 点数の意味 (何を評価した点か) */
  defs: { key: string; label: string; text: string }[];
  /** 総評 (1〜2 文) */
  summary: string;
  /** 数値の出どころ (運動時間・評価区間・記録元) */
  basis: string[];
  /** 目標ペース帯より速かったときの、事実と影響の切り分け */
  overpace: { fact: string; rows: ReadyRow[]; verdict: string } | null;
  /** 大会直前 (14 日以内) の準備状態 */
  ready: { race: string; days: number; rows: ReadyRow[]; note: string } | null;
  /** 主観と客観の照らし合わせ */
  subj: { text: string; kind: 'match' | 'gap' | 'fact' }[];
  /** 次に活かすこと */
  next: string[];
  achievement: { score: number | null; items: AItem[]; hold_reason?: string };
  fitness: { score: number | null; items: AItem[]; hold_reason?: string };
  good: string[];
  issues: string[];
  hrpace: { steady: { from_km: number; to_km: number } | null; drift_pct: number | null; response: number | null; text: string[] } | null;
  compare: { n: number; runs: { id: number; date: string; km: number; pace: number; hr: number | null }[]; metrics: CompareMetric[]; notes: string[] } | null;
  form: { rows: { label: string; first: string; second: string; diff: string; flag: boolean }[]; paceup: string | null; text: string[] } | null;
  snapshot: Snapshot;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const nums = (xs: (number | null | undefined)[]) => xs.filter((x): x is number => x != null && Number.isFinite(x));
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const clamp = (x: number) => Math.max(0, Math.min(100, x));
const judgeOf = (s: number | null): Judge => (s == null ? 'hold' : s >= 80 ? 'good' : s >= 60 ? 'ok' : 'bad');

/** 練習の種類のまとまり (比較はこの中で) */
export function groupOf(type: string | null | undefined, pace: number, easyMin: number): string {
  if (type === 'interval') return 'interval';
  if (type === 'race') return 'race';
  // ロング走の計画の中の M ペース区間など: 距離ではなくペースで見る (Easy より 10 秒以上速ければポイント練)
  if (type === 'long') return pace < easyMin - 10 ? 'tempo' : 'long';
  if (type === 'm' || type === 'lt') return 'tempo';
  if (type === 'easy' || type === 'jog') return 'easy';
  return pace < easyMin - 10 ? 'tempo' : 'easy';
}

const snapshotElev = (i: { elev_gain: number | null }, km: number) => (i.elev_gain != null && km > 0 ? i.elev_gain / km : null);
const RESERVE_SCORE: Record<string, number> = { limit: 30, '1-3': 45, '3-5': 65, '5-10': 80, '10+': 92 };
const RESERVE_TXT: Record<string, string> = { limit: 'ほぼ限界', '1-3': 'あと 1〜3km', '3-5': 'あと 3〜5km', '5-10': 'あと 5〜10km', '10+': 'あと 10km 以上' };

export interface AnalysisIn {
  id: number; date: string; distance_m: number; moving_time_s: number; avg_hr: number | null; avg_cad_spm: number | null;
  elev_gain: number | null;
  /** 走った時間の気温 (℃) */ temp?: number | null;
  ev: any | null; plan_type: string | null; has_plan: boolean;
  fb: Fb | null; series: Series | null; easy_min: number; lthr: number;
  past: Snapshot[];
  /** 経過時間 (秒)。運動時間と違えば書き分ける */ elapsed_time_s?: number | null;
  /** 記録元 (COROS / Strava) */ source?: string | null;
  /** 次の大会 (このランの日から見て) */ race?: { name: string; date: string; goal_s: number | null; distance_m: number; days: number } | null;
  /** この日・翌朝の体調 (cond:) */ cond?: { leg?: number | null; tight?: number | null; pain?: number | null; sleep?: number | null; fatigue?: number | null } | null;
}

const RACE_TYPES = ['m', 'lt', 'race', 'interval'];

export function analyzeRun(i: AnalysisIn): Analysis {
  const pace = i.moving_time_s / (i.distance_m / 1000);
  const km = i.distance_m / 1000;
  const group = groupOf(i.ev?.eff_type ?? i.ev?.type ?? i.plan_type, pace, i.easy_min);
  const sr = i.series;
  const ev = i.ev;

  // ---------------- ペースと心拍の連動
  let hrpace: Analysis['hrpace'] = null;
  let drift: number | null = null;
  if (sr && sr.hr.some((v) => v) && sr.pace.some((v) => v)) {
    const n = sr.d.length;
    const start = Math.floor(n * 0.12); // 走り始めは心拍が上がる途中なので除く
    const ps = nums(sr.pace.slice(start));
    const med = median(ps);
    // 中央値 ±3% のペースが続く一番長い区間 = 一定ペース区間
    let best: [number, number] | null = null, a = -1, gap = 0;
    for (let k = start; k <= n; k++) {
      const p = k < n ? sr.pace[k] : null;
      const ok = p != null && Math.abs(p - med) / med <= 0.03 && sr.hr[k] != null;
      if (ok) { if (a < 0) a = k; gap = 0; }
      else if (a >= 0) {
        gap++;
        if (gap > 2 || k === n) { const b = k - gap; if (!best || b - a > best[1] - best[0]) best = [a, b]; a = -1; gap = 0; }
      }
    }
    const text: string[] = [];
    let steady: { from_km: number; to_km: number } | null = null;
    if (best && sr.d[best[1]] - sr.d[best[0]] >= Math.max(3, km * 0.3)) {
      const [s0, s1] = best;
      steady = { from_km: Math.round(sr.d[s0] * 10) / 10, to_km: Math.round(sr.d[s1] * 10) / 10 };
      const mid = Math.floor((s0 + s1) / 2);
      const eff = (from: number, to: number) => {
        const idx = Array.from({ length: to - from + 1 }, (_, k) => from + k).filter((k) => sr.hr[k] != null && sr.pace[k] != null);
        return mean(idx.map((k) => sr.hr[k]! * (sr.pace[k]! / med))); // ペースの小さな違いを補正した心拍
      };
      const h1 = eff(s0, mid), h2 = eff(mid + 1, s1);
      drift = Number.isFinite(h1) && Number.isFinite(h2) && h1 > 0 ? Math.round(((h2 - h1) / h1) * 1000) / 10 : null;
      if (drift != null) text.push(`${steady.from_km}〜${steady.to_km}km はペースが一定 (${mmss(med)}/km 前後)。この区間の心拍ドリフトは ${drift >= 0 ? '+' : ''}${drift}% (${Math.round(h1)} → ${Math.round(h2)}bpm 相当)。${drift <= 3 ? '心拍は安定していて、有酸素の持久力は十分。' : drift <= 5 ? 'やや上昇。長い距離では序盤を少し抑えたい。' : '後半の上昇が大きい。暑さ・補給・疲労などが考えられる (推測。1 本だけでは原因は決められない)。'}`);
    } else {
      text.push('ペースが一定の区間が短いため、心拍ドリフトは判断を保留します (意図的なペース変化と区別するため)。');
    }
    // ペースを上げたときの心拍の反応 (1km ごとの平均ペースと心拍の関係)
    const kmPts: { p: number; h: number }[] = [];
    for (let k = 1; k <= Math.floor(km); k++) {
      const idx = sr.d.map((d, j) => (d > k - 1 && d <= k ? j : -1)).filter((j) => j >= 0 && sr.pace[j] != null && sr.hr[j] != null);
      if (idx.length >= 3) kmPts.push({ p: mean(idx.map((j) => sr.pace[j]!)), h: mean(idx.map((j) => sr.hr[j]!)) });
    }
    let response: number | null = null;
    const usable = kmPts.slice(1);
    if (usable.length >= 4 && Math.max(...usable.map((x) => x.p)) - Math.min(...usable.map((x) => x.p)) >= 10) {
      const mp = mean(usable.map((x) => x.p)), mh = mean(usable.map((x) => x.h));
      const cov = mean(usable.map((x) => (x.p - mp) * (x.h - mh))), vp = mean(usable.map((x) => (x.p - mp) ** 2));
      response = vp > 0 ? Math.round((-cov / vp) * 10 * 10) / 10 : null; // 10 秒/km 速くなったときの心拍の増え方
      if (response != null && Number.isFinite(response) && response > 0) text.push(`ペースを 10 秒/km 上げると、心拍は約 +${response}bpm (1km ごとのペースと心拍から)。${response <= 4 ? '速くしても心拍の上がり方が小さく、余裕がある。' : response <= 8 ? '標準的な反応。' : '速くすると心拍が大きく上がる (この 1 本からの目安)。'}`);
    }
    hrpace = { steady, drift_pct: drift, response, text };
  }

  // ---------------- フォーム (前半・後半の変化、ペースアップの中身)
  let form: Analysis['form'] = null;
  if (sr && sr.cad.some((v) => v)) {
    const half = (arr: (number | null)[], second: boolean) => {
      const n = arr.length, s = Math.floor(n * 0.1), m = Math.floor(n / 2);
      return mean(nums(second ? arr.slice(m) : arr.slice(s, m)));
    };
    const X = sr.extra || ({} as Series['extra']);
    const defs: [string, (number | null)[] | undefined, string, number, number][] = [
      ['ピッチ', sr.cad, 'spm', 0, 3], ['ストライド', sr.stride, 'cm', 0, 4],
      ['接地時間', X.gct?.vals, 'ms', 0, 8], ['上下動', X.vo?.vals, 'cm', 1, 0.5], ['垂直歩幅比', X.vr?.vals, '%', 1, 0.4], ['パワー', X.power?.vals, 'W', 0, 10],
    ];
    const rows: NonNullable<Analysis['form']>['rows'] = [];
    for (const [label, arr, unit, dig, thr] of defs) {
      if (!arr || !arr.some((v) => v)) continue;
      const f = half(arr, false), s = half(arr, true);
      if (!Number.isFinite(f) || !Number.isFinite(s)) continue;
      const d = s - f, r = 10 ** dig;
      rows.push({ label, first: `${Math.round(f * r) / r}${unit}`, second: `${Math.round(s * r) / r}${unit}`, diff: `${d >= 0 ? '+' : ''}${Math.round(d * r) / r}`, flag: Math.abs(d) > thr });
    }
    const text: string[] = [];
    const changed = rows.filter((x) => x.flag);
    text.push(changed.length ? `後半は ${changed.map((x) => `${x.label} ${x.diff}`).join('・')} の変化。${i.ev?.pace?.details?.half_diff_s != null && i.ev.pace.details.half_diff_s < -3 ? '後半にペースを上げたことによる変化の可能性 (推測)。' : '疲れによるフォームの変化の可能性 (推測)。'}` : '前半と後半でフォームの数値に大きな変化はない。');
    // ペースアップの中身: 速い区間 (上位 20%) と、ふだんの区間 (中央 50%) のピッチ・ストライドの差
    let paceup: string | null = null;
    const idx = sr.pace.map((p, k) => ({ p, k })).filter((x) => x.p != null && sr.cad[x.k] != null && sr.stride[x.k] != null).sort((a, b) => a.p! - b.p!);
    if (idx.length >= 20) {
      const fast = idx.slice(0, Math.floor(idx.length * 0.2)), mid = idx.slice(Math.floor(idx.length * 0.25), Math.floor(idx.length * 0.75));
      const dp = mean(mid.map((x) => x.p!)) - mean(fast.map((x) => x.p!));
      if (dp >= 8) {
        const cm = mean(mid.map((x) => sr.cad[x.k]!)), cf = mean(fast.map((x) => sr.cad[x.k]!));
        const sm = mean(mid.map((x) => sr.stride[x.k]!)), sf = mean(fast.map((x) => sr.stride[x.k]!));
        const rc = (cf - cm) / cm, rs = (sf - sm) / sm;
        paceup = `速い区間 (ふだんより ${Math.round(dp)} 秒/km 速い) では、ピッチ ${rc >= 0 ? '+' : ''}${Math.round(rc * 1000) / 10}%・ストライド ${rs >= 0 ? '+' : ''}${Math.round(rs * 1000) / 10}%。${rs > rc * 1.5 ? '主にストライドを伸ばしてペースを上げている。' : rc > rs * 1.5 ? '主にピッチを上げてペースを上げている。' : 'ピッチとストライドの両方で上げている。'}`;
        text.push(paceup);
      }
    }
    text.push('ピッチやストライドに決まった理想値は置かず、自分の過去のデータと走った感覚で見ます。');
    form = { rows, paceup, text };
  }

  // ---------------- この走りの要約 (過去との比較用に保存する)
  const X = sr?.extra;
  const snapshot: Snapshot = {
    id: i.id, date: i.date, km: Math.round(km * 100) / 100, pace: Math.round(pace), hr: i.avg_hr ? Math.round(i.avg_hr) : null, group,
    rpe: i.fb?.rpe ?? null, half_diff: ev?.pace?.details?.half_diff_s ?? null,
    cad: sr?.avg.cad ?? (i.avg_cad_spm ? Math.round(i.avg_cad_spm * 2) : null), stride: sr?.avg.stride ?? null,
    gct: X?.gct?.avg ?? null, vo: X?.vo?.avg ?? null, power: X?.power?.avg ?? null,
    elev_per_km: i.elev_gain != null && km > 0 ? Math.round((i.elev_gain / km) * 10) / 10 : null, drift, temp: i.temp ?? null,
  };

  // ---------------- 過去との比較 (同じまとまり・距離と ペースが近いもの)
  let compare: Analysis['compare'] = null;
  const sim = i.past
    .filter((p) => p.id !== i.id && p.group === group && p.km >= km * 0.6 && p.km <= km * 1.6 && Math.abs(p.pace - pace) <= 25)
    .map((p) => ({ p, d: Math.abs(Math.log(p.km / km)) * 60 + Math.abs(p.pace - pace) + (i.temp != null && p.temp != null ? Math.max(0, Math.abs(p.temp - i.temp) - 3) * 2 : 4) + (snapshotElev(i, km) != null && p.elev_per_km != null ? Math.max(0, Math.abs(p.elev_per_km - snapshotElev(i, km)!) - 5) : 0) }))
    .sort((a, b) => a.d - b.d).slice(0, 6).map((x) => x.p);
  if (sim.length >= 2) {
    const metrics: CompareMetric[] = [];
    const notes: string[] = [];
    const speed = 1000 / pace;
    // 同じペースでの心拍: 過去の心拍を今回のペースに合わせて補正 (心拍 ∝ 速さ とみなす)
    const adj = nums(sim.map((p) => (p.hr ? p.hr * (speed / (1000 / p.pace)) : null)));
    if (i.avg_hr && adj.length >= 2) {
      const pm = median(adj), d = i.avg_hr - pm;
      metrics.push({ key: 'hr_at_pace', label: '同じペースでの心拍', now: `${Math.round(i.avg_hr)}bpm`, past: `${Math.round(pm)}bpm`, diff: `${d >= 0 ? '+' : ''}${Math.round(d)}`, trend: d <= -2 ? 'up' : d >= 3 ? 'down' : 'same' });
    }
    const add = (key: keyof Snapshot, label: string, unit: string, better: 'low' | 'high', thr: number, now: number | null | undefined, dig = 0) => {
      const ps = nums(sim.map((p) => p[key] as number | null));
      if (now == null || ps.length < 2) return;
      const pm = median(ps), d = now - pm, r = 10 ** dig;
      const trend: CompareMetric['trend'] = Math.abs(d) < thr ? 'same' : (better === 'low' ? d < 0 : d > 0) ? 'up' : 'down';
      metrics.push({ key, label, now: `${Math.round(now * r) / r}${unit}`, past: `${Math.round(pm * r) / r}${unit}`, diff: `${d >= 0 ? '+' : ''}${Math.round(d * r) / r}`, trend });
    };
    add('rpe', '主観のきつさ', '/10', 'low', 1, i.fb?.rpe ?? null);
    add('half_diff', '後半の失速 (秒/km)', '', 'low', 3, snapshot.half_diff);
    add('drift', '心拍ドリフト', '%', 'low', 1.5, drift, 1);
    // ピッチ・ストライド・接地時間・パワーは、増えた・減ったに良し悪しを決めない (走り方の違いとして見る)
    const ref = (key: keyof Snapshot, label: string, unit: string, now: number | null | undefined) => {
      const ps = nums(sim.map((p) => p[key] as number | null));
      if (now == null || ps.length < 2) return;
      const pm = median(ps), d = now - pm;
      metrics.push({ key, label, now: `${Math.round(now)}${unit}`, past: `${Math.round(pm)}${unit}`, diff: `${d >= 0 ? '+' : ''}${Math.round(d)}`, trend: 'ref' });
    };
    ref('cad', 'ピッチ', 'spm', snapshot.cad);
    ref('stride', 'ストライド', 'cm', snapshot.stride);
    ref('gct', '接地時間', 'ms', snapshot.gct);
    ref('power', 'ランニングパワー', 'W', snapshot.power);
    const ep = nums(sim.map((p) => p.elev_per_km));
    if (snapshot.elev_per_km != null && ep.length && Math.abs(snapshot.elev_per_km - median(ep)) >= 8) notes.push(`今回は 1km あたりの上り ${snapshot.elev_per_km}m で、比べたランの ${median(ep)}m と坂の条件が違います。`);
    const kmGap = Math.abs(mean(sim.map((p) => p.km)) - km) / km;
    if (kmGap > 0.3) notes.push('比べたランとは距離が 3 割以上違うので、参考程度に。');
    const ts = nums(sim.map((p) => p.temp));
    if (i.temp == null || ts.length < 2) notes.push('気温が分からないランがあるため、気温の条件はそろえきれていません (暑い日は心拍が高めに出ます)。');
    else if (Math.abs(i.temp - median(ts)) >= 5) notes.push(`今回は ${Math.round(i.temp)}℃、比べたランは ${Math.round(median(ts))}℃ 前後。気温差があるので心拍の比較は参考程度に (暑いほど高く出ます)。`);
    else notes.push(`気温は今回 ${Math.round(i.temp)}℃・比べたラン ${Math.round(median(ts))}℃ 前後で、条件は近い。`);
    compare = { n: sim.length, runs: sim.map((p) => ({ id: p.id, date: p.date, km: p.km, pace: p.pace, hr: p.hr, temp: p.temp ?? null })), metrics, notes };
  }

  // ---------------- 練習達成度 (計画に対して)
  const ach: AItem[] = [];
  let achHold: string | undefined;
  if (!i.has_plan || !ev || ev.type === 'free') achHold = '計画が登録されていないランなので、達成度は評価保留 (走力評価だけ見ます)。';
  else {
    const w = ev.weights || {};
    const it = (key: string, label: string, m: any, wt?: number) => {
      if (!m) return;
      ach.push({ key, label: `${label}${wt ? ` (${wt}%)` : ''}`, score: m.score ?? null, judge: judgeOf(m.score ?? null), value: m.score == null ? '保留' : `${m.score}点`, reason: m.summary || '' });
    };
    it('pace', 'ペース', ev.pace, w.pace); it('hr', '心拍', ev.hr, w.hr); it('cadence', 'ピッチ', ev.cadence, w.cadence); it('form', 'フォーム', ev.form, w.form);
    if (ev.volume?.score != null) ach.push({ key: 'volume', label: '距離 (参考)', score: ev.volume.score, judge: judgeOf(ev.volume.score), value: `${ev.volume.score}点`, reason: ev.volume.summary || '' });
    if (group === 'easy') ach.push({ key: 'easy_note', label: 'ジョグの見方', score: null, judge: 'hold', value: '-', reason: 'ジョグ・イージーは「ゆっくり走れたか」を見ます。決めたペースより遅くても減点しません。' });
  }
  const achScore = achHold ? null : ev?.score ?? null;

  // ---------------- 走力評価 (余裕・後半の維持・効率)
  const fit: AItem[] = [];
  const hrCmp = compare?.metrics.find((m) => m.key === 'hr_at_pace');
  if (hrCmp) {
    const d = Number(hrCmp.diff);
    const sc = clamp(70 - d * 5);
    fit.push({ key: 'eff', label: '同じペースでの心拍 (過去比)', score: Math.round(sc), judge: judgeOf(sc), value: `${hrCmp.diff}bpm`, reason: `似た ${compare!.n} 本のランでは同じペースで ${hrCmp.past}。今回は ${hrCmp.now}。` });
  } else fit.push({ key: 'eff', label: '同じペースでの心拍 (過去比)', score: null, judge: 'hold', value: '保留', reason: '距離・ペース・種類が近い過去のランが 2 本未満。' });
  if (drift != null) {
    const sc = drift <= 3 ? 92 : drift <= 5 ? 75 : drift <= 8 ? 55 : 35;
    fit.push({ key: 'drift', label: '一定ペース区間の心拍ドリフト', score: sc, judge: judgeOf(sc), value: `${drift >= 0 ? '+' : ''}${drift}%`, reason: `${hrpace?.steady?.from_km}〜${hrpace?.steady?.to_km}km。3% 以内なら有酸素の持久力は十分。` });
  } else fit.push({ key: 'drift', label: '一定ペース区間の心拍ドリフト', score: null, judge: 'hold', value: '保留', reason: sr?.hr.some((v) => v) ? 'ペースが一定の区間が短く、意図的なペース変化と区別できない。' : '心拍データなし。' });
  const hd = snapshot.half_diff;
  if (hd != null && km >= 5 && group !== 'interval') {
    const sc = hd <= 0 ? 92 : hd <= 5 ? 80 : hd <= 10 ? 62 : 40;
    fit.push({ key: 'hold', label: '後半のペース維持', score: sc, judge: judgeOf(sc), value: hd <= 0 ? `${-hd}秒/km 上げた` : `${hd}秒/km 落ちた`, reason: '前半と後半の平均ペースの差。' });
  } else fit.push({ key: 'hold', label: '後半のペース維持', score: null, judge: 'hold', value: '保留', reason: km < 5 ? '5km 未満。' : 'インターバルは本数ごとに見るため対象外。' });
  if (i.fb?.reserve) {
    const sc = RESERVE_SCORE[i.fb.reserve] ?? null;
    fit.push({ key: 'reserve', label: '余裕度 (主観)', score: sc, judge: judgeOf(sc), value: RESERVE_TXT[i.fb.reserve] ?? '-', reason: `同じペースをどれだけ続けられそうか${i.fb.rpe != null ? `・きつさ ${i.fb.rpe}/10` : ''}。` });
  } else fit.push({ key: 'reserve', label: '余裕度 (主観)', score: null, judge: 'hold', value: '保留', reason: 'ふりかえりの「あと何km続けられそう」が未入力。' });
  const fChanged = form?.rows.filter((x) => x.flag) ?? [];
  if (form && form.rows.length) {
    const sc = fChanged.length === 0 ? 88 : fChanged.length === 1 ? 70 : 50;
    fit.push({ key: 'form', label: 'フォームの維持', score: sc, judge: judgeOf(sc), value: fChanged.length ? fChanged.map((x) => x.label).join('・') + ' が変化' : '安定', reason: '前半と後半のピッチ・ストライドなどの差。' });
  }
  const scored = fit.filter((x) => x.score != null);
  const fitScore = scored.length >= 2 ? Math.round(mean(scored.map((x) => x.score!))) : null;
  const fitHold = fitScore == null ? `判断できる項目が ${scored.length} つだけなので保留。ふりかえりの入力や、似たランが増えると評価できます。` : undefined;

  // ---------------- 良かった点・課題
  const good: string[] = [], issues: string[] = [];
  for (const x of [...fit, ...ach]) {
    if (x.score == null) continue;
    if (x.score >= 80 && good.length < 3) good.push(`${x.label.replace(/ \(\d+%\)/, '')}: ${x.value}`);
    if (x.score < 60 && issues.length < 3) issues.push(`${x.label.replace(/ \(\d+%\)/, '')}: ${x.value}`);
  }
  if (i.fb?.rpe != null && i.fb.rpe_late != null && i.fb.rpe_late - i.fb.rpe >= 2) issues.push(`後半のきつさ ${i.fb.rpe_late}/10 (全体 ${i.fb.rpe}/10)。後半に余裕がなくなっている`);
  if ((i.fb?.pain ?? 0) >= 3) issues.unshift(`痛み ${i.fb!.pain}/10${i.fb!.pain_part?.length ? ` (${i.fb!.pain_part.join('・')})` : ''}`);

  // ---------------- 主観と客観の照らし合わせ (点数に足すのではなく、合っているか・ずれているかを見る)
  const subj: Analysis['subj'] = [];
  const f = i.fb;
  const hrRatio = i.avg_hr ? i.avg_hr / i.lthr : null;
  const easyish = group === 'easy' || group === 'long';
  if (f && f.rpe != null && hrRatio != null) {
    const hrHigh = hrRatio >= (easyish ? 0.87 : 0.95), hrLow = hrRatio <= (easyish ? 0.8 : 0.88);
    if (f.rpe <= 4 && hrHigh) subj.push({ kind: 'gap', text: `心拍は閾値の ${Math.round(hrRatio * 100)}% と高めなのに、きつさは ${f.rpe}/10。体は負荷を感じていない一方、心拍は上がっている。暑さ・脱水・疲労の可能性 (推測)。` });
    else if (f.rpe >= 7 && hrLow) subj.push({ kind: 'gap', text: `心拍は閾値の ${Math.round(hrRatio * 100)}% と低めなのに、きつさは ${f.rpe}/10。心肺より脚や全身の疲れが原因の可能性 (推測)。翌朝の脚の状態も見たい。` });
    else subj.push({ kind: 'match', text: `きつさ ${f.rpe}/10 と心拍 (閾値の ${Math.round(hrRatio * 100)}%) は釣り合っている。` });
  }
  if (f && f.breath != null && f.leg != null && Math.abs(f.breath - f.leg) >= 3) {
    const hrNote = hrRatio != null ? `心拍は閾値の ${Math.round(hrRatio * 100)}%${hrRatio >= 0.95 ? ' と高め' : hrRatio <= 0.88 ? ' と低め' : ''}。` : '';
    subj.push({ kind: 'fact', text: f.breath > f.leg
      ? `呼吸 ${f.breath}/10・脚 ${f.leg}/10。今回は脚より心肺側の負荷を強く感じていた。${hrNote}感覚の記録なので、これだけで心肺の力が足りないとは言えません。`
      : `脚 ${f.leg}/10・呼吸 ${f.breath}/10。今回は呼吸より脚の負荷を強く感じていた。${hrNote}疲れの残りか、筋持久力か、この 1 本では決められません (翌朝の脚の状態もあわせて見ます)。` });
  }
  if (f && f.form != null && form) {
    const changed = form.rows.filter((x) => x.flag).length;
    if (f.form >= 7 && changed >= 2) subj.push({ kind: 'gap', text: `フォームの感覚は ${f.form}/10 で自然だが、数値では後半に ${changed} 項目が変化。疲れで気づかないうちに崩れている可能性 (推測)。` });
    else if (f.form <= 4 && changed === 0) subj.push({ kind: 'gap', text: `数値ではフォームは安定しているが、感覚は ${f.form}/10 で力みがある。数値に出ない力み (肩・腕) かもしれない (推測)。` });
  }
  if (f && f.reserve && drift != null) {
    if ((f.reserve === '10+' || f.reserve === '5-10') && drift > 5) subj.push({ kind: 'gap', text: `余裕は「${RESERVE_TXT[f.reserve]}」だが、心拍ドリフト ${drift}% と後半の上昇は大きい。長い距離では見込みより早くきつくなる可能性 (推測)。` });
    else if ((f.reserve === 'limit' || f.reserve === '1-3') && drift <= 3) subj.push({ kind: 'gap', text: `余裕は「${RESERVE_TXT[f.reserve]}」と少ないが、心拍は安定 (ドリフト ${drift}%)。脚の疲れや睡眠など、心肺以外の要因の可能性 (推測)。` });
  }
  if (!f || (f.rpe == null && f.reserve == null)) subj.push({ kind: 'fact', text: 'ふりかえりが未入力なので、主観との照らし合わせはできません (未入力は 0 点として扱いません)。' });

  // ---------------- ピッチ・ストライドを、本人の同じペース帯の過去と比べる (一般的な理想値とは比べない)
  const evPace: number | null = ev?.pace?.details?.avg_pace ?? null;
  const mainPace = evPace ?? pace;
  if (form && snapshot.cad != null) {
    const band = i.past.filter((p) => p.id !== i.id && p.cad != null && Math.abs(p.pace - pace) <= 8);
    if (band.length >= 3) {
      const pc = median(nums(band.map((p) => p.cad))), dc = snapshot.cad - pc;
      const st = nums(band.map((p) => p.stride));
      const ps = st.length >= 3 && snapshot.stride != null ? median(st) : null;
      form.text.splice(form.text.length - 1, 0, `同じペース帯 (${mmss(pace - 8)}〜${mmss(pace + 8)}/km) の過去 ${band.length} 本では、ピッチ ${Math.round(pc)}spm${ps != null ? `・ストライド ${Math.round(ps)}cm` : ''}。今回は ${snapshot.cad}spm (${dc >= 0 ? '+' : ''}${Math.round(dc)})${ps != null ? `・${snapshot.stride}cm (${snapshot.stride! - ps >= 0 ? '+' : ''}${Math.round(snapshot.stride! - ps)})` : ''}。${Math.abs(dc) <= 2 && (ps == null || Math.abs(snapshot.stride! - ps) <= 3) ? 'いつもの走り方。' : 'いつもと少し違う走り方 (良し悪しではなく変化として見ます)。'}`);
    }
  }
  // 後半にペースを上げたとき、ピッチとストライドのどちらが変わったか (前半・後半の差の割合)
  let lateUp: string | null = null;
  if (form && snapshot.half_diff != null && snapshot.half_diff < -3) {
    const r = (lb: string) => { const x = form!.rows.find((y) => y.label === lb); return x ? { f: parseFloat(x.first), s: parseFloat(x.second) } : null; };
    const c = r('ピッチ'), st = r('ストライド');
    if (c && st && c.f > 0 && st.f > 0) {
      const rc = (c.s - c.f) / c.f, rs = (st.s - st.f) / st.f;
      lateUp = rs > Math.max(0.005, rc * 1.5) ? 'stride' : rc > Math.max(0.005, rs * 1.5) ? 'pitch' : 'both';
      if (form.paceup) form.text = form.text.filter((t) => t !== form!.paceup);
      form.text.splice(1, 0, `後半 ${-snapshot.half_diff} 秒/km 上がったとき、ピッチ ${rc >= 0 ? '+' : ''}${Math.round(rc * 1000) / 10}%・ストライド ${rs >= 0 ? '+' : ''}${Math.round(rs * 1000) / 10}%。${lateUp === 'stride' ? '主にストライドが伸びて上がっている。' : lateUp === 'pitch' ? '主にピッチが上がって速くなっている。' : 'ピッチとストライドの両方で上がっている。'}`);
    }
  }
  const strideUp = (!!form?.paceup && /主にストライド/.test(form.paceup)) || lateUp === 'stride';
  const formStable = !!form && form.rows.filter((x) => x.flag && x.label !== 'ストライド' && x.label !== 'ピッチ').length === 0;
  const noPain = (i.fb?.pain ?? 0) < 3;
  if (strideUp && formStable && noPain) good.push('ペースを上げたときは主にストライドが伸びていて、接地などほかの数値に崩れは無い。自然な走り方で速度が出せている');

  // ---------------- 目標ペース帯より速かったとき: 事実と影響を分ける
  let overpace: Analysis['overpace'] = null;
  const bmin: number | null = ev?.pace?.details?.band_min_s ?? null, bmax: number | null = ev?.pace?.details?.band_max_s ?? null;
  const evT = ev?.eff_type ?? ev?.type;
  const daysToRace = i.race?.days ?? null;
  if (bmin != null && bmax != null && RACE_TYPES.includes(evT) && mainPace < bmin - 3) {
    const over = Math.round(bmin - mainPace);
    const rows: ReadyRow[] = [];
    const hdf = snapshot.half_diff;
    rows.push({ label: 'いつ速くなったか', judge: 'hold', value: hdf != null && hdf < -3 ? `後半 ${-hdf}秒/km 上げ` : '最初から速め', reason: hdf != null && hdf < -3 ? '前半は帯に近く、後半に上がっている。走りながら自然に上がった可能性 (推測)。' : '前半から目標帯より速く入っている。' });
    if (hrRatio != null) {
      const hj: Judge = hrRatio <= 0.92 ? 'good' : hrRatio <= 0.96 ? 'ok' : 'bad';
      rows.push({ label: '心拍', judge: hj, value: `閾値の ${Math.round(hrRatio * 100)}%${drift != null ? `・ドリフト ${drift >= 0 ? '+' : ''}${drift}%` : ''}`, reason: hj === 'good' ? '速くなっても心拍は上がりすぎていない。' : hj === 'ok' ? 'やや高め。' : '閾値に近く、負荷は高め。' });
    }
    const pr = form?.rows.find((x) => x.label === 'ピッチ'), sr2 = form?.rows.find((x) => x.label === 'ストライド');
    if (form?.paceup || pr || sr2) rows.push({ label: 'ピッチ・ストライド', judge: formStable ? 'good' : 'ok', value: strideUp ? '主にストライド' : form?.paceup && /主にピッチ/.test(form.paceup) ? '主にピッチ' : pr && sr2 ? `ピッチ ${pr.diff}・ストライド ${sr2.diff}` : '-', reason: formStable ? 'ほかのフォームの数値に崩れは無い。' : '後半にフォームの数値の変化がある。' });
    if (f?.reserve) { const rs = RESERVE_SCORE[f.reserve] ?? 50; rows.push({ label: '余裕度 (主観)', judge: rs >= 80 ? 'good' : rs >= 60 ? 'ok' : 'bad', value: RESERVE_TXT[f.reserve], reason: f.rpe != null ? `きつさ ${f.rpe}/10。` : '' }); }
    else rows.push({ label: '余裕度 (主観)', judge: 'hold', value: '未入力', reason: 'ふりかえりに入れると、速さの影響を判断できます。' });
    // 疲労リスク: 心拍・余裕・脚・大会までの日数から
    let risk = 0;
    if (hrRatio != null && hrRatio > 0.94) risk++;
    if (f?.reserve === 'limit' || f?.reserve === '1-3') risk++;
    if ((f?.leg ?? 0) >= 7 || (f?.leg_late ?? 0) >= 7) risk++;
    if (over >= 8) risk++;
    if (daysToRace != null && daysToRace <= 10) risk++;
    const rj: Judge = risk <= 1 ? 'good' : risk === 2 ? 'ok' : 'bad';
    rows.push({ label: '疲労のリスク', judge: rj, value: rj === 'good' ? '小さい' : rj === 'ok' ? '中くらい' : '大きい', reason: `心拍・余裕・脚の疲れ・速さ (${over}秒/km)${daysToRace != null ? `・大会まで ${daysToRace} 日` : ''} から。` });
    const purpose = evT === 'm' ? '本番ペースを体に覚えさせる' : evT === 'lt' ? '閾値付近で刺激を入れる' : '設定どおりに刻む';
    const verdict = rj === 'good'
      ? `目的 (${purpose}) からは ${over} 秒/km 速いが、心拍・余裕から見て負担は小さい。速く走れたこと自体は良い材料だが、本番ペースの練習としては帯の中に収める方が狙いに合います。`
      : `目的 (${purpose}) からは ${over} 秒/km 速く、負担も${rj === 'ok' ? 'やや' : ''}大きい。速く走れたことと、狙いどおりの練習ができたことは別なので、次の同じ練習は帯の中に収めます。`;
    overpace = { fact: `評価区間の平均 ${mmss(mainPace)}/km は、目標 ${mmss(bmin)}-${mmss(bmax)} より ${over} 秒/km 速い (事実)。`, rows, verdict };
  }

  // ---------------- 大会直前 (14 日以内): 疲労・脚・痛み・強度・刺激・体調を見る。距離が少ないことは減点しない
  let ready: Analysis['ready'] = null;
  if (i.race && i.race.days > 0 && i.race.days <= 14) {
    const R = i.race, cd = i.cond ?? null, rows: ReadyRow[] = [];
    const n = (x: number | null | undefined) => (x == null ? null : x);
    const fat = n(cd?.fatigue) ?? null;
    const legV = n(f?.leg_late) ?? n(f?.leg) ?? null, legM = n(cd?.leg) ?? null;
    rows.push(legV == null && legM == null
      ? { label: '脚の状態', judge: 'hold', value: '未入力', reason: 'ふりかえりか朝の体調に脚の疲労を入れると判断できます。' }
      : (() => { const v = Math.max(legV ?? 0, legM ?? 0); return { label: '脚の状態', judge: v <= 4 ? 'good' : v <= 6 ? 'ok' : 'bad', value: [legV != null ? `走った後 ${legV}/10` : '', legM != null ? `朝 ${legM}/10` : ''].filter(Boolean).join('・'), reason: v <= 4 ? '疲れは残っていない。' : v <= 6 ? 'やや残っている。次の数日は軽めに。' : '疲れが強い。強度を落として回復を優先。' } as ReadyRow; })());
    rows.push(fat == null ? { label: '疲労の抜け', judge: 'hold', value: '未入力', reason: '朝の体調の「全身の疲労」が未入力。' } : { label: '疲労の抜け', judge: fat <= 4 ? 'good' : fat <= 6 ? 'ok' : 'bad', value: `全身 ${fat}/10`, reason: '朝の体調から。' });
    const painV = Math.max(f?.pain ?? -1, cd?.pain ?? -1);
    rows.push(painV < 0 ? { label: '痛み', judge: 'hold', value: '未入力', reason: 'ふりかえり・朝の体調の痛みが未入力。' } : { label: '痛み', judge: painV <= 1 ? 'good' : painV <= 3 ? 'ok' : 'bad', value: painV === 0 ? 'なし' : `${painV}/10`, reason: painV <= 1 ? '' : painV <= 3 ? '違和感程度。悪化しないか毎日見る。' : '強度を落とし、続くなら受診を。' });
    const gp = R.goal_s ? R.goal_s / (R.distance_m / 1000) : null;
    if (group === 'tempo' && gp) {
      const d = Math.round(mainPace - gp);
      const j: Judge = Math.abs(d) <= 5 ? 'good' : d < -5 ? (d < -10 ? 'bad' : 'ok') : 'ok';
      rows.push({ label: '強度の適切さ', judge: j, value: `${mmss(mainPace)}/km (目標ペース ${mmss(gp)}/km ${d === 0 ? 'ちょうど' : d < 0 ? `より ${-d}秒速い` : `より ${d}秒遅い`})`, reason: j === 'good' ? '大会の目標ペース付近。直前の刺激として適切。' : d < 0 ? '目標ペースより速い。直前期は疲れを残さない強度に。' : '目標ペースより遅め。リズム確認としては問題なし。' });
      rows.push({ label: 'スピード刺激', judge: 'good', value: '入った', reason: `大会 ${R.days} 日前に目標ペース付近の刺激。` });
    } else if (group === 'easy' || group === 'long') {
      const j: Judge = hrRatio == null ? 'hold' : hrRatio <= 0.87 ? 'good' : 'ok';
      rows.push({ label: '強度の適切さ', judge: j, value: hrRatio == null ? '心拍なし' : `心拍 閾値の ${Math.round(hrRatio * 100)}%`, reason: j === 'good' ? '回復を妨げない強さ。' : j === 'ok' ? '直前期のジョグとしてはやや高め。' : '' });
    }
    const sleep = cd?.sleep ?? null;
    const tags = f?.tags ?? [];
    rows.push(sleep == null && !tags.length ? { label: '体調', judge: 'hold', value: '未入力', reason: '朝の体調の睡眠・コンディションが未入力。' } : { label: '体調', judge: (sleep ?? 10) >= 6 && !tags.includes('sleep') && !tags.includes('tired') ? 'good' : 'ok', value: [sleep != null ? `睡眠 ${sleep}/10` : '', ...tags.map((t) => ({ hot: '暑い', cold: '寒い', wind: '風', sleep: '睡眠不足', hungry: '空腹', tired: '疲れが残っていた' } as Record<string, string>)[t] ?? t)].filter(Boolean).join('・'), reason: '' });
    ready = { race: `${R.name}${R.goal_s ? ` (目標 ${Math.floor(R.goal_s / 3600)}:${String(Math.floor((R.goal_s % 3600) / 60)).padStart(2, '0')}:${String(R.goal_s % 60).padStart(2, '0')})` : ''}`, days: R.days, rows, note: '調整期なので、距離が少ないことは減点しません。月間の距離の進み具合は、月間の画面で練習の質とは分けて表示しています。' };
  }

  // ---------------- 次に活かすこと (分かったことから、次の練習の行動に)
  const next: string[] = [];
  if (overpace && overpace.rows.find((r) => r.label === '疲労のリスク')?.judge !== 'good') next.push(`次の同じ練習は、目標 ${mmss(bmin!)}-${mmss(bmax!)} の中に収める (今回は ${Math.round(bmin! - mainPace)} 秒/km 速かった)。`);
  if (ready) {
    const bad = ready.rows.filter((r) => r.judge === 'bad');
    next.push(bad.length ? `大会まで ${ready.days} 日。${bad.map((r) => r.label).join('・')}に注意して、強度を上げずに回復を優先する。` : `大会まで ${ready.days} 日。状態は良いので、ここから距離・強度は増やさず、疲れを残さないことを優先する。`);
  }
  if ((f?.pain ?? 0) >= 3) next.push(`痛み ${f!.pain}/10。次の練習は Jog か休養にし、翌朝の体調で痛みを記録する。`);
  if (drift != null && drift > 5) next.push(`心拍ドリフト ${drift}%。次の同じ練習では前半を 5〜10 秒/km 抑え、補水を早めに。`);
  if (snapshot.half_diff != null && snapshot.half_diff > 8 && km >= 8) next.push(`後半 ${snapshot.half_diff} 秒/km の失速。次は最初の 2〜3km を目標より 5 秒/km 遅く入る。`);
  const hrCmp2 = compare?.metrics.find((m) => m.key === 'hr_at_pace');
  if (hrCmp2?.trend === 'up') next.push(`同じペースでの心拍が過去より ${hrCmp2.diff.replace('-', '')}bpm 低い (気温などの条件差も含む)。次のポイント練は設定どおりのペースで良い。`);
  if (hrCmp2?.trend === 'down' && !next.length) next.push(`同じペースでの心拍が過去より +${hrCmp2.diff.replace('+', '')}bpm 高い。疲れが残っている可能性があるので、次の Easy はゆっくり、睡眠を優先。`);
  if (f?.rpe != null && f.rpe_late != null && f.rpe_late - f.rpe >= 2) next.push('後半に急にきつくなっている。ロング走で後半の補給 (ジェル) を試す。');
  if (!next.length) next.push(group === 'easy' ? 'このまま、Easy は楽なペースを守る。' : '今回の内容を基準にして、次の同じ練習と比べる。');

  // ---------------- 総評
  const a = achScore, fz = fitScore;
  const summary = [
    a != null ? `計画に対しては${a >= 85 ? 'よくできた' : a >= 70 ? 'おおむねできた' : '課題が残った'} (${a}点)` : '計画が無いので達成度は保留',
    fz != null ? `走力面は${fz >= 85 ? '余裕を持って走れている' : fz >= 70 ? '標準的' : '余裕が少ない'} (${fz}点)` : '走力面は材料が少なく保留',
  ].join('。') + '。';

  // ---------------- 最初に出す 3 つ
  const pick = <T,>(...xs: (T | null | undefined | false)[]) => xs.find((x) => !!x) as T | undefined;
  const raceNote = ready ? `大会 ${ready.days} 日前の${group === 'tempo' ? '刺激入れ' : '調整'}として` : '';
  const overall = a != null
    ? `${overpace ? `${raceNote ? raceNote.replace(/として$/, '。') : ''}ペースは目標帯より速め` : raceNote}${overpace ? '' : a >= 85 ? '計画どおりにできた' : a >= 70 ? 'おおむね計画どおり' : '計画とずれが残った'} (練習達成度 ${a}点)。${fz != null ? `走りの中身は${fz >= 85 ? '余裕があった' : fz >= 70 ? '標準的' : '余裕が少なかった'} (走力評価 ${fz}点)。` : '走力評価は材料が少なく保留。'}`
    : `計画の無いラン。${fz != null ? `走りの中身は${fz >= 85 ? '余裕があった' : fz >= 70 ? '標準的' : '余裕が少なかった'} (走力評価 ${fz}点)。` : '走力評価は材料が少なく保留。'}`;
  const gapS = subj.find((x) => x.kind === 'gap');
  const finding = pick<string>(
    (f?.pain ?? 0) >= 3 && `痛み ${f!.pain}/10${f!.pain_part?.length ? ` (${f!.pain_part.join('・')})` : ''} の記録がある。`,
    overpace && `${overpace.fact.replace(' (事実)', '')}${overpace.rows.find((r) => r.label === '疲労のリスク')?.judge === 'good' ? '心拍・余裕から見て負担は小さい。' : '負担はやや大きい。'}`,
    strideUp && formStable && snapshot.half_diff != null && snapshot.half_diff < -3 && `後半 ${-snapshot.half_diff} 秒/km 上がったのは、主にストライドが伸びたため。ほかのフォームの数値に崩れは無く、自然な走り方で上がっている。`,
    drift != null && drift > 5 && `一定ペース区間で心拍が ${drift}% 上がった (心拍ドリフト)。`,
    hrCmp2?.trend === 'up' && `同じペースでの心拍が、似た過去のランより ${hrCmp2.diff.replace('-', '')}bpm 低い。`,
    hrCmp2?.trend === 'down' && `同じペースでの心拍が、似た過去のランより +${hrCmp2.diff.replace('+', '')}bpm 高い (気温・疲れの影響もありうる)。`,
    gapS?.text,
    drift != null && drift <= 3 && `一定ペース区間の心拍ドリフトは ${drift >= 0 ? '+' : ''}${drift}% で安定。`,
    snapshot.half_diff != null && snapshot.half_diff <= 0 && km >= 5 && `後半は前半より ${-snapshot.half_diff} 秒/km 速く、最後までペースを保てた。`,
  ) ?? '大きな変化は見られない。今回の数値を次の同じ練習の基準にする。';
  // 発見と同じ話を「次に活かすこと」で繰り返さない
  const topic = (t: string) => (/同じペースでの心拍/.test(t) ? 'hr' : /ドリフト/.test(t) ? 'drift' : /失速/.test(t) ? 'fade' : /痛み/.test(t) ? 'pain' : t);
  const topNext = next.find((t) => topic(t) !== topic(finding)) ?? next[0] ?? '';
  const top = { overall, finding, next: topNext };
  const defs = [
    { key: 'ach', label: '練習達成度', text: '予定した距離・ペース・練習の目的に対して、どれだけできたか (計画との比較)。' },
    { key: 'fit', label: '走力評価', text: '心拍・ペースの維持・フォーム・余裕度から見た、走りの中身 (計画とは別)。' },
    { key: 'day', label: '日次評価', text: 'その日の練習全体 (アップ・メイン・ダウン) を、目的と大会までの日数もふまえて見たもの (日次の画面)。' },
  ];
  const basis: string[] = [];
  basis.push(`平均ペース ${mmss(pace)}/km = 運動時間 ${Math.floor(i.moving_time_s / 60)}:${String(Math.round(i.moving_time_s % 60)).padStart(2, '0')} ÷ ${km.toFixed(2)}km (${i.source ?? '記録'}の値から)。`);
  if (i.elapsed_time_s && i.elapsed_time_s - i.moving_time_s >= 30) basis.push(`経過時間は ${Math.floor(i.elapsed_time_s / 60)}:${String(Math.round(i.elapsed_time_s % 60)).padStart(2, '0')} (止まっていた時間を含む)。ペースは運動時間で計算しています。`);
  if (evPace != null && Math.abs(Math.round(evPace) - Math.round(pace)) >= 1 && (ev?.pace?.details?.work_km ?? km) < km - 0.05) basis.push(`評価区間 ${Number(ev.pace.details.work_km).toFixed(2)}km の平均 ${mmss(evPace)}/km は、アップ・ダウンやゆっくりの区間を除いてアプリで計算した値。目標帯の判定に使っています。`);
  basis.push('ピッチ・ストライドの前半後半・同じペース帯の比較、心拍ドリフトはアプリで計算した値です。');
  return {
    top, defs, basis, overpace, ready,
    summary, subj, next: next.slice(0, 3),
    achievement: { score: achScore, items: ach, ...(achHold ? { hold_reason: achHold } : {}) },
    fitness: { score: fitScore, items: fit, ...(fitHold ? { hold_reason: fitHold } : {}) },
    good, issues: issues.slice(0, 3), hrpace, compare, form, snapshot,
  };
}
