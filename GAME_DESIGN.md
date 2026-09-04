# Prompted Game - Design Document

## Game Overview
A Cards Against Humanity-style music game where players submit songs based on prompts, with a Card Czar judging the submissions.

## Core Mechanics

### Roles
- **Card Czar**: The judge for the current round, anonymously selects the winning song
- **Jury**: All other players who submit songs and vote

### Game Flow
1. **Lobby Creation**: Host creates game room, sets rules
2. **Topic Selection**: Card Czar selects or creates a prompt (private/public)
3. **Song Submission**: Players submit Spotify songs fitting the prompt
4. **Voting Phase**: All players (including Card Czar) vote on submissions
5. **Reveal Phase**: Card Czar and prompt creator revealed, results shown
6. **Scoring**: Points awarded based on game rules

### Key Features
- **Anonymous Card Czar**: Czar identity hidden until round end
- **Public/Private Topics**: Topics can be shared or kept private
- **Flexible Scoring**: Host determines point values
- **Override Mechanism**: Overwhelming public vote can override Czar's pick
- **Skip System**: Players can skip being Card Czar
- **Downvote Penalty**: Downvotes cost points (host-configured)

## Technical Architecture

### Database Schema

#### Users
- id, username, email, spotify_id, created_at, total_points

#### Games
- id, host_id, name, code, status, current_round, max_players
- settings: { czar_points, max_jury_points, downvote_cost, override_threshold }

#### Players
- id, game_id, user_id, is_host, total_score, skipped_czar_count

#### Topics
- id, creator_id, game_id, text, is_public, is_active

#### Rounds
- id, game_id, topic_id, card_czar_id, status, started_at, ended_at

#### Submissions
- id, round_id, player_id, spotify_uri, song_title, artist

#### Votes
- id, round_id, voter_id, submission_id, points, is_downvote

### Tech Stack
- **Backend**: Node.js + Express + Socket.io (real-time)
- **Database**: PostgreSQL
- **Web**: React + React Router
- **Mobile**: React Native + Expo
- **Music**: Spotify Web API

### Real-time Events
- player_join, player_leave, game_start, round_start
- song_submit, vote_cast, round_end, game_end
- czar_reveal, results_show

## Game States
1. LOBBY - Waiting for players
2. TOPIC_SELECTION - Card Czar selects topic
3. SUBMISSION - Players submit songs
4. VOTING - Players vote on submissions
5. REVEAL - Results shown, Czar revealed
6. ROUND_END - Between rounds
7. GAME_END - Final results

## UI Components Needed

### Web App
- Login/Register with Spotify
- Game Lobby browser
- Game Room interface
- Topic selection/prompt creation
- Song submission interface
- Voting interface
- Results display
- Scoreboard

### Mobile App
- Same core features with mobile-optimized UI
- Push notifications for game events
- Spotify mobile integration

## Development Phases
1. Backend API and database setup
2. Core game logic implementation
3. Web app UI development
4. React Native app integration
5. Real-time features
6. Testing and polish
