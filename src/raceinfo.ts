/**
 * 大会情報 (スタート時刻・整列締め切り・関門・受付・エントリー期間 など)。
 * 公式サイトのページ (または貼り付けた文章) を AI に読ませて取り出す。保存は画面で確かめてから。
 */
import { runModel } from './coach';
import type { Env } from './types';

export interface RaceBlock { name: string; start: string | null; close: string | null }
export interface RaceCutoff { km: number; time: string; place: string | null }
export interface RaceInfo {
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
  fee?: string | null;            // 参加料
  my_block?: string | null;       // 自分のブロック
  bib?: string | null;            // ゼッケン番号
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
    entry_open: date(o.entry_open), entry_close: date(o.entry_close), lottery_result: date(o.lottery_result), fee: str(o.fee, 60),
    my_block: str(o.my_block, 20), bib: str(o.bib, 20), source: str(o.source, 500), updated: str(o.updated, 20),
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
- 時刻は "8:30" の形。日付は "YYYY-MM-DD" (年が書いていなければ大会日の年から判断)
- blocks: スタートブロックごとにスタート時刻や整列締め切りが違うときだけ (name は "A" など)
- cutoffs: 関門。km は数字、time は "11:05" の形 (スタートからの時間しか無ければ "2:35後" のように)、place は地名
- 各項目は短く (1〜2 行)
次の JSON だけを返す:
{"venue":null,"start_time":null,"line_close":null,"blocks":[],"time_limit":null,"cutoffs":[],"reception":null,"baggage":null,"aid":null,"access":null,"entry_open":null,"entry_close":null,"lottery_result":null,"fee":null}`;

const SCHEMA = {
  type: 'object',
  properties: {
    venue: { type: ['string', 'null'] }, start_time: { type: ['string', 'null'] }, line_close: { type: ['string', 'null'] },
    blocks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, start: { type: ['string', 'null'] }, close: { type: ['string', 'null'] } } } },
    time_limit: { type: ['string', 'null'] },
    cutoffs: { type: 'array', items: { type: 'object', properties: { km: { type: 'number' }, time: { type: 'string' }, place: { type: ['string', 'null'] } } } },
    reception: { type: ['string', 'null'] }, baggage: { type: ['string', 'null'] }, aid: { type: ['string', 'null'] }, access: { type: ['string', 'null'] },
    entry_open: { type: ['string', 'null'] }, entry_close: { type: ['string', 'null'] }, lottery_result: { type: ['string', 'null'] }, fee: { type: ['string', 'null'] },
  },
};

export async function extractRaceInfo(env: Env, race: { name: string; date: string }, src: { url?: string; text?: string }): Promise<RaceInfo & { chars: number }> {
  if (!env.AI) throw new Error('AI が使えません');
  let text = (src.text ?? '').trim();
  if (!text) {
    if (!src.url || !/^https?:\/\//.test(src.url)) throw new Error('公式サイトの URL か、ページの文章を入れてください');
    const res = await fetch(src.url, { headers: { 'User-Agent': 'Mozilla/5.0 (STRIDE race info)', 'Accept-Language': 'ja' }, redirect: 'follow' });
    if (!res.ok) throw new Error(`ページを開けませんでした (${res.status})。ページの文章をコピーして貼り付けてください`);
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('pdf')) throw new Error('PDF は読めません。PDF の文章をコピーして貼り付けてください');
    text = htmlText(await res.text());
  }
  if (text.length < 40) throw new Error('読み取れる文章がほとんどありませんでした。ページの文章をコピーして貼り付けてください');
  const body = text.slice(0, 14000);
  const out = await runModel(env, [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `大会: ${race.name} (${race.date})\n\n# ページの文章\n${body}` },
  ], SCHEMA, 1500);
  let o: any = out.text;
  if (typeof o === 'string') { const m = o.match(/\{[\s\S]*\}/); try { o = m ? JSON.parse(m[0]) : {}; } catch { o = {}; } }
  const info = cleanRaceInfo(o);
  return { ...info, source: src.text ? null : src.url ?? null, chars: body.length };
}
