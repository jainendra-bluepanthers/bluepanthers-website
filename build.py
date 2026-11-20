#!/usr/bin/env python3
"""Build the static site.

Each file in src/pages/ starts with a front-matter block:

    ---
    title: Page title
    description: One-sentence meta description
    slug: us-fda            (empty for the home page)
    ---
    <page body html>

It is wrapped in the shared layout and written to <slug>/index.html, so
URLs look like https://bluepanthers.in/us-fda/. Run: python3 build.py
"""
from pathlib import Path
import html
import re

ROOT = Path(__file__).parent
SRC = ROOT / "src" / "pages"
SITE = "https://bluepanthers.in"
COMPANY = "Blue Panthers Manufacturing Private Limited"
EMAIL = "jainendra@bluepanthers.in"

NAV = [
    ("Services", None, [
        ("Process Authority", "/process-authority/"),
        ("Review checklist", "/process-authority/checklist/"),
        ("Food safety & validation", "/food-safety-validation/"),
        ("Regulatory & labelling", "/regulatory-labelling/"),
        ("Product & process development", "/product-process-development/"),
    ]),
    ("Regulatory", None, [
        ("India · FSSAI", "/india-fssai/"),
        ("United States · FDA", "/us-fda/"),
        ("Export markets", "/export-markets/"),
    ]),
    ("Manufacturing", "/manufacturing/", None),
    ("Engagement", "/engagement/", None),
    ("Company", None, [
        ("About", "/about/"),
        ("Team & research profiles", "/team/"),
        ("Partner companies", "/partners/"),
        ("Contact", "/contact/"),
    ]),
]

FOOTER_COLS = [
    ("Regulatory pathways", [
        ("India · FSSAI", "/india-fssai/"),
        ("United States · FDA", "/us-fda/"),
        ("Export markets", "/export-markets/"),
        ("Process Authority", "/process-authority/"),
        ("Review checklist", "/process-authority/checklist/"),
        ("Engagement & fees", "/engagement/"),
    ]),
    ("More", [
        ("Food safety & validation", "/food-safety-validation/"),
        ("Regulatory & labelling", "/regulatory-labelling/"),
        ("Product & process development", "/product-process-development/"),
        ("Manufacturing & ingredients", "/manufacturing/"),
        ("Team & research profiles", "/team/"),
        ("Partner companies", "/partners/"),
    ]),
]


def parse(path):
    text = path.read_text(encoding="utf-8")
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    if not m:
        raise SystemExit(f"{path}: missing front matter")
    meta = {}
    for line in m.group(1).splitlines():
        k, _, v = line.partition(":")
        meta[k.strip()] = v.strip()
    meta["body"] = text[m.end():]
    return meta


def nav_html(current):
    items = []
    for label, href, children in NAV:
        if children:
            active = any(current == c[1] for c in children)
            sub = "".join(
                f'<li><a href="{h}"{" aria-current=page" if current == h else ""}>{html.escape(l)}</a></li>'
                for l, h in children)
            items.append(
                f'<li class="nav-item has-menu"><button class="nav-link" type="button" aria-expanded="false"'
                f'{" aria-current=page" if active else ""}>{label}</button><ul class="menu">{sub}</ul></li>')
        else:
            cur = ' aria-current="page"' if current == href else ""
            items.append(f'<li class="nav-item"><a class="nav-link" href="{href}"{cur}>{label}</a></li>')
    return "".join(items)


def footer_html():
    cols = "".join(
        f'<div><h4>{t}</h4><ul>' + "".join(f'<li><a href="{h}">{html.escape(l)}</a></li>' for l, h in links) + "</ul></div>"
        for t, links in FOOTER_COLS)
    return f"""
<footer class="site-footer">
  <div class="wrap">
    <div class="footer-grid">
      <div class="footer-brand">
        <div class="mark">BP</div>
        <h3>Blue Panthers India</h3>
        <p>Food process, regulatory and manufacturing partner for Indian food and beverage companies serving India, the United States and export markets.</p>
      </div>
      {cols}
      <div>
        <h4>Contact</h4>
        <ul>
          <li><a href="mailto:{EMAIL}">{EMAIL}</a></li>
          <li><a href="/start/">Start a review</a></li>
          <li><a href="/contact/">Contact form</a></li>
          <li>Uttar Pradesh, India<br>Consultations by appointment</li>
        </ul>
      </div>
    </div>
    <div class="footer-legal">
      <p>{COMPANY} is an independent private company. Its services and activities are not provided by, endorsed by, or contracted through the University of British Columbia, the British Columbia Institute of Technology or any other institution with which its personnel may be affiliated. Institutional affiliations are biographical only.</p>
      <p>© 2026 {COMPANY}. General information only; this website is not legal or regulatory advice. Engagements are governed by written terms.</p>
    </div>
  </div>
</footer>"""


def page_html(meta, current):
    title = meta["title"]
    full_title = "Blue Panthers India | Food process, regulatory & manufacturing" if current == "/" else f"{title} | Blue Panthers India"
    desc = html.escape(meta["description"], quote=True)
    url = SITE + current
    return f"""<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(full_title)}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<link rel="icon" type="image/png" href="/assets/img/favicon.png">
<meta name="theme-color" content="#092c46">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Blue Panthers India">
<meta property="og:title" content="{html.escape(full_title, quote=True)}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/assets/img/logo.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/css/site.css">
<script type="application/ld+json">{{"@context":"https://schema.org","@type":"Organization","name":"{COMPANY}","alternateName":"Blue Panthers India","url":"{SITE}/","logo":"{SITE}/assets/img/logo.png","email":"{EMAIL}","address":{{"@type":"PostalAddress","addressRegion":"Uttar Pradesh","addressCountry":"IN"}}}}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="/" aria-label="Blue Panthers India, home">
      <img src="/assets/img/logo.png" alt="" width="46" height="44">
      <span class="brand-name"><strong>Blue Panthers</strong><small>Food Process · India</small></span>
    </a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav" aria-label="Open menu"><span></span><span></span><span></span></button>
    <nav class="nav" id="nav" aria-label="Main">
      <ul>{nav_html(current)}</ul>
      <a class="btn nav-cta" href="/start/">Start a review</a>
    </nav>
  </div>
</header>
<main id="main">
{meta["body"].strip()}
</main>
{footer_html()}
<script src="/assets/js/site.js" defer></script>
</body>
</html>
"""


def main():
    urls = []
    for path in sorted(SRC.glob("*.html")):
        meta = parse(path)
        slug = meta.get("slug", "").strip("/")
        current = "/" + (slug + "/" if slug else "")
        out = ROOT / slug / "index.html" if slug else ROOT / "index.html"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(page_html(meta, current), encoding="utf-8")
        urls.append(current)
        print("built", out.relative_to(ROOT))
    sitemap = ['<?xml version="1.0" encoding="UTF-8"?>',
               '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    sitemap += [f"  <url><loc>{SITE}{u}</loc></url>" for u in sorted(urls)]
    sitemap.append("</urlset>")
    (ROOT / "sitemap.xml").write_text("\n".join(sitemap) + "\n", encoding="utf-8")
    print(f"{len(urls)} pages, sitemap.xml updated")


if __name__ == "__main__":
    main()
