import { pickShoe, type ShoeRow } from './shoes';
import { evaluateRun, resolveTargets } from './evaluate';
import { addDays, daysBetween, fmtDuration, fmtKm, fmtPace, jstDate, weekStart } from './format';
import { notify } from './notify';
import { getSettings } from './settings';
import { raceWeather, weatherAdvice } from './weather';
import { getActivity, getGear, getStreams, RUN_TYPES, type StravaActivity } from './strava';
import { PLAN_LABELS, type Env, type Evaluation, type Plan } from './types';

interface IngestOptions {
  notify?: boolean;
  /** 手動で計画を割り当てる場合 (null で紐づけ解除) */
  planId?: number | null;
}

/** Strava のアクティビティを取り込み、評価・保存・通知する */
export async function ingestActivity(env: Env, id: number, opts: IngestOptions = {}): Promise<void> {
  const act = await getActivity(env, id);
  if (!RUN_TYPES.includes(act.sport_type)) {
    await deleteActivity(env, id);
    return;
  }
  const date = act.start_date_local.slice(0, 10);
  const existing = await env.DB.prepare('SELECT plan_id, notified_at FROM activities WHERE id = ?')
    .bind(id)
    .first<{ plan_id: number | null; notified_at: string | null }>();

  const linkedPlan =
    opts.planId !== undefined
      ? opts.planId == null
        ? null
        : await env.DB.prepare('SELECT * FROM plans WHERE id = ?').bind(opts.planId).first<Plan>()
      : await findPlan(env, id, date, act.distance, existing?.plan_id ?? null);
  const plan = linkedPlan;
  // 同じメニューに複数のワークアウト (アップ・本体・ダウン) が紐づくとき、短い付属ぶんは計画とは比べず単体で評価する
  let evalPlan = plan;
  if (plan?.distance_m) {
    const bigger = await env.DB.prepare('SELECT 1 AS x FROM activities WHERE plan_id = ? AND id != ? AND distance_m > ? LIMIT 1')
      .bind(plan.id, id, act.distance)
      .first();
    if (bigger && act.distance < plan.distance_m * 0.5) evalPlan = null;
  }

  const [streams, settings] = await Promise.all([getStreams(env, id), getSettings(env)]);
  const evaluation = evaluateRun(
    { distance_m: act.distance, moving_time_s: act.moving_time, laps: act.laps ?? [], streams },
    evalPlan,
    settings,
  );
  const shoeId = act.gear_id ? await ensureShoe(env, act) : null;

  await env.DB.prepare(
    `INSERT INTO activities (id, date, start_date_local, name, sport_type, workout_type, distance_m, moving_time_s,
       elapsed_time_s, avg_hr, max_hr, avg_cadence_spm, gear_id, shoe_id, plan_id, score, evaluation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET date = excluded.date, start_date_local = excluded.start_date_local,
       name = excluded.name, sport_type = excluded.sport_type, workout_type = excluded.workout_type,
       distance_m = excluded.distance_m, moving_time_s = excluded.moving_time_s, elapsed_time_s = excluded.elapsed_time_s,
       avg_hr = excluded.avg_hr, max_hr = excluded.max_hr, avg_cadence_spm = excluded.avg_cadence_spm,
       gear_id = excluded.gear_id, shoe_id = excluded.shoe_id, plan_id = excluded.plan_id,
       score = excluded.score, evaluation = excluded.evaluation`,
  )
    .bind(
      id,
      date,
      act.start_date_local,
      act.name,
      act.sport_type,
      act.workout_type ?? null,
      act.distance,
      act.moving_time,
      act.elapsed_time,
      act.average_heartrate ?? null,
      act.max_heartrate ?? null,
      act.average_cadence ? act.average_cadence * 2 : null,
      act.gear_id,
      shoeId,
      plan?.id ?? null,
      evaluation.score,
      JSON.stringify(evaluation),
    )
    .run();

  await linkRace(env, act, date);
  if (shoeId) await checkShoeLimit(env, shoeId);

  if (opts.notify && !existing?.notified_at) {
    const results = await notify(env, runNotification(env, act, plan, evaluation));
    // 送れなかったときは「通知済み」にしない (後の update イベントでやり直せる)
    if (results.some((r) => r.ok)) {
      await env.DB.prepare('UPDATE activities SET notified_at = ? WHERE id = ?').bind(new Date().toISOString(), id).run();
    }
  }
}

export async function deleteActivity(env: Env, id: number): Promise<void> {
  await env.DB.prepare('DELETE FROM activities WHERE id = ?').bind(id).run();
}

/** 同日の計画から選ぶ。1 つだけならそれ。複数あれば、まだ走っていない計画を優先して距離が近いもの (1 つの計画に複数のワークアウトを紐づけられる) */
async function findPlan(env: Env, activityId: number, date: string, distance: number, current: number | null) {
  const { results } = await env.DB.prepare(
    `SELECT p.* FROM plans p
     WHERE p.date = ? AND p.type != 'rest'
     ORDER BY EXISTS (SELECT 1 FROM activities a WHERE a.plan_id = p.id AND a.id != ?), p.id`,
  )
    .bind(date, activityId)
    .all<Plan>();
  if (current != null) {
    const keep = results.find((p) => p.id === current);
    if (keep) return keep;
  }
  if (results.length === 0) return null;
  if (results.length === 1) return results[0];
  return results.reduce((best, p) =>
    Math.abs((p.distance_m ?? distance) - distance) < Math.abs((best.distance_m ?? distance) - distance) ? p : best,
  );
}

async function ensureShoe(env: Env, act: StravaActivity): Promise<number> {
  const row = await env.DB.prepare('SELECT id FROM shoes WHERE strava_gear_id = ?').bind(act.gear_id).first<{ id: number }>();
  if (row) return row.id;
  // Strava 上の累計距離から、このアプリで管理していない過去分を初期距離として登録
  const gear = await getGear(env, act.gear_id!);
  const initialKm = Math.max(0, (gear.distance - act.distance) / 1000);
  const res = await env.DB.prepare('INSERT INTO shoes (name, strava_gear_id, initial_km) VALUES (?, ?, ?) RETURNING id')
    .bind(gear.name, act.gear_id, Math.round(initialKm * 10) / 10)
    .first<{ id: number }>();
  return res!.id;
}

export const SHOE_TOTAL_SQL = `SELECT s.*, s.initial_km + COALESCE((SELECT SUM(distance_m) FROM activities a WHERE a.shoe_id = s.id), 0) / 1000.0 AS total_km FROM shoes s`;

async function checkShoeLimit(env: Env, shoeId: number) {
  const shoe = await env.DB.prepare(`${SHOE_TOTAL_SQL} WHERE s.id = ?`)
    .bind(shoeId)
    .first<{ name: string; total_km: number; limit_km: number; alert_sent: number }>();
  if (!shoe || shoe.alert_sent || shoe.total_km < shoe.limit_km * 0.9) return;
  await notify(env, {
    title: `👟 ${shoe.name} が交換目安に近づいています`,
    message: `累計 ${shoe.total_km.toFixed(0)}km / 目安 ${shoe.limit_km}km`,
    tags: ['athletic_shoe'],
    click: `${env.APP_URL}/#/shoes`,
  });
  await env.DB.prepare('UPDATE shoes SET alert_sent = 1 WHERE id = ?').bind(shoeId).run();
}

/** レース当日・距離が近いアクティビティを結果として紐づける */
async function linkRace(env: Env, act: StravaActivity, date: string) {
  await env.DB.prepare(
    `UPDATE races SET activity_id = ?, result_time_s = ?
     WHERE date = ? AND activity_id IS NULL AND result_time_s IS NULL AND ABS(distance_m - ?) <= distance_m * 0.1`,
  )
    .bind(act.id, act.elapsed_time, date, act.distance)
    .run();
}

function runNotification(env: Env, act: StravaActivity, plan: Plan | null, ev: Evaluation) {
  const label = plan ? PLAN_LABELS[plan.type] : 'フリーラン';
  const medal = ev.score >= 85 ? 'trophy' : ev.score >= 70 ? 'white_check_mark' : 'warning';
  const lines = [
    `${fmtKm(act.distance, 2)}km ${fmtDuration(act.moving_time)} (${fmtPace(act.moving_time / (act.distance / 1000))}/km)`,
    `ペース ${ev.pace.score ?? '-'}: ${ev.pace.summary}`,
    `心拍 ${ev.hr.score ?? '-'}: ${ev.hr.summary}`,
    `ケイデンス ${ev.cadence.score ?? '-'}: ${ev.cadence.summary}`,
    '',
    ...ev.comments.map((c) => `・${c}`),
    ...(ev.focus?.length ? ['', '次に意識すること', ...ev.focus.map((c) => `→ ${c}`)] : []),
  ];
  return {
    title: `${ev.score}点 | ${label} ${fmtKm(act.distance)}km`,
    message: lines.join('\n'),
    tags: [medal],
    click: `${env.APP_URL}/#/activities/${act.id}`,
  };
}

// ---------------------------------------------------------------- 朝の通知

export async function morningBriefing(env: Env, today = jstDate()) {
  const settings = await getSettings(env);
  const { results: plans } = await env.DB.prepare('SELECT * FROM plans WHERE date = ? ORDER BY id').bind(today).all<Plan>();

  const lines: string[] = [];
  if (plans.length === 0) {
    lines.push('今日のメニューは未登録です。');
  }
  for (const p of plans) {
    if (p.type === 'rest') {
      lines.push('🛌 休養日。しっかり回復しましょう。');
      continue;
    }
    const { band, hrRange } = resolveTargets(p, settings);
    const parts = [`▶ ${PLAN_LABELS[p.type]}`];
    if (p.distance_m) parts.push(`${fmtKm(p.distance_m)}km`);
    if (band) parts.push(`${fmtPace(band.min)}-${fmtPace(band.max)}/km`);
    if (hrRange) parts.push(p.type === 'interval' ? `心拍 ${hrRange.min}+` : `心拍 ≤${hrRange.max}`);
    lines.push(parts.join(' '));
    if (p.notes) lines.push(`  ${p.notes}`);
  }

  const ws = weekStart(today);
  const week = await env.DB.prepare(
    `SELECT
       (SELECT COALESCE(SUM(distance_m), 0) FROM plans WHERE date BETWEEN ?1 AND ?2) AS planned,
       (SELECT COALESCE(SUM(distance_m), 0) FROM activities WHERE date BETWEEN ?1 AND ?3) AS done,
       (SELECT COALESCE(SUM(distance_m), 0) FROM activities WHERE date BETWEEN ?4 AND ?3) AS last7`,
  )
    .bind(ws, addDays(ws, 6), addDays(today, -1), addDays(today, -7))
    .first<{ planned: number; done: number; last7: number }>();
  if (week) {
    lines.push('', `今週 ${fmtKm(week.done)} / ${fmtKm(week.planned)}km・直近7日 ${fmtKm(week.last7)}km`);
  }

  const race = await env.DB.prepare('SELECT * FROM races WHERE date >= ? ORDER BY date LIMIT 1')
    .bind(today)
    .first<{ name: string; date: string; distance_m: number; goal_time_s: number | null }>();
  if (race) {
    const goal = race.goal_time_s ? ` 目標 ${fmtDuration(race.goal_time_s)} (${fmtPace(race.goal_time_s / (race.distance_m / 1000))}/km)` : '';
    lines.push(`🏁 ${race.name} まで ${daysBetween(today, race.date)}日${goal}`);
  }

  // 週の初め (月曜) は先週のまとめ、増やしすぎの警告、レース前は当日の天気
  const prev = addDays(today, -7);
  if (new Date(`${today}T00:00:00Z`).getUTCDay() === 1) {
    const w = await env.DB.prepare(
      `SELECT (SELECT COALESCE(SUM(distance_m), 0) FROM activities WHERE date BETWEEN ?1 AND ?2) AS done,
              (SELECT COALESCE(SUM(distance_m), 0) FROM plans WHERE date BETWEEN ?1 AND ?2) AS planned,
              (SELECT COALESCE(SUM(distance_m), 0) FROM activities WHERE date BETWEEN ?3 AND ?4) AS before,
              (SELECT COALESCE(MAX(distance_m), 0) FROM activities WHERE date BETWEEN ?1 AND ?2) AS longest`,
    )
      .bind(prev, addDays(prev, 6), addDays(prev, -7), addDays(prev, -1))
      .first<{ done: number; planned: number; before: number; longest: number }>();
    if (w) {
      lines.push('', `📊 先週 ${fmtKm(w.done)}km (計画 ${fmtKm(w.planned)}km)・最長 ${fmtKm(w.longest)}km`);
      if (w.before > 0 && w.done > w.before * 1.2) lines.push(`⚠️ 前の週より ${Math.round((w.done / w.before - 1) * 100)}% 増。ケガに注意して今週は抑えめに`);
    }
  }
  if (race && daysBetween(today, race.date) <= 14) {
    try {
      const w = await raceWeather(race.name, race.date);
      if (w) lines.push(`🌤 ${race.date.slice(5).replace('-', '/')} ${w.place} ${Math.round(w.tmin)}〜${Math.round(w.tmax)}℃・降水${w.precip_pct ?? '-'}%・風${w.wind_max.toFixed(0)}m/s。${weatherAdvice(w)}`);
    } catch (e) {
      console.warn('weather failed', e);
    }
  }

  const point = plans.find((p) => ['m', 'lt', 'interval', 'race'].includes(p.type));
  const { results: allShoes } = await env.DB.prepare(`SELECT * FROM (${SHOE_TOTAL_SQL})`).all<ShoeRow>();
  const todayType = (point ?? plans.find((p) => p.type !== 'rest'))?.type;
  const shoe = todayType ? pickShoe(allShoes, todayType) : null;
  if (shoe && plans.some((p) => p.type !== 'rest')) lines.push(`👟 ${shoe.name}`);

  const first = plans[0];
  return {
    title: `☀️ ${today.slice(5).replace('-', '/')} ${first ? (first.type === 'rest' ? '休養日' : PLAN_LABELS[first.type]) : 'メニュー未登録'}`,
    message: lines.join('\n'),
    tags: ['runner'],
    click: `${env.APP_URL}/#/`,
  };
}

export async function sendMorning(env: Env) {
  await notify(env, await morningBriefing(env));
}
