import { test, expect } from '@playwright/test'
import { io } from 'socket.io-client'
import { testRunId } from './helpers.js'

// The submission deadline used to be written, broadcast and displayed, and
// never read: a round with one absent player stayed open forever while the
// interface counted down to zero. See docs/design/round-stall-change-design.md.
//
// These are socket-level on purpose. Expiry is a server rule, and a UI test
// would keep passing if the server check were deleted — the browser would just
// be waiting on a round nobody ends. Driving the wire also lets a round expire
// in seconds rather than the 24-hour default.

const API_URL = 'http://localhost:5000'

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve))

// The server accepts a sub-hour submission window only while AUTH_TEST_MODE is
// on, which the Playwright webServer sets and which refuses to coexist with
// NODE_ENV=production. One second, expressed in the hours the setting uses.
const ONE_SECOND = 1 / 3600

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

// Waits for the first matching payload. A plain once() can capture a broadcast
// still in flight from an earlier action rather than the one under test.
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

const inPhase = (phase) => (p) => p.group?.currentTheme?.status === phase

/**
 * Builds a group and runs it to the submission phase with the given window. Returns the players split by role, so a test can act as the Judge or
 * as the contestant without caring which socket drew which.
 */
async function runToSubmission(runId, { submissionTime = ONE_SECOND, votingTime = ONE_SECOND, contestants = 2 } = {}) {
  const host = connect(`dl-host-${runId}`, 'Deadline Host')
  // Two contestants by default. With only one, that player submitting is
  // already every eligible player, so the round advances on its own and no
  // deadline is ever reached — the stall being fixed needs someone missing.
  const others = Array.from({ length: contestants }, (_, i) =>
    connect(`dl-other${i}-${runId}`, `Deadline Other ${i}`))
  await Promise.all([host.ready, ...others.map((o) => o.ready)])

  host.socket.emit('create_group', {
    groupData: { name: `Deadline ${runId}`, settings: { submissionTime, votingTime } }
  })
  const created = await once(host.socket, 'group_created')
  const groupId = created.group.id

  for (const o of others) {
    o.socket.emit('join_group', { groupId })
    await once(o.socket, 'group_joined')
  }

  // Hand the Judge role to the host deliberately, so the test knows who is who.
  host.socket.emit('start_group', { groupId, czarUserId: host.id })
  await waitForUpdate(host.socket, inPhase('topic_selection'))

  const topics = await new Promise((resolve) => {
    host.socket.once('group_topics_list', resolve)
    host.socket.emit('get_group_topics', { groupId })
  })

  let topicId = topics.topics?.[0]?.id
  if (!topicId) {
    host.socket.emit('submit_topic', { text: `Deadline topic ${runId}`, isPublic: false })
    const submitted = await once(host.socket, 'topic_submitted')
    topicId = submitted.topic.id
  }

  host.socket.emit('select_topic', { groupId, topicId })
  await waitForUpdate(host.socket, inPhase('submission'))

  const closeAll = () => [host, ...others].forEach((p) => p.socket.close())
  // The host is the Judge here, so every other member is a contestant.
  return { host, others, groupId, judge: host, contestant: others[0], closeAll }
}

async function submitVideo(player, groupId) {
  player.socket.emit('submit_video', {
    groupId,
    videoId: 'dQw4w9WgXcQ',
    title: 'A submitted video',
    thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    channelTitle: 'Someone'
  })
  return once(player.socket, 'group_updated')
}

test.describe('submission deadline', () => {
  test('expires into voting with whatever was submitted', async () => {
    const runId = testRunId()
    const { host, groupId, contestant, closeAll } = await runToSubmission(runId)

    // One of the two contestants submits. The other never does — this is the
    // absent player who used to hold the round open forever.
    await submitVideo(contestant, groupId)
    await sleep(1200)

    const advanced = waitForUpdate(host.socket, inPhase('voting'))
    contestant.socket.emit('check_round_deadline', { groupId })
    const { group } = await advanced

    expect(group.currentTheme.status, 'an expired window must open voting').toBe('voting')
    expect(group.currentTheme.submissionCount, 'it plays with what arrived').toBe(1)

    closeAll()
  })

  test('a nudge before the deadline changes nothing', async () => {
    // The client is only a trigger. The server re-checks its own clock, so an
    // early or dishonest nudge must not end anyone's round.
    const runId = testRunId()
    const { host, groupId, contestant, closeAll } = await runToSubmission(runId, { submissionTime: 1 })

    await submitVideo(contestant, groupId)

    contestant.socket.emit('check_round_deadline', { groupId })
    await sleep(400)

    const state = await new Promise((resolve) => {
      host.socket.once('group_details', resolve)
      host.socket.emit('get_group', { groupId })
    })
    expect(state.group.currentTheme.status, 'a premature nudge must be ignored').toBe('submission')

    closeAll()
  })

  test('with nothing submitted it restarts the same round and tells the host', async () => {
    const runId = testRunId()
    const { host, groupId, closeAll } = await runToSubmission(runId)

    const before = await new Promise((resolve) => {
      host.socket.once('group_details', resolve)
      host.socket.emit('get_group', { groupId })
    })
    const firstDeadline = before.group.currentTheme.deadline
    const judgeBefore = before.isRoundLeader
    const titleBefore = before.group.currentTheme.title
    const roundBefore = before.group.currentRound

    await sleep(1200)

    const restarted = new Promise((resolve) => host.socket.once('group_updated', resolve))
    host.socket.emit('check_round_deadline', { groupId })
    const update = await restarted

    expect(update.group.currentTheme.status, 'the round stays open for another try').toBe('submission')
    expect(update.group.currentTheme.title, 'the topic is kept').toBe(titleBefore)
    expect(update.isRoundLeader, 'the Judge is kept').toBe(judgeBefore)
    expect(update.group.currentRound, 'a restart is the same round, not a new one').toBe(roundBefore)
    expect(new Date(update.group.currentTheme.deadline).getTime())
      .toBeGreaterThan(new Date(firstDeadline).getTime())

    // No history entry: this is another attempt at one round.
    expect(update.group.history).toHaveLength(0)

    // The host is told, durably.
    expect(update.notices, 'the host is notified of the restart').toHaveLength(1)
    expect(update.notices[0].kind).toBe('round_restarted')
    expect(update.notices[0].message).toContain('restarted')

    closeAll()
  })

  test('gives up after three restarts and waits for the host', async () => {
    const runId = testRunId()
    const { host, groupId, closeAll } = await runToSubmission(runId)

    // Four expiries: three restarts, then the cap.
    for (let attempt = 1; attempt <= 4; attempt++) {
      await sleep(1200)
      const settled = new Promise((resolve) => host.socket.once('group_updated', resolve))
      host.socket.emit('check_round_deadline', { groupId })
      await settled
    }

    const state = await new Promise((resolve) => {
      host.socket.once('group_details', resolve)
      host.socket.emit('get_group', { groupId })
    })

    expect(state.group.currentTheme.rearmExhausted, 'the round stops restarting itself').toBe(true)
    const kinds = state.notices.map((n) => n.kind)
    expect(kinds).toContain('round_stalled')

    // Nothing further piles up: an exhausted round must not queue a new notice
    // every time somebody looks at it.
    const noticeCount = state.notices.length
    host.socket.emit('check_round_deadline', { groupId })
    await sleep(300)
    const after = await new Promise((resolve) => {
      host.socket.once('group_details', resolve)
      host.socket.emit('get_group', { groupId })
    })
    expect(after.notices, 'a stalled round must not keep notifying').toHaveLength(noticeCount)

    // The cap is only safe because the host can start over.
    host.socket.emit('start_round', { groupId })
    const restarted = await Promise.race([
      once(host.socket, 'group_updated'),
      once(host.socket, 'error').then((e) => ({ error: e.message }))
    ])
    expect(restarted.error, 'the host must be able to restart a stalled round').toBeUndefined()
    expect(restarted.group.currentTheme.status).toBe('topic_selection')
    expect(restarted.group.currentRound).toBe(state.group.currentRound + 1)

    closeAll()
  })

  test('the host can dismiss a notice, and only the host sees one', async () => {
    const runId = testRunId()
    const { host, groupId, contestant, closeAll } = await runToSubmission(runId)

    await sleep(1200)
    const restarted = new Promise((resolve) => host.socket.once('group_updated', resolve))
    host.socket.emit('check_round_deadline', { groupId })
    const update = await restarted
    expect(update.notices).toHaveLength(1)

    // The other member is not the host and must see nothing.
    const theirs = await new Promise((resolve) => {
      contestant.socket.once('group_details', resolve)
      contestant.socket.emit('get_group', { groupId })
    })
    expect(theirs.notices, 'notices are the host’s alone').toHaveLength(0)

    const cleared = new Promise((resolve) => host.socket.once('group_updated', resolve))
    host.socket.emit('acknowledge_notice', { groupId, noticeId: update.notices[0].id })
    expect((await cleared).notices).toHaveLength(0)

    closeAll()
  })
})

test.describe('voting deadline', () => {
  test('does not reveal when everyone (or anyone) votes early, and reveals only on the deadline', async () => {
    const runId = testRunId()
    const { host, groupId, judge, contestant, closeAll } = await runToSubmission(runId)

    // The contestant submits; the other contestant stays absent, so the round
    // only leaves submission via its own deadline.
    await submitVideo(contestant, groupId)
    await sleep(1200)

    const advanced = waitForUpdate(host.socket, inPhase('voting'))
    contestant.socket.emit('check_round_deadline', { groupId })
    const { group } = await advanced
    expect(group.currentTheme.status, 'the submission window expiry opens voting').toBe('voting')
    expect(group.currentTheme.submissionCount).toBe(1)

    // The voting window persisted its own fresh deadline when voting opened
    // (it replaces the stale submission deadline the countdown used to show).
    const votingDeadline = Date.parse(group.currentTheme.deadline)
    expect(Number.isFinite(votingDeadline)).toBe(true)
    expect(votingDeadline).toBeGreaterThan(Date.now())

    // Everyone present who can vote votes. Under the old behavior the last of
    // these votes would have revealed the round immediately; RT-1 says voting
    // always runs to its deadline, so it stays in voting.
    const subId = group.currentTheme.submissions[0].id
    judge.socket.emit('cast_vote', { groupId, submissionId: subId, points: 3 })

    const stillVoting = await new Promise((resolve) => {
      judge.socket.once('group_details', resolve)
      judge.socket.emit('get_group', { groupId })
    })
    expect(stillVoting.group.currentTheme.status, 'voting must not close on an early vote').toBe('voting')

    // Now let the voting window itself close, then nudge the server.
    await sleep(1200)
    const revealed = waitForUpdate(host.socket, inPhase('reveal'))
    judge.socket.emit('check_round_deadline', { groupId })
    const final = await revealed

    expect(final.group.currentTheme.status, 'the voting deadline completes the round').toBe('reveal')
    expect(final.group.currentTheme.submissionCount).toBe(1)
    expect(final.group.history, 'the resolved round is recorded').toHaveLength(1)
    expect(final.group.currentTheme.voteCount ?? final.group.currentTheme.votes?.length).toBeGreaterThan(0)

    closeAll()
  })
})

test.describe('host controls for a stuck round', () => {
  test('the host can close submissions early', async () => {
    const runId = testRunId()
    const { host, groupId, contestant, closeAll } = await runToSubmission(runId, { submissionTime: 1 })

    await submitVideo(contestant, groupId)

    const closed = waitForUpdate(host.socket, inPhase('voting'))
    host.socket.emit('close_submissions', { groupId })
    const { group } = await closed

    expect(group.currentTheme.status).toBe('voting')
    expect(group.currentTheme.submissionCount).toBe(1)

    closeAll()
  })

  test('closing with nothing submitted is refused', async () => {
    const runId = testRunId()
    const { host, others, groupId, closeAll } = await runToSubmission(runId, { submissionTime: 1 })

    host.socket.emit('close_submissions', { groupId })
    const err = await once(host.socket, 'error')
    expect(err.message).toContain('Nobody has submitted')

    closeAll()
  })

  test('only the host can close submissions', async () => {
    const runId = testRunId()
    const { host, groupId, contestant, closeAll } = await runToSubmission(runId, { submissionTime: 1 })

    await submitVideo(contestant, groupId)

    contestant.socket.emit('close_submissions', { groupId })
    const err = await once(contestant.socket, 'error')
    expect(err.message).toContain('Only the host')

    closeAll()
  })

  test('the host can hand the Judge role to someone else before a topic is chosen', async () => {
    // Topic selection has no deadline by design, so an offline Judge has
    // nothing to expire. Reassignment is the only way out.
    const runId = testRunId()
    const host = connect(`rj-host-${runId}`, 'Reassign Host')
    const other = connect(`rj-other-${runId}`, 'Reassign Other')
    await Promise.all([host.ready, other.ready])

    host.socket.emit('create_group', { groupData: { name: `Reassign ${runId}`, settings: {} } })
    const { group } = await once(host.socket, 'group_created')
    other.socket.emit('join_group', { groupId: group.id })
    await once(other.socket, 'group_joined')

    // Host takes the Judge role, then hands it over without a topic chosen.
    host.socket.emit('start_group', { groupId: group.id, czarUserId: host.id })
    const started = await waitForUpdate(host.socket, inPhase('topic_selection'))
    expect(started.isRoundLeader).toBe(true)
    expect(started.group.currentTheme.status).toBe('topic_selection')

    const handed = waitForUpdate(host.socket, (p) => p.isRoundLeader === false)
    host.socket.emit('reassign_judge', { groupId: group.id, czarUserId: other.id })
    const after = await handed

    expect(after.isRoundLeader, 'the old Judge gives up the role').toBe(false)
    expect(after.group.currentTheme.status, 'the round stays where it was').toBe('topic_selection')

    host.socket.close()
    other.socket.close()
  })

  test('the Judge cannot be swapped once the round is taking submissions', async () => {
    const runId = testRunId()
    const { host, others, groupId, closeAll } = await runToSubmission(runId, { submissionTime: 1 })

    host.socket.emit('reassign_judge', { groupId, czarUserId: others[0].id })
    const err = await once(host.socket, 'error')
    expect(err.message).toContain('choosing a topic')

    closeAll()
  })
})

test.describe('window clamping', () => {
  test('an out-of-range window is clamped to the ceiling when creating a group', async () => {
    // The host picks a value + unit (A4); the server clamps an out-of-range
    // length to the 168h ceiling rather than rejecting it (RT-1).
    const runId = testRunId()
    const host = connect(`sv-create-${runId}`, 'Validation Host')
    await host.ready

    host.socket.emit('create_group', {
      groupData: { name: `Validation ${runId}`, settings: { submissionTime: 100000, votingTime: 100000 } }
    })
    const result = await Promise.race([
      once(host.socket, 'group_created'),
      once(host.socket, 'error').then((e) => ({ error: e.message }))
    ])
    expect(result.error, 'an absurd window clamps instead of failing the request').toBeUndefined()
    expect(result.group.settings.submissionTime).toBe(168)
    expect(result.group.settings.votingTime).toBe(168)

    host.socket.close()
  })

  test('an under-range window is clamped to the floor when editing the rules', async () => {
    const runId = testRunId()
    const host = connect(`sv-edit-${runId}`, 'Validation Editor')
    await host.ready

    host.socket.emit('create_group', { groupData: { name: `Validation edit ${runId}`, settings: {} } })
    const { group } = await once(host.socket, 'group_created')

    // Under AUTH_TEST_MODE the floor is one second; clamping 0 (or a negative)
    // must land on that floor, not error, and the update must still succeed.
    host.socket.emit('update_group', { groupId: group.id, settings: { submissionTime: 0, votingTime: -5 } })
    const got = await new Promise((resolve) => {
      host.socket.once('group_updated', resolve)
    })
    expect(got.group.settings.submissionTime).toBe(ONE_SECOND)
    expect(got.group.settings.votingTime).toBe(ONE_SECOND)

    host.socket.close()
  })

  test('a window inside the range is accepted as-is', async () => {
    const runId = testRunId()
    const host = connect(`sv-ok-${runId}`, 'Validation Ok')
    await host.ready

    host.socket.emit('create_group', {
      groupData: { name: `Validation ok ${runId}`, settings: { submissionTime: 168 } }
    })
    const result = await Promise.race([
      once(host.socket, 'group_created'),
      once(host.socket, 'error').then((e) => ({ error: e.message }))
    ])
    expect(result.error).toBeUndefined()
    expect(result.group.settings.submissionTime).toBe(168)

    host.socket.close()
  })
})
