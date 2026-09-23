import { test, expect } from '@playwright/test'
import { auditVisible, auditHover, auditFocus } from './a11y-audit.js'
import {
  createGroupThroughWizard,
  seedTestUser,
  testRunId,
  fillGroupName,
  goToNextWizardStep,
  joinGroupAs,
} from './helpers.js'

// Site-wide sweep for elements that are present but cannot be seen.
// The probes themselves live in a11y-audit.js, shared with the modal sweep.

// Run in both colour schemes. The hover audit is the reason this matters: a
// :hover rule that repaints a background without re-asserting the text colour
// fails differently in each theme, and dark mode redefines every colour the
// hover states are built from.
for (const colorScheme of ['light', 'dark']) {
  test.describe(`site-wide element visibility — ${colorScheme}`, () => {
    test.use({ colorScheme })
    // Not signed in on purpose: Login redirects an authenticated visitor away.
    test('the signed-out login page has no invisible controls', async ({ page }) => {
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Welcome to Prompted' })).toBeVisible()
      // Google's script injects the sign-in button asynchronously, so without
      // this the focus audit sometimes ran before the button existed and
      // sometimes after — the same test passing or failing on network timing.
      // Bounded: with no client id configured, or no network, the widget never
      // arrives and the rest of the page is still worth auditing.
      await page.locator('.google-signin-slot [tabindex], .google-signin-slot iframe')
        .first()
        .waitFor({ state: 'attached', timeout: 5_000 })
        .catch(() => {})
      await auditVisible(page, 'login')
      await auditHover(page, 'login')
      await auditFocus(page, 'login')
    })

    test('top-level signed-in pages have no invisible controls', async ({ page, context }) => {
      const runId = testRunId()
      await seedTestUser(context, { id: `vis-${runId}`, name: 'Visibility Checker' })

      // The topics page only grows its per-item Edit/Delete controls once a
      // topic exists — an empty library audits nothing, which is how their
      // hover state went unchecked in the first place.
      await page.goto('/topics')
      await page.getByRole('button', { name: 'Add new theme idea' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('textbox').first().fill(`Visibility topic ${runId}`)
      await dialog.getByRole('button', { name: /Add Theme|Save/ }).click()
      await expect(page.getByText(`Visibility topic ${runId}`)).toBeVisible({ timeout: 15_000 })
      await expect(page.locator('.action-button.edit')).toBeVisible()

      for (const path of ['/dashboard', '/open-groups', '/account', '/topics']) {
        await page.goto(path)
        await expect(page.getByRole('banner')).toBeVisible()
        await auditVisible(page, path)
        await auditHover(page, path)
        await auditFocus(page, path)
      }
    })

    test('every step of the Create Group wizard has no invisible controls', async ({ page, context }) => {
      await seedTestUser(context, { id: `vis-wiz-${testRunId()}`, name: 'Visibility Checker' })

      await page.goto('/create-group')
      await auditVisible(page, 'wizard step 1 (Basics)')
      await auditHover(page, 'wizard step 1 (Basics)')
      await auditFocus(page, 'wizard step 1 (Basics)')

      await fillGroupName(page, `Visibility ${testRunId()}`)
      for (const heading of ['Game Rules', 'Override & Timing', 'Extras']) {
        await goToNextWizardStep(page, heading)
        await auditVisible(page, `wizard step: ${heading}`)
      }
    })

    test('every group tab and modal has no invisible controls', async ({ browser }) => {
      const runId = testRunId()
      // Two members, not one: starting a round needs a Judge plus a contestant,
      // so a solo group leaves Start Round disabled and the Judge modals
      // unreachable. This test previously created the group alone and so never
      // actually opened them.
      const host = await browser.newContext()
      await seedTestUser(host, { id: `vis-grp-${runId}`, name: 'Visibility Checker' })
      const page = await host.newPage()

      await createGroupThroughWizard(page, `Visibility Group ${runId}`)
      await expect(page).toHaveURL(/\/group\/.+/)
      await auditVisible(page, 'group overview')
      await auditHover(page, 'group overview')
      await auditFocus(page, 'group overview')

      const guest = await browser.newContext()
      await seedTestUser(guest, { id: `vis-grp2-${runId}`, name: 'Second Player' })
      const guestPage = await guest.newPage()
      await joinGroupAs(guestPage, page, 2)

      for (const tab of ['Participants', 'History', 'Rules']) {
        await page.getByRole('button', { name: tab, exact: true }).click()
        await auditVisible(page, `group ${tab} tab`)
      }

      // The rules editor is the largest form in the app.
      await page.getByRole('button', { name: 'Edit Rules' }).click()
      await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible()
      await auditVisible(page, 'rules editor')
      await page.getByRole('button', { name: 'Cancel' }).click()

      // Modals are the white-on-white case that started all this.
      await page.getByRole('button', { name: 'Overview', exact: true }).click()
      await page.getByRole('button', { name: 'Invite players to group' }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await auditVisible(page, 'invite modal')
      await auditHover(page, 'invite modal')
      await auditFocus(page, 'invite modal')
      await page.keyboard.press('Escape')

      // The Judge-selection prompt: modals whose controls were styled long
      // before anything actually rendered them.
      await page.getByRole('button', { name: 'Start Round', exact: true }).click()
      await expect(page.getByRole('heading', { name: 'Select Judge' })).toBeVisible()
      await auditVisible(page, 'select Judge modal')

      await page.getByRole('button', { name: /Pick Judge/ }).click()
      await expect(page.getByRole('heading', { name: 'Pick Judge' })).toBeVisible()
      await auditVisible(page, 'pick Judge modal')

      await host.close()
      await guest.close()
    })
  })
}
