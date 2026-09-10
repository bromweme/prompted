# EVT-1 — Server-side game event logging (first-party analytics)

- **Status:** Ready. No blocker; the event list and prop schema below are a starting point to refine during implementation.
- **Priority:** medium
- **Guarantee:** The server records the key lifecycle and feature-use events of a game into an append-only local table, so questions like "do groups finish?", "where do people drop off?", and "is feature X used?" can be answered from data instead of guesswork.

## Why

Product decisions in this backlog (enforce `maxPlayers`/`totalRounds`? wire or cut the inert settings? is the vote budget used?) currently have no usage data behind them. First-party server-side logging is the lowest-cost, most privacy-respecting way to get it: no third-party script, no cookies, no consent banner (disclosure in the privacy policy is enough — see `PRIV-1`), and not defeated by ad-blockers. The meaningful events here are server events (round transitions, votes, skips), which a client analytics tool would struggle to capture anyway.

## Current state

- `server/db.js` is a key→JSON-blob KV store (`PersistentStore`), one row per entity. It is not shaped for append-only event rows.
- `better-sqlite3`, WAL mode already on (`prompted.db-wal` present).
- Natural instrumentation points already exist as socket handlers in `server/server.js`: `create_group`, `join_group`, `leave_group`, `start_group`/`beginRound`, `select_topic`, topic submit, video submit, `cast_vote`, `czar_select_winner`, the `advanceIfExpired` transitions (submission→voting→reveal, re-arm), Judge skip (RT-3), host election (HG-1), settings update.

## Proposed design

- New append-only table (extend `db.js` or a small sibling module), e.g.
  `events (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, name TEXT NOT NULL, group_id TEXT, actor_id TEXT, props TEXT)`
  with indexes on `(name, ts)` and `(group_id)`. `props` is a JSON string.
- One helper: `logEvent(name, { groupId, actorId, ...props })`. Fire-and-forget, wrapped so a logging failure never breaks a game action.
- Starter event set:
  - Funnel: `group_created`, `invite_opened` (from the `/join` path), `member_joined`, `round_started`, `topic_selected`, `submission_made`, `round_completed`, `game_completed` (reached `totalRounds` or group ended).
  - Feature use: `vote_cast` (props: `points`, `isDownvote`), `judge_skipped`, `host_election_started`/`_resolved`, `settings_changed` (props: which keys changed, not full values), `round_rearmed`, `round_expired`.
- `actor_id` is the app's existing stable user id (Google `sub`). Decide during implementation whether to store it raw or hashed — coordinate with `PRIV-1`. **No free text or PII in `props`**: no video titles, group names, topic text, or comments.
- Retention: pick a window (e.g. 12 months) and prune opportunistically (the codebase's evaluate-on-read, no-scheduler pattern) or via a `scripts/` prune script. Document the choice.
- Reading the data (an admin query script or endpoint) is **out of scope for this issue** — this issue only captures the data. A follow-up can add a read path.

## Affected surface

| Area | Change |
|---|---|
| `server/db.js` (or new `server/events.js`) | The `events` table + `logEvent` helper. |
| `server/server.js` | `logEvent(...)` calls at the handlers above. No behaviour change to any handler. |
| e2e / unit | A check that completing a round writes the expected rows; that a logging error is swallowed. |
| `PRIV-1` | Disclose this collection in the privacy policy (first-party, no third party, no cookie). |

## Done when

- The `events` table exists and `logEvent` writes rows for at least the funnel event set above.
- Instrumentation is fire-and-forget: a forced `logEvent` failure does not affect the game action.
- No PII / free text is written to `props` (reviewed against the list).
- Retention policy is documented and enforced (prune script or opportunistic prune).
- `cd web-app && npm run lint` and the server start-up are clean; full `cd web-app && npx playwright test` green.

## Depends on

None. Pairs with `PRIV-1` for disclosure.
