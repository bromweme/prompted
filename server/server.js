const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const config = require('./config');
const { createAuthMiddleware } = require('./auth');
const { searchVideos, isValidVideoId } = require('./youtube');
const { getOrCreateProfile, updateProfile, AVATAR_CHOICES } = require('./profiles');
const { PersistentStore } = require('./db');

// The only origins the app is actually served from. Socket.io matches these
// as exact strings, so a '*' entry here was never a wildcard — it only ever
// matched a literal "Origin: *" header, which no browser sends.
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:8081',
  'exp://localhost:19000'
];

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST']
  }
});

// cors() with no options answers every origin with "Access-Control-Allow-Origin: *".
// Requests with no Origin header at all (curl, the Playwright webServer probe)
// are still allowed through; this only restricts which browser origins may
// read the response.
app.use(cors({ origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] }));
app.use(express.json());

// Health check (also used by Playwright's webServer config to know when
// the backend is ready to accept connections)
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Group state storage, backed by SQLite (see db.js) so it survives a server restart
const topics = new PersistentStore('topics'); // Global topic bank: id -> { id, text, creatorId, isPublic, createdAt }
const groups = new PersistentStore('groups'); // id -> { id, name, description, settings, host, players, status, currentRound, currentTheme, history }

// Every socket payload comes from an untrusted client, so handlers validate
// the fields they use instead of trusting the shape. Caps sit comfortably
// above the maxLength the UI enforces, so they only ever reject input that
// didn't come from the app.
const LIMITS = {
  id: 200,
  username: 100,
  groupName: 100,
  groupDescription: 500,
  videoTitle: 200,
  channelTitle: 200,
  thumbnailUrl: 500,
  searchQuery: 120,
  voteComment: 280,
  topicText: 300
};

// Returns the trimmed string, or null if it isn't a usable one. Callers treat
// null as "reject this request" rather than substituting a default, so bad
// input fails loudly at the edge instead of being stored half-formed.
function cleanText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function cleanId(value) {
  return cleanText(value, LIMITS.id);
}

// Date.now() alone is not unique: two submissions landing in the same
// millisecond produced identical ids, which made votes for them ambiguous and
// silently collapsed the pair into one entry in the score tally.
let idCounter = 0;
function uniqueId(prefix) {
  idCounter = (idCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}${Date.now()}_${idCounter}`;
}

// Wraps a socket handler so a malformed payload can only fail that one event.
// Without this, an exception thrown inside a handler is an uncaught exception,
// which terminates the process — any connected client could take the server
// down (and every in-progress round with it) by emitting one bad payload.
function withErrorHandling(socket, eventName, handler) {
  return (payload) => {
    try {
      handler(payload || {});
    } catch (err) {
      console.error(`Handler error for "${eventName}" from ${socket.id}:`, err);
      socket.emit('error', { message: 'Something went wrong handling that request' });
    }
  };
}

// Per-socket token bucket, shared across every event that socket emits.
// The bucket refills continuously, so a client may spend up to RATE_BURST
// events at once — opening a group view legitimately fires several in a row —
// but cannot sustain more than RATE_SUSTAINED per second afterwards.
const RATE_BURST = 20;
const RATE_SUSTAINED = 5;

function createRateLimiter() {
  let tokens = RATE_BURST;
  let lastRefill = Date.now();

  return function takeToken() {
    const now = Date.now();
    tokens = Math.min(RATE_BURST, tokens + ((now - lastRefill) / 1000) * RATE_SUSTAINED);
    lastRefill = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

// Drops the event with an error reply rather than disconnecting, so a client
// that trips the limit recovers on its own once the bucket refills.
function withRateLimit(socket, eventName, takeToken, handler) {
  return (payload) => {
    if (!takeToken()) {
      console.warn(`Rate limit exceeded on "${eventName}" from ${socket.id}`);
      socket.emit('error', { message: 'You are sending requests too quickly — please slow down' });
      return;
    }
    handler(payload);
  };
}

// A round is a Judge plus contestants, so two connected players is the real
// floor. Enforced here as well as in the UI, like every other rule in this app.
const MIN_PLAYERS_TO_START = 2;

// How long a host may be gone before the group considers them abandoned and
// offers the members a leave-or-vote election (HG-1). The product brief and
// design (docs/design/b5-host-election-change-design.md) settle on "more than a
// month"; 30 calendar days is the concrete threshold used everywhere. A host
// who is present, or who merely disconnected minutes ago, is never affected —
// the boundary is measured from the durable lastSeenAt stamp, not from the
// transient `connected` flag.
const HOST_ABANDON_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;

// A host is "abandoned" when they are not currently present AND their durable
// lastSeenAt is more than HOST_ABANDON_THRESHOLD_MS in the past. A present host
// is never abandoned (and so can never be voted out); a briefly-offline host
// whose lastSeenAt is recent is likewise untouched. Missing lastSeenAt is
// treated as "present/recent" so an existing group is never accidentally
// offered an election on first read (see docs/design/b5-host-election-change-design.md).
function isHostAbandoned(group) {
  const host = group && group.players.find(p => p.userId === group.host);
  if (!host) return false;
  if (host.connected !== false) return false;
  const lastSeen = host.lastSeenAt ? new Date(host.lastSeenAt).getTime() : Date.now();
  return Date.now() - lastSeen > HOST_ABANDON_THRESHOLD_MS;
}

// Stamps a player's durable last-seen time. Called on connect and on the
// low-cost presence re-establishment (create/join/get_group), so a player who
// opens the group or reconnects is tracked even if their client never sends
// another event. Persisted in the group blob so "gone > a month" survives a
// server restart (HG-1).
function touchPlayer(group, playerUserId) {
  const player = group.players.find(p => p.userId === playerUserId);
  if (player) player.lastSeenAt = new Date().toISOString();
}

// The number of current members who may vote in a host election: everyone
// except the abandoned host, who is off the ballot (HG-1).
function electionElectorate(group) {
  return group.players.filter(p => p.userId !== group.host).length;
}

// A candidate wins by a strict majority (> 50%) of the electorate. With an
// electorate of N, that is floor(N/2) + 1 votes for one candidate.
function electionMajorityNeeded(group) {
  return Math.floor(electionElectorate(group) / 2) + 1;
}

// Builds the shared, publicized view of a group that every player receives.
// Strips the host's private notices and attaches the derived host-abandoned
// flag so the client can offer the leave-or-vote election (HG-1).
function publicizeGroup(group) {
  const publicGroup = { ...group, currentTheme: publicizeTheme(group.currentTheme, group) };
  delete publicGroup.hostNotices;
  publicGroup.hostAbandoned = isHostAbandoned(group);
  return publicGroup;
}

// Judge rotation bookkeeping (RT-3). Records that `userId` has served as Judge
// this cycle in the group-level `judgedThisCycle` set, which persists across
// rounds. When every current member has served once, the set resets so the
// rotation can begin again. Stale entries for members who have since left are
// dropped so they never count toward the cycle.
function recordJudgeServed(group, userId) {
  const memberIds = new Set(group.players.map(p => p.userId));
  const served = new Set(group.judgedThisCycle || []);
  served.add(userId);
  const currentServed = Array.from(served).filter(id => memberIds.has(id));
  if (currentServed.length >= group.players.length) {
    group.judgedThisCycle = [];
  } else {
    group.judgedThisCycle = currentServed;
  }
}

// overrideThreshold is always a whole percentage (e.g. 70) in settings objects
// and over the wire; it's only ever converted to a 0-1 fraction at the point
// it's compared against a vote ratio (see calculateGroupResults).
function isValidOverrideThreshold(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 51 && value <= 100;
}

// Both round windows (submission and voting) are expressed in hours in
// settings and on the wire; the host picks a numeric value plus a unit
// (minutes/hours/days) in the UI, and the client converts that to hours. The
// design (docs/design/a4-round-windows-change-design.md) clamps an out-of-range
// window to the nearest boundary rather than rejecting it — the "ceiling" is
// always 168 hours, regardless of unit.
//
// Per-unit bounds (enforced in the UI by clamping before conversion to hours):
//   minutes 1..10080   (10080 minutes == 168h)
//   hours   1..168
//   days    1..7       (7 days == 168h)
//
// The server clamps the received hours to the same 168h ceiling. Because the
// minutes unit legitimately goes below one hour, the production floor is one
// minute (1/60h). That floor drops to one second under AUTH_TEST_MODE so the
// suite can drive a genuine expiry instead of asserting around it — a flag
// that already refuses to coexist with NODE_ENV=production (see config.js), so
// this cannot widen the range on a deployed server.
const MAX_WINDOW_HOURS = 168;
const MIN_WINDOW_HOURS = config.authTestMode ? 1 / 3600 : 1 / 60;

// Clamps a window length (in hours) to the valid band, falling back to the
// default when the value is missing or not a usable number. Used both when a
// host saves a setting and every time a window length is turned into a
// deadline, so a crafted or legacy value can never make a window absurdly
// short or long. Values below the floor (including negatives) go down to the
// floor; values above the ceiling go up to it.
function clampWindowHours(value, fallback = 24) {
  const hours = Number(value);
  if (!Number.isFinite(hours)) return fallback;
  return Math.min(MAX_WINDOW_HOURS, Math.max(MIN_WINDOW_HOURS, hours));
}

// The per-player, per-round vote budget (RT-2). Each player may spend up to
// this many points across their votes in a round; the budget resets at the
// start of every round (it lives on currentTheme, which beginRound replaces).
// It is host-set (default 10 per the product brief / design C8) and clamped to
// a sane band rather than rejected, matching how the round windows are handled.
const DEFAULT_VOTE_BUDGET = 10;
const MAX_VOTE_BUDGET = 100;
const MIN_VOTE_BUDGET = 1;

function clampVoteBudget(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_VOTE_BUDGET;
  return Math.min(MAX_VOTE_BUDGET, Math.max(MIN_VOTE_BUDGET, Math.round(n)));
}

// A downvote must always spend a positive amount of budget (RT-2-1): a host
// cannot configure a 0 or negative downvote cost, because that would make the
// downvote free and let a player vote past their budget. Clamped to a minimum
// of 1 in the create/update settings paths, and coerced again defensively at
// cast time (see cast_vote). Missing/legacy values fall back to 1.
const MIN_DOWNVOTE_COST = 1;

function clampDownvoteCost(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < MIN_DOWNVOTE_COST) return MIN_DOWNVOTE_COST;
  return Math.round(n);
}

// The per-round budget a group actually runs on, read from current settings
// with clamping. Missing/legacy values fall back to the default.
function voteBudget(group) {
  return clampVoteBudget(group.settings && group.settings.voteBudget);
}

// "Share the wealth" (default on) decides whether a player must spread their
// points across at least two submissions or may concentrate the whole budget
// on one. Absent => on (the product default).
function shareTheWealth(group) {
  return !(group.settings && group.settings.shareTheWealth === false);
}

// The submission window length a round actually runs on, from the group's
// settings with clamping applied.
function submissionHours(group) {
  return clampWindowHours(group.settings && group.settings.submissionTime);
}

// The voting window length, read server-side for the first time by RT-1. It is
// collected and displayed like submissionTime but was inert (never read) until
// this change gave it a real deadline.
function votingHours(group) {
  return clampWindowHours(group.settings && group.settings.votingTime);
}

// How many times a round with no submissions at all re-arms itself before it
// gives up and waits for the host. Without a cap an abandoned group would
// restart its round every window forever, notifying a host who has stopped
// playing. After this many attempts the round stays open and only the host
// can move it.
const MAX_AUTO_REARMS = 3;

// Queues a durable message for the group's host. Notices persist on the group
// until the host acknowledges one, so a restart that happened while they were
// offline is still waiting when they come back rather than vanishing into a
// broadcast nobody received.
function addHostNotice(group, kind, message) {
  group.hostNotices = [...(group.hostNotices || []), {
    id: uniqueId('notice'),
    kind,
    message,
    createdAt: new Date().toISOString()
  }];
}

/**
 * Moves a round into voting and starts the voting window's clock. This is the
 * single closure of the submission phase (called from the expiry path, the
 * all-submitted auto-advance, and the host's close_submissions), mirroring how
 * select_topic sets the submission deadline. It replaces the stale submission
 * deadline with a fresh absolute voting deadline so the client countdown,
 * which keys off theme.deadline generically, ticks the voting window and its
 * nudge (check_round_deadline) expires it. Voting always runs to this deadline
 * — there is no early reveal (docs/design/a1-voting-deadline-change-design.md).
 */
function openVoting(theme, group) {
  theme.status = 'voting';
  const hours = votingHours(group);
  theme.deadline = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

/**
 * Acts on an expired round-window deadline. Returns true when it changed the
 * group, so callers know to persist and broadcast.
 *
 * This is called wherever a round is already being handled rather than from a
 * timer. `deadline` is an absolute instant that already persists inside the
 * group, so evaluating it on read is correct across a server restart and needs
 * no scheduler — the server has none, and a multi-hour default is the wrong
 * scale for setTimeout anyway. See docs/design/round-stall-change-design.md.
 *
 * It honors both round windows (docs/design/a4-round-windows-change-design.md):
 * a passed submission deadline either opens voting (when something was
 * submitted) or re-arms the same round (when nobody submitted); a passed
 * voting deadline completes the round via calculateGroupResults.
 *
 * Idempotent: it only acts while the round is in a window phase with a
 * genuinely past deadline, and every branch either leaves that phase or moves
 * the deadline forward.
 */
function advanceIfExpired(group) {
  const theme = group && group.currentTheme;
  // The deadline is the active window's close for both submission and voting.
  if (!theme || !theme.deadline) return false;
  if (theme.status !== 'submission' && theme.status !== 'voting') return false;

  // Already given up on this round. The deadline stays in the past, so without
  // this guard every later call would queue the host another notice.
  if (theme.rearmExhausted) return false;

  const deadline = Date.parse(theme.deadline);
  if (!Number.isFinite(deadline) || Date.now() < deadline) return false;

  // The voting window closed. Nobody settling the round with a vote has to
  // wait for anyone else: the winner is calculated from whatever votes turned
  // up. calculateGroupResults sets status='reveal', tallies the winner, pushes
  // history, persists and broadcasts, so this returns true for the existing
  // callsites to broadcast the reveal too.
  if (theme.status === 'voting') {
    calculateGroupResults(group);
    return true;
  }

  // Something arrived: play the round with what turned up. A player who never
  // submitted simply misses this round rather than holding everyone else.
  if (theme.submissions.length > 0) {
    openVoting(theme, group);
    console.log('Submission deadline passed for group:', group.id, '- opening voting with',
      theme.submissions.length, 'submission(s)');
    return true;
  }

  // Nobody submitted. Restart the SAME round: the Judge and the topic are
  // deliberately kept, currentRound is not incremented, and no history entry
  // is written, because this is another attempt at one round rather than a
  // new one.
  const attempts = (theme.autoRearmCount || 0) + 1;
  if (attempts > MAX_AUTO_REARMS) {
    theme.rearmExhausted = true;
    addHostNotice(group, 'round_stalled',
      `Nobody submitted a video after ${MAX_AUTO_REARMS} attempts, so "${theme.title}" is waiting for you. Start it again when the group is ready.`);
    console.log('Auto re-arm limit reached for group:', group.id);
    return true;
  }

  const hours = submissionHours(group);
  theme.deadline = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  theme.autoRearmCount = attempts;
  addHostNotice(group, 'round_restarted',
    `Nobody submitted a video in time, so "${theme.title}" has restarted with the same Judge and topic. Attempt ${attempts} of ${MAX_AUTO_REARMS}.`);
  console.log('Round re-armed for group:', group.id, '- attempt', attempts);
  return true;
}

// Begins a round on an already-persisted group: assigns a Round Leader
// (randomly among connected players, unless forcedCzarUserId names a
// connected player) and creates a fresh currentTheme. Caller is responsible
// for persisting the group afterward and broadcasting the result.
function beginRound(group, forcedCzarUserId) {
  // Prefer someone who is online, but never fail to start: rounds are not
  // gated on presence, so a group where only the host is connected must still
  // be able to begin.
  const connectedPlayers = group.players.filter(p => p.connected !== false);
  const pool = connectedPlayers.length > 0 ? connectedPlayers : group.players;

  let roundLeader = forcedCzarUserId
    ? group.players.find(p => p.userId === forcedCzarUserId)
    : null;
  if (!roundLeader) {
    roundLeader = pool[Math.floor(Math.random() * pool.length)];
  }

  group.status = 'active';
  group.currentRound = (group.currentRound || 0) + 1;
  group.currentTheme = {
    id: uniqueId('theme'),
    // Filled in by the Judge in the topic_selection phase. The round used to
    // auto-pick from a per-group preset list and fall back to a placeholder,
    // which meant a group with no topics silently played "Round Challenge".
    // Topics now come from each player's own library instead.
    title: null,
    topicId: null,
    description: "This round's music challenge",
    // 'topic_selection' -> 'submission' -> 'voting' -> 'reveal'
    status: 'topic_selection',
    // No deadline yet: the submission clock starts when the topic is chosen,
    // so time spent choosing isn't taken out of the players' window.
    deadline: null,
    czarId: roundLeader.userId, // stable id; stripped from broadcasts by publicizeTheme
    // The Judge assigned when this round began. If every member skips, the
    // role reverts to this person, who is then not offered the pass again
    // (RT-3 / docs/design/a2-judge-skip-change-design.md).
    firstAssignedJudge: roundLeader.userId,
    // Set true only when the full-cycle skip reverts to the first-assigned
    // Judge: that Judge must pick a topic and is not offered the skip control.
    judgeMustPlay: false,
    submissions: [],
    votes: [],
    // Per-player points spent this round (voterUserId -> points), seeded empty
    // on every fresh theme so the budget resets automatically at the start of
    // each round. Maintained by cast_vote; drives the budget gate and the
    // remaining-budget field delivered to each player.
    voteBudgetUsed: {},
    czarSelection: null
  };

  // Judge rotation (RT-3): the assigned Judge has now served this cycle. The
  // group-level set persists across rounds; when every current member has
  // served once, the cycle resets so the rotation can begin again.
  recordJudgeServed(group, roundLeader.userId);

  return roundLeader;
}

// Strips whatever the current phase says shouldn't be visible yet, most
// importantly the Round Leader's identity (czarId is never sent as-is) and,
// during voting, which player submitted which song.
function publicizeTheme(theme, group) {
  if (!theme) return null;

  const { czarId, ...rest } = theme;
  const publicTheme = { ...rest, submissionCount: theme.submissions.length };

  if (theme.status === 'topic_selection' || theme.status === 'submission') {
    // Nothing about submissions or votes is visible yet, not even a breakdown.
    delete publicTheme.submissions;
    delete publicTheme.votes;
  } else if (theme.status === 'voting') {
    // Submissions are visible for judging, but anonymously.
    publicTheme.submissions = theme.submissions.map(s => ({
      id: s.id,
      videoId: s.videoId,
      title: s.title,
      thumbnail: s.thumbnail,
      channelTitle: s.channelTitle
    }));
    publicTheme.voteCount = theme.votes.length;
    // Comments are always collected, but only surfaced mid-round when the
    // host has opted in. Even then they carry no author — authorship appears
    // at reveal, like votes and the Round Leader's identity. Ordered by
    // submission, never by voter, so the order itself can't be used to work
    // out who wrote what.
    //
    // With showCommentsLive off, the comments simply never leave the server
    // until reveal; nothing is sent for the client to hide.
    publicTheme.comments = group.settings.showCommentsLive === true
      ? theme.votes
        .filter(v => v.comment)
        .map(v => ({ submissionId: v.submissionId, text: v.comment }))
      : [];
    delete publicTheme.votes;
  }
  // status === 'reveal': the round is over, so full submissions (with
  // playerUserId) and votes are safe to expose as-is.

  if (theme.status === 'reveal' || group.settings.anonymousCzar === false) {
    const leader = group.players.find(p => p.userId === czarId);
    if (leader) publicTheme.czarUsername = leader.username;
  }

  return publicTheme;
}

// Sends each player their own private view of the group: everyone gets the
// same publicized currentTheme, but only the actual Round Leader's socket
// gets isRoundLeader: true (mirrors the old engine's private you_are_czar).
// The topics a player may pick from inside a given group: everything they
// own, plus the public topics of anyone else currently in that group. A
// public topic is deliberately not visible group-wide across the whole app —
// only to people you're actually playing with.
function topicsForGroup(group, viewerUserId) {
  const memberIds = new Set(group.players.map(p => p.userId));
  const used = new Set(group.usedTopicIds || []);

  return Array.from(topics.values())
    .filter(t => t.creatorId === viewerUserId || (t.isPublic === true && memberIds.has(t.creatorId)))
    .map(t => ({
      id: t.id,
      text: t.text,
      isPublic: t.isPublic === true,
      isOwn: t.creatorId === viewerUserId,
      ownerName: (group.players.find(p => p.userId === t.creatorId) || {}).username || 'Someone',
      // Usage is per group: a topic played here is marked, but stays freely
      // available in every other group.
      usedInGroup: used.has(t.id)
    }))
    .sort((a, b) => Number(a.usedInGroup) - Number(b.usedInGroup));
}

// Which submission in the current round belongs to this player, if any.
// Sent only to that player's own socket, so it reveals nothing about anyone
// else while still letting the client disable self-voting.
function ownSubmissionId(group, playerUserId) {
  const theme = group.currentTheme;
  if (!theme || !Array.isArray(theme.submissions)) return null;
  const own = theme.submissions.find(sub => sub.playerUserId === playerUserId);
  return own ? own.id : null;
}

// How many budget points this player has left this round, for their own
// socket's voting UI. Per-player-per-socket like ownSubmissionId: everyone
// sees the public theme, but each player only learns their own remaining
// budget. null when there is no live round to vote in.
function remainingBudget(group, playerUserId) {
  const theme = group.currentTheme;
  if (!theme) return null;
  const used = (theme.voteBudgetUsed && theme.voteBudgetUsed[playerUserId]) || 0;
  return Math.max(0, voteBudget(group) - used);
}

function broadcastGroup(group) {
  const publicGroup = publicizeGroup(group);

  group.players.forEach(player => {
    io.to(player.id).emit('group_updated', {
      group: publicGroup,
      isRoundLeader: !!(group.currentTheme && player.userId === group.currentTheme.czarId),
      yourSubmissionId: ownSubmissionId(group, player.userId),
      voteBudgetRemaining: remainingBudget(group, player.userId),
      notices: noticesFor(group, player.userId)
    });
  });
}

// Only the host sees notices, and only ever their own group's. Returns a fresh
// array so a caller cannot mutate the stored one.
function noticesFor(group, viewerUserId) {
  if (viewerUserId !== group.host) return [];
  return [...(group.hostNotices || [])];
}

// Tallies votes, picks a winner (public override > Round Leader's pick >
// popular vote), awards points, records history, and reveals the round.
function calculateGroupResults(group) {
  const theme = group.currentTheme;

  const submissionScores = {};
  theme.submissions.forEach(sub => {
    submissionScores[sub.id] = { totalPoints: 0, voteCount: 0, submission: sub };
  });

  theme.votes.forEach(vote => {
    if (submissionScores[vote.submissionId]) {
      submissionScores[vote.submissionId].totalPoints += vote.points;
      submissionScores[vote.submissionId].voteCount++;
    }
  });

  let winner = null;
  let maxScore = -Infinity;
  const totalVotes = theme.votes.length;
  let publicVoteWinner = null;

  if (group.settings.allowOverride && totalVotes > 0) {
    // overrideThreshold is a whole percentage; converted to a fraction only here.
    publicVoteWinner = Object.values(submissionScores).find(s =>
      s.voteCount / totalVotes >= (group.settings.overrideThreshold || 70) / 100
    );
  }

  if (publicVoteWinner) {
    winner = publicVoteWinner.submission;
    winner.wonBy = 'public_override';
  } else if (theme.czarSelection) {
    winner = theme.submissions.find(s => s.id === theme.czarSelection);
    if (winner) winner.wonBy = 'czar_selection';
  } else {
    Object.values(submissionScores).forEach(s => {
      if (s.totalPoints > maxScore) {
        maxScore = s.totalPoints;
        winner = s.submission;
        winner.wonBy = 'popular_vote';
      }
    });
  }

  let winnerUsername = 'Unknown';
  if (winner) {
    const winnerPlayer = group.players.find(p => p.userId === winner.playerUserId);
    if (winnerPlayer) {
      winnerPlayer.score += (group.settings.czarPoints || 5);
      winnerUsername = winnerPlayer.username;
    }
  }

  theme.votes.forEach(vote => {
    const voter = group.players.find(p => p.userId === vote.voterUserId);
    if (voter && !vote.isDownvote && winner && vote.submissionId === winner.id) {
      // A downvote spends only from the voter's round budget (RT-2); it no
      // longer docks a lifetime score here. Winners on the winning submission
      // are scored as before.
      voter.score += vote.points;
    }
  });

  theme.status = 'reveal';

  group.history.push({
    id: theme.id,
    title: theme.title,
    completedAt: new Date().toISOString(),
    totalSubmissions: theme.submissions.length,
    winningPoints: group.settings.czarPoints || 5,
    winner: winnerUsername,
    song: winner ? winner.title : null,
    videoId: winner ? winner.videoId : null,
    // Every video from the round, so the history view can list them and
    // build a watch-all link without needing the round to still be current.
    videos: theme.submissions.map(sub => ({
      videoId: sub.videoId,
      title: sub.title,
      thumbnail: sub.thumbnail,
      channelTitle: sub.channelTitle
    }))
  });

  groups.set(group.id, group);
  console.log('Round resolved for group:', group.id, 'winner:', winnerUsername);
  broadcastGroup(group);
}

// Socket.io connection handling
// Authenticate every connection once, before any event handler can run.
// socket.data.userId is set there from a verified identity and is the only
// source of truth for who the caller is from this point on.
io.use(createAuthMiddleware());

io.on('connection', (socket) => {
  console.log('User connected:', socket.id, 'as', socket.data.userId);

  // The identity bound by the auth middleware. Handlers use this instead of
  // anything in an event payload, which is what makes the host and
  // round-leader checks actually enforceable rather than advisory.
  const userId = socket.data.userId;

  // Resolve the stored profile before registering any handler, so the name a
  // player is known by in a group is the one they chose, not Google's.
  // A brand-new profile has avatar: null, which is how the client knows to
  // run first-time setup.
  const profile = getOrCreateProfile(userId, socket.data.username, socket.data.initialAvatar);
  socket.data.username = profile.displayName;
  socket.data.avatar = profile.avatar;

  // Sends the client its current identity. Also used after a profile edit, so
  // the two paths can never drift apart.
  const emitSession = () => {
    socket.emit('session', {
      sessionToken: socket.data.sessionToken,
      avatarChoices: AVATAR_CHOICES,
      user: {
        id: userId,
        name: socket.data.username,
        avatar: socket.data.avatar,
        email: socket.data.email,
        picture: socket.data.picture
      }
    });
  };

  // Hand the client a session token so its next reconnect skips Google.
  emitSession();

  const takeToken = createRateLimiter();

  // Registers an application event handler behind the rate limiter and the
  // crash guard. Used instead of socket.on directly for everything below.
  // 'disconnect' is registered separately: it isn't client-driven, and
  // dropping it because the bucket happens to be empty would leave the player
  // marked connected forever.
  const on = (eventName, handler) => socket.on(
    eventName,
    withRateLimit(socket, eventName, takeToken, withErrorHandling(socket, eventName, handler))
  );

  // Submit topic to the global topic bank. Ownership is keyed to the
  // authenticated userId, so it survives reconnects and cannot be claimed
  // on someone else's behalf.
  on('submit_topic', ({ text, isPublic }) => {
    console.log('Topic submission:', { text, isPublic, socketId: socket.id, userId });

    const topicText = cleanText(text, LIMITS.topicText);
    if (!topicText) {
      socket.emit('error', { message: `Topic text is required and must be at most ${LIMITS.topicText} characters` });
      return;
    }

    const topic = {
      id: uniqueId('topic_'),
      text: topicText,
      creatorId: userId,
      isPublic: isPublic === true,
      createdAt: new Date().toISOString()
    };

    topics.set(topic.id, topic);
    socket.emit('topic_submitted', { topic });
  });

  // The requester's own personal library, as browsed by the topics page.
  //
  // Scoped strictly to topics this user created — public ones included, since
  // "public" means "offer this to people I play with", not "publish it to the
  // whole app". Someone else's topic reaches you only through
  // get_group_topics, and only when you actually share a group with them.
  // This previously returned every public topic in the app, which contradicted
  // that model and leaked strangers' topics into the library view.
  on('get_topics', () => {
    const own = Array.from(topics.values()).filter(t => t.creatorId === userId);
    const privateTopics = own.filter(t => t.isPublic !== true);
    const publicTopics = own.filter(t => t.isPublic === true);

    socket.emit('topics_list', { privateTopics, publicTopics });
  });

  // The topics this player can choose from inside a group, each flagged with
  // whether it has already been played here.
  on('get_group_topics', ({ groupId }) => {
    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }
    if (!group.players.some(p => p.userId === userId)) {
      socket.emit('error', { message: 'You are not a member of this group' });
      return;
    }

    socket.emit('group_topics_list', { groupId: gid, topics: topicsForGroup(group, userId) });
  });

  // The Round Leader picks this round's topic, which starts the submission
  // clock. Restricted to the Leader for the current round: the topic is the
  // one piece of the round only they get to decide.
  on('select_topic', ({ groupId, topicId }) => {
    console.log('Select topic request:', { groupId, topicId, socketId: socket.id, userId });

    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    const theme = group.currentTheme;
    if (!theme || theme.status !== 'topic_selection') {
      socket.emit('error', { message: 'This round is not waiting for a topic' });
      return;
    }

    if (userId !== theme.czarId) {
      socket.emit('error', { message: 'Only the Judge can choose the topic' });
      return;
    }

    const id = cleanId(topicId);
    const topic = id && topics.get(id);
    if (!topic) {
      socket.emit('error', { message: 'That topic no longer exists' });
      return;
    }

    // Only topics this player can actually see in this group are selectable,
    // so a crafted id can't pull in someone else's private topic.
    const visible = topicsForGroup(group, userId).some(t => t.id === id);
    if (!visible) {
      socket.emit('error', { message: 'That topic is not available in this group' });
      return;
    }

    theme.topicId = id;
    theme.title = topic.text;
    theme.status = 'submission';
    const hours = submissionHours(group);
    theme.deadline = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

    // RT-3: the Judge who actually plays this round (picks the topic) has now
    // served it, even if they were handed the role by a skip or a host
    // hand-pick rather than the first assignment. Recording on play (not on
    // mere assignment) keeps the served set coherent — a future skip re-pick
    // can never re-draft them before everyone has served once — while leaving
    // the full-skip exhaustion signal intact: a declined (skipped) role only
    // counts once the Judge either plays or skips.
    recordJudgeServed(group, theme.czarId);
    // Marked used in this group only. Re-selecting an already-used topic is
    // allowed (the UI marks it rather than blocking it), so this stays a set.
    group.usedTopicIds = Array.from(new Set([...(group.usedTopicIds || []), id]));

    groups.set(gid, group);
    console.log('Topic selected for group:', gid, '->', topic.text);
    broadcastGroup(group);
  });

  // Delete topic from bank (only the creator can delete their own topic)
  on('delete_topic', ({ topicId }) => {
    const id = cleanId(topicId);
    const topic = id && topics.get(id);
    if (topic && topic.creatorId === userId) {
      topics.delete(id);
      socket.emit('topic_deleted', { topicId: id });
    }
  });

  // Update the signed-in player's own profile. There is no target-user
  // parameter by design: a socket can only ever edit the identity bound to it.
  on('update_profile', ({ displayName, avatar }) => {
    console.log('Update profile request:', { socketId: socket.id, userId, avatar });

    const { profile: updated, error } = updateProfile(userId, { displayName, avatar }, LIMITS.username);
    if (error) {
      socket.emit('error', { message: error });
      return;
    }

    socket.data.username = updated.displayName;
    socket.data.avatar = updated.avatar;
    emitSession();

    // The display name is denormalised into every group's player list, so a
    // rename has to be pushed out or other players keep seeing the old one.
    groups.forEach((group, groupId) => {
      const player = group.players.find(p => p.userId === userId);
      if (player && player.username !== updated.displayName) {
        player.username = updated.displayName;
        groups.set(groupId, group);
        broadcastGroup(group);
      }
    });
  });

  // Create group
  on('create_group', ({ groupData }) => {
    console.log('Create group request:', { groupData, socketId: socket.id, userId });

    const data = groupData || {};
    const name = cleanText(data.name, LIMITS.groupName);
    if (!name) {
      socket.emit('error', { message: `Group name is required and must be at most ${LIMITS.groupName} characters` });
      return;
    }

    // The description is optional, but a present-and-oversized one is still
    // a rejection rather than something to silently truncate.
    let description = '';
    if (data.description !== undefined && data.description !== null && data.description !== '') {
      description = cleanText(data.description, LIMITS.groupDescription);
      if (!description) {
        socket.emit('error', { message: `Group description must be at most ${LIMITS.groupDescription} characters` });
        return;
      }
    }

    // The id is always generated here. Honouring a client-supplied one let
    // any client overwrite an existing group -- ids double as the invite
    // code, so a shared invite link was enough to seize someone's group.
    //
    // uniqueId rather than a bare timestamp: two groups created in the same
    // millisecond would otherwise share an id, and groups.set() would
    // silently overwrite the first one.
    const groupId = uniqueId('GROUP');

    const settings = { ...(data.settings || {}) };
    if (settings.overrideThreshold !== undefined && !isValidOverrideThreshold(settings.overrideThreshold)) {
      settings.overrideThreshold = 70;
    }
    // Round windows are clamped to the valid band rather than rejected (the A4
    // "numeric + unit, clamp out-of-range" model — see docs/design/a4-round-windows-change-design.md).
    // A crafted absurd length can now only make a window as short as the floor
    // or as long as 168h, never open/close a round absurdly fast or hang it.
    if (settings.submissionTime !== undefined) {
      settings.submissionTime = clampWindowHours(settings.submissionTime);
    }
    if (settings.votingTime !== undefined) {
      settings.votingTime = clampWindowHours(settings.votingTime);
    }
    // Per-round vote budget (RT-2): clamped rather than rejected, defaulting to
    // 10 when absent. "Share the wealth" is a strict boolean, defaulting on.
    if (settings.voteBudget === undefined) {
      settings.voteBudget = DEFAULT_VOTE_BUDGET;
    } else {
      settings.voteBudget = clampVoteBudget(settings.voteBudget);
    }
    if (settings.shareTheWealth === undefined) {
      settings.shareTheWealth = true;
    } else {
      settings.shareTheWealth = settings.shareTheWealth === true;
    }
    // A downvote must always spend budget: clamp a 0/negative/absent
    // downvoteCost to a positive value (RT-2-1).
    if (settings.downvoteCost !== undefined) {
      settings.downvoteCost = clampDownvoteCost(settings.downvoteCost);
    }

    const group = {
      id: groupId,
      name,
      description,
      isPrivate: data.isPrivate || false,
      host: userId,
      players: [{
        id: socket.id,
        userId,
        username: socket.data.username,
        score: 0,
        isHost: true,
        connected: true,
        // Durable presence (HG-1): the creator is present at creation.
        lastSeenAt: new Date().toISOString()
      }],
      settings,
      status: 'setup',
      currentRound: 0,
      currentTheme: null,
      history: [],
      // Topic ids already played in this group. Scoped here rather than on the
      // topic so the same topic can be reused freely in other groups.
      usedTopicIds: [],
      createdAt: new Date().toISOString()
    };

    groups.set(groupId, group);
    console.log('Created group:', groupId);

    socket.emit('group_created', { group });
  });

  // Get user's groups
  on('get_groups', () => {
    console.log('Get groups request:', { socketId: socket.id, userId });

    const userGroups = Array.from(groups.values()).filter(group =>
      group.players.some(player => player.userId === userId)
    );

    // Attach the derived host-abandoned flag so the Dashboard can surface the
    // leave-or-vote election for a group whose host has gone (HG-1).
    const listed = userGroups.map(group => ({
      ...group,
      hostAbandoned: isHostAbandoned(group)
    }));

    socket.emit('groups_list', { groups: listed });
  });

  // Join group
  on('join_group', ({ groupId }) => {
    console.log('Join group request:', { groupId, socketId: socket.id, userId });

    const gid = cleanId(groupId);
    if (!gid) {
      socket.emit('error', { message: 'A group id is required to join' });
      return;
    }

    const group = groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    // Check if player already in group (identified by stable userId, not socket id)
    const existingPlayer = group.players.find(p => p.userId === userId);
    if (existingPlayer) {
      existingPlayer.id = socket.id;
      existingPlayer.connected = true;
      existingPlayer.username = socket.data.username;
    } else {
      // Add new player to group
      group.players.push({
        id: socket.id,
        userId,
        username: socket.data.username,
        score: 0,
        isHost: false,
        connected: true
      });
    }

    // Durable presence (HG-1): joining re-establishes presence, so stamp the
    // player's lastSeenAt. This is the low-cost heartbeat that lets the server
    // later tell "host gone a month" from "host briefly offline".
    touchPlayer(group, userId);

    // If the current host returns while a host election is in flight, the
    // election cancels and the host keeps the group (HG-1). The host is only
    // still `group.host` before a transfer, so this only fires for the
    // original host returning in time.
    if (group.host === userId && group.election && group.election.open) {
      group.election = null;
      console.log('Host returned; host election cancelled for group:', gid);
    }

    advanceIfExpired(group);
    groups.set(gid, group);

    // Tell the joiner directly (they navigate off this) and update everyone
    // else already viewing the group so the new player shows up live. The
    // joiner's own payload is publicized the same as any other broadcast —
    // the Round Leader's identity is never exposed via this event either.
    const joinedGroup = publicizeGroup(group);

    socket.emit('group_joined', {
      group: joinedGroup,
      isRoundLeader: !!(group.currentTheme && userId === group.currentTheme.czarId),
      yourSubmissionId: ownSubmissionId(group, userId),
      voteBudgetRemaining: remainingBudget(group, userId),
      notices: noticesFor(group, userId)
    });
    broadcastGroup(group);
  });

  // Get group details
  on('get_group', ({ groupId }) => {
    console.log('Get group request:', { groupId, socketId: socket.id, userId });

    const gid = cleanId(groupId);
    if (!gid) {
      socket.emit('error', { message: 'A group id is required' });
      return;
    }

    const group = groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    // Refresh this player's socket mapping so server -> client broadcasts
    // (group_updated) still reach them after a reconnect or page refresh.
    const player = group.players.find(p => p.userId === userId);
    if (player) {
      player.id = socket.id;
      player.connected = true;
      // Durable presence (HG-1): opening the group is a low-cost heartbeat.
      touchPlayer(group, userId);
      // A returning host cancels an in-flight election (HG-1).
      if (group.host === userId && group.election && group.election.open) {
        group.election = null;
        console.log('Host returned; host election cancelled for group:', gid);
      }
      groups.set(gid, group);
    }

    // Opening a group is one of the natural moments a stale deadline gets
    // noticed. Broadcast first so everyone already in the round sees the phase
    // change, then answer this caller with the same up-to-date group.
    if (advanceIfExpired(group)) {
      groups.set(gid, group);
      broadcastGroup(group);
    }

    const publicGroup = publicizeGroup(group);

    socket.emit('group_details', {
      group: publicGroup,
      isRoundLeader: !!(group.currentTheme && userId === group.currentTheme.czarId),
      yourSubmissionId: ownSubmissionId(group, userId),
      voteBudgetRemaining: remainingBudget(group, userId),
      notices: noticesFor(group, userId)
    });
  });

  // The client's countdown reached zero. This is only a nudge: the server
  // re-checks its own clock in advanceIfExpired and does nothing unless the
  // deadline has genuinely passed, so a skewed or dishonest client gains
  // nothing by sending it early or often.
  on('check_round_deadline', ({ groupId }) => {
    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) return;
    if (!group.players.some(p => p.userId === userId)) return;

    if (advanceIfExpired(group)) {
      groups.set(gid, group);
      broadcastGroup(group);
    }
  });

  // Host clears a notice once they have read it.
  on('acknowledge_notice', ({ groupId, noticeId }) => {
    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }
    if (group.host !== userId) {
      socket.emit('error', { message: 'Only the host can dismiss these' });
      return;
    }

    const id = cleanId(noticeId);
    group.hostNotices = (group.hostNotices || []).filter(n => n.id !== id);
    groups.set(gid, group);
    broadcastGroup(group);
  });

  // Host ends the submission phase before the deadline. Useful when everyone
  // present has submitted and the group would rather not wait out the window
  // for someone who is not coming.
  on('close_submissions', ({ groupId }) => {
    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }
    if (group.host !== userId) {
      socket.emit('error', { message: 'Only the host can close submissions' });
      return;
    }

    const theme = group.currentTheme;
    if (!theme || theme.status !== 'submission') {
      socket.emit('error', { message: 'This round is not taking submissions right now' });
      return;
    }
    // Voting needs something to vote on, and a round with no entries should be
    // restarted rather than pushed into an empty voting phase.
    if (theme.submissions.length === 0) {
      socket.emit('error', { message: 'Nobody has submitted a video yet' });
      return;
    }

    openVoting(theme, group);
    groups.set(gid, group);
    broadcastGroup(group);
    console.log('Host closed submissions early for group:', gid);
  });

  // Host hands the Judge role to someone else while the round is still waiting
  // for a topic. A Judge who is offline (a host can pick one deliberately)
  // would otherwise hold the round open with no deadline to expire, because
  // topic selection has no clock by design.
  on('reassign_judge', ({ groupId, czarUserId }) => {
    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }
    if (group.host !== userId) {
      socket.emit('error', { message: 'Only the host can change the Judge' });
      return;
    }

    const theme = group.currentTheme;
    if (!theme || theme.status !== 'topic_selection') {
      socket.emit('error', { message: 'The Judge can only be changed while the round is choosing a topic' });
      return;
    }

    const nextId = cleanId(czarUserId);
    const next = nextId && group.players.find(p => p.userId === nextId);
    if (!next) {
      socket.emit('error', { message: 'That player is not in this group' });
      return;
    }

    theme.czarId = next.userId;
    // A host hand-pick is a fresh assignment, so the new Judge is free to skip
    // even if the previous Judge had been forced to play (RT-3).
    theme.judgeMustPlay = false;
    groups.set(gid, group);
    broadcastGroup(group);
    console.log('Judge reassigned for group:', gid);
  });

  // A Judge who does not want to hold the role can skip their turn while the
  // round is still choosing a topic (RT-3). This is the Judge-authorized mirror
  // of the host's reassign_judge: the caller must be the current Judge, and the
  // replacement is chosen at random from members who have not already served
  // as Judge this cycle. A skipped Judge counts as having served, so the
  // rotation advances. When every member has served (the pool is exhausted),
  // the role reverts to the first-assigned Judge, who is then not offered the
  // pass again — they must pick a topic.
  on('judge_skip', ({ groupId }) => {
    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    const theme = group.currentTheme;
    if (!theme || theme.status !== 'topic_selection') {
      socket.emit('error', { message: 'The Judge can only skip while the round is choosing a topic' });
      return;
    }
    if (userId !== theme.czarId) {
      socket.emit('error', { message: 'Only the Judge can skip their turn' });
      return;
    }
    // The first-assigned Judge who was reverted to after a full-cycle skip must
    // play: they are not offered the pass again.
    if (theme.judgeMustPlay) {
      socket.emit('error', { message: 'You must pick a topic this round' });
      return;
    }

    const currentJudgeId = theme.czarId;
    // The skipping Judge has now served this cycle. Build the served set
    // including them so the pool below correctly excludes everyone who has
    // already judged — and so a full set (everyone served) yields an empty
    // pool, which is what triggers the revert to the first-assigned Judge.
    const memberIds = new Set(group.players.map(p => p.userId));
    const served = new Set(group.judgedThisCycle || []);
    served.add(currentJudgeId);
    const currentServed = Array.from(served).filter(id => memberIds.has(id));

    const pool = group.players.filter(p => p.userId !== currentJudgeId && !currentServed.includes(p.userId));
    if (pool.length > 0) {
      const next = pool[Math.floor(Math.random() * pool.length)];
      theme.czarId = next.userId;
      group.judgedThisCycle = currentServed;
      console.log('Judge skipped for group:', gid, '-> new Judge:', next.userId);
    } else {
      // Everyone has served and still declined: revert to the first-assigned
      // Judge, who must play. The cycle is complete, so it resets.
      theme.czarId = theme.firstAssignedJudge || currentJudgeId;
      theme.judgeMustPlay = true;
      group.judgedThisCycle = [];
      console.log('Full-cycle skip for group:', gid, '-> first Judge must play:', theme.czarId);
    }

    groups.set(gid, group);
    broadcastGroup(group);
  });

  // Update group settings
  on('update_group', ({ groupId, settings }) => {
    console.log('Update group request:', { groupId, settings, socketId: socket.id, userId });

    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    // Only host can update group settings, compared against the identity the
    // auth middleware bound to this socket.
    if (group.host !== userId) {
      socket.emit('error', { message: 'Only host can update group settings' });
      return;
    }

    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      socket.emit('error', { message: 'Settings must be an object' });
      return;
    }

    // Reject rather than silently clamp/persist a corrupted value — a bad
    // threshold should surface immediately, not decay the override mechanic quietly.
    if (settings.overrideThreshold !== undefined && !isValidOverrideThreshold(settings.overrideThreshold)) {
      socket.emit('error', { message: 'Override threshold must be a whole percentage between 51 and 100' });
      return;
    }

    if (settings.submissionTime !== undefined) {
      settings.submissionTime = clampWindowHours(settings.submissionTime);
    }
    if (settings.votingTime !== undefined) {
      settings.votingTime = clampWindowHours(settings.votingTime);
    }
    if (settings.voteBudget !== undefined) {
      settings.voteBudget = clampVoteBudget(settings.voteBudget);
    }
    if (settings.shareTheWealth !== undefined) {
      settings.shareTheWealth = settings.shareTheWealth === true;
    }
    // A downvote must always spend budget: clamp a 0/negative downvoteCost to
    // a positive value so it can never make the downvote free (RT-2-1).
    if (settings.downvoteCost !== undefined) {
      settings.downvoteCost = clampDownvoteCost(settings.downvoteCost);
    }

    // Update group settings
    group.settings = { ...group.settings, ...settings };
    groups.set(gid, group);
    broadcastGroup(group);

    console.log('Group updated:', gid);
  });

  // Leave group: the caller removes themselves from the roster. Identity is
  // the auth-bound userId, never anything in the payload. The group survives —
  // remaining members are broadcast the updated roster, and the leaver is
  // confirmed so their client can navigate to the dashboard. Leaving when
  // already gone is a no-op, not an error, because the client may race a
  // reconnect or a page refresh against this exact call.
  //
  // The host is refused: a group must always have a host who is a current
  // member, or it could never be started, edited, or deleted again. The host
  // delete_group event is the supported path for disbanding, and the UI never
  // offers a host a Leave button, so rejecting here restores the guarantee
  // without changing any supported flow.
  on('leave_group', ({ groupId }) => {
    console.log('Leave group request:', { groupId, socketId: socket.id, userId });

    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    // A current member who is not the host may leave freely. A host may not:
    // they are the group's sole point of management, and letting them out
    // would strand the group host-less and undeletable.
    if (group.host === userId) {
      socket.emit('error', { message: 'The host cannot leave the group' });
      return;
    }

    const index = group.players.findIndex(p => p.userId === userId);
    if (index !== -1) {
      group.players.splice(index, 1);
      groups.set(gid, group);
      broadcastGroup(group);
      console.log('Player left group:', { userId, groupId: gid });
    }

    // Always confirm so the caller navigates home, even in the no-op case.
    socket.emit('left_group', { groupId: gid });
  });

  // Delete group: permanently removes the group, host only. Any other caller
  // is refused with no state change. On success every still-connected member
  // is told the group is gone so their clients can navigate to the dashboard.
  on('delete_group', ({ groupId }) => {
    console.log('Delete group request:', { groupId, socketId: socket.id, userId });

    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    // Host check against the authenticated identity, never the payload.
    if (group.host !== userId) {
      socket.emit('error', { message: 'Only the host can delete the group' });
      return;
    }

    // Capture the still-connected member sockets before the group is gone.
    // Each player carries `id` = socket id and `connected`, the same mapping
    // broadcastGroup relies on, so this matches how every other event reaches
    // players without depending on socket.io rooms.
    const connectedSockets = group.players
      .filter(p => p.connected !== false)
      .map(p => p.id);

    groups.delete(gid);
    console.log('Group deleted:', gid);

    connectedSockets.forEach(socketId => {
      io.to(socketId).emit('group_deleted', { groupId: gid });
    });
  });

  // Host election (HG-1): when the host has abandoned the group (gone > 30
  // days and not present), any current member may open an election to pick a
  // new sole host. A present host is never eligible — the election only exists
  // while the host is determined abandoned, so a briefly-offline host is never
  // affected. Opening when one is already in flight is a no-op that just
  // re-broadcasts the current state.
  on('host_election_open', ({ groupId }) => {
    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }
    if (!group.players.some(p => p.userId === userId)) {
      socket.emit('error', { message: 'You are not a member of this group' });
      return;
    }
    if (group.host === userId) {
      socket.emit('error', { message: 'The host cannot start an election' });
      return;
    }
    if (!isHostAbandoned(group)) {
      socket.emit('error', { message: 'The host is still here — no election is available' });
      return;
    }

    if (!group.election || !group.election.open) {
      group.election = {
        open: true,
        openedBy: userId,
        openedAt: new Date().toISOString(),
        // voterUserId -> candidateUserId. Keyed by the authenticated identity,
        // never a payload-supplied id.
        votes: {}
      };
      console.log('Host election opened for group:', gid, 'by', userId);
    }

    groups.set(gid, group);
    broadcastGroup(group);
  });

  // Cast a vote in a host election (HG-1). Votes are keyed by the
  // authenticated socket.data.userId, never a payload id; a member cannot vote
  // for themselves; the abandoned host is off the ballot. When a candidate
  // reaches a strict majority (> 50%) of the current non-host members, hostship
  // transfers to them and the election closes.
  on('host_vote', ({ groupId, candidateId }) => {
    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }
    if (!group.election || !group.election.open) {
      socket.emit('error', { message: 'No host election is open' });
      return;
    }
    if (group.host === userId) {
      socket.emit('error', { message: 'The host cannot vote in an election' });
      return;
    }
    if (!group.players.some(p => p.userId === userId)) {
      socket.emit('error', { message: 'You are not a member of this group' });
      return;
    }

    const candidateIdClean = cleanId(candidateId);
    const candidate = candidateIdClean && group.players.find(p => p.userId === candidateIdClean);
    if (!candidate) {
      socket.emit('error', { message: 'That player is not in this group' });
      return;
    }
    if (candidate.userId === group.host) {
      socket.emit('error', { message: 'The abandoned host is not on the ballot' });
      return;
    }
    if (candidate.userId === userId) {
      socket.emit('error', { message: 'You cannot vote for yourself' });
      return;
    }

    group.election.votes[userId] = candidate.userId;
    console.log('Host election vote for group:', gid, 'by', userId, '->', candidate.userId);

    // Majority check: a candidate wins with > 50% of the current non-host
    // members. With an electorate of N that is floor(N/2) + 1 votes.
    const needed = electionMajorityNeeded(group);
    const tally = {};
    Object.values(group.election.votes).forEach(v => { tally[v] = (tally[v] || 0) + 1; });
    const winnerId = Object.keys(tally).find(c => tally[c] >= needed);

    if (winnerId) {
      // Transfer hostship. This is the only writer of group.host besides group
      // creation, and every host gate compares group.host === userId, so all
      // host powers re-point at the elected member automatically.
      const oldHost = group.host;
      group.host = winnerId;
      group.players.forEach(p => { p.isHost = p.userId === winnerId; });
      group.election = null;
      console.log('Host election resolved for group:', gid, '-> new host:', winnerId, '(old host:', oldHost + ')');
    }

    groups.set(gid, group);
    broadcastGroup(group);
  });

  // Test-only hook (HG-1): backdate a player's lastSeenAt so the suite can
  // simulate an abandoned host without waiting 30 real days. Only available
  // under AUTH_TEST_MODE, which refuses to coexist with production (config.js).
  on('test_backdate_last_seen', ({ groupId, userId: targetId, daysAgo }) => {
    if (!config.authTestMode) {
      socket.emit('error', { message: 'Not available' });
      return;
    }
    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }
    const player = group.players.find(p => p.userId === targetId);
    if (!player) {
      socket.emit('error', { message: 'Player not in group' });
      return;
    }
    const days = Number(daysAgo) || 31;
    player.lastSeenAt = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    groups.set(gid, group);
    socket.emit('test_backdated', { groupId: gid });
  });

  // Start group: transitions out of setup and creates the first round
  on('start_group', ({ groupId, czarUserId }) => {
    console.log('Start group request:', { groupId, socketId: socket.id, userId });

    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    if (group.host !== userId) {
      socket.emit('error', { message: 'Only host can start the group' });
      return;
    }

    if (group.status !== 'setup') {
      socket.emit('error', { message: 'Group has already started' });
      return;
    }

    // A round needs a Judge plus at least one contestant, so the group must
    // have at least two MEMBERS. Deliberately not "connected": who happens to
    // be online right now is not the host's problem — an absent player can
    // submit when they come back, and blocking the round on presence just
    // strands the group.
    if (group.players.length < MIN_PLAYERS_TO_START) {
      socket.emit('error', {
        message: `A round needs at least ${MIN_PLAYERS_TO_START} players in the group — one to judge and one to submit`
      });
      return;
    }

    // The host may hand-pick round 1's Round Leader, exactly as they can for
    // later rounds. An unknown id falls through to a random pick inside
    // beginRound rather than failing the start.
    const roundLeader = beginRound(group, cleanId(czarUserId));
    groups.set(gid, group);
    console.log('Group started, round 1 created:', gid, 'round leader:', roundLeader.username);
    broadcastGroup(group);
  });

  // Start round: begins round 2+ once the group is already active and the
  // previous round has been revealed. Host-only, reuses the same
  // round-creation logic as start_group. czarUserId lets the host hand-pick
  // a Round Leader instead of a random one (used by the "Pick Round Leader" UI).
  on('start_round', ({ groupId, czarUserId }) => {
    console.log('Start round request:', { groupId, socketId: socket.id, userId, czarUserId });

    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    if (group.host !== userId) {
      socket.emit('error', { message: 'Only host can start a round' });
      return;
    }

    if (group.status !== 'active') {
      socket.emit('error', { message: 'Group has not been started yet' });
      return;
    }

    // A round that gave up after MAX_AUTO_REARMS attempts is finished waiting,
    // even though it never left its submission phase. Letting the host start
    // over is the escape hatch the re-arm cap depends on — without it, capping
    // the retries would strand the group instead of protecting it.
    const stalled = !!(group.currentTheme && group.currentTheme.rearmExhausted);
    if (group.currentTheme && group.currentTheme.status !== 'reveal' && !stalled) {
      socket.emit('error', { message: 'Current round is still in progress' });
      return;
    }

    // A round needs a Judge plus at least one contestant, so the group must
    // have at least two MEMBERS. Deliberately not "connected": who happens to
    // be online right now is not the host's problem — an absent player can
    // submit when they come back, and blocking the round on presence just
    // strands the group.
    if (group.players.length < MIN_PLAYERS_TO_START) {
      socket.emit('error', {
        message: `A round needs at least ${MIN_PLAYERS_TO_START} players in the group — one to judge and one to submit`
      });
      return;
    }

    // An unknown czarUserId is ignored by beginRound, which falls back to a
    // random connected player, so it needs no separate rejection here.
    const roundLeader = beginRound(group, cleanId(czarUserId));
    groups.set(gid, group);
    console.log('Round started for group:', gid, 'round leader:', roundLeader.username);
    broadcastGroup(group);
  });

  // Search YouTube so players pick a real video instead of pasting a link.
  // Results are cached server-side (see youtube.js) because search.list costs
  // 100 of the 10,000 daily quota units per call.
  on('search_youtube', async ({ query }) => {
    const q = cleanText(query, LIMITS.searchQuery);
    if (!q) {
      socket.emit('youtube_results', { query: '', results: [] });
      return;
    }

    try {
      const results = await searchVideos(q);
      socket.emit('youtube_results', { query: q, results });
    } catch (err) {
      console.error('YouTube search failed:', err.message);
      socket.emit('error', { message: 'Video search is unavailable right now' });
    }
  });

  // Submit a video for the current round (non-Round-Leader players only)
  on('submit_video', ({ groupId, videoId, title, thumbnail, channelTitle }) => {
    console.log('Submit video request:', { groupId, socketId: socket.id, userId });

    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    const theme = group.currentTheme;
    if (!theme || theme.status !== 'submission') {
      socket.emit('error', { message: 'Submissions are not open for this round' });
      return;
    }

    if (userId === theme.czarId) {
      socket.emit('error', { message: 'The Judge cannot submit a video' });
      return;
    }

    const player = group.players.find(p => p.userId === userId);
    if (!player || player.connected === false) {
      socket.emit('error', { message: 'You must be connected to submit' });
      return;
    }

    if (theme.submissions.some(s => s.playerUserId === userId)) {
      socket.emit('error', { message: 'You already submitted a video this round' });
      return;
    }

    // The id is checked against YouTube's exact 11-character format, so it can
    // be interpolated into an embed URL on the client without becoming an
    // injection point in the iframe src.
    if (!isValidVideoId(videoId)) {
      socket.emit('error', { message: 'That is not a valid YouTube video id' });
      return;
    }

    const videoTitle = cleanText(title, LIMITS.videoTitle);
    const channel = cleanText(channelTitle, LIMITS.channelTitle) || 'Unknown channel';
    if (!videoTitle) {
      socket.emit('error', { message: `A video needs a title of at most ${LIMITS.videoTitle} characters` });
      return;
    }

    // The thumbnail is decorative and the client puts it in an <img src>.
    // Anything that is not a plain https URL falls back to YouTube's canonical
    // one rather than failing the submission over a cosmetic field.
    let thumb = cleanText(thumbnail, LIMITS.thumbnailUrl);
    if (!thumb || thumb.slice(0, 8) !== 'https://') {
      thumb = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    }

    theme.submissions.push({
      id: uniqueId('sub_'),
      playerUserId: userId,
      videoId,
      title: videoTitle,
      thumbnail: thumb,
      channelTitle: channel
    });

    const eligiblePlayers = group.players.filter(p => p.connected !== false && p.userId !== theme.czarId);
    if (eligiblePlayers.length > 0 && theme.submissions.length >= eligiblePlayers.length) {
      openVoting(theme, group);
    } else {
      // Everyone present has not finished, but the window may have closed
      // while this submission was in flight. Checked after the push so this
      // entry counts towards the round rather than being stranded by it.
      advanceIfExpired(group);
    }

    groups.set(gid, group);
    broadcastGroup(group);
  });

  // Cast a vote on a submission (any connected player, including the Round Leader)
  on('cast_vote', ({ groupId, submissionId, points, isDownvote, comment }) => {
    console.log('Cast vote request:', { groupId, submissionId, socketId: socket.id, userId });

    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    const theme = group.currentTheme;
    if (!theme || theme.status !== 'voting') {
      socket.emit('error', { message: 'Voting is not open for this round' });
      return;
    }

    const subId = cleanId(submissionId);
    const target = subId && theme.submissions.find(sub => sub.id === subId);
    if (!target) {
      socket.emit('error', { message: 'That submission is not part of this round' });
      return;
    }

    const isDown = isDownvote === true;

    // You cannot vote for your own submission, upvote or downvote. Enforced
    // here and not only in the UI: the client is told which submission is its
    // own so it can grey it out, but nothing stops a crafted payload naming
    // it anyway. Checked before the downvote gate so a self-vote is always
    // reported as such regardless of whether downvotes are allowed.
    if (target.playerUserId === userId) {
      socket.emit('error', { message: 'You cannot vote for your own submission' });
      return;
    }

    // Downvotes are a host-controlled opt-in, enforced here and not just in the
    // UI. A crafted downvote against a group that forbids them is rejected
    // (RT-2); allowDownvotes previously appeared only in the client.
    if (isDown && group.settings.allowDownvotes !== true) {
      socket.emit('error', { message: 'Downvotes are not allowed in this group' });
      return;
    }

    // A full vote is worth `points` (capped below); a downvote is asymmetric —
    // it spends downvoteCost from the budget rather than the points field.
    const maxPoints = group.settings.maxJuryPoints || 3;
    // Upvotes must carry whole positive points (RT-2-1 + RT-2-2). A zero-point
    // cast would be free, so it would neither spend budget nor be capped —
    // letting a player vote past their budget and pump a submission's voteCount
    // free (RT-2-1). A fractional cast (e.g. 0.1) would likewise let a player
    // spend their integer budget as an unbounded number of tiny votes and ramp
    // a submission's voteCount past the public-override threshold (RT-2-2), so
    // points must be a whole number >= 1.
    if (!isDown && (typeof points !== 'number' || !Number.isInteger(points) || points < 1 || points > maxPoints)) {
      socket.emit('error', { message: `Points must be a positive whole number between 1 and ${maxPoints}` });
      return;
    }

    const voter = group.players.find(p => p.userId === userId);
    if (!voter || voter.connected === false) {
      socket.emit('error', { message: 'You must be connected to vote' });
      return;
    }

    // Per-round budget (RT-2). Each player may spend up to voteBudget points
    // across all their votes this round; voteBudgetUsed on currentTheme tracks
    // spend and auto-resets when beginRound starts the next round.
    const budget = voteBudget(group);
    // A downvote always spends a positive downvoteCost (RT-2-1). The settings
    // paths clamp it to >= 1, but a legacy/malformed group could still hold a
    // 0/negative value, so coerce it positive here too and use that single
    // clamped value for both the budget cost and the stored points.
    const downvoteCost = clampDownvoteCost(group.settings.downvoteCost);
    const cost = isDown ? downvoteCost : points;
    const used = (theme.voteBudgetUsed && theme.voteBudgetUsed[userId]) || 0;
    if (used + cost > budget) {
      socket.emit('error', { message: `Vote exceeds your remaining budget of ${Math.max(0, budget - used)} points` });
      return;
    }

    // "Share the wealth" (default on): a player must spread their points across
    // at least two submissions. Concretely, a vote is rejected when it is a
    // player's first-or-only distinct submission AND spending it means their
    // whole budget lands on that single submission with none left to spread
    // elsewhere. With the toggle off, the whole budget may go on one song.
    if (shareTheWealth(group)) {
      const spentSubs = new Set(theme.votes
        .filter(v => v.voterUserId === userId)
        .map(v => v.submissionId));
      const distinctAfter = spentSubs.has(subId) ? spentSubs.size : spentSubs.size + 1;
      if (distinctAfter < 2 && used + cost >= budget) {
        socket.emit('error', {
          message: "With 'Share the wealth' on, spread your points across at least two submissions"
        });
        return;
      }
    }

    // Comments are opt-in per group. When the setting is off the field is
    // dropped rather than rejected, so a stale client can't be wedged out of
    // voting entirely by sending one.
    let voteComment = null;
    if (group.settings.allowVotingComments === true) {
      voteComment = cleanText(comment, LIMITS.voteComment);
    }

    theme.votes.push({
      voterUserId: userId,
      submissionId: subId,
      points: isDown ? -downvoteCost : points,
      isDownvote: isDown,
      comment: voteComment
    });
    theme.voteBudgetUsed = { ...(theme.voteBudgetUsed || {}), [userId]: used + cost };

    groups.set(gid, group);

    // Voting always runs to its deadline (see openVoting): a round does NOT
    // resolve just because every eligible voter has voted. The reveal happens
    // when the persisted voting deadline passes, evaluated on read.
    broadcastGroup(group);
  });

  // Round Leader explicitly selects a winner (can resolve the round before everyone votes)
  on('czar_select_winner', ({ groupId, submissionId }) => {
    console.log('Czar select winner request:', { groupId, submissionId, socketId: socket.id, userId });

    const gid = cleanId(groupId);
    const group = gid && groups.get(gid);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    const theme = group.currentTheme;
    if (!theme || theme.status !== 'voting') {
      socket.emit('error', { message: 'Voting is not open for this round' });
      return;
    }

    if (userId !== theme.czarId) {
      socket.emit('error', { message: 'Only the Judge can select a winner' });
      return;
    }

    const subId = cleanId(submissionId);
    if (!subId || !theme.submissions.some(sub => sub.id === subId)) {
      socket.emit('error', { message: 'That submission is not part of this round' });
      return;
    }

    theme.czarSelection = subId;
    groups.set(gid, group);
    calculateGroupResults(group);
  });

  socket.on('disconnect', withErrorHandling(socket, 'disconnect', () => {
    console.log('User disconnected:', socket.id);

    // Mark this player disconnected in every group they belong to (matched by
    // the current socket mapping) so submission/voting completion checks
    // don't wait on a player who's no longer there.
    groups.forEach((group, groupId) => {
      const player = group.players.find(p => p.id === socket.id);
      if (player) {
        player.connected = false;
        groups.set(groupId, group);
        console.log('Player marked as disconnected:', { username: player.username, groupId });
        broadcastGroup(group);
      }
    });
  }));
});

server.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  if (config.authTestMode) {
    console.warn('[auth] AUTH_TEST_MODE is ON - test identities are accepted. Never enable this in production.');
  }
});
