// Sub3 Runner — 依存なしの小さな SPA
const view = document.getElementById('view');
const dialog = document.getElementById('dialog');
const dialogForm = document.getElementById('dialog-form');

const PLAN_LABELS = {
  easy: 'Easy', jog: 'Jog', long: 'ロング走', m: 'Mペース走', lt: 'LT走',
  interval: 'インターバル', race: 'レース', rest: '休養',
};
const PURPOSE_LABELS = { daily: '練習', workout: 'ポイント', race: 'レース' };
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
    <div class="row spread" style="margin-top:12px">
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
  const [plans, acts, races, summary, status] = await Promise.all([
    api(`/plans?from=${ws}&to=${addDays(ws, 6)}`),
    api(`/activities?from=${addDays(t, -14)}&to=${t}`),
    api('/races'),
    api(`/summary?from=${addDays(ws, -7 * 7)}&to=${addDays(ws, 6)}`),
    api('/status'),
  ]);
  const todays = plans.filter((p) => p.date === t);
  const next = races.find((r) => r.date >= t);
  const thisWeek = summary.find((w) => w.week === ws) || { planned_m: 0, actual_m: 0, points_planned: 0, points_done: 0 };

  return `
    ${status.strava_connected ? '' : '<div class="card error">Strava が未連携です。<a href="#/settings">設定</a>から連携してください。</div>'}
    <div class="card">
      <div class="row spread"><h2>今日 ${md(t)}(${dow(t)})</h2><a href="#/plans" class="muted">計画を編集</a></div>
      ${todays.length === 0 ? '<p class="muted">メニュー未登録</p>' : todays.map(planLine).join('')}
    </div>
    ${next ? `
    <div class="card hero">
      <div class="row spread"><h2>${esc(next.name)}</h2><span class="badge">${esc(next.priority)}</span></div>
      <div class="row spread">
        <div><span class="big">${daysBetween(t, next.date)}</span> 日</div>
        <div class="muted num">${md(next.date)}・${km(next.distance_m)}km${next.goal_time_s ? `<br>目標 ${dur(next.goal_time_s)} (${pace(next.goal_time_s / (next.distance_m / 1000))}/km)` : ''}</div>
      </div>
    </div>` : ''}
    <div class="card week">
      <h2>今週</h2>
      <div class="row spread num"><span>${km(thisWeek.actual_m)} / ${km(thisWeek.planned_m)} km</span><span class="muted">ポイント練 ${thisWeek.points_done}/${thisWeek.points_planned}</span></div>
      <div class="bar"><div style="width:${Math.min(100, thisWeek.planned_m ? (thisWeek.actual_m / thisWeek.planned_m) * 100 : 0)}%"></div></div>
    </div>
    <div class="card">
      <h2>週間距離 (点線=計画)</h2>
      ${weeklyChart(summary)}
    </div>
    <div class="card">
      <h2>最近のラン</h2>
      ${activityList(acts.slice(0, 5))}
    </div>`;
}

function planLine(p) {
  const target = p.type === 'rest' ? '' : [p.distance_m ? `${km(p.distance_m)}km` : '', p.pace_min_s ? `${pace(p.pace_min_s)}-${pace(p.pace_max_s)}` : '', p.hr_max ? `≤${p.hr_max}bpm` : ''].filter(Boolean).join(' ');
  return `<div class="plan-item" data-plan="${p.id}">
    <div><span class="badge" data-t="${p.type}">${PLAN_LABELS[p.type]}</span> <span class="num">${target}</span>${p.notes ? `<div class="muted">${esc(p.notes)}</div>` : ''}</div>
    <div class="num">${p.activity_id ? `<a href="#/activities/${p.activity_id}">${km(p.actual_distance_m)}km ${scoreHtml(p.score)}</a>` : ''}</div>
  </div>`;
}

function weeklyChart(weeks) {
  if (weeks.length === 0) return '<p class="muted">データなし</p>';
  const max = Math.max(...weeks.map((w) => Math.max(w.planned_m, w.actual_m)), 1);
  const h = (m) => `${(m / max) * 90}px`;
  return `<div class="chart">${weeks.map((w) => `
    <div class="col" title="${md(w.week)}週 実績 ${km(w.actual_m)}km / 計画 ${km(w.planned_m)}km">
      ${w.planned_m ? `<div class="plan" style="height:${h(w.planned_m)}"></div>` : ''}
      <div class="act" style="height:${h(w.actual_m)}"></div>
      <div class="lbl">${md(w.week)}</div>
    </div>`).join('')}</div>`;
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
  const [plans, weekActs, settings] = await Promise.all([
    api(`/plans?from=${ws}&to=${addDays(ws, 6)}`),
    api(`/activities?from=${ws}&to=${addDays(ws, 6)}`),
    api('/settings'),
  ]);
  const linkedIds = new Set(plans.map((p) => p.activity_id).filter(Boolean));
  const actLine = (a) => `<a class="actual" href="#/activities/${a.id}"><span>実績 ${km(a.distance_m, 1)}km ${pace(a.moving_time_s / (a.distance_m / 1000))}/km${a.avg_hr ? ` ${Math.round(a.avg_hr)}bpm` : ''}</span>${scoreHtml(a.score)}</a>`;
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
    view.querySelector('#bulk-toggle').onclick = () => view.querySelector('#bulk-box').classList.toggle('hidden');
    view.querySelector('#bulk-go').onclick = async () => {
      const out = view.querySelector('#bulk-out');
      try {
        const data = JSON.parse(view.querySelector('#bulk-text').value);
        const replace = view.querySelector('#bulk-replace').checked;
        const r = await api('/plans/bulk', { method: 'POST', body: { plans: Array.isArray(data) ? data : data.plans, replace } });
        out.textContent = `✅ ${r.imported} 件登録しました`;
        setTimeout(route, 800);
      } catch (e) { out.textContent = `❌ ${e.message}`; }
    };
    view.querySelector('#copy-week').onclick = async () => {
      if (!confirm(`この週の計画を翌週 (${md(addDays(ws, 7))}〜) に複製しますか？`)) return;
      const r = await api('/plans/copy-week', { method: 'POST', body: { from: ws, to: addDays(ws, 7) } });
      alert(`${r.copied} 件を複製しました`);
      location.hash = `#/plans?week=${addDays(ws, 7)}`;
    };
  });

  return `
    <div class="row spread" style="margin-bottom:8px">
      <a class="btn" href="#/plans?week=${addDays(ws, -7)}">‹ 前週</a>
      <strong>${md(ws)} 〜 ${md(addDays(ws, 6))}</strong>
      <a class="btn" href="#/plans?week=${addDays(ws, 7)}">翌週 ›</a>
    </div>
    <div class="card">
      <div class="row spread num"><span>計画 ${km(total)}km・実績 ${km(actual)}km</span><button id="copy-week">翌週へ複製</button></div>
    </div>
    <div class="card">
      <button id="bulk-toggle">📋 メニューを貼り付けて登録</button>
      <div id="bulk-box" class="hidden" style="margin-top:8px">
        <p class="muted">Claude が作った JSON を貼り付けます。</p>
        <textarea id="bulk-text" rows="8" style="width:100%" placeholder='[{"date":"2026-11-03","type":"jog","distance_m":8000,"notes":"..."}]'></textarea>
        <label class="row"><input type="checkbox" id="bulk-replace"> 期間内の既存メニューを置き換える</label>
        <div class="row"><button id="bulk-go" class="primary">登録</button></div>
        <p id="bulk-out"></p>
      </div>
    </div>
    <div class="card">
      ${days.map((d) => `
        <div class="week-day ${d === t ? 'today' : ''}">
          <div><strong>${md(d)}</strong><div class="muted">${dow(d)}</div></div>
          <div>
            ${plans.filter((p) => p.date === d).map(planLine).join('')}
            ${weekActs.filter((a) => a.date === d && !linkedIds.has(a.id)).map(actLine).join('')}
            <button data-add="${d}" style="margin-top:4px;font-size:12px">＋ 追加</button>
          </div>
        </div>`).join('')}
    </div>`;
}

async function editPlan(p, settings) {
  const typeOpts = Object.entries(PLAN_LABELS).map(([k, v]) => `<option value="${k}" ${p.type === k ? 'selected' : ''}>${v}</option>`).join('');
  const values = await openDialog(`
    <h2>${p.id ? '計画を編集' : '計画を追加'}</h2>
    <div class="grid2">
      <label>日付<input type="date" name="date" value="${p.date}" required></label>
      <label>種別<select name="type" id="plan-type">${typeOpts}</select></label>
    </div>
    <label>距離 (km)<input name="distance_km" inputmode="decimal" value="${p.distance_m ? p.distance_m / 1000 : ''}"></label>
    <div class="grid2">
      <label>ペース 速い側<input name="pace_min" placeholder="既定" value="${p.pace_min_s ? pace(p.pace_min_s) : ''}"></label>
      <label>ペース 遅い側<input name="pace_max" placeholder="既定" value="${p.pace_max_s ? pace(p.pace_max_s) : ''}"></label>
    </div>
    <p class="muted" id="pace-hint"></p>
    <label>心拍上限 (bpm)<input name="hr_max" inputmode="numeric" placeholder="既定" value="${p.hr_max ?? ''}"></label>
    <label>メモ<textarea name="notes" rows="2" placeholder="例: 1000m×5 r=200m jog">${esc(p.notes)}</textarea></label>`,
    p.id ? { onDelete: async () => { await api(`/plans/${p.id}`, { method: 'DELETE' }); route(); } } : {},
  );
  if (!values) return;
  const body = {
    date: values.date,
    type: values.type,
    distance_m: values.distance_km ? Number(values.distance_km) * 1000 : null,
    pace_min_s: parseDur(values.pace_min),
    pace_max_s: parseDur(values.pace_max),
    hr_max: values.hr_max ? Number(values.hr_max) : null,
    notes: values.notes,
  };
  if (body.pace_min_s && !body.pace_max_s) body.pace_max_s = body.pace_min_s;
  if (body.pace_max_s && !body.pace_min_s) body.pace_min_s = body.pace_max_s;
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

async function activitiesView() {
  const acts = await api('/activities');
  return `<div class="card"><h2>ラン一覧</h2>${activityList(acts)}</div>`;
}

async function activityDetailView(id) {
  const [a, shoes] = await Promise.all([api(`/activities/${id}`), api('/shoes')]);
  const plans = await api(`/plans?from=${a.date}&to=${a.date}`);
  const ev = a.evaluation;
  const metric = (name, m) => `<div class="metric"><span>${name}</span>${scoreHtml(m?.score)}<span class="muted">${esc(m?.summary)}</span></div>`;

  setTimeout(() => {
    view.querySelector('#plan-select').onchange = async (e) => {
      const v = e.target.value;
      await api(`/activities/${id}`, { method: 'PUT', body: { plan_id: v ? Number(v) : null } });
      route();
    };
    view.querySelector('#shoe-select').onchange = async (e) => {
      await api(`/activities/${id}`, { method: 'PUT', body: { shoe_id: e.target.value ? Number(e.target.value) : null } });
      route();
    };
    view.querySelector('#reeval').onclick = async (e) => {
      e.target.disabled = true;
      await api(`/activities/${id}/reevaluate`, { method: 'POST' });
      route();
    };
  });

  const hrd = ev?.hr?.details || {};
  const zones = [1, 2, 3, 4, 5].map((z) => hrd[`z${z}_pct`]).filter((v) => v != null);

  return `
    <p><a href="#/activities">‹ 一覧</a></p>
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
      ${metric('ペース', ev.pace)}${metric('心拍', ev.hr)}${metric('ケイデンス', ev.cadence)}${metric('距離', ev.volume)}
      <ul>${ev.comments.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      ${ev.pace.details.rep_paces ? `<p class="muted num">各本: ${esc(ev.pace.details.rep_paces)}</p>` : ''}
      ${zones.length ? `<p class="muted num">心拍ゾーン Z1–Z5: ${zones.map((z) => `${Math.round(z)}%`).join(' / ')}</p>` : ''}
    </div>` : ''}
    <div class="card">
      <label>紐づける計画
        <select id="plan-select">
          <option value="">なし (フリーラン)</option>
          ${plans.map((p) => `<option value="${p.id}" ${a.plan_id === p.id ? 'selected' : ''}>${PLAN_LABELS[p.type]} ${p.distance_m ? km(p.distance_m) + 'km' : ''}</option>`).join('')}
        </select>
      </label>
      <label>シューズ
        <select id="shoe-select">
          <option value="">なし</option>
          ${shoes.map((s) => `<option value="${s.id}" ${a.shoe_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select>
      </label>
      <button id="reeval">再評価</button>
    </div>`;
}

// ---- レース

async function racesView() {
  const races = await api('/races');
  const t = today();
  setTimeout(() => {
    view.querySelector('#add-race').onclick = () => editRace({ priority: 'A', distance_m: 42195 });
    view.querySelectorAll('[data-race]').forEach((el) => (el.onclick = () => editRace(races.find((r) => r.id === Number(el.dataset.race)))));
  });
  const row = (r) => {
    const goalPace = r.goal_time_s ? pace(r.goal_time_s / (r.distance_m / 1000)) : null;
    const diff = r.goal_time_s && r.result_time_s ? r.result_time_s - r.goal_time_s : null;
    return `<li data-race="${r.id}" style="cursor:pointer">
      <div class="row spread"><span><span class="badge">${esc(r.priority)}</span> ${esc(r.name)}</span><span class="muted num">${r.date}</span></div>
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

async function shoesView() {
  const shoes = await api('/shoes');
  setTimeout(() => {
    view.querySelector('#add-shoe').onclick = () => editShoe({ purpose: 'daily', limit_km: 700, initial_km: 0 });
    view.querySelectorAll('[data-shoe]').forEach((el) => (el.onclick = () => editShoe(shoes.find((s) => s.id === Number(el.dataset.shoe)))));
  });
  return `
    <div class="row spread" style="margin-bottom:8px"><h2>シューズ</h2><button class="primary" id="add-shoe">＋ 追加</button></div>
    <p class="muted">Strava でギアを設定して走ると自動で登録・加算されます。</p>
    <div class="card"><ul class="list">${shoes.map((s) => {
      const ratio = s.total_km / s.limit_km;
      return `<li data-shoe="${s.id}" class="shoe-row" style="cursor:pointer;${s.retired ? 'opacity:.5' : ''}">
        <div class="shoe-img">${s.image ? `<img src="${s.image}" alt="">` : '👟'}</div>
        <div class="shoe-body"><div class="row spread"><span>${esc(s.name)} <span class="badge">${PURPOSE_LABELS[s.purpose] ?? s.purpose}</span>${s.retired ? ' <span class="muted">引退</span>' : ''}</span>
        <span class="num">${s.total_km.toFixed(0)} / ${s.limit_km}km</span></div>
        <div class="bar ${ratio >= 1 ? 'over' : ratio >= 0.9 ? 'warn' : ''}"><div style="width:${Math.min(100, ratio * 100)}%"></div></div></div>
      </li>`;
    }).join('') || '<li class="muted">未登録</li>'}</ul></div>`;
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
    q('#shoe-preview').innerHTML = url ? `<img src="${url}" alt="">` : '👟';
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
      <div class="shoe-img big" id="shoe-preview">${s.image ? `<img src="${s.image}" alt="">` : '👟'}</div>
      <div class="row">
        <label class="btn" style="margin:0">写真を選ぶ<input type="file" id="shoe-file" accept="image/*" hidden></label>
        <a class="btn" id="shoe-search" target="_blank" rel="noopener">画像を探す</a>
        <button type="button" id="shoe-clear" class="danger">削除</button>
      </div>
      <input type="hidden" name="image" id="shoe-image" value="${s.image ? esc(s.image) : ''}">
    </div>
    <div class="grid2">
      <label>用途<select name="purpose">${Object.entries(PURPOSE_LABELS).map(([k, v]) => `<option value="${k}" ${s.purpose === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>交換目安 (km)<input name="limit_km" inputmode="numeric" value="${s.limit_km}"></label>
    </div>
    <div class="grid2">
      <label>初期距離 (km)<input name="initial_km" inputmode="decimal" value="${s.initial_km}"></label>
      <label>Strava gear ID<input name="strava_gear_id" placeholder="g12345" value="${esc(s.strava_gear_id)}"></label>
    </div>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="retired" style="width:auto" ${s.retired ? 'checked' : ''}> 引退済み</label>`,
    s.id ? { onDelete: async () => { await api(`/shoes/${s.id}`, { method: 'DELETE' }); route(); } } : {},
  );
  wireShoePhoto();
  const values = await pending;
  if (!values) return;
  await api(s.id ? `/shoes/${s.id}` : '/shoes', { method: s.id ? 'PUT' : 'POST', body: { ...values, retired: !!values.retired } });
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
      if (res.length === 0) return '❌ 通知先が未設定です (NTFY_TOPIC か BARK_KEY を設定してください)';
      return res.map((x) => `${x.ok ? '✅' : '❌'} ${x.channel}${x.error ? `: ${x.error}` : ' に送信しました'}`).join('\n');
    };
    run('#test-notify', async () => notifyText(await api('/notify/test', { method: 'POST' })));
    run('#morning', async () => notifyText(await api('/notify/morning', { method: 'POST' })));
    const bfText = (b) => !b ? '未実行' : b.active
      ? `取り込み中… ${b.imported} 件取り込み済み${b.pause_until && b.pause_until * 1000 > Date.now() ? ' (Strava の上限待ち。自動で再開します)' : ''}`
      : `${b.finished ? '完了' : '停止中'}: ${b.imported} 件取り込み${b.last_error ? ` / エラー: ${b.last_error}` : ''}`;
    run('#backfill-all', async () => {
      if (!confirm('Strava の全期間を取り込みます。アプリを閉じても自動で進みます。開始しますか？')) return 'キャンセル';
      return bfText(await api('/strava/backfill/start', { method: 'POST' }));
    });
    run('#seed', async () => {
      const r = await api('/seed', { method: 'POST' });
      return `✅ レース ${r.races} 件・計画 ${r.plans} 件を登録しました (登録済みの日付は飛ばします)`;
    });
    run('#backfill-2025', async () => {
      const days = Math.ceil((Date.now() - Date.parse('2025-01-01T00:00:00+09:00')) / 86400000);
      return bfText(await api(`/strava/backfill/start?days=${days}`, { method: 'POST' }));
    });
    run('#backfill-30', async () => bfText(await api('/strava/backfill/start?days=30', { method: 'POST' })));
    run('#backfill-status', async () => bfText(await api('/strava/backfill/status')));
    run('#backfill-stop', async () => bfText(await api('/strava/backfill/stop', { method: 'POST' })));
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
      <p>${status.strava_connected ? `✅ 連携済み (athlete ${status.athlete_id})` : '未連携'}</p>
      <div class="row">
        <a class="btn primary" href="/auth/strava?key=${encodeURIComponent(getToken())}">${status.strava_connected ? '再連携' : 'Strava と連携'}</a>
        <button id="subscribe">Webhook 登録</button>
        <button id="subscription">Webhook 確認</button>
      </div>
    </div>
    <div class="card">
      <h2>過去データの取り込み</h2>
      <p class="muted">${esc(status.backfill ? (status.backfill.active ? `取り込み中: ${status.backfill.imported} 件` : `前回: ${status.backfill.imported} 件取り込み${status.backfill.finished ? ' (完了)' : ''}`) : '未実行')}</p>
      <div class="row"><button id="backfill-2025" class="primary">2025年1月から取り込む</button><button id="backfill-all">全期間</button><button id="backfill-30">直近30日</button><button id="backfill-status">進み具合</button><button id="backfill-stop">停止</button></div>
      <p class="muted">開始後は閉じて大丈夫です。Strava の上限に当たると自動で待って再開します。</p>
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

  if (!getToken() && tab !== 'settings') {
    location.hash = '#/settings';
    return;
  }
  try {
    view.innerHTML = '<p class="muted">読み込み中…</p>';
    const html =
      tab === 'plans' ? await plansView(params)
      : tab === 'activities' ? (parts[1] ? await activityDetailView(parts[1]) : await activitiesView())
      : tab === 'races' ? await racesView()
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
