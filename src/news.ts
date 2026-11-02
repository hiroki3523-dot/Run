/** ランニングのニュース (Google ニュースの RSS・無料・キー不要)。見出しとリンクだけを返す */

export interface NewsItem { title: string; url: string; source: string; date: string; tag: string }

/** [見出しの種類, 検索語]。直近 2 週間の記事だけ */
const FEEDS: [string, string][] = [
  ['シューズ', 'ランニングシューズ 新作 OR 新モデル OR 発売'],
  ['大会', 'マラソン エントリー OR 募集開始 OR 抽選'],
  ['レース', 'マラソン 優勝 OR 日本記録 OR 自己ベスト'],
];

const decode = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&amp;/g, '&')
  .trim();

/** RSS の <item> を取り出す (正規表現で十分な単純な形) */
export function parseRss(xml: string, tag: string): NewsItem[] {
  const out: NewsItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const get = (name: string) => { const r = it.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)); return r ? decode(r[1]) : ''; };
    const source = get('source');
    let title = get('title');
    // Google ニュースの見出しは「見出し - 媒体名」。媒体名は別に出すので外す
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const url = get('link');
    const t = Date.parse(get('pubDate'));
    if (!title || !/^https?:\/\//.test(url) || !Number.isFinite(t)) continue;
    out.push({ title, url, source, date: new Date(t).toISOString(), tag });
  }
  return out;
}

/** 各カテゴリから新しい順に集め、同じ見出しを除いて交互に並べる */
export function mergeNews(groups: NewsItem[][], limit = 8): NewsItem[] {
  const seen = new Set<string>();
  const norm = (s: string) => s.replace(/[\s　「」『』【】()（）・、。!！?？]/g, '').slice(0, 24);
  const lists = groups.map((g) => [...g].sort((a, b) => b.date.localeCompare(a.date)));
  const out: NewsItem[] = [];
  for (let i = 0; out.length < limit && lists.some((l) => l.length > i); i++) {
    for (const l of lists) {
      const it = l[i];
      if (!it || seen.has(norm(it.title))) continue;
      seen.add(norm(it.title));
      out.push(it);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export async function runningNews(limit = 8): Promise<NewsItem[]> {
  const groups = await Promise.all(FEEDS.map(async ([tag, q]) => {
    const p = new URLSearchParams({ q: `${q} when:14d`, hl: 'ja', gl: 'JP', ceid: 'JP:ja' });
    try {
      const res = await fetch(`https://news.google.com/rss/search?${p}`, { cf: { cacheTtl: 3600, cacheEverything: true } } as RequestInit);
      if (!res.ok) return [];
      return parseRss(await res.text(), tag).slice(0, 10);
    } catch {
      return [];
    }
  }));
  return mergeNews(groups, limit);
}
