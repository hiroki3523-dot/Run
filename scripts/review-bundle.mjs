#!/usr/bin/env node
/**
 * ChatGPT などの第三者レビューに渡すデータを 1 つの zip にまとめる。
 *   node scripts/review-bundle.mjs [--results test-results.json] [--shots review-shots] [--report report.md] [--out stride-review.zip]
 * 中身: 00_READ_ME_FIRST.md (読み方とレビューしてほしい点) / docs (機能一覧・監査・テスト) / 改修履歴 / 差分 / テスト結果 / スクリーンショット / ソースコード一式
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { baseRef, git, prHistory, readResults, resultsMd, tryGit } from './lib.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const stamp = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const out = arg('--out') || `stride-review-${stamp}.zip`;
const dir = 'review-bundle';
rmSync(dir, { recursive: true, force: true });
mkdirSync(join(dir, 'source'), { recursive: true });

// ソースコード (git で管理しているもの。依存パッケージは含めない)
for (const f of git('ls-files').split('\n').filter(Boolean)) {
  if (/^(node_modules|review-bundle)\//.test(f) || f === 'package-lock.json') continue;
  const to = join(dir, 'source', f);
  mkdirSync(join(to, '..'), { recursive: true });
  cpSync(f, to);
}
// ドキュメント
for (const f of ['FEATURES.md', 'AUDIT.md', 'TESTING.md', 'REVIEW_PROCESS.md']) if (existsSync(`docs/${f}`)) cpSync(`docs/${f}`, join(dir, f));
// 改修履歴と差分
execFileSync('node', ['scripts/history.mjs', '--out', join(dir, 'HISTORY.md')]);
const base = baseRef();
writeFileSync(join(dir, 'latest-diff.patch'), tryGit('diff', `${base}...HEAD`) || '(差分なし)');
const last = prHistory('HEAD')[0];
if (last) writeFileSync(join(dir, 'last-merged-pr.patch'), tryGit('diff', `${last.hash}^1`, last.hash));
// 改修レポート
if (arg('--report') && existsSync(arg('--report'))) cpSync(arg('--report'), join(dir, 'CHANGE_REPORT.md'));
// テスト結果
const results = readResults(arg('--results'));
writeFileSync(join(dir, 'TEST_RESULTS.md'), `# テスト結果\n\n${results ? '' : '未検証: テストを実行していません。\n'}${resultsMd(results, '自動テスト')}`);
// スクリーンショット
const shots = arg('--shots');
const shotList = shots && existsSync(shots) ? readdirSync(shots).filter((f) => f.endsWith('.png')).sort() : [];
if (shotList.length) cpSync(shots, join(dir, 'screenshots'), { recursive: true });

const c = (s) => (results ? results.filter((r) => r.status === s).length : 0);
const readme = `# STRIDE レビュー用データ (${stamp})

STRIDE は、フルマラソンの目標達成に向けた個人用のランニング記録・計画アプリ (スマホ向け Web アプリ)。
Cloudflare Workers + D1 (SQLite) + 1 ページの画面 (public/app.js)。COROS・Strava から走った記録を取り込み、計画と比べて評価する。

## このデータの中身

| ファイル | 内容 |
|---|---|
| FEATURES.md | 機能一覧・画面構成・画面間の関係・計算のしくみ |
| AUDIT.md | 監査結果 (不具合の可能性・計算や表示の不整合・重複・影響しやすい箇所)。**未修正の問題の一覧** |
| TESTING.md | 自動テストの作りと、どの機能をどこまで確かめているか |
| HISTORY.md | 改修履歴 (PR ごと) |
| CHANGE_REPORT.md | 直近の改修レポート (あれば) |
| TEST_RESULTS.md | 自動テストの結果: 合格 ${c('passed')} / 不合格 ${c('failed')} / 未検証 ${c('skipped')}${results ? '' : ' (未実行)'} |
| latest-diff.patch | main との差分 (このデータを作ったブランチの変更) |
| last-merged-pr.patch | 最後にマージした PR の差分 |
| screenshots/ | 主要画面のスクリーンショット (テスト用データ・幅 390px) ${shotList.length ? `${shotList.length} 枚` : '— 今回は無し'} |
| source/ | ソースコード一式 (依存パッケージは除く) |

## 読む順番のおすすめ

1. FEATURES.md で全体をつかむ
2. AUDIT.md で既知の問題を確認する
3. source/src/evaluate.ts (ランの採点)・source/src/analysis.ts (分析)・source/src/review.ts (日・週・月) で評価ロジックを見る
4. source/public/app.js で画面 (画面ごとの関数は FEATURES.md の表を参照)
5. screenshots/ で見た目を確認する

## レビューしてほしい点

1. **評価ロジックの妥当性**: ランの点数 (ペース・心拍・ピッチ・フォーム)、練習達成度と走力評価の分け方、大会直前の評価、目標ペースより速かったときの扱いが、ランニングの考え方として妥当か
2. **数値の一貫性**: 同じランの数値 (平均ペース・心拍・ドリフト・前半後半の差) が画面ごとに食い違っていないか (AUDIT.md の C-01〜C-03 を参照)
3. **不具合**: AUDIT.md に無い不具合・データの扱いの誤り (単位・丸め・null の扱い)
4. **画面設計**: 情報の重複 (AUDIT.md D-01)・分かりにくい表示・スマホでの使いやすさ
5. **テストの抜け**: TESTING.md の「確かめていないこと」のうち、優先して足すべきもの

## 前提・制約 (レビューで提案するときの注意)

- COROS・Strava の連携処理 (src/index.ts の Webhook と認証・src/strava.ts・src/coros.ts・src/backfill.ts・src/fit.ts・src/ext.ts) は安定して動いているので、変更しない方針
- 既存の記録を消す・初期化する変更はしない
- 使う人は 1 人 (本人)。費用をかけない (Cloudflare の無料枠)
- 「推測」と「確かめたこと」を分けて書いてほしい
`;
writeFileSync(join(dir, '00_READ_ME_FIRST.md'), readme);
rmSync(out, { force: true });
execFileSync('zip', ['-qr', join('..', out), '.'], { cwd: dir });
console.log(`作成しました: ${out}`);
