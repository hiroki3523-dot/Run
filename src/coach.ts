/**
 * 予定の相談 (AI コーチ)。Cloudflare Workers AI (無料枠) で、
 * 体の状態や都合を聞いて、返事と「計画の変更案」を返す。変更はユーザーが確かめてから反映する。
 */
import { addDays } from './format';
import { normalizeFb } from './runreview';
import { getSettings, kvGet } from './settings';
import { PLAN_LABELS, PLAN_TYPES, type Env, type PlanType } from './types';

export const COACH_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export interface CoachMsg { role: 'user' | 'assistant'; content: string }
export interface CoachChange { date: string; type: PlanType; distance_km: number | null; pace: string | null; notes: string }
export interface CoachReply { reply: string; changes: CoachChange[] }

const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const dow = (d: string) => DOW[new Date(`${d}T00:00:00Z`).getUTCDay()];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const hms = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const jstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

/** AI に渡す、いまの状況 (計画・実績・ふりかえり・レース・ペース) */
export async function coachContext(env: Env): Promise<string> {
  const t = jstToday();
  const s = await getSettings(env);
  const [plans, acts, races] = await Promise.all([
    env.DB.prepare('SELECT date, type, distance_m, pace_min_s, pace_max_s, notes FROM plans WHERE date BETWEEN ? AND ? ORDER BY date, id').bind(addDays(t, -7), addDays(t, 20)).all<any>(),
    env.DB.prepare("SELECT id, date, distance_m, moving_time_s, avg_hr, score FROM activities WHERE date BETWEEN ? AND ? AND sport_type LIKE '%Run%' ORDER BY date, start_date_local").bind(addDays(t, -21), t).all<any>(),
    env.DB.prepare('SELECT name, date, distance_m, goal_time_s, priority FROM races WHERE date >= ? ORDER BY date LIMIT 3').bind(t).all<any>(),
  ]);
  const fbs = await Promise.all(acts.results.slice(-10).map(async (a: any) => [a.id, await kvGet(env, `fb:${a.id}`)] as const));
  const fbOf = new Map(fbs.filter(([, v]) => v).map(([id, v]) => [id, normalizeFb(JSON.parse(v!))]));

  const L: string[] = [];
  L.push(`今日: ${t}(${dow(t)})`);
  L.push('レース: ' + (races.results.length ? races.results.map((r: any) => `${r.name} ${r.date}(${dow(r.date)}) ${(r.distance_m / 1000).toFixed(1)}km 目標${r.goal_time_s ? hms(r.goal_time_s) : 'なし'} 優先度${r.priority}・あと${Math.round((Date.parse(r.date) - Date.parse(t)) / 86400_000)}日`).join(' / ') : 'なし'));
  L.push('ペース帯 (/km): ' + (['easy', 'jog', 'long', 'm', 'lt', 'interval'] as const).map((k) => `${PLAN_LABELS[k]} ${mmss(s.paces[k].min)}-${mmss(s.paces[k].max)}`).join('、'));
  if (s.coros?.updated) L.push(`COROS: ランニングレベル ${s.coros.running_level}・閾値ペース ${s.coros.lt_pace_s ? mmss(s.coros.lt_pace_s) : '-'}/km・フル予測 ${s.coros.predicted_s?.full ? hms(s.coros.predicted_s.full) : '-'}`);
  L.push(`最大心拍 ${s.max_hr}・閾値心拍 ${s.lthr}`);
  L.push('', '計画 (先週〜3週間後):');
  for (const p of plans.results) {
    L.push(`- ${p.date}(${dow(p.date)}) ${PLAN_LABELS[p.type as PlanType] ?? p.type}${p.distance_m ? ` ${(p.distance_m / 1000).toFixed(1)}km` : ''}${p.pace_min_s ? ` ${mmss(p.pace_min_s)}-${mmss(p.pace_max_s)}/km` : ''}${p.notes ? ` (${String(p.notes).slice(0, 40)})` : ''}`);
  }
  if (!plans.results.length) L.push('- なし');
  L.push('', '実績 (直近3週間):');
  for (const a of acts.results) {
    const fb = fbOf.get(a.id);
    const fbt = fb ? ` ふりかえり[脚の重さ${fb.leg ?? '-'}/10・痛み${fb.pain ?? '-'}/10・きつさ${fb.rpe ?? '-'}/10${fb.memo ? `・メモ「${fb.memo.slice(0, 60)}」` : ''}]` : '';
    L.push(`- ${a.date}(${dow(a.date)}) ${(a.distance_m / 1000).toFixed(1)}km ${mmss(a.moving_time_s / (a.distance_m / 1000))}/km${a.avg_hr ? ` 心拍${Math.round(a.avg_hr)}` : ''}${fbt}`);
  }
  if (!acts.results.length) L.push('- なし');
  const wk = (from: number) => acts.results.filter((a: any) => a.date > addDays(t, -from - 7) && a.date <= addDays(t, -from)).reduce((x: number, a: any) => x + a.distance_m, 0) / 1000;
  L.push(`直近7日 ${wk(0).toFixed(0)}km・その前の7日 ${wk(7).toFixed(0)}km`);
  return L.join('\n');
}

const SYSTEM = `あなたはマラソンのランニングコーチです。日本語で、ランナー本人に話しかけます。
下の「状況」(計画・実績・ふりかえり・レース) を読んで、相談に答え、必要なら計画の変更案を出します。

答え方:
- 結論を先に。3〜6 文、具体的な数字 (km・ペース・日付) を入れる。前置きや励ましの決まり文句はいらない
- 痛み: 鋭い痛み・腫れ・走ると悪化する痛みは休養を優先し、数日続くなら整形外科やスポーツ外来の受診をすすめる。違和感程度なら距離と強度を落とす
- 疲れ: ポイント練を後ろへずらすか Easy/Jog に落とす。疲れが強ければ休養
- 走り足りない: 週の距離が先週の 1.1 倍を超えない範囲で Easy を延ばす。レース 2 週間前からは増やさない
- 今日走れない: その週のポイント練とロング走を優先して残し、Easy を削るか移す。ポイント練を連日にしない
- レースが近い (14 日以内) ときは疲労を抜くことを優先する

変更案 (changes):
- 今日以降の日付だけ。変える日だけを書く (変えない日は書かない)。最大 14 日
- type は easy / jog / long / m / lt / interval / rest のどれか。休みにする日は rest
- distance_km は数字 (rest は null)。pace は "4:30-4:40" の形か null。notes は 30 字以内のメニュー説明
- 相談が質問だけで計画を変える必要がなければ changes は空の配列

必ず次の JSON だけを返す: {"reply": "返事の文章", "changes": [{"date": "YYYY-MM-DD", "type": "easy", "distance_km": 8, "pace": "5:20-5:40", "notes": "..."}]}`;

const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          type: { type: 'string', enum: PLAN_TYPES.filter((x) => x !== 'race') },
          distance_km: { type: ['number', 'null'] },
          pace: { type: ['string', 'null'] },
          notes: { type: 'string' },
        },
        required: ['date', 'type'],
      },
    },
  },
  required: ['reply', 'changes'],
};

/** AI の返事から JSON を取り出す (文字列でもオブジェクトでも) */
export function parseCoach(raw: unknown, today: string): CoachReply {
  let o: any = raw;
  if (typeof raw === 'string') {
    const m = raw.match(/\{[\s\S]*\}/);
    try { o = m ? JSON.parse(m[0]) : null; } catch { o = null; }
    if (!o) return { reply: raw.trim() || 'うまく答えられませんでした。もう一度送ってください。', changes: [] };
  }
  const changes: CoachChange[] = (Array.isArray(o?.changes) ? o.changes : [])
    .filter((c: any) => /^\d{4}-\d{2}-\d{2}$/.test(c?.date) && c.date >= today && c.date <= addDays(today, 30) && PLAN_TYPES.includes(c.type) && c.type !== 'race')
    .slice(0, 14)
    .map((c: any) => {
      const d = Number(c.distance_km);
      return {
        date: c.date,
        type: c.type,
        distance_km: c.type === 'rest' || !Number.isFinite(d) || d <= 0 ? null : Math.round(Math.min(45, d) * 10) / 10,
        pace: typeof c.pace === 'string' && /^\d{1,2}:\d{2}\s*[-〜~]\s*\d{1,2}:\d{2}$/.test(c.pace.trim()) ? c.pace.trim() : null,
        notes: String(c.notes ?? '').slice(0, 60),
      };
    });
  // 同じ日が 2 回あれば後のほう
  const byDate = new Map(changes.map((c) => [c.date, c]));
  return { reply: String(o?.reply ?? '').trim() || '変更案を作りました。', changes: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) };
}

export async function askCoach(env: Env, messages: CoachMsg[]): Promise<CoachReply> {
  if (!env.AI) throw new Error('AI が使えません。wrangler.toml に [ai] の設定が必要です');
  const ctx = await coachContext(env);
  const hist = messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-8)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
  if (!hist.length || hist[hist.length - 1].role !== 'user') throw new Error('相談の内容が空です');
  const out: any = await env.AI.run(COACH_MODEL as any, {
    messages: [{ role: 'system', content: `${SYSTEM}\n\n# 状況\n${ctx}` }, ...hist],
    response_format: { type: 'json_schema', json_schema: SCHEMA },
    max_tokens: 1200,
    temperature: 0.4,
  } as any);
  return parseCoach(out?.response ?? out, jstToday());
}

const paceS = (s: string) => { const [m, ss] = s.split(':').map(Number); return m * 60 + ss; };

/** 変更案を計画に反映する。その日の (実績の付いていない) 計画を置き換える */
export async function applyCoach(env: Env, changes: CoachChange[]): Promise<number> {
  const t = jstToday();
  const list = parseCoach({ reply: '-', changes }, t).changes;
  const stmts: D1PreparedStatement[] = [];
  for (const c of list) {
    stmts.push(env.DB.prepare('DELETE FROM plans WHERE date = ? AND NOT EXISTS (SELECT 1 FROM activities a WHERE a.plan_id = plans.id)').bind(c.date));
    let pmin: number | null = null, pmax: number | null = null;
    if (c.pace) { const [a, b] = c.pace.split(/\s*[-〜~]\s*/).map(paceS); pmin = Math.min(a, b); pmax = Math.max(a, b); }
    stmts.push(env.DB.prepare('INSERT INTO plans (date, type, distance_m, pace_min_s, pace_max_s, notes) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(c.date, c.type, c.distance_km ? c.distance_km * 1000 : null, pmin, pmax, c.notes ? `${c.notes} (相談で変更)` : '相談で変更'));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return list.length;
}
