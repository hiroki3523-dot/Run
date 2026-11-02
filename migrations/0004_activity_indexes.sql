-- 計画ごと・シューズごとの実績を引くときに activities 全件を読んでいたため索引を追加
-- (D1 無料枠の「1 日の読み取り行数」を使い切る原因になっていた)
CREATE INDEX IF NOT EXISTS activities_plan ON activities(plan_id);
CREATE INDEX IF NOT EXISTS activities_shoe ON activities(shoe_id);
