const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const config = require('./config');
const { createAuthMiddleware } = require('./auth');
const { searchVideos, isValidVideoId } = require('./youtube');
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

// overrideThreshold is always a whole percentage (e.g. 70) in settings objects
// and over the wire; it's only ever converted to a 0-1 fraction at the point
// it's compared against a vote ratio (see calculateGroupResults).
function isValidOverrideThreshold(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 51 && value <= 100;
}

// Begins a round on an already-persisted group: assigns a Round Leader
// (randomly among connected players, unless forcedCzarUserId names a
// connected player) and creates a fresh currentTheme. Caller is responsible
// for persisting the group afterward and broadcasting the result.
function beginRound(group, forcedCzarUserId) {
  const connectedPlayers = group.players.filter(p => p.connected !== false);

  let roundLeader = forcedCzarUserId
    ? connectedPlayers.find(p => p.userId === forcedCzarUserId)
    : null;
  if (!roundLeader) {
    roundLeader = connectedPlayers[Math.floor(Math.random() * connectedPlayers.length)];
  }

  const presetTopics = group.settings.presetTopics || [];
  const topicText = presetTopics.length > 0
    ? presetTopics[Math.floor(Math.random() * presetTopics.length)]
    : 'Round Challenge';
  const submissionHours = group.settings.submissionTime || 24;

  group.status = 'active';
  group.currentRound = (group.currentRound || 0) + 1;
  group.currentTheme = {
    id: `theme${Date.now()}`,
    title: topicText,
    description: "This round's music challenge",
    status: 'submission', // 'submission' -> 'voting' -> 'reveal'
    deadline: new Date(Date.now() + submissionHours * 60 * 60 * 1000).toISOString(),
    czarId: roundLeader.userId, // stable id; stripped from broadcasts by publicizeTheme
    submissions: [],
    votes: [],
    czarSelection: null
  };

  return roundLeader;
}

// Strips whatever the current phase says shouldn't be visible yet, most
// importantly the Round Leader's identity (czarId is never sent as-is) and,
// during voting, which player submitted which song.
function publicizeTheme(theme, group) {
  if (!theme) return null;

  const { czarId, ...rest } = theme;
  const publicTheme = { ...rest, submissionCount: theme.submissions.length };

  if (theme.status === 'submission') {
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
function broadcastGroup(group) {
  const publicGroup = { ...group, currentTheme: publicizeTheme(group.currentTheme, group) };
  group.players.forEach(player => {
    io.to(player.id).emit('group_updated', {
      group: publicGroup,
      isRoundLeader: !!(group.currentTheme && player.userId === group.currentTheme.czarId)
    });
  });
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
    if (voter) {
      if (vote.isDownvote) {
        voter.score -= (group.settings.downvoteCost || 1);
      } else if (winner && vote.submissionId === winner.id) {
        voter.score += vote.points;
      }
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
    videoId: winner ? winner.videoId : null
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

  // The identity bound by the auth middleware. Handlers use these instead of
  // anything in an event payload, which is what makes the host and
  // round-leader checks actually enforceable rather than advisory.
  const userId = socket.data.userId;
  const username = socket.data.username;

  // Hand the client a session token so its next reconnect skips Google.
  socket.emit('session', {
    sessionToken: socket.data.sessionToken,
    user: {
      id: userId,
      name: username,
      email: socket.data.email,
      picture: socket.data.picture
    }
  });

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
      id: Date.now().toString(),
      text: topicText,
      creatorId: userId,
      isPublic: isPublic === true,
      createdAt: new Date().toISOString()
    };

    topics.set(topic.id, topic);
    socket.emit('topic_submitted', { topic });
  });

  // Get available topics (global bank browsed by the ThemeIdeas page). A topic
  // is only ever returned if it's public or the requester created it —
  // previously every topic went out in publicTopics regardless of isPublic,
  // so everyone could read everyone else's private ideas.
  on('get_topics', () => {
    const all = Array.from(topics.values());
    const privateTopics = all.filter(t => t.creatorId === userId && t.isPublic !== true);
    const publicTopics = all.filter(t => t.isPublic === true);

    socket.emit('topics_list', { privateTopics, publicTopics });
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
    const groupId = `GROUP${Date.now()}`;

    const settings = { ...(data.settings || {}) };
    if (settings.overrideThreshold !== undefined && !isValidOverrideThreshold(settings.overrideThreshold)) {
      settings.overrideThreshold = 70;
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
        username,
        score: 0,
        isHost: true,
        connected: true
      }],
      settings,
      status: 'setup',
      currentRound: 0,
      currentTheme: null,
      history: [],
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

    socket.emit('groups_list', { groups: userGroups });
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
      existingPlayer.username = username;
    } else {
      // Add new player to group
      group.players.push({
        id: socket.id,
        userId,
        username,
        score: 0,
        isHost: false,
        connected: true
      });
    }

    groups.set(gid, group);

    // Tell the joiner directly (they navigate off this) and update everyone
    // else already viewing the group so the new player shows up live. The
    // joiner's own payload is publicized the same as any other broadcast —
    // the Round Leader's identity is never exposed via this event either.
    socket.emit('group_joined', {
      group: { ...group, currentTheme: publicizeTheme(group.currentTheme, group) },
      isRoundLeader: !!(group.currentTheme && userId === group.currentTheme.czarId)
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
      groups.set(gid, group);
    }

    socket.emit('group_details', {
      group: { ...group, currentTheme: publicizeTheme(group.currentTheme, group) },
      isRoundLeader: !!(group.currentTheme && userId === group.currentTheme.czarId)
    });
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

    // Update group settings
    group.settings = { ...group.settings, ...settings };
    groups.set(gid, group);
    broadcastGroup(group);

    console.log('Group updated:', gid);
  });

  // Start group: transitions out of setup and creates the first round
  on('start_group', ({ groupId }) => {
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

    const connectedPlayers = group.players.filter(p => p.connected !== false);
    if (connectedPlayers.length < 1) {
      socket.emit('error', { message: 'Need at least one connected player to start' });
      return;
    }

    const roundLeader = beginRound(group);
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

    if (group.currentTheme && group.currentTheme.status !== 'reveal') {
      socket.emit('error', { message: 'Current round is still in progress' });
      return;
    }

    const connectedPlayers = group.players.filter(p => p.connected !== false);
    if (connectedPlayers.length < 1) {
      socket.emit('error', { message: 'Need at least one connected player to start' });
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
      socket.emit('error', { message: 'The Round Leader cannot submit a video' });
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
      id: `sub_${Date.now()}`,
      playerUserId: userId,
      videoId,
      title: videoTitle,
      thumbnail: thumb,
      channelTitle: channel
    });

    const eligiblePlayers = group.players.filter(p => p.connected !== false && p.userId !== theme.czarId);
    if (eligiblePlayers.length > 0 && theme.submissions.length >= eligiblePlayers.length) {
      theme.status = 'voting';
    }

    groups.set(gid, group);
    broadcastGroup(group);
  });

  // Cast a vote on a submission (any connected player, including the Round Leader)
  on('cast_vote', ({ groupId, submissionId, points, isDownvote }) => {
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

    if (theme.votes.some(v => v.voterUserId === userId)) {
      socket.emit('error', { message: 'You already voted this round' });
      return;
    }

    const subId = cleanId(submissionId);
    if (!subId || !theme.submissions.some(sub => sub.id === subId)) {
      socket.emit('error', { message: 'That submission is not part of this round' });
      return;
    }

    // The old check only bounded points from above, so a negative or
    // non-numeric value went straight into the tally and could swing the
    // result or poison a score with NaN.
    const maxPoints = group.settings.maxJuryPoints || 3;
    if (!isDownvote && (typeof points !== 'number' || !Number.isFinite(points) || points < 0 || points > maxPoints)) {
      socket.emit('error', { message: `Points must be a number between 0 and ${maxPoints}` });
      return;
    }

    const voter = group.players.find(p => p.userId === userId);
    if (!voter || voter.connected === false) {
      socket.emit('error', { message: 'You must be connected to vote' });
      return;
    }

    theme.votes.push({
      voterUserId: userId,
      submissionId: subId,
      points: isDownvote ? -(group.settings.downvoteCost || 1) : points,
      isDownvote: !!isDownvote
    });

    groups.set(gid, group);

    const connectedPlayers = group.players.filter(p => p.connected !== false);
    if (theme.votes.length >= connectedPlayers.length) {
      calculateGroupResults(group);
    } else {
      broadcastGroup(group);
    }
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
      socket.emit('error', { message: 'Only the Round Leader can select a winner' });
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
