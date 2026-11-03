import { deriveSettings } from './derive';
import { predictFromRuns } from './insights';
import { getSettings, saveSettings } from './settings';
import type { Env } from './types';

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

/** データから評価の基準を決めて保存する。force=false なら「自動」のときだけ */
export async function applyDerived(env: Env, force: boolean) {
  const st = await getSettings(env);
  if (!force && st.paces_auto === false) return null;
  const today = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const [runs, mx, race] = await Promise.all([
    env.DB.prepare('SELECT date, distance_m, moving_time_s, avg_hr, avg_cadence_spm, NULL AS plan_type, NULL AS role, NULL AS drift_pct FROM activities WHERE date >= ?').bind(addDays(today, -56)).all<any>(),
    env.DB.prepare('SELECT max_hr FROM activities WHERE date >= ? AND max_hr IS NOT NULL ORDER BY max_hr DESC LIMIT 2').bind(addDays(today, -365)).all<{ max_hr: number }>(),
    env.DB.prepare("SELECT distance_m, goal_time_s FROM races WHERE date >= ? AND goal_time_s IS NOT NULL AND COALESCE(status, 'confirmed') != 'candidate' ORDER BY date LIMIT 1").bind(today).first<{ distance_m: number; goal_time_s: number }>(),
  ]);
  const src = st.predict?.source ?? 'auto';
  const predicted = src === 'coros' ? st.coros?.predicted_s?.full ?? null : src === 'manual' ? st.predict?.full_s ?? null : predictFromRuns(runs.results, st.max_hr || 190, today)?.full_s ?? null;
  const hr = mx.results.map((r) => r.max_hr);
  const d = deriveSettings({
    st, predicted_full_s: predicted,
    goal_pace_s: race ? race.goal_time_s / (race.distance_m / 1000) : null,
    observed_max_hr: hr.length >= 2 ? hr[1] : hr[0] ?? null,
  });
  await saveSettings(env, { ...st, paces: d.paces, max_hr: d.max_hr, lthr: d.lthr, paces_auto: force ? true : st.paces_auto });
  return d;
}
