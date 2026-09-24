import { test, expect } from '@playwright/test'
import { connectAs, testRunId } from './helpers.js'

// Join requests, kicks and bans (JR-1), driven over socket.io. Strangers
// from Open Groups view a group and ask to join; the host accepts or
// declines (three declines and they can't ask again). The host can kick a
// member (they may return) or ban someone (every way in is refused until
// unbanned). Nobody new joins while a round is under way.

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve))

// Resolves with the first `event` payload that satisfies `match`.
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

async function createGroup(host, { name, isPrivate = false, settings = {} }) {
  host.socket.emit('create_group', { groupData: { name, isPrivate, settings } })
  const { group } = await once(host.socket, 'group_created')
  return group
}

async function joinByInvite(player, group) {
  const joined = once(player.socket, 'group_joined')
  player.socket.emit('join_group', { inviteCode: group.inviteCode })
  return joined
}

async function preview(player, groupId) {
  const reply = once(player.socket, 'group_preview')
  player.socket.emit('get_group_preview', { groupId })
  return (await reply).preview
}

async function details(player, groupId) {
  const reply = once(player.socket, 'group_details')
  player.socket.emit('get_group', { groupId })
  return reply
}

async function requestJoin(player, groupId) {
  const update = waitFor(player.socket, 'join_request_update', (u) => u.groupId === groupId)
  player.socket.emit('request_join', { groupId })
  return update
}

async function respond(host, groupId, requesterId, accept) {
  host.socket.emit('respond_join_request', { groupId, requesterId, accept })
}

async function startRound(host, groupId, extra = {}) {
  const started = waitFor(host.socket, 'group_updated', ({ group }) =>
    group.id === groupId && group.status === 'active' && group.currentTheme)
  host.socket.emit('start_group', { groupId, ...extra })
  return started
}

test.describe('viewing a group before joining', () => {
  let runId, host, stranger

  test.beforeEach(async () => {
    runId = testRunId()
    host = connectAs(`jrv-host-${runId}`, 'Preview Host')
    stranger = connectAs(`jrv-str-${runId}`, 'Stranger')
    await Promise.all([host.ready, stranger.ready])
  })

  test.afterEach(() => {
    host.socket.close()
    stranger.socket.close()
  })

  test('shows name, host, and members, but no invite code or ids', async () => {
    const group = await createGroup(host, { name: `Viewable ${runId}` })

    const view = await preview(stranger, group.id)
    expect(view).toMatchObject({
      id: group.id,
      name: `Viewable ${runId}`,
      hostName: 'Preview Host',
      members: [{ username: 'Preview Host', isHost: true }],
      request: { status: 'none', declinesLeft: 3 },
    })
    expect(JSON.stringify(view)).not.toContain(group.inviteCode)
    expect(JSON.stringify(view)).not.toContain(host.id)
  })

  test('a private group has no preview', async () => {
    const group = await createGroup(host, { name: `Hidden ${runId}`, isPrivate: true })
    expect(await preview(stranger, group.id)).toBeNull()
  })
})

test.describe('requesting to join', () => {
  let runId, host, stranger

  test.beforeEach(async () => {
    runId = testRunId()
    host = connectAs(`jr-host-${runId}`, 'Request Host')
    stranger = connectAs(`jr-str-${runId}`, 'Hopeful Player')
    await Promise.all([host.ready, stranger.ready])
  })

  test.afterEach(() => {
    host.socket.close()
    stranger.socket.close()
  })

  test('a request shows up for the host only, and accepting adds the player', async () => {
    const group = await createGroup(host, { name: `Gatekept ${runId}` })
    const member = connectAs(`jr-mem-${runId}`, 'Existing Member')
    await member.ready
    await joinByInvite(member, group)

    const hostSees = waitFor(host.socket, 'group_updated', ({ hostPanel }) => hostPanel?.joinRequests.length === 1)
    const memberSees = waitFor(member.socket, 'group_updated', ({ group: g }) => g.id === group.id)
    const pending = await requestJoin(stranger, group.id)
    expect(pending.request.status).toBe('pending')

    const { hostPanel } = await hostSees
    expect(hostPanel.joinRequests[0]).toMatchObject({ userId: stranger.id, username: 'Hopeful Player' })
    const memberUpdate = await memberSees
    expect(memberUpdate.hostPanel).toBeNull()
    expect(memberUpdate.group).not.toHaveProperty('joinRequests')

    const accepted = waitFor(stranger.socket, 'join_request_update', (u) => u.outcome === 'accepted')
    await respond(host, group.id, stranger.id, true)
    expect((await accepted).request.status).toBe('member')

    const { group: loaded } = await details(stranger, group.id)
    expect(loaded.players.map((p) => p.userId)).toContain(stranger.id)
    member.socket.close()
  })

  test('the requester can cancel', async () => {
    const group = await createGroup(host, { name: `Cancelled ${runId}` })
    await requestJoin(stranger, group.id)

    const cleared = waitFor(host.socket, 'group_updated', ({ hostPanel }) => hostPanel?.joinRequests.length === 0)
    stranger.socket.emit('cancel_join_request', { groupId: group.id })
    await cleared
    expect((await preview(stranger, group.id)).request.status).toBe('none')
  })

  test('the open list marks a group this player has asked to join', async () => {
    const group = await createGroup(host, { name: `Marked ${runId}` })
    await requestJoin(stranger, group.id)

    const listed = once(stranger.socket, 'open_groups_list')
    stranger.socket.emit('get_open_groups', { query: runId })
    const { groups } = await listed
    expect(groups.find((g) => g.id === group.id)).toMatchObject({ requested: true })
  })

  test('three declines and they can no longer ask', async () => {
    const group = await createGroup(host, { name: `Strikes ${runId}` })

    for (const left of [2, 1]) {
      await requestJoin(stranger, group.id)
      const declined = waitFor(stranger.socket, 'join_request_update', (u) => u.outcome === 'declined')
      await respond(host, group.id, stranger.id, false)
      expect((await declined).request).toEqual({ status: 'none', declinesLeft: left })
    }

    await requestJoin(stranger, group.id)
    const third = waitFor(stranger.socket, 'join_request_update', (u) => u.outcome === 'declined')
    await respond(host, group.id, stranger.id, false)
    expect((await third).request).toEqual({ status: 'blocked', declinesLeft: 0 })

    const refused = once(stranger.socket, 'error')
    stranger.socket.emit('request_join', { groupId: group.id })
    expect((await refused).message).toBe('The host has declined your requests to join this group')
  })

  test('only the host can respond to a request', async () => {
    const group = await createGroup(host, { name: `HostOnly ${runId}` })
    const member = connectAs(`jr-m2-${runId}`, 'Member')
    await member.ready
    await joinByInvite(member, group)
    await requestJoin(stranger, group.id)

    const refused = once(member.socket, 'error')
    member.socket.emit('respond_join_request', { groupId: group.id, requesterId: stranger.id, accept: true })
    expect((await refused).message).toBe('Only the host can respond to join requests')
    member.socket.close()
  })
})

test.describe('kicking and banning', () => {
  let runId, host, player

  test.beforeEach(async () => {
    runId = testRunId()
    host = connectAs(`kb-host-${runId}`, 'Strict Host')
    player = connectAs(`kb-ply-${runId}`, 'Rowdy Player')
    await Promise.all([host.ready, player.ready])
  })

  test.afterEach(() => {
    host.socket.close()
    player.socket.close()
  })

  test('a kicked player is removed and told, and can come back', async () => {
    const group = await createGroup(host, { name: `Kick ${runId}` })
    await joinByInvite(player, group)

    const told = waitFor(player.socket, 'removed_from_group', (e) => e.groupId === group.id)
    host.socket.emit('kick_player', { groupId: group.id, targetId: player.id })
    expect(await told).toMatchObject({ reason: 'kicked', groupName: `Kick ${runId}` })

    const { group: afterKick } = await details(host, group.id)
    expect(afterKick.players.map((p) => p.userId)).toEqual([host.id])

    const { group: rejoined } = await joinByInvite(player, group)
    expect(rejoined.players.map((p) => p.userId)).toContain(player.id)
  })

  test('a banned player is removed, and every way back in is refused', async () => {
    const group = await createGroup(host, { name: `Ban ${runId}` })
    await joinByInvite(player, group)

    const told = waitFor(player.socket, 'removed_from_group', (e) => e.groupId === group.id)
    host.socket.emit('ban_player', { groupId: group.id, targetId: player.id })
    expect((await told).reason).toBe('banned')

    const codeRefused = once(player.socket, 'error')
    player.socket.emit('join_group', { inviteCode: group.inviteCode })
    expect((await codeRefused).message).toBe("You have been banned from this group. Think about what you've done.")

    const requestRefused = once(player.socket, 'error')
    player.socket.emit('request_join', { groupId: group.id })
    expect((await requestRefused).message).toBe("You have been banned from this group. Think about what you've done.")

    const listed = once(player.socket, 'open_groups_list')
    player.socket.emit('get_open_groups', { query: runId })
    expect((await listed).groups.map((g) => g.id)).not.toContain(group.id)

    const { hostPanel } = await details(host, group.id)
    expect(hostPanel.bannedUsers).toEqual([expect.objectContaining({ userId: player.id, username: 'Rowdy Player' })])
  })

  test('a requester can be banned straight from the queue', async () => {
    const group = await createGroup(host, { name: `BanRequest ${runId}` })
    await requestJoin(player, group.id)

    const told = waitFor(player.socket, 'join_request_update', (u) => u.request.status === 'banned')
    host.socket.emit('ban_player', { groupId: group.id, targetId: player.id })
    await told

    const { hostPanel } = await details(host, group.id)
    expect(hostPanel.joinRequests).toEqual([])
    expect(hostPanel.bannedUsers.map((b) => b.userId)).toEqual([player.id])
  })

  test('unbanning lets them back in', async () => {
    const group = await createGroup(host, { name: `Unban ${runId}` })
    await joinByInvite(player, group)
    host.socket.emit('ban_player', { groupId: group.id, targetId: player.id })
    await waitFor(player.socket, 'removed_from_group')

    const lifted = waitFor(host.socket, 'group_updated', ({ hostPanel }) => hostPanel?.bannedUsers.length === 0)
    host.socket.emit('unban_player', { groupId: group.id, targetId: player.id })
    await lifted

    const { group: rejoined } = await joinByInvite(player, group)
    expect(rejoined.players.map((p) => p.userId)).toContain(player.id)
  })

  test('only the host can kick or ban, and not themselves', async () => {
    const group = await createGroup(host, { name: `Powers ${runId}` })
    await joinByInvite(player, group)

    const kickRefused = once(player.socket, 'error')
    player.socket.emit('kick_player', { groupId: group.id, targetId: host.id })
    expect((await kickRefused).message).toBe('Only the host can remove players')

    const banRefused = once(player.socket, 'error')
    player.socket.emit('ban_player', { groupId: group.id, targetId: host.id })
    expect((await banRefused).message).toBe('Only the host can ban players')

    const selfRefused = once(host.socket, 'error')
    host.socket.emit('kick_player', { groupId: group.id, targetId: host.id })
    expect((await selfRefused).message).toBe("The host can't remove themselves")
  })
})

test.describe('no joining during a round', () => {
  let runId, host, member, newcomer

  test.beforeEach(async () => {
    runId = testRunId()
    host = connectAs(`mr-host-${runId}`, 'Round Host')
    member = connectAs(`mr-mem-${runId}`, 'Round Member')
    newcomer = connectAs(`mr-new-${runId}`, 'Latecomer')
    await Promise.all([host.ready, member.ready, newcomer.ready])
  })

  test.afterEach(() => {
    host.socket.close()
    member.socket.close()
    newcomer.socket.close()
  })

  test('an invite code refuses a new member mid-round, but a member can rejoin', async () => {
    const group = await createGroup(host, { name: `MidRound ${runId}` })
    await joinByInvite(member, group)
    await startRound(host, group.id)

    const refused = once(newcomer.socket, 'error')
    newcomer.socket.emit('join_group', { inviteCode: group.inviteCode })
    expect((await refused).message).toBe('This group is in the middle of a round. You can join once it ends.')

    const { group: again } = await joinByInvite(member, group)
    expect(again.players.map((p) => p.userId)).toContain(member.id)
  })

  test("a request can't be accepted mid-round", async () => {
    const group = await createGroup(host, { name: `Queued ${runId}` })
    await joinByInvite(member, group)
    await startRound(host, group.id)

    await requestJoin(newcomer, group.id)
    const refused = once(host.socket, 'error')
    await respond(host, group.id, newcomer.id, true)
    expect((await refused).message).toBe('You can accept requests once the current round ends')
  })

  test('starting with pending requests asks the host first, then keeps them queued', async () => {
    const group = await createGroup(host, { name: `Confirm ${runId}` })
    await joinByInvite(member, group)
    await requestJoin(newcomer, group.id)

    const asked = once(host.socket, 'start_needs_confirmation')
    host.socket.emit('start_group', { groupId: group.id })
    expect(await asked).toMatchObject({ groupId: group.id, pendingCount: 1 })
    const { group: notStarted } = await details(host, group.id)
    expect(notStarted.status).toBe('setup')

    await startRound(host, group.id, { startWithoutPending: true })
    const { hostPanel } = await details(host, group.id)
    expect(hostPanel.joinRequests.map((r) => r.userId)).toEqual([newcomer.id])
  })
})

test.describe('the my-groups list', () => {
  test("never carries the Judge's identity or the host's private data", async () => {
    const runId = testRunId()
    const host = connectAs(`gl-host-${runId}`, 'List Host')
    const member = connectAs(`gl-mem-${runId}`, 'List Member')
    await Promise.all([host.ready, member.ready])
    const group = await createGroup(host, { name: `Listed ${runId}` })
    await joinByInvite(member, group)
    await startRound(host, group.id)

    const listed = once(member.socket, 'groups_list')
    member.socket.emit('get_groups')
    const mine = (await listed).groups.find((g) => g.id === group.id)
    expect(mine.currentTheme).toBeTruthy()
    expect(JSON.stringify(mine)).not.toContain('czarId')
    expect(mine).not.toHaveProperty('hostNotices')
    expect(mine).not.toHaveProperty('joinRequests')
    expect(mine).not.toHaveProperty('bannedUsers')

    host.socket.close()
    member.socket.close()
  })
})

// --- Wave 13 review fixes ---------------------------------------------------
//
// Removing someone from the roster used to stop at `group.players`, leaving
// their fingerprints in the round still being decided. Each of these fails
// against the pre-fix server.

test.describe('removing a player mid-round', () => {
  let runId, host, member, third

  test.beforeEach(async () => {
    runId = testRunId()
    host = connectAs(`jrr-host-${runId}`, 'Round Host')
    member = connectAs(`jrr-mem-${runId}`, 'Doomed Member')
    third = connectAs(`jrr-third-${runId}`, 'Third Player')
    await Promise.all([host.ready, member.ready, third.ready])
  })

  test.afterEach(() => {
    host.socket.close()
    member.socket.close()
    third.socket.close()
  })

  // Puts the group into the submission phase with `host` as Judge, so the
  // other two are the contestants.
  async function startSubmissionPhase(name) {
    const group = await createGroup(host, { name })
    await joinByInvite(member, group)
    await joinByInvite(third, group)

    await startRound(host, group.id, { czarUserId: host.id })

    const topicMade = once(host.socket, 'topic_submitted')
    host.socket.emit('submit_topic', { text: `Roster topic ${runId}`, isPublic: false })
    const { topic } = await topicMade

    const submitting = waitFor(host.socket, 'group_updated', ({ group: g }) =>
      g.id === group.id && g.currentTheme && g.currentTheme.status === 'submission')
    host.socket.emit('select_topic', { groupId: group.id, topicId: topic.id })
    await submitting

    return group
  }

  test("a kicked player's submission leaves the round with them", async () => {
    const group = await startSubmissionPhase(`Kick Mid Round ${runId}`)

    const submitted = waitFor(host.socket, 'group_updated', ({ group: g }) =>
      g.currentTheme && g.currentTheme.submissionCount === 1)
    member.socket.emit('submit_video', { groupId: group.id, videoId: 'dQw4w9WgXcQ', title: 'Doomed entry' })
    await submitted

    // Kicking them must take the entry with them. Left behind, it could win a
    // round they are no longer in: the scoring lookup is by player, so the
    // reveal named the winner "Unknown" and awarded the points to nobody,
    // while everyone who voted for it still scored.
    const kicked = waitFor(host.socket, 'group_updated', ({ group: g }) => g.players.length === 2)
    host.socket.emit('kick_player', { groupId: group.id, targetId: member.id })
    const after = await kicked

    expect(after.group.currentTheme.submissionCount).toBe(0)
  })

  test('kicking the last player a round is waiting on opens voting instead of stalling', async () => {
    const group = await startSubmissionPhase(`Kick Opens Voting ${runId}`)

    const submitted = waitFor(host.socket, 'group_updated', ({ group: g }) =>
      g.currentTheme && g.currentTheme.submissionCount === 1)
    third.socket.emit('submit_video', { groupId: group.id, videoId: 'dQw4w9WgXcQ', title: 'Only entry' })
    await submitted

    // The all-submitted check used to live inside submit_video alone, so it
    // was only ever reachable by someone submitting. With the one outstanding
    // contestant removed, everybody left had submitted and nothing noticed —
    // the round sat until its deadline hours later.
    const voting = waitFor(host.socket, 'group_updated', ({ group: g }) =>
      g.currentTheme && g.currentTheme.status === 'voting')
    host.socket.emit('kick_player', { groupId: group.id, targetId: member.id })

    await expect(voting).resolves.toBeTruthy()
  })

  test('kicking the Judge during topic selection passes the role on', async () => {
    // anonymousCzar: false publishes czarUsername, which is the only way to
    // see who holds the role from outside — czarId is stripped from every
    // broadcast. Asserting on the name is direct; inferring it from whether a
    // topic can be chosen is not, and gets confounded by topic visibility.
    const group = await createGroup(host, {
      name: `Kick Judge ${runId}`,
      settings: { anonymousCzar: false }
    })
    await joinByInvite(member, group)
    await joinByInvite(third, group)

    // The doomed member is the Judge, and topic selection has no deadline —
    // the submission clock only starts once a topic is chosen. So a Judge who
    // is removed and not replaced strands the round outright, and the host has
    // to notice and reassign by hand.
    const started = await startRound(host, group.id, { czarUserId: member.id })
    expect(started.group.currentTheme.status).toBe('topic_selection')
    expect(started.group.currentTheme.czarUsername).toBe('Doomed Member')

    const kicked = waitFor(host.socket, 'group_updated', ({ group: g }) => g.players.length === 2)
    host.socket.emit('kick_player', { groupId: group.id, targetId: member.id })
    const after = await kicked

    // Still choosing a topic, but somebody who is actually in the group now
    // holds the role.
    expect(after.group.currentTheme.status).toBe('topic_selection')
    expect(after.group.currentTheme.czarUsername).not.toBe('Doomed Member')
    expect(['Round Host', 'Third Player']).toContain(after.group.currentTheme.czarUsername)
  })
})

test.describe('what a non-member can learn', () => {
  test('cancelling a join request cannot be used to discover which groups exist', async () => {
    const runId = testRunId()
    const host = connectAs(`jro-host-${runId}`, 'Oracle Host')
    const stranger = connectAs(`jro-str-${runId}`, 'Curious Stranger')
    await Promise.all([host.ready, stranger.ready])

    // A private group: the one thing UI-2's membership gate promises is that a
    // non-member learns nothing about it, "not even that it exists".
    const secret = await createGroup(host, { name: `Secret ${runId}`, isPrivate: true })

    const realReply = waitFor(stranger.socket, 'join_request_update', (u) => u.groupId === secret.id)
    stranger.socket.emit('cancel_join_request', { groupId: secret.id })

    const madeUp = `group_does_not_exist_${runId}`
    const fakeReply = waitFor(stranger.socket, 'join_request_update', (u) => u.groupId === madeUp)
    stranger.socket.emit('cancel_join_request', { groupId: madeUp })

    // The handler used to return early for a missing group, so a reply meant
    // "this id is real" and silence meant "it isn't" — an existence oracle for
    // any id, private groups included.
    const real = await realReply
    const fake = await fakeReply
    expect(real.request).toEqual(fake.request)

    host.socket.close()
    stranger.socket.close()
  })
})

test.describe('the shared group payload', () => {
  test('carries only named fields, so a new one cannot leak by default', async () => {
    const runId = testRunId()
    const host = connectAs(`jrp-host-${runId}`, 'Payload Host')
    await host.ready

    const group = await createGroup(host, { name: `Payload ${runId}` })
    const reply = await details(host, group.id)
    const received = reply.group

    // publicizeGroup is an allowlist. A field added to a group and not named
    // there must not reach players; this states that contract from the outside
    // so it fails if the allowlist ever becomes a spread again.
    const allowed = new Set([
      'id', 'inviteCode', 'name', 'description', 'isPrivate', 'host', 'players',
      'settings', 'status', 'currentRound', 'history', 'usedTopicIds', 'hostTopics',
      'setNumber', 'completedSets', 'finalStandings', 'election', 'judgedThisCycle',
      'createdAt', 'currentTheme', 'hostAbandoned'
    ])
    expect(Object.keys(received).filter((key) => !allowed.has(key))).toEqual([])

    host.socket.close()
  })
})
