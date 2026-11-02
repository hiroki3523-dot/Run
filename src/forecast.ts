import { daySky, type DaySky } from './weather';
/** 天気予報 (Open-Meteo・無料・キー不要)。気温・湿度・日射から暑さ指数 (WBGT 推定) と走りやすさを計算する */

export interface Place { name: string; lat: number; lon: number }
export const DEFAULT_PLACE: Place = { name: '福岡', lat: 33.59, lon: 130.4 };

export async function searchPlaces(q: string): Promise<(Place & { detail: string })[]> {
  const p = new URLSearchParams({ name: q, count: '8', language: 'ja', format: 'json' });
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${p}`, { cf: { cacheTtl: 86400, cacheEverything: true } } as RequestInit);
  if (!res.ok) return [];
  const j = (await res.json()) as { results?: { name: string; latitude: number; longitude: number; admin1?: string; admin2?: string; country?: string }[] };
  return (j.results ?? []).map((r) => ({
    name: r.name,
    lat: Math.round(r.latitude * 1000) / 1000,
    lon: Math.round(r.longitude * 1000) / 1000,
    detail: [r.admin1, r.admin2, r.country].filter(Boolean).join(' '),
  }));
}

export interface Hour {
  t: string; // YYYY-MM-DDTHH:00
  h: number;
  code: number;
  temp: number;
  feels: number;
  humidity: number;
  precip_pct: number | null;
  precip_mm: number;
  wind: number;
  gust: number;
  uv: number;
  wbgt: number;
  index: number; // 走りやすさ 0〜100
  daylight: boolean;
}

export const wbgtLevel = (w: number) => (w >= 31 ? '運動は原則中止' : w >= 28 ? '厳重警戒' : w >= 25 ? '警戒' : w >= 21 ? '注意' : 'ほぼ安全');

/** WBGT の推定 (小野・本保の式。気温℃・相対湿度%・全天日射 kW/m²・風速 m/s) */
export function estimateWbgt(ta: number, rh: number, sr: number, ws: number): number {
  const v = 0.735 * ta + 0.0374 * rh + 0.00292 * ta * rh + 7.619 * sr - 4.557 * sr * sr - 0.0572 * ws - 4.064;
  return Math.round(v * 10) / 10;
}

/** 走りやすさ (0〜100)。涼しく・風が弱く・雨がないほど高い */
export function runIndex(temp: number, humidity: number, wind: number, precipPct: number, precipMm: number, wbgt: number): number {
  let s = 100;
  // 気温: 5〜12℃ が最適。暑いほど急に減点、寒いのは緩やかに
  if (temp > 12) s -= Math.min(70, (temp - 12) * 4.2);
  else if (temp < 5) s -= Math.min(40, (5 - temp) * 3);
  if (wbgt >= 21) s -= Math.min(30, (wbgt - 21) * 4);
  if (humidity > 75 && temp > 12) s -= Math.min(10, (humidity - 75) * 0.5);
  if (wind > 4) s -= Math.min(20, (wind - 4) * 3);
  s -= Math.min(15, (precipPct ?? 0) * 0.15);
  s -= Math.min(20, precipMm * 6);
  return Math.max(0, Math.round(s));
}

export const indexLabel = (i: number) => (i >= 85 ? '最適' : i >= 70 ? '走りやすい' : i >= 50 ? 'ふつう' : i >= 30 ? 'きびしい' : '避けたい');

/** 暑さで遅くなるペースの目安 (秒/km)。10℃ を超えた分、フルのペースで約 2 秒/km/℃ */
export const heatPaceCost = (temp: number) => Math.max(0, Math.round((temp - 10) * 2));

export interface DayInfo extends Partial<Omit<DaySky, 'code'>> {
  date: string;
  code: number;
  tmax: number;
  tmin: number;
  feels_max: number;
  precip_pct: number | null;
  precip_mm: number;
  wind_max: number;
  sunrise: string;
  sunset: string;
  uv_max: number;
  best: { from: number; to: number; temp: number; index: number; wbgt: number; label: string } | null;
}

export interface Forecast {
  place: Place;
  updated: string;
  now: Hour | null;
  hourly: Hour[];
  daily: DayInfo[];
  air: { pm2_5: number | null; aqi: number | null } | null;
  advice: string[];
}

export async function forecast(place: Place, nowMs = Date.now()): Promise<Forecast | null> {
  const q = new URLSearchParams({
    latitude: String(place.lat),
    longitude: String(place.lon),
    hourly: 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,uv_index,shortwave_radiation',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset,uv_index_max',
    timezone: 'Asia/Tokyo',
    wind_speed_unit: 'ms',
    forecast_days: '7',
  });
  const [res, airRes] = await Promise.all([
    fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { cf: { cacheTtl: 900, cacheEverything: true } } as RequestInit),
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${place.lat}&longitude=${place.lon}&current=pm2_5,us_aqi&timezone=Asia%2FTokyo`, { cf: { cacheTtl: 1800, cacheEverything: true } } as RequestInit).catch(() => null),
  ]);
  if (!res.ok) return null;
  const j = (await res.json()) as { hourly: Record<string, (number | string | null)[]>; daily: Record<string, (number | string | null)[]> };
  const H = j.hourly, D = j.daily;
  if (!H?.time || !D?.time) return null;

  const dayOf = new Map<string, { sunrise: string; sunset: string }>();
  D.time.forEach((d, i) => dayOf.set(String(d), { sunrise: String(D.sunrise?.[i]), sunset: String(D.sunset?.[i]) }));
  const n = (a: (number | string | null)[] | undefined, i: number, d = 0) => (a?.[i] == null ? d : Number(a[i]));

  const hourly: Hour[] = H.time.map((t, i) => {
    const ts = String(t);
    const temp = n(H.temperature_2m, i), hum = n(H.relative_humidity_2m, i), wind = n(H.wind_speed_10m, i);
    const sr = n(H.shortwave_radiation, i) / 1000;
    const wbgt = estimateWbgt(temp, hum, sr, wind);
    const pp = H.precipitation_probability?.[i] == null ? null : Number(H.precipitation_probability[i]);
    const mm = n(H.precipitation, i);
    const info = dayOf.get(ts.slice(0, 10));
    const daylight = info ? ts >= info.sunrise.slice(0, 13) + ':00' && ts <= info.sunset.slice(0, 13) + ':00' : true;
    return {
      t: ts, h: Number(ts.slice(11, 13)), code: n(H.weather_code, i), temp, feels: n(H.apparent_temperature, i), humidity: hum,
      precip_pct: pp, precip_mm: mm, wind, gust: n(H.wind_gusts_10m, i), uv: n(H.uv_index, i), wbgt,
      index: runIndex(temp, hum, wind, pp ?? 0, mm, wbgt), daylight,
    };
  });

  // 日本時間の「いま」以降の時間帯だけを返す
  const jst = new Date(nowMs + 9 * 3600_000).toISOString().slice(0, 13) + ':00';
  const fromIdx = Math.max(0, hourly.findIndex((h) => h.t >= jst));
  const upcoming = hourly.slice(fromIdx, fromIdx + 48);

  const daily: DayInfo[] = D.time.map((d, i) => {
    const date = String(d);
    const hrs = hourly.filter((h) => h.t.startsWith(date) && h.daylight && h.h >= 5 && h.h <= 21 && h.t >= jst);
    // 連続 2 時間の平均がいちばん高い時間帯
    let best: DayInfo['best'] = null;
    for (let k = 0; k + 1 < hrs.length; k++) {
      if (hrs[k + 1].h !== hrs[k].h + 1) continue;
      const idx = (hrs[k].index + hrs[k + 1].index) / 2;
      if (!best || idx > best.index) {
        const temp = (hrs[k].temp + hrs[k + 1].temp) / 2, wbgt = (hrs[k].wbgt + hrs[k + 1].wbgt) / 2;
        best = { from: hrs[k].h, to: hrs[k + 1].h + 1, temp: Math.round(temp), index: Math.round(idx), wbgt: Math.round(wbgt * 10) / 10, label: indexLabel(idx) };
      }
    }
    return {
      date, ...daySky(hourly.filter((h) => h.t.startsWith(date)).map((h) => ({ h: h.h, code: h.code })), n(D.weather_code, i)), tmax: n(D.temperature_2m_max, i), tmin: n(D.temperature_2m_min, i), feels_max: n(D.apparent_temperature_max, i),
      precip_pct: D.precipitation_probability_max?.[i] == null ? null : Number(D.precipitation_probability_max[i]),
      precip_mm: n(D.precipitation_sum, i), wind_max: n(D.wind_speed_10m_max, i),
      sunrise: String(D.sunrise?.[i]).slice(11, 16), sunset: String(D.sunset?.[i]).slice(11, 16), uv_max: n(D.uv_index_max, i), best,
    };
  });

  let air: Forecast['air'] = null;
  try {
    if (airRes?.ok) {
      const a = (await airRes.json()) as { current?: { pm2_5?: number; us_aqi?: number } };
      air = { pm2_5: a.current?.pm2_5 ?? null, aqi: a.current?.us_aqi ?? null };
    }
  } catch { /* 大気質は無くてもよい */ }

  const now = upcoming[0] ?? null;
  return { place, updated: new Date(nowMs).toISOString(), now, hourly: upcoming, daily, air, advice: adviceFor(now, daily[0], air) };
}

function adviceFor(now: Hour | null, today: DayInfo | undefined, air: Forecast['air']): string[] {
  const out: string[] = [];
  if (now) {
    if (now.wbgt >= 28) out.push(`暑さ指数 ${now.wbgt} (${wbgtLevel(now.wbgt)})。いまは走らず、朝か夜に回すのが安全です。`);
    else if (now.wbgt >= 25) out.push(`暑さ指数 ${now.wbgt} (警戒)。ペースを ${heatPaceCost(now.temp)} 秒/km ほど落とし、こまめに給水を。`);
    else if (now.temp >= 15) out.push(`${Math.round(now.temp)}℃。ペースは目標より ${heatPaceCost(now.temp)} 秒/km 遅くなるのが普通です。`);
    else if (now.temp <= 3) out.push(`${Math.round(now.temp)}℃。ウォームアップを長めに、手袋とネックウォーマーを。`);
    if (now.wind >= 7) out.push(`風 ${now.wind.toFixed(0)}m/s。向かい風の区間はペースを守らず、心拍で走る。`);
    if ((now.precip_pct ?? 0) >= 60 || now.precip_mm >= 1) out.push('雨の見込み。帽子のつばと、替えの靴下を。');
  }
  if (today?.best) out.push(`今日のおすすめは ${today.best.from}〜${today.best.to}時 (${today.best.temp}℃・${today.best.label})。`);
  if (air?.aqi != null && air.aqi >= 100) out.push(`大気が悪い日です (AQI ${air.aqi})。強度の高い練習は控えめに。`);
  if (out.length === 0) out.push('走りやすい条件です。');
  return out;
}
