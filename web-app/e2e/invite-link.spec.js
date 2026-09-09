import { test, expect } from '@playwright/test'
import { createGroupThroughWizard, seedTestUser, testRunId } from './helpers.js'

// Guards the invite modal's copy-to-clipboard confirmation. Two traps make
// this test easy to write wrongly, so both are handled explicitly below.
test('invite modal confirms a successful copy, then reverts', async ({ page, context, browserName }) => {
  // Trap 1: under a default Chromium context navigator.clipboard.writeText
  // rejects with NotAllowedError, which sends handleCopyInviteLink down its
  // catch branch into a blocking alert() — the run then hangs rather than
  // failing cleanly. WebKit resolves without a grant, and grantPermissions
  // rejects 'clipboard-write' as an unknown permission there, so this is
  // deliberately Chromium-only.
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-write'])
  }

  await seedTestUser(context, { id: `invite-${testRunId()}`, name: 'Invite Tester' })

  await createGroupThroughWizard(page, `Invite Link Group ${testRunId()}`)
  await expect(page).toHaveURL(/\/group\/.+/)

  await page.getByRole('button', { name: 'Invite players to group' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // Trap 2: the button's accessible name is what changes, so a name-based
  // locator stops matching at the exact moment the assertion cares about
  // ("Copied!" does not contain "Copy"). Locate it structurally instead.
  const copyButton = dialog.locator('button.submit-button')
  await expect(copyButton).toHaveText('Copy Link')

  await copyButton.click()
  await expect(copyButton).toHaveText('Copied!')

  // The confirmation is on a 2s timer and must clear itself afterwards.
  await expect(copyButton).toHaveText('Copy Link', { timeout: 5_000 })
})
