#!/usr/bin/env python3
"""Builds the Second Query website into _site/.

Pages live in src/pages/*.html (front matter + HTML body).
Blog posts live in content/posts/*.md (front matter + Markdown).
Run: python3 build.py
"""
import datetime as dt
import html
import json
import re
import shutil
from pathlib import Path

import markdown

ROOT = Path(__file__).parent
OUT = ROOT / "_site"
SITE = "https://secondquery.com"
EMAIL = "sam@secondquery.com"
BRAND = "Second Query"
INDEXNOW_KEY = "d325655dfe07893a98583443d7d61935"  # public by design: proves to Bing/IndexNow that this site owns its pings

SEARCH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>'
MARK = ('<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="13.5" cy="13.5" r="9.5" fill="none" stroke="currentColor" stroke-width="3"/>'
        '<path d="M21 21l7 7" stroke="#ff2e7e" stroke-width="3.6" stroke-linecap="round"/>'
        '<path d="M10.2 11.4c0-1.9 1.4-3.1 3.3-3.1s3.3 1.1 3.3 2.9c0 2.7-6.6 4.2-6.6 7.4h6.8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>')

NAV = [("services", "/services/", "For businesses"), ("ppc-teams", "/ppc-teams/", "For PPC teams"),
       ("tools", "/tools/", "Free tools"), ("insights", "/insights/", "Insights"), ("about", "/about/", "About")]


def parse_front(text):
    meta, body = {}, text
    if text.startswith("---"):
        _, fm, body = text.split("---", 2)
        key = None
        for line in fm.strip().splitlines():
            if line.startswith("  - ") and key:
                meta.setdefault(key, []).append(line[4:].strip())
                continue
            if ":" in line:
                key, val = line.split(":", 1)
                key, val = key.strip(), val.strip()
                meta[key] = val if val else []
    return meta, body.strip()


def query_bar(q, extra=""):
    return (f'<div class="query" role="img" aria-label="Search: {html.escape(q)}">{SEARCH_ICON}'
            f'<span class="typed">{html.escape(q)}</span><span class="caret"></span>{extra}</div>')


def faq_schema(body):
    qs = re.findall(r"<summary>(.*?)</summary>\s*<div class=\"ans\">(.*?)</div>", body, re.S)
    if not qs:
        return ""
    strip = lambda s: html.unescape(re.sub(r"<[^>]+>", "", s)).strip()
    data = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": strip(q), "acceptedAnswer": {"@type": "Answer", "text": strip(a)}} for q, a in qs]}
    return f'<script type="application/ld+json">{json.dumps(data)}</script>'


def breadcrumb_schema(path, title):
    if path in ("/", "/404"):
        return ""
    items = [{"@type": "ListItem", "position": 1, "name": BRAND, "item": SITE + "/"}]
    if path.startswith("/insights/") and path != "/insights/":
        items.append({"@type": "ListItem", "position": 2, "name": "Insights", "item": SITE + "/insights/"})
    items.append({"@type": "ListItem", "position": len(items) + 1, "name": title, "item": SITE + path})
    return f'<script type="application/ld+json">{json.dumps({"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": items})}</script>'


def person_schema():
    p = {"@context": "https://schema.org", "@type": "Person", "name": "Sam Hitchmough", "jobTitle": "Founder, Second Query",
         "worksFor": {"@id": SITE + "/#business"}, "url": SITE + "/about/",
         "knowsAbout": ["Google Ads", "Microsoft Advertising", "Paid search strategy", "Performance Max", "Smart Bidding"]}
    return f'<script type="application/ld+json">{json.dumps(p)}</script>'


def layout(title, description, path, body, nav_key="", extra_head="", seo_title=""):
    canonical = SITE + path
    full_title = seo_title or (f"{title} | {BRAND}" if title != BRAND else f"{BRAND} - independent Google Ads advice")
    if not seo_title and len(full_title) > 65:
        full_title = title  # long headlines read better in results without the brand suffix
    nav_links = "".join(
        f'<a href="{href}"{" aria-current=page" if key == nav_key else ""}>{label}</a>' for key, href, label in NAV)
    year = dt.date.today().year
    org = {
        "@context": "https://schema.org", "@type": "Organization", "@id": SITE + "/#business", "name": BRAND,
        "url": SITE + "/", "email": EMAIL, "areaServed": {"@type": "Country", "name": "United Kingdom"},
        "logo": SITE + "/static/email-logo.png", "image": SITE + "/static/og-image.png",
        "description": "Independent, senior Google Ads and Microsoft Advertising advice for UK businesses and in-house PPC teams: account reviews, second opinions, workshops and advisory, without account management.",
        "knowsAbout": ["Google Ads", "Microsoft Advertising", "Pay-per-click advertising", "Performance Max", "Smart Bidding", "Paid search strategy"],
        "founder": {"@type": "Person", "name": "Sam Hitchmough", "jobTitle": "Founder", "url": SITE + "/about/"}, "slogan": "A second opinion before your next big Google Ads decision",
        "hasOfferCatalog": {"@type": "OfferCatalog", "name": "Paid search advisory services", "itemListElement": [
            {"@type": "Offer", "name": "Strategy consultation", "price": "295", "priceCurrency": "GBP", "url": SITE + "/services/#consultation"},
            {"@type": "Offer", "name": "Focused Review", "price": "795", "priceCurrency": "GBP", "url": SITE + "/services/#focused"},
            {"@type": "Offer", "name": "Paid Search Decision Review", "price": "1750", "priceCurrency": "GBP", "url": SITE + "/services/#review"},
            {"@type": "Offer", "name": "Strategic advisory (monthly)", "price": "1500", "priceCurrency": "GBP", "url": SITE + "/services/#advisory"}]}}
    site_ld = {"@context": "https://schema.org", "@type": "WebSite", "name": BRAND, "url": SITE + "/", "publisher": {"@id": SITE + "/#business"}}
    return f"""<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(full_title)}</title>
<meta name="description" content="{html.escape(description)}">
<link rel="canonical" href="{canonical}">
<meta property="og:title" content="{html.escape(full_title)}">
<meta property="og:description" content="{html.escape(description)}">
<meta property="og:url" content="{canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{BRAND}">
<meta property="og:locale" content="en_GB">
<meta property="og:image" content="{SITE}/static/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{SITE}/static/og-image.png">
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="{BRAND} insights" href="/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/styles.css">
<script type="application/ld+json">{json.dumps(org)}</script>
<script type="application/ld+json">{json.dumps(site_ld)}</script>
{breadcrumb_schema(path, title)}
{faq_schema(body)}
{extra_head}
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head">
  <div class="wrap">
    <a class="mark" href="/" aria-label="{BRAND} home">{MARK}<span>Second Query<span class="caret"></span></span></a>
    <button class="menu-btn" aria-expanded="false" aria-controls="nav">Menu</button>
    <nav class="nav" id="nav" aria-label="Main">{nav_links}<a class="btn" href="/contact/">Start a brief</a></nav>
  </div>
</header>
<main id="main">
{body}
</main>
<footer class="site-foot">
  <div class="wrap">
    <div class="cols">
      <div>
        <a class="mark" href="/">{MARK}<span>Second Query</span></a>
        <p style="margin-top:14px;max-width:34ch">Independent Google Ads advice for UK businesses and in-house PPC teams, before the decisions that cost the most. Strategy only.</p>
        <p><a href="mailto:{EMAIL}">{EMAIL}</a></p>
      </div>
      <div><h4>For businesses</h4><ul><li><a href="/services/#consultation">Strategy consultation</a></li><li><a href="/services/#focused">Focused Review</a></li><li><a href="/services/#review">Decision Review</a></li><li><a href="/services/#advisory">Strategic advisory</a></li><li><a href="/google-ads-audit/">Google Ads audit</a></li><li><a href="/google-ads-agency-review/">Agency review</a></li></ul></div>
      <div><h4>For PPC teams</h4><ul><li><a href="/ppc-teams/#expert-session">Expert session</a></li><li><a href="/ppc-teams/#second-opinion">Strategy second opinion</a></li><li><a href="/ppc-teams/#workshop">Team workshop</a></li><li><a href="/ppc-teams/#team-advisory">Team advisory</a></li></ul></div>
      <div><h4>Free tools</h4><ul><li><a href="/tools/">Account X-ray</a></li><li><a href="/google-ads-scripts/">Google Ads scripts</a></li><li><a href="/tools/#learning-clock">Learning clock</a></li><li><a href="/insights/">Insights</a></li></ul></div>
      <div><h4>Second Query</h4><ul><li><a href="/approach/">How I work</a></li><li><a href="/about/">About</a></li><li><a href="/contact/">Contact</a></li><li><a href="/privacy/">Privacy notice</a></li></ul></div>
    </div>
    <div class="legal"><span>&copy; {year} Second Query, the trading name of Sam Hitchmough.</span><span>Cookies only with your consent. <a href="/privacy/#cookies" data-cookie-settings>Cookie settings</a></span></div>
  </div>
</footer>
<script src="/static/main.js" defer></script>
<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{{"token": "346c7f733de54d3990c2b51f44a9e8d7"}}'></script>
</body>
</html>
"""


def fmt_date(d):
    return d.strftime("%-d %B %Y")


def load_posts():
    posts = []
    for f in sorted((ROOT / "content/posts").glob("*.md")):
        meta, body = parse_front(f.read_text(encoding="utf-8"))
        if meta.get("draft") == "true":
            continue
        date = dt.date.fromisoformat(meta["date"])
        tags = [t.strip() for t in meta.get("tags", "").split(",") if t.strip()]
        words = len(re.findall(r"\w+", body))
        md = markdown.Markdown(extensions=["extra", "smarty"])
        posts.append({
            "slug": f.stem[11:] if re.match(r"\d{4}-\d{2}-\d{2}-", f.stem) else f.stem,
            "title": meta["title"], "description": meta["description"], "date": date,
            "tags": tags, "sources": meta.get("sources", []) or [], "query": meta.get("query", meta["title"].lower()),
            "updated": dt.date.fromisoformat(meta["updated"]) if meta.get("updated") else None, "seo_title": meta.get("seo_title", ""),
            "html": md.convert(body), "minutes": max(2, round(words / 220))})
    posts.sort(key=lambda p: (p["date"], p["title"]), reverse=True)
    return posts


def post_card(p):
    chips = "".join(f'<span class="chip">{html.escape(t)}</span>' for t in p["tags"])
    return (f'<a class="post-card" href="/insights/{p["slug"]}/" data-tags="{html.escape("|".join(p["tags"]))}">'
            f'<div class="chips">{chips}</div><span class="date">{fmt_date(p["date"])} · {p["minutes"]} min read</span>'
            f'<h3>{html.escape(p["title"])}</h3><p>{html.escape(p["description"])}</p><span class="more">Read the note</span></a>')


def source_list(sources):
    if not sources:
        return ""
    items = []
    for s in sources:
        m = re.match(r"\[(.+?)\]\((.+?)\)", s)
        items.append(f'<li><a href="{html.escape(m.group(2))}" rel="noopener">{html.escape(m.group(1))}</a></li>' if m else f"<li>{html.escape(s)}</li>")
    return f'<section class="sources"><h2>Sources</h2><ul>{"".join(items)}</ul></section>'


def write(path, content):
    target = OUT / path.lstrip("/")
    if path.endswith("/"):
        target = target / "index.html"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def build():
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    shutil.copytree(ROOT / "static", OUT / "static")
    posts = load_posts()
    latest = "".join(post_card(p) for p in posts[:3])
    all_cards = "".join(post_card(p) for p in posts)
    tags = sorted({t for p in posts for t in p["tags"]})
    filters = '<div class="filters" role="group" aria-label="Filter by topic"><button data-tag="all" aria-pressed="true">All</button>' + \
        "".join(f'<button data-tag="{html.escape(t)}" aria-pressed="false">{html.escape(t)}</button>' for t in tags) + "</div>"
    urls = []

    for f in sorted((ROOT / "src/pages").glob("*.html")):
        meta, body = parse_front(f.read_text(encoding="utf-8"))
        body = (body.replace("{{latest_posts}}", latest).replace("{{all_posts}}", all_cards)
                .replace("{{filters}}", filters).replace("{{email}}", EMAIL))
        body = re.sub(r"\{\{query:(.+?)\}\}", lambda m: query_bar(m.group(1)), body)
        body = re.sub(r"\{\{code:([\w./-]+)\}\}", lambda m: '<pre class="code" id="code-' + Path(m.group(1)).stem + '"><code>' +
                      html.escape((ROOT / m.group(1)).read_text(encoding="utf-8")) + '</code></pre>', body)
        path = meta["path"]
        write(path if path != "/404.html" else "404.html",
              layout(meta["title"], meta["description"], path if path != "/404.html" else "/404", body, meta.get("nav", ""),
                     person_schema() if path == "/about/" else "", meta.get("seo_title", "")))
        if path != "/404.html":
            urls.append((path, dt.date.today()))

    for i, p in enumerate(posts):
        newer = posts[i - 1] if i > 0 else None
        older = posts[i + 1] if i + 1 < len(posts) else None
        nav = '<nav class="postnav" aria-label="More notes">' + \
            (f'<a href="/insights/{older["slug"]}/">Older: {html.escape(older["title"])}</a>' if older else "<span></span>") + \
            (f'<a href="/insights/{newer["slug"]}/" style="text-align:right">Newer: {html.escape(newer["title"])}</a>' if newer else "") + "</nav>"
        chips = "".join(f'<span class="chip">{html.escape(t)}</span>' for t in p["tags"])
        article = f"""
<div class="wrap post-head">
  {query_bar(p["query"])}
  <div class="chips" style="margin-top:28px">{chips}</div>
  <h1 style="max-width:22em">{html.escape(p["title"])}</h1>
  <p class="meta">{fmt_date(p["date"])} · {p["minutes"]} min read · Sam Hitchmough</p>
</div>
<div class="wrap band" style="padding-top:20px">
  <div class="post-layout">
    <article class="prose">{p["html"]}{source_list(p["sources"])}{nav}</article>
    <aside class="aside" aria-label="Work with Second Query">
      <h3>Facing this decision?</h3>
      <p>A Decision Review gives you an independent, senior read on your account and a suggested 90-day plan.</p>
      <a class="btn" href="/contact/">Start a brief</a>
      <p style="margin:16px 0 0;font-size:14.5px"><a href="/services/#review">What a Review includes</a></p>
    </aside>
  </div>
</div>"""
        ld = {"@context": "https://schema.org", "@type": "BlogPosting", "headline": p["title"], "description": p["description"],
              "datePublished": p["date"].isoformat(),
              "dateModified": (p.get("updated") or p["date"]).isoformat(), "image": SITE + "/static/og-image.png", "inLanguage": "en-GB",
              "author": {"@type": "Person", "name": "Sam Hitchmough", "url": SITE + "/about/"},
              "publisher": {"@id": SITE + "/#business"}, "mainEntityOfPage": f'{SITE}/insights/{p["slug"]}/'}
        write(f'/insights/{p["slug"]}/', layout(p["title"], p["description"], f'/insights/{p["slug"]}/', article, "insights",
                                                 f'<script type="application/ld+json">{json.dumps(ld)}</script>', p["seo_title"]))
        urls.append((f'/insights/{p["slug"]}/', p["updated"] or p["date"]))

    items = "".join(
        f"""<item><title>{html.escape(p["title"])}</title><link>{SITE}/insights/{p["slug"]}/</link><guid>{SITE}/insights/{p["slug"]}/</guid>
<pubDate>{dt.datetime.combine(p["date"], dt.time(9)).strftime("%a, %d %b %Y %H:%M:%S +0000")}</pubDate><description>{html.escape(p["description"])}</description></item>"""
        for p in posts[:20])
    (OUT / "feed.xml").write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>{BRAND} insights</title><link>{SITE}/insights/</link>
<description>Notes on Google Ads and paid search decisions from Sam Hitchmough.</description><language>en-gb</language>{items}</channel></rss>""", encoding="utf-8")
    (OUT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
                                     "".join(f"<url><loc>{SITE}{u}</loc><lastmod>{d.isoformat()}</lastmod></url>" for u, d in urls) + "</urlset>", encoding="utf-8")
    (OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nSitemap: {SITE}/sitemap.xml\n", encoding="utf-8")
    (OUT / "CNAME").write_text("secondquery.com\n", encoding="utf-8")
    (OUT / f"{INDEXNOW_KEY}.txt").write_text(INDEXNOW_KEY, encoding="utf-8")
    (OUT / ".nojekyll").write_text("", encoding="utf-8")
    print(f"Built {len(urls)} pages and {len(posts)} posts into {OUT}")


if __name__ == "__main__":
    build()
