/**
 * マラソン適性 (6 つの能力) と、予測タイムの根拠・信頼度。
 * 直近 12 週のランを使い、ロング走とレースを重く見る。短い距離のペース走だけで楽観的にならないよう、
 * ロング走が足りないときは予測に「距離への耐性」の上乗せをして、信頼度を下げる。
 */
export interface AptRun {
  date: string; distance_m: number; moving_time_s: number; avg_hr: number | null; type: string | null; role: string | null;
  drift: number | null; half_diff: number | null; form_score: number | null;
  leg: number | null; rpe: number | null; pain: number | null; reserve: string | null; leg_next: number | null;
}
export interface Ability { key: string; label: string; score: number | null; level: 'good' | 'ok' | 'bad' | 'hold'; value: string; reason: string }
export interface Aptitude {
  abilities: Ability[];
  prediction: {
    goal_s: number | null; raw_s: number | null; adjusted_s: number | null; source: string;
    basis: string[]; data: string[]; missing: string[]; confidence: '高' | '中' | '低' | '-'; gap_s: number | null;
  };
}

const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86400_000;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const lv = (s: number | null): Ability['level'] => (s == null ? 'hold' : s >= 75 ? 'good' : s >= 55 ? 'ok' : 'bad');
const clamp = (x: number) => Math.round(Math.max(5, Math.min(100, x)));
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

export function buildAptitude(i: {
  today: string; runs: AptRun[]; goal_s: number | null; race_km: number;
  predicted_s: number | null; source: string; lt_pace_s: number | null; vo2max: number | null; lthr: number;
}): Aptitude {
  const t = day(i.today);
  const within = (n: number) => i.runs.filter((r) => t - day(r.date) < n && t - day(r.date) >= 0 && r.role !== 'warmup' && r.role !== 'cooldown');
  const runs = within(84);
  const pace = (r: AptRun) => r.moving_time_s / (r.distance_m / 1000);
  const goalPace = i.goal_s ? i.goal_s / i.race_km : null;
  const longs = runs.filter((r) => r.distance_m >= 25000 || r.type === 'long' || r.type === 'race');
  const longest = runs.reduce((a, r) => Math.max(a, r.distance_m), 0) / 1000;
  const ab: Ability[] = [];

  // 1. スピード能力: 閾値ペース (COROS) か、10km 前後の速いランのペースと、目標ペースの差
  {
    const fast = runs.filter((r) => r.distance_m >= 5000).map(pace).sort((a, b) => a - b);
    const ref = i.lt_pace_s ?? (fast.length >= 2 ? fast[1] : null);
    if (ref && goalPace) {
      const margin = goalPace - ref; // 目標ペースが閾値ペースより何秒遅いか (余裕)
      ab.push({ key: 'speed', label: 'スピード能力', score: clamp(55 + margin * 2), level: lv(clamp(55 + margin * 2)), value: `${i.lt_pace_s ? '閾値' : '速いラン'} ${mmss(ref)}/km`, reason: `目標ペース ${mmss(goalPace)}/km より ${Math.round(margin)} 秒速い。フルの目安は閾値ペースより 15〜25 秒遅いペース。` });
    } else ab.push({ key: 'speed', label: 'スピード能力', score: null, level: 'hold', value: '保留', reason: goalPace ? '閾値ペースも、5km 以上の速いランも足りない。' : '目標タイムが未設定。' });
  }
  // 2. 心肺持久力: 目標ペース ±10 秒で走ったときの心拍 (閾値心拍比)。VO2max があれば添える
  {
    const near = goalPace ? runs.filter((r) => r.avg_hr && r.distance_m >= 6000 && Math.abs(pace(r) - goalPace) <= 10) : [];
    if (near.length >= 2) {
      const ratio = median(near.map((r) => r.avg_hr! / i.lthr));
      const sc = clamp(100 - (ratio - 0.86) * 400);
      ab.push({ key: 'aerobic', label: '心肺持久力', score: sc, level: lv(sc), value: `閾値心拍の ${Math.round(ratio * 100)}%`, reason: `目標ペース付近で走った ${near.length} 本の心拍${i.vo2max ? `・VO2max ${i.vo2max}` : ''}。フルを押し切るには 88〜92% 以下が目安。` });
    } else ab.push({ key: 'aerobic', label: '心肺持久力', score: null, level: 'hold', value: '保留', reason: '目標ペース付近 (±10 秒) で 6km 以上走ったランが 2 本未満。' });
  }
  // 3. 筋持久力: ロング走の本数・最長距離・ロング走後の脚の疲労
  {
    const n25 = runs.filter((r) => r.distance_m >= 25000).length, n30 = runs.filter((r) => r.distance_m >= 30000).length;
    const legAfter = longs.map((r) => r.leg).filter((x): x is number => x != null);
    let sc = 30 + Math.min(3, n25) * 12 + Math.min(2, n30) * 10;
    if (legAfter.length) sc -= Math.max(0, mean(legAfter) - 6) * 6;
    ab.push({ key: 'muscle', label: '筋持久力', score: clamp(sc), level: lv(clamp(sc)), value: `25km以上 ${n25}回・最長 ${longest.toFixed(1)}km`, reason: `直近 12 週のロング走${legAfter.length ? `・ロング後の脚の疲労 平均 ${mean(legAfter).toFixed(1)}/10` : ''}。30km 以上を 2〜3 回が目安。` });
  }
  // 4. フォーム安定性: 各ランの評価のフォーム点 (後半の歩幅・ピッチの崩れ)
  {
    const fs = runs.map((r) => r.form_score).filter((x): x is number => x != null);
    if (fs.length >= 3) { const sc = clamp(mean(fs)); ab.push({ key: 'form', label: 'フォーム安定性', score: sc, level: lv(sc), value: `平均 ${sc}点`, reason: `${fs.length} 本のランの、後半の歩幅・ピッチの崩れ。` }); }
    else ab.push({ key: 'form', label: 'フォーム安定性', score: null, level: 'hold', value: '保留', reason: 'ピッチのデータがあるランが 3 本未満。' });
  }
  // 5. ペース維持能力: 10km 以上のランの後半の失速 (ロング走は 2 倍の重み)
  {
    const hd = runs.filter((r) => r.distance_m >= 10000 && r.half_diff != null);
    if (hd.length >= 2) {
      const w = hd.flatMap((r) => (r.distance_m >= 20000 ? [r.half_diff!, r.half_diff!] : [r.half_diff!]));
      const m = median(w);
      const sc = clamp(90 - Math.max(0, m) * 4);
      ab.push({ key: 'hold', label: 'ペース維持能力', score: sc, level: lv(sc), value: m <= 0 ? `後半 ${Math.round(-m)}秒/km 上げ` : `後半 ${Math.round(m)}秒/km 失速`, reason: `10km 以上の ${hd.length} 本 (ロング走を重く) の前半と後半の差。` });
    } else ab.push({ key: 'hold', label: 'ペース維持能力', score: null, level: 'hold', value: '保留', reason: '10km 以上のランが 2 本未満。' });
  }
  // 6. 回復状態: 直近 7 日の距離 / それまで 4 週の週平均、最近の脚の疲労・痛み・翌日の疲労
  {
    const km7 = within(7).reduce((a, r) => a + r.distance_m, 0) / 1000;
    const km28 = i.runs.filter((r) => t - day(r.date) >= 7 && t - day(r.date) < 35).reduce((a, r) => a + r.distance_m, 0) / 4000;
    const recent = within(7);
    const legs = recent.map((r) => r.leg_next ?? r.leg).filter((x): x is number => x != null);
    const pains = recent.map((r) => r.pain).filter((x): x is number => x != null);
    if (km28 > 0 || legs.length) {
      const acwr = km28 > 0 ? km7 / km28 : 1;
      let sc = 85 - Math.max(0, acwr - 1.2) * 60 - Math.max(0, 0.6 - acwr) * 20;
      if (legs.length) sc -= Math.max(0, mean(legs) - 5) * 7;
      if (pains.length && Math.max(...pains) >= 4) sc -= 15;
      ab.push({ key: 'recovery', label: '回復状態', score: clamp(sc), level: lv(clamp(sc)), value: `直近7日 ${Math.round(km7)}km (ふだんの ${Math.round(acwr * 100)}%)`, reason: `急に増やしすぎていないか${legs.length ? `・脚の疲労 平均 ${mean(legs).toFixed(1)}/10` : ''}${pains.length && Math.max(...pains) >= 4 ? '・痛みの記録あり' : ''}。ふだんの 130% を超えると疲労がたまりやすい。` });
    } else ab.push({ key: 'recovery', label: '回復状態', score: null, level: 'hold', value: '保留', reason: '直近 5 週の記録が足りない。' });
  }

  // ---- 予測の根拠・信頼度
  const basis: string[] = [], data: string[] = [], missing: string[] = [];
  basis.push(i.source);
  data.push(`直近 12 週のラン ${runs.length} 本 (25km 以上 ${runs.filter((r) => r.distance_m >= 25000).length} 回・最長 ${longest.toFixed(1)}km・レース ${runs.filter((r) => r.type === 'race').length} 回)`);
  // 距離への耐性: ロング走が足りないほど上乗せ
  const add = longest >= 30 ? 0 : longest >= 25 ? 0.01 : longest >= 20 ? 0.025 : 0.04;
  if (add > 0) { missing.push(`最長 ${longest.toFixed(1)}km。30km 以上のロング走が無いので、後半の失速を見込んで ${Math.round(add * 100)}% 上乗せ`); }
  const holdN = ab.filter((a) => a.score == null).length;
  if (holdN) missing.push(`能力のうち ${holdN} つはデータ不足で保留`);
  if (!runs.some((r) => r.type === 'race')) missing.push('直近 12 週にレースの記録が無い (レース結果があると精度が上がる)');
  const raw = i.predicted_s;
  const adjusted = raw ? Math.round(raw * (1 + add)) : null;
  // 信頼度: レースの実績 (12 週以内)・30km 以上のロング走・目標ペース付近の練習・データの新しさ
  const hasRace = runs.some((r) => r.type === 'race' && r.distance_m >= 20000);
  const gpRuns = goalPace ? runs.filter((r) => r.distance_m >= 8000 && Math.abs(pace(r) - goalPace) <= 10).length : 0;
  const fresh = runs.some((r) => t - day(r.date) <= 10);
  let pts = (hasRace ? 2 : 0) + (longest >= 30 ? 1 : 0) + (gpRuns >= 3 ? 1 : 0) + (fresh ? 1 : 0) - (holdN >= 2 ? 1 : 0);
  if (!hasRace) pts = Math.min(pts, 3); // レース実績が無いときは「高」にしない
  const confidence: Aptitude['prediction']['confidence'] = !raw ? '-' : pts >= 4 ? '高' : pts >= 2 ? '中' : '低';
  if (raw) data.push(`信頼度の根拠: レース実績 ${hasRace ? 'あり' : 'なし'}・30km 以上 ${longest >= 30 ? 'あり' : 'なし'}・目標ペース付近の練習 ${gpRuns} 本・直近 10 日の記録 ${fresh ? 'あり' : 'なし'}`);
  if (raw) basis.push(confidence === '高' ? '複数の練習とレース実績から見ても大きな矛盾はありません。' : confidence === '中' ? (hasRace ? '練習からは大きな矛盾はありませんが、足りないデータがあります。' : 'レース実績が無いので、練習からの推定です。幅を持って見てください。') : 'ロング走や比べるデータが少ないので、幅を持って見てください。');
  return {
    abilities: ab,
    prediction: { goal_s: i.goal_s, raw_s: raw, adjusted_s: adjusted, source: i.source, basis, data, missing, confidence, gap_s: adjusted && i.goal_s ? adjusted - i.goal_s : null },
  };
}
