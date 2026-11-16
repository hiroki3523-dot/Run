import { beforeEach, describe, expect, it } from 'vitest';
import { mcp } from '../src/mcp';
import app from '../src/index';
import { call, makeEnv } from './helpers/fixtures';
const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} };
describe('STRIDE MCP', () => {
  let env: any, token: string;
  beforeEach(async () => { ({ env } = makeEnv()); token = (await call(env, 'POST', '/gpt-token')).json.token; });
  async function rpc(method: string, params: any = {}, key = token, id: any = 1) {
    const res = await (mcp as any).request('/', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', ...(id === undefined ? {} : { id }), method, params }) }, env, ctx);
    return { status: res.status, body: res.status === 202 ? null : await res.json() };
  }
  it('rejects application token, wrong keys and revoked keys', async () => {
    expect((await rpc('tools/list', {}, env.APP_TOKEN)).status).toBe(401);
    expect((await rpc('tools/list', {}, token + 'x')).status).toBe(401);
    await call(env, 'DELETE', '/gpt-token');
    expect((await rpc('tools/list')).status).toBe(401);
  });
  it('negotiates protocols and advertises seven restricted tools', async () => {
    expect((await rpc('initialize', { protocolVersion: '2025-03-26' })).body.result.protocolVersion).toBe('2025-03-26');
    expect((await rpc('server/discover')).body.result.supportedVersions).toContain('2026-07-28');
    const tools = (await rpc('tools/list')).body.result.tools;
    expect(tools.map((t: any) => t.name).sort()).toEqual(['getRun','getToday','listPlans','listRaces','listRuns','listShoes','savePlans']);
    expect(tools.find((t: any) => t.name === 'savePlans').annotations.destructiveHint).toBe(true);
    expect((await rpc('tools/call', { name: 'deleteRun' })).body.error.code).toBe(-32602);
    expect((await rpc('tools/call', { name: 'getRun', arguments: { id: '../settings' } })).body.error.code).toBe(-32602);
  });
  it('reads today through the restricted API', async () => {
    const r = (await rpc('tools/call', { name: 'getToday' })).body.result;
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.content[0].text).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it('requires confirmation, returns skipped dates and preserves linked plans', async () => {
    const today = new Date(Date.now()+9*3600000).toISOString().slice(0,10);
    const args = { plans: [{ date: '2000-01-01', type: 'rest' }, { date: today, type: 'easy', distance_km: 8, pace: '5:30-6:00' }] };
    expect((await rpc('tools/call', { name: 'savePlans', arguments: args })).body.error.code).toBe(-32602);
    expect((await rpc('tools/call', { name: 'savePlans', arguments: { ...args, confirmed: true, replace: false } })).body.error.code).toBe(-32602);
    const r = (await rpc('tools/call', { name: 'savePlans', arguments: { ...args, confirmed: true } })).body.result;
    expect(r.isError).toBe(false);
    const data = JSON.parse(r.content[0].text);
    expect(data.imported).toBe(1);
    expect(data.skipped[0]).toContain('2000-01-01');
    expect(data.kept_linked_dates).toEqual([]);
    const { addRun } = await import('./helpers/fixtures');
    await addRun(env, { date: today, km: 8, segs: [{ km: 8, pace: 330, hr: 140 }] });
    const again = (await rpc('tools/call', { name: 'savePlans', arguments: { confirmed: true, plans: [{ date: today, type: 'rest' }] } })).body.result;
    expect(JSON.parse(again.content[0].text).kept_linked_dates).toContain(today);
  });
  it('does not run tools in notifications and serves the actual mounted route', async () => {
    const req = { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc:'2.0', method:'tools/call', params:{name:'savePlans',arguments:{confirmed:true,plans:[{date:'2099-01-01',type:'rest'}]}} }) };
    expect((await (mcp as any).request('/', req, env, ctx)).status).toBe(202);
    const plans = (await rpc('tools/call', {name:'listPlans', arguments:{from:'2099-01-01',to:'2099-01-01'}})).body.result;
    expect(JSON.parse(plans.content[0].text).plans).toEqual([]);
    const res = await app.fetch(new Request('https://stride.test/mcp', { ...req, body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'}) }), env, ctx as any);
    expect(res.status).toBe(200);
    expect((await res.json() as any).result.tools.length).toBe(7);
  });
});
