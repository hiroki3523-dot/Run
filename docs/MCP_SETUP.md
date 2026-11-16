# STRIDE マラソンコーチ：MCP 接続の追加

## 今回の状態

ソース修正・ローカル検証済み。本番デプロイ、ChatGPT のプラグイン登録、認証済み実データ接続は未実施。
既存の Cloudflare Worker に `/mcp` を追加する。データベースの変更は不要。

## 変更内容

- `src/mcp.ts`：認証必須の stateless JSON-RPC MCP。7つの既存APIを内部で呼び出す。
- `src/index.ts`：`/mcp` をルーティング。
- `wrangler.toml`：`/mcp` と `/mcp/*` を Worker 優先に追加。
- `test/mcp.test.ts`：認証・ツール公開・実データ取得経路・登録確認・保護・通知・実ルートのテスト。

既存 `/gpt/*` と専用の ChatGPT 用の鍵を再利用する。APP_TOKEN は使用できない。
鍵の再発行・停止は MCP にも反映される。鍵をチャットやソースに貼らない。

## 反映手順

既存 STRIDE のデプロイ元 GitHub リポジトリに上記変更を反映し、現在使用している Cloudflare のビルド・デプロイを実行する。
元の説明書では main 更新時に Workers Builds が自動デプロイする構成。実際の接続先ブランチ・Worker は Cloudflare の現在の設定で確認する。
添付元の wrangler.toml は name=sub3-runner、提示された稼働URLは run.hiroki3523.workers.dev。新しい Worker を作らず、既存環境の名前・D1・デプロイ設定を優先する。

反映後の想定接続URL：`https://run.hiroki3523.workers.dev/mcp`
これはソースから定めたデプロイ先であり、現時点で本番動作は未検証。
ブラウザで普通に開くと、鍵なしは401・認証済みGETは405となる。接続不良とは限らない。

## 本番接続の確認とプラグイン化

1. 安全な認証設定欄に STRIDE の ChatGPT 用の鍵を設定する。HTTP Authorization: Bearer の送信が必要。
2. MCPクライアントから initialize / tools/list を実行し7ツールを確認する。
3. getToday と listRuns で参照を確認する。認証確認のために savePlans を実行しない。
4. 実エンドポイントとクライアントの認証方式を確認してからプラグインの接続設定を登録する。

この実装は Bearer 認証。OAuth サーバーは含まない。接続画面が OAuth のみを受け付ける場合は、対応する認証連携が追加で必要。URLだけで接続完了とはならない。
プラグインをまだ登録していない。未検証エンドポイントを登録済みとして扱わない。

## コーチの動作ルール

練習・体調の質問は getToday と listRuns、必要なら getRun で確認。
欠測は「記録がない」、通信・認証エラーは「取得できない」と区別。
距離は km、ペースは 分:秒/km、日付は日本時間。
計画を作る前に listPlans を確認。日付・種類・距離・ペース・ステップを表にする。
アップ・メイン・本数・レスト・ダウンを具体化。
利用者が提示した計画について「登録して」と明示したときだけ savePlans を実行。
MCPの savePlans は confirmed=true が必須で、replace=false は受け付けない。
このフラグは呼出側による申告であり、ユーザーの会話上の許可をサーバーが検証できるものではない。
期間内の未実施計画を置き換えるため、対象期間と休養日を含む全計画を提示する。
実績に結びついた計画は残し、過去日は入れない。登録後は imported / kept_linked_dates / skipped の実結果を報告。
タイムアウト後は成功と断言せず、listPlansで実際の状態を確認する。

## 検証結果

- `npm test -- test/mcp.test.ts test/gpt.test.ts`：8件成功。
- 本体 src のみの TypeScript チェック：成功。
- `npm run typecheck`：既存のテストにNode/DOM/Playwright型等のエラーがあり失敗。本体 src にエラーなし。
- 実データ、本番書き込み、ブラウザUI、リモートMCPクライアントでの接続は未検証。
