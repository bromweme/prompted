import { test, expect } from '@playwright/test'
import { seedTestUser, testRunId } from './helpers.js'

// The header on a phone.
//
// Two faults, one cause. `Account.css`, `CreateGroup.css` and `ThemeIdeas.css`
// each still carried their own `.header-content` and `.header-content h1`
// rules from before the header was extracted into AppNav. No page renders that
// markup any more, but CSS is global, so those leftovers kept overriding the
// shared header everywhere — `.header-content h1` outranks `.logo h1`, and the
// gap stayed at 2rem.
//
// At 375px that meant 402px of content in 343px of space, so the bell, avatar
// and Logout wrapped onto a row of their own, left-aligned under the logo. And
// because the panel is anchored to the bell and is wider than the space to its
// right, opening notifications put "Clear all" and the Open links off the left
// edge of the screen entirely.
//
// Geometry checks rather than screenshots: they say which measurement moved.

test.use({ viewport: { width: 375, height: 812 } })

test.describe('header layout on a phone', () => {
  test('the logo and the account controls stay on one row', async ({ page, context }) => {
    await seedTestUser(context, { id: `hdr-${testRunId()}`, name: 'Header Tester' })
    await page.goto('/dashboard')

    const logo = await page.locator('.logo').boundingBox()
    const controls = await page.locator('.user-section').boundingBox()

    // Overlapping vertical extents means one row; the wrapped version put them
    // ~45px apart with no overlap at all.
    const sharesARow = logo.y < controls.y + controls.height && controls.y < logo.y + logo.height
    expect(sharesARow, `logo at y=${logo.y} and controls at y=${controls.y} are on different rows`).toBe(true)

    // The controls sit at the right-hand end, not adrift on the left.
    const viewport = page.viewportSize().width
    expect(controls.x + controls.width).toBeGreaterThan(viewport * 0.6)
  })

  test('nothing pushes the page sideways', async ({ page, context }) => {
    await seedTestUser(context, { id: `hdr-of-${testRunId()}`, name: 'Header Tester' })
    await page.goto('/dashboard')

    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      view: window.innerWidth
    }))
    expect(overflow.doc, 'the page scrolls horizontally on a phone').toBeLessThanOrEqual(overflow.view)
  })

  test('the notification panel opens fully on screen', async ({ page, context }) => {
    await seedTestUser(context, { id: `hdr-bell-${testRunId()}`, name: 'Header Tester' })
    await page.goto('/dashboard')

    await page.getByRole('button', { name: 'Notifications' }).click()
    const panel = page.locator('.notification-panel')
    await expect(panel).toBeVisible()

    const box = await panel.boundingBox()
    const viewport = page.viewportSize().width
    expect(box.x, 'the panel starts off the left of the screen').toBeGreaterThanOrEqual(0)
    expect(box.x + box.width, 'the panel runs off the right of the screen').toBeLessThanOrEqual(viewport)
    // Wide enough to still be the panel rather than a squeezed column.
    expect(box.width).toBeGreaterThan(viewport * 0.7)
  })
})
