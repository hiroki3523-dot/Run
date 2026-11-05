import { describe, expect, it } from 'vitest';
import { isOffTopic, mergeNews, newestFirst, parseRss, runningNews } from '../src/news';

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
  it('競馬・野球の記事は除く (ランニング・マラソンの記事は残す)', () => {
    for (const t of ['【天皇賞】マラソンランナー級のスタミナ 有力馬の調教', 'JRA 菊花賞 出走馬確定', '阪神・近本 一塁ランナーで盗塁成功', 'G1 ジャパンカップ 枠順', 'ランニングフリー産駒が重賞初制覇']) expect(isOffTopic(t)).toBe(true);
    for (const t of ['福岡マラソン 交通規制のお知らせ', 'ナイキ ペガサス 42 発売', '箱根駅伝 予選会の結果', '菊花マラソン 2026 ハーフで大会新', 'ランナー必見 冬のウェア']) expect(isOffTopic(t)).toBe(false);
    const xml = `<rss><item><title>JRA 菊花賞 出走馬確定 - S</title><link>https://a.example/1</link><pubDate>Thu, 05 Nov 2026 01:00:00 GMT</pubDate><source>S</source></item><item><title>大阪マラソン 募集開始 - S</title><link>https://a.example/2</link><pubDate>Thu, 05 Nov 2026 01:00:00 GMT</pubDate><source>S</source></item></rss>`;
    expect(parseRss(xml, '話題').map((x) => x.title)).toEqual(['大阪マラソン 募集開始']);
  });
  it('「ランナー」で探し (記事の数を保つ)、競馬・野球を除く語を付ける・駅伝も探す', async () => {
    const urls: string[] = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (u: string) => { urls.push(decodeURIComponent(String(u)).replace(/\+/g, ' ')); return new Response('<rss></rss>'); }) as any;
    try { await runningNews(); } finally { globalThis.fetch = orig; }
    const topic = urls.find((u) => u.includes('ジョギング'))!;
    expect(topic).toContain('ランナー');
    expect(urls.some((u) => u.includes('駅伝'))).toBe(true);
    expect(urls.every((u) => u.includes('-競馬') && u.includes('-野球'))).toBe(true);
  });
});
