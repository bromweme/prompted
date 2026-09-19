import { test, expect } from '@playwright/test'
import { io } from 'socket.io-client'
import { testRunId } from './helpers.js'

// RT-3: a Judge can skip their turn in topic_selection, and the role rotates
// fairly across the group — nobody judges twice before everyone has judged
// once, the rotation tracks across rounds, and if everyone skips the first
// Judge must play. These are socket-level on purpose: the rotation is a server
// rule, and a UI test would keep passing if the server check were deleted.

const API_URL = 'http://localhost:5000'

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve))

// The server accepts a sub-hour window only while AUTH_TEST_MODE is on, which
// the Playwright webServer sets. One second, in the hours the setting uses.
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

// Fetches a player's private view of the group (group_details), which carries
// isRoundLeader so a test can tell who the Judge is without reading czarId
// (that is stripped from public payloads).
async function view(socket, groupId) {
  socket.emit('get_group', { groupId })
  return once(socket, 'group_details')
}

// Builds a group over raw sockets and joins `members` into it.
async function rawGroup(host, members, { name, settings = {} } = {}) {
  host.socket.emit('create_group', { groupData: { name, settings } })
  const { group } = await once(host.socket, 'group_created')
  for (const m of members) {
    m.socket.emit('join_group', { inviteCode: group.inviteCode })
    await once(m.socket, 'group_joined')
  }
  return group.id
}

// The id of the player who is currently the Judge, by asking each socket which
// one is the round leader.
async function currentJudge(players, groupId) {
  for (const p of players) {
    const v = await view(p.socket, groupId)
    if (v.isRoundLeader) return p.id
  }
  throw new Error('no player is the Judge')
}

test.describe('judge skip and rotation', () => {
  test('a Judge can skip and the role moves to a non-served member', async () => {
    const runId = testRunId()
    const host = connect(`js-host-${runId}`, 'Skip Host')
    const p2 = connect(`js-two-${runId}`, 'Skip Two')
    const p3 = connect(`js-three-${runId}`, 'Skip Three')
    await Promise.all([host.ready, p2.ready, p3.ready])

    const groupId = await rawGroup(host, [p2, p3], { name: `Skip ${runId}` })

    // Host is the Judge (forced), and the round opens in topic selection.
    host.socket.emit('start_group', { groupId, czarUserId: host.id })
    await waitForUpdate(host.socket, inPhase('topic_selection'))
    expect(await currentJudge([host, p2, p3], groupId)).toBe(host.id)

    // The host skips; the role moves to a non-served member.
    const moved = waitForUpdate(host.socket, (p) => p.isRoundLeader === false)
    host.socket.emit('judge_skip', { groupId })
    await moved

    const newJudge = await currentJudge([host, p2, p3], groupId)
    expect(newJudge, 'the new Judge is not the one who skipped').not.toBe(host.id)
    expect([p2.id, p3.id]).toContain(newJudge)

    // The skipped Judge is recorded as having served this cycle.
    const hostView = await view(host.socket, groupId)
    expect(hostView.group.judgedThisCycle).toContain(host.id)

    host.socket.close(); p2.socket.close(); p3.socket.close()
  })

  test('nobody judges twice before everyone has judged once', async () => {
    const runId = testRunId()
    const host = connect(`js-host-${runId}`, 'Skip Host')
    const p2 = connect(`js-two-${runId}`, 'Skip Two')
    const p3 = connect(`js-three-${runId}`, 'Skip Three')
    await Promise.all([host.ready, p2.ready, p3.ready])

    const groupId = await rawGroup(host, [p2, p3], { name: `NoRepeat ${runId}` })

    host.socket.emit('start_group', { groupId, czarUserId: host.id })
    await waitForUpdate(host.socket, inPhase('topic_selection'))

    // Host skips -> one of the other two becomes Judge.
    host.socket.emit('judge_skip', { groupId })
    await waitForUpdate(host.socket, (p) => p.isRoundLeader === false)
    const first = await currentJudge([host, p2, p3], groupId)
    expect([p2.id, p3.id]).toContain(first)

    // That Judge skips -> the role must go to the remaining member, never back
    // to the host (who already served) nor to the same Judge.
    const firstSocket = [host, p2, p3].find(p => p.id === first)
    const moved = waitForUpdate(firstSocket.socket, (p) => p.isRoundLeader === false)
    firstSocket.socket.emit('judge_skip', { groupId })
    await moved

    const second = await currentJudge([host, p2, p3], groupId)
    expect(second).not.toBe(host.id)
    expect(second).not.toBe(first)
    expect([host.id, p2.id, p3.id]).toContain(second)

    // Both skippers are recorded as served.
    const v = await view(host.socket, groupId)
    expect(v.group.judgedThisCycle).toContain(host.id)
    expect(v.group.judgedThisCycle).toContain(first)

    host.socket.close(); p2.socket.close(); p3.socket.close()
  })

  test('if everyone skips, the first-assigned Judge must play and cannot skip again', async () => {
    const runId = testRunId()
    const host = connect(`js-host-${runId}`, 'Skip Host')
    const p2 = connect(`js-two-${runId}`, 'Skip Two')
    const p3 = connect(`js-three-${runId}`, 'Skip Three')
    await Promise.all([host.ready, p2.ready, p3.ready])

    const groupId = await rawGroup(host, [p2, p3], { name: `FullSkip ${runId}` })

    host.socket.emit('start_group', { groupId, czarUserId: host.id })
    await waitForUpdate(host.socket, inPhase('topic_selection'))

    // Everyone skips in turn. The first-assigned Judge is the host.
    const players = [host, p2, p3]
    for (let i = 0; i < 3; i++) {
      const judge = await currentJudge(players, groupId)
      const judgeSocket = players.find(p => p.id === judge)
      const moved = waitForUpdate(judgeSocket.socket, (p) => p.isRoundLeader === false)
      judgeSocket.socket.emit('judge_skip', { groupId })
      await moved
    }

    // After three skips the role reverts to the first-assigned Judge (the host),
    // who is now marked as must-play.
    expect(await currentJudge(players, groupId)).toBe(host.id)
    const hostView = await view(host.socket, groupId)
    expect(hostView.group.currentTheme.judgeMustPlay).toBe(true)

    // The first-assigned Judge is not offered the pass again: a crafted skip is
    // refused.
    host.socket.emit('judge_skip', { groupId })
    const err = await once(host.socket, 'error')
    expect(err.message).toContain('must pick a topic')

    host.socket.close(); p2.socket.close(); p3.socket.close()
  })

  test('the rotation persists across rounds', async () => {
    const runId = testRunId()
    const host = connect(`js-host-${runId}`, 'Skip Host')
    const p2 = connect(`js-two-${runId}`, 'Skip Two')
    const p3 = connect(`js-three-${runId}`, 'Skip Three')
    await Promise.all([host.ready, p2.ready, p3.ready])

    const groupId = await rawGroup(host, [p2, p3], {
      name: `AcrossRounds ${runId}`,
      settings: { submissionTime: ONE_SECOND, votingTime: ONE_SECOND }
    })

    // Round 1: the host is the Judge and serves by picking a topic.
    host.socket.emit('start_group', { groupId, czarUserId: host.id })
    await waitForUpdate(host.socket, inPhase('topic_selection'))

    const topics = await new Promise((resolve) => {
      host.socket.once('group_topics_list', resolve)
      host.socket.emit('get_group_topics', { groupId })
    })
    let topicId = topics.topics?.[0]?.id
    if (!topicId) {
      host.socket.emit('submit_topic', { text: `Across topic ${runId}`, isPublic: false })
      const submitted = await once(host.socket, 'topic_submitted')
      topicId = submitted.topic.id
    }
    host.socket.emit('select_topic', { groupId, topicId })
    await waitForUpdate(host.socket, inPhase('submission'))

    // Both contestants submit; the one-second windows then run the round to a
    // reveal so a second round can begin.
    for (const p of [p2, p3]) {
      p.socket.emit('submit_video', {
        groupId,
        videoId: 'dQw4w9WgXcQ',
        title: 'A submitted video',
        thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
        channelTitle: 'Someone'
      })
      await once(p.socket, 'group_updated')
    }
    await sleep(1200)
    const revealed = waitForUpdate(host.socket, inPhase('reveal'))
    host.socket.emit('check_round_deadline', { groupId })
    await revealed

    // The host served round 1, so the cycle records them.
    const afterRound1 = await view(host.socket, groupId)
    expect(afterRound1.group.judgedThisCycle).toContain(host.id)

    // Round 2: p2 is the Judge and skips. The host already served, so the role
    // must go to p3 — never back to the host.
    host.socket.emit('start_round', { groupId, czarUserId: p2.id })
    await waitForUpdate(host.socket, inPhase('topic_selection'))
    expect(await currentJudge([host, p2, p3], groupId)).toBe(p2.id)

    p2.socket.emit('judge_skip', { groupId })
    await waitForUpdate(p2.socket, (p) => p.isRoundLeader === false)

    const newJudge = await currentJudge([host, p2, p3], groupId)
    expect(newJudge, 'the host who served round 1 is excluded from the re-pick').toBe(p3.id)

    host.socket.close(); p2.socket.close(); p3.socket.close()
  })

  // RT-3 gap closure (REP-RT3-1): a Judge who became Judge via a skip and then
  // actually plays a round must be recorded in judgedThisCycle. Otherwise a
  // later round's skip re-pick can re-draft them while an unserved member never
  // gets a turn. Group of 4 (host A + B, C, D): A skips round 1, someone is
  // skipped-onto and plays; round 2 is forced to a member who did not serve
  // round 1, and their skip must not re-select the round-1 Judge while one
  // genuinely unserved member remains.
  test('a skip-assigned Judge who plays is excluded from a later skip re-pick while an unserved member remains', async () => {
    const runId = testRunId()
    const host = connect(`js4-host-${runId}`, 'H')
    const p2 = connect(`js4-b-${runId}`, 'B')
    const p3 = connect(`js4-c-${runId}`, 'C')
    const p4 = connect(`js4-d-${runId}`, 'D')
    await Promise.all([host.ready, p2.ready, p3.ready, p4.ready])

    const players = [host, p2, p3, p4]
    const groupId = await rawGroup(host, [p2, p3, p4], {
      name: `Gap ${runId}`,
      settings: { submissionTime: ONE_SECOND, votingTime: ONE_SECOND }
    })

    // ---- Round 1: forced to host A ----
    host.socket.emit('start_group', { groupId, czarUserId: host.id })
    await waitForUpdate(host.socket, inPhase('topic_selection'))
    expect(await currentJudge(players, groupId)).toBe(host.id)

    // A skips; a non-served member (B/C/D) becomes Judge via the skip.
    const moved = waitForUpdate(host.socket, (p) => p.isRoundLeader === false)
    host.socket.emit('judge_skip', { groupId })
    await moved
    const round1Judge = await currentJudge(players, groupId)
    expect([p2.id, p3.id, p4.id]).toContain(round1Judge)

    // The skip only records the SKIPPER (host A) as served. The skip-assigned
    // round-1 Judge is recorded only when they actually play (select_topic
    // below) — that recorded state is asserted after the round completes.

    // The round-1 Judge actually plays: pick a topic.
    const round1JudgeSocket = players.find(p => p.id === round1Judge)
    const topics1 = await new Promise((resolve) => {
      round1JudgeSocket.socket.once('group_topics_list', resolve)
      round1JudgeSocket.socket.emit('get_group_topics', { groupId })
    })
    let topicId1 = topics1.topics?.[0]?.id
    if (!topicId1) {
      round1JudgeSocket.socket.emit('submit_topic', { text: `Gap topic ${runId}`, isPublic: false })
      topicId1 = (await once(round1JudgeSocket.socket, 'topic_submitted')).topic.id
    }
    round1JudgeSocket.socket.emit('select_topic', { groupId, topicId: topicId1 })
    await waitForUpdate(round1JudgeSocket.socket, inPhase('submission'))

    // Everyone except the Judge submits; the one-second windows run to reveal.
    for (const p of players) {
      if (p.id === round1Judge) continue
      p.socket.emit('submit_video', {
        groupId,
        videoId: 'dQw4w9WgXcQ',
        title: 'A submitted video',
        thumbnail: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
        channelTitle: 'Someone'
      })
    }
    await sleep(1500)
    const revealed1 = waitForUpdate(host.socket, inPhase('reveal'))
    host.socket.emit('check_round_deadline', { groupId })
    await revealed1

    // After round 1 the skip-assigned Judge who played is in the served set.
    expect((await view(host.socket, groupId)).group.judgedThisCycle).toContain(round1Judge)

    // ---- Round 2: forced to a member who did NOT serve round 1 ----
    const unservedRound1 = [p2, p3, p4].filter(p => p.id !== round1Judge)
    expect(unservedRound1).toHaveLength(2)
    const [round2Skipper, remainingUnserved] = unservedRound1

    host.socket.emit('start_round', { groupId, czarUserId: round2Skipper.id })
    await waitForUpdate(host.socket, inPhase('topic_selection'))
    expect(await currentJudge(players, groupId)).toBe(round2Skipper.id)

    // The round-2 Judge skips. The re-pick must NOT re-select the round-1 Judge
    // while the genuinely unserved member remains — it must land on them.
    const moved2 = waitForUpdate(round2Skipper.socket, (p) => p.isRoundLeader === false)
    round2Skipper.socket.emit('judge_skip', { groupId })
    await moved2

    const round2Judge = await currentJudge(players, groupId)
    expect(round2Judge, 'the round-1 skip-assigned Judge must not be re-drafted').not.toBe(round1Judge)
    expect(round2Judge, 'the only genuinely unserved member is picked').toBe(remainingUnserved.id)

    host.socket.close(); p2.socket.close(); p3.socket.close(); p4.socket.close()
  })
})
