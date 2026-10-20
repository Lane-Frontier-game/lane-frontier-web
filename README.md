# Lane Frontier Web（レーンフロンティア Web対戦版）

オリジナルTCG「レーンフロンティア」のローカルWeb対戦版です。

- 3属性の固定40枚デッキ（火・風・水）
- 1台のPCで交代しながら対戦
- オンライン通信対戦は未実装

## ローカル実行

```bash
npm install
npm run dev
```

## 公開

`.github/workflows/deploy.yml` で `main` へのpush時に GitHub Pages に公開します。
GitHubリポジトリの Settings > Pages > Source を GitHub Actions に設定してください。
Viteの `base` は GitHub Actions 上でリポジトリ名から自動設定します。

詳しい手順は `公開手順.txt` を参照してください。
