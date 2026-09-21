# Prompted

A real-time multiplayer music game. Each round, one player picks a topic, everyone else submits a song that fits it, and the group votes on the best pick. The round's judge stays anonymous until the reveal, when the winning video plays for everyone.

Built with React, Node.js/Express, Socket.io, and SQLite, and tested end to end with Playwright.

## Testing

The test suite is the main focus of this repository. Tests are split into layers, so each check runs at the lowest level that can prove it:

| Layer | Tests | Runs | Tool |
|---|---|---|---|
| **Unit** (backend and frontend logic) | 15 | once | Node test runner |
| **API** (game rules, driven over socket.io with no browser) | 41 | once | Playwright `api` project |
| **End-to-end** (real browsers) | 74 | x 4 projects | Playwright |

That's **337 Playwright runs per suite**, plus the unit tests. The end-to-end tests run across four browser/device projects:

| Project | Engine | Viewport |
|---|---|---|
| `chromium` | Chrome | Desktop |
| `mobile-chrome` | Chrome | Pixel 7 (touch) |
| `webkit` | Safari's WebKit | Desktop |
| `mobile-safari` | Safari's WebKit | iPhone 14 (touch) |

The projects form a 2x2 grid of engine and screen size, so a failure in one cell points at either a browser difference or a layout/touch difference. The mobile projects are emulated mobile browsers, not native apps. Tests that never open a page run once in the `api` project instead, since the browser can't change their result.

Every push runs all of it on GitHub Actions, with each Playwright project as its own parallel job.

### What the suite covers

- **Full multiplayer rounds.** Tests open separate browser contexts to act as independent players in the same game, then drive a round from start to finish: joining a group, choosing a topic, submitting a song, voting, and the reveal.
- **Live updates.** When one player acts, tests confirm the other players' open pages update without a refresh.
- **What the server sends, not just what the screen shows.** Tests listen to the raw WebSocket traffic and check that the judge's identity never appears in any message before the reveal, even though the UI already hides it.
- **Accessibility.** Pages are checked against WCAG 2.1 AA with axe-core, including hover states. Tests locate elements by role and accessible name (`getByRole`, `getByLabel`), so an unlabeled control fails the test.
- **Game rules, at the API level.** Round deadlines, per-round vote budgets, judge skips, and host election when a host leaves, tested by driving the server directly over socket.io.
- **Logic and styling guards, at the unit level.** Time-window conversions round-trip exactly, and no stylesheet references an undefined CSS token or restyles a shared button app-wide.

### Design choices

- **Real backend, no mocks.** Playwright boots the actual server and the Vite dev server before the run and tears them down afterward, so tests exercise real Socket.io traffic.
- **Deterministic data.** Tests use fixture results instead of the live YouTube API. Results are the same on every run, and runs cost no API quota and work offline.
- **Test-only sign-in.** A test mode lets the suite create players without going through Google. The server refuses to start with it enabled in production.
- **Zero retries, on purpose.** A flaky test fails visibly instead of passing on a second try. Traces are kept for every failure (`retain-on-failure`) so failures can be stepped through afterward.
- **Tuned parallelism.** Four workers, parallel by file. Higher worker counts overloaded WebKit and produced timeouts caused by machine load rather than real bugs.

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
- Sign in with Google, with a profile name and avatar
- An anonymous judge, randomly assigned each round, who picks the topic
- Song submissions through YouTube search
- Voting with a per-round vote budget, and round deadlines
- A reveal that names the judge and plays the winning video
- Scoring and round history
- Host election when the host leaves

## Tech stack

- **Frontend:** React, React Router, Vite, Socket.io client
- **Backend:** Node.js, Express, Socket.io, SQLite (better-sqlite3), Helmet
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
server/          Express + Socket.io backend, SQLite storage, unit tests
web-app/         React frontend
web-app/e2e/     Playwright API and end-to-end suites
web-app/test/    Frontend unit tests
docs/            Discovery, design, and planning documents
implementation/  Issue specs and review notes
.design/         Feature design explorations
```

## How it was built

Built with Claude Code as a development accelerator. The planning, design, and review documents in `docs/`, `implementation/`, and `.design/` show how features moved from idea to implementation to review.
