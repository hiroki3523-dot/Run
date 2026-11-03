# STRIDE 機能一覧・画面構成

2026-11-03 時点のコード (main, PR #113 まで) から整理したもの。推測で補ったところは書いていない。
ファイル・関数名は、レビューする人がコードの場所を探せるように添えている。

## 全体の作り

| 部分 | 中身 | ファイル |
|---|---|---|
| 画面 | 1 ページのアプリ (PWA)。ハッシュ (`#/plans` など) で画面を切り替える | `public/index.html`・`public/app.js`・`public/style.css`・`public/race-catalog.js` |
| API | Cloudflare Workers + Hono。`/api/*` は `Authorization: Bearer <APP_TOKEN>` が必要 | `src/index.ts` (入口・認証・Webhook・定期実行)・`src/api.ts` (API) |
| データベース | Cloudflare D1 (SQLite)。テーブル: activities・plans・races・shoes・kv・ext_activities・strava_tokens など | `migrations/0001〜0006` |
| AI | Workers AI (`@cf/openai/gpt-oss-120b`、だめなら `@cf/meta/llama-3.3-70b-instruct-fp8-fast`) | `src/coach.ts`・`src/raceinfo.ts` |
| 定期実行 | 毎分: Strava 過去データ取り込みの続き・COROS の取り込み / 毎朝 7:30 (JST): 今日のメニュー通知・大会情報の更新 | `src/index.ts` `scheduled` |

### 外部との連携 (今回の監査・テストでは変更していない)

| 連携 | 内容 | ファイル |
|---|---|---|
| Strava | OAuth・Webhook (`/webhook`)・ラン詳細と streams の取得・過去データ取り込み・シューズ (gear) | `src/strava.ts`・`src/backfill.ts`・`src/index.ts` |
| COROS | OAuth・ランと 1 秒ごとの記録の取り込み (`ext_activities` に保存、id は負の数)・予測タイム・閾値の取り込み・Strava との重複統合 | `src/coros.ts`・`src/fit.ts`・`src/ext.ts` |
| 天気 | Open-Meteo (予報・過去)・暑さ指数 | `src/weather.ts`・`src/forecast.ts` |
| ニュース | ランニングニュース・セール情報 (RSS) | `src/news.ts` |
| 大会情報 | 公式サイトの読み取り (AI)・Wikipedia/DuckDuckGo での公式サイト検索 | `src/raceinfo.ts`・`src/sitefind.ts` |
| 通知 | Bark など (朝のメニュー・ラン完了・シューズ交換時期) | `src/notify.ts`・`src/process.ts` |
| カレンダー | iPhone カレンダー購読用の ics (`/cal/:sig/sub3.ics`) | `src/calendar.ts` |

## 画面と画面間の関係

下のメニュー (6 つ): ホーム・計画・実績・レース・シューズ・設定。トークンが未設定なら、どの画面を開いても設定へ移る (`route()`)。

```
ホーム ─┬─ 今日の予定 ──────────────→ 計画
        ├─ 次のレースのカード ───────→ レース詳細 (ペース表・持ち物)
        ├─ 週間天気 ────────────────→ 週間天気
        ├─ 週の距離グラフ ───────────→ 実績 (週)
        └─ 今朝の体調・目標への現在地・マラソン適性・ニュース (ホーム内で完結)
計画 ── 週ごとのカレンダー ─→ 計画の追加・編集 (全画面のエディタ)
     └─ 予定を組む: 予定をコピー / 基本設定から自動作成 / AI に相談 / カレンダーに反映
実績 ─┬─ 一覧・日・週・月 のタブ ─→ ランの詳細
      └─ 12 週のグラフ ─→ 実績 (週)
ランの詳細 ─ 評価・分析・グラフ・ラップ・ふりかえり・シューズの選択・計画の付け替え
レース ─┬─ 一覧 (スライドで状態変更・削除) ─→ レース詳細
        └─ 大会を探す ─→ 候補に追加 ─→ レース詳細
シューズ ─ 一覧 (スライドで予備・引退) ─→ シューズの編集 (写真・用途・走った感覚)
設定 ─ 連携 (COROS・Strava)・トークン・評価の基準・通知・バックアップ
```

### 各画面の機能

| 画面 | ハッシュ | 主な機能 | 使う API | 関数 (app.js) |
|---|---|---|---|---|
| ホーム | `#/` | 今日の予定とおすすめシューズ・次のレースまでの日数・今朝の体調の記録と練習への影響・目標への現在地 (課題と次の練習)・マラソン適性 6 能力と予測の根拠・月間距離目標・週間天気・12 週の距離グラフ・ニュース | `/status` `/settings` `/plans` `/activities` `/races` `/insights` `/condition` `/goals/:month` `/weather/week` `/news` `/trend` | `homeView` `loadCondition` `loadInsights` `aptitudeHtml` `monthGoalCard` `loadNews` |
| 計画 | `#/plans?week=` | 週のカレンダー (計画と実績を並べる・予実の判定マーク・ドラッグで入れ替え)・今週の実績/計画の合計・計画の追加/編集/削除 (ステップ・ペース帯・距離)・予定のコピー・基本設定からの自動配置・AI コーチへの相談と変更案の反映・カレンダー購読 | `/plans` (GET/POST/PUT/DELETE) `/plans/copy-week` `/plans/generate` `/plans/bulk` `/plans/dedupe` `/coach` `/coach/apply` | `plansView` `weekSum` `editPlan` `wireAutoPlan` `wireCoach` `wireDrag` `calCard` |
| 実績 | `#/activities?view=list/day/week/month&date=` | 一覧・日・週・月の評価 (等級・内訳・コメント)・12 週グラフ | `/activities` `/review` `/trend` | `activitiesView` `trendChart` `bubbles` |
| ランの詳細 | `#/activities/:id` | 距離・時間・ペース等の数値・COROS の追加データ・この走りの評価 (練習達成度・走力評価・総合評価/最も重要な発見/次に活かすこと・詳細分析)・グラフ (ペース・心拍・ピッチ・ストライド・ゾーン)・ラップ・レビュー (ペース/心拍/フォーム/目標との比較)・点数の内訳・ふりかえり (主観 0〜10)・シューズの選択・計画の付け替え・再評価・画像で保存 | `/activities/:id` `/activities/:id/analysis` `/activities/:id/review` `/activities/:id/series` `/activities/:id/splits` `/activities/:id/feedback` `/activities/:id/reevaluate` `/shoes` | `activityDetailView` `analysisHtml` `reviewHtml` `seriesCards` `feedbackHtml` `bindFeedback` |
| レース一覧 | `#/races` | 状態 (エントリー候補・エントリー済み・出場決定) とエントリー時期・スライドで状態変更/削除・追加 | `/races` `/races/entry-history` | `racesView` `editRace` `wireSwipe` `manageRace` |
| レース詳細 | `#/races/:id` | 目標タイム・ペース表 (イーブン/ネガティブ/アクティブ/カスタム)・通過時刻・関門・補給・大会情報 (公式サイトから読み取り)・持ち物チェック・結果と次の目標・レース天気 | `/races/:id/*` `/checklist/:race` `/race-weather` | `raceDetailView` `paceRows` `splitTable` `racePlanExtras` `raceInfoCard` `loadRaceResult` |
| 大会を探す | `#/races/find` | 地域・時期・距離で大会一覧 (`race-catalog.js`)・名前で検索・候補に追加 | `/races` `/races/preview` `/races/find-site` | `raceFindView` `rfDetail` |
| シューズ | `#/shoes` | 一覧 (走行距離・寿命)・スライドで予備/引退・追加/編集/削除・写真・用途・走った感覚 (7 項目)・シューズの相性 (同じ練習の比較)・おすすめ | `/shoes` (GET/POST/PUT/DELETE) `/shoes/:id/feel` `/shoes/compare` | `shoesView` `editShoe` `loadShoeCompare` `recommendShoe` |
| 設定 | `#/settings` | COROS/Strava の連携と取り込み・トークン・評価の基準 (ペース帯・心拍・ピッチの参考値・データから自動)・予測タイムの出どころ・通知・バックアップ (書き出し/読み込み) | `/settings` `/settings/reset` `/settings/derive` `/coros/*` `/strava/*` `/notify/*` `/backup` | `settingsView` |
| 週間天気 | `#/weather` | 場所の選択・1 時間ごとの気温と暑さ指数・走るのにおすすめの時間帯 | `/weather/*` | `weatherView` `pickPlace` |

## 計算・評価のしくみ

| 項目 | 内容 | ファイル |
|---|---|---|
| ランの評価 (保存される点数) | 計画の種類ごとの重みで ペース・心拍・ピッチ・フォーム を採点 (距離は点数に入れない)。アップ・メイン・ダウンのステップがある計画はメイン区間だけを採点。計画なしは「フリーラン」 | `src/evaluate.ts` `evaluateRun` |
| 計画との紐付け | 同じ日の計画のうち、まだ実績の無いもの → 距離の近いもの。手動の付け替えも可。アップ・ダウンは位置から判定 | `src/process.ts` `ingestActivity` `findPlan` / `stepRole` |
| この走りの分析 | 練習達成度 (=保存された点数)・走力評価 (過去比の心拍・ドリフト・後半の維持・余裕度・フォームの維持)・ペースと心拍・過去比較 (気温・坂をそろえる)・フォームの前半後半・主観との照らし合わせ・目標超過の影響・大会直前の準備 | `src/analysis.ts` `analyzeRun` |
| ランのレビュー | ラップから前半/後半・心拍の推移・フォーム・大会の目標ペースとの比較 | `src/runreview.ts` |
| 日・週・月の評価 | 質 (点数)・ポイント練・距離・負荷 (TL) を重みづけ。調整期・回復期は距離の少なさを減点しない | `src/review.ts` `buildReview` |
| 目標への現在地 | 週間距離・ロング走・目標ペースの距離・ドリフト・ピッチ (自分の前の 4 週と比較)・走った日数 | `src/insights.ts` |
| マラソン適性・予測の根拠 | 6 能力と予測タイムの信頼度 | `src/aptitude.ts` |
| 計画の自動作成 | 週の基本構成・ポイント練の回数・レース前後の調整 | `src/planner.ts` |
| 評価の基準を自動で | 実績から ペース帯・心拍 を推定 | `src/derive.ts` `src/derive-apply.ts` |
| AI コーチ | 状況 (計画・実績・ふりかえり・体調・レース) を文章にして相談 | `src/coach.ts` |

## 保存しているデータ (kv テーブルのキー)

| キー | 中身 |
|---|---|
| `settings` | 設定 (ペース帯・心拍・ピッチの参考値・取り込み元・COROS の体力データなど) |
| `fb:{id}` | ふりかえり (呼吸・脚・RPE・フォーム・痛み・余裕・メモ・コンディション・後半) |
| `snap:{id}` | 分析の要約 (過去比較用・気温) |
| `cond:{YYYY-MM-DD}` | 朝の体調 |
| `shoefeel:{id}` | シューズの走った感覚 |
| `goal:{YYYY-MM}` | 月間の距離目標 |
| `checklist:{race_id}` | レースの持ち物チェック |
| `entry_hist:{name}` | 大会のエントリー時期の履歴 |
| `coach_brief`・`rprev:{url}`・`site:{name}` | AI の見立て・大会サイトの読み取り結果・公式サイト検索のキャッシュ |
| `coros_*`・`backfill`・`oauth_state` | 連携・取り込みの状態 (連携処理が使う。変更禁止) |
