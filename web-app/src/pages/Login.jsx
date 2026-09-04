import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './Login.css'

function Login() {
  const [isConnecting, setIsConnecting] = useState(false)
  const navigate = useNavigate()

  const handleSpotifyLogin = () => {
    setIsConnecting(true)
    // In production, this would redirect to Spotify OAuth
    // For demo, we'll simulate successful login
    setTimeout(() => {
      setIsConnecting(false)
      navigate('/dashboard')
    }, 1500)
  }

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
                A Cards Against Humanity-style music game where players submit songs 
                based on prompts, with a Card Czar judging the submissions.
              </p>
            </div>

            <div className="features-section">
              <div className="feature-item">
                <div className="feature-icon" aria-hidden="true">🎴</div>
                <h3>Card Czar System</h3>
                <p>Anonymous judge picks the winning song each round</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon" aria-hidden="true">🎵</div>
                <h3>Spotify Integration</h3>
                <p>Submit songs directly from your Spotify library</p>
              </div>
              <div className="feature-item">
                <div className="feature-icon" aria-hidden="true">🏆</div>
                <h3>Competitive Scoring</h3>
                <p>Earn points and climb the leaderboard</p>
              </div>
            </div>

            <div className="auth-section">
              <button 
                className="spotify-login-btn"
                onClick={handleSpotifyLogin}
                disabled={isConnecting}
                aria-label="Login with Spotify"
              >
                {isConnecting ? (
                  <span className="btn-text">Connecting...</span>
                ) : (
                  <>
                    <svg className="spotify-icon" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.24-.899-.621-.12-.421.24-.78.66-.899 4.56-1.021 9.52-.6 12.561 1.38.36.179.479.659.3 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.248 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
                    </svg>
                    <span className="btn-text">Continue with Spotify</span>
                  </>
                )}
              </button>
            </div>

            <div className="demo-notice">
              <p>Demo Mode: Click the button above to simulate Spotify login</p>
            </div>
          </div>

          <footer className="login-footer">
            <p>By continuing, you agree to our Terms of Service and Privacy Policy</p>
          </footer>
        </div>
      </main>
    </div>
  )
}

export default Login
