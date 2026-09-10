import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSocket } from '../context/SocketContext'
import { useUser } from '../context/UserContext'
import AppNav from '../components/AppNav'
import { WINDOW_UNITS, windowValueToHours } from '../utils/windowLengths'
import './CreateGroup.css'

const STEPS = ['Basics', 'Game Rules', 'Override & Timing', 'Topics & Extras']

function CreateGroup() {
  const navigate = useNavigate()
  const { socket, isConnected } = useSocket()
  const { user } = useUser()

  const [step, setStep] = useState(0)
  const stepHeadingRef = useRef(null)
  const isFirstRender = useRef(true)

  // Basic Group Info
  const [groupName, setGroupName] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  // Host-only invites by default: most hosts won't think to configure this,
  // and opening it up later is a single toggle.
  const [allowMemberInvites, setAllowMemberInvites] = useState(false)
  // Off by default: a quiet round is the safer starting point, and a host who
  // wants discussion can switch it on.
  const [allowVotingComments, setAllowVotingComments] = useState(false)
  // Dependent on the toggle above: with comments off there is nothing to show.
  const [showCommentsLive, setShowCommentsLive] = useState(false)

  // Game Settings
  const [totalRounds, setTotalRounds] = useState(6)
  const [maxPlayers, setMaxPlayers] = useState(12)

  // Card Czar Settings
  const [czarPoints, setCzarPoints] = useState(5)
  const [allowSkipCzar, setAllowSkipCzar] = useState(true)
  const [anonymousCzar, setAnonymousCzar] = useState(true)

  // Jury Settings
  const [maxJuryPoints, setMaxJuryPoints] = useState(3)
  const [allowDownvotes, setAllowDownvotes] = useState(true)
  const [downvoteCost, setDownvoteCost] = useState(1)
  // RT-2: the per-round vote budget (default 10) and the "Share the wealth"
  // rule (default on). See docs/design/c8-per-round-vote-budget-change-design.md.
  const [voteBudget, setVoteBudget] = useState(10)
  const [shareTheWealth, setShareTheWealth] = useState(true)

  // Override Settings
  const [allowOverride, setAllowOverride] = useState(true)
  const [overrideThreshold, setOverrideThreshold] = useState(70)

  // Timing Settings — each window is a numeric value + a unit (minutes/hours/
  // days) converted to hours on the wire (see utils/windowLengths.js).
  const [submissionWindow, setSubmissionWindow] = useState({ value: 24, unit: 'hours' })
  const [votingWindow, setVotingWindow] = useState({ value: 24, unit: 'hours' })
  const [autoStart, setAutoStart] = useState(false)

  // Topic Settings
  // 'czar' is the only implemented mode — see the select in the Topics step
  // for the alternatives being held for later.
  const [topicSelection, setTopicSelection] = useState('czar')
  const [allowCustomTopics, setAllowCustomTopics] = useState(true)

  // Features
  const [enableChat, setEnableChat] = useState(false)
  const [enableSongPreview, setEnableSongPreview] = useState(true)
  const [showVoterIdentity, setShowVoterIdentity] = useState(false)

  // Focus the new step's heading when advancing/going back, so screen
  // reader users get an announcement that they're on a new screen. Skipped
  // on the initial mount so it doesn't fight the skip-link/natural tab order.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    stepHeadingRef.current?.focus()
  }, [step])

  const isStepValid = (s) => {
    if (s === 0) return groupName.trim().length > 0
    return true
  }

  const goNext = () => {
    if (!isStepValid(step)) return
    setStep((s) => Math.min(s + 1, STEPS.length - 1))
  }

  const goBack = () => {
    setStep((s) => Math.max(s - 1, 0))
  }

  const handleSubmit = (e) => {
    e.preventDefault()

    if (!isStepValid(0)) {
      setStep(0)
      return
    }

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
        czarPoints,
        allowSkipCzar,
        anonymousCzar,
        maxJuryPoints,
        allowDownvotes,
        downvoteCost,
        voteBudget,
        shareTheWealth,
        allowOverride,
        overrideThreshold, // whole percentage (51-100); stored and transmitted as-is everywhere
        submissionTime: windowValueToHours(submissionWindow.value, submissionWindow.unit),
        votingTime: windowValueToHours(votingWindow.value, votingWindow.unit),
        autoStart,
        topicSelection,
        allowCustomTopics,
        allowMemberInvites,
        allowVotingComments,
        showCommentsLive: allowVotingComments ? showCommentsLive : false,
        enableChat,
        enableSongPreview,
        showVoterIdentity
      }
    }

    // Send group creation request to server
    socket.emit('create_group', { groupData })

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

  const isLastStep = step === STEPS.length - 1

  return (
    <div className="create-group-page">
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <AppNav />

      <main id="main-content" className="create-group-main">
        <h1 className="page-title">Create New Group</h1>
        <div
          className="wizard-progress"
          role="group"
          aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}
        >
          <p className="wizard-progress-label">
            Step {step + 1} of {STEPS.length}: {STEPS[step]}
          </p>
          <div className="wizard-progress-bar" aria-hidden="true">
            {STEPS.map((label, i) => (
              <span
                key={label}
                className={`wizard-progress-segment ${i < step ? 'complete' : ''} ${i === step ? 'active' : ''}`}
              />
            ))}
          </div>
        </div>

        {/*
          Enter never submits early: only the final step renders a
          type="submit" button, and Back/Next are both type="button", so
          there's no submit control in the DOM for the browser's implicit
          form submission to target until the last step.
        */}
        <form
          className="create-group-form"
          onSubmit={handleSubmit}
        >
          {step === 0 && (
            <div className="wizard-step">
              <h2 ref={stepHeadingRef} tabIndex={-1} className="wizard-step-title">Basics</h2>
              <p className="wizard-step-description">Give your group a name so friends can find it.</p>

              <section className="form-section">
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
                      autoFocus
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

                <div className="form-group checkbox-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={allowMemberInvites}
                      onChange={(e) => setAllowMemberInvites(e.target.checked)}
                    />
                    <span>Allow members to invite others</span>
                  </label>
                  {/* Deliberately worded around sharing, not access. The
                      setting decides who is shown the invite link; anyone who
                      already has the link can still join either way. */}
                  <small className="form-hint">
                    When off, only you can share the invite link. This controls who can
                    share an invite — not who can join, since anyone with the link can join.
                  </small>
                </div>
              </section>
            </div>
          )}

          {step === 1 && (
            <div className="wizard-step">
              <h2 ref={stepHeadingRef} tabIndex={-1} className="wizard-step-title">Game Rules</h2>
              <p className="wizard-step-description">Set the pace of a round and how the Judge and jury work.</p>

              <section className="form-section">
                <h3>Game Settings</h3>
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

                </div>
              </section>

              <section className="form-section">
                <h3>Judge Settings</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="czar-points">Points for Judge's Pick</label>
                    <input
                      id="czar-points"
                      type="number"
                      value={czarPoints}
                      onChange={(e) => setCzarPoints(parseInt(e.target.value))}
                      min="1"
                      max="10"
                    />
                    <small className="form-hint">Points awarded when the Judge selects a winner</small>
                  </div>

                  <div className="form-group checkbox-group">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={allowSkipCzar}
                        onChange={(e) => setAllowSkipCzar(e.target.checked)}
                      />
                      <span>Allow Skip Judge</span>
                    </label>
                    <small className="form-hint">Players can skip being Judge</small>
                  </div>

                  <div className="form-group checkbox-group">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={anonymousCzar}
                        onChange={(e) => setAnonymousCzar(e.target.checked)}
                      />
                      <span>Anonymous Judge</span>
                    </label>
                    <small className="form-hint">Judge identity hidden until round end</small>
                  </div>
                </div>
              </section>

              <section className="form-section">
                <h3>Jury Settings</h3>
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
                    <label htmlFor="vote-budget">Per-Round Vote Budget</label>
                    <input
                      id="vote-budget"
                      type="number"
                      value={voteBudget}
                      onChange={(e) => setVoteBudget(parseInt(e.target.value))}
                      min="1"
                      max="100"
                    />
                    <small className="form-hint">Points each player can spend across votes, resetting each round</small>
                  </div>

                  <div className="form-group checkbox-group">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={shareTheWealth}
                        onChange={(e) => setShareTheWealth(e.target.checked)}
                      />
                      <span>Share the wealth</span>
                    </label>
                    <small className="form-hint">
                      When on, a player must spread their points across at least two submissions. When off,
                      a player may put their whole budget on one submission.
                    </small>
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

                  <div className="form-group checkbox-group">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={allowVotingComments}
                        onChange={(e) => setAllowVotingComments(e.target.checked)}
                      />
                      <span>Allow comments during voting</span>
                    </label>
                    <small className="form-hint">
                      Voters can leave a short note with their vote. Comments stay anonymous
                      until the round is revealed.
                    </small>
                  </div>

                  {allowVotingComments && (
                    <div className="form-group checkbox-group">
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={showCommentsLive}
                          onChange={(e) => setShowCommentsLive(e.target.checked)}
                        />
                        <span>Show comments live during voting</span>
                      </label>
                      <small className="form-hint">
                        When off, comments are collected but stay hidden from other players
                        until the reveal.
                      </small>
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-step">
              <h2 ref={stepHeadingRef} tabIndex={-1} className="wizard-step-title">Override & Timing</h2>
              <p className="wizard-step-description">Decide if the crowd can overrule the Judge, and how long each phase lasts.</p>

              <section className="form-section">
                <h3>Override Settings</h3>
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
                    <small className="form-hint">Public vote can override the Judge's choice</small>
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

              <section className="form-section">
                <h3>Timing Settings</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="submission-time">Submission Length</label>
                    <div className="window-control">
                      <input
                        id="submission-time"
                        type="number"
                        value={submissionWindow.value}
                        onChange={(e) => setSubmissionWindow(prev => ({ ...prev, value: e.target.value }))}
                        min="1"
                        max={submissionWindow.unit === 'minutes' ? 10080 : submissionWindow.unit === 'days' ? 7 : 168}
                      />
                      <select
                        aria-label="Submission length unit"
                        value={submissionWindow.unit}
                        onChange={(e) => setSubmissionWindow(prev => ({ ...prev, unit: e.target.value }))}
                      >
                        {WINDOW_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <small className="form-hint">Time players have to submit songs</small>
                  </div>

                  <div className="form-group">
                    <label htmlFor="voting-time">Voting Length</label>
                    <div className="window-control">
                      <input
                        id="voting-time"
                        type="number"
                        value={votingWindow.value}
                        onChange={(e) => setVotingWindow(prev => ({ ...prev, value: e.target.value }))}
                        min="1"
                        max={votingWindow.unit === 'minutes' ? 10080 : votingWindow.unit === 'days' ? 7 : 168}
                      />
                      <select
                        aria-label="Voting length unit"
                        value={votingWindow.unit}
                        onChange={(e) => setVotingWindow(prev => ({ ...prev, unit: e.target.value }))}
                      >
                        {WINDOW_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
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
            </div>
          )}

          {step === 3 && (
            <div className="wizard-step">
              <h2 ref={stepHeadingRef} tabIndex={-1} className="wizard-step-title">Topics & Extras</h2>
              <p className="wizard-step-description">Choose how themes are picked and turn on any extra features.</p>

              <section className="form-section">
                <h3>Topic Settings</h3>
                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="topic-selection">Topic Selection Method</label>
                    <select
                      id="topic-selection"
                      value={topicSelection}
                      onChange={(e) => setTopicSelection(e.target.value)}
                    >
                      <option value="czar">Judge Selects</option>
                      {/* Only "Judge Selects" is implemented: the Judge picks
                          from their topic library at the start of each round.
                          The options below are future ideas kept for their
                          design intent, not rejected ones — offering them now
                          would let a host choose something that silently does
                          nothing. Each needs real mechanics before it comes
                          back:
                            random   - a pool to draw from, and a rule for
                                       whose topics are eligible
                            vote     - a whole voting sub-phase before
                                       submissions open
                            rotation - per-group ordering state so each
                                       player's topics come up in turn
                      <option value="random">Random from Preset</option>
                      <option value="vote">Players Vote on Topic</option>
                      <option value="rotation">Topic Rotation</option>
                      */}
                    </select>
                    <small className="form-hint">
                      The Judge picks from their topic library at the start of each round.
                    </small>
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

              </section>

              <section className="form-section">
                <h3>Additional Features</h3>
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
            </div>
          )}

          {/* Form Actions */}
          <div className="form-actions">
            <button
              type="button"
              className="cancel-button"
              onClick={step === 0 ? handleCancel : goBack}
            >
              {step === 0 ? 'Cancel' : 'Back'}
            </button>
            {isLastStep ? (
              <button
                key="create"
                type="submit"
                className="submit-button"
                disabled={!groupName.trim()}
              >
                Create Group
              </button>
            ) : (
              <button
                key="next"
                type="button"
                className="submit-button"
                onClick={goNext}
                disabled={!isStepValid(step)}
              >
                Next
              </button>
            )}
          </div>
        </form>
      </main>
    </div>
  )
}

export default CreateGroup
