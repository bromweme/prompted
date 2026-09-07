// Shared helpers for signing in and driving the Create Group wizard from tests.
import { expect } from '@playwright/test'

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
export async function seedTestUser(context, { id, name }) {
  await context.addInitScript((user) => {
    window.localStorage.setItem('testUser', JSON.stringify(user))
  }, { userId: id, name, email: `${id}@example.com` })
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

const WIZARD_STEP_HEADINGS = ['Basics', 'Game Rules', 'Override & Timing', 'Topics & Extras']

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
  await goToNextWizardStep(page, WIZARD_STEP_HEADINGS[3]) // Override & Timing -> Topics & Extras
}

// Full flow: create a group with default settings beyond the name.
export async function createGroupThroughWizard(page, groupName) {
  await advanceToFinalWizardStep(page, groupName)
  await page.getByRole('button', { name: 'Create Group' }).click()
}
