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
}
export interface CompareMetric { key: string; label: string; now: string; past: string; diff: string; trend: 'up' | 'same' | 'down' | 'hold'; note?: string }
export interface Analysis {
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

const RESERVE_SCORE: Record<string, number> = { limit: 30, '1-3': 45, '3-5': 65, '5-10': 80, '10+': 92 };
const RESERVE_TXT: Record<string, string> = { limit: 'ほぼ限界', '1-3': 'あと 1〜3km', '3-5': 'あと 3〜5km', '5-10': 'あと 5〜10km', '10+': 'あと 10km 以上' };

export interface AnalysisIn {
  id: number; date: string; distance_m: number; moving_time_s: number; avg_hr: number | null; avg_cad_spm: number | null;
  elev_gain: number | null;
  ev: any | null; plan_type: string | null; has_plan: boolean;
  fb: Fb | null; series: Series | null; easy_min: number; lthr: number;
  past: Snapshot[];
}

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
      if (drift != null) text.push(`${steady.from_km}〜${steady.to_km}km はペースが一定 (${mmss(med)}/km 前後)。この区間の心拍ドリフトは ${drift >= 0 ? '+' : ''}${drift}% (${Math.round(h1)} → ${Math.round(h2)}bpm 相当)。${drift <= 3 ? '心拍は安定していて、有酸素の持久力は十分。' : drift <= 5 ? 'やや上昇。長い距離では序盤を少し抑えたい。' : '後半の上昇が大きい。暑さ・補給・疲労、または持久力の不足が考えられる。'}`);
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
      if (response != null && Number.isFinite(response) && response > 0) text.push(`ペースを 10 秒/km 上げると、心拍は約 +${response}bpm (1km ごとのペースと心拍から)。${response <= 4 ? '速くしても心拍の上がり方が小さく、余裕がある。' : response <= 8 ? '標準的な反応。' : '速くすると心拍が大きく上がる。今の力ではペースを上げる余地が小さい。'}`);
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
    text.push(changed.length ? `後半は ${changed.map((x) => `${x.label} ${x.diff}`).join('・')} の変化。疲れによるフォームの変化の可能性。` : '前半と後半でフォームの数値に大きな変化はない。');
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
    elev_per_km: i.elev_gain != null && km > 0 ? Math.round((i.elev_gain / km) * 10) / 10 : null, drift,
  };

  // ---------------- 過去との比較 (同じまとまり・距離と ペースが近いもの)
  let compare: Analysis['compare'] = null;
  const sim = i.past
    .filter((p) => p.id !== i.id && p.group === group && p.km >= km * 0.6 && p.km <= km * 1.6 && Math.abs(p.pace - pace) <= 25)
    .map((p) => ({ p, d: Math.abs(Math.log(p.km / km)) * 60 + Math.abs(p.pace - pace) }))
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
    add('cad', 'ピッチ', 'spm', 'high', 2, snapshot.cad);
    add('stride', 'ストライド', 'cm', 'high', 3, snapshot.stride);
    add('gct', '接地時間', 'ms', 'low', 5, snapshot.gct);
    add('power', 'ランニングパワー', 'W', 'low', 8, snapshot.power);
    const ep = nums(sim.map((p) => p.elev_per_km));
    if (snapshot.elev_per_km != null && ep.length && Math.abs(snapshot.elev_per_km - median(ep)) >= 8) notes.push(`今回は 1km あたりの上り ${snapshot.elev_per_km}m で、比べたランの ${median(ep)}m と坂の条件が違います。`);
    const kmGap = Math.abs(mean(sim.map((p) => p.km)) - km) / km;
    if (kmGap > 0.3) notes.push('比べたランとは距離が 3 割以上違うので、参考程度に。');
    notes.push('気温・天気は比較に入っていません。暑い日は心拍が高めに出ます。');
    compare = { n: sim.length, runs: sim.map((p) => ({ id: p.id, date: p.date, km: p.km, pace: p.pace, hr: p.hr })), metrics, notes };
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

  return {
    achievement: { score: achScore, items: ach, ...(achHold ? { hold_reason: achHold } : {}) },
    fitness: { score: fitScore, items: fit, ...(fitHold ? { hold_reason: fitHold } : {}) },
    good, issues: issues.slice(0, 3), hrpace, compare, form, snapshot,
  };
}
