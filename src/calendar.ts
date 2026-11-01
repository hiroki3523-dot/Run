import { addDays, fmtKm, fmtPace } from './format';
import { PLAN_LABELS, type Env, type Plan } from './types';

export interface CalRace {
  id: number;
  name: string;
  date: string;
  distance_m: number;
  goal_time_s: number | null;
  priority: string;
  notes: string | null;
}

const enc = new TextEncoder();

/** APP_TOKEN から作る購読用の署名。URL に入れるので、トークンそのものは載せない。 */
export async function calendarSig(env: Env): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.APP_TOKEN), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode('calendar-feed-v1'));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/** ICS のテキスト値のエスケープ */
export const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** 75 バイトを超える行を折り返す (UTF-8 の文字を分断しない) */
export function foldLine(line: string): string {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
      limit = 74; // 継続行は先頭の空白 1 バイト分を引く
    }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const ymd = (d: string) => d.replace(/-/g, '');

function planEvent(p: Plan, stamp: string): string[] {
  const label = PLAN_LABELS[p.type];
  const km = p.distance_m ? ` ${fmtKm(p.distance_m)}km` : '';
  const desc: string[] = [];
  if (p.pace_min_s && p.pace_max_s) desc.push(`ペース ${fmtPace(p.pace_min_s)}-${fmtPace(p.pace_max_s)}/km`);
  if (p.hr_max) desc.push(`心拍 ≤${p.hr_max}`);
  if (p.notes) desc.push(p.notes);
  return [
    'BEGIN:VEVENT',
    `UID:plan-${p.id}@sub3-runner`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(p.date)}`,
    `DTEND;VALUE=DATE:${ymd(addDays(p.date, 1))}`,
    `SUMMARY:${icsEscape(`🏃 ${label}${km}`)}`,
    ...(desc.length ? [`DESCRIPTION:${icsEscape(desc.join('\n'))}`] : []),
    'TRANSP:TRANSPARENT',
    'END:VEVENT',
  ];
}

function raceEvent(r: CalRace, stamp: string): string[] {
  const desc = [`優先度 ${r.priority}`, ...(r.goal_time_s ? [`目標 ${fmtGoal(r.goal_time_s)}`] : []), ...(r.notes ? [r.notes] : [])];
  return [
    'BEGIN:VEVENT',
    `UID:race-${r.id}@sub3-runner`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${ymd(r.date)}`,
    `DTEND;VALUE=DATE:${ymd(addDays(r.date, 1))}`,
    `SUMMARY:${icsEscape(`🏁 ${r.name}`)}`,
    `DESCRIPTION:${icsEscape(desc.join('\n'))}`,
    'END:VEVENT',
  ];
}

function fmtGoal(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** 計画 (休養日を除く) とレースを終日予定として並べた ICS を作る */
export function buildIcs(plans: Plan[], races: CalRace[], now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//sub3-runner//JA',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:STRIDE',
    'X-WR-TIMEZONE:Asia/Tokyo',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...plans.filter((p) => p.type !== 'rest').flatMap((p) => planEvent(p, stamp)),
    ...races.flatMap((r) => raceEvent(r, stamp)),
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
