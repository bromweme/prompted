import { test, expect } from '@playwright/test'
import { io } from 'socket.io-client'
import { testRunId } from './helpers.js'

const API_URL = 'http://localhost:5000'

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve))

// The server emits `session` from inside its connection handler, so the
// listener has to be attached before the connection settles. Same shape as
// the other raw-socket specs: these talk to the same authenticated server the
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
// client would. Returns the raw group state (id, host, players) after a
// get_group round trip, so the host guarantee can be asserted directly.
async function fetchGroup(socket, groupId) {
  socket.emit('get_group', { groupId })
  const { group } = await once(socket, 'group_details')
  return group
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

// A host who tries to leave must be refused: the group keeps an intact host
// who is still a current member, so it stays manageable and deletable.
test.describe('host leave_group is refused so a group is never left host-less', () => {
  test('a host who attempts leave_group is refused with no state change', async () => {
    const runId = testRunId()
    const host = connect(`hl-host-${runId}`, 'Host Player')
    const member = connect(`hl-member-${runId}`, 'Member One')
    await Promise.all([host.ready, member.ready])

    const groupId = await rawGroup(host, [member], { name: `HostLeave ${runId}` })

    // The host tries to leave with a crafted socket event...
    host.socket.emit('leave_group', { groupId })
    const err = await once(host.socket, 'error')
    expect(err.message).toContain('The host cannot leave the group')

    // ...and the group is untouched: the host is still the host, both players
    // are still on the roster, and no left_group confirmation was sent.
    const group = await fetchGroup(host.socket, groupId)
    expect(group.host).toBe(host.id)
    expect(group.players.map((p) => p.userId)).toEqual([host.id, member.id])

    host.socket.close()
    member.socket.close()
  })

  test('after a host is refused, a member can still delete the group', async () => {
    const runId = testRunId()
    const host = connect(`hl-host-${runId}`, 'Host Player')
    const member = connect(`hl-member-${runId}`, 'Member One')
    await Promise.all([host.ready, member.ready])

    const groupId = await rawGroup(host, [member], { name: `HostDelete ${runId}` })

    // Refused host leave must not corrupt the group: the host can still delete
    // it, and every member gets the deletion notice.
    host.socket.emit('leave_group', { groupId })
    await once(host.socket, 'error')

    const notice = once(member.socket, 'group_deleted')
    host.socket.emit('delete_group', { groupId })
    expect((await notice).groupId).toBe(groupId)

    // The group is permanently gone, so the serializer host guarantee holds:
    // a get_group round trip is refused rather than returning a stale host.
    member.socket.emit('get_group', { groupId })
    const err = await once(member.socket, 'error')
    expect(err.message).toContain('Group not found')

    host.socket.close()
    member.socket.close()
  })

  test('a host leaving leaves the team viable: hostship is never orphaned', async () => {
    // The acceptance bar: "A group must always have a host who is a current
    // member after any leave." Three players, and the host attempts every
    // leave variant against the group — each is refused, so every roster the
    // server can produce keeps group.host among group.players.
    const runId = testRunId()
    const host = connect(`hl-host-${runId}`, 'Host Player')
    const p2 = connect(`hl-two-${runId}`, 'Member Two')
    const p3 = connect(`hl-three-${runId}`, 'Member Three')
    await Promise.all([host.ready, p2.ready, p3.ready])

    const groupId = await rawGroup(host, [p2, p3], { name: `HostOrphan ${runId}` })

    for (let i = 0; i < 2; i++) {
      host.socket.emit('leave_group', { groupId })
      await once(host.socket, 'error')
    }

    const group = await fetchGroup(p2.socket, groupId)
    expect(group.host).toBe(host.id)
    expect(group.players.map((p) => p.userId)).toContain(group.host)

    host.socket.close()
    p2.socket.close()
    p3.socket.close()
  })

  test('a non-host member leaving is unchanged: they are removed but the host stays', async () => {
    // Confirms the ordinary member-leave path (GL-1) is untouched by the host
    // guard: a member still leaves cleanly, and the group is left with the
    // host as a current member, manageable and deletable.
    const runId = testRunId()
    const host = connect(`hl-host-${runId}`, 'Host Player')
    const leaver = connect(`hl-leave-${runId}`, 'Leaver')
    await Promise.all([host.ready, leaver.ready])

    const groupId = await rawGroup(host, [leaver], { name: `MemberLeave ${runId}` })

    leaver.socket.emit('leave_group', { groupId })
    const left = await once(leaver.socket, 'left_group')
    expect(left.groupId).toBe(groupId)

    const group = await fetchGroup(host.socket, groupId)
    expect(group.host).toBe(host.id)
    expect(group.players.map((p) => p.userId)).toEqual([host.id])

    leaver.socket.close()
    host.socket.close()
  })
})