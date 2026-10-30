/** 秒/km → "4:15" */
export function fmtPace(secPerKm: number | null | undefined): string {
  if (secPerKm == null || !isFinite(secPerKm)) return '-';
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 秒 → "2:59:30" / "45:10" */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec == null) return '-';
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function fmtKm(m: number | null | undefined, digits = 1): string {
  if (m == null) return '-';
  return (m / 1000).toFixed(digits);
}

/** "4:15" / "2:59:30" → 秒 */
export function parseDuration(text: string): number | null {
  const parts = text.trim().split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** JST の日付文字列 YYYY-MM-DD */
export function jstDate(d: Date = new Date()): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** その日を含む週の月曜日 */
export function weekStart(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0=日
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000);
}
