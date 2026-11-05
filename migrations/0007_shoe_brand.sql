-- シューズのブランド (名前とは別に持つ。未設定は NULL のまま。既存の名前は変えない)
ALTER TABLE shoes ADD COLUMN brand TEXT;
