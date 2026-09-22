import { test, expect } from '@playwright/test'
import { connectAs, seedTestUser, testRunId } from './helpers.js'

// Open groups in the browser (OG-1): the dashboard preview and the search
// page. The rules themselves (what's listed, who can join, search matching)
// are covered at the API level in open-groups.spec.js; these check what a
// player sees and does.
//
// Other workers create groups throughout a run, so a specific group can be
// pushed out of the dashboard's 12-card preview at any moment. Tests that
// look for one particular group therefore search for its unique name on the
// search page, which can't be crowded out.

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve))

async function createOpenGroup(host, name, description = '') {
  host.socket.emit('create_group', { groupData: { name, description, settings: {} } })
  const { group } = await once(host.socket, 'group_created')
  return group
}

test.describe('open groups preview on the dashboard', () => {
  test('shows at most 12 open groups and links to the search page', async ({ page, context }) => {
    const runId = testRunId()
    const host = connectAs(`ogp-host-${runId}`, 'Preview Host')
    await host.ready
    await createOpenGroup(host, `Preview Room ${runId}`)

    await seedTestUser(context, { id: `ogp-player-${runId}`, name: 'Preview Player' })
    await page.goto('/dashboard')

    const openSection = page.getByRole('region', { name: 'Open Groups' })
    await expect(openSection.getByRole('listitem').first()).toBeVisible()
    expect(await openSection.getByRole('listitem').count()).toBeLessThanOrEqual(12)

    await openSection.getByRole('link', { name: 'View all open groups' }).click()
    await expect(page).toHaveURL(/\/open-groups$/)
    await expect(page.getByRole('heading', { name: 'Open Groups', level: 1 })).toBeVisible()

    host.socket.close()
  })
})

test.describe('open groups search page', () => {
  test('searching filters the list, and the search survives a reload', async ({ page, context }) => {
    const runId = testRunId()
    const host = connectAs(`ogs-host-${runId}`, 'Search Host')
    await host.ready
    await createOpenGroup(host, `Jazz Night ${runId}`)
    await createOpenGroup(host, `Metal Mondays ${runId}`)

    await seedTestUser(context, { id: `ogs-player-${runId}`, name: 'Searching Player' })
    await page.goto('/open-groups')

    const search = page.getByRole('searchbox', { name: 'Search open groups' })
    const results = page.getByRole('listitem')

    await search.fill(runId)
    await expect(results.filter({ hasText: `Jazz Night ${runId}` })).toBeVisible()
    await expect(results.filter({ hasText: `Metal Mondays ${runId}` })).toBeVisible()

    await search.fill(`jazz night ${runId}`)
    await expect(results.filter({ hasText: `Metal Mondays ${runId}` })).toHaveCount(0)
    await expect(results.filter({ hasText: `Jazz Night ${runId}` })).toBeVisible()
    await expect(page).toHaveURL(/[?&]q=jazz/)

    await page.reload()
    await expect(search).toHaveValue(`jazz night ${runId}`)
    await expect(results.filter({ hasText: `Jazz Night ${runId}` })).toBeVisible()
    await expect(results.filter({ hasText: `Metal Mondays ${runId}` })).toHaveCount(0)

    host.socket.close()
  })

  test('the search is kept when coming back with the Back button', async ({ page, context }) => {
    const runId = testRunId()
    await seedTestUser(context, { id: `ogb-player-${runId}`, name: 'Back Button Player' })
    await page.goto('/open-groups')

    const search = page.getByRole('searchbox', { name: 'Search open groups' })
    await search.fill(`nothing ${runId}`)
    await expect(page).toHaveURL(/[?&]q=nothing/)

    await page.getByRole('link', { name: '← Back to dashboard' }).click()
    await expect(page).toHaveURL(/\/dashboard$/)

    await page.goBack()
    await expect(search).toHaveValue(`nothing ${runId}`)
    await expect(page.getByRole('heading', { name: 'No matching groups' })).toBeVisible()
  })

  test('results are paged, Back returns to the previous page, and page size can change', async ({ page, context }) => {
    const runId = testRunId()
    const host = connectAs(`ogpg-host-${runId}`, 'Paging Host')
    await host.ready
    for (let i = 1; i <= 13; i++) {
      await createOpenGroup(host, `Page Test ${String(i).padStart(2, '0')} ${runId}`)
    }

    await seedTestUser(context, { id: `ogpg-player-${runId}`, name: 'Paging Player' })
    await page.goto(`/open-groups?q=${encodeURIComponent(runId)}`)

    const results = page.locator('.open-groups-results > li')
    const status = page.locator('#open-groups-status')
    const pagination = page.getByRole('navigation', { name: 'Pagination' })

    await expect(status).toHaveText(`Showing 1–12 of 13 groups matching "${runId}"`)
    await expect(results).toHaveCount(12)
    await expect(pagination.getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')

    await pagination.getByRole('button', { name: 'Next' }).click()
    await expect(page).toHaveURL(/[?&]page=2/)
    await expect(status).toHaveText(`Showing 13 of 13 groups matching "${runId}"`)
    await expect(results).toHaveCount(1)
    await expect(pagination.getByRole('button', { name: 'Next' })).toBeDisabled()

    await page.goBack()
    await expect(page).not.toHaveURL(/[?&]page=/)
    await expect(results).toHaveCount(12)

    await page.getByLabel('Groups per page').selectOption('24')
    await expect(page).toHaveURL(/[?&]size=24/)
    await expect(results).toHaveCount(13)
    await expect(pagination).toHaveCount(0)

    host.socket.close()
  })

  test('View opens a view-only page, and the host accepting lets the player in', async ({ page, context }) => {
    const runId = testRunId()
    const host = connectAs(`ogj-host-${runId}`, 'Join Host')
    await host.ready
    const group = await createOpenGroup(host, `Open Lounge ${runId}`)

    await seedTestUser(context, { id: `ogj-player-${runId}`, name: 'Joining Player' })
    await page.goto(`/open-groups?q=${encodeURIComponent(`Open Lounge ${runId}`)}`)

    const card = page.getByRole('listitem').filter({ hasText: `Open Lounge ${runId}` })
    await expect(card).toContainText('Join Host')
    await card.getByRole('link', { name: `View Open Lounge ${runId}` }).click()
    await expect(page).toHaveURL(new RegExp(`/group/${group.id}$`))

    // View-only: the group's details and a request button, not the group itself.
    await expect(page.getByText('View only')).toBeVisible()
    await expect(page.getByRole('heading', { name: `Open Lounge ${runId}`, level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Leave Group' })).toHaveCount(0)

    const requested = new Promise((resolve) => {
      host.socket.on('group_updated', ({ hostPanel }) => {
        const request = hostPanel?.joinRequests.find((r) => r.userId === `ogj-player-${runId}`)
        if (request) resolve(request)
      })
    })
    await page.getByRole('button', { name: 'Request to Join' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Request sent' })).toBeVisible()
    await requested

    host.socket.emit('respond_join_request', { groupId: group.id, requesterId: `ogj-player-${runId}`, accept: true })
    // No jump into the group: the page says so, and the player chooses when.
    await expect(page.getByRole('status').filter({ hasText: "You're in!" })).toBeVisible()
    await expect(page.getByText('View only')).toBeVisible()
    await page.getByRole('button', { name: 'Open group' }).click()
    await expect(page.getByRole('button', { name: 'Leave Group' })).toBeVisible()
    await expect(page.getByText('View only')).toHaveCount(0)

    host.socket.close()
  })

  test('a newly opened group appears without refreshing', async ({ page, context }) => {
    const runId = testRunId()
    await seedTestUser(context, { id: `ogl-player-${runId}`, name: 'Watching Player' })
    await page.goto(`/open-groups?q=${encodeURIComponent(`Fresh Room ${runId}`)}`)
    await expect(page.getByRole('heading', { name: 'No matching groups' })).toBeVisible()

    const host = connectAs(`ogl-host-${runId}`, 'Live Host')
    await host.ready
    await createOpenGroup(host, `Fresh Room ${runId}`)

    await expect(page.getByRole('listitem').filter({ hasText: `Fresh Room ${runId}` })).toBeVisible()

    host.socket.close()
  })
})
