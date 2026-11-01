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
  const thisWeek = summary.find((w) => w.week === ws) || { planned_m: 0, actual_m: 0, points_planned: 0, points_done: 0 };

  return `
    ${status.strava_connected ? '' : '<div class="card error">Strava が未連携です。<a href="#/settings">設定</a>から連携してください。</div>'}
    <div class="card">
      <div class="row spread"><h2>今日 ${md(t)}(${dow(t)})</h2><a href="#/plans" class="muted">計画を編集</a></div>
      ${todays.length === 0 ? '<p class="muted">メニュー未登録</p>' : todays.map(planLine).join('')}
    </div>
    ${wxWeek ? weekWxCard(t, wxWeek.place) : ''}
    ${next ? `
    <div class="card hero">
      <div class="row spread"><h2>${esc(next.name)}</h2><span class="badge">${esc(next.priority)}</span></div>
      <div class="row spread">
        <div><span class="big">${daysBetween(t, next.date)}</span> 日</div>
        <div class="muted num">${md(next.date)}・${km(next.distance_m)}km${next.goal_time_s ? `<br>目標 ${dur(next.goal_time_s)} (${pace(next.goal_time_s / (next.distance_m / 1000))}/km)` : ''}</div>
      </div>
      <a class="herolink" href="#/races/${next.id}">ペース表・持ち物 ›</a>
    </div>
    ${weatherCard(weather)}
    ${goalCard(settings, next)}` : ''}
    ${(() => {
      const l = [...acts].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)[0];
      return l ? `<a class="card" href="#/activities/${l.id}" style="display:block;text-decoration:none;color:inherit">
        <div class="row spread"><h2>最新ランの評価</h2>${scoreHtml(l.score)}</div>
        <div class="muted num">${md(l.date)}(${dow(l.date)}) ${km(l.distance_m, 2)}km・${pace(l.moving_time_s / (l.distance_m / 1000))}/km${l.avg_hr ? `・${Math.round(l.avg_hr)}bpm` : ''}</div>
        <div class="muted">タップで詳細・スプリットを見る ›</div></a>
        <a class="card" href="#/activities?view=week" style="display:block;text-decoration:none;color:inherit"><h2>今週の振り返り ›</h2><div class="muted">日・週・月の評価はここから</div></a>` : '';
    })()}
    ${await monthGoalCard(t)}
    <div class="card week">
      <h2>今週</h2>
      <div class="row spread num"><span>${km(thisWeek.actual_m)} / ${km(thisWeek.planned_m)} km</span><span class="muted">ポイント練 ${thisWeek.points_done}/${thisWeek.points_planned}</span></div>
      <div class="bar"><div style="width:${Math.min(100, thisWeek.planned_m ? (thisWeek.actual_m / thisWeek.planned_m) * 100 : 0)}%"></div></div>
    </div>
    <div class="card">
      <h2>週間距離${next ? `と、${esc(next.name)}まで` : ''}</h2>
      ${weeklyChart(summary)}
    </div>
    <div class="card">
      <h2>最近のラン</h2>
      ${activityList(acts.slice(0, 5))}
    </div>`;
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
    const change = async () => {
      const presets = [...new Set([60, 80, 100, 120, 150, 200, 250, 300, ...(suggest ? [suggest] : [])])].sort((a, b) => a - b);
      const pending = openDialog(`<h2>${Number(month.slice(5))}月の目標</h2>
        <p class="muted" style="margin-top:0">今月 ${actual.toFixed(0)}km 走りました${suggest ? `。計画の合計は ${suggest}km` : ''}。</p>
        <div class="chips" id="mg-chips">${presets.map((v) => `<button type="button" class="chip ${goal.km === v ? 'on' : ''}" data-v="${v}">${v}km</button>`).join('')}</div>
        <label>km<input name="km" inputmode="numeric" value="${goal.km ?? ''}"></label>`);
      dialogForm.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => {
        dialogForm.querySelector('[name=km]').value = b.dataset.v;
        dialogForm.querySelectorAll('[data-v]').forEach((x) => x.classList.toggle('on', x === b));
      }));
      const v = await pending;
      const km = v && Number(v.km);
      if (km > 0) await set(Math.round(km));
    };
    view.querySelectorAll('[data-mg-edit]').forEach((b) => (b.onclick = change));
  });
  const daysLeft = lastD - Number(t.slice(8)) + 1;
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
  return `<div class="card"><div class="row spread"><h2>${Number(month.slice(5))}月の目標</h2><button type="button" class="chip" data-mg-edit>${goal.km}km ›</button></div>
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
  return `<div class="wxday">${wxIcon(w.code, 22)}<span class="num">${Math.round(w.tmax)}<small>/${Math.round(w.tmin)}℃</small></span>${w.precip_pct != null && w.precip_pct >= 30 ? `<span class="rain num">${w.precip_pct}%</span>` : ''}</div>`;
};

function weekWxCard(from, place) {
  const days = [...Array(7)].map((_, i) => addDays(from, i));
  return `<a class="card linkcard" href="#/weather"><div class="row spread"><h2>週間天気</h2><span class="muted">${esc(place)} ・詳しく見る ›</span></div>
    <div class="wxweek">${days.map((d) => {
      const w = WX[d];
      return `<div class="${d === from ? 'today' : ''}"><div class="muted">${dow(d)}</div>${w ? wxIcon(w.code, 26) : '<span class="muted">-</span>'}<b class="num">${w ? Math.round(w.tmax) : '-'}</b><span class="muted num">${w ? Math.round(w.tmin) : ''}</span><span class="rain num">${w && w.precip_pct != null && w.precip_pct >= 30 ? w.precip_pct + '%' : ''}</span></div>`;
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
    <div class="card"><h2>7 日間</h2><div class="dlist">${f.daily.map((d) => `<div class="drow"><span class="dd num"><b>${md(d.date)}</b> <span class="muted">${dow(d.date)}</span></span>${wxIcon(d.code, 24)}<span class="num dt"><b>${Math.round(d.tmax)}</b><span class="muted">/${Math.round(d.tmin)}</span></span><span class="rain num dr">${d.precip_pct ?? 0}%</span><span class="muted num ds">風${d.wind_max.toFixed(0)}・日の出${d.sunrise} 日の入${d.sunset}</span></div>`).join('')}</div></div>
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
    <div class="row" style="gap:10px;align-items:center">${w.code != null ? wxIcon(w.code, 34) + `<b>${wxKind(w.code)[1]}</b>` : ''}</div>
    <div class="num" style="font-size:20px">${Math.round(w.tmin)}〜${Math.round(w.tmax)}℃ <span class="muted" style="font-size:13px">降水${w.precip_pct ?? '-'}%・風${w.wind_max.toFixed(0)}m/s</span></div>
    <div class="hours num">${hrs}</div>
    <p style="margin:8px 0 0">${esc(w.advice)}</p>
  </div>`;
}

/** 目標タイムまでの距離。サブ3・レース目標・COROS 予測を 1 本の時間軸に並べる */
function goalCard(settings, next) {
  const c = settings?.coros;
  if (!c || !next) return '';
  const full = c.predicted_s.full;
  const marks = [{ k: 'sub3', label: 'サブ3', v: 10800, cls: 'm-goal' }];
  if (next.goal_time_s && next.goal_time_s !== 10800) marks.push({ k: 'goal', label: `${next.name}の目標`, v: next.goal_time_s, cls: 'm-goal2' });
  marks.push({ k: 'pred', label: 'COROS予測', v: full, cls: 'm-pred' });
  const vals = marks.map((m) => m.v);
  const lo = Math.min(...vals) - 300, hi = Math.max(...vals) + 300;
  const pos = (v) => ((hi - v) / (hi - lo)) * 100; // 左ほど遅く、右ほど速い
  const gap = (g) => { const d = full - g; return d <= 0 ? `予測のほうが ${dur(-d)} 速い` : `あと ${dur(d)} 縮めたい`; };
  const target = marks.find((m) => m.k === 'goal') || marks[0];
  const rows = marks.filter((m) => m.k !== 'pred');
  return `<div class="card">
    <h2>目標までの距離</h2>
    <div class="gauge" aria-label="目標タイムとCOROS予測の位置">
      <div class="gtrack"><i style="left:${Math.min(pos(full), pos(target.v))}%;width:${Math.abs(pos(full) - pos(target.v))}%" class="${full <= target.v ? 'ok' : 'gap'}"></i></div>
      ${marks.map((m) => `<div class="gmark ${m.cls}" style="left:${pos(m.v)}%"><span class="gdot"></span><span class="glabel">${esc(m.label)}<b class="num">${dur(m.v)}</b></span></div>`).join('')}
      <div class="gend"><span>遅い</span><span>速い</span></div>
    </div>
    <div class="goal-rows">${rows.map((m) => `<div class="row spread"><span>${esc(m.label)} ${dur(m.v)}</span><b class="num ${full <= m.v ? 'ok' : 'gap'}">${gap(m.v)}</b></div>`).join('')}</div>
    <p class="muted">予測は理想条件での値です。本番は暑さや補給で数分遅くなるのが普通です。</p>
  </div>`;
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

function planLine(p, hideActual = false) {
  const target = p.type === 'rest' ? '' : [p.distance_m ? `${km(p.distance_m)}km` : '', p.pace_min_s ? `${pace(p.pace_min_s)}-${pace(p.pace_max_s)}` : '', p.hr_max ? `≤${p.hr_max}bpm` : ''].filter(Boolean).join(' ');
  return `<div class="plan-item" data-plan="${p.id}">
    <div><span class="badge" data-t="${p.type}">${PLAN_LABELS[p.type]}</span> <span class="num">${target}</span>${p.notes ? `<div class="muted">${esc(p.notes)}</div>` : ''}${shoeLine(p, hideActual)}</div>
    <div class="num">${p.activity_id && !hideActual ? `<a class="actual-mini" href="#/activities/${p.activity_id}"><span class="muted">実績</span> ${km(p.actual_distance_m)}km${p.activity_count > 1 ? `<span class="muted">(${p.activity_count}本)</span>` : ''} ${scoreHtml(p.score)}</a>` : ''}</div>
  </div>`;
}

function weeklyChart(weeks) {
  if (weeks.length === 0) return '<p class="muted">データなし</p>';
  const max = Math.max(...weeks.map((w) => Math.max(w.planned_m, w.actual_m)), 1);
  const h = (m) => `${(m / max) * 90}px`;
  return `<div class="chart">${weeks.map((w) => `
    <a class="col" href="#/activities?view=week&date=${w.week}" title="${md(w.week)}週 実績 ${km(w.actual_m)}km / 計画 ${km(w.planned_m)}km">
      ${w.planned_m ? `<div class="plan" style="height:${h(w.planned_m)}"></div>` : ''}
      <div class="act" style="height:${h(w.actual_m)}"></div>
      <div class="lbl">${md(w.week)}</div>
    </a>`).join('')}</div>
    <p class="muted hint">棒をタップすると、その週の評価が開きます</p>`;
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
  /** 同じ日に走ったワークアウトは 1 つのメニューとして合算して表示する */
  const actLine = (list) => {
    if (!list.length) return '';
    const main = [...list].sort((a, b) => b.distance_m - a.distance_m)[0];
    const dist = list.reduce((x, a) => x + a.distance_m, 0), time = list.reduce((x, a) => x + a.moving_time_s, 0);
    const hrs = list.filter((a) => a.avg_hr);
    const hr = hrs.length ? hrs.reduce((x, a) => x + a.avg_hr * a.moving_time_s, 0) / hrs.reduce((x, a) => x + a.moving_time_s, 0) : null;
    return `<a class="actual" href="#/activities/${main.id}"><span>実績 ${km(dist, 1)}km ${pace(time / (dist / 1000))}/km${hr ? ` ${Math.round(hr)}bpm` : ''}${list.length > 1 ? ` <span class="muted">(${list.length}本をまとめて)</span>` : ''}</span>${scoreHtml(main.score)}</a>`;
  };
  /** 1 日ぶんの 計画 と 実績 の差 */
  const dayDiff = (d, dayPlans, dayActs) => {
    const runPlans = dayPlans.filter((p) => p.type !== 'rest');
    const planned = runPlans.reduce((a, p) => a + (p.distance_m || 0), 0);
    const done = dayActs.reduce((a, r) => a + r.distance_m, 0);
    const past = d < today();
    if (runPlans.length === 0) {
      return dayPlans.length && done > 0 ? `<div class="diff over">休養日に ${km(done, 1)}km 走りました</div>` : '';
    }
    if (done === 0) return past ? '<div class="diff gap">未実施</div>' : '';
    const diff = done - planned;
    const rate = planned ? Math.abs(diff) / planned : 0;
    const cls = !planned || rate <= 0.1 ? 'ok' : diff < 0 ? 'gap' : 'over';
    let paceNote = '';
    if (runPlans.length === 1 && dayActs.length === 1) {
      const p = runPlans[0];
      const band = p.pace_min_s ? { min: p.pace_min_s, max: p.pace_max_s } : settings.paces?.[p.type];
      const avg = dayActs[0].moving_time_s / (dayActs[0].distance_m / 1000);
      if (band) {
        paceNote = avg < band.min - 1 ? ` ・平均ペースは目安より ${Math.round(band.min - avg)}秒/km 速い`
          : avg > band.max + 1 ? ` ・平均ペースは目安より ${Math.round(avg - band.max)}秒/km 遅い`
          : ' ・平均ペースは目安の範囲内';
      }
    }
    const sign = diff >= 0 ? '+' : '−';
    return `<div class="diff ${cls}">差 ${sign}${km(Math.abs(diff), 1)}km${planned ? ` (計画 ${km(planned, 1)}km → 実績 ${km(done, 1)}km)` : ''}${paceNote}</div>`;
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
    </div>
    <div class="card" id="cal">
      ${days.map((d) => {
        const dp = plans.filter((p) => p.date === d);
        return `
        <div class="week-day ${d === t ? 'today' : ''}" data-day="${d}">
          <div class="daycol">${dp.length ? '<span class="grip" data-grip="' + d + '" aria-label="ドラッグして入れ替え">⠿</span>' : '<span class="grip off"></span>'}<div><strong>${md(d)}</strong><div class="muted">${dow(d)}</div>${wxDay(d)}${dayTag(d)}</div></div>
          <div>
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
  const chip = (attr, val, label, on) => `<button type="button" class="chip ${on ? 'on' : ''}" ${attr}="${val}">${label}</button>`;
  const draw = () => {
    body.innerHTML = `
      <div class="field"><span class="lbl">ポイント走</span><div class="chips">${[0, 1, 2, 3].map((n) => chip('data-pp', n, `${n}回`, prefs.points_per_week === n)).join('')}</div></div>
      <div class="field"><span class="lbl">ロング走</span><div class="chips">${[0, 1].map((n) => chip('data-lp', n, `${n}回`, prefs.long_per_week === n)).join('')}</div></div>
      <div class="field"><span class="lbl">休息日</span><div class="chips">${[0, 1, 2, 3].map((n) => chip('data-rp', n, `${n}回`, prefs.rest_per_week === n)).join('')}</div></div>
      ${weekDays.length ? `<div class="field"><span class="lbl">走れない日 (予定がある日)</span><span class="sub">あれば選びます。その日は休みにします</span><div class="chips">${weekDays.map((d) => chip('data-bl', d, `${Number(d.slice(5, 7))}/${Number(d.slice(8))}(${dow(d)})`, prefs.blocked.includes(d))).join('')}</div></div>` : ''}
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
const bandOf = (t) => (t.ref && PACES?.[t.ref] ? [PACES[t.ref].min, PACES[t.ref].max] : ZONES[t.zone].pace);
const bandMid = (t) => (bandOf(t)[0] + bandOf(t)[1]) / 2;
const intensityLabel = (t) => (t.ref ? REFS[t.ref].label : ZONES[t.zone].short);
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
async function editPlan(p, settings) {
  const st = {
    date: p.date,
    type: p.type || 'easy',
    km: p.distance_m ? p.distance_m / 1000 : null,
    pmin: p.pace_min_s || null,
    pmax: p.pace_max_s || null,
    notes: p.notes || '',
    steps: [],
    open: null,
  };
  try { st.steps = p.steps ? JSON.parse(p.steps) : []; } catch { st.steps = []; }
  if (st.steps.length) {
    const sum = stepsSummary(st.steps);
    st.notes = (p.notes || '').startsWith(sum) ? (p.notes || '').slice(sum.length).replace(/^ \/ /, '') : p.notes || '';
  }
  if (!p.id && st.km == null) st.km = PLAN_DEFAULT_KM[st.type] ?? null;
  const ws0 = weekStart(p.date);
  const week = [...Array(7)].map((_, i) => addDays(ws0, i));
  const chip = (attr, val, label, on) => `<button type="button" class="chip ${on ? 'on' : ''}" ${attr}="${esc(String(val))}">${esc(label)}</button>`;

  PACES = settings.paces;
  const lthr = settings.coros?.lthr || settings.lthr || 174;
  const zoneLine = (z, ref) => {
    if (ref && PACES?.[ref]) return `${REFS[ref].label}ペース ${pace(PACES[ref].min)}〜${pace(PACES[ref].max)} (設定の値)`;
    const Z = ZONES[z];
    const pc = z === 0 ? `${pace(Z.pace[0])}より遅い` : z === 5 ? `${pace(Z.pace[1])}より速い` : `${pace(Z.pace[0])}〜${pace(Z.pace[1])}`;
    const hr = z === 0 ? `${Math.round(lthr * Z.hr[1])}bpm未満` : z === 5 ? `${Math.round(lthr * Z.hr[0])}bpm超` : `${Math.round(lthr * Z.hr[0])}〜${Math.round(lthr * Z.hr[1])}bpm`;
    return `${Z.n} ${pc}・${hr}`;
  };
  const partEditor = (i, part, t, label) => `
    <div class="part">${label ? `<span class="lbl">${label}</span>` : ''}
      <div class="chips">${chip('data-sby', `${i}:${part}:dist`, '距離', t.by === 'dist')}${chip('data-sby', `${i}:${part}:time`, '時間', t.by === 'time')}</div>
      <div class="stepper"><button type="button" data-sval="${i}:${part}:-${t.by === 'dist' ? 1000 : 300}">−${t.by === 'dist' ? '1km' : '5分'}</button><button type="button" data-sval="${i}:${part}:-${t.by === 'dist' ? 200 : 30}">−${t.by === 'dist' ? '200m' : '30秒'}</button>
        <b class="num">${fmtTarget(t)}</b>
        <button type="button" data-sval="${i}:${part}:${t.by === 'dist' ? 200 : 30}">+${t.by === 'dist' ? '200m' : '30秒'}</button><button type="button" data-sval="${i}:${part}:${t.by === 'dist' ? 1000 : 300}">+${t.by === 'dist' ? '1km' : '5分'}</button></div>
      <div class="chips">${Object.entries(REFS).map(([k, R]) => chip('data-sref', `${i}:${part}:${k}`, `${R.label}ペース`, t.ref === k)).join('')}</div>
      <div class="chips">${ZONES.map((Z, z) => chip('data-szone', `${i}:${part}:${z}`, Z.short, !t.ref && t.zone === z)).join('')}</div>
      <p class="muted zone-note">${esc(zoneLine(t.zone, t.ref))}</p></div>`;
  const stepsHtml = () => {
    const cards = st.steps.map((sp, i) => {
      const open = st.open === i;
      return `<div class="step ${open ? 'open' : ''}" data-k="${sp.kind}">
        <button type="button" class="step-head" data-sopen="${i}"><span class="step-name">${STEP_KINDS[sp.kind]}</span><span class="step-meta num">${esc(stepText(sp))}</span></button>
        ${open ? `<div class="step-body">
          ${sp.kind === 'interval'
            ? `<div class="stepper"><button type="button" data-sreps="${i}:-1">−1本</button><b class="num">${sp.reps} <small>本</small></b><button type="button" data-sreps="${i}:1">+1本</button></div>
               ${partEditor(i, 'work', sp.work, '走る')}${partEditor(i, 'rest', sp.rest, '休憩')}`
            : partEditor(i, '', sp, '')}
          <div class="chips"><button type="button" class="chip" data-smove="${i}:-1">上へ</button><button type="button" class="chip" data-smove="${i}:1">下へ</button><button type="button" class="chip danger" data-sdel="${i}">削除</button></div>
        </div>` : ''}</div>`;
    }).join('');
    const total = st.steps.length ? `<div class="step-total num">合計 約 ${(stepsTotalM(st.steps) / 1000).toFixed(1)}km</div>` : '';
    return `<div class="field"><span class="lbl">メニューを組む (任意)</span>
      <div class="chips">${Object.keys(STEP_PRESETS).map((n) => chip('data-spreset', n, n, false)).join('')}</div>
      ${cards}${total}
      <div class="chips">${Object.entries(STEP_KINDS).map(([k, v]) => chip('data-sadd', k, `+ ${v}`, false)).join('')}</div></div>`;
  };

  const draw = () => {
    const def = settings.paces?.[st.type];
    const shown = st.pmin ? `${pace(st.pmin)}〜${pace(st.pmax)}` : def ? `標準 ${pace(def.min)}〜${pace(def.max)}` : '-';
    dialogForm.querySelector('#pl-body').innerHTML = `
      <div class="field"><span class="lbl">日</span><div class="chips">${week.map((d) => chip('data-date', d, `${dow(d)} ${Number(d.slice(8))}`, d === st.date)).join('')}</div></div>
      <div class="field"><span class="lbl">種別</span><div class="chips">${Object.entries(PLAN_LABELS).map(([k, v]) => chip('data-type', k, v, k === st.type)).join('')}</div></div>
      ${st.type === 'rest' || st.steps.length ? '' : `
      <div class="field"><span class="lbl">距離</span>
        <div class="stepper"><button type="button" data-step="-1">−1</button><button type="button" data-step="-0.5">−0.5</button>
          <b class="num">${st.km != null ? st.km.toFixed(1) : '-'} <small>km</small></b>
          <button type="button" data-step="0.5">+0.5</button><button type="button" data-step="1">+1</button></div>
        <div class="chips">${DIST_CHIPS.map((v) => chip('data-km', v, String(v), st.km === v)).join('')}</div></div>
      <div class="field"><span class="lbl">ペース</span>
        <div class="stepper"><button type="button" data-pace="-5">−5秒</button><b class="num">${shown}</b><button type="button" data-pace="5">+5秒</button></div>
        ${st.pmin ? '<button type="button" class="chip" data-pace-reset="1">標準に戻す</button>' : ''}</div>`}
      ${st.type === 'rest' ? '' : stepsHtml()}
      <div class="field"><span class="lbl">${st.steps.length ? '補足メモ (任意)' : 'メモ'}</span><div class="chips">${st.steps.length ? '' : (MEMO_TEMPLATES[st.type] || []).map((t) => chip('data-memo', t, t, t === st.notes)).join('')}</div>
        <input name="notes" value="${esc(st.notes)}" placeholder="自由入力 (任意)"></div>`;
  };

  const onClick = (e) => {
    const t = e.target.closest('button');
    if (!t || !dialogForm.contains(t)) return;
    const d = t.dataset;
    const inp = dialogForm.querySelector('[name=notes]');
    if (inp) st.notes = inp.value;
    if (d.date) st.date = d.date;
    else if (d.type) {
      st.type = d.type;
      st.km = d.type === 'rest' ? null : (PLAN_DEFAULT_KM[d.type] ?? st.km);
      st.pmin = st.pmax = null;
      if (!(MEMO_TEMPLATES[d.type] || []).includes(st.notes)) st.notes = '';
    } else if (d.km) st.km = Number(d.km);
    else if (d.step) st.km = Math.max(0.5, (st.km ?? 0) + Number(d.step));
    else if (d.pace) {
      const base = st.pmin ? [st.pmin, st.pmax] : [settings.paces?.[st.type]?.min, settings.paces?.[st.type]?.max];
      if (base[0]) { st.pmin = base[0] + Number(d.pace); st.pmax = base[1] + Number(d.pace); }
    } else if (d.paceReset) st.pmin = st.pmax = null;
    else if (d.memo) st.notes = st.notes === d.memo ? '' : d.memo;
    else if (d.sadd) { st.steps.push(mkStep[d.sadd]()); st.open = st.steps.length - 1; }
    else if (d.spreset) { st.steps = STEP_PRESETS[d.spreset](); st.open = null; }
    else if (d.sopen != null) st.open = st.open === Number(d.sopen) ? null : Number(d.sopen);
    else if (d.sdel != null) { st.steps.splice(Number(d.sdel), 1); st.open = null; }
    else if (d.smove) {
      const [i, dir] = d.smove.split(':').map(Number);
      const j = i + dir;
      if (j >= 0 && j < st.steps.length) { [st.steps[i], st.steps[j]] = [st.steps[j], st.steps[i]]; st.open = j; }
    } else if (d.sreps) { const [i, dl] = d.sreps.split(':').map(Number); st.steps[i].reps = Math.max(1, st.steps[i].reps + dl); }
    else if (d.sby || d.sval || d.szone || d.sref) {
      const [i, part, v] = (d.sby || d.sval || d.szone || d.sref).split(':');
      const sp = st.steps[Number(i)];
      const t = part ? sp[part] : sp;
      if (d.sby) { if (t.by !== v) { t.by = v; t.value = v === 'dist' ? 1000 : 120; } }
      else if (d.sval) t.value = Math.max(t.by === 'dist' ? 100 : 15, t.value + Number(v));
      else if (d.sref) { t.ref = v; t.zone = REFS[v].zone; }
      else { t.zone = Number(v); t.ref = null; }
    } else return;
    draw();
  };

  const wait = openDialog(`<h2>${p.id ? '計画を編集' : '計画を追加'}</h2><div id="pl-body"></div>`,
    p.id ? { onDelete: async () => { await api(`/plans/${p.id}`, { method: 'DELETE' }); route(); } } : {});
  draw();
  dialogForm.addEventListener('click', onClick);
  const values = await wait;
  dialogForm.removeEventListener('click', onClick);
  if (!values) return;
  st.notes = values.notes ?? st.notes;
  let stepKm = null;
  if (st.steps.length && st.type !== 'rest') {
    stepKm = Math.round(stepsTotalM(st.steps));
    const main = st.steps.find((x) => x.kind === 'interval' || x.kind === 'work');
    if (main && !st.pmin) {
      const band = bandOf(main.kind === 'interval' ? main.work : main);
      st.pmin = band[0]; st.pmax = band[1];
    }
    st.notes = [stepsSummary(st.steps), st.notes].filter(Boolean).join(' / ');
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
  await api(p.id ? `/plans/${p.id}` : '/plans', { method: p.id ? 'PUT' : 'POST', body });
  route();
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

/** 過去12週間の距離 (面グラフ) */
function trendChart(rows) {
  const W = 320, H = 110, pad = 6;
  const max = Math.max(60, ...rows.map((r) => r.km)) * 1.1;
  const pts = rows.map((r, i) => [pad + (i * (W - pad * 2)) / (rows.length - 1), H - pad - (r.km / max) * (H - pad * 2)]);
  const line = pts.map((p) => p.join(',')).join(' ');
  const last = pts[pts.length - 1];
  const colW = (W - pad * 2) / (rows.length - 1);
  const hit = rows.map((r, i) => `<a href="#/activities?view=week&date=${r.week}"><rect x="${pts[i][0] - colW / 2}" y="0" width="${colW}" height="${H}" fill="transparent"/></a>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="trend"><polygon points="${pad},${H - pad} ${line} ${last[0]},${H - pad}" class="area"/><polyline points="${line}" class="ln"/>${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i === pts.length - 1 ? 4 : 2.5}"/>`).join('')}${hit}</svg>
    <div class="row spread muted num"><span>${md(rows[0].week)}〜</span><span>最高 ${Math.max(...rows.map((r) => r.km)).toFixed(0)}km/週</span><span>今週 ${rows[rows.length - 1].km}km</span></div>
    <p class="muted hint">グラフをタップすると、その週の評価が開きます</p>`;
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
      ${r.grade ? `<details class="how"><summary>${r.grade} とは？ (等級の決まり方)</summary>
        <p class="muted" style="margin-top:0">${kind === 'day' ? '今日' : kind === 'week' ? '今週' : '今月'}の「走りの質」と「計画どおりに走れたか」を 1 つの点数にして、4 段階に分けています。</p>
        ${r.grade_calc ? `<table class="how-t"><tr><td>平均点 (各ランの評価)</td><td class="num">${r.grade_calc.avg}</td></tr><tr><td>距離が計画とずれた分</td><td class="num">−${r.grade_calc.dist_penalty}</td></tr><tr><td>ポイント練習を抜いた分</td><td class="num">−${r.grade_calc.quality_penalty}</td></tr><tr><td><b>等級の点数</b></td><td class="num"><b>${r.grade_calc.pts}</b></td></tr></table>` : ''}
        <p class="muted"><b>A</b> 85点以上 狙いどおり / <b>B</b> 70〜84 概ね良好 / <b>C</b> 55〜69 要調整 / <b>D</b> 55未満 立て直し</p>
        <p class="muted">距離のずれは、計画の ±10% を超えるほど減点 (最大 30)。ポイント練習は、計画した回数のうち走れなかった割合で最大 15 点を引きます。</p></details>` : ''}
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
    ${trend ? `<div class="card"><h2>過去12週間</h2>${trendChart(trend)}</div>` : ''}
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
      const slow = Math.max(...sp.map((x) => x.pace_s || 0)), fast = Math.min(...sp.filter((x) => x.pace_s).map((x) => x.pace_s));
      view.querySelector('#splitchart').innerHTML = splitChart(sp);
      box.innerHTML = `<table class="num splits"><tr><th>km</th><th>ペース</th><th></th><th>標高</th><th>心拍</th></tr>${sp.map((x, i) => `<tr><td>${i + 1}</td><td>${x.pace_s ? pace(x.pace_s) : '-'}</td><td><span class="sbar" style="width:${x.pace_s ? 30 + ((slow - x.pace_s) / Math.max(1, slow - fast)) * 70 : 0}%"></span></td><td>${x.elev}</td><td>${x.hr ?? '-'}</td></tr>`).join('')}</table>`;
    }).catch(() => {});
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
    <div class="card">
      <div class="row spread"><h2>${esc(a.name)}</h2><a class="muted" href="https://www.strava.com/activities/${a.id}" target="_blank" rel="noopener">Strava ↗</a></div>
      <div class="muted">${a.start_date_local.slice(0, 16).replace('T', ' ')}</div>
      <div class="row spread" style="margin-top:8px">
        <div class="num"><span class="big">${km(a.distance_m, 2)}</span> km<br>${dur(a.moving_time_s)}・${pace(a.moving_time_s / (a.distance_m / 1000))}/km</div>
        <div style="text-align:right"><div class="muted">総合</div><div class="big">${scoreHtml(a.score)}</div></div>
      </div>
    </div>
    ${ev ? `
    <div class="card">
      <h2>評価 <span class="badge" data-t="${ev.type}">${ev.type === 'free' ? 'フリーラン' : PLAN_LABELS[ev.type]}</span></h2>
      ${metric('ペース', ev.pace, W?.pace)}${metric('心拍', ev.hr, W?.hr)}${metric('ケイデンス', ev.cadence, W?.cadence)}${ev.form ? metric('フォーム', ev.form, W?.form) : ''}
      ${howCard(ev)}
      <ul class="bullets">${ev.comments.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      ${ev.focus?.length ? `<h3 class="sub">次に意識すること</h3><ul class="bullets focus">${ev.focus.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      ${ev.pace.details.rep_paces ? `<p class="muted num">各本: ${esc(ev.pace.details.rep_paces)}</p>` : ''}
      ${zones.some((z) => z != null) ? `<h3 class="sub">心拍ゾーン (走った時間の割合)</h3>${zoneBars(zones)}` : ''}
    </div>` : ''}
    ${sib.length > 1 ? `<div class="card"><h2>この日のラン (${sib.length}本)</h2>
      <p class="muted" style="margin-top:0">アップ・本体・ダウンなど、同じ日のランは 1 つのメニューとして見ます</p>
      <div class="num" style="margin:8px 0"><span class="big">${km(sumD, 2)}</span> km・${dur(sumT)}・${pace(sumT / (sumD / 1000))}/km</div>
      <ul class="list">${sib.map((r) => `<li class="${r.id === a.id ? 'cur' : ''}"><a href="#/activities/${r.id}"><div class="row spread"><span>${r.start_date_local.slice(11, 16)} ${esc(r.name)}${r.id === a.id ? ' <span class="badge">いま見ているラン</span>' : ''}</span>${scoreHtml(r.score)}</div><div class="muted num">${km(r.distance_m, 2)}km・${pace(r.moving_time_s / (r.distance_m / 1000))}/km${r.avg_hr ? `・${Math.round(r.avg_hr)}bpm` : ''}</div></a></li>`).join('')}</ul></div>` : ''}
    ${(() => {
      const cur = shoes.find((x) => x.id === a.shoe_id);
      return `<div class="card shoe-card"><div class="row spread"><h2>${cur ? esc(cur.name) : 'シューズを追加'}</h2><button type="button" class="chip" id="shoe-open">${cur ? '変更' : '選ぶ'}</button></div>
      ${cur ? `<div class="shoe-img big">${cur.image ? `<img src="${cur.image}" alt="">` : '<svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16v-3l4-1 2-3 3 2 4 1c3 .5 5 2 5 4v1H3z"/><path d="M3 19h18"/></svg>'}</div><div class="muted num">累計 ${Math.round(cur.total_km)}km / ${cur.limit_km}km</div>` : '<p class="muted" style="margin:0">このランで履いたシューズを選びます。</p>'}
      </div>`;
    })()}
    <div class="card"><h2>スプリット</h2><div id="splitchart"></div><div id="splits"><span class="muted">読み込み中…</span></div></div>
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

const CHECK_CATS = { prep: '前日まで', morning: '当日の朝', other: '追加分' };
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
  const r = races.find((x) => x.id === Number(id));
  if (!r) return '<div class="card error">レースが見つかりません</div>';
  let mode = 'even';
  const t = today();
  const items = [...CHECK_ITEMS.map(([cat, iid, text]) => ({ cat, id: iid, text })), ...(state.custom || [])];
  const done = () => items.filter((x) => state.checked.includes(x.id)).length;
  const save = () => api(`/checklist/${id}`, { method: 'PUT', body: state }).catch(() => {});

  const drawChecks = () => {
    const box = view.querySelector('#checks');
    if (!box) return;
    box.innerHTML = Object.entries(CHECK_CATS).map(([cat, label]) => {
      const list = items.filter((x) => x.cat === cat);
      if (!list.length) return '';
      return `<div class="ck-group"><div class="ck-title">${label} <span class="muted num">${list.filter((x) => state.checked.includes(x.id)).length}/${list.length}</span></div>
        ${list.map((x) => `<label class="ck ${state.checked.includes(x.id) ? 'on' : ''}"><input type="checkbox" data-ck="${x.id}" ${state.checked.includes(x.id) ? 'checked' : ''}><span class="box"></span><span class="ck-text">${esc(x.text)}</span>${x.cat === 'other' ? `<button type="button" class="ck-del" data-del="${x.id}" aria-label="削除">×</button>` : ''}</label>`).join('')}</div>`;
    }).join('');
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
    view.querySelectorAll('[data-gp]').forEach((b) => (b.onclick = async () => {
      const km = r.distance_m / 1000;
      const cur = r.goal_time_s ? r.goal_time_s / km : 256;
      const per = b.dataset.gp === 'sub3' ? 10799 / km : Math.max(180, cur + Number(b.dataset.gp));
      await api(`/races/${r.id}`, { method: 'PUT', body: { ...r, goal_time_s: Math.round(per * km) } });
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
      state.custom = state.custom.filter((x) => x.id !== d.dataset.del);
      state.checked = state.checked.filter((x) => x !== d.dataset.del);
      items.splice(0, items.length, ...CHECK_ITEMS.map(([cat, iid, text]) => ({ cat, id: iid, text })), ...state.custom);
      drawChecks(); save();
    });
    view.querySelector('#ck-add').onsubmit = (e) => {
      e.preventDefault();
      const inp = view.querySelector('#ck-new');
      const text = inp.value.trim();
      if (!text) return;
      const it = { id: `c${Date.now().toString(36)}`, cat: 'other', text };
      state.custom = [...(state.custom || []), it];
      items.push(it);
      inp.value = '';
      drawChecks(); save();
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
      <div class="gp"><span class="muted">目標ペース</span>
        <button type="button" class="gp-b" data-gp="-5" aria-label="5秒速く">−</button>
        <b class="num">${r.goal_time_s ? `${pace(r.goal_time_s / (r.distance_m / 1000))}/km` : '未設定'}</b>
        <button type="button" class="gp-b" data-gp="5" aria-label="5秒遅く">＋</button>
        <button type="button" class="chip" data-gp="sub3">サブ3</button>
      </div>
      ${r.goal_time_s ? `<div class="muted num" style="margin:-4px 0 10px">ゴール ${dur(r.goal_time_s)}</div>` : ''}
      ${r.goal_time_s ? `<div class="chips" style="margin-bottom:10px">${Object.entries(PACE_PLANS).map(([k, v]) => `<button type="button" class="chip ${k === 'even' ? 'on' : ''}" data-pm="${k}">${v.label}</button>`).join('')}</div>
      <p class="muted" id="pace-note" style="margin-top:0">${PACE_PLANS.even.note}</p>` : ''}
      <div id="pace-out">${splitTable(r, 'even')}</div>
    </div>
    ${upcoming ? `<div class="card"><div class="row spread"><h2>持ち物</h2><b class="num" id="ck-prog"></b></div>
      <div class="bar" style="margin:6px 0 10px"><div id="ck-bar" style="width:0"></div></div>
      <div id="checks"></div>
      <form id="ck-add" class="row" style="margin-top:12px;gap:8px"><input id="ck-new" placeholder="追加 (例: 梅干し)" style="flex:1" maxlength="60"><button class="primary">追加</button></form>
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
        <div class="muted tiny">${purposeText(s)}</div></div>
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
      if (!confirm('ペース帯・心拍の基準を COROS 基準に戻します。よろしいですか？')) return 'キャンセル';
      await api('/settings/reset', { method: 'POST' });
      cachedSettings = null;
      setTimeout(route, 600);
      return 'COROS 基準に戻しました';
    });
    run('#seed', async () => {
      const r = await api('/seed', { method: 'POST' });
      return `レース ${r.races} 件・計画 ${r.plans} 件を登録しました (登録済みの日付は飛ばします)`;
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
      <h2>初期データ</h2>
      <p class="muted">レース5件 (福岡〜佐賀さくら) と、福岡マラソンまでの練習メニューを登録します。何度押しても重複しません。</p>
      <div class="row"><button id="seed" class="primary">レースと計画を登録</button></div>
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
      <div class="row" style="margin-top:12px"><button id="reset-settings">評価の基準を COROS 基準に戻す</button></div>
    </div>` : ''}
    <form class="card" id="settings-form">
      <h2>評価の基準</h2>
      <div class="grid2">
        <label>最大心拍<input name="max_hr" inputmode="numeric" value="${settings.max_hr}"></label>
        <label>LTHR (閾値心拍)<input name="lthr" inputmode="numeric" value="${settings.lthr}"></label>
      </div>
      <label>目標ケイデンス (spm)<input name="target_cadence" inputmode="numeric" value="${settings.target_cadence}"></label>
      <table><tr><th>種別</th><th>速い側</th><th>遅い側</th></tr>
      ${Object.entries(settings.paces).map(([k, b]) => `<tr><td>${PLAN_LABELS[k]}</td><td><input name="${k}_min" value="${pace(b.min)}"></td><td><input name="${k}_max" value="${pace(b.max)}"></td></tr>`).join('')}
      </table>
      <p style="margin-top:12px"><button class="primary">保存</button></p>
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
