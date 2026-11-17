# 拡張機能: MCP の OAuth ログイン (ChatGPT のコネクタでつなぐため)

## きっかけ
- ChatGPT の「Add custom MCP server」は、認証が OAuth か「認証なし」だけで、Bearer の鍵を入れる欄がない
- 「Work」のアカウントでは自分専用の GPT (Actions) が作れない

## 変更
- src/oauth.ts (新規): 最小の OAuth 2.1 (PKCE S256 必須・動的クライアント登録)
  - メタデータ: /.well-known/oauth-protected-resource・/.well-known/oauth-authorization-server
  - 許可の画面: STRIDE のページで ChatGPT 用の鍵を貼って「許可する」(iframe 不可・キャッシュしない)
  - トークン: アクセス 1 時間・更新 30 日 (使うたびに取り替え)・コードは 1 回だけ・10 分
  - トークンは /mcp だけで使える (/gpt・/api には使えない)。ChatGPT 用の鍵を作り直す・止めると全部無効
  - 保存は kv の oauth_* (ハッシュだけ。バックアップには入らない)。期限切れは発行のたびに掃除
- src/mcp.ts: ChatGPT 用の鍵に加えて OAuth のアクセストークンでも使える。鍵なしは 401 と WWW-Authenticate (resource_metadata) を返す。/gpt の入口へは内部で ChatGPT 用の鍵を使う
- src/index.ts: /oauth と /.well-known をつなぐ。wrangler.toml の run_worker_first に追加
- 設定 › 拡張機能: コネクタ (MCP) のつなぎ方と接続先 URL のコピー
- docs/MCP_SETUP.md: OAuth の説明と ChatGPT のコネクタの手順

## 変えていないもの
- COROS・Strava の連携 (Strava の oauth_state も別のキーで触れない)・既存のデータ・/api と APP_TOKEN

## テスト (ローカルで実行)
- oauth: メタデータと 401 の案内／登録 → 許可の画面 → 鍵 → コード → トークン → /mcp／コードの再利用不可／更新で取り替え／/gpt・/api には使えない／鍵を作り直すと無効／鍵違い・PKCE 違い・戻り先違い・plain・許可しない／連携停止中は登録不可
- 全体: 191 件合格・1 件スキップ (known-issues、従来どおり)
