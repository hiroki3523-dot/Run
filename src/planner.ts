import { addDays, daysBetween, fmtPace } from './format';
import type { PlanType, Settings } from './types';

export interface PlannerRace {
  date: string;
  name: string;
  distance_m: number;
  goal_time_s: number | null;
}

export interface PlannerInput {
  /** 計画を作り始める日 (この日を含む) */
  start: string;
  /** 目標レース (この日で終わる) */
  race: PlannerRace;
  /** 期間内にある他のレース (調整レース) */
  others: PlannerRace[];
  /** 直近 4 週間の週平均距離 (km)。不明なら null */
  weekly_km: number | null;
  /** 先週の 実績/計画 (0〜)。不明なら null */
  last_completion: number | null;
  /** start の直前 (10 日以内) に出たレースの日付 */
  last_race: string | null;
  settings: Settings;
}

export interface PlanRow {
  date: string;
  type: PlanType;
  distance_m: number | null;
  pace_min_s: number | null;
  pace_max_s: number | null;
  notes: string;
}

const km = (x: number) => Math.round(x * 2) / 2; // 0.5km 単位
const m = (k: number) => Math.round(k * 1000);
const dayOfWeek = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay(); // 0=日

const rest = (date: string, notes = '休養'): PlanRow => ({ date, type: 'rest', distance_m: null, pace_min_s: null, pace_max_s: null, notes });

/** 目標ペース (秒/km)。目標タイム未設定ならサブ3 (4:15) */
export function goalPace(r: PlannerRace): number {
  return r.goal_time_s ? r.goal_time_s / (r.distance_m / 1000) : 255;
}

/** 週の距離の目安: 直近の平均から週 5% ずつ増やし、4 週目ごとに減らす */
export function weekVolume(base: number, buildIndex: number): number {
  const cap = Math.min(95, Math.max(base * 1.35, 55));
  if (buildIndex % 4 === 3) return Math.min(cap, base * (1 + 0.05 * buildIndex)) * 0.8;
  return Math.min(cap, base * (1 + 0.05 * (buildIndex + 1)));
}

export function generatePlan(input: PlannerInput): PlanRow[] {
  const { start, race, others, settings } = input;
  const end = race.date;
  const mp = goalPace(race);
  const lt = settings.coros?.lt_pace_s ?? 247;
  const mpTxt = fmtPace(mp);
  const ltTxt = fmtPace(lt);
  let base = input.weekly_km && input.weekly_km > 0 ? input.weekly_km : 40;
  if (input.last_completion != null && input.last_completion < 0.8) base *= 0.9;

  const raceDays = new Map<string, PlannerRace>([[end, race], ...others.map((o) => [o.date, o] as [string, PlannerRace])]);
  const rows: PlanRow[] = [];
  const firstBuildDay = input.last_race ? addDays(input.last_race, 7) : start;

  for (let d = start; d <= end; d = addDays(d, 1)) {
    const D = daysBetween(d, end); // レースまでの日数
    const r = raceDays.get(d);
    if (r) {
      const p = goalPace(r);
      rows.push({
        date: d, type: 'race', distance_m: r.distance_m, pace_min_s: Math.round(p - 3), pace_max_s: Math.round(p + 2),
        notes: `${r.name}${d === end ? '' : ' (調整レース。全力にしない)'}。${fmtPace(p)}/km 前後で等ペース。`,
      });
      continue;
    }
    // 他レースの前後は軽く
    const near = others.concat([race]).map((o) => daysBetween(d, o.date));
    if (near.includes(1)) { rows.push(jog(d, 3, 'ジョグ3km + 補給・ゼッケン確認')); continue; }
    if (near.includes(2)) { rows.push(rest(d, '休養 (レース2日前)')); continue; }
    if (near.includes(-1)) { rows.push(rest(d, '休養 (レース翌日。歩く程度)')); continue; }
    if (near.includes(-2) || near.includes(-3)) { rows.push(jog(d, 5, 'ジョグ5km (疲労抜き。5:45/km 以下)')); continue; }
    if (input.last_race && d < firstBuildDay) {
      const k = daysBetween(input.last_race, d);
      rows.push(k <= 2 ? rest(d, '休養 (レース後の回復)') : k % 2 === 1 ? jog(d, k <= 4 ? 5 : 8, 'ジョグ (疲労抜き。心拍を上げない)') : rest(d));
      continue;
    }

    // レース週 (D = 1..6) は固定の調整メニュー
    if (D <= 6) {
      if (D === 6 || D === 2) rows.push(rest(d, '休養'));
      else if (D === 5) rows.push(jog(d, 8, 'ジョグ8km (5:30〜5:45/km)'));
      else if (D === 4) rows.push({ date: d, type: 'm', distance_m: 8000, pace_min_s: null, pace_max_s: null, notes: `1km×4 (${mpTxt}/km 前後、間400mジョグ) + アップダウンで計8km。天気を見てペース決定` });
      else if (D === 3) rows.push(jog(d, 5, 'ジョグ5km + 流し100m×3'));
      continue;
    }

    // 通常週: 週の中の位置で決める
    const weeksOut = Math.floor(D / 7);
    const w = Math.floor(daysBetween(firstBuildDay > d ? d : firstBuildDay, d) / 7);
    let vol = weekVolume(base, Math.max(0, w));
    if (weeksOut === 2) vol = Math.min(vol, base * 0.85);
    if (weeksOut === 1) vol = Math.min(vol, base * 0.7);
    if (firstBuildDay > start && w === 0) vol *= 0.8;
    rows.push(buildDay(d, vol, weeksOut, w, { mp, mpTxt, ltTxt, settings }));
  }
  return rows;

  function jog(date: string, k: number, notes: string): PlanRow {
    return { date, type: 'jog', distance_m: m(k), pace_min_s: 330, pace_max_s: 345, notes };
  }
}

function buildDay(
  d: string, vol: number, weeksOut: number, w: number,
  c: { mp: number; mpTxt: string; ltTxt: string; settings: Settings },
): PlanRow {
  const dow = dayOfWeek(d);
  const speed = c.settings.paces.interval;
  const row = (type: PlanType, k: number, notes: string, band?: [number, number]): PlanRow => ({
    date: d, type, distance_m: m(k), pace_min_s: band?.[0] ?? null, pace_max_s: band?.[1] ?? null, notes,
  });
  switch (dow) {
    case 1: return rest(d, '休養');
    case 2: return row('easy', km(Math.max(6, vol * 0.13)), 'Easy。心拍を上げずに楽に (5:00〜5:45/km)');
    case 3: {
      const lt = weeksOut <= 8 || w % 2 === 0;
      const k = km(Math.max(8, vol * 0.17));
      if (lt) {
        const rep = k >= 12 ? 3 : 2;
        return row('lt', k, `LT走: アップ3km + 閾値 ${c.ltTxt}/km 前後 ${rep}km×2 (間2分ジョグ) + ダウン2km`, [c.settings.paces.lt.min, c.settings.paces.lt.max]);
      }
      const n = Math.max(5, Math.min(8, Math.round(k - 5)));
      return row('interval', k, `インターバル: アップ3km + 1km×${n} (${fmtPace(speed.min)}〜${fmtPace(speed.max)}/km、間400mジョグ) + ダウン2km`, [speed.min, speed.max]);
    }
    case 4: return row('easy', km(Math.max(6, vol * 0.12)), 'Easy。脚の張りを確認しながら (5:00〜5:45/km)');
    case 5: return vol >= 70 ? row('jog', 5, 'ジョグ5km (疲労抜き)', [330, 345]) : rest(d, '休養 (ハムのケア・補強)');
    case 6: {
      if (weeksOut <= 12) {
        const k = km(Math.max(10, vol * 0.2));
        const body = Math.max(5, Math.round(k - 6));
        return row('m', k, `Mペース走: アップ3km + 目標ペース ${c.mpTxt}/km を ${body}km + ダウン3km`, [Math.round(c.mp - 3), Math.round(c.mp + 3)]);
      }
      return row('easy', km(Math.max(8, vol * 0.15)), 'Easy。流し100m×4 を入れる');
    }
    default: {
      const peak = weeksOut >= 3 && weeksOut <= 6;
      let k = vol * (peak ? 0.42 : 0.34);
      if (weeksOut === 2) k = Math.min(k, 24);
      if (weeksOut === 1) k = Math.min(k, 18);
      k = km(Math.min(peak ? 32 : 28, Math.max(16, k)));
      const mpPart = weeksOut <= 8 && weeksOut >= 2 ? Math.max(6, Math.round(k * 0.45)) : 0;
      const notes = mpPart
        ? `ロング走 ${k}km: 前半はゆっくり、後半 ${mpPart}km を目標ペース ${c.mpTxt}/km。本番の靴・ジェル・朝食の予行`
        : `ロング走 ${k}km: 5:00〜5:20/km で一定。後半に疲れが出ても形を崩さない`;
      return row('long', k, notes);
    }
  }
}
