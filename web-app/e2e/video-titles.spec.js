import { test, expect } from '@playwright/test'
import { createGroupThroughWizard, seedTestUser, testRunId, selectTopicAsJudge, waitForJudgeIndex } from './helpers.js'

// The YouTube Data API returns snippet text HTML-escaped, so a video really
// titled  Smash Mouth - "All Star" (Steve's Remix) & More  arrives as
//   Smash Mouth - &quot;All Star&quot; (Steve&#39;s Remix) &amp; More
// and React, correctly refusing to interpret markup in a text node, printed
// those entities on screen verbatim.
//
// server/youtube.js now decodes at the API boundary, before the result is
// cached, so every surface downstream — search, the selected-video
// confirmation, the round's video list, voting, the reveal, history — is fed
// the same already-clean string. These tests assert the decoded characters,
// and equally that the raw entity text is nowhere on the page: a half-decoded
// title would still satisfy a substring check on its own.

// Matches the entity-bearing fixture in server/youtube.js.
const RAW = 'Smash Mouth - &quot;All Star&quot; (Steve&#39;s Remix) &amp; More'
const DECODED = 'Smash Mouth - "All Star" (Steve\'s Remix) & More'
const DECODED_CHANNEL = 'Smash Mouth & Friends'

/** Fails if any entity from the raw fixture survived anywhere on the page. */
async function expectNoRawEntities(page, where) {
  const body = await page.locator('body').innerText()
  for (const entity of ['&quot;', '&#39;', '&amp;']) {
    expect(body, `${where}: undecoded "${entity}" is showing on screen`).not.toContain(entity)
  }
  expect(body, `${where}: the raw escaped title is showing on screen`).not.toContain(RAW)
}

test.describe('YouTube titles render decoded, not as HTML entities', () => {
  test('search results and the selected-video confirmation', async ({ page, context }) => {
    const runId = testRunId()
    await seedTestUser(context, { id: `ent-search-${runId}`, name: 'Entity Tester' })

    // The search UI only exists inside a running round's submit modal, so a
    // second member is needed before the round can start.
    await createGroupThroughWizard(page, `Entity Group ${runId}`)
    await expect(page).toHaveURL(/\/group\/.+/)
    const groupId = page.url().split('/group/')[1]

    const guestContext = await context.browser().newContext()
    await seedTestUser(guestContext, { id: `ent-search2-${runId}`, name: 'Second Player' })
    const guest = await guestContext.newPage()
    await guest.goto(`/group/${groupId}?join=true`)
    await expect(guest.locator('.group-info-card')).toBeVisible()

    await page.getByRole('button', { name: 'Start Group' }).click()
    await page.getByRole('dialog').getByRole('button', { name: /Randomly Assign/ }).click()

    const pages = [page, guest]
    for (const p of pages) await p.getByRole('button', { name: 'Round', exact: true }).click()
    const judgeIndex = await waitForJudgeIndex(pages)
    await selectTopicAsJudge(pages[judgeIndex])

    const contestant = pages[1 - judgeIndex]
    await contestant.getByRole('button', { name: 'Submit Video' }).click()
    const dialog = contestant.getByRole('dialog')
    await dialog.getByLabel('Search for a video').fill('all star')

    // 1. The search results list.
    const result = dialog.locator('.youtube-result-title', { hasText: 'All Star' }).first()
    await expect(result).toBeVisible({ timeout: 15_000 })
    await expect(result).toHaveText(DECODED)
    await expect(dialog.getByText(DECODED_CHANNEL)).toBeVisible()
    await expectNoRawEntities(contestant, 'search results')

    // 2. The selected-video confirmation. It renders alongside the still-open
    // result list, so assert every title in the dialog rather than one.
    await result.click()
    await expect(dialog.getByText('Your pick')).toBeVisible()
    const titles = dialog.locator('.youtube-result-title')
    expect(await titles.count()).toBeGreaterThan(1)
    for (const title of await titles.all()) {
      await expect(title).toHaveText(DECODED)
    }
    await expectNoRawEntities(contestant, 'selected-video confirmation')

    await guestContext.close()
  })

  test("this round's videos list, after submission", async ({ browser }) => {
    const runId = testRunId()
    const players = []
    for (const name of ['Host', 'Second', 'Third']) {
      const ctx = await browser.newContext()
      await seedTestUser(ctx, { id: `ent-list-${name}-${runId}`, name: `${name} Player` })
      players.push({ ctx, page: await ctx.newPage() })
    }
    const [host] = players

    await createGroupThroughWizard(host.page, `Entity List ${runId}`)
    await expect(host.page).toHaveURL(/\/group\/.+/)
    const groupId = host.page.url().split('/group/')[1]

    for (const p of players.slice(1)) {
      await p.page.goto(`/group/${groupId}?join=true`)
      await expect(p.page.locator('.group-info-card')).toBeVisible()
    }
    await expect(host.page.getByText('3 players')).toBeVisible()

    await host.page.getByRole('button', { name: 'Start Group' }).click()
    await host.page.getByRole('dialog').getByRole('button', { name: /Randomly Assign/ }).click()

    const pages = players.map((p) => p.page)
    for (const p of pages) await p.getByRole('button', { name: 'Round', exact: true }).click()
    const judgeIndex = await waitForJudgeIndex(pages)
    await selectTopicAsJudge(pages[judgeIndex])

    // Both contestants submit the entity-bearing video, so the round list is
    // populated on every player's screen.
    for (const [i, p] of pages.entries()) {
      if (i === judgeIndex) continue
      await p.getByRole('button', { name: 'Submit Video' }).click()
      const dialog = p.getByRole('dialog')
      await dialog.getByLabel('Search for a video').fill('all star')
      const result = dialog.locator('.youtube-result-title', { hasText: 'All Star' }).first()
      await expect(result).toBeVisible({ timeout: 15_000 })
      await result.click()
      await dialog.getByRole('button', { name: 'Submit Video', exact: true }).click()
      await expect(p.getByRole('dialog')).toHaveCount(0)
    }

    // The list is server-broadcast, so check it on the Judge's screen too —
    // that is the copy that made the round trip through submit_video rather
    // than the local one the submitter already had in hand.
    for (const p of pages) {
      const titles = p.locator('.round-video-title')
      await expect(titles.first()).toBeVisible({ timeout: 15_000 })
      for (const title of await titles.all()) {
        await expect(title).toHaveText(DECODED)
      }
      await expectNoRawEntities(p, "this round's videos")
    }

    for (const p of players) await p.ctx.close()
  })
})
