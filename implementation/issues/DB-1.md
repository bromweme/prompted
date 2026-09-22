# DB-1 — Move persistence off the ephemeral filesystem to managed Postgres

- **Status:** Blocked — one engineering decision, named under "Decide before starting". Becomes `Ready` the moment it's picked.
- **Priority:** high. Nothing else in the product matters if the data doesn't survive lunch.
- **Guarantee:** Groups, players, topics, notifications, profiles and the event log survive a restart, a redeploy and an idle period. A game started on Monday is still there on Wednesday.

## Observed

Render's free web services have an ephemeral filesystem, and a free service **spins down after 15 minutes without inbound traffic**. Render's own documentation is explicit: filesystem changes — "uploaded images, local SQLite databases, etc." — are lost every time the service redeploys, restarts, or spins down, and free services cannot attach a persistent disk.

`server/prompted.db` lives on that filesystem. So in production today:

- Every group, membership, topic, notification and profile is destroyed after 15 quiet minutes.
- The `events` table (`EVT-1`) is destroyed with it, so there is no usable analytics history.
- Worse for `EVT-1`: `events.js:69` stores the HMAC secret for pseudonymous actor ids in the `meta` table and regenerates it when absent. A wiped database means a **new secret on every boot**, so the same player hashes to a different actor id after every spin-down. The pseudonymous ids aren't stable, which quietly defeats the point of the log.

Sessions are unaffected: `SESSION_SECRET` is a required environment variable in production (`config.js:37`), so tokens still verify after a restart — players stay signed in, into a world where their groups have vanished.

There is no data to migrate. The database is empty most of the time already.

## Current behavior (grounded)

`server/db.js:14` — `PersistentStore` is a **write-through cache**, and this is what makes the change tractable:

- The constructor creates the table and loads every row into an in-memory `Map` (`db.js:17-22`).
- `get`, `has`, `forEach`, `values` read **only** from that Map — they never touch SQLite.
- `set` and `delete` update the Map and write through synchronously (`db.js:38-47`).

So the database is touched in exactly three places: a bulk load at startup, an upsert, and a delete. Every one of the roughly fifty socket handlers in `server.js` reads from memory and stays synchronous no matter what backs the store.

Users of the store:

| Module | Store | Notes |
|---|---|---|
| `server.js:51-53` | `topics`, `notifications`, `groups` | Created at module load, as top-level `const`s |
| `profiles.js:1` | `profiles` | Same shape |
| `events.js:2` | raw `db` | Not a `PersistentStore`: its own `events` + `meta` tables, prepared statements, opportunistic prune |
| `invites.js` | — | `createInviteIndex()` builds an in-memory index; it is fed from groups, so it follows whatever the store does |

`server.js:2878` is the only `listen()` call, which is where an async load has to land.

## Where it should go

Free tiers as verified on 2026-09-22:

| Option | Free terms | Verdict |
|---|---|---|
| **Neon** | Permanent free plan, no card. 0.5 GB storage per project, 100 compute-hours/month, scale-to-zero after 5 min idle | **Recommended.** The only one that neither expires nor pauses |
| Supabase | 500 MB, 50k monthly active users | Projects **pause after 1 week of inactivity**, max 2 active |
| Render Postgres (free) | 1 GB, one per workspace | **Expires 30 days after creation.** A trial, not a home |

Neon's scale-to-zero adds a wake-up delay to the first query after idle, which lands in the same window as Render's own one-minute spin-up — the `ConnectionBanner` (`UX-1`) already covers that experience.

One Render limitation to keep in view: free services that generate "an uncommonly high volume" of service-initiated external traffic may be suspended, and an external database counts. Our write volume is low — writes happen on state change, not per read — but it argues against chatty polling and for keeping reads in memory, which is what the design already does.

## Plan

**Phase 1 — make the store's lifecycle async, still on SQLite.** No behavior change, no new dependency, fully covered by the existing suite.
- Split the constructor: keep table creation and statement preparation, move the bulk load into `async load()`.
- Add `initStores()` that awaits every store's `load()`, and call it in `server.js` before `server.listen()` (`:2878`).
- Keep `set`/`delete` synchronous for now.
- Green suite here proves the lifecycle change in isolation, before any driver swap.

**Phase 2 — a Postgres driver behind the same interface.**
- Add `pg` and a `DATABASE_URL` environment variable. When it's absent, fall back to SQLite, so local development and the test suite keep working with no setup.
- One table per store, same shape as today: `(id TEXT PRIMARY KEY, data JSONB NOT NULL)`. The stored value is already a JSON blob, so nothing about the data model changes.
- `set`/`delete` become async internally and are **not awaited by callers**; they queue per key and log failures loudly. See the durability decision below.
- `get`/`has`/`values`/`forEach` stay synchronous, reading the Map. No handler changes.

**Phase 3 — port `events.js`.**
- Same two tables in Postgres; `props` becomes `JSONB`.
- Move the HMAC secret to the required `EVENTS_HASH_SECRET` environment variable rather than a `meta` row, so actor ids are stable across restarts and across a database reset. This is a fix to `EVT-1`'s guarantee, not just a port.
- Writes are already fire-and-forget by design, so this phase is the least invasive.

**Phase 4 — verification.**
- Full suite green against SQLite (the fallback path).
- Full suite green against a Postgres instance, to prove the two drivers agree.
- A new API-level spec: write through the store, drop and rebuild the in-memory cache, read back — the regression test for "does it actually persist", which nothing covers today.
- Deploy, then confirm by hand: create a group, wait out the 15-minute spin-down, reload, and find the group still there. Add a smoke check for it once a seeded account exists.

## Decide before starting

**1. What the tests run against.** (This is the blocker.)
- *(a) Keep the SQLite fallback and run the suite against it.* Nothing about the test setup changes; `PROMPTED_DB_PATH` keeps working. The cost is that CI then tests a driver production doesn't use.
- *(b) Run the suite against Postgres.* What's tested is what runs. The cost is that every CI job needs a Postgres service and a per-run schema, and local runs need Docker or a Neon branch.
- *(c) Both: SQLite for the fast local loop, Postgres in CI.* Best coverage, most moving parts.
- **Recommendation: (c)**, with (a) as the fallback if CI setup proves annoying. Two drivers behind one interface is exactly the kind of thing that drifts silently, and the parity is cheap to check once the job exists.

**2. Durability of writes.** Fire-and-forget writes mean a crash between the cache update and the database acknowledgement loses that change — a real regression from SQLite's synchronous write. Awaiting instead would make every handler async.
- **Recommendation: fire-and-forget with a per-key write queue and loud failure logging.** The data is a party game's state, the window is milliseconds, and making fifty handlers async to close it is a poor trade. Worth revisiting if the app ever holds something people would be upset to lose.

## Affected surface

| Area | Change |
|---|---|
| `server/db.js` | Async `load()`, driver selection on `DATABASE_URL`, Postgres-backed `set`/`delete`, write queue |
| `server/server.js` | `await initStores()` before `listen()` (`:2878`) |
| `server/profiles.js` | Participates in `initStores()`; no other change |
| `server/events.js` | Postgres port; `EVENTS_HASH_SECRET` becomes required |
| `server/.env.example` | `DATABASE_URL`, `EVENTS_HASH_SECRET` |
| `web-app/playwright.config.js` | Test database wiring, per decision 1 |
| `.github/workflows/tests.yml` | A Postgres service, per decision 1 |
| e2e | New persistence spec: written state survives a cold cache |
| `README.md`, `GAME_DESIGN.md` | "SQLite" is stated in both and would become wrong |

## Done when

- A group created before an idle spin-down is still there afterwards, in production.
- The event log keeps a stable actor id for the same player across restarts.
- Reads remain synchronous and in-memory; no socket handler's signature changed.
- The full suite is green on every driver CI runs.
- A dropped-cache read-back test exists and fails against a cache-only store.
- No secret in the repo; `DATABASE_URL` and `EVENTS_HASH_SECRET` set in Render.

## Depends on

None. `EVT-1` gains a stable-actor-id fix along the way.
