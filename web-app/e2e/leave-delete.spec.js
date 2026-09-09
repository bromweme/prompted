import { test, expect } from '@playwright/test'
import { io } from 'socket.io-client'
import { createGroupThroughWizard, seedTestUser, testRunId } from './helpers.js'

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
    m.socket.emit('join_group', { groupId: group.id })
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
    leaver.socket.emit('join_group', { groupId })
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

    member.socket.emit('join_group', { groupId })
    await once(member.socket, 'group_joined')

    // Back on the roster as a full member before the host.
    const players = await fetchPlayers(host.socket, groupId)
    expect(players).toHaveLength(2)
    expect(players.map((p) => p.userId)).toContain(member.id)

    host.socket.close()
    member.socket.close()
  })
})