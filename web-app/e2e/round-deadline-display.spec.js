import { test, expect } from '@playwright/test'
import { createGroupThroughWizard, seedTestUser, selectTopicAsJudge, startRoundAsHost, testRunId, joinGroupAs } from './helpers.js'

// RT-4: a round in its topic_selection phase has no deadline yet — the server
// sets currentTheme.deadline only when the Judge picks a topic. The Overview
// and Round tabs used to format that null with `new Date(null)`, rendering the
// Unix epoch (a ~1970 date, and a large negative "hours" value). They must show
// a plain placeholder until the submission clock starts, then the real values.

async function newPlayer(browser, id, name) {
  const context = await browser.newContext()
  await seedTestUser(context, { id, name })
  const page = await context.newPage()
  return { context, page }
}

test('deadline readouts show a placeholder before a topic is picked, real values after', async ({ browser }) => {
  const runId = testRunId()
  const hostName = 'Deadline Display Host'
  const host = await newPlayer(browser, `dl-disp-${runId}`, hostName)
  const second = await newPlayer(browser, `dl-disp2-${runId}`, 'Deadline Display Two')
  const { page } = host

  try {
    await createGroupThroughWizard(page, `Deadline Display ${runId}`)
    await expect(page).toHaveURL(/\/group\/.+/)

    // A second member is needed only so the host's Start control is enabled
    // (the UI needs one judge + one submitter).
    await joinGroupAs(second.page, page, 2)

    // Hand the Judge role to the host so this page shows the topic picker and
    // can pick the topic. The round opens in topic_selection with deadline null.
    await startRoundAsHost(page, { pickPlayer: hostName })

    const roundDeadline = page
      .locator('.round-stat', { has: page.getByText('Deadline', { exact: true }) })
      .locator('.stat-value')
    const overviewDeadline = page
      .locator('.theme-stat', { has: page.getByText('Deadline', { exact: true }) })
      .locator('.stat-value')
    const timeRemaining = page
      .locator('.stat-card', { has: page.getByRole('heading', { name: 'Time Remaining' }) })
      .locator('p')

    // --- topic_selection: all three readouts are the placeholder ---
    await page.getByRole('button', { name: 'Round', exact: true }).click()
    await expect(page.locator('.topic-picker')).toBeVisible()
    await expect(roundDeadline).toHaveText('Not set yet')
    await expect(roundDeadline).not.toContainText('1970')
    await expect(roundDeadline).not.toContainText('1969')

    await page.getByRole('button', { name: 'Overview', exact: true }).click()
    await expect(overviewDeadline).toHaveText('Not set yet')
    await expect(timeRemaining).toHaveText('Not set yet')
    // The old bug produced "-<big number> hours"; guard against any negative.
    await expect(timeRemaining).not.toContainText('-')

    // --- pick a topic: submission clock starts, real deadline appears ---
    await page.getByRole('button', { name: 'Round', exact: true }).click()
    await selectTopicAsJudge(page)

    await expect(roundDeadline).not.toHaveText('Not set yet')
    await expect(roundDeadline).toContainText(' at ')
    await expect(roundDeadline).not.toContainText('1970')

    await page.getByRole('button', { name: 'Overview', exact: true }).click()
    await expect(overviewDeadline).not.toHaveText('Not set yet')
    await expect(timeRemaining).toContainText(/\d+ hours/)
  } finally {
    await host.context.close()
    await second.context.close()
  }
})
