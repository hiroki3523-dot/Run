/**
 * 大会の公式サイトを探す。
 * 1. Wikipedia (日本語) の記事の「公式サイト」欄・外部リンク
 * 2. DuckDuckGo の検索結果 (キー不要の HTML 版)
 * 候補を返して、どれを使うかは画面で選ぶ。同じ大会名は 30 日覚えておく。
 */
import { kvGet, kvSet } from './settings';
import type { Env } from './types';

export interface SiteCandidate { url: string; title: string; source: 'wikipedia' | 'search' }

const UA = { 'User-Agent': 'STRIDE/1.0 (personal running log; https://github.com/hiroki3523-dot/Run)', 'Accept-Language': 'ja' };
const SKIP = /wikipedia|wikimedia|wikidata|archive\.org|facebook|twitter|x\.com|instagram|youtube|google\.|yahoo\.|runnet\.jp|sportsentry|moshicom|e-moshicom|amazon|rakuten|duckduckgo|bing\.com|\.pdf($|\?)/i;
const clean = (n: string) => n.replace(/\s*\(.*?\)\s*/g, '').replace(/20\d\d|第\d+回/g, '').trim();

/** Wikipedia の記事の wikitext から公式サイトの URL を探す */
export function officialFromWikitext(wt: string): string | null {
  const pats = [
    /\|\s*(?:公式サイト|公式ウェブサイト|ウェブサイト|website|url)\s*=\s*\{\{\s*(?:URL|Official URL)\s*\|\s*([^}|\s]+)/i,
    /\|\s*(?:公式サイト|公式ウェブサイト|ウェブサイト|website|url)\s*=\s*\[?\s*(https?:\/\/[^\s\]|}<]+)/i,
    /\{\{\s*(?:Official website|公式ウェブサイト|Official|公式サイト)\s*\|\s*(?:url\s*=\s*)?([^}|\s]+)/i,
    /\[(https?:\/\/[^\s\]]+)\s+[^\]]*公式[^\]]*\]/,
  ];
  for (const re of pats) {
    const m = wt.match(re);
    if (m) { const u = m[1].trim(); return /^https?:\/\//.test(u) ? u : `https://${u.replace(/^\/+/, '')}`; }
  }
  return null;
}

/** DuckDuckGo (HTML 版) の結果から URL とタイトルを取り出す */
export function parseDdg(html: string): { url: string; title: string }[] {
  const out: { url: string; title: string }[] = [];
  for (const m of html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    let href = m[1].replace(/&amp;/g, '&');
    const u = href.match(/[?&]uddg=([^&]+)/);
    if (u) href = decodeURIComponent(u[1]);
    if (href.startsWith('//')) href = `https:${href}`;
    const title = m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').trim();
    if (/^https?:\/\//.test(href)) out.push({ url: href, title });
  }
  return out;
}

async function fromWikipedia(name: string): Promise<SiteCandidate[]> {
  const api = 'https://ja.wikipedia.org/w/api.php';
  const sr = await fetch(`${api}?${new URLSearchParams({ action: 'query', list: 'search', srsearch: name, srlimit: '3', format: 'json', formatversion: '2' })}`, { headers: UA });
  if (!sr.ok) return [];
  const hits: { title: string }[] = ((await sr.json()) as any)?.query?.search ?? [];
  const key = clean(name).replace(/[\s・]/g, '').slice(0, 6);
  const out: SiteCandidate[] = [];
  for (const h of hits.filter((x) => x.title.replace(/[\s・]/g, '').includes(key.slice(0, 3))).slice(0, 2)) {
    const pr = await fetch(`${api}?${new URLSearchParams({ action: 'parse', page: h.title, prop: 'wikitext', format: 'json', formatversion: '2' })}`, { headers: UA });
    if (!pr.ok) continue;
    const wt: string = ((await pr.json()) as any)?.parse?.wikitext ?? '';
    const url = officialFromWikitext(wt);
    if (url && !SKIP.test(url)) out.push({ url, title: `${h.title} 公式サイト`, source: 'wikipedia' });
  }
  return out;
}

async function fromSearch(name: string): Promise<SiteCandidate[]> {
  const res = await fetch(`https://html.duckduckgo.com/html/?${new URLSearchParams({ q: `${clean(name)} 公式サイト` })}`, { headers: { ...UA, 'User-Agent': 'Mozilla/5.0 (compatible; STRIDE/1.0)' } });
  if (!res.ok) return [];
  return parseDdg(await res.text()).filter((r) => !SKIP.test(r.url)).slice(0, 5).map((r) => ({ ...r, source: 'search' as const }));
}

export async function findOfficialSite(env: Env, name: string): Promise<SiteCandidate[]> {
  const key = `site:${clean(name)}`;
  const hit = await kvGet(env, key);
  if (hit) { try { const o = JSON.parse(hit); if (Date.now() - o.at < 30 * 86400_000 && o.list.length) return o.list; } catch {} }
  const [w, s] = await Promise.all([fromWikipedia(clean(name)).catch(() => []), fromSearch(name).catch(() => [])]);
  // 同じサイト (ホスト) は 1 つに
  const seen = new Set<string>();
  const list = [...w, ...s].filter((c) => { try { const h = new URL(c.url).host.replace(/^www\./, ''); if (seen.has(h)) return false; seen.add(h); return true; } catch { return false; } }).slice(0, 5);
  if (list.length) await kvSet(env, key, JSON.stringify({ at: Date.now(), list }));
  return list;
}
