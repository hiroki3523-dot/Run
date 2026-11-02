import { describe, expect, it } from 'vitest';
import { mergeNews, parseRss } from '../src/news';

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
});
