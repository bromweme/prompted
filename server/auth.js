const { googleClientId, googleSignInEnabled, authTestMode, isProduction } = require('./config');
const { createSessionToken, verifySessionToken } = require('./session');

// The single seam where google-auth-library plugs in. Loaded lazily so the
// server still boots (and the test suite still runs) before the dependency is
// installed and before any credentials exist.
let cachedClient;
function getGoogleClient() {
  if (cachedClient !== undefined) return cachedClient;
  try {
    const { OAuth2Client } = require('google-auth-library');
    cachedClient = new OAuth2Client(googleClientId);
  } catch {
    cachedClient = null;
  }
  return cachedClient;
}

/**
 * Verifies a Google ID token and returns the identity it asserts.
 * Throws with an actionable message when it can't — callers turn that into a
 * connection refusal, never into a fallback identity.
 */
async function verifyGoogleIdToken(idToken) {
  if (!googleSignInEnabled) {
    throw new Error('Google sign-in is not configured (GOOGLE_CLIENT_ID is unset)');
  }

  const client = getGoogleClient();
  if (!client) {
    throw new Error('google-auth-library is not installed — run: npm install google-auth-library');
  }

  const ticket = await client.verifyIdToken({ idToken, audience: googleClientId });
  const payload = ticket.getPayload();

  // verifyIdToken already checks signature, expiry, issuer and audience.
  // Email verification is ours to enforce: an unverified email must not be
  // treated as an identity a player can be recognised by.
  if (!payload || !payload.sub) {
    throw new Error('Google ID token carried no subject');
  }
  if (payload.email && payload.email_verified === false) {
    throw new Error('Google account email is not verified');
  }

  return {
    userId: payload.sub,
    name: payload.name || payload.email || 'Player',
    email: payload.email || null,
    picture: payload.picture || null
  };
}

/**
 * Test-only identity seam. Lets the Playwright suite establish sessions
 * without a live Google round trip (which would need real credentials, burn
 * quota, and be untestable offline).
 *
 * Guarded three ways: the AUTH_TEST_MODE env var must be set, NODE_ENV must
 * not be production, and config.js refuses to boot at all if those two ever
 * contradict each other.
 */
function verifyTestIdentity(testUser) {
  if (!authTestMode || isProduction) {
    throw new Error('Test authentication is not enabled on this server');
  }
  if (!testUser || typeof testUser.userId !== 'string' || !testUser.userId) {
    throw new Error('Test authentication requires a userId');
  }
  return {
    userId: testUser.userId,
    name: typeof testUser.name === 'string' && testUser.name ? testUser.name : 'Test Player',
    email: typeof testUser.email === 'string' ? testUser.email : null,
    picture: null,
    // Lets a test start as a player who has already done first-time setup.
    // Ignored unless the profile is being created for the first time.
    initialAvatar: typeof testUser.avatar === 'string' ? testUser.avatar : null
  };
}

/**
 * Socket.io connection middleware. Every connection authenticates exactly once,
 * here, and the verified identity is bound to socket.data for that socket's
 * lifetime. Handlers read socket.data.userId and never a userId from an event
 * payload — that is what makes the host/round-leader checks enforceable.
 *
 * The client may present either:
 *   - sessionToken: our own signed token, the normal reconnect path
 *   - googleIdToken: a fresh Google credential, exchanged for a session token
 *   - testUser: only when AUTH_TEST_MODE=1 outside production
 */
function createAuthMiddleware() {
  return async (socket, next) => {
    const auth = socket.handshake.auth || {};

    try {
      let identity = null;

      if (auth.sessionToken) {
        const payload = verifySessionToken(auth.sessionToken);
        if (payload) {
          identity = {
            userId: payload.sub,
            name: payload.name || 'Player',
            email: payload.email || null,
            picture: payload.picture || null
          };
        }
        // An invalid or expired session token is not fatal on its own — fall
        // through so a googleIdToken presented alongside it can still succeed.
      }

      if (!identity && auth.googleIdToken) {
        identity = await verifyGoogleIdToken(auth.googleIdToken);
      }

      if (!identity && auth.testUser) {
        identity = verifyTestIdentity(auth.testUser);
      }

      if (!identity) {
        return next(new Error('AUTH_REQUIRED'));
      }

      socket.data.userId = identity.userId;
      socket.data.username = identity.name;
      socket.data.email = identity.email;
      socket.data.picture = identity.picture;
      socket.data.initialAvatar = identity.initialAvatar || null;
      // Handed back to the client on connect so it can store a fresh token and
      // stop replaying a short-lived Google credential.
      socket.data.sessionToken = createSessionToken(identity);

      return next();
    } catch (err) {
      console.warn('Socket authentication rejected:', err.message);
      return next(new Error('AUTH_FAILED'));
    }
  };
}

module.exports = { verifyGoogleIdToken, verifyTestIdentity, createAuthMiddleware };
