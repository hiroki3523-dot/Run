import type { Env } from './types';

export interface Notification {
  title: string;
  message: string;
  tags?: string[]; // ntfy の絵文字タグ
  priority?: 1 | 2 | 3 | 4 | 5;
  click?: string;
}

/** ntfy へ JSON で publish する */
export async function notify(env: Env, n: Notification): Promise<void> {
  if (!env.NTFY_TOPIC) {
    console.log('NTFY_TOPIC 未設定のため通知をスキップ', n.title);
    return;
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.NTFY_TOKEN) headers.Authorization = `Bearer ${env.NTFY_TOKEN}`;
  const res = await fetch(env.NTFY_SERVER || 'https://ntfy.sh', {
    method: 'POST',
    headers,
    body: JSON.stringify({ topic: env.NTFY_TOPIC, ...n }),
  });
  if (!res.ok) console.error('ntfy error', res.status, await res.text());
}
