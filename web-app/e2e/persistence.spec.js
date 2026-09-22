import { test, expect } from '@playwright/test'
import { connectAs, testRunId } from './helpers.js'

// Persistence (DB-1 phase 4): state written through the real server survives
// its in-memory cache being thrown away.
//
// Every other test in this repo would pass against a store that only ever
// lived in memory — each one writes and reads back inside a single process
// lifetime, so the database is never actually consulted. That is precisely how
// production came to be destroying all of its data on every restart without a
// single failing test. `server/test/persistence.test.js` covers the store at
// unit level; these drive the real server over sockets, the way a player does,
// and then prove the data comes back from the database.
//
// The reload is a test-only handler (server.js, AUTH_TEST_MODE only): it
// flushes the pending writes and calls initStores(), which replaces every
// store's cache with what the database holds. Anything that never reached the
// database is gone by the time the assertions run.

// Every wait has a timeout, so a reply that never comes fails the test with a
// name instead of hanging it.
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
const once = (socket, event, timeoutMs) => waitFor(socket, event, () => true, timeoutMs)

const phaseIs = (groupId, phase) => ({ group }) => group?.id === groupId && group?.currentTheme?.status === phase

/**
 * Drops every store's in-memory cache and reloads it from the database — the
 * closest a running process gets to a restart. Everything after this call
 * reads state that made the round trip through the database.
 */
async function reloadStores(player) {
  const reloaded = waitFor(player.socket, 'test_stores_reloaded', () => true, 20_000)
  player.socket.emit('test_reload_stores')
  const { stores } = await reloaded
  // A reload that loaded nothing would make every "it survived" assertion
  // below meaningless, so say so here rather than let it look like missing data.
  expect(stores, 'the reload covered no stores at all').toBeGreaterThan(0)
}

/**
 * get_group, but an error reply rejects immediately with what the server
 * actually said. After a reload, "Group not found" means the group was never
 * in the database — the failure worth naming. Without this it would surface
 * only as a ten-second wait for a reply that is never coming.
 */
function groupDetails(player, groupId) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      player.socket.off('group_details', onDetails)
      player.socket.off('error', onError)
    }
    const onDetails = (payload) => {
      if (payload.group?.id !== groupId) return
      cleanup()
      resolve(payload)
    }
    const onError = ({ message }) => {
      cleanup()
      reject(new Error(`the server refused get_group with "${message}" — group ${groupId} did not come back from the database`))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`no group_details for ${groupId} within 10000ms`))
    }, 10_000)
    player.socket.on('group_details', onDetails)
    player.socket.on('error', onError)
    player.socket.emit('get_group', { groupId })
  })
}

// The fields a restart must bring back intact. Deliberately not the whole
// group: `connected`, `lastSeenAt` and a player's socket id are properties of
// the live connection, not of the stored state, and get_group refreshes them
// every time it is called.
function persistentShape(group) {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    inviteCode: group.inviteCode,
    isPrivate: group.isPrivate,
    host: group.host,
    status: group.status,
    currentRound: group.currentRound,
    setNumber: group.setNumber,
    usedTopicIds: group.usedTopicIds,
    judgedThisCycle: group.judgedThisCycle,
    settings: group.settings,
    players: group.players.map((p) => ({
      userId: p.userId, username: p.username, score: p.score, isHost: p.isHost
    })),
    history: group.history,
  }
}

// Keeps each player's latest view of the group, which is how a player learns
// they are this round's Judge (isRoundLeader only ever arrives in an update).
function track(player, groupId) {
  player.view = null
  const keep = (payload) => {
    if (payload.group?.id !== groupId) return
    player.view = { ...(player.view || {}), ...payload }
  }
  player.socket.on('group_updated', keep)
  player.socket.on('group_details', keep)
  player.socket.on('group_joined', keep)
}

async function buildGroup(runId, prefix, size, groupData) {
  const players = Array.from({ length: size }, (_, i) =>
    connectAs(`${prefix}${i}-${runId}`, `${prefix.toUpperCase()} Player ${i + 1}`))
  await Promise.all(players.map((p) => p.ready))
  const [host] = players
  host.socket.emit('create_group', { groupData })
  const { group } = await once(host.socket, 'group_created')
  players.forEach((p) => track(p, group.id))
  for (const p of players.slice(1)) {
    const joined = once(p.socket, 'group_joined')
    p.socket.emit('join_group', { inviteCode: group.inviteCode })
    await joined
  }
  return { host, players, groupId: group.id, closeAll: () => players.forEach((p) => p.socket.close()) }
}

async function allSee(players, groupId, phase) {
  await Promise.all(players.map((p) =>
    p.view?.group?.currentTheme?.status === phase
      ? null
      : waitFor(p.socket, 'group_updated', phaseIs(groupId, phase))))
}

/**
 * Plays one round through to the reveal, which is what fills `history` and
 * moves the players' scores off zero. Modelled on game-rules.spec.js.
 */
async function playOneRound({ players, groupId, runId }) {
  const judge = players.find((p) => p.view?.isRoundLeader === true)
  if (!judge) throw new Error('no Judge found')
  const others = players.filter((p) => p !== judge)

  const created = once(judge.socket, 'topic_submitted')
  judge.socket.emit('submit_topic', { text: `Round topic ${runId}`, isPublic: false })
  const topicId = (await created).topic.id

  const open = allSee(players, groupId, 'submission')
  judge.socket.emit('select_topic', { groupId, topicId })
  await open

  const voting = allSee(players, groupId, 'voting')
  for (const [i, p] of others.entries()) {
    const videoId = `pers${i}`.padEnd(11, 'x').slice(0, 11)
    const submitted = waitFor(p.socket, 'group_updated', (u) => u.group.id === groupId && !!u.yourSubmissionId)
    p.socket.emit('submit_video', {
      groupId, videoId, title: `Persisted song ${i}`,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, channelTitle: 'Test Channel'
    })
    await submitted
  }
  await voting

  for (const p of others) {
    const { group, yourSubmissionId } = p.view
    const target = group.currentTheme.submissions.find((sub) => sub.id !== yourSubmissionId)
    if (!target) continue
    const counted = waitFor(p.socket, 'group_updated', (u) => u.group.id === groupId)
    p.socket.emit('cast_vote', { groupId, submissionId: target.id, points: 1 })
    await counted
  }

  const winner = judge.view.group.currentTheme.submissions[0]
  const reveal = allSee(players, groupId, 'reveal')
  judge.socket.emit('czar_select_winner', { groupId, submissionId: winner.id })
  await reveal
  return judge
}

test.describe('state survives a cold cache', () => {
  test('a played group comes back from the database intact', async () => {
    test.setTimeout(120_000)
    const runId = testRunId()
    const g = await buildGroup(runId, 'pgroup', 3, {
      name: `Persisted group ${runId}`,
      description: 'Proves a group survives a restart',
      isPrivate: false,
      // Set away from their defaults on purpose: a settings object that came
      // back as defaults rather than as stored would be invisible otherwise.
      settings: {
        totalRounds: 3, voteBudget: 7, shareTheWealth: false,
        allowCustomTopics: true, overrideThreshold: 80
      },
    })

    const started = allSee(g.players, g.groupId, 'topic_selection')
    g.host.socket.emit('start_group', { groupId: g.groupId })
    await started
    await playOneRound({ ...g, runId })

    const { group: before } = await groupDetails(g.host, g.groupId)
    expect(before.history, 'the round did not produce a history entry to test with').toHaveLength(1)

    await reloadStores(g.host)

    const { group: after } = await groupDetails(g.host, g.groupId)
    expect(
      persistentShape(after),
      'the group came back from the database with different contents than it was stored with'
    ).toEqual(persistentShape(before))

    // Named individually so a diff of the whole group is not the only thing a
    // reader has to go on: these are the nested structures a serialization bug
    // would flatten or drop while the group itself still loaded.
    expect(after.players, 'the players did not survive the reload').toHaveLength(3)
    expect(after.players.map((p) => p.score).reduce((a, b) => a + b, 0),
      'the scores came back as zero, so the players were reloaded without their round').toBeGreaterThan(0)
    expect(after.settings.shareTheWealth,
      'shareTheWealth came back as its default, not as the value the host chose').toBe(false)
    expect(after.settings.voteBudget, 'the vote budget did not survive the reload').toBe(7)
    expect(after.history[0].videos, 'the round history came back without its videos').toHaveLength(2)
    expect(after.history[0].title, 'the round history came back without its topic').toBe(`Round topic ${runId}`)
    expect(after.usedTopicIds, 'the played-topic list did not survive the reload').toEqual(before.usedTopicIds)

    g.closeAll()
  })

  test('topics, notifications and a profile all come back', async () => {
    const runId = testRunId()
    const host = connectAs(`pmisc-host-${runId}`, 'Misc Host')
    const guest = connectAs(`pmisc-guest-${runId}`, 'Misc Guest')
    await Promise.all([host.ready, guest.ready])

    // Profile: changed away from what the handshake identity carries, so a
    // profile that was not persisted is rebuilt from the handshake instead and
    // the difference is unmissable.
    const chosenName = `Renamed ${runId}`
    const renamed = waitFor(host.socket, 'session', ({ user }) => user.name === chosenName)
    host.socket.emit('update_profile', { displayName: chosenName, avatar: '🚀' })
    await renamed

    const kept = once(host.socket, 'topic_submitted')
    host.socket.emit('submit_topic', { text: `Kept topic ${runId}`, isPublic: true })
    const keptTopic = (await kept).topic

    // Notifications are only ever produced by something happening, so this
    // joins a group rather than writing the store directly.
    host.socket.emit('create_group', { groupData: { name: `Misc group ${runId}`, settings: {} } })
    const { group } = await once(host.socket, 'group_created')
    const notified = once(host.socket, 'notification')
    guest.socket.emit('join_group', { inviteCode: group.inviteCode })
    await Promise.all([once(guest.socket, 'group_joined'), notified])

    const listed = once(host.socket, 'notifications_list')
    host.socket.emit('get_notifications')
    const { items: before } = await listed
    expect(before.length, 'the join produced no notification to test with').toBeGreaterThan(0)

    await reloadStores(host)

    const reloadedNotifications = once(host.socket, 'notifications_list')
    host.socket.emit('get_notifications')
    const { items: after } = await reloadedNotifications
    expect(after, 'the notifications were not in the database after the reload').toEqual(before)

    const reloadedTopics = once(host.socket, 'topics_list')
    host.socket.emit('get_topics')
    const { publicTopics } = await reloadedTopics
    expect(
      publicTopics.find((t) => t.id === keptTopic.id),
      'the topic was not in the database after the reload'
    ).toEqual(keptTopic)

    // A fresh connection is what actually proves the profile persisted: it
    // resolves through getOrCreateProfile, which falls back to creating one
    // from the handshake name and avatar when the store has nothing. So a
    // session reading back "Misc Host"/🎵 means the profile was never stored.
    const returning = connectAs(`pmisc-host-${runId}`, 'Misc Host')
    const { user } = await returning.ready
    expect(
      { name: user.name, avatar: user.avatar },
      'the profile was rebuilt from the handshake identity, so it was not in the database'
    ).toEqual({ name: chosenName, avatar: '🚀' })

    returning.socket.close()
    host.socket.close()
    guest.socket.close()
  })

  test('a deletion survives too', async () => {
    const runId = testRunId()
    const host = connectAs(`pdel-host-${runId}`, 'Delete Host')
    await host.ready

    // A control alongside each deleted thing: without one, "it is still gone"
    // would also pass against a store that came back completely empty, which
    // is the very failure these tests exist to catch.
    host.socket.emit('create_group', { groupData: { name: `Kept group ${runId}`, settings: {} } })
    const { group: keptGroup } = await once(host.socket, 'group_created')
    host.socket.emit('create_group', { groupData: { name: `Doomed group ${runId}`, settings: {} } })
    const { group: doomedGroup } = await once(host.socket, 'group_created')

    const keptTopicReply = once(host.socket, 'topic_submitted')
    host.socket.emit('submit_topic', { text: `Kept ${runId}`, isPublic: false })
    const keptTopic = (await keptTopicReply).topic
    const doomedTopicReply = once(host.socket, 'topic_submitted')
    host.socket.emit('submit_topic', { text: `Doomed ${runId}`, isPublic: false })
    const doomedTopic = (await doomedTopicReply).topic

    const groupGone = waitFor(host.socket, 'group_deleted', ({ groupId }) => groupId === doomedGroup.id)
    host.socket.emit('delete_group', { groupId: doomedGroup.id })
    await groupGone

    const topicGone = waitFor(host.socket, 'topic_deleted', ({ topicId }) => topicId === doomedTopic.id)
    host.socket.emit('delete_topic', { topicId: doomedTopic.id })
    await topicGone

    await reloadStores(host)

    const groupsReply = once(host.socket, 'groups_list')
    host.socket.emit('get_groups')
    const { groups } = await groupsReply
    const groupIds = groups.map((g) => g.id)
    expect(groupIds, 'the kept group was not in the database after the reload').toContain(keptGroup.id)
    expect(groupIds, 'the deleted group came back after the reload — the delete never reached the database').not.toContain(doomedGroup.id)

    const topicsReply = once(host.socket, 'topics_list')
    host.socket.emit('get_topics')
    const { privateTopics } = await topicsReply
    const topicIds = privateTopics.map((t) => t.id)
    expect(topicIds, 'the kept topic was not in the database after the reload').toContain(keptTopic.id)
    expect(topicIds, 'the deleted topic came back after the reload — the delete never reached the database').not.toContain(doomedTopic.id)

    host.socket.close()
  })
})
