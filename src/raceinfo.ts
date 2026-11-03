/**
 * 大会情報 (スタート時刻・整列締め切り・関門・受付・エントリー期間 など)。
 * 公式サイトのページ (または貼り付けた文章) を AI に読ませて取り出す。保存は画面で確かめてから。
 */
import { runModel } from './coach';
import { kvGet, kvSet } from './settings';
import type { Env } from './types';

export interface RaceBlock { name: string; start: string | null; close: string | null }
export interface RaceCutoff { km: number; time: string; place: string | null }
export interface RaceInfo {
  image?: string; pace_mode?: string; pace_adj?: number[]; start_loss_s?: number; fuel?: { km: number; item: string }[]; // 本人が決める値 (2026-11)
  venue?: string | null;          // 会場 (スタート・ゴール)
  start_time?: string | null;     // スタート時刻 (例 8:30)
  line_close?: string | null;     // 整列の締め切り (全体)
  blocks?: RaceBlock[];           // ブロックごとのスタート・整列締め切り
  time_limit?: string | null;     // 制限時間 (例 6時間)
  cutoffs?: RaceCutoff[];         // 関門
  reception?: string | null;      // 受付 (日時・場所)
  baggage?: string | null;        // 手荷物預け
  aid?: string | null;            // 給水・給食
  access?: string | null;         // アクセス・交通
  entry_open?: string | null;     // エントリー開始 (YYYY-MM-DD)
  entry_close?: string | null;    // エントリー締め切り
  lottery_result?: string | null; // 抽選発表
  entry_last_open?: string | null;  // 前回大会のエントリー開始 (今回分がまだ出ていないとき)
  entry_last_close?: string | null;
  fee?: string | null;            // 参加料
  my_block?: string | null;       // 自分のブロック
  bib?: string | null;            // ゼッケン番号
  race_date?: string | null;      // 開催日 (YYYY-MM-DD)。一覧から追加した大会の日付を確定するため
  date_estimated?: boolean;       // 日付が仮 (例年の月から) のとき
  source?: string | null;         // 取り込んだ元 (URL)
  updated?: string | null;
}

const str = (v: unknown, n = 120) => (v == null || v === '' ? null : String(v).trim().slice(0, n) || null);
const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? v.trim() : str(v, 40));

export function cleanRaceInfo(o: any): RaceInfo {
  if (!o || typeof o !== 'object') return {};
  return {
    venue: str(o.venue), start_time: str(o.start_time, 40), line_close: str(o.line_close, 40),
    blocks: (Array.isArray(o.blocks) ? o.blocks : []).slice(0, 20).map((b: any) => ({ name: str(b?.name, 20) ?? '', start: str(b?.start, 20), close: str(b?.close, 20) })).filter((b: RaceBlock) => b.name),
    time_limit: str(o.time_limit, 40),
    cutoffs: (Array.isArray(o.cutoffs) ? o.cutoffs : []).slice(0, 30)
      .map((x: any) => ({ km: Math.round(Number(x?.km) * 100) / 100, time: str(x?.time, 20) ?? '', place: str(x?.place, 40) }))
      .filter((x: RaceCutoff) => Number.isFinite(x.km) && x.km > 0 && x.km <= 100 && x.time)
      .sort((a: RaceCutoff, b: RaceCutoff) => a.km - b.km),
    reception: str(o.reception, 200), baggage: str(o.baggage, 200), aid: str(o.aid, 200), access: str(o.access, 200),
    entry_open: date(o.entry_open), entry_close: date(o.entry_close), entry_last_open: date(o.entry_last_open), entry_last_close: date(o.entry_last_close), lottery_result: date(o.lottery_result), fee: str(o.fee, 60),
    race_date: typeof o.race_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(o.race_date.trim()) ? o.race_date.trim() : null,
    date_estimated: o.date_estimated === true ? true : undefined,
    my_block: str(o.my_block, 20), bib: str(o.bib, 20), source: str(o.source, 500), updated: str(o.updated, 20),
    // レース詳細で本人が決める値 (ペース表の型・区間ごとの調整・スタートロス・補給)。
    // 以前はここで落としていたため、保存しても残らなかった (2026-11 修正・監査 K-09)
    ...(['even', 'negative', 'active', 'custom'].includes(o.pace_mode) ? { pace_mode: o.pace_mode } : {}),
    ...(Array.isArray(o.pace_adj) ? { pace_adj: o.pace_adj.slice(0, 30).map((x: any) => (Number.isFinite(Number(x)) ? Math.max(-60, Math.min(60, Math.round(Number(x)))) : 0)) } : {}),
    ...(Number.isFinite(Number(o.start_loss_s)) && o.start_loss_s != null ? { start_loss_s: Math.max(0, Math.min(1800, Math.round(Number(o.start_loss_s)))) } : {}),
    // 大会の写真 (自分で選んだもの。画面で縮小した JPEG。大きすぎるものは保存しない)
    ...(typeof o.image === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(o.image) && o.image.length < 400_000 ? { image: o.image } : {}),
    ...(Array.isArray(o.fuel) ? { fuel: o.fuel.slice(0, 30).map((x: any) => ({ km: Math.round(Number(x?.km) * 10) / 10, item: str(x?.item, 30) ?? '' })).filter((x: any) => Number.isFinite(x.km) && x.km >= 0 && x.km <= 100 && x.item).sort((a: any, b: any) => a.km - b.km) } : {}),
  };
}

/** HTML から本文の文字だけを取り出す */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|dt|dd|section|table)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t　]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

const SYSTEM = `マラソン大会の公式ページの文章から、出場するランナーが当日までに必要な情報を取り出します。
- 文章に書いてあることだけを使う。書いていない項目は null (推測しない)
- race_date: 次に開かれる大会の開催日 ("YYYY-MM-DD")。前回大会の結果ページなら null
- 時刻は "8:30" の形。日付は "YYYY-MM-DD" (年が書いていなければ大会日の年から判断)
- blocks: スタートブロックごとにスタート時刻や整列締め切りが違うときだけ (name は "A" など)
- cutoffs: 関門。km は数字、time は "11:05" の形 (スタートからの時間しか無ければ "2:35後" のように)、place は地名
- entry_open / entry_close: 次の大会のエントリー期間。まだ発表されていなければ null
- entry_last_open / entry_last_close: ページに前回 (過去) 大会のエントリー期間しか無いときは、その日付をここに入れる
- 各項目は短く (1〜2 行)
次の JSON だけを返す:
{"race_date":null,"venue":null,"start_time":null,"line_close":null,"blocks":[],"time_limit":null,"cutoffs":[],"reception":null,"baggage":null,"aid":null,"access":null,"entry_open":null,"entry_close":null,"entry_last_open":null,"entry_last_close":null,"lottery_result":null,"fee":null}`;

const SCHEMA = {
  type: 'object',
  properties: {
    race_date: { type: ['string', 'null'] }, venue: { type: ['string', 'null'] }, start_time: { type: ['string', 'null'] }, line_close: { type: ['string', 'null'] },
    blocks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, start: { type: ['string', 'null'] }, close: { type: ['string', 'null'] } } } },
    time_limit: { type: ['string', 'null'] },
    cutoffs: { type: 'array', items: { type: 'object', properties: { km: { type: 'number' }, time: { type: 'string' }, place: { type: ['string', 'null'] } } } },
    reception: { type: ['string', 'null'] }, baggage: { type: ['string', 'null'] }, aid: { type: ['string', 'null'] }, access: { type: ['string', 'null'] },
    entry_open: { type: ['string', 'null'] }, entry_close: { type: ['string', 'null'] }, entry_last_open: { type: ['string', 'null'] }, entry_last_close: { type: ['string', 'null'] }, lottery_result: { type: ['string', 'null'] }, fee: { type: ['string', 'null'] },
  },
};

export async function extractRaceInfo(env: Env, race: { name: string; date: string }, src: { url?: string; text?: string }): Promise<RaceInfo & { chars: number }> {
  if (!env.AI) throw new Error('AI が使えません');
  let text = (src.text ?? '').trim();
  if (!text) {
    if (!src.url || !/^https?:\/\//.test(src.url)) throw new Error('公式サイトの URL か、ページの文章を入れてください');
    let res: Response;
    try { res = await fetch(src.url, { headers: { 'User-Agent': 'Mozilla/5.0 (STRIDE race info)', 'Accept-Language': 'ja' }, redirect: 'follow' }); }
    catch { throw new Error('公式サイトにつながりませんでした。URL を確かめるか、ページの文章をコピーして貼り付けてください'); }
    if (!res.ok) throw new Error(`ページを開けませんでした (${res.status})。公式サイトの URL を確かめるか、ページの文章をコピーして貼り付けてください`);
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('pdf')) throw new Error('PDF は読めません。PDF の文章をコピーして貼り付けてください');
    text = htmlText(await res.text());
  }
  if (text.length < 40) throw new Error('読み取れる文章がほとんどありませんでした。ページの文章をコピーして貼り付けてください');
  const body = text.slice(0, 14000);
  const out = await runModel(env, [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `大会: ${race.name} (今日 ${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)}、予定日 ${race.date} ごろ)\n\n# ページの文章\n${body}` },
  ], SCHEMA, 1500);
  let o: any = out.text;
  if (typeof o === 'string') { const m = o.match(/\{[\s\S]*\}/); try { o = m ? JSON.parse(m[0]) : {}; } catch { o = {}; } }
  const info = cleanRaceInfo(o);
  return { ...info, source: src.text ? null : src.url ?? null, chars: body.length };
}

/** 1 大会の公式サイトを読んで大会情報を更新する (日付が仮なら確定・エントリー期間・例年の時期を覚える) */
export async function autoFillRace(env: Env, id: number): Promise<void> {
  const t = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const r = await env.DB.prepare('SELECT * FROM races WHERE id = ?').bind(id).first<any>();
  if (!r?.url) return;
  const cur = cleanRaceInfo(JSON.parse(r.info || '{}'));
  try {
    const got = await extractRaceInfo(env, { name: r.name, date: r.date }, { url: r.url });
    const next = mergeRaceInfo(cur, got, t);
    const date = cur.date_estimated && got.race_date && got.race_date >= t ? got.race_date : r.date;
    if (date !== r.date || (got.race_date && got.race_date === r.date)) delete next.date_estimated;
    delete (next as any).race_date;
    await env.DB.prepare('UPDATE races SET info = ?, date = ? WHERE id = ?').bind(JSON.stringify(next), date, r.id).run();
    await rememberEntry(env, r.name, next);
  } catch (e) {
    // 読めなかったときも日付を進めて、毎日同じ大会でつまらないように
    await env.DB.prepare('UPDATE races SET info = ? WHERE id = ?').bind(JSON.stringify({ ...cur, updated: t }), r.id).run();
    console.warn('race info refresh failed', r.name, (e as Error).message);
  }
}

/** 大会ごとの「例年のエントリー時期」を覚えておく (次の年の目安に使う) */
const baseKey = (n: string) => n.replace(/\s*\(.*?\)\s*/g, '').replace(/20\d\d|第\d+回|[\s・]/g, '');
async function rememberEntry(env: Env, name: string, info: RaceInfo): Promise<void> {
  const open = /^\d{4}-\d{2}-\d{2}$/.test(info.entry_open ?? '') ? info.entry_open : /^\d{4}-\d{2}-\d{2}$/.test(info.entry_last_open ?? '') ? info.entry_last_open : null;
  if (!open) return;
  const close = open === info.entry_open ? info.entry_close : info.entry_last_close;
  const key = `entry_hist:${baseKey(name)}`;
  const hist = JSON.parse((await kvGet(env, key)) || '[]') as { open: string; close: string | null }[];
  if (!hist.some((h) => h.open === open)) { hist.push({ open, close: close ?? null }); await kvSet(env, key, JSON.stringify(hist.slice(-5))); }
}
export async function entryHistory(env: Env): Promise<Record<string, { open: string; close: string | null }[]>> {
  const { results } = await env.DB.prepare("SELECT key, value FROM kv WHERE key LIKE 'entry_hist:%'").all<{ key: string; value: string }>();
  return Object.fromEntries(results.map((r) => [r.key.slice(11), JSON.parse(r.value)]));
}

/**
 * 毎朝: 公式サイトを登録した今後のレースの大会情報を読み直す (最大 3 大会)。
 * エントリー候補・エントリー済みでエントリー期間がまだ分からない大会は 7 日ごと、それ以外は 14 日ごと
 */
export async function refreshRaceInfo(env: Env): Promise<void> {
  const t = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare('SELECT id, status, info FROM races WHERE date >= ? AND url IS NOT NULL ORDER BY date').bind(t).all<any>();
  const ago = (n: number) => new Date(Date.parse(t) - n * 86400_000).toISOString().slice(0, 10);
  const due = results.filter((x) => {
    let i: any = {};
    try { i = JSON.parse(x.info || '{}'); } catch {}
    const waiting = x.status !== 'confirmed' && !i.entry_close;
    return !i.updated || i.updated <= ago(waiting ? 7 : 14);
  });
  for (const r of due.slice(0, 3)) await autoFillRace(env, r.id);
}

/** 読み取った情報を今の情報に重ねる (空の項目・自分のブロック・ゼッケンは上書きしない) */
export function mergeRaceInfo(cur: RaceInfo, got: RaceInfo, today: string): RaceInfo {
  const out: any = { ...cur };
  for (const [k, v] of Object.entries(got)) {
    if (['my_block', 'bib', 'chars', 'date_estimated', 'updated'].includes(k)) continue;
    if (v == null || (Array.isArray(v) && !v.length)) continue;
    out[k] = v;
  }
  out.updated = today;
  return out;
}
