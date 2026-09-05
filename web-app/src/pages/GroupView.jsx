import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useSocket } from '../context/SocketContext'
import { useUser } from '../context/UserContext'
import { useModalA11y } from '../hooks/useModalA11y'
import './GroupView.css'

// Server player records carry both a transient socket id (`id`) and a stable
// `userId`. The client only ever needs the stable identity to check who's
// who (e.g. host), so `id` here is remapped to `userId`.
function mapPlayers(players, host) {
  return players.map(player => ({
    id: player.userId,
    username: player.username,
    score: player.score,
    isHost: player.userId === host
  }))
}

// Shared transform from a raw server group (as returned by get_group and
// join_group) into the shape this component renders.
function normalizeGroupData(group) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    host: group.host,
    settings: {
      totalRounds: group.settings.totalRounds || 6,
      maxPlayers: group.settings.maxPlayers || 12,
      minPlayers: group.settings.minPlayers || 2,
      czarPoints: group.settings.czarPoints || 5,
      allowSkipCzar: group.settings.allowSkipCzar !== false,
      anonymousCzar: group.settings.anonymousCzar !== false,
      maxJuryPoints: group.settings.maxJuryPoints || 3,
      allowDownvotes: group.settings.allowDownvotes !== false,
      downvoteCost: group.settings.downvoteCost || 1,
      allowOverride: group.settings.allowOverride !== false,
      overrideThreshold: group.settings.overrideThreshold || 70, // whole percentage; no conversion
      submissionTime: group.settings.submissionTime || 24,
      votingTime: group.settings.votingTime || 24,
      autoStart: group.settings.autoStart || false,
      topicSelection: group.settings.topicSelection || 'czar',
      allowCustomTopics: group.settings.allowCustomTopics !== false,
      presetTopics: group.settings.presetTopics || [],
      enableChat: group.settings.enableChat || false,
      enableSongPreview: group.settings.enableSongPreview !== false,
      showVoterIdentity: group.settings.showVoterIdentity || false
    },
    status: group.status,
    currentRound: group.currentRound,
    players: mapPlayers(group.players, group.host),
    currentTheme: group.currentTheme || null,
    history: group.history || []
  }
}

function GroupView() {
  const { groupId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { socket, isConnected } = useSocket()
  const { user } = useUser()
  
  const [group, setGroup] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [spotifyUri, setSpotifyUri] = useState('')
  const [songTitle, setSongTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [userSubmission, setUserSubmission] = useState(null)
  const [isEditing, setIsEditing] = useState(false)
  const [isEditingRules, setIsEditingRules] = useState(false)
  const [editedSettings, setEditedSettings] = useState(null)
  const [showRoundLeaderModal, setShowRoundLeaderModal] = useState(false)
  const [showPlayerSelection, setShowPlayerSelection] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState(null)
  const [isRoundLeader, setIsRoundLeader] = useState(false)
  const [selectedSubmissionId, setSelectedSubmissionId] = useState(null)
  const [votePoints, setVotePoints] = useState(1)
  const [userVote, setUserVote] = useState(null)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)

  const submitModalRef = useRef(null)
  const roundLeaderModalRef = useRef(null)
  const playerSelectionModalRef = useRef(null)
  const inviteModalRef = useRef(null)

  const closeSubmitModal = () => {
    setShowSubmitModal(false)
    setIsEditing(false)
    setSpotifyUri('')
    setSongTitle('')
    setArtist('')
  }

  useModalA11y(showSubmitModal, submitModalRef, closeSubmitModal)
  useModalA11y(showRoundLeaderModal, roundLeaderModalRef, () => setShowRoundLeaderModal(false))
  useModalA11y(showPlayerSelection, playerSelectionModalRef, () => setShowPlayerSelection(false))
  useModalA11y(showInviteModal, inviteModalRef, () => setShowInviteModal(false))

  useEffect(() => {
    // Countdown timer for round deadline
    if (group?.currentTheme?.deadline) {
      const interval = setInterval(() => {
        const now = new Date().getTime()
        const deadline = new Date(group.currentTheme.deadline).getTime()
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
  }, [group?.currentTheme?.deadline])

  // Clear per-round local state whenever a new round begins
  useEffect(() => {
    setUserSubmission(null)
    setUserVote(null)
    setSelectedSubmissionId(null)
  }, [group?.currentTheme?.id])

  useEffect(() => {
    if (!socket || !isConnected || !user) return

    // Get group data from navigation state or fetch from server
    if (location.state?.groupData) {
      const groupData = location.state.groupData
      
      // Ensure group has all required fields
      const fullGroupData = {
        ...groupData,
        settings: groupData.settings || {
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
        status: groupData.status || 'waiting',
        currentRound: groupData.currentRound || 0,
        players: groupData.players
          ? mapPlayers(groupData.players, groupData.host)
          : [{ id: user.id, username: user.name, score: 0, isHost: true }],
        currentTheme: groupData.currentTheme || null,
        history: groupData.history || []
      }
      
      setGroup(fullGroupData)
    } else if (new URLSearchParams(location.search).get('join') === 'true') {
      // Arrived via a shared invite link — join automatically. This is safe
      // to call even for an existing member (the server treats it as a
      // reconnect rather than adding a duplicate).
      socket.emit('join_group', { groupId, username: user.name, userId: user.id })

      socket.once('group_joined', ({ group, isRoundLeader: youAreRoundLeader }) => {
        setGroup(normalizeGroupData(group))
        setIsRoundLeader(!!youAreRoundLeader)
      })

      socket.once('error', ({ message }) => {
        console.error('Error joining group:', message)
        alert(`Failed to join group: ${message}`)
      })
    } else {
      // Fetch group data from server
      socket.emit('get_group', { groupId, username: user.name, userId: user.id })

      socket.once('group_details', ({ group, isRoundLeader: youAreRoundLeader }) => {
        setGroup(normalizeGroupData(group))
        setIsRoundLeader(!!youAreRoundLeader)
      })

      socket.once('error', ({ message }) => {
        console.error('Error fetching group:', message)
        alert(`Failed to load group: ${message}`)
      })
    }

    // Listen for group updates
    socket.on('group_updated', ({ group, isRoundLeader: youAreRoundLeader }) => {
      setGroup(prev => ({
        ...prev,
        ...group,
        players: mapPlayers(group.players, group.host),
        settings: {
          ...prev.settings,
          ...group.settings
        }
      }))
      if (typeof youAreRoundLeader === 'boolean') {
        setIsRoundLeader(youAreRoundLeader)
      }
    })

    socket.on('player_joined_group', ({ players }) => {
      setGroup(prev => ({
        ...prev,
        players: mapPlayers(players, prev.host)
      }))
    })

    return () => {
      socket.off('group_updated')
      socket.off('player_joined_group')
      socket.off('group_details')
      socket.off('error')
    }
  }, [groupId, location.state, location.search, socket, isConnected, user])

  const handleStartRound = () => {
    // Show modal to choose round leader selection method
    setShowRoundLeaderModal(true)
  }

  const emitStartRound = (czarUserId) => {
    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }

    socket.emit('start_round', { groupId, userId: user.id, czarUserId })

    socket.once('error', ({ message }) => {
      console.error('Error starting round:', message)
      alert(`Failed to start round: ${message}`)
    })
  }

  const handleRandomAssign = () => {
    setShowRoundLeaderModal(false)
    emitStartRound()
  }

  const handlePickLeader = () => {
    // Show player selection list
    setShowRoundLeaderModal(false)
    setShowPlayerSelection(true)
  }

  const handleSelectPlayer = (player) => {
    setShowPlayerSelection(false)
    emitStartRound(player.id) // player.id is the stable userId (see mapPlayers)
  }

  const handleStartGroup = () => {
    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }

    socket.emit('start_group', { groupId, userId: user.id })

    socket.once('group_updated', () => {
      alert('Group started! First round beginning.')
    })

    socket.once('error', ({ message }) => {
      console.error('Error starting group:', message)
      alert(`Failed to start group: ${message}`)
    })
  }

  const handleEditRules = () => {
    setEditedSettings({ ...group.settings })
    setIsEditingRules(true)
  }

  const handleSaveRules = () => {
    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }

    // overrideThreshold is a whole percentage everywhere — no conversion needed
    socket.emit('update_group', {
      groupId,
      settings: editedSettings,
      userId: user.id
    })

    socket.once('group_updated', ({ group }) => {
      setGroup(prev => ({ ...prev, settings: editedSettings }))
      setIsEditingRules(false)
      alert('Group rules updated!')
    })

    socket.once('error', ({ message }) => {
      console.error('Error updating group:', message)
      alert(`Failed to update group: ${message}`)
    })
  }

  const handleCancelEditRules = () => {
    setIsEditingRules(false)
    setEditedSettings(null)
  }

  const handleLeaveGroup = () => {
    if (confirm('Are you sure you want to leave this group?')) {
      navigate('/dashboard')
    }
  }

  const inviteLink = `${window.location.origin}/group/${groupId}?join=true`

  const handleInvitePlayer = () => {
    setShowInviteModal(true)
  }

  const handleCopyInviteLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy invite link:', err)
      alert('Could not copy the link automatically. Please copy it manually.')
    }
  }

  const handleSubmitSong = () => {
    if (!spotifyUri.trim() || !songTitle.trim() || !artist.trim()) {
      alert('Please fill in all fields')
      return
    }

    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }

    socket.emit('submit_song', { groupId, spotifyUri, songTitle, artist, userId: user.id })

    socket.once('error', ({ message }) => {
      console.error('Error submitting song:', message)
      alert(`Failed to submit song: ${message}`)
    })

    setUserSubmission({
      spotifyUri,
      songTitle,
      artist,
      submittedAt: new Date().toISOString()
    })
    setShowSubmitModal(false)
    setSpotifyUri('')
    setSongTitle('')
    setArtist('')
    setIsEditing(false)
  }

  const handleCastVote = (isDownvote = false) => {
    if (!selectedSubmissionId) return
    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }

    socket.emit('cast_vote', {
      groupId,
      submissionId: selectedSubmissionId,
      points: votePoints,
      isDownvote,
      userId: user.id
    })

    socket.once('error', ({ message }) => {
      console.error('Error casting vote:', message)
      alert(`Failed to cast vote: ${message}`)
    })

    setUserVote({ submissionId: selectedSubmissionId, isDownvote })
  }

  const handleCzarSelectWinner = () => {
    if (!selectedSubmissionId) return
    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }

    socket.emit('czar_select_winner', {
      groupId,
      submissionId: selectedSubmissionId,
      userId: user.id
    })

    socket.once('error', ({ message }) => {
      console.error('Error selecting winner:', message)
      alert(`Failed to select winner: ${message}`)
    })
  }

  if (!group) {
    return <div className="loading">Loading group...</div>
  }

  return (
    <div className="group-view-page">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      
      <header className="group-header">
        <div className="header-content">
          <button 
            className="back-button"
            onClick={() => navigate('/dashboard')}
            aria-label="Go back to dashboard"
          >
            ← Dashboard
          </button>
          
          <div className="group-info">
            <h1>{group.name}</h1>
            <p className="group-description">{group.description}</p>
            <div className="group-meta">
              <span className={`status-badge ${group.status}`}>
                {group.status}
              </span>
              <span className="round-info">Round {group.currentRound}/{group.settings.totalRounds}</span>
              <span className="player-count">{group.players.length} players</span>
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
              aria-label="Invite players to group"
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
            {group.status === 'active' && (!group.currentTheme || group.currentTheme.status === 'reveal') && group.players.find(p => p.id === user.id)?.isHost && (
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

      <main id="main-content" className="group-main">
        <div className="group-content">
          {/* Main Content Area */}
          <div className="group-main-content">
            {activeTab === 'overview' && (
              <section className="tab-content">
                <h2>Group Overview</h2>
                
                {group.status === 'setup' && (
                  /* Setup State - Host can invite players */
                  <div className="setup-state">
                    <div className="setup-icon" aria-hidden="true">🎯</div>
                    <h3>Group Setup</h3>
                    <p>Invite players to join your group before starting the first round.</p>
                    
                    <div className="setup-actions">
                      <button 
                        className="setup-button primary"
                        onClick={handleInvitePlayer}
                      >
                        Invite Players
                      </button>
                      <button 
                        className="setup-button secondary"
                        onClick={handleStartGroup}
                        disabled={group.players.length < 1}
                      >
                        Start Group
                      </button>
                    </div>
                    
                    <div className="setup-info">
                      <p>Players joined: {group.players.length}</p>
                      <p className="setup-hint">Group can start with 1 player for testing</p>
                    </div>
                  </div>
                )}

                {group.status === 'setup' && !group.players.find(p => p.id === user.id)?.isHost && (
                  /* Waiting State - Non-host waiting for group to start */
                  <div className="waiting-state">
                    <div className="waiting-icon" aria-hidden="true">⏳</div>
                    <h3>Waiting for Host</h3>
                    <p>The host is setting up the group. You'll be notified when it starts.</p>
                    
                    <div className="waiting-info">
                      <p>Players joined: {group.players.length}</p>
                      <p>Group status: Setup in progress</p>
                    </div>
                  </div>
                )}

                {group.status === 'active' && group.currentTheme && (
                  /* Current Round */
                  <div className="current-theme-card">
                    <div className="theme-header">
                      <h3>Current Theme</h3>
                      <div className="theme-meta">
                        <span className="theme-status">
                          {group.currentTheme.status === 'voting' ? 'Voting' : group.currentTheme.status === 'reveal' ? 'Results' : 'Submissions Open'}
                        </span>
                        <span className="round-leader-badge">
                          {isRoundLeader
                            ? 'You are the Round Leader'
                            : group.currentTheme.czarUsername
                              ? `Round Leader: ${group.currentTheme.czarUsername}`
                              : 'Round Leader: Anonymous'}
                        </span>
                      </div>
                    </div>
                    <div className="theme-body">
                      <h4>{group.currentTheme.title}</h4>
                      <p className="theme-description">{group.currentTheme.description}</p>

                      <div className="theme-stats">
                        <div className="theme-stat">
                          <span className="stat-label">Submissions</span>
                          <span className="stat-value">{group.currentTheme.submissionCount ?? 0}</span>
                        </div>
                        <div className="theme-stat">
                          <span className="stat-label">Deadline</span>
                          <span className="stat-value">
                            {new Date(group.currentTheme.deadline).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      <button
                        className="view-round-button"
                        onClick={() => setActiveTab('round')}
                      >
                        View Round →
                      </button>
                    </div>
                  </div>
                )}

                {group.status === 'active' && !group.currentTheme && (
                  /* No Active Round - Host can start round */
                  <div className="no-theme-card">
                    <div className="no-theme-icon" aria-hidden="true">🎵</div>
                    <h3>No Active Round</h3>
                    <p>Waiting for the host to start a new round.</p>
                    {group.players.find(p => p.id === user.id)?.isHost && (
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
                    {group.players
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
                    <p>{group.history.reduce((sum, h) => sum + (h.totalSubmissions || 0), 0) + (group.currentTheme?.submissionCount || 0)} submitted</p>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon" aria-hidden="true">🏆</div>
                    <h4>Themes Played</h4>
                    <p>{group.history.length} completed</p>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon" aria-hidden="true">⏱️</div>
                    <h4>Time Remaining</h4>
                    <p>{group.currentTheme ? `${Math.ceil((new Date(group.currentTheme.deadline) - new Date()) / (1000 * 60 * 60))} hours` : 'No active theme'}</p>
                  </div>
                  <div className="stat-card">
                    <div className="stat-icon" aria-hidden="true">👥</div>
                    <h4>Active Players</h4>
                    <p>{group.players.length}/{group.settings.maxPlayers}</p>
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'round' && group.currentTheme && (
              <section className="tab-content">
                <div className="round-header">
                  <h2>Round {group.currentRound}</h2>
                  {group.currentTheme.status === 'submission' && timeRemaining !== null && timeRemaining > 0 && (
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
                        {isRoundLeader
                          ? 'You are the Round Leader'
                          : group.currentTheme.czarUsername
                            ? `Round Leader: ${group.currentTheme.czarUsername}`
                            : 'Round Leader: Anonymous'}
                      </span>
                    </div>
                    <div className="round-info-body">
                      <h4>{group.currentTheme.title}</h4>
                      <p className="round-description">{group.currentTheme.description}</p>
                      <div className="round-stats">
                        <div className="round-stat">
                          <span className="stat-label">Submissions</span>
                          <span className="stat-value">{group.currentTheme.submissionCount ?? 0}</span>
                        </div>
                        <div className="round-stat">
                          <span className="stat-label">Deadline</span>
                          <span className="stat-value">
                            {new Date(group.currentTheme.deadline).toLocaleDateString()} at {new Date(group.currentTheme.deadline).toLocaleTimeString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Submission phase */}
                  {group.currentTheme.status === 'submission' && (
                    isRoundLeader ? (
                      <div className="user-submission-card">
                        <h3>You're the Round Leader</h3>
                        <p className="no-submission">Wait for the other players to submit their songs.</p>
                        <p className="submissions-count">{group.currentTheme.submissionCount ?? 0} submission(s) so far</p>
                      </div>
                    ) : (
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
                            </div>
                            <p className="submissions-count">Submitted — waiting for the rest of the group ({group.currentTheme.submissionCount ?? 0} so far)</p>
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
                    )
                  )}

                  {/* Voting phase */}
                  {group.currentTheme.status === 'voting' && (
                    <div className="submissions-section">
                      <h3>Vote</h3>
                      <p className="submissions-count">Submissions are anonymous until results are revealed.</p>

                      <div className="submissions-list">
                        {(group.currentTheme.submissions || []).map(submission => (
                          <button
                            key={submission.id}
                            type="button"
                            className={`submission-item ${!userVote ? 'selectable' : ''} ${selectedSubmissionId === submission.id ? 'selected' : ''}`}
                            onClick={() => setSelectedSubmissionId(submission.id)}
                            disabled={!!userVote}
                            aria-pressed={selectedSubmissionId === submission.id}
                          >
                            <div className="submission-song">
                              <span className="song-title">{submission.songTitle}</span>
                              <span className="song-artist">by {submission.artist}</span>
                            </div>
                          </button>
                        ))}
                      </div>

                      {userVote ? (
                        <p className="submissions-count">You've voted — waiting for the rest of the group.</p>
                      ) : selectedSubmissionId ? (
                        <div className="voting-actions">
                          <label>
                            Points:
                            <select value={votePoints} onChange={(e) => setVotePoints(parseInt(e.target.value))}>
                              {Array.from({ length: group.settings.maxJuryPoints || 3 }, (_, i) => i + 1).map(n => (
                                <option key={n} value={n}>{n}</option>
                              ))}
                            </select>
                          </label>
                          <button className="theme-action-button" onClick={() => handleCastVote(false)}>
                            Cast Vote
                          </button>
                          {group.settings.allowDownvotes && (
                            <button className="cancel-button" onClick={() => handleCastVote(true)}>
                              Downvote
                            </button>
                          )}
                          {isRoundLeader && (
                            <button className="btn btn-secondary" onClick={handleCzarSelectWinner}>
                              Select as Winner (Round Leader)
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="submissions-count">Select a submission above to vote.</p>
                      )}
                    </div>
                  )}

                  {/* Reveal phase */}
                  {group.currentTheme.status === 'reveal' && (
                    <div className="submissions-section">
                      <h3>Results</h3>
                      <p className="round-leader-badge">Round Leader was: {group.currentTheme.czarUsername || 'Unknown'}</p>

                      <div className="submissions-list">
                        {(group.currentTheme.submissions || []).map(submission => (
                          <div key={submission.id} className="submission-item">
                            <div className="submission-song">
                              <span className="song-title">{submission.songTitle}</span>
                              <span className="song-artist">by {submission.artist}</span>
                              {submission.wonBy && <span className="host-badge">🏆 Winner</span>}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="leaderboard-card">
                        <h3>Scores</h3>
                        <div className="leaderboard-list">
                          {group.players
                            .slice()
                            .sort((a, b) => b.score - a.score)
                            .map((player, index) => (
                              <div key={player.id} className="leaderboard-item">
                                <span className="rank">{index + 1}</span>
                                <span className="player-name">{player.username}</span>
                                <span className="score">{player.score} pts</span>
                              </div>
                            ))}
                        </div>
                      </div>

                      {group.players.find(p => p.id === user.id)?.isHost && (
                        <button className="setup-button primary" onClick={handleStartRound}>
                          Start Next Round
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </section>
            )}

            {activeTab === 'round' && !group.currentTheme && (
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
                  {group.players
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
                          <span className="mini-value">{Math.floor(player.score / group.settings.czarPoints)}</span>
                        </div>
                        <div className="mini-stat">
                          <span className="mini-label">Songs Submitted</span>
                          <span className="mini-value">{group.currentRound}</span>
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
                  {group.history.map((theme, index) => (
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

                {group.history.length === 0 && (
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
                  <h2>Group Rules</h2>
                  {group.players.find(p => p.id === user.id)?.isHost && !isEditingRules && (
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
                        <label htmlFor="rules-total-rounds">Total Rounds:</label>
                        <input
                          id="rules-total-rounds"
                          type="number"
                          value={editedSettings.totalRounds}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, totalRounds: parseInt(e.target.value) }))}
                          min="1"
                          max="20"
                        />
                      </div>
                      <div className="form-row">
                        <label htmlFor="rules-max-players">Max Players:</label>
                        <input
                          id="rules-max-players"
                          type="number"
                          value={editedSettings.maxPlayers}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, maxPlayers: parseInt(e.target.value) }))}
                          min="2"
                          max="50"
                        />
                      </div>
                      <div className="form-row">
                        <label htmlFor="rules-min-players">Min Players to Start:</label>
                        <input
                          id="rules-min-players"
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
                        <label htmlFor="rules-czar-points">Points for Leader Pick:</label>
                        <input
                          id="rules-czar-points"
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
                        <label htmlFor="rules-max-jury-points">Max Jury Points:</label>
                        <input
                          id="rules-max-jury-points"
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
                        <label htmlFor="rules-downvote-cost">Downvote Cost:</label>
                        <input
                          id="rules-downvote-cost"
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
                        <label htmlFor="rules-override-threshold">Override Threshold (%):</label>
                        <input
                          id="rules-override-threshold"
                          type="number"
                          value={editedSettings.overrideThreshold}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, overrideThreshold: parseInt(e.target.value) }))}
                          min="51"
                          max="100"
                        />
                      </div>
                    </div>

                    <div className="rules-section">
                      <h3>Timing</h3>
                      <small className="form-hint">Changes to timing apply to the next round — the round in progress keeps its original deadline.</small>
                      <div className="form-row">
                        <label htmlFor="rules-submission-time">Submission Time (hours):</label>
                        <input
                          id="rules-submission-time"
                          type="number"
                          value={editedSettings.submissionTime}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, submissionTime: parseInt(e.target.value) }))}
                          min="1"
                          max="168"
                        />
                      </div>
                      <div className="form-row">
                        <label htmlFor="rules-voting-time">Voting Time (hours):</label>
                        <input
                          id="rules-voting-time"
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
                        <label htmlFor="rules-topic-selection">Topic Selection:</label>
                        <select
                          id="rules-topic-selection"
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
                        <label htmlFor="rules-preset-topics">Preset Topics (one per line):</label>
                        <textarea
                          id="rules-preset-topics"
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
                        <li><strong>Total Rounds:</strong> {group.settings.totalRounds}</li>
                        <li><strong>Max Players:</strong> {group.settings.maxPlayers}</li>
                        <li><strong>Min Players to Start:</strong> {group.settings.minPlayers}</li>
                      </ul>
                    </div>

                    <div className="rules-section">
                      <h3>Round Leader Rules</h3>
                      <ul className="rules-list">
                        <li><strong>Points for Leader Pick:</strong> {group.settings.czarPoints}</li>
                        <li><strong>Anonymous Leader:</strong> {group.settings.anonymousCzar ? 'Yes' : 'No'}</li>
                        <li><strong>Allow Skip Leader:</strong> {group.settings.allowSkipCzar ? 'Yes' : 'No'}</li>
                      </ul>
                    </div>

                    <div className="rules-section">
                      <h3>Jury Rules</h3>
                      <ul className="rules-list">
                        <li><strong>Max Jury Points:</strong> {group.settings.maxJuryPoints}</li>
                        <li><strong>Allow Downvotes:</strong> {group.settings.allowDownvotes ? 'Yes' : 'No'}</li>
                        <li><strong>Downvote Cost:</strong> {group.settings.downvoteCost} points</li>
                      </ul>
                    </div>

                    <div className="rules-section">
                      <h3>Override Rules</h3>
                      <ul className="rules-list">
                        <li><strong>Allow Override:</strong> {group.settings.allowOverride ? 'Yes' : 'No'}</li>
                        <li><strong>Override Threshold:</strong> {group.settings.overrideThreshold}%</li>
                      </ul>
                    </div>

                    <div className="rules-section">
                      <h3>Timing</h3>
                      <ul className="rules-list">
                        <li><strong>Submission Time:</strong> {group.settings.submissionTime} hours</li>
                        <li><strong>Voting Time:</strong> {group.settings.votingTime} hours</li>
                        <li><strong>Auto-Start:</strong> {group.settings.autoStart ? 'Yes' : 'No'}</li>
                      </ul>
                    </div>

                    <div className="rules-section">
                      <h3>Additional Features</h3>
                      <ul className="rules-list">
                        <li><strong>Chat:</strong> {group.settings.enableChat ? 'Enabled' : 'Disabled'}</li>
                        <li><strong>Song Preview:</strong> {group.settings.enableSongPreview ? 'Enabled' : 'Disabled'}</li>
                        <li><strong>Show Voter Identity:</strong> {group.settings.showVoterIdentity ? 'Yes' : 'No'}</li>
                      </ul>
                    </div>

                    <div className="rules-section">
                      <h3>Topic Settings</h3>
                      <ul className="rules-list">
                        <li><strong>Topic Selection:</strong> {group.settings.topicSelection === 'czar' ? 'Round Leader Chooses' : group.settings.topicSelection === 'random' ? 'Random Selection' : 'Player Vote'}</li>
                        <li><strong>Allow Custom Topics:</strong> {group.settings.allowCustomTopics ? 'Yes' : 'No'}</li>
                        <li><strong>Preset Topics:</strong> {group.settings.presetTopics?.length || 0} topics available</li>
                        {group.settings.presetTopics && group.settings.presetTopics.length > 0 && (
                          <li><strong>Topics:</strong> {group.settings.presetTopics.join(', ')}</li>
                        )}
                      </ul>
                    </div>
                  </div>
                )}
              </section>
            )}
          </div>

          {/* Sidebar with Navigation */}
          <aside className="group-sidebar">
            <nav className="group-nav" aria-label="Group navigation">
              <button 
                className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
                onClick={() => setActiveTab('overview')}
              >
                Overview
              </button>
              {group.currentTheme && (
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
              {group.players.find(p => p.id === user.id)?.isHost ? (
                <button 
                  className="leave-button delete"
                  onClick={() => {
                    if (confirm('Are you sure you want to delete this group? This cannot be undone.')) {
                      navigate('/dashboard')
                    }
                  }}
                  aria-label="Delete group"
                >
                  Delete Group
                </button>
              ) : (
                <button 
                  className="leave-button"
                  onClick={handleLeaveGroup}
                  aria-label="Leave group"
                >
                  Leave Group
                </button>
              )}
            </div>
          </aside>
        </div>
      </main>

      {showSubmitModal && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submit-modal-title"
          ref={submitModalRef}
          onClick={closeSubmitModal}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="submit-modal-title">{isEditing ? 'Edit Song' : 'Submit Song'}</h2>
              <button
                className="close-button"
                onClick={closeSubmitModal}
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
                  onClick={closeSubmitModal}
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
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="round-leader-modal-title"
          ref={roundLeaderModalRef}
          onClick={() => setShowRoundLeaderModal(false)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
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
                    <p>Let the system randomly pick a Round Leader from the group players</p>
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
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="player-selection-modal-title"
          ref={playerSelectionModalRef}
          onClick={() => setShowPlayerSelection(false)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
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
                {group.players.map(player => (
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

      {showInviteModal && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-modal-title"
          ref={inviteModalRef}
          onClick={() => setShowInviteModal(false)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="invite-modal-title">Invite Players</h2>
              <button
                className="close-button"
                onClick={() => setShowInviteModal(false)}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="invite-code">Group Code</label>
                <input
                  id="invite-code"
                  type="text"
                  value={groupId}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
                <small className="form-hint">Friends can enter this on the Dashboard's "Join Group" button.</small>
              </div>

              <div className="form-group">
                <label htmlFor="invite-link">Shareable Link</label>
                <input
                  id="invite-link"
                  type="text"
                  value={inviteLink}
                  readOnly
                  onFocus={(e) => e.target.select()}
                />
                <small className="form-hint">Opening this link joins the group automatically.</small>
              </div>
            </div>

            <div className="modal-actions">
              <button
                className="cancel-button"
                onClick={() => setShowInviteModal(false)}
              >
                Close
              </button>
              <button
                className="submit-button"
                onClick={handleCopyInviteLink}
              >
                {linkCopied ? 'Copied!' : 'Copy Link'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default GroupView
