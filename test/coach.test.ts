import { describe, it, expect } from 'vitest';
import { parseCoach, repairJson } from '../src/coach';

const T = '2026-11-04';
// 2026-11-04 の画面で出た返事の形 (配列の最後を 」 で閉じ、配列の ] も抜けている)
const BROKEN = '{"conclusion":"今週は疲労が残っているので、木曜の LT を短くして日曜のロングを守る","reasons":["直近 7 日で 62km と多め","脚の張りが 3 日続いている","レースまで 4 日なのでリカバリーが最重要」,"keep":["日曜のロング走"],"reply":"無理せず、木曜は 5km に短くしましょう。","changes":[]}';

describe('AI コーチの返事の読み取り', () => {
  it('正しい JSON はそのまま読む', () => {
    const r = parseCoach('{"conclusion":"A","reasons":["x"],"keep":["k"],"reply":"R","changes":[]}', T);
    expect([r.conclusion, r.reasons, r.keep, r.reply]).toEqual(['A', ['x'], ['k'], 'R']);
  });

  it('」で閉じた・配列の ] が抜けた JSON を直して読む (画面に JSON をそのまま出さない)', () => {
    const r = parseCoach(BROKEN, T);
    expect(r.conclusion).toContain('木曜の LT を短く');
    expect(r.reasons).toEqual(['直近 7 日で 62km と多め', '脚の張りが 3 日続いている', 'レースまで 4 日なのでリカバリーが最重要']);
    expect(r.keep).toEqual(['日曜のロング走']);
    expect(r.reply).toBe('無理せず、木曜は 5km に短くしましょう。');
    expect(r.reply).not.toContain('{');
  });

  it('前後に文章が付いた・末尾のカンマ・最後の } が無い返事も読む', () => {
    expect(parseCoach('はい。\n{"conclusion":"A","reasons":["x",],"reply":"R","changes":[],}', T).conclusion).toBe('A');
    expect(parseCoach('{"conclusion":"A","reasons":["x"],"reply":"R","changes":[]', T).reply).toBe('R');
  });

  it('正しい文字列の中の 」 は変えない', () => {
    const ok = '{"conclusion":"「疲労」, を気にする","reasons":["「張り」"],"reply":"R","changes":[]}';
    expect(JSON.parse(repairJson(ok))).toEqual(JSON.parse(ok));
  });

  it('どうしても読めないときも、JSON の記号は見せない', () => {
    const r = parseCoach('{"conclusion": 今週は軽め, "reply": "休養を', T);
    expect(r.reply).not.toMatch(/[{}"]/);
    expect(r.reply).toContain('休養');
  });

  it('JSON でない文章はそのまま返す', () => {
    expect(parseCoach('今日は休みましょう。', T).reply).toBe('今日は休みましょう。');
  });
});
