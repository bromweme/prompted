import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { createGroupThroughWizard, fillGroupName, goToNextWizardStep } from './helpers.js'

// Automated WCAG 2.1 A/AA scan for the main pages, so accessibility
// regressions get caught the same way the game-loop test catches functional
// ones. Each page gets its own test so a failure on one doesn't hide results
// for the others.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

async function seedUser(context, { id, name }) {
  await context.addInitScript((user) => {
    window.localStorage.setItem('user', JSON.stringify(user))
  }, { id, name, email: `${id}@example.com`, avatar: '🎵', bio: '', location: '' })
}

function reportViolations(violations) {
  if (violations.length === 0) return ''
  return violations
    .map((v) => `\n[${v.impact}] ${v.id} — ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
    .join('\n')
}

test.describe('accessibility (WCAG 2.1 AA)', () => {
  test('Login page has no violations', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'Login with Spotify' })).toBeVisible()

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, reportViolations(results.violations)).toEqual([])
  })

  test('Dashboard has no violations', async ({ page, context }) => {
    await seedUser(context, { id: `a11y-dash-${Date.now()}`, name: 'A11y Tester' })
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, reportViolations(results.violations)).toEqual([])
  })

  test('Dashboard "Join Group" modal has no violations', async ({ page, context }) => {
    await seedUser(context, { id: `a11y-dash-modal-${Date.now()}`, name: 'A11y Tester' })
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Join existing group' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, reportViolations(results.violations)).toEqual([])
  })

  test('Create Group wizard — step 1 (Basics) has no violations', async ({ page, context }) => {
    await seedUser(context, { id: `a11y-create-${Date.now()}`, name: 'A11y Tester' })
    await page.goto('/create-group')
    await expect(page.getByRole('heading', { name: 'Create New Group' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Basics', level: 2 })).toBeVisible()
    await expect(page.getByText('Step 1 of 4')).toBeVisible()

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, reportViolations(results.violations)).toEqual([])
  })

  test('Create Group wizard — mid-wizard step (Game Rules) has no violations', async ({ page, context }) => {
    await seedUser(context, { id: `a11y-create-mid-${Date.now()}`, name: 'A11y Tester' })
    await page.goto('/create-group')
    await fillGroupName(page, 'A11y Mid-Wizard Group')
    await goToNextWizardStep(page, 'Game Rules')

    await expect(page.getByRole('heading', { name: 'Game Rules', level: 2 })).toBeVisible()
    await expect(page.getByText('Step 2 of 4')).toBeVisible()

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, reportViolations(results.violations)).toEqual([])
  })

  test('Account page has no violations', async ({ page, context }) => {
    await seedUser(context, { id: `a11y-account-${Date.now()}`, name: 'A11y Tester' })
    await page.goto('/account')
    await expect(page.getByRole('heading', { name: 'Account Settings', level: 1 })).toBeVisible()

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, reportViolations(results.violations)).toEqual([])
  })

  test('Group view (overview, rules editor, invite modal) has no violations', async ({ page, context }) => {
    const runId = Date.now()
    await seedUser(context, { id: `a11y-group-${runId}`, name: 'A11y Tester' })

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

    // Invite modal open
    await page.getByRole('button', { name: 'Invite players to group' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()

    results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations, `Invite modal:${reportViolations(results.violations)}`).toEqual([])
  })
})
