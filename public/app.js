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
/** シューズ名からの用途の推定 (一括設定ボタンで使う) */
const SHOE_GUESS = [
  [/アルファフライ|alphafly|ヴェイパーフライ|vaporfly|ヴェイパー|vapor|metaspeed|メタスピード|adios pro|アディオス/i, ['race', 'speed']],
  [/evo\s*sl|エボ|ズームフライ|zoom\s*fly|ペガサスターボ|turbo|rc elite|ライトレーサー|シーラス/i, ['pace', 'speed']],
  [/インヴィンシブル|invincible|ボメロ|vomero|nimbus|superblast/i, ['recovery', 'long', 'easy']],
  [/ペガサス|pegasus|ストラクチャー|structure|ghost|kayano/i, ['easy', 'long']],
];
const guessPurposes = (name) => (SHOE_GUESS.find(([re]) => re.test(name || '')) || [null, null])[1];
let SHOES = [];
/** メニューに合うシューズを選ぶ: 用途が合う順 → 走行距離の少ない順。理由も返す */
function recommendShoe(type) {
  const pool = SHOES.filter((x) => !x.retired && x.total_km < x.limit_km);
  for (const pu of SHOE_PREF[type] ?? ['easy']) {
    const c = pool.filter((x) => purposesOf(x.purpose).includes(pu)).sort((a, b) => a.total_km / a.limit_km - b.total_km / b.limit_km);
    if (c.length) {
      const why = c.length > 1 ? `${PURPOSE_LABELS[pu]}用 ${c.length} 足のうち、走行距離が最も少ない` : `${PURPOSE_LABELS[pu]}用に設定している唯一の 1 足`;
      return { shoe: c[0], why };
    }
  }
  return null;
}
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

async function api(path, opts = {}) {
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

/** フォーム内容を dialog で表示し、送信値を返す (キャンセルは null) */
function openDialog(html, { onDelete } = {}) {
  dialogForm.innerHTML = `${html}
    <div class="row spread dlg-actions">
      <div>${onDelete ? '<button value="delete" class="danger" formnovalidate>削除</button>' : ''}</div>
      <div class="row"><button value="cancel" formnovalidate>キャンセル</button><button value="ok" class="primary">保存</button></div>
    </div>`;
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.onclose = async () => {
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

/** ホームのニュース。画面を出したあとで読み込む (遅くてもホームの表示を待たせない) */
const NEWS_TAG = { シューズ: 'var(--c-long)', 大会: 'var(--c-m)', レース: 'var(--c-easy)', セール: 'var(--bad)' };
function ago(iso) {
  const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 3600000));
  return h < 1 ? 'たった今' : h < 24 ? `${h}時間前` : `${Math.round(h / 24)}日前`;
}
async function loadNews() {
  const box = document.getElementById('news-list');
  if (!box) return;
  try {
    const list = await api('/news');
    box.innerHTML = list.length ? `<ul class="news-l">${list.map((n) => `<li><a href="${esc(n.url)}" target="_blank" rel="noopener">
      <span class="news-tag" style="--tc:${NEWS_TAG[n.tag] || 'var(--muted)'}">${esc(n.tag)}</span>
      <b>${esc(n.title)}</b><small class="muted">${esc(n.source)}・${ago(n.date)}</small></a></li>`).join('')}</ul>` : '<p class="muted">いまは表示できるニュースがありません。</p>';
  } catch { box.innerHTML = '<p class="muted">ニュースを読み込めませんでした。</p>'; }
}

async function homeView() {
  const t = today();
  const ws = weekStart(t);
  const [plans, acts, races, status, settings, weather, wxWeek] = await Promise.all([
    api(`/plans?from=${ws}&to=${addDays(ws, 6)}`),
    api(`/activities?from=${addDays(t, -14)}&to=${t}`),
    api('/races'),
    api('/status'),
    api('/settings'),
    api('/race-weather').catch(() => null),
    loadWx(),
  ]);
  dedupeIfNeeded(plans);
  const todays = uniqPlans(plans.filter((p) => p.date === t));
  const next = races.find((r) => r.date >= t);
  // 6 週間前から、次のレースの週まで (最大 14 週先)。過去は実績、先は計画
  const endDay = next && next.date <= addDays(ws, 7 * 14) ? next.date : addDays(ws, 6);
  const summary = await api(`/summary?from=${addDays(ws, -7 * 6)}&to=${endDay}`);

  return `
    ${status.strava_connected || status.coros_connected || settings.source === 'coros' ? '' : '<div class="card error">ランのデータが未連携です。<a href="#/settings">設定</a>から COROS か Strava と連携してください。</div>'}
    <div class="card">
      <div class="row spread"><h2>今日 ${md(t)}(${dow(t)})</h2><a href="#/plans" class="muted">計画を編集</a></div>
      ${todays.length === 0 ? '<p class="muted">メニュー未登録</p>' : todays.map((p, i) => planLine(p, false, i === 0 ? markHtml(dayJudge(t, todays, acts.filter((x) => x.date === t), settings)) : '')).join('')}
    </div>
    ${wxWeek ? weekWxCard(t, wxWeek.place) : ''}
    ${next ? `
    <div class="card hero">
      <div class="row spread"><h2>${esc(next.name)}まで</h2><span class="badge">${esc(next.priority)}</span></div>
      <div class="row spread">
        <div class="hero-d">${daysBetween(t, next.date) === 0 ? '<span class="big" style="font-size:44px">本日</span>' : `あと <span class="big">${daysBetween(t, next.date)}</span> 日`}</div>
        <div class="muted num">${md(next.date)}・${km(next.distance_m)}km${next.goal_time_s ? `<br>目標 ${dur(next.goal_time_s)} (${pace(next.goal_time_s / (next.distance_m / 1000))}/km)` : ''}</div>
      </div>
      <a class="herolink" href="#/races/${next.id}">ペース表・持ち物 ›</a>
    </div>
    ${weatherCard(weather)}
    ${goalCard()}` : ''}
    ${await monthGoalCard(t)}
    <div class="card">
      <h2>週間距離</h2>
      ${weeklyChart(summary)}
    </div>
    <div class="card news"><h2>ランニングニュース</h2><div id="news-list"><p class="muted">読み込み中…</p></div></div>`;
}

/** 等ペースで走った場合の 5km ごとの通過タイム */
/** ペース戦略: 区間ペース (秒/km) を位置 (km) の関数で返す。どれも合計タイムは目標と同じ */
const PACE_PLANS = {
  even: { label: 'イーブン', note: '最初から最後まで同じペース。いちばん安定します。', f: (per) => () => per },
  negative: { label: 'ネガティブ', note: '前半を 4 秒/km 抑え、後半を 4 秒/km 上げます。', f: (per) => (k, dist) => per + (k < dist / 2 ? 4 : -4) },
  active: { label: 'アクティブ', note: '前半を 4 秒/km 速く入って貯金し、後半は粘ります。', f: (per) => (k, dist) => per + (k < dist / 2 ? -4 : 4) },
};
function paceRows(race, mode) {
  const dist = race.distance_m / 1000;
  const per = race.goal_time_s / dist;
  const f = (PACE_PLANS[mode] || PACE_PLANS.even).f(per, dist);
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
    rows.push({ k, t: tt, lap: lapPace, half: Math.abs(k - dist / 2) < 0.01 && dist > 40, fin: k === dist });
    prevT = tt; prevK = k;
  }
  return rows;
}
function splitTable(race, mode = 'even') {
  if (!race.goal_time_s) return '<p class="muted">目標タイムを設定すると、ペース表が出ます。</p>';
  const rows = paceRows(race, mode);
  const paces = rows.map((r) => r.lap);
  const fast = Math.min(...paces), slow = Math.max(...paces);
  const w = (p) => (slow - fast < 1 ? 78 : 62 + ((slow - p) / (slow - fast)) * 38);
  return `<div class="ptable">
    <div class="ph"><span>地点</span><span>通過</span><span>この区間のペース</span></div>
    ${rows.map((r) => `<div class="pr ${r.half ? 'half' : ''} ${r.fin ? 'fin' : ''}">
      <span class="pk">${r.fin ? 'ゴール' : r.half ? 'ハーフ' : `${Math.round(r.k)}km`}</span>
      <b class="num">${dur(r.t)}</b>
      <span class="pbar"><i style="width:${w(r.lap)}%"></i><em class="num">${pace(r.lap)}</em></span>
    </div>`).join('')}
  </div>`;
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
  // 月の経過に対して、どれだけ進んでいるか
  const expected = goal.km * ((Number(t.slice(8)) - 1) / lastD);
  const ahead = actual - expected;
  return `<div class="card"><div class="row spread"><h2>${Number(month.slice(5))}月の目標</h2><button type="button" class="mg-btn" data-mg-edit><b class="num">${goal.km}km</b><small>${fromPlan ? '計画から' : '変更'} ›</small></button></div>
    <div class="row spread num" style="margin:6px 0"><span><b>${actual.toFixed(1)}</b> km 走った</span><span class="muted">残り ${left.toFixed(0)}km</span></div>
    <div class="bar mg"><div style="width:${ratio * 100}%"></div><i style="left:${Math.min(100, (expected / goal.km) * 100)}%"></i></div>
    <p class="muted" style="margin:8px 0 0">${left <= 0 ? '目標を達成しました。' : `あと${daysLeft}日・1日平均 ${(left / daysLeft).toFixed(1)}km (目安より ${ahead >= 0 ? `${ahead.toFixed(0)}km 先行` : `${(-ahead).toFixed(0)}km 遅れ`})`}</p>
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
        <div><span class="muted">風</span><b>${n.wind.toFixed(1)}m/s</b></div>
        <div><span class="muted">降水</span><b>${n.precip_pct ?? 0}%</b></div>
        <div><span class="muted">暑さ指数</span><b style="color:${wbgtColor(n.wbgt)}">${n.wbgt}</b></div>
      </div>
      <p class="muted" style="margin:10px 0 0">暑さ指数 <b style="color:${wbgtColor(n.wbgt)}">${wbgtLabel(n.wbgt)}</b></p>
    </div>` : ''}
    <div class="card"><h2>ランのアドバイス</h2><ul class="bullets">${f.advice.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
</div>
    <div class="card"><h2>おすすめの時間帯</h2>${best(f.daily[0], '今日')}${best(f.daily[1], '明日')}${best(f.daily[2], dowOf(f.daily[2]?.date || '') + '曜')}</div>
    <div class="card"><h2>今日から 24 時間</h2>${hourChart(f.hourly)}
      <div class="hscroll">${f.hourly.slice(0, 24).map((h) => `<div class="hcell"><span class="muted num">${h.h}時</span>${wxIcon(h.code, 22)}<b class="num">${Math.round(h.temp)}°</b><span class="rain num">${(h.precip_pct ?? 0) >= 20 ? h.precip_pct + '%' : ''}</span><i style="background:${idxColor(h.index)}"></i></div>`).join('')}</div></div>
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

function weatherCard(w) {
  if (!w) return '';
  const hrs = w.hours.map((h) => `<div><div class="muted">${h.h}時</div><b>${Math.round(h.temp)}℃</b><div class="muted">${h.humidity ?? '-'}%</div></div>`).join('');
  return `<div class="card">
    <div class="row spread"><h2>${esc(w.race)}の天気 (${w.place})</h2><span class="muted num">${md(w.date)}</span></div>
    <div class="row" style="gap:10px;align-items:center">${w.code != null ? wxPair(w, 36) + `<b>${esc(wxText(w))}</b>` : ''}</div>
    <div class="num" style="font-size:20px">${Math.round(w.tmin)}〜${Math.round(w.tmax)}℃ <span class="muted" style="font-size:13px">降水${w.precip_pct ?? '-'}%・風${w.wind_max.toFixed(0)}m/s</span></div>
    <div class="hours num">${hrs}</div>
    <p style="margin:8px 0 0">${esc(w.advice)}</p>
  </div>`;
}

/** 目標タイムまでの距離。サブ3・レース目標・COROS 予測を 1 本の時間軸に並べる */
/** 目標への現在地と課題 (サーバーで実績から判定)。ホームを出したあとで読み込む */
const LV_COLOR = { ok: 'var(--good)', warn: 'var(--mid)', bad: 'var(--bad)' };
function goalCard() {
  return `<div class="card ins"><h2>目標への現在地</h2><div id="insights"><p class="muted">読み込み中…</p></div></div>`;
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
      <details class="ins-all"><summary>すべての項目</summary><div class="ins-list">${r.items.map(row).join('')}</div></details>`;
  } catch { box.innerHTML = '<p class="muted">読み込めませんでした。</p>'; }
}

function shoeLine(p, calendar) {
  if (!calendar || p.type === 'rest' || p.activity_id) return '';
  const r = recommendShoe(p.type);
  return r ? `<div class="shoe-rec">おすすめ: ${esc(r.shoe.name)} <span class="muted">${Math.round(r.shoe.total_km)}km</span><div class="muted why">${esc(r.why)}</div></div>` : '';
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
  return `<div class="stp">${steps.map((sp) => {
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
  if (!runPlans.length) return done > 0 && dayPlans.length ? { k: 'warn', t: '休養日に走りました' } : null;
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
    view.querySelector('#plan-cal').onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { const st = await api('/status'); location.href = st.calendar_url.replace(/^https?:/, 'webcal:'); } catch (err) { alert(err.message); }
      b.disabled = false;
    };
    view.querySelector('#copy-week').onclick = async () => {
      if (!confirm(`この週の計画を翌週 (${md(addDays(ws, 7))}〜) に複製しますか？`)) return;
      const r = await api('/plans/copy-week', { method: 'POST', body: { from: ws, to: addDays(ws, 7) } });
      alert(`${r.copied} 件を複製しました`);
      location.hash = `#/plans?week=${addDays(ws, 7)}`;
    };
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
    <div class="card">
      <div class="row spread num"><span>計画 ${km(total)}km・実績 ${km(actual)}km</span><button id="copy-week">この週を翌週へコピー</button></div>
      <p class="muted hint" style="margin:10px 0 0">左の「⠿」を押したまま別の日へ動かすと、その日と予定が入れ替わります。メニューをタップすると中身を直せます。</p>
      <button id="plan-cal" class="cal-btn"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4M12 13v4M10 15h4"/></svg><span>iPhone のカレンダーに表示<small>一度追加すれば、予定を変えると自動で反映</small></span></button>
    </div>
    <div class="card" id="cal">
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
    <h2 class="sect">予定を組む</h2>
    <div class="card tools">
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
    </div>`;
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
async function pickTime(title, sec, maxMin = 120) {
  const r = await wheelPick(title, [
    { items: range(0, maxMin), value: Math.floor(sec / 60), unit: '分' },
    { items: range(0, 59, (x) => String(x).padStart(2, '0')), value: Math.round(sec % 60), unit: '秒' },
  ]);
  return r ? Math.max(10, r[0] * 60 + r[1]) : null;
}
/** レースの目標タイムを 時:分:秒 のホイールで選ぶ */
async function pickGoal(title, sec) {
  const r = await wheelPick(title, [
    { items: range(0, 7), value: Math.floor(sec / 3600), unit: ':' },
    { items: range(0, 59, (x) => String(x).padStart(2, '0')), value: Math.floor((sec % 3600) / 60), unit: ':' },
    { items: range(0, 59, (x) => String(x).padStart(2, '0')), value: Math.round(sec % 60) },
  ]);
  return r ? r[0] * 3600 + r[1] * 60 + r[2] : null;
}
/** ペース (秒/km) を 分:秒 のホイールで選ぶ */
async function pickPace(title, sec) {
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
            <div class="wk-tiles">
              <button type="button" class="wk-tile" data-wheel="km"><small>距離</small><b class="num">${(st.km ?? 10).toFixed(1)}<span>km</span></b></button>
              <button type="button" class="wk-tile" data-wheel="prange"><small>ペース${st.pmin ? '' : ' (標準)'}</small><b class="num">${pdisp()}<span>/km</span></b></button>
            </div>
            <p class="muted zone-note" style="margin:8px 0 0">タップして選びます。${st.pmin ? '<button type="button" class="linkbtn" data-pdef="1">ペースを標準に戻す</button>' : ''}</p>
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
        row(k('val'), '目標', fmtTarget(t), `<button type="button" class="wk-pick" data-wheel="val:${part}">${fmtTarget(t)}<small>タップして選ぶ</small></button>`),
      ];
      if (!(sp.kind === 'rest' || (sp.kind === 'interval' && part === 'rest'))) {
        const b = bandOf(t);
        rows.push(row(k('pace'), 'ペース範囲', paceText(t), `
          <div class="chips">${Object.entries(REFS).map(([r, R]) => chip('data-sref', `${part}:${r}`, `${R.label}ペース`, t.ref === r && !(t.pmin && t.pmax))).join('')}</div>
          <div class="chips">${ZONES.map((Z, z) => chip('data-szone', `${part}:${z}`, Z.short, !t.ref && !(t.pmin && t.pmax) && t.zone === z)).join('')}</div>
          <div class="wk-pick2"><button type="button" class="wk-pick" data-wheel="pmin:${part}"><small>速い側</small>${pace(Math.round(b[0]))}</button><button type="button" class="wk-pick" data-wheel="pmax:${part}"><small>遅い側</small>${pace(Math.round(b[1]))}</button></div>`));
      }
      return rows.join('');
    };
    const stepHtml = () => {
      const i = scr.i, sp = st.steps[i];
      if (!sp) return listHtml();
      const kindRow = sp.kind === 'interval' ? '' : row('kind', 'ステップ', STEP_KINDS[sp.kind], `<div class="chips">${['warmup', 'work', 'rest', 'cooldown'].map((k) => chip('data-skind', k, STEP_KINDS[k], sp.kind === k)).join('')}</div>`);
      const body = sp.kind === 'interval'
        ? `${row('reps', '本数', `${sp.reps}本`, `<button type="button" class="wk-pick" data-wheel="reps">${sp.reps}本<small>タップして選ぶ</small></button>`)}
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
      if (d.wheel) {
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

async function activitiesView(params) {
  const kind = params?.get('view') || 'list';
  const tabs = `<div class="seg">${REVIEW_TABS.map(([k, l]) => `<a href="#/activities${k === 'list' ? '' : `?view=${k}`}" class="${k === kind ? 'on' : ''}">${l}</a>`).join('')}</div>`;
  if (kind === 'list') {
    const acts = await api('/activities');
    return `${tabs}<div class="card"><h2>ラン一覧</h2>${activityList(acts)}</div>`;
  }
  const anchor = params.get('date') || today();
  const p = periodOf(kind, anchor);
  const [r, trend] = await Promise.all([api(`/review?from=${p.from}&to=${p.to}&kind=${kind}`), kind === 'list' || kind === 'day' ? null : api('/trend?weeks=12')]);
  const link = (d) => `#/activities?view=${kind}&date=${d}`;
  const stat = (label, value, sub = '') => `<div><div class="muted">${label}</div><div class="stat num">${value}</div>${sub ? `<div class="muted num">${sub}</div>` : ''}</div>`;
  const pct = r.completion == null ? '' : `${Math.round(r.completion * 100)}%`;
  return `${tabs}
    <div class="row spread" style="margin-bottom:8px">
      <a class="btn" href="${link(p.prev)}">‹</a><strong>${p.label}</strong><a class="btn" href="${link(p.next)}">›</a>
    </div>
    <div class="card">
      <div class="row spread"><h2>${kind === 'day' ? '日次' : kind === 'week' ? '週間' : '月間'}評価</h2>
        ${r.grade ? `<span class="grade g${r.grade}">${r.grade}<small>${GRADE_NOTE[r.grade]}${r.grade_calc ? `・${r.grade_calc.pts}点` : ''}</small></span>` : ''}</div>
      <div class="grid3">
        ${stat('距離', `${r.km}km`, r.planned_km ? `計画 ${r.planned_km}km${pct ? `・${pct}` : ''}` : '')}
        ${stat('回数', `${r.runs}回`, `${r.run_days}日`)}
        ${stat('平均点', r.avg_score ?? '-', r.avg_hr ? `平均心拍 ${r.avg_hr}` : '')}
        ${stat('平均ペース', r.avg_pace_s ? `${pace(r.avg_pace_s)}` : '-', `/km`)}
        ${stat('最長', `${r.longest_km}km`, kind === 'month' ? `28km以上 ${r.long_runs_28}回` : '')}
        ${stat('負荷(TL)', r.tl, kind === 'day' ? (r.tl < 40 ? '低い' : r.tl < 90 ? '適度' : '高い') : '')}
        ${stat('ポイント練', r.quality.planned ? `${r.quality.done}/${r.quality.planned}` : '-', r.delta_km_pct != null && kind !== 'day' ? `前${kind === 'week' ? '週' : '月'}比 ${r.delta_km_pct >= 0 ? '+' : ''}${r.delta_km_pct}%` : '')}
      </div>
    </div>
    ${kind === 'week' ? `<div class="card"><h2>日ごとの距離</h2>${bubbles(r.days)}</div>` : ''}
    ${trend ? `<div class="card"><h2>過去12週間</h2>${trendChart(trend, weekStart(anchor))}</div>` : ''}
    <div class="card"><h2>コメント</h2><ul class="bullets">${r.comments.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>
    ${r.next.length ? `<div class="card"><h2>次にやること</h2><ul class="bullets">${r.next.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
    <div class="card"><h2>ラン</h2>${r.list.length === 0 ? '<p class="muted">記録なし</p>' : `<ul class="list">${r.list.map((a) => `
      <li><a href="#/activities/${a.id}">
        <div class="row spread"><span>${md(a.date)}(${dow(a.date)}) ${esc(a.name)}</span>${scoreHtml(a.score)}</div>
        <div class="muted num">${km(a.distance_m, 2)}km・${pace(a.moving_time_s / (a.distance_m / 1000))}/km${a.avg_hr ? `・${Math.round(a.avg_hr)}bpm` : ''}</div>
        ${kind === 'day' ? a.comments.map((c) => `<div class="muted">・${esc(c)}</div>`).join('') : ''}
      </a></li>`).join('')}</ul>`}</div>`;
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
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

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
  for (let k = step; k < total; k += step) xl += `<text x="${X(k).toFixed(1)}" y="${H - 6}" text-anchor="middle">${k}km</text>`;
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
    ${rv.race ? `<div><span class="muted">${esc(rv.race.name)}</span><div class="rv-goal num">${esc(rv.race.goal)}</div><span class="muted">${rv.race.need_pace ? `必要ペース ${esc(rv.race.need_pace)}` : `あと${rv.race.days}日`}</span></div>` : ''}</div>
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
  const SHORT = { breath: '呼吸', leg: '脚', rpe: 'きつさ', form: 'フォーム', pain: '痛み' };
  const items = FB_SLIDERS.filter(([k]) => fb[k] != null).map(([k]) => `<div><span class="muted">${SHORT[k]}</span><b class="num">${fb[k]}<small>/10</small></b></div>`);
  const rs = FB_RESERVE.find(([v]) => v === fb.reserve);
  if (rs) items.push(`<div><span class="muted">余裕</span><b class="num fbs-rs">あと${rs[1]}</b></div>`);
  const tags = FB_TAG.filter(([v]) => (fb.tags || []).includes(v)).map(([, l]) => `<span class="chip on mini">${l}</span>`).join('');
  return `<div class="card rv fbx"><div class="row spread"><h3>ふりかえり</h3><button type="button" class="chip" data-fb-edit>修正</button></div>
    <div class="fbs-grid">${items.join('')}</div>
    ${tags ? `<div class="chips mini" style="margin-top:8px">${tags}</div>` : ''}
    ${fb.memo ? `<p class="fbs-memo">${esc(fb.memo)}</p>` : ''}
    <div id="fb-notes">${(notes || []).map((t) => `<p class="fb-note">${esc(t)}</p>`).join('')}</div></div>`;
}
const hasFeedback = (fb) => FB_SLIDERS.some(([k]) => fb[k] != null) || !!fb.reserve || (fb.tags || []).length > 0 || !!fb.memo;

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
    cadence: ['ケイデンス', '目標ピッチとの差と、後半の落ち込み。目標より1spm低いごとに約8点減ります。'],
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
        <div class="sheet-row">${list.map((x) => `<button type="button" class="sh-card ${a.shoe_id === x.id ? 'on' : ''}" data-sh="${x.id}"><div class="shoe-img big">${x.image ? `<img src="${x.image}" alt="">` : '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16v-3l4-1 2-3 3 2 4 1c3 .5 5 2 5 4v1H3z"/><path d="M3 19h18"/></svg>'}</div><b>${esc(x.name)}</b><span class="muted num">${Math.round(x.total_km)}km</span></button>`).join('')}
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
      const st = { breath: null, leg: null, rpe: null, form: null, pain: null, reserve: null, memo: '', tags: [], ...(rv.fb || {}) };
      if (fbox) {
        let notes = rv.notes;
        const showSummary = () => {
          fbox.innerHTML = feedbackSummary(st, notes);
          fbox.querySelector('[data-fb-edit]').onclick = showForm;
        };
        const showForm = () => {
          fbox.innerHTML = feedbackHtml(st, notes);
          bindFeedback(fbox, st, async (body) => {
            await api(`/activities/${id}/feedback`, { method: 'PUT', body });
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
    api(`/activities/${id}/series`).then((sr) => {
      const box = view.querySelector('#series');
      if (!box || !sr || sr.error) { if (box) box.innerHTML = ''; return; }
      box.innerHTML = seriesCards(sr);
      const set = (k, v) => { const el = view.querySelector(`#${k}`); if (el && v != null) el.textContent = v; };
      set('st-fast', sr.fast_km_s ? pace(sr.fast_km_s) : null);
      set('st-elev', sr.elev_gain != null ? `${Math.round(sr.elev_gain)}` : null);
      set('st-cad', sr.avg.cad ? `${sr.avg.cad}` : null);
      set('st-cal', sr.calories ? `${Math.round(sr.calories)}` : null);
    }).catch(() => { const box = view.querySelector('#series'); if (box) box.innerHTML = ''; });
    view.querySelector('#reeval').onclick = async (e) => {
      e.target.disabled = true;
      await api(`/activities/${id}/reevaluate`, { method: 'POST' });
      route();
    };
  });

  const hrd = ev?.hr?.details || {};
  const zones = [1, 2, 3, 4, 5].map((z) => hrd[`z${z}_pct`]);
  const sib = a.siblings || [];
  const sumD = sib.reduce((x, r) => x + r.distance_m, 0), sumT = sib.reduce((x, r) => x + r.moving_time_s, 0);
  const planName = (p) => `${PLAN_LABELS[p.type]}${p.distance_m ? ' ' + km(p.distance_m) + 'km' : ''}`;
  const uPlans = uniqPlans(plans);

  return `
    <div class="card hd">
      <div class="row spread"><h2>${esc(a.name)}</h2><span class="ext-links">${a.coros ? `<a class="muted" href="https://t.coros.com/activity-detail?labelId=${encodeURIComponent(a.coros.label_id)}&sportType=${a.coros.sport_type}" target="_blank" rel="noopener">COROS ↗</a>` : ''}${a.id > 0 ? `<a class="muted" href="https://www.strava.com/activities/${a.id}" target="_blank" rel="noopener">Strava ↗</a>` : ''}</span></div>
      <div class="muted">${a.start_date_local.slice(0, 16).replace('T', ' ')}${ev?.role ? `<span class="role">${{ warmup: 'アップ', work: 'メイン', cooldown: 'ダウン' }[ev.role]}</span>` : ''}</div>
      <div class="row spread hd-main"><div class="num"><span class="hd-km">${km(a.distance_m, 2)}</span><span class="hd-u">km</span></div>
        <div style="text-align:right"><div class="muted">総合</div><div class="big">${scoreHtml(a.score)}</div></div></div>
      <div class="stats num">
        <div><b>${dur(a.moving_time_s)}</b><span>運動時間</span></div>
        <div><b>${pace(a.moving_time_s / (a.distance_m / 1000))}<small>/km</small></b><span>平均ペース</span></div>
        <div><b>${a.avg_hr ? Math.round(a.avg_hr) : '-'}<small>bpm</small></b><span>平均心拍</span></div>
        <div><b id="st-fast">-</b><span>最速 (1km)</span></div>
        <div><b>${a.max_hr ? Math.round(a.max_hr) : '-'}<small>bpm</small></b><span>最大心拍</span></div>
        <div><b><span id="st-elev">-</span><small>m</small></b><span>累積上昇</span></div>
        <div><b id="st-cad">${a.avg_cadence_spm ? Math.round(a.avg_cadence_spm * 2) : '-'}</b><span>ピッチ spm</span></div>
        <div><b id="st-cal">-</b><span>カロリー kcal</span></div>
      </div>
    </div>
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
    </div>`;
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

async function raceDetailView(id) {
  const [races, state, weather] = await Promise.all([
    api('/races'),
    api(`/checklist/${id}`).catch(() => ({ checked: [], custom: [] })),
    api('/race-weather').catch(() => null),
  ]);
  // 持ち物のひな形 (全レース共通)。設定に保存してあればそれ、無ければ最初の一覧
  const st0 = await api('/settings').catch(() => ({}));
  let tmpl = Array.isArray(st0.checklist_template) ? st0.checklist_template : CHECK_ITEMS.map(([cat, iid, text]) => ({ cat, id: iid, text }));
  let editing = false;
  const r = races.find((x) => x.id === Number(id));
  if (!r) return '<div class="card error">レースが見つかりません</div>';
  let mode = 'even';
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
    view.querySelector('#ck-add').classList.toggle('hidden', !editing);
    view.querySelector('#ck-edit').textContent = editing ? '完了' : '編集';
    view.querySelector('#ck-prog').textContent = `${done()} / ${items.length}`;
    view.querySelector('#ck-bar').style.width = `${(done() / items.length) * 100}%`;
  };
  setTimeout(() => {
    if (upcoming) wireChecks();
    view.querySelectorAll('[data-pm]').forEach((b) => (b.onclick = () => {
      mode = b.dataset.pm;
      view.querySelectorAll('[data-pm]').forEach((x) => x.classList.toggle('on', x === b));
      view.querySelector('#pace-out').innerHTML = splitTable(r, mode);
      view.querySelector('#pace-note').textContent = PACE_PLANS[mode].note;
    }));
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
    view.querySelector('#edit-race').onclick = async () => { await editRace(r); };
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
  return `
    <div class="card hero">
      <div class="row spread"><h2>${esc(r.name)}</h2><span class="badge">${esc(r.priority)}</span></div>
      <div class="row spread">
        <div>${dleft != null ? `<span class="big">${dleft}</span> 日` : '<span class="muted">終了</span>'}</div>
        <div class="muted num">${md(r.date)}・${km(r.distance_m)}km${r.goal_time_s ? `<br>目標 ${dur(r.goal_time_s)} (${pace(r.goal_time_s / (r.distance_m / 1000))}/km)` : ''}</div>
      </div>
    </div>
    ${weather && weather.race === r.name ? weatherCard(weather) : ''}
    <div class="card"><h2>ペース表</h2>
      <div class="gp2">
        <button type="button" class="gp-t" data-gp="time"><small>目標タイム</small><b class="num">${r.goal_time_s ? dur(r.goal_time_s) : '未設定'}</b></button>
        <button type="button" class="gp-t" data-gp="pace"><small>平均ペース</small><b class="num">${r.goal_time_s ? `${pace(r.goal_time_s / (r.distance_m / 1000))}<span>/km</span>` : '-'}</b></button>
      </div>
      <p class="muted hint" style="margin:0 0 12px">タップして選ぶと、ペース表も変わります。</p>
      ${r.goal_time_s ? `<div class="chips pm3" style="margin-bottom:10px">${Object.entries(PACE_PLANS).map(([k, v]) => `<button type="button" class="chip ${k === 'even' ? 'on' : ''}" data-pm="${k}">${v.label}</button>`).join('')}</div>
      <p class="muted" id="pace-note" style="margin-top:0">${PACE_PLANS.even.note}</p>` : ''}
      <div id="pace-out">${splitTable(r, 'even')}</div>
    </div>
    ${upcoming ? `<div class="card"><div class="row spread"><h2>持ち物</h2><div class="row" style="gap:8px;align-items:center"><b class="num" id="ck-prog"></b><button type="button" class="chip" id="ck-edit">編集</button></div></div>
      <div class="bar" style="margin:6px 0 10px"><div id="ck-bar" style="width:0"></div></div>
      <div id="checks"></div>
      <form id="ck-add" class="ck-add hidden">
        <p class="muted" style="margin:0 0 8px">「前日まで」「当日の朝」はすべてのレースで共通です。「このレースだけ」はこのレースにだけ入ります。</p>
        <div class="row" style="gap:8px"><select id="ck-cat"><option value="prep">前日まで</option><option value="morning">当日の朝</option><option value="other">このレースだけ</option></select>
        <input id="ck-new" placeholder="追加 (例: 梅干し)" style="flex:1;min-width:0" maxlength="60"><button class="primary">追加</button></div>
        <button type="button" class="linkbtn" id="ck-reset" style="margin-top:10px">最初の一覧に戻す</button>
      </form>
    </div>` : ''}
    <button id="edit-race" class="wide">レースの情報を編集</button>`;
}

async function racesView() {
  const races = await api('/races');
  const t = today();
  setTimeout(() => {
    view.querySelector('#add-race').onclick = () => editRace({ priority: 'A', distance_m: 42195 });
    view.querySelectorAll('[data-race]').forEach((el) => (el.onclick = () => (location.hash = `#/races/${el.dataset.race}`)));
  });
  const row = (r) => {
    const goalPace = r.goal_time_s ? pace(r.goal_time_s / (r.distance_m / 1000)) : null;
    const diff = r.goal_time_s && r.result_time_s ? r.result_time_s - r.goal_time_s : null;
    return `<li data-race="${r.id}" style="cursor:pointer">
      <div class="row spread"><span><span class="badge">${esc(r.priority)}</span> ${esc(r.name)}</span><span class="muted num">${r.date} ›</span></div>
      <div class="muted num">${km(r.distance_m, 3)}km・目標 ${dur(r.goal_time_s)}${goalPace ? ` (${goalPace}/km)` : ''}${r.date >= t ? `・あと${daysBetween(t, r.date)}日` : ''}</div>
      ${r.result_time_s ? `<div class="num">結果 <strong>${dur(r.result_time_s)}</strong>${diff != null ? ` <span class="score ${diff <= 0 ? 'good' : 'bad'}">${diff <= 0 ? '-' : '+'}${dur(Math.abs(diff))}</span>` : ''}${r.activity_id ? ` <a href="#/activities/${r.activity_id}">記録</a>` : ''}</div>` : ''}
    </li>`;
  };
  const upcoming = races.filter((r) => r.date >= t);
  const past = races.filter((r) => r.date < t).reverse();
  return `
    <div class="row spread" style="margin-bottom:8px"><h2>レース</h2><button class="primary" id="add-race">＋ 追加</button></div>
    <div class="card"><h2>予定</h2>${upcoming.length ? `<ul class="list">${upcoming.map(row).join('')}</ul>` : '<p class="muted">なし</p>'}</div>
    <div class="card"><h2>過去</h2>${past.length ? `<ul class="list">${past.map(row).join('')}</ul>` : '<p class="muted">なし</p>'}</div>`;
}

async function editRace(r) {
  const presets = [[42195, 'フル'], [21097.5, 'ハーフ'], [10000, '10K'], [5000, '5K']];
  const isPreset = presets.some(([d]) => d === r.distance_m);
  const values = await openDialog(`
    <h2>${r.id ? 'レースを編集' : 'レースを追加'}</h2>
    <label>大会名<input name="name" value="${esc(r.name)}" required></label>
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
  const over = live.filter((x) => x.total_km >= x.limit_km);
  if (over.length) out.push({ tone: 'bad', text: `交換目安を超えています: ${over.map((x) => esc(x.name)).join('、')}。引退にするか、入れ替えを。` });
  const raceShoe = live.find((x) => purposesOf(x.purpose).includes('race'));
  if (race && daysTo != null && daysTo >= 0 && daysTo <= 56) {
    if (!raceShoe) out.push({ tone: 'warn', text: `本番用がありません。${esc(race.name)}まで${daysTo}日。` });
    else if (raceShoe.total_km < 30) out.push({ tone: 'warn', text: `${esc(raceShoe.name)}は${Math.round(raceShoe.total_km)}km。本番前に 30〜50km で慣らしを。` });
  }
  const missing = ['recovery', 'pace', 'speed', 'long'].filter((pu) => !live.some((x) => purposesOf(x.purpose).includes(pu)));
  if (missing.length && live.length) out.push({ tone: 'info', text: `用途が未設定: ${missing.map((pu) => PURPOSE_LABELS[pu]).join('・')}。` });
  const near = live.filter((x) => x.total_km < x.limit_km && x.total_km / x.limit_km >= 0.85);
  if (near.length) out.push({ tone: 'warn', text: `そろそろ交換: ${near.map((x) => `${esc(x.name)}(残り${Math.round(x.limit_km - x.total_km)}km)`).join('、')}` });
  return out.slice(0, 3);
}

const STATUS = [[0, '使用中'], [2, '予備'], [1, '引退']];

async function putShoe(s, patch) {
  await api(`/shoes/${s.id}`, { method: 'PUT', body: { ...s, ...patch } });
}

async function shoesView() {
  const [shoes, races] = await Promise.all([api('/shoes'), api('/races').catch(() => [])]);
  const nextRace = races.filter((r) => r.date >= today() && ['A', 'B'].includes(r.priority)).sort((a, b) => a.date.localeCompare(b.date))[0];
  const advice = shoeAdvice(shoes, nextRace);
  const guesses = shoes.filter((x) => !x.retired && guessPurposes(x.name) && purposesOf(x.purpose).join() !== guessPurposes(x.name).join());
  setTimeout(() => {
    view.querySelector('#add-shoe').onclick = () => editShoe({ purpose: 'easy', limit_km: 700, initial_km: 0 });
    view.querySelectorAll('[data-shoe]').forEach((el) => (el.onclick = (e) => {
      if (e.target.closest('[data-st],[data-pq]') || el._swiped) return;
      editShoe(shoes.find((s) => s.id === Number(el.dataset.shoe)));
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
    const g = view.querySelector('#guess');
    if (g) g.onclick = async () => {
      if (!confirm(`名前から用途を推定して設定します:\n${guesses.map((x) => `${x.name} → ${guessPurposes(x.name).map((p) => PURPOSE_LABELS[p]).join('・')}`).join('\n')}\n(あとで各シューズから直せます)`)) return;
      g.disabled = true;
      for (const x of guesses) await putShoe(x, { purpose: guessPurposes(x.name).join(',') });
      route();
    };
  });
  const row = (s) => {
    const ratio = s.total_km / s.limit_km;
    const rt = (s.retired || 0) === 0 ? '予備にする' : '使用中に戻す';
    return `<li data-shoe="${s.id}" class="shoe-item ${s.retired ? 'off' : ''}">
      <div class="shoe-bg"><span class="bg-r">${rt}</span><span class="bg-l">${(s.retired || 0) === 1 ? '' : '役目を終える'}</span></div>
      <div class="shoe-fg">
      <div class="shoe-row">
        <div class="shoe-img">${s.image ? `<img src="${s.image}" alt="">` : '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16v-3l4-1 2-3 3 2 4 1c3 .5 5 2 5 4v1H3z"/><path d="M3 19h18"/></svg>'}</div>
        <div class="shoe-body"><b class="shoe-name">${esc(s.name)}</b>
        <div class="shoe-km num">${s.total_km.toFixed(1)}<small> / ${s.limit_km}KM</small></div>
        <div class="bar ${ratio >= 1 ? 'over' : ratio >= 0.9 ? 'warn' : ''}"><div style="width:${Math.min(100, ratio * 100)}%"></div></div>
        <div class="muted tiny">${purposeText(s)}</div>
        ${s.retired === 1 ? `<button type="button" class="chip" data-st="0" data-sid="${s.id}" style="margin-top:6px">使用中に戻す</button>` : ''}</div>
        <svg class="chev" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>
      </div>
      </div>
    </li>`;
  };
  const active = shoes.filter((s) => !s.retired), rest = shoes.filter((s) => s.retired);
  return `
    <div class="row spread" style="margin-bottom:8px"><h2>シューズ</h2><button class="primary" id="add-shoe">＋ 追加</button></div>
    ${advice.length ? `<div class="card"><ul class="advice">${advice.map((a) => `<li class="${a.tone}">${a.text}</li>`).join('')}</ul></div>` : ''}
    ${guesses.length ? `<div class="card"><p class="muted" style="margin-top:0">名前から、用途を自動で設定できます (${guesses.length}足)。</p><button id="guess" class="primary wide">用途をまとめて設定</button></div>` : ''}
    <div class="card"><ul class="list shoes">${active.map(row).join('') || '<li class="muted">使用中のシューズはありません</li>'}</ul></div>
    ${rest.length ? `<h3 class="sub" style="margin:18px 4px 6px">予備・引退 (${rest.length}足)</h3><div class="card"><ul class="list shoes">${rest.map(row).join('')}</ul></div>` : ''}
    <p class="muted hint">右へスライドで「予備/使用中」、左へスライドで「引退」。タップすると写真・用途・走行距離を直せます。</p>`;
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
  };
  q('#shoe-clear').onclick = () => set('');
  q('#shoe-search').onclick = () => {
    const name = dialogForm.querySelector('[name=name]').value || 'running shoes';
    q('#shoe-search').href = `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(name + ' シューズ')}`;
  };
}

async function editShoe(s) {
  const pending = openDialog(`
    <h2>${s.id ? 'シューズを編集' : 'シューズを追加'}</h2>
    <label>名称<input name="name" value="${esc(s.name)}" required></label>
    <div class="shoe-photo">
      <div class="shoe-img big" id="shoe-preview">${s.image ? `<img src="${s.image}" alt="">` : '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16v-3l4-1 2-3 3 2 4 1c3 .5 5 2 5 4v1H3z"/><path d="M3 19h18"/></svg>'}</div>
      <div class="row">
        <label class="btn" style="margin:0">写真を選ぶ<input type="file" id="shoe-file" accept="image/*" hidden></label>
        <a class="btn" id="shoe-search" target="_blank" rel="noopener">画像を探す</a>
        <button type="button" id="shoe-clear" class="danger">削除</button>
      </div>
      <input type="hidden" name="image" id="shoe-image" value="${s.image ? esc(s.image) : ''}">
    </div>
    <div class="field"><span class="lbl">どんな練習で使う？ (複数選べます)</span>
      <div class="chips" id="pu-chips">${Object.entries(PURPOSE_LABELS).map(([k, v]) => `<button type="button" class="chip ${purposesOf(s.purpose).includes(k) ? 'on' : ''}" data-pu="${k}">${v}</button>`).join('')}</div>
      <p class="muted hint" id="pu-hint"></p>
      <input type="hidden" name="purpose" value="${purposesOf(s.purpose).join(',')}">
    </div>
    <label>交換目安 (km)<input name="limit_km" inputmode="numeric" value="${s.limit_km}"></label>
    <div class="grid2">
      <label>走行距離 (km)<input name="total_km" inputmode="decimal" value="${s.id ? Math.round((s.total_km ?? s.initial_km) * 10) / 10 : (s.initial_km || 0)}"></label>
      <label>Strava gear ID<input name="strava_gear_id" placeholder="g12345" value="${esc(s.strava_gear_id)}"></label>
    </div>
    <div class="field"><span class="lbl">状態</span>
      <div class="chips" id="st-chips">${STATUS.map(([v, l]) => `<button type="button" class="chip ${(s.retired || 0) === v ? 'on' : ''}" data-stv="${v}">${l}</button>`).join('')}</div>
      <input type="hidden" name="retired" value="${s.retired || 0}">
    </div>`,
    s.id ? { onDelete: async () => { await api(`/shoes/${s.id}`, { method: 'DELETE' }); route(); } } : {},
  );
  wireShoePhoto();
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
  await api(s.id ? `/shoes/${s.id}` : '/shoes', { method: s.id ? 'PUT' : 'POST', body: { ...values, retired: Number(values.retired) || 0 } });
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
            <div class="row"><button type="button" data-dbg="querySportRecords">ランの一覧</button><button type="button" data-dbg="queryFitnessAssessmentOverview">体力評価</button><button type="button" data-probe="1">取得テスト</button><button type="button" data-cs="off" class="danger">連携を解除</button></div>
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
    run('#open-cal', async () => { location.href = status.calendar_url.replace(/^https?:/, 'webcal:'); return 'カレンダーを開きます'; });
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
    <pre id="out" style="white-space:pre-wrap;word-break:break-all;margin:8px 4px"></pre>
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
    <div class="card">
      <h2>過去データの取り込み</h2>
      <div id="bf-live" class="bf-live muted">読み込み中…</div>
      <div class="row"><button id="backfill-2025" class="primary">2025年1月から取り込む</button><button id="backfill-all">全期間</button><button id="backfill-30">直近30日</button><button id="reeval-30">直近30日を再評価</button><button id="backfill-status">進み具合</button><button id="backfill-stop">停止</button></div>
      <p class="muted">直近30日を先に取り込み、そのあと古い記録へ進みます。閉じて大丈夫です。Strava の上限に当たると自動で待って再開します。</p>
    </div>
    <div class="card">
      <h2>iPhone カレンダー</h2>
      <p class="muted">練習メニューとレースを iPhone のカレンダーに表示します (読み取り専用・自動更新)。</p>
      <div class="row"><button id="open-cal" class="primary">カレンダーに追加</button><button id="copy-cal">URL をコピー</button></div>
    </div>
    <div class="card">
      <h2>通知</h2>
      <p class="muted">ntfy: ${status.ntfy_topic_set ? '設定済み' : '未設定'}・Bark: ${status.bark_set ? '設定済み' : '未設定'}</p>
      <div class="row"><button id="test-notify">テスト通知</button><button id="morning">朝の通知を今すぐ送る</button></div>
    </div>
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
      <h2>COROS の基準 (${esc(settings.coros.updated)})</h2>
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
      <h2>評価の基準</h2>
      <div class="pf-seg pred-seg" style="--n:2;margin-bottom:10px"><button type="button" class="${settings.paces_auto !== false ? 'on' : ''}" data-pa="1">データから自動</button><button type="button" class="${settings.paces_auto === false ? 'on' : ''}" data-pa="0">手で設定</button></div>
      <p class="muted" style="margin:0 0 12px">${settings.paces_auto !== false
        ? `${settings.source === 'coros' || settings.predict?.source === 'coros' ? 'COROS の閾値・ゾーン' : '予測タイム'}、次のレースの目標タイム、最近の最大心拍から決めます。COROS の値やレースの目標が変わると自動で直ります。`
        : '下の値で評価します。数字を直したら保存してください。'}</p>
      <fieldset ${settings.paces_auto !== false ? 'disabled' : ''} class="sf-fields">
      <div class="grid2">
        <label>最大心拍<input name="max_hr" inputmode="numeric" value="${settings.max_hr}"></label>
        <label>LTHR (閾値心拍)<input name="lthr" inputmode="numeric" value="${settings.lthr}"></label>
      </div>
      <label>目標ケイデンス (spm)<input name="target_cadence" inputmode="numeric" value="${settings.target_cadence}"></label>
      <table><tr><th>種別</th><th>速い側</th><th>遅い側</th></tr>
      ${Object.entries(settings.paces).map(([k, b]) => `<tr><td>${PLAN_LABELS[k]}</td><td><input name="${k}_min" value="${pace(b.min)}"></td><td><input name="${k}_max" value="${pace(b.max)}"></td></tr>`).join('')}
      </table>
      <p style="margin-top:12px"><button class="primary">保存</button></p>
      </fieldset>
    </form>` : ''}
    `;
}

// ---------------------------------------------------------------- router

async function route() {
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
      : tab === 'races' ? (parts[1] ? await raceDetailView(parts[1]) : await racesView())
      : tab === 'shoes' ? await shoesView()
      : tab === 'settings' ? await settingsView()
      : await homeView();
    view.innerHTML = html;
    bindTrend(view);
    if (document.getElementById('news-list')) loadNews();
    if (document.getElementById('insights')) loadInsights();
  } catch (e) {
    view.innerHTML = `<div class="card error">${esc(e.message)}</div>`;
  }
}

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
