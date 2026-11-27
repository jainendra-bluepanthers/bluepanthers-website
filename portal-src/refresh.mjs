#!/usr/bin/env node
// Team portal refresh: reads the tracker Google Sheets (read-only), builds the status the portal
// shows, encrypts it for the team (public key only, no passwords needed) and writes
// portal/data.json, but only when something changed.
//
// Runs in GitHub Actions (.github/workflows/portal-refresh.yml) every 15 minutes.
//   GOOGLE_ACCESS_TOKEN  read-only Sheets token (from keyless Workload Identity sign-in)
//   PORTAL_SHEETS        JSON {"cm": id, "rm": id, "eq": id, "hlt": id} (repository secret)
// Local test without Google:  node portal-src/refresh.mjs --fixture sheets.json [--print]
//
// The repository is public: this file must stay generic. Names, prices and specs only ever
// come from the sheets and only leave this script encrypted. Logs show counts, never content.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sealForTeam, sha256hex } from './lib.mjs';

const SRC = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SRC, '..');
const KEYS = process.env.PORTAL_KEYS_FILE || join(ROOT, 'portal', 'keys.json');
const OUT = process.env.PORTAL_DATA_FILE || join(ROOT, 'portal', 'data.json');
const argv = process.argv.slice(2);
const opt = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const FIXTURE = opt('--fixture');
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const log = (...a) => console.log(...a);

// Tabs read from each sheet.
const TABS = {
  cm: ['Manufacturers', 'Dryer sizing'],
  rm: ['Suppliers', 'Spec limits', 'Requirement & cost'],
  eq: ['Suppliers & RFQ', 'Equipment List'],
  hlt: ['Quotes in hand', 'Key dates'],
};
// Columns whose dropdown order sets the stage order (header name per tab).
const STAGE_COL = { cm: ['Manufacturers', 'Stage'], rm: ['Suppliers', 'Stage'], eq: ['Suppliers & RFQ', 'Status'] };

// ---------------------------------------------------------------- reading
let SHEETS = {};
if (!FIXTURE) {
  try { SHEETS = JSON.parse(process.env.PORTAL_SHEETS || readFileSync(join(SRC, 'sheets.json'), 'utf8')); }
  catch { fail('Sheet ids missing: set the PORTAL_SHEETS secret (or portal-src/sheets.json locally).'); }
  if (process.env.GITHUB_ACTIONS) for (const id of Object.values(SHEETS)) console.log(`::add-mask::${id}`);
  if (!process.env.GOOGLE_ACCESS_TOKEN) fail('GOOGLE_ACCESS_TOKEN is not set.');
}
function fail(msg) { console.error(`::error::${msg}`); process.exit(1); }

async function gget(path) {
  const r = await fetch(`${API}/${path}`, { headers: { Authorization: `Bearer ${process.env.GOOGLE_ACCESS_TOKEN}` } });
  if (!r.ok) {
    let m = ''; try { m = (await r.json()).error?.message || ''; } catch { /* ignore */ }
    throw new Error(`Sheets API ${r.status}${m ? `: ${m}` : ''}`);
  }
  return r.json();
}
const q = t => `'${t.replace(/'/g, "''")}'`;
const colA1 = i => { let s = ''; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

async function readBook(key) {
  const id = SHEETS[key];
  if (!id) throw new Error(`no id for "${key}"`);
  const meta = await gget(`${id}?fields=sheets.properties.title`);
  const titles = new Set(meta.sheets.map(s => s.properties.title));
  const tabs = TABS[key].filter(t => titles.has(t));
  for (const t of TABS[key]) if (!titles.has(t)) log(`warning: ${key}: tab "${t}" not found`);
  const book = { tabs: {}, options: {} };
  if (!tabs.length) return book;
  const ranges = tabs.map(t => `ranges=${encodeURIComponent(q(t))}`).join('&');
  const v = await gget(`${id}/values:batchGet?${ranges}&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`);
  tabs.forEach((t, i) => { book.tabs[t] = v.valueRanges[i].values || []; });
  const sc = STAGE_COL[key];
  if (sc && book.tabs[sc[0]]) {
    const tb = table(book.tabs[sc[0]], [sc[1]]);
    if (tb && tb.col(sc[1]) >= 0) {
      const cell = `${q(sc[0])}!${colA1(tb.col(sc[1]))}${tb.at + 2}`;
      try {
        const g = await gget(`${id}?ranges=${encodeURIComponent(cell)}&fields=sheets.data.rowData.values.dataValidation`);
        const dv = g.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.dataValidation?.condition;
        if (dv?.type === 'ONE_OF_LIST') book.options[sc[0]] = { [sc[1]]: dv.values.map(x => x.userEnteredValue) };
      } catch { /* order falls back to first appearance */ }
    }
  }
  return book;
}

// ---------------------------------------------------------------- helpers
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Find the header row (first 15 rows) that has every name in `must`; returns column lookups. */
function table(rows, must) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const h = (rows[i] || []).map(norm);
    const find = name => { const n = norm(name); let c = h.indexOf(n); if (c < 0) c = h.findIndex(x => x && x.startsWith(n)); return c; };
    if (must.every(m => find(m) >= 0)) {
      return { at: i, col: find, body: rows.slice(i + 1).filter(r => r && r.some(v => String(v ?? '').trim() !== '')) };
    }
  }
  return null;
}
const cell = (r, c) => (c >= 0 && r[c] != null ? r[c] : '');
const str = v => (v == null ? '' : typeof v === 'number' ? String(+v.toFixed(6)) : String(v).trim());
const num = v => (typeof v === 'number' ? v : (() => { const s = String(v ?? '').replace(/[₹,\s]/g, ''); return /^-?\d+(\.\d+)?$/.test(s) ? +s : null; })());
const inr = n => `₹${Math.round(n).toLocaleString('en-IN')}`;
const cut = (s, n = 220) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

const NOW = new Date();
const TODAY = new Date(NOW.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10); // India time
const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const isoOf = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 ? t.toISOString().slice(0, 10) : ''; };
const addDays = (iso, n) => (iso ? new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10) : '');
/** Year for a date written without one: the one that puts it nearest to `ref`. */
function nearYear(m, d, ref) {
  const y = +(ref || TODAY).slice(0, 4);
  const opts = [y - 1, y, y + 1].map(yy => isoOf(yy, m, d)).filter(Boolean);
  return opts.sort((a, b) => Math.abs(Date.parse(a) - Date.parse(ref || TODAY)) - Math.abs(Date.parse(b) - Date.parse(ref || TODAY)))[0] || '';
}
/** Sheet value -> ISO date ('' if it is not a date). Handles serial numbers and common written forms. */
function toISO(v, ref) {
  if (typeof v === 'number') return v > 20000 && v < 80000 ? new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5).toISOString().slice(0, 10) : '';
  const s = String(v ?? '').trim().replace(/^(after|by|before|on|due)\s+/i, '');
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return isoOf(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/))) return isoOf(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([A-Za-z]{3})[A-Za-z]*\.?,?(?:[\s-]+(\d{4}))?\b/)) && MON[m[2].toLowerCase()])
    return m[3] ? isoOf(+m[3], MON[m[2].toLowerCase()], +m[1]) : nearYear(MON[m[2].toLowerCase()], +m[1], ref);
  if ((m = s.match(/^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),?(?:\s+(\d{4}))?\b/)) && MON[m[1].toLowerCase()])
    return m[3] ? isoOf(+m[3], MON[m[1].toLowerCase()], +m[2]) : nearYear(MON[m[1].toLowerCase()], +m[2], ref);
  return '';
}
const maxISO = (...a) => a.filter(Boolean).sort().pop() || '';

/** Stage order: the column's dropdown list if we have it, then any other values seen, closed ones last. */
function stageOrder(listed, seen) {
  const out = [...(listed || [])];
  for (const s of seen) if (s && !out.includes(s)) out.push(s);
  const last = out.filter(s => /^(rejected|no response)$/i.test(s));
  return [...out.filter(s => !last.includes(s)), ...last];
}

// ---------------------------------------------------------------- vertical 1: contract manufacturers
const TIERS = { 1: 'Near Bangalore: small runs', 2: 'Trial and process proving', 3: 'Backup: larger plants further away', 4: 'Not tiered yet' };
// Tier column: "1: ...", "2: ...", "3: ..." (older sheets used A = backup, B = near Bangalore, C = trial).
function tierOf(v) {
  const s = str(v);
  const m = s.match(/^\s*(?:tier\s*)?([123])\b/i);
  if (m) return +m[1];
  const l = s.match(/^([ABC])\b/i);
  return l ? { A: 3, B: 1, C: 2 }[l[1].toUpperCase()] : 4;
}
function buildCM(book) {
  const t = table(book.tabs.Manufacturers || [], ['Company', 'Stage']);
  if (!t) return { rows: [], stages: [], note: '' };
  const c = n => t.col(n);
  const rows = t.body.filter(r => str(cell(r, c('Company')))).map(r => {
    const tier = tierOf(cell(r, c('Tier')));
    return {
      co: str(cell(r, c('Company'))), tier, tierName: TIERS[tier], loc: str(cell(r, c('Location'))),
      cap: str(cell(r, c('Dryer capacity'))), cert: str(cell(r, c('Certifications'))),
      stage: str(cell(r, c('Stage'))) || 'Identified', act: str(cell(r, c('Next action'))),
      due: toISO(cell(r, c('Due'))), owner: str(cell(r, c('Owner'))), notes: str(cell(r, c('Notes'))),
    };
  }).sort((a, b) => a.tier - b.tier);
  const stages = stageOrder(book.options.Manufacturers?.Stage, rows.map(r => r.stage));
  // Small-batch sizing from the "Dryer sizing" tab, if its inputs are there.
  let note = '';
  const sz = book.tabs['Dryer sizing'] || [];
  const val = re => { const r = sz.find(x => re.test(str(x?.[0]))); return r ? num(r[1]) : null; };
  const water = val(/^water evaporated per kg/i), yieldPerKg = val(/produced per kg/i);
  if (water && yieldPerKg) {
    const batch = 10, evap = water * batch;
    note = `Small-batch sizing: a ${batch} kg batch needs about ${Math.round(batch / yieldPerKg)} kg of seed and evaporates about `
      + `${(evap / 1000).toFixed(1)} t of water, about ${Math.round(evap / 100)} hours on a 100 kg/h dryer.`;
  }
  return { rows, stages, note };
}

// ---------------------------------------------------------------- vertical 2: raw materials
function buildRM(book) {
  const t = table(book.tabs.Suppliers || [], ['Material', 'Supplier', 'Stage']);
  const rows = !t ? [] : t.body.filter(r => str(cell(r, t.col('Supplier')))).map(r => {
    const c = n => cell(r, t.col(n));
    const qp = c('Quoted price'), lp = c('Indicative price');
    return {
      mat: str(c('Material')), co: str(c('Supplier')), loc: str(c('Location')), type: str(c('Type')),
      cert: str(c('Certifications')),
      listing: typeof lp === 'number' ? `${inr(lp)}/kg` : str(lp),
      quote: typeof qp === 'number' ? `${inr(qp)}/kg` : str(qp),
      fit: str(c('Spec fit')), stage: str(c('Stage')) || 'Identified', act: str(c('Next action')),
      due: toISO(c('Due')), owner: str(c('Owner')), notes: str(c('Notes')),
    };
  });
  const stages = stageOrder(book.options.Suppliers?.Stage, rows.map(r => r.stage));
  const sp = table(book.tabs['Spec limits'] || [], ['Material']);
  const spec = !sp ? [] : sp.body.filter(r => str(cell(r, sp.col('Material'))) && str(cell(r, 1)))
    .map(r => ({ mat: str(cell(r, sp.col('Material'))), id: str(cell(r, sp.col('Identity'))), lim: str(cell(r, sp.col('Key limits'))) }))
    .filter(x => x.lim);
  const firstNum = r => r.slice(1).map(num).find(x => x != null);
  const cost = (book.tabs['Requirement & cost'] || []).filter(r => /^raw materials per kg/i.test(str(r?.[0])) && firstNum(r) != null)
    .map(r => `${str(r[0])}: ${inr(firstNum(r))}`);
  return { rows, stages, spec, cost };
}

// ---------------------------------------------------------------- vertical 3: equipment RFQs
const EQ_ACT = {
  'not contacted': 'Send the RFQ', 'draft ready': 'Send the drafted RFQ', 'follow-up drafted': 'Send the drafted follow-up',
  'rfq sent': 'Wait for the reply; follow up if none', 'follow-up sent': 'No reply yet: call them',
  clarification: 'Close the open questions; get the final quote', 'quote received': 'Check the quote against spec and budget',
  shortlisted: 'Negotiate and confirm', ordered: '', 'no response': '', rejected: '',
};
function buildEQ(book) {
  const t = table(book.tabs['Suppliers & RFQ'] || [], ['Pkg', 'Supplier', 'Status']);
  const rows = !t ? [] : t.body.filter(r => str(cell(r, t.col('Supplier')))).map(r => {
    const c = n => cell(r, t.col(n));
    const stage = str(c('Status')) || 'Not contacted', k = stage.toLowerCase();
    const sent = toISO(c('RFQ sent')), fu = toISO(c('Follow-up')), qr = toISO(c('Quote received'));
    const last = maxISO(sent, fu, qr), remarks = str(c('Remarks'));
    const price = num(c('Price ex-GST')), p1 = num(c('Phase 1'));
    // Due: an explicit "Next follow-up" column wins; else "reply by <date>" in the remarks; else 7 days after the last contact.
    let due = '', now = false;
    const rb = remarks.match(/reply by\s+(\d{1,2}\s+[A-Za-z]{3,9}(?:\s+\d{4})?)/i);
    if (/^(draft ready|follow-up drafted)$/.test(k)) now = true;
    else if (/^(rfq sent|follow-up sent)$/.test(k)) { const d = rb ? toISO(rb[1], last || TODAY) : ''; due = d && d > last ? d : addDays(last, 7); }
    else if (/^(clarification|quote received|shortlisted)$/.test(k)) due = addDays(last, 7);
    const nf = toISO(c('Next follow-up'));
    if (nf) { due = nf; now = false; }
    const route = str(c('Contact route'));
    const act = str(c('Next action')) || (k === 'not contacted' && route ? `Send the RFQ (${route.toLowerCase()})` : EQ_ACT[k] ?? '');
    return {
      pkg: str(c('Pkg')), pkgName: str(c('Package')), co: str(c('Supplier')), city: str(c('City')), stage,
      last, lastNote: cut(remarks), act, due, now,
      price: [price ? `${inr(price)} ex-GST` : '', p1 ? `Phase 1: ${inr(p1)}` : ''].filter(Boolean).join(' · '),
      priced: !!(price || p1), sent: !!sent,
    };
  });
  const stages = stageOrder(book.options['Suppliers & RFQ']?.Status, rows.map(r => r.stage));
  // Packages and budget: "Equipment List" (budget in INR lakh), counts worked out like the "Quote Comparison" tab.
  const el = table(book.tabs['Equipment List'] || [], ['Pkg', 'Package']);
  const pk = new Map();
  if (el) for (const r of el.body) {
    const k = str(cell(r, el.col('Pkg'))); if (!/^P\d+/i.test(k)) continue;
    pk.set(k, { k, n: str(cell(r, el.col('Package'))), budget: num(cell(r, el.col('Budget'))) });
  }
  for (const r of rows) if (r.pkg && !pk.has(r.pkg)) pk.set(r.pkg, { k: r.pkg, n: r.pkgName, budget: null });
  const packages = [...pk.values()].sort((a, b) => a.k.localeCompare(b.k, 'en', { numeric: true })).map(p => {
    const R = rows.filter(r => r.pkg === p.k);
    const prices = (t ? t.body : []).filter(r => str(cell(r, t.col('Pkg'))) === p.k).map(r => num(cell(r, t.col('Price ex-GST')))).filter(x => x > 0);
    return { ...p, suppliers: R.length, contacted: R.filter(r => r.sent).length, priced: prices.length,
      low: prices.length ? +(Math.min(...prices) / 1e5).toFixed(2) : null };
  });
  return { rows, stages, packages };
}

// ---------------------------------------------------------------- overview sheet: quotes in hand, key dates
function buildHLT(book) {
  const qt = table(book.tabs['Quotes in hand'] || [], ['Vertical', 'Item', 'Company']);
  const quotes = !qt ? [] : qt.body.filter(r => /^equipment/i.test(str(cell(r, qt.col('Vertical'))))).map(r => {
    const c = n => str(cell(r, qt.col(n)));
    const p = cell(r, qt.col('Price'));
    return { item: c('Item'), co: c('Company'), price: typeof p === 'number' ? inr(p) : str(p), basis: c('Basis'), cmp: c('Compare'), date: c('Date'), note: c('Status') };
  });
  const kd = table(book.tabs['Key dates'] || [], ['Date', 'What']);
  const key = !kd ? [] : kd.body.map(r => {
    const raw = cell(r, kd.col('Date'));
    const d = toISO(raw), label = typeof raw === 'number' ? '' : str(raw);
    return { d, label: d && /^\d{1,2}\s+[A-Za-z]{3}[a-z]*\s+\d{4}$|^\d{4}-/.test(label) ? '' : label, s: str(cell(r, kd.col('What'))), v: str(cell(r, kd.col('Vertical'))) };
  }).filter(k => k.s && !/^buyers?$/i.test(k.v)).sort((a, b) => (a.d || '9').localeCompare(b.d || '9'));
  return { quotes, key };
}

// ---------------------------------------------------------------- daily progress (outreach and quotes by date)
// Rebuilt on every run from dates already in the sheets: the RFQ sent / Follow-up / Quote received
// columns, and notes written as "27 Nov: follow-up sent" or "Enquiry sent 25 Nov". Only daily counts
// per vertical leave this function; company names and note text do not.
const MON_RE = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec';
const THEIRS = /\b(received|replied|acknowledg\w*|confirmed|apologi[sz]ed|promised|quoted|answered)\b|\bsent (?:the |a |an |their |us )?(?:basis|bod|sheet|offer|quote|quotation|proposal|sample|price|catalogue|brochure|coa)/i;
const kindOf = desc => {
  const s = desc.toLowerCase();
  if (/not received|no reply|awaiting|drafted|reply by/.test(s) && !/\bsent\b/.test(s.replace(/reply by.*$/, ''))) return '';
  if (THEIRS.test(s) && !/not received/.test(s)) return 'reply';
  if (/\b(sent|resent|emailed)\b/.test(s)) return /follow|remind|chase|resen|again/.test(s) ? 'followup' : 'sent';
  return '';
};
function textEvents(text, ref) {
  const out = [];
  const seg = new RegExp(`(?:^|[|;.]\\s*)(\\d{1,2}\\s+(?:${MON_RE})[a-z]*(?:\\s+\\d{4})?)\\s*:\\s*([^|]*)`, 'gi');
  for (const m of String(text || '').matchAll(seg)) {
    const d = toISO(m[1], ref), k = kindOf(m[2]);
    if (d && k) out.push({ d, k, quote: k === 'reply' && /quot|offer|proposal|price/i.test(m[2]) });
  }
  const verb = new RegExp(`\\b(sent|received|replied|acknowledged)\\s+(?:on\\s+)?(\\d{1,2}\\s+(?:${MON_RE})[a-z]*(?:\\s+\\d{4})?)`, 'gi');
  for (const m of String(text || '').matchAll(verb)) {
    const d = toISO(m[2], ref), k = /sent/i.test(m[1]) ? 'sent' : 'reply';
    if (d) out.push({ d, k, quote: false });
  }
  return out;
}
function buildProgress(raw) {
  // raw: [{v, co, texts: [...], cols: [{d, k, quote}]}]
  const seen = new Set(), ev = [];
  for (const r of raw) {
    for (const e of [...r.cols, ...r.texts.flatMap(t => textEvents(t))]) {
      if (!e.d || e.d > TODAY) continue;
      const key = `${r.v}|${r.co}|${e.d}|${e.k}`;
      if (seen.has(key)) { if (e.quote) ev.find(x => x.key === key).quote = true; continue; }
      seen.add(key); ev.push({ key, v: r.v, d: e.d, k: e.k, quote: e.quote });
    }
  }
  const days = new Map();
  const day = d => { if (!days.has(d)) days.set(d, { d, cm: { sent: 0, followup: 0, reply: 0 }, rm: { sent: 0, followup: 0, reply: 0 }, eq: { sent: 0, followup: 0, reply: 0 }, quotes: 0 }); return days.get(d); };
  for (const e of ev) { const x = day(e.d); x[e.v][e.k] += 1; if (e.quote) x.quotes += 1; }
  return [...days.values()].sort((a, b) => a.d.localeCompare(b.d));
}
/** Equipment packages priced over time: the first date each package got a price. */
function pricedTimeline(eqBook) {
  const t = table(eqBook.tabs['Suppliers & RFQ'] || [], ['Pkg', 'Supplier', 'Status']);
  if (!t) return [];
  const first = new Map();
  for (const r of t.body) {
    const pkg = str(cell(r, t.col('Pkg'))), d = toISO(cell(r, t.col('Quote received')));
    const priced = num(cell(r, t.col('Price ex-GST'))) || num(cell(r, t.col('Phase 1')));
    if (pkg && d && priced && (!first.has(pkg) || d < first.get(pkg))) first.set(pkg, d);
  }
  return [...first.values()].sort();
}

// ---------------------------------------------------------------- main
const books = {};
if (FIXTURE) Object.assign(books, JSON.parse(readFileSync(FIXTURE, 'utf8')));
else {
  for (const k of Object.keys(TABS)) {
    try { books[k] = await readBook(k); } catch (e) { fail(`Could not read the "${k}" sheet: ${e.message}`); }
  }
}
const cm = buildCM(books.cm || { tabs: {}, options: {} });
const rm = buildRM(books.rm || { tabs: {}, options: {} });
const eq = buildEQ(books.eq || { tabs: {}, options: {} });
const hl = buildHLT(books.hlt || { tabs: {}, options: {} });
if (!cm.rows.length && !rm.rows.length && !eq.rows.length) fail('No rows found in any tracker: not publishing an empty portal.');

// Raw dated activity per company for the progress charts.
const raw = [];
for (const [v, key, tab, must, textCols] of [
  ['cm', 'cm', 'Manufacturers', ['Company', 'Stage'], ['Next action', 'Notes']],
  ['rm', 'rm', 'Suppliers', ['Material', 'Supplier', 'Stage'], ['Next action', 'Notes']],
  ['eq', 'eq', 'Suppliers & RFQ', ['Pkg', 'Supplier', 'Status'], ['Remarks', 'Next action']],
]) {
  const t = table(books[key]?.tabs?.[tab] || [], must);
  if (!t) continue;
  const coCol = v === 'cm' ? 'Company' : 'Supplier';
  for (const r of t.body) {
    const co = str(cell(r, t.col(coCol))); if (!co) continue;
    const cols = v !== 'eq' ? [] : [
      { d: toISO(cell(r, t.col('RFQ sent'))), k: 'sent', quote: false },
      { d: toISO(cell(r, t.col('Follow-up'))), k: 'followup', quote: false },
      { d: toISO(cell(r, t.col('Quote received'))), k: 'reply', quote: true },
    ].filter(e => e.d);
    raw.push({ v, co: v === 'rm' ? `${co}|${str(cell(r, t.col('Material')))}` : `${co}|${str(cell(r, t.col('Pkg')))}`,
      texts: textCols.map(c => (t.col(c) >= 0 ? str(cell(r, t.col(c))) : '')), cols });
  }
}
const activity = buildProgress(raw);
const pricedDates = pricedTimeline(books.eq || { tabs: {} });

const open = r => !/^(rejected|no response)$/i.test(r.stage);
const tierN = n => cm.rows.filter(r => r.tier === n).length;
const budget = eq.packages.reduce((a, p) => a + (p.budget || 0), 0);
const mats = new Set(rm.rows.map(r => r.mat).filter(Boolean));
const summary = {
  cm: `${cm.rows.length} plants listed: ${tierN(1)} near Bangalore for small runs, ${tierN(2)} for trial runs, ${tierN(3)} as backup. `
    + `${cm.rows.filter(r => open(r) && r.stage !== (cm.stages[0] || 'Identified')).length} contacted so far.`,
  rm: `${rm.rows.length} suppliers across ${mats.size} materials: ${rm.rows.filter(r => open(r) && !/^(identified|drafted)$/i.test(r.stage)).length} contacted, `
    + `${rm.rows.filter(r => r.quote).length} written quotes so far.`,
  eq: `${eq.rows.length} suppliers across ${eq.packages.length} packages: ${eq.rows.filter(r => r.sent).length} RFQs sent, `
    + `${eq.rows.filter(r => r.priced).length} prices in hand.${budget ? ` Budget ₹${(budget / 100).toFixed(2)} Cr ex-GST.` : ''}`,
};
const links = FIXTURE ? {} : Object.fromEntries(Object.entries(SHEETS).map(([k, id]) => [k, `https://docs.google.com/spreadsheets/d/${id}/edit`]));

const status = {
  cm: cm.rows, rm: rm.rows, eq: eq.rows, packages: eq.packages, quotes: hl.quotes, key: hl.key,
  stages: { cm: cm.stages, rm: rm.stages, eq: eq.stages }, notes: { cm: cm.note, rm: rm.cost }, spec: rm.spec,
  summary, links,
  progress: { activity, priced: pricedDates, pkgTotal: eq.packages.length },
};
const h = sha256hex(JSON.stringify(status));

// Daily stage snapshot for the funnel chart. Past snapshots cannot be rebuilt from the sheets, so
// each day's counts are kept in portal/history.json, encrypted for the team like data.json.
const countBy = R => R.reduce((a, r) => ((a[r.stage] = (a[r.stage] || 0) + 1), a), {});
const snapshot = { d: TODAY, cm: countBy(cm.rows), rm: countBy(rm.rows), eq: countBy(eq.rows) };
const HIST = process.env.PORTAL_HISTORY_FILE || join(ROOT, 'portal', 'history.json');
function writeHistory(keys) {
  const hist = existsSync(HIST) ? JSON.parse(readFileSync(HIST, 'utf8')) : { v: 1, days: [] };
  const entry = { d: TODAY, kid: keys.kid, box: sealForTeam(keys.pub, Buffer.from(JSON.stringify(snapshot))) };
  hist.days = hist.days.filter(x => x.d !== TODAY).concat(entry).sort((a, b) => a.d.localeCompare(b.d)).slice(-400);
  writeFileSync(HIST, JSON.stringify(hist) + '\n');
}

if (argv.includes('--print')) { console.log(JSON.stringify(status, null, 1)); process.exit(0); }
log(`Read ${Object.keys(books).length} sheets: ${cm.rows.length} + ${rm.rows.length} + ${eq.rows.length} rows.`);
if (!existsSync(KEYS)) { console.log('::warning::No logins yet (portal/keys.json): run portal-src/setup-logins.mjs. Nothing published.'); process.exit(0); }
const keys = JSON.parse(readFileSync(KEYS, 'utf8'));
const prev = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
if (prev && prev.h === h && prev.kid === keys.kid) { log('No change since the last refresh.'); process.exit(0); }
const asOf = NOW.toISOString();
const box = sealForTeam(keys.pub, Buffer.from(JSON.stringify({ ...status, asOf })));
writeFileSync(OUT, JSON.stringify({ v: 2, kid: keys.kid, h, at: asOf, box }) + '\n');
writeHistory(keys);
log(prev && prev.kid !== keys.kid ? 'Logins changed: data re-encrypted.' : 'Changes found: portal/data.json updated.');
