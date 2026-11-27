// Shared crypto for the team portal (Node side). The browser side lives in portal/index.html.
//
// keys.json  public team key + one slot per member. A slot holds the team's private key,
//            encrypted with a key derived from that member's password (PBKDF2-SHA256).
// data.json  the status, encrypted with a fresh AES-256-GCM key that is wrapped with the
//            public team key (RSA-OAEP-SHA256). Anyone can write it; only members can read it.
import {
  randomBytes, createHash, createCipheriv, createDecipheriv, pbkdf2Sync,
  generateKeyPairSync, createPublicKey, createPrivateKey, publicEncrypt, privateDecrypt, constants,
} from 'node:crypto';

export const ITER = 600000;
export const b64 = b => Buffer.from(b).toString('base64');
export const ub = s => Buffer.from(s, 'base64');
export const sha256hex = b => createHash('sha256').update(b).digest('hex');

/** Slot id for an email: lets the page find the right slot without storing the email. */
export const slotId = email => sha256hex('bpm-portal:' + String(email).trim().toLowerCase());

/** Short fingerprint of the public team key, so data and logins can be matched. */
export const kidOf = pubB64 => sha256hex(ub(pubB64)).slice(0, 16);

export function gcmSeal(key, plain) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
  return { iv: b64(iv), ct: b64(ct) };
}

export function gcmOpen(key, box) {
  const buf = ub(box.ct);
  const d = createDecipheriv('aes-256-gcm', key, ub(box.iv));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]);
}

export const passwordKey = (pw, salt) => pbkdf2Sync(String(pw).normalize('NFC'), salt, ITER, 32, 'sha256');

export function newTeamKey() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });
  return { pub: b64(publicKey), priv: privateKey };
}

const OAEP = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };

/** Encrypt for the team with the public key only (used by the refresh job). */
export function sealForTeam(pubB64, plain) {
  const key = randomBytes(32);
  const pub = createPublicKey({ key: ub(pubB64), format: 'der', type: 'spki' });
  return { w: b64(publicEncrypt({ key: pub, ...OAEP }, key)), ...gcmSeal(key, plain) };
}

/** Decrypt with the private key (tests and local checks only). */
export function openForTeam(privDer, box) {
  const priv = createPrivateKey({ key: privDer, format: 'der', type: 'pkcs8' });
  return gcmOpen(privateDecrypt({ key: priv, ...OAEP }, ub(box.w)), box);
}

export function makeSlot(email, name, password, privDer) {
  const salt = randomBytes(16);
  const kek = passwordKey(password, salt);
  return { id: slotId(email), salt: b64(salt), key: gcmSeal(kek, privDer), name: gcmSeal(kek, Buffer.from(name)) };
}

/** Returns the private key (DER) if the password opens the slot, else null. */
export function openSlot(slot, password) {
  try { return gcmOpen(passwordKey(password, ub(slot.salt)), slot.key); } catch { return null; }
}
