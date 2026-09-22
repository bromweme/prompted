// Shared helpers for signing in and driving the Create Group wizard from tests.
import { expect } from '@playwright/test'
import { io } from 'socket.io-client'

export const API_URL = 'http://localhost:5000'

/**
 * A collision-proof suffix for per-test identities, group names and topics.
 *
 * A bare Date.now() is not enough once the suite runs in parallel: the same
 * test executes in four projects at once with the same id prefix, so two of
 * them can land on the same millisecond and end up sharing a user account —
 * and therefore a profile and a topic library. The random tail removes that.
 */
export function testRunId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Seeds a test identity into a browser context before the app boots.
 *
 * Real sign-in goes through Google Identity Services, which the suite can't
 * drive: it needs live credentials, a real Google account, and network. So the
 * client reads a `testUser` from localStorage (dev builds only) and presents
 * it on the socket handshake, and the server accepts it only when
 * AUTH_TEST_MODE=1 and NODE_ENV is not production — see server/auth.js.
 * The identity is still established server-side, so everything downstream
 * exercises the real authenticated path.
 */
export async function seedTestUser(context, { id, name, avatar = '🎵' }) {
  // `avatar` decides whether this identity looks like a first-time player.
  // The default is a set-up profile, so ordinary tests land straight on the
  // Dashboard; pass avatar: null to get the first-time setup modal.
  await context.addInitScript((user) => {
    window.localStorage.setItem('testUser', JSON.stringify(user))
  }, { userId: id, name, email: `${id}@example.com`, avatar })
}

/**
 * Picks a video through the real YouTube search UI. With no YOUTUBE_API_KEY
 * configured the server serves a fixed fixture list (see server/youtube.js),
 * so this exercises the search -> select -> submit path without spending any
 * of the 10,000/day quota.
 */
export async function submitVideoThroughSearch(page, query = 'queen') {
  await page.getByRole('button', { name: 'Submit Video' }).click()

  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Search for a video').fill(query)

  // The search box debounces by 450ms before it emits, so the first result
  // only appears after that plus a round trip.
  const firstResult = dialog.getByRole('button', { name: /.+/ }).filter({ has: page.locator('img') }).first()
  await expect(firstResult).toBeVisible({ timeout: 15_000 })

  const title = (await firstResult.locator('.youtube-result-title').textContent()).trim()
  await firstResult.click()

  await dialog.getByRole('button', { name: 'Submit Video', exact: true }).click()
  return title
}

/**
 * A round now opens in its topic-selection phase: the Round Leader picks a
 * topic before the submission clock starts. Call this on whichever page is
 * the Leader. Falls back to writing a topic when the library is empty, which
 * is also the path a brand-new group takes.
 */
export async function selectTopicAsJudge(page, text = "A song you can't stop replaying") {
  const picker = page.locator('.topic-picker')
  await expect(picker).toBeVisible()

  const existing = picker.locator('.topic-option')
  if (await existing.count() === 0) {
    await picker.getByLabel('Or write a new one').fill(text)
    await picker.getByRole('button', { name: 'Add to my topics' }).click()
    await expect(existing.first()).toBeVisible({ timeout: 15_000 })
  }

  await existing.first().click()
  // The picker disappears once the round moves into its submission phase.
  await expect(picker).toBeHidden({ timeout: 15_000 })
}

/**
 * Starts a round (the first one or any later one) through the Judge-selection
 * prompt the host now always sees. Pass a player name to hand-pick that
 * player as Judge; omit it for a random assignment.
 */
export async function startRoundAsHost(page, { pickPlayer } = {}) {
  const startButton = page.getByRole('button', { name: /^(Start Group|Start Round|Start Next Round)$/ })
  await startButton.first().click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Select Judge' })).toBeVisible()

  if (pickPlayer) {
    await dialog.getByRole('button', { name: /Pick Judge/ }).click()
    const picker = page.getByRole('dialog')
    await expect(picker.getByRole('heading', { name: 'Pick Judge' })).toBeVisible()
    await picker.getByRole('button', { name: new RegExp(pickPlayer) }).click()
  } else {
    await dialog.getByRole('button', { name: /Randomly Assign/ }).click()
  }

  await expect(page.getByRole('dialog')).toHaveCount(0)
}

/**
 * Returns the index of the player who is this round's Judge, identified by
 * being the only one shown the topic picker.
 *
 * Polls rather than reading counts once: the round's topic_selection state
 * arrives by broadcast, so an immediate check can land before any page has
 * rendered the picker.
 */
export async function waitForJudgeIndex(pages) {
  let index = -1
  await expect(async () => {
    const counts = await Promise.all(pages.map((page) => page.locator('.topic-picker').count()))
    index = counts.findIndex((n) => n > 0)
    expect(index, 'no player is showing the topic picker yet').toBeGreaterThanOrEqual(0)
  }).toPass({ timeout: 15_000 })
  return index
}

const WIZARD_STEP_HEADINGS = ['Basics', 'Game Rules', 'Override & Timing', 'Extras']

export async function fillGroupName(page, groupName) {
  const field = page.getByLabel('Group Name')
  // The field carries autoFocus, and on WebKit that deferred focus can land
  // after the fill and drop it — the field stays empty, Next stays disabled,
  // and the next step's click burns the full 60s timeout. Filling until the
  // value actually sticks turns a lost keystroke into a quick retry.
  await expect(async () => {
    await field.fill(groupName)
    await expect(field).toHaveValue(groupName, { timeout: 1_000 })
  }).toPass({ timeout: 15_000 })
}

// Clicking Next moves focus to the new step's heading (an accessibility
// requirement — screen reader users need the announcement), which scrolls
// it into view. Waiting for that heading to be visible before returning
// avoids racing that transition on the very next action.
export async function goToNextWizardStep(page, expectHeading) {
  await page.getByRole('button', { name: 'Next' }).click()
  if (expectHeading) {
    await expect(page.getByRole('heading', { name: expectHeading, level: 2 })).toBeVisible()
  }
}

// Navigates to /create-group, fills the required Basics field, and advances
// through every intermediate step (defaults left untouched), landing on the
// final step without submitting.
export async function advanceToFinalWizardStep(page, groupName) {
  await page.goto('/create-group')
  await fillGroupName(page, groupName)
  await goToNextWizardStep(page, WIZARD_STEP_HEADINGS[1]) // Basics -> Game Rules
  await goToNextWizardStep(page, WIZARD_STEP_HEADINGS[2]) // Game Rules -> Override & Timing
  await goToNextWizardStep(page, WIZARD_STEP_HEADINGS[3]) // Override & Timing -> Extras
}

// Full flow: create a group with default settings beyond the name.
export async function createGroupThroughWizard(page, groupName) {
  await advanceToFinalWizardStep(page, groupName)
  await page.getByRole('button', { name: 'Create Group' }).click()
}

/**
 * A raw, authenticated socket.io client for the same test identity seam the
 * browser uses. `ready` resolves with the server's session payload.
 */
export function connectAs(id, name = 'Test Player') {
  const socket = io(API_URL, {
    transports: ['websocket'], forceNew: true, reconnection: false,
    auth: { testUser: { userId: id, name, avatar: '🎵' } }
  })
  const ready = new Promise((resolve, reject) => {
    socket.once('session', resolve)
    socket.once('connect_error', reject)
  })
  return { id, socket, ready }
}

/**
 * A group's invite code (UI-2), read as one of its members over a short-lived
 * raw socket. Uses get_groups rather than get_group on purpose: get_group
 * re-points the member's broadcast socket at the caller, which would starve
 * that member's open browser page of live updates.
 */
export async function inviteCodeFor(memberId, groupId) {
  const member = connectAs(memberId)
  try {
    await member.ready
    const listed = new Promise((resolve) => member.socket.once('groups_list', resolve))
    member.socket.emit('get_groups')
    const { groups } = await listed
    const group = groups.find((g) => g.id === groupId)
    if (!group) throw new Error(`${memberId} is not a member of ${groupId}`)
    // A pre-UI-2 group has no inviteCode; its id is its code.
    return group.inviteCode || group.id
  } finally {
    member.socket.close()
  }
}

/**
 * The /join/<code> path for the group a signed-in page is currently showing,
 * read as that page's own test identity. Replaces the old
 * `/group/<id>?join=true` pattern, which no longer joins a new group because
 * its id is not its invite code.
 */
export async function inviteJoinPath(memberPage) {
  const groupId = new URL(memberPage.url()).pathname.split('/group/')[1]
  if (!groupId) throw new Error(`not on a group page: ${memberPage.url()}`)
  const memberId = await memberPage.evaluate(() => JSON.parse(window.localStorage.getItem('testUser')).userId)
  return `/join/${await inviteCodeFor(memberId, groupId)}`
}
