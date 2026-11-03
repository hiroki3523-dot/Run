# 改修のたびに作るもの

1. **改修レポート** — PR ごとに自動で作る (`scripts/report.mjs`)。
   - 自動: 変更した機能 (画面名・機能名。`docs/feature-map.json` の対応表から)・変更したファイル・変更した関数・コミット・動作確認の結果 (合格・不合格・未検証)・連携処理のファイルを変えていないか
   - 手書き: 変更前と変更後の違い・変更した理由・既存機能への影響・残っている問題・ユーザーによる確認が必要な操作。`docs/changes/<ブランチ名>.md` に書く (見出しは PR テンプレートと同じ)
   - 見る場所: PR の「Checks」→「テスト」→ Summary。残したいものは `docs/reports/` にも置く
2. **レビュー用データ** (`scripts/review-bundle.mjs`) — ChatGPT などに渡す zip。ソースコード一式・機能一覧・監査結果・改修履歴・差分・テスト結果・スクリーンショット・既知の不具合。
   - 取り方: GitHub の Actions →「テスト」の最新の実行 → 下の Artifacts の `stride-review` をダウンロード (中の `stride-review.zip` を ChatGPT に渡す)
3. **改修履歴** (`docs/HISTORY.md`) — `node scripts/history.mjs --out docs/HISTORY.md` で git から作り直す

## ルール

- 実行していないテストを「合格」と書かない。スキップしたものは「未検証」
- COROS・Strava の連携処理のファイル (`src/index.ts`・`strava.ts`・`backfill.ts`・`coros.ts`・`fit.ts`・`ext.ts`) が変更に入っていたら、レポートに警告が出る
- テストは本番のデータに触れない (テスト用データベースだけを使う)
