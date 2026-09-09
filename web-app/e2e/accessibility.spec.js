import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createGroupThroughWizard, fillGroupName, goToNextWizardStep, seedTestUser, submitVideoThroughSearch, selectTopicAsJudge, waitForJudgeIndex, startRoundAsHost, testRunId } from './helpers.js'

// Automated WCAG 2.1 A/AA scan for the main pages, so accessibility
// regressions get caught the same way the game-loop test catches functional
// ones. Each page gets its own test so a failure on one doesn't hide results
// for the others.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

function reportViolations(violations) {
  if (violations.length === 0) return ''
  return violations
    .map((v) => `\n[${v.impact}] ${v.id} — ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
    .join('\n')
}

test.describe('accessibility (WCAG 2.1 AA)', () => {
  test('Login page has no violations', async ({ page }) => {
    await page.goto('/')
    // Google Identity Services renders its own button, and it is absent
    // without VITE_GOOGLE_CLIENT_ID, so anchor on our own copy instead.
    await expect(page.getByRole('heading', { name: 'Welcome to Prompted' })).toBeVisible()

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, reportViolations(results.violations)).toEqual([])
  })

  test('Dashboard has no violations', async ({ page, context }) => {
    await seedTestUser(context, { id: `a11y-dash-${testRunId()}`, name: 'A11y Tester' })
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, reportViolations(results.violations)).toEqual([])
  })

  test('Dashboard "Join Group" modal has no violations', async ({ page, context }) => {
    await seedTestUser(context, { id: `a11y-dash-modal-${testRunId()}`, name: 'A11y Tester' })
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Join existing group' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, reportViolations(results.violations)).toEqual([])
  })

  test('First-time profile setup modal has no violations', async ({ page, context }) => {
    // avatar: null is what makes the server treat this as a first sign-in.
    await seedTestUser(context, { id: `a11y-setup-${testRunId()}`, name: 'A11y Tester', avatar: null })
    await page.goto('/dashboard')
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Welcome to Prompted!' })).toBeVisible()

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, reportViolations(results.violations)).toEqual([])
  })

  test('Create Group wizard — step 1 (Basics) has no violations', async ({ page, context }) => {
    await seedTestUser(context, { id: `a11y-create-${testRunId()}`, name: 'A11y Tester' })
    await page.goto('/create-group')
    await expect(page.getByRole('heading', { name: 'Create New Group' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Basics', level: 2 })).toBeVisible()
    await expect(page.getByText('Step 1 of 4')).toBeVisible()

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, reportViolations(results.violations)).toEqual([])
  })

  test('Create Group wizard — mid-wizard step (Game Rules) has no violations', async ({ page, context }) => {
    await seedTestUser(context, { id: `a11y-create-mid-${testRunId()}`, name: 'A11y Tester' })
    await page.goto('/create-group')
    await fillGroupName(page, 'A11y Mid-Wizard Group')
    await goToNextWizardStep(page, 'Game Rules')

    await expect(page.getByRole('heading', { name: 'Game Rules', level: 2 })).toBeVisible()
    await expect(page.getByText('Step 2 of 4')).toBeVisible()

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, reportViolations(results.violations)).toEqual([])
  })

  test('Account page has no violations', async ({ page, context }) => {
    await seedTestUser(context, { id: `a11y-account-${testRunId()}`, name: 'A11y Tester' })
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'Account Settings', level: 1 })).toBeVisible()

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, reportViolations(results.violations)).toEqual([])
  })

  test('Round voting phase (with comments enabled) has no violations', async ({ browser }) => {
    const runId = testRunId()
    const players = []
    for (const name of ['Host', 'Second', 'Third']) {
      const context = await browser.newContext()
      await seedTestUser(context, { id: `a11y-round-${name}-${runId}`, name: `${name} Player` })
      players.push({ context, page: await context.newPage() })
    }
    const [host, ...rest] = players

    await createGroupThroughWizard(host.page, `A11y Round ${runId}`)
    await expect(host.page).toHaveURL(/\/group\/.+/)
    const groupId = host.page.url().split('/group/')[1]

    // Comments on, so the voting phase is scanned with its full markup.
    await host.page.getByRole('button', { name: 'Rules', exact: true }).click()
    await host.page.getByRole('button', { name: 'Edit Rules' }).click()
    await host.page.getByRole('checkbox', { name: 'Allow comments during voting' }).check()
    await host.page.getByRole('button', { name: 'Save Changes' }).click()
    await expect(host.page.getByRole('button', { name: 'Edit Rules' })).toBeVisible()
    await host.page.getByRole('button', { name: 'Overview', exact: true }).click()

    for (const p of rest) {
      await p.page.goto(`/group/${groupId}?join=true`)
      await expect(p.page.locator('.group-info-card')).toBeVisible()
    }
    await startRoundAsHost(host.page)

    for (const p of players) await p.page.getByRole('button', { name: 'Round', exact: true }).click()

    const judgeIndex = await waitForJudgeIndex(players.map((p) => p.page))
    await selectTopicAsJudge(players[judgeIndex].page)

    const submitters = players.filter((_, i) => i !== judgeIndex)
    for (const s of submitters) await submitVideoThroughSearch(s.page, 'queen')

    const scanTarget = players[judgeIndex]
    await expect(scanTarget.page.getByText('Phase 2 of 3')).toBeVisible()
    // Select a submission so the vote controls (including the comment field)
    // are on screen for the scan.
    await scanTarget.page.locator('.submission-item:not(.own-submission)').first().click()
    await expect(scanTarget.page.getByLabel('Comment (optional)')).toBeVisible()

    const results = await new AxeBuilder({ page: scanTarget.page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, reportViolations(results.violations)).toEqual([])

    for (const p of players) await p.context.close()
  })

  test('Group view (overview, rules editor, invite modal) has no violations', async ({ page, context }) => {
    const runId = testRunId()
    await seedTestUser(context, { id: `a11y-group-${runId}`, name: 'A11y Tester' })

    await createGroupThroughWizard(page, `A11y Scan Group ${runId}`)
    await expect(page).toHaveURL(/\/group\/.+/)

    // Overview tab (resting state)
    let results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, `Overview tab:${reportViolations(results.violations)}`).toEqual([])

    // Rules tab, edit form open — the largest form in the app
    await page.getByRole('button', { name: 'Rules', exact: true }).click()
    await page.getByRole('button', { name: 'Edit Rules' }).click()
    await expect(page.getByRole('button', { name: 'Save Changes' })).toBeVisible()

    results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, `Rules editor:${reportViolations(results.violations)}`).toEqual([])

    await page.getByRole('button', { name: 'Cancel' }).click()

    // Invite modal open. The invite action now lives in the Overview tab's
    // Group Info card, so go back there first.
    await page.getByRole('button', { name: 'Overview', exact: true }).click()
    await page.getByRole('button', { name: 'Invite players to group' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, `Invite modal:${reportViolations(results.violations)}`).toEqual([])
  })
})
