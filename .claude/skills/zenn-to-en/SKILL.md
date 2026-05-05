---
name: zenn-to-en
description: Translate a Zenn article (Japanese) to English and convert it to an Astro blog post. Use when the user wants to port a Zenn article to this blog.
---

Arguments: `<file-path> <zenn-url>`
- `<file-path>`: local path to the copied Zenn markdown file
- `<zenn-url>`: Zenn article URL (e.g. `https://zenn.dev/username/articles/slug`)

1. Read the source file at `<file-path>`
2. Fetch tags from the Zenn API: `https://zenn.dev/api/articles/<slug>` — extract `.article.topics[].name`
3. Download Zenn CDN images (`storage.googleapis.com/zenn-user-upload/`) to `public/images/<article-slug>/`
4. Translate section by section (`##` headings), converting Zenn syntax as you go:
   - `:::message` → `> **Note:** ...`
   - `:::message alert` → `> **Warning:** ...`
   - `^[text]` → `[^n]` inline + `[^n]: text` at end of file
   - Bare GitHub/YouTube URLs → labeled markdown links
   - `![](zenn-url)` *caption* → `![caption](/images/<article-slug>/<name>.png)`
   - Remove leading `# Title` (goes into frontmatter)
   - Translate Japanese code comments to English
5. Write to the same relative path under `src/content/` with frontmatter and a Japanese version note at the top of the body:

```yaml
---
title: ""
description: ""
pubDate: YYYY-MM-DD
tags: []  # populated from Zenn API
---
```

```markdown
> **Japanese version:** This article is also available in Japanese on [Zenn](<zenn-url>).
```
