import type { PlanType } from './types';

export const SHOE_PURPOSES = ['easy', 'recovery', 'long', 'pace', 'speed', 'race'] as const;
const LEGACY: Record<string, string[]> = { daily: ['easy', 'recovery', 'long'], workout: ['pace', 'speed'] };

/** 保存値 (カンマ区切り。古い daily / workout も読める) → 用途の配列 */
export function purposesOf(v: string | null | undefined): string[] {
  const out = new Set<string>();
  for (const p of (v ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
    for (const q of LEGACY[p] ?? [p]) if ((SHOE_PURPOSES as readonly string[]).includes(q)) out.add(q);
  }
  return [...out];
}

export function cleanPurposes(v: unknown): string {
  const list = purposesOf(Array.isArray(v) ? v.join(',') : String(v ?? ''));
  return (list.length ? list : ['easy']).join(',');
}

/** 計画の種類ごとに、向いている用途 (先ほど優先) */
export const SHOE_PREF: Partial<Record<PlanType, string[]>> = {
  easy: ['easy', 'recovery', 'long'],
  jog: ['recovery', 'easy'],
  long: ['long', 'easy'],
  m: ['pace', 'race', 'speed'],
  lt: ['pace', 'speed', 'race'],
  interval: ['speed', 'pace', 'race'],
  race: ['race'],
};

export interface ShoeRow { name: string; purpose: string; retired: number; total_km: number; limit_km: number }

/** 用途が合う順 → 走行距離の少ない順 */
export function pickShoe<T extends ShoeRow>(shoes: T[], type: PlanType): T | null {
  const pool = shoes.filter((s) => !s.retired && s.total_km < s.limit_km);
  for (const pu of SHOE_PREF[type] ?? ['easy']) {
    const c = pool.filter((s) => purposesOf(s.purpose).includes(pu)).sort((a, b) => a.total_km / a.limit_km - b.total_km / b.limit_km)[0];
    if (c) return c;
  }
  return null;
}
