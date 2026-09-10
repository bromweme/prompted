import { test, expect } from '@playwright/test'
import { io } from 'socket.io-client'
import { testRunId } from './helpers.js'

// RT-2: a per-round vote budget with "Share the wealth" and a single downvote
// cost. See docs/design/c8-per-round-vote-budget-change-design.md and
// implementation/issues/RT-2.md.
//
// These are socket-level on purpose, mirroring round-deadline.spec.js: the
// budget gate, the spread/concentrate rule and the downvote rules are server
// rules, and driving the wire lets a test craft exactly the payloads a UI
// test could not (a dump, an over-budget cast, a forbidden downvote).

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

async function fetchView(player, groupId) {
  player.socket.emit('get_group', { groupId })
  return once(player.socket, 'group_details')
}

/**
 * Builds a group and runs it into the voting phase with the given settings.
 * The host is the Judge; the two `others` are the submitters (both submit, so
 * voting opens with two entries to vote on).
 */
async function runToVoting(runId, settings = {}) {
  const host = connect(`vb-host-${runId}`, 'Budget Host')
  const others = Array.from({ length: 2 }, (_, i) =>
    connect(`vb-other${i}-${runId}`, `Budget Other ${i}`))
  await Promise.all([host.ready, ...others.map((o) => o.ready)])

  host.socket.emit('create_group', {
    groupData: { name: `Budget ${runId}`, settings: { ...settings } }
  })
  const created = await once(host.socket, 'group_created')
  const groupId = created.group.id

  for (const o of others) {
    o.socket.emit('join_group', { groupId })
    await once(o.socket, 'group_joined')
  }

  // Host is the Judge deliberately, so the test knows who is who.
  host.socket.emit('start_group', { groupId, czarUserId: host.id })
  await waitForUpdate(host.socket, inPhase('topic_selection'))

  host.socket.emit('submit_topic', { text: `Budget topic ${runId}`, isPublic: false })
  const { topic } = await once(host.socket, 'topic_submitted')
  host.socket.emit('select_topic', { groupId, topicId: topic.id })
  await waitForUpdate(host.socket, inPhase('submission'))

  const submit = async (player, i) => {
    player.socket.emit('submit_video', {
      groupId,
      videoId: i === 0 ? 'aaaaaaaaaaa' : 'bbbbbbbbbbb',
      title: `Budget Sub ${i}`,
      thumbnail: `https://i.ytimg.com/vi/${i === 0 ? 'aaaaaaaaaaa' : 'bbbbbbbbbbb'}/mqdefault.jpg`,
      channelTitle: 'Budget Channel'
    })
    return once(player.socket, 'group_updated')
  }

  await submit(others[0], 0)

  // Register the voting-phase wait before the final submission triggers it, so
  // an in-flight broadcast can't slip past the listener (the second submission
  // is what flips the round into voting).
  const votingOpened = waitForUpdate(host.socket, inPhase('voting'))
  await submit(others[1], 1)
  await votingOpened

  const view = await fetchView(host, groupId)
  const subs = view.group.currentTheme.submissions
  expect(subs).toHaveLength(2)

  const closeAll = () => [host, ...others].forEach((p) => p.socket.close())
  return { host, others, groupId, judge: host, submissions: subs, closeAll }
}

test.describe('vote budget', () => {
  test('a player can cast multiple votes up to the budget and cannot exceed it', async () => {
    const runId = testRunId()
    const { host, groupId, submissions, closeAll } = await runToVoting(runId, {
      // A budget small enough to spend in two capped votes; share off so the
      // pure cap is tested without the spread rule muddying it.
      voteBudget: 6, maxJuryPoints: 3, shareTheWealth: false
    })
    const [a, b] = submissions

    const spend = async (player, subId, points) => {
      const settled = new Promise((resolve) => {
        player.socket.once('group_updated', resolve)
        player.socket.once('error', (e) => resolve({ error: e }))
      })
      player.socket.emit('cast_vote', { groupId, submissionId: subId, points })
      return settled
    }

    // First vote: 3 on A. Remaining 6 -> 3.
    let r = await spend(host, a.id, 3)
    expect(r.error).toBeUndefined()
    expect((await fetchView(host, groupId)).voteBudgetRemaining).toBe(3)

    // Second vote: 3 on B. Remaining 3 -> 0 (budget spent).
    r = await spend(host, b.id, 3)
    expect(r.error).toBeUndefined()
    expect((await fetchView(host, groupId)).voteBudgetRemaining).toBe(0)

    // A further vote would exceed the budget: the server rejects it.
    r = await spend(host, a.id, 1)
    expect(r.error?.message).toContain('remaining budget')

    closeAll()
  })

  test('Share the wealth on: a whole-budget concentration is rejected, spreading is not', async () => {
    const runId = testRunId()
    const { host, groupId, submissions, closeAll } = await runToVoting(runId, {
      voteBudget: 10, maxJuryPoints: 10, shareTheWealth: true
    })
    const [a, b] = submissions

    const cast = async (player, subId, points) => {
      const settled = new Promise((resolve) => {
        player.socket.once('group_updated', resolve)
        player.socket.once('error', (e) => resolve({ error: e }))
      })
      player.socket.emit('cast_vote', { groupId, submissionId: subId, points })
      return settled
    }

    // Dumping the whole budget on one submission is refused.
    const dumped = await cast(host, a.id, 10)
    expect(dumped.error?.message).toContain('Share the wealth')

    // Spreading across two submissions is fine.
    const first = await cast(host, a.id, 5)
    expect(first.error).toBeUndefined()
    const second = await cast(host, b.id, 5)
    expect(second.error).toBeUndefined()
    expect((await fetchView(host, groupId)).voteBudgetRemaining).toBe(0)

    closeAll()
  })

  test('Share the wealth off: the whole budget may go on one submission', async () => {
    const runId = testRunId()
    const { host, groupId, submissions, closeAll } = await runToVoting(runId, {
      voteBudget: 10, maxJuryPoints: 10, shareTheWealth: false
    })
    const [a] = submissions

    const settled = new Promise((resolve) => {
      host.socket.once('group_updated', resolve)
      host.socket.once('error', (e) => resolve({ error: e }))
    })
    host.socket.emit('cast_vote', { groupId, submissionId: a.id, points: 10 })
    const r = await settled
    expect(r.error, 'with share off the whole budget may concentrate').toBeUndefined()
    expect((await fetchView(host, groupId)).voteBudgetRemaining).toBe(0)

    closeAll()
  })

  test('a downvote spends downvoteCost from the round budget and not a lifetime score', async () => {
    const runId = testRunId()
    const { host, groupId, submissions, closeAll } = await runToVoting(runId, {
      voteBudget: 10, downvoteCost: 2, allowDownvotes: true, shareTheWealth: false
    })
    const [a, b] = submissions

    const settled = new Promise((resolve) => {
      host.socket.once('group_updated', resolve)
      host.socket.once('error', (e) => resolve({ error: e }))
    })
    host.socket.emit('cast_vote', { groupId, submissionId: a.id, isDownvote: true })
    const r = await settled
    expect(r.error).toBeUndefined()

    // The downvote spent 2 from the round budget (10 -> 8), not the points field.
    const after = await fetchView(host, groupId)
    expect(after.voteBudgetRemaining).toBe(8)

    // Resolve the round (Judge picks the OTHER submission), then confirm the
    // downvoter's lifetime score was not docked by the downvote.
    host.socket.emit('czar_select_winner', { groupId, submissionId: b.id })
    await waitForUpdate(host.socket, inPhase('reveal'))
    const revealed = await fetchView(host, groupId)
    const downvoter = revealed.group.players.find((p) => p.userId === host.id)
    expect(downvoter.score, 'downvoting must not dock a lifetime score').toBe(0)

    closeAll()
  })

  test('a crafted downvote is rejected when the group forbids downvotes, and a self-vote is too', async () => {
    const runId = testRunId()
    const { host, others, groupId, submissions, closeAll } = await runToVoting(runId, {
      allowDownvotes: false, voteBudget: 10, shareTheWealth: false
    })
    const [a] = submissions

    // The forbidden downvote is refused server-side.
    const refused = new Promise((resolve) => {
      host.socket.once('group_updated', resolve)
      host.socket.once('error', (e) => resolve({ error: e }))
    })
    host.socket.emit('cast_vote', { groupId, submissionId: a.id, isDownvote: true })
    expect((await refused).error?.message).toContain('Downvotes are not allowed')

    // Rather than the host, use a submitter to try the self-vote: their own
    // submission is present in the roster but must be refused.
    const other = others[0]
    const view = await fetchView(other, groupId)
    const theirOwn = view.yourSubmissionId
    expect(theirOwn).toBeTruthy()

    const self = new Promise((resolve) => {
      other.socket.once('group_updated', resolve)
      other.socket.once('error', (e) => resolve({ error: e }))
    })
    other.socket.emit('cast_vote', { groupId, submissionId: theirOwn, points: 3 })
    expect((await self).error?.message).toContain('cannot vote for your own submission')

    // Sanity: voting for someone else's submission still works.
    const legal = new Promise((resolve) => {
      other.socket.once('group_updated', resolve)
      other.socket.once('error', (e) => resolve({ error: e }))
    })
    const target = submissions.find((s) => s.id !== theirOwn)
    other.socket.emit('cast_vote', { groupId, submissionId: target.id, points: 3 })
    const ok = await legal
    expect(ok.error).toBeUndefined()
    expect((await fetchView(other, groupId)).voteBudgetRemaining).toBe(7)

    closeAll()
  })
})