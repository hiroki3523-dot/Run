-- COROS など Strava 以外から取り込んだランの元データ (概要・1 秒ごとの記録)。activities.id は負の数
CREATE TABLE IF NOT EXISTS ext_activities (
  id INTEGER PRIMARY KEY,
  ext_id TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL
);
