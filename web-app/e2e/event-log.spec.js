import { test, expect } from '@playwright/test'
import { io } from 'socket.io-client'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { testRunId } from './helpers.js'

// EVT-1: playing a round writes the expected rows to the server's append-only
// `events` table, and none of them carry names, topic text or video titles.
//
// Driven over raw sockets (the same authenticated path the browser uses) so the
// round is deterministic, then checked by opening the server's own SQLite file
// read-only. better-sqlite3 is a server dependency, so it is loaded from the
// server's node_modules rather than added to the web app.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(__dirname, '../../server')
const Database = createRequire(path.join(serverDir, 'package.json'))('better-sqlite3')
// Mirrors server/db.js: PROMPTED_DB_PATH is inherited by the webServer env.
const dbPath = process.env.PROMPTED_DB_PATH || path.join(serverDir, 'prompted.db')

const API_URL = 'http://localhost:5000'

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve))

// Resolves on the first `event` whose payload satisfies `pred`. A bare once()
// can resolve on an earlier broadcast that was still in flight.
const onceWhere = (socket, event, pred) => new Promise((resolve) => {
  const handler = (payload) => {
    if (!pred(payload)) return
    socket.off(event, handler)
    resolve(payload)
  }
  socket.on(event, handler)
})

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

function readEvents(groupId) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    return db
      .prepare('SELECT name, group_id, actor_id, props FROM events WHERE group_id = ? ORDER BY ts, rowid')
      .all(groupId)
      .map((row) => ({ ...row, props: row.props ? JSON.parse(row.props) : null }))
  } finally {
    db.close()
  }
}

test('playing a round writes the funnel events, with no PII', async () => {
  const runId = testRunId()
  const groupName = `EventLog Group ${runId}`
  const topicText = `EventLog topic ${runId}`
  const videoTitle = `EventLog video ${runId}`
  const host = connect(`evt-host-${runId}`, 'Event Host')
  const guest = connect(`evt-guest-${runId}`, 'Event Guest')
  await Promise.all([host.ready, guest.ready])

  try {
    host.socket.emit('create_group', { groupData: { name: groupName, settings: { voteBudget: 10 } } })
    const { group } = await once(host.socket, 'group_created')
    const groupId = group.id

    guest.socket.emit('join_group', { inviteCode: group.inviteCode })
    await once(guest.socket, 'group_joined')

    // Host picks themselves as Judge so the rest of the round is deterministic.
    host.socket.emit('start_group', { groupId, czarUserId: host.id })
    await once(host.socket, 'group_updated')

    host.socket.emit('submit_topic', { text: topicText, isPublic: false })
    const { topic } = await once(host.socket, 'topic_submitted')
    host.socket.emit('select_topic', { groupId, topicId: topic.id })
    await once(host.socket, 'group_updated')

    // The only non-Judge submits, which opens voting straight away.
    const guestSawVoting = onceWhere(guest.socket, 'group_updated',
      (p) => p.group && p.group.currentTheme && p.group.currentTheme.status === 'voting')
    guest.socket.emit('submit_video', {
      groupId, videoId: 'ccccccccccc', title: videoTitle,
      thumbnail: 'https://i.ytimg.com/vi/ccccccccccc/mqdefault.jpg', channelTitle: 'EventLog channel'
    })
    await guestSawVoting

    host.socket.emit('get_group', { groupId })
    const details = await once(host.socket, 'group_details')
    expect(details.group.currentTheme.status).toBe('voting')
    const submissionId = details.group.currentTheme.submissions[0].id

    host.socket.emit('cast_vote', { groupId, submissionId, points: 2 })
    await once(host.socket, 'group_updated')

    host.socket.emit('czar_select_winner', { groupId, submissionId })
    const revealed = await once(host.socket, 'group_updated')
    expect(revealed.group.currentTheme.status).toBe('reveal')

    let rows = []
    await expect.poll(() => {
      rows = readEvents(groupId)
      return rows.map((r) => r.name)
    }).toEqual([
      'group_created',
      // UI-2: every join attempt records how the invite arrived.
      'invite_opened',
      'member_joined',
      'round_started',
      'topic_selected',
      'submission_made',
      'voting_opened',
      'vote_cast',
      'winner_selected',
      'round_completed'
    ])

    const byName = Object.fromEntries(rows.map((r) => [r.name, r]))
    expect(byName.round_started.props).toMatchObject({ round: 1, players: 2, judgeHandPicked: true })
    expect(byName.voting_opened.props).toMatchObject({ trigger: 'all_submitted', submissions: 1 })
    expect(byName.vote_cast.props).toMatchObject({ points: 2, isDownvote: false, isJudge: true })
    expect(byName.round_completed.props).toMatchObject({
      round: 1, submissions: 1, votes: 1, voters: 1, players: 2, wonBy: 'czar_selection'
    })
    expect(byName.group_created.props.settings).toMatchObject({ voteBudget: 10 })
    expect(byName.invite_opened.props).toEqual({ via: 'code', outcome: 'joined' })
    expect(byName.invite_opened.actor_id).toBe(byName.member_joined.actor_id)

    // Actors are hashed, stable per user, and distinct between users.
    expect(byName.group_created.actor_id).toMatch(/^[0-9a-f]{64}$/)
    expect(byName.round_started.actor_id).toBe(byName.group_created.actor_id)
    expect(byName.member_joined.actor_id).toBe(byName.submission_made.actor_id)
    expect(byName.member_joined.actor_id).not.toBe(byName.group_created.actor_id)
    expect(byName.round_completed.actor_id).toBeNull()

    // Nothing identifying or free-text reaches the log.
    const stored = JSON.stringify(rows)
    for (const forbidden of [host.id, guest.id, group.inviteCode, 'Event Host', 'Event Guest', groupName, topicText, videoTitle, 'EventLog channel', 'ccccccccccc']) {
      expect(stored).not.toContain(forbidden)
    }
  } finally {
    host.socket.close()
    guest.socket.close()
  }
})
