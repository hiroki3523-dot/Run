/** 実績から、次のレースに向けた課題と、やるべき練習を出す (ルールベース・数字つき) */

export interface InsightRun {
  date: string;
  distance_m: number;
  moving_time_s: number;
  avg_hr: number | null;
  avg_cadence_spm: number | null;
  plan_type: string | null;
  role: string | null;
  drift_pct: number | null;
}

export interface InsightIn {
  today: string;
  runs: InsightRun[]; // 直近 8 週間
  race: { name: string; date: string; distance_m: number; goal_time_s: number | null } | null;
  predicted_full_s: number | null;
  /** 予測の出どころ (画面に出す短い説明) */
  predicted_label?: string;
  target_cadence: number;
}

/**
 * Strava の記録 (ペースと心拍) からフルマラソンの予測タイムを出す。
 * 心拍が高め (最大心拍の 80% 以上) の 5km 以上のランについて、心拍から %VO2max を推定し (Swain の式)、
 * ペースから求めた酸素摂取量で割って VDOT を推定する。その中央値から、Daniels の式でフルのタイムを求める。
 */
const vo2 = (mPerMin: number) => -4.6 + 0.182258 * mPerMin + 0.000104 * mPerMin * mPerMin;
const pctAt = (min: number) => 0.8 + 0.1894393 * Math.exp(-0.012778 * min) + 0.2989558 * Math.exp(-0.1932605 * min);
export function timeForVdot(vdot: number, distM: number): number {
  let lo = 60, hi = 600; // 分
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (vo2(distM / mid) / pctAt(mid) > vdot) lo = mid; else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 60);
}
export function predictFromRuns(runs: InsightRun[], maxHr: number, today: string): { full_s: number; n: number } | null {
  const t = Date.parse(`${today}T00:00:00Z`);
  const vd = runs
    .filter((r) => r.distance_m >= 5000 && r.avg_hr && r.avg_hr / maxHr >= 0.8 && r.avg_hr / maxHr <= 0.97 && t - Date.parse(`${r.date}T00:00:00Z`) < 56 * 86400_000)
    .map((r) => {
      const v = r.distance_m / (r.moving_time_s / 60);
      const pct = (r.avg_hr! / maxHr - 0.37) / 0.64;
      return vo2(v) / pct;
    })
    .filter((x) => x > 25 && x < 85)
    .sort((a, b) => a - b);
  if (vd.length < 3) return null;
  const med = vd[Math.floor(vd.length / 2)];
  return { full_s: timeForVdot(med, 42195), n: vd.length };
}

export type Level = 'ok' | 'warn' | 'bad';
export interface InsightItem { key: string; level: Level; label: string; value: string; target: string }
export interface Insights {
  race: { name: string; days: number; goal_s: number | null; goal_pace_s: number | null } | null;
  predicted_s: number | null;
  predicted_label: string;
  /** 予測 − 目標 (秒)。負なら予測のほうが速い */
  gap_s: number | null;
  items: InsightItem[];
  actions: string[];
}

const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86400_000;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** 目標タイムに対する週間距離の目安 (km)。フルマラソンの一般的な目安 */
export function weeklyTarget(goalS: number | null): number {
  if (!goalS) return 50;
  const h = goalS / 3600;
  return h <= 3.0 ? 80 : h <= 3.25 ? 70 : h <= 3.5 ? 60 : h <= 4 ? 50 : 40;
}

export function buildInsights(i: InsightIn): Insights {
  const t = day(i.today);
  const within = (n: number) => i.runs.filter((r) => t - day(r.date) < n && t - day(r.date) >= 0);
  const race = i.race && day(i.race.date) >= t ? i.race : null;
  const isFull = !!race && race.distance_m >= 40000;
  const daysLeft = race ? Math.round(day(race.date) - t) : null;
  const goalPace = race?.goal_time_s ? race.goal_time_s / (race.distance_m / 1000) : null;
  const items: InsightItem[] = [];
  const actions: string[] = [];
  const taper = daysLeft != null && daysLeft <= 14;

  // 1. 週間距離 (直近 4 週の平均)
  const km4 = within(28).reduce((a, r) => a + r.distance_m, 0) / 1000 / 4;
  const wt = weeklyTarget(isFull ? race!.goal_time_s : null);
  const wl: Level = km4 >= wt * 0.9 ? 'ok' : km4 >= wt * 0.7 ? 'warn' : 'bad';
  items.push({ key: 'volume', level: wl, label: '週間距離 (4週平均)', value: `${Math.round(km4)}km`, target: `${wt}km` });
  if (!taper && wl !== 'ok') actions.push(`週間距離を ${Math.round(km4)}km → ${wt}km へ。Easy を 1 日 2〜3km ずつ延ばし、1 週で 10% 以内の増加に`);

  // 2. ロング走 (1 日の合計 28km 以上、直近 8 週)
  if (isFull) {
    const byDay = new Map<string, number>();
    for (const r of within(56)) byDay.set(r.date, (byDay.get(r.date) ?? 0) + r.distance_m);
    const longs = [...byDay.values()].filter((m) => m >= 28000).length;
    const need = 3;
    const lv: Level = longs >= need ? 'ok' : longs >= 1 ? 'warn' : 'bad';
    items.push({ key: 'long', level: lv, label: '28km以上のロング (8週)', value: `${longs}回`, target: `${need}回` });
    if (!taper && lv !== 'ok') actions.push(`28〜32km のロング走をあと ${need - longs} 回。後半 10km は目標ペース ${goalPace ? mmss(goalPace) : ''}/km 付近で`);
  }

  // 3. 目標ペースで走った距離 (±8 秒/km、5km 以上の区間、直近 4 週)
  if (goalPace) {
    const at = within(28).filter((r) => r.distance_m >= 5000 && Math.abs(r.moving_time_s / (r.distance_m / 1000) - goalPace) <= 8);
    const mk = at.reduce((a, r) => a + r.distance_m, 0) / 1000;
    const need = isFull ? 30 : 15;
    const lv: Level = mk >= need ? 'ok' : mk >= need / 2 ? 'warn' : 'bad';
    items.push({ key: 'mpace', level: lv, label: `目標ペース ${mmss(goalPace)} の距離 (4週)`, value: `${Math.round(mk)}km`, target: `${need}km` });
    if (lv !== 'ok') actions.push(taper ? `本番前は目標ペース ${mmss(goalPace)}/km を 1km×3〜4 本だけ。体に速さを思い出させる程度に` : `目標ペース ${mmss(goalPace)}/km の持続走を週 1 回 (8〜12km)。4 週で ${need}km を目安に`);
  }

  // 4. ロング走の心拍ドリフト (18km 以上、直近 8 週の平均)
  const drifts = within(56).filter((r) => r.distance_m >= 18000 && r.drift_pct != null).map((r) => r.drift_pct!);
  if (drifts.length) {
    const d = drifts.reduce((a, b) => a + b, 0) / drifts.length;
    const lv: Level = d <= 3 ? 'ok' : d <= 6 ? 'warn' : 'bad';
    items.push({ key: 'drift', level: lv, label: '長い距離の心拍ドリフト', value: `${d.toFixed(1)}%`, target: '3%以内' });
    if (lv !== 'ok') actions.push(`後半に心拍が上がりやすい (ドリフト ${d.toFixed(1)}%)。Easy の割合を増やし、ロング走は前半を 10 秒/km 抑える。給水も早めに`);
  }

  // 5. ピッチ (直近 4 週の平均)
  const cads = within(28).filter((r) => r.avg_cadence_spm);
  if (cads.length) {
    const c = cads.reduce((a, r) => a + r.avg_cadence_spm! * r.moving_time_s, 0) / cads.reduce((a, r) => a + r.moving_time_s, 0);
    const lv: Level = c >= i.target_cadence - 3 ? 'ok' : c >= i.target_cadence - 8 ? 'warn' : 'bad';
    items.push({ key: 'cadence', level: lv, label: 'ピッチ (4週平均)', value: `${Math.round(c)}spm`, target: `${i.target_cadence}spm` });
    if (lv !== 'ok') actions.push(`ピッチが ${Math.round(c)}spm と低め。Easy の最後に流し 100m×4〜6 本、接地を体の真下に`);
  }

  // 6. 継続 (直近 4 週の走った日数)
  const days4 = new Set(within(28).map((r) => r.date)).size / 4;
  const dl: Level = days4 >= 5 ? 'ok' : days4 >= 4 ? 'warn' : 'bad';
  items.push({ key: 'days', level: dl, label: '走った日数 (週平均)', value: `${days4.toFixed(1)}日`, target: '5日' });
  if (!taper && dl === 'bad') actions.push(`走る日が週 ${days4.toFixed(1)} 日と少なめ。短いジョグ (5km) でよいので日数を増やす`);

  if (taper) actions.unshift(`${race!.name}まであと ${daysLeft} 日。ここからは距離を落として疲労を抜くことが最優先`);

  return {
    race: race ? { name: race.name, days: daysLeft!, goal_s: race.goal_time_s, goal_pace_s: goalPace } : null,
    predicted_s: i.predicted_full_s,
    predicted_label: i.predicted_label ?? '予測',
    gap_s: isFull && race!.goal_time_s && i.predicted_full_s ? i.predicted_full_s - race!.goal_time_s : null,
    items,
    actions: actions.slice(0, 3),
  };
}
