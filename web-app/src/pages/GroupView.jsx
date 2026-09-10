import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useSocket } from '../context/SocketContext'
import { useUser } from '../context/UserContext'
import { useModalA11y } from '../hooks/useModalA11y'
import AppNav from '../components/AppNav'
import YouTubeSearch from '../components/YouTubeSearch'
import YouTubeEmbed from '../components/YouTubeEmbed'
import RoundVideoList from '../components/RoundVideoList'
import TopicPicker from '../components/TopicPicker'
import { WINDOW_UNITS, windowValueToHours, hoursToWindowValue } from '../utils/windowLengths'
import './GroupView.css'

// Server player records carry both a transient socket id (`id`) and a stable
// `userId`. The client only ever needs the stable identity to check who's
// who (e.g. host), so `id` here is remapped to `userId`.
function mapPlayers(players, host) {
  return players.map(player => ({
    id: player.userId,
    username: player.username,
    score: player.score,
    isHost: player.userId === host,
    // Carried through so the UI can gate on the same count the server checks.
    connected: player.connected !== false
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
      enableChat: group.settings.enableChat || false,
      enableSongPreview: group.settings.enableSongPreview !== false,
      showVoterIdentity: group.settings.showVoterIdentity || false,
      allowMemberInvites: group.settings.allowMemberInvites === true,
      allowVotingComments: group.settings.allowVotingComments === true,
      showCommentsLive: group.settings.showCommentsLive === true
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
  // The video chosen from search results: { videoId, title, thumbnail, channelTitle }
  const [selectedVideo, setSelectedVideo] = useState(null)
  const [userSubmission, setUserSubmission] = useState(null)
  const [isEditingRules, setIsEditingRules] = useState(false)
  const [editedSettings, setEditedSettings] = useState(null)
  // The Rules editor represents each round window as a value + unit (see
  // utils/windowLengths.js); the persisted settings stay in hours.
  const [submissionWindow, setSubmissionWindow] = useState({ value: 24, unit: 'hours' })
  const [votingWindow, setVotingWindow] = useState({ value: 24, unit: 'hours' })
  const [showRoundLeaderModal, setShowRoundLeaderModal] = useState(false)
  const [showPlayerSelection, setShowPlayerSelection] = useState(false)
  const [timeRemaining, setTimeRemaining] = useState(null)
  const [isRoundLeader, setIsRoundLeader] = useState(false)
  const [selectedSubmissionId, setSelectedSubmissionId] = useState(null)
  const [votePoints, setVotePoints] = useState(1)
  const [voteComment, setVoteComment] = useState('')
  const [userVote, setUserVote] = useState(null)
  // Which submission in the current round is this player's own. The server
  // tells each socket only about its own, so this can gate self-voting in the
  // UI without leaking anyone else's authorship.
  const [ownSubmissionId, setOwnSubmissionId] = useState(null)
  const [showInviteModal, setShowInviteModal] = useState(false)
  // Durable messages for the host, e.g. a round that restarted while they were
  // away. They persist server-side until acknowledged, so one that arrives
  // during an offline spell is still waiting on the next connection.
  const [hostNotices, setHostNotices] = useState([])
  const [linkCopied, setLinkCopied] = useState(false)
  // True while a Leave Group / Delete Group request is in flight so the button
  // disables and a double click can't fire the emit twice.
  const [leaving, setLeaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const submitModalRef = useRef(null)
  const roundLeaderModalRef = useRef(null)
  const playerSelectionModalRef = useRef(null)
  const inviteModalRef = useRef(null)

  const closeSubmitModal = () => {
    setShowSubmitModal(false)
    setSelectedVideo(null)
  }

  useModalA11y(showSubmitModal, submitModalRef, closeSubmitModal)
  useModalA11y(showRoundLeaderModal, roundLeaderModalRef, () => setShowRoundLeaderModal(false))
  useModalA11y(showPlayerSelection, playerSelectionModalRef, () => setShowPlayerSelection(false))
  useModalA11y(showInviteModal, inviteModalRef, () => setShowInviteModal(false))

  useEffect(() => {
    // Countdown timer for round deadline.
    //
    // Reaching zero used to do nothing at all: the display sat at 00:00 while
    // the round stayed open forever, because no timer on the server ends a
    // phase. The countdown now tells the server its clock says the window
    // closed. That is only a nudge — the server re-checks its own clock and
    // ignores this if the deadline has not really passed — so nothing here is
    // trusted, and a wrong local clock cannot end anyone's round early.
    if (group?.currentTheme?.deadline) {
      const notifyExpired = () => {
        if (socket && groupId) socket.emit('check_round_deadline', { groupId })
      }

      const interval = setInterval(() => {
        const now = new Date().getTime()
        const deadline = new Date(group.currentTheme.deadline).getTime()
        const remaining = deadline - now

        if (remaining <= 0) {
          setTimeRemaining(0)
          clearInterval(interval)
          notifyExpired()
        } else {
          setTimeRemaining(remaining)
        }
      }, 1000)

      // A tab that was closed or asleep at the deadline comes back to an
      // already-expired round, which the one-second tick above would report
      // only after its first pass. Checking immediately keeps that case quick.
      if (new Date(group.currentTheme.deadline).getTime() - Date.now() <= 0) {
        notifyExpired()
      }

      return () => clearInterval(interval)
    }
  }, [group?.currentTheme?.deadline, socket, groupId])

  // Clear per-round local state whenever a new round begins
  useEffect(() => {
    setUserSubmission(null)
    setUserVote(null)
    setSelectedSubmissionId(null)
    setVoteComment('')
    setOwnSubmissionId(null)
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
          enableChat: false,
          enableSongPreview: true,
          showVoterIdentity: false,
          allowMemberInvites: false,
          allowVotingComments: false,
          showCommentsLive: false
        },
        status: groupData.status || 'waiting',
        currentRound: groupData.currentRound || 0,
        players: groupData.players
          ? mapPlayers(groupData.players, groupData.host)
          : [{ id: user.id, username: user.name, score: 0, isHost: true }],
        currentTheme: groupData.currentTheme || null,
        history: groupData.history || []
      }
      
      // Seeds the first paint only. history.state survives a reload, so
      // treating this as the source of truth left the page showing
      // creation-time data indefinitely; the fetch below always follows.
      setGroup(fullGroupData)
    }

    if (new URLSearchParams(location.search).get('join') === 'true') {
      // Arrived via a shared invite link — join automatically. This is safe
      // to call even for an existing member (the server treats it as a
      // reconnect rather than adding a duplicate).
      socket.emit('join_group', { groupId })

      socket.once('group_joined', ({ group, isRoundLeader: youAreRoundLeader, yourSubmissionId, notices }) => {
        setGroup(normalizeGroupData(group))
        setIsRoundLeader(!!youAreRoundLeader)
        setOwnSubmissionId(yourSubmissionId || null)
        setHostNotices(notices || [])
      })

      socket.once('error', ({ message }) => {
        console.error('Error joining group:', message)
        alert(`Failed to join group: ${message}`)
      })
    } else {
      // Fetch group data from server
      socket.emit('get_group', { groupId })

      socket.once('group_details', ({ group, isRoundLeader: youAreRoundLeader, yourSubmissionId, notices }) => {
        setGroup(normalizeGroupData(group))
        setIsRoundLeader(!!youAreRoundLeader)
        setOwnSubmissionId(yourSubmissionId || null)
        setHostNotices(notices || [])
      })

      socket.once('error', ({ message }) => {
        console.error('Error fetching group:', message)
        alert(`Failed to load group: ${message}`)
      })
    }

    // Listen for group updates
    socket.on('group_updated', ({ group, isRoundLeader: youAreRoundLeader, yourSubmissionId, notices }) => {
      if (yourSubmissionId !== undefined) setOwnSubmissionId(yourSubmissionId || null)
      if (notices !== undefined) setHostNotices(notices || [])
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

    // Server confirmation that this player was removed from the group. This —
    // not the Leave click — is what returns the leaver to the dashboard, so
    // the roster on the server is guaranteed to be up to date first.
    socket.on('left_group', () => {
      navigate('/dashboard')
    })

    // The group this page is showing no longer exists (host deleted it, or a
    // socket-based removal). Return every still-connected member — and the
    // deleting host, since the server includes the host among the connected
    // sockets it notifies — to the dashboard. Guard on groupId so a stale
    // event from another group's teardown can't yank this page away.
    socket.on('group_deleted', ({ groupId: deletedId }) => {
      if (deletedId === groupId) navigate('/dashboard')
    })

    return () => {
      socket.off('group_updated')
      socket.off('player_joined_group')
      socket.off('group_details')
      socket.off('left_group')
      socket.off('group_deleted')
      socket.off('error')
    }
  }, [groupId, location.state, location.search, socket, isConnected, user, navigate])

  // Both the first round (start_group) and every later one (start_round) go
  // through the same Judge-selection prompt, so the host always gets the
  // choice rather than only from round 2 onwards.
  const handleStartRound = () => {
    setShowRoundLeaderModal(true)
  }

  const emitRoundStart = (czarUserId) => {
    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }

    // Round 1 transitions the group out of setup; later rounds don't.
    const event = group.status === 'setup' ? 'start_group' : 'start_round'
    socket.emit(event, { groupId, czarUserId })

    socket.once('error', ({ message }) => {
      console.error('Error starting round:', message)
      alert(`Failed to start round: ${message}`)
    })
  }

  const handleRandomAssign = () => {
    setShowRoundLeaderModal(false)
    emitRoundStart()
  }

  const handlePickLeader = () => {
    // Show player selection list
    setShowRoundLeaderModal(false)
    setShowPlayerSelection(true)
  }

  // The Pick Judge modal serves two jobs: choosing who starts a new round, and
  // replacing the Judge of a round that is already waiting on a topic. The
  // round's phase says which, so the modal needs no extra state.
  const isReplacingJudge = group?.currentTheme?.status === 'topic_selection'

  const handleSelectPlayer = (player) => {
    setShowPlayerSelection(false)
    // player.id is the stable userId (see mapPlayers)
    if (isReplacingJudge) {
      handleReassignJudge(player.id)
    } else {
      emitRoundStart(player.id)
    }
  }

  // Start Group now opens the same prompt instead of silently assigning a
  // random Judge. The old success alert is gone: the round view shows the
  // topic-selection phase directly, and a blocking dialog on a normal flow
  // just gets in the way.
  const handleStartGroup = () => {
    setShowRoundLeaderModal(true)
  }

  const handleEditRules = () => {
    const settings = { ...group.settings }
    setEditedSettings(settings)
    // Seed the window editors from the stored hours.
    setSubmissionWindow(hoursToWindowValue(settings.submissionTime || 24))
    setVotingWindow(hoursToWindowValue(settings.votingTime || 24))
    setIsEditingRules(true)
  }

  const handleSaveRules = () => {
    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }

    // Convert the value + unit windows back to hours before sending (the
    // persisted settings stay in hours).
    const settings = {
      ...editedSettings,
      submissionTime: windowValueToHours(submissionWindow.value, submissionWindow.unit),
      votingTime: windowValueToHours(votingWindow.value, votingWindow.unit)
    }

    // overrideThreshold is a whole percentage everywhere — no conversion needed
    socket.emit('update_group', {
      groupId,
      settings
    })

    socket.once('group_updated', ({ group }) => {
      setGroup(prev => ({ ...prev, settings }))
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

  // Host ends the submission window early rather than waiting it out for
  // someone who is not coming.
  const handleCloseSubmissions = () => {
    if (socket && groupId) socket.emit('close_submissions', { groupId })
  }

  // Host hands the Judge role to someone else while the round is still waiting
  // for a topic. Topic selection has no deadline by design, so an absent Judge
  // has nothing to expire and this is the only way out.
  const handleReassignJudge = (playerUserId) => {
    if (socket && groupId) socket.emit('reassign_judge', { groupId, czarUserId: playerUserId })
    setShowPlayerSelection(false)
  }

  const handleDismissNotice = (noticeId) => {
    if (socket && groupId) socket.emit('acknowledge_notice', { groupId, noticeId })
  }

  const handleLeaveGroup = () => {
    if (!confirm('Are you sure you want to leave this group?')) return
    if (leaving) return
    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }
    setLeaving(true)
    // Do NOT navigate here — the server confirms the removal with a
    // `left_group` reply, and only that drives the navigation back to the
    // dashboard. Navigating on click would leave a stale member roster behind.
    socket.emit('leave_group', { groupId })

    socket.once('error', ({ message }) => {
      console.error('Error leaving group:', message)
      alert(message)
      setLeaving(false)
    })
  }

  const handleDeleteGroup = () => {
    if (!confirm('Are you sure you want to delete this group? This cannot be undone.')) return
    if (deleting) return
    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }
    setDeleting(true)
    // Do NOT navigate here either — the server confirms the deletion with a
    // `group_deleted` reply (host is among the connected members it notifies),
    // and that drives the navigation back to the dashboard.
    socket.emit('delete_group', { groupId })

    socket.once('error', ({ message }) => {
      console.error('Error deleting group:', message)
      alert(message)
      setDeleting(false)
    })
  }

  const isHost = !!group && group.players.find(p => p.id === user?.id)?.isHost

  // Mirrors MIN_PLAYERS_TO_START on the server. A round is a Judge plus at
  // least one contestant; with one player nobody can submit, so the round
  // would consume a topic and then stall.
  //
  // Counts group MEMBERS, not who is currently online. Who happens to be
  // connected is not the host's problem — an absent player can submit when
  // they return, so presence must not block starting a round.
  const MIN_PLAYERS_TO_START = 2
  const canStartRound = !!group && group.players.length >= MIN_PLAYERS_TO_START

  // Maps a stable userId to the name shown in the UI.
  const playerName = (userId) =>
    (group && group.players.find(p => p.id === userId)?.username) || 'Unknown'

  // Everyone except the Round Leader submits, so this is what "all in" means.
  // It mirrors the server's own gate (see submit_video), which is what
  // actually flips the round into voting.
  const expectedSubmissions = group
    ? Math.max(group.players.length - 1, 0)
    : 0

  // Anonymous during voting: the server sends text and submission only.
  const votingComments = group?.currentTheme?.comments || []

  // At reveal the full votes come through, so comments gain their author.
  const revealedComments = (group?.currentTheme?.votes || [])
    .filter(v => v.comment)
    .map(v => ({ submissionId: v.submissionId, text: v.comment, voterUserId: v.voterUserId }))
  // Who is offered the invite action. This is a UI affordance only: it decides
  // who is shown the link, not who may join. Anyone holding a group link can
  // still join, because joining is keyed on the group id alone and there is no
  // separate access-control layer behind it.
  const canInvite = !!group && (isHost || group.settings.allowMemberInvites === true)

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

  const handleSubmitVideo = () => {
    if (!selectedVideo) {
      alert('Please pick a video from the search results')
      return
    }

    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }

    socket.emit('submit_video', {
      groupId,
      videoId: selectedVideo.videoId,
      title: selectedVideo.title,
      thumbnail: selectedVideo.thumbnail,
      channelTitle: selectedVideo.channelTitle
    })

    socket.once('error', ({ message }) => {
      console.error('Error submitting video:', message)
      alert(`Failed to submit video: ${message}`)
    })

    setUserSubmission({ ...selectedVideo, submittedAt: new Date().toISOString() })
    setShowSubmitModal(false)
    setSelectedVideo(null)
  }

  const handleSelectTopic = (topicId) => {
    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }

    socket.emit('select_topic', { groupId, topicId })

    socket.once('error', ({ message }) => {
      console.error('Error selecting topic:', message)
      alert(`Failed to select topic: ${message}`)
    })
  }

  const handleCastVote = (isDownvote = false) => {
    if (!selectedSubmissionId) return
    if (selectedSubmissionId === ownSubmissionId) {
      alert('You cannot vote for your own submission')
      return
    }
    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }

    socket.emit('cast_vote', {
      groupId,
      submissionId: selectedSubmissionId,
      points: votePoints,
      isDownvote,
      comment: group.settings.allowVotingComments ? voteComment.trim() : undefined
    })

    socket.once('error', ({ message }) => {
      console.error('Error casting vote:', message)
      alert(`Failed to cast vote: ${message}`)
    })

    setUserVote({ submissionId: selectedSubmissionId, isDownvote })
    setVoteComment('')
  }

  const handleCzarSelectWinner = () => {
    if (!selectedSubmissionId) return
    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }

    socket.emit('czar_select_winner', {
      groupId,
      submissionId: selectedSubmissionId
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
      
      <AppNav />

      <main id="main-content" className="group-main">
        <div className="group-content">
          {/* Host-only messages that outlived the moment they happened, most
              importantly a round that restarted while the host was away. */}
          {hostNotices.length > 0 && (
            <div className="host-notices">
              {hostNotices.map(notice => (
                <div key={notice.id} className="host-notice" role="status">
                  <p className="host-notice-text">{notice.message}</p>
                  <button
                    className="host-notice-dismiss"
                    onClick={() => handleDismissNotice(notice.id)}
                    aria-label="Dismiss this message"
                  >
                    Dismiss
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Main Content Area */}
          <div className="group-main-content">
            {activeTab === 'overview' && (
              <section className="tab-content">
                <h2>Group Overview</h2>

                {/* Everything that used to live in the page header. It sits in
                    the Overview tab only — the other tabs stay focused on
                    their own content. */}
                <div className="group-info-card">
                  <div className="group-info-heading">
                    <h3 className="group-info-name">{group.name}</h3>
                    <span className={`status-badge ${group.status}`}>{group.status}</span>
                  </div>

                  {group.description && (
                    <p className="group-info-description">{group.description}</p>
                  )}

                  <div className="group-info-meta">
                    <span className="round-info">Round {group.currentRound}/{group.settings.totalRounds}</span>
                    <span className="player-count">
                      {group.players.length} {group.players.length === 1 ? 'player' : 'players'}
                    </span>
                    {timeRemaining !== null && timeRemaining > 0 && (
                      <span className="countdown-timer">
                        <span className="timer-icon" aria-hidden="true">⏱️</span>
                        <span className="timer-text">
                          {Math.floor(timeRemaining / (1000 * 60 * 60))}h {Math.floor((timeRemaining % (1000 * 60 * 60)) / (1000 * 60))}m {Math.floor((timeRemaining % (1000 * 60)) / 1000)}s
                        </span>
                      </span>
                    )}
                  </div>

                  {canInvite && (
                    <div className="group-info-actions">
                      <button
                        className="action-button"
                        onClick={handleInvitePlayer}
                        aria-label="Invite players to group"
                      >
                        Invite Players
                      </button>
                    </div>
                  )}
                </div>
                
                {group.status === 'setup' && isHost && (
                  /* Setup State - host prepares the group before round 1.
                     Host-only: it carries Start Group, which the server
                     refuses for anyone else, and it used to render alongside
                     the non-host "Waiting for Host" panel. The invite action
                     now lives in the Group Info card above. */
                  <div className="setup-state">
                    <div className="setup-icon" aria-hidden="true">🎯</div>
                    <h3>Group Setup</h3>
                    <p>Invite players to join your group before starting the first round.</p>

                    <div className="setup-actions">
                      <button
                        className="setup-button secondary"
                        onClick={handleStartGroup}
                        disabled={!canStartRound}
                      >
                        Start Group
                      </button>
                    </div>

                    <div className="setup-info">
                      <p>Players joined: {group.players.length}</p>
                      {canStartRound ? (
                        <p className="setup-hint">Ready to start.</p>
                      ) : (
                        <p className="setup-hint">
                          You need at least {MIN_PLAYERS_TO_START} players to start — one to
                          judge and one to submit. Invite someone to join.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {group.status === 'setup' && !isHost && (
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
                          {group.currentTheme.status === 'topic_selection' ? 'Choosing a topic'
                            : group.currentTheme.status === 'submission' ? 'Submissions Open'
                            : group.currentTheme.status === 'voting' ? 'Voting'
                            : group.currentTheme.status === 'reveal' ? 'Results'
                            : group.currentTheme.status}
                        </span>
                        <span className="round-leader-badge">
                          {isRoundLeader
                            ? 'You are the Judge'
                            : group.currentTheme.czarUsername
                              ? `Judge: ${group.currentTheme.czarUsername}`
                              : 'Judge: Anonymous'}
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
                    {isHost && (
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

                  {/* The viewer's own role, from their own private
                      isRoundLeader flag — the server sends that only to the
                      socket it belongs to, so this never discloses anyone
                      else's role. Shown during submission and voting, the
                      phases where knowing your role changes what you do. */}
                  {(group.currentTheme.status === 'submission' || group.currentTheme.status === 'voting') && (
                    <span className={`role-badge ${isRoundLeader ? 'role-judge' : 'role-contestant'}`}>
                      You are a: {isRoundLeader ? 'Judge' : 'Contestant'}
                    </span>
                  )}

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
                          ? 'You are the Judge'
                          : group.currentTheme.czarUsername
                            ? `Judge: ${group.currentTheme.czarUsername}`
                            : 'Judge: Anonymous'}
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

                  {/* ---- Phase 0: the Round Leader picks a topic ---- */}
                  {group.currentTheme.status === 'topic_selection' && (
                    <div className="round-phase round-phase-active">
                      <div className="round-phase-header">
                        <span className="round-phase-step">Getting started</span>
                        <h3>Topic</h3>
                      </div>

                      {isRoundLeader ? (
                        <>
                          <p className="submissions-count">
                            You're the Judge. Pick a topic to start the round — the
                            submission timer begins once you choose.
                          </p>
                          <TopicPicker groupId={groupId} onSelect={handleSelectTopic} />
                        </>
                      ) : (
                        <p className="no-submission">
                          Waiting for the Judge to choose this round's topic.
                        </p>
                      )}

                      {isHost && (
                        <div className="round-host-actions">
                          <button
                            className="action-button"
                            onClick={() => setShowPlayerSelection(true)}
                          >
                            Choose a different Judge
                          </button>
                          <p className="form-hint">
                            Only the Judge can pick the topic, and this phase has no
                            timer. Hand the role to someone else if they can't.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ---- Phase 1: submission ---- */}
                  {group.currentTheme.status === 'submission' && (
                    <div className="round-phase round-phase-active">
                      <div className="round-phase-header">
                        <span className="round-phase-step">Phase 1 of 3</span>
                        <h3>Submissions</h3>
                      </div>

                      {isRoundLeader ? (
                        <div className="user-submission-card">
                          <p className="no-submission">
                            You're the Judge — wait for the other players to submit their videos.
                          </p>
                          <p className="submissions-count">
                            {group.currentTheme.submissionCount ?? 0} of {expectedSubmissions} submitted
                          </p>
                        </div>
                      ) : userSubmission ? (
                        /* Deliberately shaped like the voting section that
                           replaces it, so the layout doesn't jump when the
                           phase flips. */
                        <div className="submission-confirmation">
                          <p className="submission-confirmed-label">✓ Your submission is in</p>
                          <div className="youtube-selection">
                            <img
                              className="youtube-result-thumb"
                              src={userSubmission.thumbnail}
                              alt=""
                              width="120"
                              height="68"
                            />
                            <span className="youtube-result-meta">
                              <span className="youtube-result-title">{userSubmission.title}</span>
                              <span className="youtube-result-channel">{userSubmission.channelTitle}</span>
                            </span>
                          </div>
                          <p className="submissions-count">
                            Waiting for the rest of the group — {group.currentTheme.submissionCount ?? 0} of {expectedSubmissions} submitted.
                            Voting opens once everyone has submitted, or when the timer runs out.
                          </p>
                        </div>
                      ) : (
                        <div className="no-submission-content">
                          <p>You haven't submitted a video for this round yet.</p>
                          <button
                            className="submit-button"
                            onClick={() => setShowSubmitModal(true)}
                          >
                            Submit Video
                          </button>
                        </div>
                      )}
                    {isHost && (group.currentTheme.submissionCount ?? 0) > 0 && (
                      <div className="round-host-actions">
                        <button
                          className="action-button"
                          onClick={handleCloseSubmissions}
                        >
                          Close submissions now
                        </button>
                        <p className="form-hint">
                          Opens voting with the {group.currentTheme.submissionCount ?? 0} video
                          {(group.currentTheme.submissionCount ?? 0) === 1 ? '' : 's'} already in,
                          instead of waiting for the timer.
                        </p>
                      </div>
                    )}

                    </div>
                  )}

                  {/* ---- Phase 2: voting ---- */}
                  {group.currentTheme.status === 'voting' && (
                    <div className="round-phase round-phase-active">
                      <div className="round-phase-header">
                        <span className="round-phase-step">Phase 2 of 3</span>
                        <h3>Voting</h3>
                      </div>
                      <p className="submissions-count">
                        Everyone has submitted. Submissions stay anonymous until results are revealed.
                      </p>

                      <div className="submissions-list">
                        {(group.currentTheme.submissions || []).map(submission => {
                          const isOwn = submission.id === ownSubmissionId
                          const submissionComments = votingComments.filter(c => c.submissionId === submission.id)
                          return (
                            <div key={submission.id} className="submission-entry">
                              <button
                                type="button"
                                className={`submission-item ${!userVote && !isOwn ? 'selectable' : ''} ${selectedSubmissionId === submission.id ? 'selected' : ''} ${isOwn ? 'own-submission' : ''}`}
                                onClick={() => setSelectedSubmissionId(submission.id)}
                                disabled={!!userVote || isOwn}
                                aria-pressed={selectedSubmissionId === submission.id}
                              >
                                <div className="submission-song">
                                  <span className="song-title">{submission.title}</span>
                                  <span className="song-artist">{submission.channelTitle}</span>
                                  {isOwn && <span className="own-submission-badge">Your submission — you can't vote for it</span>}
                                </div>
                              </button>

                              {group.settings.allowVotingComments && submissionComments.length > 0 && (
                                <ul className="vote-comments" aria-label={`Comments on ${submission.title}`}>
                                  {submissionComments.map((c, i) => (
                                    <li key={i} className="vote-comment">
                                      <span className="vote-comment-author">Anonymous</span>
                                      <span className="vote-comment-text">{c.text}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )
                        })}
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

                          {group.settings.allowVotingComments && (
                            <div className="form-group vote-comment-field">
                              <label htmlFor="vote-comment">Comment (optional)</label>
                              <input
                                id="vote-comment"
                                type="text"
                                value={voteComment}
                                onChange={(e) => setVoteComment(e.target.value)}
                                maxLength={280}
                                placeholder="Say why — shown anonymously until the reveal"
                              />
                            </div>
                          )}

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
                              Select as Winner (Judge)
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="submissions-count">Select a submission above to vote.</p>
                      )}

                      <RoundVideoList videos={group.currentTheme.submissions} />
                    </div>
                  )}

                  {/* ---- Phase 3: results ---- */}
                  {group.currentTheme.status === 'reveal' && (
                    <div className="round-phase round-phase-final">
                      <div className="round-phase-header">
                        <span className="round-phase-step">Phase 3 of 3</span>
                        <h3>Results</h3>
                      </div>
                      <p className="round-leader-badge">Judge was: {group.currentTheme.czarUsername || 'Unknown'}</p>

                      <div className="submissions-list">
                        {(group.currentTheme.submissions || []).map(submission => {
                          const revealed = revealedComments.filter(c => c.submissionId === submission.id)
                          return (
                            <div key={submission.id} className="submission-item">
                              <div className="submission-song">
                                <span className="song-title">{submission.title}</span>
                                <span className="song-artist">{submission.channelTitle}</span>
                                {submission.playerUserId && (
                                  <span className="song-submitter">
                                    Submitted by {playerName(submission.playerUserId)}
                                  </span>
                                )}
                                {submission.wonBy && <span className="host-badge">🏆 Winner</span>}
                              </div>
                              <YouTubeEmbed videoId={submission.videoId} title={submission.title} />

                              {revealed.length > 0 && (
                                <ul className="vote-comments" aria-label={`Comments on ${submission.title}`}>
                                  {revealed.map((c, i) => (
                                    <li key={i} className="vote-comment">
                                      <span className="vote-comment-author">{playerName(c.voterUserId)}</span>
                                      <span className="vote-comment-text">{c.text}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )
                        })}
                      </div>

                      <RoundVideoList videos={group.currentTheme.submissions} />

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

                      {isHost && (
                        <>
                          <button
                            className="setup-button primary"
                            onClick={handleStartRound}
                            disabled={!canStartRound}
                          >
                            Start Next Round
                          </button>
                          {!canStartRound && (
                            <p className="setup-hint">
                              You need at least {MIN_PLAYERS_TO_START} players in the group to
                              start another round.
                            </p>
                          )}
                        </>
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

                        {/* Rounds completed before videos were recorded in
                            history simply have nothing to list. */}
                        <RoundVideoList videos={theme.videos} heading="Videos from this round" />
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
                  {isHost && !isEditingRules && (
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
                      <div className="form-row checkbox">
                        <label>
                          <input
                            type="checkbox"
                            checked={editedSettings.allowMemberInvites === true}
                            onChange={(e) => setEditedSettings(prev => ({ ...prev, allowMemberInvites: e.target.checked }))}
                          />
                          Allow members to invite others
                        </label>
                      </div>
                      {/* Worded around sharing, not access: the setting decides
                          who is shown the invite link, and anyone holding a
                          link can join regardless. */}
                      <p className="form-hint">
                        When off, only the host can share the invite link. This controls who can
                        share an invite — not who can join, since anyone with the link can join.
                      </p>
                    </div>

                    <div className="rules-section">
                      <h3>Judge Rules</h3>
                      <div className="form-row">
                        <label htmlFor="rules-czar-points">Points for Judge's Pick:</label>
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
                          Anonymous Judge
                        </label>
                      </div>
                      <div className="form-row checkbox">
                        <label>
                          <input 
                            type="checkbox" 
                            checked={editedSettings.allowSkipCzar}
                            onChange={(e) => setEditedSettings(prev => ({ ...prev, allowSkipCzar: e.target.checked }))}
                          />
                          Allow Skip Judge
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
                            checked={editedSettings.allowVotingComments === true}
                            onChange={(e) => setEditedSettings(prev => ({
                              ...prev,
                              allowVotingComments: e.target.checked,
                              // Turning the parent off takes the dependent
                              // setting with it, so the pair can't be left in
                              // a state the UI never shows.
                              showCommentsLive: e.target.checked ? prev.showCommentsLive : false
                            }))}
                          />
                          Allow comments during voting
                        </label>
                      </div>
                      {editedSettings.allowVotingComments === true && (
                        <div className="form-row checkbox">
                          <label>
                            <input
                              type="checkbox"
                              checked={editedSettings.showCommentsLive === true}
                              onChange={(e) => setEditedSettings(prev => ({ ...prev, showCommentsLive: e.target.checked }))}
                            />
                            Show comments live during voting
                          </label>
                        </div>
                      )}
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
                        <label htmlFor="rules-submission-time">Submission Length:</label>
                        <div className="window-control">
                          <input
                            id="rules-submission-time"
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
                      </div>
                      <div className="form-row">
                        <label htmlFor="rules-voting-time">Voting Length:</label>
                        <div className="window-control">
                          <input
                            id="rules-voting-time"
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
                          <option value="czar">Judge Chooses</option>
                          {/* Unimplemented alternatives, preserved as design
                              intent rather than deleted — see CreateGroup.jsx
                              for what each would need.
                          <option value="random">Random Selection</option>
                          <option value="vote">Player Vote</option>
                          */}
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
                        <li><strong>Members Can Share Invites:</strong> {group.settings.allowMemberInvites ? 'Yes' : 'No'}</li>
                      </ul>
                    </div>

                    <div className="rules-section">
                      <h3>Judge Rules</h3>
                      <ul className="rules-list">
                        <li><strong>Points for Judge's Pick:</strong> {group.settings.czarPoints}</li>
                        <li><strong>Anonymous Judge:</strong> {group.settings.anonymousCzar ? 'Yes' : 'No'}</li>
                        <li><strong>Allow Skip Judge:</strong> {group.settings.allowSkipCzar ? 'Yes' : 'No'}</li>
                      </ul>
                    </div>

                    <div className="rules-section">
                      <h3>Jury Rules</h3>
                      <ul className="rules-list">
                        <li><strong>Max Jury Points:</strong> {group.settings.maxJuryPoints}</li>
                        <li><strong>Allow Downvotes:</strong> {group.settings.allowDownvotes ? 'Yes' : 'No'}</li>
                        <li><strong>Comments During Voting:</strong> {group.settings.allowVotingComments ? 'Yes' : 'No'}</li>
                        {group.settings.allowVotingComments && (
                          <li><strong>Show Comments Live:</strong> {group.settings.showCommentsLive ? 'Yes' : 'No'}</li>
                        )}
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
                        <li><strong>Submission Length:</strong> {(hoursToWindowValue(group.settings.submissionTime || 24)).value} {(hoursToWindowValue(group.settings.submissionTime || 24)).unit}</li>
                        <li><strong>Voting Length:</strong> {(hoursToWindowValue(group.settings.votingTime || 24)).value} {(hoursToWindowValue(group.settings.votingTime || 24)).unit}</li>
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
                        {/* Only 'czar' is selectable, but an older group could
                            still carry another value, so this doesn't assume. */}
                        <li><strong>Topic Selection:</strong> {group.settings.topicSelection === 'czar' ? 'Judge Chooses' : group.settings.topicSelection}</li>
                        <li><strong>Allow Custom Topics:</strong> {group.settings.allowCustomTopics ? 'Yes' : 'No'}</li>
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
              {isHost ? (
                <button 
                  className="leave-button delete"
                  onClick={handleDeleteGroup}
                  disabled={deleting}
                  aria-label="Delete group"
                >
                  {deleting ? 'Deleting…' : 'Delete Group'}
                </button>
              ) : (
                <button 
                  className="leave-button"
                  onClick={handleLeaveGroup}
                  disabled={leaving}
                  aria-label="Leave group"
                >
                  {leaving ? 'Leaving…' : 'Leave Group'}
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
              <h2 id="submit-modal-title">Submit Video</h2>
              <button
                className="close-button"
                onClick={closeSubmitModal}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>

            <form className="modal-body" onSubmit={(e) => { e.preventDefault(); handleSubmitVideo(); }}>
              <YouTubeSearch selected={selectedVideo} onSelect={setSelectedVideo} />

              {selectedVideo && (
                <div className="form-group">
                  <span className="detail-label">Your pick</span>
                  <div className="youtube-selection">
                    <img
                      className="youtube-result-thumb"
                      src={selectedVideo.thumbnail}
                      alt=""
                      width="120"
                      height="68"
                    />
                    <span className="youtube-result-meta">
                      <span className="youtube-result-title">{selectedVideo.title}</span>
                      <span className="youtube-result-channel">{selectedVideo.channelTitle}</span>
                    </span>
                  </div>
                </div>
              )}

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
                  disabled={!selectedVideo}
                >
                  Submit Video
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
              <h2 id="round-leader-modal-title">Select Judge</h2>
              <button 
                className="close-button"
                onClick={() => setShowRoundLeaderModal(false)}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>
            
            <div className="modal-body">
              <p>
                {group.status === 'setup'
                  ? 'Choose how to select the Judge for the first round:'
                  : 'Choose how to select the Judge for this round:'}
              </p>
              
              <div className="leader-selection-options">
                <button 
                  className="leader-option-button"
                  onClick={handleRandomAssign}
                >
                  <div className="option-icon">🎲</div>
                  <div className="option-content">
                    <h3>Randomly Assign</h3>
                    <p>Let the system randomly pick a Judge from the group players</p>
                  </div>
                </button>
                
                <button 
                  className="leader-option-button"
                  onClick={handlePickLeader}
                >
                  <div className="option-icon">👤</div>
                  <div className="option-content">
                    <h3>Pick Judge</h3>
                    <p>Manually select a specific player to be the Judge</p>
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
              <h2 id="player-selection-modal-title">
                {isReplacingJudge ? 'Choose a different Judge' : 'Pick Judge'}
              </h2>
              <button 
                className="close-button"
                onClick={() => setShowPlayerSelection(false)}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>
            
            <div className="modal-body">
              <p>
                {isReplacingJudge
                  ? 'Hand this round’s Judge role to someone else. The topic has not been chosen yet, so nothing is lost.'
                  : 'Select a player to be the Judge for this round:'}
              </p>
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
