/** レース当日の天気予報 (Open-Meteo・無料・キー不要)。予報は 16 日先まで */

const CITIES: [keyword: string, name: string, lat: number, lon: number][] = [
  ['福岡', '福岡', 33.59, 130.4],
  ['青島', '宮崎', 31.87, 131.45],
  ['宮崎', '宮崎', 31.91, 131.42],
  ['長崎', '長崎', 32.75, 129.88],
  ['熊本', '熊本', 32.8, 130.71],
  ['佐賀', '佐賀', 33.25, 130.3],
];

export interface RaceWeather extends Partial<Omit<DaySky, 'code'>> {
  place: string;
  date: string;
  code: number;
  tmax: number;
  tmin: number;
  precip_pct: number | null;
  wind_max: number;
  /** スタート後 (9〜13 時) の時間帯別 */
  hours: { h: number; temp: number; humidity: number | null; precip_pct: number | null; wind: number }[];
}

export interface DayWeather extends Partial<Omit<DaySky, 'code'>> { date: string; code: number; tmax: number; tmin: number; precip_pct: number | null; wind_max: number }


/** 天気の大まかな種類 (「のち」「時々」の判定用) */
type Sky = 'sun' | 'cloud' | 'rain' | 'snow';
const SKY_LABEL: Record<Sky, string> = { sun: '晴れ', cloud: 'くもり', rain: '雨', snow: '雪' };
function skyOf(code: number): Sky {
  if (code <= 2) return 'sun';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  return 'cloud';
}
const SKY_RANK: Record<Sky, number> = { snow: 3, rain: 2, cloud: 1, sun: 0 };

export interface DaySky { code: number; code2: number | null; rel: 'nochi' | 'toki' | null; label: string }

/**
 * 1 日 (6〜21 時) の時間ごとの天気から「雨のちくもり」「くもり時々雨」のような表現を作る。
 * 前半 (6〜13 時) と後半 (14〜21 時) の主な天気が違えば「のち」、同じでも別の天気が 3 時間以上あれば「時々」
 */
export function daySky(hours: { h: number; code: number }[], fallback: number): DaySky {
  const hs = hours.filter((x) => x.h >= 6 && x.h <= 21 && Number.isFinite(x.code));
  const one = (c: number): DaySky => ({ code: c, code2: null, rel: null, label: SKY_LABEL[skyOf(c)] });
  if (hs.length < 6) return one(fallback);
  const dominant = (xs: { code: number }[]) => {
    const cnt = new Map<Sky, number>();
    xs.forEach((x) => cnt.set(skyOf(x.code), (cnt.get(skyOf(x.code)) ?? 0) + 1));
    // 雨・雪は半分の 4 割以上あればその天気とする (降っている時間は短くても印象が強い)
    const wet = (['snow', 'rain'] as Sky[]).find((k) => (cnt.get(k) ?? 0) >= xs.length * 0.4);
    const sky = wet ?? ([...cnt.entries()].sort((a, b) => b[1] - a[1] || SKY_RANK[b[0]] - SKY_RANK[a[0]])[0][0]);
    // そのカテゴリで最も多いコード (雷雨などの強さを残すため、同数なら大きいコード)
    const codes = xs.filter((x) => skyOf(x.code) === sky).map((x) => x.code);
    const cc = new Map<number, number>();
    codes.forEach((c) => cc.set(c, (cc.get(c) ?? 0) + 1));
    return { sky, code: [...cc.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0] };
  };
  const a = dominant(hs.filter((x) => x.h <= 13)), b = dominant(hs.filter((x) => x.h >= 14));
  if (hs.filter((x) => x.h <= 13).length >= 3 && hs.filter((x) => x.h >= 14).length >= 3 && a.sky !== b.sky) {
    return { code: a.code, code2: b.code, rel: 'nochi', label: `${SKY_LABEL[a.sky]}のち${SKY_LABEL[b.sky]}` };
  }
  const all = dominant(hs);
  const others = new Map<Sky, number[]>();
  hs.forEach((x) => { const k = skyOf(x.code); if (k !== all.sky) others.set(k, [...(others.get(k) ?? []), x.code]); });
  const sub = [...others.entries()].filter(([, v]) => v.length >= 3).sort((p, q) => SKY_RANK[q[0]] - SKY_RANK[p[0]] || q[1].length - p[1].length)[0];
  if (sub && SKY_RANK[sub[0]] !== SKY_RANK[all.sky]) {
    return { code: all.code, code2: Math.max(...sub[1]), rel: 'toki', label: `${SKY_LABEL[all.sky]}時々${SKY_LABEL[sub[0]]}` };
  }
  return { code: all.code, code2: null, rel: null, label: SKY_LABEL[all.sky] };
}

/** hourly の time / weather_code から、日付ごとの時間別コードを作る */
export function hourlyCodes(h: Record<string, (number | string | null)[]> | undefined): Map<string, { h: number; code: number }[]> {
  const m = new Map<string, { h: number; code: number }[]>();
  (h?.time ?? []).forEach((t, i) => {
    const c = h?.weather_code?.[i];
    if (c == null) return;
    const ts = String(t), d = ts.slice(0, 10);
    m.set(d, [...(m.get(d) ?? []), { h: Number(ts.slice(11, 13)), code: Number(c) }]);
  });
  return m;
}

/** 1 週間 (過去 7 日 + 先 15 日) の天気。自宅の近くの都市 (既定は福岡) */
export async function weatherDays(place: { name: string; lat: number; lon: number }): Promise<{ place: string; days: DayWeather[] } | null> {
  const city: [string, string, number, number] = [place.name, place.name, place.lat, place.lon];
  const q = new URLSearchParams({
    latitude: String(city[2]),
    longitude: String(city[3]),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
    hourly: 'weather_code',
    timezone: 'Asia/Tokyo',
    wind_speed_unit: 'ms',
    past_days: '7',
    forecast_days: '16',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { cf: { cacheTtl: 1800, cacheEverything: true } } as RequestInit);
  if (!res.ok) return null;
  const j = (await res.json()) as { daily?: Record<string, (number | string | null)[]>; hourly?: Record<string, (number | string | null)[]> };
  const d = j.daily;
  if (!d?.time) return null;
  const hc = hourlyCodes(j.hourly);
  return {
    place: city[1],
    days: d.time.map((t, i) => ({
      date: String(t),
      ...daySky(hc.get(String(t)) ?? [], Number(d.weather_code?.[i] ?? 0)),
      tmax: Number(d.temperature_2m_max?.[i]),
      tmin: Number(d.temperature_2m_min?.[i]),
      precip_pct: d.precipitation_probability_max?.[i] == null ? null : Number(d.precipitation_probability_max[i]),
      wind_max: Number(d.wind_speed_10m_max?.[i]),
    })),
  };
}

export function cityFor(raceName: string) {
  return CITIES.find((c) => raceName.includes(c[0])) ?? null;
}

export async function raceWeather(raceName: string, date: string): Promise<RaceWeather | null> {
  const city = cityFor(raceName);
  if (!city) return null;
  const q = new URLSearchParams({
    latitude: String(city[2]),
    longitude: String(city[3]),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
    hourly: 'temperature_2m,relative_humidity_2m,precipitation_probability,wind_speed_10m,weather_code',
    timezone: 'Asia/Tokyo',
    wind_speed_unit: 'ms',
    forecast_days: '16',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`);
  if (!res.ok) return null;
  const j = (await res.json()) as {
    daily?: Record<string, (number | string | null)[]>;
    hourly?: Record<string, (number | string | null)[]>;
  };
  const di = j.daily?.time?.indexOf(date) ?? -1;
  if (di < 0 || !j.daily) return null;
  const d = j.daily;
  const hours: RaceWeather['hours'] = [];
  for (const h of [9, 10, 11, 12, 13]) {
    const i = j.hourly?.time?.indexOf(`${date}T${String(h).padStart(2, '0')}:00`) ?? -1;
    if (i < 0 || !j.hourly) continue;
    hours.push({
      h,
      temp: Number(j.hourly.temperature_2m?.[i]),
      humidity: j.hourly.relative_humidity_2m?.[i] == null ? null : Number(j.hourly.relative_humidity_2m[i]),
      precip_pct: j.hourly.precipitation_probability?.[i] == null ? null : Number(j.hourly.precipitation_probability[i]),
      wind: Number(j.hourly.wind_speed_10m?.[i]),
    });
  }
  return {
    place: city[1],
    date,
    ...daySky(hourlyCodes(j.hourly).get(date) ?? [], Number(d.weather_code?.[di] ?? 0)),
    tmax: Number(d.temperature_2m_max?.[di]),
    tmin: Number(d.temperature_2m_min?.[di]),
    precip_pct: d.precipitation_probability_max?.[di] == null ? null : Number(d.precipitation_probability_max[di]),
    wind_max: Number(d.wind_speed_10m_max?.[di]),
    hours,
  };
}

/** 走りやすさのひと言 (マラソンは 5〜12℃ が最適、15℃を超えると遅くなる) */
export function weatherAdvice(w: RaceWeather): string {
  const t = Math.max(...w.hours.map((h) => h.temp), w.tmax);
  const parts: string[] = [];
  if (t >= 20) parts.push('暑い。目標ペースを 10〜20 秒/km 落とし、給水を毎回とる');
  else if (t >= 15) parts.push('やや暖かい。前半を抑え、補水を早めに');
  else if (t <= 3) parts.push('寒い。スタート前の防寒を厚めに');
  else parts.push('走りやすい気温');
  if ((w.precip_pct ?? 0) >= 50) parts.push('雨の可能性が高い (ポンチョ・キャップ)');
  if (w.wind_max >= 7) parts.push('風が強い (集団の後ろで)');
  return parts.join('。');
}
