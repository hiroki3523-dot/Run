import { beforeEach, describe, expect, it } from 'vitest';
import app from '../src/index';
import { call, makeEnv } from './helpers/fixtures';

const ctx: any = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} };
const O = 'https://stride.test';
async function s256(v: string) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
  let b = ''; h.forEach((x) => (b += String.fromCharCode(x)));
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('拡張機能: MCP の OAuth ログイン', () => {
  let env: any, key: string;
  const f = (path: string, init: RequestInit = {}) => (app as any).fetch(new Request(`${O}${path}`, init), env, ctx) as Promise<Response>;
  const formPost = (path: string, data: Record<string, string>) => f(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data).toString() });
  const rpc = (token: string, method = 'tools/list') => f('/mcp', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }) });
  beforeEach(async () => { ({ env } = makeEnv()); key = (await call(env, 'POST', '/gpt-token')).json.token; });

  /** 登録 → 許可の画面 → 鍵を入れて許可 → コード → トークン */
  async function login(k = key) {
    const reg = await f('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.com/connector_platform_oauth_redirect'] }) });
    expect(reg.status).toBe(201);
    const client = (await reg.json()) as any;
    const verifier = 'v'.repeat(50), challenge = await s256(verifier);
    const q = { response_type: 'code', client_id: client.client_id, redirect_uri: client.redirect_uris[0], state: 'st1', code_challenge: challenge, code_challenge_method: 'S256', scope: 'stride' };
    const pg = await f(`/oauth/authorize?${new URLSearchParams(q)}`);
    expect(pg.status).toBe(200);
    const html = await pg.text();
    expect(html).toContain('ChatGPT が STRIDE への接続を求めています');
    expect(pg.headers.get('x-frame-options')).toBe('DENY');
    const ok = await formPost('/oauth/authorize', { ...q, key: k, decision: 'allow' });
    return { client, verifier, q, ok };
  }

  it('説明 (メタデータ) と、鍵なしの /mcp は OAuth の場所を案内する', async () => {
    const pr = (await (await f('/.well-known/oauth-protected-resource')).json()) as any;
    expect(pr).toEqual({ resource: `${O}/mcp`, authorization_servers: [O], scopes_supported: ['stride'], bearer_methods_supported: ['header'], resource_name: 'STRIDE' });
    const as = (await (await f('/.well-known/oauth-authorization-server')).json()) as any;
    expect([as.authorization_endpoint, as.token_endpoint, as.registration_endpoint, as.code_challenge_methods_supported]).toEqual([`${O}/oauth/authorize`, `${O}/oauth/token`, `${O}/oauth/register`, ['S256']]);
    const r = await rpc('');
    expect(r.status).toBe(401);
    expect(r.headers.get('WWW-Authenticate')).toBe(`Bearer resource_metadata="${O}/.well-known/oauth-protected-resource"`);
  });

  it('鍵を入れて許可 → トークンで /mcp が使える・更新できる', async () => {
    const { client, verifier, ok } = await login();
    expect(ok.status).toBe(302);
    const loc = new URL(ok.headers.get('Location')!);
    expect(loc.origin + loc.pathname).toBe('https://chatgpt.com/connector_platform_oauth_redirect');
    expect(loc.searchParams.get('state')).toBe('st1');
    const code = loc.searchParams.get('code')!;
    const tok = await formPost('/oauth/token', { grant_type: 'authorization_code', code, redirect_uri: client.redirect_uris[0], client_id: client.client_id, code_verifier: verifier });
    expect(tok.status).toBe(200);
    const t = (await tok.json()) as any;
    expect(t.token_type).toBe('Bearer');
    expect(t.access_token).toMatch(/^mcpat_/);
    const list = (await (await rpc(t.access_token)).json()) as any;
    expect(list.result.tools.length).toBe(7);
    // 同じコードは 2 回使えない
    expect((await formPost('/oauth/token', { grant_type: 'authorization_code', code, redirect_uri: client.redirect_uris[0], client_id: client.client_id, code_verifier: verifier })).status).toBe(400);
    // 更新: 新しいトークンが出て、古い更新用トークンは使えない
    const r2 = (await (await formPost('/oauth/token', { grant_type: 'refresh_token', refresh_token: t.refresh_token, client_id: client.client_id })).json()) as any;
    expect(r2.access_token).toMatch(/^mcpat_/);
    expect((await formPost('/oauth/token', { grant_type: 'refresh_token', refresh_token: t.refresh_token })).status).toBe(400);
    expect((await rpc(r2.access_token)).status).toBe(200);
    // OAuth のトークンでは /gpt や /api には入れない
    expect((await f('/gpt/today', { headers: { Authorization: `Bearer ${r2.access_token}` } })).status).toBe(401);
    expect((await f('/api/settings', { headers: { Authorization: `Bearer ${r2.access_token}` } })).status).toBe(401);
    // ChatGPT 用の鍵を作り直すと、出したトークンはすべて使えない
    await call(env, 'POST', '/gpt-token');
    expect((await rpc(r2.access_token)).status).toBe(401);
    expect((await formPost('/oauth/token', { grant_type: 'refresh_token', refresh_token: r2.refresh_token })).status).toBe(400);
  });

  it('鍵が違う・PKCE が違う・戻り先が違う・許可しない は通らない', async () => {
    const bad = await login('gpt_wrong');
    expect(bad.ok.status).toBe(401);
    expect(await bad.ok.text()).toContain('鍵が違います');
    const { client, q, ok } = await login();
    const code = new URL(ok.headers.get('Location')!).searchParams.get('code')!;
    expect((await formPost('/oauth/token', { grant_type: 'authorization_code', code, redirect_uri: client.redirect_uris[0], client_id: client.client_id, code_verifier: 'x'.repeat(50) })).status).toBe(400);
    expect((await f(`/oauth/authorize?${new URLSearchParams({ ...q, redirect_uri: 'https://evil.example/cb' })}`)).status).toBe(400);
    expect((await f(`/oauth/authorize?${new URLSearchParams({ ...q, code_challenge_method: 'plain' })}`)).status).toBe(400);
    const deny = await formPost('/oauth/authorize', { ...q, decision: 'deny' });
    expect(new URL(deny.headers.get('Location')!).searchParams.get('error')).toBe('access_denied');
    // 連携を止めていると登録できない
    await call(env, 'DELETE', '/gpt-token');
    expect((await f('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://chatgpt.com/cb'] }) })).status).toBe(403);
  });
});
