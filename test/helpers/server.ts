/**
 * 画面のテスト用のサーバー: public/ の画面と、テスト用データベースにつないだ API を 1 つのポートで出す。
 * 本番の Cloudflare・データベース・Strava・COROS には接続しない。
 */
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { call } from './fixtures';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

export async function startServer(env: any): Promise<{ url: string; close: () => Promise<void>; apiLog: string[] }> {
  const apiLog: string[] = [];
  const server: Server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined;
        const r = await call(env, req.method || 'GET', url.pathname.slice(4) + url.search, body);
        apiLog.push(`${req.method} ${url.pathname}${url.search} → ${r.status}`);
        res.writeHead(r.status, { 'content-type': 'application/json' });
        res.end(r.status === 204 ? '' : JSON.stringify(r.json));
        return;
      }
      const p = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
      const data = await readFile(join(PUBLIC, p));
      res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
      res.end(data);
    } catch (e) {
      res.writeHead(404); res.end(String(e));
    }
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const port = (server.address() as any).port;
  return { url: `http://127.0.0.1:${port}`, apiLog, close: () => new Promise((ok) => server.close(() => ok())) };
}
