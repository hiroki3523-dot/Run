// 改修レポート・レビュー用データの作成で共通に使う関数
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
export const tryGit = (...args) => { try { return git(...args); } catch { return ''; } };

/** 比べる元 (main) を決める。BASE を指定すればそれ、なければ origin/main との分岐点 */
export function baseRef() {
  if (process.env.BASE) return process.env.BASE;
  for (const ref of ['origin/main', 'main']) {
    const mb = tryGit('merge-base', 'HEAD', ref);
    if (mb && mb !== tryGit('rev-parse', 'HEAD')) return mb;
  }
  return tryGit('rev-parse', 'HEAD~1') || 'HEAD';
}

/** マージの記録から PR の一覧 (番号・日付・題名・中のコミット) */
export function prHistory(ref = 'HEAD') {
  const lines = tryGit('log', '--merges', '--first-parent', '--format=%H|%P|%ad|%s', '--date=short', ref).split('\n').filter(Boolean);
  return lines.map((l) => {
    const [h, parents, date, subject] = l.split('|');
    const [p1, p2] = parents.split(' ');
    const m = subject.match(/#(\d+) from [^/]+\/(.+)$/);
    const commits = p2 ? tryGit('log', '--format=%s', `${p1}..${p2}`).split('\n').filter(Boolean).reverse() : [];
    return { hash: h.slice(0, 7), date, pr: m ? Number(m[1]) : null, branch: m ? m[2] : '', commits };
  });
}

/** テスト結果を読む。vitest の JSON (--reporter=json) と、ローカルで使う簡易形式の両方に対応 */
export function readResults(path) {
  if (!path || !existsSync(path)) return null;
  const j = JSON.parse(readFileSync(path, 'utf8'));
  const st = (s) => (s === 'passed' ? 'passed' : s === 'failed' ? 'failed' : 'skipped');
  if (Array.isArray(j)) return j.map((x) => ({ file: x.file, name: x.name, status: st(x.status), error: x.error ?? '' }));
  const out = [];
  for (const f of j.testResults ?? []) {
    const file = (f.name || '').replace(/^.*?\/(test\/)/, '$1');
    for (const a of f.assertionResults ?? []) out.push({ file, name: [...(a.ancestorTitles ?? []), a.title].join(' > '), status: st(a.status), error: (a.failureMessages ?? []).join('\n').split('\n').slice(0, 4).join('\n') });
    if (!(f.assertionResults ?? []).length && f.status === 'failed') out.push({ file, name: '(ファイルの読み込み)', status: 'failed', error: (f.message || '').slice(0, 500) });
  }
  return out;
}

export const LABEL = { passed: '合格', failed: '不合格', skipped: '未検証 (スキップ)' };

/** テスト結果を Markdown に */
export function resultsMd(results, title = '動作確認の結果 (自動テスト)') {
  if (!results) return `## ${title}\n\n未検証: テスト結果のファイルがありません (テストを実行していない)。\n`;
  const c = (s) => results.filter((r) => r.status === s).length;
  let md = `## ${title}\n\n合格 ${c('passed')} / 不合格 ${c('failed')} / 未検証 ${c('skipped')} (全 ${results.length} 件)\n\n`;
  const byFile = new Map();
  for (const r of results) { if (!byFile.has(r.file)) byFile.set(r.file, []); byFile.get(r.file).push(r); }
  for (const [file, rs] of byFile) {
    md += `### ${file}\n\n| 結果 | テスト |\n|---|---|\n`;
    for (const r of rs) md += `| ${LABEL[r.status]} | ${r.name.replace(/\|/g, '/')} |\n`;
    const bad = rs.filter((r) => r.status === 'failed');
    for (const r of bad) md += `\n<details><summary>不合格: ${r.name}</summary>\n\n\`\`\`\n${r.error}\n\`\`\`\n</details>\n`;
    md += '\n';
  }
  return md;
}

/** 変更したファイル・関数から、画面名・機能名を引く (docs/feature-map.json) */
export function featuresOf(files, funcs) {
  const map = JSON.parse(readFileSync(new URL('../docs/feature-map.json', import.meta.url), 'utf8'));
  const out = new Map();
  const add = (k, why) => { if (!out.has(k)) out.set(k, new Set()); out.get(k).add(why); };
  for (const f of files) for (const [pat, feats] of Object.entries(map.files)) if (f === pat || (pat.endsWith('/') && f.startsWith(pat))) for (const x of feats) add(x, f);
  for (const fn of funcs) for (const [name, feats] of Object.entries(map.functions)) if (fn === name) for (const x of feats) add(x, `${fn}()`);
  return [...out].map(([k, v]) => ({ feature: k, from: [...v] }));
}
