import { test, expect } from '@playwright/test'
import { createGroupThroughWizard } from './helpers.js'

// This test drives the real, merged group game loop end to end over real
// socket.io traffic (see server/server.js): create a group, join it as a
// second independent player, start a round, submit a song, vote, and
// resolve results — with a live check that the Round Leader's identity
// never appears in a wire payload before the round is revealed.
//
// UserContext.jsx keys identity off localStorage, so two Playwright *tabs*
// in the same context would collide on the same fake user. Each player
// therefore gets its own browser context (separate storage), seeded with a
// distinct identity via addInitScript before the app boots.

/**
 * Decode a socket.io v4 text frame ("42[\"event\",payload]") into
 * { event, args }, or null if the frame isn't a Socket.IO EVENT packet
 * (e.g. Engine.IO ping/pong, connect acks).
 */
function decodeSocketIOFrame(payload) {
  if (typeof payload !== 'string') return null
  const match = payload.match(/^42(\[.*\])$/s)
  if (!match) return null
  try {
    const [event, ...args] = JSON.parse(match[1])
    return { event, args }
  } catch {
    return null
  }
}

/**
 * Attaches a WebSocket frame listener to `page` and returns an array that
 * fills up with decoded { event, args } entries for every Socket.IO event
 * the page receives, for as long as the page lives. This inspects the
 * actual wire payload, independent of anything rendered in the DOM.
 */
function captureSocketEvents(page) {
  const events = []
  page.on('websocket', (ws) => {
    ws.on('framereceived', ({ payload }) => {
      const decoded = decodeSocketIOFrame(payload)
      if (decoded) events.push(decoded)
    })
  })
  return events
}

function latestGroupUpdate(events) {
  const matches = events.filter((e) => e.event === 'group_updated')
  return matches.length ? matches[matches.length - 1].args[0] : undefined
}

async function newPlayerContext(browser, { id, name }) {
  const context = await browser.newContext()
  await context.addInitScript((user) => {
    window.localStorage.setItem('user', JSON.stringify(user))
  }, { id, name, email: `${id}@example.com`, avatar: '🎵', bio: '', location: '' })
  const page = await context.newPage()
  const events = captureSocketEvents(page)
  return { context, page, events }
}

test('two players play a full round: join, assign, submit, vote, resolve, next round', async ({ browser }) => {
  const runId = Date.now()
  const player1 = await newPlayerContext(browser, { id: `e2e-host-${runId}`, name: 'Host Player' })
  const player2 = await newPlayerContext(browser, { id: `e2e-guest-${runId}`, name: 'Guest Player' })

  let groupId

  await test.step('host creates a group', async () => {
    await createGroupThroughWizard(player1.page, `E2E Group ${runId}`)

    await expect(player1.page).toHaveURL(/\/group\/.+/)
    groupId = player1.page.url().split('/group/')[1]
    expect(groupId).toBeTruthy()

    await expect(player1.page.getByRole('button', { name: 'Delete Group' })).toBeVisible()
  })

  await test.step('second player joins the same group via a separate session', async () => {
    await player2.page.goto('/dashboard')
    await player2.page.getByRole('button', { name: 'Join existing group' }).click()
    await player2.page.getByLabel('Group Code').fill(groupId)
    await player2.page.getByRole('button', { name: 'Join Group', exact: true }).click()

    await expect(player2.page).toHaveURL(new RegExp(`/group/${groupId}$`))
    await expect(player2.page.getByRole('button', { name: 'Leave Group' })).toBeVisible()

    // Host's already-open page should live-update to show both players,
    // without a manual refresh.
    await expect(player1.page.getByText('2 players')).toBeVisible()
  })

  await test.step('host starts the group (round 1 begins, a Round Leader is assigned)', async () => {
    await player1.page.getByRole('button', { name: 'Start Group' }).click()

    await expect.poll(() => latestGroupUpdate(player1.events)?.group?.currentTheme?.status).toBe('submission')
    await expect.poll(() => latestGroupUpdate(player2.events)?.group?.currentTheme?.status).toBe('submission')
  })

  const p1IsLeader = latestGroupUpdate(player1.events).isRoundLeader
  const p2IsLeader = latestGroupUpdate(player2.events).isRoundLeader

  // Exactly one of the two players is privately told they're the Round
  // Leader — the assignment is random, so we don't assume which one.
  expect(p1IsLeader).toBe(!p2IsLeader)

  const leader = p1IsLeader ? player1 : player2
  const nonLeader = p1IsLeader ? player2 : player1

  await test.step('the Round Leader is never identifiable in a payload before reveal', () => {
    const allEvents = [...player1.events, ...player2.events]
    for (const { args } of allEvents) {
      // czarId is the server-internal field; publicizeTheme() must strip it
      // from every broadcast, to every player, always.
      expect(JSON.stringify(args)).not.toContain('czarId')
    }

    // anonymousCzar defaults to true, so czarUsername must be absent from
    // both players' payloads until the round is revealed.
    for (const page of [player1, player2]) {
      for (const { event, args } of page.events) {
        if (event !== 'group_updated' && event !== 'group_details') continue
        const theme = args[0]?.group?.currentTheme
        if (theme && theme.status !== 'reveal') {
          expect(theme.czarUsername, `czarUsername leaked pre-reveal in a ${event} payload`).toBeUndefined()
        }
      }
    }
  })

  await test.step('the non-Round-Leader submits a song through the real UI', async () => {
    await nonLeader.page.getByRole('button', { name: 'Round', exact: true }).click()
    await nonLeader.page.getByRole('button', { name: 'Submit Song' }).click()

    const dialog = nonLeader.page.getByRole('dialog')
    await dialog.getByLabel('Spotify URI').fill('spotify:track:e2e12345')
    await dialog.getByLabel('Song Title').fill('E2E Test Song')
    await dialog.getByLabel('Artist').fill('E2E Artist')
    await dialog.getByRole('button', { name: 'Submit Song' }).click()

    // Only one non-leader player exists, so one submission closes submission
    // phase immediately.
    await expect.poll(() => latestGroupUpdate(player1.events)?.group?.currentTheme?.status).toBe('voting')
    await expect.poll(() => latestGroupUpdate(player2.events)?.group?.currentTheme?.status).toBe('voting')
  })

  await test.step('submissions are anonymous during voting', async () => {
    await leader.page.getByRole('button', { name: 'Round', exact: true }).click()
    await expect(leader.page.getByText('E2E Test Song')).toBeVisible()

    // Submitter identity must not be present on the anonymized submission
    // (group.host legitimately carries the host's id elsewhere in the same
    // payload, so this checks the submission shape specifically rather than
    // scanning the whole payload for id substrings).
    const submissions = latestGroupUpdate(leader.events).group.currentTheme.submissions
    expect(submissions).toHaveLength(1)
    expect(submissions[0]).not.toHaveProperty('playerUserId')
  })

  await test.step('both players vote, including the Round Leader', async () => {
    for (const player of [leader, nonLeader]) {
      await player.page.getByText('E2E Test Song').click()
      await player.page.getByRole('button', { name: 'Cast Vote' }).click()
    }

    await expect.poll(() => latestGroupUpdate(player1.events)?.group?.currentTheme?.status).toBe('reveal')
    await expect.poll(() => latestGroupUpdate(player2.events)?.group?.currentTheme?.status).toBe('reveal')
  })

  await test.step('the round resolves with the correct winner, scoring, and history', async () => {
    const result = latestGroupUpdate(player1.events).group
    const theme = result.currentTheme

    // With both votes unanimously behind the only submission (2/2 = 100%
    // meets the default 70% override threshold), this resolves as a public
    // override rather than falling through to the popular-vote branch.
    const winningSubmission = theme.submissions.find((s) => s.wonBy)
    expect(winningSubmission).toBeTruthy()
    expect(winningSubmission.songTitle).toBe('E2E Test Song')
    expect(winningSubmission.wonBy).toBe('public_override')

    // Now that the round is revealed, the Round Leader's name is public.
    const expectedLeaderName = p1IsLeader ? 'Host Player' : 'Guest Player'
    expect(theme.czarUsername).toBe(expectedLeaderName)

    // Scoring: the submitter (non-leader) gets czarPoints (5, the create
    // form's default) for winning, plus a jury bonus (their own vote's
    // point value, default 1) for voting for the winning submission. The
    // Round Leader only collects their own jury bonus (1).
    const submitterName = p1IsLeader ? 'Guest Player' : 'Host Player'
    const scoreOf = (name) => result.players.find((p) => p.username === name).score
    expect(scoreOf(submitterName)).toBe(6)
    expect(scoreOf(expectedLeaderName)).toBe(1)

    // History recorded the completed round.
    expect(result.history).toHaveLength(1)
    expect(result.history[0]).toMatchObject({
      song: 'E2E Test Song',
      winner: submitterName,
      totalSubmissions: 1,
      winningPoints: 5,
    })

    // Same numbers should be visible to the player who plays through it.
    await expect(nonLeader.page.getByText('🏆 Winner')).toBeVisible()
  })

  await test.step('a second round can start cleanly afterward', async () => {
    // Player 1 created the group, so they're always the host regardless of
    // who was Round Leader for round 1.
    await player1.page.getByRole('button', { name: 'Start Next Round' }).click()
    await player1.page.getByRole('dialog').getByRole('button', { name: 'Randomly Assign' }).click()

    await expect.poll(() => latestGroupUpdate(player1.events)?.group?.currentRound).toBe(2)
    await expect.poll(() => latestGroupUpdate(player1.events)?.group?.currentTheme?.status).toBe('submission')
    await expect.poll(() => latestGroupUpdate(player2.events)?.group?.currentRound).toBe(2)
  })

  await player1.context.close()
  await player2.context.close()
})
