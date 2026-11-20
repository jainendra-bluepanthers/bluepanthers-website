# Blue Panthers India — website

Source for https://bluepanthers.in — a static site (HTML + CSS + GSAP), hosted on Netlify.

## Structure
- `index.html` — the whole site (home, products, plant & quality, team, contact)
- `assets/img/` — logo, favicon and product images
- `netlify.toml` — headers, caching, www → apex redirect
- Enquiry form posts to Formspree (`FORM_ENDPOINT` in `index.html`)

## Deploy
Every push to `main` deploys automatically via Netlify.

Local preview: `python3 -m http.server 8000` then open http://localhost:8000
