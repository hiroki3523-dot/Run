/**
 * 評価の基準 (ペース帯・最大心拍・閾値心拍) を、COROS / Strava のデータから決める。
 * - 閾値ペース: COROS があればその値、無ければフル予測ペース × 0.93 (フル予測 4:27/km → 4:08)
 * - ゾーン: COROS のゾーン、無ければ閾値ペースからの比率 (COROS と同じ比率)
 * - M ペース・レース: 次のレースの目標ペース (無ければフル予測ペース)
 * - 最大心拍: 直近 1 年の記録の最大 (ベルトの異常値を避けて 2 番目に高い値)
 */
import type { PaceBand, Settings } from './types';

export interface DeriveIn {
  st: Settings;
  predicted_full_s: number | null;
  goal_pace_s: number | null;
  observed_max_hr: number | null;
}
export interface DeriveOut { paces: Settings['paces']; max_hr: number; lthr: number; source: string; lt_pace_s: number }

const b = (min: number, max: number): PaceBand => ({ min: Math.round(Math.min(min, max)), max: Math.round(Math.max(min, max)) });

export function deriveSettings(i: DeriveIn): DeriveOut {
  const c = i.st.coros;
  const fromCoros = i.st.predict?.source === 'coros' || i.st.source === 'coros';
  const fullPace = i.predicted_full_s ? i.predicted_full_s / 42.195 : null;
  const lt = fromCoros && c?.lt_pace_s ? c.lt_pace_s : fullPace ? Math.round(fullPace * 0.93) : c.lt_pace_s;
  const z = fromCoros && c?.zones_s?.aerobic && c.zones_s.threshold && c.zones_s.speed
    ? c.zones_s
    : { aerobic: [Math.round(lt * 1.154) + 1, Math.round(lt * 1.397)], threshold: [Math.round(lt * 0.98) + 1, Math.round(lt * 1.073)], speed: [Math.round(lt * 0.899) + 1, Math.round(lt * 0.98)] };
  const mp = i.goal_pace_s ?? fullPace ?? lt * 1.08;
  const paces: Settings['paces'] = {
    easy: b(z.aerobic[0], z.aerobic[1]),
    jog: b(z.aerobic[1], z.aerobic[1] + 45),
    long: b(z.aerobic[0] - 1, z.aerobic[0] + 29),
    m: b(mp - 3, mp + 3),
    lt: b(lt - 4, lt + 4),
    interval: b(z.speed[0], z.speed[1]),
    race: b(mp - 3, mp + 2),
  };
  return {
    paces,
    max_hr: i.observed_max_hr && i.observed_max_hr > 150 && i.observed_max_hr < 230 ? Math.round(i.observed_max_hr) : i.st.max_hr,
    lthr: fromCoros && c?.lthr ? c.lthr : i.st.lthr,
    lt_pace_s: lt,
    source: fromCoros ? 'COROS' : i.st.predict?.source === 'manual' ? '入力した予測タイム' : 'Strava の記録',
  };
}
