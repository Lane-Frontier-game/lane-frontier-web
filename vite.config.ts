import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Actions ではリポジトリ名から Pages の公開パスを自動決定。
// ローカル開発（npm run dev）では / で動作する。
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/').pop()
const isGitHubPagesBuild = process.env.GITHUB_ACTIONS === 'true'
const pagesBase = isGitHubPagesBuild && repositoryName && !repositoryName.endsWith('.github.io')
  ? `/${repositoryName}/`
  : '/'

export default defineConfig({
  plugins: [react()],
  base: pagesBase,
})
