export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_URL: string;
  APP_TOKEN: string;
  STRAVA_CLIENT_ID: string;
  STRAVA_CLIENT_SECRET: string;
  STRAVA_VERIFY_TOKEN: string;
  NTFY_SERVER?: string;
  NTFY_TOPIC?: string;
  NTFY_TOKEN?: string;
  /** Bark (iPhone 通知アプリ) を使う場合のデバイスキー */
  BARK_KEY?: string;
  BARK_SERVER?: string;
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
  /** メニュー構成 (JSON 文字列)。無ければ null */
  steps?: string | null;
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
  /** COROS のランニングレベル画面の値 (表示用・AI の計画づくりの基準) */
  coros: CorosInfo;
  /** 週のメニューの基本構成 (自動計画の希望) */
  plan_prefs: PlanPrefs;
  /** フルマラソンの予測タイムの出どころ。auto = Strava の記録から推定 / manual = 時計 (COROS など) の予測を入力 */
  predict?: { source: 'auto' | 'manual'; full_s: number | null };
  /** 天気の場所 (未設定なら福岡) */
  weather_place?: { name: string; lat: number; lon: number };
}

export interface PlanPrefs {
  /** 週のポイント練習 (LT・インターバル・Mペース走) の回数 0〜3 */
  points_per_week: number;
  /** ロング走の回数 0〜1 */
  long_per_week: number;
  /** ロング走を置きたい曜日 (0=日 … 6=土) */
  long_day: number;
  /** 毎週休む曜日 (0=日 … 6=土)。空なら rest_per_week の回数だけ自動で選ぶ */
  rest_days: number[];
  /** 1 週間に休む日の数 (走れない日は別) */
  rest_per_week: number;
  /** 予定が入って走れない日 (YYYY-MM-DD) */
  blocked: string[];
}

export interface CorosInfo {
  updated: string;
  running_level: number;
  vo2max: number;
  lt_pace_s: number; // 閾値ペース 秒/km
  lthr: number;
  predicted_s: { '5k': number; '10k': number; half: number; full: number };
  zones_s: { aerobic: [number, number]; threshold: [number, number]; speed: [number, number] };
}

export const DEFAULT_PLAN_PREFS: PlanPrefs = { points_per_week: 2, long_per_week: 1, long_day: 0, rest_days: [], rest_per_week: 1, blocked: [] };

export const DEFAULT_SETTINGS: Settings = {
  max_hr: 180,
  lthr: 174,
  target_cadence: 180,
  // COROS (2026-11-01) の閾値ペース 4:07 と各ゾーンを基準にした目安。race/m はサブ3 (4:15/km)
  paces: {
    easy: { min: 300, max: 345 },
    jog: { min: 330, max: 390 },
    long: { min: 285, max: 315 },
    m: { min: 250, max: 256 },
    lt: { min: 242, max: 250 },
    interval: { min: 225, max: 240 },
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
  coros: {
    updated: '2026-11-01',
    running_level: 90.0,
    vo2max: 55,
    lt_pace_s: 247,
    lthr: 174,
    predicted_s: { '5k': 1181, '10k': 2441, half: 5403, full: 11249 },
    zones_s: { aerobic: [286, 345], threshold: [242, 265], speed: [222, 241] },
  },
  plan_prefs: DEFAULT_PLAN_PREFS,
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
  /** フォームの安定度 (歩幅・ピッチ)。古い評価には無い */
  form?: MetricResult;
  /** 総合点の内訳 (各指標の重み %。データのある指標だけで合計 100) */
  weights?: { pace: number; hr: number; cadence: number; form: number };
  /** ロング走の本番ペース区間を評価したとき、その距離 (km) */
  section_km?: number;
  /** アップ・メイン・ダウンのうち、このランがどれにあたるか (ステップのある計画のとき) */
  role?: 'warmup' | 'work' | 'cooldown';
  comments: string[];
  /** 次に意識すること (数字つき・最大3つ) */
  focus?: string[];
}
