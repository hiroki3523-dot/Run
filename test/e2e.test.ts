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
    // 11/1: アップ 5.01km → M ペース走 12.01km → ダウン 1.12km (3 つの記録)。計画はステップつき
    const steps = [{ kind: 'warmup', by: 'dist', value: 5000, zone: 1, ref: 'easy' }, { kind: 'work', by: 'dist', value: 12000, zone: 3, pmin: 265, pmax: 275 }, { kind: 'cooldown', by: 'dist', value: 1100, zone: 1, ref: 'easy' }];
    // 計画はロング走 (アップ + M ペース 12km + ダウン)。ユーザーの 11/1 と同じ組み方
    await call(env, 'POST', '/plans', { date: NOV1.date, type: 'long', distance_m: 18100, steps });
    await addRun(env, { date: NOV1.date, time: '06:20', km: 5.01, segs: [{ km: 5.01, pace: 314, hr: 140 }], gear_id: 'g-a' });
    runId = await addRun(env, { ...NOV1, time: '06:48', gear_id: 'g-a' });
    await addRun(env, { date: NOV1.date, time: '07:43', km: 1.12, segs: [{ km: 1.12, pace: 356, hr: 138 }], gear_id: 'g-a' });
    // 10 月・9 月の Easy と LT (一覧・月の成長分析用)
    for (let i = 0; i < 10; i++) {
      await addRun(env, { date: `2026-10-${String(2 + i * 3).padStart(2, '0')}`, km: 8, segs: [{ km: 8, pace: 330, hr: 142 + (i % 3) }] });
      await addRun(env, { date: `2026-09-${String(2 + i * 3).padStart(2, '0')}`, km: 8, segs: [{ km: 8, pace: 335, hr: 147 + (i % 3) }] });
    }
    await call(env, 'POST', '/plans', { date: '2026-10-28', type: 'lt', distance_m: 6500, pace_min_s: 250, pace_max_s: 260 });
    await addRun(env, { date: '2026-10-28', time: '18:30', km: 6.55, segs: [{ km: 6.55, pace: 257, hr: 168 }] });
    await call(env, 'PUT', '/goals/2026-11', { km: 200 });
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
    // 画面の一時保存 (30 秒) を消すため、毎回ページを読み込み直す (テストはサーバー側のデータを直接変えるので)
    await page.goto(`${srv.url}/?t=${Date.now()}${hash}`);
    await page.waitForFunction(() => !document.querySelector('#view')?.textContent?.includes('読み込み中…'), null, { timeout: 15000 });
    await page.waitForTimeout(600);
    if (SHOTS && shot) await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
    const errCard = await page.$$eval('#view > .card.error', (els: Element[]) => els.map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()));
    return { errCard, errors: [...errors] };
  };

  const screens: [string, string, string][] = [
    ['ホーム', '#/', '01-home'],
    ['計画', '#/plans', '02-plans'],
    ['実績 一覧', '#/activities', '03-activities'],
    ['実績 日 (11/1・アップ+メイン+ダウン)', '#/activities?view=day&date=2026-11-01', '04-day'],
    ['実績 週 (10/26〜11/1)', '#/activities?view=week&date=2026-10-26', '05-week'],
    ['実績 月 (2026年11月)', '#/activities?view=month&date=2026-11-01', '06-month'],
    ['実績 月 (2026年10月)', '#/activities?view=month&date=2026-10-01', '06b-month-oct'],
    ['実績 日 (記録なし)', '#/activities?view=day&date=2026-10-03', '04b-day-empty'],
    ['実績 一覧 (ポイントで絞り込み)', '#/activities?f=point', '03b-list-point'],
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

  it('実績 一覧: 日ごとにまとまり、11/1 は 3 本・メインが目立つ', async () => {
    await open('#/activities');
    const day = page.locator('.hl-day', { hasText: '11/1' });
    expect(await day.locator('.hl-run').count()).toBe(3);
    expect(await day.locator('.hl-run.main').count()).toBe(1);
    expect(await day.locator('.hl-dh').textContent()).toContain('18.14km');
    // 絞り込みのボタン 5 つが、横にはみ出さずに画面に収まる
    const chips = await page.$eval('.hl-chips', (el: HTMLElement) => ({ sw: el.scrollWidth, cw: el.clientWidth, right: Math.max(...[...el.children].map((c) => c.getBoundingClientRect().right)) }));
    expect(chips.sw).toBeLessThanOrEqual(chips.cw);
    expect(chips.right).toBeLessThanOrEqual(390);
    await open('#/activities?f=point');
    const txt = await page.textContent('#view');
    expect(txt).toContain('11/1');
    expect(txt).not.toContain('10/2(');
  }, 30000);
  it('実績 日: 評価対象のメイン区間と根拠・主観の欄が出る', async () => {
    await open('#/activities?view=day&date=2026-11-01');
    await page.waitForSelector('.hl-target', { timeout: 15000 });
    const t = await page.textContent('#view');
    expect(t).toContain('18.14');
    expect(t).toContain('記録全体 12.01km');
    expect(t).toContain('計画のステップ');
    expect(t).toContain('主観とデータの照合');
    expect(t).toContain('未入力');
    // 日付の移動
    await page.click('.hl-nav a[aria-label="次へ"]');
    await page.waitForTimeout(800);
    expect(await page.textContent('.hl-nav b')).toContain('11/2');
  }, 40000);
  it('実績 週: 曜日の棒グラフ・量/強度/回復・先週からの変化', async () => {
    await open('#/activities?view=week&date=2026-10-26');
    expect(await page.locator('.wbars .wb-d').count()).toBe(7);
    const t = await page.textContent('#view');
    expect(t).toContain('週評価');
    expect(t).toContain('先週からの変化');
    expect(t).toContain('翌週への提案');
  }, 30000);
  it('実績 月: カレンダー・内訳・成長分析・目標', async () => {
    await open('#/activities?view=month&date=2026-10-01');
    expect(await page.locator('.mcal a').count()).toBe(31);
    expect(await page.locator('.mcal a.run').count()).toBeGreaterThanOrEqual(10);
    const t = await page.textContent('#view');
    expect(t).toContain('練習の内訳');
    expect(t).toContain('月間の成長分析');
    expect(t).toContain('での心拍');
    await open('#/activities?view=month&date=2026-11-01');
    expect(await page.textContent('#view')).toContain('200');
  }, 40000);

  it('実績 一覧: ロング走の M ペース区間は「ロング走 (Mペース)」', async () => {
    await open('#/activities');
    expect(await page.locator('.hl-day', { hasText: '11/1' }).textContent()).toContain('ロング走 (Mペース)');
  }, 30000);
  it('レース一覧: 次の大会が大きく出て、今後・過去が分かれる', async () => {
    await open('#/races');
    const hero = await page.textContent('.rl-hero');
    expect(hero).toContain('テストマラソン');
    expect(hero).toContain('本命');
    expect(hero).toContain('3:10:00');
    expect(hero).toContain('4:30/km');
    expect(await page.locator('.rl-past summary').textContent()).toContain('過去の大会');
  }, 30000);
  it('レース詳細: 項目のタブ・ペース表に補給の列 (5km ごとの通過と検算)', async () => {
    await call(env, 'PUT', `/races/${raceId}`, { ...(await call(env, 'GET', '/races')).json.find((x: any) => x.id === raceId), info: { fuel: [{ km: 10, item: 'ジェル' }, { km: 25, item: '塩タブレット' }] }, no_auto: true });
    await open(`#/races/${raceId}`, '09b-race-detail-fuel');
    expect(await page.locator('.rd-tabs a').count()).toBe(4);
    const rows = await page.$$eval('#pace-out .pr', (els: Element[]) => els.map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()));
    const r10 = rows.find((t) => t.startsWith('10km'))!;
    expect(r10).toContain('ジェル');
    // 目標 3:10:00 のイーブン: 10km 通過は 45:02 前後 (11400 × 10 / 42.195 = 2701.7 秒)
    expect(r10).toMatch(/45:0[12]/);
    expect(rows.find((t) => t.startsWith('25km'))).toContain('塩タブレット');
    expect(rows.find((t) => t.startsWith('5km'))).not.toContain('ジェル');
    await page.click('.rd-tabs [data-go="prep"]');
    await page.waitForTimeout(800);
    expect(await page.$eval('.rd-tabs a.on', (a: HTMLElement) => a.dataset.go)).not.toBe('about');
  }, 40000);
  it('シューズ: 一覧の絞り込み・詳しく (使用履歴・相性・使用感)', async () => {
    await open('#/shoes');
    const card = await page.textContent('[data-shoe] .shoe-body');
    expect(card).toContain('最終使用');
    await open('#/shoes?f=race');
    expect(await page.textContent('#view')).toContain('この用途の使用中のシューズはありません');
    const s = (await call(env, 'GET', '/shoes')).json.find((x: any) => x.name === 'テストシューズA');
    await open(`#/shoes/${s.id}`, '11b-shoe-detail');
    expect(await page.textContent('.sh-head')).toContain('使用回数');
    expect(await page.textContent('.sh-head')).toContain('補正を含む');
    await page.click('[data-shtab="hist"]');
    expect(await page.locator('.sh-pane[data-pane="hist"] .hl-run').count()).toBeGreaterThanOrEqual(4);
    await page.click('[data-shtab="feel"]');
    expect(await page.textContent('.sh-pane[data-pane="feel"]')).toContain('未入力');
  }, 40000);

  it('計画: アップ・インターバル・ダウンのステップが 1 行ずつ縦に並ぶ (横に重ならない)', async () => {
    const steps = [{ kind: 'warmup', by: 'dist', value: 2000, zone: 1, ref: 'easy' }, { kind: 'interval', reps: 3, work: { by: 'dist', value: 1000, pmin: 245, pmax: 255 }, rest: { by: 'dist', value: 200 } }, { kind: 'cooldown', by: 'dist', value: 2000, zone: 1, ref: 'easy' }];
    await call(env, 'POST', '/plans', { date: TODAY, type: 'interval', distance_m: 7600, steps });
    await open('#/plans', '02b-plans-steps');
    const rows = await page.$$eval('.stl .stp-r', (els: Element[]) => els.map((e) => { const r = e.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right }; }));
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < 3; i++) expect(rows[i].top).toBeGreaterThan(rows[i - 1].top + 5);
    for (const r of rows) expect(r.right).toBeLessThanOrEqual(390);
  }, 30000);

  it('ホーム: 今日のトレーニングが一番上、今週の距離・次のレースが続く', async () => {
    await open('#/');
    const order = await page.$$eval('#view > .card:not(.error)', (els: Element[]) => els.map((e) => e.className));
    expect(order[0]).toContain('hm-today');
    expect(order[1]).toContain('hm-week');
    expect(await page.textContent('.hm-race')).toContain('テストマラソン');
    // 最後の行が下の固定メニューに隠れない (いちばん下までスクロールしたとき)
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);
    const gap = await page.evaluate(() => { const last = [...document.querySelectorAll('#view > *')].pop()!.getBoundingClientRect(); const nav = document.querySelector('nav')!.getBoundingClientRect(); return nav.top - last.bottom; });
    expect(gap).toBeGreaterThanOrEqual(0);
  }, 30000);

  it('レース詳細: スクロールしてもタブが見出しのすぐ下に残る (iPhone のノッチ分の高さでも)', async () => {
    await open(`#/races/${raceId}`);
    // iPhone のノッチ分、見出しを高くしても、タブは見出しの下に出る
    await page.addStyleTag({ content: 'header { padding-top: 64px !important; }' });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    for (const y of [800, 1800]) {
      await page.evaluate((yy: number) => window.scrollTo(0, yy), y);
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => ({ tabs: document.querySelector('.rd-tabs')!.getBoundingClientRect().top, head: document.querySelector('header')!.getBoundingClientRect().bottom }));
      expect(Math.abs(r.tabs - r.head)).toBeLessThanOrEqual(2);
    }
    // タブを押すと、その項目の見出しがタブのすぐ下に来る
    await page.click('.rd-tabs [data-go="prep"]');
    await page.waitForTimeout(900);
    const pos = await page.evaluate(() => ({ sec: document.querySelector('#rs-prep')!.getBoundingClientRect().top, tabs: document.querySelector('.rd-tabs')!.getBoundingClientRect().bottom }));
    expect(pos.sec).toBeGreaterThanOrEqual(pos.tabs - 2);
    expect(pos.sec - pos.tabs).toBeLessThan(40);
  }, 40000);
  it('レース詳細: 見出しに自動で作った景色が出て、景色を選び直せる', async () => {
    await open(`#/races/${raceId}`, '09c-race-art');
    expect(await page.$eval('.rd-hero', (e: Element) => e.classList.contains('has-art'))).toBe(true);
    await page.click('.rd-photo');
    await page.waitForSelector('.asheet .as-row[data-k="sea"]');
    await page.click('.asheet .as-row[data-k="sea"]');
    await page.waitForTimeout(1200);
    const inf = JSON.parse((await call(env, 'GET', '/races')).json.find((x: any) => x.id === raceId).info);
    expect(inf.hero).toBe('sea');
    expect(await page.$eval('.rd-hero', (e: Element) => e.classList.contains('has-art'))).toBe(true);
  }, 40000);
  it('レース詳細: 大会の写真を選ぶと見出しの背景になる', async () => {
    await open(`#/races/${raceId}`);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFklEQVR4nGNk+M/AwMDAwMDAwMDAAAAPkAEBXqP1AQAAAABJRU5ErkJggg==', 'base64');
    await page.setInputFiles('#race-photo', { name: 'p.png', mimeType: 'image/png', buffer: png });
    await page.waitForTimeout(1500);
    const inf = JSON.parse((await call(env, 'GET', '/races')).json.find((x: any) => x.id === raceId).info);
    expect(inf.image).toMatch(/^data:image\/jpeg;base64,/);
    expect(await page.$eval('.rd-hero', (e: Element) => e.classList.contains('has-img'))).toBe(true);
  }, 40000);
  it('シューズの編集: 用途のボタンが小さく、「使用感を入力・編集」で使用感の欄が開く', async () => {
    const sh = (await call(env, 'GET', '/shoes')).json.find((x: any) => x.name === 'テストシューズA');
    await open(`#/shoes/${sh.id}`);
    await page.click('[data-shtab="feel"]');
    await page.click('[data-feel-edit]');
    await page.waitForSelector('dialog[open]');
    await page.waitForTimeout(500);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/11c-shoe-edit.png` });
    expect(await page.$eval('#sf-box', (d: HTMLDetailsElement) => d.open)).toBe(true);
    const h = await page.$eval('[data-pu]', (b: Element) => b.getBoundingClientRect().height);
    expect(h).toBeLessThanOrEqual(40);
    await page.selectOption('dialog [name=f_overall]', '8');
    await page.click('dialog button[value=ok]');
    await page.waitForTimeout(1000);
    const after = (await call(env, 'GET', '/shoes')).json.find((x: any) => x.id === sh.id);
    expect(after.feel.overall).toBe(8);
  }, 40000);

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
    // 一覧をタップすると詳しくの画面。そこから編集を開く。開いたときに名称欄へ自動でフォーカスしない
    await page.click(`[data-shoe="${s.id}"] .shoe-fg, [data-shoe="${s.id}"]`);
    await page.waitForSelector('#shoe-edit');
    expect(await page.evaluate(() => location.hash)).toBe(`#/shoes/${s.id}`);
    await page.click('#shoe-edit');
    await page.waitForSelector('dialog[open]');
    expect(await page.evaluate(() => document.activeElement?.getAttribute('name'))).not.toBe('name');
    await page.fill('dialog [name=name]', 'E2Eシューズ改');
    await page.click('dialog button[value=ok]');
    await page.waitForTimeout(800);
    list = (await call(env, 'GET', '/shoes')).json;
    expect(list.some((x: any) => x.name === 'E2Eシューズ改')).toBe(true);
    await page.waitForSelector('#shoe-edit');
    await page.click('#shoe-edit');
    await page.waitForSelector('dialog[open]');
    await page.click('dialog button[value=delete]');
    await page.waitForTimeout(1000);
    list = (await call(env, 'GET', '/shoes')).json;
    expect(list.some((x: any) => x.id === s.id)).toBe(false);
    expect(await page.evaluate(() => location.hash)).toBe('#/shoes');
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
  it('AI コーチ: 崩れた JSON を生のまま出さない・会話を消すと消えたままになる・読めないときは再試行', async () => {
    const realAI = env.AI;
    // 2026-11-04 に画面に出た形 (」で閉じ、配列の ] も抜けている)
    const BROKEN = '{"conclusion":"今日は休養を続け、明日の Jog 5km は予定どおり","reasons":["脚の張りは 2","11/3 の M ペース走で刺激は入っている","レース前なのでリカバリーが最重要」,"keep":["11/7 Jog 3km"],"reply":"無理せずいきましょう。","changes":[]}';
    let next = BROKEN, calls = 0;
    env.AI = { run: async () => { calls++; return { response: next }; } };
    try {
      await page.evaluate(() => { sessionStorage.clear(); sessionStorage.setItem('pm', 'coach'); });
      await open('#/plans');
      await page.waitForSelector('#coach-log .cm-card', { timeout: 15000 });
      if (SHOTS) await (await page.$('#pm-coach')).screenshot({ path: `${SHOTS}/40-coach-brief.png` });
      const text = await page.$eval('#coach-log', (e: Element) => e.textContent || '');
      expect(text).toContain('今日は休養を続け');
      expect(text).toContain('計画変更なし');
      expect(text).not.toMatch(/"conclusion"|[{}]/);
      expect(await page.$('#coach-log [data-cask]')).toBeNull(); // 変更が無いので反映ボタンは出さない
      expect(await page.$$eval('#coach-log .cm-why li', (els: Element[]) => els.map((e) => e.textContent))).toEqual(['脚の張りは 2', '11/3 の M ペース走で刺激は入っている', 'レース前なのでリカバリーが最重要']);

      // 会話を消す → 消えたまま (同じ見立てを自動で出し直さない)
      const before = calls;
      await page.click('#coach-clear');
      await page.waitForTimeout(800);
      expect(await page.$('#coach-log .cm-card')).toBeNull();
      expect(await page.$('#coach-brief-btn')).toBeTruthy();
      await open('#/plans');
      expect(await page.$('#coach-log .cm-card')).toBeNull();
      expect(calls).toBe(before);

      // 読めない返事 → 利用者向けの文と「もう一度試す」。キー名や波括弧は出さない
      next = '{"conclusion": 今週は軽め, "reply": "休養を';
      await page.fill('#coach-text', '明日は走れる？');
      await page.click('#coach-send');
      await page.waitForSelector('#coach-log .cm-err', { timeout: 15000 });
      if (SHOTS) await (await page.$('#pm-coach')).screenshot({ path: `${SHOTS}/41-coach-invalid.png` });
      const t2 = await page.$eval('#coach-log', (e: Element) => e.textContent || '');
      expect(t2).toContain('回答をうまく表示できませんでした');
      expect(t2).not.toMatch(/"conclusion"|"reply"|[{}]/);
      // 再試行 → 変更案つきの返事。反映は確認してから
      const d = addDays(TODAY, 3);
      next = JSON.stringify({ conclusion: '3 日後は Jog に軽くする', reasons: ['疲れが残っている'], keep: [], reply: '軽めにしましょう', changes: [{ date: d, type: 'jog', distance_km: 5 }] });
      await page.click('[data-cretry]');
      await page.waitForSelector('#coach-log [data-cask]', { timeout: 15000 });
      expect(await page.$eval('#coach-log', (e: Element) => e.textContent || '')).toContain('変更案あり：1件');
      expect(await page.$('#coach-log .cm-err')).toBeNull();
      const plansBefore = (await call(env, 'GET', `/plans?from=${d}&to=${d}`)).json;
      await page.click('#coach-log [data-cask]');
      await page.waitForSelector('#coach-log [data-capply]');
      expect((await call(env, 'GET', `/plans?from=${d}&to=${d}`)).json).toEqual(plansBefore); // 確認の前は変えない
      await page.click('#coach-log [data-cno]');
      expect(await page.$('#coach-log [data-capply]')).toBeNull();
      expect((await call(env, 'GET', `/plans?from=${d}&to=${d}`)).json).toEqual(plansBefore);
    } finally {
      env.AI = realAI;
      await page.evaluate(() => sessionStorage.clear());
    }
  }, 90000);
  it('シューズ: 上部 (追加・絞り込み・注意のカード・まとめて設定)・相性は結論と 3 足を横スクロールなしで', async () => {
    // 交換の目安が近いシューズ (目安 700km の 90%)・名前から用途を推定できるシューズ
    const near = (await call(env, 'POST', '/shoes', { name: 'Nike Pegasus 41', initial_km: 640, limit_km: 700, purpose: 'race' })).json;
    const cmp = { easy: [
      { shoe_id: 1001, name: 'Nike ボメロプラス', n: 59, km: 737, pace: 329, hr: 154.8, cad: 177, stride: null, form: 8, leg: 3, next_leg: null, breath: null, gct: null, pain_n: 0 },
      { shoe_id: 1002, name: 'Nike ボメロ18', n: 38, km: 482, pace: 334, hr: 151.8, cad: 175.1, stride: 106, form: 7, leg: 4, next_leg: null, breath: 2, gct: null, pain_n: 0 },
      { shoe_id: 1003, name: 'Nike ズームフライ 6', n: 26, km: 376, pace: 312, hr: 157.1, cad: 177.3, stride: null, form: null, leg: null, next_leg: null, breath: null, gct: null, pain_n: 1 },
      { shoe_id: 1004, name: 'テストシューズA', n: 4, km: 30, pace: 330, hr: 150, cad: 176, stride: null, form: null, leg: null, next_leg: null, breath: null, gct: null, pain_n: 0 },
    ] };
    await page.route('**/api/shoes/compare', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cmp) }));
    try {
      await open('#/shoes', '11d-shoes-top');
      expect(await page.$eval('.sh-top', (e: Element) => e.textContent)).toContain('追加');
      const alert = await page.$eval('.sa-list', (e: Element) => e.textContent || '');
      expect(alert).toContain('交換の目安が近いシューズ');
      expect(alert).toContain('残り60km');
      expect(await page.$eval('.sa-list a.sa', (a: HTMLAnchorElement) => a.getAttribute('href'))).toBe(`#/shoes/${near.id}`);
      expect(await page.$eval('#guess', (e: Element) => e.textContent)).toMatch(/用途をまとめて設定 \(\d+足\)/);
      await page.waitForSelector('#shoe-cmp .sc-rec');
      await (await page.$('#shoe-cmp')).scrollIntoViewIfNeeded();
      if (SHOTS) await (await page.$('#shoe-cmp')).screenshot({ path: `${SHOTS}/11e-shoe-compat.png` });
      expect(await page.$eval('#shoe-cmp .sc-rec', (e: Element) => e.textContent)).toContain('Nike ボメロプラス');
      // 3 足・名前は省略しない・横にはみ出さない
      expect(await page.$$eval('#shoe-cmp .sc-fix:not(.sc-more *) th .sc-nm', (els: Element[]) => els.map((e) => e.textContent))).toEqual(['Nike ボメロプラス', 'Nike ボメロ18', 'Nike ズームフライ 6']);
      const over = await page.$eval('#shoe-cmp', (e: HTMLElement) => e.scrollWidth - e.clientWidth);
      expect(over).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      // 観点を変える: 疲れにくい → 脚の疲労がいちばん少ないシューズ / スピード寄り → いちばん速い
      await page.click('[data-crit="easy"]');
      expect(await page.$eval('#shoe-cmp .sc-rec', (e: Element) => e.textContent)).toContain('脚の疲労 3/10');
      await page.click('[data-crit="speed"]');
      expect(await page.$eval('#shoe-cmp .sc-rec', (e: Element) => e.textContent)).toContain('Nike ズームフライ 6');
      await page.click('[data-scall]');
      expect(await page.$$eval('#shoe-cmp > table.sc-fix th .sc-nm', (els: Element[]) => els.length)).toBe(4);
    } finally {
      await page.unroute('**/api/shoes/compare');
      await call(env, 'DELETE', `/shoes/${near.id}`);
    }
  }, 60000);

  it('ニュース: もっと見る → 閉じる (同じ記事を二重に出さない)', async () => {
    const news = Array.from({ length: 8 }, (_, i) => ({ title: `テスト記事 ${i + 1}`, url: `https://example.com/${i}`, source: 'テスト', date: new Date().toISOString(), tag: 'シューズ' }));
    await page.route('**/api/news', (r: any) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(news) }));
    try {
      await open('#/');
      await page.waitForSelector('#news-list .news-tg', { timeout: 15000 });
      const visible = () => page.$$eval('#news-list li', (els: HTMLElement[]) => els.filter((e) => e.offsetParent !== null).map((e) => e.querySelector('b')?.textContent));
      expect(await visible()).toHaveLength(5);
      expect(await page.textContent('#news-list .news-tg')).toBe('もっと見る (3件)');
      await page.click('#news-list .news-tg');
      const all = await visible();
      expect(all).toHaveLength(8);
      expect(new Set(all).size).toBe(8);
      expect((await page.textContent('#news-list .news-tg'))?.trim()).toBe('閉じる');
      // ボタンは一覧の下
      expect(await page.$eval('#news-list', (e: Element) => e.lastElementChild?.classList.contains('news-tg'))).toBe(true);
      if (SHOTS) await (await page.$('#news-list')).screenshot({ path: `${SHOTS}/01b-news-open.png` });
      await page.click('#news-list .news-tg');
      expect(await visible()).toHaveLength(5);
    } finally {
      await page.unroute('**/api/news');
    }
  }, 60000);
});
