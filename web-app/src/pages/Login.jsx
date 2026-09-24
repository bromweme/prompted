import { useEffect } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useUser } from '../context/UserContext'
import { useGoogleSignIn } from '../hooks/useGoogleSignIn'
import './Login.css'

// Where to go once signed in: the protected address RequireAuth bounced the
// visitor from, if it is a same-app path, otherwise the Dashboard. Only a path
// starting with a single "/" is honoured, so router state can never send a
// signed-in user off-site.
function destinationAfterSignIn(state) {
  const from = state && typeof state.from === 'string' ? state.from : ''
  if (from.startsWith('/') && !from.startsWith('//') && from !== '/') return from
  return '/dashboard'
}

function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const destination = destinationAfterSignIn(location.state)
  const { isAuthenticated, signInWithGoogle, authError } = useUser()
  const { buttonRef, status, error } = useGoogleSignIn(signInWithGoogle)

  // Sign-in completes asynchronously: the credential goes to the server over
  // the socket handshake, and only once the server confirms the identity does
  // the user become authenticated. That confirmation is what routes onward.
  useEffect(() => {
    if (isAuthenticated) {
      // replace: the sign-in screen should not sit between the visitor and
      // the page they were after in the Back history.
      navigate(destination, { replace: destination !== '/dashboard' })
    }
  }, [isAuthenticated, navigate, destination])

  return (
    <div className="login-page">
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <main id="main-content" className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="logo-section">
              <h1>🎵 Prompted</h1>
              <p className="tagline">Discover music. Compete with friends.</p>
            </div>
          </div>

          <div className="login-body">
            <div className="intro-section">
              <h2>Welcome to Prompted</h2>
              <p>
                A Cards Against Humanity-style music game where players submit videos
                based on prompts, with a Judge picking the winner.
              </p>
            </div>

            <div className="features-section">
              <div className="feature-item">
                <div className="feature-icon" aria-hidden="true">🎴</div>
                <h3>Judge System</h3>
                <p>An anonymous Judge picks the winning video each round</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon" aria-hidden="true">📺</div>
                <h3>YouTube Search</h3>
                <p>Find and submit any video, then watch it together</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon" aria-hidden="true">🏆</div>
                <h3>Competitive Scoring</h3>
                <p>Earn points and climb the leaderboard</p>
              </div>
            </div>

            <div className="auth-section">
              {/* Google renders its own button in here once the script loads. */}
              <div ref={buttonRef} className="google-signin-slot" />

              {status === 'loading' && (
                <p className="auth-status" role="status">Loading Google Sign-In…</p>
              )}

              {status === 'disabled' && (
                <p className="auth-status auth-status-warning" role="status">
                  Google Sign-In is not configured yet. Set <code>VITE_GOOGLE_CLIENT_ID</code>{' '}
                  in <code>web-app/.env</code> to enable it.
                </p>
              )}

              {status === 'error' && (
                <p className="auth-status auth-status-error" role="alert">
                  {error || 'Google Sign-In could not be loaded.'}
                </p>
              )}

              {authError && (
                <p className="auth-status auth-status-error" role="alert">{authError}</p>
              )}
            </div>
          </div>

          <footer className="login-footer">
            {/* This used to claim agreement to a Terms of Service and a Privacy
                Policy, neither of which existed, and neither of which was a link.
                Only the policy exists, so only the policy is named. */}
            <p>By continuing, you agree to our <Link to="/privacy">Privacy Policy</Link>.</p>
          </footer>
        </div>
      </main>
    </div>
  )
}

export default Login
