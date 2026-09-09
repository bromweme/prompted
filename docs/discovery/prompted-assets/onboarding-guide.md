# Engineering Onboarding: Prompted

A learning path, not a reference. Follow it in order; each step assumes the one before. Budget about half a day to reach the point where you can change something safely.

Companion reading: [the report](../prompted-deep-discovery.md) for current state, [the atlas](architecture/atlas.md) for structure, [the source guide](source-guide.md) for what to trust.

---

## Before you start: one thing that will mislead you

`README.md` and `GAME_DESIGN.md` describe a different product — Spotify, PostgreSQL, a React Native app, no user accounts. None of that is true. If you have already read them, set that mental model aside. The `.env.example` files are accurate; the two narrative documents are not.

---

## Step 1 — Get it running (about 15 minutes)

```bash
cd server && npm install && npm start      # port 5000
cd web-app && npm install && npm run dev   # port 5173
```

It boots with no credentials at all. `server/config.js` prints exactly which subsystems are degraded and why: sign-in disabled, YouTube search on local fixtures, an ephemeral session secret. This is deliberate — a fresh clone and the test suite both work before any secret exists.

To sign in for real you need `GOOGLE_CLIENT_ID` in both `.env` files. To search real YouTube you need `YOUTUBE_API_KEY` in `server/.env`. **You probably do not want the YouTube key while developing**: a search costs 100 of 10,000 daily units, and the fixture list exercises the whole path for free.

Run the tests:

```bash
cd web-app && npx playwright test                    # all 4 projects, ~4 min
npx playwright test --project=chromium               # ~1 min, what you will use
```

Playwright starts both servers itself. If you already have one running by hand, it will reuse it — including reusing a server started **without** `AUTH_TEST_MODE=1`, which will fail the tests confusingly. When tests fail for no clear reason, kill any stray server first.

---

## Step 2 — Understand the round (about 1 hour)

This is the product. Everything else exists to make it possible.

Read `server/server.js` in this order, and only these now to begin with:

1. **`advanceIfExpired` (`:198-238`)** — the deadline seam. Understand it first because it is the newest and most behavior-rich function: it reads a stored deadline at interaction moments, advances to voting when submissions exist, and re-arms the *same* round up to three times when none do, then stalls for the host.
2. **`beginRound` (`:244-281`)** — picks the Judge, creates `group.currentTheme`, opens the `topic_selection` phase.
3. **`publicizeTheme` (`:286-330`)** — decides what each phase is allowed to reveal. Read this slowly; it is the most important function in the codebase.
4. **`calculateGroupResults` (`:393-480`)** — tallies votes, picks a winner, applies scores, writes history.

Then trace one round through the handlers: `start_group` → `select_topic` → `submit_video` → `cast_vote`. Four handlers, and you have the whole game.

**The mental model to carry away:** the server is the only authority. The client renders what it is sent and asks for changes; it never decides anything. Concealment works by *not sending* data, not by hiding it in the interface — so a modified client cannot reveal the Judge.

---

## Step 3 — Understand identity (about 30 minutes)

Read `server/auth.js`, then `server/session.js`.

The key line is `io.use(createAuthMiddleware())` at `server/server.js:486`. It runs once per connection, before any handler exists, and sets `socket.data.userId` from a verified identity. Every handler reads that and never trusts a field in the message.

This one property is what makes "only the host may start a round" a real rule rather than a suggestion. When you add a handler, **read the identity from `socket.data.userId`** — never from the payload.

Why there are two tokens: Google's ID token expires in about an hour, far too short for a socket that reconnects. So once Google has confirmed who someone is, the server mints its own longer-lived HMAC token. It is deliberately not a JWT.

---

## Step 4 — Understand storage (about 15 minutes)

Read `server/db.js`. All 55 lines of it.

`PersistentStore` is a `Map` with a SQLite table behind it. Reads come from an in-memory cache; every `set()` writes through to disk before returning. Three tables: `users`, `topics`, `groups`, each one JSON blob per row.

**The trap:** `get()` returns the live cached object. If you mutate it and forget to call `set()`, memory and disk drift apart silently. Existing callers always build a new object and save it. Do the same.

---

## Step 5 — Read the client (about 1 hour)

`web-app/src/pages/GroupView.jsx` is about 1,900 lines and is the whole game surface. Do not read it top to bottom. Start with `normalizeGroupData` and `mapPlayers` at the top — they convert the server's shape into what the component renders, and `mapPlayers` in particular collapses the server's two identities (a transient socket `id` and a stable `userId`) into one, so nothing downstream can compare against the wrong one.

Then find the phase branches and read the one you care about.

`SocketContext` and `UserContext` supply the connection and the identity. `RequireAuth` in `App.jsx` waits for the server to confirm identity rather than bouncing to the login screen, which is why a reload does not throw you out.

---

## Step 6 — Learn what the tests guarantee (about 45 minutes)

Read `web-app/e2e/round-phases.spec.js` and `web-app/e2e/round-deadline.spec.js`. Together they are the clearest executable specification of the game's rules — the first for server/UI rule parity, the second for the deadline contract driven with real socket clients.

Three techniques are worth understanding, because you will need them:

- **Raw socket clients** for rules a browser cannot break. The self-vote test sends a payload no interface could produce, proving the *server* refuses it rather than that a button is disabled; `round-deadline.spec.js` uses the same pattern to drive real deadline expiry. Use this pattern whenever you add a server-side rule.
- **Websocket frame inspection** (`game-loop.spec.js`) to prove a negative — the Judge's id appears in no frame before reveal.
- **A CSS cascade simulator** (`a11y-audit.js`) that computes importance, specificity and source order to catch labels that vanish on hover, plus a static token guard (`css-tokens.spec.js`) that fails on any undefined `var()`. The comment at `a11y-audit.js:156-163` explains why the naive approach was wrong.

`retries: 0` is deliberate. A failing test means something is actually broken.

---

## Step 7 — Know what is not finished

Before you plan any work, read the [conflicts and gaps section of the report](../prompted-deep-discovery.md#conflicts-gaps-and-open-questions). The short version:

- **The deadline is enforced, but voting has no deadline.** A round with no submissions re-arms the same round up to three times, then stalls for the host; enforcement only happens when someone interacts with the group; and once in `voting`, nothing forces the phase forward and the host has no escape (`close_submissions` only works during submission).
- **Nine of 21 group settings do anything** — and several more (including `maxPlayers` and `totalRounds`) are *displayed* as if they were limits.
- **Leave Group and Delete Group send nothing.**
- **The host role cannot be transferred**, so an absent host permanently blocks new rounds.

The first of these is now well tested (`round-deadline.spec.js`); the rest are largely invisible to the suite.

---

## Conventions worth matching

- **Comments explain *why*, not *what*.** The good ones in this codebase record a decision and the failure that motivated it. Match that; it is the project's best habit.
- **Validate at the edge.** Every handler cleans its inputs against `LIMITS` and rejects rather than substituting a default.
- **Never restyle a shared button or form class from a page stylesheet.** Page CSS loads after `index.css` and applies app-wide. This exact mistake made every primary button in the app invisible while the test suite stayed green. `css-tokens.spec.js` now fails the build if you do it.
- **Never reference an undefined CSS custom property.** An undefined `var()` invalidates the whole declaration, so `background` silently falls back to transparent. Same lint catches it.
- **Add a test at the right level.** A rule the server enforces deserves a raw-socket test, not a UI test — the UI test would pass even if the server check were deleted.
