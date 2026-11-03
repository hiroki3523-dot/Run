-- レースの状態 (エントリー候補 / エントリー済み / 出場決定)・公式サイト・大会情報 (JSON)
ALTER TABLE races ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed';
ALTER TABLE races ADD COLUMN url TEXT;
ALTER TABLE races ADD COLUMN info TEXT;
