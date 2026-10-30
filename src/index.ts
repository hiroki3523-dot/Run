import { Hono } from 'hono';
import { api } from './api';
import { deleteActivity, ingestActivity, sendMorning } from './process';
import { kvGet, kvSet } from './settings';
import { authorizeUrl, exchangeCode, getAthleteId } from './strava';
import type { Env } from './types';

const app = new Hono<{ Bindings: Env }>();

function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------- Strava webhook

/** 購読作成時の検証リクエスト */
app.get('/webhook', (c) => {
  const q = c.req.query();
  if (q['hub.mode'] !== 'subscribe' || !safeEqual(q['hub.verify_token'] ?? '', c.env.STRAVA_VERIFY_TOKEN)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  return c.json({ 'hub.challenge': q['hub.challenge'] });
});

interface WebhookEvent {
  object_type: 'activity' | 'athlete';
  object_id: number;
  aspect_type: 'create' | 'update' | 'delete';
  owner_id: number;
  updates?: Record<string, string>;
}

/** Strava は 2 秒以内の 200 を要求するので、処理は waitUntil で後回しにする */
app.post('/webhook', async (c) => {
  const ev = await c.req.json<WebhookEvent>();
  c.executionCtx.waitUntil(
    (async () => {
      if (ev.object_type !== 'activity') return;
      if (ev.owner_id !== (await getAthleteId(c.env))) return;
      if (ev.aspect_type === 'delete') return deleteActivity(c.env, ev.object_id);
      // update は公開範囲の変更なども来るが、再評価しても害はない (通知は 1 回のみ)
      await ingestActivity(c.env, ev.object_id, { notify: true });
    })().catch((e) => console.error('webhook processing failed', ev, e)),
  );
  return c.text('ok');
});

// ---------------------------------------------------------------- Strava OAuth

app.get('/auth/strava', async (c) => {
  if (!safeEqual(c.req.query('key') ?? '', c.env.APP_TOKEN)) return c.text('unauthorized', 401);
  const state = crypto.randomUUID();
  await kvSet(c.env, 'oauth_state', state);
  return c.redirect(authorizeUrl(c.env, state));
});

app.get('/auth/strava/callback', async (c) => {
  const { code, state, scope, error } = c.req.query();
  const expected = await kvGet(c.env, 'oauth_state');
  if (error || !code || !expected || !safeEqual(state ?? '', expected)) return c.text(`認可に失敗しました: ${error ?? 'state 不一致'}`, 400);
  if (!scope?.includes('activity:read_all')) return c.text('activity:read_all の許可が必要です', 400);
  await exchangeCode(c.env, code);
  await kvSet(c.env, 'oauth_state', '');
  return c.redirect('/#/settings');
});

// ---------------------------------------------------------------- API (要トークン)

app.use('/api/*', async (c, next) => {
  const token = c.req.header('Authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!safeEqual(token, c.env.APP_TOKEN)) return c.json({ error: 'unauthorized' }, 401);
  await next();
});
app.route('/api', api);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sendMorning(env));
  },
} satisfies ExportedHandler<Env>;
