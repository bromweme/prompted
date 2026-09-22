# Prompted — Game Design

How the game actually works, as built. Last checked against the code on 2026-09-22.

This file describes the shipped app. Planned-but-unbuilt ideas belong in `implementation-queue.md` (the "Out of scope for now" notes), not here. Per-feature specs live in `implementation/issues/`.

## The game in one paragraph

A group of friends plays a music game over days, not minutes. Each round one player is the **Judge**. The Judge picks a topic — a prompt like "a song for a road trip" — and everyone else answers it with a YouTube video. Submissions are anonymous. When the submission window closes, everyone votes, then the Judge picks a winner and the round is revealed. A game is a fixed number of rounds; after the last one the group has final standings and can start again.

It is asynchronous by design. Rounds run on hour-scale deadlines rather than while everyone sits in a lobby, which is why notifications (`NT-1`) matter as much as the game rules.

## Words used here

| Word | Means |
|---|---|
| **Group** | A standing set of players. Has a host, settings, an invite code, and a history. |
| **Set** | One complete game: `totalRounds` rounds, then final standings. A group plays set after set. |
| **Round** | One topic, its submissions, its votes, its winner. |
| **Judge** | The player who picks the round's topic and its winner. Rotates. (The UI says Judge; older docs say Card Czar.) |
| **Topic / theme** | The prompt for a round. Both words appear in the code and UI — a rename to "prompt" is pending as `UI-6`. |
| **Submission** | One player's YouTube video answering the topic. |

## Round flow

A round moves through four phases, held in `group.currentTheme.status`:

1. **`topic_selection`** — the Judge picks a topic. No deadline yet; the deadline readouts show "Not set yet" (`RT-4`).
2. **`submission`** — everyone but the Judge submits one video. A deadline is set from the group's submission window (`RT-1`). The host can close submissions early.
3. **`voting`** — players spend a per-round vote budget across the submissions. Voting always runs to its deadline; there is no early reveal (`RT-1`, `RT-2`).
4. **`reveal`** — the winner, the Judge's identity and the topic's author become visible. Scores are applied and the round joins the group's history.

The group's own `status` is `setup` (before the first round of a set), `active` (a round is under way or between rounds), or `finished` (the set's last round has resolved).

**The Judge's identity is hidden until the reveal**, and not just in the UI: the server strips it from every payload, and the test suite listens to the raw WebSocket traffic to prove it never ships early.

## Rules the server enforces

- **Judge rotation** (`RT-3`): everyone judges before anyone judges twice. A Judge counts as having served when they *play* the role (pick a topic), not when they're assigned it, so a skip or a host hand-pick can't quietly re-draft them. A Judge may skip their turn.
- **Vote budget** (`RT-2`): each player gets `voteBudget` points per round (default 10) to spend across submissions. "Share the wealth" controls whether they must spread them. Upvotes must be whole numbers of at least 1 — fractional and zero-point votes were both routes to an unbounded vote count, and are refused (`REP-RT2-1`, `REP-RT2-2`).
- **Public override**: if one submission takes at least `overrideThreshold` percent of the votes (default 70), the crowd overrides the Judge's pick.
- **Downvotes**, when the host allows them, cost from the same budget and nothing else — they don't dock the target's lifetime score.
- **A set ends** (`GS-1`): when round `totalRounds` resolves, the group finishes with final standings kept in `completedSets`. Only the host starts a new set, and only from `finished`; that resets the round counter, the played topics and the Judge cycle.
- **A topic plays once per set** (`GT-1`). A new set frees them all.
- **Minimum two players** to start a round — a Judge and at least one person to answer.
- **Nobody joins mid-round** (`JR-1`), by invite code or by request. Between rounds and before the first one is fine; reconnecting members are unaffected.
- **An absent host can be replaced** (`HG-1`): after 30 days without being seen, the remaining members can elect a new one.

## Getting into a group

- **Invite code** (`UI-2`): a random 20-letter code, separate from the group id, shared as `/join/<code>`. The host can reset it. Wrong codes are throttled per user.
- **Open Groups** (`OG-1`): a group that isn't private and hasn't started is listed for any signed-in player, on the dashboard and on `/open-groups`. Listings carry no invite code and no player ids — being findable must not be a way in. Once a round starts, the group leaves the list.
- **Join requests** (`JR-1`): a non-member reads a view-only group page and asks; the host accepts or declines. Three declines and they can't ask that group again. The host can kick (they may return) or ban (every route refused until unbanned). Requests and bans are visible to the host alone.

## Host settings

Per group: name, description, private or open, `totalRounds` (default 6, clamped 1–50), `maxPlayers` (displayed, **not** enforced — an open note), the submission and voting window lengths, `voteBudget` (10) and "share the wealth", `allowDownvotes` and `downvoteCost`, `czarPoints` (5) and `maxJuryPoints` (3), `overrideThreshold` (70%), and `allowCustomTopics`.

With `allowCustomTopics` off (`GT-1`), the group plays from a list the host writes. The app won't start a round without one unused topic per remaining round, and won't let the host delete below that line mid-game.

## Notifications (`NT-1`)

Kept per player on the server, capped at 100, delivered to every tab that player has open through a per-user socket room, so they survive being offline. They cover the set and round lifecycle, your turn to judge, results, host changes, join requests and their answers, joins, kicks and bans. Each links to the thing it's about; a ban and a final decline deliberately link nowhere.

## Architecture as built

- **Backend**: Node.js, Express, Socket.io. Nearly all gameplay is socket events rather than REST.
- **Storage**: Postgres when `DATABASE_URL` is set, SQLite via `better-sqlite3` otherwise, behind one driver interface (`server/db.js`, `server/drivers/`). A small `PersistentStore` layer keeps every read in memory and writes through to whichever database is configured — stores for `groups`, `topics` and `notifications`, plus profiles, sessions and an append-only event log (`EVT-1`). Production must use Postgres: a hosted filesystem is ephemeral, so a local file is destroyed on every restart, redeploy and idle spin-down (`DB-1`).
- **Frontend**: React with React Router, built by Vite. Responsive web only; the mobile experience is the same app, tested against emulated mobile browsers. There is no native app.
- **Sign-in**: Google. Without credentials the server runs in a degraded local mode (fixture search, sign-in disabled) and says so.
- **Music**: the YouTube Data API for search; videos are embedded for playback. Tests use fixtures, never the live API.
- **Real-time**: `broadcastGroup` is the single choke point — it publicizes the group (stripping the Judge, host notices, requests and bans), pushes it to the group's room, refreshes open-group listings, and diffs the snapshot to raise notifications. Keeping it in one place is what stops two code paths announcing the same event twice.

## Not built

Named here only because earlier drafts of this document promised them: Spotify (the app uses YouTube), a React Native mobile app, in-game chat, song preview, and auto-start. The inert settings that remain in the UI are tracked as notes in `implementation-queue.md`.
