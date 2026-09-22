# Prompted

A real-time multiplayer music game. Each round, one player picks a topic, everyone else submits a song that fits it, and the group votes on the best pick. The round's judge stays anonymous until the reveal, when the winning video plays for everyone.

Built with React, Node.js/Express, Socket.io and Postgres, and tested end to end with Playwright. A checkout runs on SQLite with no setup; production sets `DATABASE_URL` and the same code runs on Postgres.

Games are asynchronous — rounds run on deadlines measured in hours, not while everyone waits in a lobby. A group plays a set number of rounds and then finishes with final standings, and the host can start another game.

- **Find a group without knowing anyone.** Groups that are open and haven't started yet are listed on the dashboard and on a searchable Open Groups page. A stranger reads the group's page, asks to join, and the host accepts or declines.
- **Hosts run their group.** Invite links with resettable codes, join requests (three declines and that player can't keep asking), kick, and ban. Nobody new joins in the middle of a round.
- **Notifications.** A bell in the header and a full history page: your turn to judge, a round opening or resolving, a game finishing, join requests and their answers. They're kept per player on the server, so they survive being away.
- **Host-supplied topics.** A group can turn off custom topics and play from a list the host writes, and the app won't start a round without enough unused topics for the rounds left.

`GAME_DESIGN.md` describes the rules and architecture as built; `implementation/issues/` holds the per-feature specs.

## Testing

The test suite is the main focus of this repository. Tests are split into layers, so each check runs at the lowest level that can prove it:

| Layer | Tests | Runs | Tool |
|---|---|---|---|
| **Unit** (backend and frontend logic) | 28 | once | Node test runner |
| **Persistence** (state survives its cache being dropped) | 3 | once | Playwright `persistence` project |
| **API** (game rules, driven over socket.io with no browser) | 92 | once | Playwright `api` project |
| **End-to-end** (real browsers) | 102 | x 4 projects | Playwright |

That's **503 Playwright runs per suite**, plus the unit tests. The persistence layer runs first and alone: it reloads every store from the database mid-run to prove the data really came back, which affects the whole server process, so every other project waits on it. The end-to-end tests run across four browser/device projects:

| Project | Engine | Viewport |
|---|---|---|
| `chromium` | Chrome | Desktop |
| `mobile-chrome` | Chrome | Pixel 7 (touch) |
| `webkit` | Safari's WebKit | Desktop |
| `mobile-safari` | Safari's WebKit | iPhone 14 (touch) |

The projects form a 2x2 grid of engine and screen size, so a failure in one cell points at either a browser difference or a layout/touch difference. The mobile projects are emulated mobile browsers, not native apps. Tests that never open a page run once in the `api` project instead, since the browser can't change their result.

Every push runs all of it on GitHub Actions, with each Playwright project as its own parallel job.

Two checks run alongside the tests. A **Postgres job** runs the server unit tests and the `api` project against a real `postgres:17` service, because local runs default to SQLite and the driver production uses would otherwise never be exercised. A **dependency audit** fails the build on a high or critical advisory in a package that ships, reports dev-only advisories without blocking (a bundler cannot be reached by a player), and saves a CycloneDX SBOM of the shipped tree — which is what makes it possible to answer "were we affected?" about an advisory published next month. Dependabot raises the weekly update pull requests, grouped so an ordinary week is one review per package.

### What the suite covers

- **Full multiplayer rounds.** Tests open separate browser contexts to act as independent players in the same game, then drive a round from start to finish: joining a group, choosing a topic, submitting a song, voting, and the reveal.
- **Every group size from 3 to 8.** Full games at each size, checking scoring, the end of the game, and that the Judge rotates through everyone.
- **Players in more than one group.** Activity in one group never changes the group on screen.
- **Live updates.** When one player acts, tests confirm the other players' open pages update without a refresh.
- **What the server sends, not just what the screen shows.** Tests listen to the raw WebSocket traffic and check that the judge's identity never appears in any message before the reveal, even though the UI already hides it.
- **Accessibility.** Pages are checked against WCAG 2.1 AA with axe-core, including hover states. Tests locate elements by role and accessible name (`getByRole`, `getByLabel`), so an unlabeled control fails the test.
- **Game rules, at the API level.** Round deadlines, per-round vote budgets, judge skips, host election when a host leaves, which groups are open, and join requests, kicks, and bans, tested by driving the server directly over socket.io.
- **Logic and styling guards, at the unit level.** Time-window conversions round-trip exactly, and no stylesheet references an undefined CSS token or restyles a shared button app-wide.

### Design choices

- **Real backend, no mocks.** Playwright boots the actual server and the Vite dev server before the run and tears them down afterward, so tests exercise real Socket.io traffic. Each run gets a fresh throwaway database.
- **Deterministic data.** Tests use fixture results instead of the live YouTube API. Results are the same on every run, and runs cost no API quota and work offline.
- **Test-only sign-in.** A test mode lets the suite create players without going through Google. The server refuses to start with it enabled in production.
- **Zero retries, on purpose.** A flaky test fails visibly instead of passing on a second try. Traces are kept for every failure (`retain-on-failure`) so failures can be stepped through afterward.
- **Tuned parallelism.** Four workers, parallel by file. Higher worker counts overloaded WebKit and produced timeouts caused by machine load rather than real bugs.

### Two checks that sit outside the suite

The suite proves the rules are right on a local machine. Two things it can't tell you have their own tools, run on demand rather than in CI.

**Load** (`web-app/perf/loadtest.mjs`) drives real socket clients through real games and measures what only shows up under concurrency: how long the *last* member of a group waits for an update, how much data the server pushes, how many app-wide broadcasts an uninvolved socket receives, and whether the per-socket rate limit (20 burst, ~5/s) starts refusing real play. It needs a local server with `AUTH_TEST_MODE=1` and refuses a non-localhost target unless you pass `--allow-remote`.

```bash
cd web-app && npm run perf -- --groups 25 --players 6 --rounds 2
```

**Smoke** (`web-app/smoke/`) checks a *deployed* site, which CI never touches: the backend answers its health check (and how slowly, if the instance was asleep), the websocket layer is reachable and refuses anonymous connections, test-mode sign-in is refused, the app boots with no failed requests, and the shipped bundle is built against the intended backend rather than localhost. It deliberately doesn't play a game — production refuses test-mode sign-in, which is the point.

```bash
cd web-app && SMOKE_WEB_URL=https://prompted-frontend.onrender.com SMOKE_API_URL=https://prompted-server-8hbz.onrender.com npm run test:smoke
```

### Running the tests

The end-to-end suite starts the backend itself, so install both packages first:

```bash
cd server && npm install && cd ..
cd web-app && npm install
npx playwright install
npm run test:e2e
```

No credentials are needed; the suite runs on fixtures and test-mode sign-in. To run one layer or browser, add `-- --project=api` or `-- --project=webkit`.

Unit tests:

```bash
cd server && npm test
cd web-app && npm test
```

## Features

- Create a group and invite players with a code or a shareable link
- Browse open groups on the dashboard or search them on their own page, view one, and ask to join; the host accepts or declines (three declines and you can't ask again)
- Hosts can kick members, or ban them from every way back in, with a banned list to undo it
- No one joins during a round, by request or invite; hosts starting a round with requests waiting are asked first
- Sign in with Google, with a profile name and avatar
- An anonymous judge who picks the topic each round; random picks rotate through everyone before anyone judges twice
- Games run for the host's number of rounds and end with final standings; the host can start a new game
- No topic repeats within a game; with custom topics off, the host sets the group's topic list (at least one per round)
- A notification bell for requests, kicks and bans, games starting and ending, your turn to judge, and each round's phases
- Song submissions through YouTube search
- Voting with a per-round vote budget, and round deadlines
- A reveal that names the judge and plays the winning video
- Scoring and round history
- Host election when the host leaves

## Tech stack

- **Frontend:** React, React Router, Vite, Socket.io client
- **Backend:** Node.js, Express, Socket.io, Postgres (`pg`) or SQLite (better-sqlite3), Helmet
- **Auth:** Google Identity Services, with server-signed session tokens
- **External API:** YouTube Data API v3
- **Testing:** Playwright, axe-core, Node test runner

## Running locally

```bash
cd server && npm install && npm start      # http://localhost:5000
cd web-app && npm install && npm run dev   # http://localhost:5173
```

The server starts without any configuration. Missing credentials put it in a degraded local mode (fixture search results, sign-in disabled) and it says so in the console. To enable Google sign-in and live YouTube search, copy `server/.env.example` to `server/.env` and `web-app/.env.example` to `web-app/.env`, then fill them in. Each example file explains where to get its values.

## Project structure

```
server/          Express + Socket.io backend, Postgres/SQLite storage, unit tests
web-app/         React frontend
web-app/e2e/     Playwright API and end-to-end suites
web-app/test/    Frontend unit tests
docs/            Discovery, design, and planning documents
implementation/  Issue specs and review notes
.design/         Feature design explorations
```

## How it was built

Built with Claude Code as a development accelerator. The planning, design, and review documents in `docs/`, `implementation/`, and `.design/` show how features moved from idea to implementation to review.
