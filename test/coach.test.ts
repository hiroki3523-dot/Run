import { describe, it, expect } from 'vitest';
import { parseCoach, repairJson, INVALID_REPLY } from '../src/coach';

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

  it('どうしても読めないときは「読めなかった」とし、元の JSON を返事に入れない', () => {
    const r = parseCoach('{"conclusion": 今週は軽め, "reply": "休養を', T);
    expect(r.invalid).toBe(true);
    expect(r.reply).toBe(INVALID_REPLY);
    expect(r.changes).toEqual([]);
  });

  it('コードフェンス付き・二重にエンコードされた返事も読む', () => {
    const j = '{"conclusion":"A","reasons":["x"],"reply":"R","changes":[]}';
    expect(parseCoach('```json\n' + j + '\n```', T).conclusion).toBe('A');
    expect(parseCoach(JSON.stringify(j), T).conclusion).toBe('A');
    expect(parseCoach({ response: 1 } as any, T).invalid).toBe(true);
  });

  it('必要な項目が無い・型が違う返事は「読めなかった」。変な型の理由は捨てる', () => {
    expect(parseCoach('{"foo":1}', T).invalid).toBe(true);
    const r = parseCoach({ conclusion: 'A', reasons: ['x', { a: 1 }, null, 3], reply: { x: 1 }, changes: 'no' }, T);
    expect(r.invalid).toBeUndefined();
    expect(r.reasons).toEqual(['x', '3']);
    expect(r.reply).toBe('A');
    expect(r.changes).toEqual([]);
  });

  it('返事の中に JSON が入っていたら結論を使う', () => {
    const r = parseCoach({ conclusion: 'A', reply: '{"conclusion":"A"}', changes: [] }, T);
    expect(r.reply).toBe('A');
  });

  it('JSON でない文章はそのまま返す', () => {
    expect(parseCoach('今日は休みましょう。', T).reply).toBe('今日は休みましょう。');
  });
});

describe('今週の見立てのキャッシュ', () => {
  it('読めなかった見立ては保存しない。JSON のまま保存されていた古い見立ては読み直して返す', async () => {
    const { makeEnv, call } = await import('./helpers/fixtures');
    const { env } = makeEnv();
    let next = '{"conclusion": 壊れた';
    env.AI = { run: async () => ({ response: next }) };
    const r1 = (await call(env, 'POST', '/coach/brief', {})).json;
    expect(r1.invalid).toBe(true);
    expect(await env.DB.prepare("SELECT value FROM kv WHERE key = 'coach_brief'").first()).toBeNull();
    // 古い形: 返事に生の JSON が入ったまま保存されたもの
    next = '{"conclusion":"新しい","reasons":[],"reply":"R","changes":[]}';
    const r2 = (await call(env, 'POST', '/coach/brief', {})).json;
    const saved = JSON.parse((await env.DB.prepare("SELECT value FROM kv WHERE key = 'coach_brief'").first<any>()).value);
    saved.r = { reply: '{"conclusion":"古い見立て","reasons":["x"],"reply":"r","changes":[]}', changes: [] };
    await env.DB.prepare("UPDATE kv SET value = ? WHERE key = 'coach_brief'").bind(JSON.stringify(saved)).run();
    const r3 = (await call(env, 'POST', '/coach/brief', {})).json;
    expect(r2.conclusion).toBe('新しい');
    expect(r3.cached).toBe(true);
    expect(r3.conclusion).toBe('古い見立て');
    expect(r3.reply).toBe('r');
  });
});
