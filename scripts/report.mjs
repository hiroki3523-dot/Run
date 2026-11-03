#!/usr/bin/env node
/**
 * 改修レポートを作る。
 *   node scripts/report.mjs [--results test-results.json] [--notes docs/changes/xxx.md] [--out report.md]
 * - 変更したファイル・画面名/機能名・変更前後の差 (行数)・コミットは git から自動で書く
 * - 動作確認の結果は、テスト結果のファイルから (無ければ「未検証」)
 * - 変更した理由・既存機能への影響・残っている問題・ユーザーによる確認は、--notes のファイルから (無ければ「記入なし」)
 * 比べる元は BASE (環境変数) か、origin/main との分岐点。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { baseRef, featuresOf, git, readResults, resultsMd, tryGit } from './lib.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const base = baseRef();
const head = tryGit('rev-parse', '--short', 'HEAD');
const branch = process.env.GITHUB_HEAD_REF || tryGit('rev-parse', '--abbrev-ref', 'HEAD');

const status = git('diff', '--name-status', `${base}...HEAD`).split('\n').filter(Boolean).map((l) => { const [s, ...f] = l.split('\t'); return { s: s[0], f: f[f.length - 1] }; });
const stat = new Map(git('diff', '--numstat', `${base}...HEAD`).split('\n').filter(Boolean).map((l) => { const [a, d, f] = l.split('\t'); return [f, { add: a, del: d }]; }));
// 変更した関数 (diff の見出しに出る関数名と、追加・削除した関数の定義)
const funcs = new Set();
for (const { f } of status.filter((x) => /\.(ts|js|mjs)$/.test(x.f))) {
  const d = tryGit('diff', '-U0', `${base}...HEAD`, '--', f);
  for (const m of d.matchAll(/^@@[^@]*@@\s*(?:export\s+)?(?:async\s+)?(?:function\s+)?(?:const\s+)?([A-Za-z0-9_]+)(?![.\w])/gm)) funcs.add(m[1]);
  for (const m of d.matchAll(/^[+-](?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/gm)) funcs.add(m[1]);
}
const feats = featuresOf(status.map((x) => x.f), [...funcs]);
const commits = tryGit('log', '--format=- %s (%h)', `${base}..HEAD`);
const S = { A: '追加', M: '変更', D: '削除', R: '名前変更' };
const touchesSync = status.some((x) => /^src\/(index|strava|backfill|coros|fit|ext)\.ts$/.test(x.f));

const notesPath = arg('--notes');
const notes = notesPath && existsSync(notesPath) ? readFileSync(notesPath, 'utf8') : '';
const section = (h) => { const m = notes.match(new RegExp(`##\\s*${h}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s|$)`)); return m ? m[1].trim() : '記入なし'; };

let md = `# 改修レポート: ${branch}\n\n- 作成: ${new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')} (JST)\n- 比べた元: ${base.slice(0, 7)} → ${head}\n\n`;
md += `## 変更した機能 (画面名・機能名)\n\n${feats.length ? feats.map((x) => `- **${x.feature}** (${x.from.join('・')})`).join('\n') : '- (対応表に無いファイルだけの変更)'}\n\n`;
md += touchesSync ? '> **注意: COROS・Strava の連携処理のファイルが変更に含まれています。** 確認してください。\n\n' : '> COROS・Strava の連携処理 (src/index・strava・backfill・coros・fit・ext) は変更していません。\n\n';
md += `## 変更したファイル\n\n| 種類 | ファイル | 追加行 | 削除行 |\n|---|---|---|---|\n${status.map((x) => `| ${S[x.s] ?? x.s} | ${x.f} | ${stat.get(x.f)?.add ?? '-'} | ${stat.get(x.f)?.del ?? '-'} |`).join('\n')}\n\n`;
md += `## 変更前と変更後の違い\n\n${section('変更前と変更後の違い')}\n\nコミット:\n\n${commits || '- (なし)'}\n\n変更した関数: ${[...funcs].sort().join('・') || '-'}\n\n`;
md += `## 変更した理由\n\n${section('変更した理由')}\n\n`;
const results = readResults(arg('--results'));
md += resultsMd(results) + '\n';
md += `## 既存機能への影響\n\n${section('既存機能への影響')}\n\n`;
md += `## 残っている問題\n\n${section('残っている問題')}\n\n`;
md += `## ユーザーによる確認が必要な操作\n\n${section('ユーザーによる確認が必要な操作')}\n`;

const out = arg('--out');
if (out) writeFileSync(out, md); else process.stdout.write(md);
