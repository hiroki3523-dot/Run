/**
 * テスト用の D1 (Cloudflare のデータベース) の代わり。
 * Node 22 の node:sqlite でメモリ上に作り、migrations/ をすべて当てる。本番のデータには一切触れない。
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');

export function makeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  const norm = (a: unknown[]) => a.map((x) => (x === undefined ? null : typeof x === 'boolean' ? Number(x) : x)) as any[];
  const stmt = (sql: string, args: unknown[] = []): any => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    first: async (col?: string) => { const r = (db.prepare(sql).get(...norm(args)) as any) ?? null; return col && r ? r[col] : r; },
    all: async () => ({ results: db.prepare(sql).all(...norm(args)) as any[], success: true }),
    run: async () => { const r = db.prepare(sql).run(...norm(args)); return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
    raw: async () => db.prepare(sql).all(...norm(args)).map((r: any) => Object.values(r)),
  });
  const DB = { prepare: (sql: string) => stmt(sql), batch: async (list: any[]) => { const out = []; for (const s of list) out.push(await s.run()); return out; }, exec: async (sql: string) => { db.exec(sql); return { count: 1 }; } };
  return { DB: DB as any, sqlite: db };
}
