const crypto = require('crypto');
const { sessionSecret, sessionTtlDays } = require('./config');

// Self-contained signed session tokens: base64url(payload).base64url(HMAC).
// Deliberately not JWT — there is no third party to interoperate with, and a
// hand-rolled HMAC of a JSON payload has a much smaller surface than a library
// that has to negotiate algorithms (including "none").
//
// The token is a bearer credential: anyone holding it is the user it names, so
// it only ever travels over the socket handshake, never in a URL.

const TOKEN_VERSION = 1;

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64url(value) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function sign(payloadB64) {
  return base64url(crypto.createHmac('sha256', sessionSecret).update(payloadB64).digest());
}

/**
 * Mints a session token for an already-verified identity. Callers must only
 * reach this after Google (or the test-mode seam) has confirmed who the user
 * is — nothing here validates the claims it is handed.
 */
function createSessionToken({ userId, name, email, picture }) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: TOKEN_VERSION,
    sub: userId,
    name: name || null,
    email: email || null,
    picture: picture || null,
    iat: now,
    exp: now + sessionTtlDays * 24 * 60 * 60
  };

  const payloadB64 = base64url(JSON.stringify(payload));
  return `${payloadB64}.${sign(payloadB64)}`;
}

/**
 * Returns the payload for a valid, unexpired token, or null. Every failure
 * path returns null rather than throwing or distinguishing itself, so a caller
 * cannot leak which part was wrong.
 */
function verifySessionToken(token) {
  if (typeof token !== 'string' || token.length > 4096) return null;

  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [payloadB64, signatureB64] = parts;
  const expected = sign(payloadB64);

  // Compare over fixed-length buffers so the check is timing-safe;
  // timingSafeEqual throws on a length mismatch, hence the guard.
  const givenBuf = Buffer.from(signatureB64);
  const expectedBuf = Buffer.from(expected);
  if (givenBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(givenBuf, expectedBuf)) return null;

  let payload;
  try {
    payload = JSON.parse(fromBase64url(payloadB64).toString('utf8'));
  } catch {
    return null;
  }

  if (payload.v !== TOKEN_VERSION) return null;
  if (typeof payload.sub !== 'string' || !payload.sub) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null;

  return payload;
}

module.exports = { createSessionToken, verifySessionToken };
