import { test, expect } from '@playwright/test'
import { io } from 'socket.io-client'
import { testRunId, inviteCodeFor } from './helpers.js'

// HG-1: when a host abandons the group (gone > 30 days and not present), the
// remaining members may leave or vote for a new host; a majority elects the
// new sole host. A present host is never voted out, a briefly-offline host is
// never affected, and a returning host cancels an in-flight election. These
// are socket-level on purpose: presence and the election are server rules.

const API_URL = 'http://localhost:5000'

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve))

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function waitForUpdate(socket, predicate, event = 'group_updated') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler)
      reject(new Error(`no matching ${event} within 10s`))
    }, 10_000)
    function handler(payload) {
      if (!predicate(payload)) return
      clearTimeout(timer)
      socket.off(event, handler)
      resolve(payload)
    }
    socket.on(event, handler)
  })
}

// Fetches a player's private view of the group (group_details).
async function view(socket, groupId) {
  socket.emit('get_group', { groupId })
  return once(socket, 'group_details')
}

// Builds a group over raw sockets and joins `members` into it.
async function rawGroup(host, members, { name } = {}) {
  host.socket.emit('create_group', { groupData: { name, settings: {} } })
  const { group } = await once(host.socket, 'group_created')
  for (const m of members) {
    m.socket.emit('join_group', { inviteCode: group.inviteCode })
    await once(m.socket, 'group_joined')
  }
  return group.id
}

// Simulates an abandoned host: backdate their lastSeenAt past the 30-day
// threshold and take them offline. Returns after the disconnect has settled.
async function abandonHost(host, groupId, { daysAgo = 31 } = {}) {
  host.socket.emit('test_backdate_last_seen', { groupId, userId: host.id, daysAgo })
  await once(host.socket, 'test_backdated')
  host.socket.close()
  await sleep(400)
}

test.describe('host abandonment election', () => {
  test('presence is tracked: lastSeenAt is stamped on connect and join', async () => {
    const runId = testRunId()
    const host = connect(`he-host-${runId}`, 'Presence Host')
    const member = connect(`he-member-${runId}`, 'Presence Member')
    await Promise.all([host.ready, member.ready])

    const groupId = await rawGroup(host, [member], { name: `Presence ${runId}` })

    const hostView = await view(host.socket, groupId)
    const hostPlayer = hostView.group.players.find(p => p.userId === host.id)
    expect(hostPlayer.lastSeenAt, 'the creator is stamped as present').toBeTruthy()

    const memberView = await view(member.socket, groupId)
    const memberPlayer = memberView.group.players.find(p => p.userId === member.id)
    expect(memberPlayer.lastSeenAt, 'a joiner is stamped as present').toBeTruthy()

    host.socket.close(); member.socket.close()
  })

  test('a present host is never offered an election', async () => {
    const runId = testRunId()
    const host = connect(`he-host-${runId}`, 'Present Host')
    const member = connect(`he-member-${runId}`, 'Present Member')
    await Promise.all([host.ready, member.ready])

    const groupId = await rawGroup(host, [member], { name: `Present ${runId}` })

    const memberView = await view(member.socket, groupId)
    expect(memberView.group.hostAbandoned, 'a present host is not abandoned').toBe(false)

    member.socket.emit('host_election_open', { groupId })
    const err = await once(member.socket, 'error')
    expect(err.message).toContain('The host is still here')

    host.socket.close(); member.socket.close()
  })

  test('a briefly-offline host is never affected', async () => {
    const runId = testRunId()
    const host = connect(`he-host-${runId}`, 'Brief Host')
    const member = connect(`he-member-${runId}`, 'Brief Member')
    await Promise.all([host.ready, member.ready])

    const groupId = await rawGroup(host, [member], { name: `Brief ${runId}` })

    // The host drops offline for a moment, but their lastSeenAt is recent.
    host.socket.close()
    await sleep(400)

    const memberView = await view(member.socket, groupId)
    expect(memberView.group.hostAbandoned, 'a brief disconnect is not abandonment').toBe(false)

    member.socket.emit('host_election_open', { groupId })
    const err = await once(member.socket, 'error')
    expect(err.message).toContain('The host is still here')

    member.socket.close()
  })

  test('an abandoned host opens the election, and a member cannot vote for themselves', async () => {
    const runId = testRunId()
    const host = connect(`he-host-${runId}`, 'Abandoned Host')
    const a = connect(`he-a-${runId}`, 'Member A')
    const b = connect(`he-b-${runId}`, 'Member B')
    await Promise.all([host.ready, a.ready, b.ready])

    const groupId = await rawGroup(host, [a, b], { name: `Abandoned ${runId}` })
    await abandonHost(host, groupId)

    const aView = await view(a.socket, groupId)
    expect(aView.group.hostAbandoned, 'a host gone > 30 days is abandoned').toBe(true)

    // A member opens the election.
    a.socket.emit('host_election_open', { groupId })
    await waitForUpdate(a.socket, (p) => p.group?.election?.open === true)

    // A self-vote is refused.
    a.socket.emit('host_vote', { groupId, candidateId: a.id })
    const err = await once(a.socket, 'error')
    expect(err.message).toContain('You cannot vote for yourself')

    a.socket.close(); b.socket.close()
  })

  test('a majority elects the new sole host, who can then delete the group', async () => {
    const runId = testRunId()
    const host = connect(`he-host-${runId}`, 'Election Host')
    const a = connect(`he-a-${runId}`, 'Member A')
    const b = connect(`he-b-${runId}`, 'Member B')
    const c = connect(`he-c-${runId}`, 'Member C')
    await Promise.all([host.ready, a.ready, b.ready, c.ready])

    const groupId = await rawGroup(host, [a, b, c], { name: `Election ${runId}` })
    await abandonHost(host, groupId)

    // Electorate is the three non-host members; majority is > 1.5, i.e. 2 votes.
    a.socket.emit('host_election_open', { groupId })
    await waitForUpdate(a.socket, (p) => p.group?.election?.open === true)

    // One vote is not yet a majority: the host is unchanged.
    a.socket.emit('host_vote', { groupId, candidateId: b.id })
    await waitForUpdate(a.socket, (p) => p.group?.election?.votes?.[a.id] === b.id)
    let state = await view(a.socket, groupId)
    expect(state.group.host, 'one vote is not a majority').toBe(host.id)

    // A second vote for the same candidate reaches the majority and transfers.
    c.socket.emit('host_vote', { groupId, candidateId: b.id })
    await waitForUpdate(c.socket, (p) => p.group?.host === b.id)

    state = await view(a.socket, groupId)
    expect(state.group.host, 'the elected member becomes the sole host').toBe(b.id)
    expect(state.group.election, 'the election closes on resolution').toBeNull()

    // The new host inherits host powers: they can delete the group.
    const deleted = once(a.socket, 'group_deleted')
    b.socket.emit('delete_group', { groupId })
    expect((await deleted).groupId).toBe(groupId)

    a.socket.close(); b.socket.close(); c.socket.close()
  })

  test('a returning host cancels an in-flight election', async () => {
    const runId = testRunId()
    const host = connect(`he-host-${runId}`, 'Returning Host')
    const a = connect(`he-a-${runId}`, 'Member A')
    const b = connect(`he-b-${runId}`, 'Member B')
    await Promise.all([host.ready, a.ready, b.ready])

    const groupId = await rawGroup(host, [a, b], { name: `Return ${runId}` })
    await abandonHost(host, groupId)

    a.socket.emit('host_election_open', { groupId })
    await waitForUpdate(a.socket, (p) => p.group?.election?.open === true)

    // A vote is cast but no majority yet.
    a.socket.emit('host_vote', { groupId, candidateId: b.id })
    await waitForUpdate(a.socket, (p) => p.group?.election?.votes?.[a.id] === b.id)

    // The original host returns before the election resolves. The abandonHost
    // helper closed the original socket, so the host reconnects fresh.
    const returning = connect(`he-host-${runId}`, 'Returning Host')
    await returning.ready
    const inviteCode = await inviteCodeFor(host.id, groupId)
    const rejoined = new Promise((resolve) => {
      returning.socket.once('group_joined', resolve)
      returning.socket.emit('join_group', { inviteCode })
    })
    await rejoined

    const aView = await view(a.socket, groupId)
    expect(aView.group.election, 'the election cancels when the host returns').toBeNull()
    expect(aView.group.host, 'the returning host keeps the group').toBe(host.id)

    a.socket.close(); b.socket.close(); returning.socket.close()
  })
})
