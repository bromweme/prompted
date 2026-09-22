import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// A fresh throwaway database per run, so tests never write into (or read
// leftovers from) the development database; before this, every run's groups
// piled up there by the thousands. It's set on process.env here, in the
// runner, so the server (via the webServer env below) and the test workers
// (which specs like event-log read the database from) all get the same path.
// A worker re-evaluating this file keeps the inherited value.
process.env.PROMPTED_DB_PATH ??= path.join(os.tmpdir(), `prompted-e2e-${Date.now()}.db`)

// With DATABASE_URL set, the server runs on Postgres instead (DB-1), which is
// how CI proves the driver production uses. Each run gets its own schema, so
// concurrent runs can share one database and a run can drop everything it made
// without touching anything else. PROMPTED_DB_PATH still applies: event-log
// specs read the event log, which is SQLite until DB-1 phase 3.
if (process.env.DATABASE_URL) {
  process.env.DATABASE_SCHEMA ??= `e2e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

const WEB_PORT = 5173
const API_PORT = 5000

// Specs that drive the server directly over socket.io and never open a page.
// The browser can't change their result, so they run once in the `api`
// project instead of once per browser project.
const API_SPECS = [
  '**/event-log.spec.js',
  '**/game-rules.spec.js',
  '**/host-election.spec.js',
  '**/host-leave.spec.js',
  '**/join-requests.spec.js',
  '**/judge-skip.spec.js',
  '**/open-groups.spec.js',
  '**/round-deadline.spec.js',
  '**/vote-budget.spec.js',
]

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Parallelism is at file level (fullyParallel stays off): tests within a
  // file share carefully sequenced state — a round's phases, a group's
  // members — and running those against each other buys nothing.
  // Many spec files x 4 browser projects gives plenty of independent jobs,
  // so workers scale well past the file count.
  //
  // 4, not the 6-8 the wall clock alone would suggest. The heaviest tests
  // drive three browser contexts each, and several of those in flight at once
  // starved WebKit enough that clicks timed out waiting for an element to be
  // "visible, enabled and stable" — a machine-load failure, not a real one.
  // 6 workers cost ~2 failures per 5 full runs for ~7% less wall clock.
  fullyParallel: false,
  workers: Number(process.env.PW_WORKERS) || 4,
  // Kept at 0 deliberately: a retry would paper over exactly the flakiness
  // this parallelism could introduce, so failures must stay visible.
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    // Server-level specs, run once. No device or browser settings apply.
    { name: 'api', testMatch: API_SPECS },
    { name: 'chromium', testIgnore: API_SPECS, use: { ...devices['Desktop Chrome'] } },
    // Mobile viewport coverage — same suites, narrow screen + touch input.
    // Pixel 7 is Chromium-based, so this isolates the variable to
    // viewport/touch rather than also swapping the rendering engine
    // (iPhone presets would pull in WebKit).
    { name: 'mobile-chrome', testIgnore: API_SPECS, use: { ...devices['Pixel 7'] } },
    // WebKit coverage at both widths. WebKit is the engine behind Safari and
    // every iOS browser, and it's where engine-specific breakage actually
    // shows up (CSS support gaps, JS API differences) — Chromium desktop and
    // Chromium mobile only vary the viewport.
    { name: 'webkit', testIgnore: API_SPECS, use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-safari', testIgnore: API_SPECS, use: { ...devices['iPhone 14'] } },
  ],
  // Boots the real backend (server.js) and the real Vite dev server so the
  // suite exercises actual socket.io traffic end to end — no mocking. Both
  // are torn down after the run. If they're already running locally
  // (reuseExistingServer, non-CI only), those are reused instead.
  webServer: [
    {
      command: 'node server.js',
      cwd: path.resolve(__dirname, '../server'),
      url: `http://localhost:${API_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      // Sockets authenticate at the handshake, so the suite needs a way to
      // establish identities without a live Google round trip (which would
      // need real credentials and couldn't run offline). AUTH_TEST_MODE lets
      // the server accept a plain { userId, name } — and the server refuses
      // to boot at all with this set while NODE_ENV=production.
      env: {
        ...process.env,
        AUTH_TEST_MODE: '1',
        // Blanked deliberately. The env spread above inherits the developer's
        // real YOUTUBE_API_KEY, which pointed the suite at the live API: every
        // search test spent 100 of the 10,000 daily quota units and asserted
        // against whatever YouTube happened to return that day. Empty here
        // selects the fixture list in server/youtube.js, so search tests are
        // deterministic, offline-capable and free.
        YOUTUBE_API_KEY: '',
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: __dirname,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
})
