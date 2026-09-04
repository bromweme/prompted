import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSocket } from '../context/SocketContext'
import './Home.css'

function Home() {
  const [username, setUsername] = useState('')
  const [gameId, setGameId] = useState('')
  const { socket, isConnected } = useSocket()
  const navigate = useNavigate()

  const handleCreateGame = () => {
    if (!username.trim()) {
      alert('Please enter a username')
      return
    }
    
    if (!socket || !isConnected) {
      alert('Not connected to server. Please wait...')
      return
    }
    
    // Generate random game code
    const newGameId = Math.random().toString(36).substring(2, 8).toUpperCase()
    setGameId(newGameId)
    
    console.log('Creating game:', { gameId: newGameId, username, socketId: socket.id })
    socket.emit('join_game', { gameId: newGameId, username })
    navigate(`/lobby/${newGameId}`)
  }

  const handleJoinGame = () => {
    if (!username.trim() || !gameId.trim()) {
      alert('Please enter both username and game code')
      return
    }
    
    if (!socket || !isConnected) {
      alert('Not connected to server. Please wait...')
      return
    }
    
    console.log('Joining game:', { gameId: gameId.toUpperCase(), username, socketId: socket.id })
    socket.emit('join_game', { gameId: gameId.toUpperCase(), username })
    navigate(`/lobby/${gameId.toUpperCase()}`)
  }

  return (
    <div className="home">
      <div className="home-container">
        <div className="logo-section">
          <h1>🎵 Prompted</h1>
          <p>Cards Against Humanity meets music discovery</p>
        </div>

        <div className="auth-section">
          <div className="input-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              maxLength={20}
            />
          </div>

          <div className="button-group">
            <button className="btn-primary" onClick={handleCreateGame} disabled={!isConnected}>
              Create New Game {!isConnected && '(Connecting...)'}
            </button>
          </div>

          <div className="divider">
            <span>OR</span>
          </div>

          <div className="input-group">
            <label>Game Code</label>
            <input
              type="text"
              value={gameId}
              onChange={(e) => setGameId(e.target.value.toUpperCase())}
              placeholder="Enter 6-letter code"
              maxLength={6}
            />
          </div>

          <div className="button-group">
            <button className="btn-secondary" onClick={handleJoinGame} disabled={!isConnected}>
              Join Game {!isConnected && '(Connecting...)'}
            </button>
          </div>
        </div>

        <div className="how-to-play">
          <h3>How to Play</h3>
          <ol>
            <li>Join or create a game room</li>
            <li>Card Czar picks a music theme/topic</li>
            <li>Players submit songs that fit the theme</li>
            <li>Everyone votes on the best submissions</li>
            <li>Card Czar picks the winner (unless public vote overrides)</li>
            <li>Earn points and become the music champion!</li>
          </ol>
        </div>
      </div>
    </div>
  )
}

export default Home
