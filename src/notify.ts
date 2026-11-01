import type { Env } from './types';

export interface Notification {
  title: string;
  message: string;
  tags?: string[]; // ntfy の絵文字タグ
  priority?: 1 | 2 | 3 | 4 | 5;
  click?: string;
}

export interface NotifyResult {
  channel: 'ntfy' | 'bark';
  ok: boolean;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 5xx / ネットワークエラーは 1 回だけやり直す */
async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  const send = () => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    const res = await send();
    if (res.status < 500) return res;
    await sleep(800);
    return await send();
  } catch {
    await sleep(800);
    return send();
  }
}

/** ntfy へ JSON で publish する */
async function sendNtfy(env: Env, n: Notification): Promise<NotifyResult> {
  const headers: Record<string, string> = {};
  if (env.NTFY_TOKEN) headers.Authorization = `Bearer ${env.NTFY_TOKEN}`;
  try {
    const res = await postJson(env.NTFY_SERVER || 'https://ntfy.sh', headers, { topic: env.NTFY_TOPIC, ...n });
    if (res.ok) return { channel: 'ntfy', ok: true };
    const text = (await res.text()).slice(0, 300);
    console.error('ntfy error', res.status, text);
    return { channel: 'ntfy', ok: false, error: `ntfy ${res.status}: ${text}` };
  } catch (e) {
    console.error('ntfy fetch failed', e);
    return { channel: 'ntfy', ok: false, error: `ntfy 接続失敗: ${(e as Error).message}` };
  }
}

/** Bark (iPhone アプリ) へ送る */
async function sendBark(env: Env, n: Notification): Promise<NotifyResult> {
  const base = (env.BARK_SERVER || 'https://api.day.app').replace(/\/$/, '');
  try {
    const res = await postJson(`${base}/push`, {}, {
      device_key: env.BARK_KEY,
      title: n.title,
      body: n.message,
      group: 'sub3-runner',
      ...(n.click ? { url: n.click } : {}),
    });
    if (res.ok) return { channel: 'bark', ok: true };
    const text = (await res.text()).slice(0, 300);
    console.error('bark error', res.status, text);
    return { channel: 'bark', ok: false, error: `bark ${res.status}: ${text}` };
  } catch (e) {
    console.error('bark fetch failed', e);
    return { channel: 'bark', ok: false, error: `bark 接続失敗: ${(e as Error).message}` };
  }
}

/**
 * 設定されている通知先すべてに送る。失敗しても例外は投げず、結果を返す。
 * NTFY_TOPIC があれば ntfy、BARK_KEY があれば Bark に送信する。
 */
export async function notify(env: Env, n: Notification): Promise<NotifyResult[]> {
  const jobs: Promise<NotifyResult>[] = [];
  if (env.NTFY_TOPIC) jobs.push(sendNtfy(env, n));
  if (env.BARK_KEY) jobs.push(sendBark(env, n));
  if (jobs.length === 0) console.log('通知先が未設定のため通知をスキップ', n.title);
  return Promise.all(jobs);
}
