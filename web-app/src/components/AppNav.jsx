import { useNavigate } from 'react-router-dom'
import { useUser } from '../context/UserContext'
import './AppNav.css'

/**
 * The application header: logo, primary nav, avatar (which is the route to
 * the account page) and logout. Extracted from Dashboard so GroupView shows
 * the same chrome instead of its own one-off header.
 *
 * `current` names the active nav item so it can carry aria-current.
 */
function AppNav({ current }) {
  const navigate = useNavigate()
  const { user, signOut } = useUser()

  const handleLogout = () => {
    signOut()
    navigate('/')
  }

  return (
    <header className="app-header">
      <div className="header-content">
        <div className="logo">
          <h1>🎵 Prompted</h1>
        </div>

        <nav className="header-nav" aria-label="Main navigation">
          <button
            className={`nav-button ${current === 'dashboard' ? 'active' : ''}`}
            aria-current={current === 'dashboard' ? 'page' : undefined}
            onClick={() => navigate('/dashboard')}
          >
            Dashboard
          </button>
          <button
            className={`nav-button ${current === 'topics' ? 'active' : ''}`}
            aria-current={current === 'topics' ? 'page' : undefined}
            onClick={() => navigate('/topics')}
          >
            My Topics
          </button>
        </nav>

        <div className="user-section">
          {/* The avatar is the only route to the account page, so it is a
              real labelled control rather than decoration. */}
          <button
            className="user-avatar-button"
            onClick={() => navigate('/account')}
            aria-label={`Account settings for ${user?.name || 'your profile'}`}
          >
            <span className="user-avatar" aria-hidden="true">{user?.avatar}</span>
          </button>
          <button
            className="logout-button"
            onClick={handleLogout}
            aria-label="Logout"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  )
}

export default AppNav
