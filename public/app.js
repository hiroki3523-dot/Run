import { RACE_CATALOG, AREA_NAMES, areaOf } from './race-catalog.js';
// STRIDE — 依存なしの小さな SPA
const view = document.getElementById('view');
const dialog = document.getElementById('dialog');
const dialogForm = document.getElementById('dialog-form');

const PLAN_LABELS = {
  easy: 'Easy', jog: 'Jog', long: 'ロング走', m: 'Mペース走', lt: 'LT走',
  interval: 'インターバル', race: 'レース', rest: '休養',
};
const PURPOSE_LABELS = { easy: 'イージー走', recovery: 'リカバリー・ジョグ', long: 'ロング走', pace: 'ペース走(M・LT)', speed: 'スピード練習', race: 'レース本番' };
const PURPOSE_HINTS = {
  easy: 'ふだんのEasy。いちばん使う 1 足',
  recovery: '疲労抜き・ジョグ。クッション厚め',
  long: 'ロング走。距離を踏むときの 1 足',
  pace: 'MペースやLT走。軽めでよく走る靴',
  speed: 'インターバル・レペ。反発のある靴',
  race: 'レース本番と、本番ペースの練習',
};
const LEGACY_PURPOSE = { daily: ['easy', 'recovery', 'long'], workout: ['pace', 'speed'] };
/** 保存値 (カンマ区切り。古い daily / workout も読める) → 用途の配列 */
const purposesOf = (v) => [...new Set(String(v || '').split(',').map((x) => x.trim()).filter(Boolean).flatMap((x) => LEGACY_PURPOSE[x] ?? [x]).filter((x) => PURPOSE_LABELS[x]))];
const purposeText = (s) => purposesOf(s.purpose).map((x) => PURPOSE_LABELS[x]).join('・') || '用途未設定';
/** 計画の種類 → 向いている用途 (先頭ほど優先) */
const SHOE_PREF = { easy: ['easy', 'recovery', 'long'], jog: ['recovery', 'easy'], long: ['long', 'easy'], m: ['pace', 'race', 'speed'], lt: ['pace', 'speed', 'race'], interval: ['speed', 'pace', 'race'], race: ['race'] };
let SHOES = [];
/** シューズごとの、種類別の使用実績 (/shoes/compare)。推薦に使う */
let SHOE_FIT = null;
const SHOE_FEEL = [['overall', '総合的な走りやすさ'], ['natural', 'フォームの自然さ'], ['cushion', 'クッション性'], ['light', '軽さ'], ['rebound', '反発の強さ'], ['stable', '安定感'], ['load', '脚への負担 (10 = 重い)']];

/**
 * メニューに合うシューズを選ぶ。用途 → 本人の相性評価 → 同じ種類での使用実績 (脚の疲労・走りやすさ・痛み) → 状態の順に見る。
 * 走行距離が少ないことは、同じくらいの候補の中で少しだけ優先する程度 (レース用は距離で選ばない)
 */
const GROUP_OF_TYPE = { easy: 'easy', jog: 'easy', long: 'long', m: 'tempo', lt: 'tempo', interval: 'interval', race: 'race' };
function recommendShoe(type) {
  const prefs = SHOE_PREF[type] ?? ['easy'];
  const g = GROUP_OF_TYPE[type] || 'easy';
  const fit = (SHOE_FIT && SHOE_FIT[g]) || [];
  // 使用中の靴から選ぶ。合う靴が無いときだけ予備から (引退は選ばない)
  const ok = (x) => purposesOf(x.purpose).some((p) => prefs.includes(p));
  const act = SHOES.filter((x) => !x.retired && ok(x));
  const spare = !act.length;
  const cands = (spare ? SHOES.filter((x) => x.retired === 2 && ok(x)) : act).map((x) => {
    const rank = Math.min(...purposesOf(x.purpose).map((p) => prefs.indexOf(p)).filter((k) => k >= 0));
    let sc = 30 - rank * 10;
    const why = [];
    const f = x.feel || {};
    if (f.overall != null) { sc += (f.overall - 5) * 3; if (f.overall >= 8) why.push(`走りやすさ ${f.overall}/10`); }
    if (f.overall != null && f.overall <= 3) { sc -= 30; why.push('相性が良くないと評価'); }
    if (f.load != null && (g === 'long' || g === 'easy')) sc -= Math.max(0, f.load - 5) * 2;
    const u = fit.find((r) => r.shoe_id === x.id);
    if (u) {
      if (u.leg != null) sc -= (u.leg - 5) * 2;
      if (u.next_leg != null) sc -= (u.next_leg - 5) * 2;
      if (u.form != null) sc += (u.form - 5) * 2;
      if (u.pain_n) { sc -= u.pain_n * 8; why.push(`痛みの記録 ${u.pain_n} 回`); }
      if (u.leg != null && u.leg <= 4) why.push(`この種類で脚の疲労 平均 ${u.leg}/10`);
      else if (!why.length) why.push(`この種類で ${u.n} 回使用`);
    }
    const wear = x.total_km / x.limit_km;
    if (wear >= 1) { sc -= 25; why.push('交換目安を超えている'); } else if (wear >= 0.9) { sc -= 8; why.push('交換目安に近い'); }
    if (g !== 'race') sc -= wear * 4; // 同じくらいなら、使っていない方を少しだけ
    return { shoe: x, sc, why, pu: purposesOf(x.purpose).find((p) => prefs.includes(p)) };
  }).sort((a, b) => b.sc - a.sc);
  const top = cands[0];
  if (!top) return null;
  const head = `${PURPOSE_LABELS[top.pu]}用${spare ? ' (予備から)' : ''}`;
  return { shoe: top.shoe, why: [head, ...top.why.slice(0, 2)].join('・') };
}
/** ランニングシューズのブランド (選択肢)。[表示名, 名前の先頭にあればブランドとみなす語] */
const SHOE_BRANDS = [
  ['Nike', /^(nike|ナイキ)\s*/i], ['adidas', /^(adidas|アディダス)\s*/i], ['ASICS', /^(asics|アシックス)\s*/i], ['New Balance', /^(new\s*balance|ニューバランス|nb)\s+/i],
  ['HOKA', /^(hoka(\s*one\s*one)?|ホカ(オネオネ)?)\s*/i], ['On', /^(on|オン)\s+/i], ['Saucony', /^(saucony|サッカニー)\s*/i], ['Brooks', /^(brooks|ブルックス)\s*/i],
  ['Mizuno', /^(mizuno|ミズノ)\s*/i], ['PUMA', /^(puma|プーマ)\s*/i], ['Under Armour', /^(under\s*armour|アンダーアーマー)\s*/i], ['Salomon', /^(salomon|サロモン)\s*/i],
  ['ALTRA', /^(altra|アルトラ)\s*/i], ['Reebok', /^(reebok|リーボック)\s*/i], ['361°', /^361°?\s*/i], ['Diadora', /^(diadora|ディアドラ)\s*/i],
];
/** 名前の先頭のブランドを分ける (ブランドが未設定の靴の、編集画面の初期値だけに使う。保存するまで変えない) */
const splitBrand = (name) => { for (const [b, re] of SHOE_BRANDS) { const m = String(name || '').match(re); if (m && name.length > m[0].length) return [b, name.slice(m[0].length).trim()]; } return [null, name]; };
const shoeModel = (s) => `${s.name}${s.feel?.label ? ` (${s.feel.label})` : ''}`;
const shoeName = (s) => `${s.brand ? `${s.brand} ` : ''}${shoeModel(s)}`;
/** ブランドを小さく 1 行・モデル名を大きく (一覧・詳細・相性の表) */
const shoeNameHtml = (s, cls = '') => `${s.brand ? `<small class="sh-brand">${esc(s.brand)}</small>` : ''}<span class="${cls}">${esc(shoeModel(s))}</span>`;
const DOW = ['日', '月', '火', '水', '木', '金', '土'];

// ---------------------------------------------------------------- utils

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const km = (m, d = 1) => (m == null ? '-' : (m / 1000).toFixed(d));
const pace = (s) => (s == null || !isFinite(s) ? '-' : `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`);
const dur = (sec) => {
  if (sec == null) return '-';
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};
const parseDur = (t) => {
  if (!t) return null;
  const p = String(t).trim().split(':').map(Number);
  if (p.length < 2 || p.some((n) => !isFinite(n))) return null;
  return p.reduce((a, n) => a * 60 + n, 0);
};
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekStart = (d) => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return addDays(d, w === 0 ? -6 : 1 - w); };
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const ymd = (d) => `${d.slice(0, 4)}/${md(d)}`;
const dow = (d) => DOW[new Date(`${d}T00:00:00Z`).getUTCDay()];
const scoreCls = (s) => (s == null ? '' : s >= 80 ? 'good' : s >= 60 ? 'mid' : 'bad');
const scoreHtml = (s) => `<span class="score ${scoreCls(s)}">${s ?? '-'}</span>`;

function getToken() {
  try { return localStorage.getItem('token') || ''; } catch { return ''; }
}
function setToken(t) {
  try { localStorage.setItem('token', t); } catch { /* private mode */ }
}

/**
 * 読み込みの一時保存 (速く切り替えるため)。同じ GET は 30 秒以内なら前の結果を使う。
 * 保存・削除などの変更をしたら、すべて捨てる。連携の状態など、いつも新しい値が要るものは保存しない
 */
const API_CACHE = new Map();
const API_TTL = 30_000;
const NO_CACHE = /^\/(status|coros|strava|notify|backup)|\/coros-segments|^\/news/;
const clearApiCache = () => API_CACHE.clear();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') clearApiCache(); });
async function api(path, opts = {}) {
  const method = String(opts.method || 'GET').toUpperCase();
  if (method !== 'GET') clearApiCache();
  else if (!NO_CACHE.test(path)) {
    const hit = API_CACHE.get(path);
    if (hit && Date.now() - hit.t < API_TTL) return hit.p.then((d) => (d == null ? d : structuredClone(d)));
    const p = apiFetch(path, opts);
    API_CACHE.set(path, { t: Date.now(), p });
    p.catch(() => API_CACHE.delete(path));
    return p.then((d) => (d == null ? d : structuredClone(d)));
  }
  const out = await apiFetch(path, opts);
  if (method !== 'GET') clearApiCache();
  return out;
}
async function apiFetch(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}`, ...opts.headers },
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body,
  });
  if (res.status === 401) {
    location.hash = '#/settings';
    throw new Error('トークンを設定してください');
  }
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/** 入力欄のフォーカスを外す (キーボードを閉じる) */
function noFocus() { const el = document.activeElement; if (el && el !== document.body && el.matches?.('input, textarea, select')) el.blur(); }
/** キーボードが下がって画面の高さが戻るまで待つ (最大 600ms)。キーボードが出ていなければすぐ */
function viewportSettled() {
  const vv = window.visualViewport;
  const ok = () => !vv || (vv.height >= window.innerHeight * 0.9 && vv.offsetTop < 2);
  if (ok()) return Promise.resolve();
  return new Promise((res) => {
    const done = () => { vv.removeEventListener('resize', chk); clearTimeout(t); window.scrollTo(window.scrollX, window.scrollY); res(); };
    const chk = () => { if (ok()) done(); };
    const t = setTimeout(done, 600);
    vv.addEventListener('resize', chk);
  });
}
// 保存・キャンセルを押した時点で入力欄のフォーカスを外す (閉じる前にキーボードを下げる)
dialogForm.addEventListener('pointerdown', (e) => { if (e.target.closest?.('.dlg-actions button')) noFocus(); });
dialogForm.addEventListener('submit', () => noFocus());
/** フォーム内容を dialog で表示し、送信値を返す (キャンセルは null) */
function openDialog(html, { onDelete } = {}) {
  dialogForm.innerHTML = `${html}
    <div class="row spread dlg-actions">
      <div>${onDelete ? '<button value="delete" class="danger" formnovalidate>削除</button>' : ''}</div>
      <div class="row"><button value="cancel" formnovalidate>キャンセル</button><button value="ok" class="primary">保存</button></div>
    </div>`;
  dialog.showModal();
  // 開いたときに最初の入力欄へ自動でフォーカスしない (スマホでキーボードが勝手に出るため)
  noFocus();
  return new Promise((resolve) => {
    dialog.onclose = async () => {
      // iPhone: キーボードが出たまま閉じると、画面の位置がずれて固まったようになる。閉じたらキーボードを下げ、戻るのを待ってから次へ
      noFocus();
      await viewportSettled();
      if (dialog.returnValue === 'delete' && onDelete) {
        if (confirm('削除しますか？')) await onDelete();
        resolve(null);
      } else if (dialog.returnValue === 'ok') {
        resolve(Object.fromEntries(new FormData(dialogForm)));
      } else resolve(null);
    };
  });
}

// ---------------------------------------------------------------- views

/** 今の画面 (内容の部分) を 1 枚の画像にして、保存・共有できるようにする */
async function captureView(title) {
  const ov = document.createElement('div');
  ov.className = 'sheet capsheet';
  ov.innerHTML = '<div class="sheet-bg"></div><div class="sheet-body"><p class="muted" style="text-align:center;margin:30px 0">画像を作っています…</p></div>';
  document.body.appendChild(ov);
  const close = () => ov.remove();
  ov.querySelector('.sheet-bg').onclick = close;
  try {
    const { toBlob } = await import('https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/+esm');
    // 開いている折りたたみはそのまま、ボタン類 (no-cap) は写さない
    const bg = getComputedStyle(document.body).backgroundColor;
    // iPhone の Safari は、1 枚の画像の大きさ (縦×横の点の数) に上限がある (約 1,670 万点)。
    // 画面が長いと上限を超えて保存できなくなるので、超えないように細かさを下げる
    const box = view.getBoundingClientRect();
    const area = Math.max(1, (box.width + 28) * (view.scrollHeight + 28));
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 2, Math.sqrt(14_000_000 / area)));
    const blob = await toBlob(view, { pixelRatio: ratio, backgroundColor: bg, cacheBust: true, filter: (n) => !(n.classList && n.classList.contains('no-cap')), style: { padding: '14px', margin: '0' } });
    if (!blob || blob.size < 1000) throw new Error('画像が空になりました。折りたたみを閉じて、もう一度試してください');
    const name = `${String(title || 'STRIDE').replace(/[\\/:*?"<>|]/g, '')}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    // ボタンを上に (画像が長くても、すぐ押せるように)
    ov.querySelector('.sheet-body').innerHTML = `<div class="cap-acts"><button type="button" class="primary" data-cap="share">保存・共有</button><button type="button" data-cap="close">閉じる</button></div>
      <p class="muted" style="text-align:center;font-size:12px;margin:6px 0 8px">「保存・共有」→「画像を保存」で写真に入ります。画像を長押ししても保存できます。</p>
      <div class="cap-prev"><img src="${url}" alt=""></div>`;
    ov.querySelector('[data-cap="close"]').onclick = () => { URL.revokeObjectURL(url); close(); };
    ov.querySelector('[data-cap="share"]').onclick = async () => {
      if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); } catch {} return; }
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    };
  } catch (e) {
    ov.querySelector('.sheet-body').innerHTML = `<p class="error" style="margin:24px 16px">画像を作れませんでした: ${esc(e.message)}</p><div class="cap-acts"><button type="button" data-cap="close">閉じる</button></div>`;
    ov.querySelector('[data-cap="close"]').onclick = close;
  }
}
// 入力欄にフォーカスしたら、キーボードや下のメニューに隠れないよう画面の中央へ
document.addEventListener('focusin', (e) => {
  const el = e.target;
  if (!el.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea, select')) return;
  setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 280);
});
document.addEventListener('click', (e) => { const b = e.target.closest?.('[data-capture]'); if (b) captureView(b.dataset.capture); });

/** ホームのニュース。画面を出したあとで読み込む (遅くてもホームの表示を待たせない) */
const NEWS_TAG = { 話題: 'var(--accent)', 駅伝: 'var(--c-lt)', シューズ: 'var(--c-long)', 大会: 'var(--c-m)', レース: 'var(--c-easy)', セール: 'var(--bad)' };
function ago(iso) {
  const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3600000));
  return h < 1 ? 'たった今' : h < 24 ? `${h}時間前` : `${Math.round(h / 24)}日前`;
}
async function loadNews() {
  const box = document.getElementById('news-list');
  if (!box) return;
  try {
    const list = await api('/news');
    const item = (n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">
      <span class="news-tag" style="--tc:${NEWS_TAG[n.tag] || 'var(--muted)'}">${esc(n.tag)}</span>
      <b>${esc(n.title)}</b><small class="muted">${esc(n.source)}・${ago(n.date)}</small></a></li>`;
    // 初めは 5 件。残りは「もっと見る」で
    // 開いたあとはボタンを下に置いたまま「閉じる」に変える (同じ記事を二重に出さない)
    box.innerHTML = list.length ? `<ul class="news-l">${list.map((n, i) => item(n).replace('<li>', i >= 5 ? '<li class="news-x hidden">' : '<li>')).join('')}</ul>${list.length > 5 ? `<button type="button" class="news-tg" aria-expanded="false">もっと見る (${list.length - 5}件)</button>` : ''}` : '<p class="muted">いまは表示できるニュースがありません。</p>';
    const tg = box.querySelector('.news-tg');
    if (tg) tg.onclick = () => {
      const open = tg.getAttribute('aria-expanded') !== 'true';
      box.querySelectorAll('.news-x').forEach((li) => li.classList.toggle('hidden', !open));
      tg.setAttribute('aria-expanded', String(open));
      tg.innerHTML = open ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>閉じる' : `もっと見る (${list.length - 5}件)`;
      if (!open) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
  } catch { box.innerHTML = '<p class="muted">ニュースを読み込めませんでした。</p>'; }
}

async function homeView() {
  const t = today();
  const ws = weekStart(t);
  // 天気 (外のサービス)・月間目標・週間グラフは、画面を出してから後で入れる (表示を待たせない)
  const [plans, acts, races, status, settings] = await Promise.all([
    api(`/plans?from=${ws}&to=${addDays(ws, 6)}`),
    api(`/activities?from=${addDays(t, -14)}&to=${t}`),
    api('/races'),
    api('/status'),
    api('/settings'),
  ]);
  dedupeIfNeeded(plans);
  const todays = uniqPlans(plans.filter((p) => p.date === t));
  const next = races.find((r) => r.date >= t && r.status !== 'candidate');
  // 6 週間前から、次のレースの週まで (最大 14 週先)。過去は実績、先は計画
  const endDay = next && next.date <= addDays(ws, 7 * 14) ? next.date : addDays(ws, 6);
  setTimeout(() => {
    const fill = (id, html) => { const el = document.getElementById(id); if (el) el.outerHTML = html; };
    api('/race-weather').then((w) => fill('hm-rwx', next ? weatherCard(w) : '')).catch(() => fill('hm-rwx', ''));
    loadWx().then((w) => fill('hm-wxweek', w ? weekWxCard(t, w.place) : '')).catch(() => fill('hm-wxweek', ''));
    monthGoalCard(t).then((h) => fill('hm-month', h)).catch(() => fill('hm-month', ''));
    // 週間グラフは開いたときに読む
    const acc = document.getElementById('hm-weekly');
    if (acc) acc.addEventListener('toggle', async () => {
      if (!acc.open || acc.dataset.done) return;
      acc.dataset.done = '1';
      try { acc.querySelector('.rv-acc-b').innerHTML = weeklyChart(await api(`/summary?from=${addDays(ws, -7 * 6)}&to=${endDay}`)); bindTrend(acc); } catch { acc.querySelector('.rv-acc-b').innerHTML = '<p class="muted">読み込めませんでした。</p>'; }
    });
  });

  // 今週の走行距離 / 計画 (計画画面の上と同じ数え方: 週の計画の合計と、週に走った距離)
  const weekActs = acts.filter((x) => x.date >= ws && x.date <= addDays(ws, 6));
  const wkKm = weekActs.reduce((x, a) => x + a.distance_m, 0) / 1000;
  const wkPlan = uniqPlans(plans).filter((p) => p.type !== 'rest').reduce((x, p) => x + (p.distance_m || 0), 0) / 1000;
  const wkPct = wkPlan ? Math.round((wkKm / wkPlan) * 100) : null;
  const ranToday = acts.some((x) => x.date === t);
  return `
    ${status.strava_connected || status.coros_connected || settings.source === 'coros' ? '' : '<div class="card error">ランのデータが未連携です。<a href="#/settings">設定</a>から COROS か Strava と連携してください。</div>'}
    <div class="card hm-today">
      <div class="row spread"><h2>今日のトレーニング <small class="muted num">${md(t)}(${dow(t)})</small></h2><a href="#/plans" class="chip mini">計画</a></div>
      ${todays.length === 0 ? '<p class="muted">メニュー未登録。<a href="#/plans">計画</a>から追加できます。</p>' : todays.map((p, i) => planLine(p, false, i === 0 ? markHtml(dayJudge(t, todays, acts.filter((x) => x.date === t), settings)) : '')).join('')}
      ${ranToday ? `<a class="hm-link" href="#/activities?view=day&date=${t}">今日の実績を見る ›</a>` : ''}
    </div>
    <a class="card hm-week" href="#/plans">
      <div class="row spread"><b>今週の走行距離</b><span class="muted num">${wkPct != null ? `${wkPct}%` : ''}</span></div>
      <div class="hm-week-n num"><b>${wkKm.toFixed(1)}</b><small>km</small><span class="muted">${wkPlan ? `/ 計画 ${wkPlan.toFixed(1)}km` : '計画なし'}</span></div>
      ${wkPlan ? `<div class="bar"><div style="width:${Math.min(100, wkPct)}%"></div></div>` : ''}
    </a>
    <div class="card cond" id="cond" data-plan="${esc(JSON.stringify(todays.map((p) => ({ type: p.type, km: p.distance_m ? Math.round(p.distance_m / 100) / 10 : null }))))}"></div>
    <div class="card bodyc" id="bodyc"></div>
    ${next ? `
    <a class="card hm-race ${raceHeroStyle(next).cls}" href="#/races/${next.id}" style="${raceHeroStyle(next).style}">
      <div class="row spread"><small class="muted">次のレース</small>${next.priority === 'A' ? '<span class="rb rb-main">本命</span>' : ''}</div>
      <b class="hm-rname">${esc(next.name)}</b>
      <div class="hm-rrow"><div class="num">${daysBetween(t, next.date) === 0 ? '<b class="hm-days">本日</b>' : `あと <b class="hm-days">${daysBetween(t, next.date)}</b> 日`}</div>
        <div class="num hm-rgoal"><small class="muted">${md(next.date)}(${dow(next.date)})・${km(next.distance_m)}km</small>${next.goal_time_s ? `<b>目標 ${dur(next.goal_time_s)}</b><small class="muted">${pace(next.goal_time_s / (next.distance_m / 1000))}/km</small>` : '<small class="muted">目標未設定</small>'}</div></div>
      <span class="hm-link">ペース表・持ち物 ›</span>
    </a>
    ${goalCard()}
    <div id="hm-rwx"></div>` : ''}
    <div id="hm-month"></div>
    <details class="card rv-acc hm-acc" id="hm-weekly"><summary>週間距離のグラフ</summary><div class="rv-acc-b"><p class="muted">開くと読み込みます</p></div></details>
    <div id="hm-wxweek"></div>
    <div class="card news"><h2>ランニングニュース</h2><div id="news-list"><p class="muted">読み込み中…</p></div></div>`;
}

/** 等ペースで走った場合の 5km ごとの通過タイム */
/** ペース戦略: 区間ペース (秒/km) を位置 (km) の関数で返す。どれも合計タイムは目標と同じ */
const PACE_PLANS = {
  even: { label: 'イーブン', note: '最初から最後まで同じペース。いちばん安定します。', f: (per) => () => per },
  negative: { label: 'ネガティブ', note: '前半を 4 秒/km 抑え、後半を 4 秒/km 上げます。', f: (per) => (k, dist) => per + (k < dist / 2 ? 4 : -4) },
  active: { label: 'アクティブ', note: '前半を 4 秒/km 速く入って貯金し、後半は粘ります。', f: (per) => (k, dist) => per + (k < dist / 2 ? -4 : 4) },
  custom: { label: 'カスタム', note: '5km ごとのペースを ±秒 で調整します (区間のペースをタップ)。合計は目標タイムに合うよう自動で整えます。', f: (per, dist, adj) => (k) => per + ((adj || [])[Math.min(Math.floor(k / 5), Math.ceil(dist / 5) - 1)] || 0) },
};
function paceRows(race, mode) {
  const dist = race.distance_m / 1000;
  const per = race.goal_time_s / dist;
  const f = (PACE_PLANS[mode] || PACE_PLANS.even).f(per, dist, raceInfoOf(race).pace_adj);
  // 1km ずつ積み上げ、最後の端数 (0.195km) も足して、ゴールが目標タイムになるよう微調整
  let t = 0;
  const at = new Map();
  const marks = [];
  for (let k = 5; k < dist; k += 5) marks.push(k);
  if (dist > 21.1 && dist < 21.2 + 21) marks.push(dist / 2);
  marks.sort((x, y) => x - y);
  let pos = 0;
  const raw = (to) => { let tt = 0; for (let k = 0; k < to; ) { const step = Math.min(1, to - k); tt += f(k + step / 2, dist) * step; k += step; } return tt; };
  const scale = race.goal_time_s / raw(dist);
  const rows = [];
  let prevT = 0, prevK = 0;
  for (const k of [...marks, dist]) {
    const tt = raw(k) * scale;
    const lapPace = (tt - prevT) / (k - prevK);
    rows.push({ k, t: tt, lap: lapPace, seg: Math.min(Math.floor((k - 0.001) / 5), Math.ceil(dist / 5) - 1), half: Math.abs(k - dist / 2) < 0.01 && dist > 40, fin: k === dist });
    prevT = tt; prevK = k;
  }
  return rows;
}
/** "8:20" → 秒 */
const clockS = (v) => { const m = String(v || '').match(/(\d{1,2})[:：](\d{2})/); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 : null; };
const clockTxt = (s) => `${Math.floor(s / 3600) % 24}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
/** 距離 (km) の地点を通過する時間 (ネット・秒)。ペース表と同じ計算 */
function timeAt(race, mode, km) {
  const dist = race.distance_m / 1000, per = race.goal_time_s / dist;
  const f = (PACE_PLANS[mode] || PACE_PLANS.even).f(per, dist, raceInfoOf(race).pace_adj);
  const raw = (to) => { let tt = 0; for (let k = 0; k < to; ) { const step = Math.min(1, to - k); tt += f(k + step / 2, dist) * step; k += step; } return tt; };
  return raw(Math.min(km, dist)) * (race.goal_time_s / raw(dist));
}
/** スタート時刻 (自分のブロック) + スタートロス = 自分がスタートラインを越える時刻 (秒)。分からなければ null */
function myStartClock(race) {
  const inf = raceInfoOf(race);
  const blk = (inf.blocks || []).find((b) => inf.my_block && b.name.replace(/ブロック/, '') === String(inf.my_block).replace(/ブロック/, ''));
  const st = clockS(blk?.start || inf.start_time);
  return st == null ? null : st + (inf.start_loss_s || 0);
}
function splitTable(race, mode = 'even') {
  if (!race.goal_time_s) return '<p class="muted">目標タイムを設定すると、ペース表が出ます。</p>';
  const rows = paceRows(race, mode);
  const sc = myStartClock(race);
  const loss = raceInfoOf(race).start_loss_s || 0;
  const paces = rows.map((r) => r.lap);
  const fast = Math.min(...paces), slow = Math.max(...paces);
  const w = (p) => (slow - fast < 1 ? 78 : 62 + ((slow - p) / (slow - fast)) * 38);
  // 補給: 前の地点からこの地点までの補給をこの行に出す (登録したものだけ。無ければ空欄)
  const fuel = (raceInfoOf(race).fuel || []).slice().sort((a, b) => a.km - b.km);
  let prevK = 0;
  const fuelAt = rows.map((r) => { const xs = r.half ? [] : fuel.filter((f) => f.km > prevK && f.km <= r.k + 1e-6); if (!r.half) prevK = r.k; return xs; });
  return `<div class="ptable ${fuel.length ? 'with-fuel' : ''}">
    <div class="ph"><span>地点</span><span>通過${loss ? ' (ネット)' : ''}</span><span>この区間のペース</span>${fuel.length ? '<span>補給</span>' : ''}</div>
    ${rows.map((r, ri) => `<div class="pr ${r.half ? 'half' : ''} ${r.fin ? 'fin' : ''}">
      <span class="pk">${r.fin ? 'ゴール' : r.half ? 'ハーフ' : `${Math.round(r.k)}km`}</span>
      <b class="num">${dur(r.t)}${sc != null ? `<small class="pclock">${clockTxt(sc + r.t)}</small>` : ''}</b>
      ${mode === 'custom' && !r.half ? `<button type="button" class="pbar pbtn" data-seg="${r.seg}"><i style="width:${w(r.lap)}%"></i><em class="num">${pace(r.lap)}</em></button>` : `<span class="pbar"><i style="width:${w(r.lap)}%"></i><em class="num">${pace(r.lap)}</em></span>`}
      ${fuel.length ? `<span class="pfuel">${fuelAt[ri].map((f) => `${esc(f.item)}<small class="num">${f.km}km</small>`).join('<br>') || '<span class="muted">—</span>'}</span>` : ''}
    </div>`).join('')}
  ${fuel.length ? '' : '<p class="muted an-note">補給は登録されていません。下の「補給計画」で登録すると、この表の同じ地点に出ます。</p>'}
  </div>
  ${loss ? `<p class="muted an-note">スタートロス ${mmss(loss)} を見込んだグロス (号砲から) のゴールは ${dur(race.goal_time_s + loss)}。</p>` : ''}
  ${sc != null ? '<p class="muted an-note">時刻は、自分のブロックのスタート時刻 + スタートロスからの見込み。</p>' : ''}`;
}

/** 今月の目標距離。目標が未設定なら、計画の合計を提案する */
async function monthGoalCard(t) {
  const month = t.slice(0, 7);
  const first = `${month}-01`;
  const lastD = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const last = `${month}-${String(lastD).padStart(2, '0')}`;
  const [goal, plans, acts] = await Promise.all([
    api(`/goals/${month}`).catch(() => ({ km: null })),
    api(`/plans?from=${first}&to=${last}`).catch(() => []),
    api(`/activities?from=${first}&to=${last}`).catch(() => []),
  ]);
  const actual = acts.reduce((a, r) => a + r.distance_m, 0) / 1000;
  const planned = uniqPlans(plans).filter((p) => p.type !== 'rest').reduce((a, p) => a + (p.distance_m || 0), 0) / 1000;
  const suggest = Math.round(planned / 10) * 10;
  setTimeout(() => {
    const set = async (v) => { await api(`/goals/${month}`, { method: 'PUT', body: { km: v } }); route(); };
    // ホイールで選ぶ (10km 刻み)。いちばん上の「計画どおり」は、計画の合計を目標にする
    const change = async () => {
      const items = [{ v: 0, label: '計画どおり' }, ...range(1, 60, (x) => `${x * 10}km`)];
      const r = await wheelPick(suggest ? `${Number(month.slice(5))}月の目標 (計画 ${suggest}km)` : `${Number(month.slice(5))}月の目標`, [{ items, value: goal.km && !fromPlan ? Math.round(goal.km / 10) : 0 }]);
      if (r) await set(r[0] === 0 ? null : r[0] * 10);
    };
    view.querySelectorAll('[data-mg-edit]').forEach((b) => (b.onclick = change));
  });
  const daysLeft = lastD - Number(t.slice(8)) + 1;
  // 目標を決めていなければ、計画の合計を目標にする (入力しなくても進み具合が分かる)
  const fromPlan = goal.km == null && suggest > 0;
  if (fromPlan) goal.km = suggest;
  if (goal.km == null) {
    return `<div class="card"><h2>${Number(month.slice(5))}月の目標</h2><p class="muted" style="margin-top:0">今月の走行距離の目標を決めておくと、毎日の進み具合が分かります。</p>
      <p class="num">今月ここまで <b>${actual.toFixed(1)}km</b>${planned ? `・計画の合計 ${Math.round(planned)}km` : ''}</p>
      <button type="button" data-mg-edit class="primary wide">目標を決める</button></div>`;
  }
  const ratio = goal.km ? Math.min(1, actual / goal.km) : 0;
  const left = Math.max(0, goal.km - actual);
  // ここまでに走っておきたい距離: 計画があれば計画の積み上げ (調整期・回復期の少ない週も反映)、無ければ日割り
  const plannedDue = uniqPlans(plans).filter((p) => p.type !== 'rest' && p.date < t).reduce((a, p) => a + (p.distance_m || 0), 0) / 1000;
  const expected = planned > 0 ? goal.km * (plannedDue / planned) : goal.km * ((Number(t.slice(8)) - 1) / lastD);
  const ahead = actual - expected;
  return `<div class="card"><div class="row spread"><h2>${Number(month.slice(5))}月の目標</h2><button type="button" class="mg-btn" data-mg-edit><b class="num">${goal.km}km</b><small>${fromPlan ? '計画から' : '変更'} ›</small></button></div>
    <div class="row spread num" style="margin:6px 0"><span><b>${actual.toFixed(1)}</b> km 走った</span><span class="muted">残り ${left.toFixed(0)}km</span></div>
    <div class="bar mg"><div style="width:${ratio * 100}%"></div><i style="left:${Math.min(100, (expected / goal.km) * 100)}%"></i></div>
    <p class="muted" style="margin:8px 0 0">${left <= 0 ? '目標を達成しました。' : `あと${daysLeft}日・1日平均 ${(left / daysLeft).toFixed(1)}km (${planned > 0 ? '計画の積み上げ' : '日割り'}より ${Math.abs(ahead) < 1 ? 'ほぼ予定どおり' : ahead >= 0 ? `${ahead.toFixed(0)}km 先行` : `${(-ahead).toFixed(0)}km 遅れ`})`}</p>
    <p class="muted" style="margin:4px 0 0;font-size:11.5px">距離の目標の進み具合です。練習の良し悪しは実績の月間評価で見ます。</p>
</div>`;
}

/** 天気コード (WMO) → 線画アイコン。絵文字は使わない */
function wxKind(code) {
  if (code === 0) return ['sun', '晴れ'];
  if (code <= 2) return ['partly', '晴れ時々くもり'];
  if (code === 3) return ['cloud', 'くもり'];
  if (code === 45 || code === 48) return ['fog', '霧'];
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return ['rain', '雨'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['snow', '雪'];
  if (code >= 95) return ['thunder', '雷雨'];
  return ['cloud', 'くもり'];
}
const WX_PATH = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  partly: '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.2M2.2 4.2l.9.9M1.5 10h1.2M13.8 4.2l-.9.9"/><path d="M8.5 20h9a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.4 1.5A3.3 3.3 0 0 0 8.5 20z"/>',
  cloud: '<path d="M7 19h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.3 3.3 0 0 0 7 19z"/>',
  fog: '<path d="M7 14h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.3 3.3 0 0 0 7 14z"/><path d="M5 18h14M8 21h8"/>',
  rain: '<path d="M7 15h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.3 3.3 0 0 0 7 15z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
  snow: '<path d="M7 15h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.3 3.3 0 0 0 7 15z"/><path d="M8 18v.01M12 19v.01M16 18v.01M10 21v.01M14 21v.01"/>',
  thunder: '<path d="M7 14h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.3 3.3 0 0 0 7 14z"/><path d="M12 14l-2 4h3l-2 4"/>',
};
const WX_COLOR = { sun: '#ffb800', partly: '#ffb800', cloud: '#98a0b3', fog: '#98a0b3', rain: '#3d8bff', snow: '#8fd3ff', thunder: '#ff8a1f' };
const wxIcon = (code, size = 24) => {
  const [k, label] = wxKind(code);
  return `<svg class="wx" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${WX_COLOR[k]}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${label}">${WX_PATH[k]}</svg>`;
};
/** 「雨のちくもり」なら 2 つのアイコンを斜めに重ねる。1 種類ならいつものアイコン */
const wxPair = (w, size = 24) => {
  if (w.code2 == null) return wxIcon(w.code, size);
  return `<span class="wxp" style="--s:${size}px" title="${esc(w.label || '')}">${wxIcon(w.code, Math.round(size * 0.78))}${wxIcon(w.code2, Math.round(size * 0.62))}</span>`;
};
const wxText = (w) => w.label || wxKind(w.code)[1];
let WX = {};
const loadWx = async () => {
  try {
    const w = await api('/weather/week');
    WX = Object.fromEntries((w?.days || []).map((d) => [d.date, d]));
    return w;
  } catch { return null; }
};
/** 1 日ぶんの天気 (アイコン・気温・降水確率) */
const wxDay = (d) => {
  const w = WX[d];
  if (!w) return '';
  return `<div class="wxday">${wxPair(w, 22)}<span class="num">${Math.round(w.tmax)}<small>/${Math.round(w.tmin)}℃</small></span>${w.precip_pct != null && w.precip_pct >= 30 ? `<span class="rain num">${w.precip_pct}%</span>` : ''}</div>`;
};

function weekWxCard(from, place) {
  const days = [...Array(7)].map((_, i) => addDays(from, i));
  return `<a class="card linkcard" href="#/weather"><div class="row spread"><h2>週間天気</h2><span class="muted">${esc(place)} ・詳しく見る ›</span></div>
    <div class="wxweek">${days.map((d) => {
      const w = WX[d];
      return `<div class="${d === from ? 'today' : ''}"><div class="muted">${dow(d)}</div>${w ? wxPair(w, 28) : '<span class="muted">-</span>'}<b class="num">${w ? Math.round(w.tmax) : '-'}</b><span class="muted num">${w ? Math.round(w.tmin) : ''}</span><span class="rain num">${w && w.precip_pct != null && w.precip_pct >= 30 ? w.precip_pct + '%' : ''}</span></div>`;
    }).join('')}</div></a>`;
}

const idxColor = (i) => (i >= 85 ? '#16b57a' : i >= 70 ? '#2fb7c9' : i >= 50 ? '#ffb800' : i >= 30 ? '#ff8a1f' : '#e63946');
const idxLabel = (i) => (i >= 85 ? '最適' : i >= 70 ? '走りやすい' : i >= 50 ? 'ふつう' : i >= 30 ? 'きびしい' : '避けたい');
const wbgtLabel = (w) => (w >= 31 ? '運動は原則中止' : w >= 28 ? '厳重警戒' : w >= 25 ? '警戒' : w >= 21 ? '注意' : 'ほぼ安全');
const wbgtColor = (w) => (w >= 31 ? '#e63946' : w >= 28 ? '#ff4f7b' : w >= 25 ? '#ff8a1f' : w >= 21 ? '#ffb800' : '#16b57a');

/** 24 時間の気温 (線)・降水確率 (棒)・走りやすさ (色帯) */
function hourChart(hours) {
  const hs = hours.slice(0, 24);
  if (hs.length < 3) return '';
  const W = 340, H = 170, L = 30, R = 10, T = 12, B = 44;
  const x = (i) => L + (i / (hs.length - 1)) * (W - L - R);
  const ts = hs.map((h) => h.temp), tmin = Math.floor(Math.min(...ts) - 1), tmax = Math.ceil(Math.max(...ts) + 1);
  const y = (v) => T + ((tmax - v) / (tmax - tmin || 1)) * (H - T - B);
  const bw = (W - L - R) / hs.length;
  const bars = hs.map((h, i) => `<rect x="${(x(i) - bw / 2 + 1).toFixed(1)}" y="${(H - B - ((h.precip_pct ?? 0) / 100) * (H - T - B) * 0.55).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(((h.precip_pct ?? 0) / 100) * (H - T - B) * 0.55).toFixed(1)}" fill="#3d8bff" opacity=".35"/>`).join('');
  const strip = hs.map((h, i) => `<rect x="${(x(i) - bw / 2).toFixed(1)}" y="${H - B + 8}" width="${bw.toFixed(1)}" height="12" fill="${idxColor(h.index)}" opacity="${h.daylight ? 1 : 0.35}"/>`).join('');
  const xl = hs.map((h, i) => (i % 3 === 0 ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${h.h}</text>` : '')).join('');
  const line = `<polyline fill="none" stroke="#ff8a1f" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" points="${hs.map((h, i) => `${x(i).toFixed(1)},${y(h.temp).toFixed(1)}`).join(' ')}"/>`;
  const grid = [tmin, Math.round((tmin + tmax) / 2), tmax].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="var(--line)"/><text x="${L - 5}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`).join('');
  return `<div class="schart"><div class="legend"><span><i style="background:#ff8a1f"></i>気温(℃)</span><span><i style="background:#3d8bff;opacity:.5"></i>降水確率</span><span><i style="background:#16b57a"></i>下の帯は走りやすさ</span></div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="24時間の気温と降水確率"><g class="ax">${grid}${xl}</g>${bars}${line}${strip}</svg></div>`;
}

async function weatherView() {
  const f = await api('/weather/forecast');
  setTimeout(() => {
    const b = view.querySelector('#change-place'); if (b) b.onclick = () => pickPlace();
    const r = view.querySelector('#wx-reload'); if (r) r.onclick = () => route();
  });
  if (!f) return `<div class="card error">天気を取得できませんでした。<button id="wx-reload">もう一度</button></div>`;
  const n = f.now;
  const dowOf = (d) => dow(d);
  const best = (d, label) => (d?.best ? `<div class="bestrow"><span class="bt">${label}</span><b class="num">${d.best.from}〜${d.best.to}時</b><span class="num">${d.best.temp}℃</span><span class="pill" style="background:${idxColor(d.best.index)}">${d.best.label}</span></div>` : '');
  return `
    <div class="row spread" style="margin-bottom:10px"><h2>${esc(f.place.name)}の天気</h2><button id="change-place" class="primary">場所を変える</button></div>
    ${n ? `<div class="card">
      <div class="nowrow"><div>${wxIcon(n.code, 56)}</div><div><div class="bigt num">${Math.round(n.temp)}<small>℃</small></div><div class="muted">${wxKind(n.code)[1]}・体感 ${Math.round(n.feels)}℃</div></div>
        <div class="nowidx"><div class="muted">走りやすさ</div><div class="num idx" style="color:${idxColor(n.index)}">${n.index}</div><div style="color:${idxColor(n.index)};font-weight:700">${idxLabel(n.index)}</div></div></div>
      <div class="facts num">
        <div><span class="muted">湿度</span><b>${Math.round(n.humidity)}%</b></div>
        <div><span class="muted">風</span><b>${windArrow(n.dir)}${n.wind.toFixed(1)}m/s</b><small class="muted">${n.dir != null ? `${dirName(n.dir)}の風` : ''}${n.gust ? `・瞬間${n.gust.toFixed(0)}` : ''}</small></div>
        <div><span class="muted">降水</span><b>${n.precip_pct ?? 0}%</b></div>
        <div><span class="muted">暑さ指数</span><b style="color:${wbgtColor(n.wbgt)}">${n.wbgt}</b></div>
      </div>
      <p class="muted" style="margin:10px 0 0">暑さ指数 <b style="color:${wbgtColor(n.wbgt)}">${wbgtLabel(n.wbgt)}</b></p>
    </div>` : ''}
    <div class="card"><h2>ランのアドバイス</h2><ul class="bullets">${f.advice.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
</div>
    <div class="card"><h2>おすすめの時間帯</h2>${best(f.daily[0], '今日')}${best(f.daily[1], '明日')}${best(f.daily[2], dowOf(f.daily[2]?.date || '') + '曜')}</div>
    <div class="card"><h2>今日から 24 時間</h2>${hourChart(f.hourly)}
      <div class="hscroll">${f.hourly.slice(0, 24).map((h) => `<div class="hcell"><span class="muted num">${h.h}時</span>${wxIcon(h.code, 22)}<b class="num">${Math.round(h.temp)}°</b><span class="rain num">${(h.precip_pct ?? 0) >= 20 ? h.precip_pct + '%' : ''}</span><span class="hw num">${windArrow(h.dir, 12)}${h.wind.toFixed(0)}<small>m</small></span><small class="hwd muted">${dirName(h.dir)}</small><i style="background:${idxColor(h.index)}"></i></div>`).join('')}</div>
      <p class="muted hint">矢印は風が吹いていく向き (北西の風なら右下を指す)・数字は風速 m/s</p></div>
    <div class="card"><h2>7 日間</h2><div class="dlist">${f.daily.map((d) => `<div class="drow"><span class="dd num"><b>${md(d.date)}</b> <span class="muted">${dow(d.date)}</span></span><span class="dwx">${wxPair(d, 26)}</span><span class="num dt"><b>${Math.round(d.tmax)}</b><span class="muted">/${Math.round(d.tmin)}</span></span><span class="rain num dr">${d.precip_pct ?? 0}%</span><span class="muted num ds"><b class="dlabel">${esc(wxText(d))}</b>・風${d.wind_max.toFixed(0)}m・${d.sunrise}〜${d.sunset}</span></div>`).join('')}</div></div>
    ${f.air ? `<div class="card"><h2>大気</h2><p class="num" style="margin:0">PM2.5 <b>${f.air.pm2_5 != null ? Math.round(f.air.pm2_5) : '-'}</b> µg/m³${f.air.aqi != null ? `・AQI <b>${Math.round(f.air.aqi)}</b> <span class="muted">(${f.air.aqi < 50 ? '良好' : f.air.aqi < 100 ? 'ふつう' : '悪い'})</span>` : ''}</p></div>` : ''}
    <p class="muted hint">暑さ指数と走りやすさは、予報から計算した推定値です。</p>`;
}

/** 天気の場所を選ぶ (地名で検索 / 現在地) */
async function pickPlace() {
  const pending = openDialog(`
    <h2>天気の場所</h2>
    <button type="button" id="geo" class="primary wide">現在地を使う</button>
    <label style="margin-top:14px">地名で探す<input id="place-q" placeholder="例: 佐賀、久留米、渋谷" autocomplete="off"></label>
    <div id="place-res" class="place-res"></div>
    <input type="hidden" name="name"><input type="hidden" name="lat"><input type="hidden" name="lon">`);
  const q = (id) => dialogForm.querySelector(id);
  const choose = (name, lat, lon) => { q('[name=name]').value = name; q('[name=lat]').value = lat; q('[name=lon]').value = lon; dialog.close('ok'); };
  let timer;
  q('#place-q').oninput = (e) => {
    clearTimeout(timer);
    const v = e.target.value.trim();
    if (!v) { q('#place-res').innerHTML = ''; return; }
    timer = setTimeout(async () => {
      try {
        const r = await api(`/weather/search?q=${encodeURIComponent(v)}`);
        q('#place-res').innerHTML = r.length ? r.map((x, i) => `<button type="button" class="choice" data-pi="${i}"><b>${esc(x.name)}</b><small>${esc(x.detail)}</small></button>`).join('') : '<p class="muted">見つかりません</p>';
        q('#place-res').querySelectorAll('[data-pi]').forEach((b) => (b.onclick = () => { const x = r[Number(b.dataset.pi)]; choose(x.name, x.lat, x.lon); }));
      } catch (err) { q('#place-res').innerHTML = `<p class="error">${esc(err.message)}</p>`; }
    }, 350);
  };
  q('#geo').onclick = () => {
    if (!navigator.geolocation) { alert('この端末では現在地を取得できません'); return; }
    q('#geo').textContent = '取得中…';
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      let name = '現在地';
      try {
        const r = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ja`);
        const j = await r.json();
        name = j.city || j.locality || j.principalSubdivision || name;
      } catch { /* 名前が取れなくても座標で動く */ }
      choose(name, lat, lon);
    }, () => { q('#geo').textContent = '現在地を使う'; alert('現在地を取得できませんでした。設定で位置情報を許可するか、地名で探してください。'); }, { enableHighAccuracy: false, timeout: 10000 });
  };
  const v = await pending;
  if (!v || !v.name || !v.lat) return;
  await api('/settings', { method: 'PUT', body: { weather_place: { name: v.name, lat: Number(v.lat), lon: Number(v.lon) } } });
  route();
}

/** 風向き (風が吹いてくる方角・度) → 「北西」 */
const DIR16 = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
const dirName = (deg) => (deg == null ? '' : DIR16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]);
/** 風の矢印 (風が吹いていく向きを指す。北西の風なら南東を指す) */
const windArrow = (deg, size = 14) => (deg == null ? '' : `<svg class="warrow" viewBox="0 0 24 24" width="${size}" height="${size}" style="transform:rotate(${deg + 180}deg)" aria-hidden="true"><path d="M12 3v17M12 3l-5 6M12 3l5 6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`);
const windTxt = (speed, deg) => `${dirName(deg)}${deg != null ? 'の風 ' : '風 '}${Number(speed).toFixed(1)}m/s`;
/** コースの向き (走る方向) と風から、向かい風・追い風・横風 */
const COURSE_DIRS = [[0, '北へ'], [45, '北東へ'], [90, '東へ'], [135, '南東へ'], [180, '南へ'], [225, '南西へ'], [270, '西へ'], [315, '北西へ']];
function windRel(windFrom, heading, speed) {
  if (windFrom == null || heading == null) return null;
  const d = Math.abs(((windFrom - heading + 540) % 360) - 180); // 0 = 進む方向から吹く (向かい風)
  const head = Math.round(speed * Math.cos((d * Math.PI) / 180) * 10) / 10;
  if (speed < 1.5) return { k: 'calm', t: '弱い', head };
  return d <= 45 ? { k: 'head', t: '向かい風', head } : d >= 135 ? { k: 'tail', t: '追い風', head } : { k: 'cross', t: '横風', head };
}
/** 時刻 (秒) の予報を、前後の 1 時間ごとの予報から求める (気温・風速は直線で・風向きは近い方の時間) */
function wxAt(hours, sec) {
  const h = sec / 3600;
  const a = [...hours].reverse().find((x) => x.h <= h), b = hours.find((x) => x.h >= h);
  if (!a && !b) return null;
  if (!a || !b || a.h === b.h) return a || b;
  const f = (h - a.h) / (b.h - a.h), mix = (k) => (a[k] == null || b[k] == null ? a[k] ?? b[k] : a[k] + (b[k] - a[k]) * f);
  return { temp: mix('temp'), wind: mix('wind'), gust: mix('gust'), humidity: mix('humidity'), precip_pct: f < 0.5 ? a.precip_pct : b.precip_pct, dir: f < 0.5 ? a.dir : b.dir };
}
/** レース展開と天気: 5km ごとの通過時刻に、その時刻の気温・風 (コースの向きがあれば向かい風/追い風) */
function raceWxTimeline(w, race, pm) {
  if (!w || !race) return '';
  if (!race.goal_time_s) return '<p class="muted an-note">目標タイムを設定すると、地点ごとの通過時刻の気温と風が出ます。</p>';
  const sc = myStartClock(race);
  if (sc == null) return '<p class="muted an-note">大会情報にスタート時刻 (または自分のブロックのスタート時刻) を入れると、地点ごとの通過時刻の気温と風が出ます。</p>';
  const inf = raceInfoOf(race), mode = pm || inf.pace_mode || 'even', heading = inf.course_heading ?? null;
  const dist = race.distance_m / 1000;
  const pts = [];
  for (let k = 0; k < dist; k += 5) pts.push(k);
  pts.push(dist);
  const rows = pts.map((k) => {
    const t = sc + timeAt(race, mode, k), x = wxAt(w.hours, t);
    if (!x) return '';
    const rel = windRel(x.dir, heading, x.wind);
    return `<div class="rwx-r"><span class="pk">${k === 0 ? 'スタート' : k >= dist ? 'ゴール' : `${k}km`}</span><span class="num muted">${clockTxt(t)}</span>
      <b class="num">${x.temp.toFixed(1)}℃</b>
      <span class="num rwx-w">${windArrow(x.dir)}${dirName(x.dir)} ${x.wind.toFixed(1)}m/s</span>
      <span class="rwx-rel ${rel ? `wr-${rel.k}` : ''}">${rel ? rel.t : ''}</span></div>`;
  }).join('');
  return `<div class="rwx">
    <h3 class="rwx-h">レース展開と天気 <small class="muted">(目標 ${dur(race.goal_time_s)}・${esc(PACE_PLANS[mode]?.label || '')})</small></h3>
    <div class="rwx-t">${rows}</div>
    <div class="rwx-cd"><span class="muted">コースの向き</span><div class="sm-chips">${[[null, '未設定'], ...COURSE_DIRS].map(([d, l]) => `<button type="button" class="chip ${d === heading ? 'on' : ''}" data-chd="${d ?? ''}">${l}</button>`).join('')}</div></div>
    <p class="muted an-note">${heading == null ? 'コースの大まかな向き (走っていく方角) を選ぶと、向かい風・追い風の目安が出ます。' : '向かい風・追い風は、コース全体を 1 つの向きとみなした目安です。曲がり角・折り返し・ビル風は入っていません。'}風は高さ 10m の予報で、地上では少し弱くなります。</p>
  </div>`;
}
/** レース詳細: 天気のカードを入れ、コースの向きの選択をつなぐ */
function drawRaceWx(w, race, pm, tries = 0) {
  const el = document.getElementById('rd-wx');
  // 天気が画面より先に届いたときは、画面ができるまで少し待つ (別の画面に移ったらやめる)
  if (!el) { if (tries < 40 && location.hash.startsWith(`#/races/${race.id}`)) setTimeout(() => drawRaceWx(w, race, pm, tries + 1), 100); return; }
  el.innerHTML = weatherCard(w, race, pm);
  el.querySelectorAll('[data-chd]').forEach((b) => (b.onclick = async () => {
    const v = b.dataset.chd === '' ? null : Number(b.dataset.chd);
    const info = { ...raceInfoOf(race), course_heading: v };
    race.info = JSON.stringify(info);
    drawRaceWx(w, race, pm);
    await api(`/races/${race.id}`, { method: 'PUT', body: { ...race, info, no_auto: true } }).catch((e) => alert(e.message));
  }));
}
function weatherCard(w, race = null, pm = null) {
  if (!w) return '';
  // 1 時間ごと (レースの時間帯: 7〜14 時)
  const hrs = w.hours.filter((h) => h.h >= 7 && h.h <= 14).map((h) => `<div><div class="muted">${h.h}時</div><b>${Math.round(h.temp)}℃</b><div class="muted">${h.humidity ?? '-'}%</div><div class="hw">${windArrow(h.dir, 12)}<span>${h.wind.toFixed(0)}m</span></div></div>`).join('');
  const rh = w.hours.filter((h) => h.h >= 8 && h.h <= 13);
  const wmax = rh.length ? rh.reduce((a, h) => (h.wind > a.wind ? h : a)) : null;
  return `<div class="card">
    <div class="row spread"><h2>${esc(w.race)}の天気 (${w.place})</h2><span class="muted num">${md(w.date)}</span></div>
    <div class="row" style="gap:10px;align-items:center">${w.code != null ? wxPair(w, 36) + `<b>${esc(wxText(w))}</b>` : ''}</div>
    <div class="num" style="font-size:20px">${Math.round(w.tmin)}〜${Math.round(w.tmax)}℃ <span class="muted" style="font-size:13px">降水${w.precip_pct ?? '-'}%・風${w.wind_max.toFixed(0)}m/s</span></div>
    ${wmax ? `<p class="num" style="margin:4px 0 0">${windArrow(wmax.dir)} レース中 (8〜13時) の最大: ${windTxt(wmax.wind, wmax.dir)}${wmax.gust ? `<span class="muted">・瞬間 ${wmax.gust.toFixed(0)}m/s</span>` : ''}</p>` : ''}
    <div class="hours num">${hrs}</div>
    <p style="margin:8px 0 0">${esc(w.advice)}</p>
    ${race ? raceWxTimeline(w, race, pm) : ''}
  </div>`;
}

/** 目標タイムまでの距離。サブ3・レース目標・COROS 予測を 1 本の時間軸に並べる */
/** 目標への現在地と課題 (サーバーで実績から判定)。ホームを出したあとで読み込む */
const LV_COLOR = { ok: 'var(--good)', warn: 'var(--mid)', bad: 'var(--bad)' };
function goalCard() {
  return `<div class="card ins"><h2>目標への現在地</h2><div id="insights"><p class="muted">読み込み中…</p></div></div>`;
}
/** 円形のメーター (0〜100) */
function ringGauge(v, label, color) {
  const r = 34, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, v / 100));
  return `<div class="ring"><svg viewBox="0 0 84 84" width="84" height="84" aria-hidden="true"><circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--line)" stroke-width="7"/><circle cx="42" cy="42" r="${r}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-dasharray="${c * f} ${c}" transform="rotate(-90 42 42)"/><text x="42" y="48" text-anchor="middle" class="ring-v">${v}</text></svg><small>${label}</small></div>`;
}
/** 毎朝の体調 (脚・張り・痛み・睡眠・全身の疲労)。疲労の蓄積や、回復状態・シューズの相性に使う */
const COND = [['leg', '脚の疲労感', 'なし', '最大'], ['tight', '筋肉の張り', 'なし', '最大'], ['fatigue', '全身の疲労感', 'なし', '最大'], ['sleep', '睡眠の質', '悪い', 'よく眠れた'], ['pain', '痛み', 'なし', '最大']];
async function loadCondition() {
  const box = document.getElementById('cond');
  if (!box) return;
  const t = today();
  let all = {};
  try { all = await api(`/condition?from=${addDays(t, -6)}&to=${t}`); } catch { box.remove(); return; }
  const cur = all[t];
  const week = [...Array(7)].map((_, k) => addDays(t, k - 6));
  const trend = `<div class="cd-trend">${week.map((d) => { const c = all[d]; const v = c ? Math.max(c.leg ?? 0, c.fatigue ?? 0) : null; return `<div><i style="height:${v == null ? 3 : 4 + v * 2.6}px;background:${v == null ? 'var(--line)' : v >= 7 ? 'var(--mid)' : v >= 4 ? 'var(--accent)' : 'var(--good)'}"></i><small>${dow(d)}</small></div>`; }).join('')}</div>`;
  const legs = week.map((d) => all[d]?.leg).filter((x) => x != null);
  const warn = legs.length >= 3 && legs.slice(-3).every((x) => x >= 6) ? '<p class="cd-warn">脚の疲労が 3 日続けて 6 以上。疲れがたまっています。強い練習は 1 日ずらすのがおすすめ。</p>' : '';
  const form = (st) => {
    box.innerHTML = `<div class="row spread"><h2>今朝の体調</h2>${cur ? '<button type="button" class="chip" data-cd="cancel">閉じる</button>' : ''}</div>
      <p class="muted" style="margin:0 0 6px;font-size:12.5px">起きたときの状態を 10 秒で。疲労の蓄積や回復の判断に使います。</p>
      ${COND.map(([k, title, lo, hi]) => `<div class="fs ${st[k] == null ? 'unset' : ''}" data-k="${k}"><div class="fs-h"><b>${title}</b><span class="fs-v num"><em>${st[k] ?? '–'}</em><small>/10</small></span></div>
        <div class="fs-track" style="--v:${st[k] ?? 0}"><div class="fs-dots">${Array.from({ length: 11 }, () => '<i></i>').join('')}</div><div class="fs-thumb"></div></div><div class="fs-l"><span>${lo}</span><span>${hi}</span></div></div>`).join('')}
      <div class="fbx-q fbx-pain ${(st.pain ?? 0) > 0 ? '' : 'hidden'}"><b>痛む場所</b><div class="chips">${PAIN_PARTS.map((v) => `<button type="button" class="chip ${(st.pain_part || []).includes(v) ? 'on' : ''}" data-pn="${v}">${v}</button>`).join('')}</div></div>
      <button type="button" class="fbx-save" data-cd="save">保存</button>`;
    box.querySelectorAll('.fs').forEach((el) => {
      const k = el.dataset.k, tr = el.querySelector('.fs-track');
      const at = (e) => { const r = tr.getBoundingClientRect(); const v = Math.max(0, Math.min(10, Math.round(((e.clientX - r.left - 22) / (r.width - 44)) * 10))); st[k] = v; el.classList.remove('unset'); tr.style.setProperty('--v', v); el.querySelector('em').textContent = v; if (k === 'pain') box.querySelector('.fbx-pain').classList.toggle('hidden', !(v > 0)); };
      let on = false;
      tr.addEventListener('pointerdown', (e) => { on = true; tr.setPointerCapture(e.pointerId); at(e); });
      tr.addEventListener('pointermove', (e) => { if (on) at(e); });
      ['pointerup', 'pointercancel'].forEach((ev) => tr.addEventListener(ev, () => { on = false; }));
    });
    box.querySelectorAll('[data-pn]').forEach((b) => (b.onclick = () => { const set = new Set(st.pain_part || []); set.has(b.dataset.pn) ? set.delete(b.dataset.pn) : set.add(b.dataset.pn); st.pain_part = [...set]; b.classList.toggle('on'); }));
    box.querySelector('[data-cd="save"]').onclick = async (e) => { e.target.disabled = true; try { all[t] = await api(`/condition/${t}`, { method: 'PUT', body: st }); loadCondition(); } catch (err) { alert(err.message); e.target.disabled = false; } };
    const cancel = box.querySelector('[data-cd="cancel"]'); if (cancel) cancel.onclick = () => loadCondition();
  };
  if (!cur) {
    box.innerHTML = `<div class="row spread"><h2>今朝の体調</h2><button type="button" class="chip" data-cd="open">記録する</button></div>${trend}${warn}`;
    box.querySelector('[data-cd="open"]').onclick = () => form({ leg: null, tight: null, fatigue: null, sleep: null, pain: null, pain_part: [] });
    return;
  }
  const SH = { leg: '脚', tight: '張り', fatigue: '全身', sleep: '睡眠', pain: '痛み' };
  // 今日の練習への影響 (提案だけ。計画は自動で変えない)
  let todayPlan = [];
  try { todayPlan = JSON.parse(box.dataset.plan || '[]'); } catch {}
  const hard = todayPlan.some((p) => ['m', 'lt', 'interval', 'long', 'race'].includes(p.type));
  const worst = Math.max(cur.leg ?? 0, cur.tight ?? 0, cur.fatigue ?? 0);
  const pain = cur.pain ?? 0, sleep = cur.sleep;
  let impact = '', tone = 'ok';
  if (!todayPlan.length || todayPlan.every((p) => p.type === 'rest')) impact = worst >= 6 ? '今日は休養日。回復に専念できます。' : '';
  else if (pain >= 5) { impact = `痛み ${pain}/10。今日の練習は休み、痛みが続くなら受診を。`; tone = 'bad'; }
  else if (pain >= 3) { impact = `痛み ${pain}/10${(cur.pain_part || []).length ? ` (${cur.pain_part.join('・')})` : ''}。${hard ? 'ポイント練は避けて Jog に下げるのがおすすめ。' : '距離を短めに、痛みが強まったら中止。'}`; tone = 'warn'; }
  else if (worst >= 7) { impact = `疲労が強め (${worst}/10)。${hard ? '強度を下げるか、ポイント練を 1 日ずらすのがおすすめ。' : '予定より短く、ゆっくりで。'}`; tone = 'warn'; }
  else if (worst >= 5 || (sleep != null && sleep <= 3)) { impact = `${worst >= 5 ? `疲労がやや残っている (${worst}/10)` : `睡眠が浅め (${sleep}/10)`}。${hard ? '予定どおりで良いが、序盤は抑えて体の反応を見ながら。' : '予定どおり、ゆっくりめで。'}`; }
  else impact = `疲労は少なく、${hard ? 'ポイント練も' : ''}予定どおり実施できそう。`;
  const impactHtml = impact ? `<p class="cd-impact ${tone}"><b>今日の練習への影響</b>${esc(impact)}${tone !== 'ok' && todayPlan.length ? ' <a href="#/plans">計画で相談 ›</a>' : ''}</p>` : '';
  const vals = [cur.leg, cur.tight, cur.fatigue].filter((x) => x != null);
  const ready = vals.length ? Math.max(0, Math.min(100, Math.round(100 - (vals.reduce((a, b) => a + b, 0) / vals.length) * 7 - (cur.pain ?? 0) * 5 + (cur.sleep != null ? (cur.sleep - 5) * 2 : 0)))) : null;
  box.innerHTML = `<div class="row spread"><h2>今朝の体調</h2><button type="button" class="chip" data-cd="edit">修正</button></div>
    ${ready != null ? `<div class="cd-top">${ringGauge(ready, 'コンディション', ready >= 70 ? 'var(--good)' : ready >= 50 ? 'var(--accent)' : 'var(--mid)')}<div class="cd-top-r">${impactHtml}</div></div>` : ''}
    <div class="cd-sum">${COND.filter(([k]) => cur[k] != null).map(([k]) => `<div><small>${SH[k]}</small><b class="num">${cur[k]}</b></div>`).join('')}${(cur.pain_part || []).length ? `<div><small>痛む場所</small><b style="font-size:13px">${cur.pain_part.map(esc).join('・')}</b></div>` : ''}</div>${ready == null ? impactHtml : ''}${trend}${warn}`;
  box.querySelector('[data-cd="edit"]').onclick = () => form({ ...cur });
}

/** からだのデータ (体重・体脂肪・安静時心拍・HRV・睡眠)。ヘルスケアからショートカットで送るか、手で入力 */
const BODY_F = [['weight', '体重', 'kg'], ['body_fat', '体脂肪率', '%'], ['resting_hr', '安静時心拍', 'bpm'], ['hrv', 'HRV', 'ms'], ['sleep_h', '睡眠', '時間']];
async function loadBody() {
  const box = document.getElementById('bodyc');
  if (!box) return;
  const t = today();
  let r;
  try { r = await api(`/body?from=${addDays(t, -34)}&to=${t}`); } catch { box.remove(); return; }
  const days = r.days || {};
  const latest = (k) => { const ds = Object.keys(days).filter((d) => days[d][k] != null).sort(); const d = ds[ds.length - 1]; return d && d >= addDays(t, -6) ? { v: days[d][k], d } : null; };
  const items = BODY_F.map(([k, l, u]) => [k, l, u, latest(k)]).filter((x) => x[3]);
  // 体重の 35 日の推移
  const ws = Object.keys(days).filter((d) => days[d].weight != null).sort().map((d) => [d, days[d].weight]);
  let spark = '';
  if (ws.length >= 2) {
    const lo = Math.min(...ws.map((x) => x[1])), hi = Math.max(...ws.map((x) => x[1])), span = Math.max(0.6, hi - lo);
    const X = (d) => 4 + ((Date.parse(d) - Date.parse(addDays(t, -34))) / (34 * 86400_000)) * 292, Y = (v) => 40 - ((v - lo) / span) * 32;
    spark = `<svg class="bd-spark" viewBox="0 0 300 46" preserveAspectRatio="none" aria-label="体重の推移 (35 日)"><polyline points="${ws.map(([d, v]) => `${X(d).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>${ws.map(([d, v]) => `<circle cx="${X(d).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2" fill="var(--accent)"/>`).join('')}</svg>
      <div class="bd-spark-l muted num"><span>${md(addDays(t, -34))}</span><span>${lo.toFixed(1)}〜${hi.toFixed(1)}kg</span><span>今日</span></div>`;
  }
  const g = r.guide;
  const guide = g ? `<details class="bd-guide"><summary>体重と目標タイムの目安</summary>
      <p><b class="num">7 日平均 ${g.avg7}kg</b>${g.change28 != null ? `<span class="muted num">・4 週前から ${g.change28 > 0 ? '+' : ''}${g.change28}kg</span>` : ''}${g.bmi != null ? `<span class="muted num">・BMI ${g.bmi}</span>` : ''}</p>
      ${g.sec_per_kg ? `<p>同じ走力なら「体重 1% ≈ タイム 1%」がよく使われる目安です。いまの体重と目標 ${dur(r.goal_s)} では、<b class="num">1kg ≈ 約 ${Math.floor(g.sec_per_kg / 60)}分${String(g.sec_per_kg % 60).padStart(2, '0')}秒</b>にあたります。</p>` : '<p class="muted">次のフルマラソンに目標タイムを入れると、1kg あたりの目安が出ます。</p>'}
      ${g.lean ? '<p class="bd-note">BMI が 20 未満で、すでに軽めの体重です。これ以上減らすより、練習と回復でタイムを伸ばす方が確実です。</p>' : ''}
      <p class="muted">あくまで目安です。体重を落とすと筋肉や回復力も落ちることがあり、タイムが良くなるとは限りません。食事を大きく減らすのではなく、練習量に見合った食事で、体調 (疲労・睡眠) が悪くならない範囲で。${g.bmi_low_kg ? ` BMI 18.5 (${g.bmi_low_kg}kg) を下回る体重は、健康のために目指さないでください。` : ''}${r.profile?.height_cm ? '' : ' 身長を入れると BMI も出ます。'}</p>
    </details>` : '';
  box.innerHTML = `<div class="row spread"><h2>からだ</h2><button type="button" class="chip" data-bd="edit">入力</button></div>
    ${items.length ? `<div class="bd-grid">${items.map(([k, l, u, x]) => `<div><small>${l}${x.d !== t ? `<em> ${md(x.d)}</em>` : ''}</small><b class="num">${x.v}<span>${u}</span></b></div>`).join('')}</div>`
      : '<p class="muted" style="margin:0">体重・体脂肪率・安静時心拍・HRV・睡眠を記録できます。iPhone のヘルスケアから毎朝自動で送る方法は 設定 › からだのデータ にあります。</p>'}
    ${spark}${guide}`;
  box.querySelector('[data-bd="edit"]').onclick = async () => {
    const cur = days[t] || {};
    const f = (k, l, u, step, min, max) => `<label>${l} (${u})<input name="${k}" type="number" inputmode="decimal" step="${step}" min="${min}" max="${max}" value="${cur[k] ?? ''}"></label>`;
    const v = await openDialog(`<h2>からだ (${md(t)})</h2>
      <div class="bd-form">${f('weight', '体重', 'kg', '0.1', 30, 200)}${f('body_fat', '体脂肪率', '%', '0.1', 3, 60)}${f('resting_hr', '安静時心拍', 'bpm', '1', 30, 120)}${f('hrv', 'HRV', 'ms', '1', 5, 250)}${f('sleep_h', '睡眠', '時間', '0.1', 0.5, 16)}
      <label>身長 (cm・BMI 用)<input name="height_cm" type="number" inputmode="decimal" step="0.1" min="120" max="230" value="${r.profile?.height_cm ?? ''}"></label></div>
      <p class="muted" style="font-size:12px">空欄の項目は記録しません。ヘルスケアから送った値も、ここで直せます。</p>`);
    if (!v) return;
    try {
      const { height_cm, ...rest } = v;
      if (String(height_cm ?? '') !== String(r.profile?.height_cm ?? '')) await api('/body-profile', { method: 'PUT', body: { height_cm } });
      await api(`/body/${t}`, { method: 'PUT', body: rest });
      loadBody();
    } catch (e) { alert(e.message); }
  };
}

/** マラソン適性 (6 つの能力) と予測の根拠 */
function aptitudeHtml(a) {
  const LV = { good: ['良い', 'var(--good)'], ok: ['普通', 'var(--accent)'], bad: ['課題', 'var(--mid)'], hold: ['保留', 'var(--muted)'] };
  const p = a.prediction;
  const bars = a.abilities.map((x) => `<div class="apt-r"><span class="apt-l">${esc(x.label)}</span><span class="apt-b">${x.score != null ? `<i style="width:${x.score}%;background:${LV[x.level][1]}"></i>` : ''}</span><b style="color:${LV[x.level][1]}">${x.score != null ? x.score : '保留'}</b></div>
    <p class="apt-why"><b class="num">${esc(x.value)}</b> ${esc(x.reason)}</p>`).join('');
  return `<details class="ins-all apt"><summary>マラソン適性 (6 つの能力)</summary><div class="apt-list">${bars}</div>
    <p class="muted" style="font-size:12px;margin:8px 0 0">直近 12 週のランから。ロング走とレースを重く見ます。データが足りない能力は保留にしています。</p></details>
    ${p.raw_s ? `<details class="ins-all apt"><summary>予測の根拠 <span class="apt-conf c-${p.confidence}">信頼度 ${p.confidence}</span></summary>
      <div class="apt-pred num" style="--n:${p.adjusted_s !== p.raw_s ? 3 : 2}"><div><small>${esc(p.source.startsWith('COROS') ? 'COROS 予測' : '予測')}</small><b>${dur(p.raw_s)}</b></div>${p.adjusted_s !== p.raw_s ? `<div><small>STRIDE 補正 (持久力)</small><b>${dur(p.adjusted_s)}</b></div>` : ''}${p.goal_s ? `<div><small>目標との差</small><b class="${p.gap_s <= 0 ? 'g' : 'b'}">${Math.abs(p.gap_s) < 60 ? `${Math.abs(p.gap_s)}秒${p.gap_s <= 0 ? '余裕' : '不足'}` : `${p.gap_s <= 0 ? '−' : '+'}${dur(Math.abs(p.gap_s))}`}</b></div>` : ''}</div>
      <h4>根拠</h4>${p.basis.map((t) => `<p>${esc(t)}</p>`).join('')}
      <h4>使ったデータ</h4>${p.data.map((t) => `<p>${esc(t)}</p>`).join('')}
      ${p.missing.length ? `<h4>足りないデータ</h4>${p.missing.map((t) => `<p>${esc(t)}</p>`).join('')}` : ''}
      <p class="muted" style="font-size:12px">目標タイムは「出したいタイム」、予測は「今の力で出せそうなタイム」です。短い距離のペース走だけでは楽観的になりやすいので、30km 以上のロング走が無いときは上乗せしています。</p></details>` : ''}`;
}

async function loadInsights() {
  const box = document.getElementById('insights');
  if (!box) return;
  try {
    const r = await api('/insights');
    const g = r.gap_s;
    const head = r.race ? `<div class="ins-head">
        <div><small>目標 (${esc(r.race.name)})</small><b class="num">${r.race.goal_s ? dur(r.race.goal_s) : '未設定'}</b></div>
        <div><small>${esc(r.predicted_label || '予測')}</small><b class="num">${r.predicted_s ? dur(r.predicted_s) : '-'}</b></div>
        ${g != null ? `<span class="ins-gap ${g <= 0 ? 'ok' : 'ng'}">${g <= 0 ? `${dur(-g)} 余裕` : `あと ${dur(g)}`}</span>` : ''}
      </div>` : '<p class="muted">レースと目標タイムを登録すると、目標との差が出ます。</p>';
    const issues = r.items.filter((x) => x.level !== 'ok').sort((x, y) => (x.level === 'bad' ? 0 : 1) - (y.level === 'bad' ? 0 : 1)).slice(0, 3);
    const row = (x) => `<div class="ins-row"><i style="background:${LV_COLOR[x.level]}"></i><span>${esc(x.label)}</span><b class="num">${esc(x.value)}<small> / ${esc(x.target)}</small></b></div>`;
    box.innerHTML = `${head}
      ${issues.length ? `<div class="ins-sub">課題</div><div class="ins-list">${issues.map(row).join('')}</div>` : '<p class="ins-okmsg">大きな課題はありません。今の練習を続けましょう。</p>'}
      ${r.actions[0] ? `<div class="ins-next"><b>次の練習</b><span>${esc(r.actions[0])}</span></div>` : ''}
      ${r.aptitude ? aptitudeHtml(r.aptitude) : ''}
      <details class="ins-all"><summary>すべての項目</summary><div class="ins-list">${r.items.map(row).join('')}</div></details>`;
  } catch { box.innerHTML = '<p class="muted">読み込めませんでした。</p>'; }
}

function shoeLine(p, calendar) {
  if (!calendar || p.type === 'rest' || p.activity_id) return '';
  const r = recommendShoe(p.type);
  return r ? `<div class="shoe-rec">おすすめ: ${esc(shoeName(r.shoe))} <span class="muted">${Math.round(r.shoe.total_km)}km</span><div class="muted why">${esc(r.why)}</div></div>` : '';
}

/** 同じ日・同じ内容の計画が重なっていたら 1 つにまとめる (走った実績が付いている方を残す) */
function uniqPlans(list) {
  const m = new Map();
  for (const p of list) {
    const k = [p.date, p.type, p.distance_m, p.notes].join('|');
    const q = m.get(k);
    if (!q || (!q.activity_id && p.activity_id)) m.set(k, p);
  }
  return [...m.values()];
}

/** 画面に重複があれば、サーバー側も整理する (1 度だけ) */
let dedupeAsked = false;
function dedupeIfNeeded(list) {
  if (dedupeAsked || uniqPlans(list).length === list.length) return;
  dedupeAsked = true;
  api('/plans/dedupe', { method: 'POST' }).catch(() => {});
}

const STEP_SHORT = { warmup: 'アップ', work: 'メイン', rest: '休憩', cooldown: 'ダウン', interval: 'インターバル' };
const parseSteps = (p) => {
  try { const v = typeof p.steps === 'string' ? JSON.parse(p.steps) : p.steps; return Array.isArray(v) ? v : []; } catch { return []; }
};
const paceRange = (t) => { const b = bandOf(t); return `${pace(Math.round(b[0]))}–${pace(Math.round(b[1]))}`; };
/** ステップ付きの計画を、色つきの行で見せる (長い文章にしない) */
function stepRows(steps) {
  // 「stp」は −/＋ の入力 (stepper) と名前が重なって横並びになっていたので「stl」に (2026-11 修正)
  return `<div class="stl">${steps.map((sp) => {
    const kc = KIND_COLOR[sp.kind] || '#8a8f9c';
    if (sp.kind === 'interval') {
      return `<div class="stp-r" style="--kc:${kc}"><i></i><span class="stp-n">インターバル<small>レスト ${fmtTarget(sp.rest)}</small></span><span class="num stp-d">${fmtTarget(sp.work)}×${sp.reps}</span><span class="num stp-p">${paceRange(sp.work)}</span></div>`;
    }
    return `<div class="stp-r" style="--kc:${kc}"><i></i><span class="stp-n">${STEP_SHORT[sp.kind]}</span><span class="num stp-d">${fmtTarget(sp)}</span><span class="num stp-p">${sp.kind === 'rest' ? '' : paceRange(sp)}</span></div>`;
  }).join('')}</div>`;
}
/** 以前は「ステップの要約 / メモ」を notes に入れていた。いまはメモだけを残す */
function cleanNotes(notes, steps) {
  const n = notes || '';
  if (!steps.length || !n) return n;
  const parts = n.split(' / ');
  if (parts.length > 1 && /→/.test(parts[0])) return parts.slice(1).join(' / ');
  if (/→/.test(n) && /^(アップ|ウォームアップ|トレーニング|インターバル|休憩|クールダウン|\d)/.test(n)) return '';
  return n;
}


/** その日のメニュー通りに走れたかを、チェック / ▲ / バツ で判定する */
function dayJudge(d, dayPlans, dayActs, settings) {
  const runPlans = dayPlans.filter((p) => p.type !== 'rest');
  const done = dayActs.reduce((a, r) => a + r.distance_m, 0);
  const past = d < today();
  if (!runPlans.length) {
    if (!dayPlans.length) return null;
    if (done > 0) return { k: 'warn', t: '休養日に走りました' };
    // 休養日に走らずに終わった日はチェック (今日はまだ終わっていないので付けない)
    return past ? { k: 'ok', t: '休養できました' } : null;
  }
  if (!done) return past ? { k: 'ng', t: '未実施' } : null;
  const planned = runPlans.reduce((a, p) => a + (p.distance_m || 0), 0);
  if (d === today() && planned && done < planned * 0.9) return null; // 今日はまだ途中かもしれない
  const dr = planned ? Math.abs(done - planned) / planned : 0;
  let dev = 0, band = null;
  if (runPlans.length === 1) {
    const pl = runPlans[0];
    const mainAct = dayActs.find((a) => a.role === 'work') || (dayActs.length === 1 ? dayActs[0] : null);
    band = pl.pace_min_s ? { min: pl.pace_min_s, max: pl.pace_max_s } : settings?.paces?.[pl.type] || null;
    if (mainAct && band) {
      const avg = mainAct.moving_time_s / (mainAct.distance_m / 1000);
      dev = avg < band.min - 3 ? band.min - 3 - avg : avg > band.max + 3 ? avg - band.max - 3 : 0;
    }
  }
  if (dr <= 0.1 && dev === 0) return { k: 'ok', t: 'メニュー通り' };
  if (dr <= 0.25 && dev <= 10) return { k: 'warn', t: dr > 0.1 ? '距離がずれました' : 'ペースがずれました' };
  return { k: 'ng', t: dr > 0.25 ? '距離が大きくずれました' : 'ペースが大きくずれました' };
}
const JMARK = {
  ok: '<svg viewBox="0 0 32 32" width="30" height="30"><circle cx="16" cy="16" r="15" fill="currentColor" opacity=".16"/><path d="M9 16.5l5 5 9-10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  warn: '<svg viewBox="0 0 32 32" width="30" height="30"><circle cx="16" cy="16" r="15" fill="currentColor" opacity=".16"/><path d="M16 8.5l8 14H8z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>',
  ng: '<svg viewBox="0 0 32 32" width="30" height="30"><circle cx="16" cy="16" r="15" fill="currentColor" opacity=".16"/><path d="M10.5 10.5l11 11M21.5 10.5l-11 11" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
};
const markHtml = (j) => (j ? `<span class="jmark ${j.k}" title="${j.t}" role="img" aria-label="${j.t}">${JMARK[j.k]}</span>` : '');

function planLine(p, hideActual = false, mark = '') {
  const steps = parseSteps(p);
  const target = p.type === 'rest' ? '' : [p.distance_m ? `${km(p.distance_m)}km` : '', steps.length ? '' : p.pace_min_s ? `${pace(p.pace_min_s)}-${pace(p.pace_max_s)}` : '', p.hr_max ? `≤${p.hr_max}bpm` : ''].filter(Boolean).join(' ');
  const memo = cleanNotes(p.notes, steps);
  return `<div class="plan-item ${mark ? 'has-mark' : ''}" data-plan="${p.id}">${mark}
    <div class="pl-main"><span class="badge" data-t="${p.type}">${PLAN_LABELS[p.type]}</span> <span class="num pl-t">${target}</span>${steps.length ? stepRows(steps) : ''}${memo ? `<div class="muted pl-memo">${esc(memo)}</div>` : ''}${shoeLine(p, hideActual)}</div>
    <div class="num">${p.activity_id && !hideActual ? `<a class="actual-mini" href="#/activities/${p.activity_id}"><span class="muted">実績</span> ${km(p.actual_distance_m)}km${p.activity_count > 1 ? `<span class="muted">(${p.activity_count}本)</span>` : ''} ${scoreHtml(p.score)}</a>` : ''}</div>
  </div>`;
}

/** 週ごとの距離 (棒)。上に km を書き、目盛り線を引く。先の週は計画 (点線) */
function weeklyChart(weeks) {
  if (weeks.length === 0) return '<p class="muted">データなし</p>';
  const ws = weekStart(today());
  const top = Math.max(...weeks.map((w) => Math.max(w.planned_m, w.actual_m)), 1) / 1000;
  const step = top > 120 ? 50 : top > 60 ? 20 : 10;
  const max = Math.ceil(top / step) * step || step;
  const H = 120;
  const h = (m) => `${(m / 1000 / max) * H}px`;
  const grid = [...Array(max / step + 1)].map((_, i) => i * step).map((v) => `<div class="wg" style="bottom:${(v / max) * H + 18}px"><span>${v}</span></div>`).join('');
  return `<div class="wchart" style="--H:${H}px">${grid}<div class="wcols">${weeks.map((w) => {
    const future = w.week > ws, cur = w.week === ws;
    const val = future ? w.planned_m : w.actual_m;
    const label = cur && w.planned_m ? `${Math.round(w.actual_m / 1000)}/${Math.round(w.planned_m / 1000)}` : val ? Math.round(val / 1000) : '';
    const bars = future ? `<div class="wplan" style="height:${h(w.planned_m)}"></div>`
      : cur ? `<div class="wstack" style="height:${h(Math.max(w.planned_m, w.actual_m))}">${w.planned_m ? '<div class="wplan full"></div>' : ''}<div class="wact" style="height:${h(w.actual_m)}"></div></div>`
      : `<div class="wact" style="height:${h(w.actual_m)}"></div>`;
    return `<a class="wcol ${cur ? 'cur' : ''} ${future ? 'fut' : ''}" href="#/activities?view=week&date=${w.week}">
      <span class="wv num">${label}</span>
      ${bars}
      <div class="wl">${md(w.week)}</div></a>`;
  }).join('')}</div></div>
    <p class="muted hint">km・点線は計画・タップで週の評価</p>`;
}

function activityList(acts) {
  if (acts.length === 0) return '<p class="muted">まだありません</p>';
  return `<ul class="list">${acts.map((a) => `
    <li><a href="#/activities/${a.id}">
      <div class="row spread"><span>${ymd(a.date)}(${dow(a.date)}) ${esc(a.name)}</span>${scoreHtml(a.score)}</div>
      <div class="muted num">${a.plan_type ? PLAN_LABELS[a.plan_type] : 'フリー'}・${km(a.distance_m, 2)}km・${pace(a.moving_time_s / (a.distance_m / 1000))}/km${a.avg_hr ? `・${Math.round(a.avg_hr)}bpm` : ''}${a.avg_cadence_spm ? `・${Math.round(a.avg_cadence_spm)}spm` : ''}</div>
    </a></li>`).join('')}</ul>`;
}

// ---- 計画

async function plansView(params) {
  const ws = weekStart(params.get('week') || today());
  const [plansRaw, weekActs, settings, shoes] = await Promise.all([
    api(`/plans?from=${ws}&to=${addDays(ws, 6)}`),
    api(`/activities?from=${ws}&to=${addDays(ws, 6)}`),
    api('/settings'),
    api('/shoes').catch(() => []),
    loadWx(),
  ]);
  SHOES = shoes;
  if (!SHOE_FIT) SHOE_FIT = await api('/shoes/compare').catch(() => ({}));
  dedupeIfNeeded(plansRaw);
  const plans = uniqPlans(plansRaw);
  /** 同じ日に走ったワークアウトは 1 つのメニューとして見せる。アップ・メイン・ダウンの内訳つき */
  const ROLE = { warmup: 'アップ', work: 'メイン', cooldown: 'ダウン' };
  const actLine = (list) => {
    if (!list.length) return '';
    const byTime = [...list].sort((a, b) => (a.start_date_local || '').localeCompare(b.start_date_local || ''));
    const main = list.find((a) => a.role === 'work') || [...list].sort((a, b) => b.distance_m - a.distance_m)[0];
    const dist = list.reduce((x, a) => x + a.distance_m, 0);
    const row = (a) => `<div class="ar"><span class="ar-n">${ROLE[a.role] || '走行'}</span><span class="num">${km(a.distance_m, 1)}km</span><span class="num">${pace(a.moving_time_s / (a.distance_m / 1000))}</span><span class="num muted">${a.avg_hr ? `${Math.round(a.avg_hr)}bpm` : ''}</span></div>`;
    return `<a class="act" href="#/activities/${main.id}"><div class="row spread"><b class="num">実績 ${km(dist, 1)}km</b>${scoreHtml(main.score)}</div>${list.length > 1 || main.role ? `<div class="ars">${byTime.map(row).join('')}</div>` : `<div class="num muted">${pace(main.moving_time_s / (main.distance_m / 1000))}/km${main.avg_hr ? `・${Math.round(main.avg_hr)}bpm` : ''}</div>`}</a>`;
  };
  /** 1 日ぶんの 計画 と 実績 の差 (短いチップで) */
  const dayDiff = (d, dayPlans, dayActs) => {
    const runPlans = dayPlans.filter((p) => p.type !== 'rest');
    const planned = runPlans.reduce((a, p) => a + (p.distance_m || 0), 0);
    const done = dayActs.reduce((a, r) => a + r.distance_m, 0);
    const past = d < today();
    const chip = (cls, text) => `<span class="dchip ${cls}">${text}</span>`;
    if (runPlans.length === 0) {
      return dayPlans.length && done > 0 ? `<div class="dchips">${chip('over', `休養日に ${km(done, 1)}km 走りました`)}</div>` : '';
    }
    if (done === 0) return past ? `<div class="dchips">${chip('gap', '未実施')}</div>` : '';
    const diff = done - planned;
    const rate = planned ? Math.abs(diff) / planned : 0;
    const chips = [];
    if (planned) chips.push(chip(rate <= 0.1 ? 'ok' : diff < 0 ? 'gap' : 'over', `距離 ${diff >= 0 ? '+' : '−'}${km(Math.abs(diff), 1)}km`));
    if (runPlans.length === 1) {
      const p = runPlans[0];
      const mainAct = dayActs.find((a) => a.role === 'work') || (dayActs.length === 1 ? dayActs[0] : null);
      const band = p.pace_min_s ? { min: p.pace_min_s, max: p.pace_max_s } : settings.paces?.[p.type];
      if (mainAct && band) {
        const avg = mainAct.moving_time_s / (mainAct.distance_m / 1000);
        const lab = parseSteps(p).length ? 'メインのペース' : 'ペース';
        chips.push(avg < band.min - 3 ? chip('over', `${lab} ${Math.round(band.min - avg)}秒 速い`)
          : avg > band.max + 3 ? chip('gap', `${lab} ${Math.round(avg - band.max)}秒 遅い`)
          : chip('ok', `${lab} 範囲内`));
      }
    }
    return chips.length ? `<div class="dchips">${chips.join('')}</div>` : '';
  };
  const days = [...Array(7)].map((_, i) => addDays(ws, i));
  const t = today();
  const total = plans.reduce((a, p) => a + (p.distance_m || 0), 0);
  const actual = weekActs.reduce((a, r) => a + (r.distance_m || 0), 0);

  setTimeout(() => {
    view.querySelectorAll('[data-add]').forEach((b) => (b.onclick = () => editPlan({ date: b.dataset.add }, settings)));
    view.querySelectorAll('[data-plan]').forEach((el) => (el.onclick = (e) => {
      if (e.target.closest('a')) return;
      editPlan(plans.find((p) => p.id === Number(el.dataset.plan)), settings);
    }));
    wirePrefs(view, settings, ws);
    wireAutoPlan(view);
    wireTools(view);
    wireDrag(view, plans, ws);
    view.querySelector('#bulk-go').onclick = async () => {
      const out = view.querySelector('#bulk-out');
      try {
        const data = JSON.parse(view.querySelector('#bulk-text').value);
        const replace = view.querySelector('#bulk-replace').checked;
        const r = await api('/plans/bulk', { method: 'POST', body: { plans: Array.isArray(data) ? data : data.plans, replace } });
        out.textContent = `${r.imported} 件登録しました`;
        setTimeout(route, 800);
      } catch (e) { out.textContent = `エラー: ${e.message}`; }
    };
    wireCopy(view, ws);
    wireCoach(view);
    wireCalendar(view, settings);
    // 予定を組むメニュー: 押した 1 つだけ開く
    view.querySelectorAll('[data-pm]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.pm;
      const open = !b.classList.contains('on');
      view.querySelectorAll('[data-pm]').forEach((x) => x.classList.remove('on'));
      view.querySelectorAll('.pm-pane').forEach((x) => x.classList.add('hidden'));
      if (open) {
        b.classList.add('on');
        view.querySelector(`#pm-${k}`).classList.remove('hidden');
        if (k === 'coach') view._coachOpen?.();
        try { sessionStorage.setItem('pm', k); } catch {}
      } else { try { sessionStorage.removeItem('pm'); } catch {} }
    }));
    try { const k = sessionStorage.getItem('pm'); if (k) view.querySelector(`[data-pm="${k}"]`)?.click(); } catch {}
  });

  const prefsOf = settings.plan_prefs;
  const dayTag = (d) => {
    const wd = new Date(d + 'T00:00:00').getDay();
    if (prefsOf.blocked.includes(d)) return '<span class="tag">予定あり</span>';
    if (prefsOf.rest_days.includes(wd)) return '<span class="tag">休み</span>';
    return '';
  };
  return `
    <div class="row spread" style="margin-bottom:8px">
      <a class="btn" href="#/plans?week=${addDays(ws, -7)}">‹ 前週</a>
      <strong>${md(ws)} 〜 ${md(addDays(ws, 6))}</strong>
      <a class="btn" href="#/plans?week=${addDays(ws, 7)}">翌週 ›</a>
    </div>
    <div class="card" id="cal">
      ${weekSum(total, actual, plans, weekActs, ws)}
      ${days.map((d) => {
        const dp = plans.filter((p) => p.date === d);
        return `
        <div class="week-day ${d === t ? 'today' : ''}" data-day="${d}">
          <div class="daycol">${dp.length ? '<span class="grip" data-grip="' + d + '" aria-label="ドラッグして入れ替え">⠿</span>' : '<span class="grip off"></span>'}<div><strong>${md(d)}</strong><div class="muted">${dow(d)}</div>${wxDay(d)}${dayTag(d)}</div></div>
          <div class="day-body">
            ${markHtml(dayJudge(d, dp, weekActs.filter((a) => a.date === d), settings))}
            ${dp.map((p) => planLine(p, true)).join('')}
            ${actLine(weekActs.filter((a) => a.date === d))}
            ${dayDiff(d, dp, weekActs.filter((a) => a.date === d))}
            <button data-add="${d}" style="margin-top:4px;font-size:12px">＋ 追加</button>
          </div>
        </div>`;
      }).join('')}
    </div>
    <p class="muted hint" style="margin:8px 4px 0">左の「⠿」を押したまま別の日へ動かすと入れ替わります。メニューをタップすると中身を直せます。</p>
    <h2 class="sect">予定を組む</h2>
    <div class="card pm-list">
      <button type="button" class="pm-row" data-pm="copy"><span class="pm-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg></span><span class="pm-t"><b>予定をコピー</b><small>前の週の予定を使い回す</small></span><span class="pm-chev">›</span></button>
      <div class="pm-pane hidden" id="pm-copy">
        <button type="button" class="pm-act" data-copy="next">この週 (${md(ws)}〜) を翌週へコピー</button>
        <button type="button" class="pm-act" data-copy="prev">前の週 (${md(addDays(ws, -7))}〜) をこの週へコピー</button>
        <p class="muted" id="copy-msg">コピー先にある予定はそのまま残り、コピーした予定が追加されます。</p>
      </div>
      <button type="button" class="pm-row" data-pm="prefs"><span class="pm-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg></span><span class="pm-t"><b>基本設定で組む</b><small>回数を選んで自動配置・レースまで</small></span><span class="pm-chev">›</span></button>
      <div class="pm-pane hidden" id="pm-prefs">
      <div class="tool-tabs">
        <button type="button" data-tool="prefs" class="on">週を自動配置</button>
        <button type="button" data-tool="auto">レースまで</button>
        <button type="button" data-tool="bulk">貼り付け</button>
      </div>
      <div class="tool-pane" id="pane-prefs"><div id="prefs-body"></div></div>
      <div class="tool-pane hidden" id="pane-auto">
        <p class="muted">直近4週間の走行距離と先週の達成度、レースの目標ペースから、レース当日までの毎日のメニューを作ります。</p>
        <label>目標レース<select id="auto-race"></select></label>
        <label class="row"><input type="checkbox" id="auto-over"> すでにある計画を置き換える (走った日の計画は残します)</label>
        <div class="row"><button id="auto-preview" class="primary">プレビュー</button><button id="auto-commit" class="hidden">この計画を登録</button></div>
        <div id="auto-out"></div>
      </div>
      <div class="tool-pane hidden" id="pane-bulk">
        <p class="muted">Claude が作った JSON を貼り付けます。</p>
        <textarea id="bulk-text" rows="8" style="width:100%" placeholder='[{"date":"2026-11-03","type":"jog","distance_m":8000,"notes":"..."}]'></textarea>
        <label class="row"><input type="checkbox" id="bulk-replace"> 期間内の既存メニューを置き換える</label>
        <div class="row"><button id="bulk-go" class="primary">登録</button></div>
        <p id="bulk-out"></p>
      </div>
      </div>
      <button type="button" class="pm-row" data-pm="coach"><span class="pm-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9 11h.01M12 11h.01M15 11h.01"/></svg></span><span class="pm-t"><b>予定を相談する</b><small>痛み・疲れ・走れない日を AI に相談</small></span><span class="pm-chev">›</span></button>
      <div class="pm-pane hidden" id="pm-coach">${coachPane()}</div>
    </div>
    <h2 class="sect">カレンダーに反映</h2>
    <div class="card" id="cal-card">${calCard(settings)}</div>`;
}

/** 計画画面の上: 今週の 実績 / 計画 と進み具合 */
function weekSum(total, actual, plans, acts, ws) {
  const t = today();
  const pct = total ? Math.min(100, Math.round((actual / total) * 100)) : 0;
  // 昨日までの計画 (ここまでに走っておきたい距離)。今日のぶんは走ったら足す
  const ranToday = acts.some((a) => a.date === t);
  const due = plans.filter((p) => p.date < t || (ranToday && p.date === t)).reduce((a, p) => a + (p.distance_m || 0), 0);
  const duePct = total ? Math.min(100, Math.round((due / total) * 100)) : 0;
  const cur = t >= ws && t <= addDays(ws, 6);
  const diff = actual - due;
  const status = !total ? '' : !cur ? (t > addDays(ws, 6) ? `達成率 ${pct}%` : 'これからの週')
    : Math.abs(diff) < 500 ? '予定どおり' : diff < 0 ? `予定より ${km(-diff, 1)}km 少ない` : `予定より ${km(diff, 1)}km 多い`;
  const cls = !cur || !total ? '' : Math.abs(diff) < 500 ? 'ok' : diff < 0 ? 'gap' : 'over';
  return `<div class="wsum">
    <div class="wsum-n num"><div><small>実績</small><b>${km(actual, 1)}</b><span>km</span></div><div class="wsum-of"><small>計画</small><b>${km(total, 1)}</b><span>km</span></div></div>
    <div class="wsum-bar"><i style="width:${pct}%"></i>${cur && total ? `<em style="left:${duePct}%" title="ここまでの計画"></em>` : ''}</div>
    <div class="row spread wsum-f"><span class="num">${total ? `${pct}%・残り ${km(Math.max(0, total - actual), 1)}km` : '計画なし'}</span>${status ? `<span class="dchip ${cls}">${status}</span>` : ''}</div>
  </div>`;
}

/** 予定をコピー (この週 → 翌週 / 前の週 → この週) */
function wireCopy(root, ws) {
  root.querySelectorAll('[data-copy]').forEach((b) => (b.onclick = async () => {
    const next = b.dataset.copy === 'next';
    const from = next ? ws : addDays(ws, -7), to = next ? addDays(ws, 7) : ws;
    if (!confirm(`${md(from)}〜の予定を ${md(to)}〜 の週へコピーしますか？`)) return;
    b.disabled = true;
    try {
      const r = await api('/plans/copy-week', { method: 'POST', body: { from, to } });
      root.querySelector('#copy-msg').textContent = `${r.copied} 件をコピーしました`;
      setTimeout(() => { if (next) location.hash = `#/plans?week=${to}`; else route(); }, 700);
    } catch (e) { root.querySelector('#copy-msg').textContent = `エラー: ${e.message}`; b.disabled = false; }
  }));
}

// ---- 予定の相談 (AI)。会話はこの画面を開いている間だけ残す
const COACH_BAD = '回答をうまく表示できませんでした。もう一度お試しください。';
const COACH_NET = 'AIコーチに接続できませんでした。';
// JSON のように見える文字列 (キー名や波括弧を画面に出さない)
const coachLooksJson = (s) => /^\s*(```|\{|\[|"\s*\{)|"(conclusion|reasons|reply|changes|keep)"\s*:/.test(String(s || ''));
/** サーバーの返事・保存していた会話を、画面に出せる形にそろえる (通常の相談と今週の見立てで共通) */
function coachMsg(r, extra = {}) {
  const strs = (v, n) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim() && !coachLooksJson(x)).slice(0, n) : []);
  const conclusion = typeof r?.conclusion === 'string' && !coachLooksJson(r.conclusion) ? r.conclusion.trim() : '';
  const reply = typeof r?.reply === 'string' && !coachLooksJson(r.reply) ? r.reply.trim() : '';
  const changes = (Array.isArray(r?.changes) ? r.changes : []).filter((c) => c && /^\d{4}-\d{2}-\d{2}$/.test(c.date) && typeof c.type === 'string');
  const invalid = !!r?.invalid || (!conclusion && !reply && !changes.length);
  return { role: 'assistant', content: invalid ? '' : reply || conclusion, conclusion, reasons: strs(r?.reasons, 5), keep: strs(r?.keep, 4), changes: invalid ? [] : changes, invalid, model: r?.model, ...extra };
}
let COACH_LOG = (() => { try { return JSON.parse(sessionStorage.getItem('coach') || '[]'); } catch { return []; } })();
// 前に保存した会話も同じ形にそろえる (JSON のまま残った返事は「読めなかった」扱い)
COACH_LOG = Array.isArray(COACH_LOG) ? COACH_LOG.filter((m) => m && (m.role === 'user' || m.role === 'assistant')).map((m) => (m.role === 'assistant' && !m.error ? { ...coachMsg({ ...m, reply: m.content }), brief: m.brief, applied: m.applied } : m)) : [];
const saveCoach = () => { try { sessionStorage.setItem('coach', JSON.stringify(COACH_LOG.slice(-20))); } catch {} };
function coachPane() {
  return `<div class="coach">
    <div class="coach-log" id="coach-log"></div>
    <form class="coach-in" id="coach-form">
      <textarea id="coach-text" rows="2" placeholder="例: 右ふくらはぎに張りがある。明日の LT 走はどうする？"></textarea>
      <button class="primary" id="coach-send" aria-label="送信"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
    </form>
    <div class="row spread coach-foot"><span class="muted" id="coach-model">計画と直近 3 週間の実績・ふりかえりを見て答えます</span><button type="button" class="linkbtn" id="coach-clear">会話を消す</button></div>
  </div>`;
}
function wireCoach(root) {
  const log = root.querySelector('#coach-log');
  if (!log) return;
  const ta = root.querySelector('#coach-text');
  const fmtChange = (c) => `${PLAN_LABELS[c.type] || c.type}${c.distance_km ? ` ${c.distance_km}km` : ''}${c.pace ? ` ${c.pace.split('-')[0] === c.pace.split('-')[1] ? c.pace.split('-')[0] : c.pace}` : ''}`;
  let confirmAt = -1; // 「予定に反映」を押して確認中の返事
  const aiCard = (m, i, before) => {
    const tag = m.brief ? '今週の見立て' : '相談への回答';
    if (m.invalid || m.error) {
      return `<div class="cm ai cm-card cm-err"><div class="cm-hd"><b>AIコーチ</b><span class="cm-tag">${tag}</span></div>
        <p class="cm-concl">${m.error ? COACH_NET : COACH_BAD}</p>${m.error && m.detail ? `<p class="muted cm-sub">${esc(m.detail)}</p>` : ''}
        <button type="button" class="ghost cm-retry" data-cretry="${i}">もう一度試す</button></div>`;
    }
    const n = m.changes?.length || 0;
    const head = m.conclusion || m.content;
    const extra = m.conclusion && m.content && m.content !== m.conclusion ? m.content : '';
    return `<div class="cm ai cm-card"><div class="cm-hd"><b>AIコーチの見立て</b><span class="cm-tag">${tag}</span><span class="cm-st ${n ? 'chg' : ''}">${n ? `変更案あり：${n}件` : '計画変更なし'}</span></div>
      <div class="cm-concl clamp" data-cclamp>${esc(head).replace(/\n/g, '<br>')}</div><button type="button" class="linkbtn cm-more hidden" data-cmore>続きを表示</button>
      ${m.reasons?.length ? `<details class="cm-why"><summary>判断した理由 (${m.reasons.length})</summary><ul>${m.reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
      ${m.keep?.length ? `<div class="cm-keep"><b>予定どおりにする練習</b>${m.keep.map((x) => `<p>${esc(x)}</p>`).join('')}</div>` : ''}
      ${extra ? `<details class="cm-why"><summary>コーチのコメント</summary><p class="cm-sub">${esc(extra).replace(/\n/g, '<br>')}</p></details>` : ''}
      ${n ? `<div class="cchg"><b>変更案</b>${m.changes.map((c) => `<div class="cchg-r"><span class="num">${md(c.date)}(${dow(c.date)})</span><span class="muted">${esc(m.applied ? '' : before(c.date))}</span><span>→ <b>${esc(fmtChange(c))}</b>${c.notes ? `<small class="muted">${esc(c.notes)}</small>` : ''}</span></div>`).join('')}
        ${m.applied ? '<p class="muted" style="margin:8px 0 0">予定に反映しました</p>'
          : confirmAt === i ? `<p class="cm-sub">上の ${n} 日の予定を置き換えます (実績の付いた予定は変えません)。</p><div class="row cm-cf"><button type="button" class="ghost" data-cno>やめる</button><button type="button" class="primary" data-capply="${i}">反映する</button></div>`
          : `<button type="button" class="primary wide" data-cask="${i}">予定に反映する…</button>`}</div>` : ''}</div>`;
  };
  const draw = async () => {
    const dates = COACH_LOG.flatMap((m) => (m.changes || []).map((c) => c.date)).sort();
    let cur = [];
    if (dates.length) { try { cur = uniqPlans(await api(`/plans?from=${dates[0]}&to=${dates[dates.length - 1]}`)); } catch {} }
    const before = (d) => cur.filter((p) => p.date === d).map((p) => `${PLAN_LABELS[p.type]}${p.distance_m ? ` ${km(p.distance_m)}km` : ''}`).join('・') || 'なし';
    const shown = COACH_LOG.filter((m) => !m.hidden);
    log.innerHTML = shown.length ? COACH_LOG.map((m, i) => m.hidden ? '' : m.role === 'user' ? `<div class="cm me">${esc(m.content)}</div>` : aiCard(m, i, before)).join('')
      : `<div class="coach-empty"><p class="muted">体の状態や都合を書くと、計画の組み直しを提案します。反映するかはあとで選べます。</p><button type="button" class="ghost" id="coach-brief-btn">今週の見立てを出す</button></div>`;
    const lastModel = [...COACH_LOG].reverse().find((m) => m.model)?.model;
    root.querySelector('#coach-model').textContent = lastModel ? `AI: ${lastModel.split('/').pop()}` : '計画と直近 3 週間の実績・ふりかえりを見て答えます';
    // 結論が長いときだけ「続きを表示」
    log.querySelectorAll('[data-cclamp]').forEach((el) => {
      const more = el.nextElementSibling;
      if (el.scrollHeight > el.clientHeight + 2) { more.classList.remove('hidden'); more.onclick = () => { el.classList.remove('clamp'); more.remove(); }; }
    });
    root.querySelector('#coach-brief-btn')?.addEventListener('click', () => openBrief(false));
    log.querySelectorAll('[data-cask]').forEach((b) => (b.onclick = () => { confirmAt = Number(b.dataset.cask); draw(); }));
    log.querySelectorAll('[data-cno]').forEach((b) => (b.onclick = () => { confirmAt = -1; draw(); }));
    log.querySelectorAll('[data-capply]').forEach((b) => (b.onclick = async () => {
      const m = COACH_LOG[Number(b.dataset.capply)];
      if (!m?.changes?.length) return;
      b.disabled = true;
      try { await api('/coach/apply', { method: 'POST', body: { changes: m.changes } }); m.applied = true; confirmAt = -1; saveCoach(); route(); }
      catch (e) { b.disabled = false; b.insertAdjacentHTML('afterend', `<p class="muted cm-sub">反映できませんでした (${esc(e.message)})</p>`); }
    }));
    log.querySelectorAll('[data-cretry]').forEach((b) => (b.onclick = () => {
      const i = Number(b.dataset.cretry);
      const m = COACH_LOG[i];
      if (m.brief) { COACH_LOG = COACH_LOG.filter((x, k) => k !== i && !(x.hidden && k === i - 1)); saveCoach(); openBrief(true); return; }
      // 通常の相談: 読めなかった返事を消して、直前の相談をもう一度送る
      COACH_LOG.splice(i, 1);
      ask();
    }));
  };
  const errMsg = (e, extra) => ({ role: 'assistant', content: '', error: true, detail: /無料枠/.test(e?.message || '') ? e.message : '', changes: [], ...extra });
  // 会話を送る (最後がユーザーの相談のとき)
  const ask = async () => {
    await draw();
    log.insertAdjacentHTML('beforeend', '<div class="cm ai typing"><i></i><i></i><i></i></div>');
    log.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const btn = root.querySelector('#coach-send'); btn.disabled = true;
    try {
      // 読めなかった返事・エラーは AI に送り返さない
      const hist = COACH_LOG.filter((m) => !m.invalid && !m.error).map((m) => ({ role: m.role, content: m.content, changes: m.changes }));
      COACH_LOG.push(coachMsg(await api('/coach', { method: 'POST', body: { messages: hist } })));
    } catch (e) {
      COACH_LOG.push(errMsg(e));
    }
    saveCoach();
    btn.disabled = false;
    await draw();
    log.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const send = async (text) => {
    text = text.trim();
    if (!text) return;
    COACH_LOG.push({ role: 'user', content: text });
    ta.value = '';
    await ask();
  };
  // 今週の見立て。force なら作り直す (サーバーのキャッシュを使わない)
  const openBrief = async (force = false) => {
    log.innerHTML = '<div class="cm ai typing"><i></i><i></i><i></i></div>';
    let m;
    try { m = coachMsg(await api('/coach/brief', { method: 'POST', body: { force } }), { brief: true }); }
    catch (e) { m = errMsg(e, { brief: true }); }
    if (COACH_LOG.some((x) => !x.hidden)) { draw(); return; } // 待っている間に相談を始めていたら出さない
    COACH_LOG = [{ role: 'user', content: '今週の見立てをください', hidden: true }, m];
    saveCoach();
    draw();
  };
  root.querySelector('#coach-form').onsubmit = (e) => { e.preventDefault(); send(ta.value); };
  // 会話を消す: 消したあとは自動で見立てを出し直さない (前と同じ見立てが出て、消えていないように見えるため)
  root.querySelector('#coach-clear').onclick = () => { COACH_LOG = []; confirmAt = -1; saveCoach(); try { sessionStorage.setItem('coach-cleared', '1'); } catch {} draw(); };
  // 開いたとき、会話が空なら「今週の見立て」を出す (同じ状況ならサーバーのキャッシュ)。会話を消したあとは出さない
  root._coachOpen = () => {
    let cleared = false;
    try { cleared = sessionStorage.getItem('coach-cleared') === '1'; } catch {}
    if (COACH_LOG.length || cleared) return;
    openBrief(false);
  };
  draw();
}

// ---- iPhone カレンダー。購読は 1 回だけ (2 回追加すると予定が二重に出る)
function calCard(settings) {
  const icon = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/><path d="M9 15l2 2 4-4"/></svg>';
  if (settings.calendar_added) {
    return `<div class="cal-done">${icon}<span><b>iPhone のカレンダーと連携済み</b><small>予定を変えると自動で反映 (${md(settings.calendar_added)} 追加)</small></span></div>
      <details class="cal-more"><summary>反映されないとき</summary>
        <p class="muted">iPhone の「設定 › アプリ › カレンダー › カレンダーアカウント › 照会したカレンダー」で、このカレンダーの「取得頻度」を短くすると早く反映されます。</p>
        <p class="muted">カレンダーから消してしまったときだけ、下のボタンで追加し直してください。2 回追加すると予定が二重に表示されます。</p>
        <button type="button" id="cal-re">カレンダーに追加し直す</button>
      </details>`;
  }
  return `<button type="button" id="cal-add" class="cal-btn">${icon}<span>iPhone のカレンダーに追加<small>1 回だけ追加。あとは自動で反映</small></span></button>
    <p class="muted" style="margin:10px 2px 0;font-size:12.5px">前に追加したことがあるなら、押さずに <button type="button" class="linkbtn" id="cal-mark" style="margin:0">追加済みにする</button> (二重に表示されるのを防ぎます)</p>`;
}
async function openCalendar() {
  const st = await api('/status');
  await api('/settings', { method: 'PUT', body: { calendar_added: today() } }).catch(() => null);
  cachedSettings = null;
  location.href = st.calendar_url.replace(/^https?:/, 'webcal:');
}
function wireCalendar(root) {
  const add = root.querySelector('#cal-add');
  if (add) add.onclick = async () => { add.disabled = true; try { await openCalendar(); setTimeout(route, 1500); } catch (e) { alert(e.message); add.disabled = false; } };
  const mark = root.querySelector('#cal-mark');
  if (mark) mark.onclick = async () => { await api('/settings', { method: 'PUT', body: { calendar_added: today() } }); cachedSettings = null; route(); };
  const re = root.querySelector('#cal-re');
  if (re) re.onclick = async () => {
    if (!confirm('カレンダーにまだ「STRIDE」が残っていると、予定が二重に表示されます。iPhone のカレンダーから消したときだけ追加し直してください。追加しますか？')) return;
    try { await openCalendar(); } catch (e) { alert(e.message); }
  };
}

/** 「週の条件」「自動で作る」「貼り付け」の切り替え (選んだ1つだけ開く) */
function wireTools(root) {
  const tabs = root.querySelectorAll('[data-tool]');
  tabs.forEach((b) => (b.onclick = async () => {
    const was = b.classList.contains('on');
    tabs.forEach((x) => x.classList.remove('on'));
    root.querySelectorAll('.tool-pane').forEach((x) => x.classList.add('hidden'));
    if (was) return;
    b.classList.add('on');
    root.querySelector('#pane-' + b.dataset.tool).classList.remove('hidden');
    if (b.dataset.tool === 'auto') await root._loadRaces();
  }));
}

/** 日ごとのメニューをドラッグで入れ替え (指でもマウスでも動く) */
function wireDrag(root, plans, ws) {
  const cal = root.querySelector('#cal');
  const dayAt = (x, y) => document.elementsFromPoint(x, y).map((e) => e.closest?.('.week-day')).find((e) => e && cal.contains(e));
  cal.querySelectorAll('[data-grip]').forEach((g) => {
    g.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const from = g.dataset.grip;
      const src = g.closest('.week-day');
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.textContent = `${md(from)}(${dow(from)}) のメニュー`;
      document.body.appendChild(ghost);
      src.classList.add('dragging');
      let over = null;
      const place = (ev) => { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; };
      place(e);
      g.setPointerCapture(e.pointerId);
      const move = (ev) => {
        place(ev);
        const d = dayAt(ev.clientX, ev.clientY);
        if (over && over !== d) over.classList.remove('drop');
        over = d && d !== src ? d : null;
        if (over) over.classList.add('drop');
        const m = 70;
        if (ev.clientY < m) window.scrollBy(0, -12); else if (ev.clientY > innerHeight - 150) window.scrollBy(0, 12);
      };
      const end = async (ev) => {
        g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', end); g.removeEventListener('pointercancel', end);
        ghost.remove(); src.classList.remove('dragging');
        cal.querySelectorAll('.drop').forEach((x) => x.classList.remove('drop'));
        const d = ev.type === 'pointerup' ? dayAt(ev.clientX, ev.clientY) : null;
        if (!d || d === src) return;
        const to = d.dataset.day;
        const a = plans.filter((p) => p.date === from);
        const b = plans.filter((p) => p.date === to);
        const label = b.length ? `${md(from)}と${md(to)}のメニューを入れ替えます` : `${md(from)}のメニューを${md(to)}へ移します`;
        if (!confirm(label)) return;
        try {
          const put = (p, date) => api(`/plans/${p.id}`, { method: 'PUT', body: { ...p, date } });
          await Promise.all([...a.map((p) => put(p, to)), ...b.map((p) => put(p, from))]);
        } catch (err) { alert(`入れ替えできませんでした: ${err.message}`); }
        route();
      };
      g.addEventListener('pointermove', move); g.addEventListener('pointerup', end); g.addEventListener('pointercancel', end);
    });
  });
}


/** この週の条件 (ポイント走の回数・ロング走・休みの回数・走れない日)。選ぶとすぐ保存し、ボタンで自動配置 */
function wirePrefs(root, settings, ws) {
  const body = root.querySelector('#prefs-body');
  const prefs = settings.plan_prefs;
  const t = today();
  const from = ws > t ? ws : t;
  const weekDays = [...Array(7)].map((_, i) => addDays(ws, i)).filter((d) => d >= t);
  const seg = (label, attr, vals, cur) => `<div class="pf-row"><b>${label}</b><div class="pf-seg" style="--n:${vals.length}">${vals.map((n) => `<button type="button" class="${cur === n ? 'on' : ''}" ${attr}="${n}">${n}<small>回</small></button>`).join('')}</div></div>`;
  const draw = () => {
    body.innerHTML = `
      <p class="muted pf-note">1週間の回数を選びます。選んだ回数は保存され、次の週にも使われます。</p>
      ${seg('ポイント練', 'data-pp', [0, 1, 2, 3], prefs.points_per_week)}
      ${seg('ロング走', 'data-lp', [0, 1, 2, 3], prefs.long_per_week)}
      ${seg('休息日', 'data-rp', [0, 1, 2, 3], prefs.rest_per_week)}
      ${weekDays.length ? `<div class="pf-block"><div class="pf-h"><b>走れない日</b><span class="muted">タップした日は休みにします</span></div>
        <div class="wk-days">${[...Array(7)].map((_, i) => addDays(ws, i)).map((d) => `<button type="button" class="wk-day ${prefs.blocked.includes(d) ? 'on off-day' : ''}" data-bl="${d}" ${d < t ? 'disabled' : ''}><small>${dow(d)}</small><b class="num">${Number(d.slice(8))}</b></button>`).join('')}</div></div>` : ''}
      <button type="button" id="regen" class="primary wide" ${weekDays.length ? '' : 'disabled'}>この週を自動で配置</button>
      <p class="muted" id="prefs-msg">${weekDays.length ? '配置したあと、カレンダーの「⠿」をドラッグして入れ替えられます' : '過ぎた週は作り直せません'}</p>`;
  };
  const save = async () => {
    try { await api('/settings', { method: 'PUT', body: { plan_prefs: prefs } }); }
    catch (e) { body.querySelector('#prefs-msg').textContent = `エラー: ${e.message}`; }
  };
  body.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (b.id === 'regen') {
      if (!confirm(`${md(from)}〜${md(addDays(ws, 6))}の計画を、この条件で作り直します (走った日の計画は残します)`)) return;
      b.disabled = true;
      prefs.rest_days = [];
      try {
        await save();
        const r = await api('/plans/generate', { method: 'POST', body: { overwrite: true, commit: true, from, to: addDays(ws, 6) } });
        body.querySelector('#prefs-msg').textContent = `${r.added} 日分を配置しました`;
        setTimeout(route, 700);
      } catch (err) { body.querySelector('#prefs-msg').textContent = `エラー: ${err.message}`; b.disabled = false; }
      return;
    }
    if (d.pp != null) prefs.points_per_week = Number(d.pp);
    else if (d.lp != null) prefs.long_per_week = Number(d.lp);
    else if (d.rp != null) prefs.rest_per_week = Number(d.rp);
    else if (d.bl) prefs.blocked = prefs.blocked.includes(d.bl) ? prefs.blocked.filter((x) => x !== d.bl) : [...prefs.blocked, d.bl];
    else return;
    draw();
    await save();
  });
  draw();
}

function wireAutoPlan(root) {
  const q = (id) => root.querySelector(id);
  root._loadRaces = async () => {
    const sel = q('#auto-race');
    if (sel.options.length) return;
    const races = (await api('/races')).filter((r) => r.date >= today());
    sel.innerHTML = races.map((r) => `<option value="${r.id}">${esc(r.name)} (${ymd(r.date)}・${esc(r.priority)})</option>`).join('') || '<option value="">先にレースを登録してください</option>';
  };
  const call = (commit) => api('/plans/generate', { method: 'POST', body: { race_id: Number(q('#auto-race').value) || undefined, overwrite: q('#auto-over').checked, commit } });
  q('#auto-preview').onclick = async () => {
    const out = q('#auto-out');
    out.textContent = '作成中…';
    try {
      const r = await call(false);
      const s = r.summary;
      out.innerHTML = `<p><b>${esc(s.race)}</b> (${ymd(s.race_date)}) まで ${s.days} 日分${s.base_weekly_km ? `・直近の週平均 ${s.base_weekly_km}km` : ''}</p>
        <table class="num"><tr><th>週</th><th>距離</th></tr>${s.weeks.map((w) => `<tr><td>${md(w.week)}〜</td><td>${w.km}km <span class="bar" style="display:inline-block;width:${Math.min(120, w.km * 1.3)}px;vertical-align:middle"><i style="display:block;height:100%;width:100%;background:var(--accent)"></i></span></td></tr>`).join('')}</table>
        <details><summary>日ごとのメニュー</summary>${r.rows.map((x) => `<div class="prow"><b>${md(x.date)}(${dow(x.date)})</b> <span class="badge" data-t="${x.type}">${PLAN_LABELS[x.type]}</span> ${x.distance_m ? `${km(x.distance_m)}km` : ''}<div class="muted">${esc(x.notes)}</div></div>`).join('')}</details>`;
      q('#auto-commit').classList.remove('hidden');
    } catch (e) { out.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
  };
  q('#auto-commit').onclick = async (e) => {
    e.target.disabled = true;
    try {
      const r = await call(true);
      q('#auto-out').innerHTML = `<p>${r.added} 日分を登録しました${r.skipped ? ` (登録済みの ${r.skipped} 日は飛ばしました)` : ''}</p>`;
      setTimeout(route, 1200);
    } catch (err) { q('#auto-out').innerHTML = `<p class="error">${esc(err.message)}</p>`; e.target.disabled = false; }
  };
}

// ---- COROS 風のメニュー構成 (ウォームアップ / トレーニング / 休憩 / インターバル / クールダウン)
const STEP_KINDS = { warmup: 'ウォームアップ', work: 'トレーニング', rest: '休憩', interval: 'インターバル', cooldown: 'クールダウン' };
/** COROS の強度ゾーン (ペースは秒/km。上限・下限が無いゾーンは目安で補う) */
const ZONES = [
  { n: '回復', short: '回復', pace: [345, 390], hr: [0, 0.8] },
  { n: '有酸素持久力', short: '持久力', pace: [286, 345], hr: [0.8, 0.9] },
  { n: '有酸素パワー', short: 'パワー', pace: [265, 285], hr: [0.91, 0.95] },
  { n: '乳酸閾値', short: '閾値', pace: [242, 264], hr: [0.95, 1.02] },
  { n: '無酸素持久力', short: '無酸素', pace: [222, 241], hr: [1.02, 1.06] },
  { n: '無酸素パワー', short: '全力', pace: [200, 221], hr: [1.06, 1.2] },
];
/** 自分の設定ペース (設定画面の値)。E / M / LT / I を基準ペースとして選べる */
let PACES = null;
const REFS = { easy: { label: 'E', zone: 1 }, m: { label: 'M', zone: 3 }, lt: { label: 'LT', zone: 3 }, interval: { label: 'I', zone: 4 } };
const bandOf = (t) => (t.pmin && t.pmax ? [t.pmin, t.pmax] : t.ref && PACES?.[t.ref] ? [PACES[t.ref].min, PACES[t.ref].max] : ZONES[t.zone].pace);
const bandMid = (t) => (bandOf(t)[0] + bandOf(t)[1]) / 2;
const intensityLabel = (t) => (t.pmin && t.pmax ? `${pace(t.pmin)}〜${pace(t.pmax)}` : t.ref ? REFS[t.ref].label : ZONES[t.zone].short);

/** ホイール式の数値選択 (COROS と同じ。上下にスクロールして合わせる)。cols: [{items:[{v,label}], value, unit}] */
function wheelPick(title, cols) {
  return new Promise((resolve) => {
    const H = 44;
    const el = document.createElement('div');
    el.className = 'sheet wheel';
    el.innerHTML = `<div class="sheet-bg"></div><div class="sheet-body"><div class="row spread" style="margin-bottom:6px"><button type="button" class="chip" data-w="no">キャンセル</button><b>${title}</b><button type="button" class="chip on" data-w="ok">決定</button></div>
      <div class="wh-cols">${cols.map((c, ci) => `<div class="wh-col"><div class="wh-list" data-ci="${ci}"><div style="height:${H * 2}px"></div>${c.items.map((it) => `<div class="wh-it" style="height:${H}px">${it.label}</div>`).join('')}<div style="height:${H * 2}px"></div></div>${c.unit ? `<span class="wh-u">${c.unit}</span>` : ''}</div>`).join('')}<div class="wh-sel"></div></div></div>`;
    document.body.appendChild(el);
    const lists = [...el.querySelectorAll('.wh-list')];
    lists.forEach((l, ci) => {
      const idx = Math.max(0, cols[ci].items.findIndex((it) => it.v === cols[ci].value));
      l.scrollTop = idx * H;
    });
    const done = (ok) => {
      const out = ok ? lists.map((l, ci) => cols[ci].items[Math.min(cols[ci].items.length - 1, Math.max(0, Math.round(l.scrollTop / H)))].v) : null;
      el.remove();
      resolve(out);
    };
    el.querySelector('.sheet-bg').onclick = () => done(false);
    el.querySelector('[data-w="no"]').onclick = () => done(false);
    el.querySelector('[data-w="ok"]').onclick = () => done(true);
  });
}
const range = (a, b, f = (x) => String(x)) => Array.from({ length: b - a + 1 }, (_, i) => ({ v: a + i, label: f(a + i) }));
/** 距離 (m) を km と 0.05km 刻みのホイールで選ぶ */
async function pickDist(title, m) {
  const km = Math.floor(m / 1000), q = Math.round((m - km * 1000) / 50);
  const r = await wheelPick(title, [
    { items: range(0, 42), value: km, unit: '.' },
    { items: range(0, 19, (x) => String(x * 5).padStart(2, '0')), value: Math.min(19, q), unit: 'km' },
  ]);
  return r ? Math.max(100, r[0] * 1000 + r[1] * 50) : null;
}
/** 時間 (秒) を 分 / 秒 のホイールで選ぶ */
async function pickTime(title, sec0, maxMin = 120) {
  const sec = Math.round(sec0); // 先に丸める (秒が 60 にならないように)
  const r = await wheelPick(title, [
    { items: range(0, maxMin), value: Math.floor(sec / 60), unit: '分' },
    { items: range(0, 59, (x) => String(x).padStart(2, '0')), value: Math.round(sec % 60), unit: '秒' },
  ]);
  return r ? Math.max(10, r[0] * 60 + r[1]) : null;
}
/** レースの目標タイムを 時:分:秒 のホイールで選ぶ */
async function pickGoal(title, sec0) {
  const sec = Math.round(sec0);
  const r = await wheelPick(title, [
    { items: range(0, 7), value: Math.floor(sec / 3600), unit: ':' },
    { items: range(0, 59, (x) => String(x).padStart(2, '0')), value: Math.floor((sec % 3600) / 60), unit: ':' },
    { items: range(0, 59, (x) => String(x).padStart(2, '0')), value: Math.round(sec % 60) },
  ]);
  return r ? r[0] * 3600 + r[1] * 60 + r[2] : null;
}
/** ペース (秒/km) を 分:秒 のホイールで選ぶ */
async function pickPace(title, sec0) {
  const sec = Math.round(sec0);
  const r = await wheelPick(title, [
    { items: range(2, 9), value: Math.floor(sec / 60), unit: ':' },
    { items: range(0, 59, (x) => String(x).padStart(2, '0')), value: Math.round(sec % 60), unit: '/km' },
  ]);
  return r ? r[0] * 60 + r[1] : null;
}

const fmtTarget = (t) => (t.by === 'dist' ? (t.value >= 1000 ? `${+(t.value / 1000).toFixed(2)}km` : `${t.value}m`) : pace(t.value));
const targetM = (t) => (t.by === 'dist' ? t.value : (t.value / bandMid(t)) * 1000);
const stepM = (sp) => (sp.kind === 'interval' ? sp.reps * (targetM(sp.work) + targetM(sp.rest)) : targetM(sp));
const stepsTotalM = (steps) => steps.reduce((a, sp) => a + stepM(sp), 0);
function stepText(sp) {
  if (sp.kind === 'interval') return `${fmtTarget(sp.work)}×${sp.reps} ${intensityLabel(sp.work)} (休憩 ${fmtTarget(sp.rest)})`;
  const base = `${fmtTarget(sp)} ${intensityLabel(sp)}`;
  return sp.kind === 'warmup' ? `アップ ${base}` : sp.kind === 'cooldown' ? `ダウン ${base}` : sp.kind === 'rest' ? `休憩 ${fmtTarget(sp)}` : base;
}
const stepsSummary = (steps) => steps.map(stepText).join(' → ');
const mkStep = {
  warmup: () => ({ kind: 'warmup', by: 'dist', value: 2000, zone: 1, ref: 'easy' }),
  work: () => ({ kind: 'work', by: 'dist', value: 5000, zone: 3, ref: 'm' }),
  rest: () => ({ kind: 'rest', by: 'time', value: 120, zone: 0 }),
  cooldown: () => ({ kind: 'cooldown', by: 'dist', value: 2000, zone: 1, ref: 'easy' }),
  interval: () => ({ kind: 'interval', reps: 5, work: { by: 'dist', value: 1000, zone: 4, ref: 'interval' }, rest: { by: 'dist', value: 200, zone: 0 } }),
};
const STEP_PRESETS = {
  'Mペース走': () => [mkStep.warmup(), { kind: 'work', by: 'dist', value: 10000, zone: 3, ref: 'm' }, mkStep.cooldown()],
  'LT走': () => [mkStep.warmup(), { kind: 'interval', reps: 3, work: { by: 'dist', value: 2000, zone: 3, ref: 'lt' }, rest: { by: 'dist', value: 400, zone: 0 } }, mkStep.cooldown()],
  'インターバル': () => [mkStep.warmup(), mkStep.interval(), mkStep.cooldown()],
  'ビルドアップ': () => [{ kind: 'work', by: 'dist', value: 5000, zone: 1, ref: 'easy' }, { kind: 'work', by: 'dist', value: 5000, zone: 2 }, { kind: 'work', by: 'dist', value: 3000, zone: 3, ref: 'm' }],
  'ロング(後半M)': () => [{ kind: 'work', by: 'dist', value: 16000, zone: 1, ref: 'easy' }, { kind: 'work', by: 'dist', value: 8000, zone: 3, ref: 'm' }],
};

const PLAN_DEFAULT_KM = { easy: 10, jog: 6, long: 24, m: 14, lt: 10, interval: 10, race: 42.2 };
const DIST_CHIPS = [5, 8, 10, 12, 15, 18, 20, 25, 30];
const MEMO_TEMPLATES = {
  easy: ['ゆっくり (会話できるペース)', '流し 4本を最後に'],
  jog: ['ゆっくりジョグ', '回復ジョグ+流し 3本'],
  long: ['全体を一定ペースで', '後半 5km をMペースに', '30km 走'],
  m: ['アップ 2km + M 10km + ダウン 2km', 'アップ 2km + M 5km×2 (間 1km つなぎ)', 'M 1km×4 (調整)'],
  lt: ['アップ 2km + 2km×3 (間 400m)', 'アップ 2km + 5km テンポ', '1km×5 (間 200m)'],
  interval: ['1000m×5 (間 200m ジョグ)', '400m×10 (間 200m)', '2000m×3 (間 400m)'],
  race: ['目標ペースで走り切る'],
  rest: ['完全休養', 'ストレッチ・体幹のみ'],
};

/** タップだけで計画を作る・直す */
// ---- ワークアウト作成 (COROS 風): ステップのカードを並べて、タップで編集する全画面
const KIND_COLOR = { warmup: '#c9a227', work: '#2e9e5b', rest: '#8a8f9c', cooldown: '#2b9a9a', interval: '#2e9e5b' };
const REF_LABEL = { easy: 'E', m: 'M', lt: 'LT', interval: 'I' };

function editPlan(p, settings) {
  return new Promise((resolve) => {
    const st = {
      date: p.date,
      type: p.type || 'easy',
      km: p.distance_m ? p.distance_m / 1000 : null,
      pmin: p.pace_min_s || null,
      pmax: p.pace_max_s || null,
      notes: p.notes || '',
      steps: [],
    };
    try { st.steps = p.steps ? JSON.parse(p.steps) : []; } catch { st.steps = []; }
    if (st.steps.length) {
      st.notes = cleanNotes(p.notes, st.steps);
    }
    if (!p.id && st.km == null) st.km = PLAN_DEFAULT_KM[st.type] ?? null;
    PACES = settings.paces;
    const lthr = settings.coros?.lthr || settings.lthr || 174;
    const ws0 = weekStart(p.date);
    const week = [...Array(7)].map((_, i) => addDays(ws0, i));
    const chip = (attr, val, label, on) => `<button type="button" class="chip ${on ? 'on' : ''}" ${attr}="${esc(String(val))}">${esc(label)}</button>`;
    let scr = { name: 'list' };
    let openRow = null;

    const root = document.createElement('div');
    root.className = 'wk';
    document.body.appendChild(root);
    document.body.classList.add('wk-open');
    const close = (v) => { root.remove(); document.body.classList.remove('wk-open'); resolve(v); };

    const partOf = (sp, part) => (part ? sp[part] : sp);
    const paceText = (t) => {
      const b = bandOf(t);
      const lab = t.pmin && t.pmax ? '' : t.ref ? `${REF_LABEL[t.ref]} ` : `${ZONES[t.zone].short} `;
      return `${lab}${pace(b[0])}〜${pace(b[1])}`;
    };
    const subLine = (sp) => sp.kind === 'interval'
      ? `${sp.reps}本 × ${fmtTarget(sp.work)} ${paceText(sp.work)} / 休憩 ${fmtTarget(sp.rest)}`
      : `${sp.by === 'dist' ? '距離' : '時間'} ${fmtTarget(sp)}${sp.kind === 'rest' ? '' : ` | ${paceText(sp)}`}`;
    const plus = (at) => `<button type="button" class="wk-plus" data-add-at="${at}" aria-label="ステップを追加"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>`;

    const header = (title, left, right) => `<div class="wk-top"><button type="button" class="wk-btn" data-act="${left[0]}">${left[1]}</button><b>${title}</b>${right ? `<button type="button" class="wk-btn primary" data-act="${right[0]}">${right[1]}</button>` : '<span style="width:64px"></span>'}</div>`;

    /** − [タップで詳しく選ぶ] + */
    const stp = (key, inner) => `<div class="stp"><button type="button" class="stp-b" data-stp="${key}:-1" aria-label="減らす"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg></button>${inner}<button type="button" class="stp-b" data-stp="${key}:1" aria-label="増やす"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button></div>`;
    // ---------------- 一覧
    const listHtml = () => {
      const simple = !st.steps.length && st.type !== 'rest';
      const def = settings.paces?.[st.type];
      const pdisp = () => (st.pmin ? `${pace(st.pmin)}〜${pace(st.pmax)}` : def ? `${pace(def.min)}〜${pace(def.max)}` : '-');
      return `${header(p.id ? '計画を編集' : '計画を追加', ['back', '‹ 戻る'], ['save', '保存'])}
      <div class="wk-body">
        <div class="wk-card">
          <div class="field"><span class="lbl">日</span><div class="wk-days">${week.map((d) => `<button type="button" class="wk-day ${d === st.date ? 'on' : ''}" data-date="${d}"><small>${dow(d)}</small><b class="num">${Number(d.slice(8))}</b></button>`).join('')}</div></div>
          <div class="field"><span class="lbl">種別</span><div class="wk-types">${Object.entries(PLAN_LABELS).map(([k, v]) => `<button type="button" class="wk-type ${k === st.type ? 'on' : ''}" data-type="${k}" style="--tc:var(--c-${k})"><i></i>${esc(v)}</button>`).join('')}</div></div>
        </div>
        ${st.type === 'rest' ? '' : st.steps.length ? `
          <div class="wk-steps">
            ${plus(0)}
            ${st.steps.map((sp, i) => `<div class="wk-step" data-i="${i}" style="--kc:${KIND_COLOR[sp.kind]}">
                <button type="button" class="wk-grip" data-grip="${i}" aria-label="並べ替え">⠿</button>
                <button type="button" class="wk-card-main" data-edit="${i}"><b>${i + 1} ${STEP_KINDS[sp.kind]}</b><span class="muted">${esc(subLine(sp))}</span></button>
                <svg class="chev" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
              </div>${plus(i + 1)}`).join('')}
          </div>
          <div class="step-total num">合計 約 ${(stepsTotalM(st.steps) / 1000).toFixed(1)}km</div>` : `
          <div class="wk-card">
            <div class="wk-tiles stp-tiles">
              ${stp('km', `<button type="button" class="wk-tile" data-wheel="km"><small>距離</small><b class="num">${(st.km ?? 10).toFixed(1)}<span>km</span></b></button>`)}
              ${stp('prange', `<button type="button" class="wk-tile" data-wheel="prange"><small>ペース${st.pmin ? '' : ' (標準)'}</small><b class="num">${pdisp()}<span>/km</span></b></button>`)}
            </div>
            <p class="muted zone-note" style="margin:8px 0 0">−/＋ で少しずつ、数字をタップすると細かく選べます。${st.pmin ? '<button type="button" class="linkbtn" data-pdef="1">ペースを標準に戻す</button>' : ''}</p>
          </div>
          <div class="wk-card"><span class="lbl">アップ・メイン・ダウンで組む</span>
            <div class="wk-presets">${Object.keys(STEP_PRESETS).map((n) => `<button type="button" class="wk-preset" data-preset="${esc(n)}">${esc(n)}</button>`).join('')}</div>
            <button type="button" class="wk-own" data-add-at="0"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>自分でステップを組む</button></div>`}
        <div class="wk-card"><div class="field"><span class="lbl">メモ (任意)</span><input name="notes" value="${esc(st.notes)}" placeholder="気をつけたいこと など"></div></div>
        ${p.id ? '<button type="button" class="danger wide" data-act="del">この計画を削除</button>' : ''}
      </div>`;
    };

    // ---------------- ステップを選ぶ
    const addHtml = () => `${header('ステップを選ぶ', ['list', 'キャンセル'], null)}
      <div class="wk-body"><div class="wk-grid">${Object.keys(STEP_KINDS).map((k) => {
        const sp = mkStep[k]();
        return `<button type="button" class="wk-kind" data-kind="${k}" style="--kc:${KIND_COLOR[k]}"><b>${STEP_KINDS[k]}</b><span class="muted">${esc(subLine(sp))}</span><i></i></button>`;
      }).join('')}</div></div>`;

    // ---------------- ステップ編集
    const row = (key, label, value, body) => `<div class="wk-rowwrap"><button type="button" class="wk-row ${openRow === key ? 'open' : ''}" data-row="${key}"><span>${label}</span><span class="v" data-val="${key}">${value}</span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></button>${openRow === key ? `<div class="wk-open">${body}</div>` : ''}</div>`;
    const targetRows = (sp, part, i) => {
      const t = partOf(sp, part);
      const k = (s) => `${part}:${s}`;
      const rows = [
        row(k('by'), '目標タイプ', t.by === 'dist' ? '距離' : '時間', `<div class="chips">${chip('data-sby', `${part}:dist`, '距離', t.by === 'dist')}${chip('data-sby', `${part}:time`, '時間', t.by === 'time')}</div>`),
        row(k('val'), '目標', fmtTarget(t), stp(`val:${part}`, `<button type="button" class="wk-pick" data-wheel="val:${part}">${fmtTarget(t)}<small>タップして細かく選ぶ</small></button>`)),
      ];
      if (!(sp.kind === 'rest' || (sp.kind === 'interval' && part === 'rest'))) {
        const b = bandOf(t);
        rows.push(row(k('pace'), 'ペース範囲', paceText(t), `
          <div class="chips">${Object.entries(REFS).map(([r, R]) => chip('data-sref', `${part}:${r}`, `${R.label}ペース`, t.ref === r && !(t.pmin && t.pmax))).join('')}</div>
          <div class="chips">${ZONES.map((Z, z) => chip('data-szone', `${part}:${z}`, Z.short, !t.ref && !(t.pmin && t.pmax) && t.zone === z)).join('')}</div>
          ${stp(`pshift:${part}`, `<div class="wk-pick2"><button type="button" class="wk-pick" data-wheel="pmin:${part}"><small>速い側</small>${pace(Math.round(b[0]))}</button><button type="button" class="wk-pick" data-wheel="pmax:${part}"><small>遅い側</small>${pace(Math.round(b[1]))}</button></div>`)}
          <p class="muted" style="margin:0;font-size:12px;text-align:center">−/＋ で範囲ごと 5 秒ずつ (− が速く)</p>`));
      }
      return rows.join('');
    };
    const stepHtml = () => {
      const i = scr.i, sp = st.steps[i];
      if (!sp) return listHtml();
      const kindRow = sp.kind === 'interval' ? '' : row('kind', 'ステップ', STEP_KINDS[sp.kind], `<div class="chips">${['warmup', 'work', 'rest', 'cooldown'].map((k) => chip('data-skind', k, STEP_KINDS[k], sp.kind === k)).join('')}</div>`);
      const body = sp.kind === 'interval'
        ? `${row('reps', '本数', `${sp.reps}本`, stp('reps', `<button type="button" class="wk-pick" data-wheel="reps">${sp.reps}本<small>タップして細かく選ぶ</small></button>`))}
           <div class="wk-sub">走る</div><div class="wk-group">${targetRows(sp, 'work', i)}</div>
           <div class="wk-sub">休憩</div><div class="wk-group">${targetRows(sp, 'rest', i)}</div>`
        : `<div class="wk-group">${kindRow}</div><div class="wk-group">${targetRows(sp, '', i)}</div>`;
      return `${header(`${i + 1} ${STEP_KINDS[sp.kind]}`, ['list', '‹ 戻る'], ['list', '完了'])}<div class="wk-body">${body}
        <button type="button" class="danger wide" data-sdel="${i}">このステップを削除</button></div>`;
    };

    const render = () => {
      root.innerHTML = scr.name === 'add' ? addHtml() : scr.name === 'step' ? stepHtml() : listHtml();
      // ステップ編集中は開いている行へスクロール
    };

    // ---------------- 並べ替え (⠿ をつかんで上下)
    const startDrag = (e, i) => {
      const cards = [...root.querySelectorAll('.wk-step')];
      const el = cards[i];
      const rects = cards.map((c) => c.getBoundingClientRect());
      const y0 = e.clientY;
      el.classList.add('drag');
      el.setPointerCapture(e.pointerId);
      let to = i;
      const move = (ev) => {
        const dy = ev.clientY - y0;
        el.style.transform = `translateY(${dy}px)`;
        const mid = rects[i].top + rects[i].height / 2 + dy;
        to = rects.findIndex((r) => mid < r.top + r.height);
        if (to < 0) to = rects.length - 1;
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        if (to !== i) { const [m] = st.steps.splice(i, 1); st.steps.splice(to, 0, m); }
        render();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    };
    root.addEventListener('pointerdown', (e) => {
      const g = e.target.closest('[data-grip]');
      if (g) { e.preventDefault(); startDrag(e, Number(g.dataset.grip)); }
    });

    // ---------------- 保存
    const save = async () => {
      let stepKm = null;
      if (st.steps.length && st.type !== 'rest') {
        stepKm = Math.round(stepsTotalM(st.steps));
        const main = st.steps.find((x) => x.kind === 'interval' || x.kind === 'work');
        if (main) { const band = bandOf(main.kind === 'interval' ? main.work : main); st.pmin = band[0]; st.pmax = band[1]; }
        // 評価で使えるように、各ステップのペース範囲を確定して保存する
        const freeze = (t) => { if (!(t.pmin && t.pmax)) { const bd = bandOf(t); t.pmin = Math.round(bd[0]); t.pmax = Math.round(bd[1]); } };
        st.steps.forEach((sp) => { if (sp.kind === 'interval') { freeze(sp.work); freeze(sp.rest); } else freeze(sp); });
      }
      const body = {
        steps: st.steps.length ? st.steps : null,
        date: st.date,
        type: st.type,
        distance_m: st.type === 'rest' ? null : stepKm ?? (st.km == null ? null : Math.round(st.km * 1000)),
        pace_min_s: st.pmin,
        pace_max_s: st.pmax,
        hr_max: p.hr_max ?? null,
        notes: st.notes,
      };
      try { await api(p.id ? `/plans/${p.id}` : '/plans', { method: p.id ? 'PUT' : 'POST', body }); } catch (e) { alert(e.message); return; }
      close(true);
      route();
    };

    // ---------------- クリック
    root.addEventListener('click', async (e) => {
      const t = e.target.closest('button');
      if (!t || !root.contains(t)) return;
      const d = t.dataset;
      const inp = root.querySelector('[name=notes]');
      if (inp) st.notes = inp.value;
      if (d.act === 'back') return close(null);
      if (d.act === 'save') return save();
      if (d.act === 'list') { scr = { name: 'list' }; openRow = null; return render(); }
      if (d.act === 'del') { if (confirm('削除しますか？')) { await api(`/plans/${p.id}`, { method: 'DELETE' }); close(null); route(); } return; }
      if (d.stp) {
        const [k, part, dir] = d.stp.split(':').length === 3 ? d.stp.split(':') : [d.stp.split(':')[0], '', d.stp.split(':')[1]];
        const sg = Number(dir);
        const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
        if (k === 'reps') { const sp = st.steps[scr.i]; sp.reps = clamp(sp.reps + sg, 1, 30); }
        else if (k === 'km') st.km = clamp(Math.round(((st.km ?? 10) + sg * 0.5) * 10) / 10, 0.5, 50);
        else if (k === 'prange') {
          const def = settings.paces?.[st.type] || { min: 300, max: 345 };
          st.pmin = clamp((st.pmin || def.min) + sg * 5, 150, 600); st.pmax = clamp((st.pmax || def.max) + sg * 5, 150, 600);
        } else {
          const tt = partOf(st.steps[scr.i], part);
          if (k === 'val') {
            if (tt.by === 'dist') { const v = tt.value; const inc = v < 400 || (v === 400 && sg < 0) ? 50 : v < 2000 || (v === 2000 && sg < 0) ? 100 : v < 10000 || (v === 10000 && sg < 0) ? 500 : 1000; tt.value = clamp(v + sg * inc, 50, 50000); }
            else { const v = tt.value; const inc = v < 300 || (v === 300 && sg < 0) ? 15 : v < 1200 || (v === 1200 && sg < 0) ? 30 : 60; tt.value = clamp(v + sg * inc, 15, 4 * 3600); }
          } else if (k === 'pshift') {
            const [lo, hi] = bandOf(tt);
            tt.pmin = clamp(Math.round(lo) + sg * 5, 150, 600); tt.pmax = clamp(Math.round(hi) + sg * 5, 150, 600); tt.ref = null;
          }
        }
      } else if (d.wheel) {
        const [k, part = ''] = d.wheel.split(':');
        if (k === 'reps') {
          const r = await wheelPick('本数', [{ items: range(1, 30), value: st.steps[scr.i].reps, unit: '本' }]);
          if (r) st.steps[scr.i].reps = r[0];
        } else if (k === 'prange') {
          const def = settings.paces?.[st.type] || { min: 300, max: 345 };
          const lo = st.pmin || def.min, hi = st.pmax || def.max;
          const sec = range(0, 59, (x) => String(x).padStart(2, '0'));
          const r = await wheelPick('ペース', [
            { items: range(2, 9), value: Math.floor(lo / 60), unit: ':' }, { items: sec, value: lo % 60, unit: '〜' },
            { items: range(2, 9), value: Math.floor(hi / 60), unit: ':' }, { items: sec, value: hi % 60 },
          ]);
          if (r) { let a = r[0] * 60 + r[1], b = r[2] * 60 + r[3]; if (a > b) [a, b] = [b, a]; st.pmin = a; st.pmax = b; }
        } else if (k === 'km') {
          const m = await pickDist('距離', Math.round((st.km ?? 10) * 1000));
          if (m != null) { st.km = m / 1000; if (!st.steps.length) st.pmin = st.pmin; }
        } else {
          const tt = partOf(st.steps[scr.i], part);
          if (k === 'val') {
            const v = tt.by === 'dist' ? await pickDist('目標の距離', tt.value) : await pickTime('目標の時間', tt.value);
            if (v != null) tt.value = v;
          } else {
            const [lo, hi] = bandOf(tt);
            const v = await pickPace(k === 'pmin' ? '速い側のペース' : '遅い側のペース', k === 'pmin' ? lo : hi);
            if (v != null) { let a = k === 'pmin' ? v : lo, b = k === 'pmax' ? v : hi; if (a > b) { if (k === 'pmin') b = a; else a = b; } tt.pmin = Math.round(a); tt.pmax = Math.round(b); tt.ref = null; }
          }
        }
      } else if (d.pdef) { st.pmin = st.pmax = null; }
      else if (d.date) st.date = d.date;
      else if (d.type) {
        st.type = d.type;
        const PRE = { m: 'Mペース走', lt: 'LT走', interval: 'インターバル' };
        // M走・LT走・インターバルは、アップ → メイン → ダウン の形から組む (本数・距離・ペース・レストを設定できる)
        if (PRE[d.type] && !st.steps.length) st.steps = STEP_PRESETS[PRE[d.type]]();
        if (!st.steps.length) { st.km = d.type === 'rest' ? null : (PLAN_DEFAULT_KM[d.type] ?? st.km); st.pmin = st.pmax = null; } }
      else if (d.preset) st.steps = STEP_PRESETS[d.preset]();
      else if (d.addAt != null) { scr = { name: 'add', at: Number(d.addAt) }; }
      else if (d.kind) { st.steps.splice(scr.at, 0, mkStep[d.kind]()); scr = { name: 'step', i: scr.at }; openRow = null; }
      else if (d.edit != null) { scr = { name: 'step', i: Number(d.edit) }; openRow = null; }
      else if (d.row) openRow = openRow === d.row ? null : d.row;
      else if (d.sdel != null) { st.steps.splice(Number(d.sdel), 1); scr = { name: 'list' }; }
      else if (d.skind) { st.steps[scr.i].kind = d.skind; if (d.skind === 'rest') { st.steps[scr.i].by = 'time'; } }
      else if (d.sby || d.sref || d.szone) {
        const [part, v] = (d.sby || d.sref || d.szone).split(':');
        const tt = partOf(st.steps[scr.i], part);
        if (d.sby) { if (tt.by !== v) { tt.by = v; tt.value = v === 'dist' ? 1000 : 120; } }
        else if (d.sref) { tt.ref = v; tt.zone = REFS[v].zone; delete tt.pmin; delete tt.pmax; }
        else { tt.zone = Number(v); tt.ref = null; delete tt.pmin; delete tt.pmax; }
      } else return;
      render();
    });

    // ---------------- スライダー (ドラッグ中は作り直さず、数字だけ更新)
    root.addEventListener('input', (e) => {
      const r = e.target.closest('[data-rng]');
      if (!r) return;
      const [k, part = ''] = r.dataset.rng.split(':');
      const v = Number(r.value);
      const setVal = (key, text) => { const el = root.querySelector(`[data-val="${key}"]`); if (el) el.textContent = text; };
      if (k === 'km') { st.km = v; root.querySelector('#km-out').innerHTML = `${v.toFixed(1)} <small>km</small>`; return; }
      if (k === 'pace') {
        const def = settings.paces?.[st.type];
        if (!def) return;
        if (v === 0) st.pmin = st.pmax = null; else { st.pmin = def.min + v; st.pmax = def.max + v; }
        root.querySelector('#pace-out').textContent = st.pmin ? `${pace(st.pmin)}〜${pace(st.pmax)}` : `標準 ${pace(def.min)}〜${pace(def.max)}`;
        return;
      }
      const sp = st.steps[scr.i];
      if (k === 'reps') { sp.reps = v; setVal('reps', `${v}本`); return; }
      const tt = partOf(sp, part);
      if (k === 'sval') { tt.value = tt.by === 'dist' ? Math.round(v * 1000) : v; setVal(`${part}:val`, fmtTarget(tt)); }
      else if (k === 'spmin' || k === 'spmax') {
        const [lo, hi] = bandOf(tt);
        let a = k === 'spmin' ? v : lo, b = k === 'spmax' ? v : hi;
        if (a > b) { if (k === 'spmin') b = a; else a = b; }
        tt.pmin = a; tt.pmax = b; tt.ref = null;
        setVal(`${part}:pace`, paceText(tt));
        root.querySelectorAll('[data-rng^="spmin"]').forEach((x) => (x.value = a));
        root.querySelectorAll('[data-rng^="spmax"]').forEach((x) => (x.value = b));
      }
    });

    render();
  });
}

// 計画ダイアログで種別に応じた既定ペースを表示
dialog.addEventListener('change', (e) => e.target.id === 'plan-type' && updatePaceHint());
let cachedSettings = null;
async function updatePaceHint() {
  const sel = document.getElementById('plan-type');
  const hint = document.getElementById('pace-hint');
  if (!sel || !hint) return;
  cachedSettings ??= await api('/settings');
  const band = cachedSettings.paces[sel.value];
  hint.textContent = band ? `既定: ${pace(band.min)}-${pace(band.max)}/km (空欄なら既定値で評価)` : '';
}
new MutationObserver(() => dialog.open && updatePaceHint()).observe(dialog, { attributes: true, attributeFilter: ['open'] });

// ---- 実績

/** Strava 風: 日ごとの距離を丸の大きさで表示 */
function bubbles(days, linkBase) {
  const max = Math.max(10, ...days.map((d) => d.km));
  return `<div class="bubbles">${days.map((d) => {
    const size = d.km ? 26 + (d.km / max) * 34 : 6;
    return `<a class="bub" href="#/activities?view=day&date=${d.date}"><span class="dot" style="width:${size}px;height:${size}px">${d.km ? d.km.toFixed(1) : ''}${d.runs > 1 ? `<i>${d.runs}</i>` : ''}</span><small>${dow(d.date)}</small></a>`;
  }).join('')}</div>`;
}

/** 過去12週間の距離 (面グラフ)。タップ / なぞると週を選び、下の行からその週へ飛べる */
function trendChart(rows, selWeek) {
  const W = 320, H = 120, pad = 8, top = 26;
  const max = Math.max(60, ...rows.map((r) => r.km)) * 1.05;
  const pts = rows.map((r, i) => [pad + (i * (W - pad * 2)) / (rows.length - 1), H - pad - (r.km / max) * (H - pad - top)]);
  const line = pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' ');
  const last = pts[pts.length - 1];
  let sel = rows.findIndex((r) => r.week === selWeek);
  if (sel < 0) sel = rows.length - 1;
  const data = esc(JSON.stringify({ rows, pts: pts.map((p) => p.map((v) => +v.toFixed(1))), W, H }));
  return `<div class="trend-wrap" data-trend="${data}" data-sel="${sel}">
    <svg viewBox="0 0 ${W} ${H}" class="trend">
      <polygon points="${pad},${H - pad} ${line} ${last[0].toFixed(1)},${H - pad}" class="area"/><polyline points="${line}" class="ln"/>
      ${pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5"/>`).join('')}
      <g class="tr-cur"><line class="tr-v" y1="${top - 4}" y2="${H - pad}"/><circle class="tr-dot" r="5"/><g class="tr-tag"><rect rx="5" height="18"/><text text-anchor="middle"></text></g></g>
      <rect class="tr-hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
    </svg>
    <div class="row spread muted num tr-ax"><span>${md(rows[0].week)}</span><span>最高 ${Math.max(...rows.map((r) => r.km)).toFixed(0)}km/週</span><span>今週</span></div>
    <a class="tr-row" href="#"><span class="tr-ic"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg></span><span class="tr-txt"><b></b><small></small></span><span class="tr-go">›</span></a>
  </div>`;
}

/** 過去12週間グラフの選択操作 (タップ・なぞり) */
function bindTrend(root) {
  root.querySelectorAll('.trend-wrap').forEach((wrap) => {
    const { rows, pts, W } = JSON.parse(wrap.dataset.trend);
    const svg = wrap.querySelector('svg');
    const g = wrap.querySelector('.tr-cur');
    const set = (i) => {
      const [x, y] = pts[i], r = rows[i];
      g.querySelector('.tr-v').setAttribute('x1', x); g.querySelector('.tr-v').setAttribute('x2', x);
      const dot = g.querySelector('.tr-dot'); dot.setAttribute('cx', x); dot.setAttribute('cy', y);
      const label = `${r.km}km`, w = label.length * 7 + 12;
      const tx = Math.min(W - w / 2 - 1, Math.max(w / 2 + 1, x));
      const rect = g.querySelector('rect'); rect.setAttribute('x', tx - w / 2); rect.setAttribute('y', 2); rect.setAttribute('width', w);
      const t = g.querySelector('text'); t.setAttribute('x', tx); t.setAttribute('y', 15); t.textContent = label;
      const end = addDays(r.week, 6);
      const row = wrap.querySelector('.tr-row');
      row.href = `#/activities?view=week&date=${r.week}`;
      row.querySelector('b').textContent = `${md(r.week)} 〜 ${md(end)}${i === rows.length - 1 ? ' (今週)' : ''}`;
      row.querySelector('small').textContent = `${r.km}km${r.runs != null ? `・${r.runs}回` : ''}・この週を開く`;
      wrap.dataset.sel = i;
    };
    const pick = (e) => {
      const b = svg.getBoundingClientRect();
      const x = ((e.clientX - b.left) / b.width) * W;
      let best = 0;
      pts.forEach((p, i) => { if (Math.abs(p[0] - x) < Math.abs(pts[best][0] - x)) best = i; });
      if (String(best) !== wrap.dataset.sel) set(best);
    };
    let down = false;
    svg.addEventListener('pointerdown', (e) => { down = true; pick(e); });
    svg.addEventListener('pointermove', (e) => { if (down) pick(e); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => svg.addEventListener(t, () => { down = false; }));
    svg.style.touchAction = 'pan-y';
    set(Number(wrap.dataset.sel));
  });
}

const REVIEW_TABS = [['list', '一覧'], ['day', '日'], ['week', '週'], ['month', '月']];

function periodOf(kind, anchor) {
  if (kind === 'day') return { from: anchor, to: anchor, label: `${ymd(anchor)}(${dow(anchor)})`, prev: addDays(anchor, -1), next: addDays(anchor, 1) };
  if (kind === 'week') {
    const ws = weekStart(anchor);
    return { from: ws, to: addDays(ws, 6), label: `${ymd(ws)} 〜 ${md(addDays(ws, 6))}`, prev: addDays(ws, -7), next: addDays(ws, 7) };
  }
  const y = Number(anchor.slice(0, 4)), m = Number(anchor.slice(5, 7));
  const first = `${anchor.slice(0, 7)}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  return { from: first, to: last, label: `${y}年${m}月`, prev, next };
}

const GRADE_NOTE = { A: '狙いどおり', B: '概ね良好', C: '要調整', D: '立て直し' };

/* ---------------- 実績: 一覧・日・週・月 (2026-11 指示書 v3.0 第3・4段階) ---------------- */
const ROLE_LABEL = { warmup: 'アップ', cooldown: 'ダウン', work: 'メイン' };
const typeOf = (a) => a.eff_type || a.type || a.plan_type || null;
const typeLabel = (t) => (t && PLAN_LABELS[t]) || 'フリー';
/** Easy の遅い側のペース (秒/km)。ロング走の中の M ペース区間を見分けるため (実績の画面を開いたときに設定から読む) */
let EASY_MIN = null;
/** 表示用の種類: ロング走の計画の M ペース区間は「ロング走 (Mペース)」 */
const runTypeLabel = (a) => {
  const t = typeOf(a), p = a.distance_m ? a.moving_time_s / (a.distance_m / 1000) : null;
  if (a.plan_type === 'long' && (t === 'm' || (a.role === 'work' && EASY_MIN && p && p < EASY_MIN - 10))) return 'ロング走 (Mペース)';
  return typeLabel(t);
};
/** 種類のまとまり (src/review.ts kindGroup と同じ) */
const kindOf = (t, role, kmv) => (role === 'warmup' || role === 'cooldown' ? 'link' : t === 'race' ? 'race' : ['m', 'lt', 'interval'].includes(t) ? 'point' : t === 'long' || kmv >= 20 ? 'long' : ['easy', 'jog'].includes(t) ? 'easy' : 'free');
const KIND_FILTER = [['all', 'すべて'], ['point', 'ポイント'], ['long', 'ロング'], ['easy', 'Easy/Jog'], ['race', 'レース']];
const RUN_IC = {
  point: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  long: '<path d="M3 17c4-8 8 4 12-4s4-6 6-6"/>',
  race: '<path d="M5 21V4h11l-2 4 2 4H5"/>',
  link: '<circle cx="8" cy="12" r="2.5"/><circle cx="16" cy="12" r="2.5"/>',
  easy: '<circle cx="13" cy="4" r="2"/><path d="M8 21l3-6 3 3v-6l-3-3-3 2M14 9l3 3h3"/>',
  free: '<circle cx="13" cy="4" r="2"/><path d="M8 21l3-6 3 3v-6l-3-3-3 2M14 9l3 3h3"/>',
};
const runIcon = (t, role, kmv) => { const k = kindOf(t, role, kmv); return `<i class="hl-ic" style="--tc:var(--c-${role === 'warmup' || role === 'cooldown' ? 'rest' : t || 'free'})"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${RUN_IC[k]}</svg></i>`; };
const scoreTag = (v) => (v == null ? '<span class="hl-sc muted">-</span>' : `<span class="hl-sc ${scoreCls(v)} num">${v}</span>`);
const navRow = (prevHref, label, nextHref, right = '') => `<div class="hl-nav"><a class="btn" href="${prevHref}" aria-label="前へ">‹</a><b>${label}</b><a class="btn" href="${nextHref}" aria-label="次へ">›</a>${right}</div>`;
const jClass = (v) => (v == null ? 'hold' : v >= 80 ? 'good' : v >= 60 ? 'ok' : 'bad');
const signed = (v, unit = '', dig = 0) => (v == null || !isFinite(v) ? '-' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(dig)}${unit}`);

/** 1 本のランの行 (一覧・日で共通) */
function runRow(a, main) {
  const t = typeOf(a), kmv = a.distance_m / 1000;
  const name = a.role ? `${ROLE_LABEL[a.role] ?? ''}${a.role === 'work' ? ` (${runTypeLabel(a)})` : ''}` : t ? runTypeLabel(a) : esc(a.name);
  return `<a class="hl-run ${main ? 'main' : ''}" href="#/activities/${a.id}">${runIcon(t, a.role, kmv)}
    <div class="hl-tx"><b>${name}${main && !a.role ? ' <small class="hl-main">メイン</small>' : ''}</b><small class="num">${km(a.distance_m, 2)}km・${pace(a.moving_time_s / kmv)}/km${a.avg_hr ? `・${Math.round(a.avg_hr)}bpm` : ''}</small></div>${scoreTag(a.score)}</a>`;
}
/** その日のメイン (アップ・ダウン以外で一番長いラン) */
const mainOf = (runs) => [...runs].filter((r) => r.role !== 'warmup' && r.role !== 'cooldown').sort((x, y) => y.distance_m - x.distance_m)[0] ?? null;

async function activitiesView(params) {
  const kind = params?.get('view') || 'list';
  if (EASY_MIN == null) EASY_MIN = (await api('/settings').catch(() => null))?.paces?.easy?.min ?? 0;
  const tabs = `<div class="seg">${REVIEW_TABS.map(([k, l]) => `<a href="#/activities${k === 'list' ? '' : `?view=${k}`}" class="${k === kind ? 'on' : ''}">${l}</a>`).join('')}</div>`;
  if (kind === 'list') return tabs + await histList(params);
  const anchor = params.get('date') || today();
  if (kind === 'day') return tabs + await histDay(anchor);
  if (kind === 'week') return tabs + await histWeek(anchor);
  return tabs + await histMonth(anchor);
}

/** 一覧: 記録を探す */
async function histList(params) {
  const acts = await api('/activities');
  const f = params.get('f') || 'all';
  const n = Number(params.get('n')) || 30;
  const t = today();
  const span = (a, b) => acts.filter((x) => x.date > addDays(t, a) && x.date <= addDays(t, b));
  const cur = span(-7, 0), prv = span(-14, -7);
  const kmOf = (xs) => xs.reduce((s, x) => s + x.distance_m, 0) / 1000;
  const avgSc = (xs) => { const v = xs.filter((x) => x.role !== 'warmup' && x.role !== 'cooldown' && x.score != null); return v.length ? Math.round(v.reduce((s, x) => s + x.score, 0) / v.length) : null; };
  const k1 = kmOf(cur), k0 = kmOf(prv), s1 = avgSc(cur), s0 = avgSc(prv);
  const tile = (label, v, sub) => `<div class="hl-tile"><small>${label}</small><b class="num">${v}</b>${sub ? `<span class="num">${sub}</span>` : ''}</div>`;
  // 日ごとにまとめる
  const days = [];
  for (const a of acts) { let d = days[days.length - 1]; if (!d || d.date !== a.date) { d = { date: a.date, runs: [] }; days.push(d); } d.runs.push(a); }
  for (const d of days) d.runs.sort((x, y) => String(x.start_date_local).localeCompare(String(y.start_date_local)));
  const shown = days.filter((d) => f === 'all' || d.runs.some((r) => kindOf(typeOf(r), r.role, r.distance_m / 1000) === f));
  const chips = `<div class="hl-chips">${KIND_FILTER.map(([k, l]) => `<a class="chip ${k === f ? 'on' : ''}" href="#/activities${k === 'all' ? '' : `?f=${k}`}">${l}</a>`).join('')}</div>`;
  const body = shown.slice(0, n).map((d) => {
    const m = mainOf(d.runs);
    const tot = d.runs.reduce((s, r) => s + r.distance_m, 0);
    // 1 本だけの日は 1 行に (日付つき)
    if (d.runs.length === 1) return `<div class="card hl-day one"><small class="hl-date">${md(d.date)}(${dow(d.date)})</small>${runRow(d.runs[0], false)}</div>`;
    return `<div class="card hl-day"><a class="hl-dh" href="#/activities?view=day&date=${d.date}"><b>${md(d.date)}(${dow(d.date)})</b><span class="num">${km(tot, 2)}km${d.runs.length > 1 ? `・${d.runs.length}本` : ''}</span><span class="hl-go">›</span></a>
      ${d.runs.map((r) => runRow(r, d.runs.length > 1 && m && r.id === m.id)).join('')}</div>`;
  }).join('');
  return `<div class="card"><h2>ランニング履歴</h2><div class="hl-tiles">
      ${tile('距離・直近7日', `${k1.toFixed(1)}<small>km</small>`, k0 > 0 ? `${signed((k1 / k0 - 1) * 100, '%')} 前の7日比` : '')}
      ${tile('ラン回数', `${cur.length}<small>本</small>`, prv.length ? `前の7日 ${prv.length}本` : '')}
      ${tile('平均評価', s1 ?? '-', s0 != null && s1 != null ? `${signed(s1 - s0)} 前の7日比` : 'メインのランの点')}
    </div></div>${chips}
    ${shown.length ? body : '<div class="card"><p class="muted">この条件の記録はありません。</p></div>'}
    ${shown.length > n ? `<a class="btn wide" href="#/activities?${f !== 'all' ? `f=${f}&` : ''}n=${n + 30}">もっと見る (残り ${shown.length - n} 日)</a>` : ''}`;
}

/** 日: その日の走りを理解する */
async function histDay(d) {
  const r = await api(`/review?from=${d}&to=${d}&kind=day`);
  const runs = [...r.list].reverse();
  const m = mainOf(runs);
  const [ev, an, rv] = m ? await Promise.all([api(`/activities/${m.id}`).catch(() => null), api(`/activities/${m.id}/analysis`).catch(() => null), api(`/activities/${m.id}/review`).catch(() => null)]) : [null, null, null];
  const nav = navRow(`#/activities?view=day&date=${addDays(d, -1)}`, `${md(d)}(${dow(d)})`, `#/activities?view=day&date=${addDays(d, 1)}`);
  if (!runs.length) return `${nav}<div class="card"><h2>この日の記録はありません</h2>${r.planned_km ? `<p class="muted">計画 ${r.planned_km}km</p>` : ''}</div>`;
  const pct = r.planned_km ? Math.round((r.km / r.planned_km) * 100) : null;
  let h = `${nav}<div class="card hl-sum">
    <div class="hl-sum-top"><div><small class="muted">日次評価</small>${r.grade ? `<div class="grade g${r.grade}">${r.grade}<small class="num">${r.grade_calc?.pts ?? ''}点</small></div>` : '<div class="grade gH">保留</div>'}</div>
      <div class="hl-big"><b class="num">${km(runs.reduce((x, y) => x + y.distance_m, 0), 2)}</b><small>km</small>${r.planned_km ? `<span class="muted num">計画 ${r.planned_km}km (${pct}%)</span>` : '<span class="muted">計画なし</span>'}</div></div>
    <div class="hl-tiles three"><div class="hl-tile"><small>ラン回数</small><b class="num">${r.runs}<small>本</small></b></div><div class="hl-tile"><small>合計時間</small><b class="num">${dur(r.time_s)}</b></div><div class="hl-tile"><small>負荷 (TL)</small><b class="num">${r.tl}</b></div></div>
    ${r.phase_note ? `<p class="rv-phase">${esc(r.phase_note)}</p>` : ''}</div>
    <h3 class="sect">この日の練習</h3><div class="card hl-day">${runs.map((x) => runRow(x, runs.length > 1 && m && x.id === m.id)).join('')}</div>`;
  // 評価対象 (メイン区間): 何を・どの根拠で評価したか
  const e = ev?.evaluation;
  if (m && e) {
    const pd = e.pace?.details || {};
    const totKm = m.distance_m / 1000;
    const secKm = e.section_km ?? pd.work_km ?? null;
    const by = e.role === 'work' ? ['計画のステップ (アップ・ダウンは別の記録)', 'good'] : e.section_km != null ? ['計画のステップ (この記録の中の区間)', 'good'] : secKm != null && secKm < totKm - 0.05 ? ['推定: 目標帯より 20 秒/km 以上遅い記録を除外 (メインの失速も除かれることがあるため参考)', 'ok'] : ['この記録の全体', 'good'];
    h += `<h3 class="sect">評価対象</h3><div class="card"><div class="hl-target"><div><small class="muted">評価した区間</small><b class="num">${secKm != null ? `${Number(secKm).toFixed(2)}km` : '-'}</b><span class="muted num">記録全体 ${totKm.toFixed(2)}km</span></div>
      <div><small class="muted">区間の平均</small><b class="num">${pd.avg_pace ? pace(pd.avg_pace) : '-'}<small>/km</small></b><span class="muted num">${pd.target ? `目標 ${esc(pd.target)}` : '目標なし'}</span></div>
      <div><small class="muted">目標帯に入った距離</small><b class="num">${pd.in_band_pct != null ? `${pd.in_band_pct}%` : '-'}</b><span class="muted num">${e.hr?.details?.avg_hr ? `心拍 ${e.hr.details.avg_hr}bpm` : ''}</span></div></div>
      <p class="hl-by"><span class="an-j j-${by[1]}">${by[1] === 'good' ? '根拠' : '参考'}</span>${esc(by[0])}</p></div>`;
  }
  // 主観とデータの照合
  if (m) {
    const fb = rv?.fb || {};
    const ft = (label, v) => `<div class="hl-tile"><small>${label}</small><b class="num">${v == null ? '-' : `${v}<small>/10</small>`}</b></div>`;
    const any = ['breath', 'leg', 'rpe', 'form'].some((k) => fb[k] != null);
    h += `<h3 class="sect">主観とデータの照合</h3><div class="card"><div class="hl-tiles four">${ft('呼吸', fb.breath)}${ft('脚の疲労', fb.leg)}${ft('きつさ', fb.rpe)}${ft('フォーム', fb.form)}</div>
      ${any ? (an?.subj || []).filter((x) => !/未入力/.test(x.text)).slice(0, 3).map((x) => `<p class="hl-p"><span class="an-j j-${x.kind === 'gap' ? 'bad' : x.kind === 'match' ? 'good' : 'ok'}">${x.kind === 'gap' ? 'ずれ' : x.kind === 'match' ? '一致' : '事実'}</span>${esc(x.text)}</p>`).join('') : `<p class="muted hl-p"><span>ふりかえりが未入力です。<a href="#/activities/${m.id}">ランの詳細</a>で入れると、ここに照合が出ます (未入力は 0 点にしません)。</span></p>`}</div>`;
  }
  // 良かった点・課題・次の一手
  if (an?.top) {
    h += `<h3 class="sect">まとめ</h3><div class="card an-top" style="margin:0 0 14px">
      <div><b>総合評価</b><p>${esc(an.top.overall)}</p></div><div><b>最も重要な発見</b><p>${esc(an.top.finding)}</p></div>${an.top.next ? `<div><b>次の一手</b><p>${esc(an.top.next)}</p></div>` : ''}
      ${an.good?.length || an.issues?.length ? `<div class="an-gi">${an.good.length ? `<div><b class="g">良かった点</b>${an.good.map((t) => `<p>${esc(t)}</p>`).join('')}</div>` : ''}${an.issues.length ? `<div><b class="b">課題</b>${an.issues.map((t) => `<p>${esc(t)}</p>`).join('')}</div>` : ''}</div>` : ''}</div>`;
  }
  h += `<details class="card rv-acc"><summary>採点の根拠</summary><div class="rv-acc-b">${(r.parts || []).map((x) => `<div class="an-it"><span class="an-j j-${jClass(x.score)}">${x.score ?? '保留'}</span><div><b>${esc(x.label)} <small class="muted">(重み ${x.weight})</small></b><small class="muted">${esc(x.reason)}</small></div></div>`).join('')}
    <p class="muted an-note">日次評価は、その日の練習全体 (アップ・メイン・ダウン) を、目的と大会までの日数もふまえて見たもの。メインの点数は練習達成度。</p>
    <ul class="bullets">${r.comments.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div></details>`;
  return h;
}

/** 週の距離の棒グラフ (実績の棒・計画の枠)。タップでその日へ */
function weekBars(days) {
  const W = 320, H = 150, top = 22, bot = 22, bw = 26;
  const max = Math.max(5, ...days.map((d) => Math.max(d.km, d.plan_km || 0))) * 1.1;
  const y = (v) => H - bot - (v / max) * (H - top - bot);
  const step = W / days.length;
  return `<svg viewBox="0 0 ${W} ${H}" class="wbars" role="img" aria-label="曜日ごとの距離">${days.map((d, i) => {
    const x = i * step + (step - bw) / 2;
    const t = d.main_type || 'free';
    const fut = d.date > today();
    return `<a href="#/activities?view=day&date=${d.date}">
      ${d.plan_km ? `<rect x="${x - 2}" y="${y(d.plan_km)}" width="${bw + 4}" height="${H - bot - y(d.plan_km)}" rx="5" class="wb-plan"/>` : ''}
      ${d.km ? `<rect x="${x}" y="${y(d.km)}" width="${bw}" height="${H - bot - y(d.km)}" rx="4" style="fill:var(--c-${t})"/><text x="${x + bw / 2}" y="${y(d.km) - 5}" class="wb-v">${d.km}</text>` : `<text x="${x + bw / 2}" y="${H - bot - 5}" class="wb-v muted">${fut ? '' : '–'}</text>`}
      <text x="${x + bw / 2}" y="${H - 6}" class="wb-d ${d.date === today() ? 'cur' : ''}">${dow(d.date)}</text></a>`;
  }).join('')}</svg><p class="muted wb-leg"><i class="wb-k plan"></i>計画 <i class="wb-k act"></i>実績 (色は練習の種類)</p>`;
}

/** 週: 練習を調整する */
async function histWeek(anchor) {
  const p = periodOf('week', anchor);
  const [r, cond, trend] = await Promise.all([api(`/review?from=${p.from}&to=${p.to}&kind=week`), api(`/condition?from=${p.from}&to=${p.to}`).catch(() => ({})), api('/trend?weeks=12').catch(() => null)]);
  const pv = r.prev_detail;
  const pct = r.planned_km ? Math.round((r.km / r.planned_km) * 100) : null;
  const long = r.breakdown?.find((x) => x.key === 'long')?.runs ?? 0;
  const tile = (label, v, sub = '') => `<div class="hl-tile"><small>${label}</small><b class="num">${v}</b>${sub ? `<span class="num">${sub}</span>` : ''}</div>`;
  // 量・強度・回復
  const P = Object.fromEntries((r.parts || []).map((x) => [x.key, x]));
  const cs = Object.values(cond || {});
  const avgC = (k) => { const v = cs.map((c) => c[k]).filter((x) => x != null); return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : null; };
  const maxPain = cs.map((c) => c.pain).filter((x) => x != null);
  const rows = [
    ['量', P.volume],
    ['強度 (ポイント練)', P.points],
    ['練習の質', P.quality],
    ['回復 (負荷の増え方)', P.load],
  ].filter(([, x]) => x);
  let h = `${navRow(`#/activities?view=week&date=${p.prev}`, p.label, `#/activities?view=week&date=${p.next}`)}
    <div class="card hl-sum"><div class="hl-sum-top"><div><small class="muted">週間走行距離</small><div class="hl-big"><b class="num">${r.km}</b><small>km</small></div>
      <span class="muted num">${r.delta_km_pct != null ? `前週比 ${signed(r.delta_km_pct, '%')}` : ''}</span></div>
      <div class="hl-plan"><small class="muted">計画</small><b class="num">${r.planned_km || '-'}${r.planned_km ? '<small>km</small>' : ''}</b>${pct != null ? `<span class="num ${pct > 115 ? 'over' : pct < 80 ? 'gap' : 'ok'}">${pct}%</span>` : ''}</div></div>
      ${weekBars(r.days)}
      <div class="hl-tiles four">${tile('ラン回数', `${r.runs}<small>回</small>`)}${tile('走った日', `${r.run_days}<small>日</small>`)}${tile('ポイント', r.quality.planned ? `${r.quality.done}/${r.quality.planned}` : `${r.breakdown?.find((x) => x.key === 'point')?.runs ?? 0}<small>回</small>`)}${tile('ロング', `${long}<small>回</small>`)}</div></div>
    <h3 class="sect">週評価${r.in_progress ? ' <small class="muted">(途中経過)</small>' : ''}</h3><div class="card">
      <div class="row spread"><b>量・強度・回復のバランス</b>${r.grade ? `<span class="grade g${r.grade}">${r.grade}<small class="num">${r.grade_calc?.pts}点</small></span>` : '<span class="grade gH">保留</span>'}</div>
      ${r.phase_note ? `<p class="rv-phase">${esc(r.phase_note)}</p>` : ''}
      <div class="an-items" style="margin-top:8px">${rows.map(([l, x]) => `<div class="an-it"><span class="an-j j-${jClass(x.score)}">${x.score ?? '保留'}</span><div><b>${l}</b><small class="muted">${esc(x.reason)}</small></div></div>`).join('')}</div>
      <p class="muted an-note">${r.in_progress ? 'まだ来ていない日の計画は、未達として数えていません。' : ''}「量」は計画の距離とのずれで採点します (±10% までは満点)。調整期・回復期は少なくても減点しません。</p></div>
    <h3 class="sect">先週からの変化</h3><div class="card"><div class="hl-tiles three">
      ${tile('距離', pv ? `${signed(r.km - pv.km, '', 1)}<small>km</small>` : '-', pv ? `先週 ${pv.km}km` : '先週の記録なし')}
      ${tile('平均ペース', pv?.avg_pace_s && r.avg_pace_s ? `${signed(Math.round(r.avg_pace_s - pv.avg_pace_s))}<small>秒/km</small>` : '-', pv?.avg_pace_s ? `先週 ${pace(pv.avg_pace_s)}/km` : '')}
      ${tile('平均心拍', pv?.avg_hr && r.avg_hr ? `${signed(r.avg_hr - pv.avg_hr)}<small>bpm</small>` : '-', pv?.avg_hr ? `先週 ${pv.avg_hr}bpm` : '')}
    </div><p class="muted an-note">平均ペース・心拍は、練習の中身 (ポイント練・ロング走の有無) で変わります。走力の変化は月の「成長分析」で、同じペース同士を比べて見ます。</p></div>
    <h3 class="sect">疲労・睡眠・痛み</h3><div class="card">${cs.length ? `<div class="hl-tiles four">${tile('脚の疲労', avgC('leg') ?? '-', '平均/10')}${tile('全身の疲労', avgC('fatigue') ?? '-', '平均/10')}${tile('睡眠', avgC('sleep') ?? '-', '平均/10')}${tile('痛み', maxPain.length ? Math.max(...maxPain) : '-', '最大/10')}</div><p class="muted an-note">朝の体調 ${cs.length} 日分。</p>` : '<p class="muted">この週の朝の体調は未入力です (ホームの「今朝の体調」から記録できます)。</p>'}</div>
    ${r.next_period?.length ? `<div class="card hl-next"><b>翌週への提案</b>${r.next_period.map((t) => `<p>${esc(t)}</p>`).join('')}</div>` : ''}
    <details class="card rv-acc"><summary>詳しく (コメント・過去12週・ラン)</summary><div class="rv-acc-b">
      <ul class="bullets">${r.comments.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      ${trend ? trendChart(trend, p.from) : ''}
      <div class="hl-day">${[...r.list].reverse().map((x) => runRow(x, false)).join('') || '<p class="muted">記録なし</p>'}</div></div></details>`;
  return h;
}

/** 月: 成長を確認する */
async function histMonth(anchor) {
  const p = periodOf('month', anchor);
  const mon = p.from.slice(0, 7);
  const [r, goal] = await Promise.all([api(`/review?from=${p.from}&to=${p.to}&kind=month`), api(`/goals/${mon}`).catch(() => ({ km: null }))]);
  const pv = r.prev_detail;
  const gpct = goal?.km ? Math.min(100, (r.km / goal.km) * 100) : null;
  const tile = (label, v, sub = '') => `<div class="hl-tile"><small>${label}</small><b class="num">${v}</b>${sub ? `<span class="num">${sub}</span>` : ''}</div>`;
  // カレンダー (月曜始まり)
  const first = p.from, lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const t = today();
  const cells = [...Array(lead).fill(null), ...r.days];
  const cal = `<div class="mcal">${['月', '火', '水', '木', '金', '土', '日'].map((x) => `<small>${x}</small>`).join('')}${cells.map((d) => d == null ? '<span></span>' : `<a href="#/activities?view=day&date=${d.date}" class="${d.km ? 'run' : ''} ${d.date > t ? 'fut' : ''} ${d.date === t ? 'cur' : ''}" style="${d.km ? `--tc:var(--c-${d.main_type || 'free'})` : ''}"><b>${Number(d.date.slice(8))}</b>${d.km ? `<i class="num">${d.km}</i>` : ''}</a>`).join('')}</div>
    <p class="muted wb-leg"><i class="wb-k act"></i>走った日 (色は練習の種類・数字は km)　<i class="wb-k fut"></i>未来の日</p>`;
  // 週ごとの距離
  const wk = new Map();
  for (const d of r.days) { const w = weekStart(d.date); wk.set(w, (wk.get(w) || 0) + d.km); }
  const wmax = Math.max(10, ...wk.values());
  const weeks = [...wk].map(([w, v]) => `<a class="mwk" href="#/activities?view=week&date=${w}"><span>${md(w < first ? first : w)}〜</span><i style="width:${(v / wmax) * 100}%"></i><b class="num">${v.toFixed(1)}km</b></a>`).join('');
  const bmax = Math.max(1, ...(r.breakdown || []).map((x) => x.km));
  return `${navRow(`#/activities?view=month&date=${p.prev}`, p.label, `#/activities?view=month&date=${p.next}`)}
    <div class="card hl-sum"><div class="hl-sum-top"><div><small class="muted">月間走行距離</small><div class="hl-big"><b class="num">${r.km}</b><small>km</small></div>
      <span class="muted num">${r.delta_km_pct != null && !r.in_progress ? `前月比 ${signed(r.delta_km_pct, '%')}` : pv ? `前月 ${pv.km}km` : ''}</span></div>
      <div class="hl-plan"><small class="muted">設定目標</small><b class="num">${goal?.km ? `${goal.km}<small>km</small>` : '-'}</b>${goal?.km ? `<span class="num">${Math.round((r.km / goal.km) * 100)}%</span>` : '<span class="muted">未設定</span>'}</div></div>
      ${gpct != null ? `<div class="gtrack hl-gt"><i class="ok" style="width:${gpct}%"></i></div>` : ''}
      ${r.in_progress ? `<p class="muted an-note">${md(t)} 時点の記録 (暫定)。月の途中なので、まだ来ていない日は未達として数えていません。</p>` : ''}
      <div class="hl-tiles three">${tile('ラン回数', `${r.runs}<small>本</small>`)}${tile('走った日', `${r.run_days}<small>日</small>`)}${tile('最長', `${r.longest_km}<small>km</small>`)}</div></div>
    <h3 class="sect">練習の内訳</h3><div class="card">${(r.breakdown || []).length ? (r.breakdown || []).map((x) => `<div class="mbk"><span>${esc(x.label)}</span><i style="width:${(x.km / bmax) * 100}%"></i><b class="num">${x.runs}回・${x.km}km</b></div>`).join('') : '<p class="muted">記録なし</p>'}</div>
    <h3 class="sect">今月の練習カレンダー</h3><div class="card">${cal}</div>
    <h3 class="sect">週ごとの距離</h3><div class="card">${weeks}</div>
    <h3 class="sect">月間の成長分析</h3><div class="card">
      ${(r.growth || []).map((g) => `<div class="an-it"><span class="an-j j-${g.trend === 'up' ? 'good' : g.trend === 'down' ? 'bad' : g.trend === 'same' ? 'ok' : 'hold'}">${{ up: '改善', down: '低下', same: '維持', hold: '保留' }[g.trend]}</span><div><b>${esc(g.label)}</b><span class="num">${g.trend === 'hold' ? '' : `今月 ${g.now}・前月 ${g.past} (${g.diff})`}</span><small class="muted">${esc(g.note)}</small></div></div>`).join('')}
      <div class="an-it"><span class="an-j j-hold">事実</span><div><b>ロング走・ポイント練</b><small class="muted">ロング走 ${r.breakdown?.find((x) => x.key === 'long')?.runs ?? 0} 回 (28km 以上 ${r.long_runs_28} 回)・ポイント練 ${r.breakdown?.find((x) => x.key === 'point')?.runs ?? 0} 回${r.quality.planned ? ` (計画 ${r.quality.planned} 回中 ${r.quality.done} 回)` : ''}</small></div></div>
      ${r.phase_note ? `<p class="rv-phase">${esc(r.phase_note)}</p>` : ''}</div>
    <details class="card rv-acc"><summary>月の評価 ${r.grade ? `${r.grade} (${r.grade_calc?.pts}点)` : '(保留)'}${r.in_progress ? '・暫定' : ''}</summary><div class="rv-acc-b">
      ${(r.parts || []).map((x) => `<div class="an-it"><span class="an-j j-${jClass(x.score)}">${x.score ?? '保留'}</span><div><b>${esc(x.label)} <small class="muted">(重み ${x.weight})</small></b><small class="muted">${esc(x.reason)}</small></div></div>`).join('')}
      <ul class="bullets">${r.comments.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      ${r.next_period?.length ? `<p><b>翌月への提案</b></p><ul class="bullets">${r.next_period.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}</div></details>`;
}

const HR_ZONES = [['Z1', '回復', '#98a0b3'], ['Z2', '有酸素持久力', '#16b57a'], ['Z3', '有酸素パワー', '#ffb800'], ['Z4', '乳酸閾値', '#ff8a1f'], ['Z5', '無酸素', '#e63946']];
/** 心拍ゾーンごとの時間割合を横棒で */
function zoneBars(zones) {
  return `<div class="zones">${HR_ZONES.map(([z, name, col], i) => {
    const v = Math.round(zones[i] ?? 0);
    return `<div class="zrow"><span class="zl"><b>${z}</b> ${name}</span><span class="zbar"><i style="width:${Math.max(v, v ? 2 : 0)}%;background:${col}"></i></span><span class="zv num">${v}%</span></div>`;
  }).join('')}</div>`;
}

/** 1km ごとのペース (線) と心拍 (線) を 1 枚のグラフに */
function splitChart(sp) {
  const pts = sp.map((x, i) => ({ i, p: x.pace_s, h: x.hr })).filter((x) => x.p);
  if (pts.length < 2) return '';
  const W = 340, H = 150, L = 38, R = 38, T = 14, B = 22;
  const px = (i) => L + (pts.length === 1 ? 0 : (i / (sp.length - 1)) * (W - L - R));
  const ps = pts.map((x) => x.p), pmin = Math.min(...ps) - 5, pmax = Math.max(...ps) + 5;
  const py = (v) => T + ((v - pmin) / (pmax - pmin)) * (H - T - B); // 速い = 上
  const hs = pts.filter((x) => x.h).map((x) => x.h);
  const hmin = hs.length ? Math.min(...hs) - 3 : 0, hmax = hs.length ? Math.max(...hs) + 3 : 1;
  const hy = (v) => H - B - ((v - hmin) / (hmax - hmin)) * (H - T - B);
  const line = (arr, f, col) => arr.length > 1 ? `<polyline fill="none" stroke="${col}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" points="${arr.map((x) => f(x)).join(' ')}"/>` : '';
  const paceLine = line(pts, (x) => `${px(x.i).toFixed(1)},${py(x.p).toFixed(1)}`, 'var(--accent)');
  const hrPts = pts.filter((x) => x.h);
  const hrLine = line(hrPts, (x) => `${px(x.i).toFixed(1)},${hy(x.h).toFixed(1)}`, '#ff4f7b');
  const dots = pts.map((x) => `<circle cx="${px(x.i).toFixed(1)}" cy="${py(x.p).toFixed(1)}" r="3" fill="var(--accent)"/>`).join('');
  const step = Math.ceil(sp.length / 8);
  const xl = sp.map((_, i) => (i % step === 0 || i === sp.length - 1 ? `<text x="${px(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${i + 1}</text>` : '')).join('');
  return `<div class="schart"><div class="legend"><span><i style="background:var(--accent)"></i>ペース (上ほど速い)</span>${hrPts.length > 1 ? '<span><i style="background:#ff4f7b"></i>心拍</span>' : ''}</div>
    <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="1kmごとのペースと心拍">
      <g class="ax"><text x="${L - 6}" y="${py(pmin + 5) + 4}" text-anchor="end">${pace(Math.round(pmin + 5))}</text><text x="${L - 6}" y="${py(pmax - 5) + 4}" text-anchor="end">${pace(Math.round(pmax - 5))}</text>
      ${hrPts.length > 1 ? `<text x="${W - R + 6}" y="${hy(hmax - 3) + 4}">${Math.round(hmax - 3)}</text><text x="${W - R + 6}" y="${hy(hmin + 3) + 4}">${Math.round(hmin + 3)}</text>` : ''}${xl}</g>
      <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="var(--line)"/>
      ${paceLine}${hrLine}${dots}</svg></div>`;
}


const PACE_ZONES = [['リカバリー', '#8fa3d9'], ['有酸素持久力', '#2fb7c9'], ['有酸素パワー', '#16b57a'], ['乳酸閾値', '#ffb800'], ['無酸素持久力', '#ff8a1f'], ['無酸素パワー', '#e63946']];
const mmss = (x) => { const sec = Math.round(x); return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`; }; // 先に丸める (4:60 にしない)

/** COROS 風の面グラフ。vals と d(km) は同じ長さ。invert=true は小さいほど上 (ペース) */
function areaChart(vals, d, total, o) {
  const pts = vals.map((v, i) => ({ v, x: d[i] })).filter((p) => p.v != null);
  if (pts.length < 3) return '';
  const W = 340, H = 140, L = 42, R = 8, T = 10, B = 22;
  const sorted = pts.map((p) => p.v).sort((a, b) => a - b);
  let lo = sorted[Math.floor(sorted.length * 0.02)], hi = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.98) - 1)];
  if (o.min != null) lo = Math.min(lo, o.min);
  if (hi - lo < (o.minSpan || 4)) { const m = (hi + lo) / 2; lo = m - (o.minSpan || 4) / 2; hi = m + (o.minSpan || 4) / 2; }
  const padv = (hi - lo) * 0.12; lo -= padv; hi += padv;
  const clamp = (v) => Math.min(hi, Math.max(lo, v));
  const X = (x) => L + (x / Math.max(0.1, total)) * (W - L - R);
  const Y = (v) => { const r = (clamp(v) - lo) / (hi - lo); return T + (o.invert ? r : 1 - r) * (H - T - B); };
  const line = pts.map((p) => `${X(p.x).toFixed(1)},${Y(p.v).toFixed(1)}`);
  const base = H - B;
  const area = `M${X(pts[0].x).toFixed(1)},${base} L${line.join(' L')} L${X(pts[pts.length - 1].x).toFixed(1)},${base} Z`;
  const ticks = [0, 1, 2].map((k) => lo + ((hi - lo) * (k + 0.5)) / 3);
  const fmt = o.fmt || ((v) => Math.round(v));
  const yl = ticks.map((v) => `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="gl"/><text x="${L - 6}" y="${(Y(v) + 3).toFixed(1)}" text-anchor="end">${fmt(v)}</text>`).join('');
  const step = total > 14 ? 5 : total > 7 ? 2 : 1;
  let xl = '';
  for (let k = step; k < total; k += step) xl += `<text x="${X(k).toFixed(1)}" y="${H - 6}" text-anchor="middle">${k}${o.unit || 'km'}</text>`;
  const avg = o.avg != null ? `<line x1="${L}" x2="${W - R}" y1="${Y(o.avg).toFixed(1)}" y2="${Y(o.avg).toFixed(1)}" class="avgl"/>` : '';
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="achart" role="img" aria-label="${o.label || ''}"><g class="ax">${yl}${xl}</g>
    <path d="${area}" fill="${o.color}" fill-opacity=".28"/><polyline points="${line.join(' ')}" fill="none" stroke="${o.color}" stroke-width="1.6" stroke-linejoin="round"/>${avg}</svg>`;
}

/** ゾーンの表 (名前・範囲・割合の棒・時間) */
function zoneTable(names, ranges, secs) {
  const tot = secs.reduce((a, b) => a + b, 0) || 1;
  return `<div class="ztab">${secs.map((sec, i) => {
    const pc = Math.round((sec / tot) * 100);
    return `<div class="zt-row"><span class="zt-n">${names[i][0]}</span><span class="zt-r num">${ranges[i]}</span><span class="zt-b"><i style="width:${Math.max(pc, pc ? 3 : 0)}%;background:${names[i][1]}"></i></span><span class="zt-p num">${pc}%</span><span class="zt-t num">${mmss(sec)}</span></div>`;
  }).reverse().join('')}</div>`;
}

function seriesCards(sr) {
  const tk = sr.dist_m / 1000;
  const pb = sr.pace_bounds, hb = sr.hr_bounds;
  const pr = [`>${pace(pb[0])}`, ...[1, 2, 3, 4].map((i) => `${pace(pb[i] + 1)}–${pace(pb[i - 1])}`), `<${pace(pb[4])}`];
  const hr = [`<${hb[0]}`, ...[1, 2, 3, 4].map((i) => `${hb[i - 1]}–${hb[i] - 1}`), `>${hb[4] - 1}`];
  const head = (title, a, b) => `<div class="row spread ch-h"><h2>${title}</h2><div class="ch-s num">${a || ''}${b ? `<br>${b}` : ''}</div></div>`;
  const out = [];
  out.push(`<div class="card ch">${head('ペース', sr.fast_km_s ? `最速(1km) <b>${pace(sr.fast_km_s)}</b>` : '', sr.avg.pace ? `平均 <b>${pace(sr.avg.pace)}</b>` : '')}
    ${areaChart(sr.pace, sr.d, tk, { color: '#f4b400', invert: true, fmt: (v) => pace(Math.round(v)), avg: sr.avg.pace, minSpan: 20, label: 'ペース' })}
    ${zoneTable(PACE_ZONES, pr, sr.pace_zone_s)}</div>`);
  if (sr.hr.some((v) => v)) out.push(`<div class="card ch">${head('心拍数 (bpm)', sr.max.hr ? `最大 <b>${sr.max.hr}</b>` : '', sr.avg.hr ? `平均 <b>${sr.avg.hr}</b>` : '')}
    ${areaChart(sr.hr, sr.d, tk, { color: '#ff4f7b', avg: sr.avg.hr, minSpan: 20, label: '心拍' })}
    ${zoneTable(PACE_ZONES, hr, sr.hr_zone_s)}</div>`);
  if (sr.cad.some((v) => v)) out.push(`<div class="card ch">${head('ピッチ (spm)', sr.max.cad ? `最大 <b>${sr.max.cad}</b>` : '', sr.avg.cad ? `平均 <b>${sr.avg.cad}</b>` : '')}
    ${areaChart(sr.cad, sr.d, tk, { color: '#ff8a1f', avg: sr.avg.cad, minSpan: 16, label: 'ピッチ' })}</div>`);
  if (sr.stride.some((v) => v)) out.push(`<div class="card ch">${head('ストライド (cm)', '', sr.avg.stride ? `平均 <b>${sr.avg.stride}</b>` : '')}
    ${areaChart(sr.stride, sr.d, tk, { color: '#7a5cff', avg: sr.avg.stride, minSpan: 20, label: 'ストライド' })}</div>`);
  const X = sr.extra || {};
  const exCard = (k, title, color, span, unit = '') => (X[k]?.avg != null ? `<div class="card ch">${head(title, X[k].max != null && k === 'power' ? `最大 <b>${X[k].max}</b>` : '', `平均 <b>${X[k].avg}${unit}</b>`)}
    ${areaChart(X[k].vals, sr.d, tk, { color, avg: X[k].avg, minSpan: span, label: title })}</div>` : '');
  out.push(exCard('power', 'ランニングパワー (W)', '#e8622c', 40), exCard('gct', '接地時間 (ms)', '#2fd3c9', 30), exCard('vr', '垂直歩幅比 (%)', '#3ccf5a', 3), exCard('vo', '上下動 (cm)', '#f4c430', 3));
  if (sr.alt.some((v) => v != null)) out.push(`<div class="card ch">${head('標高 (m)', sr.alt_max != null ? `最大 <b>${sr.alt_max}</b> ・ 最小 <b>${sr.alt_min}</b>` : '', sr.elev_gain != null ? `上昇 <b>${Math.round(sr.elev_gain)}</b> ・ 下降 <b>${sr.elev_loss ?? '-'}</b>` : '')}
    ${areaChart(sr.alt, sr.d, tk, { color: '#2fb7c9', minSpan: 12, label: '標高' })}</div>`);
  return out.join('');
}

/** COROS ならではの カード: トレーニング効果 (有酸素・無酸素)・回復心拍 */
const TE_LABEL = (v) => (v < 1 ? 'なし' : v < 2 ? '軽い' : v < 3 ? '維持' : v < 4 ? '改善' : v < 5 ? '大きく改善' : '過負荷');
function teGauge(v, label, color) {
  const r = 46, c = Math.PI * r * 1.5, f = Math.max(0, Math.min(1, v / 5));
  return `<div class="te-g"><svg viewBox="0 0 120 108" width="130" height="117" aria-hidden="true"><g transform="rotate(135 60 60)">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="var(--line)" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c} ${2 * Math.PI * r}"/>
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="${color}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${c * f} ${2 * Math.PI * r}"/></g>
    <text x="60" y="64" text-anchor="middle" class="te-v">${v.toFixed(1)}</text><text x="60" y="84" text-anchor="middle" class="te-s">${TE_LABEL(v)}</text></svg><b>${label}</b></div>`;
}
function corosExtraCards(x) {
  if (!x) return '';
  const out = [];
  if (x.aerobic_te != null || x.anaerobic_te != null) {
    out.push(`<div class="card ch"><div class="row spread ch-h"><h2>トレーニング効果</h2>${x.training_load != null ? `<div class="ch-s num">負荷 <b>${x.training_load}</b></div>` : ''}</div>
      <div class="te-row">${x.aerobic_te != null ? teGauge(x.aerobic_te, '有酸素', '#16b57a') : ''}${x.anaerobic_te != null ? teGauge(x.anaerobic_te, '無酸素', '#4b6bff') : ''}</div></div>`);
  }
  if (Array.isArray(x.hr_recovery) && x.hr_recovery.length > 2) {
    const h = x.hr_recovery, first = h[0][1], at2 = (h.find((p) => p[0] >= 120) || h[h.length - 1])[1];
    const vals = h.map((p) => p[1]), ds = h.map((p) => Math.round((p[0] / 60) * 100) / 100);
    out.push(`<div class="card ch"><div class="row spread ch-h"><h2>回復心拍 (bpm)</h2><div class="ch-s num">止めた直後 <b>${first}</b><br>2 分で <b>−${first - at2}</b></div></div>
      ${areaChart(vals, ds, ds[ds.length - 1], { color: '#d63d9a', minSpan: 20, label: '回復心拍', unit: '分' })}</div>`);
  }
  return out.join('');
}

/** ペースと心拍を同じ距離の軸で重ねる (一定ペース区間に色をつける) */
function hrPaceChart(ch, steady) {
  if (!ch || !ch.d?.length) return '';
  const W = 340, H = 150, L = 34, R = 34, T = 10, B = 22;
  const tot = ch.d[ch.d.length - 1] || 1;
  const X = (x) => L + (x / tot) * (W - L - R);
  const ps = ch.pace.filter((v) => v != null).sort((a, b) => a - b), hs = ch.hr.filter((v) => v != null).sort((a, b) => a - b);
  if (ps.length < 5 || hs.length < 5) return '';
  const q = (a, f) => a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * f)))];
  let pl = q(ps, 0.03) - 5, ph = q(ps, 0.97) + 5, hl = q(hs, 0.03) - 5, hh = q(hs, 0.97) + 5;
  if (ph - pl < 30) { const m = (ph + pl) / 2; pl = m - 15; ph = m + 15; }
  const YP = (v) => T + ((Math.min(ph, Math.max(pl, v)) - pl) / (ph - pl)) * (H - T - B); // 速いほど上
  const YH = (v) => T + (1 - (Math.min(hh, Math.max(hl, v)) - hl) / (hh - hl)) * (H - T - B);
  const line = (vals, Y) => vals.map((v, k) => (v == null ? null : `${X(ch.d[k]).toFixed(1)},${Y(v).toFixed(1)}`)).filter(Boolean).join(' ');
  const band = steady ? `<rect x="${X(steady.from_km).toFixed(1)}" y="${T}" width="${(X(steady.to_km) - X(steady.from_km)).toFixed(1)}" height="${H - T - B}" fill="var(--accent)" opacity=".1"/>` : '';
  const step = tot > 14 ? 5 : tot > 7 ? 2 : 1;
  let xl = ''; for (let k = step; k < tot; k += step) xl += `<text x="${X(k).toFixed(1)}" y="${H - 6}" text-anchor="middle">${k}km</text>`;
  const yl = [0.2, 0.8].map((f) => { const pv = pl + (ph - pl) * f, hv = hh - (hh - hl) * f; const y = T + f * (H - T - B); return `<text x="${L - 4}" y="${y + 3}" text-anchor="end" fill="#f4b400">${pace(Math.round(pv))}</text><text x="${W - R + 4}" y="${y + 3}" fill="#ff4f7b">${Math.round(hv)}</text>`; }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" class="achart" role="img" aria-label="ペースと心拍"><g class="ax">${xl}${yl}</g>${band}
    <polyline points="${line(ch.pace, YP)}" fill="none" stroke="#f4b400" stroke-width="1.6"/><polyline points="${line(ch.hr, YH)}" fill="none" stroke="#ff4f7b" stroke-width="1.6"/></svg>
    <div class="hp-leg"><span><i style="background:#f4b400"></i>ペース (上ほど速い)</span><span><i style="background:#ff4f7b"></i>心拍</span>${steady ? '<span><i class="hp-band"></i>一定ペース区間</span>' : ''}</div>`;
}

/** この走りの評価: 練習達成度・走力評価・良かった点と課題・根拠・過去比較・ペースと心拍・フォーム */
function analysisHtml(an) {
  const J = { good: '良い', ok: '普通', bad: '課題', hold: '保留' };
  const tile = (title, x, sub) => `<div class="an-t"><small>${title}</small>${x.score != null ? `<b class="num">${x.score}</b>` : '<b class="an-hold">保留</b>'}<span class="muted">${sub}</span></div>`;
  const items = (arr) => `<div class="an-items">${arr.map((x) => `<div class="an-it"><span class="an-j j-${x.judge}">${J[x.judge]}</span><div><b>${esc(x.label)}</b><span class="num">${esc(x.value)}</span><small class="muted">${esc(x.reason)}</small></div></div>`).join('')}</div>`;
  const acc = (title, body, open = false) => `<details class="rv-acc" ${open ? 'open' : ''}><summary>${title}</summary><div class="rv-acc-b">${body}</div></details>`;
  const TR = { up: ['改善', 'good'], same: ['維持', 'ok'], down: ['低下', 'bad'], ref: ['参考', 'hold'], hold: ['保留', 'hold'] };
  const D = Object.fromEntries((an.defs || []).map((d) => [d.key, d.text]));
  const top = an.top;
  let h = `<div class="card an"><h2>この走りの評価</h2>
    <div class="an-tiles">${tile('練習達成度', an.achievement, '予定に対して')}${tile('走力評価', an.fitness, '走りの中身')}</div>
    ${top ? `<div class="an-top">
      <div><b>総合評価</b><p>${esc(top.overall)}</p></div>
      <div><b>最も重要な発見</b><p>${esc(top.finding)}</p></div>
      ${top.next ? `<div><b>次に活かすこと</b><p>${esc(top.next)}</p></div>` : ''}
    </div>` : an.summary ? `<p class="an-sum"><b>総評</b>${esc(an.summary)}</p>` : ''}
    <h3 class="an-dh">詳細分析</h3>`;
  if (an.ready) h += acc(`大会への準備 (${esc(an.ready.race)}・あと ${an.ready.days} 日)`, items(an.ready.rows) + `<p class="muted an-note">${esc(an.ready.note)}</p>`);
  if (an.overpace) h += acc('目標ペースより速かった影響', `<p>${esc(an.overpace.fact)}</p>${items(an.overpace.rows)}<p class="an-sum">${esc(an.overpace.verdict)}</p>`);
  if (an.good.length || an.issues.length || (an.next?.length > 1)) h += acc('良かった点・課題', `${an.good.length || an.issues.length ? `<div class="an-gi">${an.good.length ? `<div><b class="g">良かった点</b>${an.good.map((t) => `<p>${esc(t)}</p>`).join('')}</div>` : ''}${an.issues.length ? `<div><b class="b">課題</b>${an.issues.map((t) => `<p>${esc(t)}</p>`).join('')}</div>` : ''}</div>` : ''}${an.next?.length > 1 ? `<div class="an-next"><b>ほかに活かすこと</b>${an.next.slice(1).map((t) => `<p>${esc(t)}</p>`).join('')}</div>` : ''}`);
  if (an.subj?.length) h += acc('主観と数値の照らし合わせ', an.subj.map((x) => `<div class="an-it"><span class="an-j j-${x.kind === 'gap' ? 'bad' : x.kind === 'match' ? 'good' : 'ok'}">${x.kind === 'gap' ? 'ずれ' : x.kind === 'match' ? '一致' : '事実'}</span><div><span>${esc(x.text)}</span></div></div>`).join('') + '<p class="muted an-note">主観を点数に足すのではなく、数値と合っているか・ずれているかを見ます。「推測」と書いたものは可能性です。</p>');
  h += acc('評価の根拠', `<h4>練習達成度${an.achievement.score != null ? ` ${an.achievement.score}点` : ''}</h4>${D.ach ? `<p class="muted an-def">${esc(D.ach)}</p>` : ''}${an.achievement.hold_reason ? `<p class="muted">${esc(an.achievement.hold_reason)}</p>` : ''}${items(an.achievement.items)}
    <h4>走力評価${an.fitness.score != null ? ` ${an.fitness.score}点` : ''}</h4>${D.fit ? `<p class="muted an-def">${esc(D.fit)}</p>` : ''}${an.fitness.hold_reason ? `<p class="muted">${esc(an.fitness.hold_reason)}</p>` : ''}${items(an.fitness.items)}
    ${D.day ? `<h4>日次評価</h4><p class="muted an-def">${esc(D.day)}</p>` : ''}
    <p class="muted an-note">同じデータなら同じ点数になります。データが足りない項目・未入力のふりかえりは、数値にせず保留にしています (0 点や推測の値では埋めません)。</p>`);
  if (an.compare) h += acc(`過去との比較 (似たラン ${an.compare.n} 本)`, `<table class="an-cmp num"><tr><th></th><th>今回</th><th>過去</th><th>差</th><th></th></tr>${an.compare.metrics.map((m) => `<tr><td>${esc(m.label)}</td><td>${esc(m.now)}</td><td class="muted">${esc(m.past)}</td><td>${esc(m.diff)}</td><td><span class="an-j j-${TR[m.trend][1]}">${TR[m.trend][0]}</span></td></tr>`).join('')}</table>
    <p class="muted an-note">比べたラン: ${an.compare.runs.map((r) => `<a href="#/activities/${r.id}">${md(r.date)} ${r.km}km ${pace(r.pace)}${r.temp != null ? ` ${Math.round(r.temp)}℃` : ''}</a>`).join('・')}</p>${an.compare.notes.map((t) => `<p class="muted an-note">${esc(t)}</p>`).join('')}`);
  else h += acc('過去との比較', '<p class="muted">距離・ペース・種類が近い過去のランがまだ 2 本未満のため比較できません。ランが増えると自動で比べます。</p>');
  if (an.hrpace) h += acc('ペースと心拍', `${hrPaceChart(an.chart, an.hrpace.steady)}${an.hrpace.text.map((t) => `<p>${esc(t)}</p>`).join('')}`);
  if (an.form && an.form.rows.length) h += acc('フォームの前半・後半', `<table class="an-cmp num"><tr><th></th><th>前半</th><th>後半</th><th>差</th></tr>${an.form.rows.map((r) => `<tr class="${r.flag ? 'flag' : ''}"><td>${r.label}</td><td>${r.first}</td><td>${r.second}</td><td>${r.diff}</td></tr>`).join('')}</table>${an.form.text.map((t) => `<p>${esc(t)}</p>`).join('')}`);
  if (an.basis?.length) h += acc('数値の出どころ', an.basis.map((t) => `<p class="muted an-note">${esc(t)}</p>`).join(''));
  return h + '</div>';
}

/** ラップ詳細 (1km ごと) */
function lapTable(sp) {
  const ps = sp.filter((x) => x.pace_s).map((x) => x.pace_s);
  const slow = Math.max(...ps), fast = Math.min(...ps);
  return `<table class="num lap"><tr><th>km</th><th>距離</th><th>時間</th><th>ペース</th><th></th><th>心拍</th></tr>${sp.map((x, i) => `<tr class="${x.pace_s === fast ? 'best' : ''}"><td>${i + 1}</td><td>${x.km.toFixed(2)}</td><td>${x.time_s ? mmss(x.time_s) : '-'}</td><td><b>${x.pace_s ? pace(x.pace_s) : '-'}</b></td><td><span class="sbar" style="width:${x.pace_s ? 25 + ((slow - x.pace_s) / Math.max(1, slow - fast)) * 75 : 0}%"></span></td><td>${x.hr ?? '-'}</td></tr>`).join('')}</table>`;
}


/** ランのレビュー (文章+数字)。サーバーが組み立てた内容を表示する */
function reviewHtml(rv) {
  if (rv.main_id !== undefined) {
    const L = { warmup: 'アップ', cooldown: 'ダウン' }[rv.role];
    return `<div class="card rv"><h2>レビュー</h2><p class="muted">このランは ${L} です。評価はメインのランで見ます。</p>${rv.main_id ? `<a class="btn" href="#/activities/${rv.main_id}">メインのレビューを見る ›</a>` : ''}</div>`;
  }
  // 1 枚のカードに: 総合 → 各項目は見出しだけ (タップで開く)
  const ps = (arr) => arr.map((t) => `<p>${esc(t)}</p>`).join('');
  const acc = (title, body, open = false) => `<details class="rv-acc" ${open ? 'open' : ''}><summary>${esc(title)}</summary><div class="rv-acc-b">${body}</div></details>`;
  let h = `<div class="card rv"><h2>評価</h2>
    <div class="rv-top"><div><div class="rv-grade">${esc(rv.grade)}</div><span class="muted">${esc(rv.headline)}</span></div>
    ${rv.race ? `<div><span class="muted">${esc(rv.race.name)}</span><div class="rv-goal num">${esc(rv.race.goal)}</div><span class="muted">${rv.race.need_pace ? `必要ペース ${esc(rv.race.need_pace)}` : `大会${rv.race.days}日前のラン`}</span></div>` : ''}</div>
    <table class="rv-t num">${rv.rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
  if (rv.pace) {
    const n = rv.pace.laps.length;
    h += acc(`ペース: ${rv.pace.title}`, `
      ${areaChart(rv.pace.laps, rv.pace.laps.map((_, i) => i + 1), n, { color: '#4a90e2', invert: true, fmt: (v) => pace(Math.round(v)), avg: null, minSpan: 16, label: 'ラップ推移' })}
      <div class="rv-chips">${rv.pace.chips.map(([t, v, d]) => `<div><span class="muted">${esc(t)}</span><b class="num">${esc(v)}</b><span class="muted">${esc(d)}</span></div>`).join('')}</div>${ps(rv.pace.text)}`);
  }
  if (rv.hr) h += acc(`心拍: ${rv.hr.title}`, `<table class="rv-t num"><tr><th>区間</th><th>平均心拍</th></tr>${rv.hr.rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v}</td></tr>`).join('')}</table>${ps(rv.hr.text)}`);
  if (rv.form) h += acc(`フォーム: ${rv.form.title}`, `<div class="rv-chips">${rv.form.stats.map(([t, v, u]) => `<div><span class="muted">${esc(t)}</span><b class="num">${esc(v)}<small>${esc(u)}</small></b></div>`).join('')}</div>${ps(rv.form.text)}`);
  if (rv.verdict) h += acc(rv.verdict.title, `${ps(rv.verdict.text)}${rv.verdict.table.length ? `<table class="rv-t num"><tr><th>区間</th><th>推奨ペース</th></tr>${rv.verdict.table.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}`);
  h += '<div id="rv-score"></div></div>';
  return h;
}

const FB_SLIDERS = [
  ['breath', '呼吸のきつさ', '負担なし', '最大'],
  ['leg', '脚の疲労感', '負担なし', '最大'],
  ['rpe', '全体的なきつさ (RPE)', '負担なし', '最大'],
  ['form', 'フォームの自然さ', '不自然・力みがある', '自然・理想的'],
  ['pain', '痛みの強さ', 'なし', '最大'],
];
const FB_LATE = [['rpe_late', '後半のきつさ (RPE)', '負担なし', '最大'], ['leg_late', '後半の脚の疲労感', '負担なし', '最大']];
const PAIN_PARTS = ['足裏', 'かかと', 'アキレス腱', 'ふくらはぎ', 'すね', '足首', '膝', '太もも前', 'ハムストリング', '股関節', 'お尻', '腰', 'その他'];
const FB_RESERVE = [['limit', 'ほぼ限界'], ['1-3', '1〜3km'], ['3-5', '3〜5km'], ['5-10', '5〜10km'], ['10+', '10km以上']];
const FB_TAG = [['hot', '暑い'], ['cold', '寒い'], ['wind', '風'], ['sleep', '睡眠不足'], ['hungry', '空腹・補給'], ['tired', '疲れが残っていた']];
const CLIP_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 13l2 2 4-4"/></svg>';
/** ふりかえり: 0〜10 のスライダー (タップでもなぞっても選べる)・余裕・メモ・コンディション */
function feedbackHtml(fb, notes) {
  const slider = ([k, title, lo, hi]) => {
    const v = fb[k];
    return `<div class="fs ${v == null ? 'unset' : ''}" data-k="${k}">
      <div class="fs-h"><b>${title}</b><span class="fs-v num"><em>${v ?? '–'}</em><small>/10</small></span></div>
      <div class="fs-track" style="--v:${v ?? 0}"><div class="fs-dots">${Array.from({ length: 11 }, () => '<i></i>').join('')}</div><div class="fs-thumb"></div></div>
      <div class="fs-l"><span>${lo}</span><span>${hi}</span></div></div>`;
  };
  return `<div class="card rv fbx"><div class="row spread"><h3>ふりかえり</h3><span class="fbx-ic">${CLIP_SVG}</span></div>
    <p class="muted fbx-sub">練習直後に 30 秒で。答えるとレビューに反映されます。</p>
    ${FB_SLIDERS.map(slider).join('')}
    <div class="fbx-q fbx-pain ${(fb.pain ?? 0) > 0 || (fb.pain_part || []).length ? '' : 'hidden'}"><b>痛む場所 <span class="muted">(複数可)</span></b>
      <div class="chips">${PAIN_PARTS.map((v) => `<button type="button" class="chip ${(fb.pain_part || []).includes(v) ? 'on' : ''}" data-pn="${v}">${v}</button>`).join('')}</div></div>
    <details class="fbx-late" ${fb.rpe_late != null || fb.leg_late != null ? 'open' : ''}><summary>前半と後半で分けて記録する <span class="muted">(任意)</span></summary>
      <p class="muted" style="font-size:12px;margin:4px 0 8px">上のきつさ・脚を「前半」として、後半だけを入れます。</p>${FB_LATE.map(slider).join('')}</details>
    <div class="fbx-q"><b>同じペースをあと何km続けられそう？</b>
      <div class="fbx-radio">${FB_RESERVE.map(([v, l]) => `<button type="button" class="rd ${fb.reserve === v ? 'on' : ''}" data-rs="${v}"><i></i>${l}</button>`).join('')}</div></div>
    <div class="fbx-q"><b>コンディション <span class="muted">(任意・複数可)</span></b>
      <div class="chips">${FB_TAG.map(([v, l]) => `<button type="button" class="chip ${(fb.tags || []).includes(v) ? 'on' : ''}" data-tg="${v}">${l}</button>`).join('')}</div></div>
    <div class="fbx-q"><b>特記事項 <span class="muted">(任意)</span></b>
      <textarea class="fbx-memo" rows="2" maxlength="500" placeholder="例: 9kmからゾーンに入った。へそ下を意識すると自然に加速。">${esc(fb.memo || '')}</textarea></div>
    <button type="button" class="fbx-save" disabled>この評価を保存<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
    <div id="fb-notes">${(notes || []).map((t) => `<p class="fb-note">${esc(t)}</p>`).join('')}</div></div>`;
}

/** 保存したふりかえりの表示 (スライダーは出さない。「修正」で入力に戻る) */
function feedbackSummary(fb, notes) {
  const SHORT = { breath: '呼吸', leg: '脚', rpe: 'きつさ', form: 'フォーム', pain: '痛み', rpe_late: '後半きつさ', leg_late: '後半の脚' };
  const items = [...FB_SLIDERS, ...FB_LATE].filter(([k]) => fb[k] != null).map(([k]) => `<div><span class="muted">${SHORT[k]}</span><b class="num">${fb[k]}<small>/10</small></b></div>`);
  if ((fb.pain_part || []).length) items.push(`<div><span class="muted">痛む場所</span><b class="fbs-rs">${fb.pain_part.map(esc).join('・')}</b></div>`);
  const rs = FB_RESERVE.find(([v]) => v === fb.reserve);
  if (rs) items.push(`<div><span class="muted">余裕</span><b class="num fbs-rs">あと${rs[1]}</b></div>`);
  const tags = FB_TAG.filter(([v]) => (fb.tags || []).includes(v)).map(([, l]) => `<span class="chip on mini">${l}</span>`).join('');
  return `<div class="card rv fbx"><div class="row spread"><h3>ふりかえり</h3><button type="button" class="chip" data-fb-edit>修正</button></div>
    <div class="fbs-grid">${items.join('')}</div>
    ${tags ? `<div class="chips mini" style="margin-top:8px">${tags}</div>` : ''}
    ${fb.memo ? `<p class="fbs-memo">${esc(fb.memo)}</p>` : ''}
    <div id="fb-notes">${(notes || []).map((t) => `<p class="fb-note">${esc(t)}</p>`).join('')}</div></div>`;
}
const hasFeedback = (fb) => [...FB_SLIDERS, ...FB_LATE].some(([k]) => fb[k] != null) || !!fb.reserve || (fb.tags || []).length > 0 || !!fb.memo;

/** ふりかえりの操作 (スライダー・選択・保存) */
function bindFeedback(fbox, state, onSave) {
  const save = fbox.querySelector('.fbx-save');
  const dirty = () => { save.disabled = false; save.firstChild.textContent = 'この評価を保存'; };
  fbox.querySelectorAll('.fs').forEach((el) => {
    const k = el.dataset.k, tr = el.querySelector('.fs-track');
    const setV = (v) => {
      if (state[k] === v && !el.classList.contains('unset')) return;
      state[k] = v; el.classList.remove('unset');
      tr.style.setProperty('--v', v); el.querySelector('em').textContent = v; dirty();
      if (k === 'pain') fbox.querySelector('.fbx-pain')?.classList.toggle('hidden', !(v > 0) && !(state.pain_part || []).length);
    };
    const at = (e) => {
      const r = tr.getBoundingClientRect(), th = 44;
      setV(Math.max(0, Math.min(10, Math.round(((e.clientX - r.left - th / 2) / (r.width - th)) * 10))));
    };
    let on = false;
    tr.addEventListener('pointerdown', (e) => { on = true; tr.setPointerCapture(e.pointerId); at(e); });
    tr.addEventListener('pointermove', (e) => { if (on) at(e); });
    ['pointerup', 'pointercancel'].forEach((t) => tr.addEventListener(t, () => { on = false; }));
  });
  fbox.querySelectorAll('[data-rs]').forEach((b) => (b.onclick = () => {
    state.reserve = state.reserve === b.dataset.rs ? null : b.dataset.rs;
    fbox.querySelectorAll('[data-rs]').forEach((x) => x.classList.toggle('on', x.dataset.rs === state.reserve)); dirty();
  }));
  fbox.querySelectorAll('[data-pn]').forEach((b) => (b.onclick = () => {
    const s = new Set(state.pain_part || []); s.has(b.dataset.pn) ? s.delete(b.dataset.pn) : s.add(b.dataset.pn); state.pain_part = [...s];
    b.classList.toggle('on', s.has(b.dataset.pn)); dirty();
  }));
  fbox.querySelectorAll('[data-tg]').forEach((b) => (b.onclick = () => {
    const s = new Set(state.tags); s.has(b.dataset.tg) ? s.delete(b.dataset.tg) : s.add(b.dataset.tg); state.tags = [...s];
    b.classList.toggle('on', s.has(b.dataset.tg)); dirty();
  }));
  fbox.querySelector('.fbx-memo').oninput = (e) => { state.memo = e.target.value; dirty(); };
  save.onclick = async () => {
    save.disabled = true; save.firstChild.textContent = '保存中…';
    try { await onSave(state); save.firstChild.textContent = '保存しました'; } catch (err) { alert(err.message); dirty(); }
  };
}

async function activityDetailView(id) {
  const [a, shoes] = await Promise.all([api(`/activities/${id}`), api('/shoes')]);
  const plans = await api(`/plans?from=${a.date}&to=${a.date}`);
  const ev = a.evaluation;
  const metric = (name, m, w) => `<div class="metric"><span>${name}${w ? `<small class="wt">配点 ${w}%</small>` : ''}</span>${scoreHtml(m?.score)}<span class="muted">${esc(m?.summary)}</span></div>`;
  const W = ev?.weights;
  const HOW = {
    pace: ['ペース', '計画のペース帯に入って走れた距離の割合と、帯からはみ出した秒数。1kmごとの安定、後半の失速も見ます。帯からの平均のはみ出しが0秒で満点、1秒/kmごとに約7点減ります。'],
    hr: ['心拍', '目標の心拍域に収まっていたか。一定ペースの練習では、後半に心拍が上がる「ドリフト」(2%以内なら満点) も見ます。'],
    cadence: ['ケイデンス', '後半までピッチを保てたか。理想値は人それぞれなので、決まった値 (180 など) との差では減点しません。後半に 2spm を超えて落ちた分だけ、1spm ごとに約8点減ります。'],
    form: ['フォーム', '歩幅とピッチのばらつき、後半に歩幅が縮んでいないか。'],
  };
  const howCard = (ev) => {
    if (!W) return '';
    const rows = ['pace', 'hr', 'cadence', 'form'].filter((k) => W[k] > 0 && ev[k]?.score != null).map((k) => `<tr><td><b>${HOW[k][0]}</b><div class="muted">${HOW[k][1]}</div></td><td class="num">${ev[k].score}</td><td class="num">${W[k]}%</td></tr>`).join('');
    return `<details class="how"><summary>この点数のつけ方</summary>
      <p class="muted">総合点は、上の各指標の点数を「配点」で重みづけした平均です。${ev.type === 'free' ? 'メニューが無いので、単独の走りの質(安定・心拍・ピッチ・フォーム)で採点します。' : `${esc(PLAN_LABELS[ev.type])}は、この練習の目的に合わせて配点を変えています。`}距離が計画に届かなくても点数は下がりません (評価は走りの質だけ)。</p>
      <table class="how-t"><tr><th>指標</th><th>点</th><th>配点</th></tr>${rows}</table>
      <p class="muted">目安: 90点以上 とても良い / 75点以上 良い / 60点以上 合格 / 60点未満 見直しが必要。</p></details>`;
  };

  setTimeout(() => {
    view.querySelectorAll('[data-pc]').forEach((b) => (b.onclick = async () => {
      if (b.classList.contains('on')) return;
      view.querySelectorAll('[data-pc]').forEach((x) => (x.disabled = true));
      b.insertAdjacentHTML('beforeend', '<small>切り替え中…</small>');
      const v = b.dataset.pc;
      try { await api(`/activities/${id}`, { method: 'PUT', body: { plan_id: v ? Number(v) : null } }); } catch (e) { alert(e.message); }
      route();
    }));
    view.querySelector('#shoe-open').onclick = () => {
      const list = shoes.filter((x) => x.retired !== 1);
      const sheet = document.createElement('div');
      sheet.className = 'sheet';
      sheet.innerHTML = `<div class="sheet-bg"></div><div class="sheet-body"><h2>マイ シューズ</h2>
        <div class="sheet-row">${list.map((x) => `<button type="button" class="sh-card ${a.shoe_id === x.id ? 'on' : ''}" data-sh="${x.id}"><div class="shoe-img big">${x.image ? `<img src="${x.image}" alt="">` : '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16v-3l4-1 2-3 3 2 4 1c3 .5 5 2 5 4v1H3z"/><path d="M3 19h18"/></svg>'}</div><b>${esc(shoeName(x))}</b><span class="muted num">${Math.round(x.total_km)}km</span></button>`).join('')}
        <button type="button" class="sh-card ${a.shoe_id == null ? 'on' : ''}" data-sh=""><div class="shoe-img big muted">なし</div><b>選ばない</b></button></div>
        <button type="button" class="sheet-close">閉じる</button></div>`;
      document.body.appendChild(sheet);
      const close = () => sheet.remove();
      sheet.querySelector('.sheet-bg').onclick = close;
      sheet.querySelector('.sheet-close').onclick = close;
      sheet.querySelectorAll('[data-sh]').forEach((b) => (b.onclick = async () => {
        close();
        try { await api(`/activities/${id}`, { method: 'PUT', body: { shoe_id: b.dataset.sh ? Number(b.dataset.sh) : null } }); } catch (e) { alert(e.message); }
        route();
      }));
    };
    api(`/activities/${id}/splits`).then((sp) => {
      const box = view.querySelector('#splits');
      if (!box || !Array.isArray(sp) || !sp.length) { if (box) box.innerHTML = '<span class="muted">取得できませんでした</span>'; return; }
      box.innerHTML = lapTable(sp);
    }).catch(() => {});
    // 点数の内訳 (配点・内訳・コメント) は、評価カードの中に折りたたんで入れる
    const scoreTpl = view.querySelector('#score-detail');
    const moveScore = () => { const slot = view.querySelector('#rv-score'); if (slot && scoreTpl) slot.innerHTML = scoreTpl.innerHTML; };
    const loadReview = () => api(`/activities/${id}/review`).then((rv) => {
      const box = view.querySelector('#review'), fbox = view.querySelector('#fb');
      if (!box || !rv || rv.error) { if (box) box.innerHTML = ''; return; }
      box.innerHTML = reviewHtml(rv);
      moveScore();
      if (rv.main_id !== undefined) { if (fbox) fbox.innerHTML = ''; return; }
      const st = { breath: null, leg: null, rpe: null, form: null, pain: null, reserve: null, memo: '', tags: [], pain_part: [], rpe_late: null, leg_late: null, ...(rv.fb || {}) };
      if (fbox) {
        let notes = rv.notes;
        const showSummary = () => {
          fbox.innerHTML = feedbackSummary(st, notes);
          fbox.querySelector('[data-fb-edit]').onclick = showForm;
        };
        const showForm = () => {
          // 入力中は下書きに書き、保存できたときだけ確定する (保存しないで離れても、保存済みの評価は変わらない)
          const draft = JSON.parse(JSON.stringify(st));
          fbox.innerHTML = feedbackHtml(draft, notes);
          if (hasFeedback(st)) {
            fbox.querySelector('.fbx h3')?.insertAdjacentHTML('afterend', '<button type="button" class="chip" data-fb-cancel>取り消し</button>');
            fbox.querySelector('[data-fb-cancel]').onclick = showSummary;
          }
          bindFeedback(fbox, draft, async (body) => {
            await api(`/activities/${id}/feedback`, { method: 'PUT', body });
            Object.assign(st, JSON.parse(JSON.stringify(body)));
            api(`/activities/${id}/analysis`).then((an) => { const box = view.querySelector('#analysis'); if (box && an && !an.error) box.innerHTML = analysisHtml(an); }).catch(() => {});
            const r2 = await api(`/activities/${id}/review`).catch(() => null);
            if (r2 && !r2.error && r2.main_id === undefined) {
              view.querySelector('#review').innerHTML = reviewHtml(r2);
              moveScore();
              notes = r2.notes;
            }
            showSummary();
          });
        };
        hasFeedback(st) ? showSummary() : showForm();
      }
    }).catch(() => { const box = view.querySelector('#review'); if (box) box.innerHTML = ''; });
    loadReview();
    api(`/activities/${id}/analysis`).then((an) => { const box = view.querySelector('#analysis'); if (box && an && !an.error) box.innerHTML = analysisHtml(an); }).catch(() => {});
    api(`/activities/${id}/series`).then((sr) => {
      const box = view.querySelector('#series');
      if (!box || !sr || sr.error) { if (box) box.innerHTML = ''; return; }
      box.innerHTML = seriesCards(sr) + corosExtraCards(a.coros?.extra);
      const set = (k, v) => { const el = view.querySelector(`#${k}`); if (el && v != null) el.textContent = v; };
      set('st-fast', sr.fast_km_s ? pace(sr.fast_km_s) : null);
      set('st-elev', sr.elev_gain != null ? `${Math.round(sr.elev_gain)}` : null);
      set('st-cad', sr.avg.cad ? `${sr.avg.cad}` : null);
      set('st-cal', sr.calories ? `${Math.round(sr.calories)}` : null);
    }).catch(() => { const box = view.querySelector('#series'); if (box) box.innerHTML = ''; });
    const sp = view.querySelector('#seg-probe');
    if (sp) sp.onclick = async () => {
      const box = view.querySelector('#seg-out');
      sp.disabled = true; box.innerHTML = '<p class="muted">調べています (20 秒ほど)…</p>';
      try {
        const txt = segProbeText(a, await api(`/activities/${id}/coros-segments`));
        box.innerHTML = `<pre class="seg-pre">${esc(txt)}</pre><button type="button" id="seg-copy">結果をコピー</button>`;
        box.querySelector('#seg-copy').onclick = async (e) => { try { await navigator.clipboard.writeText(txt); e.target.textContent = 'コピーしました'; } catch { e.target.textContent = 'コピーできませんでした (長押しで選択してください)'; } };
      } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
      sp.disabled = false;
    };
    view.querySelector('#reeval').onclick = async (e) => {
      e.target.disabled = true;
      await api(`/activities/${id}/reevaluate`, { method: 'POST' });
      route();
    };
  });

  const hrd = ev?.hr?.details || {};
  const CX = a.coros?.extra || {};
  const zones = [1, 2, 3, 4, 5].map((z) => hrd[`z${z}_pct`]);
  const sib = a.siblings || [];
  const sumD = sib.reduce((x, r) => x + r.distance_m, 0), sumT = sib.reduce((x, r) => x + r.moving_time_s, 0);
  const planName = (p) => `${PLAN_LABELS[p.type]}${p.distance_m ? ' ' + km(p.distance_m) + 'km' : ''}`;
  const uPlans = uniqPlans(plans);

  return `
    <div class="card hd">
      <div class="row spread"><h2>${esc(a.name)}</h2><span class="ext-links"><button type="button" class="cap-btn no-cap" data-capture="${esc(a.name)}" aria-label="画面を画像で保存"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M5 19h14"/></svg>画像</button>${a.coros ? `<a class="muted" href="https://t.coros.com/activity-detail?labelId=${encodeURIComponent(a.coros.label_id)}&sportType=${a.coros.sport_type}" target="_blank" rel="noopener">COROS ↗</a>` : ''}${a.id > 0 ? `<a class="muted" href="https://www.strava.com/activities/${a.id}" target="_blank" rel="noopener">Strava ↗</a>` : ''}</span></div>
      <div class="muted">${a.start_date_local.slice(0, 16).replace('T', ' ')}${ev?.role ? `<span class="role">${{ warmup: 'アップ', work: 'メイン', cooldown: 'ダウン' }[ev.role]}</span>` : ''}</div>
      <div class="row spread hd-main"><div class="num"><span class="hd-km">${km(a.distance_m, 2)}</span><span class="hd-u">km</span></div>
        <div style="text-align:right"><div class="muted">${a.plan_id && ev?.type !== 'free' ? '練習達成度' : '走りの点'}</div><div class="big">${scoreHtml(a.score)}</div></div></div>
      <div class="stats num">
        <div><b>${dur(a.moving_time_s)}</b><span>運動時間</span></div>
        <div><b>${pace(a.moving_time_s / (a.distance_m / 1000))}<small>/km</small></b><span>平均ペース</span></div>
        <div><b>${a.avg_hr ? Math.round(a.avg_hr) : '-'}<small>bpm</small></b><span>平均心拍</span></div>
        <div><b id="st-fast">-</b><span>最速 (1km)</span></div>
        <div><b>${a.max_hr ? Math.round(a.max_hr) : '-'}<small>bpm</small></b><span>最大心拍</span></div>
        <div><b><span id="st-elev">-</span><small>m</small></b><span>累積上昇</span></div>
        <div><b id="st-cad">${a.avg_cadence_spm ? Math.round(a.avg_cadence_spm) : '-'}</b><span>ピッチ spm</span></div>
        <div><b id="st-cal">-</b><span>カロリー kcal</span></div>
        ${CX.effort_pace_s ? `<div><b>${pace(CX.effort_pace_s)}<small>/km</small></b><span>出力ペース</span></div>` : ''}
        ${CX.efficiency != null ? `<div><b>${CX.efficiency}<small>%</small></b><span>効率</span></div>` : ''}
        ${CX.training_load != null ? `<div><b>${CX.training_load}</b><span>トレーニング負荷</span></div>` : ''}
      </div>
      ${ev && a.score != null && (ev.version ?? 1) < 2 ? '<p class="muted hd-basis hd-old">この点数は 11/3 より前の基準で計算したもの (ピッチ 180 との差の減点などを含む)。下の「再評価」を押すと、今の基準で計算し直します (このランだけ)。</p>' : ''}
      <p class="muted hd-basis">距離・運動時間・心拍・ピッチは${a.coros ? ' COROS' : a.id > 0 ? ' Strava' : ''}の記録。平均ペース = 運動時間 ÷ 距離${a.elapsed_time_s && a.elapsed_time_s - a.moving_time_s >= 30 ? ` (経過時間 ${dur(a.elapsed_time_s)} は止まった時間を含む)` : ''}。</p>
    </div>
    <div id="analysis"></div>
    <div id="series"><div class="card"><span class="muted">グラフを読み込み中…</span></div></div>
    <div class="card"><h2>ラップ詳細</h2><div id="splits"><span class="muted">読み込み中…</span></div></div>
    ${sib.length > 1 ? `<div class="card"><h2>この日のラン (${sib.length}本)</h2>
      <p class="muted" style="margin-top:0">アップ・本体・ダウンなど、同じ日のランは 1 つのメニューとして見ます</p>
      <div class="num" style="margin:8px 0"><span class="big">${km(sumD, 2)}</span> km・${dur(sumT)}・${pace(sumT / (sumD / 1000))}/km</div>
      <ul class="list">${sib.map((r) => `<li class="${r.id === a.id ? 'cur' : ''}"><a href="#/activities/${r.id}"><div class="row spread"><span>${r.start_date_local.slice(11, 16)} ${esc(r.name)}${r.role ? `<span class="role">${{ warmup: 'アップ', work: 'メイン', cooldown: 'ダウン' }[r.role]}</span>` : ''}${r.id === a.id ? ' <span class="badge">いま見ているラン</span>' : ''}</span>${scoreHtml(r.score)}</div><div class="muted num">${km(r.distance_m, 2)}km・${pace(r.moving_time_s / (r.distance_m / 1000))}/km${r.avg_hr ? `・${Math.round(r.avg_hr)}bpm` : ''}</div></a></li>`).join('')}</ul></div>` : ''}
    <div id="review"><div class="card"><span class="muted">レビューをつくっています…</span></div></div>
    <div id="fb"></div>
    <template id="score-detail"><details class="rv-acc"><summary>点数の内訳</summary><div class="rv-acc-b">
    ${ev && W && a.score != null && a.score < 85 ? (() => {
      const NM = { pace: 'ペース', hr: '心拍', cadence: 'ケイデンス', form: 'フォーム' };
      const lost = ['pace', 'hr', 'cadence', 'form'].filter((k) => W[k] > 0 && ev[k]?.score != null)
        .map((k) => ({ k, loss: Math.round(W[k] * (100 - ev[k].score) / 100) })).filter((x) => x.loss >= 3).sort((x, y) => y.loss - x.loss);
      return lost.length ? `<div class="why"><h3 class="sub">${a.score}点の内訳</h3>
        <p class="muted" style="margin:0 0 6px">100点から引かれた点</p>
        ${lost.map((x) => `<div class="row spread why-row"><b>${NM[x.k]}</b><b class="num bad">−${x.loss}</b></div><div class="muted why-sub">${esc(ev[x.k].summary)}</div>`).join('')}
      </div>` : '';
    })() : ''}
    ${ev ? `
    <div>
      <p class="muted">評価の種類: <span class="badge" data-t="${ev.type}">${ev.type === 'free' ? 'フリーラン' : PLAN_LABELS[ev.type]}</span></p>
      ${metric('ペース', ev.pace, W?.pace)}${metric('心拍', ev.hr, W?.hr)}${metric('ケイデンス', ev.cadence, W?.cadence)}${ev.form ? metric('フォーム', ev.form, W?.form) : ''}
      ${howCard(ev)}
      <ul class="bullets">${ev.comments.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      ${ev.focus?.length ? `<h3 class="sub">次に意識すること</h3><ul class="bullets focus">${ev.focus.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      ${ev.pace.details.rep_paces ? `<p class="muted num">各本: ${esc(ev.pace.details.rep_paces)}</p>` : ''}
      ${zones.some((z) => z != null) ? `<h3 class="sub">心拍ゾーン (走った時間の割合)</h3>${zoneBars(zones)}` : ''}
    </div>` : ''}
    </div></details></template>
    ${(() => {
      const cur = shoes.find((x) => x.id === a.shoe_id);
      return `<div class="card shoe-card"><div class="row spread"><h2>${cur ? esc(cur.name) : 'シューズを追加'}</h2><button type="button" class="chip" id="shoe-open">${cur ? '変更' : '選ぶ'}</button></div>
      ${cur ? `<div class="shoe-img big">${cur.image ? `<img src="${cur.image}" alt="">` : '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16v-3l4-1 2-3 3 2 4 1c3 .5 5 2 5 4v1H3z"/><path d="M3 19h18"/></svg>'}</div><div class="muted num">累計 ${Math.round(cur.total_km)}km / ${cur.limit_km}km</div>` : '<p class="muted" style="margin:0">このランで履いたシューズを選びます。</p>'}
      </div>`;
    })()}
    <div class="card">
      <h2>この練習のメニュー</h2>
      <p class="muted" style="margin-top:0">${a.plan ? `いまは「${md(a.date)} ${planName(a.plan)}」として評価しています` : 'いまはメニューなし (フリーラン) として評価しています'}。別のメニューに変えるときは下から選んでください。同じ日のランはまとめて変わります。</p>
      <div class="plan-choices" id="plan-choices">
        ${uPlans.filter((p) => p.type !== 'rest').map((p) => `<button type="button" class="choice ${a.plan_id === p.id ? 'on' : ''}" data-pc="${p.id}"><b>${planName(p)}</b><small>${md(p.date)}の計画${p.notes ? '・' + esc(p.notes) : ''}</small></button>`).join('')}
        <button type="button" class="choice ${a.plan_id == null ? 'on' : ''}" data-pc=""><b>メニューなし (フリーラン)</b><small>計画とは比べず、単独で評価します</small></button>
      </div>
      <button id="reeval">再評価</button>
    </div>
    ${a.coros ? `<details class="card rv-acc seg-probe"><summary>COROS のワークアウト区間を調べる (調査用)</summary><div class="rv-acc-b">
      <p class="muted" style="font-size:12.5px;margin-top:0">このランの COROS のデータに、アップ・メイン・ダウン・レストの区間の情報が入っているかを調べます。読み取るだけで、記録・評価は変わりません。FIT のダウンロードを 1 回使います。</p>
      <button type="button" id="seg-probe">調べる</button><div id="seg-out"></div></div></details>` : ''}`;
}

/** 区間の調査結果を、読める文章にする (コピーして送ってもらう用) */
function segProbeText(a, r) {
  const L = [`【STRIDE 区間調査】${a.date} ${km(a.distance_m, 2)}km ${dur(a.moving_time_s)}`];
  if (r.error) return L.concat(`エラー: ${r.error}`).join('\n');
  const sl = r.saved_laps || [];
  L.push(`保存済みのラップ: ${sl.length} 本 (${sl.slice(0, 12).map((l) => `${(l.dist_m / 1000).toFixed(2)}km/${dur(l.time_s)}`).join(', ')}${sl.length > 12 ? ' …' : ''})`);
  const la = r.lap_api;
  if (r.lap_api_error) L.push(`ラップ API: エラー ${r.lap_api_error}`);
  else if (la) {
    L.push(`ラップ API: 最上位の項目 [${la.keys.join(', ')}] / グループ ${la.groups.length} 個 / 取り込みで使ったのは ${la.used_by_import == null ? '-' : `グループ${la.used_by_import + 1}`}`);
    la.groups.forEach((g, i) => {
      L.push(`  グループ${i + 1}: ラップ ${g.count} 本 / グループの項目 [${g.keys.join(', ')}] ${JSON.stringify(g.info)}`);
      L.push(`    ラップの項目: [${g.lapKeys.join(', ')}]`);
      g.laps.slice(0, 25).forEach((l, k) => L.push(`    ${k + 1}: ${JSON.stringify(l)}`));
    });
  }
  const f = r.fit;
  if (r.fit_error) L.push(`FIT: エラー ${r.fit_error}`);
  else if (f?.error) L.push(`FIT: ${f.error}`);
  else if (f) {
    L.push(`FIT のメッセージ: ${Object.entries(f.messages).map(([k, n]) => `${k}=${n}`).join(', ')}`);
    L.push(`FIT のワークアウト: ${f.workout ? `「${f.workout.name}」 ステップ ${f.workout.steps ?? '-'}` : 'なし'}`);
    f.steps.forEach((x) => L.push(`  ステップ${x.i ?? ''}: ${x.name || '(名前なし)'} / ${x.intensity ?? '-'} / ${x.duration} ${x.value ?? ''} / 目標 ${x.target_type ?? '-'} ${x.low ?? ''}-${x.high ?? ''}${x.notes ? ` / ${x.notes}` : ''}`));
    L.push(`FIT のラップ: ${f.laps.length} 本`);
    f.laps.forEach((x) => L.push(`  ${x.i + 1}: ${x.dist_m != null ? (x.dist_m / 1000).toFixed(2) + 'km' : '-'} ${x.timer_s != null ? dur(x.timer_s) : '-'} / 種類 ${x.intensity ?? '-'} / きっかけ ${x.trigger ?? '-'} / ステップ ${x.step ?? '-'}`));
  }
  return L.join('\n');
}

// ---- レース

const CHECK_CATS = { prep: '前日まで', morning: '当日の朝', other: 'このレースだけ' };
const CHECK_ITEMS = [
  ['prep', 'p1', 'ゼッケン引換証・本人確認'],
  ['prep', 'p2', '本番シューズと靴下'],
  ['prep', 'p3', 'ウェア・安全ピン'],
  ['prep', 'p4', '防寒 (ポンチョ・捨て着)'],
  ['prep', 'p5', 'ウォッチ充電・ペース表'],
  ['prep', 'p6', 'ジェル・塩タブレット'],
  ['prep', 'p7', 'ワセリン・絆創膏'],
  ['prep', 'p8', '会場・集合時間・荷物預けの確認'],
  ['morning', 'm1', '朝食 (スタート 2〜3 時間前)'],
  ['morning', 'm2', 'トイレ・給水'],
  ['morning', 'm3', '荷物を預ける'],
  ['morning', 'm4', '軽いジョグ・ストレッチ'],
];

/** レースの結果: 目標との差・前半/後半・失速した地点・次の目標の目安 */
async function loadRaceResult(r) {
  const box = document.getElementById('race-result');
  if (!box) return;
  const res = await api(`/races/${r.id}/result`).catch(() => null);
  const ask = async (manual) => {
    let body = {};
    if (manual) { const v = await openDialog(`<h2>結果タイム</h2><input name="t" placeholder="3:08:30" value="${r.result_time_s ? dur(r.result_time_s) : ''}" required><p class="muted" style="font-size:12.5px">記録証のタイム (グロスかネット、どちらでも)。</p>`); if (!v) return; body = { result_time_s: parseDur(v.t) }; }
    try { await api(`/races/${r.id}/result`, { method: 'POST', body }); route(); } catch (e) { alert(e.message); }
  };
  if (!res) {
    box.innerHTML = `<div class="card"><h2>結果</h2><p class="muted">その日の実績から、レースのランを見つけて結果を登録します。</p><div class="row"><button type="button" class="primary" data-res="auto">実績から登録</button><button type="button" data-res="man">タイムを入力</button></div></div>`;
    box.querySelector('[data-res="auto"]').onclick = () => ask(false);
    box.querySelector('[data-res="man"]').onclick = () => ask(true);
    return;
  }
  const d = res.diff_s;
  const km = r.distance_m / 1000;
  box.innerHTML = `<div class="card rres"><div class="row spread"><h2>結果</h2><button type="button" class="chip" data-res="man">修正</button></div>
    <div class="apt-pred num" style="--n:3"><div><small>結果</small><b>${dur(res.result_s)}</b></div><div><small>目標</small><b>${res.goal_s ? dur(res.goal_s) : '-'}</b></div><div><small>目標との差</small><b class="${d != null && d <= 0 ? 'g' : 'b'}">${d == null ? '-' : `${d <= 0 ? '−' : '+'}${dur(Math.abs(d))}`}</b></div></div>
    ${res.first_pace ? `<p>前半 <b class="num">${pace(res.first_pace)}</b>/km → 後半 <b class="num">${pace(res.second_pace)}</b>/km (${res.second_pace - res.first_pace > 0 ? `${res.second_pace - res.first_pace} 秒/km 落ちた` : `${res.first_pace - res.second_pace} 秒/km 上げた`})。${res.fade_km ? `${res.fade_km}km から目標ペースより 10 秒/km 以上遅くなっている。` : res.goal_s ? '目標ペースから大きく落ちた区間はない。' : ''}</p>` : '<p class="muted">ラップが取れないので、ペース配分は分かりません。</p>'}
    ${res.next_goal_s ? `<p class="muted">この結果の走力 (VDOT ${res.vdot}) から、次のフルの目標の目安は <b class="num">${dur(res.next_goal_s)}</b>${km < 40 ? ' (フル換算)' : ''}。${res.fade_km && km > 40 ? ' 後半の失速を減らすため、30km 以上のロング走と M ペース走を増やしたい。' : ''}</p>` : ''}
    ${res.activity_id ? `<a class="btn" href="#/activities/${res.activity_id}">このレースの実績を見る ›</a>` : ''}</div>`;
  box.querySelector('[data-res="man"]').onclick = () => ask(true);
}

/** 関門との余裕・補給計画 (ペース表と同じ計算で、通過予定の時刻を出す) */
function racePlanExtras(r, mode) {
  if (!r.goal_time_s) return '';
  const inf = raceInfoOf(r);
  const sc = myStartClock(r), gun = clockS(inf.start_time), loss = inf.start_loss_s || 0;
  let h = '';
  const cut = (inf.cutoffs || []).filter((x) => x.km <= r.distance_m / 1000);
  if (cut.length) {
    h += `<div class="card"><h2>関門との余裕</h2>${sc == null ? '<p class="muted">スタート時刻が分からないので、号砲からの時間で比べます。</p>' : ''}<table class="an-cmp num"><tr><th>関門</th><th>閉鎖</th><th>通過予定</th><th>余裕</th></tr>${cut.map((x) => {
      const tAt = timeAt(r, mode, x.km);
      const closeC = clockS(x.time);
      // 閉鎖が時刻なら時刻同士、"2:35後" のように号砲からの時間ならグロスで比べる
      const passC = sc != null ? sc + tAt : null;
      const margin = closeC != null && passC != null && !/後/.test(x.time) ? closeC - passC : /後/.test(x.time) && closeC != null ? closeC - (tAt + loss) : null;
      return `<tr><td>${x.km}km${x.place ? ` <small class="muted">${esc(x.place)}</small>` : ''}</td><td>${esc(x.time)}</td><td>${passC != null ? clockTxt(passC) : `号砲+${dur(tAt + loss)}`}</td><td class="${margin != null && margin < 900 ? 'warn-t' : ''}">${margin != null ? `${Math.round(margin / 60)}分` : '-'}</td></tr>`;
    }).join('')}</table></div>`;
  }
  const fuel = [...(inf.fuel || [])].sort((a, b) => a.km - b.km);
  inf.fuel = fuel;
  h += `<div class="card"><div class="row spread"><h2>補給計画</h2><button type="button" class="chip" data-fuel="add">＋ 追加</button></div>
    ${fuel.length ? `<div class="fuel-l">${fuel.map((x, k) => { const tt = timeAt(r, mode, x.km); return `<button type="button" class="fuel-r" data-fuel-edit="${k}"><b class="num">${x.km}km</b><span>${esc(x.item)}</span><span class="num muted">${dur(tt)}${sc != null ? ` (${clockTxt(sc + tt)})` : ''}</span></button>`; }).join('')}</div>
      <p class="muted an-note">通過予定はペース表 (${PACE_PLANS[mode].label}) と同じ計算。ペースの作り方を変えると時刻も変わります。タップで編集・削除。</p>`
    : `<p class="muted">ジェル・給水の地点を決めておくと、通過予定の時刻と、持ち物のジェルの数が出ます。</p><button type="button" class="wide" data-fuel="std">標準の補給を入れる (フル: 10・17.5・25・32・37km でジェル)</button>`}</div>`;
  return h;
}

/* ---- 大会のイメージ画像 (自動で作る SVG。都市・海辺の都市・海・山) ---- */
const ART_THEMES = { city: '都市', coast: '海辺の都市', sea: '海', mountain: '山', country: '田園' };
/** 大会名・会場から景色を選ぶ (おすすめ)。大きな都市の名前が無ければ、田園 (田舎の大会を都市にしない) */
function artThemeOf(r) {
  const t = `${r.name || ''} ${raceInfoOf(r).venue || ''}`;
  const sea = /海|湾|浜|ビーチ|島|港|岬|別府|湘南|糸島|沖縄|那覇|宮古|石垣|館山|みなと|マリン|ベイ|オーシャン|シーサイド|海岸/.test(t);
  const mtn = /山|高原|トレイル|峠|富士|岳|アルプス|渓谷|湖|森/.test(t);
  const coastCity = /福岡|神戸|横浜|那覇|北九州|下関|函館|長崎|千葉|大阪|湘南|静岡|和歌山|松山|高知|鹿児島/.test(t);
  // 都市にするのは大きな都市の名前があるときだけ (「○○市民マラソン」の「市」では都市にしない)
  const city = /東京|大阪|名古屋|福岡|京都|神戸|横浜|札幌|仙台|広島|北九州|さいたま|金沢|岡山|熊本|新潟|シティ|city|City/.test(t);
  if (mtn && !city) return 'mountain';
  if (coastCity && city) return 'coast';
  if (sea) return 'sea';
  if (mtn) return 'mountain';
  if (city) return 'city';
  return 'country';
}
/** 大会ごとに少しずつ違う景色にするための乱数 (同じ大会なら毎回同じ) */
function artRand(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
}
/** 景色の SVG (400×200)。左側は文字が読めるように暗く、景色は右側に寄せる */
function raceArtSvg(theme, seed) {
  const rnd = artRand(`${seed}:${theme}`);
  const W = 400, H = 200;
  const pal = {
    city: ['#0b0f2e', '#2a2a8a', '#7a4dff', '#ff7aa8'],
    coast: ['#0a1236', '#24308f', '#6a5cff', '#ffa77a'],
    sea: ['#08163a', '#1d3a9e', '#4f7dff', '#ffc27a'],
    mountain: ['#0c1030', '#2b2a86', '#8a5cff', '#ff9ec7'],
    country: ['#0b1534', '#2c3d96', '#7b6cff', '#ffc38a'],
  }[theme] || ['#0b0f2e', '#2a2a8a', '#7a4dff', '#ff7aa8'];
  const horizon = theme === 'mountain' ? 150 : theme === 'city' ? 168 : theme === 'country' ? 140 : 132;
  const sunX = 250 + rnd() * 100, sunY = horizon - 18 - rnd() * 30;
  let g = `<defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal[0]}"/><stop offset=".55" stop-color="${pal[1]}"/><stop offset="1" stop-color="${pal[2]}"/></linearGradient>
    <radialGradient id="sun" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${pal[3]}" stop-opacity=".95"/><stop offset=".35" stop-color="${pal[3]}" stop-opacity=".45"/><stop offset="1" stop-color="${pal[3]}" stop-opacity="0"/></radialGradient>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${pal[1]}"/><stop offset="1" stop-color="${pal[0]}"/></linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>`;
  // 星
  for (let i = 0; i < 26; i++) g += `<circle cx="${(rnd() * W).toFixed(1)}" cy="${(rnd() * horizon * 0.6).toFixed(1)}" r="${(0.4 + rnd() * 0.9).toFixed(2)}" fill="#fff" opacity="${(0.25 + rnd() * 0.5).toFixed(2)}"/>`;
  // 太陽 (光の輪)
  g += `<circle cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="70" fill="url(#sun)"/><circle cx="${sunX.toFixed(1)}" cy="${sunY.toFixed(1)}" r="${(14 + rnd() * 6).toFixed(1)}" fill="${pal[3]}" opacity=".9"/>`;
  const skyline = (base, x0, x1, hmin, hmax, fill, win) => {
    let s = '', x = x0;
    while (x < x1) {
      const w = 10 + rnd() * 22, h = hmin + rnd() * (hmax - hmin) * (0.35 + 0.65 * ((x - x0) / Math.max(1, x1 - x0)));
      s += `<rect x="${x.toFixed(1)}" y="${(base - h).toFixed(1)}" width="${w.toFixed(1)}" height="${(h + 1).toFixed(1)}" fill="${fill}"/>`;
      if (win) for (let k = 0; k < Math.floor(h / 9); k++) for (let j = 0; j < Math.floor(w / 6); j++) if (rnd() < 0.22) s += `<rect x="${(x + 2 + j * 6).toFixed(1)}" y="${(base - h + 4 + k * 9).toFixed(1)}" width="2" height="3" fill="#ffd98a" opacity="${(0.4 + rnd() * 0.5).toFixed(2)}"/>`;
      x += w + 1 + rnd() * 3;
    }
    // 塔 (アンテナ)
    const tx = x0 + (x1 - x0) * (0.55 + rnd() * 0.3), th = hmax * 1.25;
    s += `<path d="M${(tx - 5).toFixed(1)} ${base} L${tx.toFixed(1)} ${(base - th).toFixed(1)} L${(tx + 5).toFixed(1)} ${base}Z" fill="${fill}"/><line x1="${tx.toFixed(1)}" y1="${(base - th).toFixed(1)}" x2="${tx.toFixed(1)}" y2="${(base - th - 12).toFixed(1)}" stroke="${fill}" stroke-width="1.5"/><circle cx="${tx.toFixed(1)}" cy="${(base - th - 12).toFixed(1)}" r="1.6" fill="#ff8aa8"/>`;
    return s;
  };
  if (theme === 'city') {
    g += skyline(horizon, 150, W, 24, 70, '#1a1850', false);
    g += skyline(horizon + 4, 120, W, 18, 60, '#0d0e2c', true);
    g += `<rect y="${horizon + 3}" width="${W}" height="${H - horizon}" fill="#0a0b24"/>`;
  } else if (theme === 'coast') {
    g += skyline(horizon, 210, W, 14, 46, '#13134a', true);
    g += `<rect y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#sea)"/>`;
  } else if (theme === 'sea') {
    g += `<rect y="${horizon}" width="${W}" height="${H - horizon}" fill="url(#sea)"/>`;
    g += `<path d="M180 ${horizon} q40 -14 80 -6 t70 2 l70 4 v0 Z" fill="#141a52" opacity=".8"/>`;
  } else if (theme === 'country') {
    // 田園: なだらかな丘・田畑のうね・木と小さな家
    const hill = (base, amp, fill, op, ph) => { let d = `M0 ${H} L0 ${base}`; for (let x = 0; x <= W; x += 10) d += ` L${x} ${(base - Math.sin(x / 70 + ph) * amp - Math.sin(x / 23 + ph * 2) * amp * 0.25).toFixed(1)}`; return `<path d="${d} L${W} ${H}Z" fill="${fill}" opacity="${op}"/>`; };
    g += hill(horizon - 6, 10, '#3d3a9c', '.55', rnd() * 6) + hill(horizon + 10, 9, '#24256e', '.9', rnd() * 6);
    // 田畑のうね (手前に向かって広がる線)
    for (let i = 0; i < 7; i++) { const y = horizon + 22 + i * 7; g += `<path d="M${(150 + i * 4).toFixed(0)} ${y} Q 280 ${y - 4} ${W} ${y + 2}" stroke="#8fa0ff" stroke-width=".8" fill="none" opacity="${(0.12 + i * 0.03).toFixed(2)}"/>`; }
    g += hill(horizon + 34, 6, '#12133a', '1', rnd() * 6);
    // 木と家 (右寄り)
    for (let i = 0; i < 7; i++) {
      const x = 170 + rnd() * 220, base = horizon + 4 + rnd() * 10, r = 4 + rnd() * 5;
      g += `<rect x="${(x - 0.8).toFixed(1)}" y="${(base - r).toFixed(1)}" width="1.6" height="${(r + 2).toFixed(1)}" fill="#14153e"/><circle cx="${x.toFixed(1)}" cy="${(base - r * 1.4).toFixed(1)}" r="${r.toFixed(1)}" fill="#1c1d52"/>`;
    }
    for (let i = 0; i < 3; i++) {
      const x = 200 + rnd() * 170, base = horizon + 8 + rnd() * 6, w = 12 + rnd() * 6;
      g += `<path d="M${x.toFixed(1)} ${base.toFixed(1)} v-7 l${(w / 2).toFixed(1)} -6 l${(w / 2).toFixed(1)} 6 v7 Z" fill="#16173f"/><rect x="${(x + w / 2 - 1.5).toFixed(1)}" y="${(base - 6).toFixed(1)}" width="3" height="3" fill="#ffd98a" opacity=".7"/>`;
    }
  } else {
    const ridge = (base, amp, fill, op) => { let d = `M0 ${H} L0 ${base}`; for (let x = 0; x <= W; x += 20) d += ` L${x} ${(base - (Math.sin(x / 37 + rnd()) + 1) * amp * (0.4 + 0.6 * x / W) - rnd() * 6).toFixed(1)}`; return `<path d="${d} L${W} ${H}Z" fill="${fill}" opacity="${op}"/>`; };
    g += ridge(horizon - 10, 34, '#3a2f9a', '.55') + ridge(horizon + 8, 30, '#221d6a', '.85') + ridge(horizon + 28, 22, '#0e0e30', '1');
  }
  if (theme === 'coast' || theme === 'sea') {
    // 太陽の映り込みと波
    for (let i = 0; i < 9; i++) { const y = horizon + 6 + i * 7, w = 40 - i * 3; g += `<rect x="${(sunX - w / 2).toFixed(1)}" y="${y}" width="${w}" height="1.6" rx=".8" fill="${pal[3]}" opacity="${(0.55 - i * 0.05).toFixed(2)}"/>`; }
    for (let i = 0; i < 6; i++) { const y = horizon + 10 + i * 10 + rnd() * 4, x = rnd() * 240; g += `<path d="M${x.toFixed(1)} ${y.toFixed(1)} q12 -3 24 0 t24 0" stroke="#a9b8ff" stroke-width="1" fill="none" opacity=".35"/>`; }
  }
  // 走るコース (光る点線)
  const y0 = H - 22 - rnd() * 10;
  g += `<path d="M0 ${y0.toFixed(1)} C 120 ${(y0 - 26).toFixed(1)}, 220 ${(y0 + 18).toFixed(1)}, ${W} ${(y0 - 14).toFixed(1)}" stroke="#fff" stroke-width="2" stroke-dasharray="2 7" stroke-linecap="round" fill="none" opacity=".55"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice">${g}</svg>`;
}
/** 見出しの背景: 選んだ景色か写真。hero = auto (おすすめ) / city / coast / sea / mountain / photo / plain */
function raceHeroStyle(r) {
  const inf = raceInfoOf(r);
  const mode = inf.hero || 'auto';
  if (mode === 'plain') return { cls: '', style: '' };
  if (mode === 'photo' && inf.image) return { cls: 'has-img', style: `--img:url('${inf.image}')` };
  const theme = ART_THEMES[mode] ? mode : artThemeOf(r);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(raceArtSvg(theme, r.id || r.name))}`;
  // 属性の中に入れるので外側は ' で囲む (SVG の中には ' を使っていない)
  return { cls: 'has-art', style: `--art:url('${url}')` };
}

/** レース詳細 > 実績: 目標への準備状況 (ホームの「目標への現在地」と同じ計算。次の大会だけが対象) */
async function loadRaceReady(r) {
  const box = document.getElementById('race-ready');
  if (!box) return;
  let ins = null;
  try { ins = await api('/insights'); } catch { box.innerHTML = '<h2>目標への準備状況</h2><p class="muted">読み込めませんでした。</p>'; return; }
  if (!document.body.contains(box)) return;
  const LVc = { ok: 'good', warn: 'ok', bad: 'bad' };
  if (!ins?.race || ins.race.name !== r.name) {
    box.innerHTML = `<h2>目標への準備状況</h2><p class="muted">準備状況は「次の大会」${ins?.race ? ` (${esc(ins.race.name)})` : ''}だけを計算しています。この大会が次の大会になると、ここに出ます。</p>`;
    return;
  }
  const full = Math.abs(r.distance_m - 42195) < 50;
  const pr = ins.predicted_s;
  box.innerHTML = `<h2>目標への準備状況</h2>
    <div class="hl-tiles"><div class="hl-tile"><small>目標</small><b class="num">${r.goal_time_s ? dur(r.goal_time_s) : '-'}</b></div>
      <div class="hl-tile"><small>${esc(ins.predicted_label || '予測')}</small><b class="num">${full && pr ? dur(pr) : '-'}</b><span>${full && pr ? `${md(today())} 時点` : 'データ不足・フル以外'}</span></div>
      <div class="hl-tile"><small>目標との差</small><b class="num">${ins.gap_s != null ? `${ins.gap_s <= 0 ? '−' : '+'}${dur(Math.abs(ins.gap_s))}` : '-'}</b><span>${ins.gap_s != null ? (ins.gap_s <= 0 ? '予測が目標より速い' : '予測が目標より遅い') : ''}</span></div></div>
    <div class="an-items" style="margin-top:12px">${(ins.items || []).map((x) => `<div class="an-it"><span class="an-j j-${LVc[x.level] || 'hold'}">${x.level === 'ok' ? '良い' : x.level === 'warn' ? '注意' : '課題'}</span><div><b>${esc(x.label)}</b><span class="num">${esc(x.value)} / 目安 ${esc(x.target)}</span></div></div>`).join('')}</div>
    ${ins.aptitude?.prediction?.confidence && ins.aptitude.prediction.confidence !== '-' ? `<p class="muted an-note">予測の信頼度: ${esc(ins.aptitude.prediction.confidence)} (根拠はホームの「マラソン適性」)。</p>` : ''}
    <p class="muted an-note">予測は今の練習の記録からの目安で、達成を約束するものではありません。気温・風・コース・当日の体調で結果は変わります。</p>`;
}

let RACE_WX = null; // レース詳細の天気 (ペースの型を変えたら、レース展開の表を描き直す)
async function raceDetailView(id) {
  const [races, state] = await Promise.all([
    api('/races'),
    api(`/checklist/${id}`).catch(() => ({ checked: [], custom: [] })),
  ]);
  // レース天気は外のサービスなので、画面を出してから入れる
  setTimeout(() => api('/race-weather').then((w) => { const rr = races.find((x) => x.id === Number(id)); if (w && rr && w.race === rr.name) { RACE_WX = w; drawRaceWx(w, rr); } else document.getElementById('rd-wx')?.remove(); }).catch(() => {}));
  // 持ち物のひな形 (全レース共通)。設定に保存してあればそれ、無ければ最初の一覧
  const st0 = await api('/settings').catch(() => ({}));
  let tmpl = Array.isArray(st0.checklist_template) ? st0.checklist_template : CHECK_ITEMS.map(([cat, iid, text]) => ({ cat, id: iid, text }));
  let editing = false;
  const r = races.find((x) => x.id === Number(id));
  if (!r) return '<div class="card error">レースが見つかりません</div>';
  let mode = raceInfoOf(r).pace_mode || 'even';
  const t = today();
  const items = [...tmpl, ...(state.custom || [])];
  const rebuild = () => items.splice(0, items.length, ...tmpl, ...(state.custom || []));
  const saveTmpl = () => api('/settings', { method: 'PUT', body: { checklist_template: tmpl } }).catch((e) => alert(e.message));
  const done = () => items.filter((x) => state.checked.includes(x.id)).length;
  const save = () => api(`/checklist/${id}`, { method: 'PUT', body: state }).catch(() => {});

  const drawChecks = () => {
    const box = view.querySelector('#checks');
    if (!box) return;
    box.innerHTML = Object.entries(CHECK_CATS).map(([cat, label]) => {
      const list = items.filter((x) => x.cat === cat);
      if (!list.length) return '';
      return `<div class="ck-group"><div class="ck-title">${label} <span class="muted num">${list.filter((x) => state.checked.includes(x.id)).length}/${list.length}</span></div>
        ${list.map((x) => editing
          ? `<div class="ck ck-ed"><input class="ck-in" data-ed="${x.id}" value="${esc(x.text)}" maxlength="60"><button type="button" class="ck-del" data-del="${x.id}" aria-label="削除">×</button></div>`
          : `<label class="ck ${state.checked.includes(x.id) ? 'on' : ''}"><input type="checkbox" data-ck="${x.id}" ${state.checked.includes(x.id) ? 'checked' : ''}><span class="box"></span><span class="ck-text">${esc(x.text)}</span></label>`).join('')}</div>`;
    }).join('');
    const gels = (raceInfoOf(r).fuel || []).filter((x) => /ジェル|gel/i.test(x.item)).length;
    if (gels) box.insertAdjacentHTML('afterbegin', `<p class="ck-fuel">補給計画より: ジェル <b>${gels + 1}</b> 個 (予備 1 個を含む)${(raceInfoOf(r).fuel || []).some((x) => /塩/.test(x.item)) ? '・塩タブレット' : ''}</p>`);
    view.querySelector('#ck-add').classList.toggle('hidden', !editing);
    view.querySelector('#ck-edit').textContent = editing ? '完了' : '編集';
    view.querySelector('#ck-prog').textContent = `${done()} / ${items.length}`;
    view.querySelector('#ck-bar').style.width = `${(done() / items.length) * 100}%`;
  };
  setTimeout(() => {
    if (upcoming) wireChecks();
    const saveInfo = async (patch) => { const info = { ...raceInfoOf(r), ...patch }; r.info = JSON.stringify(info); await api(`/races/${r.id}`, { method: 'PUT', body: { ...r, info, no_auto: true } }).catch((e) => alert(e.message)); };
    const redraw = () => { view.querySelector('#pace-out').innerHTML = splitTable(r, mode); view.querySelector('#rp-extra').innerHTML = racePlanExtras(r, mode); if (upcoming) drawChecks(); if (RACE_WX && RACE_WX.race === r.name) drawRaceWx(RACE_WX, r, mode); };
    view.querySelectorAll('[data-pm]').forEach((b) => (b.onclick = () => {
      mode = b.dataset.pm;
      view.querySelectorAll('[data-pm]').forEach((x) => x.classList.toggle('on', x === b));
      view.querySelector('#pace-note').textContent = PACE_PLANS[mode].note;
      redraw();
      saveInfo({ pace_mode: mode });
    }));
    view.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-seg],[data-rp],[data-fuel]');
      if (!b) return;
      const inf = raceInfoOf(r);
      if (b.dataset.seg != null) {
        const n = Math.ceil(r.distance_m / 5000), adj = Array.from({ length: n }, (_, k) => (inf.pace_adj || [])[k] || 0), k = Number(b.dataset.seg);
        const v = await wheelPick(`${k * 5}〜${Math.min(k * 5 + 5, r.distance_m / 1000).toFixed(0)}km のペース調整`, [{ items: range(-20, 20, (x) => `${x > 0 ? '+' : ''}${x} 秒/km`), value: adj[k] }]);
        if (v) { adj[k] = v[0]; await saveInfo({ pace_adj: adj }); redraw(); }
      } else if (b.dataset.rp === 'loss') {
        const v = await wheelPick('スタートロス (号砲からスタートラインまで)', [{ items: range(0, 40, (x) => `${Math.floor(x * 15 / 60)}:${String((x * 15) % 60).padStart(2, '0')}`), value: Math.round((inf.start_loss_s || 0) / 15) }]);
        if (v) { await saveInfo({ start_loss_s: v[0] * 15 }); route(); }
      } else if (b.dataset.rp === 'start') {
        const cur = clockS(inf.start_time) ?? 9 * 3600;
        const v = await wheelPick('スタート時刻', [{ items: range(5, 14), value: Math.floor(cur / 3600), unit: ':' }, { items: range(0, 59, (x) => String(x).padStart(2, '0')), value: Math.floor((cur % 3600) / 60) }]);
        if (v) { await saveInfo({ start_time: `${v[0]}:${String(v[1]).padStart(2, '0')}` }); route(); }
      } else if (b.dataset.fuel === 'std') {
        const dist = r.distance_m / 1000;
        const pts = dist >= 40 ? [10, 17.5, 25, 32, 37] : dist >= 20 ? [8, 15] : [];
        await saveInfo({ fuel: pts.map((km) => ({ km, item: 'ジェル' })) }); redraw();
      } else if (b.dataset.fuel === 'add' || b.dataset.fuelEdit != null) {
        const list = [...(inf.fuel || [])], k = b.dataset.fuelEdit != null ? Number(b.dataset.fuelEdit) : -1, cur = k >= 0 ? list[k] : { km: 10, item: 'ジェル' };
        const v = await openDialog(`<h2>${k >= 0 ? '補給を編集' : '補給を追加'}</h2><div class="grid2"><label>地点 (km)<input name="km" inputmode="decimal" value="${cur.km}" required></label><label>内容<input name="item" value="${esc(cur.item)}" list="fuel-items" required></label></div>
          <datalist id="fuel-items"><option value="ジェル"><option value="ジェル (カフェイン)"><option value="塩タブレット"><option value="給水"><option value="スポーツドリンク"></datalist>`, k >= 0 ? { onDelete: async () => { list.splice(k, 1); await saveInfo({ fuel: list }); redraw(); } } : {});
        if (!v) return;
        const km = Math.max(0, Math.min(r.distance_m / 1000, Number(v.km)));
        if (!Number.isFinite(km)) return;
        const item = { km: Math.round(km * 10) / 10, item: String(v.item).slice(0, 30) };
        if (k >= 0) list[k] = item; else list.push(item);
        list.sort((a, b2) => a.km - b2.km);
        await saveInfo({ fuel: list }); redraw();
      }
    });
    // 目標タイムかペースのどちらかをホイールで選ぶと、もう一方とペース表が変わる (レースの目標として保存)
    view.querySelectorAll('[data-gp]').forEach((b) => (b.onclick = async () => {
      const km = r.distance_m / 1000;
      const cur = r.goal_time_s || Math.round(km * 300);
      let goal = null;
      if (b.dataset.gp === 'time') goal = await pickGoal('目標タイム', cur);
      else { const per = await pickPace('目標ペース', Math.round(cur / km)); if (per) goal = Math.round(per * km); }
      if (!goal || goal < 600) return;
      await api(`/races/${r.id}`, { method: 'PUT', body: { ...r, goal_time_s: goal } });
      route();
    }));
    // 項目のタブ: 押すとその場所へ。スクロールに合わせて選択を変える
    const tabs = [...view.querySelectorAll('.rd-tabs [data-go]')];
    const offset = () => (document.querySelector('header')?.getBoundingClientRect().height || 70) + (view.querySelector('.rd-tabs')?.getBoundingClientRect().height || 44) + 10;
    tabs.forEach((a) => (a.onclick = () => { const el = view.querySelector(`#rs-${a.dataset.go}`); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset(), behavior: 'smooth' }); }));
    const onScroll = () => {
      if (!document.body.contains(tabs[0])) { window.removeEventListener('scroll', onScroll); return; }
      let cur = 'about';
      for (const k of ['about', 'plan', 'prep', 'result']) { const el = view.querySelector(`#rs-${k}`); if (el && el.getBoundingClientRect().top < offset() + 30) cur = k; }
      tabs.forEach((a) => a.classList.toggle('on', a.dataset.go === cur));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    if (r.date > t) loadRaceReady(r);
    // 見出しの画像: 自動で作った景色 (おすすめ・都市・海辺の都市・海・山) か、自分の写真
    view.querySelector('#race-photo').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try { const url = await resizeImage(file, 900); await saveInfo({ image: url, hero: 'photo' }); route(); } catch (err) { alert(err.message); }
    };
    view.querySelector('.rd-photo').addEventListener('click', async (e) => {
      if (e.target.id === 'race-photo') return;
      e.preventDefault();
      const inf = raceInfoOf(r), cur = inf.hero || 'auto', rec = artThemeOf(r);
      const thumb = (th) => `<i class="art-th" style="background-image:url(&quot;data:image/svg+xml;charset=utf-8,${encodeURIComponent(raceArtSvg(th, r.id || r.name))}&quot;)"></i>`;
      const k = await actionSheet('見出しの画像', [
        { key: 'auto', label: 'おすすめ', sub: `大会名から: ${ART_THEMES[rec]}`, icon: thumb(rec), on: cur === 'auto' },
        ...Object.entries(ART_THEMES).map(([key, label]) => ({ key, label, icon: thumb(key), on: cur === key })),
        ...(inf.image ? [{ key: 'photo', label: '自分の写真', on: cur === 'photo' }] : []),
        { key: 'pick', label: inf.image ? '別の写真を選ぶ' : '写真を選ぶ' },
        { key: 'plain', label: '画像なし (色だけ)', on: cur === 'plain' },
        ...(inf.image ? [{ key: 'remove', label: '写真を削除', danger: true }] : []),
      ]);
      if (!k) return;
      if (k === 'pick') return view.querySelector('#race-photo').click();
      if (k === 'remove') { await saveInfo({ image: null, hero: cur === 'photo' ? 'auto' : cur }); return route(); }
      await saveInfo({ hero: k }); route();
    });
    view.querySelector('#edit-race').onclick = async () => { await editRace(r); };
    view.querySelector('#st-race').onclick = () => manageRace(r);
    if (r.date <= t) loadRaceResult(r);
    view.querySelector('#del-race').onclick = async () => { if (await deleteRace(r)) location.hash = '#/races'; };
    wireRaceInfo(view, r);
  });
  const wireChecks = () => {
    drawChecks();
    view.querySelector('#checks').addEventListener('change', (e) => {
      const id2 = e.target.dataset.ck;
      if (!id2) return;
      state.checked = e.target.checked ? [...state.checked, id2] : state.checked.filter((x) => x !== id2);
      drawChecks(); save();
    });
    view.querySelector('#checks').addEventListener('click', (e) => {
      const d = e.target.closest('[data-del]');
      if (!d) return;
      e.preventDefault();
      const did = d.dataset.del;
      if (tmpl.some((x) => x.id === did)) { tmpl = tmpl.filter((x) => x.id !== did); saveTmpl(); }
      state.custom = (state.custom || []).filter((x) => x.id !== did);
      state.checked = state.checked.filter((x) => x !== did);
      rebuild(); drawChecks(); save();
    });
    // 文言を直す (入力を離れたら保存)
    view.querySelector('#checks').addEventListener('change', (e) => {
      const eid = e.target.dataset.ed;
      if (!eid) return;
      const text = e.target.value.trim();
      if (!text) return;
      const tt = tmpl.find((x) => x.id === eid);
      if (tt) { tt.text = text; saveTmpl(); }
      const cc = (state.custom || []).find((x) => x.id === eid);
      if (cc) { cc.text = text; save(); }
      rebuild();
    });
    view.querySelector('#ck-edit').onclick = () => { editing = !editing; drawChecks(); };
    view.querySelector('#ck-reset').onclick = () => {
      if (!confirm('持ち物の一覧を最初の状態に戻します (全レース共通)')) return;
      tmpl = CHECK_ITEMS.map(([cat, iid, text]) => ({ cat, id: iid, text })); saveTmpl(); rebuild(); drawChecks();
    };
    view.querySelector('#ck-add').onsubmit = (e) => {
      e.preventDefault();
      const inp = view.querySelector('#ck-new');
      const text = inp.value.trim();
      if (!text) return;
      const cat = view.querySelector('#ck-cat').value;
      const it = { id: `c${Date.now().toString(36)}`, cat, text };
      if (cat === 'other') { state.custom = [...(state.custom || []), it]; save(); }
      else { tmpl = [...tmpl, it]; saveTmpl(); }
      rebuild();
      inp.value = '';
      drawChecks();
    };
  };
  const dleft = r.date >= t ? daysBetween(t, r.date) : null;
  const upcoming = dleft != null;
  const inf0 = raceInfoOf(r), st0r = r.status || 'confirmed';
  const est0 = inf0.date_estimated;
  return `
    <div class="card hero rd-hero ${raceHeroStyle(r).cls}" style="${raceHeroStyle(r).style}">
      <label class="rd-photo" aria-label="見出しの画像を選ぶ">${SVG('<rect x="3" y="6" width="18" height="14" rx="2"/><circle cx="12" cy="13" r="3.5"/><path d="M8 6l2-2h4l2 2"/>')}<input type="file" id="race-photo" accept="image/*" hidden></label>
      <div class="rl-top"><span class="rb rb-${upcoming ? st0r : r.result_time_s ? 'done' : 'past'}">${upcoming ? RACE_STATUS.find(([k]) => k === st0r)[1] : r.result_time_s ? '完走' : '終了'}</span>${r.priority === 'A' && st0r !== 'candidate' ? '<span class="rb rb-main">本命</span>' : `<span class="rb">優先度 ${esc(r.priority || '-')}</span>`}${est0 ? '<span class="rb rb-est">日付は暫定</span>' : ''}</div>
      <h2 class="rl-hname">${esc(r.name)}</h2>
      <div class="muted num">${r.date.slice(0, 4)}年${md(r.date)}(${dow(r.date)})${inf0.venue ? `・${esc(inf0.venue)}` : ''}・${km(r.distance_m, 3)}km</div>
      <div class="rl-hrow"><div>${!upcoming ? '<span class="muted">終了</span>' : est0 ? '<span class="muted">開催日が決まったら残り日数を出します</span>' : `あと <b class="big num">${dleft}</b> 日`}</div>
        <div class="rl-hgoal num"><small>目標</small><b>${r.goal_time_s ? dur(r.goal_time_s) : '未設定'}</b>${r.goal_time_s ? `<small>平均 ${pace(r.goal_time_s / (r.distance_m / 1000))}/km</small>` : ''}</div></div>
    </div>
    <div class="rd-tiles">
      <div class="hl-tile"><small>目標</small><b class="num">${r.goal_time_s ? dur(r.goal_time_s) : '-'}</b></div>
      <div class="hl-tile"><small>平均ペース</small><b class="num">${r.goal_time_s ? `${pace(r.goal_time_s / (r.distance_m / 1000))}<small>/km</small>` : '-'}</b></div>
      <div class="hl-tile"><small>スタート</small><b class="num">${myStartClock(r) != null ? clockTxt(myStartClock(r)) : esc(inf0.start_time || '-')}</b></div>
    </div>
    <div class="rd-tabs" role="tablist" aria-label="レースの項目">${[['about', '概要'], ['plan', '戦略'], ['prep', '準備'], ['result', '実績']].map(([k, l], i) => `<a href="javascript:void 0" data-go="${k}" class="${i === 0 ? 'on' : ''}">${l}</a>`).join('')}</div>
    <div id="rs-about" class="rd-sec">
    ${raceInfoCard(r)}
    <div id="rd-wx"></div>
    </div>
    <div id="rs-plan" class="rd-sec">
    <div class="card"><h2>ペース・補給プラン</h2>
      <div class="gp2">
        <button type="button" class="gp-t" data-gp="time"><small>目標タイム</small><b class="num">${r.goal_time_s ? dur(r.goal_time_s) : '未設定'}</b></button>
        <button type="button" class="gp-t" data-gp="pace"><small>平均ペース</small><b class="num">${r.goal_time_s ? `${pace(r.goal_time_s / (r.distance_m / 1000))}<span>/km</span>` : '-'}</b></button>
      </div>
      <p class="muted hint" style="margin:0 0 12px">タップして選ぶと、ペース表も変わります。</p>
      ${r.goal_time_s ? `<div class="chips pm3" style="margin-bottom:10px">${Object.entries(PACE_PLANS).map(([k, v]) => `<button type="button" class="chip ${k === mode ? 'on' : ''}" data-pm="${k}">${v.label}</button>`).join('')}</div>
      <p class="muted" id="pace-note" style="margin-top:0">${PACE_PLANS[mode].note}</p>` : ''}
      ${r.goal_time_s ? `<div class="rp-tiles"><button type="button" class="ri-tile" data-rp="loss"><small>スタートロス</small><b class="num">${mmss(raceInfoOf(r).start_loss_s || 0)}</b></button><button type="button" class="ri-tile" data-rp="start"><small>スタート時刻</small><b class="num">${myStartClock(r) != null ? clockTxt(myStartClock(r) - (raceInfoOf(r).start_loss_s || 0)) : '未設定'}</b></button></div>` : ''}
      <div id="pace-out">${splitTable(r, mode)}</div>
    </div>
    <div id="rp-extra">${racePlanExtras(r, mode)}</div>
    </div>
    <div id="rs-prep" class="rd-sec">
    ${upcoming ? `<div class="card"><div class="row spread"><h2>持ち物</h2><div class="row" style="gap:8px;align-items:center"><b class="num" id="ck-prog"></b><button type="button" class="chip" id="ck-edit">編集</button></div></div>
      <div class="bar" style="margin:6px 0 10px"><div id="ck-bar" style="width:0"></div></div>
      <div id="checks"></div>
      <form id="ck-add" class="ck-add hidden">
        <p class="muted" style="margin:0 0 8px">「前日まで」「当日の朝」はすべてのレースで共通です。「このレースだけ」はこのレースにだけ入ります。</p>
        <div class="row" style="gap:8px"><select id="ck-cat"><option value="prep">前日まで</option><option value="morning">当日の朝</option><option value="other">このレースだけ</option></select>
        <input id="ck-new" placeholder="追加 (例: 梅干し)" style="flex:1;min-width:0" maxlength="60"><button class="primary">追加</button></div>
        <button type="button" class="linkbtn" id="ck-reset" style="margin-top:10px">最初の一覧に戻す</button>
      </form>
    </div>` : '<div class="card"><h2>持ち物</h2><p class="muted">大会は終了しました。</p></div>'}
    </div>
    <div id="rs-result" class="rd-sec">
    ${r.date <= t ? '<div id="race-result"></div>' : `<div class="card" id="race-ready"><h2>目標への準備状況</h2><p class="muted">読み込み中…</p></div>`}
    </div>
    <div class="rd-acts">
      <button type="button" id="st-race">${ST_ICON[r.status || 'confirmed']}<span><small>状態</small>${RACE_STATUS.find(([k]) => k === (r.status || 'confirmed'))[1]}</span></button>
      <button type="button" id="edit-race">${SVG('<path d="M4 20h4L19 9l-4-4L4 16z"/>')}<span><small>大会名・日付・目標</small>編集</span></button>
    </div>
    <button id="del-race" class="linkdanger">このレースを削除</button>`;
}

// ---- レースの状態と大会情報
const searchUrl = (name) => `https://www.google.com/search?q=${encodeURIComponent(`${String(name).replace(/\s*\(.*?\)\s*/g, '').replace(/20\d\d$/, '')} 公式サイト`)}`;
/** 入力された URL を整える (https:// が無ければ付ける・二重になっていれば 1 つに・貼り付けた文章から URL だけ取り出す) */
function normUrl(v) {
  let u = String(v || '').trim();
  if (!u) return null;
  const m = u.match(/https?:\/\/[^\s"'<>、。）)]+/g);
  if (m) u = m[m.length - 1];
  const http = /^(https?:\/\/)*http:\/\//i.test(u) && !/^https:/i.test(u);
  u = u.replace(/^(https?:\/\/)+/i, '').replace(/^\/+/, '');
  if (!/^[^\s/]+\.[^\s/]+/.test(u)) return null;
  return `${http ? 'http' : 'https'}://${u}`;
}
/** 下から出る選択シート (iPhone 風)。押したらすぐ決まる。opts: [{key, label, sub, icon, on, danger}] */
function actionSheet(title, opts) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'sheet asheet';
    el.innerHTML = `<div class="sheet-bg"></div><div class="sheet-body">
      <div class="as-grab"></div><div class="as-title">${title}</div>
      <div class="as-list">${opts.map((o) => `<button type="button" class="as-row ${o.on ? 'on' : ''} ${o.danger ? 'danger' : ''}" data-k="${o.key}">
        <span class="as-ic">${o.icon || ''}</span><span class="as-t"><b>${o.label}</b>${o.sub ? `<small>${o.sub}</small>` : ''}</span>
        ${o.on ? '<svg class="as-ck" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : ''}</button>`).join('')}</div>
      <button type="button" class="as-cancel">キャンセル</button></div>`;
    document.body.appendChild(el);
    const done = (k) => { el.classList.add('out'); setTimeout(() => el.remove(), 160); resolve(k); };
    el.querySelector('.sheet-bg').onclick = () => done(null);
    el.querySelector('.as-cancel').onclick = () => done(null);
    el.querySelectorAll('.as-row').forEach((b) => (b.onclick = () => done(b.dataset.k)));
  });
}
const SVG = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ST_ICON = {
  candidate: SVG('<path d="M7 4h10v16l-5-3.5L7 20z"/>'),
  entered: SVG('<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/>'),
  confirmed: SVG('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
};
const ST_SUB = { candidate: '出るか検討中 (計画には入れない)', entered: '申し込んだ・抽選や入金の結果待ち', confirmed: '出場が決まった' };
/** 公式サイトをアプリの中で探して選ぶ (Wikipedia の公式サイト欄・検索結果)。選んだ URL を返す */
async function pickSite(name, btn) {
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = '探しています…'; }
  let list = [];
  try { list = (await api(`/races/find-site?name=${encodeURIComponent(name)}`)).list || []; } catch {}
  if (btn) { btn.disabled = false; btn.textContent = label; }
  const host = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return u; } };
  const k = await actionSheet(`${esc(name)} の公式サイト`, [
    ...list.map((c, i) => ({ key: `c${i}`, label: esc(c.title || host(c.url)).slice(0, 60), sub: `${esc(host(c.url))}${c.source === 'wikipedia' ? '・Wikipedia より' : ''}`, icon: SVG('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'), on: i === 0 && c.source === 'wikipedia' })),
    ...(list.length ? [] : [{ key: 'none', label: '見つかりませんでした', sub: '下の 2 つから探せます', icon: SVG('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>') }]),
    { key: 'type', label: 'URL を自分で入れる', sub: 'https:// は無くても大丈夫', icon: SVG('<path d="M4 20h4L19 9l-4-4L4 16z"/>') },
    { key: 'google', label: 'Google で探す', sub: '見つけた URL をコピーして「自分で入れる」へ', icon: SVG('<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>') },
  ]);
  if (!k || k === 'none') return null;
  if (k === 'google') { window.open(searchUrl(name), '_blank', 'noopener'); return null; }
  if (k === 'type') return normUrl(prompt('公式サイトの URL', ''));
  return list[Number(k.slice(1))]?.url || null;
}
/** 状態を変える (下から出るシート) */
async function manageRace(r) {
  if (!r) return;
  const cur = r.status || 'confirmed';
  const k = await actionSheet(esc(r.name), RACE_STATUS.map(([key, label]) => ({ key, label, sub: ST_SUB[key], icon: ST_ICON[key], on: key === cur })));
  if (!k || k === cur) return;
  await api(`/races/${r.id}`, { method: 'PUT', body: { ...r, status: k } });
  route();
}
async function deleteRace(r) {
  if (!confirm(`「${r.name}」を削除しますか？`)) return false;
  await api(`/races/${r.id}`, { method: 'DELETE' });
  return true;
}
/** 左にスライドすると「状態」「削除」が出る行 */
function wireSwipe(root, onAct) {
  let openEl = null;
  const W = 152;
  const setX = (el, x, anim) => { el.style.transition = anim ? 'transform .2s ease' : 'none'; el.style.transform = x ? `translateX(${x}px)` : ''; };
  const close = () => { if (openEl) { setX(openEl, 0, true); openEl.closest('.sw').classList.remove('open'); openEl = null; } };
  root.querySelectorAll('.sw-front').forEach((f) => {
    let x0 = 0, y0 = 0, dx = 0, mode = null, base = 0, moved = false;
    f.addEventListener('pointerdown', (e) => { x0 = e.clientX; y0 = e.clientY; dx = 0; mode = null; moved = false; base = openEl === f ? -W : 0; if (openEl && openEl !== f) close(); });
    f.addEventListener('pointermove', (e) => {
      if (e.buttons === 0 && e.pointerType === 'mouse') return;
      const ddx = e.clientX - x0, ddy = e.clientY - y0;
      if (!mode) { if (Math.abs(ddx) > 8 && Math.abs(ddx) > Math.abs(ddy)) { mode = 'h'; f.setPointerCapture(e.pointerId); } else if (Math.abs(ddy) > 8) mode = 'v'; }
      if (mode !== 'h') return;
      moved = true; dx = ddx;
      setX(f, Math.max(-W - 30, Math.min(0, base + dx)), false);
    });
    const end = () => {
      if (mode !== 'h') return;
      const x = base + dx;
      if (x < -W / 2) { setX(f, -W, true); openEl = f; f.closest('.sw').classList.add('open'); } else { setX(f, 0, true); if (openEl === f) openEl = null; f.closest('.sw').classList.remove('open'); }
      mode = null;
    };
    f.addEventListener('pointerup', end); f.addEventListener('pointercancel', end);
    f.addEventListener('click', (e) => {
      if (moved) { e.preventDefault(); e.stopPropagation(); moved = false; return; }
      if (openEl) { e.preventDefault(); e.stopPropagation(); close(); return; }
      onAct('open', f.closest('.sw').dataset.id);
    });
  });
  root.querySelectorAll('.sw-act').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const id = b.closest('.sw').dataset.id; close(); onAct(b.dataset.act, id); }));
}
const RACE_STATUS = [['candidate', 'エントリー候補'], ['entered', 'エントリー済み'], ['confirmed', '出場決定']];
const raceInfoOf = (r) => { try { return typeof r.info === 'string' ? JSON.parse(r.info) : r.info || {}; } catch { return {}; } };
const fmtD = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? `${md(d)}(${dow(d)})` : esc(d || ''));
/** 一覧の 1 行: エントリー期間 (候補・エントリー済みのとき) */
const seasonOf = (d) => { const dd = Number(d.slice(8, 10)); return `${Number(d.slice(5, 7))}月${dd <= 10 ? '上旬' : dd <= 20 ? '中旬' : '下旬'}`; };
const histKey = (n) => String(n).replace(/\s*\(.*?\)\s*/g, '').replace(/20\d\d|第\d+回|[\s・]/g, '');
const histOf = (name) => { const h = ENTRY_HIST[histKey(name)]; return h && h.length ? h[h.length - 1] : null; };
function entryLine(r, t, noStatus = false) {
  const inf = raceInfoOf(r);
  const st = r.status || 'confirmed';
  if (r.date < t) return '';
  const label = RACE_STATUS.find(([k]) => k === st)[1];
  const icon = ST_ICON[st].replace(/width="20" height="20"/, 'width="14" height="14"');
  const bits = [];
  if (st === 'confirmed' && inf.my_block) bits.push(`${esc(inf.my_block)}ブロック${inf.bib ? `・No.${esc(inf.bib)}` : ''}`);
  if (st === 'entered' && inf.lottery_result) bits.push(`抽選発表 ${fmtD(inf.lottery_result)}`);
  let entry = '';
  if (st === 'candidate') {
    if (inf.entry_open || inf.entry_close) {
      const left = inf.entry_close && /^\d{4}-/.test(inf.entry_close) ? daysBetween(t, inf.entry_close) : null;
      const before = inf.entry_open && /^\d{4}-/.test(inf.entry_open) && inf.entry_open > t;
      entry = `<div class="num entry-l">エントリー ${fmtD(inf.entry_open)}〜${fmtD(inf.entry_close)}${before ? ` <b class="warn-t">開始まで${daysBetween(t, inf.entry_open)}日</b>` : left != null && left >= 0 ? ` <b class="warn-t">締切まで${left}日</b>` : left != null ? '（締切済み）' : ''}</div>`;
    } else if (inf.entry_last_open || histOf(r.name)) {
      // 今回分はまだ発表されていない: 前回のエントリー期間から「例年○月○旬ごろ」
      const h = inf.entry_last_open ? { open: inf.entry_last_open, close: inf.entry_last_close } : histOf(r.name);
      entry = `<div class="num entry-l"><span class="rf-entry">エントリー 例年${seasonOf(h.open)}ごろ開始 (前回 ${md(h.open)}〜${h.close && /^\d{4}-/.test(h.close) ? md(h.close) : ''})</span></div>`;
    } else {
      // 公式サイトの情報がまだ無いときは、大会の一覧の開始日か、例年・一般的な目安
      const c = RACE_CATALOG.find((x) => baseName(x[0]) === baseName(r.name));
      const x = c ? { month: c[2], dist: c[3], entry: c[6], known: !!(c[5] && c[5] >= t && c[5] === r.date) }
        : { month: Number(r.date.slice(5, 7)), dist: r.distance_m >= 40000 ? 'full' : 'half', entry: '' };
      entry = `<div class="entry-l">${entryHint(x, null, t, true)}</div>`;
    }
  }
  // noStatus: 状態はバッジで出しているので、ブロック・抽選発表・エントリー期間だけ (レース一覧)
  if (noStatus) return `${bits.length ? `<div class="muted num rl-bits">${bits.join('・')}</div>` : ''}${entry}`;
  return `<div class="rl-st st-${st}">${icon}<b>${label}</b>${bits.length ? `<span>${bits.join('・')}</span>` : ''}</div>${entry}`;
}
/** レース詳細の「大会情報」カード */
function raceInfoCard(r) {
  const inf = raceInfoOf(r);
  const blk = (inf.blocks || []).find((b) => inf.my_block && b.name.replace(/ブロック/, '') === String(inf.my_block).replace(/ブロック/, ''));
  const rows = [
    ['スタート', blk?.start || inf.start_time ? `${esc(blk?.start || inf.start_time)}${blk?.start ? `（${esc(blk.name)}ブロック）` : ''}` : null],
    ['整列締め切り', blk?.close || inf.line_close ? `<b class="warn-t">${esc(blk?.close || inf.line_close)}</b>${blk?.close ? `（${esc(blk.name)}ブロック）` : ''}` : null],
    ['制限時間', inf.time_limit && esc(inf.time_limit)],
    ['会場', inf.venue && esc(inf.venue)],
    ['受付', inf.reception && esc(inf.reception)],
    ['手荷物', inf.baggage && esc(inf.baggage)],
    ['給水・給食', inf.aid && esc(inf.aid)],
    ['アクセス', inf.access && esc(inf.access)],
  ].filter(([, v]) => v);
  // エントリー期間・参加料は当日には要らないので折りたたむ
  const entryRows = [
    ['エントリー', inf.entry_open || inf.entry_close ? `${fmtD(inf.entry_open)}〜${fmtD(inf.entry_close)}` : null],
    ['抽選発表', inf.lottery_result && fmtD(inf.lottery_result)],
    ['参加料', inf.fee && esc(inf.fee)],
  ].filter(([, v]) => v);
  const cut = inf.cutoffs || [];
  const blocks = inf.blocks || [];
  const has = rows.length || cut.length;
  return `<div class="card rinfo"><div class="row spread"><h2>大会情報</h2>${r.url ? `<a class="muted" href="${esc(r.url)}" target="_blank" rel="noopener">公式サイト ↗</a>` : `<button type="button" class="linkbtn" data-ri="find" style="margin:0">公式サイトを探す</button>`}</div>
    ${inf.date_estimated ? `<p class="ri-est">日付は仮です (例年の月から)。公式サイトから取り込むと正しい日付に直ります。</p>` : ''}
    <div class="ri-me">
      <button type="button" class="ri-tile" data-ri="block"><small>自分のブロック</small><b>${inf.my_block ? esc(inf.my_block) : '未設定'}</b></button>
      <button type="button" class="ri-tile" data-ri="bib"><small>ゼッケン</small><b class="num">${inf.bib ? esc(inf.bib) : '未設定'}</b></button>
    </div>
    ${has ? `<dl class="ri-dl">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : '<p class="muted" style="margin:10px 0">公式サイトから、スタート時刻・整列締め切り・関門・受付などを取り込めます。</p>'}
    ${entryRows.length ? `<details class="ri-more"><summary>エントリー情報</summary><dl class="ri-dl" style="margin-top:8px">${entryRows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl></details>` : ''}
    ${blocks.length > 1 ? `<details class="ri-more"><summary>ブロックごとのスタート (${blocks.length})</summary><table class="ri-t num"><tr><th>ブロック</th><th>スタート</th><th>整列締切</th></tr>${blocks.map((b) => `<tr class="${blk === b ? 'me' : ''}"><td>${esc(b.name)}</td><td>${esc(b.start || '-')}</td><td>${esc(b.close || '-')}</td></tr>`).join('')}</table></details>` : ''}
    ${cut.length ? `<details class="ri-more" ${r.date >= today() ? 'open' : ''}><summary>関門 (${cut.length})</summary><table class="ri-t num"><tr><th>距離</th><th>閉鎖</th><th>場所</th></tr>${cut.map((x) => `<tr><td>${x.km}km</td><td>${esc(x.time)}</td><td>${esc(x.place || '')}</td></tr>`).join('')}</table></details>` : ''}
    <div class="ri-acts">
      <button type="button" data-ri="fetch">${r.url ? '公式サイトから取り込む' : 'サイトを探して取り込む'}</button>
      <button type="button" data-ri="paste">文章を貼り付ける</button>
    </div>
    ${inf.updated ? `<p class="muted" style="margin:8px 0 0;font-size:12px">${md(inf.updated)} に取り込み。内容は公式サイトで必ず確かめてください。</p>` : ''}
  </div>`;
}
function wireRaceInfo(root, r) {
  const save = async (info, extra = {}) => { await api(`/races/${r.id}`, { method: 'PUT', body: { ...r, ...extra, info, no_auto: true } }); route(); };
  const merge = (cur, got) => {
    const out = { ...cur };
    for (const [k, v] of Object.entries(got)) if (!['my_block', 'bib', 'chars', 'date_estimated', 'updated'].includes(k) && v != null && !(Array.isArray(v) && !v.length)) out[k] = v;
    out.updated = today();
    return out;
  };
  const preview = (got) => {
    const n = Object.entries(got).filter(([k, v]) => !['source', 'chars'].includes(k) && v != null && !(Array.isArray(v) && !v.length)).length;
    if (!n) { alert('大会情報が見つかりませんでした。要項のページの URL か、要項の文章を貼り付けてください。'); return false; }
    const L = [got.race_date && `開催日 ${fmtD(got.race_date)}`, got.start_time && `スタート ${got.start_time}`, got.line_close && `整列締め切り ${got.line_close}`, got.blocks?.length && `ブロック ${got.blocks.length}`, got.time_limit && `制限時間 ${got.time_limit}`, got.cutoffs?.length && `関門 ${got.cutoffs.length}か所`, got.reception && '受付', got.entry_close && `エントリー締切 ${got.entry_close}`].filter(Boolean);
    return confirm(`${n} 項目を読み取りました。\n${L.join('\n')}\n\nこの内容で大会情報を上書きしますか？ (自分のブロック・ゼッケンはそのまま)`);
  };
  const run = async (body, btn) => {
    const label = btn.textContent; btn.disabled = true; btn.textContent = '読み取り中…';
    try {
      const got = await api(`/races/${r.id}/extract`, { method: 'POST', body });
      if (!preview(got)) { btn.disabled = false; btn.textContent = label; return; }
      const cur = raceInfoOf(r), next = merge(cur, got), extra = body.url ? { url: body.url } : {};
      if (got.race_date && got.race_date >= today() && (cur.date_estimated || got.race_date !== r.date) && (cur.date_estimated || confirm(`公式サイトの開催日は ${fmtD(got.race_date)} です。日付をこの日に直しますか？`))) { extra.date = got.race_date; delete next.date_estimated; }
      delete next.race_date;
      await save(next, extra);
    }
    catch (e) { alert(e.message); }
    btn.disabled = false; btn.textContent = label;
  };
  root.querySelectorAll('[data-ri]').forEach((b) => (b.onclick = async () => {
    const k = b.dataset.ri, inf = raceInfoOf(r);
    if (k === 'fetch' || k === 'find') {
      let url = k === 'fetch' ? r.url : null;
      if (!url) { url = await pickSite(r.name, b); if (!url) return; }
      return run({ url }, b);
    }
    if (k === 'paste') {
      const v = await openDialog(`<h2>文章を貼り付けて取り込む</h2><p class="muted">公式サイトや PDF の大会要項を、まとめてコピーして貼り付けます。</p><textarea name="text" rows="10" style="width:100%" required></textarea>`);
      if (v?.text) return run({ text: v.text }, b);
      return;
    }
    if (k === 'block') {
      const names = (inf.blocks || []).map((x) => x.name);
      const v = names.length
        ? await openDialog(`<h2>自分のブロック</h2><div class="chips">${['', ...names].map((n) => `<label class="seg-r chip-r"><input type="radio" name="v" value="${esc(n)}" ${(inf.my_block || '') === n ? 'checked' : ''}><span>${n ? esc(n) : 'なし'}</span></label>`).join('')}</div>`)
        : await openDialog(`<h2>自分のブロック</h2><input name="v" value="${esc(inf.my_block || '')}" placeholder="例: C" maxlength="20">`);
      if (v) return save({ ...inf, my_block: v.v || null });
      return;
    }
    if (k === 'bib') {
      const v = await openDialog(`<h2>ゼッケン番号</h2><input name="v" value="${esc(inf.bib || '')}" inputmode="numeric" maxlength="20">`);
      if (v) return save({ ...inf, bib: v.v || null });
    }
  }));
}


// ---- 大会を探す (主な大会の一覧から、エントリー候補に追加)
let FIND = { area: '', when: '', dist: '' };
try { FIND = { ...FIND, ...JSON.parse(localStorage.getItem('race-find') || '{}') }; } catch {}
/** 次に開かれる日の目安 (例年の月の第 2 日曜) */
function nextOccur(month) {
  const t = today();
  for (const y of [Number(t.slice(0, 4)), Number(t.slice(0, 4)) + 1]) {
    const first = new Date(Date.UTC(y, month - 1, 1));
    const d = new Date(first.getTime() + (((7 - first.getUTCDay()) % 7) + 7) * 86400000).toISOString().slice(0, 10);
    if (d >= t) return d;
  }
}
const baseName = (n) => String(n).replace(/\s*\(.*?\)\s*/g, '').replace(/20\d\d|[\s・]/g, '');
const RF_OPEN = new Set();
let RF_Q = '';
/** エントリー時期: 公式サイトで読んだ期間 → 分かっている開始日 → 例年の時期 の順。short は一覧用 */
function entryHint(x, got, t, short) {
  const cls = (warn) => `class="rf-entry num ${warn ? 'warn-t' : ''}"`;
  if (got && (got.entry_open || got.entry_close)) {
    const left = got.entry_close && /^\d{4}-/.test(got.entry_close) ? daysBetween(t, got.entry_close) : null;
    const open = got.entry_open && /^\d{4}-/.test(got.entry_open) && got.entry_open > t;
    const txt = `エントリー ${fmtD(got.entry_open)}〜${fmtD(got.entry_close)}${open ? '' : left != null && left >= 0 ? `・締切まで${left}日` : left != null ? '・締切済み' : ''}`;
    return `<span ${cls(left != null && left >= 0 && left <= 30 || open)}>${txt}</span>`;
  }
  if (x.entry) {
    const m = Number(x.entry.slice(5, 7)), dd = Number(x.entry.slice(8, 10));
    const part = dd <= 10 ? '上旬' : dd <= 20 ? '中旬' : '下旬';
    if (x.known && x.entry > t) return `<span ${cls(daysBetween(t, x.entry) <= 45)}>エントリー ${fmtD(x.entry)} 開始予定</span>`;
    if (x.known) return `<span ${cls(false)}>エントリー ${md(x.entry)}〜 (開始済み・締切は公式サイトで)</span>`;
    return `<span ${cls(false)}>エントリー 例年${m}月${part}ごろ開始</span>`;
  }
  // 分からない大会: 一般的な目安 (フルは 4〜7 か月前、ハーフは 2〜4 か月前)
  const back = x.dist === 'full' ? [7, 4] : [4, 2];
  const mm = (k) => ((x.month - k - 1 + 24) % 12) + 1;
  return `<span ${cls(false)}>エントリー 目安 ${mm(back[0])}〜${mm(back[1])}月ごろ${short ? '' : ' (一般的な時期。公式サイトで確認)'}</span>`;
}
/** 大会の詳細 (公式サイトから読んだもの)。開いたときだけ読む (同じ URL はサーバーが 1 週間覚えておく) */
function rfDetail(x, got) {
  const known = x.known;
  const lines = [
    ['開催日', `${fmtD(x.when)}${known ? '' : '（例年の月からの目安）'}`],
    ['場所', `${esc(x.pref)}（${esc(x.area)}）`],
    ['種目', x.dist === 'full' ? 'フルマラソン' : 'ハーフマラソン'],
  ];
  if (!got || !(got.entry_open || got.entry_close)) lines.push(['エントリー', entryHint(x, null, today(), false)]);
  if (got) {
    if (got.race_date && got.race_date !== x.when) lines[0] = ['開催日', `${fmtD(got.race_date)}（公式サイト）`];
    const add = (k, v) => v && lines.push([k, esc(v)]);
    if (got.entry_open || got.entry_close) lines.push(['エントリー', `${fmtD(got.entry_open)}〜${fmtD(got.entry_close)}`]);
    if (got.lottery_result) lines.push(['抽選発表', fmtD(got.lottery_result)]);
    add('参加料', got.fee); add('スタート', got.start_time); add('制限時間', got.time_limit); add('会場', got.venue); add('受付', got.reception);
    if (got.cutoffs?.length) lines.push(['関門', `${got.cutoffs.length}か所（最初 ${got.cutoffs[0].km}km ${esc(got.cutoffs[0].time)}）`]);
  }
  const link = x.url ? `<a class="chip" href="${esc(x.url)}" target="_blank" rel="noopener">公式サイト ↗</a>` : '';
  return `<dl class="ri-dl">${lines.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
    <div class="rf-acts">${link}${got ? '' : x.url ? `<button type="button" class="chip" data-rfread="${esc(x.name)}">公式サイトから詳しく読む</button>` : `<button type="button" class="chip" data-rfurl="${esc(x.name)}">公式サイトを探して詳しく読む</button>`}</div>
    ${got ? '<p class="muted" style="font-size:11.5px;margin:6px 0 0">公式サイトから AI で読み取った内容です。申し込み前に公式サイトで確かめてください。</p>' : ''}`;
}
async function raceFindView() {
  const races = await api('/races');
  const t = today();
  const have = new Map(races.filter((r) => r.date >= t).map((r) => [baseName(r.name), r]));
  const monthsAhead = (d) => Math.round((Date.parse(d) - Date.parse(t)) / (30.4 * 86400000));
  const list = RACE_CATALOG.map(([name, pref, month, dist, url, date, entry]) => {
    const known = !!(date && date >= t);
    return { name, pref, month, dist, url, entry, area: areaOf(pref), known, when: known ? date : nextOccur(month) };
  }).sort((a, b) => a.when.localeCompare(b.when));
  const WHEN = [['', 'すべて'], ['3', '3か月以内'], ['6', '4〜6か月'], ['12', '7か月以降']];
  const norm = (v) => String(v).toLowerCase().replace(/[\s・ー-]/g, '');
  const pass = (x) => (!RF_Q || norm(x.name + x.pref).includes(norm(RF_Q)))
    && (RF_Q || ((!FIND.area || x.area === FIND.area) && (!FIND.dist || x.dist === FIND.dist)
    && (!FIND.when || (() => { const m = monthsAhead(x.when); return FIND.when === '3' ? m <= 3 : FIND.when === '6' ? m > 3 && m <= 6 : m > 6; })())));
  const chips = (key, opts) => `<div class="fchips">${opts.map(([v, l]) => `<button type="button" class="chip ${FIND[key] === v ? 'on' : ''}" data-f="${key}:${v}">${l}</button>`).join('')}</div>`;
  const cache = raceFindView.cache || (raceFindView.cache = new Map());
  const rowHtml = (x) => {
    const got = have.get(baseName(x.name));
    const open = RF_OPEN.has(x.name);
    return `<li class="rf ${open ? 'open' : ''}" data-name="${esc(x.name)}">
      <div class="rf-top">
        <button type="button" class="rf-main" data-rfopen="${esc(x.name)}"><b>${esc(x.name)}</b><span class="muted num">${x.known ? fmtD(x.when) : `例年${x.month}月`}・${esc(x.pref)}・${x.dist === 'full' ? 'フル' : 'ハーフ'}</span>${entryHint(x, cache.get(x.name), t, true)}<span class="rf-msg muted"></span></button>
        ${got ? `<a class="chip on" href="#/races/${got.id}">${RACE_STATUS.find(([k]) => k === (got.status || 'confirmed'))[1]}</a>` : `<button type="button" class="chip" data-addc="${esc(x.name)}">候補に追加</button>`}
      </div>
      ${open ? `<div class="rf-detail">${rfDetail(x, cache.get(x.name))}</div>` : ''}
    </li>`;
  };
  const readDetail = async (x, url, btn) => {
    btn.disabled = true; btn.textContent = '読み取り中…';
    try {
      const got = await api('/races/preview', { method: 'POST', body: { name: x.name, date: x.when, url } });
      if (!x.url) x.url = url;
      cache.set(x.name, got);
    } catch (e) { alert(e.message); }
    route();
  };
  const addRace = async (x, b, msg) => {
    b.disabled = true; b.textContent = '追加中…';
    try {
      const pre = cache.get(x.name);
      const date = pre?.race_date && pre.race_date >= today() ? pre.race_date : x.when;
      const est = !(x.known || (pre?.race_date && pre.race_date >= today()));
      const info = pre ? { ...pre, updated: today() } : {};
      delete info.chars; delete info.race_date;
      if (est) info.date_estimated = true;
      const r = await api('/races', { method: 'POST', body: { name: `${x.name.replace(/\s*\(.*?\)\s*/g, '')}${date.slice(0, 4)}`, date, distance_m: x.dist === 'full' ? 42195 : 21097.5, priority: 'B', status: 'candidate', url: x.url || null, info, no_auto: true } });
      b.outerHTML = `<a class="chip on" href="#/races/${r.id}">エントリー候補</a>`;
      if (!x.url && !pre) {
        // 公式サイトが一覧に無い大会: アプリで探して、Wikipedia の公式サイト欄で見つかればそれを使う
        msg.textContent = '公式サイトを探しています…';
        let hit = null;
        try { hit = ((await api(`/races/find-site?name=${encodeURIComponent(x.name)}`)).list || []).find((c) => c.source === 'wikipedia'); } catch {}
        if (!hit) { msg.textContent = '追加しました (公式サイトは大会の詳細の「公式サイトを探す」から)'; return; }
        x.url = hit.url; r.url = hit.url;
      }
      if (pre) { msg.innerHTML = '追加しました'; return; }
      msg.textContent = '公式サイトからエントリー期間などを読み取り中…';
      try {
        const got = await api(`/races/${r.id}/extract`, { method: 'POST', body: { url: x.url } });
        const inf2 = { ...got, updated: today() };
        delete inf2.chars;
        let d2 = r.date;
        if (got.race_date && got.race_date >= today()) d2 = got.race_date; else if (est) inf2.date_estimated = true;
        delete inf2.race_date;
        await api(`/races/${r.id}`, { method: 'PUT', body: { ...r, date: d2, info: inf2, no_auto: true } });
        msg.innerHTML = `${inf2.date_estimated ? '日付はまだ仮です' : `${fmtD(d2)} 開催`}${got.entry_close ? `・エントリー締切 ${fmtD(got.entry_close)}` : got.entry_open ? `・エントリー開始 ${fmtD(got.entry_open)}` : ''}`;
      } catch (e) {
        await api(`/races/${r.id}`, { method: 'PUT', body: { ...r, no_auto: true } }).catch(() => null);
        msg.textContent = `追加しました (公式サイトは読めませんでした: ${e.message})`;
      }
    } catch (e) { b.disabled = false; b.textContent = '候補に追加'; msg.textContent = e.message; }
  };
  setTimeout(() => {
    view.querySelectorAll('[data-f]').forEach((b) => (b.onclick = () => {
      const [k, v] = b.dataset.f.split(':');
      FIND[k] = FIND[k] === v ? '' : v;
      try { localStorage.setItem('race-find', JSON.stringify(FIND)); } catch {}
      route();
    }));
    const q = view.querySelector('#rf-q');
    q.oninput = () => {
      RF_Q = q.value.trim();
      const shown = list.filter(pass);
      view.querySelector('#rf-count').textContent = `${shown.length}大会`;
      view.querySelector('#rf-body').innerHTML = shown.length ? `<ul class="list rf-list">${shown.map(rowHtml).join('')}</ul>` : '';
      view.querySelector('#rf-own').classList.toggle('hidden', !RF_Q);
      view.querySelector('#rf-own-name').textContent = RF_Q;
      view.querySelector('.rf-filter').classList.toggle('dim', !!RF_Q);
    };
    view.addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b || !view.contains(b)) return;
      const d = b.dataset;
      const x = list.find((y) => y.name === (d.rfopen || d.addc || d.rfread || d.rfurl));
      if (d.rfopen) { RF_OPEN.has(x.name) ? RF_OPEN.delete(x.name) : RF_OPEN.add(x.name); const li = b.closest('li'); li.outerHTML = rowHtml(x); return; }
      if (d.addc) return addRace(x, b, b.closest('li').querySelector('.rf-msg'));
      if (d.rfread) return readDetail(x, x.url, b);
      if (d.rfurl) { const u = await pickSite(x.name, b); if (u) readDetail(x, u, b); return; }
      if (b.id === 'rf-own-add') {
        const v = await openDialog(`<h2>大会を候補に追加</h2>
          <label>大会名<input name="name" value="${esc(RF_Q)}" required></label>
          <label>公式サイト (分かれば)<input name="url" type="text" inputmode="url" autocapitalize="off" placeholder="例: xxx-marathon.jp"></label>
          <div class="grid2"><label>開催日 (分かれば)<input type="date" name="date"></label>
          <label>種目<select name="dist"><option value="42195">フル</option><option value="21097.5">ハーフ</option><option value="10000">10K</option></select></label></div>
          <p class="muted" style="font-size:12.5px">公式サイトを入れると、開催日・エントリー期間などを読み取ります。</p>`);
        if (!v) return;
        const url = normUrl(v.url);
        const r = await api('/races', { method: 'POST', body: { name: v.name, date: v.date || addDays(today(), 90), distance_m: Number(v.dist), priority: 'B', status: 'candidate', url, info: v.date ? {} : { date_estimated: true }, no_auto: true } });
        if (url) {
          try {
            const got = await api(`/races/${r.id}/extract`, { method: 'POST', body: { url } });
            const inf = { ...got, updated: today() }; delete inf.chars;
            let date = r.date;
            if (got.race_date && got.race_date >= today()) date = got.race_date; else if (!v.date) inf.date_estimated = true;
            delete inf.race_date;
            await api(`/races/${r.id}`, { method: 'PUT', body: { ...r, date, info: inf } });
          } catch (err) { alert(`追加しました (公式サイトは読めませんでした: ${err.message})`); }
        }
        location.hash = `#/races/${r.id}`;
      }
    });
  });
  const shown = list.filter(pass);
  return `
    <div class="row spread" style="margin-bottom:8px"><h2>大会を探す</h2><span class="muted" id="rf-count">${shown.length}大会</span></div>
    <div class="rf-search"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input id="rf-q" type="search" placeholder="大会名・県で探す" value="${esc(RF_Q)}" autocomplete="off"></div>
    <div class="card rf-filter ${RF_Q ? 'dim' : ''}">
      <span class="lbl">地域</span>${chips('area', [['', 'すべて'], ...AREA_NAMES.map((a) => [a, a])])}
      <span class="lbl">時期</span>${chips('when', WHEN)}
      <span class="lbl">種目</span>${chips('dist', [['', 'すべて'], ['full', 'フル'], ['half', 'ハーフ']])}
    </div>
    <div class="card"><div id="rf-body">${shown.length ? `<ul class="list rf-list">${shown.map(rowHtml).join('')}</ul>` : ''}</div>
      <div id="rf-own" class="rf-own ${RF_Q ? '' : 'hidden'}"><span>一覧に無い大会は</span><button type="button" class="chip" id="rf-own-add">「<span id="rf-own-name">${esc(RF_Q)}</span>」を候補に追加</button></div>
      <p class="muted" style="font-size:12px;margin:12px 0 0">大会名をタップすると詳細が開きます。一覧は全国の主な ${list.length} 大会。載っていない大会は名前で探して、そのまま候補に追加できます。</p></div>`;
}

let ENTRY_HIST = {};
async function racesView() {
  const [races, hist] = await Promise.all([api('/races'), api('/races/entry-history').catch(() => ({}))]);
  ENTRY_HIST = hist || {};
  const t = today();
  setTimeout(() => {
    view.querySelector('#add-race').onclick = () => editRace({ priority: 'A', distance_m: 42195 });
    wireSwipe(view, async (act, id) => {
      const r = races.find((x) => x.id === Number(id));
      if (act === 'open') location.hash = `#/races/${id}`;
      else if (act === 'status') manageRace(r);
      else if (act === 'del' && (await deleteRace(r))) route();
    });
  });
  const ST_LABEL = Object.fromEntries(RACE_STATUS);
  const distName = (m) => (Math.abs(m - 42195) < 50 ? 'フル' : Math.abs(m - 21097.5) < 50 ? 'ハーフ' : `${km(m, 1)}km`);
  const goalTxt = (r) => (r.goal_time_s ? `目標 ${dur(r.goal_time_s)} (${pace(r.goal_time_s / (r.distance_m / 1000))}/km)` : '目標未設定');
  const row = (r) => {
    const diff = r.goal_time_s && r.result_time_s ? r.result_time_s - r.goal_time_s : null;
    const st = r.status || 'confirmed';
    const est = raceInfoOf(r).date_estimated;
    return `<li class="sw" data-id="${r.id}">
      <div class="sw-acts">${r.date >= t ? `<button type="button" class="sw-act st" data-act="status">${ST_ICON[st]}<span>状態</span></button>` : ''}<button type="button" class="sw-act del" data-act="del">${SVG('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>')}<span>削除</span></button></div>
      <div class="sw-front"><div class="rl-row">
        <div class="rl-date num"><small>${Number(r.date.slice(5, 7))}月</small><b>${Number(r.date.slice(8, 10))}</b><small>${dow(r.date)}</small></div>
        <div class="rl-body">
          <div class="rl-top">${r.date >= t ? `<span class="rb rb-${st}">${ST_LABEL[st]}</span>` : r.result_time_s ? '<span class="rb rb-done">完走</span>' : '<span class="rb rb-past">終了</span>'}${r.priority === 'A' && st !== 'candidate' ? '<span class="rb rb-main">本命</span>' : ''}${est ? '<span class="rb rb-est">日付は暫定</span>' : ''}</div>
          <b class="rl-name">${esc(r.name)}</b>
          <span class="muted num rl-sub">${distName(r.distance_m)}・${r.result_time_s ? `結果 ${dur(r.result_time_s)}${diff != null ? ` (${diff <= 0 ? '−' : '+'}${dur(Math.abs(diff))})` : ''}` : goalTxt(r)}${r.date >= t && !est ? `・あと${daysBetween(t, r.date)}日` : ''}</span>
          ${entryLine(r, t, true)}
        </div>
        <svg class="chev" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
      </div></div>
    </li>`;
  };
  const upcoming = races.filter((r) => r.date >= t).sort((a, b) => a.date.localeCompare(b.date));
  const past = races.filter((r) => r.date < t && r.status !== 'candidate').sort((a, b) => b.date.localeCompare(a.date));
  // いちばん近い出場予定 (候補は除く)。優先度 A のときだけ「本命」と書く
  const next = upcoming.filter((r) => (r.status || 'confirmed') !== 'candidate')[0] ?? null;
  const hero = (() => {
    if (!next) return `<div class="card rl-empty"><b>出場予定の大会はありません</b><p class="muted">「大会を探す」か「＋ 追加」から登録すると、ここに次の大会が大きく出ます。${upcoming.length ? '(エントリー候補は、状態を「エントリー済み」「出場決定」にすると出ます)' : ''}</p></div>`;
    const est = raceInfoOf(next).date_estimated, st = next.status || 'confirmed';
    const inf = raceInfoOf(next);
    const hs = raceHeroStyle(next);
    return `<a class="card hero rl-hero ${hs.cls}" href="#/races/${next.id}" style="${hs.style}">
      <div class="rl-top"><span class="rb rb-${st}">${ST_LABEL[st]}</span>${next.priority === 'A' ? '<span class="rb rb-main">本命</span>' : `<span class="rb">優先度 ${esc(next.priority || '-')}</span>`}</div>
      <h2 class="rl-hname">${esc(next.name)}</h2>
      <div class="muted num">${next.date.slice(0, 4)}年${md(next.date)}(${dow(next.date)})${est ? '・日付は暫定' : ''}${inf.venue ? `・${esc(inf.venue)}` : ''}</div>
      <div class="rl-hrow"><div>${est ? '<span class="muted">開催日が決まったら残り日数を出します</span>' : `あと <b class="big num">${daysBetween(t, next.date)}</b> 日`}</div>
        <div class="rl-hgoal num"><small>${distName(next.distance_m)} (${km(next.distance_m, 3)}km)</small><b>${next.goal_time_s ? dur(next.goal_time_s) : '目標未設定'}</b>${next.goal_time_s ? `<small>${pace(next.goal_time_s / (next.distance_m / 1000))}/km</small>` : ''}</div></div>
    </a>`;
  })();
  return `
    <div class="row spread" style="margin-bottom:8px"><h2>レース</h2><div class="row" style="gap:8px"><a class="btn" href="#/races/find">大会を探す</a><button class="primary" id="add-race">＋ 追加</button></div></div>
    ${hero}
    <h3 class="sect">今後の大会 <small class="muted">${upcoming.length}件</small></h3>
    ${upcoming.length ? `<div class="card"><ul class="list rl-list">${upcoming.map(row).join('')}</ul></div><p class="muted sw-hint">左にスライドすると、状態の変更と削除ができます。エントリー候補は、計画やホームの目標には入れません</p>` : '<div class="card"><p class="muted">予定の大会はありません</p></div>'}
    <details class="card rv-acc rl-past" ${upcoming.length ? '' : 'open'}><summary>過去の大会 (${past.length})</summary><div class="rv-acc-b">${past.length ? `<ul class="list rl-list">${past.map(row).join('')}</ul>` : '<p class="muted">なし</p>'}</div></details>`;
}

async function editRace(r) {
  const presets = [[42195, 'フル'], [21097.5, 'ハーフ'], [10000, '10K'], [5000, '5K']];
  const isPreset = presets.some(([d]) => d === r.distance_m);
  const values = await openDialog(`
    <h2>${r.id ? 'レースを編集' : 'レースを追加'}</h2>
    <label>大会名<input name="name" value="${esc(r.name)}" required></label>
    <div class="field"><span class="lbl">状態</span><div class="pf-seg race-st" style="--n:3">${RACE_STATUS.map(([k, l]) => `<label class="seg-r"><input type="radio" name="status" value="${k}" ${(r.status || 'confirmed') === k ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>
    <label>公式サイト (任意)<input name="url" type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="例: fukuoka-marathon.com" value="${esc(r.url || '')}"></label>
    <div class="grid2">
      <label>日付<input type="date" name="date" value="${r.date || ''}" required></label>
      <label>優先度<select name="priority">${['A', 'B', 'C'].map((p) => `<option ${r.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
    </div>
    <div class="grid2">
      <label>距離<select name="preset">${presets.map(([d, n]) => `<option value="${d}" ${r.distance_m === d ? 'selected' : ''}>${n}</option>`).join('')}<option value="" ${isPreset ? '' : 'selected'}>その他</option></select></label>
      <label>その他 (km)<input name="custom_km" inputmode="decimal" value="${isPreset ? '' : r.distance_m / 1000}"></label>
    </div>
    <div class="grid2">
      <label>目標タイム<input name="goal" placeholder="2:59:00" value="${r.goal_time_s ? dur(r.goal_time_s) : ''}"></label>
      <label>結果タイム<input name="result" placeholder="h:mm:ss" value="${r.result_time_s ? dur(r.result_time_s) : ''}"></label>
    </div>
    <label>メモ<textarea name="notes" rows="2">${esc(r.notes)}</textarea></label>`,
    r.id ? { onDelete: async () => { await api(`/races/${r.id}`, { method: 'DELETE' }); route(); } } : {},
  );
  if (!values) return;
  const body = {
    name: values.name,
    date: values.date,
    priority: values.priority,
    distance_m: values.preset ? Number(values.preset) : Number(values.custom_km) * 1000,
    goal_time_s: parseDur(values.goal),
    result_time_s: parseDur(values.result),
    notes: values.notes,
    status: values.status || 'confirmed',
    url: normUrl(values.url),
    info: raceInfoOf(r),
  };
  await api(r.id ? `/races/${r.id}` : '/races', { method: r.id ? 'PUT' : 'POST', body });
  route();
}

// ---- シューズ

/** シューズの提案。短く、多くても 3 つ */
function shoeAdvice(shoes, race) {
  const live = shoes.filter((x) => !x.retired);
  const out = [];
  const daysTo = race ? Math.round((new Date(race.date) - new Date(today())) / 86400000) : null;
  const link = (xs) => (xs.length === 1 ? `#/shoes/${xs[0].id}` : null);
  const over = live.filter((x) => x.total_km >= x.limit_km);
  if (over.length) out.push({ tone: 'bad', title: '交換の目安を超えたシューズ', text: over.map((x) => esc(shoeName(x))).join('、'), sub: '目安なので、使用感に問題がなければ続けても大丈夫。底のすり減りや脚の違和感が出たら入れ替えを。', href: link(over) });
  const near = live.filter((x) => x.total_km < x.limit_km && x.total_km / x.limit_km >= 0.85);
  if (near.length) out.push({ tone: 'warn', title: '交換の目安が近いシューズ', text: near.map((x) => `${esc(shoeName(x))} (残り${Math.round(x.limit_km - x.total_km)}km)`).join('、'), href: link(near) });
  const raceShoe = live.find((x) => purposesOf(x.purpose).includes('race'));
  if (race && daysTo != null && daysTo >= 0 && daysTo <= 56) {
    if (!raceShoe) out.push({ tone: 'warn', title: '本番用のシューズがありません', text: `${esc(race.name)}まで${daysTo}日。` });
    else if (raceShoe.total_km < 30) out.push({ tone: 'warn', title: '本番用の慣らし', text: `${esc(shoeName(raceShoe))}は${Math.round(raceShoe.total_km)}km。本番前に 30〜50km で慣らしを。`, href: `#/shoes/${raceShoe.id}` });
  }
  const missing = ['recovery', 'pace', 'speed', 'long'].filter((pu) => !live.some((x) => purposesOf(x.purpose).includes(pu)));
  if (missing.length && live.length) out.push({ tone: 'info', title: '用途が未設定', text: missing.map((pu) => PURPOSE_LABELS[pu]).join('・') });
  return out.slice(0, 3);
}
const ALERT_IC = {
  bad: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  warn: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v5h1"/>',
};
/** シューズの注意 (交換の目安など) をカードで */
const shoeAlert = (a) => {
  const inner = `<span class="sa-ic"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ALERT_IC[a.tone] || ALERT_IC.info}</svg></span>
    <span class="sa-tx"><b>${a.title}</b><span>${a.text}</span>${a.sub ? `<small class="muted">${a.sub}</small>` : ''}</span>${a.href ? '<span class="pm-chev">›</span>' : ''}`;
  return a.href ? `<a class="sa ${a.tone}" href="${a.href}">${inner}</a>` : `<div class="sa ${a.tone}">${inner}</div>`;
};

const STATUS = [[0, '使用中'], [2, '予備'], [1, '引退']];

async function putShoe(s, patch) {
  await api(`/shoes/${s.id}`, { method: 'PUT', body: { ...s, ...patch } });
}

const PURPOSE_SHORT = { easy: 'イージー', recovery: 'リカバリー', long: 'ロング', pace: 'ペース走', speed: 'スピード', race: 'レース' };
/** シューズ一覧の絞り込み: 用途 (保存値) との対応 */
const SHOE_FILTER = [['all', 'すべて', null], ['jog', 'ジョグ', ['easy', 'recovery']], ['point', 'ポイント', ['pace', 'speed']], ['long', 'ロング', ['long']], ['race', 'レース', ['race']]];
const shoeImg = (s, big) => `<div class="shoe-img ${big ? 'big' : ''}">${s.image ? `<img src="${s.image}" alt="">` : '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16v-3l4-1 2-3 3 2 4 1c3 .5 5 2 5 4v1H3z"/><path d="M3 19h18"/></svg>'}</div>`;
const wearBar = (s) => { const r = s.limit_km ? s.total_km / s.limit_km : 0; return `<div class="bar ${r >= 1 ? 'over' : r >= 0.9 ? 'warn' : ''}"><div style="width:${Math.min(100, r * 100)}%"></div></div><div class="sh-wear muted num"><span>${s.total_km.toFixed(1)} / 目安 ${s.limit_km}km</span><span>${s.limit_km ? `${Math.round(r * 100)}%` : ''}</span></div>`; };

async function shoesView(params) {
  const sf = params?.get('f') || 'all';
  const [shoes, races] = await Promise.all([api('/shoes'), api('/races').catch(() => [])]);
  const nextRace = races.filter((r) => r.date >= today() && ['A', 'B'].includes(r.priority)).sort((a, b) => a.date.localeCompare(b.date))[0];
  const advice = shoeAdvice(shoes, nextRace);
  SHOES = shoes; // 相性の比較で写真を出すため
  setTimeout(() => {
    view.querySelector('#add-shoe').onclick = () => editShoe({ purpose: 'easy', limit_km: 700, initial_km: 0 });
    // タップで詳しく (使用履歴・相性・使用感)。編集は詳しくの画面から
    view.querySelectorAll('[data-shoe]').forEach((el) => (el.onclick = (e) => {
      if (e.target.closest('[data-st],[data-pq]') || el._swiped) return;
      location.hash = `#/shoes/${el.dataset.shoe}`;
    }));
    // 左右にスライドして状態を変える (右: 予備/使用中へ、左: 引退)
    view.querySelectorAll('.shoe-item').forEach((li) => {
      const s = shoes.find((x) => x.id === Number(li.dataset.shoe));
      const fg = li.querySelector('.shoe-fg');
      let x0 = 0, y0 = 0, dx = 0, on = false, id = null;
      const rightTo = (s.retired || 0) === 0 ? 2 : 0;
      fg.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; x0 = e.clientX; y0 = e.clientY; dx = 0; on = false; id = e.pointerId; });
      fg.addEventListener('pointermove', (e) => {
        if (id !== e.pointerId) return;
        const mx = e.clientX - x0, my = e.clientY - y0;
        if (!on && Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my) * 1.5) { on = true; fg.setPointerCapture(id); }
        if (!on) return;
        dx = Math.max(-140, Math.min(140, mx));
        if ((s.retired || 0) === 1 && dx < 0) dx = 0;
        fg.style.transition = 'none'; fg.style.transform = `translateX(${dx}px)`;
        li.classList.toggle('arm-r', dx > 90); li.classList.toggle('arm-l', dx < -90);
        li.classList.toggle('peek-r', dx > 10); li.classList.toggle('peek-l', dx < -10);
      });
      const end = async () => {
        if (id == null) return;
        id = null;
        const swiped = on; on = false;
        fg.style.transition = 'transform .2s'; fg.style.transform = '';
        li.classList.remove('peek-r', 'peek-l');
        if (swiped) { li._swiped = true; setTimeout(() => (li._swiped = false), 350); }
        const to = dx > 90 ? rightTo : dx < -90 ? 1 : null;
        li.classList.remove('arm-r', 'arm-l');
        if (to != null && to !== (s.retired || 0)) { await putShoe(s, { retired: to }); route(); }
      };
      fg.addEventListener('pointerup', end); fg.addEventListener('pointercancel', end);
    });
    // 用途はその場でタップして切り替え
    view.querySelectorAll('[data-pq]').forEach((b) => (b.onclick = async (e) => {
      e.stopPropagation();
      const s = shoes.find((x) => x.id === Number(b.dataset.sid));
      const cur = purposesOf(s.purpose);
      const next = cur.includes(b.dataset.pq) ? cur.filter((k) => k !== b.dataset.pq) : [...cur, b.dataset.pq];
      if (!next.length) return;
      s.purpose = next.join(',');
      b.classList.toggle('on');
      const t = b.closest('li').querySelector('.tiny'); if (t) t.textContent = purposeText(s);
      await putShoe(s, { purpose: s.purpose });
    }));
    view.querySelectorAll('[data-st]').forEach((b) => (b.onclick = async () => {
      const s = shoes.find((x) => x.id === Number(b.dataset.sid));
      if (Number(b.dataset.st) === 1 && !confirm(`${s.name} を引退にします (走行距離の記録は残ります)`)) return;
      b.disabled = true;
      await putShoe(s, { retired: Number(b.dataset.st) });
      route();
    }));
  });
  const row = (s) => {
    const rt = (s.retired || 0) === 0 ? '予備にする' : '使用中に戻す';
    const pu = purposesOf(s.purpose);
    return `<li data-shoe="${s.id}" class="shoe-item ${s.retired === 1 ? 'off' : ''}">
      <div class="shoe-bg"><span class="bg-r">${rt}</span><span class="bg-l">${(s.retired || 0) === 1 ? '' : '役目を終える'}</span></div>
      <div class="shoe-fg">
      <div class="shoe-row">
        ${shoeImg(s)}
        <div class="shoe-body"><b class="shoe-name">${shoeNameHtml(s)}</b>
        <div class="sh-tags">${pu.length ? pu.map((p) => `<span class="sh-tag">${PURPOSE_SHORT[p]}</span>`).join('') : '<span class="sh-tag none">用途未設定</span>'}${(s.retired || 0) === 2 ? '<span class="sh-tag st">予備</span>' : s.retired === 1 ? '<span class="sh-tag st">引退</span>' : ''}</div>
        ${wearBar(s)}
        <div class="muted tiny num">${s.last_date ? `最終使用 ${md(s.last_date)}・${s.runs}回` : '使用記録なし'}</div>
        ${s.retired === 1 ? `<button type="button" class="chip" data-st="0" data-sid="${s.id}" style="margin-top:6px">使用中に戻す</button>` : ''}</div>
        <svg class="chev" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
      </div>
      </div>
    </li>`;
  };
  const F = SHOE_FILTER.find(([k]) => k === sf) || SHOE_FILTER[0];
  const pick = (xs) => (F[2] ? xs.filter((x) => purposesOf(x.purpose).some((p) => F[2].includes(p))) : xs);
  const active = pick(shoes.filter((s) => !s.retired)), spare = pick(shoes.filter((s) => s.retired === 2)), retired = pick(shoes.filter((s) => s.retired === 1));
  const chips = `<div class="hl-chips">${SHOE_FILTER.map(([k, l]) => `<a class="chip ${k === sf ? 'on' : ''}" href="#/shoes${k === 'all' ? '' : `?f=${k}`}">${l}</a>`).join('')}</div>`;
  return `
    <div class="sh-top"><h2>シューズ</h2><button class="primary sh-add" id="add-shoe"><span aria-hidden="true">＋</span> 追加</button></div>
    ${chips}
    ${advice.length ? `<div class="sa-list">${advice.map(shoeAlert).join('')}</div>` : ''}
    ${!shoes.length ? '<div class="card"><b>シューズが登録されていません</b><p class="muted">「＋ 追加」から登録すると、走行距離と使用履歴がここに出ます。Strava のシューズを付けたランは自動で登録されます。</p></div>' : `
    <h3 class="sect">使用中 <small class="muted">${active.length}足</small></h3>
    <div class="card"><ul class="list shoes">${active.map(row).join('') || '<li class="muted">この用途の使用中のシューズはありません</li>'}</ul></div>
    ${spare.length ? `<h3 class="sect">予備 <small class="muted">${spare.length}足</small></h3><div class="card"><ul class="list shoes">${spare.map(row).join('')}</ul></div>` : ''}
    ${retired.length ? `<details class="card rv-acc"><summary>引退 (${retired.length}足)</summary><div class="rv-acc-b"><ul class="list shoes">${retired.map(row).join('')}</ul></div></details>` : ''}
    <p class="muted hint">右へスライドで「予備/使用中」、左へスライドで「引退」。タップすると使用履歴・相性・使用感と編集。距離のバーは、登録した目安に対する割合です (靴の傷み具合を測ったものではありません)。</p>`}
    <h2 class="sect">シューズの相性</h2><div class="card" id="shoe-cmp"><p class="muted">読み込み中…</p></div>`;
}

/** シューズの詳しく: 使用状況・使用履歴・使用感・相性・履き分け */
async function shoeDetailView(id) {
  const [h, shoes, plans, cmp] = await Promise.all([
    api(`/shoes/${id}/history`), api('/shoes'), api(`/plans?from=${today()}&to=${addDays(today(), 7)}`).catch(() => []), api('/shoes/compare').catch(() => ({})),
  ]);
  const s = shoes.find((x) => x.id === Number(id)) || h.shoe;
  SHOES = shoes; SHOE_FIT = cmp;
  setTimeout(() => {
    view.querySelector('#shoe-edit').onclick = () => editShoe(s);
    view.querySelector('[data-feel-edit]').onclick = () => editShoe(s, { feel: true });
    view.querySelectorAll('[data-shtab]').forEach((a) => (a.onclick = () => {
      view.querySelectorAll('[data-shtab]').forEach((x) => x.classList.toggle('on', x === a));
      view.querySelectorAll('.sh-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== a.dataset.shtab));
    }));
  });
  const pu = purposesOf(s.purpose);
  const f = s.feel || {};
  const st = (s.retired || 0) === 2 ? '予備' : s.retired === 1 ? '引退' : '使用中';
  const mmax = Math.max(1, ...h.months.map((m) => m.km));
  // 相性: このシューズの、種類ごとの使用実績と、同じ種類のほかのシューズとの差 (2 本以上あるとき)
  const fitRows = Object.entries(GROUP_LABEL).map(([g, label]) => {
    const rows = cmp[g] || [];
    const me = rows.find((r) => r.shoe_id === s.id);
    if (!me) return '';
    const others = rows.filter((r) => r.shoe_id !== s.id);
    const avg = (k) => { const v = others.map((r) => r[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const d = (k, unit, low) => { const o = avg(k); if (me[k] == null || o == null) return ''; const x = me[k] - o; return `<span class="num">${k === 'pace' ? `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x))}秒/km` : `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 10) / 10)}${unit}`}</span>`; };
    return `<div class="sh-fit"><b>${label} <small class="muted">${me.n}本・${me.km}km</small></b>
      <div class="sh-fitg num"><span>ペース ${me.pace ? pace(me.pace) : '-'}</span><span>心拍 ${me.hr ?? '-'}</span><span>ピッチ ${me.cad ?? '-'}</span><span>ストライド ${me.stride != null ? `${me.stride}cm` : '-'}</span><span>脚の疲労 ${me.leg != null ? `${me.leg}/10` : '-'}</span><span>走りやすさ ${me.form != null ? `${me.form}/10` : '-'}</span></div>
      ${others.length ? `<small class="muted">ほかのシューズ (${others.length}足) の平均との差: ペース ${d('pace', '', true) || '-'}・心拍 ${d('hr', 'bpm') || '-'}・脚の疲労 ${d('leg', '') || '-'}</small>` : '<small class="muted">同じ種類でほかのシューズの記録が無いので、比べられません。</small>'}</div>`;
  }).join('');
  // 履き分け: これから 7 日の計画のうち、このシューズがおすすめになる日
  const recs = plans.filter((p) => p.type !== 'rest').map((p) => ({ p, r: recommendShoe(p.type) })).filter((x) => x.r && x.r.shoe.id === s.id);
  // このシューズの結論 (使用実績から読み取れることだけ。データが無ければ書かない)
  const mine = Object.entries(GROUP_LABEL).map(([g, label]) => ({ g, label, me: (cmp[g] || []).find((r) => r.shoe_id === s.id), others: (cmp[g] || []).filter((r) => r.shoe_id !== s.id) })).filter((x) => x.me);
  const mostUsed = [...mine].sort((a, b) => b.me.n - a.me.n)[0];
  const facts = [];
  for (const x of mine) {
    if (!x.others.length) continue;
    const avg = (k) => { const v = x.others.map((r) => r[k]).filter((y) => y != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
    const leg = avg('leg'), hr = avg('hr');
    if (x.me.leg != null && leg != null && x.me.leg - leg <= -1) facts.push(`${x.label}では、ほかのシューズより脚の疲労が少なめ`);
    else if (x.me.leg != null && leg != null && x.me.leg - leg >= 1) facts.push(`${x.label}では、ほかのシューズより脚の疲労が多め`);
    if (x.me.hr != null && hr != null && Math.abs(x.me.hr - hr) >= 3) facts.push(`${x.label}では、ほかのシューズより心拍が ${Math.abs(Math.round(x.me.hr - hr))}bpm ${x.me.hr < hr ? '低め' : '高め'}`);
  }
  const conclusion = mostUsed ? `主に${mostUsed.label}で使用 (${mostUsed.me.n}本・${mostUsed.me.km}km)。${facts.length ? facts.slice(0, 2).join('。') + '。' : ''}` : '';
  const kmax = Math.max(1, ...mine.map((x) => x.me.km));
  const recent = h.months.slice(-6), older = h.months.slice(0, -6);
  const mrow = (m) => `<div class="mbk"><span>${Number(m.month.slice(5))}月 <small class="muted">${m.month.slice(0, 4)}</small></span><i style="width:${(m.km / mmax) * 100}%"></i><b class="num">${m.km}km</b></div>`;
  const histRow = (a) => {
    const kmv = a.distance_m / 1000;
    const lab = a.race_name ? esc(a.race_name) : (a.type && a.type !== 'free') || a.plan_type ? runTypeLabel(a) : esc(a.name);
    return `<a class="hl-run" href="#/activities/${a.id}"><span class="sh-hd num">${md(a.date)}<small>(${dow(a.date)})</small></span><div class="hl-tx"><b>${lab}</b><small class="num">${kmv.toFixed(2)}km・${pace(a.moving_time_s / kmv)}/km${a.avg_hr ? `・${Math.round(a.avg_hr)}bpm` : ''}</small></div>${scoreTag(a.score)}</a>`;
  };
  const feelN = SHOE_FEEL.filter(([k]) => f[k] != null).length;
  const wear = s.limit_km ? s.total_km / s.limit_km : null;
  return `
    <div class="card sh-head">
      <div class="sh-head-top">${shoeImg(s, false)}<div class="sh-head-tx"><b class="sh-title">${shoeNameHtml(s)}</b>
        <div class="sh-tags">${pu.map((p) => `<span class="sh-tag">${PURPOSE_SHORT[p]}</span>`).join('') || '<span class="sh-tag none">用途未設定</span>'}<span class="sh-tag st">${st}</span></div></div></div>
      <div class="hl-tiles"><div class="hl-tile"><small>累計距離</small><b class="num">${s.total_km.toFixed(1)}<small>km</small></b><span>${s.initial_km ? '補正を含む' : 'アプリの記録'}</span></div>
        <div class="hl-tile"><small>目安 (設定値)</small><b class="num">${s.limit_km}<small>km</small></b><span>${wear != null ? `累計の ${Math.round(wear * 100)}%` : ''}</span></div>
        <div class="hl-tile"><small>使用回数</small><b class="num">${h.total_runs}<small>回</small></b><span>${h.first_date ? `${md(h.first_date)}〜${md(h.last_date)}` : '記録なし'}</span></div></div>
      <div class="bar" style="margin-top:10px"><div style="width:${Math.min(100, (wear ?? 0) * 100)}%"></div></div>
      <p class="muted an-note">目安は自分で決めた値で、靴の傷み具合を測ったものではありません。</p>
      <button type="button" class="wide" id="shoe-edit" style="margin-top:8px">写真・用途・距離・使用感を編集</button>
    </div>
    <div class="seg sh-tabs"><a href="javascript:void 0" data-shtab="fit" class="on">相性</a><a href="javascript:void 0" data-shtab="hist">使用履歴</a><a href="javascript:void 0" data-shtab="feel">使用感</a></div>
    <div class="sh-pane" data-pane="fit">
      ${conclusion ? `<div class="card sh-concl"><small>このシューズの傾向</small><p>${esc(conclusion)}</p></div>` : ''}
      <div class="card"><h2>練習の種類ごと</h2>${mine.length ? mine.map((x) => `<div class="mbk"><span>${x.label}</span><i style="width:${(x.me.km / kmax) * 100}%"></i><b class="num">${x.me.n}本・${x.me.km}km</b></div>`).join('') : ''}
        ${fitRows ? `<details class="rv-acc"><summary>くわしい数字 (ペース・心拍・ピッチ・ほかのシューズとの差)</summary><div class="rv-acc-b">${fitRows}</div></details>` : '<p class="muted">このシューズで、同じ種類のランが 2 本以上あると出ます。</p>'}
        <p class="muted an-note">気温・コース・疲れ・練習の目的の違いも数字に入っています。シューズのせいだと決めつけず、傾向として見てください。</p></div>
      <div class="card"><h2>履き分けの提案</h2>${recs.length ? `<p class="sh-recs-lead">これから 7 日で ${recs.length} 回、このシューズがおすすめです。</p>${recs.map(({ p, r }) => `<p class="hl-p"><b class="num">${md(p.date)}(${dow(p.date)})</b><span>${esc(PLAN_LABELS[p.type] || p.type)}${p.distance_m ? ` ${km(p.distance_m)}km` : ''} — ${esc(r.why)}</span></p>`).join('')}` : '<p class="muted">これから 7 日の計画で、このシューズがおすすめになる日はありません (用途・使用感・使用実績から選んでいます)。</p>'}</div>
    </div>
    <div class="sh-pane hidden" data-pane="hist">
      <div class="card"><h2>月ごとの距離 <small class="muted">このアプリに記録したラン</small></h2>${recent.length ? recent.map(mrow).join('') : '<p class="muted">記録なし</p>'}
        ${older.length ? `<details class="rv-acc"><summary>さらに表示 (${older.length}か月)</summary><div class="rv-acc-b">${older.map(mrow).join('')}</div></details>` : ''}
        <p class="muted an-note">月ごとの距離は、このシューズを付けたランの合計です。上の「累計距離」(手入力の補正を含む) とは数え方が違います。</p></div>
      ${h.races.length ? `<div class="card"><h2>レースでの使用</h2>${h.races.map((r) => `<a class="hl-run" href="#/activities/${r.id}"><div class="hl-tx"><b>${esc(r.name)}</b><small class="num">${md(r.date)}・${r.km}km・${dur(r.time_s)}</small></div></a>`).join('')}</div>` : ''}
      <div class="card hl-day"><h2 style="margin:8px 2px">使ったラン <small class="muted">${h.total_runs}本${h.total_runs > h.runs.length ? ` (新しい ${h.runs.length} 本)` : ''}</small></h2>${h.runs.map(histRow).join('') || '<p class="muted">このシューズを付けたランはありません。ランの詳細でシューズを選べます。</p>'}</div>
    </div>
    <div class="sh-pane hidden" data-pane="feel">
      <div class="card"><div class="row spread"><h2>走った感覚</h2><span class="muted num">入力 ${feelN}/${SHOE_FEEL.length}</span></div>
        ${SHOE_FEEL.map(([k, l]) => `<div class="sh-feel"><span>${l}</span>${f[k] == null ? '<span class="muted">未入力</span>' : `<span class="sh-fbar"><i style="width:${f[k] * 10}%"></i></span><b class="num">${f[k]}<small>/10</small></b>`}</div>`).join('')}
        ${f.memo ? `<p class="hl-p"><span>${esc(f.memo)}</span></p>` : ''}
        <button type="button" class="wide" data-feel-edit style="margin-top:10px">使用感を入力・編集</button>
        <p class="muted an-note">未入力は未入力のまま (推測で埋めません)。</p></div>
    </div>`;
}

/** シューズの相性: 同じ種類のランで、シューズごとに比べる (2 本以上走ったシューズだけ) */
const GROUP_LABEL = { easy: 'ジョグ・イージー', tempo: 'ポイント練', long: 'ロング走', interval: 'インターバル', race: 'レース' };
/** 相性の「おすすめ」の観点。値は相性の集計 (主観・実績) から。データが 2 足分そろわなければ出さない */
const FIT_CRIT = [
  ['natural', '自然に走れる', '<path d="M4 20c4-1 7-4 8-8s4-7 8-8"/><path d="M12 12c-2 0-4 1-5 3"/>', (r) => r.form, false, (r) => `走りやすさ ${r.form}/10`],
  ['easy', '疲れにくい', '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/>', (r) => r.leg ?? r.next_leg, true, (r) => (r.leg != null ? `脚の疲労 ${r.leg}/10` : `翌朝の脚 ${r.next_leg}/10`)],
  ['speed', 'スピード寄り', '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>', (r) => r.pace, true, (r) => `平均 ${pace(r.pace)}/km`],
];
/** 練習の種類ごとに、おすすめの対象にする用途 (シューズの編集で設定した用途)。用途が未設定の靴は対象にする */
const GROUP_PURPOSE = { easy: ['easy', 'recovery', 'long'], tempo: ['pace', 'speed', 'race'], long: ['long', 'easy', 'pace'], interval: ['speed', 'pace', 'race'], race: ['race', 'speed', 'pace'] };
async function loadShoeCompare() {
  const box = document.getElementById('shoe-cmp');
  if (!box) return;
  let data = {};
  try { data = await api('/shoes/compare'); } catch { box.innerHTML = '<p class="muted">読み込めませんでした。</p>'; return; }
  const keys = Object.keys(GROUP_LABEL).filter((k) => data[k]?.length);
  if (!keys.length) { box.innerHTML = '<p class="muted">シューズを付けたランが、同じ種類で 2 本以上あるシューズが出てくると比べられます。</p>'; return; }
  let cur = keys.find((k) => data[k].length >= 2) || keys[0];
  let crit = 'natural', all = false, order = 'crit', showRet = false; // order: crit = 選んだ観点の良い順 / n = 使用回数の多い順
  const f = (v, u = '') => (v == null ? '-' : `${v}${u}`);
  const img = (id) => { const s = SHOES.find((x) => x.id === id); return s?.image ? `<img src="${s.image}" alt="">` : '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 16v-3l4-1 2-3 3 2 4 1c3 .5 5 2 5 4v1H3z"/><path d="M3 19h18"/></svg>'; };
  const draw = () => {
    const C = FIT_CRIT.find((c) => c[0] === crit);
    // 並び: 観点の良い順 (値の無い靴は後ろに、使用回数順) / 使用回数順
    const byCrit = (a, b) => { const x = C[3](a), y = C[3](b); if (x == null || y == null) return x == null && y == null ? b.n - a.n : x == null ? 1 : -1; return (C[4] ? x - y : y - x) || b.n - a.n; };
    // 用途がこの練習に合わない靴 (例: レース用をジョグで使った記録) は、表には出すが、おすすめ・緑の印の対象から外して後ろに並べる
    const purp = (r) => purposesOf(SHOES.find((x) => x.id === r.shoe_id)?.purpose);
    const fits = (r) => { const p = purp(r); return !p.length || p.some((x) => GROUP_PURPOSE[cur].includes(x)); };
    const offTag = (r) => (isRet(r) ? '<span class="sc-off">引退</span>' : fits(r) ? '' : `<span class="sc-off">${esc(purp(r).map((x) => PURPOSE_LABELS[x]).join('・'))}用</span>`);
    const sorter = order === 'crit' ? byCrit : (a, b) => b.n - a.n;
    // 引退した靴は比較・おすすめに入れない (記録は残す)。「引退したシューズも表示」で表の右端に出せる
    const isRet = (r) => (SHOES.find((x) => x.id === r.shoe_id)?.retired ?? r.retired) === 1;
    const retN = data[cur].filter(isRet).length;
    const rank = (r) => (isRet(r) ? 0 : fits(r) ? 2 : 1);
    const rowsAll = data[cur].filter((r) => showRet || !isRet(r)).sort((a, b) => (rank(b) - rank(a)) || sorter(a, b));
    const fitRows = rowsAll.filter((r) => fits(r) && !isRet(r));
    const rows = all ? rowsAll : rowsAll.slice(0, 3);
    const best = (k, low) => { const v = fitRows.map((r) => r[k]).filter((x) => x != null); return v.length >= 2 ? (low ? Math.min(...v) : Math.max(...v)) : null; };
    const mark = (r, k, low) => (fits(r) && !isRet(r) && r[k] != null && r[k] === best(k, low) ? ' class="sc-best"' : '');
    // おすすめ: 選んだ観点でいちばん良いシューズ (2 足以上に値があるときだけ)
    const vals = fitRows.filter((r) => C[3](r) != null);
    const top = vals.length >= 2 ? [...vals].sort((a, b) => (C[4] ? C[3](a) - C[3](b) : C[3](b) - C[3](a)))[0] : null;
    const tie = top && vals.filter((r) => C[3](r) === C[3](top)).length > 1;
    const rec = top && !tie
      ? `<a class="sc-rec" href="#/shoes/${top.shoe_id}"><span class="sc-rec-l">結論</span><div><small>おすすめ・${C[1]}</small><b>${esc((() => { const sh = SHOES.find((x) => x.id === top.shoe_id); return sh ? shoeName(sh) : top.name; })())}</b><span class="muted num">${C[5](top)} (${GROUP_LABEL[cur]}・${top.n}本)</span></div><span class="pm-chev">›</span></a>`
      : `<div class="sc-rec none"><span class="sc-rec-l">結論</span><div><small>${C[1]}</small><span class="muted">${tie ? '差がありません' : `この練習に合う用途の靴で、この観点の記録があるものが 2 足未満のため、比べられません`}</span></div></div>`;
    // ブランドは小さく別の行に (名前が短くなり、列からはみ出しにくい)
    // 見出しの高さをそろえる: 1 行目 = ブランド・色/呼び名 (小さく)、2 行目以降 = モデル名 (2 行まで)。写真の位置がずれない
    const cmpName = (r) => {
      const sh = SHOES.find((x) => x.id === r.shoe_id);
      const sub = sh ? [sh.brand, sh.feel?.label].filter(Boolean).join('・') : '';
      return `<small class="sh-brand">${sub ? esc(sub) : '&nbsp;'}</small><span class="sc-md">${esc(sh ? sh.name : r.name)}</span>`;
    };
    const wide = rows.length > 3; // 4 足以上は横にスライド (列の幅を固定して、名前・数字が重ならないように)
    const th = rows.map((r) => `<th><span class="sc-img">${img(r.shoe_id)}</span><span class="sc-nm">${cmpName(r)}</span><small>${r.n}本・${r.km}km</small>${offTag(r)}</th>`).join('');
    const tr = (label, cells) => `<tr><td>${label}</td>${cells}</tr>`;
    box.innerHTML = `<div class="seg sc-tabs">${keys.map((k) => `<a href="javascript:void 0" data-sg="${k}" class="${k === cur ? 'on' : ''}">${GROUP_LABEL[k]}</a>`).join('')}</div>
      ${rec}
      <div class="sc-crit">${FIT_CRIT.map(([k, l, ic]) => `<button type="button" class="chip ${k === crit ? 'on' : ''}" data-crit="${k}"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ic}</svg>${l}</button>`).join('')}</div>
      <div class="sc-ord"><span class="muted">並び</span>${[['crit', `${C[1]}の順`], ['n', '使用回数の順']].map(([k, l]) => `<button type="button" class="chip ${k === order ? 'on' : ''}" data-ord="${k}">${l}</button>`).join('')}</div>
      ${wide ? '<p class="muted sc-hint">横にスライドすると全部の靴を見られます</p>' : ''}
      <div class="${wide ? 'sc-scroll' : ''}"><table class="an-cmp num sc-t sc-fix"><tr><th></th>${th}</tr>
      ${tr('ペース', rows.map((r) => `<td${mark(r, 'pace', true)}>${r.pace ? pace(r.pace) : '-'}</td>`).join(''))}
      ${tr('心拍', rows.map((r) => `<td${mark(r, 'hr', true)}>${f(r.hr)}</td>`).join(''))}
      ${tr('ピッチ', rows.map((r) => `<td>${f(r.cad)}</td>`).join(''))}
      ${tr('ストライド', rows.map((r) => `<td>${f(r.stride, 'cm')}</td>`).join(''))}
      ${tr('走りやすさ', rows.map((r) => `<td${mark(r, 'form', false)}>${f(r.form, '/10')}</td>`).join(''))}
      ${tr('脚の疲労', rows.map((r) => `<td${mark(r, 'leg', true)}>${f(r.leg, '/10')}</td>`).join(''))}
      </table></div>
      <details class="rv-acc sc-more"><summary>ほかの項目 (接地時間・呼吸・翌朝の脚・痛み)</summary><div class="rv-acc-b ${wide ? 'sc-scroll' : ''}"><table class="an-cmp num sc-t sc-fix"><tr><th></th>${rows.map((r) => `<th><span class="sc-nm">${cmpName(r)}</span></th>`).join('')}</tr>
      ${tr('接地時間', rows.map((r) => `<td${mark(r, 'gct', true)}>${f(r.gct, 'ms')}</td>`).join(''))}
      ${tr('呼吸', rows.map((r) => `<td${mark(r, 'breath', true)}>${f(r.breath, '/10')}</td>`).join(''))}
      ${tr('翌朝の脚', rows.map((r) => `<td${mark(r, 'next_leg', true)}>${f(r.next_leg, '/10')}</td>`).join(''))}
      ${tr('痛み (3以上)', rows.map((r) => `<td>${r.pain_n}回</td>`).join(''))}</table></div></details>
      ${retN ? `<label class="sc-ret"><input type="checkbox" data-scret ${showRet ? 'checked' : ''}> 引退したシューズも表示 (${retN}足・おすすめには入れません)</label>` : ''}
      ${rowsAll.length > 3 ? `<button type="button" class="linkbtn sc-all" data-scall>${all ? '上の 3 足だけにする' : `ほかの ${rowsAll.length - 3} 足も表示`}</button>` : ''}
      <p class="muted an-note">同じ種類のランだけで比べています。速さより「自然に走れるか (走りやすさ)」「疲れが少ないか (脚・翌朝の脚)」を重く見てください。ピッチは記録の平均歩数、ストライドは距離÷歩数。緑はその項目でいちばん良いシューズ。主観は、ふりかえりと毎朝の体調から。用途がこの練習に合わない靴 (「〜用」の印) は、おすすめと緑の印の対象から外しています。用途はシューズの編集で変えられます。</p>`;
    box.querySelectorAll('[data-sg]').forEach((a) => (a.onclick = () => { cur = a.dataset.sg; draw(); }));
    box.querySelectorAll('[data-crit]').forEach((b) => (b.onclick = () => { crit = b.dataset.crit; draw(); }));
    box.querySelectorAll('[data-ord]').forEach((b) => (b.onclick = () => { order = b.dataset.ord; draw(); }));
    box.querySelector('[data-scall]')?.addEventListener('click', () => { all = !all; draw(); });
    box.querySelector('[data-scret]')?.addEventListener('change', (e) => { showRet = e.target.checked; if (showRet) all = true; draw(); });
  };
  draw();
}

/** 写真を選ぶと 320px 以内の JPEG に縮小して data URL にする */
function resizeImage(file, max = 320) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const r = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * r);
      c.height = Math.round(img.height * r);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.82));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = URL.createObjectURL(file);
  });
}

function wireShoePhoto() {
  const q = (id) => dialogForm.querySelector(id);
  const set = (url) => {
    q('#shoe-image').value = url;
    q('#shoe-preview').innerHTML = url ? `<img src="${url}" alt="">` : '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16v-3l4-1 2-3 3 2 4 1c3 .5 5 2 5 4v1H3z"/><path d="M3 19h18"/></svg>';
  };
  q('#shoe-file').onchange = async (e) => {
    const f = e.target.files[0];
    if (f) try { set(await resizeImage(f)); } catch (err) { alert(err.message); }
    noFocus();
  };
  q('#shoe-clear').onclick = () => { set(''); noFocus(); };
  wireBrandFields();
  q('#shoe-search').onclick = () => {
    const name = `${dialogForm.querySelector('[name=brand]').value} ${dialogForm.querySelector('[name=name]').value}`.trim() || 'running shoes';
    q('#shoe-search').href = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(name + ' シューズ')}`;
  };
}

/** ブランド (選択・無ければ入力) と名称 (モデル名) の入力欄 */
function brandFields(s) {
  // ブランドが未設定で名前の先頭にブランドがあれば、分けた形を初期値にする (保存したときだけ変わる)
  const [gb, gn] = s.brand ? [s.brand, s.name] : splitBrand(s.name || '');
  const known = SHOE_BRANDS.some(([b]) => b === gb);
  const opt = (v, l, on) => `<option value="${esc(v)}" ${on ? 'selected' : ''}>${esc(l)}</option>`;
  return `<div class="sh-brand-row">
      <label>ブランド<select id="brand-sel">${opt('', '未設定', !gb)}${SHOE_BRANDS.map(([b]) => opt(b, b, b === gb)).join('')}${opt('__other', 'その他 (入力)', gb && !known)}</select></label>
      <label class="${gb && !known ? '' : 'hidden'}" id="brand-other-l">ブランド名<input id="brand-other" value="${gb && !known ? esc(gb) : ''}" maxlength="40" placeholder="例: Topo Athletic"></label>
    </div>
    <input type="hidden" name="brand" value="${esc(gb || '')}">
    <label>モデル名<input name="name" value="${esc(gn || '')}" required placeholder="例: ボメロ18"></label>
    ${!s.brand && gb && s.id ? `<p class="muted tiny" style="margin:-4px 0 8px">名前の先頭の「${esc(s.name.slice(0, s.name.length - gn.length).trim())}」をブランドに分けました。保存すると反映されます。</p>` : ''}`;
}
function wireBrandFields() {
  const sel = dialogForm.querySelector('#brand-sel'), other = dialogForm.querySelector('#brand-other'), hid = dialogForm.querySelector('[name=brand]');
  if (!sel) return;
  const sync = () => {
    const o = sel.value === '__other';
    dialogForm.querySelector('#brand-other-l').classList.toggle('hidden', !o);
    hid.value = o ? other.value.trim() : sel.value;
  };
  sel.onchange = () => { sync(); if (sel.value === '__other') other.focus(); };
  other.oninput = sync;
}
async function editShoe(s, opts = {}) {
  const pending = openDialog(`
    <h2>${s.id ? 'シューズを編集' : 'シューズを追加'}</h2>
    ${brandFields(s)}
    <div class="shoe-photo">
      <div class="shoe-img big" id="shoe-preview">${s.image ? `<img src="${s.image}" alt="">` : '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16v-3l4-1 2-3 3 2 4 1c3 .5 5 2 5 4v1H3z"/><path d="M3 19h18"/></svg>'}</div>
      <div class="row">
        <label class="btn" style="margin:0">写真を選ぶ<input type="file" id="shoe-file" accept="image/*" hidden></label>
        <a class="btn" id="shoe-search" target="_blank" rel="noopener">画像を探す</a>
        <button type="button" id="shoe-clear" class="danger">写真を外す</button>
      </div>
      <input type="hidden" name="image" id="shoe-image" value="${s.image ? esc(s.image) : ''}">
    </div>
    <div class="field"><span class="lbl">どんな練習で使う？ (複数選べます)</span>
      <div class="chips sm-chips" id="pu-chips">${Object.entries(PURPOSE_LABELS).map(([k, v]) => `<button type="button" class="chip mini ${purposesOf(s.purpose).includes(k) ? 'on' : ''}" data-pu="${k}" title="${esc(v)}">${PURPOSE_SHORT[k]}</button>`).join('')}</div>
      <p class="muted hint" id="pu-hint"></p>
      <input type="hidden" name="purpose" value="${purposesOf(s.purpose).join(',')}">
    </div>
    <details class="field shoe-feel" id="sf-box" ${opts.feel || (s.feel && Object.keys(s.feel).some((k) => SHOE_FEEL.some(([f]) => f === k))) ? 'open' : ''}><summary class="sf-sum"><b>使用感 (走った感覚)</b><span class="muted num">${SHOE_FEEL.filter(([k]) => s.feel?.[k] != null).length}/${SHOE_FEEL.length} 入力・任意</span></summary>
      <div class="sf-grid">${SHOE_FEEL.map(([k, l]) => `<label>${l}<select name="f_${k}"><option value="">-</option>${Array.from({ length: 11 }, (_, v) => `<option ${s.feel?.[k] === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`).join('')}</div>
      <p class="muted hint">「総合的な走りやすさ」が 3 以下だと、おすすめに出にくくなります。</p>
    </details>
    <label>交換目安 (km)<input name="limit_km" inputmode="numeric" value="${s.limit_km}"></label>
    <div class="grid2">
      <label>走行距離 (km)<input name="total_km" inputmode="decimal" value="${s.id ? Math.round((s.total_km ?? s.initial_km) * 10) / 10 : (s.initial_km || 0)}"></label>
      <label>Strava gear ID<input name="strava_gear_id" placeholder="g12345" value="${esc(s.strava_gear_id)}"></label>
    </div>
    <label>色・呼び名 (同じモデルが複数あるとき)<input name="f_label" maxlength="20" placeholder="例: 白・2足目" value="${esc(s.feel?.label || '')}"></label>
    <div class="field"><span class="lbl">状態</span>
      <div class="chips sm-chips" id="st-chips">${STATUS.map(([v, l]) => `<button type="button" class="chip mini ${(s.retired || 0) === v ? 'on' : ''}" data-stv="${v}">${l}</button>`).join('')}</div>
      <input type="hidden" name="retired" value="${s.retired || 0}">
    </div>`,
    s.id ? { onDelete: async () => { await api(`/shoes/${s.id}`, { method: 'DELETE' }); if (location.hash.startsWith('#/shoes/')) location.hash = '#/shoes'; else route(); } } : {},
  );
  wireShoePhoto();
  // 「使用感を入力・編集」から開いたときは、使用感の欄へ
  if (opts.feel) setTimeout(() => { const el = dialogForm.querySelector('#sf-box'); if (el) el.scrollIntoView({ block: 'start' }); }, 150);
  const hint = () => {
    const sel = [...dialogForm.querySelectorAll('[data-pu].on')].map((b) => b.dataset.pu);
    dialogForm.querySelector('#pu-hint').textContent = sel.map((k) => `${PURPOSE_LABELS[k]}: ${PURPOSE_HINTS[k]}`).join(' / ');
    dialogForm.querySelector('[name=purpose]').value = sel.join(',');
  };
  dialogForm.querySelectorAll('[data-pu]').forEach((b) => (b.onclick = () => { b.classList.toggle('on'); hint(); }));
  dialogForm.querySelectorAll('[data-stv]').forEach((b) => (b.onclick = () => {
    dialogForm.querySelectorAll('[data-stv]').forEach((x) => x.classList.remove('on'));
    b.classList.add('on');
    dialogForm.querySelector('[name=retired]').value = b.dataset.stv;
  }));
  hint();
  const values = await pending;
  if (!values) return;
  // 走行距離は Nike Run Club など正確な値をそのまま入力 → 取り込みラン分を引いて初期距離にする
  const imported = s.id ? (s.total_km ?? 0) - (s.initial_km || 0) : 0;
  const total = Number(values.total_km);
  values.initial_km = Number.isFinite(total) && String(values.total_km).trim() !== '' ? Math.round((total - imported) * 10) / 10 : s.initial_km || 0;
  delete values.total_km;
  const feel = { label: values.f_label || '' };
  for (const [k] of SHOE_FEEL) if (values[`f_${k}`] !== '' && values[`f_${k}`] != null) feel[k] = Number(values[`f_${k}`]);
  for (const k of Object.keys(values)) if (k.startsWith('f_')) delete values[k];
  const saved = await api(s.id ? `/shoes/${s.id}` : '/shoes', { method: s.id ? 'PUT' : 'POST', body: { ...values, retired: Number(values.retired) || 0 } });
  const sid = s.id || saved?.id;
  if (sid) await api(`/shoes/${sid}/feel`, { method: 'PUT', body: feel }).catch(() => null);
  SHOE_FIT = null;
  route();
}

// ---- 設定

async function settingsView() {
  let status = null;
  let settings = null;
  let err = '';
  if (getToken()) {
    try {
      [status, settings] = await Promise.all([api('/status'), api('/settings')]);
    } catch (e) { err = e.message; }
  }

  setTimeout(() => {
    // ランの取り込み元と COROS 連携
    const sc = view.querySelector('#src-card');
    if (sc) {
      sc.querySelectorAll('[data-src]').forEach((b) => (b.onclick = async () => {
        if (b.dataset.src === 'coros' && !confirm('COROS を優先にします。Strava のランは消えません (COROS に無いランは Strava のまま、両方にあるランは中身を COROS に置き換えます)。')) return;
        await api('/settings', { method: 'PUT', body: { source: b.dataset.src } }); route();
      }));
      const box = sc.querySelector('#coros-box');
      const msg = (t) => { const m = box.querySelector('.coros-msg'); if (m) m.textContent = t; };
      const draw = (cs) => {
        const when = (iso) => (iso ? new Date(iso).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
        box.innerHTML = cs.connected ? `
          <div class="coros-st"><span class="dot ok"></span><b>COROS と連携済み</b><span class="muted">${esc((cs.region || '').replace('https://', ''))}</span></div>
          <div class="muted num coros-q">取り込み済み ${cs.done} 件・取り込み待ち ${cs.queue} 件${cs.last_found != null ? `・最後の確認で見つかったラン ${cs.last_found} 件` : ''}${cs.scan_to ? `・${cs.scan_to.slice(0, 7)} までさかのぼり中` : ''}${cs.pause_until ? `・${when(cs.pause_until)} から再開` : ''}・最後の確認 ${when(cs.last_sync)}</div>
          ${cs.last_error ? `<p class="coros-err">${esc(cs.last_error)}</p>` : ''}
          ${cs.fitness_error ? `<p class="coros-err">体力データ: ${esc(cs.fitness_error)}</p>` : ''}
          <div class="row coros-btns"><button type="button" data-cs="sync" class="primary">今すぐ確認</button><button type="button" data-cs="b30">過去30日</button><button type="button" data-cs="all">全期間</button><button type="button" data-cs="fit">体力データ</button></div>
          <p class="muted coros-msg" style="margin:6px 0 0"></p>
          <details class="coros-dbg"><summary>うまく取り込めないとき (診断)</summary>
            <div class="row"><button type="button" data-dbg="querySportRecords">ランの一覧</button><button type="button" data-dbg="queryFitnessAssessmentOverview">体力評価</button><button type="button" data-probe="1">取得テスト</button><button type="button" data-cs="fitf">FIT の項目</button><button type="button" data-cs="re14">直近14日を取り直す</button><button type="button" data-cs="off" class="danger">連携を解除</button></div>
            <pre class="coros-raw"></pre><button type="button" class="chip" data-copyraw="1">結果をコピー</button></details>`
          : `<div class="coros-st"><span class="dot"></span><b>COROS は未連携</b></div>
             <a class="btn primary wide" style="margin-top:8px;display:block;text-align:center" href="/auth/coros?key=${encodeURIComponent(getToken())}">COROS と連携</a>
             <p class="muted" style="margin:6px 0 0">COROS のアカウントでログインして「許可」を押すと戻ってきます。申請や費用は不要です。</p>`;
      };
      api('/coros/status').then(draw).catch((e) => { box.innerHTML = `<p class="coros-err">${esc(e.message)}</p>`; });
      box.addEventListener('click', async (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        const act = b.dataset.cs, dbg = b.dataset.dbg, probe = b.dataset.probe;
        if (b.dataset.copyraw) { try { await navigator.clipboard.writeText(box.querySelector('.coros-raw').textContent); msg('コピーしました'); } catch { msg('コピーできませんでした'); } return; }
        b.disabled = true;
        try {
          if (probe) { box.querySelector('.coros-raw').textContent = '調べています (20 秒ほど)…'; const r = await api('/coros/probe'); box.querySelector('.coros-raw').textContent = r.text; }
          else if (dbg) { const r = await api(`/coros/debug?tool=${dbg}`); box.querySelector('.coros-raw').textContent = r.text || JSON.stringify(r.structured, null, 1); }
          else if (act === 'sync') { const r = await api('/coros/sync', { method: 'POST' }); draw(r); msg(`新しいラン ${r.added} 件・取り込み ${r.imported} 件${r.removed ? `・Strava と同じ ${r.removed} 件を 1 件にまとめました` : ''}`); }
          else if (act === 'fitf') { const r = await api('/coros/status'); box.querySelector('.coros-raw').textContent = r.fit_fields ? `${r.fit_fields.date} のラン (${r.fit_fields.label})\n${r.fit_fields.fields.join('\n')}` : 'まだ記録がありません (次にランを取り込むと出ます)'; }
          else if (act === 're14') { if (!confirm('直近14日のランを COROS から取り直します (歩幅・接地時間・上下動などを入れ直すため)。1 日 50 件までです。')) { b.disabled = false; return; } const r = await api('/coros/reimport', { method: 'POST', body: { days: 14 } }); msg(`${r.queued} 件を取り直します。毎分 2 件ずつ`); }
          else if (act === 'b30') { const r = await api('/coros/backfill', { method: 'POST', body: { days: 30 } }); draw(r); msg(`${r.added} 件を取り込み待ちにしました。毎分少しずつ取り込みます`); }
          else if (act === 'all') { if (!confirm('COROS の全期間のランを取り込みます。Strava にもあるランは 1 件のまま中身を COROS に置き換えます (Strava のランは消えません)。新しいものから 1 日 50 件ずつ取り込みます。')) { b.disabled = false; return; } const r = await api('/coros/backfill', { method: 'POST', body: { all: true } }); draw(r); msg('全期間の取り込みを始めました。閉じて大丈夫です'); }
          else if (act === 'fit') { const f = await api('/coros/fitness', { method: 'POST' }); msg(`ランニングレベル ${f.running_level ?? '-'}・予測 フル ${f.predicted_s?.full ? dur(f.predicted_s.full) : '-'}・閾値ペース ${f.lt_pace_s ? pace(f.lt_pace_s) : '-'}・閾値心拍 ${f.lthr ?? '-'}。反映しました`); setTimeout(route, 1500); }
          else if (act === 'off') { if (confirm('COROS との連携を解除します')) { await api('/coros/disconnect', { method: 'POST' }); route(); } }
        } catch (err) { msg(`エラー: ${err.message}`); }
        b.disabled = false;
      });
    }
    // 予測タイムの出どころ
    const pc = view.querySelector('#pred-card');
    if (pc) {
      const pr = { source: settings.predict?.source || 'auto', full_s: settings.predict?.full_s ?? 11400 };
      const save = async () => { await api('/settings', { method: 'PUT', body: { predict: pr } }); route(); };
      pc.querySelectorAll('[data-pred]').forEach((b) => (b.onclick = async () => { pr.source = b.dataset.pred; await save(); }));
      const tb = pc.querySelector('[data-pred-time]');
      if (tb) tb.onclick = async () => { const v = await pickGoal('フルの予測タイム', pr.full_s); if (v) { pr.full_s = v; await save(); } };
      api('/insights').then((r) => { const o = pc.querySelector('#pred-auto'); if (o) o.textContent = r.predicted_s ? `いまの推定: ${dur(r.predicted_s)}` : '推定に使えるランがまだ足りません (心拍つき・5km以上が3本)'; }).catch(() => {});
    }
    view.querySelector('#token-form').onsubmit = (e) => {
      e.preventDefault();
      setToken(new FormData(e.target).get('token'));
      route();
    };
    const ti = view.querySelector('#token-input');
    view.querySelector('#token-show').onclick = (e) => {
      ti.type = ti.type === 'password' ? 'text' : 'password';
      e.target.textContent = ti.type === 'password' ? '表示する' : '隠す';
    };
    view.querySelector('#token-copy').onclick = async (e) => {
      try { await navigator.clipboard.writeText(ti.value); e.target.textContent = 'コピーしました'; }
      catch { ti.type = 'text'; ti.select(); e.target.textContent = '長押しでコピー'; }
    };
    const out = view.querySelector('#out');
    const run = (sel, fn) => { const b = view.querySelector(sel); if (b) b.onclick = async () => { b.disabled = true; try { out.textContent = JSON.stringify(await fn(), null, 2); } catch (e) { out.textContent = e.message; } b.disabled = false; }; };
    run('#subscribe', () => api('/strava/subscribe', { method: 'POST' }));
    run('#subscription', () => api('/strava/subscription'));
    const notifyText = (r) => {
      const res = r.results || [];
      if (res.length === 0) return '通知先が未設定です (NTFY_TOPIC か BARK_KEY を設定してください)';
      return res.map((x) => `[${x.ok ? 'OK' : '失敗'}] ${x.channel}${x.error ? `: ${x.error}` : ' に送信しました'}`).join('\n');
    };
    run('#test-notify', async () => notifyText(await api('/notify/test', { method: 'POST' })));
    const bkMsg = (t) => { const m = view.querySelector('#bk-msg'); if (m) m.textContent = t; };
    view.querySelector('#bk-out')?.addEventListener('click', async () => {
      bkMsg('書き出し中…');
      try {
        const data = await api('/backup');
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const name = `stride-backup-${today()}.json`;
        const file = new File([blob], name, { type: 'application/json' });
        if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file] }); } catch {} }
        else { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
        const n = Object.entries(data.tables).map(([k, v]) => `${k} ${v.length}`).join('・');
        bkMsg(`書き出しました (${n})`);
      } catch (e) { bkMsg(`エラー: ${e.message}`); }
    });
    view.querySelector('#bk-in')?.addEventListener('click', () => view.querySelector('#bk-file').click());
    view.querySelector('#bk-file')?.addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!confirm(`${f.name} を読み込みます。同じ記録は上書きされます。よろしいですか？`)) return;
        bkMsg('読み込み中…');
        const r = await api('/backup', { method: 'POST', body: data });
        bkMsg(`読み込みました (${Object.entries(r.counts).map(([k, v]) => `${k} ${v}`).join('・')})`);
        cachedSettings = null;
      } catch (err) { bkMsg(`エラー: ${err.message}`); }
      e.target.value = '';
    });
    run('#morning', async () => notifyText(await api('/notify/morning', { method: 'POST' })));
    const fmtTime = (ep) => new Date(ep * 1000).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const renderBackfill = (b) => {
      const el = view.querySelector('#bf-live');
      if (!el) return false;
      const db = b.db || {};
      const waiting = b.active && b.pause_until && b.pause_until * 1000 > Date.now();
      const state = !b.started ? '未実行'
        : b.active ? (waiting ? `⏸ Strava の上限待ち (${fmtTime(b.pause_until)} ごろ再開)` : '▶ 取り込み中')
        : b.finished ? (b.last_error ? 'エラーで停止' : '完了') : '停止中';
      const pos = b.active && b.after ? `現在位置 ${new Date(b.after * 1000).toISOString().slice(0, 10)} 付近` : '';
      el.innerHTML = `<div><b>${state}</b></div>
        <div class="num">取り込み済み ${db.count ?? 0} 件${db.oldest ? `(${db.oldest.replace(/-/g, '/')} 〜 ${db.newest.replace(/-/g, '/')})` : ''}</div>
        ${b.started ? `<div class="num">今回 ${b.imported} 件取り込み・${b.skipped} 件は済みのため飛ばしました${pos ? `・${pos}` : ''}</div>` : ''}
        ${b.last_error ? `<div class="error">${esc(b.last_error)}</div>` : ''}`;
      return true;
    };
    const refreshBackfill = async () => {
      try { return renderBackfill(await api('/strava/backfill/status')); } catch { return false; }
    };
    refreshBackfill();
    const timer = setInterval(async () => { if (!(await refreshBackfill())) clearInterval(timer); }, 8000);
    const bfText = (b) => !b ? '未実行' : b.active
      ? `取り込み中… ${b.imported} 件取り込み済み${b.pause_until && b.pause_until * 1000 > Date.now() ? ' (Strava の上限待ち。自動で再開します)' : ''}`
      : `${b.finished ? '完了' : '停止中'}: ${b.imported} 件取り込み${b.last_error ? ` / エラー: ${b.last_error}` : ''}`;
    run('#backfill-all', async () => {
      if (!confirm('Strava の全期間を取り込みます。アプリを閉じても自動で進みます。開始しますか？')) return 'キャンセル';
      { const r = bfText(await api('/strava/backfill/start', { method: 'POST' })); refreshBackfill(); return r; }
    });
    run('#reset-settings', async () => {
      if (!confirm('評価に使うペース帯・心拍の基準だけを標準に戻します (取り込み元や予測タイムの設定は変わりません)。よろしいですか？')) return 'キャンセル';
      await api('/settings/reset', { method: 'POST' });
      cachedSettings = null;
      setTimeout(route, 600);
      return '標準に戻しました';
    });
    run('#backfill-2025', async () => {
      const days = Math.ceil((Date.now() - Date.parse('2025-01-01T00:00:00+09:00')) / 86400000);
      { const r = bfText(await api(`/strava/backfill/start?days=${days}`, { method: 'POST' })); refreshBackfill(); return r; }
    });
    run('#reeval-30', async () => { const r = bfText(await api('/strava/backfill/start?days=30&force=1', { method: 'POST' })); refreshBackfill(); return r; });
    run('#backfill-30', async () => { const r = bfText(await api('/strava/backfill/start?days=30', { method: 'POST' })); refreshBackfill(); return r; });
    run('#backfill-status', async () => bfText(await api('/strava/backfill/status')));
    run('#backfill-stop', async () => { const r = bfText(await api('/strava/backfill/stop', { method: 'POST' })); refreshBackfill(); return r; });
    run('#copy-cal', async () => {
      await navigator.clipboard.writeText(status.calendar_url);
      return 'カレンダー購読 URL をコピーしました。iPhone の「設定 > カレンダー > アカウント > アカウントを追加 > その他 >照会カレンダーを追加」に貼り付けてください';
    });
    run('#open-cal', async () => { await openCalendar(); return 'カレンダーを開きます'; });
    const sf = view.querySelector('#settings-form');
    if (sf) sf.querySelectorAll('[data-pa]').forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      if (b.dataset.pa === '1') await api('/settings/derive', { method: 'POST' });
      else await api('/settings', { method: 'PUT', body: { paces_auto: false } });
      cachedSettings = null; route();
    }));
    if (sf) sf.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(sf);
      const paces = {};
      for (const k of Object.keys(settings.paces)) {
        paces[k] = { min: parseDur(f.get(`${k}_min`)) ?? settings.paces[k].min, max: parseDur(f.get(`${k}_max`)) ?? settings.paces[k].max };
      }
      await api('/settings', { method: 'PUT', body: { max_hr: Number(f.get('max_hr')), lthr: Number(f.get('lthr')), target_cadence: Number(f.get('target_cadence')), paces } });
      cachedSettings = null;
      out.textContent = '保存しました';
    };
  });

  return `
    ${getToken() && !err && status ? `<details class="card set-adv"><summary><b>アクセストークン</b> <span class="muted">設定済み</span></summary>
      <form id="token-form" class="row">
        <input name="token" id="token-input" type="password" placeholder="APP_TOKEN" value="${esc(getToken())}" style="flex:1">
        <button class="primary">保存</button>
      </form>
      <div class="row" style="margin-top:8px">
        <button id="token-show" type="button">表示する</button>
        <button id="token-copy" type="button">コピー</button>
      </div>
      <p class="muted">ホーム画面のアプリと Safari は別々に保存されます。Safari でコピーして、ホーム画面のアプリに貼り付けてください。</p>
      ${err ? `<p class="error">${esc(err)}</p>` : ''}
    </details>` : `
    <div class="card">
      <h2>アクセストークン</h2>
      <form id="token-form" class="row">
        <input name="token" id="token-input" type="password" placeholder="APP_TOKEN" value="${esc(getToken())}" style="flex:1">
        <button class="primary">保存</button>
      </form>
      <div class="row" style="margin-top:8px">
        <button id="token-show" type="button">表示する</button>
        <button id="token-copy" type="button">コピー</button>
      </div>
      <p class="muted">ホーム画面のアプリと Safari は別々に保存されます。Safari でコピーして、ホーム画面のアプリに貼り付けてください。</p>
      ${err ? `<p class="error">${esc(err)}</p>` : ''}
    </div>
    `}
    <pre id="out" style="white-space:pre-wrap;word-break:break-all;margin:8px 4px"></pre>
    ${status ? '<h2 class="sect">データの取り込み</h2>' : ''}
    ${status && settings ? `
    <div class="card" id="src-card"><h2>ランの取り込み元</h2>
      <div class="pf-seg pred-seg" style="--n:2"><button type="button" class="${(settings.source || 'strava') === 'strava' ? 'on' : ''}" data-src="strava">Strava のみ</button><button type="button" class="${settings.source === 'coros' ? 'on' : ''}" data-src="coros">COROS 優先</button></div>
      <p class="muted" style="margin:10px 0 0">${settings.source === 'coros' ? 'COROS のデータを正にします。COROS に無いランは Strava で補います。両方にあるランは 1 件のまま中身を COROS に置き換えます (計画・シューズ・ふりかえりは残ります)。' : 'Strava に同期されたランを取り込みます。'}</p>
      <div id="coros-box" class="coros-box"><p class="muted">COROS: 読み込み中…</p></div>
    </div>` : ''}
    ${status ? `
    <div class="card">
      <h2>Strava</h2>
      <p>${status.strava_connected ? `連携済み (athlete ${status.athlete_id})` : '未連携'}</p>
      <div class="row">
        <a class="btn primary" href="/auth/strava?key=${encodeURIComponent(getToken())}">${status.strava_connected ? '再連携' : 'Strava と連携'}</a>
        <button id="subscribe">Webhook 登録</button>
        <button id="subscription">Webhook 確認</button>
      </div>
    </div>
    <details class="card set-adv"><summary><b>過去データの取り込み・再評価</b></summary>
      <div id="bf-live" class="bf-live muted">読み込み中…</div>
      <div class="row"><button id="backfill-2025" class="primary">2025年1月から取り込む</button><button id="backfill-all">全期間</button><button id="backfill-30">直近30日</button><button id="reeval-30">直近30日を再評価</button><button id="backfill-status">進み具合</button><button id="backfill-stop">停止</button></div>
      <p class="muted">直近30日を先に取り込み、そのあと古い記録へ進みます。閉じて大丈夫です。Strava の上限に当たると自動で待って再開します。</p>
    </details>
    <h2 class="sect">評価と予測</h2>
    ${settings ? (() => {
      const src = settings.predict?.source || 'auto';
      const fs = settings.predict?.full_s ?? 11400;
      return `<div class="card" id="pred-card"><h2>フルマラソンの予測タイム</h2>
        <div class="pf-seg pred-seg" style="--n:3"><button type="button" class="${src === 'coros' ? 'on' : ''}" data-pred="coros">COROS</button><button type="button" class="${src === 'auto' ? 'on' : ''}" data-pred="auto">Strava で推定</button><button type="button" class="${src === 'manual' ? 'on' : ''}" data-pred="manual">手で入力</button></div>
        ${src === 'coros'
          ? `<div class="wk-tile" style="margin-top:10px;width:100%"><small>COROS の予測 (${esc(settings.coros?.updated || '-')} 時点・毎日自動で更新)</small><b class="num">${settings.coros?.predicted_s?.full ? dur(settings.coros.predicted_s.full) : '-'}</b></div>
             <p class="muted" style="margin:8px 0 0">COROS と連携すると、予測タイム・閾値ペース・閾値心拍・VO2max を毎日取り込みます。</p>`
          : src === 'auto'
          ? `<p class="muted" style="margin:10px 0 0">直近8週の、心拍つき・5km以上のランのペースと心拍から推定します。最大心拍の設定が正しいほど正確です。</p><p class="num" id="pred-auto" style="margin:6px 0 0"></p>`
          : `<button type="button" class="wk-tile" data-pred-time style="margin-top:10px;width:100%"><small>時計 (Garmin など) の予測 (タップして変更)</small><b class="num">${dur(fs)}</b></button>`}
      </div>`;
    })() : ''}
    ${settings.coros ? `<div class="card">
      <div class="row spread"><h2>COROS の値</h2><span class="src-tag coros">COROS 由来・${esc(settings.coros.updated)}</span></div>
      <div class="grid2 num">
        <div><div class="muted">ランニングレベル</div><div class="big" style="font-size:32px">${settings.coros.running_level}</div></div>
        <div><div class="muted">VO2max</div><div class="big" style="font-size:32px">${settings.coros.vo2max}</div></div>
      </div>
      <table style="margin-top:8px">
        <tr><td>閾値ペース / 心拍</td><td class="num">${pace(settings.coros.lt_pace_s)}/km・${settings.coros.lthr}bpm</td></tr>
        <tr><td>有酸素</td><td class="num">${pace(settings.coros.zones_s.aerobic[0])}〜${pace(settings.coros.zones_s.aerobic[1])}</td></tr>
        <tr><td>乳酸閾値</td><td class="num">${pace(settings.coros.zones_s.threshold[0])}〜${pace(settings.coros.zones_s.threshold[1])}</td></tr>
        <tr><td>スピード持久力</td><td class="num">${pace(settings.coros.zones_s.speed[0])}〜${pace(settings.coros.zones_s.speed[1])}</td></tr>
        <tr><td>予測 5km / 10km</td><td class="num">${dur(settings.coros.predicted_s['5k'])} / ${dur(settings.coros.predicted_s['10k'])}</td></tr>
        <tr><td>予測 ハーフ / フル</td><td class="num">${dur(settings.coros.predicted_s.half)} / ${dur(settings.coros.predicted_s.full)}</td></tr>
      </table>
      <div class="row" style="margin-top:12px"><button id="reset-settings">ペース帯・心拍の基準を標準に戻す</button></div>
    </div>` : ''}
    <form class="card" id="settings-form">
      <div class="row spread"><h2>評価の基準</h2><span class="src-tag stride">STRIDE</span></div>
      <div class="pf-seg pred-seg" style="--n:2;margin-bottom:10px"><button type="button" class="${settings.paces_auto !== false ? 'on' : ''}" data-pa="1">データから自動</button><button type="button" class="${settings.paces_auto === false ? 'on' : ''}" data-pa="0">手で設定</button></div>
      <p class="muted" style="margin:0 0 12px">${settings.paces_auto !== false
        ? `${settings.source === 'coros' || settings.predict?.source === 'coros' ? 'COROS の閾値・ゾーン' : '予測タイム'}、次のレースの目標タイム、最近の最大心拍から決めます。COROS の値やレースの目標が変わると自動で直ります。`
        : '下の値で評価します。数字を直したら保存してください。'}</p>
      <fieldset ${settings.paces_auto !== false ? 'disabled' : ''} class="sf-fields">
      <div class="grid2">
        <label>最大心拍<input name="max_hr" inputmode="numeric" value="${settings.max_hr}"></label>
        <label>LTHR (閾値心拍)<input name="lthr" inputmode="numeric" value="${settings.lthr}"></label>
      </div>
      <label>ピッチの参考値 (spm・減点の基準にはしません)<input name="target_cadence" inputmode="numeric" value="${settings.target_cadence}"></label>
      <table><tr><th>種別</th><th>速い側</th><th>遅い側</th></tr>
      ${Object.entries(settings.paces).map(([k, b]) => `<tr><td>${PLAN_LABELS[k]}</td><td><input name="${k}_min" value="${pace(b.min)}"></td><td><input name="${k}_max" value="${pace(b.max)}"></td></tr>`).join('')}
      </table>
      <p style="margin-top:12px"><button class="primary">保存</button></p>
      </fieldset>
      <details class="ri-more"><summary>この基準を使う分析</summary><p class="muted" style="font-size:12.5px">ペース帯 → 練習達成度のペース・計画の自動配置。最大心拍・閾値心拍 → 心拍の評価・心拍ゾーン・マラソン適性の心肺持久力・予測 (Strava で推定)。ピッチの参考値 → 表示だけ (後半まで保てたかで評価します)。</p></details>
    </form>
    <h2 class="sect">アプリ</h2>
    <div class="card">
      <h2>iPhone カレンダー</h2>
      <p class="muted">練習メニューとレースを iPhone のカレンダーに表示します (読み取り専用・自動更新)。</p>
      <div class="row"><button id="open-cal" class="primary">カレンダーに追加</button><button id="copy-cal">URL をコピー</button></div>
    </div>
    <div class="card" id="body-setup">
      <h2>からだのデータ (ヘルスケア)</h2>
      <p class="muted">iPhone のヘルスケアの体重・体脂肪率・安静時心拍・HRV・睡眠を、ショートカットで毎朝 STRIDE に送れます (ホームの「からだ」に出ます)。STRIDE はヘルスケアを直接は読めないため、この方法になります。</p>
      <details class="bd-howto"><summary>ショートカットの作り方</summary>
        <ol>
          <li>ショートカット App › オートメーション › ＋ › 「時刻」(例: 毎朝 7:00)・「すぐに実行」</li>
          <li>アクション「ヘルスケアサンプルを検索」を項目ごとに追加: 体重 / 体脂肪率 / 安静時心拍数 / 心拍変動 / 睡眠 (それぞれ「開始日が今日」「最新の 1 件」)</li>
          <li>アクション「URL の内容を取得」: URL <code>${esc(location.origin)}/api/body</code>・方法 POST・ヘッダ <code>Authorization</code> = <code>Bearer (設定のトークン)</code>・本文 JSON に次のキーで値を入れる</li>
        </ol>
        <pre class="bd-json">{"weight": 体重, "body_fat": 体脂肪率,
 "resting_hr": 安静時心拍数, "hrv": 心拍変動,
 "sleep_h": 睡眠 (時間)}</pre>
        <p class="muted">無いキーは省いて大丈夫です。体脂肪率は 0.152 でも 15.2 でも受け取れます。日付を変えたいときは "date": "2026-11-12" を足します。</p>
      </details>
    </div>
    <div class="card">
      <h2>通知</h2>
      <p class="muted">ntfy: ${status.ntfy_topic_set ? '設定済み' : '未設定'}・Bark: ${status.bark_set ? '設定済み' : '未設定'}</p>
      <div class="row"><button id="test-notify">テスト通知</button><button id="morning">朝の通知を今すぐ送る</button></div>
    </div>
    <div class="card">
      <h2>バックアップ</h2>
      <p class="muted">計画・実績・レース・シューズ・ふりかえり・体調をファイルに書き出し、別の環境へ引き継げます (COROS の 1 秒ごとの記録は含みません。COROS から取り直せます)。読み込むと、同じ記録は上書き、無い記録は追加します。</p>
      <div class="row"><button id="bk-out" class="primary">書き出す</button><button id="bk-in">読み込む</button><input type="file" id="bk-file" accept="application/json,.json" hidden></div>
      <p class="muted" id="bk-msg"></p>
    </div>
    ` : ''}
    `;
}

// ---------------------------------------------------------------- router

let ROUTE_SEQ = 0;
async function route() {
  const seq = ++ROUTE_SEQ; // 続けて呼ばれたときは、最後の 1 回だけ画面に出す (古い描画が後から上書きしない)
  const [path, query] = location.hash.slice(1).split('?');
  const params = new URLSearchParams(query);
  const parts = (path || '/').split('/').filter(Boolean);
  const tab = parts[0] || 'home';
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
  view.dataset.tab = parts[1] ? `${tab}-detail` : tab;
  // 詳細ページ (ランの詳細・週/日の評価・別の週) では「戻る」を出す
  const isRoot = parts.length <= 1 && !query && tab !== 'weather';
  document.getElementById('back').classList.toggle('hidden', isRoot);
  document.querySelector('h1').classList.toggle('hidden', !isRoot);
  window.scrollTo(0, 0);

  if (!getToken() && tab !== 'settings') {
    location.hash = '#/settings';
    return;
  }
  try {
    view.innerHTML = '<p class="muted">読み込み中…</p>';
    const html =
      tab === 'plans' ? await plansView(params)
      : tab === 'activities' ? (parts[1] ? await activityDetailView(parts[1]) : await activitiesView(params))
      : tab === 'weather' ? await weatherView()
      : tab === 'races' ? (parts[1] === 'find' ? await raceFindView() : parts[1] ? await raceDetailView(parts[1]) : await racesView())
      : tab === 'shoes' ? (parts[1] ? await shoeDetailView(parts[1]) : await shoesView(params))
      : tab === 'settings' ? await settingsView()
      : await homeView();
    if (seq !== ROUTE_SEQ) return;
    view.innerHTML = html;
    setHeaderH();
    bindTrend(view);
    if (document.getElementById('news-list')) loadNews();
    if (document.getElementById('insights')) loadInsights();
    if (document.getElementById('shoe-cmp')) loadShoeCompare();
    if (document.getElementById('cond')) loadCondition();
    if (document.getElementById('bodyc')) loadBody();
  } catch (e) {
    if (seq === ROUTE_SEQ) view.innerHTML = `<div class="card error">${esc(e.message)}</div>`;
  }
}

/** 上の見出し (戻る・STRIDE) の高さ。iPhone ではノッチの分だけ高くなるので、固定するタブをこの下に置く */
const setHeaderH = () => { const h = document.querySelector('header'); if (h) document.documentElement.style.setProperty('--hdr-h', `${Math.round(h.getBoundingClientRect().height)}px`); };
window.addEventListener('resize', setHeaderH);
window.addEventListener('hashchange', route);
route();

document.getElementById('back').onclick = () => {
  const [path] = location.hash.slice(1).split('?');
  // 履歴が無い (ホーム画面から直接開いた) ときは、そのタブの一覧へ
  if (history.length > 1) history.back();
  else location.hash = `#/${(path || '/').split('/').filter(Boolean)[0] || ''}`;
};

// ---- 新しい版の自動読み込み
// ホーム画面のアプリは裏で開いたままになりやすく、デプロイしても古い画面が残る。
// アプリに戻ったとき (と 10 分ごと) に app.js / style.css の版 (ETag) を確かめ、変わっていたら読み込み直す。
const assetTag = async () => {
  try {
    const rs = await Promise.all(['/app.js', '/style.css'].map((u) => fetch(u, { method: 'HEAD', cache: 'no-store' })));
    return rs.map((r) => r.headers.get('etag') || r.headers.get('last-modified') || '').join('|');
  } catch { return null; }
};
let loadedTag = null;
assetTag().then((t) => { loadedTag = t; });
const busy = () => document.body.classList.contains('wk-open') || document.querySelector('.sheet') || document.getElementById('dialog')?.open || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
async function checkUpdate() {
  if (!loadedTag || document.visibilityState !== 'visible' || busy()) return;
  const t = await assetTag();
  if (t && t !== loadedTag && !busy()) location.reload();
}
document.addEventListener('visibilitychange', checkUpdate);
setInterval(checkUpdate, 10 * 60 * 1000);

// ヘッダーの高さを CSS に渡す (タブをヘッダーのすぐ下に固定するため)
{
  const hdr = document.querySelector('header');
  const setH = () => document.documentElement.style.setProperty('--hdr', `${hdr.offsetHeight}px`);
  setH();
  if (window.ResizeObserver) new ResizeObserver(setH).observe(hdr);
}
