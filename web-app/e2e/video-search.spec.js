import { test, expect } from '@playwright/test'
import {
  createGroupThroughWizard, seedTestUser, selectTopicAsJudge, startRoundAsHost,
  testRunId, waitForJudgeIndex, inviteJoinPath
} from './helpers.js'

// Finding a video to submit.
//
// These searches deliberately use capital letters. The client compared the
// server's echoed query against a lowercased copy of what it had sent, so
// every search containing a capital letter had its results thrown away and
// looked as though it had found nothing — "love" worked, "Metallica" did not.
// The rest of the suite searches "queen", in lowercase, which is why nothing
// caught it.

async function newPlayer(browser, { id, name }) {
  const context = await browser.newContext()
  await seedTestUser(context, { id, name })
  const page = await context.newPage()
  return { context, page, name }
}

/** Two players, a started round, and the submitter's Submit Video modal open. */
async function openSubmitModal(browser, runId) {
  const host = await newPlayer(browser, { id: `vs-host-${runId}`, name: 'Search Host' })
  const guest = await newPlayer(browser, { id: `vs-guest-${runId}`, name: 'Search Guest' })

  await createGroupThroughWizard(host.page, `Video Search ${runId}`)
  await expect(host.page).toHaveURL(/\/group\/.+/)
  await guest.page.goto(await inviteJoinPath(host.page))
  await expect(guest.page.locator('.group-info-card')).toBeVisible()
  await expect(host.page.getByText('2 players')).toBeVisible()

  await startRoundAsHost(host.page)

  const all = [host, guest]
  for (const p of all) await p.page.getByRole('button', { name: 'Round', exact: true }).click()
  const leaderIndex = await waitForJudgeIndex(all.map((p) => p.page))
  const leader = all[leaderIndex]
  const submitter = all[1 - leaderIndex]

  await selectTopicAsJudge(leader.page)
  await submitter.page.getByRole('button', { name: 'Submit Video' }).click()
  const dialog = submitter.page.getByRole('dialog')
  await expect(dialog.getByLabel('Search for a video')).toBeVisible()

  return { dialog, submitter, close: async () => {
    await host.context.close()
    await guest.context.close()
  } }
}

test.describe('finding a video', () => {
  test('a search with capital letters shows its results', async ({ browser }) => {
    const runId = testRunId()
    const { dialog, close } = await openSubmitModal(browser, runId)

    await dialog.getByLabel('Search for a video').fill('Queen')

    const results = dialog.getByRole('list', { name: 'Video search results' })
    await expect(results).toBeVisible({ timeout: 15_000 })
    await expect(results.getByRole('button').first()).toBeVisible()
    await expect(dialog.getByText('we are unable to find that video')).toHaveCount(0)

    await close()
  })

  test('a pasted YouTube link resolves to that one video', async ({ browser }) => {
    const runId = testRunId()
    const { dialog, close } = await openSubmitModal(browser, runId)

    // A link says "this exact one", which is the answer when search can't find
    // it. Mixed case in the id matters: lowercasing it anywhere would resolve
    // to a different video, or to none.
    await dialog.getByLabel('Search for a video').fill('https://www.youtube.com/watch?v=L_jWHffIx5E&t=42s')

    const results = dialog.getByRole('list', { name: 'Video search results' })
    await expect(results).toBeVisible({ timeout: 15_000 })
    await expect(results.getByRole('listitem')).toHaveCount(1)
    await expect(results.getByText('All Star')).toBeVisible()

    // And it can be submitted like any other result.
    await results.getByRole('button').first().click()
    await dialog.getByRole('button', { name: 'Submit Video', exact: true }).click()
    await expect(dialog).toHaveCount(0)

    await close()
  })

  test('a youtu.be share link works too', async ({ browser }) => {
    const runId = testRunId()
    const { dialog, close } = await openSubmitModal(browser, runId)

    await dialog.getByLabel('Search for a video').fill('https://youtu.be/fJ9rUzIMcZQ')

    const results = dialog.getByRole('list', { name: 'Video search results' })
    await expect(results).toBeVisible({ timeout: 15_000 })
    await expect(results.getByRole('listitem')).toHaveCount(1)
    await expect(results.getByText('Bohemian Rhapsody')).toBeVisible()

    await close()
  })
})
