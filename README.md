# Lane Frontier Web（レーンフロンティア Web対戦版）

レーンフロンティアのWeb対戦版です。

- 火・風・水の固定40枚デッキ
- 1台で交代して遊ぶローカル対戦
- Firebase Realtime Databaseを使用したオンライン対戦
- カード画像、背景素材、マリガン演出などを含む

## ローカル起動

```bash
npm install
npm run dev
```

## GitHub Pages 公開

`.github/workflows/main.yml` により、GitHubの `main` ブランチへpushするとViteのビルドとPages公開が自動実行されます。
GitHub リポジトリの `Settings → Pages → Build and deployment → Source` で `GitHub Actions` を選択してください。

`vite.config.ts` はGitHub Actions上のリポジトリ名から公開用の `base` を設定します。
Firebaseを使用する場合はRealtime Databaseのルールと認証・権限の適切な管理が必要です。

公開バージョン表示: v0.20.1
