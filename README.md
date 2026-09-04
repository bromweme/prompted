# Prompted Game

A Cards Against Humanity-style music game where players submit songs based on prompts, with a Card Czar judging the submissions. Built for both web and mobile platforms.

## 🎮 Game Concept

Similar to MusicLeague but with custom "Card Czar" mechanics:
- **Card Czar**: Anonymous judge who selects the winning song
- **Jury**: All other players who submit songs and vote
- **Topics**: Can be public (shared) or private (created for specific games)
- **Scoring**: Host-configurable points for Czar picks and jury votes
- **Override**: Public vote can override Czar's choice if overwhelming majority
- **Skip System**: Players can skip being Card Czar
- **Downvotes**: Cost points (host-configured penalty)

## 🏗️ Architecture

### Backend (Node.js + Socket.io)
- Real-time multiplayer game logic
- WebSocket communication for live updates
- In-memory game state (production: PostgreSQL database)
- Configurable game settings

### Web App (React + Vite)
- Modern React interface
- Socket.io client for real-time updates
- Responsive design
- Game lobby and room management

### Mobile App (React Native + Expo)
- Cross-platform mobile support
- Native navigation
- Mobile-optimized UI
- Same game logic as web

## 🚀 Getting Started

### Prerequisites
- Node.js installed
- For mobile: Expo CLI and mobile dev environment

### Installation

1. **Backend Server**:
```bash
cd server
npm install
npm start
```

2. **Web App**:
```bash
cd web-app
npm install
npm run dev
```

3. **Mobile App**:
```bash
npm install
npm start
```

## 🎯 How to Play

1. **Create/Join Game**: Enter username and create new game or join with code
2. **Lobby**: Wait for players to join (minimum 2 players)
3. **Topic Selection**: Card Czar selects a music theme/topic
4. **Song Submission**: Players submit Spotify songs fitting the topic
5. **Voting**: All players vote on submissions (including Card Czar)
6. **Results**: Card Czar revealed, winner announced, points awarded
7. **Next Round**: New Card Czar selected, repeat!

## 🎴 Game Mechanics

### Card Czar System
- Randomly assigned each round
- Identity hidden until round end
- Can select winning song for bonus points
- Can skip being Czar (won't be Czar until everyone else goes)

### Scoring System
- **Czar Pick**: Host-configured points (default: 5)
- **Jury Vote**: Up to host-configured max points (default: 3)
- **Downvote**: Costs points (default: 1)
- **Override**: 70% public vote can override Czar's choice

### Topic System
- **Public Topics**: Available to all games
- **Private Topics**: Created for specific games
- **Preset Topics**: Built-in theme suggestions
- **Custom Topics**: Players can create their own

## 📁 Project Structure

```
├── server/                    # Backend server
│   ├── server.js             # Socket.io game server
│   └── package.json
├── web-app/                   # React web application
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.jsx      # Landing & game creation
│   │   │   ├── GameLobby.jsx # Game lobby
│   │   │   └── GameRoom.jsx  # Main game interface
│   │   └── App.jsx
│   └── package.json
├── src/                       # React Native mobile app
│   ├── screens/
│   │   ├── HomeScreen.jsx
│   │   ├── GameLobbyScreen.jsx
│   │   └── GameRoomScreen.jsx
│   ├── context/
│   │   └── AuthContext.jsx
│   └── App.js
├── GAME_DESIGN.md            # Detailed game design document
└── README.md
```

## 🔧 Configuration

### Game Settings (in server.js)
```javascript
settings: {
  czarPoints: 5,           // Points for Czar's pick
  maxJuryPoints: 3,        // Max points per jury vote
  downvoteCost: 1,         // Point cost for downvotes
  overrideThreshold: 0.7   // Vote % needed to override Czar
}
```

### Socket.io Server
- Default port: 5000
- CORS enabled for development

## 🎵 Future Enhancements

### Spotify Integration
- Real Spotify OAuth authentication
- Direct song search from Spotify API
- Auto-generated playlists
- Album art display

### Database Integration
- PostgreSQL for persistent game state
- User accounts and profiles
- Game history and statistics
- Topic library management

### Additional Features
- Voice chat during rounds
- Song preview playback
- Custom game themes
- Tournament mode
- Leaderboards

## 🐛 Development Notes

### Current Limitations
- In-memory game state (resets on server restart)
- No persistent user accounts
- Manual Spotify URI entry
- No real Spotify API integration

### Testing
- Web app: http://localhost:5173
- Mobile: Run with Expo Go app
- Backend: http://localhost:5000

### Socket Events
- `join_game` - Join a game lobby
- `start_game` - Start the game
- `select_topic` - Card Czar selects topic
- `submit_song` - Submit a song
- `cast_vote` - Vote on submissions
- `czar_select_winner` - Card Czar picks winner
- `skip_czar` - Skip being Card Czar
- `next_round` - Start next round

## 📄 License

MIT License - feel free to use and modify for your own projects!

## 🤝 Contributing

This is a demonstration project. For production use, consider:
- Adding proper authentication
- Implementing database persistence
- Adding error handling and validation
- Implementing proper Spotify API integration
- Adding comprehensive testing

## 🎮 Game Inspiration

Inspired by [MusicLeague](https://musicleague.com) with custom "Card Czar" mechanics similar to Cards Against Humanity, creating a unique music discovery and competition experience.
