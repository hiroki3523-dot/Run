import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, fmtDuration, fmtPace, jstDate, parseDuration, weekStart } from '../src/format';

describe('format', () => {
  it('ペースと時間の表示', () => {
    expect(fmtPace(255)).toBe('4:15');
    expect(fmtDuration(10799)).toBe('2:59:59');
    expect(fmtDuration(2710)).toBe('45:10');
    expect(parseDuration('2:59:30')).toBe(10770);
    expect(parseDuration('4:15')).toBe(255);
    expect(parseDuration('abc')).toBeNull();
  });
  it('JST の日付', () => {
    // 22:30 UTC は翌日 7:30 JST
    expect(jstDate(new Date('2026-10-30T22:30:00Z'))).toBe('2026-10-31');
  });
  it('週の計算 (月曜始まり)', () => {
    expect(weekStart('2026-11-01')).toBe('2026-10-26'); // 日曜
    expect(weekStart('2026-10-26')).toBe('2026-10-26'); // 月曜
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-10-31', '2027-02-28')).toBe(120);
  });
});
