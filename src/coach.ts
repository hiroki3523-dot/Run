/**
 * 予定の相談 (AI コーチ)。Cloudflare Workers AI (無料枠) で、
 * 体の状態や都合を聞いて、返事と「計画の変更案」を返す。変更はユーザーが確かめてから反映する。
 */
import { addDays } from './format';
import { normalizeFb } from './runreview';
import { getSettings, kvGet, kvSet } from './settings';
import { PLAN_LABELS, PLAN_TYPES, type Env, type PlanType } from './types';

/** 先に試すモデル (考える力が高い) → だめなら次 */
export const COACH_MODELS = ['@cf/openai/gpt-oss-120b', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'];

export interface CoachMsg { role: 'user' | 'assistant'; content: string; changes?: CoachChange[] }
export interface CoachChange { date: string; type: PlanType; distance_km: number | null; pace: string | null; notes: string }
export interface CoachReply { reply: string; changes: CoachChange[]; model?: string }

const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const dow = (d: string) => DOW[new Date(`${d}T00:00:00Z`).getUTCDay()];
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const hms = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const jstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

/** AI に渡す、いまの状況 (計画・実績・ふりかえり・レース・ペース) */
export async function coachContext(env: Env): Promise<{ text: string; races: { name: string; date: string; priority: string }[] }> {
  const t = jstToday();
  const s = await getSettings(env);
  const [plans, acts, races] = await Promise.all([
    env.DB.prepare('SELECT date, type, distance_m, pace_min_s, pace_max_s, notes FROM plans WHERE date BETWEEN ? AND ? ORDER BY date, id').bind(addDays(t, -7), addDays(t, 20)).all<any>(),
    env.DB.prepare("SELECT id, date, distance_m, moving_time_s, avg_hr, score FROM activities WHERE date BETWEEN ? AND ? AND sport_type LIKE '%Run%' ORDER BY date, start_date_local").bind(addDays(t, -21), t).all<any>(),
    env.DB.prepare("SELECT name, date, distance_m, goal_time_s, priority FROM races WHERE date >= ? AND COALESCE(status, 'confirmed') != 'candidate' ORDER BY date LIMIT 3").bind(t).all<any>(),
  ]);
  const fbs = await Promise.all(acts.results.slice(-10).map(async (a: any) => [a.id, await kvGet(env, `fb:${a.id}`)] as const));
  const fbOf = new Map(fbs.filter(([, v]) => v).map(([id, v]) => [id, normalizeFb(JSON.parse(v!))]));

  const L: string[] = [];
  L.push(`今日: ${t}(${dow(t)})`);
  L.push('レース: ' + (races.results.length ? races.results.map((r: any) => `${r.name} ${r.date}(${dow(r.date)}) ${(r.distance_m / 1000).toFixed(1)}km 目標${r.goal_time_s ? hms(r.goal_time_s) : 'なし'} 優先度${r.priority}・あと${Math.round((Date.parse(r.date) - Date.parse(t)) / 86400_000)}日`).join(' / ') : 'なし'));
  L.push('ペース帯 (/km): ' + (['easy', 'jog', 'long', 'm', 'lt', 'interval'] as const).map((k) => `${PLAN_LABELS[k]} ${mmss(s.paces[k].min)}-${mmss(s.paces[k].max)}`).join('、'));
  if (s.coros?.updated) L.push(`COROS: ランニングレベル ${s.coros.running_level}・閾値ペース ${s.coros.lt_pace_s ? mmss(s.coros.lt_pace_s) : '-'}/km・フル予測 ${s.coros.predicted_s?.full ? hms(s.coros.predicted_s.full) : '-'}`);
  L.push(`最大心拍 ${s.max_hr}・閾値心拍 ${s.lthr}`);
  // 日ごとのカレンダー (曜日とレースまでの日数を書いておく。AI は日付の計算を間違えやすいため)
  const race0 = races.results[0];
  L.push('', '日ごとの計画 (日付・曜日・レースまでの日数・その日の計画・実績):');
  for (let i = -3; i <= 20; i++) {
    const d = addDays(t, i);
    const ps = plans.results.filter((p: any) => p.date === d);
    const done = acts.results.filter((a: any) => a.date === d).reduce((x: number, a: any) => x + a.distance_m, 0);
    const left = race0 ? Math.round((Date.parse(race0.date) - Date.parse(d)) / 86400_000) : null;
    const tag = [i === 0 ? '今日' : i === 1 ? '明日' : i < 0 ? '過去' : '', left === 0 ? `★${race0.name}当日` : left != null && left > 0 && left <= 21 ? `レース${left}日前` : left != null && left < 0 && left >= -7 ? `レース${-left}日後` : ''].filter(Boolean).join('・');
    const plan = ps.length ? ps.map((p: any) => `${PLAN_LABELS[p.type as PlanType] ?? p.type}${p.distance_m ? ` ${(p.distance_m / 1000).toFixed(1)}km` : ''}${p.pace_min_s ? ` ${mmss(p.pace_min_s)}-${mmss(p.pace_max_s)}/km` : ''}${p.notes ? ` (${String(p.notes).slice(0, 30)})` : ''}`).join(' + ') : '計画なし';
    L.push(`- ${d}(${dow(d)})${tag ? ` [${tag}]` : ''} 計画: ${plan}${i <= 0 && done ? ` / 実績 ${(done / 1000).toFixed(1)}km` : ''}`);
  }
  L.push('', '実績 (直近3週間):');
  for (const a of acts.results) {
    const fb = fbOf.get(a.id);
    const fbt = fb ? ` ふりかえり[脚の重さ${fb.leg ?? '-'}/10・痛み${fb.pain ?? '-'}/10・きつさ${fb.rpe ?? '-'}/10${fb.memo ? `・メモ「${fb.memo.slice(0, 60)}」` : ''}]` : '';
    L.push(`- ${a.date}(${dow(a.date)}) ${(a.distance_m / 1000).toFixed(1)}km ${mmss(a.moving_time_s / (a.distance_m / 1000))}/km${a.avg_hr ? ` 心拍${Math.round(a.avg_hr)}` : ''}${fbt}`);
  }
  if (!acts.results.length) L.push('- なし');
  const wk = (from: number) => acts.results.filter((a: any) => a.date > addDays(t, -from - 7) && a.date <= addDays(t, -from)).reduce((x: number, a: any) => x + a.distance_m, 0) / 1000;
  L.push(`週の距離: 直近7日 ${wk(0).toFixed(0)}km・8〜14日前 ${wk(7).toFixed(0)}km・15〜21日前 ${wk(14).toFixed(0)}km`);
  const recentFb = acts.results.filter((a: any) => a.date > addDays(t, -7)).map((a: any) => fbOf.get(a.id)).filter(Boolean) as any[];
  const avg = (k: string) => { const v = recentFb.map((f) => f[k]).filter((x) => x != null); return v.length ? (v.reduce((x: number, y: number) => x + y, 0) / v.length).toFixed(1) : '-'; };
  L.push(recentFb.length ? `直近7日のふりかえり平均 (${recentFb.length}回): 脚の重さ ${avg('leg')}/10・きつさ ${avg('rpe')}/10・痛み ${avg('pain')}/10 (7 以上は疲れが強い)` : '直近7日のふりかえり: 入力なし');
  return { text: L.join('\n'), races: races.results };
}

const SYSTEM = `あなたはマラソンのランニングコーチです。日本語で、ランナー本人に話しかけます。
下の「状況」(計画・実績・ふりかえり・レース) を読んで、相談に答え、必要なら計画の変更案を出します。

あなたの役目は、予定を動かすことだけではない。コーチとして見立てを伝える:
- 疲れの見立て: ふりかえり (脚の重さ・きつさ・痛み) と、週の距離の増え方から「疲れているか」を判断し、はっきり言う (例:「先週は脚の重さ 7/10 が続いたので、今日はレストでもいい」)
- 今週のポイント: レースまでの狙いから、今週いちばん大事な練習 (外さないでほしいもの) と、削っても困らない練習を言う
- 聞かれていなくても、気になることがあれば一言そえる (例: ピッチが落ちている、ロング走が足りない、急に距離が増えている)

答え方:
- 1 文目に結論。そのあと理由を、状況の数字を 1〜2 個引いて書く。最後に「今週のポイント」を 1 文。全体で 4〜8 文
- 日付は「11/4(水)」の形で書く (年は書かない)。前置きや決まり文句の励ましはいらない
- 痛み: 鋭い痛み・腫れ・走ると悪化する痛みは休養を優先し、数日続くなら整形外科やスポーツ外来の受診をすすめる。違和感程度なら距離と強度を落とす
- 疲れ: ポイント練を後ろへずらすか Easy/Jog に落とす。疲れが強ければ休養でよいと言い切る
- 走り足りない: 週の距離が先週の 1.1 倍を超えない範囲で Easy を延ばす。レース 2 週間前からは増やさない
- 走れない日: その週のポイント練とロング走を優先して残し、Easy を削るか移す。ポイント練を連日にしない。今日の Jog をポイント練に変えるなど、疲れが抜けきらない置き方はしない
- レースが近いときの決まり (必ず守る):
  - レース 14〜8 日前: ロング走は 25km まで。ポイント練は週 1〜2 回
  - レース 7〜4 日前: ポイント練は 1 回だけ、短く (M ペース か LT で 3〜5km まで)。それ以外は Jog/Easy 8km まで
  - レース 3〜1 日前: Jog/Easy 5km までか休養だけ。ポイント練・ロング走は入れない
- 予定を動かすときは、「日ごとの計画」の [レース○日前] を必ず見て、上の決まりに合う日へ動かす。合う日が無ければ、そのポイント練はやめる (無理に詰めない)
- 日付と曜日は「日ごとの計画」の表記をそのまま使う。計画の中身 (種類・距離) も表のとおりに読む

変更案 (changes):
- 今日以降の日付だけ。変える日だけを書く (変えない日は書かない)。最大 14 日
- type は easy / jog / long / m / lt / interval / rest のどれか。休みにする日は rest
- distance_km は数字 (rest は null)。pace は "4:30-4:40" の形か null。notes は 30 字以内のメニュー説明
- 相談が質問だけで計画を変える必要がなければ changes は空の配列
- reply に書く日付・内容は changes とまったく同じにする
- 見立てやアドバイスだけで十分なときは、無理に変更案を作らない
- 前の返事に指摘や質問が来たら、まずその指摘に答え、必要なら案を作り直す (前と同じ案をくり返さない)

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

const HARD: PlanType[] = ['m', 'lt', 'interval', 'long'];
/** レース前の決まりに合わない変更を探す (A/B レースだけ) */
export function taperIssues(changes: CoachChange[], races: { name: string; date: string; priority: string }[]): string[] {
  const out: string[] = [];
  for (const c of changes) {
    for (const r of races.filter((x) => x.priority !== 'C')) {
      const left = Math.round((Date.parse(r.date) - Date.parse(c.date)) / 86400_000);
      const lab = `${c.date}(${dow(c.date)}) は${r.name}の${left}日前`;
      if (left >= 1 && left <= 3 && (HARD.includes(c.type) || (c.distance_km ?? 0) > 6)) out.push(`${lab}なので、Jog/Easy 5km までか休養だけ`);
      else if (left >= 4 && left <= 7 && ((HARD.includes(c.type) && (c.type === 'long' || c.type === 'interval' || (c.distance_km ?? 0) > 6)) || (c.distance_km ?? 0) > 10)) out.push(`${lab}なので、ポイント練は 3〜5km まで・Jog/Easy は 8km まで`);
    }
  }
  return [...new Set(out)];
}

/** Workers AI の返事から文章を取り出す (モデルによって形が違う) */
function outText(out: any): unknown {
  if (out == null) return '';
  if (typeof out.response === 'object' && out.response) return out.response;
  if (typeof out.response === 'string') return out.response;
  const ch = out.choices?.[0]?.message?.content;
  if (ch) return ch;
  if (Array.isArray(out.output)) {
    const t = out.output.flatMap((o: any) => (o.content ?? []).map((c: any) => c.text ?? '')).join('');
    if (t) return t;
  }
  return typeof out === 'string' ? out : '';
}

const fmtChanges = (cs: CoachChange[]) => cs.map((c) => `${c.date}(${dow(c.date)}) → ${PLAN_LABELS[c.type]}${c.distance_km ? ` ${c.distance_km}km` : ''}${c.pace ? ` ${c.pace}` : ''}`).join('、');

export async function runModel(env: Env, msgs: { role: string; content: string }[], schema: object = SCHEMA, maxTokens = 1200): Promise<{ text: unknown; model: string }> {
  let last: unknown = null;
  for (const model of COACH_MODELS) {
    try {
      const gpt = model.includes('gpt-oss');
      const out: any = await env.AI!.run(model as any, (gpt
        ? { messages: msgs, max_tokens: 4000, reasoning: { effort: 'medium' } }
        : { messages: msgs, response_format: { type: 'json_schema', json_schema: schema }, max_tokens: maxTokens, temperature: 0.3 }) as any);
      const t = outText(out);
      if (t && (typeof t !== 'string' || t.includes('{'))) return { text: t, model };
      last = t;
    } catch (e) {
      last = e;
      if (/neuron|quota|4006/i.test(String((e as Error)?.message))) throw e;
    }
  }
  if (last instanceof Error) throw last;
  return { text: last ?? '', model: COACH_MODELS[COACH_MODELS.length - 1] };
}

export async function askCoach(env: Env, messages: CoachMsg[]): Promise<CoachReply> {
  if (!env.AI) throw new Error('AI が使えません。wrangler.toml に [ai] の設定が必要です');
  const t = jstToday();
  const ctx = await coachContext(env);
  // 前の返事には、そのとき出した変更案も付けておく (同じ案のくり返しを防ぐ)
  const hist = messages.filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-8)
    .map((m) => ({ role: m.role, content: (m.role === 'assistant' && m.changes?.length ? `${m.content}\n[このとき出した変更案: ${fmtChanges(m.changes)}]` : m.content).slice(0, 1800) }));
  if (!hist.length || hist[hist.length - 1].role !== 'user') throw new Error('相談の内容が空です');
  const msgs = [{ role: 'system', content: `${SYSTEM}\n\n# 状況\n${ctx.text}` }, ...hist];
  const m1 = await runModel(env, msgs);
  let r = parseCoach(m1.text, t);
  r.model = m1.model;
  let issues = taperIssues(r.changes, ctx.races);
  if (issues.length) {
    // 決まりに合わなければ、理由を伝えて 1 回だけ作り直してもらう
    const again = (x: { text: unknown; model: string }) => ({ ...parseCoach(x.text, t), model: x.model });
    r = again(await runModel(env, [...msgs, { role: 'assistant', content: JSON.stringify(r) }, { role: 'user', content: `この案はレース前の決まりに合いません: ${issues.join(' / ')}。決まりに合うように案と返事を作り直してください。` }]));
    issues = taperIssues(r.changes, ctx.races);
  }
  if (issues.length) {
    // それでも合わない日は案から外す
    const bad = new Set(issues.map((x) => x.slice(0, 10)));
    r.changes = r.changes.filter((c) => !bad.has(c.date));
    r.reply += `\n\n(注意: レース直前に強い練習が入る案だったため、${[...bad].map((d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`).join('・')} の変更は外しました)`;
  }
  return r;
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

/** 計画画面を開いたときの「今週の見立て」。同じ日・同じ計画と実績なら作り直さない (無料枠の節約) */
export const BRIEF_Q = '今週の見立てをください。直近の疲れ具合、今週いちばん大事な練習 (外さないでほしいもの)、削ってもいい練習、体で気をつけること。変える必要があるときだけ変更案も。';
export async function coachBrief(env: Env, force = false): Promise<CoachReply & { cached?: boolean }> {
  const t = jstToday();
  const sig = await env.DB.prepare(
    `SELECT (SELECT COALESCE(MAX(id), 0) || ':' || COUNT(*) FROM activities WHERE date >= ?) || '|' ||
            (SELECT COALESCE(GROUP_CONCAT(date || type || COALESCE(distance_m, 0), ','), '') FROM plans WHERE date BETWEEN ? AND ?) AS s`,
  ).bind(addDays(t, -7), t, addDays(t, 13)).first<{ s: string }>();
  const key = `${t}|${sig?.s ?? ''}`;
  if (!force) {
    const c = await kvGet(env, 'coach_brief');
    if (c) { try { const o = JSON.parse(c); if (o.key === key) return { ...o.r, cached: true }; } catch {} }
  }
  const r = await askCoach(env, [{ role: 'user', content: BRIEF_Q }]);
  await kvSet(env, 'coach_brief', JSON.stringify({ key, r }));
  return r;
}
