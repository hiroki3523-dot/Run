/** レース当日の天気予報 (Open-Meteo・無料・キー不要)。予報は 16 日先まで */

const CITIES: [keyword: string, name: string, lat: number, lon: number][] = [
  ['福岡', '福岡', 33.59, 130.4],
  ['青島', '宮崎', 31.87, 131.45],
  ['宮崎', '宮崎', 31.91, 131.42],
  ['長崎', '長崎', 32.75, 129.88],
  ['熊本', '熊本', 32.8, 130.71],
  ['佐賀', '佐賀', 33.25, 130.3],
];

export interface RaceWeather {
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

export interface DayWeather { date: string; code: number; tmax: number; tmin: number; precip_pct: number | null; wind_max: number }

/** 1 週間 (過去 7 日 + 先 15 日) の天気。自宅の近くの都市 (既定は福岡) */
export async function weatherDays(cityName = '福岡'): Promise<{ place: string; days: DayWeather[] } | null> {
  const city = CITIES.find((c) => c[0] === cityName) ?? CITIES[0];
  const q = new URLSearchParams({
    latitude: String(city[2]),
    longitude: String(city[3]),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
    timezone: 'Asia/Tokyo',
    wind_speed_unit: 'ms',
    past_days: '7',
    forecast_days: '16',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { cf: { cacheTtl: 1800, cacheEverything: true } } as RequestInit);
  if (!res.ok) return null;
  const j = (await res.json()) as { daily?: Record<string, (number | string | null)[]> };
  const d = j.daily;
  if (!d?.time) return null;
  return {
    place: city[1],
    days: d.time.map((t, i) => ({
      date: String(t),
      code: Number(d.weather_code?.[i] ?? 0),
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
    hourly: 'temperature_2m,relative_humidity_2m,precipitation_probability,wind_speed_10m',
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
    code: Number(d.weather_code?.[di] ?? 0),
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
