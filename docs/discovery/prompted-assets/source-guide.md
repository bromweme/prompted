# Source Guide

What each source in this project is worth reading for, and how far to trust it. Companion to [source-model.json](source-model.json), which records the same reconciliation in machine-readable form.

**The short version: do not onboard from `README.md` or `GAME_DESIGN.md`.** Read them as a record of original intent, then check every present-tense claim against the code. The `.env.example` files are accurate and are a better orientation to how the system actually works.

## Documents

### `GAME_DESIGN.md`

**Read it for:** the original mechanics — the Judge concept, public and private topics, the override rule, the downvote penalty, the phase order. The phase names it lists (`TOPIC_SELECTION`, `SUBMISSION`, `VOTING`, `REVEAL`) survive in the code almost exactly.

**Do not trust:** the tech stack (Spotify, PostgreSQL, React Native), the database schema (the code stores one JSON blob per group, not seven normalized tables), or the socket event names.

**Notable:** it describes a `GAME_END` state and a `skipped_czar_count` field. Neither exists. Whether either was dropped or never built is unresolved.

### `README.md`

**Read it for:** the scoring defaults, which are exactly right — five points for the winner, up to three per jury vote, one for a downvote, seventy percent to override. Also for the MusicLeague framing, which is the clearest one-line statement of what the product is.

**Do not trust:** anything about Spotify, PostgreSQL, persistence, accounts, the project structure, or the mobile app.

**Notable:** the document contradicts itself. Spotify appears as the current submission mechanism at line 69, and as an unbuilt future enhancement at lines 139-140, and as a current limitation at lines 162-163. It was already internally inconsistent before the implementation diverged from it.

### `server/.env.example`

**Accurate.** Describes Google sign-in, the YouTube Data API and its quota cost, session tokens and their lifetime, and the test-mode seam. Every variable matches `server/config.js`. The best short orientation to the operating model in the repository.

### `web-app/.env.example`

**Accurate.** Client configuration: the Google OAuth client id and the socket URL.

### `.gitignore`

**Accurate**, and quietly informative: a comment records a past secret-exposure fix for `server/.env`.

### `web-app/README.md`

**Nothing to read.** Unmodified Vite scaffold text with no project content.

## Code, by what question it answers

| Question | Read |
|---|---|
| What are the game's actual rules? | `server/server.js:198-238, 240-375` — the deadline seam, then the whole lifecycle |
| Who is allowed to do what, and how is that enforced? | `server/server.js:486-530`, then the individual handlers |
| What does a player see at each phase? | `server/server.js:286-330` (`publicizeTheme`) |
| How does a round not stall anymore? | `server/server.js:198-238` (`advanceIfExpired`) and `web-app/e2e/round-deadline.spec.js` |
| How does someone become a trusted identity? | `server/auth.js`, `server/session.js` |
| What happens when a credential is missing? | `server/config.js:39-63` |
| Where does data live? | `server/db.js`, `server/profiles.js` |
| How is YouTube quota kept under control? | `server/youtube.js:6-41` |
| What does the product look like to a player? | `web-app/src/pages/GroupView.jsx` |
| Which settings exist, and which are real? | `web-app/src/pages/CreateGroup.jsx:104-131`, compared against the nine keys the server reads |
| What behavior is actually guaranteed? | `web-app/e2e/round-phases.spec.js`, then `web-app/e2e/round-deadline.spec.js` |

## Where the reasoning is written down

Unusually for a project this size, several decisions are recorded in comments at the point they apply. These are the closest thing to design records the repository has, and they are worth more than either narrative document:

| Decision | Where |
|---|---|
| Only "Judge Selects" ships; three modes deferred with the mechanics each needs | `web-app/src/pages/CreateGroup.jsx:509-533` |
| Rounds gated on membership, never on presence | `server/server.js:1037-1047` |
| The submission deadline is enforced on interaction, not by a timer, with a 3-attempt re-arm | `docs/design/round-stall-change-design.md`, implemented at `server/server.js:198-238` |
| Public topics scoped to groupmates, not app-wide | `server/server.js` (`get_topics`, `topicsForGroup`) |
| Session tokens deliberately not JWT | `server/session.js:4-11` |
| Vote points bounded below as well as above, after a negative value could poison a score | `server/server.js:1251-1255` |
| The hover audit rewritten as a true cascade simulation after the naive version gave a false positive | `web-app/e2e/a11y-audit.js:156-163` |

## Excluded from review

- `web-app/test-results/` and `playwright-report/` — 1,661 generated Playwright trace artifacts
- `server/.env`, `web-app/.env` — confirmed present, deliberately never opened; no value was read or quoted
- `server/prompted.db` and its WAL files — live data, not source

The corpus after exclusions is 84 files with no byte-identical duplicates. All were read.
