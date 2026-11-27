# Team portal (bluepanthers.in/portal/)

A login page where the team sees where we are on contract manufacturing, raw materials and
plant equipment. It reads the tracker Google Sheets by itself: edit a sheet, and the portal
shows the change within about 15 minutes. Nobody needs to publish anything for that.

The repository is public, so everything committed here is either generic code or encrypted.

## How it works
- `portal/index.html` is the page. It holds no data.
- `portal/keys.json` holds the logins: the team key, locked once per person with their password.
- `portal/data.json` holds the status, encrypted so only the team key opens it.
- `.github/workflows/portal-refresh.yml` runs every 15 minutes. It signs in to Google with
  read-only access (keyless, through Workload Identity Federation), runs `refresh.mjs` to read
  the sheets and rebuild `data.json`, and when something changed commits it and asks Render to
  deploy. It never needs a password.
- Sheet ids live in the `PORTAL_SHEETS` repository secret: `{"cm": "...", "rm": "...", "eq": "...", "hlt": "..."}`.
  Renaming a sheet or moving it to another folder is fine; ids do not change. If a sheet is
  replaced by a new file, update the secret and share the new file (view only) with the
  service account the workflow uses.

## Logins
Who has a login is listed in `portal-src/members.json` (on your computer only, never committed):
`[{"name": "Jainendra", "email": "..."}]`. Then, in the website folder:

| To | Run |
|---|---|
| Set up logins the first time, or add people | `node portal-src/setup-logins.mjs` |
| Give someone a new password | `node portal-src/setup-logins.mjs --reset their@email` |
| Remove someone | delete their line in members.json, then `node portal-src/setup-logins.mjs` |

Passwords are typed in the terminal (hidden) or made for you and shown once; send each person
theirs privately. Then commit and push `portal/keys.json`. Removing someone makes a new team key,
so everyone left types a password again (their current one is fine) and removed logins stop
working once the refresh runs.

## What the page reads from each sheet
- Contract manufacturer tracker, tab Manufacturers: Tier (1 near Bangalore, 2 trials, 3 backup),
  Company, Location, Dryer capacity, Certifications, Stage, Next action, Due, Owner, Notes.
  Tab Dryer sizing gives the small-batch note.
- Raw material tracker, tab Suppliers: Material, Supplier, Location, Type, Certifications,
  Indicative price, Quoted price, Spec fit, Stage, Next action, Due, Owner, Notes.
  Tabs Spec limits and Requirement & cost give the spec table and cost lines.
- Equipment quotation tracker, tab Suppliers & RFQ: Pkg, Supplier, City, RFQ sent, Follow-up,
  Quote received, Price ex-GST, Phase 1 price, Status, Remarks. Tab Equipment List gives the budget.
  Due dates are worked out: the "reply by" date in Remarks, else 7 days after the last contact;
  drafts not yet sent are due now. Add a "Next follow-up" or "Next action" column to set them yourself.
- High level tracker, tabs Quotes in hand (equipment rows) and Key dates.

Columns are found by their header names, so moving or adding columns is fine; renaming a header
or a tab above stops that part from showing.

## Test locally
`node portal-src/refresh.mjs --fixture sheets.json --print` builds the status from a saved copy of
the sheets without Google. Preview: `python3 -m http.server 8000`, open http://localhost:8000/portal/.
