# Blue Panthers India — website

Source for https://bluepanthers.in — a static site (HTML + CSS + vanilla JS), hosted on GitHub Pages.

## Structure
- `index.html` — the whole site (hero, opportunity, products, process, plant, values, team, contact)
- `assets/css/site.css`, `assets/js/site.js` — styles and behaviour
- `assets/img/` — logo and favicon
- `netlify.toml` — headers, caching, www → apex redirect
- Enquiry form posts to Formspree (`FORM_ENDPOINT` in `assets/js/site.js`)

## Deploy
Work on a branch; merge to `main` only after approval. Every push to `main` deploys automatically via GitHub Pages.

Local preview: `python3 -m http.server 8000` then open http://localhost:8000
