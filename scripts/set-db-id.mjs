// デプロイ前に、wrangler.toml の database_id を Cloudflare のビルド変数 D1_DATABASE_ID に置き換える。
// コピー (Fork) して使う人は wrangler.toml を書き換えずに済むので、本家の更新を自動で取り込める。
import { readFileSync, writeFileSync } from 'node:fs';
const id = (process.env.D1_DATABASE_ID || '').trim();
if (!id) process.exit(0);
if (!/^[0-9a-f-]{36}$/i.test(id)) { console.error('D1_DATABASE_ID の形が正しくありません'); process.exit(1); }
const p = new URL('../wrangler.toml', import.meta.url);
writeFileSync(p, readFileSync(p, 'utf8').replace(/database_id\s*=\s*"[^"]*"/, `database_id = "${id}"`));
console.log('database_id を D1_DATABASE_ID に置き換えました');
