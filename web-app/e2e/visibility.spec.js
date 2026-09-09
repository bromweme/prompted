import { test, expect } from '@playwright/test'
import { auditVisible, auditHover } from './a11y-audit.js'
import {
  createGroupThroughWizard, seedTestUser, testRunId, fillGroupName, goToNextWizardStep
} from './helpers.js'

// Site-wide sweep for elements that are present but cannot be seen.
// The probes themselves live in a11y-audit.js, shared with the modal sweep.

test.describe('site-wide element visibility', () => {
  // Not signed in on purpose: Login redirects an authenticated visitor away.
  test('the signed-out login page has no invisible controls', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Welcome to Prompted' })).toBeVisible()
    await auditVisible(page, 'login')
    await auditHover(page, 'login')
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

    for (const path of ['/dashboard', '/account', '/topics']) {
      await page.goto(path)
      await expect(page.getByRole('banner')).toBeVisible()
      await auditVisible(page, path)
      await auditHover(page, path)
    }
  })

  test('every step of the Create Group wizard has no invisible controls', async ({ page, context }) => {
    await seedTestUser(context, { id: `vis-wiz-${testRunId()}`, name: 'Visibility Checker' })

    await page.goto('/create-group')
    await auditVisible(page, 'wizard step 1 (Basics)')
    await auditHover(page, 'wizard step 1 (Basics)')

    await fillGroupName(page, `Visibility ${testRunId()}`)
    for (const heading of ['Game Rules', 'Override & Timing', 'Topics & Extras']) {
      await goToNextWizardStep(page, heading)
      await auditVisible(page, `wizard step: ${heading}`)
    }
  })

  test('every group tab and modal has no invisible controls', async ({ browser }) => {
    const runId = testRunId()
    // Two members, not one: starting a round needs a Judge plus a contestant,
    // so a solo group leaves Start Group disabled and the Judge modals
    // unreachable. This test previously created the group alone and so never
    // actually opened them.
    const host = await browser.newContext()
    await seedTestUser(host, { id: `vis-grp-${runId}`, name: 'Visibility Checker' })
    const page = await host.newPage()

    await createGroupThroughWizard(page, `Visibility Group ${runId}`)
    await expect(page).toHaveURL(/\/group\/.+/)
    await auditVisible(page, 'group overview')
    await auditHover(page, 'group overview')

    const groupId = page.url().split('/group/')[1]
    const guest = await browser.newContext()
    await seedTestUser(guest, { id: `vis-grp2-${runId}`, name: 'Second Player' })
    const guestPage = await guest.newPage()
    await guestPage.goto(`/group/${groupId}?join=true`)
    await expect(guestPage.locator('.group-info-card')).toBeVisible()

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
    await page.keyboard.press('Escape')

    // The Judge-selection prompt: modals whose controls were styled long
    // before anything actually rendered them.
    await page.getByRole('button', { name: 'Start Group' }).click()
    await expect(page.getByRole('heading', { name: 'Select Judge' })).toBeVisible()
    await auditVisible(page, 'select Judge modal')

    await page.getByRole('button', { name: /Pick Judge/ }).click()
    await expect(page.getByRole('heading', { name: 'Pick Judge' })).toBeVisible()
    await auditVisible(page, 'pick Judge modal')

    await host.close()
    await guest.close()
  })
})
