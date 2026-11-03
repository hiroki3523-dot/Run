import { addDays, daysBetween, fmtPace } from './format';
import type { PlanType, Settings } from './types';

export interface PlannerRace {
  date: string;
  name: string;
  distance_m: number;
  goal_time_s: number | null;
  /** A: 本命 / B: 重要 / C: 練習の一部 */
  priority?: string | null;
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
  /** start が週の途中のとき、その週にすでに走った分 (残りの週メニューを作り直す用) */
  week_done?: { km: number; points: number; long: boolean };
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
  const pending = new Map<string, { date: string; vol: number; weeksOut: number; w: number }[]>();
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
    // 他レースの前後: 優先度で調整の長さを変える (A/B は前 2 日・後 3 日、C は前日と翌日だけ軽く)
    const near = others.concat([race]).map((o) => ({ k: daysBetween(d, o.date), c: (o.priority ?? 'B') === 'C', half: o.distance_m < 30000 }));
    const hit = (k: number, cOk = true) => near.some((x) => x.k === k && (cOk || !x.c));
    if (hit(1)) { rows.push(jog(d, 3, 'ジョグ3km + 補給・ゼッケン確認')); continue; }
    if (hit(2, false)) { rows.push(rest(d, '休養 (レース2日前)')); continue; }
    if (hit(-1)) { rows.push(near.some((x) => x.k === -1 && x.c && x.half) ? jog(d, 5, 'ジョグ5km (C レース翌日。疲労抜き)') : rest(d, '休養 (レース翌日。歩く程度)')); continue; }
    if (near.some((x) => (x.k === -2 || x.k === -3) && !(x.c && x.half))) { rows.push(jog(d, 5, 'ジョグ5km (疲労抜き。5:45/km 以下)')); continue; }
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
    const key = weekStartOf(d);
    const g = pending.get(key) ?? [];
    g.push({ date: d, vol, weeksOut, w });
    pending.set(key, g);
  }
  let first = true;
  for (const [key, days] of [...pending].sort(([a], [b]) => a.localeCompare(b))) {
    const done = first && input.week_done && days[0].date > key ? input.week_done : undefined;
    first = false;
    rows.push(...buildWeek(days, { mp, mpTxt, ltTxt, settings, done }));
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date));

  function jog(date: string, k: number, notes: string): PlanRow {
    return { date, type: 'jog', distance_m: m(k), pace_min_s: 330, pace_max_s: 345, notes };
  }
}

/** 月曜はじまりの週の開始日 */
function weekStartOf(d: string): string {
  const dow = dayOfWeek(d);
  return addDays(d, -((dow + 6) % 7));
}
const monIndex = (d: string) => (dayOfWeek(d) + 6) % 7; // 月=0 … 日=6

interface WeekCtx {
  mp: number; mpTxt: string; ltTxt: string; settings: Settings;
  done?: { km: number; points: number; long: boolean };
}

/**
 * 1 週間ぶんの役割を決める。
 * 休養日・予定ありの日を除いた「走れる日」に、ロング走 → ポイント練習 → Easy の順で割り当てる。
 */
function buildWeek(days: { date: string; vol: number; weeksOut: number; w: number }[], c: WeekCtx): PlanRow[] {
  const prefs = c.settings.plan_prefs;
  const { weeksOut, w } = days[0];
  let vol = days[0].vol;
  if (c.done) vol = Math.max(vol * 0.3, vol - c.done.km);
  const out: PlanRow[] = [];
  const open: string[] = [];
  for (const { date } of days) {
    if (prefs.blocked.includes(date)) out.push(rest(date, '休養 (予定があり走れない日)'));
    else if (prefs.rest_days.includes(dayOfWeek(date))) out.push(rest(date, '休養日'));
    else open.push(date);
  }
  if (open.length === 0) return out;

  // ロング走: 希望の曜日。使えなければ一番近い走れる日
  const hard: string[] = [];
  let longDay: string | null = null;
  let nLong = Math.min(3, Math.max(0, prefs.long_per_week));
  if (c.done?.long) nLong = Math.max(0, nLong - 1);
  if (nLong > 0) {
    const want = (prefs.long_day + 6) % 7;
    longDay = [...open].sort((a, b) => Math.abs(monIndex(a) - want) - Math.abs(monIndex(b) - want) || monIndex(b) - monIndex(a))[0];
    hard.push(longDay);
  }
  // 2・3 回目のロング走: ほかのロングからいちばん離れた日 (距離は短め)
  const extraLongs: string[] = [];
  if (longDay) {
    // 週をまたいでも近くならないよう、曜日の差は一周 (7 日) で測る
    const cgap = (a: string, b: string) => { const g = Math.abs(monIndex(a) - monIndex(b)); return Math.min(g, 7 - g); };
    while (1 + extraLongs.length < nLong) {
      const taken = [longDay, ...extraLongs];
      const cand = open.filter((d) => !taken.includes(d));
      if (cand.length <= 1) break; // 1 日は Easy か休みに残す
      const gap = (d: string) => Math.min(...taken.map((x) => cgap(d, x)));
      cand.sort((a, b) => gap(b) - gap(a) || monIndex(a) - monIndex(b));
      extraLongs.push(cand[0]);
      hard.push(cand[0]);
    }
  }
  // ポイント練習: すでにある硬い日からできるだけ離す。同点なら水・土・火・木の順
  const PREF = [2, 5, 1, 3, 0, 4, 6];
  let nPoints = Math.min(3, Math.max(0, prefs.points_per_week));
  if (weeksOut <= 1) nPoints = Math.min(nPoints, 2);
  if (c.done) nPoints = Math.max(0, nPoints - c.done.points);
  const points: string[] = [];
  while (points.length < nPoints) {
    const cand = open.filter((d) => !hard.includes(d) && !points.includes(d));
    if (cand.length === 0) break;
    const score = (d: string) => {
      const gap = Math.min(3, ...[...hard, ...points].map((x) => { const g = Math.abs(monIndex(x) - monIndex(d)); return Math.min(g, 7 - g); }));
      return gap * 10 + (7 - PREF.indexOf(monIndex(d)));
    };
    cand.sort((a, b) => score(b) - score(a));
    points.push(cand[0]);
  }
  points.sort();

  // 種別: 最初は LT/インターバル、最後は M ペース走 (本番に近い時期)
  const A: PlanType = weeksOut <= 8 || w % 2 === 0 ? 'lt' : 'interval';
  const B: PlanType = weeksOut <= 12 ? 'm' : A === 'lt' ? 'interval' : 'lt';
  const Cc: PlanType = A === 'lt' ? 'interval' : 'lt';
  const seq: PlanType[] = points.length === 1 ? [w % 2 === 0 ? A : B] : points.length === 2 ? [A, B] : [A, Cc, B];

  const rowFor = (d: string, type: PlanType): PlanRow => qualityRow(d, type, vol, c);
  const longRow = longDay ? longRunRow(longDay, vol, weeksOut, c) : null;
  const extraRows: PlanRow[] = longRow ? extraLongs.map((d, j) => {
    const k = km(Math.max(14, ((longRow.distance_m ?? 0) / 1000) * (j === 0 ? 0.7 : 0.6)));
    return { date: d, type: 'long', distance_m: m(k), pace_min_s: null, pace_max_s: null, notes: `ロング走 (${j + 2}本目) ${k}km: 5:00〜5:20/km で一定。1本目より短め` };
  }) : [];
  const pointRows = points.map((d, i) => rowFor(d, seq[i]));
  const used = (longRow?.distance_m ?? 0) + extraRows.reduce((a, r) => a + (r.distance_m ?? 0), 0) + pointRows.reduce((a, r) => a + (r.distance_m ?? 0), 0);

  // 休養日: ロング走の翌日とポイント走の前日を優先して、回数ぶんを自動で選ぶ
  const restN = Math.min(Math.round((prefs.rest_per_week ?? 0) * days.length / 7), Math.max(0, open.length - 1 - (longDay ? 1 : 0) - extraLongs.length - points.length));
  const autoRest: string[] = [];
  const afterLong = longDay ? addDays(longDay, 1) : null;
  while (autoRest.length < restN) {
    const cand = open.filter((d) => d !== longDay && !extraLongs.includes(d) && !points.includes(d) && !autoRest.includes(d));
    if (cand.length === 0) break;
    const sc = (d: string) => (d === afterLong ? 10 : 0) + (points.some((x) => addDays(x, -1) === d) ? 6 : 0) + (points.some((x) => addDays(x, 1) === d) ? 3 : 0) - (autoRest.some((x) => Math.abs(monIndex(x) - monIndex(d)) <= 1) ? 8 : 0);
    cand.sort((a, b) => sc(b) - sc(a) || monIndex(a) - monIndex(b));
    autoRest.push(cand[0]);
  }
  for (const d of autoRest) out.push(rest(d, '休養日'));
  const easyDays = open.filter((d) => d !== longDay && !extraLongs.includes(d) && !points.includes(d) && !autoRest.includes(d));
  const easyKm = easyDays.length ? Math.min(14, Math.max(5, (vol * 1000 - used) / 1000 / easyDays.length)) : 0;
  for (const d of easyDays) {
    const k = km(easyKm);
    out.push(k < 6
      ? { date: d, type: 'jog', distance_m: m(k), pace_min_s: 330, pace_max_s: 345, notes: `ジョグ${k}km (疲労抜き)` }
      : { date: d, type: 'easy', distance_m: m(k), pace_min_s: null, pace_max_s: null, notes: 'Easy。心拍を上げずに楽に (5:00〜5:45/km)' });
  }
  if (longRow) out.push(longRow);
  out.push(...extraRows);
  out.push(...pointRows);
  return out;
}

function qualityRow(d: string, type: PlanType, vol: number, c: WeekCtx): PlanRow {
  const speed = c.settings.paces.interval;
  const row = (t: PlanType, k: number, notes: string, band?: [number, number]): PlanRow => ({
    date: d, type: t, distance_m: m(k), pace_min_s: band?.[0] ?? null, pace_max_s: band?.[1] ?? null, notes,
  });
  if (type === 'm') {
    const k = km(Math.max(10, vol * 0.2));
    const body = Math.max(5, Math.round(k - 6));
    return row('m', k, `Mペース走: アップ3km + 目標ペース ${c.mpTxt}/km を ${body}km + ダウン3km`, [Math.round(c.mp - 3), Math.round(c.mp + 3)]);
  }
  const k = km(Math.max(8, vol * 0.17));
  if (type === 'lt') {
    const rep = k >= 12 ? 3 : 2;
    return row('lt', k, `LT走: アップ3km + 閾値 ${c.ltTxt}/km 前後 ${rep}km×2 (間2分ジョグ) + ダウン2km`, [c.settings.paces.lt.min, c.settings.paces.lt.max]);
  }
  const n = Math.max(5, Math.min(8, Math.round(k - 5)));
  return row('interval', k, `インターバル: アップ3km + 1km×${n} (${fmtPace(speed.min)}〜${fmtPace(speed.max)}/km、間400mジョグ) + ダウン2km`, [speed.min, speed.max]);
}

function longRunRow(d: string, vol: number, weeksOut: number, c: WeekCtx): PlanRow {
  const peak = weeksOut >= 3 && weeksOut <= 6;
  let k = vol * (peak ? 0.42 : 0.34);
  if (weeksOut === 2) k = Math.min(k, 24);
  if (weeksOut === 1) k = Math.min(k, 18);
  k = km(Math.min(peak ? 32 : 28, Math.max(16, k)));
  const mpPart = weeksOut <= 8 && weeksOut >= 2 ? Math.max(6, Math.round(k * 0.45)) : 0;
  const notes = mpPart
    ? `ロング走 ${k}km: 前半はゆっくり、後半 ${mpPart}km を目標ペース ${c.mpTxt}/km。本番の靴・ジェル・朝食の予行`
    : `ロング走 ${k}km: 5:00〜5:20/km で一定。後半に疲れが出ても形を崩さない`;
  return { date: d, type: 'long', distance_m: m(k), pace_min_s: null, pace_max_s: null, notes };
}
