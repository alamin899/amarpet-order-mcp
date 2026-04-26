import { createHash, randomBytes } from 'node:crypto';

// Short-lived codes (5 min) and long-lived tokens (24 h)
const codes  = new Map(); // code  → { codeChallenge, expiresAt }
const tokens = new Map(); // token → expiresAt

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function pkceValid(verifier, challenge) {
  return base64url(createHash('sha256').update(verifier).digest()) === challenge;
}

export function createCode(codeChallenge) {
  const code = base64url(randomBytes(24));
  codes.set(code, { codeChallenge, expiresAt: Date.now() + 5 * 60 * 1000 });
  return code;
}

export function redeemCode(code, codeVerifier) {
  const entry = codes.get(code);
  if (!entry || Date.now() > entry.expiresAt) { codes.delete(code); return null; }
  if (!pkceValid(codeVerifier, entry.codeChallenge)) return null;
  codes.delete(code);

  const token = base64url(randomBytes(32));
  tokens.set(token, Date.now() + 24 * 60 * 60 * 1000);
  return token;
}

export function isKnownToken(token) {
  if (!token) return false;
  const exp = tokens.get(String(token));
  if (!exp) return false;
  if (Date.now() > exp) { tokens.delete(token); return false; }
  return true;
}
