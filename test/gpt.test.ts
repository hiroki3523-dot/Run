import { beforeEach, describe, expect, it } from 'vitest';
import { gpt } from '../src/gpt';
import { addRun, call, makeEnv } from './helpers/fixtures';

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const TODAY = ymd(new Date(Date.now() + 9 * 3600_000));
const addDays = (s: string, n: number) => ymd(new Date(Date.parse(s) + n * 86400_000));
const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} };

describe('拡張機能: ChatGPT 連携 (/gpt)', () => {
  let env: any;
  const g = async (method: string, path: string, token: string | null, body?: unknown) => {
    const res: Response = await (gpt as any).request(path, { method, headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx);
    const t = await res.text();
    let json: any = null;
    try { json = JSON.parse(t); } catch { json = t; }
    return { status: res.status, json };
  };
  beforeEach(() => { ({ env } = makeEnv()); });

  it('鍵を発行するまでは使えない・APP_TOKEN では使えない・止めたら使えない', async () => {
    expect((await g('GET', '/today', null)).status).toBe(401);
    expect((await g('GET', '/today', env.APP_TOKEN)).status).toBe(401);
    expect((await call(env, 'GET', '/gpt-token')).json).toEqual({ enabled: false, token: null });
    const tok = (await call(env, 'POST', '/gpt-token')).json.token;
    expect(tok).toMatch(/^gpt_[0-9a-f]{48}$/);
    expect((await g('GET', '/today', tok)).status).toBe(200);
    expect((await g('GET', '/today', tok + 'x')).status).toBe(401);
    // 作り直すと前の鍵は使えない
    const tok2 = (await call(env, 'POST', '/gpt-token')).json.token;
    expect((await g('GET', '/today', tok)).status).toBe(401);
    expect((await g('GET', '/today', tok2)).status).toBe(200);
    await call(env, 'DELETE', '/gpt-token');
    expect((await g('GET', '/today', tok2)).status).toBe(401);
    // 説明書は鍵なしで読める
    const spec = (await g('GET', '/openapi.json', null)).json;
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.paths['/gpt/plans'].post.operationId).toBe('savePlans');
    expect(Object.values(spec.paths).flatMap((p: any) => Object.values(p).map((o: any) => o.operationId)).sort()).toEqual(['getRun', 'getToday', 'listPlans', 'listRaces', 'listRuns', 'listShoes', 'savePlans']);
  });

  it('読む: ラン一覧・1 本の詳細・計画・今日・レース・シューズ', async () => {
    const tok = (await call(env, 'POST', '/gpt-token')).json.token;
    await call(env, 'POST', '/shoes', { name: 'Vomero Plus', brand: 'Nike', strava_gear_id: 'g-a' });
    const id = await addRun(env, { date: addDays(TODAY, -1), km: 10, segs: [{ km: 10, pace: 330, hr: 145 }], gear_id: 'g-a' });
    await call(env, 'POST', '/plans', { date: TODAY, type: 'm', distance_m: 14000, pace_min_s: 275, pace_max_s: 280, notes: '巡航' });
    await call(env, 'POST', '/races', { name: '青島', date: addDays(TODAY, 27), distance_m: 42195, goal_time_s: 11400, priority: 'A', status: 'confirmed', no_auto: true });
    await call(env, 'POST', '/body', { weight: 71.4, body_fat: 18.7 });
    const runs = (await g('GET', '/runs?days=7', tok)).json;
    expect(runs.count).toBe(1);
    expect([runs.runs[0].distance_km, runs.runs[0].pace, runs.runs[0].shoe]).toEqual([10, '5:30/km', 'Vomero Plus']);
    const one = (await g('GET', `/runs/${id}`, tok)).json;
    expect([one.id, one.distance_km, one.moving_time]).toEqual([id, 10, '55:00']);
    expect(Array.isArray(one.laps_1km)).toBe(true);
    const plans = (await g('GET', '/plans', tok)).json.plans;
    expect(plans[0]).toEqual({ date: TODAY, type: 'Mペース走', distance_km: 14, pace_range: '4:35/km〜4:40/km', steps: null, notes: '巡航', done: false, actual_km: null, score: null });
    const today = (await g('GET', '/today', tok)).json;
    expect(today.next_race).toEqual({ name: '青島', date: addDays(TODAY, 27), days_left: 27, distance_km: 42.2, goal_time: '3:10:00', goal_pace: '4:30/km' });
    expect(today.body.weight_kg).toEqual({ value: 71.4, date: TODAY });
    expect(today.body.fit_weight_range_kg).toEqual([64.5, 66]);
    expect((await g('GET', '/races', tok)).json.races[0].name).toBe('青島');
    expect((await g('GET', '/shoes', tok)).json.shoes[0].name).toBe('Nike Vomero Plus');
  });

  it('書く: 計画の登録だけ。今日より前・変な種類は入れず理由を返す・走った日の計画は残す・ほかの書き込みはできない', async () => {
    const tok = (await call(env, 'POST', '/gpt-token')).json.token;
    const d1 = addDays(TODAY, 1), d2 = addDays(TODAY, 2);
    const keep = (await call(env, 'POST', '/plans', { date: TODAY, type: 'jog', distance_m: 6000 })).json.id;
    await addRun(env, { date: TODAY, km: 6, segs: [{ km: 6, pace: 340 }] });
    const linked = (await call(env, 'GET', `/plans?from=${TODAY}&to=${TODAY}`)).json[0];
    expect(linked.id).toBe(keep);
    await call(env, 'POST', '/plans', { date: d1, type: 'easy', distance_m: 8000, notes: '古い' });
    const r = await g('POST', '/plans', tok, { plans: [
      { date: addDays(TODAY, -1), type: 'easy', distance_km: 8 },
      { date: TODAY, type: 'long', distance_km: 20 },
      { date: d1, type: 'lt', distance_km: 12.5, pace: '4:15-4:20', notes: '2km×3本', steps: [
        { kind: 'warmup', distance_km: 3, pace: '5:30-6:00' },
        { repeat: 3, work: { distance_km: 2, pace: '4:15-4:20' }, rest: { distance_km: 0.5, pace: '5:45-6:30' } },
        { kind: 'cooldown', distance_km: 2, pace: '5:35-6:05' },
      ] },
      { date: d2, type: 'sprint', distance_km: 5 },
    ] });
    expect(r.status).toBe(200);
    expect(r.json.imported).toBe(1);
    expect(r.json.kept_linked_dates).toEqual([TODAY]);
    expect(r.json.skipped).toEqual([`${addDays(TODAY, -1)}: 今日より前の日は入れません`, `${d2}: 種類 sprint は使えません (easy/jog/long/m/lt/interval/race/rest)`]);
    const got = (await call(env, 'GET', `/plans?from=${TODAY}&to=${d2}`)).json;
    expect(got.map((p: any) => `${p.date}:${p.type}`)).toEqual([`${TODAY}:jog`, `${d1}:lt`]);
    const lt = got[1];
    expect([lt.pace_min_s, lt.pace_max_s, lt.distance_m, lt.notes]).toEqual([255, 260, 12500, '2km×3本']);
    const st = JSON.parse(lt.steps);
    expect(st.map((x: any) => x.kind)).toEqual(['warmup', 'interval', 'cooldown']);
    expect([st[1].reps, st[1].work.value, st[1].work.pmin, st[1].rest.value]).toEqual([3, 2000, 255, 500]);
    // 計画の登録以外の書き込みはできない
    expect((await g('PUT', '/plans', tok, {})).status).toBe(405);
    expect((await g('POST', '/runs', tok, {})).status).toBe(405);
    expect((await g('DELETE', '/plans', tok)).status).toBe(405);
    // 鍵はバックアップに入らない
    const bk = (await call(env, 'GET', '/backup')).json;
    expect(JSON.stringify(bk)).not.toContain(tok);
  });
});
