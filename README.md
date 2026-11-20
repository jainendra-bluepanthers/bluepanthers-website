# Blue Panthers India — website

Source for https://bluepanthers.in — a static site (HTML + CSS + vanilla JS), hosted on Render.

## Structure
- `src/pages/*.html` — page content (front matter: title, description, slug)
- `build.py` — wraps each page in the shared header/nav/footer and writes `<slug>/index.html` + `sitemap.xml`
- `assets/css/site.css`, `assets/js/site.js` — styles, menus, forms (Formspree endpoint in site.js)
- `assets/img/` — logo and favicon

**Edit pages in `src/pages/`, then run `python3 build.py`.** Never edit the generated `*/index.html` files directly.

## Deploy
Work on a branch; merge to `main` only after approval. `main` is deployed by Render (static site `bluepanthers-website`, publish dir `./`, no build step — run `python3 build.py` locally and commit the output).

Local preview: `python3 -m http.server 8000` then open http://localhost:8000
