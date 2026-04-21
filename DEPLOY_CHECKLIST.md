# デプロイチェックリスト — blog.kaseken.dev

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
