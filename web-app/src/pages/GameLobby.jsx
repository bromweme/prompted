import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useSocket } from '../context/SocketContext'
import './GameLobby.css'

function GameLobby() {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const { socket, isConnected } = useSocket()
  const [players, setPlayers] = useState([])
  const [gameState, setGameState] = useState('lobby')
  const [isHost, setIsHost] = useState(false)

  useEffect(() => {
    if (!socket || !isConnected) return

    socket.on('player_joined', ({ players: newPlayers, gameState: newGameState }) => {
      console.log('Player joined event:', { players: newPlayers, gameState: newGameState, socketId: socket.id })
      setPlayers(newPlayers)
      setGameState(newGameState)
      
      // Check if current user is host
      const currentUserId = socket.id
      const hostCheck = newPlayers[0]?.id === currentUserId
      console.log('Host check:', { currentUserId, firstPlayerId: newPlayers[0]?.id, isHost: hostCheck })
      setIsHost(hostCheck)
    })

    socket.on('game_started', ({ gameState: newGameState, cardCzar, currentRound }) => {
      console.log('Game started event')
      setGameState(newGameState)
      navigate(`/game/${gameId}`)
    })

    return () => {
      socket.off('player_joined')
      socket.off('game_started')
    }
  }, [socket, isConnected, gameId, navigate])

  const handleStartGame = () => {
    console.log('Start game clicked:', { isHost, playerCount: players.length, socket })
    if (isHost && players.length >= 2) {
      socket.emit('start_game', { gameId })
    } else if (players.length < 2) {
      alert('Need at least 2 players to start!')
    } else {
      alert('You are not the host!')
    }
  }

  const copyGameCode = () => {
    navigator.clipboard.writeText(gameId)
    alert('Game code copied to clipboard!')
  }

  return (
    <div className="game-lobby">
      <header className="lobby-header">
        <h1>Game Lobby</h1>
        <div className="game-code-display">
          <span className="code-label">Game Code:</span>
          <span className="code-value">{gameId}</span>
          <button className="copy-btn" onClick={copyGameCode} aria-label="Copy game code">📋</button>
        </div>
      </header>

      <main className="lobby-main">
        <div className="lobby-content">
          <section className="players-section">
            <h2>Players ({players.length})</h2>
            <div className="players-list">
              {players.map((player, index) => (
                <div key={player.id} className="player-item">
                  <span className="player-name">{player.username}</span>
                  {index === 0 && <span className="host-badge">Host</span>}
                </div>
              ))}
            </div>
          </section>

          <aside className="info-sidebar">
            <h3>Game Info</h3>
            <div className="player-count">
              <div className="number">{players.length}</div>
              <div className="label">Players Ready</div>
            </div>
            
            <div className="game-rules">
              <h4>How to Play</h4>
              <ul>
                <li>Card Czar selects a music topic</li>
                <li>Players submit songs that fit the topic</li>
                <li>Everyone votes on the best submissions</li>
                <li>Card Czar picks the winner</li>
                <li>Earn points and climb the leaderboard!</li>
              </ul>
            </div>
          </aside>
        </div>
      </main>

      <footer className="lobby-footer">
        {isHost ? (
          <button 
            className="start-btn"
            onClick={handleStartGame}
            disabled={players.length < 2}
            aria-label="Start game"
          >
            Start Game {players.length < 2 && '(Need 2+ players)'}
          </button>
        ) : (
          <div className="waiting-message">
            <p>Waiting for host to start the game...</p>
            <div className="loading-spinner" aria-hidden="true"></div>
          </div>
        )}
      </footer>
    </div>
  )
}

export default GameLobby
