import { test, expect } from '@playwright/test'
import { createGroupThroughWizard, seedTestUser, testRunId, joinGroupAs } from './helpers.js'

// Covers the GroupView reorganisation: the shared app nav replacing the old
// bespoke header, the Group Info card that absorbed its contents, and the
// invite action's visibility rule.

async function newPlayer(browser, { id, name }) {
  const context = await browser.newContext()
  await seedTestUser(context, { id, name })
  const page = await context.newPage()
  return { context, page }
}

// Creates a group as host and returns its id, optionally turning on the
// "Allow members to invite others" setting through the Rules edit form —
// the same path a host would use after the fact.
async function hostCreatesGroup(page, name, { allowMemberInvites = false } = {}) {
  await createGroupThroughWizard(page, name)
  await expect(page).toHaveURL(/\/group\/.+/)
  const groupId = page.url().split('/group/')[1]

  if (allowMemberInvites) {
    await page.getByRole('button', { name: 'Rules', exact: true }).click()
    await page.getByRole('button', { name: 'Edit Rules' }).click()
    await page.getByRole('checkbox', { name: 'Allow members to invite others' }).check()
    await page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(page.getByRole('button', { name: 'Edit Rules' })).toBeVisible()
  }

  return groupId
}

test.describe('group view layout', () => {
  test('uses the shared app nav instead of its own header', async ({ page, context }) => {
    await seedTestUser(context, { id: `nav-${testRunId()}`, name: 'Nav Host' })
    await createGroupThroughWizard(page, `Nav Group ${testRunId()}`)
    await expect(page).toHaveURL(/\/group\/.+/)

    const header = page.getByRole('banner')
    await expect(header.getByRole('heading', { name: '🎵 Prompted' })).toBeVisible()
    await expect(header.getByRole('button', { name: 'Dashboard' })).toBeVisible()
    await expect(header.getByRole('button', { name: /Account settings for Nav Host/ })).toBeVisible()

    // The old bespoke header's controls are gone: no back button, and no
    // separate Account button now that the avatar serves that purpose.
    await expect(page.getByRole('button', { name: 'Go back to dashboard' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Go to account' })).toHaveCount(0)

    // The nav's Dashboard button is a working route, replacing the back button.
    await header.getByRole('button', { name: 'Dashboard' }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('create-group and account use the same shared nav', async ({ page, context }) => {
    const runId = testRunId()
    await seedTestUser(context, { id: `nav-shared-${runId}`, name: 'Nav Shared' })

    for (const [path, heading] of [['/create-group', 'Create New Group'], ['/account', 'Account Settings']]) {
      await page.goto(path)
      const header = page.getByRole('banner')
      await expect(header.getByRole('heading', { name: '🎵 Prompted' })).toBeVisible()
      await expect(header.getByRole('button', { name: 'Dashboard' })).toBeVisible()
      await expect(header.getByRole('button', { name: 'My Topics' })).toBeVisible()
      await expect(header.getByRole('button', { name: /Account settings for Nav Shared/ })).toBeVisible()

      // The old back button is gone; the nav's Dashboard link replaces it.
      await expect(page.getByRole('button', { name: 'Go back to dashboard' })).toHaveCount(0)
      // The page still announces itself with a level-1 heading.
      await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible()
    }
  })

  test('group info lives in an Overview card and does not follow other tabs', async ({ page, context }) => {
    await seedTestUser(context, { id: `card-${testRunId()}`, name: 'Card Host' })
    const groupName = `Card Group ${testRunId()}`
    await createGroupThroughWizard(page, groupName)
    await expect(page).toHaveURL(/\/group\/.+/)

    const card = page.locator('.group-info-card')
    await expect(card).toBeVisible()
    await expect(card).toContainText(groupName)
    await expect(card).toContainText('setup')
    await expect(card).toContainText('Round 0/')
    await expect(card).toContainText('1 player')

    // The name is in the card, not in the page chrome.
    await expect(page.getByRole('banner')).not.toContainText(groupName)

    for (const tab of ['Participants', 'History', 'Rules']) {
      await page.getByRole('button', { name: tab, exact: true }).click()
      await expect(page.locator('.group-info-card')).toHaveCount(0)
    }

    await page.getByRole('button', { name: 'Overview', exact: true }).click()
    await expect(page.locator('.group-info-card')).toBeVisible()
  })

  test('host always sees the invite action; a member only sees it when allowed', async ({ browser }) => {
    const runId = testRunId()
    const host = await newPlayer(browser, { id: `inv-host-${runId}`, name: 'Invite Host' })
    const member = await newPlayer(browser, { id: `inv-member-${runId}`, name: 'Invite Member' })

    // Default is off — host-only invites.
    await hostCreatesGroup(host.page, `Invite Group ${runId}`)

    const inviteButton = (page) => page.getByRole('button', { name: 'Invite players to group' })
    await expect(inviteButton(host.page)).toBeVisible()

    await joinGroupAs(member.page, host.page, 2)
    await expect(inviteButton(member.page)).toHaveCount(0)

    // Host turns the setting on; it reaches the member over the live update.
    await host.page.getByRole('button', { name: 'Rules', exact: true }).click()
    await host.page.getByRole('button', { name: 'Edit Rules' }).click()
    await host.page.getByRole('checkbox', { name: 'Allow members to invite others' }).check()
    await host.page.getByRole('button', { name: 'Save Changes' }).click()

    await expect(inviteButton(member.page)).toBeVisible()

    // Host keeps it either way.
    await host.page.getByRole('button', { name: 'Overview', exact: true }).click()
    await expect(inviteButton(host.page)).toBeVisible()

    await host.context.close()
    await member.context.close()
  })

  test('the invite setting persists across a reload', async ({ page, context }) => {
    const runId = testRunId()
    await seedTestUser(context, { id: `persist-inv-${runId}`, name: 'Persist Host' })
    const groupId = await hostCreatesGroup(page, `Persist Group ${runId}`, { allowMemberInvites: true })

    await page.goto(`/group/${groupId}`)
    await page.getByRole('button', { name: 'Rules', exact: true }).click()
    await expect(page.getByText('Members Can Share Invites: Yes')).toBeVisible()

    await page.getByRole('button', { name: 'Edit Rules' }).click()
    await expect(page.getByRole('checkbox', { name: 'Allow members to invite others' })).toBeChecked()
  })

  test('the invite setting defaults to off for a new group', async ({ page, context }) => {
    const runId = testRunId()
    await seedTestUser(context, { id: `default-inv-${runId}`, name: 'Default Host' })
    await createGroupThroughWizard(page, `Default Group ${runId}`)
    await expect(page).toHaveURL(/\/group\/.+/)

    await page.getByRole('button', { name: 'Rules', exact: true }).click()
    await expect(page.getByText('Members Can Share Invites: No')).toBeVisible()
  })
})
