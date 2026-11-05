import { describe, expect, it } from 'vitest';
import { mergeNews, newestFirst, parseRss, runningNews } from '../src/news';

const RSS = `<rss><channel><item><title>ナイキが新作「ペガサス」を発表 - Runner's World</title><link>https://news.google.com/rss/articles/abc?oc=5</link><pubDate>Mon, 02 Nov 2026 03:00:00 GMT</pubDate><source url="https://example.com">Runner's World</source></item>
<item><title><![CDATA[熊本城マラソン エントリー開始 &amp; 抽選 - 熊日]]></title><link>https://news.google.com/rss/articles/def</link><pubDate>Sun, 01 Nov 2026 10:00:00 GMT</pubDate><source url="https://k.example">熊日</source></item>
<item><title>壊れた記事</title><link></link><pubDate>x</pubDate></item></channel></rss>`;

describe('news', () => {
  it('見出しから媒体名を外し、壊れた項目は捨てる', () => {
    const r = parseRss(RSS, 'シューズ');
    expect(r.length).toBe(2);
    expect(r[0].title).toBe('ナイキが新作「ペガサス」を発表');
    expect(r[1].title).toBe('熊本城マラソン エントリー開始 & 抽選');
    expect(r[1].source).toBe('熊日');
  });
  it('カテゴリを交互に並べ、同じ見出しは 1 つに', () => {
    const a = parseRss(RSS, 'シューズ'), b = parseRss(RSS, '大会');
    const m = mergeNews([a, b], 8);
    expect(m.length).toBe(2);
    expect(m[0].tag).toBe('シューズ');
  });
  it('Google の関連度順ではなく、日付の新しい順に使う (古い記事が上に居座らない)', () => {
    const r = newestFirst(parseRss(RSS.replace('Mon, 02 Nov 2026 03:00:00', 'Mon, 19 Oct 2026 03:00:00'), 'シューズ'));
    expect(r[0].title).toBe('熊本城マラソン エントリー開始 & 抽選');
  });
  it('直近 7 日が少ない種類は 14 日まで広げる・次の大会の名前でも探す', async () => {
    const urls: string[] = [];
    const item = (t: string, d: string) => `<item><title>${t}</title><link>https://n.example/${encodeURIComponent(t)}</link><pubDate>${d}</pubDate><source>S</source></item>`;
    const orig = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      urls.push(decodeURIComponent(String(u)));
      const q = decodeURIComponent(String(u));
      const body = q.includes('福岡マラソン') ? item('福岡マラソン 交通規制のお知らせ', 'Thu, 05 Nov 2026 01:00:00 GMT') : q.includes('when:14d') ? item(`古め ${urls.length}`, 'Mon, 26 Oct 2026 01:00:00 GMT') : '';
      return new Response(`<rss>${body}</rss>`, { status: 200 });
    }) as any;
    try {
      const r = await runningNews(12, [['大会', '"福岡マラソン"']]);
      expect(r[0].title).toBe('福岡マラソン 交通規制のお知らせ');
      expect(urls.some((u) => u.includes('when:7d'))).toBe(true);
      expect(urls.some((u) => u.includes('when:14d'))).toBe(true);
    } finally { globalThis.fetch = orig; }
  });
});
