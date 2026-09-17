import { test, expect } from '@playwright/test'
import { io } from 'socket.io-client'
import { createGroupThroughWizard, seedTestUser, submitVideoThroughSearch, selectTopicAsJudge, waitForJudgeIndex, startRoundAsHost, testRunId } from './helpers.js'

const API_URL = 'http://localhost:5000'

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve))

// The server emits `session` from inside its connection handler, so the
// listener has to be attached before the connection settles.
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

// Covers the three-phase round view, the self-vote restriction (UI and
// server), voting comments and their anonymity, and the post-round video list.
//
// Three players are used deliberately: with only two, the single submission
// belongs to the non-leader and nobody but the leader can vote, so there is no
// self-vote case to observe and no second commenter.

async function newPlayer(browser, { id, name }) {
  const context = await browser.newContext()
  await seedTestUser(context, { id, name })
  const page = await context.newPage()
  return { context, page, name }
}

/**
 * Builds a group with three players, starts it, and returns the players split
 * into the round leader and the two who submit.
 */
async function startThreePlayerRound(browser, runId, { allowVotingComments = false, showCommentsLive = false } = {}) {
  const host = await newPlayer(browser, { id: `rp-host-${runId}`, name: 'Host Player' })
  const p2 = await newPlayer(browser, { id: `rp-two-${runId}`, name: 'Second Player' })
  const p3 = await newPlayer(browser, { id: `rp-three-${runId}`, name: 'Third Player' })

  await createGroupThroughWizard(host.page, `Round Phase ${runId}`)
  await expect(host.page).toHaveURL(/\/group\/.+/)
  const groupId = host.page.url().split('/group/')[1]

  if (allowVotingComments) {
    await host.page.getByRole('button', { name: 'Rules', exact: true }).click()
    await host.page.getByRole('button', { name: 'Edit Rules' }).click()
    await host.page.getByRole('checkbox', { name: 'Allow comments during voting' }).check()
    // The dependent toggle only exists once the parent is on.
    const liveToggle = host.page.getByRole('checkbox', { name: 'Show comments live during voting' })
    await expect(liveToggle).toBeVisible()
    if (showCommentsLive) await liveToggle.check()
    await host.page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(host.page.getByRole('button', { name: 'Edit Rules' })).toBeVisible()
    await host.page.getByRole('button', { name: 'Overview', exact: true }).click()
  }

  for (const p of [p2, p3]) {
    await p.page.goto(`/group/${groupId}?join=true`)
    await expect(p.page.locator('.group-info-card')).toBeVisible()
  }
  await expect(host.page.getByText('3 players')).toBeVisible()

  await startRoundAsHost(host.page)

  const all = [host, p2, p3]
  for (const p of all) {
    await p.page.getByRole('button', { name: 'Round', exact: true }).click()
  }

  // Exactly one player is the leader; the other two are the submitters. The
  // round opens in topic selection, and only the Leader sees the picker.
  const leaderIndex = await waitForJudgeIndex(all.map((p) => p.page))

  const leader = all[leaderIndex]
  const submitters = all.filter((_, i) => i !== leaderIndex)

  await selectTopicAsJudge(leader.page)
  for (const p of all) await expect(p.page.getByText('Phase 1 of 3')).toBeVisible()

  return { groupId, all, leader, submitters }
}

test.describe('round phases', () => {
  test('a solo group cannot start a round, in the UI or on the server', async ({ page, context, browser }) => {
    const runId = testRunId()
    await seedTestUser(context, { id: `solo-${runId}`, name: 'Solo Host' })

    await createGroupThroughWizard(page, `Solo Group ${runId}`)
    await expect(page).toHaveURL(/\/group\/.+/)
    const groupId = page.url().split('/group/')[1]

    // UI: the action is disabled and says why. A solo round would consume a
    // topic and then stall, because nobody can submit.
    const startButton = page.getByRole('button', { name: 'Start Round', exact: true })
    // Styled as the primary action; the :disabled rule is what mutes it here.
    await expect(startButton).toHaveClass(/\bsetup-button\b/)
    await expect(startButton).toHaveClass(/\bprimary\b/)
    await expect(startButton).not.toHaveClass(/\bsecondary\b/)
    await expect(startButton).toBeDisabled()
    await expect(page.getByText(/at least 2 players/)).toBeVisible()
    await expect(page.getByText('Group can start with 1 player for testing')).toHaveCount(0)

    // The server-side half of this rule is covered by the next test, which
    // owns its group and so reaches the player-count check rather than the
    // host check.

    // Once a second player joins, both sides allow it.
    const second = await browser.newContext()
    await seedTestUser(second, { id: `solo-two-${runId}`, name: 'Second Player' })
    const secondPage = await second.newPage()
    await secondPage.goto(`/group/${groupId}?join=true`)
    await expect(secondPage.locator('.group-info-card')).toBeVisible()

    await expect(startButton).toBeEnabled()
    await startRoundAsHost(page)
    await page.getByRole('button', { name: 'Round', exact: true }).click()
    // The round opens in its topic phase. Asserted via the phase label, which
    // every player sees regardless of who was picked as Judge.
    await expect(page.getByText('Getting started')).toBeVisible()

    await second.close()
  })

  test('a round can start while other members are offline', async () => {
    // Presence must not gate the round: whoever is away can submit when they
    // come back. Only group membership matters.
    const runId = testRunId()
    const host = connect(`off-host-${runId}`, 'Offline Host')
    const away = connect(`off-away-${runId}`, 'Away Player')
    await Promise.all([host.ready, away.ready])

    host.socket.emit('create_group', { groupData: { name: `Offline ${runId}`, settings: {} } })
    const { group } = await once(host.socket, 'group_created')

    away.socket.emit('join_group', { groupId: group.id })
    await once(away.socket, 'group_joined')

    // The second member goes offline, leaving the host alone on the wire.
    away.socket.close()
    await new Promise((r) => setTimeout(r, 400))

    host.socket.emit('start_group', { groupId: group.id })
    const update = await Promise.race([
      once(host.socket, 'group_updated'),
      once(host.socket, 'error').then((e) => ({ error: e.message }))
    ])
    expect(update.error, 'starting a round must not depend on who is connected').toBeUndefined()
    expect(update.group.currentTheme.status).toBe('topic_selection')

    host.socket.close()
  })

  test('the server refuses a solo start even from the host', async () => {
    const runId = testRunId()
    const host = connect(`hostonly-${runId}`, 'Host Only')
    await host.ready

    host.socket.emit('create_group', { groupData: { name: `HostOnly ${runId}`, settings: {} } })
    const { group } = await once(host.socket, 'group_created')

    host.socket.emit('start_group', { groupId: group.id })
    const err = await once(host.socket, 'error')
    expect(err.message).toContain('at least 2 players in the group')

    host.socket.close()
  })

  test('the host is prompted to choose the Judge, and a manual pick is honoured', async ({ browser }) => {
    const runId = testRunId()
    const host = await newPlayer(browser, { id: `pick-host-${runId}`, name: 'Picking Host' })
    const target = await newPlayer(browser, { id: `pick-target-${runId}`, name: 'Chosen Judge' })

    await createGroupThroughWizard(host.page, `Judge Pick ${runId}`)
    await expect(host.page).toHaveURL(/\/group\/.+/)
    const groupId = host.page.url().split('/group/')[1]

    await target.page.goto(`/group/${groupId}?join=true`)
    await expect(target.page.locator('.group-info-card')).toBeVisible()

    // Round 1 now prompts too — it used to assign randomly with no choice.
    await host.page.getByRole('button', { name: 'Start Round', exact: true }).click()
    const prompt = host.page.getByRole('dialog')
    await expect(prompt.getByRole('heading', { name: 'Select Judge' })).toBeVisible()
    await expect(prompt.getByRole('button', { name: /Randomly Assign/ })).toBeVisible()

    await prompt.getByRole('button', { name: /Pick Judge/ }).click()
    const picker = host.page.getByRole('dialog')
    await expect(picker.getByRole('heading', { name: 'Pick Judge' })).toBeVisible()
    await picker.getByRole('button', { name: /Chosen Judge/ }).click()

    for (const p of [host, target]) {
      await p.page.getByRole('button', { name: 'Round', exact: true }).click()
    }

    // The chosen player is the Judge, and only they are told so.
    await expect(target.page.locator('.topic-picker')).toBeVisible()
    await expect(host.page.locator('.topic-picker')).toHaveCount(0)
    await expect(host.page.getByText('Waiting for the Judge')).toBeVisible()

    // The submission clock only starts once the topic is chosen.
    await expect(host.page.getByText('Phase 1 of 3')).toHaveCount(0)
    await selectTopicAsJudge(target.page)
    await expect(host.page.getByText('Phase 1 of 3')).toBeVisible()

    await host.context.close()
    await target.context.close()
  })

  test('submission phase shows a confirmation with the video still, and voting waits for everyone', async ({ browser }) => {
    const runId = testRunId()
    const { all, leader, submitters } = await startThreePlayerRound(browser, runId)

    await expect(leader.page.getByText('Phase 1 of 3')).toBeVisible()
    await expect(leader.page.getByRole('heading', { name: 'Submissions' })).toBeVisible()

    // First submitter: confirmation card with the thumbnail of what they sent.
    const title = await submitVideoThroughSearch(submitters[0].page, 'queen')
    const confirmation = submitters[0].page.locator('.submission-confirmation')
    await expect(confirmation).toBeVisible()
    await expect(confirmation).toContainText('Your submission is in')
    await expect(confirmation).toContainText(title)
    await expect(confirmation.locator('img')).toHaveAttribute('src', /i\.ytimg\.com|ytimg/)

    // Voting must not have opened with one of two submissions in.
    await expect(confirmation).toContainText('1 of 2 submitted')
    await expect(leader.page.getByText('Phase 1 of 3')).toBeVisible()
    await expect(leader.page.getByText('Phase 2 of 3')).toHaveCount(0)

    // Second submission flips everyone into voting.
    await submitVideoThroughSearch(submitters[1].page, 'adele')
    for (const p of all) {
      await expect(p.page.getByText('Phase 2 of 3')).toBeVisible()
      await expect(p.page.getByRole('heading', { name: 'Voting' })).toBeVisible()
    }

    for (const p of all) await p.context.close()
  })

  test('each player sees only their own role, in submission and voting', async ({ browser }) => {
    const runId = testRunId()
    const { all, leader, submitters } = await startThreePlayerRound(browser, runId)

    // Submission phase.
    await expect(leader.page.locator('.role-badge')).toHaveText('You are a: Judge')
    for (const s of submitters) {
      await expect(s.page.locator('.role-badge')).toHaveText('You are a: Contestant')
    }

    // Nobody is told anyone else's role: exactly one badge per page, and a
    // contestant's page never names the Judge.
    for (const p of all) await expect(p.page.locator('.role-badge')).toHaveCount(1)
    for (const s of submitters) {
      await expect(s.page.locator('.round-content')).not.toContainText(leader.name)
    }

    // Voting phase: still shown, still the viewer's own role.
    await submitVideoThroughSearch(submitters[0].page, 'queen')
    await submitVideoThroughSearch(submitters[1].page, 'adele')
    await expect(leader.page.getByText('Phase 2 of 3')).toBeVisible()

    await expect(leader.page.locator('.role-badge')).toHaveText('You are a: Judge')
    for (const s of submitters) {
      await expect(s.page.locator('.role-badge')).toHaveText('You are a: Contestant')
    }

    for (const p of all) await p.context.close()
  })

  test('a player cannot select their own submission in the voting UI', async ({ browser }) => {
    const runId = testRunId()
    const { all, submitters } = await startThreePlayerRound(browser, runId)

    const ownTitle = await submitVideoThroughSearch(submitters[0].page, 'queen')
    await submitVideoThroughSearch(submitters[1].page, 'adele')

    const page = submitters[0].page
    await expect(page.getByText('Phase 2 of 3')).toBeVisible()

    // Their own entry is present but disabled and labelled.
    const own = page.locator('.submission-item.own-submission')
    await expect(own).toBeVisible()
    await expect(own).toContainText(ownTitle)
    await expect(own).toBeDisabled()
    await expect(own).toContainText("you can't vote for it")

    // The other submission is selectable.
    const others = page.locator('.submission-item:not(.own-submission)')
    await expect(others).toHaveCount(1)
    await expect(others).toBeEnabled()

    for (const p of all) await p.context.close()
  })

  test('the server rejects a self-vote even when the client sends one', async () => {
    // Deliberately not driven through the UI: the point is that the rule
    // holds against a crafted payload, which a browser test can't produce
    // because the control is disabled. This talks to the same server the
    // browser tests use, over the same authenticated socket path.
    const runId = testRunId()
    const players = ['host', 'two', 'three'].map((n) =>
      connect(`sv-${n}-${runId}`, `Player ${n}`)
    )
    const [host, second, third] = players
    await Promise.all(players.map((p) => p.ready))

    host.socket.emit('create_group', { groupData: { name: `SelfVote ${runId}`, settings: { totalRounds: 3 } } })
    const { group } = await once(host.socket, 'group_created')
    const groupId = group.id

    for (const p of [second, third]) {
      p.socket.emit('join_group', { groupId })
      await once(p.socket, 'group_joined')
    }

    host.socket.emit('start_group', { groupId })
    await once(host.socket, 'group_updated')

    const views = {}
    for (const p of players) {
      p.socket.emit('get_group', { groupId })
      views[p.id] = await once(p.socket, 'group_details')
    }
    const submitters = players.filter((p) => !views[p.id].isRoundLeader)
    expect(submitters).toHaveLength(2)

    // The round opens waiting for a topic. The Leader creates one and picks
    // it, which is also the path a group with an empty library takes.
    const judge = players.find((p) => views[p.id].isRoundLeader)
    judge.socket.emit('submit_topic', { text: `Socket topic ${runId}`, isPublic: false })
    const { topic } = await once(judge.socket, 'topic_submitted')
    judge.socket.emit('select_topic', { groupId, topicId: topic.id })
    await once(judge.socket, 'group_updated')

    // Awaited one at a time: these are separate sockets, so firing both and
    // reading straight after would race the server's processing order.
    submitters[0].socket.emit('submit_video', {
      groupId, videoId: 'aaaaaaaaaaa', title: 'Self A',
      thumbnail: 'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg', channelTitle: 'Ch A'
    })
    await once(submitters[0].socket, 'group_updated')

    submitters[1].socket.emit('submit_video', {
      groupId, videoId: 'bbbbbbbbbbb', title: 'Self B',
      thumbnail: 'https://i.ytimg.com/vi/bbbbbbbbbbb/mqdefault.jpg', channelTitle: 'Ch B'
    })
    await once(submitters[1].socket, 'group_updated')

    // Each submitter is told which submission is their own, and only their own.
    // Polled rather than read once: the phase flip reaches each socket by
    // broadcast, so a single immediate read can land a beat early.
    const fetch = async (player) => {
      player.socket.emit('get_group', { groupId })
      return once(player.socket, 'group_details')
    }
    let mine
    await expect.poll(async () => {
      mine = await fetch(submitters[0])
      return mine.group.currentTheme.status
    }, { timeout: 15_000 }).toBe('voting')
    expect(mine.yourSubmissionId).toBeTruthy()

    const leaderView = await fetch(judge)
    expect(leaderView.yourSubmissionId).toBeNull()

    // Upvote and downvote of one's own submission are both refused.
    submitters[0].socket.emit('cast_vote', { groupId, submissionId: mine.yourSubmissionId, points: 3 })
    expect((await once(submitters[0].socket, 'error')).message).toContain('cannot vote for your own submission')

    submitters[0].socket.emit('cast_vote', { groupId, submissionId: mine.yourSubmissionId, isDownvote: true })
    expect((await once(submitters[0].socket, 'error')).message).toContain('cannot vote for your own submission')

    // Voting for someone else still works, so the rule isn't over-broad.
    const other = mine.group.currentTheme.submissions.find((x) => x.id !== mine.yourSubmissionId)
    submitters[0].socket.emit('cast_vote', { groupId, submissionId: other.id, points: 2 })
    const updated = await once(submitters[0].socket, 'group_updated')
    expect(updated.group.currentTheme.voteCount ?? updated.group.currentTheme.votes?.length).toBeGreaterThan(0)

    for (const p of players) p.socket.close()
  })

  test('voting comments are anonymous during voting and attributed at reveal', async ({ browser }) => {
    const runId = testRunId()
    const { all, leader, submitters } = await startThreePlayerRound(browser, runId, { allowVotingComments: true, showCommentsLive: true })

    await submitVideoThroughSearch(submitters[0].page, 'queen')
    const secondTitle = await submitVideoThroughSearch(submitters[1].page, 'adele')

    // A contestant votes for the other contestant's submission with a comment.
    // The Judge deliberately does not vote here, so they keep the "Select as
    // Winner" control (that control disappears once the Judge has voted).
    await expect(submitters[0].page.getByText('Phase 2 of 3')).toBeVisible()
    await submitters[0].page.locator('.submissions-list').getByText(secondTitle).click()
    await submitters[0].page.getByLabel('Comment (optional)').fill('This one is unbeatable')
    await submitters[0].page.getByRole('button', { name: 'Cast Vote' }).click()

    // Another player sees the comment but not who wrote it.
    const otherView = leader.page
    const comment = otherView.locator('.vote-comment').filter({ hasText: 'This one is unbeatable' })
    await expect(comment).toBeVisible()
    await expect(comment.locator('.vote-comment-author')).toHaveText('Anonymous')
    await expect(otherView.locator('.vote-comment')).not.toContainText(submitters[0].name)

    // Voting keeps running to its deadline (RT-1), so the reveal is driven by
    // the Judge explicitly picking a winner — a valid during-voting path that
    // resolves immediately.
    await leader.page.locator('.submissions-list').getByText(secondTitle).click()
    await leader.page.getByRole('button', { name: /Select as Winner/ }).click()

    await expect(leader.page.getByText('Phase 3 of 3')).toBeVisible()
    const revealed = leader.page.locator('.vote-comment').filter({ hasText: 'This one is unbeatable' })
    await expect(revealed).toBeVisible()
    await expect(revealed.locator('.vote-comment-author')).toHaveText(submitters[0].name)

    for (const p of all) await p.context.close()
  })

  test('with live comments off, comments are withheld until reveal', async ({ browser }) => {
    const runId = testRunId()
    const { all, leader, submitters } = await startThreePlayerRound(
      browser, runId, { allowVotingComments: true, showCommentsLive: false }
    )

    const commentedTitle = await submitVideoThroughSearch(submitters[0].page, 'queen')
    await submitVideoThroughSearch(submitters[1].page, 'adele')

    // The comment box is still offered — collection is unchanged. submitters[1]
    // comments on submitters[0]'s submission (a peer's, not its own).
    await expect(leader.page.getByText('Phase 2 of 3')).toBeVisible()
    await submitters[1].page.locator('.submissions-list').getByText(commentedTitle).click()
    await submitters[1].page.getByLabel('Comment (optional)').fill('Held until the reveal')
    await submitters[1].page.getByRole('button', { name: 'Cast Vote' }).click()

    // Nobody sees it mid-round, including the author's own view (live is off).
    for (const p of [leader, submitters[0], submitters[1]]) {
      await expect(p.page.locator('.vote-comment')).toHaveCount(0)
    }

    // Voting stays open even after people vote (RT-1), so the reveal is driven
    // by the Judge explicitly picking a winner rather than by "everyone cast".
    await leader.page.locator('.submissions-list').getByText(commentedTitle).click()
    await leader.page.getByRole('button', { name: /Select as Winner/ }).click()

    // At reveal it appears, attributed like any other comment.
    await expect(leader.page.getByText('Phase 3 of 3')).toBeVisible()
    const revealed = leader.page.locator('.vote-comment').filter({ hasText: 'Held until the reveal' })
    await expect(revealed).toBeVisible()
    await expect(revealed.locator('.vote-comment-author')).toHaveText(submitters[1].name)

    for (const p of all) await p.context.close()
  })

  test('the live-comments setting is only offered when comments are enabled', async ({ page, context }) => {
    const runId = testRunId()
    await seedTestUser(context, { id: `dep-${runId}`, name: 'Dependent Host' })
    await createGroupThroughWizard(page, `Dependent ${runId}`)
    await expect(page).toHaveURL(/\/group\/.+/)

    await page.getByRole('button', { name: 'Rules', exact: true }).click()
    await page.getByRole('button', { name: 'Edit Rules' }).click()

    const parent = page.getByRole('checkbox', { name: 'Allow comments during voting' })
    const dependent = page.getByRole('checkbox', { name: 'Show comments live during voting' })

    await expect(parent).not.toBeChecked()
    await expect(dependent).toHaveCount(0)

    await parent.check()
    await expect(dependent).toBeVisible()
    await dependent.check()

    // Turning the parent back off hides and clears the dependent setting,
    // so the pair can't be saved in a state the UI never shows.
    await parent.uncheck()
    await expect(dependent).toHaveCount(0)
    await parent.check()
    await expect(dependent).not.toBeChecked()
  })

  test('the comment box only appears when the host has enabled it', async ({ browser }) => {
    const runId = testRunId()
    const { all, leader, submitters } = await startThreePlayerRound(browser, runId)

    await submitVideoThroughSearch(submitters[0].page, 'queen')
    await submitVideoThroughSearch(submitters[1].page, 'adele')

    await expect(leader.page.getByText('Phase 2 of 3')).toBeVisible()
    await leader.page.locator('.submission-item:not(.own-submission)').first().click()
    await expect(leader.page.getByRole('button', { name: 'Cast Vote' })).toBeVisible()
    await expect(leader.page.getByLabel('Comment (optional)')).toHaveCount(0)

    for (const p of all) await p.context.close()
  })

  test('the round video list and watch-all link appear once submissions are in', async ({ browser }) => {
    const runId = testRunId()
    const { all, leader, submitters } = await startThreePlayerRound(browser, runId)

    await submitVideoThroughSearch(submitters[0].page, 'queen')
    await submitVideoThroughSearch(submitters[1].page, 'adele')

    await expect(leader.page.getByText('Phase 2 of 3')).toBeVisible()

    const list = leader.page.getByRole('region', { name: "This round's videos" })
    await expect(list).toBeVisible()
    await expect(list.locator('.round-video-item')).toHaveCount(2)

    // The watch-all URL is YouTube's multi-video watch link: a plain URL with
    // comma-separated ids, needing no API call and no OAuth scope.
    const watchAll = list.getByRole('link', { name: /Watch all on YouTube/ })
    const href = await watchAll.getAttribute('href')
    expect(href).toMatch(/^https:\/\/www\.youtube\.com\/watch_videos\?video_ids=/)
    const ids = href.split('video_ids=')[1].split(',')
    expect(ids).toHaveLength(2)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{11}$/)
    await expect(watchAll).toHaveAttribute('target', '_blank')
    await expect(watchAll).toHaveAttribute('rel', /noopener/)

    for (const p of all) await p.context.close()
  })
})
