/**
 * 画面の裏側の API を、テスト用のデータベースで通しで確かめる。
 * 本番のデータ・Strava・COROS には接続しない (fixtures.ts の blockNetwork)。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { addRun, blockNetwork, call, makeEnv, NOV1 } from './helpers/fixtures';

let env: any;
let sqlite: any;
let blocked: () => string[];
beforeEach(() => { ({ env, sqlite } = makeEnv()); blocked = blockNetwork(); });

const noSyncCalls = () => expect(blocked().filter((u) => /strava\.com|coros\.com/.test(u))).toEqual([]);

describe('計画 (練習メニュー)', () => {
  it('登録・一覧・編集・削除', async () => {
    const c = await call(env, 'POST', '/plans', { date: '2026-11-05', type: 'jog', distance_m: 6000 });
    expect(c.status).toBe(201);
    const l = await call(env, 'GET', '/plans?from=2026-11-01&to=2026-11-07');
    expect(l.json.length).toBe(1);
    const u = await call(env, 'PUT', `/plans/${c.json.id}`, { date: '2026-11-06', type: 'easy', distance_m: 8000 });
    expect(u.json.date).toBe('2026-11-06');
    expect(u.json.type).toBe('easy');
    expect((await call(env, 'DELETE', `/plans/${c.json.id}`)).status).toBe(204);
    expect((await call(env, 'GET', '/plans?from=2026-11-01&to=2026-11-07')).json.length).toBe(0);
  });
  it('日付や種類が無い計画は保存しない', async () => {
    const r = await call(env, 'POST', '/plans', { date: 'abc', type: 'jog' });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await call(env, 'GET', '/plans?from=2000-01-01&to=2100-01-01')).json.length).toBe(0);
  });
  it('from/to が無い一覧は 400', async () => {
    expect((await call(env, 'GET', '/plans')).status).toBe(400);
  });
});

describe('計画と実績の紐付け', () => {
  it('同じ日の計画に自動で紐づき、計画側から実績が見える', async () => {
    const p = await call(env, 'POST', '/plans', { date: NOV1.date, type: 'm', distance_m: 12000, pace_min_s: 265, pace_max_s: 275 });
    const id = await addRun(env, NOV1);
    const a = await call(env, 'GET', `/activities/${id}`);
    expect(a.json.plan_id).toBe(p.json.id);
    expect(a.json.evaluation.type).toBe('m');
    const l = await call(env, 'GET', `/plans?from=${NOV1.date}&to=${NOV1.date}`);
    expect(l.json[0].activity_id).toBe(id);
    expect(l.json[0].activity_count).toBe(1);
    noSyncCalls();
  });
  it('同じ日に計画が 2 つあれば、距離の近い方に紐づく', async () => {
    await call(env, 'POST', '/plans', { date: '2026-10-20', type: 'jog', distance_m: 4000 });
    const p2 = await call(env, 'POST', '/plans', { date: '2026-10-20', type: 'easy', distance_m: 10000 });
    const id = await addRun(env, { date: '2026-10-20', km: 10, segs: [{ km: 10, pace: 330, hr: 140 }] });
    expect((await call(env, 'GET', `/activities/${id}`)).json.plan_id).toBe(p2.json.id);
  });
  it('計画が無い日はフリーラン (練習達成度は保留)', async () => {
    const id = await addRun(env, { date: '2026-10-21', km: 5, segs: [{ km: 5, pace: 330 }] });
    const a = await call(env, 'GET', `/activities/${id}`);
    expect(a.json.plan_id).toBeNull();
    expect(a.json.evaluation.type).toBe('free');
    const an = await call(env, 'GET', `/activities/${id}/analysis`);
    expect(an.json.achievement.score).toBeNull();
  });
  it('手動で付け替え・紐付けの解除ができる', async () => {
    const p = await call(env, 'POST', '/plans', { date: '2026-10-22', type: 'easy', distance_m: 8000 });
    const id = await addRun(env, { date: '2026-10-22', km: 8, segs: [{ km: 8, pace: 330 }] });
    expect((await call(env, 'PUT', `/activities/${id}`, { plan_id: null })).status).toBe(200);
    expect((await call(env, 'GET', `/activities/${id}`)).json.plan_id).toBeNull();
    await call(env, 'PUT', `/activities/${id}`, { plan_id: p.json.id });
    expect((await call(env, 'GET', `/activities/${id}`)).json.plan_id).toBe(p.json.id);
  });
  it('計画を消しても実績は残り、紐付けだけ外れる', async () => {
    const p = await call(env, 'POST', '/plans', { date: '2026-10-23', type: 'easy', distance_m: 8000 });
    const id = await addRun(env, { date: '2026-10-23', km: 8, segs: [{ km: 8, pace: 330 }] });
    await call(env, 'DELETE', `/plans/${p.json.id}`);
    const a = await call(env, 'GET', `/activities/${id}`);
    expect(a.status).toBe(200);
    expect(a.json.plan_id).toBeNull();
  });
});

describe('11/1 の 12km 走: 表示と評価の数値がそろっている', () => {
  it('平均ペースは 運動時間 ÷ 距離 = 4:29、サブ3との比較は出ない', async () => {
    await call(env, 'POST', '/plans', { date: NOV1.date, type: 'm', distance_m: 12000, pace_min_s: 265, pace_max_s: 275 });
    const id = await addRun(env, NOV1);
    const a = (await call(env, 'GET', `/activities/${id}`)).json;
    expect(a.moving_time_s).toBe(3230);
    expect(Math.round(a.distance_m / 10) / 100).toBe(12.01);
    const p = Math.round(a.moving_time_s / (a.distance_m / 1000));
    expect(`${Math.floor(p / 60)}:${String(p % 60).padStart(2, '0')}`).toBe('4:29');
    expect(a.evaluation.version).toBe(2);
    expect(a.evaluation.run_pace_s).toBe(269);
    expect(a.evaluation.comments[0]).toContain('平均ペース 4:29/km (運動時間 53:50 ÷ 12.01km)');
    expect(a.evaluation.comments.join('')).not.toContain('サブ3');
    expect(a.evaluation.comments.join('')).not.toContain('4:16');
    const an = (await call(env, 'GET', `/activities/${id}/analysis`)).json;
    expect(an.basis[0]).toContain('平均ペース 4:29/km');
    expect(an.snapshot.pace).toBe(269);
    // 評価区間の平均が全体と違うときは「評価区間」と書いてある
    for (const c of a.evaluation.comments) if (/\d:\d\d\/km/.test(c) && !c.includes('4:29')) expect(/評価区間|1km ごと|目標|後半|前半|最後/.test(c)).toBe(true);
    noSyncCalls();
  });
  it('ピッチ 183 は 180 との差で減点・課題にならない', async () => {
    await call(env, 'POST', '/plans', { date: NOV1.date, type: 'm', distance_m: 12000, pace_min_s: 265, pace_max_s: 275 });
    const id = await addRun(env, NOV1);
    const ev = (await call(env, 'GET', `/activities/${id}`)).json.evaluation;
    expect(ev.cadence.score).toBe(100);
    expect(ev.cadence.summary).not.toContain('参考');
    expect((ev.focus ?? []).join('')).not.toContain('ピッチ');
  });
  it('大会 7 日前: 準備状態は福岡の目標 3:10 (4:30/km) で見る', async () => {
    await call(env, 'POST', '/races', { name: '福岡マラソン2026', date: '2026-11-08', distance_m: 42195, goal_time_s: 11400, priority: 'A', status: 'confirmed', no_auto: true });
    await call(env, 'POST', '/plans', { date: NOV1.date, type: 'm', distance_m: 12000, pace_min_s: 265, pace_max_s: 275 });
    const id = await addRun(env, NOV1);
    const an = (await call(env, 'GET', `/activities/${id}/analysis`)).json;
    expect(an.ready.days).toBe(7);
    expect(an.ready.race).toContain('3:10:00');
    const it = an.ready.rows.find((r: any) => r.label === '強度の適切さ');
    expect(it.value).toContain('4:30/km');
    expect(JSON.stringify(an)).not.toContain('サブ3');
  });
});

describe('主観評価 (ふりかえり) の保存と分析への反映', () => {
  it('未入力のときは保留、入力すると照らし合わせと余裕度に出る', async () => {
    await call(env, 'POST', '/plans', { date: NOV1.date, type: 'm', distance_m: 12000, pace_min_s: 265, pace_max_s: 275 });
    const id = await addRun(env, NOV1);
    let an = (await call(env, 'GET', `/activities/${id}/analysis`)).json;
    expect(an.fitness.items.find((x: any) => x.key === 'reserve').judge).toBe('hold');
    const put = await call(env, 'PUT', `/activities/${id}/feedback`, { breath: 7, leg: 3, rpe: 6, form: 8, pain: 0, reserve: '5-10', memo: 'へそ下を意識', tags: ['cold'] });
    expect(put.status).toBe(200);
    const rv = (await call(env, 'GET', `/activities/${id}/review`)).json;
    expect(rv.fb.breath).toBe(7);
    expect(rv.fb.memo).toBe('へそ下を意識');
    an = (await call(env, 'GET', `/activities/${id}/analysis`)).json;
    expect(an.fitness.items.find((x: any) => x.key === 'reserve').value).toBe('あと 5〜10km');
    const fact = an.subj.find((x: any) => x.kind === 'fact');
    expect(fact.text).toContain('呼吸 7/10・脚 3/10');
    expect(fact.text).toContain('足りないとは言えません');
  });
  it('範囲外の値は 0〜10 に丸め、知らない項目は捨てる', async () => {
    const id = await addRun(env, { date: '2026-10-24', km: 5, segs: [{ km: 5, pace: 330 }] });
    await call(env, 'PUT', `/activities/${id}/feedback`, { breath: 15, leg: -2, rpe: 'x', reserve: 'zzz', tags: ['hot', 'unknown'] });
    const fb = (await call(env, 'GET', `/activities/${id}/review`)).json.fb;
    expect(fb.breath).toBe(10);
    expect(fb.leg).toBe(0);
    expect(fb.rpe).toBeNull();
    expect(fb.reserve).toBeNull();
    expect(fb.tags).toEqual(['hot']);
  });
});

describe('日次・週次・月次の集計', () => {
  it('距離・本数が合う', async () => {
    await addRun(env, { date: '2026-10-26', km: 6, segs: [{ km: 6, pace: 330 }] });
    await addRun(env, { date: '2026-10-28', km: 10, segs: [{ km: 10, pace: 300 }] });
    await addRun(env, { date: '2026-10-28', time: '18:00', km: 4, segs: [{ km: 4, pace: 340 }] });
    await addRun(env, { date: '2026-11-01', km: 12, segs: [{ km: 12, pace: 270 }] });
    const day = (await call(env, 'GET', '/review?from=2026-10-28&to=2026-10-28&kind=day')).json;
    expect(day.km).toBe(14);
    const wk = (await call(env, 'GET', '/review?from=2026-10-26&to=2026-11-01&kind=week')).json;
    expect(wk.km).toBe(32);
    expect(wk.days.length).toBe(7);
    expect(wk.days[2].runs).toBe(2);
    const mo = (await call(env, 'GET', '/review?from=2026-10-01&to=2026-10-31&kind=month')).json;
    expect(mo.km).toBe(20);
    const sum = (await call(env, 'GET', '/summary?from=2026-10-26&to=2026-11-01')).json;
    const total = sum.reduce((a: number, w: any) => a + w.actual_m, 0);
    expect(Math.round(total / 1000)).toBe(32);
  });
});

describe('レース', () => {
  it('目標の登録・状態の変更・削除', async () => {
    const r = await call(env, 'POST', '/races', { name: 'テスト大会', date: '2027-02-01', distance_m: 42195, goal_time_s: 10800, priority: 'A', status: 'candidate', no_auto: true });
    expect(r.status).toBe(201);
    expect(r.json.goal_time_s).toBe(10800);
    const u = await call(env, 'PUT', `/races/${r.json.id}`, { ...r.json, status: 'entered', goal_time_s: 11000, no_auto: true });
    expect(u.json.status).toBe('entered');
    expect(u.json.goal_time_s).toBe(11000);
    expect((await call(env, 'GET', '/races')).json.length).toBe(1);
    expect((await call(env, 'DELETE', `/races/${r.json.id}`)).status).toBe(204);
    expect((await call(env, 'GET', '/races')).json.length).toBe(0);
  });
});

describe('シューズ', () => {
  it('登録・走行距離の合計・編集・削除 (削除しても実績は残る)', async () => {
    const s = await call(env, 'POST', '/shoes', { name: 'テストシューズ', strava_gear_id: 'g-test', initial_km: 100, limit_km: 600 });
    expect(s.status).toBe(201);
    const a1 = await addRun(env, { date: '2026-10-20', km: 10, segs: [{ km: 10, pace: 320 }], gear_id: 'g-test' });
    await addRun(env, { date: '2026-10-21', km: 5, segs: [{ km: 5, pace: 320 }], gear_id: 'g-test' });
    await addRun(env, { date: '2026-10-22', km: 7, segs: [{ km: 7, pace: 320 }] });
    let list = (await call(env, 'GET', '/shoes')).json;
    expect(Math.round(list[0].total_km)).toBe(115);
    expect((await call(env, 'GET', `/activities/${a1}`)).json.shoe_id).toBe(s.json.id);
    const u = await call(env, 'PUT', `/shoes/${s.json.id}`, { name: '名前を変更', strava_gear_id: 'g-test', initial_km: 0, limit_km: 600 });
    expect(u.json.name).toBe('名前を変更');
    list = (await call(env, 'GET', '/shoes')).json;
    expect(Math.round(list[0].total_km)).toBe(15);
    await call(env, 'PUT', `/activities/${a1}`, { shoe_id: null });
    expect(Math.round((await call(env, 'GET', '/shoes')).json[0].total_km)).toBe(5);
    expect((await call(env, 'DELETE', `/shoes/${s.json.id}`)).status).toBe(204);
    expect((await call(env, 'GET', `/activities/${a1}`)).status).toBe(200);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM activities').get().n).toBe(3);
    noSyncCalls();
  });
});

describe('COROS のワークアウト区間の調査 (読み取りのみ)', () => {
  it('COROS 以外のランは 404、COROS のランは外に出られなくてもエラーを返すだけで記録は変わらない', async () => {
    const id = await addRun(env, { date: '2026-10-26', km: 5, segs: [{ km: 5, pace: 330 }] });
    const before = sqlite.prepare('SELECT data FROM ext_activities WHERE id = ?').get(id).data;
    const evBefore = sqlite.prepare('SELECT evaluation FROM activities WHERE id = ?').get(id).evaluation;
    const r = await call(env, 'GET', `/activities/${id}/coros-segments`);
    expect(r.status).toBe(200);
    expect(r.json.saved_laps).toEqual([]);
    expect(typeof (r.json.lap_api_error ?? r.json.fit_error)).toBe('string');
    expect(sqlite.prepare('SELECT data FROM ext_activities WHERE id = ?').get(id).data).toBe(before);
    expect(sqlite.prepare('SELECT evaluation FROM activities WHERE id = ?').get(id).evaluation).toBe(evBefore);
    sqlite.exec(`INSERT INTO activities (id, date, start_date_local, name, sport_type, distance_m, moving_time_s, elapsed_time_s) VALUES (123, '2026-10-26', '2026-10-26T07:00:00Z', 's', 'Run', 5000, 1500, 1500)`);
    expect((await call(env, 'GET', '/activities/123/coros-segments')).status).toBe(404);
  });
});
