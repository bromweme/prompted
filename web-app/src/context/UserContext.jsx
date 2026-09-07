import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'

const UserContext = createContext()

const SESSION_KEY = 'sessionToken'
// Test-only. Only read in dev builds, and the server accepts the resulting
// identity only when AUTH_TEST_MODE=1 outside production — so this is inert
// in a real deployment and absent from a production bundle entirely.
const TEST_USER_KEY = 'testUser'

export const useUser = () => {
  const context = useContext(UserContext)
  if (!context) {
    throw new Error('useUser must be used within a UserProvider')
  }
  return context
}

function readStoredSession() {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

function readTestUser() {
  if (!import.meta.env.DEV) return null
  try {
    const raw = localStorage.getItem(TEST_USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const UserProvider = ({ children }) => {
  // The authenticated user, as confirmed by the server. It is never invented
  // client-side: until the socket has authenticated and sent back a session,
  // this stays null and the app treats the visitor as signed out.
  const [user, setUser] = useState(null)
  const [sessionToken, setSessionToken] = useState(readStoredSession)
  // A fresh Google credential, held only long enough to be exchanged for a
  // session token on the next connection.
  const [googleIdToken, setGoogleIdToken] = useState(null)
  const [testUser] = useState(readTestUser)
  const [authError, setAuthError] = useState(null)

  // What the socket handshake presents. A stored session token is the normal
  // path; a Google credential is used the first time or after one expires.
  const authPayload = useMemo(() => {
    if (sessionToken) return { sessionToken }
    if (googleIdToken) return { googleIdToken }
    if (testUser) return { testUser }
    return null
  }, [sessionToken, googleIdToken, testUser])

  // Called by SocketContext when the server confirms who we are.
  const onSession = useCallback(({ sessionToken: token, user: authedUser }) => {
    setAuthError(null)
    setUser(authedUser)
    if (token) {
      setSessionToken(token)
      setGoogleIdToken(null)
      try {
        localStorage.setItem(SESSION_KEY, token)
      } catch {
        // A blocked storage API only costs a re-prompt next visit.
      }
    }
  }, [])

  // Called with the credential Google Identity Services hands back.
  const signInWithGoogle = useCallback((credential) => {
    setAuthError(null)
    setGoogleIdToken(credential)
  }, [])

  const signOut = useCallback(() => {
    setUser(null)
    setSessionToken(null)
    setGoogleIdToken(null)
    try {
      localStorage.removeItem(SESSION_KEY)
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
  }, [])

  // A rejected handshake means the stored token is no longer good; drop it so
  // the app falls back to the sign-in screen instead of retrying forever.
  const onAuthFailure = useCallback((message) => {
    setAuthError(message)
    setUser(null)
    setSessionToken(null)
    setGoogleIdToken(null)
    try {
      localStorage.removeItem(SESSION_KEY)
    } catch {
      // Ignored, as above.
    }
  }, [])

  const updateUser = useCallback((updates) => {
    setUser(prevUser => (prevUser ? { ...prevUser, ...updates } : prevUser))
  }, [])

  useEffect(() => {
    // Clear any stale pre-auth user left by an older build of the app, which
    // used to seed a fake "Music Lover" account into localStorage.
    try {
      localStorage.removeItem('user')
    } catch {
      // Ignored.
    }
  }, [])

  const value = {
    user,
    isAuthenticated: !!user,
    // A stored credential exists but the server hasn't confirmed it yet.
    // Routes must wait rather than bounce to sign-in, or every reload would
    // flash the login screen before landing where the user asked to go.
    isResolvingAuth: !!authPayload && !user && !authError,
    authPayload,
    authError,
    signInWithGoogle,
    signOut,
    onSession,
    onAuthFailure,
    updateUser,
    setUser
  }

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  )
}
