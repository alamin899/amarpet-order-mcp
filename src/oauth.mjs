import { createHash, randomBytes } from 'node:crypto';

// Short-lived authorization codes (5 min TTL)
const authCodes = new Map();
// Long-lived Bearer tokens (24h TTL)
const tokens    = new Map();

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// PKCE S256: verify that SHA-256(codeVerifier) == codeChallenge
export function verifyPkce(codeVerifier, codeChallenge) {
  const computed = base64url(createHash('sha256').update(codeVerifier).digest());
  return computed === codeChallenge;
}

export function createAuthCode({ apiKey, codeChallenge, redirectUri, state }) {
  const code = base64url(randomBytes(24));
  authCodes.set(code, {
    apiKey, codeChallenge, redirectUri, state,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  return code;
}

export function redeemCode(code, codeVerifier) {
  const entry = authCodes.get(code);
  if (!entry || Date.now() > entry.expiresAt) {
    authCodes.delete(code);
    return null;
  }
  if (!verifyPkce(codeVerifier, entry.codeChallenge)) return null;
  authCodes.delete(code);

  const token = base64url(randomBytes(32));
  tokens.set(token, {
    apiKey: entry.apiKey,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000,
  });
  return token;
}

export function validateBearerToken(token) {
  if (!token) return false;
  const entry = tokens.get(token);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) { tokens.delete(token); return false; }
  return true;
}

export function tokenCount() { return tokens.size; }
