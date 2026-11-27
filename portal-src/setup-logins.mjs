#!/usr/bin/env node
// Team portal logins. Run on your own computer, in the website folder:
//
//   node portal-src/setup-logins.mjs                    add new people from members.json
//   node portal-src/setup-logins.mjs --reset EMAIL      give someone a new password
//   node portal-src/setup-logins.mjs --new-key          start over: new team key, everyone gets a password again
//
// members.json (this folder, never committed) lists who has a login: [{"name": "...", "email": "..."}].
// Passwords are typed here (hidden) or made for you, and shown only in this terminal.
// The only file written is portal/keys.json, which holds encrypted data only. Commit and push it.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomInt } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { ITER, kidOf, slotId, newTeamKey, makeSlot, openSlot } from './lib.mjs';

const SRC = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SRC, '..');
const KEYS = process.env.PORTAL_KEYS_FILE || join(ROOT, 'portal', 'keys.json');
const MEMBERS = process.env.PORTAL_MEMBERS_FILE || join(SRC, 'members.json');
const MIN_LEN = 12;

const argv = process.argv.slice(2);
const flag = f => argv.includes(f);
const resets = argv.flatMap((a, i) => (a === '--reset' && argv[i + 1] ? [argv[i + 1].trim().toLowerCase()] : []));
if (flag('--help') || flag('-h')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).map(l => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}

// ---------- terminal input (hidden for passwords)
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
let muted = false;
rl._writeToOutput = s => { if (!muted) rl.output.write(s); };
const lines = rl[Symbol.asyncIterator]();
async function ask(q, hidden = false) {
  rl.output.write(q);
  muted = hidden;
  const { value, done } = await lines.next();
  muted = false;
  if (hidden && process.stdin.isTTY) rl.output.write('\n');
  if (done) throw new Error('No input.');
  return String(value).trim();
}
const bye = (msg, code = 1) => { if (msg) console.log(msg); rl.close(); process.exit(code); };

// 4 groups of 4 from an alphabet without look-alikes: about 82 bits.
const ALPHA = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const makePassword = () => Array.from({ length: 4 }, () =>
  Array.from({ length: 4 }, () => ALPHA[randomInt(ALPHA.length)]).join('')).join('-');

async function choosePassword(m) {
  for (;;) {
    const pw = await ask(`Password for ${m.name} <${m.email}> (press Enter to make one): `, true);
    if (!pw) {
      const made = makePassword();
      console.log(`  ${m.name}'s password: ${made}   (send it to them privately)`);
      return made;
    }
    if (pw.length < MIN_LEN) { console.log(`  Use at least ${MIN_LEN} characters, or press Enter to make one.`); continue; }
    if ((await ask('  Type it again: ', true)) !== pw) { console.log('  The two did not match. Try again.'); continue; }
    return pw;
  }
}

function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ---------- main
if (!existsSync(MEMBERS)) bye(`Missing ${MEMBERS}. Copy members.example.json to members.json and list the team.`);
let members;
try { members = JSON.parse(readFileSync(MEMBERS, 'utf8')); } catch (e) { bye(`members.json is not valid JSON: ${e.message}`); }
members = members.map(m => ({ name: String(m.name || '').trim(), email: String(m.email || '').trim().toLowerCase() }))
  .filter(m => m.email);
if (!members.length) bye('members.json lists nobody.');
const bad = members.find(m => !m.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(m.email));
if (bad) bye(`Check this entry in members.json: ${JSON.stringify(bad)}`);
if (new Set(members.map(m => m.email)).size !== members.length) bye('An email appears twice in members.json.');

const old = existsSync(KEYS) ? JSON.parse(readFileSync(KEYS, 'utf8')) : null;
const ids = new Map(members.map(m => [slotId(m.email), m]));
const removed = old ? old.slots.filter(s => !ids.has(s.id)).length : 0;
const unknownReset = resets.find(e => !members.some(m => m.email === e));
if (unknownReset) bye(`${unknownReset} is not in members.json.`);

let pub, priv, keep = [], targets;
if (!old || removed || flag('--new-key')) {
  if (old && removed) console.log(`${removed} login(s) removed. Making a new team key so removed logins stop working;`
    + ' everyone on the list gets a password again (type the current one to keep it).');
  else if (old) console.log('Making a new team key; everyone on the list gets a password again.');
  else console.log(`Setting up logins for ${members.length} people.`);
  ({ pub, priv } = newTeamKey());
  targets = members;
} else {
  const have = new Set(old.slots.map(s => s.id));
  targets = members.filter(m => !have.has(slotId(m.email)) || resets.includes(m.email));
  if (!targets.length) bye('Logins are up to date: nothing to change. (Use --reset EMAIL for a new password.)', 0);
  console.log(`Adding or resetting: ${targets.map(m => m.name).join(', ')}.`);
  console.log('First, unlock with your own portal login.');
  const email = (await ask('Your email: ')).toLowerCase();
  const slot = old.slots.find(s => s.id === slotId(email));
  const pw = await ask('Your password: ', true);
  priv = slot && old.iter === ITER ? openSlot(slot, pw) : null;
  if (!priv) bye('Email or password not recognised. Nothing was changed.');
  pub = old.pub;
  const t = new Set(targets.map(m => slotId(m.email)));
  keep = old.slots.filter(s => !t.has(s.id));
}

const slots = [...keep];
for (const m of targets) slots.push(makeSlot(m.email, m.name, await choosePassword(m), priv));
const out = { v: 2, iter: ITER, kid: kidOf(pub), pub, slots: shuffle(slots) };
writeFileSync(KEYS, JSON.stringify(out) + '\n');
console.log(`\nSaved portal/keys.json (${slots.length} logins).`);
console.log('Next: commit and push it. The status refresh re-encrypts the data for these logins within a few minutes.');
bye('', 0);
