# デプロイチェックリスト — blog.kaseken.dev

## コンテンツ

- [ ] **最初の実記事を1件追加する**（`hello-world.md` はテスト用なので差し替える）
  - frontmatterに `tags` を設定してタグ機能の動作確認をする

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
