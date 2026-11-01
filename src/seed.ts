import type { Env } from './types';

type Race = [name: string, date: string, goal: number | null, priority: string, notes: string];
type PlanRow = [date: string, type: string, dist: number | null, pmin: number | null, pmax: number | null, notes: string];

const RACES: Race[] = [
  ['福岡マラソン', '2026-11-08', 11400, 'A', '3:10切り。等ペース4:30〜4:35/km。スタート8:20'],
  ['青島太平洋マラソン', '2026-12-13', null, 'B', '調整'],
  ['長崎ミュージックフェスマラソン', '2027-01-31', null, 'C', '調整'],
  ['熊本城マラソン', '2027-02-21', 10800, 'A', 'サブ3本命'],
  ['佐賀さくらマラソン', '2027-03-21', 10800, 'B', 'サブ3予備 (PB 3:24:16 の大会)'],
];

const PLANS: PlanRow[] = [
  ['2026-10-26', 'rest', null, null, null, '完全休養'],
  ['2026-10-27', 'rest', null, null, null, '完全休養'],
  ['2026-10-28', 'lt', 8000, null, null, '閾値走 2km×2 (4:15前後)'],
  ['2026-10-29', 'jog', 5000, null, null, '休養またはジョグ'],
  ['2026-10-30', 'jog', 10000, 330, 345, 'ジョグ10km (5:30〜5:45) + 流し100m×3'],
  ['2026-10-31', 'rest', null, null, null, '休養 (脚が軽ければ5kmジョグ可)'],
  ['2026-11-01', 'long', 18000, null, null, 'アップ4km + 目標ペース10km (4:30〜4:35) + ダウン4km。本番靴・ジェル・朝食の予行'],
  ['2026-11-02', 'rest', null, null, null, '休養'],
  ['2026-11-03', 'jog', 8000, 330, 345, 'ジョグ8km (5:30〜5:45)'],
  ['2026-11-04', 'm', 8000, null, null, '1km×4 (4:30前後、間400mジョグ) + アップダウンで計8km。天気を見てペース決定'],
  ['2026-11-05', 'jog', 5000, 330, 345, 'ジョグ5km + 流し100m×3'],
  ['2026-11-06', 'rest', null, null, null, '休養'],
  ['2026-11-07', 'jog', 3000, 330, 345, 'ジョグ3km + 補給・ゼッケン確認'],
  ['2026-11-08', 'race', 42195, 270, 275, '福岡マラソン 4:30〜4:35/km等ペース。30kmまで死守。ジェルは時間で摂る'],
];

/** レースと福岡までの計画を登録する。同じ日付がすでにあれば追加しない (何度押しても安全) */
export async function seedInitial(env: Env): Promise<{ races: number; plans: number }> {
  const raceIns = env.DB.prepare(
    `INSERT INTO races (name, date, distance_m, goal_time_s, priority, notes)
     SELECT ?1, ?2, 42195, ?3, ?4, ?5 WHERE NOT EXISTS (SELECT 1 FROM races WHERE date = ?2)`,
  );
  const planIns = env.DB.prepare(
    `INSERT INTO plans (date, type, distance_m, pace_min_s, pace_max_s, notes)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE NOT EXISTS (SELECT 1 FROM plans WHERE date = ?1)`,
  );
  const res = await env.DB.batch([...RACES.map((r) => raceIns.bind(...r)), ...PLANS.map((p) => planIns.bind(...p))]);
  const added = (from: number, n: number) => res.slice(from, from + n).reduce((s, r) => s + (r.meta.changes ?? 0), 0);
  return { races: added(0, RACES.length), plans: added(RACES.length, PLANS.length) };
}
