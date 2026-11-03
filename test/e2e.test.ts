/**
 * 画面の通しテスト (ブラウザで実際に操作する)。テスト用データベースを使い、本番のデータには触れない。
 * Playwright が無い環境では、この中のテストは「スキップ」になる (合格にはしない)。
 * スクリーンショットは SCREENSHOT_DIR を指定したときだけ保存する。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { addRun, blockNetwork, call, makeEnv, NOV1 } from './helpers/fixtures';
import { startServer } from './helpers/server';

let pw: any = null;
try { pw = await import('playwright'); } catch { pw = null; }
const SHOTS = process.env.SCREENSHOT_DIR || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const TODAY = ymd(new Date(Date.now() + 9 * 3600_000));
const addDays = (s: string, n: number) => ymd(new Date(Date.parse(s) + n * 86400_000));

describe.skipIf(!pw)('画面 (ブラウザ)', () => {
  let browser: any, page: any, srv: any, env: any, runId = 0, raceId = 0;
  const errors: string[] = [];

  beforeAll(async () => {
    ({ env } = makeEnv());
    blockNetwork();
    // テスト用データ: 計画・実績 (11/1 相当)・レース・シューズ
    const s = await call(env, 'POST', '/shoes', { name: 'テストシューズA', strava_gear_id: 'g-a', initial_km: 50 });
    await call(env, 'POST', '/plans', { date: NOV1.date, type: 'm', distance_m: 12000, pace_min_s: 265, pace_max_s: 275 });
    runId = await addRun(env, { ...NOV1, gear_id: 'g-a' });
    await addRun(env, { date: addDays(TODAY, -1), km: 8, segs: [{ km: 8, pace: 330, hr: 140 }], gear_id: 'g-a' });
    await call(env, 'POST', '/plans', { date: TODAY, type: 'jog', distance_m: 6000 });
    raceId = (await call(env, 'POST', '/races', { name: 'テストマラソン', date: addDays(TODAY, 40), distance_m: 42195, goal_time_s: 11400, priority: 'A', status: 'confirmed', no_auto: true })).json.id;
    expect(s.status).toBe(201);
    srv = await startServer(env);
    browser = await pw.chromium.launch();
    page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e: Error) => errors.push(`pageerror: ${e.message}`));
    page.on('dialog', (d: any) => d.accept());
    await page.addInitScript(() => localStorage.setItem('token', 'test-token'));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r: any) => r.abort()); // 外部 (画像・フォントなど) には出ない
  }, 120000);
  afterAll(async () => { await browser?.close(); await srv?.close(); });

  const open = async (hash: string, shot?: string) => {
    errors.length = 0;
    await page.goto(`${srv.url}/${hash}`);
    await page.waitForFunction(() => !document.querySelector('#view')?.textContent?.includes('読み込み中…'), null, { timeout: 15000 });
    await page.waitForTimeout(600);
    if (SHOTS && shot) await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
    const errCard = await page.$$eval('#view > .card.error', (els: Element[]) => els.map((e) => e.textContent || ''));
    return { errCard, errors: [...errors] };
  };

  const screens: [string, string, string][] = [
    ['ホーム', '#/', '01-home'],
    ['計画', '#/plans', '02-plans'],
    ['実績 一覧', '#/activities', '03-activities'],
    ['実績 日', '#/activities?view=day', '04-day'],
    ['実績 週', '#/activities?view=week', '05-week'],
    ['実績 月', '#/activities?view=month', '06-month'],
    ['レース', '#/races', '08-races'],
    ['大会を探す', '#/races/find', '10-race-find'],
    ['シューズ', '#/shoes', '11-shoes'],
    ['設定', '#/settings', '12-settings'],
    ['週間天気', '#/weather', '13-weather'],
  ];
  for (const [name, hash, shot] of screens) {
    it(`正常表示: ${name}`, async () => {
      const r = await open(hash, shot);
      expect(r.errors).toEqual([]);
      // 天気は外部に出られないテスト環境ではエラーカードが出るのが正しい動き。ほかの画面はエラーカードを出さない
      // ホームの「未連携」の案内は、テスト環境が COROS・Strava とつながっていないための正しい表示
      if (!hash.includes('weather')) expect(r.errCard.filter((t: string) => !t.includes('未連携'))).toEqual([]);
    }, 30000);
  }
  it('正常表示: ランの詳細 (11/1 相当) と分析', async () => {
    const r = await open(`#/activities/${runId}`);
    await page.waitForSelector('.an-top', { timeout: 15000 });
    await page.waitForTimeout(800);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/07-activity-detail.png`, fullPage: true });
    expect(r.errors).toEqual([]);
    const stats = await page.textContent('.stats');
    expect(stats).toContain('4:29');
    expect(await page.textContent('.an-top')).toContain('総合評価');
    expect(await page.textContent('#view')).not.toContain('サブ3の');
  }, 40000);
  it('正常表示: レースの詳細 (ペース表)', async () => {
    const r = await open(`#/races/${raceId}`, '09-race-detail');
    expect(r.errors).toEqual([]);
    const txt = await page.textContent('#view');
    expect(txt).toContain('テストマラソン');
    // 目標 3:10:00 のフルなら 1km あたり 4:30 前後が出る
    expect(/4:3\d/.test(txt)).toBe(true);
  }, 30000);

  for (const [name, hash] of screens.filter(([, h]) => !h.includes('weather'))) {
    it(`横にはみ出さない (幅 390): ${name}`, async () => {
      await open(hash);
      const sw = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(sw).toBeLessThanOrEqual(390);
    }, 30000);
  }
  // [K-03] 修正済み: レース詳細の大会情報のボタンがはみ出していた
  it('横にはみ出さない (幅 390): レース詳細', async () => {
    await open(`#/races/${raceId}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }, 30000);

  it('ナビゲーション: 下のメニューで各画面に移れる', async () => {
    await open('#/');
    for (const tab of ['plans', 'activities', 'races', 'shoes', 'settings', 'home']) {
      await page.click(`nav a[data-tab="${tab}"]`);
      await page.waitForTimeout(400);
      const active = await page.$eval('nav a.active', (a: HTMLElement) => a.dataset.tab);
      expect(active).toBe(tab);
    }
    expect(errors).toEqual([]);
  }, 40000);
  it('ナビゲーション: 詳細画面では戻るボタンが出る', async () => {
    await open(`#/activities/${runId}`);
    expect(await page.$eval('#back', (b: HTMLElement) => !b.classList.contains('hidden'))).toBe(true);
    await open('#/activities');
    expect(await page.$eval('#back', (b: HTMLElement) => b.classList.contains('hidden'))).toBe(true);
  }, 30000);

  it('シューズ: 追加・編集・削除 (画面から)', async () => {
    await open('#/shoes');
    await page.click('#add-shoe');
    await page.fill('dialog [name=name]', 'E2Eシューズ');
    await page.click('dialog button[value=ok]');
    await page.waitForTimeout(800);
    let list = (await call(env, 'GET', '/shoes')).json;
    const s = list.find((x: any) => x.name === 'E2Eシューズ');
    expect(s).toBeTruthy();
    // 開いたときに名称欄へ自動でフォーカスしない
    await page.click(`[data-shoe="${s.id}"] .shoe-fg, [data-shoe="${s.id}"]`);
    await page.waitForSelector('dialog[open]');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('name'))).not.toBe('name');
    await page.fill('dialog [name=name]', 'E2Eシューズ改');
    await page.click('dialog button[value=ok]');
    await page.waitForTimeout(800);
    list = (await call(env, 'GET', '/shoes')).json;
    expect(list.some((x: any) => x.name === 'E2Eシューズ改')).toBe(true);
    await page.click(`[data-shoe="${s.id}"] .shoe-fg, [data-shoe="${s.id}"]`);
    await page.waitForSelector('dialog[open]');
    await page.click('dialog button[value=delete]');
    await page.waitForTimeout(800);
    list = (await call(env, 'GET', '/shoes')).json;
    expect(list.some((x: any) => x.id === s.id)).toBe(false);
  }, 60000);

  it('レース: 追加 (画面から) で目標タイムが保存される', async () => {
    await open('#/races');
    await page.click('#add-race');
    await page.fill('dialog [name=name]', 'E2E大会');
    await page.fill('dialog [name=date]', addDays(TODAY, 60));
    await page.fill('dialog [name=goal]', '3:05:00');
    await page.click('dialog button[value=ok]');
    await page.waitForTimeout(1000);
    const r = (await call(env, 'GET', '/races')).json.find((x: any) => x.name === 'E2E大会');
    expect(r).toBeTruthy();
    expect(r.goal_time_s).toBe(3 * 3600 + 5 * 60);
  }, 40000);

  it('計画: 追加・削除 (画面から)', async () => {
    const day = addDays(TODAY, 2);
    await open(`#/plans`);
    const btn = await page.$(`[data-add="${day}"]`);
    if (!btn) { await open(`#/plans?week=${addDays(TODAY, 2)}`); }
    await page.click(`[data-add="${day}"]`);
    await page.waitForSelector('.wk [data-act="save"]');
    await page.click('.wk [data-type="easy"]');
    await page.click('.wk [data-act="save"]');
    await page.waitForTimeout(1000);
    let plans = (await call(env, 'GET', `/plans?from=${day}&to=${day}`)).json;
    expect(plans.length).toBe(1);
    expect(plans[0].type).toBe('easy');
    await page.click(`[data-plan="${plans[0].id}"]`);
    await page.waitForSelector('.wk [data-act="del"]');
    await page.click('.wk [data-act="del"]');
    await page.waitForTimeout(1000);
    plans = (await call(env, 'GET', `/plans?from=${day}&to=${day}`)).json;
    expect(plans.length).toBe(0);
  }, 60000);

  it('ふりかえり: 画面から保存して分析に反映される', async () => {
    await open(`#/activities/${runId}`);
    await page.waitForSelector('.fbx', { timeout: 15000 });
    await page.click('.fbx [data-rs="5-10"]');
    const save = await page.$('.fbx .fbx-save');
    expect(save).toBeTruthy();
    await save.click();
    await page.waitForTimeout(1500);
    const fb = (await call(env, 'GET', `/activities/${runId}/review`)).json.fb;
    expect(fb.reserve).toBe('5-10');
    const an = (await call(env, 'GET', `/activities/${runId}/analysis`)).json;
    expect(an.fitness.items.find((x: any) => x.key === 'reserve').value).toBe('あと 5〜10km');
  }, 60000);
});
