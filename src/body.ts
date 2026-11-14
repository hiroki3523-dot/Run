/**
 * からだのデータ (体重・体脂肪率・安静時心拍・HRV・睡眠時間)。kv の body:YYYY-MM-DD に日ごとに保存。
 * iPhone のショートカットでヘルスケアから送る (POST /api/body) か、画面で手入力する。
 * 送られなかった項目は保存しない (0 や推測で埋めない)。
 */

export interface BodyDay {
  weight?: number; // kg
  body_fat?: number; // %
  muscle?: number; // kg
  resting_hr?: number; // bpm
  hrv?: number; // ms
  sleep_h?: number; // 時間
  source?: 'health' | 'manual';
  at?: string;
}

const FIELDS: [keyof BodyDay, string[], number, number][] = [
  ['weight', ['weight', 'weight_kg', 'body_mass'], 30, 200],
  ['body_fat', ['body_fat', 'body_fat_pct', 'fat'], 3, 60],
  ['muscle', ['muscle', 'muscle_kg', 'lean_mass'], 10, 120],
  ['resting_hr', ['resting_hr', 'rhr'], 30, 120],
  ['hrv', ['hrv', 'hrv_ms'], 5, 250],
  ['sleep_h', ['sleep_h', 'sleep_hours', 'sleep'], 0.5, 16],
];

/** ショートカットは「72,4」「15.2 %」のような文字や配列を送ってくることがあるので、ゆるく数にする */
function toNum(v: unknown): number | null {
  if (Array.isArray(v)) v = v[v.length - 1]; // 新しい順でないこともあるので、最後 (いちばん新しい) を使う
  if (v && typeof v === 'object') { const o = v as Record<string, unknown>; v = o.value ?? o.quantity ?? o.qty ?? null; }
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // 「71.4 kg」「71,4」「71.4 kg 2026/11/13 21:09」などから、最初の数だけを読む
  const m = String(v).replace(/(\d),(\d)/, '$1.$2').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/** 読めなかったときに、何が届いたかを短く返す (原因を調べるため。値は先頭 60 文字まで) */
export function describeReceived(b: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(b || {}).slice(0, 10)) {
    const t = Array.isArray(v) ? `配列(${v.length})` : v === null ? 'null' : typeof v;
    out[k.slice(0, 30)] = `${t}: ${JSON.stringify(v)?.slice(0, 60) ?? ''}`;
  }
  return out;
}

/** 受け取った値を確かめる。範囲外・読めない値は捨てる (保存しない) */
export function cleanBody(input: Record<string, unknown>): BodyDay {
  // キーの前後の空白・大文字は無視する (ショートカットで「weight 」のように空白が入りやすい)
  const b: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input || {})) b[k.trim().toLowerCase()] = v;
  const out: BodyDay = {};
  for (const [k, names, lo, hi] of FIELDS) {
    let v: number | null = null;
    for (const n of names) if (v == null) v = toNum(b[n]);
    if (v == null) continue;
    if (k === 'body_fat' && v > 0 && v < 1) v *= 100; // ヘルスケアは 0.152 のように割合で返す
    if (k === 'sleep_h' && v > 24 && v <= 960) v /= 60; // 分で送られたとき
    if (v < lo || v > hi) continue;
    (out as any)[k] = Math.round(v * 10) / 10;
  }
  return out;
}

/** 適正体重の幅に使う体脂肪率 (男性のサブ 3 前後のランナーでよく言われる 10〜12%) */
export const FIT_BF: [number, number] = [10, 12];

/**
 * 体重と目標タイムの目安。
 * - 7 日平均の体重・体脂肪率、4 週前との差、1 週あたりの増減
 * - 適正体重: 体脂肪率が分かれば「除脂肪体重 ÷ (1 − 目標の体脂肪率)」で 10〜12% のときの体重の幅
 * - 目標体重 (自分で決めた値があればそれ、無ければ適正体重の上側) まであと何 kg
 * - 「体重 1% ≈ タイム 1%」という一般的な目安から、1kg あたりの秒数
 * - 身長があれば BMI と、BMI 18.5 (低体重の境目) の体重。適正体重がこれを下回るときは BMI 18.5 で止める
 * 足りないデータは出さない (null)
 */
export function weightGuide(days: Record<string, BodyDay>, today: string, heightCm: number | null, goalS: number | null, targetKg: number | null = null) {
  const dates = Object.keys(days).filter((d) => days[d]?.weight != null && d <= today).sort();
  if (!dates.length) return null;
  const last = dates[dates.length - 1];
  const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
  if (dayMs(today) - dayMs(last) > 14 * 86400_000) return null; // 2 週間以上前の体重は使わない
  const gap = (d: string) => (dayMs(last) - dayMs(d)) / 86400_000;
  const within = (from: number, to: number, k: keyof BodyDay = 'weight') => Object.keys(days).filter((d) => d <= last && days[d]?.[k] != null && gap(d) >= from && gap(d) <= to).map((d) => days[d][k] as number);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const mean = (xs: number[]) => (xs.length ? r1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const avg7 = mean(within(0, 6))!;
  const before = mean(within(24, 34));
  const bf7 = mean(within(0, 6, 'body_fat'));
  const h = heightCm && heightCm >= 120 && heightCm <= 230 ? heightCm / 100 : null;
  const bmi = h ? r1(avg7 / (h * h)) : null;
  const bmiLow = h ? r1(18.5 * h * h) : null;
  // 適正体重 (体脂肪率 10〜12% のとき)
  let fit: { lo: number; hi: number; lean: number } | null = null;
  if (bf7 != null) {
    const lean = avg7 * (1 - bf7 / 100);
    let lo = r1(lean / (1 - FIT_BF[0] / 100)), hi = r1(lean / (1 - FIT_BF[1] / 100));
    if (bmiLow != null) { lo = Math.max(lo, bmiLow); hi = Math.max(hi, bmiLow); }
    fit = { lo, hi, lean: r1(lean) };
  }
  const own = targetKg && targetKg >= 30 && targetKg <= 200 ? targetKg : null;
  const target = own ?? fit?.hi ?? null;
  const secPerKg = goalS ? Math.round(goalS / avg7) : null;
  const toTarget = target != null ? r1(avg7 - target) : null;
  // 1 週あたりの増減: 14 日以上の幅に 4 日以上の記録があるときだけ (最小二乗の傾き)
  const pts = Object.keys(days).filter((d) => d <= last && days[d]?.weight != null && gap(d) <= 27).map((d) => [-gap(d), days[d].weight!] as [number, number]);
  let perWeek: number | null = null;
  if (pts.length >= 4 && Math.max(...pts.map((p) => -p[0])) >= 14) {
    const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length, my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
    const sxx = pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0), sxy = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0);
    if (sxx > 0) perWeek = r1((sxy / sxx) * 7);
  }
  return {
    last_date: last,
    avg7,
    n7: within(0, 6).length,
    change28: before != null ? r1(avg7 - before) : null,
    per_week: perWeek,
    // 1 週で体重の 1% を超えて減っているときは、減り方が速すぎる
    too_fast: perWeek != null && perWeek < -avg7 * 0.01,
    bf7,
    fit,
    target_kg: target,
    target_own: own != null,
    to_target: toTarget,
    // 目標まで落としたときの、タイムの目安 (秒)。増やす方向は出さない
    gain_s: secPerKg && toTarget != null && toTarget > 0 ? Math.round(secPerKg * toTarget) : null,
    bmi,
    bmi_low_kg: bmiLow,
    sec_per_kg: secPerKg,
    lean: bmi != null && bmi < 20,
  };
}
