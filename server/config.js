const crypto = require('crypto');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

const isProduction = process.env.NODE_ENV === 'production';

// Test mode lets the Playwright suite mint sessions without talking to Google.
// It is refused outright in production, so enabling it by accident on a
// deployed server fails at boot rather than quietly opening a bypass.
const authTestMode = process.env.AUTH_TEST_MODE === '1';
if (authTestMode && isProduction) {
  console.error('FATAL: AUTH_TEST_MODE=1 is not allowed when NODE_ENV=production.');
  process.exit(1);
}

const missing = [];

function required(name) {
  const value = process.env[name];
  if (!value) missing.push(name);
  return value || null;
}

// Public: ships in the client bundle. Identifies which OAuth app an ID token
// was minted for, and is what we check the token's `aud` against.
const googleClientId = required('GOOGLE_CLIENT_ID');

// Secret: server-side only. Used for YouTube Data API v3 search.
const youtubeApiKey = required('YOUTUBE_API_KEY');

// Secret: signs our own session tokens. Google ID tokens expire after about an
// hour, which is far too short for the socket-reconnect pattern, so we mint a
// longer-lived token of our own once identity is verified.
let sessionSecret = process.env.SESSION_SECRET || null;
if (!sessionSecret) missing.push('SESSION_SECRET');

// Secret: pseudonymises actor ids in the event log (EVT-1). It has to outlive
// the database, not just the process — it used to be generated into a `meta`
// row, so a wiped database (which on an ephemeral filesystem is every restart)
// meant a new secret and a new actor id for the same player, and nothing in the
// log could be followed across a boundary. Changing it renames every actor.
let eventsHashSecret = process.env.EVENTS_HASH_SECRET || null;
if (!eventsHashSecret) missing.push('EVENTS_HASH_SECRET');

if (missing.length > 0) {
  if (isProduction) {
    console.error(
      `FATAL: missing required environment variable(s): ${missing.join(', ')}.\n` +
      'See server/.env.example for what each one is and where to get it.'
    );
    process.exit(1);
  }

  // Outside production the server still boots, so `npm run dev` and the test
  // suite work before any credentials exist — but every degraded subsystem
  // says so loudly rather than failing mysteriously later.
  console.warn(`\n[config] Missing env var(s): ${missing.join(', ')}`);
  console.warn('[config] Copy server/.env.example to server/.env and fill it in.');
  if (missing.includes('GOOGLE_CLIENT_ID')) {
    console.warn('[config]   -> Google sign-in is DISABLED (no client id to verify tokens against).');
  }
  if (missing.includes('YOUTUBE_API_KEY')) {
    console.warn('[config]   -> YouTube search is running on local FIXTURES, not the real API.');
  }
  if (missing.includes('SESSION_SECRET')) {
    sessionSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[config]   -> Using an ephemeral session secret; sessions die on restart.');
  }
  if (missing.includes('EVENTS_HASH_SECRET')) {
    eventsHashSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[config]   -> Using an ephemeral event-log hash secret; actor ids change on restart.');
  }
  console.warn('');
}

// Browser origins the HTTP API and the socket.io handshake accept cross-origin
// requests from. Driven by ALLOWED_ORIGINS (comma-separated); falls back to the
// local dev origins when unset so `npm run dev` and the Playwright suite work
// with no .env entry. Production MUST set ALLOWED_ORIGINS to the real deployed
// web origin(s) — a production boot that still only trusts localhost is almost
// certainly a misconfiguration, so we warn loudly (but still boot, since a
// smoke test on a box with no browser client is legitimate).
const DEFAULT_DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8081',
  'exp://localhost:19000'
];

const parsedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = parsedOrigins.length > 0 ? parsedOrigins : [...DEFAULT_DEV_ORIGINS];

if (isProduction && parsedOrigins.length === 0) {
  console.warn(
    '[config] ALLOWED_ORIGINS is not set (or empty): the server will only accept ' +
    'browser requests from localhost origins. Set ALLOWED_ORIGINS to the real ' +
    'production web origin(s), comma-separated (e.g. https://app.example.com).'
  );
}

module.exports = {
  isProduction,
  authTestMode,
  googleClientId,
  youtubeApiKey,
  sessionSecret,
  eventsHashSecret,
  allowedOrigins,
  googleSignInEnabled: !!googleClientId,
  youtubeSearchEnabled: !!youtubeApiKey,
  port: Number(process.env.PORT) || 5000,
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS) || 30
};
