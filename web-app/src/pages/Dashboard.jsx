import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useSocket } from '../context/SocketContext'
import { useUser } from '../context/UserContext'
import { useModalA11y } from '../hooks/useModalA11y'
import ProfileSetupModal from '../components/ProfileSetupModal'
import AppNav from '../components/AppNav'
import './Dashboard.css'

function Dashboard() {
  const [groups, setGroups] = useState([])
  const [showJoinModal, setShowJoinModal] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const { socket, isConnected } = useSocket()
  const { user, needsProfileSetup } = useUser()
  const navigate = useNavigate()
  const location = useLocation()
  const joinModalRef = useRef(null)

  useModalA11y(showJoinModal, joinModalRef, () => setShowJoinModal(false))

  useEffect(() => {
    if (!socket || !isConnected || !user) return

    // Fetch user's groups from server
    socket.emit('get_groups')

    socket.on('groups_list', ({ groups: serverGroups }) => {
      // Transform server groups to match UI format
      const transformedGroups = serverGroups.map(group => ({
        id: group.id,
        name: group.name,
        description: group.description,
        players: group.players.length,
        currentRound: group.currentRound,
        totalRounds: group.settings.totalRounds || 6,
        status: group.status,
        host: group.host
      }))
      setGroups(transformedGroups)
    })

    return () => {
      socket.off('groups_list')
    }
  }, [socket, isConnected, user])

  useEffect(() => {
    // Check if there's a new group from navigation state
    if (location.state?.newGroup) {
      setGroups(prev => {
        // Check if group already exists
        if (prev.find(l => l.id === location.state.newGroup.id)) {
          return prev
        }
        return [...prev, {
          id: location.state.newGroup.id,
          name: location.state.newGroup.name,
          description: location.state.newGroup.description,
          players: location.state.newGroup.players.length,
          currentRound: location.state.newGroup.currentRound,
          totalRounds: location.state.newGroup.settings.totalRounds,
          status: location.state.newGroup.status,
          host: location.state.newGroup.host
        }]
      })
    }
  }, [location.state])

  const handleJoinGroup = (groupId) => {
    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }

    // Fetch group details from server
    socket.emit('get_group', { groupId })

    socket.once('group_details', ({ group }) => {
      // Transform server group data to match UI format
      const fullGroupData = {
        id: group.id,
        name: group.name,
        description: group.description,
        host: group.host,
        settings: {
          totalRounds: group.settings.totalRounds || 6,
          maxPlayers: group.settings.maxPlayers || 12,
          czarPoints: group.settings.czarPoints || 5,
          allowSkipCzar: group.settings.allowSkipCzar !== false,
          anonymousCzar: group.settings.anonymousCzar !== false,
          maxJuryPoints: group.settings.maxJuryPoints || 3,
          allowDownvotes: group.settings.allowDownvotes !== false,
          downvoteCost: group.settings.downvoteCost || 1,
          voteBudget: typeof group.settings.voteBudget === 'number' ? group.settings.voteBudget : 10,
          shareTheWealth: group.settings.shareTheWealth !== false,
          allowOverride: group.settings.allowOverride !== false,
          overrideThreshold: group.settings.overrideThreshold || 70, // whole percentage; no conversion
          submissionTime: group.settings.submissionTime || 24,
          votingTime: group.settings.votingTime || 24,
          autoStart: group.settings.autoStart || false,
          topicSelection: group.settings.topicSelection || 'czar',
          allowCustomTopics: group.settings.allowCustomTopics !== false,
          enableChat: group.settings.enableChat || false,
          enableSongPreview: group.settings.enableSongPreview !== false,
          showVoterIdentity: group.settings.showVoterIdentity || false
        },
        status: group.status,
        currentRound: group.currentRound,
        // Pass raw player records through — GroupView's own mapPlayers()
        // does the userId -> client id transform. Pre-mapping here would
        // strip the `userId` field it depends on.
        players: group.players,
        currentTheme: group.currentTheme || null,
        history: group.history || []
      }
      
      navigate(`/group/${groupId}`, { state: { groupData: fullGroupData } })
    })

    socket.once('error', ({ message }) => {
      console.error('Error fetching group:', message)
      alert(`Failed to load group: ${message}`)
    })
  }

  const handleJoinGroupByCode = () => {
    if (!joinCode.trim()) return

    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }

    const groupId = joinCode.trim().toUpperCase()
    socket.emit('join_group', { groupId })

    socket.once('group_joined', ({ group }) => {
      setShowJoinModal(false)
      setJoinCode('')
      navigate(`/group/${group.id}`, { state: { groupData: group } })
    })

    socket.once('error', ({ message }) => {
      console.error('Error joining group:', message)
      alert(`Failed to join group: ${message}`)
    })
  }

  if (!user) {
    return <div className="loading">Loading...</div>
  }

  return (
    <div className="dashboard-page">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      
      <AppNav current="dashboard" />

      <main id="main-content" className="dashboard-main">
        <div className="dashboard-content">
          {/* Show My Groups first if user has groups */}
          {groups.length > 0 && (
            <section className="groups-section">
              <div className="section-header">
                <h2>My Groups</h2>
                <span className="status-label" aria-hidden="true">Active</span>
              </div>

              <div className="groups-grid">
                {groups.map((group) => (
                  <article 
                    key={group.id} 
                    className="group-card"
                    onClick={() => handleJoinGroup(group.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="group-header">
                      <h3>{group.name}</h3>
                      <span className={`status-badge ${group.status}`}>
                        {group.status}
                      </span>
                    </div>
                    
                    <p className="group-description">{group.description}</p>
                    
                    <div className="group-stats">
                      <div className="stat">
                        <span className="stat-label">Players</span>
                        <span className="stat-value">{group.players}</span>
                      </div>
                      <div className="stat">
                        <span className="stat-label">Round</span>
                        <span className="stat-value">{group.currentRound}/{group.totalRounds}</span>
                      </div>
                    </div>

                    <div className="group-actions">
                      {group.host === user.id ? (
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
                className="create-group-button"
                onClick={() => navigate('/create-group')}
                aria-label="Create new group"
              >
                <span className="button-icon" aria-hidden="true">+</span>
                Create New Group
              </button>
              <button 
                className="join-group-button"
                onClick={() => setShowJoinModal(true)}
                aria-label="Join existing group"
              >
                <span className="button-icon" aria-hidden="true">🔗</span>
                Join Group
              </button>
            </div>
          </section>

          {groups.length === 0 && (
            <section className="groups-section">
              <div className="section-header">
                <h2>My Groups</h2>
                <span className="status-label" aria-hidden="true">Active</span>
              </div>

              <div className="groups-grid">
                {groups.length === 0 && (
                  <div className="empty-state">
                    <div className="empty-icon" aria-hidden="true">🎵</div>
                    <h3>No groups yet</h3>
                    <p>Create your first group to get started!</p>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </main>

      {showJoinModal && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="join-modal-title"
          ref={joinModalRef}
          onClick={() => setShowJoinModal(false)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="join-modal-title">Join Group</h2>
              <button 
                className="close-button"
                onClick={() => setShowJoinModal(false)}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>
            
            <form className="modal-body" onSubmit={(e) => { e.preventDefault(); handleJoinGroupByCode(); }}>
              <div className="form-group">
                <label htmlFor="join-code">Group Code</label>
                <input
                  id="join-code"
                  type="text"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="Enter group code"
                  required
                />
                <small className="form-hint">Get the group code from the host</small>
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
                  Join Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* First sign-in only: the server leaves avatar null exactly once. */}
      {needsProfileSetup && <ProfileSetupModal />}
    </div>
  )
}

export default Dashboard
