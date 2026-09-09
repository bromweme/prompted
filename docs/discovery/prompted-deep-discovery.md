# Prompted Deep Discovery

Current state as of 9 September 2026. This refresh describes the working tree on top of revision `cfa08f6` — the state includes both the baseline commit and the uncommitted round-stall/deadline work, profile system, phase rework and new test suite that followed it.
Package entry point: [prompted-assets/index.md](prompted-assets/index.md)

## Executive Summary

Prompted is a working multiplayer music game. A Judge sets a prompt, every other player answers it with one YouTube video, everyone votes, and a winner is scored. Groups are standing, so the same people play round after round and keep a shared history.

The build is real and better than its reputation. A Node server holds every game rule, identity is verified through Google and bound to each connection before any handler runs, state persists to SQLite, and 65 end-to-end tests run across four browsers. The parts that matter most for a judging game — concealing who is judging, who submitted what, and who wrote which comment — are enforced by withholding data from the payload rather than by hiding it in the interface, and a test proves the Judge's identity is absent from every websocket frame before the reveal.

**The single most important finding is unchanged: the project's two narrative documents describe a different product.** `README.md` and `GAME_DESIGN.md` specify Spotify, PostgreSQL, a React Native mobile app, in-memory state and no user accounts. The build uses the YouTube Data API, SQLite, Google Sign-In and persistent profiles, and has no mobile app at all (confirmed — there is no `src/` directory anywhere in the repository). Anyone onboarding from those documents would build the wrong thing. The environment examples, by contrast, are accurate — so this is a problem with two hand-written files, not with the project's documentation habits.

Two further findings change what the product does:

1. **The round-deadline stall is fixed.** The prior discovery's highest-priority finding — a submission deadline that was computed and displayed but never enforced, stranding a round forever on one absent player — has been resolved by a designed and now-implemented `advanceIfExpired` seam, with a durable host-notice system and a 13-test suite pinning every branch. The stall the old suite could not see is now the best-tested behavior in the project.
2. **Group settings stay misleading.** The server enforces 9 of the 21 settings the wizard sends, and at least six (`totalRounds`, `maxPlayers`, `allowSkipCzar`, `votingTime`, `autoStart`, `allowCustomTopics`) never turn into server behavior anywhere. Two of the inert ones — `totalRounds` and `maxPlayers` — are *displayed* as if they were limits ("Round 3/6", "4/12 players") that are never applied.
3. **Leave Group and Delete Group are still inert.** Both confirm with the user and then only navigate away. No event is sent; no handler exists.

The test suite is no longer uniformly green: at the time of investigation, `css-tokens.spec.js` failed because the new host-notice styling referenced an undefined CSS token (`var(--color-text)` at `web-app/src/pages/GroupView.css:1284`). That is fixed in this refresh — the token is now the defined `--color-text-primary` — but it is a useful live example of the static guard working. Independent of that one failure, 65 tests × 4 projects = 260 executions per run.

## Product, Process, and Actors

**What it is.** A prompt-and-judge party game for music, in the shape of Cards Against Humanity but played with videos. The comparison the README draws to MusicLeague is apt: the differentiator is the Judge.

**Who plays.**

| Actor | What they do | Notes |
|---|---|---|
| Player | Joins groups, answers prompts with a video, votes | Identity comes from Google and is bound to the socket, never taken from a message |
| Host | Creates the group, starts rounds, edits rules, closes submissions, reassigns a stalled Judge | Fixed at creation. There is no way to transfer or replace the host |
| Judge | Sets the prompt for one round, may name a winner outright | Chosen per round, randomly or hand-picked by the host. May also vote |

**A note on the Judge's name.** The code still calls this role three things: `czarId` and `czarPoints` internally, "Judge" in player-facing text, and "Round Leader" in comments. Both documents call it the Card Czar. This is not simply stale documentation — the implementation has not settled either, which makes every discussion and every code search about the role ambiguous.

**Six screens.** Login is public. Dashboard, Create Group, Group View, Account and My Topics all require a confirmed identity, and the app waits for the server to confirm rather than bouncing to the login screen on every reload. ThemeIdeas, previously built but unreachable, is now routed at `/topics`. Group View is the product: roughly 1,900 lines carrying every round phase, four tabs, the rules editor and five modals, plus a new host-notice banner.

## Core Value Paths

### 1. Play a round (the path everything else exists to serve)

```
host starts  →  Judge chosen  →  topic_selection  →  submission  →  voting  →  reveal
```

- **Starting.** The host emits `start_group` or `start_round`. The server checks that the caller really is the host and that the group has at least two *members*. Presence is deliberately not considered — the comment at `server/server.js:1037-1041` explains that who happens to be online is not the host's problem, since an absent player can submit when they return. The host may hand-pick the Round Leader (`czarUserId`) on either path; an unknown id falls through to a random pick.
- **Topic selection (new phase).** Since this refresh, every round begins in a `topic_selection` phase with **no deadline by design** — the only Judge can stall it, and the escape is a host-level `reassign_judge`, not a clock. Only the Judge sees the picker. Choosing a topic sets the title, computes the submission deadline, and opens submissions. A group with no topics is not stuck: the Judge can write one on the spot.
- **Submission.** Each contestant submits exactly one video, found through YouTube search. The Judge cannot submit. The phase ends when every eligible player has submitted, when a deadline passes, or when the host force-closes it. The deadline is now real: on expiry with submissions it advances to voting; with none it restarts the *same* round (same Judge, same topic, `currentRound` not incremented, no history entry) up to three attempts, then stalls for the host.
- **Voting.** Submissions appear without their authors. A player may award points to any submission but their own, and this is refused by the server, not merely disabled in the interface. The Judge may vote too.
- **Resolution.** The round resolves when every eligible voter has voted, or immediately if the Judge names a winner. The winner is decided by public override first, then the Judge's pick, then the highest tally.
- **Reveal.** Submitters, votes, comment authors and the Judge all become visible, and the round is written to group history with every video, so the history view can rebuild a watch-all link later.

### 2. Become a trusted identity

Google Identity Services mints an ID token in the browser. It is presented on the socket handshake, where the server checks signature, expiry, issuer, audience and the email-verified claim. The server then mints its own HMAC-signed session token, because a Google ID token expires in about an hour — far too short for a reconnect pattern. That token goes to `localStorage` and is replayed on every later connection.

A new profile is created with a null avatar, and that null is precisely what tells the client to run first-time setup. It is a small, deliberate piece of design: one nullable field carries the entire "is this person new" question. The profile (display name + avatar) is now editable and denormalizes into the player's groups, and avatars are validated against a server allowlist rather than accepted raw.

### 3. Own a topic, share it only with people you play with

Each player has a personal topic library. `get_topics` returns only their own topics. Inside a group, `topicsForGroup` additionally offers other members' *public* topics — but only to people in that group. A public topic is never visible app-wide.

This directly contradicts the documents, which describe public topics as "available to all games." The implementation is the better privacy model, it is pinned by tests, and the document is what should change.

## Business Rules and Operating Context

Rules the server actually enforces, each at a cited line in the current tree:

| Rule | Where |
|---|---|
| A round needs two group members, counted by membership not connection | `server/server.js:1042-1047` |
| Only the host may start a round or change rules | `start_round` host gate, `server/server.js:1072-1075`; the stalled-round escape is host-only at `:1086-1090` |
| Round Leader is picked randomly among connected players, or the host may name one | `beginRound`, `server/server.js:244-256` |
| Only a Judge who is also the current theme's Judge may pick the topic; may not be done after the pick | `server/server.js:606-613` |
| The Judge may not submit a video | `server/server.js:1148-1151` |
| Nobody may vote for their own submission | `server/server.js:1243-1246` |
| One submission and one vote per player per round | `cast_vote` re-vote guard, `server/server.js:1227-1230` |
| Vote points must be a finite number within range, negatives only via `isDownvote` | `server/server.js:1251-1255` |
| Winner precedence: public override, then Judge pick, then highest tally | `server/server.js:413-434` |
| Override threshold must be a whole percentage from 51 to 100 | `server/server.js:715-717` |
| Submission deadline must be 1–168 hours, validated on create and update | `server/server.js:156-162, :722-727, :1001-1006` |

**Defaults match the documents exactly**: five points for the winner, up to three per jury vote, one point for a downvote, seventy percent to override.

**Round-stall operating contract (new).** `advanceIfExpired` (`server/server.js:198-238`) is the single idempotent enforcement point. It is evaluated at natural round moments — `join_group` (:805), `get_group` (:852), `submit_video` (:1203), `start_round` — and again when the client emits `check_round_deadline` when its on-screen countdown reaches zero (:872-882). Crucially, the server re-checks its **own** clock; a dishonest client that fakes reaching zero gains nothing, and a client that goes to sleep wakes to a nudged re-check. There is deliberately no scheduler, so a round advances only when someone interacts with the group — the deadline persists across restarts because it is stored on the theme.

**Operating posture.** The server refuses to boot if `AUTH_TEST_MODE` is set while `NODE_ENV` is production (`server/config.js:12-16`). Outside production it boots in a degraded mode with loud warnings when credentials are missing (`:39-63`), so a fresh clone and the test suite both work before any secret exists. Every socket handler runs behind a token-bucket rate limiter and a crash guard that turns a thrown exception into an error message to that one caller rather than taking down the process.

## Data, Systems, and Dependencies

**Storage.** One SQLite file in WAL mode, three tables — `users`, `topics`, `groups` — each storing one JSON blob per row through a Map-compatible write-through cache. Reads come from memory; every `set()` writes to disk before returning.

One structural hazard: `get()` returns the live cached object. Current callers are careful to build a new object and call `set()`, but nothing in the class stops a future caller from mutating in place and never saving. The scoring leaderboard in the UI shows the same class of hazard in reverse — one `.sort()` mutates the live players array in place rather than a copy (`web-app/src/pages/GroupView.jsx:731-732`).

**External dependencies and what happens when they fail.**

| Dependency | Missing | Failing |
|---|---|---|
| Google Identity Services | Sign-in disabled outside production; fatal at boot in production | Connection refused, never a fallback identity |
| YouTube Data API v3 | Falls back to a local fixture list, transparently | Throws after an 8-second timeout; the caller gets a generic error, the API key never leaks |
| SQLite | Hard dependency. Throws at module load, before the degraded-mode logic applies | Same |

**Quota.** A `search.list` call costs 100 of 10,000 daily units. Results are cached by normalized query with a 30-minute TTL and a 500-entry LRU bound, and the client debounces typing. Without both, a few players typing would exhaust the day's allowance in minutes. YouTube titles/descriptions are HTML-entity-decoded at the API boundary in a new one-pass decoder that avoids DOM and injection risk (`server/htmlEntities.js`), pinned by the `video-titles` spec.

**Security posture, plainly.** Identity is bound once and never read from a payload. CORS is an exact-string allowlist. Video ids are validated against a strict 11-character pattern before being interpolated into an embed URL. Session tokens are deliberately not JWT, and are compared in constant time. `allowVotingComments` is one of the few settings that gates a real server behavior (dropping the comment field when off). The one real gap remains: **there is no way to revoke a session.** Signing out clears local state only; a copied token stays valid until it expires, and the default lifetime is 30 days with a fresh token minted on every connection.

## Design Direction and Decision State

The codebase records its reasoning unusually well. Several comments are genuine decision records, and the round-stall work carries a dedicated design notebook at `docs/design/round-stall-change-design.md`.

**Settled, with the reasoning written down:**

- *Only "Judge Selects" ships.* Three other topic-selection modes are commented out rather than deleted, each annotated with the mechanics it would need — "a pool to draw from, and a rule for whose topics are eligible" for random; "a whole voting sub-phase" for vote; "per-group ordering state" for rotation. This stays the clearest decision record in the project.
- *Rounds are gated on membership, not presence*, and the deadline is evaluated on interaction, not by a timer. The design doc measured Node's setTimeout-overflow risk and rejected the timer seam.
- *A round with zero submissions restarts the same round* (same Judge, same topic, `currentRound` not incremented, no history entry), capped at three attempts, then stalls for the host with a durable notice. The doc recorded the advance-to-voting-with-what-arrived branch as medium-confidence/inferred and it was implemented exactly as written.
- *Public topics are scoped to groupmates.*
- *Session tokens are not JWT*, to avoid a library that must negotiate algorithms including `none`.

**Settled in code, unrecorded in prose:** the move from Spotify to YouTube, and from PostgreSQL to SQLite. Both are complete and deliberate. No document mentions either.

**Unclear:** whether the skip-Judge rotation was dropped or never built (its setting is still collected and never read); what the Judge role should finally be called; whether a group should end at `totalRounds` or run as a standing league. The mobile-app question is no longer open — there is no mobile code in this repository.

## Current Build and Evolution

**Shape.** 84 source files (the suite's corpus; 1,661 generated Playwright artifacts are excluded). A ~1,177-line server, a ~1,900-line Group View, 5 new UI components (AppNav, AvatarPicker, ProfileSetupModal, RoundVideoList, TopicPicker), and 13 test files. No REST API for gameplay — socket.io carries everything. The uncommitted delta since `cfa08f6` is large: 24 modified files (+1864/−923) plus 26 untracked files, dominated by the round-stall work, the phase rework, the profile system and 10 new e2e specs.

**Test suite.** 65 tests across chromium, mobile-chrome, webkit and mobile-safari, for 260 executions per run. It boots both real servers (`node server.js` under `AUTH_TEST_MODE=1` with `YOUTUBE_API_KEY` blanked to force fixtures, plus the real Vite dev server) and does not mock the game engine. Three mechanisms are worth noting:

- **Raw socket clients** for rules a browser cannot violate. The self-vote test sends a crafted payload no interface could produce, proving server-side enforcement rather than a disabled button. `round-deadline.spec.js` uses the same raw-socket approach to drive real deadline expiry.
- **Websocket frame inspection** to prove a negative — the Judge's id appears in no frame before reveal.
- **A CSS cascade simulator** that computes importance, specificity and source order to find labels that vanish on hover. An earlier version that simply overlaid hover rules produced a false positive, and the comment records why that approach was wrong. A companion **static token guard** fails on any undefined `var(--token)` — which is exactly what caught the `--color-text` regression this refresh fixes.

**Stability.** At the baseline this was 208 executions/run with zero failures across three runs. The suite has since grown to 260 executions/run and added the deadline machinery. One real failure existed at investigation time — the `css-tokens` undefined-token guard — now resolved. `retries: 0` is deliberate so a flake cannot be papered over.

**What the suite does not cover**, in order of how much it matters:

1. **Scoring variety.** Every end-to-end round resolves through the public-override branch at 100% vote share. The popular-vote fallback, vote splits, ties, a legitimate downvote against another player, and any non-default point configuration are never exercised.
2. **Real Google sign-in and the real YouTube API**, both bypassed by design.
3. **Mid-round disconnect and reconnect.** Offline-start is tested; reconnect-and-resume is not.
4. **Focus states.** The static lint deliberately exempts `:focus`, and the runtime audit simulates `:hover` only. A control that goes invisible on keyboard focus would pass everything — the same bug class that was found and fixed for hover, uncovered for the state keyboard users depend on.
5. **The new voting-phase hang** (below) and `totalRounds` group ending are untested.

## Conflicts, Gaps, and Open Questions

### The documents describe a different product

| `README.md` / `GAME_DESIGN.md` | The build |
|---|---|
| Spotify Web API | YouTube Data API v3 |
| PostgreSQL | better-sqlite3, WAL |
| React Native + Expo app under `src/` | No such directory — confirmed absent |
| In-memory state, no user accounts | Google Sign-In, session tokens, persisted profiles and groups |
| Games joined by code, with a lobby browser | Groups; the id doubles as the invite code |
| `Home.jsx`, `GameLobby.jsx`, `GameRoom.jsx` | `Login`, `Dashboard`, `CreateGroup`, `GroupView`, `Account`, `ThemeIdeas` |
| Public topics available to all games | Public topics scoped to shared groups |
| `join_game`, `submit_song`, `next_round`, `skip_czar` | `join_group`, `submit_video`, `start_round`; no skip event exists |

`README.md` also contradicts itself: Spotify appears as the current submission method and, two sections later, as an unbuilt future enhancement.

Not everything differs. The phase order, the scoring defaults, the override threshold and Judge anonymity all match — and anonymity is implemented more strongly than described.

### A round with no submissions restarts (and then stalls for the host)

The old stall — deadline computed but never enforced — is gone. In its place is a careful contract, but it has edges worth knowing:

- **Voting has no deadline.** `votingTime` is collected and displayed but nothing ever forces `voting` → `reveal`. A round can hang in voting forever unless every eligible voter votes or the Judge names a winner, and `close_submissions` only works while the phase is `submission`. There is no host escape from a stuck voting phase.
- **Deadline enforcement is interaction-driven.** With no scheduler, a group where everyone goes quiet after the deadline simply does not advance until someone pings it. This is an explicit design choice, not a bug, but it is worth being deliberate about.
- **The topic-selection stall is real but the escape is host-only.** A Judge who goes away before picking a topic holds that phase forever unless the host reassigns them; there is no timer there by design.

### Nine settings do nothing (and some are displayed as limits)

The wizard sends 21 settings. The server reads nine.

- **Enforced server-side:** `submissionTime`, `showCommentsLive`, `anonymousCzar`, `allowOverride`, `overrideThreshold`, `czarPoints`, `downvoteCost`, `maxJuryPoints`, `allowVotingComments`
- **Client-only, not server-checked:** `allowDownvotes` hides the Downvote control but the server never checks the toggle — a crafted `isDownvote:true` passes even when the group forbids downvoting (`server/server.js:1274`). `allowMemberInvites` gates who *sees* the invite link only; anyone with the group id can join.
- **Inert everywhere:** `totalRounds`, `maxPlayers`, `allowSkipCzar`, `votingTime`, `autoStart`, `allowCustomTopics`, `enableChat`, `enableSongPreview`, `showVoterIdentity` — none appear anywhere in `server/server.js`, and most have no UI effect either.

`totalRounds` and `maxPlayers` are the most misleading, because they are *displayed* — "Round 3/6", "4/12 players" — implying limits that are never applied. Nothing ends a group at `totalRounds`, and nothing stops a thirteenth player joining (`join_group` has no cap).

### Leave and Delete do nothing

Both controls confirm with the user and then call `navigate('/dashboard')` (`web-app/src/pages/GroupView.jsx:1636-1655`). Neither `leave_group` nor `delete_group` is emitted anywhere, and the server has no handler for either. A player who leaves is still a member. A host who deletes still owns the group.

### The host role is permanent

Only the host may start a round or edit rules, and `group.host` is written once at creation. If that person stops playing, the group can never start another round — the stall notice is literally "waiting for you [host]" with no transfer mechanism.

### Dead UI in the current tree

Several controls read as actionable but do nothing, in addition to Leave/Delete:

- **Edit Video** is unreachable: `setIsEditing(true)` is never called, yet the submit-modal title and button branch on it (`GroupView.jsx:1672, :1717`).
- **Dashboard** tabs (Active/Completed/Archived) are presentational with no filtering, and its "Quick Actions" cards have no `onClick` (`Dashboard.jsx:166-168, :265-284`).
- **Account Settings** toggles (Email Notifications / Public Profile / Sound Effects) are cosmetic `defaultChecked` checkboxes with no persistence, and "Deactivate Account" is a stub (`Account.jsx:353-388`).
- **Overview phase label** reads "Submissions Open" for any phase that is not voting or reveal — so during `topic_selection`, before a topic exists, it is misleading (`GroupView.jsx:672`).

### Accessibility gaps

The suite's resting + hover audits are strong, but two keyboard issues remain visible and the focus state is uncovered entirely: ThemeIdeas' "Quick Theme Inspiration" cards are non-interactive `div onClick` with no role or tabindex (`ThemeIdeas.jsx:116-139`), inconsistent with Account's real buttons; and the CreateGroup topic-selection `<select>` renders as a fixed single choice presented as a dropdown.

### A downvote costs points twice

The vote is stored with negated points, which dock the target submission. The voter is then separately charged `downvoteCost` — unconditionally, whether or not the downvoted entry won. Both documents say only that "downvotes cost points," which does not settle whether both effects were intended.

### Open questions

1. Should the Judge both vote *and* hold an outright winner pick? The code allows both deliberately, and the documents agree — but nothing records whether giving one person two levers on the same outcome was weighed.
2. Is a downvote meant to cost the voter as well as the target?
3. Was skip-Judge dropped or never built? Its setting is still collected.
4. What is the role finally called?
5. Should a group end after `totalRounds`, or run indefinitely as a standing league?
6. Should the voting phase get a deadline, or a host escape, to match the submission deadline?

## Codebase Guide

Read in this order.

| Read | For |
|---|---|
| `server/server.js:198-238, 240-375` | The new deadline contract, then the whole game — `beginRound`, `publicizeTheme`, `calculateGroupResults` |
| `server/server.js:486-530` | How identity is bound before any handler can run |
| `server/auth.js`, `session.js`, `config.js` | Sign-in, tokens, and the degraded-boot behavior |
| `server/db.js`, `server/profiles.js` | All persistence and the profile store |
| `web-app/src/pages/GroupView.jsx` | The product. Large, but it is the round |
| `web-app/src/pages/CreateGroup.jsx:104-131` | Every setting, in one payload — compare against the nine the server reads |
| `web-app/e2e/round-phases.spec.js` | The clearest executable specification of the rules |
| `web-app/e2e/round-deadline.spec.js` | The newest spec: the deadline contract end-to-end |
| `web-app/e2e/a11y-audit.js`, `css-tokens.spec.js` | The cascade simulator and the static token guard |

**Do not start with `README.md` or `GAME_DESIGN.md`.** Read them only as a record of original intent, and check every present-tense claim against the code. `server/.env.example` is accurate and is a good orientation to the operating model.

## Source Guide

| Source | Worth reading for | Trust |
|---|---|---|
| `GAME_DESIGN.md` | Original mechanics and the vocabulary the code still half-uses | Stale on stack, storage, music source and mobile |
| `README.md` | Scoring defaults, override threshold, the MusicLeague framing | Stale, and internally inconsistent about Spotify |
| `docs/design/round-stall-change-design.md` | The one fully-designed-and-implemented change; records rationale and rejected seams | Accurate for the deadline work |
| `server/.env.example` | The real operating model and every credential's purpose | Accurate |
| `web-app/.env.example` | Client configuration | Accurate |
| `.gitignore` | Records a past secret-exposure fix | Accurate |
| `web-app/README.md` | Nothing — unmodified Vite boilerplate | n/a |

---

*Method: 84 source files inventoried; 1,661 generated Playwright artifacts excluded. Five bounded source investigations (server engine, frontend/UX, test suite, docs/git history, identity), reconciled by the lead with every contested claim re-verified directly against the code; the cross-team claim that "the Judge cannot submit" and the settings-enforcement split were confirmed by direct server reads. Findings marked from static analysis come from reading code, not from watching it run; capability statuses in [application-model.json](prompted-assets/knowledge-base/application-model.json) keep that distinction.*