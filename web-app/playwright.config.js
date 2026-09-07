import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const WEB_PORT = 5173
const API_PORT = 5000

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // Mobile viewport coverage — same suites, narrow screen + touch input.
    // Pixel 7 is Chromium-based, so this isolates the variable to
    // viewport/touch rather than also swapping the rendering engine
    // (iPhone presets would pull in WebKit).
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    // WebKit coverage at both widths. WebKit is the engine behind Safari and
    // every iOS browser, and it's where engine-specific breakage actually
    // shows up (CSS support gaps, JS API differences) — Chromium desktop and
    // Chromium mobile only vary the viewport.
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
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
      env: { ...process.env, AUTH_TEST_MODE: '1' },
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
