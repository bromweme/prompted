const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const dotenv = require('dotenv');
const { PersistentStore } = require('./db');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8081', 'exp://localhost:19000', '*'],
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Health check (also used by Playwright's webServer config to know when
// the backend is ready to accept connections)
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Group state storage, backed by SQLite (see db.js) so it survives a server restart
const topics = new PersistentStore('topics'); // Global topic bank: id -> { id, text, creatorId, isPublic, createdAt }
const groups = new PersistentStore('groups'); // id -> { id, name, description, settings, host, players, status, currentRound, currentTheme, history }

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
    publicTheme.submissions = theme.submissions.map(s => ({ id: s.id, songTitle: s.songTitle, artist: s.artist }));
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
    song: winner ? winner.songTitle : null
  });

  groups.set(group.id, group);
  console.log('Round resolved for group:', group.id, 'winner:', winnerUsername);
  broadcastGroup(group);
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Set default username if not provided
  socket.data.username = socket.data.username || `Player${socket.id.substring(0, 4)}`;

  // Submit topic to the global topic bank
  socket.on('submit_topic', ({ text, isPublic }) => {
    console.log('Topic submission:', { text, isPublic, socketId: socket.id });

    const topic = {
      id: Date.now().toString(),
      text: text.trim(),
      creatorId: socket.id,
      isPublic: isPublic || false,
      createdAt: new Date().toISOString()
    };

    topics.set(topic.id, topic);
    socket.emit('topic_submitted', { topic });
  });

  // Get available topics (global bank browsed by the ThemeIdeas page)
  socket.on('get_topics', () => {
    const privateTopics = Array.from(topics.values()).filter(t => t.creatorId === socket.id);
    const publicTopics = Array.from(topics.values());

    socket.emit('topics_list', { privateTopics, publicTopics });
  });

  // Delete topic from bank (only the creator can delete their own topic)
  socket.on('delete_topic', ({ topicId }) => {
    const publicTopic = topics.get(topicId);
    if (publicTopic && publicTopic.creatorId === socket.id) {
      topics.delete(topicId);
      socket.emit('topic_deleted', { topicId });
    }
  });

  // Create group
  socket.on('create_group', ({ groupData, username, userId }) => {
    console.log('Create group request:', { groupData, socketId: socket.id, userId });

    socket.data.username = username || socket.data.username || 'Unknown';
    socket.data.userId = userId;

    const groupId = groupData.id || `GROUP${Date.now()}`;

    const settings = { ...(groupData.settings || {}) };
    if (settings.overrideThreshold !== undefined && !isValidOverrideThreshold(settings.overrideThreshold)) {
      settings.overrideThreshold = 70;
    }

    const group = {
      id: groupId,
      name: groupData.name,
      description: groupData.description,
      isPrivate: groupData.isPrivate || false,
      host: userId,
      players: [{
        id: socket.id,
        userId,
        username: socket.data.username || 'Unknown',
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
  socket.on('get_groups', ({ userId } = {}) => {
    console.log('Get groups request:', { socketId: socket.id, userId });

    const uid = userId || socket.data.userId;
    const userGroups = Array.from(groups.values()).filter(group =>
      group.players.some(player => player.userId === uid)
    );

    socket.emit('groups_list', { groups: userGroups });
  });

  // Join group
  socket.on('join_group', ({ groupId, username, userId }) => {
    console.log('Join group request:', { groupId, username, socketId: socket.id, userId });

    const group = groups.get(groupId);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    socket.data.username = username || socket.data.username || 'Unknown';
    socket.data.userId = userId || socket.data.userId;

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
        username: username,
        score: 0,
        isHost: false,
        connected: true
      });
    }

    groups.set(groupId, group);

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
  socket.on('get_group', ({ groupId, username, userId }) => {
    console.log('Get group request:', { groupId, socketId: socket.id, userId });

    socket.data.username = username || socket.data.username || 'Unknown';
    socket.data.userId = userId || socket.data.userId;

    const group = groups.get(groupId);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    // Refresh this player's socket mapping so server -> client broadcasts
    // (group_updated) still reach them after a reconnect or page refresh.
    const uid = socket.data.userId;
    if (uid) {
      const player = group.players.find(p => p.userId === uid);
      if (player) {
        player.id = socket.id;
        player.connected = true;
        groups.set(groupId, group);
      }
    }

    socket.emit('group_details', {
      group: { ...group, currentTheme: publicizeTheme(group.currentTheme, group) },
      isRoundLeader: !!(group.currentTheme && uid === group.currentTheme.czarId)
    });
  });

  // Update group settings
  socket.on('update_group', ({ groupId, settings, userId }) => {
    console.log('Update group request:', { groupId, settings, socketId: socket.id, userId });

    const group = groups.get(groupId);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    // Only host can update group settings (compared by stable userId, not socket id)
    if (group.host !== (userId || socket.data.userId)) {
      socket.emit('error', { message: 'Only host can update group settings' });
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
    groups.set(groupId, group);
    broadcastGroup(group);

    console.log('Group updated:', groupId);
  });

  // Start group: transitions out of setup and creates the first round
  socket.on('start_group', ({ groupId, userId }) => {
    console.log('Start group request:', { groupId, socketId: socket.id, userId });

    const group = groups.get(groupId);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    if (group.host !== (userId || socket.data.userId)) {
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
    groups.set(groupId, group);
    console.log('Group started, round 1 created:', groupId, 'round leader:', roundLeader.username);
    broadcastGroup(group);
  });

  // Start round: begins round 2+ once the group is already active and the
  // previous round has been revealed. Host-only, reuses the same
  // round-creation logic as start_group. czarUserId lets the host hand-pick
  // a Round Leader instead of a random one (used by the "Pick Round Leader" UI).
  socket.on('start_round', ({ groupId, userId, czarUserId }) => {
    console.log('Start round request:', { groupId, socketId: socket.id, userId, czarUserId });

    const group = groups.get(groupId);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    if (group.host !== (userId || socket.data.userId)) {
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

    const roundLeader = beginRound(group, czarUserId);
    groups.set(groupId, group);
    console.log('Round started for group:', groupId, 'round leader:', roundLeader.username);
    broadcastGroup(group);
  });

  // Submit a song for the current round (non-Round-Leader players only)
  socket.on('submit_song', ({ groupId, spotifyUri, songTitle, artist, userId }) => {
    console.log('Submit song request:', { groupId, socketId: socket.id, userId });

    const group = groups.get(groupId);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    const uid = userId || socket.data.userId;
    const theme = group.currentTheme;
    if (!theme || theme.status !== 'submission') {
      socket.emit('error', { message: 'Submissions are not open for this round' });
      return;
    }

    if (uid === theme.czarId) {
      socket.emit('error', { message: 'The Round Leader cannot submit a song' });
      return;
    }

    const player = group.players.find(p => p.userId === uid);
    if (!player || player.connected === false) {
      socket.emit('error', { message: 'You must be connected to submit' });
      return;
    }

    if (theme.submissions.some(s => s.playerUserId === uid)) {
      socket.emit('error', { message: 'You already submitted a song this round' });
      return;
    }

    theme.submissions.push({ id: `sub_${Date.now()}`, playerUserId: uid, spotifyUri, songTitle, artist });

    const eligiblePlayers = group.players.filter(p => p.connected !== false && p.userId !== theme.czarId);
    if (eligiblePlayers.length > 0 && theme.submissions.length >= eligiblePlayers.length) {
      theme.status = 'voting';
    }

    groups.set(groupId, group);
    broadcastGroup(group);
  });

  // Cast a vote on a submission (any connected player, including the Round Leader)
  socket.on('cast_vote', ({ groupId, submissionId, points, isDownvote, userId }) => {
    console.log('Cast vote request:', { groupId, submissionId, socketId: socket.id, userId });

    const group = groups.get(groupId);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    const uid = userId || socket.data.userId;
    const theme = group.currentTheme;
    if (!theme || theme.status !== 'voting') {
      socket.emit('error', { message: 'Voting is not open for this round' });
      return;
    }

    if (theme.votes.some(v => v.voterUserId === uid)) {
      socket.emit('error', { message: 'You already voted this round' });
      return;
    }

    if (!isDownvote && points > (group.settings.maxJuryPoints || 3)) {
      socket.emit('error', { message: `Points cannot exceed ${group.settings.maxJuryPoints || 3}` });
      return;
    }

    const voter = group.players.find(p => p.userId === uid);
    if (!voter || voter.connected === false) {
      socket.emit('error', { message: 'You must be connected to vote' });
      return;
    }

    theme.votes.push({
      voterUserId: uid,
      submissionId,
      points: isDownvote ? -(group.settings.downvoteCost || 1) : points,
      isDownvote: !!isDownvote
    });

    groups.set(groupId, group);

    const connectedPlayers = group.players.filter(p => p.connected !== false);
    if (theme.votes.length >= connectedPlayers.length) {
      calculateGroupResults(group);
    } else {
      broadcastGroup(group);
    }
  });

  // Round Leader explicitly selects a winner (can resolve the round before everyone votes)
  socket.on('czar_select_winner', ({ groupId, submissionId, userId }) => {
    console.log('Czar select winner request:', { groupId, submissionId, socketId: socket.id, userId });

    const group = groups.get(groupId);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    const uid = userId || socket.data.userId;
    const theme = group.currentTheme;
    if (!theme || theme.status !== 'voting') {
      socket.emit('error', { message: 'Voting is not open for this round' });
      return;
    }

    if (uid !== theme.czarId) {
      socket.emit('error', { message: 'Only the Round Leader can select a winner' });
      return;
    }

    theme.czarSelection = submissionId;
    groups.set(groupId, group);
    calculateGroupResults(group);
  });

  socket.on('disconnect', () => {
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
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
