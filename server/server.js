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

// Game state storage, backed by SQLite (see db.js) so it survives a server restart
const games = new PersistentStore('games');
const topics = new PersistentStore('topics'); // Global topic bank: id -> { id, text, creatorId, isPublic, createdAt }
const groups = new PersistentStore('groups'); // id -> { id, name, description, settings, host, players, status, currentRound, history }

// Game constants
const GAME_STATES = {
  LOBBY: 'lobby',
  TOPIC_SELECTION: 'topic_selection',
  SUBMISSION: 'submission',
  VOTING: 'voting',
  REVEAL: 'reveal',
  ROUND_END: 'round_end',
  GAME_END: 'game_end'
};

// Generate unique game code
function generateGameCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Set default username if not provided
  socket.data.username = socket.data.username || `Player${socket.id.substring(0, 4)}`;

  // Join game lobby
  socket.on('join_game', ({ gameId, username, settings }) => {
    console.log('Join game request:', { gameId, username, socketId: socket.id, settings });
    socket.join(gameId);
    
    // Store username on socket for reconnection
    socket.data.username = username;
    
    if (!games.has(gameId)) {
      // Create new game with custom settings or defaults
      const gameSettings = settings || {
        czarPoints: 5,
        maxJuryPoints: 3,
        downvoteCost: 1,
        overrideThreshold: 0.7 // 70% public vote needed to override
      };
      
      games.set(gameId, {
        id: gameId,
        host: socket.id,
        players: [],
        gameState: GAME_STATES.LOBBY,
        currentRound: 0,
        cardCzar: null,
        topic: null,
        submissions: [],
        votes: [],
        topicBank: [], // Game-specific private topics
        settings: gameSettings
      });
      console.log('Created new game:', gameId, 'with settings:', gameSettings);
    }

    const game = games.get(gameId);
    
    // Check if player with same username already exists (reconnection)
    const existingPlayer = game.players.find(p => p.username === username);
    if (existingPlayer) {
      // Update socket ID for reconnected player
      existingPlayer.id = socket.id;
      existingPlayer.connected = true;
      console.log('Player reconnected:', { username, socketId: socket.id });
    } else {
      // Add new player
      game.players.push({
        id: socket.id,
        username: username,
        score: 0,
        skippedCzarCount: 0,
        connected: true
      });
      console.log('Added player to game:', { username, socketId: socket.id, totalPlayers: game.players.length });
    }

    games.set(gameId, game);

    console.log('Emitting player_joined with players:', game.players);
    io.to(gameId).emit('player_joined', {
      players: game.players,
      gameState: game.gameState
    });
  });

  // Submit topic to bank
  socket.on('submit_topic', ({ gameId, text, isPublic }) => {
    console.log('Topic submission:', { gameId, text, isPublic, socketId: socket.id });
    
    const topic = {
      id: Date.now().toString(),
      text: text.trim(),
      creatorId: socket.id,
      isPublic: isPublic || false,
      createdAt: new Date().toISOString()
    };

    if (isPublic || gameId === 'global') {
      // Add to global topic bank
      topics.set(topic.id, topic);
      console.log('Added to global topic bank:', topic.id);
    } else {
      // Add to game-specific private topic bank
      const game = games.get(gameId);
      if (game) {
        game.topicBank.push(topic);
        games.set(gameId, game);
        console.log('Added to game topic bank:', topic.id);
      }
    }

    // Send confirmation to submitter
    socket.emit('topic_submitted', { topic });
  });

  // Get available topics for a game
  socket.on('get_topics', ({ gameId }) => {
    let privateTopics = [];
    
    // If it's a real game, get private topics from that game
    if (gameId !== 'global') {
      const game = games.get(gameId);
      if (game) {
        privateTopics = game.topicBank.filter(t => t.creatorId === socket.id);
      }
    } else {
      // For global topic bank (ThemeIdeas page), return all topics as public
      // since it's for browsing all available topics
      privateTopics = Array.from(topics.values()).filter(t => t.creatorId === socket.id);
    }
    
    // Get all public topics from global bank
    const publicTopics = Array.from(topics.values());

    socket.emit('topics_list', {
      privateTopics,
      publicTopics
    });
  });

  // Delete topic from bank
  socket.on('delete_topic', ({ topicId, gameId }) => {
    const game = games.get(gameId);
    
    // Check if it's a private topic in the game
    if (game && gameId !== 'global') {
      const privateIndex = game.topicBank.findIndex(t => t.id === topicId && t.creatorId === socket.id);
      if (privateIndex !== -1) {
        game.topicBank.splice(privateIndex, 1);
        games.set(gameId, game);
        socket.emit('topic_deleted', { topicId });
        return;
      }
    }

    // Check if it's a public topic (only creator can delete)
    const publicTopic = topics.get(topicId);
    if (publicTopic && publicTopic.creatorId === socket.id) {
      topics.delete(topicId);
      socket.emit('topic_deleted', { topicId });
    }
  });

  // Create group
  socket.on('create_group', ({ groupData, username }) => {
    console.log('Create group request:', { groupData, socketId: socket.id });

    socket.data.username = username || socket.data.username || 'Unknown';

    const groupId = groupData.id || `GROUP${Date.now()}`;

    const group = {
      id: groupId,
      name: groupData.name,
      description: groupData.description,
      isPrivate: groupData.isPrivate || false,
      host: socket.id,
      players: [{
        id: socket.id,
        username: socket.data.username || 'Unknown',
        score: 0,
        isHost: true,
        connected: true
      }],
      settings: groupData.settings || {},
      status: 'setup',
      currentRound: 0,
      history: [],
      createdAt: new Date().toISOString()
    };

    groups.set(groupId, group);
    console.log('Created group:', groupId);

    socket.emit('group_created', { group });
  });

  // Get user's groups
  socket.on('get_groups', () => {
    console.log('Get groups request:', { socketId: socket.id });

    const userGroups = Array.from(groups.values()).filter(group =>
      group.players.some(player => player.id === socket.id)
    );

    socket.emit('groups_list', { groups: userGroups });
  });

  // Join group
  socket.on('join_group', ({ groupId, username }) => {
    console.log('Join group request:', { groupId, username, socketId: socket.id });

    const group = groups.get(groupId);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    // Check if player already in group
    const existingPlayer = group.players.find(p => p.id === socket.id);
    if (existingPlayer) {
      existingPlayer.connected = true;
      existingPlayer.username = username;
    } else {
      // Add new player to group
      group.players.push({
        id: socket.id,
        username: username,
        score: 0,
        isHost: false,
        connected: true
      });
    }

    groups.set(groupId, group);

    socket.emit('group_joined', { group });
  });

  // Get group details
  socket.on('get_group', ({ groupId, username }) => {
    console.log('Get group request:', { groupId, socketId: socket.id });

    socket.data.username = username || socket.data.username || 'Unknown';

    const group = groups.get(groupId);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    socket.emit('group_details', { group });
  });

  // Update group settings
  socket.on('update_group', ({ groupId, settings }) => {
    console.log('Update group request:', { groupId, settings, socketId: socket.id });

    const group = groups.get(groupId);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    // Only host can update group settings
    if (group.host !== socket.id) {
      socket.emit('error', { message: 'Only host can update group settings' });
      return;
    }

    // Update group settings
    group.settings = { ...group.settings, ...settings };
    groups.set(groupId, group);

    // Broadcast group update to all players in the group
    group.players.forEach(player => {
      io.to(player.id).emit('group_updated', { group });
    });

    console.log('Group updated:', groupId);
  });

  // Start group: transitions out of setup and creates the first round
  socket.on('start_group', ({ groupId }) => {
    console.log('Start group request:', { groupId, socketId: socket.id });

    const group = groups.get(groupId);
    if (!group) {
      socket.emit('error', { message: 'Group not found' });
      return;
    }

    if (group.host !== socket.id) {
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

    // Anonymously assign a Round Leader (Card Czar) for the first round
    const roundLeader = connectedPlayers[Math.floor(Math.random() * connectedPlayers.length)];

    const presetTopics = group.settings.presetTopics || [];
    const topicText = presetTopics.length > 0
      ? presetTopics[Math.floor(Math.random() * presetTopics.length)]
      : 'Round Challenge';
    const submissionHours = group.settings.submissionTime || 24;

    group.status = 'active';
    group.currentRound = 1;
    group.currentTheme = {
      id: `theme${Date.now()}`,
      title: topicText,
      description: "This round's music challenge",
      status: 'active',
      submissions: 0,
      deadline: new Date(Date.now() + submissionHours * 60 * 60 * 1000).toISOString(),
      czarId: roundLeader.id // server-side only, stripped below before broadcasting
    };

    groups.set(groupId, group);
    console.log('Group started, round 1 created:', groupId, 'round leader:', roundLeader.username);

    // Broadcast the round start to every player, withholding the Round Leader's
    // identity from everyone except the Round Leader themselves (unless the group
    // has anonymity turned off), mirroring the game engine's you_are_czar pattern.
    const { czarId, ...publicTheme } = group.currentTheme;
    if (group.settings.anonymousCzar === false) {
      publicTheme.czarUsername = roundLeader.username;
    }

    group.players.forEach(player => {
      io.to(player.id).emit('group_updated', {
        group: { ...group, currentTheme: publicTheme },
        isRoundLeader: player.id === roundLeader.id
      });
    });
  });

  // Start game
  socket.on('start_game', ({ gameId }) => {
    const game = games.get(gameId);
    if (game && game.host === socket.id) {
      game.gameState = GAME_STATES.TOPIC_SELECTION;
      game.currentRound = 1;
      selectCardCzar(game);
      games.set(gameId, game);

      // Broadcast to all players without revealing czar identity
      io.to(gameId).emit('game_started', {
        gameState: game.gameState,
        currentRound: game.currentRound
      });
      
      // Private message to the card czar
      io.to(game.cardCzar.id).emit('you_are_czar', {
        gameState: game.gameState,
        currentRound: game.currentRound
      });
    }
  });

  // Select topic/prompt
  socket.on('select_topic', ({ gameId, topic, isPublic, topicId }) => {
    const game = games.get(gameId);
    if (game && game.cardCzar.id === socket.id) {
      // Find topic creator if selecting from bank
      let creatorId = socket.id;
      if (topicId) {
        // Check game private topics
        const privateTopic = game.topicBank.find(t => t.id === topicId);
        if (privateTopic) {
          creatorId = privateTopic.creatorId;
        } else {
          // Check global public topics
          const publicTopic = topics.get(topicId);
          if (publicTopic) {
            creatorId = publicTopic.creatorId;
          }
        }
      }

      game.topic = {
        text: topic,
        isPublic: isPublic,
        creatorId: creatorId
      };
      game.gameState = GAME_STATES.SUBMISSION;
      game.submissions = [];
      games.set(gameId, game);

      // Broadcast without revealing creator
      io.to(gameId).emit('topic_selected', {
        topic: {
          text: game.topic.text,
          isPublic: game.topic.isPublic
        },
        gameState: game.gameState
      });
    }
  });

  // Submit song
  socket.on('submit_song', ({ gameId, spotifyUri, songTitle, artist }) => {
    const game = games.get(gameId);
    if (game && game.gameState === GAME_STATES.SUBMISSION) {
      // Check if player already submitted
      const alreadySubmitted = game.submissions.find(s => s.playerId === socket.id);
      if (!alreadySubmitted && game.cardCzar.id !== socket.id) {
        // Validate that player is connected
        const player = game.players.find(p => p.id === socket.id);
        if (!player || !player.connected) {
          socket.emit('error', { message: 'You must be connected to submit' });
          return;
        }
        
        game.submissions.push({
          id: Date.now(),
          playerId: socket.id,
          spotifyUri,
          songTitle,
          artist
        });

        // Check if all connected non-czar players have submitted
        const connectedNonCzarPlayers = game.players.filter(p => p.connected && p.id !== game.cardCzar.id);
        if (game.submissions.length === connectedNonCzarPlayers.length) {
          game.gameState = GAME_STATES.VOTING;
          game.votes = [];
          games.set(gameId, game);
          io.to(gameId).emit('voting_started', {
            submissions: game.submissions.map(s => ({
              id: s.id,
              songTitle: s.songTitle,
              artist: s.artist
            })),
            gameState: game.gameState
          });
        } else {
          games.set(gameId, game);
          io.to(gameId).emit('song_submitted', {
            submissionCount: game.submissions.length,
            totalPlayers: connectedNonCzarPlayers.length
          });
        }
      }
    }
  });

  // Cast vote
  socket.on('cast_vote', ({ gameId, submissionId, points, isDownvote }) => {
    const game = games.get(gameId);
    if (game && game.gameState === GAME_STATES.VOTING) {
      // Check if player already voted
      const alreadyVoted = game.votes.find(v => v.voterId === socket.id);
      if (!alreadyVoted) {
        // Validate maxJuryPoints for positive votes
        if (!isDownvote && points > game.settings.maxJuryPoints) {
          socket.emit('error', { message: `Points cannot exceed ${game.settings.maxJuryPoints}` });
          return;
        }
        
        // Validate that player is connected
        const voter = game.players.find(p => p.id === socket.id);
        if (!voter || !voter.connected) {
          socket.emit('error', { message: 'You must be connected to vote' });
          return;
        }
        
        game.votes.push({
          voterId: socket.id,
          submissionId,
          points: isDownvote ? -game.settings.downvoteCost : points,
          isDownvote
        });
        games.set(gameId, game);

        // Check if all connected players have voted
        const connectedPlayers = game.players.filter(p => p.connected);
        if (game.votes.length === connectedPlayers.length) {
          calculateResults(game);
        } else {
          io.to(gameId).emit('vote_cast', {
            voteCount: game.votes.length,
            totalPlayers: connectedPlayers.length
          });
        }
      }
    }
  });

  // Card Czar selects winner
  socket.on('czar_select_winner', ({ gameId, submissionId }) => {
    const game = games.get(gameId);
    if (game && game.cardCzar.id === socket.id && game.gameState === GAME_STATES.VOTING) {
      game.czarSelection = submissionId;
      calculateResults(game);
    }
  });

  // Skip being Card Czar
  socket.on('skip_czar', ({ gameId }) => {
    const game = games.get(gameId);
    if (game && game.cardCzar.id === socket.id) {
      const player = game.players.find(p => p.id === socket.id);
      player.skippedCzarCount = game.players.length; // Can't be czar until everyone else goes
      selectCardCzar(game);
      games.set(gameId, game);

      // Broadcast without revealing new czar identity
      io.to(gameId).emit('czar_skipped', {
        newCzarSelected: true
      });
      
      // Private message to the new card czar
      io.to(game.cardCzar.id).emit('you_are_czar', {
        gameState: game.gameState,
        currentRound: game.currentRound
      });
    }
  });

  // Next round
  socket.on('next_round', ({ gameId }) => {
    const game = games.get(gameId);
    if (game && game.host === socket.id) {
      game.currentRound++;
      game.gameState = GAME_STATES.TOPIC_SELECTION;
      game.topic = null;
      game.submissions = [];
      game.votes = [];
      game.czarSelection = null;
      selectCardCzar(game);
      games.set(gameId, game);

      // Broadcast without revealing czar identity
      io.to(gameId).emit('next_round', {
        currentRound: game.currentRound,
        gameState: game.gameState
      });
      
      // Private message to the new card czar
      io.to(game.cardCzar.id).emit('you_are_czar', {
        currentRound: game.currentRound,
        gameState: game.gameState
      });
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    // Find all games this player is in and mark as disconnected
    games.forEach((game, gameId) => {
      const player = game.players.find(p => p.id === socket.id);
      if (player) {
        player.connected = false;
        console.log('Player marked as disconnected:', { username: player.username, gameId });
        
        // If the disconnected player was the card czar, select a new one
        if (game.cardCzar && game.cardCzar.id === socket.id) {
          selectCardCzar(game);
          console.log('New card czar selected after disconnect:', game.cardCzar.username);
          
          // Notify players that czar changed
          io.to(gameId).emit('czar_changed', {
            gameState: game.gameState,
            currentRound: game.currentRound
          });
          
          // Private message to new czar
          io.to(game.cardCzar.id).emit('you_are_czar', {
            gameState: game.gameState,
            currentRound: game.currentRound
          });
        }
        
        games.set(gameId, game);

        // Notify other players of the disconnect
        io.to(gameId).emit('player_disconnected', {
          username: player.username,
          players: game.players
        });
      }
    });
  });
});

// Helper functions
function selectCardCzar(game) {
  // Filter out disconnected players and those who have skipped
  const eligiblePlayers = game.players.filter(p => p.connected && p.skippedCzarCount === 0);
  
  if (eligiblePlayers.length === 0) {
    // Reset skip counts if everyone has skipped or is disconnected
    game.players.forEach(p => {
      if (p.connected) p.skippedCzarCount = 0;
    });
    const connectedPlayers = game.players.filter(p => p.connected);
    if (connectedPlayers.length > 0) {
      game.cardCzar = connectedPlayers[Math.floor(Math.random() * connectedPlayers.length)];
    } else {
      game.cardCzar = null; // No connected players available
    }
  } else {
    game.cardCzar = eligiblePlayers[Math.floor(Math.random() * eligiblePlayers.length)];
  }
  
  // Ensure the selected card czar is still connected
  if (game.cardCzar) {
    const currentCzar = game.players.find(p => p.id === game.cardCzar.id);
    if (!currentCzar || !currentCzar.connected) {
      // If somehow a disconnected player was selected, pick another
      const connectedPlayers = game.players.filter(p => p.connected);
      if (connectedPlayers.length > 0) {
        game.cardCzar = connectedPlayers[Math.floor(Math.random() * connectedPlayers.length)];
      } else {
        game.cardCzar = null;
      }
    }
  }
}

function calculateResults(game) {
  game.gameState = GAME_STATES.REVEAL;
  
  // Calculate total votes for each submission
  const submissionScores = {};
  game.submissions.forEach(sub => {
    submissionScores[sub.id] = {
      totalPoints: 0,
      voteCount: 0,
      submission: sub
    };
  });

  game.votes.forEach(vote => {
    if (submissionScores[vote.submissionId]) {
      submissionScores[vote.submissionId].totalPoints += vote.points;
      submissionScores[vote.submissionId].voteCount++;
    }
  });

  // Determine winner
  let winner = null;
  let maxScore = -Infinity;

  // Check for public vote override (guard against division by zero)
  const totalVotes = game.votes.length;
  let publicVoteWinner = null;
  
  if (totalVotes > 0) {
    publicVoteWinner = Object.values(submissionScores).find(s => 
      s.voteCount / totalVotes >= game.settings.overrideThreshold
    );
  }

  if (publicVoteWinner) {
    winner = publicVoteWinner.submission;
    winner.wonBy = 'public_override';
  } else if (game.czarSelection) {
    winner = game.submissions.find(s => s.id === game.czarSelection);
    if (winner) {
      winner.wonBy = 'czar_selection';
    }
  } else {
    // Fallback to highest score
    Object.values(submissionScores).forEach(s => {
      if (s.totalPoints > maxScore) {
        maxScore = s.totalPoints;
        winner = s.submission;
        winner.wonBy = 'popular_vote';
      }
    });
  }

  // Award points
  if (winner) {
    const winnerPlayer = game.players.find(p => p.id === winner.playerId);
    if (winnerPlayer) {
      winnerPlayer.score += game.settings.czarPoints;
    }
  }

  // Award jury points and deduct downvote costs
  game.votes.forEach(vote => {
    const voter = game.players.find(p => p.id === vote.voterId);
    if (voter) {
      if (vote.isDownvote) {
        // Deduct downvote cost from voter
        voter.score -= game.settings.downvoteCost;
      } else if (winner && vote.submissionId === winner.id) {
        // Award jury points for correct votes
        voter.score += vote.points;
      }
    }
  });

  // Decrease skip counts
  game.players.forEach(p => {
    if (p.skippedCzarCount > 0) p.skippedCzarCount--;
  });

  // Find topic creator for reveal
  const topicCreator = game.topic ? game.players.find(p => p.id === game.topic.creatorId) : null;

  games.set(game.id, game);

  io.to(game.id).emit('round_results', {
    gameState: game.gameState,
    topic: game.topic,
    cardCzar: game.cardCzar,
    topicCreator: topicCreator,
    submissions: game.submissions,
    votes: game.votes,
    winner: winner,
    scores: game.players.map(p => ({
      id: p.id,
      username: p.username,
      score: p.score
    }))
  });
}

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
