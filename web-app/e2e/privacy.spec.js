import { test, expect } from '@playwright/test'
import { createGroupThroughWizard, seedTestUser, testRunId, joinGroupAs, inviteJoinPath } from './helpers.js'

// PRIV-1. The sign-in screen used to tell everyone they agreed to a privacy
// policy and terms of service that did not exist, and the Delete Account
// button showed "coming soon". These cover the two halves of fixing that: the
// policy is real and reachable, and deletion actually deletes.

async function newPlayer(browser, { id, name }) {
  const context = await browser.newContext()
  await seedTestUser(context, { id, name })
  const page = await context.newPage()
  return { context, page, name }
}

async function addTopic(page, text) {
  await page.goto('/topics')
  await page.getByRole('button', { name: 'Add new theme idea' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').first().fill(text)
  await dialog.getByRole('button', { name: /Add Theme|Save/ }).click()
  await expect(page.getByText(text)).toBeVisible({ timeout: 15_000 })
}

// Fills the confirmation and presses the button, from the Account page.
async function deleteAccountThroughUi(page) {
  await page.goto('/account')
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Delete Account' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Delete Account' })).toBeVisible()

  const confirmButton = dialog.getByRole('button', { name: 'Delete my account' })
  await expect(confirmButton).toBeDisabled()

  await dialog.getByLabel(/Type DELETE to confirm/).fill('DELETE')
  await expect(confirmButton).toBeEnabled()
  await confirmButton.click()

  // Deletion signs the player out, which lands them back on the sign-in screen.
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
}

test.describe('privacy policy', () => {
  test('the policy is readable without an account, because the sign-in screen links to it', async ({ page }) => {
    // Signed out on purpose: no seedTestUser. A policy behind a login is
    // useless to someone deciding whether to sign up.
    await page.goto('/privacy')

    await expect(page.getByRole('heading', { name: 'Privacy Policy', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Deleting your account' })).toBeVisible()
    await expect(page).toHaveURL(/\/privacy/)
  })

  test('the sign-in screen links to the policy instead of naming documents that do not exist', async ({ page }) => {
    await page.goto('/')

    const footer = page.locator('.login-footer')
    await expect(footer).toBeVisible()

    // The old copy promised a Terms of Service too. There isn't one, so it
    // must not be claimed.
    await expect(footer).not.toContainText('Terms of Service')

    const link = footer.getByRole('link', { name: 'Privacy Policy' })
    await expect(link).toBeVisible()
    await link.click()
    await expect(page.getByRole('heading', { name: 'Privacy Policy', level: 1 })).toBeVisible()
  })
})

test.describe('account deletion', () => {
  test('deleting an account removes the profile and its topics, and signs the player out', async ({ browser }) => {
    const runId = testRunId()
    const me = await newPlayer(browser, { id: `del-solo-${runId}`, name: 'Deleting Player' })
    const topic = `Doomed topic ${runId}`

    await addTopic(me.page, topic)

    await deleteAccountThroughUi(me.page)

    // Signing in again with the same identity gives a fresh, empty account
    // rather than restoring the old one — the policy says exactly this.
    const again = await newPlayer(browser, { id: `del-solo-${runId}`, name: 'Deleting Player' })
    await again.page.goto('/topics')
    await expect(again.page.getByText(topic)).toHaveCount(0)

    await me.context.close()
    await again.context.close()
  })

  test('a group the deleted player hosted alone goes with them', async ({ browser }) => {
    const runId = testRunId()
    const me = await newPlayer(browser, { id: `del-host-${runId}`, name: 'Sole Host' })

    await createGroupThroughWizard(me.page, `Solo Group ${runId}`)
    await expect(me.page).toHaveURL(/\/group\/.+/)

    // Captured before deletion, because it is the only assertion that can tell
    // "the group is gone" from "you are not in it". Visiting the group URL
    // cannot: UI-2 deliberately shows a non-member the same page a missing
    // group gives, so that a stranger learns nothing either way. An invite
    // link is different — a group that still existed would admit them.
    const joinPath = await inviteJoinPath(me.page)

    await deleteAccountThroughUi(me.page)

    const stranger = await newPlayer(browser, { id: `del-stranger-${runId}`, name: 'Stranger' })
    await stranger.page.goto(joinPath)

    await expect(stranger.page.locator('.group-info-card')).toHaveCount(0)
    await expect(
      stranger.page.getByRole('heading', { name: /not a member of this group|Couldn't join this group/ })
    ).toBeVisible({ timeout: 15_000 })

    await me.context.close()
    await stranger.context.close()
  })

  test('a group the deleted player hosted with others is handed over, not destroyed', async ({ browser }) => {
    const runId = testRunId()
    const host = await newPlayer(browser, { id: `del-rehost-${runId}`, name: 'Leaving Host' })
    const heir = await newPlayer(browser, { id: `del-heir-${runId}`, name: 'Remaining Member' })

    await createGroupThroughWizard(host.page, `Handover ${runId}`)
    await expect(host.page).toHaveURL(/\/group\/.+/)
    const groupUrl = host.page.url()

    await joinGroupAs(heir.page, host.page, 2)

    await deleteAccountThroughUi(host.page)

    // The remaining member still has the group, is now alone in it, and holds
    // the host-only controls. Destroying their group would have been the worse
    // failure, which is why deletion hands it over instead.
    await heir.page.goto(groupUrl)
    await expect(heir.page.locator('.group-info-card')).toBeVisible({ timeout: 15_000 })
    await expect(heir.page.getByText('1 player')).toBeVisible()
    await expect(heir.page.getByRole('button', { name: 'Invite players to group' })).toBeVisible()

    await host.context.close()
    await heir.context.close()
  })
})
