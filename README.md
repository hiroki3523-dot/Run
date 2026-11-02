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

## デプロイ手順 (スマホのブラウザだけで完結)

wrangler コマンドは使わず、Cloudflare と GitHub の Web 画面だけで行う。
Cloudflare 側でコードを GitHub から取り込み、ビルドとデプロイを自動で行う (Workers Builds)。
以後は GitHub の `main` ブランチを更新するたびに自動で再デプロイされる。

> Cloudflare の画面の項目名は変わることがあるため、以下と多少違っていたら近い名前のものを選ぶ。
> スマホでメニューが見当たらないときは、ブラウザの「PC 版サイトを表示」に切り替えると探しやすい。

### 事前に用意するもの

- Cloudflare アカウント (無料プランで可)
- GitHub アカウント (無料)
- Strava アカウント
- スマホに [ntfy](https://ntfy.sh) アプリ (App Store / Google Play)

パスワード管理アプリやメモアプリを開いておき、途中で出てくる値を書き留めておくと楽。

### 1. このリポジトリを自分の GitHub にコピーする (Fork)

1. GitHub でこのリポジトリを開き、右上の **Fork** → **Create fork**
2. 以後の手順は、自分のアカウントにできたコピー (`<自分のID>/Run`) で行う

本家の改良は毎日 4:17 に自動で取り込まれる (自分のコピーの **Actions** タブで一度だけ
「I understand my workflows, go ahead and enable them」を押して有効にする)。すぐ取り込みたいときは
**Sync fork** → **Update branch**。取り込むと Cloudflare が自動で再デプロイする。

### 2. D1 データベースを作る (Cloudflare)

1. <https://dash.cloudflare.com> にログイン
2. メニューの **ストレージとデータベース (Storage & Databases)** → **D1 SQL Database** → **作成 (Create)**
3. データベース名に `sub3` と入力して作成
4. 作成したデータベースの画面に表示される **Database ID** (`xxxxxxxx-xxxx-...` の形式) をコピーしておく

テーブルはここでは作らない。手順 5 のデプロイ時に `migrations/` の SQL が自動で適用される。

### 3. Database ID はメモしておく

`wrangler.toml` は書き換えない (本家の更新を自動で取り込めるように)。手順 5 で Cloudflare のビルド変数 `D1_DATABASE_ID` に入れる。

### 4. Strava API アプリを作る (Strava)

1. <https://www.strava.com/settings/api> を開く (スマホの Strava アプリではなくブラウザで)
2. アプリを作成する。**Authorization Callback Domain** はひとまず `localhost` にしておく (手順 7 で直す)
3. 表示される **Client ID** と **Client Secret** を書き留める

### 5. Worker を作って GitHub と連携する (Cloudflare)

1. メニューの **Workers & Pages** → **作成 (Create)**
2. **リポジトリをインポート (Import a repository)** を選び、GitHub アカウントを連携する
   (初回は GitHub 側で Cloudflare アプリのインストール画面が開くので、このリポジトリへのアクセスを許可する)
3. このリポジトリを選ぶ
4. 設定画面で次のとおりにする
   - **プロジェクト名 / Worker 名**: `sub3-runner` (`wrangler.toml` の `name` と同じにする)
   - **ビルドコマンド**: 空欄のまま (依存パッケージは自動でインストールされる)
   - **デプロイコマンド**: `npm run deploy`
     (D1 にテーブルを作る `wrangler d1 migrations apply` を実行してから `wrangler deploy` する)
   - **ルートディレクトリ**: 空欄 (または `/`)
5. **ビルド変数 (Build variables)** に `D1_DATABASE_ID` = 手順 2 の Database ID を追加
6. **デプロイ (Deploy)** をタップ。数分でビルドが終わる
6. 完了したら Worker の画面に表示される URL (`https://sub3-runner.<あなたのサブドメイン>.workers.dev`) を書き留める

この時点ではシークレットが未登録なのでアプリは正常に動かない。次の手順で登録する。

#### ビルドが失敗したとき

Worker の画面の **デプロイ (Deployments)** またはビルド履歴から、ログを開いて確認する。

- `database_id` 関連のエラー → 手順 3 の ID が正しいか確認する
- D1 の認証・権限エラー (`Authentication error` など) → ビルド用の API トークンに D1 の権限がない。
  Cloudflare の **プロフィール → API トークン** で、ビルド用に自動で作られたトークン (Workers Builds 用) を編集し、
  **アカウント → D1 → 編集** の権限を追加してから、Worker の画面でビルドを再実行する
- Worker 名の不一致エラー → Worker 名と `wrangler.toml` の `name` (`sub3-runner`) を揃える

### 6. シークレットを登録する (Cloudflare)

Worker の画面 → **設定 (Settings)** → **変数とシークレット (Variables and Secrets)** → **追加 (Add)**。
種類は **シークレット (Secret)** を選び、1 つずつ登録する (シークレットは再デプロイしても消えない)。

| 名前 | 値 |
| --- | --- |
| `APP_URL` | 手順 5 で書き留めた URL (末尾の `/` なし) |
| `APP_TOKEN` | アプリにログインするための合言葉。推測されにくい長い文字列 (パスワード管理アプリで生成すると楽) |
| `STRAVA_CLIENT_ID` | 手順 4 の Client ID |
| `STRAVA_CLIENT_SECRET` | 手順 4 の Client Secret |
| `STRAVA_VERIFY_TOKEN` | 任意のランダムな文字列 (Webhook の確認用。自分で入力する必要はない) |
| `NTFY_TOPIC` | 通知用のトピック名。他人に推測されない名前にする (例: `sub3-k8f2xq9w7m`) |
| `NTFY_TOKEN` | (任意) ntfy のアカウントで保護したトピックを使う場合のアクセストークン |

登録すると Worker に反映される (反映されない場合は手順 5 の画面からビルドを再実行する)。

### 7. Strava のコールバックドメインを直す (Strava)

<https://www.strava.com/settings/api> で **Authorization Callback Domain** を、
手順 5 の URL のドメイン部分 (`sub3-runner.<あなたのサブドメイン>.workers.dev`。`https://` は付けない) に変更する。

### 8. ntfy を購読する (スマホ)

ntfy アプリで **+** (Subscribe to topic) をタップし、手順 6 の `NTFY_TOPIC` と同じトピック名を入力する。
ntfy.sh の公開トピックは名前を知っていれば誰でも読めるので、トピック名は他人に教えない。

### 9. アプリの初期設定 (スマホのブラウザ)

手順 5 の URL を開き、**設定** タブで以下を行う。

1. **アクセストークン** に `APP_TOKEN` の値を入力して保存
2. **Strava と連携** → Strava の画面で許可 (「すべてのアクティビティを表示」のチェックは外さない)
3. **Webhook 登録** をタップ (結果に `id` が表示されれば成功。Strava の購読はアプリにつき 1 つ)
4. **テスト通知** をタップし、ntfy に届くか確認
5. 最大心拍・LTHR (閾値心拍)・目標ケイデンス・種別ごとのペース帯を自分の値に変えて保存
6. 必要なら **過去データ取り込み** で直近のランを取り込む

ブラウザの共有メニューから **ホーム画面に追加** すると、アプリのように使える。

### 更新のしかた

GitHub の `main` ブランチにコミット (または Pull request を Merge) すると、Cloudflare が自動で再ビルド・再デプロイする。
`migrations/` に SQL を追加した場合も、デプロイ時に未適用の分だけ自動で適用される。

## ローカル開発 (PC で開発する場合のみ)

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
