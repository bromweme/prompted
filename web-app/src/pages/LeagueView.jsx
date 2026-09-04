import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useSocket } from '../context/SocketContext'
import { useUser } from '../context/UserContext'
import './LeagueView.css'

function LeagueView() {
  const { leagueId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { socket, isConnected } = useSocket()
  const { user } = useUser()
  
  const [league, setLeague] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [spotifyUri, setSpotifyUri] = useState('')
  const [songTitle, setSongTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [userSubmission, setUserSubmission] = useState(null)
  const [isEditing, setIsEditing] = useState(false)
  const [selectedRoundLeader, setSelectedRoundLeader] = useState(null)
  const [isEditingRules, setIsEditingRules] = useState(false)
  const [editedSettings, setEditedSettings] = useState(null)
  const [showRoundLeaderModal, setShowRoundLeaderModal] = useState(false)
  const [showPlayerSelection, setShowPlayerSelection] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState(null)

  useEffect(() => {
    // Countdown timer for round deadline
    if (league?.currentTheme?.deadline) {
      const interval = setInterval(() => {
        const now = new Date().getTime()
        const deadline = new Date(league.currentTheme.deadline).getTime()
        const remaining = deadline - now

        if (remaining <= 0) {
          setTimeRemaining(0)
          clearInterval(interval)
        } else {
          setTimeRemaining(remaining)
        }
      }, 1000)

      return () => clearInterval(interval)
    }
  }, [league?.currentTheme?.deadline])

  useEffect(() => {
    if (!socket || !isConnected) return

    // Set username on socket for league operations
    socket.data.username = user.name

    // Get league data from navigation state or fetch from server
    if (location.state?.leagueData) {
      const leagueData = location.state.leagueData
      
      // Ensure league has all required fields
      const fullLeagueData = {
        ...leagueData,
        settings: leagueData.settings || {
          totalRounds: 6,
          maxPlayers: 12,
          minPlayers: 2,
          czarPoints: 5,
          allowSkipCzar: true,
          anonymousCzar: true,
          maxJuryPoints: 3,
          allowDownvotes: true,
          downvoteCost: 1,
          allowOverride: true,
          overrideThreshold: 70,
          submissionTime: 24,
          votingTime: 24,
          autoStart: false,
          topicSelection: 'czar',
          allowCustomTopics: true,
          presetTopics: [],
          enableChat: false,
          enableSongPreview: true,
          showVoterIdentity: false
        },
        status: leagueData.status || 'waiting',
        currentRound: leagueData.currentRound || 0,
        players: leagueData.players || [
          { id: 'user123', username: 'MusicLover', score: 0, isHost: true }
        ],
        currentTheme: leagueData.currentTheme || null,
        history: leagueData.history || []
      }
      
      setLeague(fullLeagueData)
    } else {
      // Fetch league data from server
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
            overrideThreshold: (league.settings.overrideThreshold || 0.7) * 100,
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
          currentTheme: null,
          history: league.history || []
        }
        
        setLeague(fullLeagueData)
      })

      socket.once('error', ({ message }) => {
        console.error('Error fetching league:', message)
        alert(`Failed to load league: ${message}`)
      })
    }

    // Listen for league updates
    socket.on('league_updated', ({ league }) => {
      setLeague(prev => ({
        ...prev,
        ...league,
        settings: {
          ...prev.settings,
          ...league.settings
        }
      }))
    })

    socket.on('player_joined_league', ({ players }) => {
      setLeague(prev => ({
        ...prev,
        players: players.map(player => ({
          id: player.id,
          username: player.username,
          score: player.score,
          isHost: player.id === prev.host
        }))
      }))
    })

    return () => {
      socket.off('league_updated')
      socket.off('player_joined_league')
      socket.off('league_details')
      socket.off('error')
    }
  }, [leagueId, location.state, socket, isConnected, user.name])

  const handleStartRound = () => {
    // Show modal to choose round leader selection method
    setShowRoundLeaderModal(true)
  }

  const handleRandomAssign = () => {
    // Randomly select a Round Leader from players
    const randomIndex = Math.floor(Math.random() * league.players.length)
    const selectedPlayer = league.players[randomIndex]
    setSelectedRoundLeader(selectedPlayer)
    setShowRoundLeaderModal(false)
    
    // Create a theme for the round
    const newTheme = {
      id: `theme${new Date().getTime()}`,
      title: 'Round Challenge',
      description: 'This round\'s music challenge',
      status: 'active',
      submissions: 0,
      deadline: new Date(new Date().getTime() + (league.settings.submissionTime * 60 * 60 * 1000)).toISOString()
    }
    
    setLeague(prev => ({ 
      ...prev, 
      currentTheme: newTheme,
      currentRound: prev.currentRound + 1
    }))
    
    alert(`Round Leader randomly selected: ${selectedPlayer.username}\nRound started!`)
  }

  const handlePickLeader = () => {
    // Show player selection list
    setShowRoundLeaderModal(false)
    setShowPlayerSelection(true)
  }

  const handleSelectPlayer = (player) => {
    setSelectedRoundLeader(player)
    setShowPlayerSelection(false)
    
    // Create a theme for the round
    const newTheme = {
      id: `theme${new Date().getTime()}`,
      title: 'Round Challenge',
      description: 'This round\'s music challenge',
      status: 'active',
      submissions: 0,
      deadline: new Date(new Date().getTime() + (league.settings.submissionTime * 60 * 60 * 1000)).toISOString()
    }
    
    setLeague(prev => ({ 
      ...prev, 
      currentTheme: newTheme,
      currentRound: prev.currentRound + 1
    }))
    
    alert(`Round Leader selected: ${player.username}\nRound started!`)
  }

  const handleStartLeague = () => {
    // In production, this would start the league
    setLeague(prev => ({ ...prev, status: 'active' }))
    alert('League started! First round beginning.')
  }

  const handleEditRules = () => {
    setEditedSettings({ ...league.settings })
    setIsEditingRules(true)
  }

  const handleSaveRules = () => {
    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }

    // Convert percentage back to decimal for server
    const serverSettings = {
      ...editedSettings,
      overrideThreshold: editedSettings.overrideThreshold / 100
    }

    socket.emit('update_league', { 
      leagueId, 
      settings: serverSettings 
    })

    socket.once('league_updated', ({ league }) => {
      setLeague(prev => ({ ...prev, settings: editedSettings }))
      setIsEditingRules(false)
      alert('League rules updated!')
    })

    socket.once('error', ({ message }) => {
      console.error('Error updating league:', message)
      alert(`Failed to update league: ${message}`)
    })
  }

  const handleCancelEditRules = () => {
    setIsEditingRules(false)
    setEditedSettings(null)
  }

  const handleLeaveLeague = () => {
    if (confirm('Are you sure you want to leave this league?')) {
      navigate('/dashboard')
    }
  }

  const handleInvitePlayer = () => {
    // Generate a simple 6-digit league code for testing
    const leagueCode = Math.random().toString(36).substring(2, 8).toUpperCase()
    const inviteLink = `${window.location.origin}/league/${leagueId}?code=${leagueCode}`
    
    // For testing purposes, show the code instead of copying to clipboard
    alert(`Share this league code with your friends:\n\n${leagueCode}\n\nOr share this link:\n${inviteLink}`)
  }

  const handleSubmitSong = () => {
    if (!spotifyUri.trim() || !songTitle.trim() || !artist.trim()) {
      alert('Please fill in all fields')
      return
    }
    
    const submission = {
      id: `sub_${new Date().getTime()}`,
      spotifyUri,
      songTitle,
      artist,
      submittedAt: new Date().toISOString(),
      userId: user.id,
      username: user.name
    }
    
    // In production, this would submit to backend
    console.log('Submitting song:', submission)
    setUserSubmission(submission)
    setShowSubmitModal(false)
    setSpotifyUri('')
    setSongTitle('')
    setArtist('')
    setIsEditing(false)
  }

  const handleEditSubmission = () => {
    if (userSubmission) {
      setSpotifyUri(userSubmission.spotifyUri)
      setSongTitle(userSubmission.songTitle)
      setArtist(userSubmission.artist)
      setIsEditing(true)
      setShowSubmitModal(true)
    }
  }

  if (!league) {
    return <div className="loading">Loading league...</div>
  }

  return (
    <div className="league-view-page">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      
      <header className="league-header">
        <div className="header-content">
          <button 
            className="back-button"
            onClick={() => navigate('/dashboard')}
            aria-label="Go back to dashboard"
          >
            ← Dashboard
          </button>
          
          <div className="league-info">
            <h1>{league.name}</h1>
            <p className="league-description">{league.description}</p>
            <div className="league-meta">
              <span className={`status-badge ${league.status}`}>
                {league.status}
              </span>
              <span className="round-info">Round {league.currentRound}/{league.settings.totalRounds}</span>
              <span className="player-count">{league.players.length} players</span>
            </div>
          </div>

          <div className="header-actions">
            {timeRemaining !== null && timeRemaining > 0 && (
              <div className="countdown-timer">
                <span className="timer-icon">⏱️</span>
                <span className="timer-text">
                  {Math.floor(timeRemaining / (1000 * 60 * 60))}h {Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60))}m {Math.floor((timeRemaining % (1000 * 60)) / 1000)}s
                </span>
              </div>
            )}
            <button 
              className="action-button"
              onClick={handleInvitePlayer}
              aria-label="Invite players to league"
            >
              Invite Players
            </button>
            <button 
              className="action-button secondary"
              onClick={() => navigate('/account')}
              aria-label="Go to account"
            >
              Account
            </button>
            {league.players.find(p => p.id === user.id)?.isHost && (
              <button 
                className="action-button primary"
                onClick={handleStartRound}
                aria-label="Start new round for submissions"
              >
                Start Round
              </button>
            )}
          </div>
        </div>
      </header>

      <main id="main-content" className="league-main">
        <div className="league-content">
          {/* Main Content Area */}
          <div className="league-main-content">
            {activeTab === 'overview' && (
              <section className="tab-content">
                <h2>League Overview</h2>
                
                {league.status === 'setup' && (
                  /* Setup State - Host can invite players */
                  <div className="setup-state">
                    <div className="setup-icon" aria-hidden="true">🎯</div>
                    <h3>League Setup</h3>
                    <p>Invite players to join your league before starting the first round.</p>
                    
                    <div className="setup-actions">
                      <button 
                        className="setup-button primary"
                        onClick={handleInvitePlayer}
                      >
                        Invite Players
                      </button>
                      <button 
                        className="setup-button secondary"
                        onClick={handleStartLeague}
                        disabled={league.players.length < 1}
                      >
                        Start League
                      </button>
                    </div>
                    
                    <div className="setup-info">
                      <p>Players joined: {league.players.length}</p>
                      <p className="setup-hint">League can start with 1 player for testing</p>
                    </div>
                  </div>
                )}

                {league.status === 'setup' && !league.players.find(p => p.id === user.id)?.isHost && (
                  /* Waiting State - Non-host waiting for league to start */
                  <div className="waiting-state">
                    <div className="waiting-icon" aria-hidden="true">⏳</div>
                    <h3>Waiting for Host</h3>
                    <p>The host is setting up the league. You'll be notified when it starts.</p>
                    
                    <div className="waiting-info">
                      <p>Players joined: {league.players.length}</p>
                      <p>League status: Setup in progress</p>
                    </div>
                  </div>
                )}

                {league.status === 'active' && league.currentTheme && selectedRoundLeader && (
                  /* Current Round */
                  <div className="current-theme-card">
                    <div className="theme-header">
                      <h3>Current Theme</h3>
                      <div className="theme-meta">
                        <span className="theme-status">Active</span>
                        <span className="round-leader-badge">Round Leader: {selectedRoundLeader.username}</span>
                      </div>
                    </div>
                    <div className="theme-body">
                      <h4>{league.currentTheme.title}</h4>
                      <p className="theme-description">{league.currentTheme.description}</p>
                      
                      <div className="theme-stats">
                        <div className="theme-stat">
                          <span className="stat-label">Submissions</span>
                          <span className="stat-value">{league.currentTheme.submissions}</span>
                        </div>
                        <div className="theme-stat">
                          <span className="stat-label">Deadline</span>
                          <span className="stat-value">
                            {new Date(league.currentTheme.deadline).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      <button 
                        className="view-round-button"
                        onClick={() => setActiveTab('round')}
                      >
                        View Round →
                      </button>

                      {userSubmission ? (
                        <div className="user-submission">
                          <div className="submission-header">
                            <h5>Your Submission</h5>
                            <span className="submitted-time">
                              Submitted {new Date(userSubmission.submittedAt).toLocaleTimeString()}
                            </span>
                          </div>
                          <div className="submission-details">
                            <div className="submission-detail">
                              <span className="detail-label">Song:</span>
                              <span className="detail-value">{userSubmission.songTitle}</span>
                            </div>
                            <div className="submission-detail">
                              <span className="detail-label">Artist:</span>
                              <span className="detail-value">{userSubmission.artist}</span>
                            </div>
                            <div className="submission-detail">
                              <span className="detail-label">Spotify URI:</span>
                              <span className="detail-value">{userSubmission.spotifyUri}</span>
                            </div>
                          </div>
                          <div className="submission-actions">
                            <button 
                              className="edit-button"
                              onClick={handleEditSubmission}
                              aria-label="Edit your submission"
                            >
                              Edit Submission
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button 
                          className="theme-action-button"
                          onClick={() => setShowSubmitModal(true)}
                        >
                          Submit Song
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {league.status === 'active' && !league.currentTheme && (
                  /* No Active Round - Host can start round */
                  <div className="no-theme-card">
                    <div className="no-theme-icon" aria-hidden="true">🎵</div>
                    <h3>No Active Round</h3>
                    <p>Waiting for the host to start a new round.</p>
                    {league.players.find(p => p.id === user.id)?.isHost && (
                      <button 
                        className="theme-action-button"
                        onClick={handleStartRound}
                      >
                        Start Round
                      </button>
                    )}
                  </div>
                )}

                {/* Leaderboard */}
                <div className="leaderboard-card">
                  <h3>Leaderboard</h3>
                  <div className="leaderboard-list">
                    {league.players
                      .sort((a, b) => b.score - a.score)
                      .map((player, index) => (
                        <div key={player.id} className="leaderboard-item">
                          <span className="rank">{index + 1}</span>
                          <span className="player-name">{player.username}</span>
                          {player.isHost && <span className="host-badge">Host</span>}
                          <span className="score">{player.score} pts</span>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Quick Stats */}
                <div className="stats-grid">
                  <div className="stat-card">
                    <div className="stat-icon" aria-hidden="true">🎵</div>
                    <h4>Total Songs</h4>
                    <p>{league.history.reduce((sum, h) => sum + (h.totalSubmissions || 0), 0) + (league.currentTheme?.submissions || 0)} submitted</p>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon" aria-hidden="true">🏆</div>
                    <h4>Themes Played</h4>
                    <p>{league.history.length} completed</p>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon" aria-hidden="true">⏱️</div>
                    <h4>Time Remaining</h4>
                    <p>{league.currentTheme ? `${Math.ceil((new Date(league.currentTheme.deadline) - new Date()) / (1000 * 60 * 60))} hours` : 'No active theme'}</p>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon" aria-hidden="true">👥</div>
                    <h4>Active Players</h4>
                    <p>{league.players.length}/{league.settings.maxPlayers}</p>
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'round' && league.currentTheme && (
              <section className="tab-content">
                <div className="round-header">
                  <h2>Round {league.currentRound}</h2>
                  {timeRemaining !== null && timeRemaining > 0 && (
                    <div className="round-countdown">
                      <span className="countdown-icon">⏱️</span>
                      <span className="countdown-text">
                        {Math.floor(timeRemaining / (1000 * 60 * 60))}h {Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60))}m {Math.floor((timeRemaining % (1000 * 60)) / 1000)}s remaining
                      </span>
                    </div>
                  )}
                </div>

                <div className="round-content">
                  {/* Round Info Card */}
                  <div className="round-info-card">
                    <div className="round-info-header">
                      <h3>Current Theme</h3>
                      <span className="round-leader-badge">
                        Round Leader: {selectedRoundLeader?.username || 'Loading...'}
                      </span>
                    </div>
                    <div className="round-info-body">
                      <h4>{league.currentTheme.title}</h4>
                      <p className="round-description">{league.currentTheme.description}</p>
                      <div className="round-stats">
                        <div className="round-stat">
                          <span className="stat-label">Submissions</span>
                          <span className="stat-value">{league.currentTheme.submissions}</span>
                        </div>
                        <div className="round-stat">
                          <span className="stat-label">Deadline</span>
                          <span className="stat-value">
                            {new Date(league.currentTheme.deadline).toLocaleDateString()} at {new Date(league.currentTheme.deadline).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Submissions Section */}
                  <div className="submissions-section">
                    <h3>Submissions</h3>
                    <p className="submissions-count">{league.currentTheme.submissions} player(s) have submitted songs</p>
                    
                    <div className="submissions-list">
                      {league.players.filter(p => p.id !== selectedRoundLeader?.id).map(player => (
                        <div key={player.id} className="submission-item">
                          <div className="submission-player">
                            <span className="submission-avatar" aria-hidden="true">{player.username[0]}</span>
                            <span className="submission-name">{player.username}</span>
                            <span className="submission-status">
                              {userSubmission ? 'Submitted' : 'Pending'}
                            </span>
                          </div>
                          <div className="submission-song">
                            {userSubmission ? (
                              <>
                                <span className="song-title">{userSubmission.songTitle}</span>
                                <span className="song-artist">by {userSubmission.artist}</span>
                              </>
                            ) : (
                              <span className="no-submission">No song submitted yet</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* User's Submission */}
                  <div className="user-submission-card">
                    <h3>Your Submission</h3>
                    {userSubmission ? (
                      <div className="user-submission-content">
                        <div className="submission-details">
                          <div className="submission-detail">
                            <span className="detail-label">Song:</span>
                            <span className="detail-value">{userSubmission.songTitle}</span>
                          </div>
                          <div className="submission-detail">
                            <span className="detail-label">Artist:</span>
                            <span className="detail-value">{userSubmission.artist}</span>
                          </div>
                          <div className="submission-detail">
                            <span className="detail-label">Spotify URI:</span>
                            <span className="detail-value">{userSubmission.spotifyUri}</span>
                          </div>
                          <div className="submission-detail">
                            <span className="detail-label">Submitted:</span>
                            <span className="detail-value">{new Date(userSubmission.submittedAt).toLocaleString()}</span>
                          </div>
                        </div>
                        <button 
                          className="edit-button"
                          onClick={handleEditSubmission}
                        >
                          Edit Submission
                        </button>
                      </div>
                    ) : (
                      <div className="no-submission-content">
                        <p>You haven't submitted a song for this round yet.</p>
                        <button 
                          className="submit-button"
                          onClick={() => setShowSubmitModal(true)}
                        >
                          Submit Song
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'round' && !league.currentTheme && (
              <section className="tab-content">
                <div className="no-round-state">
                  <div className="no-round-icon" aria-hidden="true">🎵</div>
                  <h3>No Active Round</h3>
                  <p>Wait for the host to start a new round.</p>
                </div>
              </section>
            )}

            {activeTab === 'participants' && (
              <section className="tab-content">
                <h2>Participants</h2>
                
                <div className="participants-list">
                  {league.players
                    .sort((a, b) => b.score - a.score)
                    .map((player, index) => (
                    <article key={player.id} className="participant-card">
                      <div className="participant-header">
                        <div className="participant-info">
                          <span className="participant-name">{player.username}</span>
                          {player.isHost && <span className="host-badge">Host</span>}
                        </div>
                        <div className="participant-score">
                          <span className="score-value">{player.score}</span>
                          <span className="score-label">points</span>
                        </div>
                      </div>
                      
                      <div className="participant-stats">
                        <div className="mini-stat">
                          <span className="mini-label">Rounds Won</span>
                          <span className="mini-value">{Math.floor(player.score / league.settings.czarPoints)}</span>
                        </div>
                        <div className="mini-stat">
                          <span className="mini-label">Songs Submitted</span>
                          <span className="mini-value">{league.currentRound}</span>
                        </div>
                        <div className="mini-stat">
                          <span className="mini-label">Current Rank</span>
                          <span className="mini-value">#{index + 1}</span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>

                <div className="participants-footer">
                  <button className="invite-button" onClick={handleInvitePlayer}>
                    Invite More Players
                  </button>
                </div>
              </section>
            )}

            {activeTab === 'history' && (
              <section className="tab-content">
                <h2>Theme History</h2>
                
                <div className="history-list">
                  {league.history.map((theme, index) => (
                    <article key={theme.id} className="history-item">
                      <div className="history-header">
                        <div className="round-number">Round {index + 1}</div>
                        <div className="completion-date">
                          {new Date(theme.completedAt).toLocaleDateString('en-US', { 
                            weekday: 'short', 
                            year: 'numeric', 
                            month: 'short', 
                            day: 'numeric' 
                          })}
                        </div>
                      </div>
                      
                      <div className="history-content">
                        <h3>{theme.title}</h3>
                        <div className="history-stats">
                          <div className="history-stat">
                            <span className="stat-label">Submissions:</span>
                            <span className="stat-value">{theme.totalSubmissions}</span>
                          </div>
                          <div className="history-stat">
                            <span className="stat-label">Points Awarded:</span>
                            <span className="stat-value">{theme.winningPoints}</span>
                          </div>
                        </div>
                        <div className="winner-section">
                          <span className="winner-label">Winner:</span>
                          <span className="winner-name">{theme.winner}</span>
                        </div>
                        <div className="winning-song">
                          <span className="song-label">Winning Song:</span>
                          <span className="song-title">{theme.song}</span>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>

                {league.history.length === 0 && (
                  <div className="empty-state">
                    <div className="empty-icon" aria-hidden="true">📜</div>
                    <h3>No history yet</h3>
                    <p>Theme history will appear here as rounds are completed</p>
                  </div>
                )}
              </section>
            )}

            {activeTab === 'rules' && (
              <section className="tab-content">
                <div className="rules-header">
                  <h2>League Rules</h2>
                  {league.players.find(p => p.id === user.id)?.isHost && !isEditingRules && (
                    <button 
                      className="edit-rules-button"
                      onClick={handleEditRules}
                    >
                      Edit Rules
                    </button>
                  )}
                </div>
                
                {isEditingRules ? (
                  <div className="rules-edit-form">
                    <div className="rules-section">
                      <h3>Game Settings</h3>
                      <div className="form-row">
                        <label>Total Rounds:</label>
                        <input 
                          type="number" 
                          value={editedSettings.totalRounds}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, totalRounds: parseInt(e.target.value) }))}
                          min="1"
                          max="20"
                        />
                      </div>
                      <div className="form-row">
                        <label>Max Players:</label>
                        <input 
                          type="number" 
                          value={editedSettings.maxPlayers}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, maxPlayers: parseInt(e.target.value) }))}
                          min="2"
                          max="50"
                        />
                      </div>
                      <div className="form-row">
                        <label>Min Players to Start:</label>
                        <input 
                          type="number" 
                          value={editedSettings.minPlayers}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, minPlayers: parseInt(e.target.value) }))}
                          min="1"
                          max="10"
                        />
                      </div>
                    </div>

                    <div className="rules-section">
                      <h3>Round Leader Rules</h3>
                      <div className="form-row">
                        <label>Points for Leader Pick:</label>
                        <input 
                          type="number" 
                          value={editedSettings.czarPoints}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, czarPoints: parseInt(e.target.value) }))}
                          min="1"
                          max="10"
                        />
                      </div>
                      <div className="form-row checkbox">
                        <label>
                          <input 
                            type="checkbox" 
                            checked={editedSettings.anonymousCzar}
                            onChange={(e) => setEditedSettings(prev => ({ ...prev, anonymousCzar: e.target.checked }))}
                          />
                          Anonymous Leader
                        </label>
                      </div>
                      <div className="form-row checkbox">
                        <label>
                          <input 
                            type="checkbox" 
                            checked={editedSettings.allowSkipCzar}
                            onChange={(e) => setEditedSettings(prev => ({ ...prev, allowSkipCzar: e.target.checked }))}
                          />
                          Allow Skip Leader
                        </label>
                      </div>
                    </div>

                    <div className="rules-section">
                      <h3>Jury Rules</h3>
                      <div className="form-row">
                        <label>Max Jury Points:</label>
                        <input 
                          type="number" 
                          value={editedSettings.maxJuryPoints}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, maxJuryPoints: parseInt(e.target.value) }))}
                          min="1"
                          max="10"
                        />
                      </div>
                      <div className="form-row checkbox">
                        <label>
                          <input 
                            type="checkbox" 
                            checked={editedSettings.allowDownvotes}
                            onChange={(e) => setEditedSettings(prev => ({ ...prev, allowDownvotes: e.target.checked }))}
                          />
                          Allow Downvotes
                        </label>
                      </div>
                      <div className="form-row">
                        <label>Downvote Cost:</label>
                        <input 
                          type="number" 
                          value={editedSettings.downvoteCost}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, downvoteCost: parseInt(e.target.value) }))}
                          min="0"
                          max="5"
                        />
                      </div>
                    </div>

                    <div className="rules-section">
                      <h3>Override Rules</h3>
                      <div className="form-row checkbox">
                        <label>
                          <input 
                            type="checkbox" 
                            checked={editedSettings.allowOverride}
                            onChange={(e) => setEditedSettings(prev => ({ ...prev, allowOverride: e.target.checked }))}
                          />
                          Allow Override
                        </label>
                      </div>
                      <div className="form-row">
                        <label>Override Threshold (%):</label>
                        <input 
                          type="number" 
                          value={editedSettings.overrideThreshold}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, overrideThreshold: parseInt(e.target.value) }))}
                          min="50"
                          max="100"
                        />
                      </div>
                    </div>

                    <div className="rules-section">
                      <h3>Timing</h3>
                      <div className="form-row">
                        <label>Submission Time (hours):</label>
                        <input 
                          type="number" 
                          value={editedSettings.submissionTime}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, submissionTime: parseInt(e.target.value) }))}
                          min="1"
                          max="168"
                        />
                      </div>
                      <div className="form-row">
                        <label>Voting Time (hours):</label>
                        <input 
                          type="number" 
                          value={editedSettings.votingTime}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, votingTime: parseInt(e.target.value) }))}
                          min="1"
                          max="168"
                        />
                      </div>
                      <div className="form-row checkbox">
                        <label>
                          <input 
                            type="checkbox" 
                            checked={editedSettings.autoStart}
                            onChange={(e) => setEditedSettings(prev => ({ ...prev, autoStart: e.target.checked }))}
                          />
                          Auto-Start
                        </label>
                      </div>
                    </div>

                    <div className="rules-section">
                      <h3>Additional Features</h3>
                      <div className="form-row checkbox">
                        <label>
                          <input 
                            type="checkbox" 
                            checked={editedSettings.enableChat}
                            onChange={(e) => setEditedSettings(prev => ({ ...prev, enableChat: e.target.checked }))}
                          />
                          Enable Chat
                        </label>
                      </div>
                      <div className="form-row checkbox">
                        <label>
                          <input 
                            type="checkbox" 
                            checked={editedSettings.enableSongPreview}
                            onChange={(e) => setEditedSettings(prev => ({ ...prev, enableSongPreview: e.target.checked }))}
                          />
                          Enable Song Preview
                        </label>
                      </div>
                      <div className="form-row checkbox">
                        <label>
                          <input 
                            type="checkbox" 
                            checked={editedSettings.showVoterIdentity}
                            onChange={(e) => setEditedSettings(prev => ({ ...prev, showVoterIdentity: e.target.checked }))}
                          />
                          Show Voter Identity
                        </label>
                      </div>
                    </div>

                    <div className="rules-section">
                      <h3>Topic Settings</h3>
                      <div className="form-row">
                        <label>Topic Selection:</label>
                        <select 
                          value={editedSettings.topicSelection}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, topicSelection: e.target.value }))}
                        >
                          <option value="czar">Round Leader Chooses</option>
                          <option value="random">Random Selection</option>
                          <option value="vote">Player Vote</option>
                        </select>
                      </div>
                      <div className="form-row checkbox">
                        <label>
                          <input 
                            type="checkbox" 
                            checked={editedSettings.allowCustomTopics}
                            onChange={(e) => setEditedSettings(prev => ({ ...prev, allowCustomTopics: e.target.checked }))}
                          />
                          Allow Custom Topics
                        </label>
                      </div>
                      <div className="form-row textarea-row">
                        <label>Preset Topics (one per line):</label>
                        <textarea 
                          value={editedSettings.presetTopics && editedSettings.presetTopics.length > 0 ? editedSettings.presetTopics.join('\n') : ''}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, presetTopics: e.target.value.split('\n').filter(t => t.trim()) }))}
                          rows="4"
                          placeholder="Enter preset topics, one per line"
                        />
                      </div>
                    </div>

                    <div className="form-actions">
                      <button 
                        className="cancel-button"
                        onClick={handleCancelEditRules}
                      >
                        Cancel
                      </button>
                      <button 
                        className="save-button"
                        onClick={handleSaveRules}
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="rules-container">
                    <div className="rules-section">
                      <h3>Game Settings</h3>
                      <ul className="rules-list">
                        <li><strong>Total Rounds:</strong> {league.settings.totalRounds}</li>
                        <li><strong>Max Players:</strong> {league.settings.maxPlayers}</li>
                        <li><strong>Min Players to Start:</strong> {league.settings.minPlayers}</li>
                      </ul>
                    </div>

                    <div className="rules-section">
                      <h3>Round Leader Rules</h3>
                      <ul className="rules-list">
                        <li><strong>Points for Leader Pick:</strong> {league.settings.czarPoints}</li>
                        <li><strong>Anonymous Leader:</strong> {league.settings.anonymousCzar ? 'Yes' : 'No'}</li>
                        <li><strong>Allow Skip Leader:</strong> {league.settings.allowSkipCzar ? 'Yes' : 'No'}</li>
                      </ul>
                    </div>

                    <div className="rules-section">
                      <h3>Jury Rules</h3>
                      <ul className="rules-list">
                        <li><strong>Max Jury Points:</strong> {league.settings.maxJuryPoints}</li>
                        <li><strong>Allow Downvotes:</strong> {league.settings.allowDownvotes ? 'Yes' : 'No'}</li>
                        <li><strong>Downvote Cost:</strong> {league.settings.downvoteCost} points</li>
                      </ul>
                    </div>

                    <div className="rules-section">
                      <h3>Override Rules</h3>
                      <ul className="rules-list">
                        <li><strong>Allow Override:</strong> {league.settings.allowOverride ? 'Yes' : 'No'}</li>
                        <li><strong>Override Threshold:</strong> {league.settings.overrideThreshold}%</li>
                      </ul>
                    </div>

                    <div className="rules-section">
                      <h3>Timing</h3>
                      <ul className="rules-list">
                        <li><strong>Submission Time:</strong> {league.settings.submissionTime} hours</li>
                        <li><strong>Voting Time:</strong> {league.settings.votingTime} hours</li>
                        <li><strong>Auto-Start:</strong> {league.settings.autoStart ? 'Yes' : 'No'}</li>
                      </ul>
                    </div>

                    <div className="rules-section">
                      <h3>Additional Features</h3>
                      <ul className="rules-list">
                        <li><strong>Chat:</strong> {league.settings.enableChat ? 'Enabled' : 'Disabled'}</li>
                        <li><strong>Song Preview:</strong> {league.settings.enableSongPreview ? 'Enabled' : 'Disabled'}</li>
                        <li><strong>Show Voter Identity:</strong> {league.settings.showVoterIdentity ? 'Yes' : 'No'}</li>
                      </ul>
                    </div>

                    <div className="rules-section">
                      <h3>Topic Settings</h3>
                      <ul className="rules-list">
                        <li><strong>Topic Selection:</strong> {league.settings.topicSelection === 'czar' ? 'Round Leader Chooses' : league.settings.topicSelection === 'random' ? 'Random Selection' : 'Player Vote'}</li>
                        <li><strong>Allow Custom Topics:</strong> {league.settings.allowCustomTopics ? 'Yes' : 'No'}</li>
                        <li><strong>Preset Topics:</strong> {league.settings.presetTopics?.length || 0} topics available</li>
                        {league.settings.presetTopics && league.settings.presetTopics.length > 0 && (
                          <li><strong>Topics:</strong> {league.settings.presetTopics.join(', ')}</li>
                        )}
                      </ul>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>

          {/* Sidebar with Navigation */}
          <aside className="league-sidebar">
            <nav className="league-nav" aria-label="League navigation">
              <button 
                className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveTab('overview')}
              >
                Overview
              </button>
              {league.currentTheme && (
                <button 
                  className={`nav-item ${activeTab === 'round' ? 'active' : ''}`}
                  onClick={() => setActiveTab('round')}
                >
                  Round
                </button>
              )}
              <button 
                className={`nav-item ${activeTab === 'participants' ? 'active' : ''}`}
                onClick={() => setActiveTab('participants')}
              >
                Participants
              </button>
              <button 
                className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}
                onClick={() => setActiveTab('history')}
              >
                History
              </button>
              <button 
                className={`nav-item ${activeTab === 'rules' ? 'active' : ''}`}
                onClick={() => setActiveTab('rules')}
              >
                Rules
              </button>
            </nav>

            <div className="sidebar-footer">
              {league.players.find(p => p.id === user.id)?.isHost ? (
                <button 
                  className="leave-button delete"
                  onClick={() => {
                    if (confirm('Are you sure you want to delete this league? This cannot be undone.')) {
                      navigate('/dashboard')
                    }
                  }}
                  aria-label="Delete league"
                >
                  Delete League
                </button>
              ) : (
                <button 
                  className="leave-button"
                  onClick={handleLeaveLeague}
                  aria-label="Leave league"
                >
                  Leave League
                </button>
              )}
            </div>
          </aside>
        </div>
      </main>

      {showSubmitModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="submit-modal-title">
          <div className="modal-content">
            <div className="modal-header">
              <h2 id="submit-modal-title">{isEditing ? 'Edit Song' : 'Submit Song'}</h2>
              <button 
                className="close-button"
                onClick={() => {
                  setShowSubmitModal(false)
                  setIsEditing(false)
                  setSpotifyUri('')
                  setSongTitle('')
                  setArtist('')
                }}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>
            
            <form className="modal-body" onSubmit={(e) => { e.preventDefault(); handleSubmitSong(); }}>
              <div className="form-group">
                <label htmlFor="spotify-uri">Spotify URI *</label>
                <input
                  id="spotify-uri"
                  type="text"
                  value={spotifyUri}
                  onChange={(e) => setSpotifyUri(e.target.value)}
                  placeholder="spotify:track:..."
                  required
                />
                <small className="form-hint">Find the Spotify URI in Spotify by sharing → Copy Spotify URI</small>
              </div>
              
              <div className="form-group">
                <label htmlFor="song-title">Song Title *</label>
                <input
                  id="song-title"
                  type="text"
                  value={songTitle}
                  onChange={(e) => setSongTitle(e.target.value)}
                  placeholder="Enter song title"
                  required
                  maxLength={100}
                />
              </div>

              <div className="form-group">
                <label htmlFor="artist">Artist *</label>
                <input
                  id="artist"
                  type="text"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="Enter artist name"
                  required
                  maxLength={100}
                />
              </div>

              <div className="modal-actions">
                <button 
                  type="button"
                  className="cancel-button"
                  onClick={() => {
                    setShowSubmitModal(false)
                    setIsEditing(false)
                    setSpotifyUri('')
                    setSongTitle('')
                    setArtist('')
                  }}
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="submit-button"
                  disabled={!spotifyUri.trim() || !songTitle.trim() || !artist.trim()}
                >
                  {isEditing ? 'Update Song' : 'Submit Song'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRoundLeaderModal && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="round-leader-modal-title">
          <div className="modal-content">
            <div className="modal-header">
              <h2 id="round-leader-modal-title">Select Round Leader</h2>
              <button 
                className="close-button"
                onClick={() => setShowRoundLeaderModal(false)}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>
            
            <div className="modal-body">
              <p>Choose how to select the Round Leader for this round:</p>
              
              <div className="leader-selection-options">
                <button 
                  className="leader-option-button"
                  onClick={handleRandomAssign}
                >
                  <div className="option-icon">🎲</div>
                  <div className="option-content">
                    <h3>Randomly Assign</h3>
                    <p>Let the system randomly pick a Round Leader from the league players</p>
                  </div>
                </button>
                
                <button 
                  className="leader-option-button"
                  onClick={handlePickLeader}
                >
                  <div className="option-icon">👤</div>
                  <div className="option-content">
                    <h3>Pick Round Leader</h3>
                    <p>Manually select a specific player to be the Round Leader</p>
                  </div>
                </button>
              </div>
            </div>

            <div className="modal-actions">
              <button 
                className="cancel-button"
                onClick={() => setShowRoundLeaderModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showPlayerSelection && (
        <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="player-selection-modal-title">
          <div className="modal-content">
            <div className="modal-header">
              <h2 id="player-selection-modal-title">Pick Round Leader</h2>
              <button 
                className="close-button"
                onClick={() => setShowPlayerSelection(false)}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>
            
            <div className="modal-body">
              <p>Select a player to be the Round Leader for this round:</p>
              <div className="player-selection-list">
                {league.players.map(player => (
                  <button 
                    key={player.id}
                    className="player-selection-item"
                    onClick={() => handleSelectPlayer(player)}
                  >
                    <span className="player-avatar" aria-hidden="true">{player.username[0]}</span>
                    <span className="player-name">{player.username}</span>
                    {player.isHost && <span className="host-badge-small">Host</span>}
                    <span className="select-icon">→</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="modal-actions">
              <button 
                className="cancel-button"
                onClick={() => setShowPlayerSelection(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default LeagueView
