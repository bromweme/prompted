import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSocket } from '../context/SocketContext'
import { useUser } from '../context/UserContext'
import './CreateGroup.css'

function CreateGroup() {
  const navigate = useNavigate()
  const { socket, isConnected } = useSocket()
  const { user } = useUser()

  // Basic Group Info
  const [groupName, setGroupName] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)

  // Game Settings
  const [totalRounds, setTotalRounds] = useState(6)
  const [maxPlayers, setMaxPlayers] = useState(12)
  const [minPlayers, setMinPlayers] = useState(2)

  // Card Czar Settings
  const [czarPoints, setCzarPoints] = useState(5)
  const [allowSkipCzar, setAllowSkipCzar] = useState(true)
  const [anonymousCzar, setAnonymousCzar] = useState(true)

  // Jury Settings
  const [maxJuryPoints, setMaxJuryPoints] = useState(3)
  const [allowDownvotes, setAllowDownvotes] = useState(true)
  const [downvoteCost, setDownvoteCost] = useState(1)

  // Override Settings
  const [allowOverride, setAllowOverride] = useState(true)
  const [overrideThreshold, setOverrideThreshold] = useState(70)

  // Timing Settings
  const [submissionTime, setSubmissionTime] = useState(24) // hours
  const [votingTime, setVotingTime] = useState(24) // hours
  const [autoStart, setAutoStart] = useState(false)

  // Topic Settings
  const [topicSelection, setTopicSelection] = useState('czar') // czar, random, vote
  const [allowCustomTopics, setAllowCustomTopics] = useState(true)
  const [presetTopics, setPresetTopics] = useState('')

  // Features
  const [enableChat, setEnableChat] = useState(false)
  const [enableSongPreview, setEnableSongPreview] = useState(true)
  const [showVoterIdentity, setShowVoterIdentity] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()

    if (!isConnected) {
      alert('Please wait for server connection')
      return
    }

    const groupData = {
      name: groupName,
      description: groupDescription,
      isPrivate,
      settings: {
        totalRounds,
        maxPlayers,
        minPlayers,
        czarPoints,
        allowSkipCzar,
        anonymousCzar,
        maxJuryPoints,
        allowDownvotes,
        downvoteCost,
        allowOverride,
        overrideThreshold, // whole percentage (51-100); stored and transmitted as-is everywhere
        submissionTime,
        votingTime,
        autoStart,
        topicSelection,
        allowCustomTopics,
        presetTopics: presetTopics ? presetTopics.split('\n').filter(t => t.trim()) : [],
        enableChat,
        enableSongPreview,
        showVoterIdentity
      }
    }

    // Send group creation request to server
    socket.emit('create_group', { groupData, username: user.name, userId: user.id })

    // Listen for group creation confirmation
    socket.once('group_created', ({ group }) => {
      console.log('Group created successfully:', group)
      navigate(`/group/${group.id}`, { state: { groupData: group } })
    })

    socket.once('error', ({ message }) => {
      console.error('Error creating group:', message)
      alert(`Failed to create group: ${message}`)
    })
  }

  const handleCancel = () => {
    navigate('/dashboard')
  }

  return (
    <div className="create-group-page">
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <header className="page-header">
        <div className="header-content">
          <button
            className="back-button"
            onClick={handleCancel}
            aria-label="Go back to dashboard"
          >
            ← Back to Dashboard
          </button>
          <h1>Create New Group</h1>
        </div>
      </header>

      <main id="main-content" className="create-group-main">
        <form className="create-group-form" onSubmit={handleSubmit}>
          {/* Basic Information */}
          <section className="form-section">
            <h2>Basic Information</h2>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="group-name">Group Name *</label>
                <input
                  id="group-name"
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Enter group name"
                  required
                  maxLength={50}
                />
              </div>

              <div className="form-group">
                <label htmlFor="group-description">Description</label>
                <textarea
                  id="group-description"
                  value={groupDescription}
                  onChange={(e) => setGroupDescription(e.target.value)}
                  placeholder="Describe your group theme"
                  rows={3}
                  maxLength={200}
                />
              </div>
            </div>

            <div className="form-group checkbox-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                />
                <span>Private Group (invite only)</span>
              </label>
            </div>
          </section>

          {/* Game Settings */}
          <section className="form-section">
            <h2>Game Settings</h2>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="total-rounds">Number of Rounds</label>
                <select
                  id="total-rounds"
                  value={totalRounds}
                  onChange={(e) => setTotalRounds(parseInt(e.target.value))}
                >
                  <option value={4}>4 Rounds</option>
                  <option value={6}>6 Rounds</option>
                  <option value={8}>8 Rounds</option>
                  <option value={10}>10 Rounds</option>
                  <option value={12}>12 Rounds</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="max-players">Maximum Players</label>
                <select
                  id="max-players"
                  value={maxPlayers}
                  onChange={(e) => setMaxPlayers(parseInt(e.target.value))}
                >
                  <option value={4}>4 Players</option>
                  <option value={6}>6 Players</option>
                  <option value={8}>8 Players</option>
                  <option value={12}>12 Players</option>
                  <option value={16}>16 Players</option>
                  <option value={20}>20 Players</option>
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="min-players">Minimum Players to Start</label>
                <select
                  id="min-players"
                  value={minPlayers}
                  onChange={(e) => setMinPlayers(parseInt(e.target.value))}
                >
                  <option value={2}>2 Players</option>
                  <option value={3}>3 Players</option>
                  <option value={4}>4 Players</option>
                  <option value={5}>5 Players</option>
                </select>
              </div>
            </div>
          </section>

          {/* Card Czar Settings */}
          <section className="form-section">
            <h2>Card Czar Settings</h2>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="czar-points">Points for Czar's Pick</label>
                <input
                  id="czar-points"
                  type="number"
                  value={czarPoints}
                  onChange={(e) => setCzarPoints(parseInt(e.target.value))}
                  min="1"
                  max="10"
                />
                <small className="form-hint">Points awarded when Card Czar selects a winner</small>
              </div>

              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={allowSkipCzar}
                    onChange={(e) => setAllowSkipCzar(e.target.checked)}
                  />
                  <span>Allow Skip Card Czar</span>
                </label>
                <small className="form-hint">Players can skip being Card Czar</small>
              </div>

              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={anonymousCzar}
                    onChange={(e) => setAnonymousCzar(e.target.checked)}
                  />
                  <span>Anonymous Card Czar</span>
                </label>
                <small className="form-hint">Czar identity hidden until round end</small>
              </div>
            </div>
          </section>

          {/* Jury Settings */}
          <section className="form-section">
            <h2>Jury Settings</h2>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="max-jury-points">Max Jury Points per Vote</label>
                <input
                  id="max-jury-points"
                  type="number"
                  value={maxJuryPoints}
                  onChange={(e) => setMaxJuryPoints(parseInt(e.target.value))}
                  min="1"
                  max="5"
                />
                <small className="form-hint">Maximum points jury can award per vote</small>
              </div>

              <div className="form-group">
                <label htmlFor="downvote-cost">Downvote Cost</label>
                <input
                  id="downvote-cost"
                  type="number"
                  value={downvoteCost}
                  onChange={(e) => setDownvoteCost(parseInt(e.target.value))}
                  min="0"
                  max="5"
                  disabled={!allowDownvotes}
                />
                <small className="form-hint">Points lost when downvoting</small>
              </div>

              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={allowDownvotes}
                    onChange={(e) => setAllowDownvotes(e.target.checked)}
                  />
                  <span>Allow Downvotes</span>
                </label>
                <small className="form-hint">Players can downvote submissions</small>
              </div>
            </div>
          </section>

          {/* Override Settings */}
          <section className="form-section">
            <h2>Override Settings</h2>

            <div className="form-row">
              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={allowOverride}
                    onChange={(e) => setAllowOverride(e.target.checked)}
                  />
                  <span>Allow Public Vote Override</span>
                </label>
                <small className="form-hint">Public vote can override Czar's choice</small>
              </div>

              <div className="form-group">
                <label htmlFor="override-threshold">Override Threshold (%)</label>
                <input
                  id="override-threshold"
                  type="range"
                  value={overrideThreshold}
                  onChange={(e) => setOverrideThreshold(parseInt(e.target.value))}
                  min="51"
                  max="100"
                  disabled={!allowOverride}
                />
                <div className="range-value">{overrideThreshold}%</div>
                <small className="form-hint">Vote percentage needed to override Czar</small>
              </div>
            </div>
          </section>

          {/* Timing Settings */}
          <section className="form-section">
            <h2>Timing Settings</h2>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="submission-time">Submission Time (hours)</label>
                <input
                  id="submission-time"
                  type="number"
                  value={submissionTime}
                  onChange={(e) => setSubmissionTime(parseInt(e.target.value))}
                  min="1"
                  max="168"
                />
                <small className="form-hint">Time players have to submit songs</small>
              </div>

              <div className="form-group">
                <label htmlFor="voting-time">Voting Time (hours)</label>
                <input
                  id="voting-time"
                  type="number"
                  value={votingTime}
                  onChange={(e) => setVotingTime(parseInt(e.target.value))}
                  min="1"
                  max="168"
                />
                <small className="form-hint">Time players have to vote</small>
              </div>

              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={autoStart}
                    onChange={(e) => setAutoStart(e.target.checked)}
                  />
                  <span>Auto-Start Next Round</span>
                </label>
                <small className="form-hint">Automatically start next round after results</small>
              </div>
            </div>
          </section>

          {/* Topic Settings */}
          <section className="form-section">
            <h2>Topic Settings</h2>

            <div className="form-row">
              <div className="form-group">
                <label htmlFor="topic-selection">Topic Selection Method</label>
                <select
                  id="topic-selection"
                  value={topicSelection}
                  onChange={(e) => setTopicSelection(e.target.value)}
                >
                  <option value="czar">Card Czar Selects</option>
                  <option value="random">Random from Preset</option>
                  <option value="vote">Players Vote on Topic</option>
                  <option value="rotation">Topic Rotation</option>
                </select>
                <small className="form-hint">How topics are selected each round</small>
              </div>

              <div className="form-group checkbox-group">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={allowCustomTopics}
                    onChange={(e) => setAllowCustomTopics(e.target.checked)}
                  />
                  <span>Allow Custom Topics</span>
                </label>
                <small className="form-hint">Players can create their own topics</small>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="preset-topics">Preset Topics (one per line)</label>
              <textarea
                id="preset-topics"
                value={presetTopics}
                onChange={(e) => setPresetTopics(e.target.value)}
                placeholder="Songs that describe your mood today&#10;Best workout songs&#10;Songs that make you cry&#10;Guilty pleasures"
                rows={6}
              />
              <small className="form-hint">Add preset topics that players can choose from</small>
            </div>
          </section>

          {/* Features */}
          <section className="form-section">
            <h2>Additional Features</h2>

            <div className="features-grid">
              <div className="feature-option">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={enableChat}
                    onChange={(e) => setEnableChat(e.target.checked)}
                  />
                  <span>Enable Chat</span>
                </label>
                <small className="form-hint">Allow players to chat during rounds</small>
              </div>

              <div className="feature-option">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={enableSongPreview}
                    onChange={(e) => setEnableSongPreview(e.target.checked)}
                  />
                  <span>Enable Song Preview</span>
                </label>
                <small className="form-hint">Allow previewing songs before voting</small>
              </div>

              <div className="feature-option">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={showVoterIdentity}
                    onChange={(e) => setShowVoterIdentity(e.target.checked)}
                  />
                  <span>Show Voter Identity</span>
                </label>
                <small className="form-hint">Show who voted for which songs</small>
              </div>
            </div>
          </section>

          {/* Form Actions */}
          <div className="form-actions">
            <button
              type="button"
              className="cancel-button"
              onClick={handleCancel}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="submit-button"
              disabled={!groupName.trim()}
            >
              Create Group
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}

export default CreateGroup
