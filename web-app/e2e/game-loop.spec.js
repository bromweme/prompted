import { test, expect } from '@playwright/test'
import { createGroupThroughWizard, seedTestUser, submitVideoThroughSearch, selectTopicAsJudge, startRoundAsHost, testRunId } from './helpers.js'

// This test drives the real, merged group game loop end to end over real
// socket.io traffic (see server/server.js): create a group, join it as a
// second independent player, start a round, submit a song, vote, and
// resolve results — with a live check that the Round Leader's identity
// never appears in a wire payload before the round is revealed.
//
// Identity is established at the socket handshake and bound server-side, and
// the test identity is seeded into localStorage, so two Playwright *tabs* in
// the same context would collide on the same user. Each player therefore gets
// its own browser context (separate storage), seeded with a distinct identity
// before the app boots.

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
  await seedTestUser(context, { id, name })
  const page = await context.newPage()
  const events = captureSocketEvents(page)
  return { context, page, events }
}

test('two players play a full round: join, assign, submit, vote, resolve, next round', async ({ browser }) => {
  const runId = testRunId()
  const player1 = await newPlayerContext(browser, { id: `e2e-host-${runId}`, name: 'Host Player' })
  const player2 = await newPlayerContext(browser, { id: `e2e-guest-${runId}`, name: 'Guest Player' })

  let groupId
  let submittedTitle

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
    await startRoundAsHost(player1.page)

    // A round now opens waiting for the Leader to choose a topic.
    await expect.poll(() => latestGroupUpdate(player1.events)?.group?.currentTheme?.status).toBe('topic_selection')
    await expect.poll(() => latestGroupUpdate(player2.events)?.group?.currentTheme?.status).toBe('topic_selection')
  })

  const p1IsLeader = latestGroupUpdate(player1.events).isRoundLeader
  const p2IsLeader = latestGroupUpdate(player2.events).isRoundLeader

  // Exactly one of the two players is privately told they're the Round
  // Leader — the assignment is random, so we don't assume which one.
  expect(p1IsLeader).toBe(!p2IsLeader)

  const leader = p1IsLeader ? player1 : player2
  const nonLeader = p1IsLeader ? player2 : player1

  await test.step('the Round Leader chooses a topic, which opens submissions', async () => {
    await leader.page.getByRole('button', { name: 'Round', exact: true }).click()
    await selectTopicAsJudge(leader.page)

    await expect.poll(() => latestGroupUpdate(player1.events)?.group?.currentTheme?.status).toBe('submission')
    await expect.poll(() => latestGroupUpdate(player2.events)?.group?.currentTheme?.status).toBe('submission')
    // The submission clock only starts once the topic exists.
    expect(latestGroupUpdate(player1.events).group.currentTheme.deadline).toBeTruthy()
    expect(latestGroupUpdate(player1.events).group.currentTheme.title).toBeTruthy()
  })

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

  await test.step('the non-Round-Leader submits a video through the real UI', async () => {
    await nonLeader.page.getByRole('button', { name: 'Round', exact: true }).click()
    submittedTitle = await submitVideoThroughSearch(nonLeader.page, 'queen')
    expect(submittedTitle).toBeTruthy()

    // Only one non-leader player exists, so one submission closes submission
    // phase immediately.
    await expect.poll(() => latestGroupUpdate(player1.events)?.group?.currentTheme?.status).toBe('voting')
    await expect.poll(() => latestGroupUpdate(player2.events)?.group?.currentTheme?.status).toBe('voting')
  })

  await test.step('submissions are anonymous during voting', async () => {
    await leader.page.getByRole('button', { name: 'Round', exact: true }).click()
    // The title also appears in the round's video list, so scope to the
    // voting list to keep this unambiguous.
    await expect(leader.page.locator('.submissions-list').getByText(submittedTitle)).toBeVisible()

    // Submitter identity must not be present on the anonymized submission
    // (group.host legitimately carries the host's id elsewhere in the same
    // payload, so this checks the submission shape specifically rather than
    // scanning the whole payload for id substrings).
    const submissions = latestGroupUpdate(leader.events).group.currentTheme.submissions
    expect(submissions).toHaveLength(1)
    expect(submissions[0]).not.toHaveProperty('playerUserId')
  })

  await test.step('the Round Leader resolves the round as Judge', async () => {
    // The leader is the Judge and the sole submission is the non-leader's own.
    // Casting a vote no longer reveals the round (RT-1), and the "Select as
    // Winner" control disappears once the Judge votes, so the Judge resolves
    // this two-player round directly by picking the winner.
    await leader.page.locator('.submissions-list').getByText(submittedTitle).click()
    await leader.page.getByRole('button', { name: /Select as Winner/ }).click()

    await expect.poll(() => latestGroupUpdate(player1.events)?.group?.currentTheme?.status).toBe('reveal')
    await expect.poll(() => latestGroupUpdate(player2.events)?.group?.currentTheme?.status).toBe('reveal')
  })

  await test.step('the round resolves with the correct winner, scoring, and history', async () => {
    const result = latestGroupUpdate(player1.events).group
    const theme = result.currentTheme

    // The Judge resolved by directly picking the winner (czar_selection), so
    // no popular-vote override applies even though only one submission exists.
    const winningSubmission = theme.submissions.find((s) => s.wonBy)
    expect(winningSubmission).toBeTruthy()
    expect(winningSubmission.title).toBe(submittedTitle)
    // The id is what the reveal iframe is built from, so its shape matters.
    expect(winningSubmission.videoId).toMatch(/^[A-Za-z0-9_-]{11}$/)
    expect(winningSubmission.wonBy).toBe('czar_selection')

    // Now that the round is revealed, the Round Leader's name is public.
    const expectedLeaderName = p1IsLeader ? 'Host Player' : 'Guest Player'
    expect(theme.czarUsername).toBe(expectedLeaderName)

    // Scoring: the submitter (non-leader) gets czarPoints (5, the create
    // form's default) for winning. Nobody cast a ballot — the Judge picked the
    // winner without voting, and self-voting is blocked for the only submitter
    // — so no jury bonus is awarded this round.
    const submitterName = p1IsLeader ? 'Guest Player' : 'Host Player'
    const scoreOf = (name) => result.players.find((p) => p.username === name).score
    expect(scoreOf(submitterName)).toBe(5)
    expect(scoreOf(expectedLeaderName)).toBe(0)

    // History recorded the completed round.
    expect(result.history).toHaveLength(1)
    expect(result.history[0]).toMatchObject({
      song: submittedTitle,
      winner: submitterName,
      totalSubmissions: 1,
      winningPoints: 5,
    })

    // Same numbers should be visible to the player who plays through it.
    await expect(nonLeader.page.getByText('🏆 Winner')).toBeVisible()

    // The reveal is the "watch together" moment: the winning video must
    // actually be embedded, not just named.
    const embed = nonLeader.page.locator('.youtube-embed iframe').first()
    await expect(embed).toHaveAttribute(
      'src',
      new RegExp(`youtube-nocookie\\.com/embed/${winningSubmission.videoId}`)
    )
  })

  await test.step('a second round can start cleanly afterward', async () => {
    // Player 1 created the group, so they're always the host regardless of
    // who was Round Leader for round 1.
    await startRoundAsHost(player1.page)

    await expect.poll(() => latestGroupUpdate(player1.events)?.group?.currentRound).toBe(2)
    await expect.poll(() => latestGroupUpdate(player1.events)?.group?.currentTheme?.status).toBe('topic_selection')
    await expect.poll(() => latestGroupUpdate(player2.events)?.group?.currentRound).toBe(2)
  })

  await player1.context.close()
  await player2.context.close()
})
