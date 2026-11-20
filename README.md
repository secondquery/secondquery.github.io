# Second Query website

Source for [secondquery.com](https://secondquery.com), the website of Second Query (Sam Hitchmough), independent paid search advice for UK businesses.

## How it works

- `src/pages/*.html` are the site pages. Each starts with a small front-matter block (title, description, path, nav).
- `content/posts/*.md` are the Insights posts, one Markdown file per post, named `YYYY-MM-DD-slug.md`.
- `static/` holds the stylesheet, script and favicon.
- `build.py` turns all of that into a static site in `_site/` (pages, posts, RSS feed, sitemap).
- `.github/workflows/pages.yml` builds and deploys to GitHub Pages on every push to `main`.

Build locally:

```
pip install markdown
python3 build.py
python3 -m http.server -d _site
```

## Adding a post

Create `content/posts/YYYY-MM-DD-short-slug.md`:

```
---
title: Plain, specific headline
description: One or two sentences for cards and search results.
date: YYYY-MM-DD
tags: Tag one, Tag two
query: the search a reader might type
sources:
  - [Source title (Publisher, date)](https://example.com)
---
Body in Markdown.
```

Add `draft: true` to keep a post out of the build. See `docs/weekly-post-guide.md` for the voice and rules used for the weekly notes.
