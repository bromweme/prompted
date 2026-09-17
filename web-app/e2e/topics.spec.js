import { test, expect } from '@playwright/test'
import { createGroupThroughWizard, seedTestUser, selectTopicAsJudge, submitVideoThroughSearch, waitForJudgeIndex, startRoundAsHost, testRunId } from './helpers.js'

// Covers the personal topic library, group-scoped sharing, and per-group
// usage marking.

async function newPlayer(browser, { id, name }) {
  const context = await browser.newContext()
  await seedTestUser(context, { id, name })
  const page = await context.newPage()
  return { context, page, name }
}

/**
 * Joins a second player to a group. A round needs at least two connected
 * players (one to judge, one to submit), so a solo group can no longer start.
 */
async function addFillerPlayer(browser, groupId, { id, name }) {
  const context = await browser.newContext()
  await seedTestUser(context, { id, name })
  const page = await context.newPage()
  await page.goto(`/group/${groupId}?join=true`)
  await expect(page.locator('.group-info-card')).toBeVisible()
  return { context, page, name }
}

async function addTopicToLibrary(page, text, { share = false } = {}) {
  await page.goto('/topics')
  await page.getByRole('button', { name: 'Add new theme idea' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox').first().fill(text)
  if (share) await dialog.getByRole('checkbox').first().check()
  await dialog.getByRole('button', { name: /Add Theme|Save/ }).click()
  await expect(page.getByText(text)).toBeVisible({ timeout: 15_000 })
}

test.describe('topic library', () => {
  test('the personal library is reachable from the nav and keeps topics across groups', async ({ page, context, browser }) => {
    const runId = testRunId()
    await seedTestUser(context, { id: `lib-${runId}`, name: 'Library Owner' })

    await page.goto('/dashboard')
    await page.getByRole('banner').getByRole('button', { name: 'My Topics' }).click()
    await expect(page).toHaveURL(/\/topics$/)
    await expect(page.getByRole('heading', { name: 'My Topics' })).toBeVisible()

    const topicText = `Reusable topic ${runId}`
    await addTopicToLibrary(page, topicText)

    // The same library backs every group the owner plays in.
    await createGroupThroughWizard(page, `Lib Group A ${runId}`)
    await expect(page).toHaveURL(/\/group\/.+/)
    const groupId = page.url().split('/group/')[1]
    const filler = await addFillerPlayer(browser, groupId, { id: `lib-fill-${runId}`, name: 'Filler One' })

    // Hand-picking the owner as Judge makes the picker deterministically theirs.
    await startRoundAsHost(page, { pickPlayer: 'Library Owner' })
    await page.getByRole('button', { name: 'Round', exact: true }).click()
    await expect(page.locator('.topic-picker').getByText(topicText)).toBeVisible()

    await filler.context.close()
  })

  test('the library page has no preset inspiration grid, and Add Theme still works', async ({ page, context }) => {
    const runId = testRunId()
    await seedTestUser(context, { id: `noquick-${runId}`, name: 'No Quick Ideas' })

    await page.goto('/topics')
    await expect(page.getByRole('heading', { name: 'My Topics' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add new theme idea' })).toBeVisible()

    // UI-5: the "Quick Theme Inspiration" presets were removed from this page.
    await expect(page.getByText('Quick Theme Inspiration')).toHaveCount(0)
    await expect(page.locator('.quick-ideas-section')).toHaveCount(0)

    // The Add Theme modal still opens empty (no preset prefill) and saves.
    await page.getByRole('button', { name: 'Add new theme idea' }).click()
    await expect(page.getByRole('dialog').getByRole('textbox').first()).toHaveValue('')
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    const topicText = `No presets needed ${runId}`
    await addTopicToLibrary(page, topicText)
    await expect(page.getByText('Quick Theme Inspiration')).toHaveCount(0)
  })

  test('a topic used in one group is marked there but stays fresh elsewhere', async ({ browser }) => {
    const runId = testRunId()
    const owner = await newPlayer(browser, { id: `used-own-${runId}`, name: 'Reuse Owner' })
    const mate = await newPlayer(browser, { id: `used-mate-${runId}`, name: 'Reuse Mate' })

    // Shared, so whichever of the two is Judge in round 2 can see it — Judge
    // assignment is random.
    const topicText = `Shared across groups ${runId}`
    await addTopicToLibrary(owner.page, topicText, { share: true })

    // --- Group A: play a full round using the topic ---
    await createGroupThroughWizard(owner.page, `Reuse A ${runId}`)
    await expect(owner.page).toHaveURL(/\/group\/.+/)
    const groupA = owner.page.url().split('/group/')[1]

    await mate.page.goto(`/group/${groupA}?join=true`)
    await expect(mate.page.locator('.group-info-card')).toBeVisible()
    await startRoundAsHost(owner.page)

    const both = [owner, mate]
    for (const p of both) await p.page.getByRole('button', { name: 'Round', exact: true }).click()

    let judgeIdx = await waitForJudgeIndex(both.map((p) => p.page))
    const judge = both[judgeIdx]
    const contestant = both[1 - judgeIdx]

    await expect(judge.page.locator('.topic-option').filter({ hasText: topicText })).toBeVisible()
    await judge.page.locator('.topic-option').filter({ hasText: topicText }).click()
    await expect(judge.page.getByText('Phase 1 of 3')).toBeVisible()

    // Complete the round so a second one can begin. Casting a vote no longer
    // reveals the round (RT-1), and the Judge loses the "Select as Winner"
    // control once they vote, so the Judge resolves by directly picking the
    // winner without voting.
    const title = await submitVideoThroughSearch(contestant.page, 'queen')
    await expect(judge.page.getByText('Phase 2 of 3')).toBeVisible()
    await judge.page.locator('.submissions-list').getByText(title).click()
    await judge.page.getByRole('button', { name: /Select as Winner/ }).click()
    await expect(judge.page.getByText('Phase 3 of 3')).toBeVisible()

    // --- Round 2 in the same group: the topic is marked as already played ---
    await startRoundAsHost(owner.page)

    judgeIdx = await waitForJudgeIndex(both.map((p) => p.page))
    const round2Judge = both[judgeIdx]
    const marked = round2Judge.page.locator('.topic-option').filter({ hasText: topicText })
    await expect(marked).toHaveClass(/used/)
    await expect(marked).toContainText('Already played here')
    // Marked, not blocked — reuse stays the Judge's call.
    await expect(marked).toBeEnabled()

    // --- Group B: the same topic is untouched, because usage is per group ---
    await createGroupThroughWizard(owner.page, `Reuse B ${runId}`)
    await expect(owner.page).toHaveURL(/\/group\/.+/)
    const groupB = owner.page.url().split('/group/')[1]

    await mate.page.goto(`/group/${groupB}?join=true`)
    await expect(mate.page.locator('.group-info-card')).toBeVisible()

    await startRoundAsHost(owner.page, { pickPlayer: 'Reuse Owner' })
    await owner.page.getByRole('button', { name: 'Round', exact: true }).click()

    const inGroupB = owner.page.locator('.topic-option').filter({ hasText: topicText })
    await expect(inGroupB).toBeVisible()
    await expect(inGroupB).not.toHaveClass(/used/)
    await expect(inGroupB).not.toContainText('Already played here')

    await owner.context.close()
    await mate.context.close()
  })

  test("the personal library shows only your own topics, even public ones from others", async ({ browser }) => {
    const runId = testRunId()
    const owner = await newPlayer(browser, { id: `lib-own-${runId}`, name: 'Library Owner' })
    const stranger = await newPlayer(browser, { id: `lib-stranger-${runId}`, name: 'Unrelated Stranger' })

    const myPrivate = `My private ${runId}`
    const myShared = `My shared ${runId}`
    const theirShared = `Their shared ${runId}`
    const theirPrivate = `Their private ${runId}`

    await addTopicToLibrary(owner.page, myPrivate)
    await addTopicToLibrary(owner.page, myShared, { share: true })
    await addTopicToLibrary(stranger.page, theirShared, { share: true })
    await addTopicToLibrary(stranger.page, theirPrivate)

    // The library is strictly your own: both of yours, neither of theirs.
    // "Public" means "offer this to people I play with", not "publish to the
    // whole app" — sharing happens through a group, never globally.
    await owner.page.goto('/topics')
    await expect(owner.page.getByText(myPrivate)).toBeVisible()
    await expect(owner.page.getByText(myShared)).toBeVisible()
    await expect(owner.page.getByText(theirShared)).toHaveCount(0)
    await expect(owner.page.getByText(theirPrivate)).toHaveCount(0)

    // Symmetric: the stranger's library is equally free of the owner's.
    await stranger.page.goto('/topics')
    await expect(stranger.page.getByText(theirShared)).toBeVisible()
    await expect(stranger.page.getByText(myShared)).toHaveCount(0)

    // A shared group is the only route between them. Once they play together,
    // the stranger's shared topic appears in the group picker — but still not
    // in the library view.
    await createGroupThroughWizard(owner.page, `Shared Route ${runId}`)
    await expect(owner.page).toHaveURL(/\/group\/.+/)
    const groupId = owner.page.url().split('/group/')[1]

    await stranger.page.goto(`/group/${groupId}?join=true`)
    await expect(stranger.page.locator('.group-info-card')).toBeVisible()

    await startRoundAsHost(owner.page, { pickPlayer: 'Library Owner' })
    await owner.page.getByRole('button', { name: 'Round', exact: true }).click()

    const picker = owner.page.locator('.topic-picker')
    await expect(picker).toBeVisible()
    await expect(picker.getByText(theirShared)).toBeVisible()
    await expect(picker.getByText(theirPrivate)).toHaveCount(0)

    await owner.page.goto('/topics')
    await expect(owner.page.getByText(theirShared)).toHaveCount(0)

    await owner.context.close()
    await stranger.context.close()
  })

  test('public topics reach groupmates; private ones do not', async ({ browser }) => {
    const runId = testRunId()
    const host = await newPlayer(browser, { id: `share-host-${runId}`, name: 'Sharing Host' })
    const mate = await newPlayer(browser, { id: `share-mate-${runId}`, name: 'Group Mate' })

    const sharedText = `Public topic ${runId}`
    const secretText = `Private topic ${runId}`
    await addTopicToLibrary(mate.page, sharedText, { share: true })
    await addTopicToLibrary(mate.page, secretText)

    await createGroupThroughWizard(host.page, `Share Group ${runId}`)
    await expect(host.page).toHaveURL(/\/group\/.+/)
    const groupId = host.page.url().split('/group/')[1]

    await mate.page.goto(`/group/${groupId}?join=true`)
    await expect(mate.page.locator('.group-info-card')).toBeVisible()

    // Force the host to be the Judge so the picker is theirs, by starting the
    // group while they are the only other member (assignment is random, so
    // the assertion below is on content, not on who was chosen).
    await startRoundAsHost(host.page)
    for (const p of [host, mate]) {
      await p.page.getByRole('button', { name: 'Round', exact: true }).click()
    }
    const judge = [host, mate][await waitForJudgeIndex([host.page, mate.page])]
    const picker = judge.page.locator('.topic-picker')
    await expect(picker).toBeVisible()

    if (judge === host) {
      // A groupmate's shared topic is offered; their private one is not.
      await expect(picker.getByText(sharedText)).toBeVisible()
      await expect(picker.getByText(secretText)).toHaveCount(0)
      await expect(picker.locator('.topic-option').filter({ hasText: sharedText }))
        .toContainText('Shared by Group Mate')
    } else {
      // The owner sees both of their own.
      await expect(picker.getByText(sharedText)).toBeVisible()
      await expect(picker.getByText(secretText)).toBeVisible()
    }

    await host.context.close()
    await mate.context.close()
  })

  test('a group with no topics lets the Judge write one instead of starting blank', async ({ page, context, browser }) => {
    const runId = testRunId()
    await seedTestUser(context, { id: `blank-${runId}`, name: 'Blank Host' })

    await createGroupThroughWizard(page, `Blank Group ${runId}`)
    await expect(page).toHaveURL(/\/group\/.+/)
    const groupId = page.url().split('/group/')[1]
    const filler = await addFillerPlayer(browser, groupId, { id: `blank-fill-${runId}`, name: 'Filler Two' })

    await startRoundAsHost(page, { pickPlayer: 'Blank Host' })
    await page.getByRole('button', { name: 'Round', exact: true }).click()

    // The round waits rather than silently playing a placeholder topic.
    const picker = page.locator('.topic-picker')
    await expect(picker).toBeVisible()
    await expect(picker.getByText("You don't have any topics yet")).toBeVisible()
    await expect(page.getByText('Phase 1 of 3')).toHaveCount(0)

    const written = `Written on the spot ${runId}`
    await selectTopicAsJudge(page, written)

    // Chosen topic becomes the round's title, and submissions open.
    await expect(page.getByText('Phase 1 of 3')).toBeVisible()
    await expect(page.getByText(written)).toBeVisible()

    // It also lands in the personal library for reuse.
    await page.goto('/topics')
    await expect(page.getByText(written)).toBeVisible()

    await filler.context.close()
  })
})
