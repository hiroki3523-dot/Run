/**
 * 拡張機能: ChatGPT などの MCP クライアントが「OAuth」でつなぐための、最小のログイン (OAuth 2.1・PKCE 必須)。
 * - 本人確認は「ChatGPT 用の鍵」(設定 › 拡張機能 で発行) を、STRIDE のページに入れてもらう
 * - 発行するのは /mcp だけで使えるアクセストークン (1 時間) と更新用トークン (30 日・使うたびに取り替え)
 * - ChatGPT 用の鍵を作り直す・止めると、ここで出したトークンもすべて使えなくなる
 * - 保存は kv の oauth_* (バックアップには入らない)。トークンはハッシュだけを保存する
 */
import { Hono } from 'hono';
import { GPT_TOKEN_KEY } from './gpt';
import { kvGet, kvSet } from './settings';
import type { Env } from './types';

export const oauth = new Hono<{ Bindings: Env }>();
export const wellKnown = new Hono<{ Bindings: Env }>();

const AT_TTL = 3600, RT_TTL = 30 * 86400, CODE_TTL = 600;
const now = () => Math.floor(Date.now() / 1000);
const rand = (n = 32) => { const b = new Uint8Array(n); crypto.getRandomValues(b); return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); };
async function sha256(s: string, b64url = false): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  if (!b64url) return Array.from(h, (x) => x.toString(16).padStart(2, '0')).join('');
  let bin = '';
  h.forEach((x) => (bin += String.fromCharCode(x)));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const eq = (a: string, b: string) => { if (!a || !b || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const origin = (c: any) => new URL(c.req.url).origin;
async function getJson(env: Env, key: string): Promise<any> { try { return JSON.parse((await kvGet(env, key)) || 'null'); } catch { return null; } }
async function del(env: Env, key: string) { await env.DB.prepare('DELETE FROM kv WHERE key = ?').bind(key).run(); }
/** 鍵の世代: ChatGPT 用の鍵が変わったら、出したトークンは無効 */
async function keyGen(env: Env): Promise<string | null> { const k = await kvGet(env, GPT_TOKEN_KEY); return k ? (await sha256(k)).slice(0, 16) : null; }
async function form(c: any): Promise<Record<string, string>> {
  const ct = c.req.header('content-type') || '';
  const raw: string = typeof c.req.text === 'function' ? await c.req.text() : await c.req.raw.text();
  if (/json/.test(ct)) { try { return JSON.parse(raw || '{}'); } catch { return {}; } }
  return Object.fromEntries(new URLSearchParams(raw));
}
const err = (c: any, error: string, desc: string, status = 400) => c.json({ error, error_description: desc }, status);
const okRedirect = (u: string) => /^https:\/\//.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u);

/** /mcp で使えるトークンか (アクセストークン)。正しければ true */
export async function checkAccessToken(env: Env, token: string): Promise<boolean> {
  if (!token.startsWith('mcpat_')) return false;
  const t = await getJson(env, `oauth_at:${await sha256(token)}`);
  if (!t || t.exp < now()) return false;
  const g = await keyGen(env);
  return !!g && t.gen === g;
}

// ---------------------------------------------------------------- 説明 (メタデータ)
const resourceMeta = (c: any) => c.json({ resource: `${origin(c)}/mcp`, authorization_servers: [origin(c)], scopes_supported: ['stride'], bearer_methods_supported: ['header'], resource_name: 'STRIDE' });
wellKnown.get('/oauth-protected-resource', resourceMeta);
wellKnown.get('/oauth-protected-resource/mcp', resourceMeta);
const asMeta = (c: any) => c.json({
  issuer: origin(c),
  authorization_endpoint: `${origin(c)}/oauth/authorize`,
  token_endpoint: `${origin(c)}/oauth/token`,
  registration_endpoint: `${origin(c)}/oauth/register`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
  scopes_supported: ['stride'],
});
wellKnown.get('/oauth-authorization-server', asMeta);
wellKnown.get('/openid-configuration', asMeta);

// ---------------------------------------------------------------- クライアントの登録 (ChatGPT が自動で行う)
oauth.post('/register', async (c) => {
  if (!(await kvGet(c.env, GPT_TOKEN_KEY))) return err(c, 'access_denied', 'STRIDE の設定で ChatGPT 連携を使う (鍵を発行) にしてください', 403);
  const b: any = await form(c);
  const uris: string[] = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u: unknown) => typeof u === 'string' && okRedirect(u)).slice(0, 10) : [];
  if (!uris.length) return err(c, 'invalid_redirect_uri', 'redirect_uris (https) が必要です');
  // 登録しすぎない (古いものから消す)
  const { results } = await c.env.DB.prepare("SELECT key FROM kv WHERE key LIKE 'oauth_client:%' ORDER BY rowid DESC LIMIT -1 OFFSET 20").all<{ key: string }>().catch(() => ({ results: [] as { key: string }[] }));
  for (const r of results) await del(c.env, r.key);
  const id = `stride_${rand(12)}`;
  const name = typeof b.client_name === 'string' ? b.client_name.slice(0, 60) : 'MCP クライアント';
  await kvSet(c.env, `oauth_client:${id}`, JSON.stringify({ redirect_uris: uris, name, at: now() }));
  return c.json({ client_id: id, client_name: name, redirect_uris: uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', client_id_issued_at: now() }, 201);
});

// ---------------------------------------------------------------- 許可の画面
const esc = (s: string) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const page = (title: string, body: string, status = 200) => new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;background:#0b0c10;color:#e9e9ec;font-family:system-ui,-apple-system,'Hiragino Sans',sans-serif;display:grid;place-items:center;min-height:100vh;padding:16px;box-sizing:border-box}
.card{background:#151821;border-radius:20px;padding:24px;max-width:420px;width:100%;box-sizing:border-box}h1{font-size:20px;margin:0 0 12px}p{color:#a9adb8;font-size:14px;line-height:1.7}
ul{color:#cfd2da;font-size:14px;line-height:1.8;padding-left:20px}input{width:100%;box-sizing:border-box;font-size:16px;padding:14px;border-radius:12px;border:1px solid #2a2e3a;background:#0f1117;color:#fff;margin:8px 0 14px}
button{width:100%;min-height:52px;border:0;border-radius:999px;font-size:16px;font-weight:700;background:#4f5bff;color:#fff}.no{background:transparent;color:#a9adb8;margin-top:8px;font-weight:500}.e{color:#ff7a7a}</style></head>
<body><div class="card">${body}</div></body></html>`, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'", 'cache-control': 'no-store' } });

async function checkAuthorizeParams(c: any, q: Record<string, string | undefined>) {
  if (q.response_type !== 'code') return 'response_type は code だけです';
  const client = q.client_id ? await getJson(c.env, `oauth_client:${q.client_id}`) : null;
  if (!client) return '登録されていないクライアントです';
  if (!q.redirect_uri || !client.redirect_uris.includes(q.redirect_uri)) return '戻り先 (redirect_uri) が登録と違います';
  if (!q.code_challenge || q.code_challenge_method !== 'S256') return 'PKCE (S256) が必要です';
  return { client };
}
const PARAMS = ['response_type', 'client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'];

oauth.get('/authorize', async (c) => {
  const q = Object.fromEntries(PARAMS.map((k) => [k, c.req.query(k)]));
  const r = await checkAuthorizeParams(c, q);
  if (typeof r === 'string') return page('STRIDE', `<h1>接続できません</h1><p class="e">${esc(r)}</p>`, 400);
  const hidden = PARAMS.filter((k) => q[k] != null).map((k) => `<input type="hidden" name="${k}" value="${esc(q[k]!)}">`).join('');
  return page('STRIDE に接続', `<h1>${esc(r.client.name)} が STRIDE への接続を求めています</h1>
    <p>許可すると、次のことができるようになります。</p>
    <ul><li>ラン・計画・体調・体重・レース・シューズを読む</li><li>計画を登録する (今日より前の日と、走った日の計画は変わりません)</li></ul>
    <p>STRIDE の設定 › 拡張機能 › ChatGPT 連携 の「ChatGPT 用の鍵」をコピーして貼ってください。</p>
    <form method="post" action="/oauth/authorize">${hidden}<input name="key" type="password" autocomplete="off" placeholder="gpt_…" required><button type="submit" name="decision" value="allow">許可する</button><button type="submit" name="decision" value="deny" class="no" formnovalidate>許可しない</button></form>`);
});

oauth.post('/authorize', async (c) => {
  const b = await form(c);
  const r = await checkAuthorizeParams(c, b);
  if (typeof r === 'string') return page('STRIDE', `<h1>接続できません</h1><p class="e">${esc(r)}</p>`, 400);
  const back = new URL(b.redirect_uri);
  if (b.state) back.searchParams.set('state', b.state);
  if (b.decision !== 'allow') { back.searchParams.set('error', 'access_denied'); return new Response(null, { status: 302, headers: { Location: back.toString() } }); }
  const saved = await kvGet(c.env, GPT_TOKEN_KEY);
  if (!saved || !eq(String(b.key || '').trim(), saved)) {
    const hidden = PARAMS.filter((k) => b[k] != null).map((k) => `<input type="hidden" name="${k}" value="${esc(b[k])}">`).join('');
    return page('STRIDE に接続', `<h1>鍵が違います</h1><p class="e">ChatGPT 用の鍵が違うか、連携が止まっています。STRIDE の設定 › 拡張機能 で確かめてください。</p>
      <form method="post" action="/oauth/authorize">${hidden}<input name="key" type="password" autocomplete="off" placeholder="gpt_…" required><button type="submit" name="decision" value="allow">もう一度</button></form>`, 401);
  }
  const code = rand(24);
  await kvSet(c.env, `oauth_code:${await sha256(code)}`, JSON.stringify({ client_id: b.client_id, redirect_uri: b.redirect_uri, challenge: b.code_challenge, exp: now() + CODE_TTL, gen: await keyGen(c.env) }));
  back.searchParams.set('code', code);
  return new Response(null, { status: 302, headers: { Location: back.toString(), 'cache-control': 'no-store' } });
});

// ---------------------------------------------------------------- トークン
async function issue(c: any, client_id: string) {
  const at = `mcpat_${rand(24)}`, rt = `mcprt_${rand(24)}`, gen = await keyGen(c.env);
  await kvSet(c.env, `oauth_at:${await sha256(at)}`, JSON.stringify({ client_id, exp: now() + AT_TTL, gen }));
  await kvSet(c.env, `oauth_rt:${await sha256(rt)}`, JSON.stringify({ client_id, exp: now() + RT_TTL, gen }));
  // 期限切れを掃除
  await c.env.DB.prepare("DELETE FROM kv WHERE (key LIKE 'oauth_at:%' OR key LIKE 'oauth_rt:%' OR key LIKE 'oauth_code:%') AND CAST(json_extract(value, '$.exp') AS INTEGER) < ?").bind(now()).run().catch(() => null);
  return c.json({ access_token: at, token_type: 'Bearer', expires_in: AT_TTL, refresh_token: rt, scope: 'stride' }, 200, { 'cache-control': 'no-store' });
}
oauth.post('/token', async (c) => {
  const b = await form(c);
  const gen = await keyGen(c.env);
  if (!gen) return err(c, 'invalid_grant', 'ChatGPT 連携が止まっています');
  if (b.grant_type === 'authorization_code') {
    const key = `oauth_code:${await sha256(String(b.code || ''))}`;
    const rec = await getJson(c.env, key);
    await del(c.env, key); // 1 回だけ使える
    if (!rec || rec.exp < now() || rec.gen !== gen) return err(c, 'invalid_grant', 'コードが無効か期限切れです');
    if (rec.client_id !== b.client_id || rec.redirect_uri !== b.redirect_uri) return err(c, 'invalid_grant', 'クライアントか戻り先が違います');
    if (!b.code_verifier || !eq(await sha256(b.code_verifier, true), rec.challenge)) return err(c, 'invalid_grant', 'PKCE の確認に失敗しました');
    return issue(c, rec.client_id);
  }
  if (b.grant_type === 'refresh_token') {
    const key = `oauth_rt:${await sha256(String(b.refresh_token || ''))}`;
    const rec = await getJson(c.env, key);
    await del(c.env, key); // 使ったら取り替え
    if (!rec || rec.exp < now() || rec.gen !== gen || (b.client_id && b.client_id !== rec.client_id)) return err(c, 'invalid_grant', '更新用トークンが無効か期限切れです');
    return issue(c, rec.client_id);
  }
  return err(c, 'unsupported_grant_type', 'authorization_code か refresh_token だけです');
});
