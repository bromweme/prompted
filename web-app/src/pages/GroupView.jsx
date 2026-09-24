import { useState, useEffect, useRef, useCallback } from 'react'
import {
  TOTAL_ROUNDS_CHOICES,
  MAX_PLAYER_CHOICES,
  CZAR_POINTS_RANGE,
  MAX_JURY_POINTS_RANGE,
  VOTE_BUDGET_RANGE,
  DOWNVOTE_COST_RANGE,
  OVERRIDE_THRESHOLD_RANGE,
  numberBounds,
} from '../utils/groupSettings'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useSocket } from '../context/SocketContext'
import { useUser } from '../context/UserContext'
import { useModalA11y } from '../hooks/useModalA11y'
import AppNav from '../components/AppNav'
import GroupPreview from '../components/GroupPreview'
import HostTopicEditor from '../components/HostTopicEditor'
import YouTubeSearch from '../components/YouTubeSearch'
import YouTubeEmbed from '../components/YouTubeEmbed'
import RoundVideoList from '../components/RoundVideoList'
import TopicPicker from '../components/TopicPicker'
import { WINDOW_UNITS, windowValueToHours, hoursToWindowValue } from '../utils/windowLengths'
import { formatInviteCode, inviteLinkFor } from '../utils/inviteCode'
import './GroupView.css'

// A round in its topic_selection phase has no deadline yet: the server sets
// currentTheme.deadline when the Judge picks a topic (select_topic), not at
// beginRound, so the topic-choosing time isn't taken out of the players'
// window. Formatting that missing value with `new Date(null)` would render the
// Unix epoch (a ~1970 date, and a large negative "hours" figure), so every
// deadline readout goes through these helpers and shows a plain placeholder
// until the submission clock actually starts.
const NO_DEADLINE_LABEL = 'Not set yet'

function hasUsableDeadline(deadline) {
  return Boolean(deadline) && !Number.isNaN(new Date(deadline).getTime())
}

// `withTime` picks the Round tab's "date at time" form; the Overview card uses
// the date alone. Output for a real deadline is unchanged from before.
function formatDeadline(deadline, { withTime = false } = {}) {
  if (!hasUsableDeadline(deadline)) return NO_DEADLINE_LABEL
  const when = new Date(deadline)
  return withTime
    ? `${when.toLocaleDateString()} at ${when.toLocaleTimeString()}`
    : when.toLocaleDateString()
}

// The Overview "Time Remaining" stat. Keeps the existing whole-hours rounding
// for a real deadline; only the missing/invalid case changes.
function formatHoursRemaining(deadline) {
  if (!hasUsableDeadline(deadline)) return NO_DEADLINE_LABEL
  const hours = Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60))
  return `${hours} hours`
}

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
    // Only members ever receive this (UI-2). Absent on a pre-UI-2 group, whose
    // code is still its id until the host resets it.
    inviteCode: group.inviteCode || null,
    name: group.name,
    description: group.description,
    isPrivate: group.isPrivate === true,
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
      allowCustomTopics: group.settings.allowCustomTopics !== false,
      enableChat: group.settings.enableChat || false,
      enableSongPreview: group.settings.enableSongPreview !== false,
      showVoterIdentity: group.settings.showVoterIdentity || false,
      allowMemberInvites: group.settings.allowMemberInvites === true,
      allowVotingComments: group.settings.allowVotingComments === true,
      showCommentsLive: group.settings.showCommentsLive === true,
      // Per-round vote budget (default 10) and the "Share the wealth" rule
      // (default on) — see docs/design/c8-per-round-vote-budget-change-design.md.
      voteBudget: typeof group.settings.voteBudget === 'number' ? group.settings.voteBudget : 10,
      shareTheWealth: group.settings.shareTheWealth !== false
    },
    status: group.status,
    currentRound: group.currentRound,
    players: mapPlayers(group.players, group.host),
    currentTheme: group.currentTheme || null,
    history: group.history || [],
    // Judge rotation (RT-3): who has already served as Judge this cycle.
    judgedThisCycle: group.judgedThisCycle || [],
    // Host governance (HG-1): whether the host has abandoned the group, and any
    // in-flight host election.
    hostAbandoned: group.hostAbandoned === true,
    election: group.election || null,
    // Games and topics (GT-1): the host's topic list, what's been played this
    // game, which game (set) this is, and final standings once it ends.
    hostTopics: group.hostTopics || [],
    usedTopicIds: group.usedTopicIds || [],
    setNumber: group.setNumber || 1,
    finalStandings: group.finalStandings || null,
    completedSets: group.completedSets || []
  }
}

function GroupView() {
  const { groupId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { socket, isConnected } = useSocket()
  const { user } = useUser()
  
  const [group, setGroup] = useState(null)
  // A link can open a specific tab (?tab=requests from a join-request
  // notification, say), including when this group is already on screen.
  const tabParam = new URLSearchParams(location.search).get('tab')
  const [activeTab, setActiveTab] = useState(tabParam || 'overview')
  const [syncedTab, setSyncedTab] = useState(tabParam)
  if (tabParam !== syncedTab) {
    setSyncedTab(tabParam)
    if (tabParam) setActiveTab(tabParam)
  }
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
  // How many budget points this player still has this round, delivered by the
  // server (per-socket, like ownSubmissionId). The old single `userVote` flag
  // could not tell "mid-budget" from "spent" once multiple votes were possible
  // (RT-2), so this replaces it as the voting gate.
  const [remainingBudget, setRemainingBudget] = useState(null)
  // The distinct submissions this player has voted on this round, tracked
  // locally so the UI can warn (and disable a persona-breaking cast) when
  // "Share the wealth" is on and a vote would concentrate everything on one.
  const [myVotedSubmissionIds, setMyVotedSubmissionIds] = useState(() => new Set())
  // Which submission in the current round is this player's own. The server
  // tells each socket only about its own, so this can gate self-voting in the
  // UI without leaking anyone else's authorship.
  const [ownSubmissionId, setOwnSubmissionId] = useState(null)
  const [showInviteModal, setShowInviteModal] = useState(false)
  // Starting with something missing opens one of these instead of the Judge
  // prompt: too few players, or (custom topics off) too few topics.
  const [showPlayersModal, setShowPlayersModal] = useState(false)
  const [showTopicsModal, setShowTopicsModal] = useState(false)
  const playersModalRef = useRef(null)
  const topicsModalRef = useRef(null)
  // Durable messages for the host, e.g. a round that restarted while they were
  // away. They persist server-side until acknowledged, so one that arrives
  // during an offline spell is still waiting on the next connection.
  const [hostNotices, setHostNotices] = useState([])
  // Host only (JR-1): pending join requests and banned players. The server
  // sends null to everyone else.
  const [hostPanel, setHostPanel] = useState(null)
  // Bumped when a view-only visitor is accepted, to load the full group.
  const [reloadKey, setReloadKey] = useState(0)
  const [linkCopied, setLinkCopied] = useState(false)
  const [codeCopied, setCodeCopied] = useState(false)
  // Host-only invite code reset (UI-2): an in-page confirm step rather than a
  // native confirm(), plus the in-flight flag and any refusal to show.
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [resettingCode, setResettingCode] = useState(false)
  const [resetError, setResetError] = useState(null)
  // Why this group could not be shown: the server refused get_group (missing
  // group, or not a member; it deliberately answers both the same way) or
  // refused the legacy ?join=true join. Replaces the page instead of leaving
  // a spinner up forever.
  const [accessError, setAccessError] = useState(null)
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
  // Detaches the listeners of an in-flight invite code reset, if any.
  const abandonResetRef = useRef(null)
  const abandonPendingReset = () => {
    if (abandonResetRef.current) abandonResetRef.current()
    abandonResetRef.current = null
    setResettingCode(false)
  }

  const closeInviteModal = () => {
    // Closing gives up on a reset still waiting for its reply, so reopening
    // never finds the button stuck on "Resetting…". A reset the server did
    // apply still reaches this page through group_updated.
    abandonPendingReset()
    setShowInviteModal(false)
    setConfirmingReset(false)
    setResetError(null)
  }

  // Leaving the page drops a pending reset's listeners with it.
  useEffect(() => () => {
    if (abandonResetRef.current) abandonResetRef.current()
  }, [])

  useModalA11y(showInviteModal, inviteModalRef, closeInviteModal)
  useModalA11y(showPlayersModal, playersModalRef, () => setShowPlayersModal(false))
  useModalA11y(showTopicsModal, topicsModalRef, () => setShowTopicsModal(false))

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
    setRemainingBudget(null)
    setMyVotedSubmissionIds(new Set())
    setSelectedSubmissionId(null)
    setVoteComment('')
    setOwnSubmissionId(null)
  }, [group?.currentTheme?.id])

  useEffect(() => {
    if (!socket || !isConnected || !user) return

    // Get group data from navigation state or fetch from server
    if (location.state?.groupData) {
      const groupData = location.state.groupData
      
      // Ensure group has all required fields. The dashboard's copy doesn't
      // carry the GT-1 fields, and reading them undefined blanked the page
      // for a group with custom topics off.
      const fullGroupData = {
        ...groupData,
        hostTopics: groupData.hostTopics || [],
        usedTopicIds: groupData.usedTopicIds || [],
        setNumber: groupData.setNumber || 1,
        finalStandings: groupData.finalStandings || null,
        completedSets: groupData.completedSets || [],
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
          showCommentsLive: false,
          voteBudget: 10,
          shareTheWealth: true
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

    setAccessError(null)

    // Exactly one of the success/failure listeners below answers the initial
    // load; each removes the other, so a later, unrelated error (a refused
    // vote, say) can never be mistaken for "this group can't be shown".
    const applyGroupPayload = ({ group, isRoundLeader: youAreRoundLeader, yourSubmissionId, voteBudgetRemaining, notices, hostPanel: panel }) => {
      setGroup(normalizeGroupData(group))
      setIsRoundLeader(!!youAreRoundLeader)
      setOwnSubmissionId(yourSubmissionId || null)
      if (typeof voteBudgetRemaining === 'number') setRemainingBudget(voteBudgetRemaining)
      setHostNotices(notices || [])
      setHostPanel(panel || null)
    }
    const isLegacyJoin = new URLSearchParams(location.search).get('join') === 'true'

    // Once a legacy ?join=true visit has shown the group, drop the query so a
    // reload, reconnect or re-opened tab takes the plain member path. The
    // effect re-runs for the new URL and re-reads the group with get_group;
    // `group` is kept, so the page does not blink.
    const stripLegacyQuery = () => {
      if (isLegacyJoin) navigate(`/group/${groupId}`, { replace: true })
    }

    // Stage 2 of a legacy ?join=true visit, used only when get_group says this
    // player is not a member (REP-UI2-1). The id in the path is sent as an
    // invite code, which only ever matches a pre-UI-2 group whose code is
    // still its id. Its refusal (e.g. a code retired by a reset) is what the
    // page shows.
    const onJoined = (payload) => {
      // A reply about some other group isn't ours; keep waiting.
      if (payload.group?.id !== groupId) {
        socket.once('group_joined', onJoined)
        return
      }
      socket.off('error', onJoinError)
      applyGroupPayload(payload)
      stripLegacyQuery()
    }
    const onJoinError = ({ message }) => {
      // join_group never answers "Group not found"; that is the reply to an
      // earlier get_group still in flight from a previous run of this effect
      // (it re-runs as the session settles). Keep waiting for the join.
      if (message === 'Group not found') {
        socket.once('error', onJoinError)
        return
      }
      socket.off('group_joined', onJoined)
      console.error('Error joining group:', message)
      setAccessError(message || 'Invite code not found')
    }

    const onLoaded = (payload) => {
      // One socket serves every page in the tab, so a reply about some other
      // group isn't ours; keep waiting for this one.
      if (payload.group?.id !== groupId) {
        socket.once('group_details', onLoaded)
        return
      }
      socket.off('error', onLoadError)
      applyGroupPayload(payload)
      stripLegacyQuery()
    }
    const onLoadError = ({ message }) => {
      socket.off('group_details', onLoaded)
      if (isLegacyJoin && message === 'Group not found') {
        // Not a member (yet): fall back to the legacy join. No access error
        // is set here, so the not-a-member page never flashes before the
        // join attempt answers.
        socket.once('group_joined', onJoined)
        socket.once('error', onJoinError)
        socket.emit('join_group', { inviteCode: groupId, via: 'link' })
        return
      }
      console.error('Error fetching group:', message)
      setAccessError(message || 'Group not found')
    }
    socket.once('group_details', onLoaded)
    socket.once('error', onLoadError)

    // Members only: a non-member gets "Group not found" (UI-2). This comes
    // first even on a legacy ?join=true link, so an existing member never
    // re-sends a join with a code a reset may since have retired (REP-UI2-1).
    socket.emit('get_group', { groupId })

    // Listen for group updates
    socket.on('group_updated', ({ group, isRoundLeader: youAreRoundLeader, yourSubmissionId, voteBudgetRemaining, notices, hostPanel: panel }) => {
      // The server keeps sending live updates for every group this player has
      // opened in this tab, because they all share one socket. Only this
      // page's group may change what's on screen; before this check, a vote
      // in another group could overwrite the one being viewed.
      if (group?.id !== groupId) return
      if (yourSubmissionId !== undefined) setOwnSubmissionId(yourSubmissionId || null)
      if (typeof voteBudgetRemaining === 'number') setRemainingBudget(voteBudgetRemaining)
      if (notices !== undefined) setHostNotices(notices || [])
      if (panel !== undefined) setHostPanel(panel || null)
      // A broadcast can land before this page's own load reply (e.g. the one
      // that follows a join); the load reply carries the full group anyway.
      setGroup(prev => (prev ? {
        ...prev,
        ...group,
        players: mapPlayers(group.players, group.host),
        settings: {
          ...prev.settings,
          ...group.settings
        }
      } : prev))
      if (typeof youAreRoundLeader === 'boolean') {
        setIsRoundLeader(youAreRoundLeader)
      }
    })

    socket.on('player_joined_group', ({ players }) => {
      setGroup(prev => (prev ? {
        ...prev,
        players: mapPlayers(players, prev.host)
      } : prev))
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

    // The host kicked or banned this player (JR-1). The dashboard shows why.
    socket.on('removed_from_group', ({ groupId: removedFrom, groupName, reason }) => {
      if (removedFrom !== groupId) return
      const notice = reason === 'banned'
        ? `You were banned from ${groupName}.`
        : `You were removed from ${groupName}. You can ask to join again.`
      navigate('/dashboard', { replace: true, state: { notice } })
    })

    return () => {
      socket.off('group_updated')
      socket.off('player_joined_group')
      socket.off('group_details')
      socket.off('group_joined', onJoined)
      socket.off('left_group')
      socket.off('group_deleted')
      socket.off('removed_from_group')
      socket.off('error')
    }
  }, [groupId, location.state, location.search, socket, isConnected, user, navigate, reloadKey])

  // Both the first round (start_group) and every later one (start_round) go
  // through the same Judge-selection prompt, so the host always gets the
  // choice rather than only from round 2 onwards.
  // Start is never greyed out: a greyed button with small print reads as
  // broken. Clicking it with something missing explains what and offers the
  // fix right there; otherwise it goes on to the Judge prompt.
  const openStartFlow = () => {
    if (group.players.length < MIN_PLAYERS_TO_START) {
      setShowPlayersModal(true)
      return
    }
    if (group.status === 'setup' && !hasEnoughTopics) {
      setShowTopicsModal(true)
      return
    }
    setShowRoundLeaderModal(true)
  }

  const handleStartRound = () => {
    openStartFlow()
  }

  const emitRoundStart = (czarUserId) => {
    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }

    // Round 1 transitions the group out of setup; later rounds don't.
    const event = group.status === 'setup' ? 'start_group' : 'start_round'

    // Nobody can join during a round (JR-1), so with requests waiting the
    // server asks first. They stay queued to be accepted after this round.
    socket.off('start_needs_confirmation')
    socket.once('start_needs_confirmation', ({ pendingCount }) => {
      const waiting = pendingCount === 1 ? '1 person is' : `${pendingCount} people are`
      if (confirm(`${waiting} waiting to join. Start the round without them? You can accept them once this round ends.`)) {
        socket.emit(event, { groupId, czarUserId, startWithoutPending: true })
      }
    })
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

  // The setup panel's Start Round button (handleStartGroup) opens the same
  // Select-Judge prompt instead of silently assigning a
  // random Judge. The old success alert is gone: the round view shows the
  // topic-selection phase directly, and a blocking dialog on a normal flow
  // just gets in the way.
  const handleStartGroup = () => {
    openStartFlow()
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

  // The Judge declines their turn (RT-3). The server re-assigns the role to a
  // random member who has not already judged this cycle; if everyone skips, the
  // first-assigned Judge must play.
  const handleSkipJudge = () => {
    if (socket && groupId) socket.emit('judge_skip', { groupId })
  }

  // A member opens a host election when the host has abandoned the group
  // (HG-1). The server only allows this while the host is determined gone.
  const handleOpenElection = () => {
    if (socket && groupId) socket.emit('host_election_open', { groupId })
  }

  // A member casts a vote for a new host (HG-1). The server keys the vote to
  // the authenticated identity and refuses self-votes.
  const handleHostVote = (candidateId) => {
    if (socket && groupId) socket.emit('host_vote', { groupId, candidateId })
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

  // A view-only visitor was let in (JR-1): load the full group page.
  const onRequestAccepted = useCallback(() => {
    setAccessError(null)
    setReloadKey((key) => key + 1)
  }, [])

  // Host moderation (JR-1). Refusals come back on the shared 'error' event,
  // the same way the page's other host actions report them.
  const hostAction = (event, payload) => {
    if (!socket || !isConnected) {
      alert('Please wait for server connection')
      return
    }
    socket.once('error', ({ message }) => alert(message))
    socket.emit(event, { groupId, ...payload })
  }

  const handleAcceptRequest = (request) => {
    hostAction('respond_join_request', { requesterId: request.userId, accept: true })
  }

  const handleDeclineRequest = (request) => {
    hostAction('respond_join_request', { requesterId: request.userId, accept: false })
  }

  const handleKick = (player) => {
    if (!confirm(`Are you sure you want to kick ${player.username} from the group?\n\nKicked players can still ask to join again later.`)) return
    hostAction('kick_player', { targetId: player.id })
  }

  const handleBan = (person) => {
    const id = person.id || person.userId
    if (!confirm(`Ban ${person.username}? They'll be removed and can't rejoin unless you unban them.`)) return
    hostAction('ban_player', { targetId: id })
  }

  const handleUnban = (banned) => {
    hostAction('unban_player', { targetId: banned.userId })
  }

  const handleStartNewSet = () => {
    if (!confirm('Start a new game? Scores go back to zero, and every topic can be played again.')) return
    hostAction('start_new_set', {})
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

  // GT-1: with custom topics off, a game needs one unused host topic per round.
  const hostTopicsOnly = !!group && group.settings.allowCustomTopics === false
  const topicsNeeded = group ? (group.settings.totalRounds || 6) : 0
  const groupHostTopics = group?.hostTopics || []
  const usedTopicIds = group?.usedTopicIds || []
  const unusedHostTopics = hostTopicsOnly
    ? groupHostTopics.filter((t) => !usedTopicIds.includes(t.id)).length
    : 0
  const hasEnoughTopics = !hostTopicsOnly || unusedHostTopics >= topicsNeeded
  const isFinished = !!group && group.status === 'finished'

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
  // who is shown the code, not who may join. Anyone holding the invite code
  // (or its /join link) can join; the host can reset the code to cut that off.
  const canInvite = !!group && (isHost || group.settings.allowMemberInvites === true)

  // The group's invite code (UI-2). A pre-UI-2 group has none yet, and its id
  // still works as its code until the host resets it.
  const inviteCode = group ? (group.inviteCode || group.id) : ''
  const inviteLink = inviteCode ? inviteLinkFor(inviteCode) : ''

  const handleInvitePlayer = () => {
    setShowInviteModal(true)
  }

  const copyToClipboard = async (text, setCopied, what) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error(`Failed to copy invite ${what}:`, err)
      alert(`Could not copy the ${what} automatically. Please copy it manually.`)
    }
  }

  const handleCopyInviteLink = () => copyToClipboard(inviteLink, setLinkCopied, 'link')
  const handleCopyInviteCode = () => copyToClipboard(formatInviteCode(inviteCode), setCodeCopied, 'code')

  // Host replaces the invite code (UI-2). The old code and link stop working at
  // once; members are unaffected. The server answers the host directly with
  // the new code (and broadcasts it to members through group_updated).
  const handleResetInviteCode = () => {
    if (resettingCode) return
    if (!socket || !isConnected) {
      setResetError('Please wait for the server connection')
      return
    }
    setResettingCode(true)
    setResetError(null)

    const detach = () => {
      socket.off('invite_code_reset', onReset)
      socket.off('error', onError)
      socket.off('disconnect', onDrop)
      abandonResetRef.current = null
    }
    const onReset = ({ groupId: resetId, inviteCode: freshCode }) => {
      if (resetId !== groupId) return
      detach()
      setGroup(prev => (prev ? { ...prev, inviteCode: freshCode } : prev))
      setResettingCode(false)
      setConfirmingReset(false)
    }
    const onError = ({ message }) => {
      detach()
      setResettingCode(false)
      setResetError(message || 'Could not reset the invite code')
    }
    // The connection dropped before the reply: that reply will never come on
    // this socket, so release the button and back out of the confirm step to
    // let the host try again (REP-UI2-1). If the server did apply the reset,
    // the new code arrives with the next group load.
    const onDrop = () => {
      detach()
      setResettingCode(false)
      setConfirmingReset(false)
    }
    abandonResetRef.current = detach
    socket.on('invite_code_reset', onReset)
    socket.once('error', onError)
    socket.once('disconnect', onDrop)
    socket.emit('reset_invite_code', { groupId })
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

    // Optimistically fold this vote into the local view so the UI can keep
    // rendering the spread/concentrate affordance. The server is the authority
    // on the budget (it rejects an over-budget or concentration-violating cast
    // and re-broadcasts the true remaining budget back to us), so a mismatch
    // here is only ever cosmetic and self-corrects on the next group_updated.
    setMyVotedSubmissionIds(prev => new Set(prev).add(selectedSubmissionId))
    if (typeof remainingBudget === 'number') {
      const cost = isDownvote ? (group.settings.downvoteCost || 1) : (group.settings.maxJuryPoints ? Math.max(0, Math.min(votePoints, group.settings.maxJuryPoints)) : votePoints)
      setRemainingBudget(Math.max(0, remainingBudget - cost))
    }
    setVoteComment('')
    setSelectedSubmissionId(null)
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

  // ---- RT-2 vote-budget view-model (server-sourced gate) ----
  // remainingBudget is delivered per-socket by the server; when it has not
  // arrived yet (e.g. mid-handoff) we fall back to the full budget so the UI
  // never disables voting purely on a missing field.
  const budgetSetting = typeof group?.settings?.voteBudget === 'number' ? group.settings.voteBudget : 10
  const currentRemaining = typeof remainingBudget === 'number' ? remainingBudget : budgetSetting
  const voteBudgetSpent = !group?.currentTheme || currentRemaining <= 0
  // A single vote is capped by the per-vote max (maxJuryPoints) AND by how
  // much budget remains, so a player can't be offered a value they can't afford.
  const maxVoteValue = group?.settings?.maxJuryPoints
    ? Math.min(group.settings.maxJuryPoints, Math.max(0, currentRemaining))
    : Math.max(0, currentRemaining)
  // "Share the wealth" (default on): a player must spread points across at
  // least two submissions. If this vote is their first-or-only submission and
  // it would consume their whole remaining budget, the cast is disabled and a
  // hint explains why — mirroring the server-side rejection.
  const shareRuleOn = group?.settings?.shareTheWealth !== false
  const costOfDownvote = group?.settings?.downvoteCost || 1
  const castThisVoteWouldConcentrate = (() => {
    if (!shareRuleOn || !selectedSubmissionId) return false
    const cost = Math.min(votePoints, maxVoteValue)
    const afterRemaining = currentRemaining - cost
    const newDistinct = myVotedSubmissionIds.has(selectedSubmissionId) ? myVotedSubmissionIds.size : myVotedSubmissionIds.size + 1
    return newDistinct < 2 && afterRemaining <= 0
  })()

  if (accessError) {
    // The server answers "Group not found" both for a missing group and for
    // one this player is not in, so the copy covers both without guessing.
    const notFound = accessError === 'Group not found'
    const accessCard = (
        <main id="main-content" className="group-access-main">
          <section className="group-access-card" aria-labelledby="group-access-title">
            <h1 id="group-access-title" className="group-access-title">
              {notFound ? "You're not a member of this group" : "Couldn't join this group"}
            </h1>
            <p className="group-access-message" role="alert">
              {notFound
                ? "This group doesn't exist, or you haven't joined it. Ask the host for an invite link or code."
                : accessError}
            </p>
            <button className="submit-button" onClick={() => navigate('/dashboard')}>
              Back to Dashboard
            </button>
          </section>
        </main>
    )
    return (
      <div className="group-view-page">
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <AppNav />
        {/* Not a member: a group that isn't private gets a view-only page
            with Request to Join (JR-1); anything else gets the usual card. */}
        {notFound ? (
          <GroupPreview
            groupId={groupId}
            onAccepted={onRequestAccepted}
            notMember={accessCard}
          />
        ) : accessCard}
      </div>
    )
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
                    <span className="round-info">
                      {isFinished ? 'Game over' : `Round ${group.currentRound}/${group.settings.totalRounds}`}
                    </span>
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
                     Host-only: it carries Start Round, which the server
                     refuses for anyone else, and it used to render alongside
                     the non-host "Waiting for Host" panel. The invite action
                     now lives in the Group Info card above. */
                  <div className="setup-state">
                    <div className="setup-icon" aria-hidden="true">🎯</div>
                    <h3>Group Setup</h3>
                    <p>Invite players to join your group before starting the first round.</p>

                    <div className="setup-actions">
                      <button
                        className="setup-button primary"
                        onClick={handleStartGroup}
                      >
                        Start Round
                      </button>
                    </div>

                    <div className="setup-info">
                      <p>Players joined: {group.players.length}</p>
                      {group.players.length === 1 ? (
                        <p className="setup-warning">
                          <span aria-hidden="true">⚠️</span> You need at least {MIN_PLAYERS_TO_START} players
                          to start: one to judge and one to submit. Invite someone to join.
                        </p>
                      ) : (canStartRound && hasEnoughTopics) && (
                        <p className="setup-hint">Ready to start.</p>
                      )}
                    </div>
                  </div>
                )}

                {isFinished && (
                  /* GT-1: the game ended after its last round. */
                  <section className="game-over" aria-labelledby="game-over-title">
                    <h3 id="game-over-title">Game over</h3>
                    {group.finalStandings && group.finalStandings.length > 0 && (
                      <p className="game-over-winner">
                        {group.finalStandings[0].username} won with {group.finalStandings[0].score} points.
                      </p>
                    )}
                    <ol className="game-over-standings">
                      {(group.finalStandings || []).map((entry) => (
                        <li key={entry.userId}>
                          <span className="player-name">{entry.username}</span>
                          <span className="score">{entry.score} pts</span>
                        </li>
                      ))}
                    </ol>
                    {isHost ? (
                      <button type="button" className="setup-button primary" onClick={handleStartNewSet}>
                        Start a new game
                      </button>
                    ) : (
                      <p className="setup-hint">The host can start a new game. You'll get a notification.</p>
                    )}
                  </section>
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
                      {/* UI-4: until the Judge picks a theme (title is null in
                          topic_selection), say so instead of "Current Theme". */}
                      <h3>{group.currentTheme.title ? 'Current Theme' : "Choosing This Round's Theme"}</h3>
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
                      {group.currentTheme.title && (
                        <>
                          <h4>{group.currentTheme.title}</h4>
                          <p className="theme-description">{group.currentTheme.description}</p>
                        </>
                      )}

                      <div className="theme-stats">
                        <div className="theme-stat">
                          <span className="stat-label">Submissions</span>
                          <span className="stat-value">{group.currentTheme.submissionCount ?? 0}</span>
                        </div>
                        <div className="theme-stat">
                          <span className="stat-label">Deadline</span>
                          <span className="stat-value">
                            {formatDeadline(group.currentTheme.deadline)}
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
                    <p>{group.currentTheme ? formatHoursRemaining(group.currentTheme.deadline) : 'No active theme'}</p>
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
                      <h3>{group.currentTheme.title ? 'Current Theme' : "Choosing This Round's Theme"}</h3>
                      <span className="round-leader-badge">
                        {isRoundLeader
                          ? 'You are the Judge'
                          : group.currentTheme.czarUsername
                            ? `Judge: ${group.currentTheme.czarUsername}`
                            : 'Judge: Anonymous'}
                      </span>
                    </div>
                    <div className="round-info-body">
                      {group.currentTheme.title && (
                        <>
                          <h4>{group.currentTheme.title}</h4>
                          <p className="round-description">{group.currentTheme.description}</p>
                        </>
                      )}
                      <div className="round-stats">
                        <div className="round-stat">
                          <span className="stat-label">Submissions</span>
                          <span className="stat-value">{group.currentTheme.submissionCount ?? 0}</span>
                        </div>
                        <div className="round-stat">
                          <span className="stat-label">Deadline</span>
                          <span className="stat-value">
                            {formatDeadline(group.currentTheme.deadline, { withTime: true })}
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
                          <TopicPicker groupId={groupId} onSelect={handleSelectTopic} hostTopicsOnly={hostTopicsOnly} />

                          {/* Judge skip (RT-3): a Judge who doesn't want the role
                              can pass it to a random member who hasn't judged this
                              cycle. The first-assigned Judge who is reverted to
                              after a full-cycle skip is not offered the pass again. */}
                          {!group.currentTheme.judgeMustPlay && (
                            <div className="judge-skip-control">
                              <button
                                className="action-button"
                                onClick={handleSkipJudge}
                              >
                                Skip my turn
                              </button>
                              <p className="form-hint">
                                Pass the Judge role to someone who hasn't judged yet this cycle.
                              </p>
                            </div>
                          )}
                          {group.currentTheme.judgeMustPlay && (
                            <p className="form-hint">
                              Everyone has skipped, so you must pick a topic this round.
                            </p>
                          )}

                          {/* Rotation state (RT-3): who has already served as Judge
                              this cycle, so the fairness rule is legible. */}
                          {group.judgedThisCycle.length > 0 && (
                            <p className="form-hint judge-rotation-hint">
                              Already judged this cycle: {group.judgedThisCycle
                                .map(id => playerName(id))
                                .join(', ')}
                            </p>
                          )}
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
                                className={`submission-item ${!voteBudgetSpent && !isOwn ? 'selectable' : ''} ${selectedSubmissionId === submission.id ? 'selected' : ''} ${isOwn ? 'own-submission' : ''}`}
                                onClick={() => setSelectedSubmissionId(submission.id)}
                                disabled={voteBudgetSpent || isOwn}
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

                      {voteBudgetSpent ? (
                        <div className="voting-actions voting-budget-spent">
                          <p className="submissions-count">You've spent your {budgetSetting}-point budget for this round — waiting for the rest of the group.</p>
                        </div>
                      ) : selectedSubmissionId ? (
                        <div className="voting-actions">
                          <p className="submissions-count budget-remaining">
                            Budget remaining: {currentRemaining}/{budgetSetting} points
                          </p>
                          <label>
                            Points:
                            <select value={votePoints} onChange={(e) => setVotePoints(parseInt(e.target.value))}>
                              {Array.from({ length: Math.max(0, maxVoteValue) }, (_, i) => i + 1).map(n => (
                                <option key={n} value={n}>{n}</option>
                              ))}
                            </select>
                          </label>

                          {shareRuleOn && myVotedSubmissionIds.size < 2 && (
                            <p className="form-hint share-wealth-hint">
                              Share the wealth is on — spread your points across at least two submissions.
                            </p>
                          )}

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

                          <button
                            className="theme-action-button"
                            onClick={() => handleCastVote(false)}
                            disabled={castThisVoteWouldConcentrate}
                          >
                            Cast Vote
                          </button>
                          {castThisVoteWouldConcentrate && (
                            <p className="form-hint share-wealth-warning">
                              With Share the wealth on you can't put your whole budget on one submission.
                            </p>
                          )}
                          {group.settings.allowDownvotes && currentRemaining >= costOfDownvote && (
                            <button className="cancel-button" onClick={() => handleCastVote(true)}>
                              Downvote ({costOfDownvote} pts)
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

                      {isFinished && (
                        <p className="setup-hint">
                          That was the last round. See the final standings on the Overview.
                        </p>
                      )}
                      {isHost && !isFinished && (
                        <>
                          <button
                            className="setup-button primary"
                            onClick={handleStartRound}
                          >
                            Start Next Round
                          </button>
                          {group.players.length === 1 && (
                            <p className="setup-warning">
                              <span aria-hidden="true">⚠️</span> You need at least {MIN_PLAYERS_TO_START} players
                              to start another round. Invite someone to join.
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

                {/* Host governance (HG-1): when the host has abandoned the group,
                    members get a leave-or-vote choice. A present host never sees
                    this, and a briefly-offline host is never affected. */}
                {group.hostAbandoned && !isHost && (
                  <div className="host-election-banner">
                    <h3>The host hasn't been here in a while</h3>
                    <p>
                      You can leave the group, or vote for a new host. A majority of
                      current members elects the new sole host.
                    </p>

                    {!group.election?.open ? (
                      <button
                        className="action-button"
                        onClick={handleOpenElection}
                      >
                        Start a host election
                      </button>
                    ) : (
                      <div className="host-election-ballot">
                        <p className="form-hint">
                          Vote for a new host. You can't vote for yourself.
                        </p>
                        {group.players
                          .filter(p => !p.isHost)
                          .map(candidate => {
                            const myVote = group.election.votes?.[user?.id]
                            const votesFor = Object.values(group.election.votes || {})
                              .filter(v => v === candidate.id).length
                            return (
                              <div key={candidate.id} className="host-election-candidate">
                                <span className="participant-name">{candidate.username}</span>
                                <span className="form-hint">{votesFor} vote{votesFor === 1 ? '' : 's'}</span>
                                <button
                                  className="action-button"
                                  onClick={() => handleHostVote(candidate.id)}
                                  disabled={myVote === candidate.id}
                                >
                                  {myVote === candidate.id ? 'Your vote' : 'Vote'}
                                </button>
                              </div>
                            )
                          })}
                      </div>
                    )}
                  </div>
                )}

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

                      {isHost && !player.isHost && (
                        <div className="participant-moderation">
                          <button
                            type="button"
                            className="cancel-button"
                            onClick={() => handleKick(player)}
                            aria-label={`Kick ${player.username}`}
                          >
                            Kick
                          </button>
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => handleBan(player)}
                            aria-label={`Ban ${player.username}`}
                          >
                            Ban
                          </button>
                        </div>
                      )}
                      
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

            {activeTab === 'topics' && isHost && hostTopicsOnly && (
              <section className="tab-content">
                <h2>Group Topics</h2>
                <p className="form-hint">
                  Custom topics are off, so the Judge picks from this list. Each topic can be
                  played once per game, so a {topicsNeeded}-round game needs at least {topicsNeeded}.
                </p>
                <HostTopicEditor group={group} needed={topicsNeeded} />
              </section>
            )}

            {activeTab === 'requests' && isHost && hostPanel && (
              <section className="tab-content">
                <h2>Join Requests</h2>
                {group.currentTheme && group.currentTheme.status !== 'reveal' && (
                  <p className="form-hint" role="status">
                    A round is under way. You can accept requests once it ends.
                  </p>
                )}

                {hostPanel.joinRequests.length === 0 ? (
                  <p className="requests-empty">No one is waiting to join.</p>
                ) : (
                  <ul className="requests-list">
                    {hostPanel.joinRequests.map((request) => (
                      <li key={request.userId} className="request-card">
                        <div className="request-info">
                          <span className="participant-name">{request.username}</span>
                          <span className="form-hint">
                            Asked {new Date(request.requestedAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="request-actions">
                          <button
                            type="button"
                            className="submit-button"
                            onClick={() => handleAcceptRequest(request)}
                            disabled={!!group.currentTheme && group.currentTheme.status !== 'reveal'}
                            aria-label={`Accept ${request.username}`}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="cancel-button"
                            onClick={() => handleDeclineRequest(request)}
                            aria-label={`Decline ${request.username}`}
                          >
                            Decline
                          </button>
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => handleBan(request)}
                            aria-label={`Ban ${request.username}`}
                          >
                            Ban
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                <h3 className="banned-heading">Banned players</h3>
                {hostPanel.bannedUsers.length === 0 ? (
                  <p className="requests-empty">No one is banned.</p>
                ) : (
                  <ul className="requests-list">
                    {hostPanel.bannedUsers.map((banned) => (
                      <li key={banned.userId} className="request-card">
                        <div className="request-info">
                          <span className="participant-name">{banned.username}</span>
                          <span className="form-hint">
                            Banned {new Date(banned.bannedAt).toLocaleString()}
                          </span>
                        </div>
                        <div className="request-actions">
                          <button
                            type="button"
                            className="cancel-button"
                            onClick={() => handleUnban(banned)}
                            aria-label={`Unban ${banned.username}`}
                          >
                            Unban
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
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
                        <select
                          id="rules-total-rounds"
                          value={editedSettings.totalRounds}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, totalRounds: parseInt(e.target.value) }))}
                          disabled={group.status === 'active'}
                          aria-describedby={group.status === 'active' ? 'rules-rounds-locked' : undefined}
                        >
                          {TOTAL_ROUNDS_CHOICES.map((count) => (
                            <option key={count} value={count}>{count} Rounds</option>
                          ))}
                          {/* A stored value the list does not contain stays
                              visible rather than the form silently reporting a
                              different number than the group actually has. */}
                          {!TOTAL_ROUNDS_CHOICES.includes(editedSettings.totalRounds) && (
                            <option value={editedSettings.totalRounds}>
                              {editedSettings.totalRounds} Rounds (current)
                            </option>
                          )}
                        </select>
                        {group.status === 'active' && (
                          <small id="rules-rounds-locked" className="form-hint">
                            The number of rounds can only change before a game starts or after it ends.
                          </small>
                        )}
                      </div>
                      {/* The same six choices the Create Group wizard offers.
                          This was a free number input accepting up to 50, so a
                          host could set a limit the wizard would have refused —
                          and the server, which now enforces the limit, caps at
                          20. One control, one answer. */}
                      <div className="form-row">
                        <label htmlFor="rules-max-players">Max Players:</label>
                        <select
                          id="rules-max-players"
                          value={editedSettings.maxPlayers}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, maxPlayers: parseInt(e.target.value) }))}
                        >
                          {MAX_PLAYER_CHOICES.map((count) => (
                            <option key={count} value={count}>{count} Players</option>
                          ))}
                          {/* A group stored with something else (the old input
                              allowed any number) keeps its own value visible
                              rather than silently jumping to the nearest
                              option the moment the form opens. */}
                          {!MAX_PLAYER_CHOICES.includes(editedSettings.maxPlayers) && (
                            <option value={editedSettings.maxPlayers}>
                              {editedSettings.maxPlayers} Players (current)
                            </option>
                          )}
                        </select>
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
                      <div className="form-row checkbox">
                        <label>
                          <input
                            type="checkbox"
                            checked={editedSettings.allowCustomTopics}
                            onChange={(e) => setEditedSettings(prev => ({ ...prev, allowCustomTopics: e.target.checked }))}
                            disabled={group.status === 'active'}
                            aria-describedby="rules-custom-topics-hint"
                          />
                          Allow Custom Topics
                        </label>
                        <small id="rules-custom-topics-hint" className="form-hint">
                          On: the Judge picks from their own topics and ones members share. Off: you set
                          the group's topic list, with at least one per round.
                          {group.status === 'active' && ' This can only change before a game starts or after it ends.'}
                        </small>
                      </div>
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
                          {...numberBounds(CZAR_POINTS_RANGE)}
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
                          {...numberBounds(MAX_JURY_POINTS_RANGE)}
                        />
                      </div>
                      <div className="form-row">
                        <label htmlFor="rules-vote-budget">Per-Round Vote Budget:</label>
                        <input
                          id="rules-vote-budget"
                          type="number"
                          value={editedSettings.voteBudget}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, voteBudget: parseInt(e.target.value) }))}
                          {...numberBounds(VOTE_BUDGET_RANGE)}
                        />
                      </div>
                      <p className="form-hint">
                        How many points each player may spend across their votes this round. It resets at the
                        start of every round.
                      </p>
                      <div className="form-row checkbox">
                        <label>
                          <input
                            type="checkbox"
                            checked={editedSettings.shareTheWealth !== false}
                            onChange={(e) => setEditedSettings(prev => ({ ...prev, shareTheWealth: e.target.checked }))}
                          />
                          Share the wealth
                        </label>
                      </div>
                      <p className="form-hint">
                        When on, a player must spread their points across at least two submissions. When off,
                        a player may put their whole budget on one submission.
                      </p>
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
                          {...numberBounds(DOWNVOTE_COST_RANGE)}
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
                          type="range"
                          value={editedSettings.overrideThreshold}
                          onChange={(e) => setEditedSettings(prev => ({ ...prev, overrideThreshold: parseInt(e.target.value) }))}
                          {...numberBounds(OVERRIDE_THRESHOLD_RANGE)}
                          disabled={editedSettings.allowOverride !== true}
                        />
                        <div className="range-value">{editedSettings.overrideThreshold}%</div>
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
                        <li><strong>Allow Custom Topics:</strong> {group.settings.allowCustomTopics ? 'Yes' : 'No'}</li>
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
                        <li><strong>Per-Round Vote Budget:</strong> {typeof group.settings.voteBudget === 'number' ? group.settings.voteBudget : 10} points</li>
                        <li><strong>Share the Wealth:</strong> {group.settings.shareTheWealth !== false ? 'Yes' : 'No'}</li>
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
              {isHost && hostTopicsOnly && (
                <button
                  className={`nav-item ${activeTab === 'topics' ? 'active' : ''}`}
                  onClick={() => setActiveTab('topics')}
                >
                  Topics
                </button>
              )}
              {isHost && hostPanel && (
                <button
                  className={`nav-item ${activeTab === 'requests' ? 'active' : ''}`}
                  onClick={() => setActiveTab('requests')}
                >
                  Requests
                  {hostPanel.joinRequests.length > 0 && (
                    <span className="nav-count">
                      {hostPanel.joinRequests.length}
                      <span className="visually-hidden"> pending</span>
                    </span>
                  )}
                </button>
              )}
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

      {showPlayersModal && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="players-modal-title"
          ref={playersModalRef}
          onClick={() => setShowPlayersModal(false)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="players-modal-title">Invite someone to start</h2>
              <button className="close-button" onClick={() => setShowPlayersModal(false)} aria-label="Close modal">
                ×
              </button>
            </div>
            <div className="modal-body">
              <p>
                A round needs at least {MIN_PLAYERS_TO_START} players: one to judge and one to submit
                a song. Right now it's just you.
              </p>
              {!group.isPrivate && group.status === 'setup' && (
                <p className="form-hint">
                  Your group is also listed in Open Groups, so other players can ask to join.
                </p>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={() => setShowPlayersModal(false)}>
                Close
              </button>
              <button
                type="button"
                className="submit-button"
                onClick={() => {
                  setShowPlayersModal(false)
                  handleInvitePlayer()
                }}
              >
                Invite players
              </button>
            </div>
          </div>
        </div>
      )}

      {showTopicsModal && (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="topics-modal-title"
          ref={topicsModalRef}
          onClick={() => setShowTopicsModal(false)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="topics-modal-title">Add your topics to start</h2>
              <button className="close-button" onClick={() => setShowTopicsModal(false)} aria-label="Close modal">
                ×
              </button>
            </div>
            <div className="modal-body">
              <p>
                Custom topics are off, so you choose this game's topics. Each topic is played once,
                so a {topicsNeeded}-round game needs {topicsNeeded}.
              </p>
              <HostTopicEditor group={group} needed={topicsNeeded} inputId="topics-modal-input" />
            </div>
            <div className="modal-actions">
              <button type="button" className="cancel-button" onClick={() => setShowTopicsModal(false)}>
                Not now
              </button>
              <button
                type="button"
                className="submit-button"
                onClick={() => {
                  setShowTopicsModal(false)
                  setShowRoundLeaderModal(true)
                }}
                disabled={!hasEnoughTopics}
                aria-describedby="topics-modal-start-hint"
              >
                Start round
              </button>
            </div>
            {!hasEnoughTopics && (
              <p id="topics-modal-start-hint" className="form-hint topics-modal-start-hint">
                Add {topicsNeeded - unusedHostTopics} more {topicsNeeded - unusedHostTopics === 1 ? 'topic' : 'topics'} to start the round.
              </p>
            )}
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
          onClick={closeInviteModal}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 id="invite-modal-title">Invite Players</h2>
              <button
                className="close-button"
                onClick={closeInviteModal}
                aria-label="Close modal"
              >
                ×
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="invite-code">Group Code</label>
                <div className="invite-field-row">
                  <input
                    id="invite-code"
                    className="invite-code-input"
                    type="text"
                    value={formatInviteCode(inviteCode)}
                    readOnly
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm invite-copy-code"
                    onClick={handleCopyInviteCode}
                  >
                    {codeCopied ? 'Copied!' : 'Copy Code'}
                  </button>
                </div>
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

              {isHost && (
                <div className="invite-reset">
                  {confirmingReset ? (
                    <div className="invite-reset-confirm" role="group" aria-labelledby="invite-reset-question">
                      <p id="invite-reset-question" className="invite-reset-text">
                        Reset the invite code? The current code and link will stop working immediately.
                        Current members stay in the group.
                      </p>
                      <div className="invite-reset-actions">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => { setConfirmingReset(false); setResetError(null) }}
                          disabled={resettingCode}
                        >
                          Keep current code
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          onClick={handleResetInviteCode}
                          disabled={resettingCode}
                        >
                          {resettingCode ? 'Resetting…' : 'Yes, reset code'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setConfirmingReset(true)}
                    >
                      Reset code
                    </button>
                  )}
                  {resetError && <p className="invite-reset-error" role="alert">{resetError}</p>}
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button
                className="cancel-button"
                onClick={closeInviteModal}
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
