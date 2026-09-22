import { test, expect } from '@playwright/test'
import { connectAs, seedTestUser, startRoundAsHost, testRunId } from './helpers.js'

// Join requests, kicks and bans in the browser (JR-1). The rules are covered
// at the API level in join-requests.spec.js; these check the host's Requests
// tab, the Kick and Ban buttons, what a removed player sees, and the prompt
// when starting a round with requests waiting.
//
// The browser plays one side; the other side is a raw socket, which keeps
// each test to a single page.

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve))

function waitFor(socket, event, match = () => true) {
  return new Promise((resolve) => {
    const handler = (payload) => {
      if (match(payload)) {
        socket.off(event, handler)
        resolve(payload)
      }
    }
    socket.on(event, handler)
  })
}

// A group hosted by `hostId`, created over a raw socket for that identity so
// a browser seeded with the same identity is its host.
async function hostedGroup(hostId, name) {
  const host = connectAs(hostId, 'Browser Host')
  await host.ready
  host.socket.emit('create_group', { groupData: { name, settings: {} } })
  const { group } = await once(host.socket, 'group_created')
  host.socket.close()
  return group
}

async function joinByInvite(player, group) {
  const joined = once(player.socket, 'group_joined')
  player.socket.emit('join_group', { inviteCode: group.inviteCode })
  return joined
}

test.describe('the host handling requests and members', () => {
  test('a request appears in the Requests tab, and Accept adds the player', async ({ page, context }) => {
    const runId = testRunId()
    const hostId = `jru-host-${runId}`
    const group = await hostedGroup(hostId, `Requests Tab ${runId}`)
    await seedTestUser(context, { id: hostId, name: 'Browser Host' })
    await page.goto(`/group/${group.id}`)

    const requester = connectAs(`jru-req-${runId}`, 'Hopeful Hannah')
    await requester.ready
    requester.socket.emit('request_join', { groupId: group.id })

    const requestsTab = page.getByRole('button', { name: /^Requests/ })
    await expect(requestsTab).toContainText('1')
    await requestsTab.click()
    await expect(page.getByRole('heading', { name: 'Join Requests' })).toBeVisible()

    const accepted = waitFor(requester.socket, 'join_request_update', (u) => u.outcome === 'accepted')
    await page.getByRole('button', { name: 'Accept Hopeful Hannah' }).click()
    await accepted
    await expect(page.getByText('No one is waiting to join.')).toBeVisible()

    await page.getByRole('button', { name: 'Participants' }).click()
    await expect(page.locator('.participant-card').filter({ hasText: 'Hopeful Hannah' })).toBeVisible()

    requester.socket.close()
  })

  test('the host can kick or ban from the Participants tab', async ({ page, context }) => {
    const runId = testRunId()
    const hostId = `jrk-host-${runId}`
    const group = await hostedGroup(hostId, `Moderation ${runId}`)
    const kicked = connectAs(`jrk-a-${runId}`, 'Kickable Kim')
    const banned = connectAs(`jrk-b-${runId}`, 'Bannable Ben')
    await Promise.all([kicked.ready, banned.ready])
    await joinByInvite(kicked, group)
    await joinByInvite(banned, group)

    await seedTestUser(context, { id: hostId, name: 'Browser Host' })
    await page.goto(`/group/${group.id}`)
    await page.getByRole('button', { name: 'Participants' }).click()

    page.once('dialog', (dialog) => dialog.accept())
    const kickNotice = waitFor(kicked.socket, 'removed_from_group')
    await page.getByRole('button', { name: 'Kick Kickable Kim' }).click()
    expect((await kickNotice).reason).toBe('kicked')
    await expect(page.locator('.participant-card').filter({ hasText: 'Kickable Kim' })).toHaveCount(0)

    page.once('dialog', (dialog) => dialog.accept())
    const banNotice = waitFor(banned.socket, 'removed_from_group')
    await page.getByRole('button', { name: 'Ban Bannable Ben' }).click()
    expect((await banNotice).reason).toBe('banned')

    await page.getByRole('button', { name: /^Requests/ }).click()
    await expect(page.getByRole('heading', { name: 'Banned players' })).toBeVisible()
    await page.getByRole('button', { name: 'Unban Bannable Ben' }).click()
    await expect(page.getByText('No one is banned.')).toBeVisible()

    kicked.socket.close()
    banned.socket.close()
  })

  test('starting a round with requests waiting asks the host first', async ({ page, context }) => {
    const runId = testRunId()
    const hostId = `jrs-host-${runId}`
    const group = await hostedGroup(hostId, `Pending Start ${runId}`)
    const member = connectAs(`jrs-mem-${runId}`, 'Ready Member')
    const requester = connectAs(`jrs-req-${runId}`, 'Waiting Walt')
    await Promise.all([member.ready, requester.ready])
    await joinByInvite(member, group)
    requester.socket.emit('request_join', { groupId: group.id })
    await waitFor(requester.socket, 'join_request_update', (u) => u.request.status === 'pending')

    await seedTestUser(context, { id: hostId, name: 'Browser Host' })
    await page.goto(`/group/${group.id}`)

    const prompt = new Promise((resolve) => {
      page.once('dialog', async (dialog) => {
        const message = dialog.message()
        await dialog.accept()
        resolve(message)
      })
    })
    await startRoundAsHost(page)
    expect(await prompt).toContain('1 person is waiting to join')
    await expect(page.getByRole('button', { name: 'Round', exact: true })).toBeVisible()

    member.socket.close()
    requester.socket.close()
  })
})

test.describe('what a removed player sees', () => {
  test('a kicked player lands on the dashboard with a notice', async ({ page, context }) => {
    const runId = testRunId()
    const host = connectAs(`jrn-host-${runId}`, 'Notice Host')
    await host.ready
    host.socket.emit('create_group', { groupData: { name: `Notice ${runId}`, settings: {} } })
    const { group } = await once(host.socket, 'group_created')

    const playerId = `jrn-ply-${runId}`
    const player = connectAs(playerId, 'Removed Rita')
    await player.ready
    await joinByInvite(player, group)
    player.socket.close()

    await seedTestUser(context, { id: playerId, name: 'Removed Rita' })
    await page.goto(`/group/${group.id}`)
    await expect(page.getByRole('button', { name: 'Leave Group' })).toBeVisible()

    host.socket.emit('kick_player', { groupId: group.id, targetId: playerId })
    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByRole('status').filter({ hasText: `You were removed from Notice ${runId}` })).toBeVisible()

    host.socket.close()
  })
})
