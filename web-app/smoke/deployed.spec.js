import { test, expect } from '@playwright/test'
import { io } from 'socket.io-client'

// Smoke checks against the deployed site. See smoke.config.js for why these
// exist and what they deliberately don't cover.

const API_URL = process.env.SMOKE_API_URL
const WEB_URL = process.env.SMOKE_WEB_URL

/** Connects a raw socket and resolves with how it went, without throwing. */
function tryConnect(auth, timeoutMs = 60_000) {
  return new Promise((resolve) => {
    const socket = io(API_URL, {
      transports: ['websocket'], forceNew: true, reconnection: false, timeout: timeoutMs, auth
    })
    const done = (result) => {
      socket.close()
      resolve(result)
    }
    socket.once('session', (session) => done({ connected: true, session }))
    socket.once('connect', () => setTimeout(() => done({ connected: true, session: null }), 2_000))
    socket.once('connect_error', (error) => done({ connected: false, message: error.message }))
    setTimeout(() => done({ connected: false, message: 'timed out' }), timeoutMs)
  })
}

test('the backend answers its health check', async ({ request }) => {
  // Also the wake-up call: a sleeping instance answers this one slowly and
  // everything after it quickly.
  const startedAt = Date.now()
  const response = await request.get(`${API_URL}/`, { timeout: 90_000 })
  const elapsed = Date.now() - startedAt

  expect(response.status()).toBe(200)
  expect(await response.json()).toEqual({ status: 'ok' })
  console.log(`  backend answered in ${elapsed}ms${elapsed > 5_000 ? ' (cold start)' : ''}`)
})

test('the websocket layer is reachable and refuses anonymous connections', async () => {
  const result = await tryConnect({})
  // AUTH_REQUIRED is the server's own refusal, which proves the socket layer
  // is up: a dead backend or a proxy that drops websockets fails differently.
  expect(result.connected, 'an unauthenticated socket must not connect').toBe(false)
  expect(result.message).toBe('AUTH_REQUIRED')
})

test('production refuses test-mode sign-in', async () => {
  // The suite signs in by handing the server a plain object. If a deploy ever
  // ships with AUTH_TEST_MODE enabled, anyone could become anyone, so this is
  // the one security assertion worth making from outside.
  const result = await tryConnect({
    testUser: { userId: `smoke-${Date.now()}`, name: 'Smoke Check', avatar: '🎵' }
  })
  expect(result.connected, 'test-mode sign-in must be refused in production').toBe(false)
  expect(result.message).toMatch(/AUTH_REQUIRED|AUTH_FAILED/)
})

test('the web app loads and renders its sign-in page', async ({ page }) => {
  const failed = []
  page.on('requestfailed', (request) => failed.push(`${request.url()} — ${request.failure()?.errorText}`))
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.goto('/', { waitUntil: 'domcontentloaded' })

  // React actually booted, rather than serving an empty shell or a build error.
  await expect(page.locator('#root')).not.toBeEmpty()
  await expect(page.getByRole('heading', { level: 1, name: 'Prompted' })).toBeVisible()

  expect(failed, `failed requests:\n${failed.join('\n')}`).toEqual([])
  // Google's own script is noisy when third-party cookies are blocked; only
  // the app's own errors should fail this.
  const ourErrors = consoleErrors.filter((text) => !/accounts\.google\.com|gsi|third-party cookie/i.test(text))
  expect(ourErrors, `console errors:\n${ourErrors.join('\n')}`).toEqual([])
})

test('the deployed frontend is built against the deployed backend', async ({ page, request }) => {
  // Catches the deploy that builds fine but still points at localhost, or at
  // another environment's API — which no other check in this repo would see.
  //
  // It reads the shipped bundle rather than watching for a socket: the app
  // only opens one after sign-in, and smoke can't sign in. VITE_SOCKET_URL is
  // inlined at build time, so the built JS is where the answer actually is.
  // This means the check is meaningful against a real build; against a dev
  // server (unbundled modules) it is skipped rather than made up.
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  const scripts = await page.locator('script[src]').evaluateAll((nodes) => nodes.map((n) => n.src))
  const bundles = scripts.filter((src) => src.startsWith(WEB_URL) && /\/assets\/.*\.js$/.test(src))
  test.skip(bundles.length === 0, 'no built bundle on this target (dev server?)')

  const apiOrigin = new URL(API_URL).origin
  let sawApiOrigin = false
  const localhostRefs = []

  for (const src of bundles) {
    const body = await (await request.get(src)).text()
    if (body.includes(apiOrigin)) sawApiOrigin = true
    for (const match of body.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+/g)) {
      localhostRefs.push(match[0])
    }
  }

  expect(sawApiOrigin, `no reference to ${apiOrigin} in the shipped bundle — the frontend is pointed somewhere else`).toBe(true)
  expect([...new Set(localhostRefs)], 'the shipped bundle still points at a local address').toEqual([])
})
