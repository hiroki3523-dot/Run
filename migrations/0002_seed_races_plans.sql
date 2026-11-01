-- レースと福岡マラソンまでの計画を初期登録 (すでに同じ日付があれば追加しない)

INSERT INTO races (name, date, distance_m, goal_time_s, priority, notes)
SELECT v.name, v.date, 42195, v.goal, v.priority, v.notes
FROM (
  SELECT '福岡マラソン' AS name, '2026-11-08' AS date, 11400 AS goal, 'A' AS priority, '3:10切り。等ペース4:30〜4:35/km。スタート8:20' AS notes
  UNION ALL SELECT '青島太平洋マラソン', '2026-12-13', NULL, 'B', '調整'
  UNION ALL SELECT '長崎ミュージックフェスマラソン', '2027-01-31', NULL, 'C', '調整'
  UNION ALL SELECT '熊本城マラソン', '2027-02-21', 10800, 'A', 'サブ3本命'
  UNION ALL SELECT '佐賀さくらマラソン', '2027-03-21', 10800, 'B', 'サブ3予備 (PB 3:24:16 の大会)'
) v
WHERE NOT EXISTS (SELECT 1 FROM races r WHERE r.date = v.date);

INSERT INTO plans (date, type, distance_m, pace_min_s, pace_max_s, notes)
SELECT v.date, v.type, v.dist, v.pmin, v.pmax, v.notes
FROM (
  SELECT '2026-10-26' AS date, 'rest' AS type, NULL AS dist, NULL AS pmin, NULL AS pmax, '完全休養' AS notes
  UNION ALL SELECT '2026-10-27', 'rest', NULL, NULL, NULL, '完全休養'
  UNION ALL SELECT '2026-10-28', 'lt', 8000, NULL, NULL, '閾値走 2km×2 (4:15前後)'
  UNION ALL SELECT '2026-10-29', 'jog', 5000, NULL, NULL, '休養またはジョグ'
  UNION ALL SELECT '2026-10-30', 'jog', 10000, 330, 345, 'ジョグ10km (5:30〜5:45) + 流し100m×3'
  UNION ALL SELECT '2026-10-31', 'rest', NULL, NULL, NULL, '休養 (脚が軽ければ5kmジョグ可)'
  UNION ALL SELECT '2026-11-01', 'long', 18000, NULL, NULL, 'アップ4km + 目標ペース10km (4:30〜4:35) + ダウン4km。本番靴・ジェル・朝食の予行'
  UNION ALL SELECT '2026-11-02', 'rest', NULL, NULL, NULL, '休養'
  UNION ALL SELECT '2026-11-03', 'jog', 8000, 330, 345, 'ジョグ8km (5:30〜5:45)'
  UNION ALL SELECT '2026-11-04', 'm', 8000, NULL, NULL, '1km×4 (4:30前後、間400mジョグ) + アップダウンで計8km。天気を見てペース決定'
  UNION ALL SELECT '2026-11-05', 'jog', 5000, 330, 345, 'ジョグ5km + 流し100m×3'
  UNION ALL SELECT '2026-11-06', 'rest', NULL, NULL, NULL, '休養'
  UNION ALL SELECT '2026-11-07', 'jog', 3000, 330, 345, 'ジョグ3km + 補給・ゼッケン確認'
  UNION ALL SELECT '2026-11-08', 'race', 42195, 270, 275, '福岡マラソン 4:30〜4:35/km等ペース。30kmまで死守。ジェルは時間で摂る'
) v
WHERE NOT EXISTS (SELECT 1 FROM plans p WHERE p.date = v.date);
