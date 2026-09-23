import { test, expect } from '@playwright/test'
import { createGroupThroughWizard, seedTestUser, selectTopicAsJudge, startRoundAsHost, testRunId, joinGroupAs } from './helpers.js'

// UI-4: during topic_selection the round has no theme title yet (the server
// sends title: null and a constant description). The Overview card and the
// Round tab used to show "Current Theme", an empty title line, and the
// boilerplate "This round's music challenge" as if a theme were set. They must
// say the theme is being chosen until the Judge picks one, then show
// "Current Theme" and the title. The stat label and value must not run
// together ("SUBMISSIONS0").

const NO_THEME_HEADING = "Choosing This Round's Theme"
const BOILERPLATE = "This round's music challenge"

async function newPlayer(browser, id, name) {
  const context = await browser.newContext()
  await seedTestUser(context, { id, name })
  const page = await context.newPage()
  return { context, page }
}

// The label box must sit above the value box (stacked, not inline).
async function expectStacked(card, statClass, label) {
  const stat = card.locator(statClass, { has: card.page().getByText(label, { exact: true }) })
  const labelBox = await stat.locator('.stat-label').boundingBox()
  const valueBox = await stat.locator('.stat-value').boundingBox()
  expect(labelBox).not.toBeNull()
  expect(valueBox).not.toBeNull()
  expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(valueBox.y + 1)
}

test('theme section says the theme is being chosen until a topic is picked', async ({ browser }) => {
  const runId = testRunId()
  const hostName = 'Theme Heading Host'
  const topicText = `Theme heading topic ${runId}`
  const host = await newPlayer(browser, `th-head-${runId}`, hostName)
  const second = await newPlayer(browser, `th-head2-${runId}`, 'Theme Heading Two')
  const { page } = host

  try {
    await createGroupThroughWizard(page, `Theme Heading ${runId}`)
    await expect(page).toHaveURL(/\/group\/.+/)

    // A second member so the host's Start control is enabled.
    await joinGroupAs(second.page, page, 2)

    await startRoundAsHost(page, { pickPlayer: hostName })

    const overviewCard = page.locator('.current-theme-card')
    const roundCard = page.locator('.round-info-card')

    // --- topic_selection: Overview ---
    await expect(overviewCard).toBeVisible()
    await expect(overviewCard.locator('h3')).toHaveText(NO_THEME_HEADING)
    await expect(overviewCard).not.toContainText('Current Theme')
    await expect(overviewCard).not.toContainText(BOILERPLATE)
    await expect(overviewCard.locator('h4')).toHaveCount(0)
    await expectStacked(overviewCard, '.theme-stat', 'Submissions')
    await expectStacked(overviewCard, '.theme-stat', 'Deadline')

    // --- topic_selection: Round tab ---
    await page.getByRole('button', { name: 'Round', exact: true }).click()
    await expect(page.locator('.topic-picker')).toBeVisible()
    await expect(roundCard.locator('h3')).toHaveText(NO_THEME_HEADING)
    await expect(roundCard).not.toContainText('Current Theme')
    await expect(roundCard).not.toContainText(BOILERPLATE)
    await expect(roundCard.locator('h4')).toHaveCount(0)
    await expectStacked(roundCard, '.round-stat', 'Submissions')
    await expectStacked(roundCard, '.round-stat', 'Deadline')

    // --- pick a topic: the theme is set ---
    await selectTopicAsJudge(page, topicText)

    await expect(roundCard.locator('h3')).toHaveText('Current Theme')
    await expect(roundCard.locator('h4')).toHaveText(topicText)
    await expect(roundCard.locator('.round-description')).toHaveText(BOILERPLATE)
    await expectStacked(roundCard, '.round-stat', 'Deadline')

    await page.getByRole('button', { name: 'Overview', exact: true }).click()
    await expect(overviewCard.locator('h3')).toHaveText('Current Theme')
    await expect(overviewCard.locator('h4')).toHaveText(topicText)
    await expect(overviewCard.locator('.theme-description')).toHaveText(BOILERPLATE)
    await expectStacked(overviewCard, '.theme-stat', 'Submissions')
  } finally {
    await host.context.close()
    await second.context.close()
  }
})
