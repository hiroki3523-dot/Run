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
  const [plans, acts, races, summary, status, settings, weather] = await Promise.all([
    api(`/plans?from=${ws}&to=${addDays(ws, 6)}`),
    api(`/activities?from=${addDays(t, -14)}&to=${t}`),
    api('/races'),
    api(`/summary?from=${addDays(ws, -7 * 7)}&to=${addDays(ws, 6)}`),
    api('/status'),
    api('/settings'),
    api('/race-weather').catch(() => null),
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
      ${next.goal_time_s ? splitTable(next) : ''}
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

/** 等ペースで走った場合の 5km ごとの通過タイム */
function splitTable(race) {
  const per = race.goal_time_s / (race.distance_m / 1000);
  const rows = [];
  for (let k = 5; k < race.distance_m / 1000; k += 5) rows.push([`${k}km`, per * k]);
  rows.push([`${km(race.distance_m, 1)}km`, race.goal_time_s]);
  return `<details class="splits"><summary>ペース表 (等ペース ${pace(per)}/km)</summary>
    <div class="split-grid num">${rows.map(([l, t]) => `<span>${l}</span><b>${dur(t)}</b>`).join('')}</div>
    <p class="muted">30km までは目標ペースを守り、残りで上げるのが基本です。</p></details>`;
}

function weatherCard(w) {
  if (!w) return '';
  const hrs = w.hours.map((h) => `<div><div class="muted">${h.h}時</div><b>${Math.round(h.temp)}℃</b><div class="muted">${h.humidity ?? '-'}%</div></div>`).join('');
  return `<div class="card">
    <div class="row spread"><h2>${esc(w.race)}の天気 (${w.place})</h2><span class="muted num">${md(w.date)}</span></div>
    <div class="num" style="font-size:20px">${Math.round(w.tmin)}〜${Math.round(w.tmax)}℃ <span class="muted" style="font-size:13px">降水${w.precip_pct ?? '-'}%・風${w.wind_max.toFixed(0)}m/s</span></div>
    <div class="hours num">${hrs}</div>
    <p style="margin:8px 0 0">${esc(w.advice)}</p>
  </div>`;
}

/** COROS の予測タイムと目標の差 */
function goalCard(settings, next) {
  const c = settings?.coros;
  if (!c || !next) return '';
  const full = c.predicted_s.full;
  const rows = [['サブ3 (3:00:00)', 10800]];
  if (next.goal_time_s && next.goal_time_s !== 10800) rows.unshift([`${next.name} 目標`, next.goal_time_s]);
  const line = ([label, goal]) => {
    const d = full - goal;
    return `<div class="row spread"><span>${esc(label)} ${dur(goal)}</span><b class="num ${d <= 0 ? 'ok' : 'gap'}">${d <= 0 ? `予測より ${dur(-d)} 余裕` : `あと ${dur(d)} 短縮`}</b></div>`;
  };
  return `<div class="card">
    <h2>目標までの距離 (COROS 予測 ${dur(full)})</h2>
    <div class="goal-rows">${rows.map(line).join('')}</div>
    <p class="muted">予測は理想条件での値です。本番は暑さや補給で数分遅くなるのが普通です。</p>
  </div>`;
}

function planLine(p, hideActual = false) {
  const target = p.type === 'rest' ? '' : [p.distance_m ? `${km(p.distance_m)}km` : '', p.pace_min_s ? `${pace(p.pace_min_s)}-${pace(p.pace_max_s)}` : '', p.hr_max ? `≤${p.hr_max}bpm` : ''].filter(Boolean).join(' ');
  return `<div class="plan-item" data-plan="${p.id}">
    <div><span class="badge" data-t="${p.type}">${PLAN_LABELS[p.type]}</span> <span class="num">${target}</span>${p.notes ? `<div class="muted">${esc(p.notes)}</div>` : ''}</div>
    <div class="num">${p.activity_id && !hideActual ? `<a href="#/activities/${p.activity_id}">${km(p.actual_distance_m)}km ${scoreHtml(p.score)}</a>` : ''}</div>
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
  const actLine = (a) => `<a class="actual" href="#/activities/${a.id}"><span>実績 ${km(a.distance_m, 1)}km ${pace(a.moving_time_s / (a.distance_m / 1000))}/km${a.avg_hr ? ` ${Math.round(a.avg_hr)}bpm` : ''}</span>${scoreHtml(a.score)}</a>`;
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
    wireAutoPlan(view);
    view.querySelector('#bulk-toggle').onclick = () => view.querySelector('#bulk-box').classList.toggle('hidden');
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

  return `
    <div class="row spread" style="margin-bottom:8px">
      <a class="btn" href="#/plans?week=${addDays(ws, -7)}">‹ 前週</a>
      <strong>${md(ws)} 〜 ${md(addDays(ws, 6))}</strong>
      <a class="btn" href="#/plans?week=${addDays(ws, 7)}">翌週 ›</a>
    </div>
    <div class="card">
      <div class="row spread num"><span>計画 ${km(total)}km・実績 ${km(actual)}km</span><button id="copy-week">この週を翌週へコピー</button></div>
    </div>
    <div class="card" id="auto-card">
      <button id="auto-toggle">実績と目標から計画を自動で作る</button>
      <div id="auto-box" class="hidden" style="margin-top:12px">
        <p class="muted">直近4週間の走行距離と、先週の達成度、レースの目標ペースから、レース当日までの毎日のメニューを作ります。</p>
        <label>目標レース<select id="auto-race"></select></label>
        <label class="row"><input type="checkbox" id="auto-over"> すでにある計画を置き換える (走った日の計画は残します)</label>
        <div class="row"><button id="auto-preview" class="primary">プレビュー</button><button id="auto-commit" class="hidden">この計画を登録</button></div>
        <div id="auto-out"></div>
      </div>
    </div>
    <div class="card">
      <button id="bulk-toggle">メニューを貼り付けて登録</button>
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
            ${plans.filter((p) => p.date === d).map((p) => planLine(p, true)).join('')}
            ${weekActs.filter((a) => a.date === d).map(actLine).join('')}
            ${dayDiff(d, plans.filter((p) => p.date === d), weekActs.filter((a) => a.date === d))}
            <button data-add="${d}" style="margin-top:4px;font-size:12px">＋ 追加</button>
          </div>
        </div>`).join('')}
    </div>`;
}

function wireAutoPlan(root) {
  const q = (id) => root.querySelector(id);
  q('#auto-toggle').onclick = async () => {
    q('#auto-box').classList.toggle('hidden');
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
const zoneMid = (z) => (ZONES[z].pace[0] + ZONES[z].pace[1]) / 2;
const fmtTarget = (t) => (t.by === 'dist' ? (t.value >= 1000 ? `${+(t.value / 1000).toFixed(2)}km` : `${t.value}m`) : pace(t.value));
const targetM = (t) => (t.by === 'dist' ? t.value : (t.value / zoneMid(t.zone)) * 1000);
const stepM = (sp) => (sp.kind === 'interval' ? sp.reps * (targetM(sp.work) + targetM(sp.rest)) : targetM(sp));
const stepsTotalM = (steps) => steps.reduce((a, sp) => a + stepM(sp), 0);
function stepText(sp) {
  if (sp.kind === 'interval') return `${fmtTarget(sp.work)}×${sp.reps} ${ZONES[sp.work.zone].short} (休憩 ${fmtTarget(sp.rest)})`;
  const base = `${fmtTarget(sp)} ${ZONES[sp.zone].short}`;
  return sp.kind === 'warmup' ? `アップ ${base}` : sp.kind === 'cooldown' ? `ダウン ${base}` : sp.kind === 'rest' ? `休憩 ${fmtTarget(sp)}` : base;
}
const stepsSummary = (steps) => steps.map(stepText).join(' → ');
const mkStep = {
  warmup: () => ({ kind: 'warmup', by: 'dist', value: 2000, zone: 1 }),
  work: () => ({ kind: 'work', by: 'dist', value: 5000, zone: 3 }),
  rest: () => ({ kind: 'rest', by: 'time', value: 120, zone: 0 }),
  cooldown: () => ({ kind: 'cooldown', by: 'dist', value: 2000, zone: 1 }),
  interval: () => ({ kind: 'interval', reps: 5, work: { by: 'dist', value: 1000, zone: 4 }, rest: { by: 'dist', value: 200, zone: 0 } }),
};
const STEP_PRESETS = {
  'Mペース走': () => [mkStep.warmup(), { kind: 'work', by: 'dist', value: 10000, zone: 3 }, mkStep.cooldown()],
  'LT走': () => [mkStep.warmup(), { kind: 'interval', reps: 3, work: { by: 'dist', value: 2000, zone: 3 }, rest: { by: 'dist', value: 400, zone: 0 } }, mkStep.cooldown()],
  'インターバル': () => [mkStep.warmup(), mkStep.interval(), mkStep.cooldown()],
  'ビルドアップ': () => [{ kind: 'work', by: 'dist', value: 5000, zone: 1 }, { kind: 'work', by: 'dist', value: 5000, zone: 2 }, { kind: 'work', by: 'dist', value: 3000, zone: 3 }],
  'ロング(後半M)': () => [{ kind: 'work', by: 'dist', value: 16000, zone: 1 }, { kind: 'work', by: 'dist', value: 8000, zone: 3 }],
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

  const lthr = settings.coros?.lthr || settings.lthr || 174;
  const zoneLine = (z) => {
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
      <div class="chips">${ZONES.map((Z, z) => chip('data-szone', `${i}:${part}:${z}`, Z.short, t.zone === z)).join('')}</div>
      <p class="muted zone-note">${esc(zoneLine(t.zone))}</p></div>`;
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
    else if (d.sby || d.sval || d.szone) {
      const [i, part, v] = (d.sby || d.sval || d.szone).split(':');
      const sp = st.steps[Number(i)];
      const t = part ? sp[part] : sp;
      if (d.sby) { if (t.by !== v) { t.by = v; t.value = v === 'dist' ? 1000 : 120; } }
      else if (d.sval) t.value = Math.max(t.by === 'dist' ? 100 : 15, t.value + Number(v));
      else t.zone = Number(v);
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
      const z = ZONES[main.kind === 'interval' ? main.work.zone : main.zone];
      st.pmin = z.pace[0]; st.pmax = z.pace[1];
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
  return `<svg viewBox="0 0 ${W} ${H}" class="trend"><polygon points="${pad},${H - pad} ${line} ${last[0]},${H - pad}" class="area"/><polyline points="${line}" class="ln"/>${pts.map((p, i) => `<circle cx="${p[0]}" cy="${p[1]}" r="${i === pts.length - 1 ? 4 : 2.5}"/>`).join('')}</svg>
    <div class="row spread muted num"><span>${md(rows[0].week)}〜</span><span>最高 ${Math.max(...rows.map((r) => r.km)).toFixed(0)}km/週</span><span>今週 ${rows[rows.length - 1].km}km</span></div>`;
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
        ${r.grade ? `<span class="grade g${r.grade}">${r.grade}<small>${GRADE_NOTE[r.grade]}</small></span>` : ''}</div>
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
    api(`/activities/${id}/splits`).then((sp) => {
      const box = view.querySelector('#splits');
      if (!box || !Array.isArray(sp) || !sp.length) { if (box) box.innerHTML = '<span class="muted">取得できませんでした</span>'; return; }
      const slow = Math.max(...sp.map((x) => x.pace_s || 0)), fast = Math.min(...sp.filter((x) => x.pace_s).map((x) => x.pace_s));
      box.innerHTML = `<table class="num splits"><tr><th>km</th><th>ペース</th><th></th><th>標高</th><th>心拍</th></tr>${sp.map((x, i) => `<tr><td>${i + 1}</td><td>${x.pace_s ? pace(x.pace_s) : '-'}</td><td><span class="sbar" style="width:${x.pace_s ? 30 + ((slow - x.pace_s) / Math.max(1, slow - fast)) * 70 : 0}%"></span></td><td>${x.elev}</td><td>${x.hr ?? '-'}</td></tr>`).join('')}</table>`;
    }).catch(() => {});
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
      ${metric('ペース', ev.pace)}${metric('心拍', ev.hr)}${metric('ケイデンス', ev.cadence)}${ev.form ? metric('フォーム', ev.form) : ''}
      <ul class="bullets">${ev.comments.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
      ${ev.focus?.length ? `<h3 class="sub">次に意識すること</h3><ul class="bullets focus">${ev.focus.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      ${ev.pace.details.rep_paces ? `<p class="muted num">各本: ${esc(ev.pace.details.rep_paces)}</p>` : ''}
      ${zones.length ? `<p class="muted num">心拍ゾーン Z1–Z5: ${zones.map((z) => `${Math.round(z)}%`).join(' / ')}</p>` : ''}
    </div>` : ''}
    <div class="card"><h2>スプリット</h2><div id="splits"><span class="muted">読み込み中…</span></div></div>
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
        <div class="shoe-img">${s.image ? `<img src="${s.image}" alt="">` : '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 16v-3l4-1 2-3 3 2 4 1c3 .5 5 2 5 4v1H3z"/><path d="M3 19h18"/></svg>'}</div>
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

  if (!getToken() && tab !== 'settings') {
    location.hash = '#/settings';
    return;
  }
  try {
    view.innerHTML = '<p class="muted">読み込み中…</p>';
    const html =
      tab === 'plans' ? await plansView(params)
      : tab === 'activities' ? (parts[1] ? await activityDetailView(parts[1]) : await activitiesView(params))
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
