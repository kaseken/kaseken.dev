# デプロイチェックリスト — blog.kaseken.dev

## コンテンツ

- [ ] **最初の実記事を1件追加する**（`hello-world.md` はテスト用なので差し替える）
  - frontmatterに `tags` を設定してタグ機能の動作確認をする

---

## GitHub

- [ ] リポジトリを作成して `main` に push する
- [ ] Settings → Pages → Source を **GitHub Actions** に変更する
- [ ] Actions が成功することを確認する

---

## カスタムドメイン

- [ ] Settings → Pages → Custom domain に `blog.kaseken.dev` を設定する
- [x] DNS に CNAME レコードを追加する（`blog.kaseken.dev` → `kaseken.github.io`）✓ 設定済み
- [ ] `public/CNAME` ファイルに `blog.kaseken.dev` を記載する

---

## 最終動作確認

- [ ] トップページ・記事詳細・タグページが表示される
- [ ] コードブロックにシンタックスハイライトが適用されている
- [ ] RSS フィード (`/rss.xml`) が配信されている
- [ ] OGP 確認（[opengraph.xyz](https://www.opengraph.xyz/)）
- [ ] モバイル表示の確認
