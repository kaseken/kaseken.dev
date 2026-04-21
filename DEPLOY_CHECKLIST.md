# デプロイチェックリスト — blog.kaseken.dev

## サイト情報の書き換え

- [ ] **favicon** を差し替える
  - `public/favicon.svg` — SVG版（ブラウザタブ・ブックマーク）
  - `public/favicon.ico` — ICO版（旧ブラウザ向け）
- [ ] **`src/consts.ts`** のディスクリプションを最終確認
  - 現状: `'技術メモ・学びの記録'`

## About ページ (`src/pages/about.astro`)

- [ ] Lorem ipsumプレースホルダーテキストを自己紹介に書き換える
- [ ] `heroImage` をプレースホルダー画像から差し替える
  - 現状: `src/assets/blog-placeholder-about.jpg`
- [ ] `pubDate={new Date('August 08 2021')}` を削除またはブログ開設日に変更する

## コンテンツ

- [ ] **最初の実記事を1件追加する**（空サイトのままデプロイしない）
  - frontmatterに `tags` を設定してタグ機能の動作確認をする

---

## アセット

- [ ] **デフォルトOGP画像を用意する**
  - 現状: `src/assets/blog-placeholder-1.jpg` がフォールバックとして使われている
- [ ] **未使用のプレースホルダー画像を削除する**
  - `src/assets/blog-placeholder-*.jpg`

---

## GitHub

- [ ] 変更を commit して `main` にプッシュする

---

## Cloudflare

- [ ] ビルド設定を確認:
  - **Build command**: `pnpm build`
  - **Deploy command**: `npx wrangler deploy`
- [ ] 環境変数: `NODE_VERSION` = `22`
- [ ] デプロイ成功を確認
- [ ] カスタムドメイン `blog.kaseken.dev` の設定

---

## 最終動作確認

- [ ] トップページ・記事詳細・タグページが表示される
- [ ] コードブロックにシンタックスハイライトが適用されている
- [ ] RSS フィード (`/rss.xml`) が配信されている
- [ ] OGP 確認（[opengraph.xyz](https://www.opengraph.xyz/)）
- [ ] モバイル表示の確認
