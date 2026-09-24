import { test, expect } from '@playwright/test'
import { connectAs, testRunId } from './helpers.js'

// Games, topics and notifications (GT-1, NT-1), driven over socket.io.
// A game ("set") runs for the host's number of rounds and ends with final
// standings; the host can then start a new set. No topic plays twice in a
// set. With custom topics off, the Judge picks only from the host's list.
// Notifications record what happened for each player.
//
// Includes full games at every group size from 3 to 8 players, checking the
// whole loop and that the Judge rotates through everyone.

// Every wait has a timeout, so a dropped reply fails the test instead of
// hanging it. The server rate-limits each socket (a burst of 20, then about
// 5 a second) and drops what's over, so these helpers read each player's
// state from the updates the server pushes anyway, rather than polling.
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

async function details(player, groupId) {
  const reply = once(player.socket, 'group_details')
  player.socket.emit('get_group', { groupId })
  return reply
}

// Keeps each player's latest view of the group (their own isRoundLeader and
// yourSubmissionId included) from every update the server sends them.
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

// A group of `size` players (the first is host) with the given settings.
async function buildGroup(runId, prefix, size, settings = {}) {
  const players = Array.from({ length: size }, (_, i) =>
    connectAs(`${prefix}${i}-${runId}`, `${prefix.toUpperCase()} Player ${i + 1}`))
  await Promise.all(players.map((p) => p.ready))
  const [host] = players
  host.socket.emit('create_group', { groupData: { name: `${prefix} ${runId}`, settings } })
  const { group } = await once(host.socket, 'group_created')
  players.forEach((p) => track(p, group.id))
  for (const p of players.slice(1)) {
    const joined = once(p.socket, 'group_joined')
    p.socket.emit('join_group', { inviteCode: group.inviteCode })
    await joined
  }
  return { host, players, groupId: group.id, closeAll: () => players.forEach((p) => p.socket.close()) }
}

// This round's Judge: the one player the server told isRoundLeader.
function findJudge(players) {
  const judge = players.find((p) => p.view?.isRoundLeader === true)
  if (!judge) throw new Error('no Judge found')
  return judge
}

// Resolves once every player has seen the round reach `phase`.
async function allSee(players, groupId, phase) {
  await Promise.all(players.map((p) =>
    p.view?.group?.currentTheme?.status === phase
      ? null
      : waitFor(p.socket, 'group_updated', phaseIs(groupId, phase))))
}

// Plays the current round from topic selection through the reveal: the Judge
// picks a new topic, everyone else submits, everyone else votes for someone
// else's song, and the Judge picks the first submission as the winner.
async function playRound({ players, groupId, runId, round, topicId }) {
  const judge = findJudge(players)
  const others = players.filter((p) => p !== judge)

  let chosen = topicId
  if (!chosen) {
    const created = once(judge.socket, 'topic_submitted')
    judge.socket.emit('submit_topic', { text: `Topic r${round} ${runId}`, isPublic: false })
    chosen = (await created).topic.id
  }
  const open = allSee(players, groupId, 'submission')
  judge.socket.emit('select_topic', { groupId, topicId: chosen })
  await open

  const voting = allSee(players, groupId, 'voting')
  for (const [i, p] of others.entries()) {
    const videoId = `r${round}p${i}`.padEnd(11, 'x').slice(0, 11)
    const submitted = waitFor(p.socket, 'group_updated', (u) => u.group.id === groupId && !!u.yourSubmissionId)
    p.socket.emit('submit_video', {
      groupId, videoId, title: `Song ${round}-${i}`,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, channelTitle: 'Test Channel'
    })
    await submitted
  }
  await voting

  for (const p of others) {
    const { group, yourSubmissionId } = p.view
    const target = group.currentTheme.submissions.find((sub) => sub.id !== yourSubmissionId)
    // With a single submitter there is nobody else's song to vote for.
    if (!target) continue
    const counted = waitFor(p.socket, 'group_updated', (u) => u.group.id === groupId)
    p.socket.emit('cast_vote', { groupId, submissionId: target.id, points: 1 })
    await counted
  }

  const winner = judge.view.group.currentTheme.submissions[0]
  const reveal = allSee(players, groupId, 'reveal')
  judge.socket.emit('czar_select_winner', { groupId, submissionId: winner.id })
  await reveal
  return { judge, group: judge.view.group }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Real players take far longer than a test between rounds. Without a pause
// the host's socket, which acts every round, outruns the server's rate
// limit (burst 20, then about 5 a second) after five or six rounds.
const ROUND_PACE_MS = 900

async function startRound(g, event) {
  const started = allSee(g.players, g.groupId, 'topic_selection')
  g.host.socket.emit(event, { groupId: g.groupId })
  await started
}

test.describe('full games at every group size', () => {
  for (const size of [3, 4, 5, 6, 7, 8]) {
    test(`${size} players play a full game, and everyone judges exactly once`, async () => {
      test.setTimeout(120_000)
      const runId = testRunId()
      const g = await buildGroup(runId, `fg${size}p`, size, { totalRounds: size })

      const judges = []
      for (let round = 1; round <= size; round++) {
        await startRound(g, round === 1 ? 'start_group' : 'start_round')
        const { judge, group } = await playRound({ ...g, runId, round })
        judges.push(judge.id)
        await sleep(ROUND_PACE_MS)
        expect(group.history).toHaveLength(round)
        expect(group.history[round - 1].totalSubmissions).toBe(size - 1)
      }

      // Everyone got a turn as Judge, and nobody went twice.
      expect(new Set(judges).size).toBe(size)

      const { group } = await details(g.host, g.groupId)
      expect(group.status).toBe('finished')
      expect(group.finalStandings).toHaveLength(size)
      const scores = group.finalStandings.map((s) => s.score)
      expect([...scores].sort((a, b) => b - a)).toEqual(scores)
      expect(scores.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
      g.closeAll()
    })
  }
})

test.describe('a game ends after its rounds', () => {
  test('no round starts after the last one, and a new set resets it', async () => {
    const runId = testRunId()
    const g = await buildGroup(runId, 'end', 3, { totalRounds: 2 })

    await startRound(g, 'start_group')
    const first = await playRound({ ...g, runId, round: 1 })
    const firstTopic = first.group.history[0].title
    await startRound(g, 'start_round')
    await playRound({ ...g, runId, round: 2 })

    const { group: ended } = await details(g.host, g.groupId)
    expect(ended.status).toBe('finished')
    expect(ended.completedSets).toHaveLength(1)

    const refused = once(g.host.socket, 'error')
    g.host.socket.emit('start_round', { groupId: g.groupId })
    expect((await refused).message).toBe('This game is over. Start a new set to play again.')

    const reset = waitFor(g.host.socket, 'group_updated', ({ group }) => group.id === g.groupId && group.status === 'setup')
    g.host.socket.emit('start_new_set', { groupId: g.groupId })
    const { group: fresh } = await reset
    expect(fresh.currentRound).toBe(0)
    expect(fresh.setNumber).toBe(2)
    expect(fresh.players.every((p) => p.score === 0)).toBe(true)
    expect(fresh.usedTopicIds).toEqual([])
    expect(fresh.history.map((h) => h.set)).toEqual([1, 1])
    expect(firstTopic).toBeTruthy()
    g.closeAll()
  })

  test('only the host can start a new set, and only after the game ends', async () => {
    const runId = testRunId()
    const g = await buildGroup(runId, 'nset', 2, { totalRounds: 1 })

    const early = once(g.host.socket, 'error')
    g.host.socket.emit('start_new_set', { groupId: g.groupId })
    expect((await early).message).toBe('The current game has not finished yet')

    const notHost = once(g.players[1].socket, 'error')
    g.players[1].socket.emit('start_new_set', { groupId: g.groupId })
    expect((await notHost).message).toBe('Only the host can start a new set')
    g.closeAll()
  })

  test("the round count and topic rules can't change mid-game", async () => {
    const runId = testRunId()
    const g = await buildGroup(runId, 'shape', 2, { totalRounds: 4 })
    await startRound(g, 'start_group')

    const refused = once(g.host.socket, 'error')
    g.host.socket.emit('update_group', { groupId: g.groupId, settings: { totalRounds: 8 } })
    expect((await refused).message)
      .toBe('The number of rounds and the topic rules can only change before a game starts or after it ends')

    // Saving other rules with those two unchanged is fine.
    const saved = waitFor(g.host.socket, 'group_updated', ({ group }) => group.settings.voteBudget === 7)
    g.host.socket.emit('update_group', { groupId: g.groupId, settings: { totalRounds: 4, voteBudget: 7 } })
    await saved
    g.closeAll()
  })
})

test.describe('topics', () => {
  test('a topic plays once per game', async () => {
    const runId = testRunId()
    const g = await buildGroup(runId, 'reuse', 2, { totalRounds: 3 })
    await startRound(g, 'start_group')
    const judge = findJudge(g.players)
    const created = once(judge.socket, 'topic_submitted')
    judge.socket.emit('submit_topic', { text: `Once only ${runId}`, isPublic: true })
    const { topic } = await created
    await playRound({ ...g, runId, round: 1, topicId: topic.id })

    await startRound(g, 'start_round')
    const nextJudge = findJudge(g.players)
    const refused = once(nextJudge.socket, 'error')
    nextJudge.socket.emit('select_topic', { groupId: g.groupId, topicId: topic.id })
    expect((await refused).message).toBe('That topic has already been played in this game')
    g.closeAll()
  })

  test('with custom topics off, the game needs a host topic per round, and the Judge picks only from them', async () => {
    const runId = testRunId()
    const g = await buildGroup(runId, 'hostt', 2, { totalRounds: 2, allowCustomTopics: false })

    const tooFew = once(g.host.socket, 'error')
    g.host.socket.emit('start_group', { groupId: g.groupId })
    expect((await tooFew).message)
      .toBe('Add at least 2 topics before starting. This game has 2 rounds and each topic can be played once (0 so far).')

    for (const text of [`Host topic A ${runId}`, `Host topic B ${runId}`]) {
      const added = waitFor(g.host.socket, 'group_updated', ({ group }) => group.hostTopics?.some((t) => t.text === text))
      g.host.socket.emit('add_group_topic', { groupId: g.groupId, text })
      await added
    }

    const dupe = once(g.host.socket, 'error')
    g.host.socket.emit('add_group_topic', { groupId: g.groupId, text: `host topic a ${runId}` })
    expect((await dupe).message).toBe('That topic is already on the list')

    await startRound(g, 'start_group')
    const judge = findJudge(g.players)

    const listed = once(judge.socket, 'group_topics_list')
    judge.socket.emit('get_group_topics', { groupId: g.groupId })
    const { topics } = await listed
    expect(topics.map((t) => t.text).sort()).toEqual([`Host topic A ${runId}`, `Host topic B ${runId}`])

    // A topic from the Judge's own library isn't allowed.
    const own = once(judge.socket, 'topic_submitted')
    judge.socket.emit('submit_topic', { text: `My own ${runId}`, isPublic: true })
    const { topic } = await own
    const refused = once(judge.socket, 'error')
    judge.socket.emit('select_topic', { groupId: g.groupId, topicId: topic.id })
    expect((await refused).message).toBe('That topic no longer exists')
    g.closeAll()
  })
})

test.describe('notifications', () => {
  test('the Judge and the other players are told when a game starts', async () => {
    const runId = testRunId()
    const g = await buildGroup(runId, 'ntf', 3)

    // Only game-start notices count: the setup's own "joined" notices can
    // still be in flight when the round starts.
    const START_TYPES = ['your_turn_judge', 'game_started']
    const told = g.players.map((p) =>
      waitFor(p.socket, 'notification', (n) => START_TYPES.includes(n.item?.type), 5_000).catch(() => null))
    await startRound(g, 'start_group')
    const judge = findJudge(g.players)
    const received = await Promise.all(told)

    for (const [i, p] of g.players.entries()) {
      const n = received[i]
      if (p === judge) {
        expect(n.item.type).toBe('your_turn_judge')
      } else if (p === g.host) {
        expect(n).toBeNull()
      } else {
        expect(n.item).toMatchObject({ type: 'game_started', link: `/group/${g.groupId}` })
      }
    }
    g.closeAll()
  })

  test('notifications are kept, and can be marked read', async () => {
    const runId = testRunId()
    const host = connectAs(`ntk-host-${runId}`, 'Keeper Host')
    await host.ready
    host.socket.emit('create_group', { groupData: { name: `Kept ${runId}`, settings: {} } })
    const { group } = await once(host.socket, 'group_created')

    // The requester is offline when accepted, then comes back.
    const requesterId = `ntk-req-${runId}`
    const requester = connectAs(requesterId, 'Away Player')
    await requester.ready
    requester.socket.emit('request_join', { groupId: group.id })
    await waitFor(requester.socket, 'join_request_update')
    requester.socket.close()

    host.socket.emit('respond_join_request', { groupId: group.id, requesterId, accept: true })
    await waitFor(host.socket, 'group_updated', ({ group: g }) => g.players.length === 2)

    const back = connectAs(requesterId, 'Away Player')
    await back.ready
    const list = once(back.socket, 'notifications_list')
    back.socket.emit('get_notifications')
    const { items, unreadCount } = await list
    expect(items[0]).toMatchObject({ type: 'request_accepted', read: false, link: `/group/${group.id}` })
    expect(items[0].text).toBe(`Your request to join Kept ${runId} was accepted. You're in!`)
    expect(unreadCount).toBeGreaterThan(0)

    const cleared = once(back.socket, 'notifications_list')
    back.socket.emit('mark_notifications_read')
    expect((await cleared).unreadCount).toBe(0)
    host.socket.close()
    back.socket.close()
  })

  test('joining by invite notifies the new member and the host', async () => {
    const runId = testRunId()
    const host = connectAs(`nti-host-${runId}`, 'Invite Host')
    const joiner = connectAs(`nti-join-${runId}`, 'Invite Joiner')
    await Promise.all([host.ready, joiner.ready])
    host.socket.emit('create_group', { groupData: { name: `Invited ${runId}`, settings: {} } })
    const { group } = await once(host.socket, 'group_created')

    const joinerTold = waitFor(joiner.socket, 'notification', ({ item }) => item.type === 'joined')
    const hostTold = waitFor(host.socket, 'notification', ({ item }) => item.type === 'member_joined')
    joiner.socket.emit('join_group', { inviteCode: group.inviteCode })
    expect((await joinerTold).item).toMatchObject({ text: `You joined Invited ${runId}.`, link: `/group/${group.id}` })
    expect((await hostTold).item.text).toBe(`Invite Joiner joined Invited ${runId}.`)
    host.socket.close()
    joiner.socket.close()
  })

  test("a join request's notification opens the host's Requests tab", async () => {
    const runId = testRunId()
    const host = connectAs(`ntr-host-${runId}`, 'Tab Host')
    const asker = connectAs(`ntr-ask-${runId}`, 'Tab Asker')
    await Promise.all([host.ready, asker.ready])
    host.socket.emit('create_group', { groupData: { name: `Tabbed ${runId}`, settings: {} } })
    const { group } = await once(host.socket, 'group_created')

    const told = waitFor(host.socket, 'notification', ({ item }) => item.type === 'join_request')
    asker.socket.emit('request_join', { groupId: group.id })
    expect((await told).item.link).toBe(`/group/${group.id}?tab=requests`)
    host.socket.close()
    asker.socket.close()
  })

  test('a notification can be removed, and all can be cleared', async () => {
    const runId = testRunId()
    const host = connectAs(`ntc-host-${runId}`, 'Clear Host')
    await host.ready
    for (const n of [1, 2, 3]) {
      const joiner = connectAs(`ntc-j${n}-${runId}`, `Clear Joiner ${n}`)
      await joiner.ready
      host.socket.emit('create_group', { groupData: { name: `Clear ${n} ${runId}`, settings: {} } })
      const { group } = await once(host.socket, 'group_created')
      const told = waitFor(host.socket, 'notification', ({ item }) => item.type === 'member_joined')
      joiner.socket.emit('join_group', { inviteCode: group.inviteCode })
      await told
      joiner.socket.close()
    }

    const listed = once(host.socket, 'notifications_list')
    host.socket.emit('get_notifications')
    const { items } = await listed
    expect(items).toHaveLength(3)

    const afterRemove = once(host.socket, 'notifications_list')
    host.socket.emit('delete_notification', { notificationId: items[0].id })
    const { items: left } = await afterRemove
    expect(left.map((n) => n.id)).toEqual([items[1].id, items[2].id])

    const afterClear = once(host.socket, 'notifications_list')
    host.socket.emit('clear_notifications')
    expect(await afterClear).toEqual({ items: [], unreadCount: 0 })
    host.socket.close()
  })

  test('a decline says how many tries are left', async () => {
    const runId = testRunId()
    const host = connectAs(`ntd-host-${runId}`, 'Decline Host')
    const asker = connectAs(`ntd-ask-${runId}`, 'Asker')
    await Promise.all([host.ready, asker.ready])
    host.socket.emit('create_group', { groupData: { name: `Declines ${runId}`, settings: {} } })
    const { group } = await once(host.socket, 'group_created')

    asker.socket.emit('request_join', { groupId: group.id })
    await waitFor(asker.socket, 'join_request_update')
    const told = waitFor(asker.socket, 'notification', ({ item }) => item.type === 'request_declined')
    host.socket.emit('respond_join_request', { groupId: group.id, requesterId: asker.id, accept: false })
    expect((await told).item.text).toBe(`Your request to join Declines ${runId} was declined. You can ask 2 more times.`)
    host.socket.close()
    asker.socket.close()
  })
})

// Group size is a real limit now, and every setting the two forms offer is
// bounded on the server as well (`SEC-2`). `maxPlayers` was collected,
// displayed as "3/12" and never read, so the number was decorative; the two
// forms also disagreed about what it could even be, because each held its own
// copy of every limit.

test.describe('group size is enforced, not decorative', () => {
  async function group(host, name, settings = {}) {
    host.socket.emit('create_group', { groupData: { name, isPrivate: false, settings } })
    const { group: made } = await once(host.socket, 'group_created')
    return made
  }

  function joinAttempt(player, inviteCode) {
    return new Promise((resolve) => {
      const done = (event) => (payload) => resolve({ event, payload })
      player.socket.once('group_joined', done('group_joined'))
      player.socket.once('error', done('error'))
      player.socket.emit('join_group', { inviteCode })
    })
  }

  test('a full group refuses the next player, whichever way in they try', async () => {
    const runId = testRunId()
    const host = connectAs(`mp-host-${runId}`, 'Size Host')
    const second = connectAs(`mp-two-${runId}`, 'Second')
    const third = connectAs(`mp-three-${runId}`, 'Third')
    await Promise.all([host.ready, second.ready, third.ready])

    try {
      // Two is the floor, so the group is full as soon as one person joins.
      const made = await group(host, `Full Group ${runId}`, { maxPlayers: 2 })

      expect((await joinAttempt(second, made.inviteCode)).event).toBe('group_joined')

      const refused = await joinAttempt(third, made.inviteCode)
      expect(refused.event).toBe('error')
      expect(refused.payload.message).toMatch(/full \(2 players\)/)
    } finally {
      host.socket.close(); second.socket.close(); third.socket.close()
    }
  })

  test('a member who was already in can still get back in when the group is full', async () => {
    const runId = testRunId()
    const host = connectAs(`mp2-host-${runId}`, 'Rejoin Host')
    const member = connectAs(`mp2-mem-${runId}`, 'Returning Member')
    await Promise.all([host.ready, member.ready])

    try {
      const made = await group(host, `Rejoin ${runId}`, { maxPlayers: 2 })
      expect((await joinAttempt(member, made.inviteCode)).event).toBe('group_joined')

      // The group is now at its limit, and this player is part of why. A
      // reconnect must not be mistaken for a new arrival and bounced out of
      // their own group.
      expect((await joinAttempt(member, made.inviteCode)).event).toBe('group_joined')
    } finally {
      host.socket.close(); member.socket.close()
    }
  })

  test('the server holds the bounds the forms advertise, whatever a client sends', async () => {
    const runId = testRunId()
    const host = connectAs(`mp3-host-${runId}`, 'Crafted Host')
    await host.ready

    try {
      // None of these are reachable through either form. The point is that the
      // forms are a convenience and the server is the control: a `min`/`max`
      // attribute stops an honest mistake, not a crafted payload.
      const made = await group(host, `Crafted ${runId}`, {
        maxPlayers: 500,
        czarPoints: 9999,
        maxJuryPoints: 0,
        overrideThreshold: 1,
        downvoteCost: 0,
        voteBudget: 100000
      })

      expect(made.settings.maxPlayers).toBe(20)
      expect(made.settings.czarPoints).toBe(10)
      expect(made.settings.maxJuryPoints).toBe(1)
      // A downvote must always cost something (RT-2-1), which is why neither
      // form offers 0 any more.
      expect(made.settings.downvoteCost).toBe(1)
      expect(made.settings.voteBudget).toBe(100)
      // overrideThreshold is not clamped with the rest: creating with an
      // invalid one falls back to the default rather than to the nearest
      // legal value, which is a deliberate older decision left alone here.
      expect(made.settings.overrideThreshold).toBe(70)
    } finally {
      host.socket.close()
    }
  })

  test('editing the rules is held to the same bounds as creating them', async () => {
    const runId = testRunId()
    const host = connectAs(`mp4-host-${runId}`, 'Editing Host')
    await host.ready

    try {
      const made = await group(host, `Edited ${runId}`, {})

      const updated = waitFor(host.socket, 'group_updated', ({ group: g }) => g.id === made.id)
      host.socket.emit('update_group', {
        groupId: made.id,
        settings: { maxPlayers: 500, czarPoints: 9999 }
      })
      const { group: after } = await updated

      // The Edit Rules form used to be the lenient one -- it accepted 50
      // players where the wizard stopped at 20 -- so this is the path that
      // most needs holding to the same line.
      expect(after.settings.maxPlayers).toBe(20)
      expect(after.settings.czarPoints).toBe(10)

      // overrideThreshold keeps its own, older rule on this path: an invalid
      // one is refused outright rather than clamped, so that a bad threshold
      // surfaces instead of quietly decaying the override mechanic. Asserted
      // here so that rule is not mistaken for an oversight and "fixed".
      const refusal = new Promise((resolve) => host.socket.once('error', resolve))
      host.socket.emit('update_group', { groupId: made.id, settings: { overrideThreshold: 1 } })
      expect((await refusal).message).toMatch(/threshold must be a whole percentage/)
    } finally {
      host.socket.close()
    }
  })
})
