import { test, expect } from '@playwright/test'
import { connectAs, seedTestUser, testRunId } from './helpers.js'

// Games, topics, notifications, and being in more than one group, in the
// browser (GT-1, NT-1). The rules are covered at the API level in
// game-rules.spec.js; these check what a player sees. The other side of each
// test is a raw socket, keeping each test to a single page.

function waitFor(socket, event, match = () => true, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler)
      reject(new Error(`no matching ${event} within ${timeoutMs}ms`))
    }, timeoutMs)
    function handler(payload) {
      if (!match(payload)) return
      clearTimeout(timer)
      socket.off(event, handler)
      resolve(payload)
    }
    socket.on(event, handler)
  })
}
const once = (socket, event) => waitFor(socket, event)

async function createGroup(host, name, settings = {}) {
  host.socket.emit('create_group', { groupData: { name, settings } })
  const { group } = await once(host.socket, 'group_created')
  return group
}

async function joinByInvite(player, group) {
  const joined = once(player.socket, 'group_joined')
  player.socket.emit('join_group', { inviteCode: group.inviteCode })
  return joined
}

test.describe('the notification bell', () => {
  test('shows a new notification, opens it, and clears the count', async ({ page, context }) => {
    const runId = testRunId()
    const host = connectAs(`nb-host-${runId}`, 'Bell Host')
    await host.ready
    const group = await createGroup(host, `Bell Group ${runId}`)

    const playerId = `nb-ply-${runId}`
    await seedTestUser(context, { id: playerId, name: 'Bell Player' })
    await page.goto(`/group/${group.id}`)
    const requested = waitFor(host.socket, 'group_updated', ({ hostPanel }) => hostPanel?.joinRequests.length === 1)
    await page.getByRole('button', { name: 'Request to Join' }).click()
    await requested

    host.socket.emit('respond_join_request', { groupId: group.id, requesterId: playerId, accept: true })

    const bell = page.getByRole('button', { name: /^Notifications, \d+ unread$/ })
    await expect(bell).toBeVisible()
    await bell.click()
    const panel = page.getByRole('region', { name: 'Notifications' })
    await expect(panel).toContainText(`Your request to join Bell Group ${runId} was accepted. You're in!`)

    // Opened from the group's own view-only page: it still goes into the group.
    await panel.getByRole('link', { name: /^Open: Your request to join/ }).click()
    await expect(page).toHaveURL(new RegExp(`/group/${group.id}$`))
    await expect(page.getByRole('button', { name: 'Leave Group' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible()
    host.socket.close()
  })

  test('shows three at most, links to the full page, and can remove or clear them', async ({ page, context }) => {
    const runId = testRunId()
    const hostId = `nbp-host-${runId}`
    const host = connectAs(hostId, 'Busy Host')
    await host.ready
    for (const n of [1, 2, 3, 4, 5]) {
      const joiner = connectAs(`nbp-j${n}-${runId}`, `Joiner ${n}`)
      await joiner.ready
      const group = await createGroup(host, `Busy ${n} ${runId}`)
      const told = waitFor(host.socket, 'notification', ({ item }) => item.type === 'member_joined')
      joiner.socket.emit('join_group', { inviteCode: group.inviteCode })
      await told
      joiner.socket.close()
    }
    host.socket.close()

    await seedTestUser(context, { id: hostId, name: 'Busy Host' })
    await page.goto('/dashboard')
    await page.getByRole('button', { name: /^Notifications, 5 unread$/ }).click()
    const panel = page.getByRole('region', { name: 'Notifications' })
    await expect(panel.getByRole('listitem')).toHaveCount(3)
    await expect(panel.getByRole('listitem').first()).toContainText(`Joiner 5 joined Busy 5 ${runId}.`)

    await panel.getByRole('button', { name: `Remove notification: Joiner 5 joined Busy 5 ${runId}.` }).click()
    await expect(panel.getByRole('listitem').first()).toContainText(`Joiner 4 joined Busy 4 ${runId}.`)

    await panel.getByRole('link', { name: 'See all 4 notifications' }).click()
    await expect(page).toHaveURL(/[/]notifications$/)
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible()
    await expect(page.locator('.notifications-page-list > li')).toHaveCount(4)

    page.once('dialog', (dialog) => dialog.accept())
    await page.getByRole('button', { name: 'Clear all' }).click()
    await expect(page.getByText('Nothing yet. Game news will show up here.')).toBeVisible()
  })

  test("a join request's notification opens the Requests tab", async ({ page, context }) => {
    const runId = testRunId()
    const hostId = `nbr-host-${runId}`
    const host = connectAs(hostId, 'Tab Host')
    const asker = connectAs(`nbr-ask-${runId}`, 'Tab Asker')
    await Promise.all([host.ready, asker.ready])
    const group = await createGroup(host, `Tab Group ${runId}`)
    host.socket.close()

    await seedTestUser(context, { id: hostId, name: 'Tab Host' })
    await page.goto(`/group/${group.id}`)
    await expect(page.locator('.group-info-name')).toHaveText(`Tab Group ${runId}`)

    asker.socket.emit('request_join', { groupId: group.id })
    await page.getByRole('button', { name: /^Notifications, [0-9]+ unread$/ }).click()
    await page.getByRole('link', { name: `Open: Tab Asker asked to join Tab Group ${runId}.` }).click()
    await expect(page.getByRole('heading', { name: 'Join Requests' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Accept Tab Asker' })).toBeVisible()
    asker.socket.close()
  })
})

test.describe('being in more than one group', () => {
  test("another group's activity doesn't change the group on screen", async ({ page, context }) => {
    const runId = testRunId()
    const host = connectAs(`mg-host-${runId}`, 'Multi Host')
    await host.ready
    const groupA = await createGroup(host, `Group Alpha ${runId}`)
    const groupB = await createGroup(host, `Group Beta ${runId}`)

    const playerId = `mg-ply-${runId}`
    const player = connectAs(playerId, 'Multi Player')
    await player.ready
    await joinByInvite(player, groupA)
    await joinByInvite(player, groupB)
    player.socket.close()

    // Open A, then B, in the same tab (one socket for both pages).
    await seedTestUser(context, { id: playerId, name: 'Multi Player' })
    await page.goto('/dashboard')
    await page.locator('.group-card').filter({ hasText: `Group Alpha ${runId}` }).click()
    await expect(page.locator('.group-info-name')).toHaveText(`Group Alpha ${runId}`)
    await page.getByRole('button', { name: 'Dashboard' }).click()
    await page.locator('.group-card').filter({ hasText: `Group Beta ${runId}` }).click()
    await expect(page.locator('.group-info-name')).toHaveText(`Group Beta ${runId}`)
    await expect(page.getByText('2 players')).toBeVisible()

    // Someone joins A. The page is still showing B, and must stay B.
    const newcomer = connectAs(`mg-new-${runId}`, 'Alpha Newcomer')
    await newcomer.ready
    await joinByInvite(newcomer, groupA)
    await page.waitForTimeout(1000)
    await expect(page.locator('.group-info-name')).toHaveText(`Group Beta ${runId}`)
    await expect(page.getByText('2 players')).toBeVisible()
    await expect(page.getByText('3 players')).toHaveCount(0)

    host.socket.close()
    newcomer.socket.close()
  })
})

test.describe('opening a group from the dashboard', () => {
  // Regression: the dashboard's copy of a group lacked the host-topic fields,
  // which blanked the page for a group with custom topics off.
  test('a group with custom topics off opens from its dashboard card', async ({ page, context }) => {
    const runId = testRunId()
    const hostId = `dc-host-${runId}`
    const host = connectAs(hostId, 'Card Host')
    await host.ready
    await createGroup(host, `Custom Off ${runId}`, { allowCustomTopics: false, totalRounds: 4 })
    host.socket.close()

    await seedTestUser(context, { id: hostId, name: 'Card Host' })
    await page.goto('/dashboard')
    await page.locator('.group-card').filter({ hasText: `Custom Off ${runId}` }).click()
    await expect(page.locator('.group-info-name')).toHaveText(`Custom Off ${runId}`)
    await expect(page.getByRole('button', { name: 'Start Round' })).toBeVisible()
  })
})

test.describe('the end of a game', () => {
  test('shows final standings, and the host can start a new game', async ({ page, context }) => {
    const runId = testRunId()
    const hostId = `go-host-${runId}`
    const host = connectAs(hostId, 'Final Host')
    const member = connectAs(`go-mem-${runId}`, 'Final Member')
    await Promise.all([host.ready, member.ready])
    const group = await createGroup(host, `Finale ${runId}`, { totalRounds: 1 })
    await joinByInvite(member, group)

    // Play the only round over sockets, with the host as Judge.
    const phase = (p) => ({ group: g }) => g.id === group.id && g.currentTheme?.status === p
    let wait = waitFor(host.socket, 'group_updated', phase('topic_selection'))
    host.socket.emit('start_group', { groupId: group.id, czarUserId: hostId })
    await wait
    host.socket.emit('submit_topic', { text: `Finale topic ${runId}`, isPublic: false })
    const { topic } = await once(host.socket, 'topic_submitted')
    wait = waitFor(host.socket, 'group_updated', phase('voting'))
    host.socket.emit('select_topic', { groupId: group.id, topicId: topic.id })
    await waitFor(host.socket, 'group_updated', phase('submission'))
    member.socket.emit('submit_video', {
      groupId: group.id, videoId: 'finaleAAAAA', title: 'Finale Song',
      thumbnail: 'https://i.ytimg.com/vi/finaleAAAAA/mqdefault.jpg', channelTitle: 'Test'
    })
    const { group: voting } = await wait
    wait = waitFor(host.socket, 'group_updated', ({ group: g }) => g.id === group.id && g.status === 'finished')
    host.socket.emit('czar_select_winner', { groupId: group.id, submissionId: voting.currentTheme.submissions[0].id })
    await wait
    host.socket.close()

    await seedTestUser(context, { id: hostId, name: 'Final Host' })
    await page.goto(`/group/${group.id}`)
    const over = page.getByRole('region', { name: 'Game over' })
    await expect(over).toContainText('Final Member won with')
    await expect(page.getByText('Game over', { exact: true }).first()).toBeVisible()

    page.once('dialog', (dialog) => dialog.accept())
    await over.getByRole('button', { name: 'Start a new game' }).click()
    await expect(page.getByRole('heading', { name: 'Group Setup' })).toBeVisible()
    member.socket.close()
  })
})

test.describe('starting a game with something missing', () => {
  test('Start opens a topics modal that validates, then goes on to the Judge prompt', async ({ page, context }) => {
    const runId = testRunId()
    const hostId = `ht-host-${runId}`
    const host = connectAs(hostId, 'Topic Host')
    const member = connectAs(`ht-mem-${runId}`, 'Topic Member')
    await Promise.all([host.ready, member.ready])
    const group = await createGroup(host, `Host Topics ${runId}`, { totalRounds: 2, allowCustomTopics: false })
    await joinByInvite(member, group)
    host.socket.close()

    await seedTestUser(context, { id: hostId, name: 'Topic Host' })
    await page.goto(`/group/${group.id}`)

    // Start is never greyed out; clicking it explains what's missing.
    await page.getByRole('button', { name: 'Start Round' }).click()
    const modal = page.getByRole('dialog', { name: 'Add your topics to start' })
    await expect(modal).toBeVisible()
    await expect(modal.getByRole('status').filter({ hasText: '0 of 2 added: add 2 more to start.' })).toBeVisible()
    await expect(modal.getByRole('button', { name: 'Start round' })).toBeDisabled()
    await expect(modal.getByText('Add 2 more topics to start the round.')).toBeVisible()

    // Validation: empty, then a duplicate.
    await modal.getByRole('button', { name: 'Add topic' }).click()
    await expect(modal.getByRole('alert')).toHaveText('Type a topic first.')

    const input = modal.getByLabel('New topic')
    await input.fill(`First topic ${runId}`)
    await modal.getByRole('button', { name: 'Add topic' }).click()
    await expect(modal.getByText(`First topic ${runId}`)).toBeVisible()
    await expect(input).toHaveValue('')

    await input.fill(`  first TOPIC ${runId} `)
    await modal.getByRole('button', { name: 'Add topic' }).click()
    await expect(modal.getByRole('alert')).toHaveText('That topic is already on the list.')

    await input.fill(`Second topic ${runId}`)
    await modal.getByRole('button', { name: 'Add topic' }).click()
    await expect(modal.getByRole('status').filter({ hasText: '2 of 2 added, ready to play.' })).toBeVisible()

    await modal.getByRole('button', { name: 'Start round' }).click()
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Select Judge' })).toBeVisible()
    member.socket.close()
  })

  test('with one player, Start explains and offers the invite', async ({ page, context }) => {
    const runId = testRunId()
    const hostId = `pl-host-${runId}`
    const host = connectAs(hostId, 'Lonely Host')
    await host.ready
    const group = await createGroup(host, `Just Me ${runId}`)
    host.socket.close()

    await seedTestUser(context, { id: hostId, name: 'Lonely Host' })
    await page.goto(`/group/${group.id}`)
    await expect(page.locator('.setup-warning')).toContainText('You need at least 2 players to start')

    await page.getByRole('button', { name: 'Start Round' }).click()
    const modal = page.getByRole('dialog', { name: 'Invite someone to start' })
    await expect(modal).toContainText("Right now it's just you.")
    await expect(modal).toContainText('Your group is also listed in Open Groups')
    await modal.getByRole('button', { name: 'Invite players' }).click()
    await expect(page.getByRole('dialog', { name: 'Invite Players' })).toBeVisible()
  })

  test('the players warning only shows while there is one player', async ({ page, context }) => {
    const runId = testRunId()
    const hostId = `pw-host-${runId}`
    const host = connectAs(hostId, 'Warned Host')
    await host.ready
    const group = await createGroup(host, `Warned ${runId}`)

    await seedTestUser(context, { id: hostId, name: 'Warned Host' })
    await page.goto(`/group/${group.id}`)
    await expect(page.locator('.setup-warning')).toBeVisible()

    const member = connectAs(`pw-mem-${runId}`, 'Second Player')
    await member.ready
    await joinByInvite(member, group)
    await expect(page.getByText('2 players')).toBeVisible()
    await expect(page.locator('.setup-warning')).toHaveCount(0)
    await expect(page.getByText('Ready to start.')).toBeVisible()
    host.socket.close()
    member.socket.close()
  })
})

test.describe('the Create Group wizard', () => {
  test('Next without a name explains instead of doing nothing', async ({ page, context }) => {
    await seedTestUser(context, { id: `wz-${testRunId()}`, name: 'Wizard User' })
    await page.goto('/create-group')

    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByRole('alert')).toHaveText('Enter a group name to continue.')
    await expect(page.getByLabel('Group Name *')).toBeFocused()
    await expect(page.getByRole('heading', { name: 'Basics', level: 2 })).toBeVisible()

    await page.getByLabel('Group Name *').fill('Named at last')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await page.getByRole('button', { name: 'Next' }).click()
    await expect(page.getByRole('heading', { name: 'Game Rules', level: 2 })).toBeVisible()
  })
})
