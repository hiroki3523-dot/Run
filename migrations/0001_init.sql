-- Strava トークン (1 行のみ)
CREATE TABLE strava_tokens (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  athlete_id INTEGER NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

-- 汎用 key-value (設定 JSON、OAuth state など)
CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE races (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  date TEXT NOT NULL,              -- YYYY-MM-DD
  distance_m REAL NOT NULL,
  goal_time_s INTEGER,
  priority TEXT NOT NULL DEFAULT 'A',  -- A/B/C
  result_time_s INTEGER,
  activity_id INTEGER,
  notes TEXT
);

CREATE TABLE plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,              -- YYYY-MM-DD
  type TEXT NOT NULL,              -- easy/jog/long/m/lt/interval/race/rest
  distance_m REAL,
  pace_min_s INTEGER,              -- 速い側 (秒/km)
  pace_max_s INTEGER,              -- 遅い側 (秒/km)
  hr_max INTEGER,
  notes TEXT
);
CREATE INDEX plans_date ON plans(date);

CREATE TABLE shoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'daily',  -- daily/workout/race
  strava_gear_id TEXT UNIQUE,
  limit_km REAL NOT NULL DEFAULT 700,
  initial_km REAL NOT NULL DEFAULT 0,
  retired INTEGER NOT NULL DEFAULT 0,
  alert_sent INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE activities (
  id INTEGER PRIMARY KEY,          -- Strava activity id
  date TEXT NOT NULL,              -- ローカル日付 YYYY-MM-DD
  start_date_local TEXT NOT NULL,
  name TEXT NOT NULL,
  sport_type TEXT NOT NULL,
  workout_type INTEGER,
  distance_m REAL NOT NULL,
  moving_time_s INTEGER NOT NULL,
  elapsed_time_s INTEGER NOT NULL,
  avg_hr REAL,
  max_hr REAL,
  avg_cadence_spm REAL,
  gear_id TEXT,
  shoe_id INTEGER REFERENCES shoes(id) ON DELETE SET NULL,
  plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
  score INTEGER,
  evaluation TEXT,                 -- JSON
  notified_at TEXT
);
CREATE INDEX activities_date ON activities(date);
