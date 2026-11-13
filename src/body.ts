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

/**
 * 体重と目標タイムの目安。目標体重は出さない。
 * - 7 日平均の体重・4 週前との差
 * - 「体重 1% ≈ タイム 1%」という一般的な目安から、1kg あたりの秒数
 * - 身長があれば BMI と、BMI 18.5 (低体重の境目) の体重
 */
export function weightGuide(days: Record<string, BodyDay>, today: string, heightCm: number | null, goalS: number | null) {
  const dates = Object.keys(days).filter((d) => days[d]?.weight != null && d <= today).sort();
  if (!dates.length) return null;
  const last = dates[dates.length - 1];
  const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
  if (dayMs(today) - dayMs(last) > 14 * 86400_000) return null; // 2 週間以上前の体重は使わない
  const within = (from: number, to: number) => dates.filter((d) => { const g = (dayMs(last) - dayMs(d)) / 86400_000; return g >= from && g <= to; }).map((d) => days[d].weight!);
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const avg7 = mean(within(0, 6))!;
  const before = mean(within(24, 34));
  const h = heightCm && heightCm >= 120 && heightCm <= 230 ? heightCm / 100 : null;
  const bmi = h ? Math.round((avg7 / (h * h)) * 10) / 10 : null;
  return {
    last_date: last,
    avg7,
    n7: within(0, 6).length,
    change28: before != null ? Math.round((avg7 - before) * 10) / 10 : null,
    bmi,
    bmi_low_kg: h ? Math.round(18.5 * h * h * 10) / 10 : null,
    sec_per_kg: goalS ? Math.round(goalS / avg7) : null,
    lean: bmi != null && bmi < 20,
  };
}
