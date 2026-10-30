export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_URL: string;
  APP_TOKEN: string;
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  STRAVA_VERIFY_TOKEN: string;
  NTFY_SERVER: string;
  NTFY_TOPIC: string;
  NTFY_TOKEN?: string;
}

export const PLAN_TYPES = ['easy', 'jog', 'long', 'm', 'lt', 'interval', 'race', 'rest'] as const;
export type PlanType = (typeof PLAN_TYPES)[number];

export const PLAN_LABELS: Record<PlanType, string> = {
  easy: 'Easy',
  jog: 'Jog',
  long: 'ロング走',
  m: 'Mペース走',
  lt: 'LT走',
  interval: 'インターバル',
  race: 'レース',
  rest: '休養',
};

export interface Plan {
  id: number;
  date: string;
  type: PlanType;
  distance_m: number | null;
  pace_min_s: number | null;
  pace_max_s: number | null;
  hr_max: number | null;
  notes: string | null;
}

export interface PaceBand {
  min: number; // 速い側 秒/km
  max: number; // 遅い側 秒/km
}

export interface Settings {
  max_hr: number;
  lthr: number;
  target_cadence: number;
  /** 種別ごとの既定ペース帯 (秒/km) */
  paces: Record<Exclude<PlanType, 'rest'>, PaceBand>;
  /** 種別ごとの心拍目標 (LTHR に対する比率) */
  hr_targets: Record<Exclude<PlanType, 'rest'>, { min: number; max: number }>;
}

export const DEFAULT_SETTINGS: Settings = {
  max_hr: 190,
  lthr: 170,
  target_cadence: 180,
  // サブ3 (4:15/km) を基準にした目安
  paces: {
    easy: { min: 300, max: 340 },
    jog: { min: 330, max: 390 },
    long: { min: 275, max: 310 },
    m: { min: 250, max: 256 },
    lt: { min: 232, max: 240 },
    interval: { min: 210, max: 222 },
    race: { min: 250, max: 255 },
  },
  hr_targets: {
    easy: { min: 0.7, max: 0.89 },
    jog: { min: 0.6, max: 0.85 },
    long: { min: 0.75, max: 0.92 },
    m: { min: 0.9, max: 0.96 },
    lt: { min: 0.95, max: 1.02 },
    interval: { min: 0.95, max: 1.1 },
    race: { min: 0.9, max: 1.0 },
  },
};

/** Strava streams を key ごとの配列にしたもの */
export interface Streams {
  time: number[];
  distance: number[];
  velocity_smooth?: number[];
  heartrate?: number[];
  cadence?: number[]; // Strava のランは片足 rpm
}

export interface Lap {
  distance: number;
  moving_time: number;
  average_speed: number;
  average_heartrate?: number;
  average_cadence?: number;
}

export interface ActivityInput {
  distance_m: number;
  moving_time_s: number;
  laps: Lap[];
  streams: Streams | null;
}

export interface MetricResult {
  score: number | null; // データが無ければ null
  summary: string;
  details: Record<string, number | string | null>;
}

export interface Evaluation {
  type: PlanType | 'free';
  score: number;
  pace: MetricResult;
  hr: MetricResult;
  cadence: MetricResult;
  volume: MetricResult;
  comments: string[];
}
