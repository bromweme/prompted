import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useSocket } from '../context/SocketContext'
import { useUser } from '../context/UserContext'
import './Dashboard.css'

function Dashboard() {
  const [leagues, setLeagues] = useState([])
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const { socket, isConnected } = useSocket()
  const { user } = useUser()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!socket || !isConnected) return

    // Fetch user's leagues from server
    socket.emit('get_leagues')

    socket.on('leagues_list', ({ leagues: serverLeagues }) => {
      // Transform server leagues to match UI format
      const transformedLeagues = serverLeagues.map(league => ({
        id: league.id,
        name: league.name,
        description: league.description,
        players: league.players.length,
        currentRound: league.currentRound,
        totalRounds: league.settings.totalRounds || 6,
        status: league.status,
        host: league.host
      }))
      setLeagues(transformedLeagues)
    })

    return () => {
      socket.off('leagues_list')
    }
  }, [socket, isConnected])

  useEffect(() => {
    // Check if there's a new league from navigation state
    if (location.state?.newLeague) {
      setLeagues(prev => {
        // Check if league already exists
        if (prev.find(l => l.id === location.state.newLeague.id)) {
          return prev
        }
        return [...prev, {
          id: location.state.newLeague.id,
          name: location.state.newLeague.name,
          description: location.state.newLeague.description,
          players: location.state.newLeague.players.length,
          currentRound: location.state.newLeague.currentRound,
          totalRounds: location.state.newLeague.settings.totalRounds,
          status: location.state.newLeague.status,
          host: location.state.newLeague.players[0]?.id
        }]
      })
    }
  }, [location.state])

  const handleJoinLeague = (leagueId) => {
    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }

    // Set username on socket for league join
    socket.data.username = user.name
    
    // Fetch league details from server
    socket.emit('get_league', { leagueId })

    socket.once('league_details', ({ league }) => {
      // Transform server league data to match UI format
      const fullLeagueData = {
        id: league.id,
        name: league.name,
        description: league.description,
        settings: {
          totalRounds: league.settings.totalRounds || 6,
          maxPlayers: league.settings.maxPlayers || 12,
          minPlayers: league.settings.minPlayers || 2,
          czarPoints: league.settings.czarPoints || 5,
          allowSkipCzar: league.settings.allowSkipCzar !== false,
          anonymousCzar: league.settings.anonymousCzar !== false,
          maxJuryPoints: league.settings.maxJuryPoints || 3,
          allowDownvotes: league.settings.allowDownvotes !== false,
          downvoteCost: league.settings.downvoteCost || 1,
          allowOverride: league.settings.allowOverride !== false,
          overrideThreshold: (league.settings.overrideThreshold || 0.7) * 100, // Convert to percentage
          submissionTime: league.settings.submissionTime || 24,
          votingTime: league.settings.votingTime || 24,
          autoStart: league.settings.autoStart || false,
          topicSelection: league.settings.topicSelection || 'czar',
          allowCustomTopics: league.settings.allowCustomTopics !== false,
          presetTopics: league.settings.presetTopics || [],
          enableChat: league.settings.enableChat || false,
          enableSongPreview: league.settings.enableSongPreview !== false,
          showVoterIdentity: league.settings.showVoterIdentity || false
        },
        status: league.status,
        currentRound: league.currentRound,
        players: league.players.map(player => ({
          id: player.id,
          username: player.username,
          score: player.score,
          isHost: player.id === league.host
        })),
        currentTheme: null, // Will be populated when league becomes active
        history: league.history || []
      }
      
      navigate(`/league/${leagueId}`, { state: { leagueData: fullLeagueData } })
    })

    socket.once('error', ({ message }) => {
      console.error('Error fetching league:', message)
      alert(`Failed to load league: ${message}`)
    })
  }

  const handleJoinLeagueByCode = () => {
    // In production, this would validate the code and join the league
    if (joinCode.trim()) {
      alert(`Joining league with code: ${joinCode}`)
      setShowJoinModal(false)
      setJoinCode('')
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('user')
    navigate('/')
  }

  if (!user) {
    return <div className="loading">Loading...</div>
  }

  return (
    <div className="dashboard-page">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      
      <header className="dashboard-header">
        <div className="header-content">
          <div className="logo">
            <h1>🎵 Prompted</h1>
          </div>
          
          <nav className="header-nav" aria-label="Main navigation">
            <button 
              className="nav-button active"
              aria-current="page"
            >
              Dashboard
            </button>
            <button 
              className="nav-button"
              onClick={() => navigate('/account')}
            >
              Account
            </button>
          </nav>

          <div className="user-section">
            <div className="user-info">
              <span className="user-avatar" aria-hidden="true">{user?.avatar}</span>
              <div className="user-details">
                <span className="user-name">{user?.name}</span>
                <span className="user-email">{user?.email}</span>
              </div>
            </div>
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

      <main id="main-content" className="dashboard-main">
        <div className="dashboard-content">
          {/* Show My Leagues first if user has leagues */}
          {leagues.length > 0 && (
            <section className="leagues-section">
              <div className="section-header">
                <h2>My Leagues</h2>
                <div className="league-tabs">
                  <button className="tab-button active">Active</button>
                  <button className="tab-button">Completed</button>
                  <button className="tab-button">Archived</button>
                </div>
              </div>

              <div className="leagues-grid">
                {leagues.map((league) => (
                  <article 
                    key={league.id} 
                    className="league-card"
                    onClick={() => handleJoinLeague(league.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="league-header">
                      <h3>{league.name}</h3>
                      <span className={`status-badge ${league.status}`}>
                        {league.status}
                      </span>
                    </div>
                    
                    <p className="league-description">{league.description}</p>
                    
                    <div className="league-stats">
                      <div className="stat">
                        <span className="stat-label">Players</span>
                        <span className="stat-value">{league.players}</span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Round</span>
                        <span className="stat-value">{league.currentRound}/{league.totalRounds}</span>
                      </div>
                    </div>

                    <div className="league-actions">
                      {league.host === user.id ? (
                        <span className="host-badge">You're the host</span>
                      ) : (
                        <span className="member-badge">Member</span>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          <section className="welcome-section">
            <h2>Welcome back, {user?.name}!</h2>
            <p className="welcome-text">
              Ready to discover some new music and compete with your friends?
            </p>
            
            <div className="welcome-actions">
              <button 
                className="create-league-button"
                onClick={() => navigate('/create-league')}
                aria-label="Create new league"
              >
                <span className="button-icon" aria-hidden="true">+</span>
                Create New League
              </button>
              <button 
                className="join-league-button"
                onClick={() => setShowJoinModal(true)}
                aria-label="Join existing league"
              >
                <span className="button-icon" aria-hidden="true">🔗</span>
                Join League
              </button>
            </div>
          </section>

          {leagues.length === 0 && (
            <section className="leagues-section">
              <div className="section-header">
                <h2>My Leagues</h2>
                <div className="league-tabs">
                  <button className="tab-button active">Active</button>
                  <button className="tab-button">Completed</button>
                  <button className="tab-button">Archived</button>
                </div>
              </div>

              <div className="leagues-grid">
                {leagues.length === 0 && (
                  <div className="empty-state">
                    <div className="empty-icon" aria-hidden="true">🎵</div>
                    <h3>No leagues yet</h3>
                    <p>Create your first league to get started!</p>
                  </div>
                )}
              </div>
            </section>
          )}

          <section className="quick-actions-section">
            <h2>Quick Actions</h2>
            <div className="quick-actions-grid">
              <button className="quick-action-card">
                <div className="action-icon" aria-hidden="true">🔍</div>
                <h3>Browse Leagues</h3>
                <p>Find public leagues to join</p>
              </button>
              <button className="quick-action-card">
                <div className="action-icon" aria-hidden="true">👥</div>
                <h3>Invite Friends</h3>
                <p>Share your league with friends</p>
              </button>
              <button className="quick-action-card">
                <div className="action-icon" aria-hidden="true">📊</div>
                <h3>View Stats</h3>
                <p>Check your performance history</p>
              </button>
              <button className="quick-action-card">
                <div className="action-icon" aria-hidden="true">⚙️</div>
                <h3>Settings</h3>
                <p>Manage your account settings</p>
              </button>
            </div>
          </section>
        </div>
      </main>

      {showJoinModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="join-modal-title">
          <div className="modal-content">
            <div className="modal-header">
              <h2 id="join-modal-title">Join League</h2>
              <button 
                className="close-button"
                onClick={() => setShowJoinModal(false)}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>
            
            <form className="modal-body" onSubmit={(e) => { e.preventDefault(); handleJoinLeagueByCode(); }}>
              <div className="form-group">
                <label htmlFor="join-code">League Code</label>
                <input
                  id="join-code"
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="Enter 6-digit league code"
                  required
                  maxLength={6}
                />
                <small className="form-hint">Get the league code from the host</small>
              </div>

              <div className="modal-actions">
                <button 
                  type="button"
                  className="cancel-button"
                  onClick={() => setShowJoinModal(false)}
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="submit-button"
                  disabled={!joinCode.trim()}
                >
                  Join League
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

export default Dashboard
