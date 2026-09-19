import { test, expect } from '@playwright/test'
import { io } from 'socket.io-client'
import { createGroupThroughWizard, seedTestUser, testRunId, inviteCodeFor, inviteJoinPath } from './helpers.js'

const API_URL = 'http://localhost:5000'

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve))

// The server emits `session` from inside its connection handler, so the
// listener has to be attached before the connection settles. Same shape as
// round-phases.spec.js: these talk to the same authenticated server the
// browser tests use, so a crafted payload exercises the real contract.
function connect(id, name) {
  const socket = io(API_URL, {
    transports: ['websocket'], forceNew: true, reconnection: false,
    auth: { testUser: { userId: id, name, avatar: '🎵' } }
  })
  const ready = new Promise((resolve, reject) => {
    socket.once('session', resolve)
    socket.once('connect_error', reject)
  })
  return { id, socket, ready }
}

// Reads the group's roster by asking the server directly, the same way the
// client would. Returns group.players after a get_group round trip.
async function fetchPlayers(socket, groupId) {
  socket.emit('get_group', { groupId })
  const { group } = await once(socket, 'group_details')
  return group.players
}

// Builds a group over raw sockets and joins `members` into it, returning the
// group id and the created host object.
async function rawGroup(host, members, { name } = {}) {
  host.socket.emit('create_group', { groupData: { name, settings: {} } })
  const { group } = await once(host.socket, 'group_created')
  for (const m of members) {
    m.socket.emit('join_group', { inviteCode: group.inviteCode })
    await once(m.socket, 'group_joined')
  }
  return group.id
}

test.describe('leave and delete group', () => {
  test('a member who leaves is removed from the remaining host\'s live roster', async ({ browser }) => {
    const runId = testRunId()
    const context = await browser.newContext()
    await seedTestUser(context, { id: `ld-host-${runId}`, name: 'Leave Host' })
    const page = await context.newPage()

    await createGroupThroughWizard(page, `Leave Group ${runId}`)
    await expect(page).toHaveURL(/\/group\/.+/)
    const groupId = page.url().split('/group/')[1]

    const leaver = connect(`ld-leaver-${runId}`, 'Leaver')
    await leaver.ready
    leaver.socket.emit('join_group', { inviteCode: await inviteCodeFor(`ld-host-${runId}`, groupId) })
    await once(leaver.socket, 'group_joined')

    // The host page sees the new member live on the roster.
    await expect(page.getByText('2 players')).toBeVisible()

    // The member leaves; they get the confirmation, and the group continues.
    leaver.socket.emit('leave_group', { groupId })
    const left = await once(leaver.socket, 'left_group')
    expect(left.groupId).toBe(groupId)

    // The remaining host is rebroadcast the group and so sees the roster drop
    // to just themselves.
    await expect(page.getByText('1 player')).toBeVisible()
    await expect(page.getByText('Leaver')).toHaveCount(0)

    leaver.socket.close()
    await context.close()
  })

  test('only the host can delete the group: a non-host is refused with no state change', async () => {
    const runId = testRunId()
    const host = connect(`ld-host-${runId}`, 'Delete Host')
    const member = connect(`ld-member-${runId}`, 'Delete Member')
    await Promise.all([host.ready, member.ready])

    const groupId = await rawGroup(host, [member], { name: `Delete ${runId}` })

    // A regular member tries to delete...
    member.socket.emit('delete_group', { groupId })
    const err = await once(member.socket, 'error')
    expect(err.message).toContain('Only the host can delete the group')

    // ...and the group is untouched: the host can still fetch it (no 'Group
    // not found' error) and the member is still on the roster.
    const players = await fetchPlayers(member.socket, groupId)
    expect(players.map((p) => p.userId)).toContain(member.id)
    expect(players).toHaveLength(2)

    host.socket.close()
    member.socket.close()
  })

  test('after the host deletes, every connected member is told group_deleted and the group is gone', async () => {
    const runId = testRunId()
    const host = connect(`ld-host-${runId}`, 'Delete Host')
    const p2 = connect(`ld-two-${runId}`, 'Member Two')
    const p3 = connect(`ld-three-${runId}`, 'Member Three')
    await Promise.all([host.ready, p2.ready, p3.ready])

    const groupId = await rawGroup(host, [p2, p3], { name: `Delete All ${runId}` })

    const deletions = [p2, p3].map((p) => once(p.socket, 'group_deleted'))
    const hostDeletion = once(host.socket, 'group_deleted')

    host.socket.emit('delete_group', { groupId })

    // The host's own client also receives the notice so it can navigate home.
    expect((await hostDeletion).groupId).toBe(groupId)

    // Each connected member is notified with the same payload.
    const notices = await Promise.all(deletions)
    for (const notice of notices) {
      expect(notice.groupId).toBe(groupId)
    }

    // The group is permanently gone: a later get_group is refused, not stale.
    p2.socket.emit('get_group', { groupId })
    const err = await once(p2.socket, 'error')
    expect(err.message).toContain('Group not found')

    host.socket.close()
    p2.socket.close()
    p3.socket.close()
  })

  test('a raw socket member removal removes them from the roster on the server', async () => {
    const runId = testRunId()
    const host = connect(`ld-host-${runId}`, 'Raw Host')
    const member = connect(`ld-raw-${runId}`, 'Raw Member')
    await Promise.all([host.ready, member.ready])

    const groupId = await rawGroup(host, [member], { name: `Raw ${runId}` })
    expect(await fetchPlayers(member.socket, groupId)).toHaveLength(2)

    member.socket.emit('leave_group', { groupId })
    await once(member.socket, 'left_group')

    const players = await fetchPlayers(host.socket, groupId)
    expect(players.map((p) => p.userId)).toEqual([host.id])

    host.socket.close()
    member.socket.close()
  })

  test('a player who left can rejoin the group', async () => {
    const runId = testRunId()
    const host = connect(`ld-host-${runId}`, 'Rejoin Host')
    const member = connect(`ld-return-${runId}`, 'Returning Member')
    await Promise.all([host.ready, member.ready])

    const groupId = await rawGroup(host, [member], { name: `Rejoin ${runId}` })

    // Leave, then come straight back to the same group.
    member.socket.emit('leave_group', { groupId })
    await once(member.socket, 'left_group')
    expect(await fetchPlayers(host.socket, groupId)).toHaveLength(1)

    member.socket.emit('join_group', { inviteCode: await inviteCodeFor(host.id, groupId) })
    await once(member.socket, 'group_joined')

    // Back on the roster as a full member before the host.
    const players = await fetchPlayers(host.socket, groupId)
    expect(players).toHaveLength(2)
    expect(players.map((p) => p.userId)).toContain(member.id)

    host.socket.close()
    member.socket.close()
  })

  // The two cases below drive the REAL Leave Group / Delete Group buttons in a
  // real browser page and assert the page navigates to /dashboard only after
  // the server replies with left_group / group_deleted. They deliberately do
  // NOT drive either actor over raw sockets: the whole point is that a browser
  // click -> server reply -> navigate('/dashboard') path is exercised, so
  // removing the client wiring in GroupView.jsx (the emits, the reply
  // listeners, and their navigate calls) would make these fail.

  test('a browser non-host member clicks Leave Group and is navigated to /dashboard', async ({ browser }) => {
    const runId = testRunId()

    // Host creates a group through the real wizard.
    const hostContext = await browser.newContext()
    await seedTestUser(hostContext, { id: `ld-br-host-${runId}`, name: 'Browser Host' })
    const hostPage = await hostContext.newPage()
    await createGroupThroughWizard(hostPage, `Browser Leave ${runId}`)
    await expect(hostPage).toHaveURL(/\/group\/.+/)

    // Non-host member joins through the real invite link, landing in the Group
    // View as an ordinary (non-host) member.
    const memberContext = await browser.newContext()
    await seedTestUser(memberContext, { id: `ld-br-member-${runId}`, name: 'Browser Member' })
    const memberPage = await memberContext.newPage()
    await memberPage.goto(await inviteJoinPath(hostPage))
    await expect(memberPage.locator('.group-info-card')).toBeVisible()

    // The member's page shows the Leave Group button and must NOT be the host:
    // the host's page is the one carrying Delete Group.
    const leaveButton = memberPage.getByRole('button', { name: 'Leave Group' })
    await expect(leaveButton).toBeVisible()
    await expect(memberPage.getByRole('button', { name: 'Delete Group' })).toHaveCount(0)
    await expect(hostPage.getByRole('button', { name: 'Delete Group' })).toBeVisible()

    // The click pops a browser confirm(); accept it. The dialog only appears
    // if handleLeaveGroup's confirm() ran, so its arrival is itself the proof
    // the real button wiring fired.
    const accepted = new Promise((resolve) => {
      memberPage.once('dialog', (dialog) => {
        resolve(dialog.message)
        dialog.accept()
      })
    })
    await leaveButton.click()
    await accepted

    // The navigation is driven purely by the left_group reply -> navigate.
    await expect(memberPage).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    await memberContext.close()
    await hostContext.close()
  })

  test('a browser host clicks Delete Group and is navigated to /dashboard', async ({ browser }) => {
    const runId = testRunId()

    // Host creates a group through the real wizard and stays in the Group View.
    const context = await browser.newContext()
    await seedTestUser(context, { id: `ld-br-del-${runId}`, name: 'Browser Delete Host' })
    const page = await context.newPage()
    await createGroupThroughWizard(page, `Browser Delete ${runId}`)
    await expect(page).toHaveURL(/\/group\/.+/)

    // The host's page is the one that shows Delete Group (not Leave Group).
    const deleteButton = page.getByRole('button', { name: 'Delete Group' })
    await expect(deleteButton).toBeVisible()
    await expect(page.getByRole('button', { name: 'Leave Group' })).toHaveCount(0)

    const accepted = new Promise((resolve) => {
      page.once('dialog', (dialog) => {
        resolve(dialog.message)
        dialog.accept()
      })
    })
    await deleteButton.click()
    await accepted

    // The navigation is driven purely by the group_deleted reply -> navigate.
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

    await context.close()
  })
})