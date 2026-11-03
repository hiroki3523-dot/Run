#!/usr/bin/env node
/** 改修履歴 (docs/HISTORY.md) を git のマージ記録から作る: node scripts/history.mjs [--out docs/HISTORY.md] */
import { writeFileSync } from 'node:fs';
import { prHistory } from './lib.mjs';

const list = prHistory('HEAD');
let md = '# 改修履歴\n\ngit のマージ記録 (main に入った PR) から自動で作成。各 PR の中のコミットの題名を並べている。\nPR の説明文 (変更理由) は GitHub の各 PR のページを参照。ここに無いもの (手作業の設定変更など) は「履歴未確認」。\n\n';
md += '| PR | 日付 | ブランチ | 内容 (コミット) |\n|---|---|---|---|\n';
for (const p of list) md += `| ${p.pr ? `#${p.pr}` : p.hash} | ${p.date} | ${p.branch} | ${p.commits.map((c) => c.replace(/\|/g, '/')).join('<br>') || '-'} |\n`;
const nums = new Set(list.map((p) => p.pr).filter(Boolean));
const max = Math.max(0, ...nums);
const gap = Array.from({ length: max }, (_, k) => k + 1).filter((n) => !nums.has(n));
if (gap.length) md += `\n上の表に無い番号: ${gap.map((n) => `#${n}`).join('・')}。main への直接のマージ記録が無いもの (別のブランチ経由でマージされた・閉じられた・Issue の番号など)。内容は GitHub の PR 一覧で確認できる。git だけでは履歴未確認。\n`;
const i = process.argv.indexOf('--out');
if (i > 0) writeFileSync(process.argv[i + 1], md); else process.stdout.write(md);
