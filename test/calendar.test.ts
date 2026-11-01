import { describe, expect, it } from 'vitest';
import { buildIcs, foldLine, icsEscape } from '../src/calendar';
import type { Plan } from '../src/types';

const plan = (o: Partial<Plan>): Plan =>
  ({ id: 1, date: '2026-11-03', type: 'jog', distance_m: 8000, pace_min_s: null, pace_max_s: null, hr_max: null, notes: null, ...o }) as Plan;

describe('calendar', () => {
  it('escapes special characters', () => {
    expect(icsEscape('a,b;c\nd')).toBe('a\\,b\;c\\nd');
  });
  it('folds long lines without splitting UTF-8 characters', () => {
    const folded = foldLine('SUMMARY:' + 'あ'.repeat(60));
    for (const l of folded.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
    expect(folded.replace(/\r\n /g, '')).toBe('SUMMARY:' + 'あ'.repeat(60));
  });
  it('builds events, skipping rest days and including races', () => {
    const ics = buildIcs(
      [plan({}), plan({ id: 2, type: 'rest', date: '2026-11-02', distance_m: null })],
      [{ id: 5, name: '福岡マラソン', date: '2026-11-08', distance_m: 42195, goal_time_s: 11400, priority: 'A', notes: null }],
      new Date('2026-11-01T00:00:00Z'),
    );
    expect(ics).toContain('UID:plan-1@sub3-runner');
    expect(ics).not.toContain('plan-2@');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261108');
    expect(ics).toContain('DTEND;VALUE=DATE:20261109');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});
