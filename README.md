# Sub3 Runner

サブ3 (フルマラソン 3 時間切り) を狙うランナー向けの個人用トレーニングアプリ。

- Strava の Webhook で新規ランを受信 → ペース・心拍・ケイデンス・距離で 100 点満点評価
- 毎朝 7:30 (JST) に今日のメニュー、ラン後に評価をスマホへ通知 (ntfy)
- レース一覧と目標タイム、日ごとの計画と実績、シューズの走行距離管理

要件は [docs/requirements.md](docs/requirements.md) を参照。

## 構成

| 役割 | 採用 |
| --- | --- |
| ホスティング | Cloudflare Workers (UI も同じ Worker の静的アセットで配信) |
| DB | Cloudflare D1 (SQLite) |
| 定時実行 | Cron Triggers (`30 22 * * *` UTC = 7:30 JST) |
| 通知 | [ntfy](https://ntfy.sh) |

```
src/
  index.ts     エントリ (Webhook / OAuth / API 認証 / Cron)
  api.ts       REST API (races, plans, activities, shoes, settings, summary)
  process.ts   アクティビティ取り込み・計画紐づけ・通知文生成・朝の通知
  evaluate.ts  ラン評価ロジック (純粋関数、test/ でテスト)
  strava.ts    Strava API クライアント (トークン自動更新)
  notify.ts    ntfy 送信
public/        SPA (依存なし、PWA としてホーム画面に追加可)
migrations/    D1 スキーマ
```

## 評価ロジック

計画の種別ごとに目標ペース帯・心拍域を決め (計画で上書き可、未指定は設定画面の既定値)、Strava の streams から算出する。

- **ペース**: 目標帯の滞在率 (時間加重) と 1km スプリットのばらつき。M/LT/レースはアップ・ダウンを除いた本練習部分、インターバルはラップから本数・各本ペース・失速率を評価。Easy/Jog は速すぎのみを減点
- **心拍**: 目標域の滞在率と心拍ドリフト (前半/後半の速度÷心拍の低下率、5% 超で減点)。ゾーンは LTHR 基準
- **ケイデンス**: 目標 spm との差と後半の落ち込み (Easy 系は目標を少し緩める)
- **距離**: 計画距離に対する達成率
- 種別ごとに重み付けして総合点を出す。計画のない日は「フリーラン」として心拍・ケイデンス中心

## セットアップ

### 1. 依存関係と D1

```sh
npm install
npx wrangler login
npx wrangler d1 create sub3        # 出力された database_id を wrangler.toml に記入
npm run db:migrate:remote
```

`wrangler.toml` の `APP_URL` をデプロイ先 URL (例: `https://sub3-runner.<account>.workers.dev`) に変更。

### 2. Strava API アプリ

<https://www.strava.com/settings/api> でアプリを作成し、**Authorization Callback Domain** に Worker のドメイン (例: `sub3-runner.<account>.workers.dev`) を設定。

### 3. ntfy

スマホに ntfy アプリを入れ、推測されにくいトピック名 (例: `sub3-<ランダム文字列>`) を購読する。
ntfy.sh の公開トピックは名前を知っていれば誰でも読めるので、ランダムな名前にするか、アカウントを作ってアクセストークンを使う。

### 4. シークレットを登録してデプロイ

```sh
npx wrangler secret put APP_TOKEN            # UI ログイン用 (長いランダム文字列)
npx wrangler secret put STRAVA_CLIENT_ID
npx wrangler secret put STRAVA_CLIENT_SECRET
npx wrangler secret put STRAVA_VERIFY_TOKEN  # 任意のランダム文字列
npx wrangler secret put NTFY_TOPIC
npx wrangler secret put NTFY_TOKEN           # 任意
npm run deploy
```

### 5. 初期設定 (アプリの「設定」タブ)

1. `APP_TOKEN` を入力して保存
2. 「Strava と連携」→ 認可
3. 「Webhook 登録」(Strava の購読はアプリにつき 1 つ)
4. 「テスト通知」で ntfy に届くか確認
5. 最大心拍・LTHR・目標ケイデンス・種別ごとのペース帯を調整
6. 必要なら「過去データ取り込み」

## ローカル開発

```sh
cp .dev.vars.example .dev.vars   # 値を埋める
npm run db:migrate:local
npm run dev                      # http://localhost:8787
npm test
npm run typecheck
```

## 制約メモ

- Strava の Webhook は 2 秒以内に 200 を返す必要があるため、取り込みは `waitUntil` で応答後に実行
- Workers 無料プランは 1 リクエストあたりのサブリクエスト数に上限があるため、過去データ取り込みは 1 回 15 件ずつ (UI が自動で繰り返す)
- Strava API のレート制限は 15 分 100 / 1 日 1,000 リクエスト
