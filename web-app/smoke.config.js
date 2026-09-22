import { defineConfig } from '@playwright/test'

/**
 * Smoke checks against a DEPLOYED site, not localhost.
 *
 * The main suite boots its own server and its own database and proves the
 * game's rules. It never looks at production, so a deploy can be broken —
 * wrong environment variable, frontend pointed at the wrong backend, an
 * instance that never wakes — while CI stays green. These checks cover that
 * gap and nothing else.
 *
 * They deliberately do NOT play a game: production refuses test-mode
 * sign-in by design, so there is no way to create a player without real
 * Google credentials. What they prove is that the deploy is alive,
 * correctly wired, and still refusing what it should refuse.
 *
 *   SMOKE_WEB_URL=https://<web>.onrender.com \
 *   SMOKE_API_URL=https://<api>.onrender.com \
 *   npm run test:smoke
 */

const webUrl = process.env.SMOKE_WEB_URL
const apiUrl = process.env.SMOKE_API_URL

if (!webUrl || !apiUrl) {
  throw new Error(
    'Smoke checks need SMOKE_WEB_URL and SMOKE_API_URL set to the deployed URLs.\n' +
    'Example: SMOKE_WEB_URL=https://prompted-web.onrender.com SMOKE_API_URL=https://prompted-api.onrender.com npm run test:smoke'
  )
}

export default defineConfig({
  testDir: './smoke',
  // A free instance that has gone to sleep can take about a minute to answer
  // the first request, and that IS the case worth covering, so the timeouts
  // are generous rather than tight.
  timeout: 120_000,
  expect: { timeout: 90_000 },
  // Smoke runs against one shared deployment; parallel workers would just
  // race each other through the same cold start.
  workers: 1,
  fullyParallel: false,
  // A flake here means a real user saw it too.
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: webUrl,
    trace: 'retain-on-failure',
    ignoreHTTPSErrors: false
  },
  metadata: { webUrl, apiUrl }
})
