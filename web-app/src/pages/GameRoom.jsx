import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useSocket } from '../context/SocketContext'
import './GameRoom.css'

const GAME_STATES = {
  LOBBY: 'lobby',
  TOPIC_SELECTION: 'topic_selection',
  SUBMISSION: 'submission',
  VOTING: 'voting',
  REVEAL: 'reveal',
  ROUND_END: 'round_end',
  GAME_END: 'game_end'
}

function GameRoom() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const { socket, isConnected } = useSocket()
  
  const [gameState, setGameState] = useState(GAME_STATES.LOBBY)
  const [currentRound, setCurrentRound] = useState(1)
  const [cardCzarId, setCardCzarId] = useState(null)
  const [cardCzar, setCardCzar] = useState(null)
  const [topicCreator, setTopicCreator] = useState(null)
  const [topic, setTopic] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [votes, setVotes] = useState([])
  const [scores, setScores] = useState([])
  const [winner, setWinner] = useState(null)
  const [isCardCzar, setIsCardCzar] = useState(false)
  
  // Topic bank states
  const [privateTopics, setPrivateTopics] = useState([])
  const [publicTopics, setPublicTopics] = useState([])
  
  // Form states
  const [customTopic, setCustomTopic] = useState('')
  const [selectedTopic, setSelectedTopic] = useState('')
  const [selectedTopicId, setSelectedTopicId] = useState(null)
  const [isPublicTopic, setIsPublicTopic] = useState(false)
  const [spotifyUri, setSpotifyUri] = useState('')
  const [songTitle, setSongTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [selectedSubmission, setSelectedSubmission] = useState(null)
  const [votePoints, setVotePoints] = useState(3)
  
  // Spotify connection states
  const [spotifyConnected, setSpotifyConnected] = useState(false)
  const [showSpotifyConnect, setShowSpotifyConnect] = useState(false)

  const presetTopics = [
    "Songs that describe your mood today",
    "Best workout songs",
    "Songs that make you cry",
    "Guilty pleasures",
    "Perfect road trip songs",
    "Songs from your childhood",
    "Breakup anthems",
    "Feel-good songs",
    "Songs with great bass lines",
    "Perfect summer vibes"
  ]

  useEffect(() => {
    if (!socket || !isConnected) return

    socket.on('game_started', ({ gameState: newGameState, currentRound: newRound }) => {
      console.log('Game started in GameRoom')
      setGameState(newGameState)
      setCurrentRound(newRound)
      // Load topics when game starts
      socket.emit('get_topics', { gameId })
    })

    socket.on('you_are_czar', ({ gameState: newGameState, currentRound: newRound }) => {
      console.log('You are the card czar')
      setIsCardCzar(true)
      if (newGameState) setGameState(newGameState)
      if (newRound) setCurrentRound(newRound)
      // Load topics when becoming czar
      socket.emit('get_topics', { gameId })
    })

    socket.on('topic_selected', ({ topic: newTopic, gameState: newGameState }) => {
      setTopic(newTopic)
      setGameState(newGameState)
    })

    socket.on('song_submitted', ({ submissionCount, totalPlayers }) => {
      // Could show progress
    })

    socket.on('voting_started', ({ submissions: newSubmissions, gameState: newGameState }) => {
      setSubmissions(newSubmissions)
      setGameState(newGameState)
    })

    socket.on('vote_cast', ({ voteCount, totalPlayers }) => {
      // Could show progress
    })

    socket.on('round_results', ({ 
      gameState: newGameState, 
      topic: roundTopic, 
      cardCzar: roundCardCzar, 
      topicCreator: roundTopicCreator,
      submissions: roundSubmissions, 
      votes: roundVotes, 
      winner: roundWinner,
      scores: roundScores 
    }) => {
      setGameState(newGameState)
      setTopic(roundTopic)
      setSubmissions(roundSubmissions)
      setVotes(roundVotes)
      setWinner(roundWinner)
      setScores(roundScores)
      setCardCzar(roundCardCzar)
      setTopicCreator(roundTopicCreator)
      setCardCzarId(roundCardCzar?.id)
      setIsCardCzar(false) // Reset czar status for next round
    })

    socket.on('next_round', ({ currentRound: newRound, gameState: newGameState }) => {
      setCurrentRound(newRound)
      setIsCardCzar(false) // Reset until we get you_are_czar message
      setGameState(newGameState)
      setTopic(null)
      setSubmissions([])
      setVotes([])
      setWinner(null)
    })

    socket.on('czar_skipped', ({ newCzarSelected }) => {
      // Czar was skipped, new czar will get private message
      setIsCardCzar(false)
    })

    socket.on('czar_changed', ({ gameState: newGameState, currentRound: newRound }) => {
      // Czar changed due to disconnect
      setIsCardCzar(false)
      if (newGameState) setGameState(newGameState)
      if (newRound) setCurrentRound(newRound)
    })

    socket.on('player_disconnected', ({ username, players: newPlayers }) => {
      console.log('Player disconnected:', username)
      // Update players list if needed
    })

    socket.on('topics_list', ({ privateTopics: newPrivateTopics, publicTopics: newPublicTopics }) => {
      setPrivateTopics(newPrivateTopics)
      setPublicTopics(newPublicTopics)
    })

    socket.on('topic_submitted', ({ topic }) => {
      // Refresh topics list after submission
      socket.emit('get_topics', { gameId })
    })

    socket.on('topic_deleted', ({ topicId }) => {
      // Refresh topics list after deletion
      socket.emit('get_topics', { gameId })
    })

    socket.on('error', ({ message }) => {
      alert(message)
    })

    return () => {
      socket.off('game_started')
      socket.off('you_are_czar')
      socket.off('topic_selected')
      socket.off('song_submitted')
      socket.off('voting_started')
      socket.off('vote_cast')
      socket.off('round_results')
      socket.off('next_round')
      socket.off('czar_skipped')
      socket.off('czar_changed')
      socket.off('player_disconnected')
      socket.off('topics_list')
      socket.off('topic_submitted')
      socket.off('topic_deleted')
      socket.off('error')
    }
  }, [socket, isConnected, gameId])

  const handleSelectTopic = (isPublic = true) => {
    const topicText = isPublic ? selectedTopic : customTopic
    if (topicText.trim()) {
      socket.emit('select_topic', { 
        gameId, 
        topic: topicText, 
        isPublic, 
        topicId: selectedTopicId 
      })
    }
  }

  const handleSelectBankTopic = (topic) => {
    setSelectedTopic(topic.text)
    setSelectedTopicId(topic.id)
  }

  const handleSubmitNewTopic = () => {
    if (customTopic.trim()) {
      socket.emit('submit_topic', { 
        gameId, 
        text: customTopic, 
        isPublic: isPublicTopic 
      })
      setCustomTopic('')
      setIsPublicTopic(false)
    }
  }

  const handleSubmitSong = () => {
    if (spotifyUri.trim() && songTitle.trim() && artist.trim()) {
      socket.emit('submit_song', { gameId, spotifyUri, songTitle, artist })
      setSpotifyUri('')
      setSongTitle('')
      setArtist('')
    }
  }

  const handleCastVote = (isDownvote = false) => {
    if (selectedSubmission) {
      socket.emit('cast_vote', { 
        gameId, 
        submissionId: selectedSubmission, 
        points: isDownvote ? 0 : votePoints,
        isDownvote 
      })
      setSelectedSubmission(null)
    }
  }

  const handleCzarSelectWinner = () => {
    if (selectedSubmission) {
      socket.emit('czar_select_winner', { gameId, submissionId: selectedSubmission })
    }
  }

  const handleSkipCzar = () => {
    socket.emit('skip_czar', { gameId })
  }

  const handleNextRound = () => {
    socket.emit('next_round', { gameId })
  }

  // Spotify connection simulation
  const handleSpotifyConnect = () => {
    // Simulate Spotify OAuth flow
    setSpotifyConnected(true)
    setShowSpotifyConnect(false)
  }

  const handleSpotifyDisconnect = () => {
    setSpotifyConnected(false)
  }

  const renderContent = () => {
    switch (gameState) {
      case GAME_STATES.TOPIC_SELECTION:
        return renderTopicSelection()
      case GAME_STATES.SUBMISSION:
        return renderSubmission()
      case GAME_STATES.VOTING:
        return renderVoting()
      case GAME_STATES.REVEAL:
        return renderResults()
      default:
        return <div>Loading...</div>
    }
  }

  const renderTopicSelection = () => (
    <div className="game-phase">
      <div className="phase-header">
        <h2>Round {currentRound} - Topic Selection</h2>
        {isCardCzar ? (
          <p className="role-badge">You are the Card Czar! 🎴</p>
        ) : (
          <p>Waiting for Card Czar to select a topic...</p>
        )}
      </div>

      {isCardCzar && (
        <div className="topic-selection">
          <div className="topic-bank">
            <h3>Your Private Topics</h3>
            {privateTopics.length > 0 ? (
              <div className="topics-grid">
                {privateTopics.map((topic) => (
                  <button
                    key={topic.id}
                    className={`topic-btn ${selectedTopicId === topic.id ? 'selected' : ''}`}
                    onClick={() => handleSelectBankTopic(topic)}
                  >
                    {topic.text}
                  </button>
                ))}
              </div>
            ) : (
              <p className="no-topics">No private topics yet. Add one below!</p>
            )}
          </div>

          <div className="topic-bank">
            <h3>Public Topics</h3>
            {publicTopics.length > 0 ? (
              <div className="topics-grid">
                {publicTopics.map((topic) => (
                  <button
                    key={topic.id}
                    className={`topic-btn ${selectedTopicId === topic.id ? 'selected' : ''}`}
                    onClick={() => handleSelectBankTopic(topic)}
                  >
                    {topic.text}
                  </button>
                ))}
              </div>
            ) : (
              <p className="no-topics">No public topics available.</p>
            )}
          </div>

          <div className="custom-topic">
            <h3>Create New Topic</h3>
            <input
              type="text"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="Enter custom topic..."
              maxLength={100}
            />
            <div className="topic-type-toggle">
              <label>
                <input
                  type="checkbox"
                  checked={isPublicTopic}
                  onChange={(e) => setIsPublicTopic(e.target.checked)}
                />
                Make Public
              </label>
            </div>
          </div>

          <div className="topic-actions">
            <button 
              className="btn-primary"
              onClick={() => handleSelectTopic(true)}
              disabled={!selectedTopic}
            >
              Use Selected Topic
            </button>
            <button 
              className="btn-secondary"
              onClick={handleSubmitNewTopic}
              disabled={!customTopic.trim()}
            >
              Save Topic
            </button>
          </div>
        </div>
      )}
    </div>
  )

  const renderSubmission = () => (
    <div className="game-phase">
      <div className="phase-header">
        <h2>Round {currentRound} - Song Submission</h2>
        <div className="topic-display">
          <span className="topic-label">Topic:</span>
          <span className="topic-text">{topic?.text}</span>
        </div>
        {!isCardCzar && (
          <p>Submit a song that fits this topic from Spotify!</p>
        )}
      </div>

      {!isCardCzar ? (
        <div className="song-submission">
          <div className="spotify-connection">
            {spotifyConnected ? (
              <div className="spotify-connected">
                <div className="connection-status">
                  <span className="status-indicator connected"></span>
                  <span className="status-text">Connected to Spotify</span>
                </div>
                <button 
                  className="btn-secondary"
                  onClick={handleSpotifyDisconnect}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="spotify-disconnected">
                <p className="connect-message">Demo Mode: Click the button below to simulate Spotify login</p>
                <button 
                  className="btn-primary"
                  onClick={handleSpotifyConnect}
                >
                  Connect Spotify
                </button>
              </div>
            )}
          </div>

          <div className="input-group">
            <label>Spotify URI</label>
            <input
              type="text"
              value={spotifyUri}
              onChange={(e) => setSpotifyUri(e.target.value)}
              placeholder="spotify:track:..."
              disabled={!spotifyConnected}
            />
          </div>
          <div className="input-group">
            <label>Song Title</label>
            <input
              type="text"
              value={songTitle}
              onChange={(e) => setSongTitle(e.target.value)}
              placeholder="Enter song title"
              disabled={!spotifyConnected}
            />
          </div>
          <div className="input-group">
            <label>Artist</label>
            <input
              type="text"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="Enter artist name"
              disabled={!spotifyConnected}
            />
          </div>
          <button 
            className="btn-primary"
            onClick={handleSubmitSong}
            disabled={!spotifyConnected || !spotifyUri.trim() || !songTitle.trim() || !artist.trim()}
          >
            Submit Song
          </button>
        </div>
      ) : (
        <div className="waiting-message">
          <p>You're the Card Czar - wait for submissions!</p>
          <div className="loading-spinner"></div>
        </div>
      )}
    </div>
  )

  const renderVoting = () => (
    <div className="game-phase">
      <div className="phase-header">
        <h2>Round {currentRound} - Voting</h2>
        <div className="topic-display">
          <span className="topic-label">Topic:</span>
          <span className="topic-text">{topic?.text}</span>
        </div>
        <p>Vote for the best submission!</p>
      </div>

      <div className="voting-section">
        <div className="submissions-list">
          {submissions.map((submission) => (
            <div
              key={submission.id}
              className={`submission-card ${selectedSubmission === submission.id ? 'selected' : ''}`}
              onClick={() => setSelectedSubmission(submission.id)}
            >
              <div className="song-info">
                <h4>{submission.songTitle}</h4>
                <p>{submission.artist}</p>
              </div>
            </div>
          ))}
        </div>

        {selectedSubmission && (
          <div className="voting-actions">
            <div className="point-selector">
              <label>Points:</label>
              <select value={votePoints} onChange={(e) => setVotePoints(parseInt(e.target.value))}>
                <option value={1}>1 Point</option>
                <option value={2}>2 Points</option>
                <option value={3}>3 Points</option>
              </select>
            </div>
            <button className="btn-primary" onClick={() => handleCastVote(false)}>
              Cast Vote
            </button>
            <button className="btn-danger" onClick={() => handleCastVote(true)}>
              Downvote
            </button>
          </div>
        )}

        {isCardCzar && selectedSubmission && (
          <div className="czar-actions">
            <button className="btn-czar" onClick={handleCzarSelectWinner}>
              🎴 Select as Winner (Card Czar Choice)
            </button>
            <button className="btn-secondary" onClick={handleSkipCzar}>
              Skip Being Czar
            </button>
          </div>
        )}
      </div>
    </div>
  )

  const renderResults = () => (
    <div className="game-phase">
      <div className="phase-header">
        <h2>Round {currentRound} - Results</h2>
        <div className="topic-display">
          <span className="topic-label">Topic:</span>
          <span className="topic-text">{topic?.text}</span>
        </div>
      </div>

      <div className="results-section">
        <div className="winner-announcement">
          <h3>🏆 Winner</h3>
          {winner && (
            <div className="winner-card">
              <h4>{winner.songTitle}</h4>
              <p>{winner.artist}</p>
              <span className="win-method">{winner.wonBy === 'public_override' ? '🎉 Public Override!' : winner.wonBy === 'czar_selection' ? '🎴 Card Czar Choice' : '👍 Popular Vote'}</span>
            </div>
          )}
        </div>

        <div className="roles-reveal">
          <h3>Round Roles</h3>
          <div className="role-info">
            <span className="role-label">🎴 Card Czar:</span>
            <span className="role-value">{cardCzar?.username || 'Unknown'}</span>
          </div>
          {topicCreator && (
            <div className="role-info">
              <span className="role-label">✍️ Topic Creator:</span>
              <span className="role-value">{topicCreator.username}</span>
            </div>
          )}
        </div>

        <div className="all-submissions">
          <h3>All Submissions</h3>
          {submissions.map((submission) => (
            <div key={submission.id} className="result-submission">
              <h4>{submission.songTitle}</h4>
              <p>{submission.artist}</p>
              {winner?.id === submission.id && <span className="winner-badge">🏆 Winner</span>}
            </div>
          ))}
        </div>

        <div className="scoreboard">
          <h3>Current Scores</h3>
          {scores.map((player) => (
            <div key={player.id} className="score-item">
              <span>{player.username}</span>
              <span className="score">{player.score} pts</span>
            </div>
          ))}
        </div>

        <button className="btn-primary" onClick={handleNextRound}>
          Next Round
        </button>
      </div>
    </div>
  )

  return (
    <div className="game-room">
      <div className="game-container">
        <div className="game-header">
          <h1>🎵 Prompted</h1>
          <div className="game-info">
            <span>Round {currentRound}</span>
            <span>Game: {gameId}</span>
          </div>
        </div>

        {renderContent()}
      </div>
    </div>
  )
}

export default GameRoom
