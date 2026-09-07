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
  console.warn('');
}

module.exports = {
  isProduction,
  authTestMode,
  googleClientId,
  youtubeApiKey,
  sessionSecret,
  googleSignInEnabled: !!googleClientId,
  youtubeSearchEnabled: !!youtubeApiKey,
  port: Number(process.env.PORT) || 5000,
  sessionTtlDays: Number(process.env.SESSION_TTL_DAYS) || 30
};
