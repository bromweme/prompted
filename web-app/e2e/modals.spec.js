import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { auditVisible, auditHover, auditFocus } from './a11y-audit.js'
import {
  createGroupThroughWizard,
  seedTestUser,
  testRunId,
  selectTopicAsJudge,
  waitForJudgeIndex,
  joinGroupAs,
} from './helpers.js'

// Every modal in the app, opened and checked three ways:
//   - axe (WCAG 2.1 A/AA)          — labels, roles, focus order, text contrast
//   - the resting visibility audit — controls with no fill at all
//   - the hover audit              — labels that vanish on :hover
//
// Modals are the highest-risk surface for the invisible-control class of bug:
// they sit on a white panel, so a control that loses its fill has nothing
// behind it to show an edge against, and several of these were styled long
// before anything actually rendered them.

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

function reportViolations(violations) {
  if (violations.length === 0) return ''
  return violations
    .map((v) => `\n[${v.impact}] ${v.id} — ${v.help}\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
    .join('\n')
}

/** axe + both visual audits against whatever modal is currently open. */
async function scanOpenModal(page, name) {
  await expect(page.getByRole('dialog')).toBeVisible()

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  expect(results.violations, `axe on ${name}:${reportViolations(results.violations)}`).toEqual([])

  await auditVisible(page, `${name} (modal)`)
  await auditHover(page, `${name} (modal)`)
  // Focus matters most in a modal: it is where focus is trapped, so a
  // control with no visible ring leaves a keyboard user stuck with no idea
  // where they are.
  await auditFocus(page, `${name} (modal)`)
}

// Run in both colour schemes. The hover audit is the reason this matters: a
// :hover rule that repaints a background without re-asserting the text colour
// fails differently in each theme, and dark mode redefines every colour the
// hover states are built from.
for (const colorScheme of ['light', 'dark']) {
  test.describe(`modal accessibility — ${colorScheme}`, () => {
    test.use({ colorScheme })
    test('first-time profile setup modal', async ({ page, context }) => {
      // avatar: null is what makes the server treat this as a first sign-in.
      await seedTestUser(context, { id: `modal-setup-${testRunId()}`, name: 'Modal Tester', avatar: null })
      await page.goto('/dashboard')
      await scanOpenModal(page, 'profile setup')
    })

    test('dashboard join-group modal', async ({ page, context }) => {
      await seedTestUser(context, { id: `modal-join-${testRunId()}`, name: 'Modal Tester' })
      await page.goto('/dashboard')
      await page.getByRole('button', { name: 'Join existing group' }).click()
      await scanOpenModal(page, 'join group')
    })

    // The delete-account modal (PRIV-1). Worth its own scan: it is the only
    // modal with a destructive primary action, and it is the one a player is
    // most likely to be reading carefully.
    test('delete account modal', async ({ page, context }) => {
      await seedTestUser(context, { id: `modal-del-${testRunId()}`, name: 'Modal Tester' })
      await page.goto('/account')
      await page.getByRole('button', { name: 'Settings', exact: true }).click()
      await page.getByRole('button', { name: 'Delete Account' }).click()
      await scanOpenModal(page, 'delete account')

      // Again with the confirmation typed, because that is when the
      // destructive button becomes enabled and its colours actually apply.
      await page.getByLabel(/Type DELETE to confirm/).fill('DELETE')
      await expect(page.getByRole('button', { name: 'Delete my account' })).toBeEnabled()
      await scanOpenModal(page, 'delete account (armed)')
    })

    test('topic library add and edit modals', async ({ page, context }) => {
      const runId = testRunId()
      await seedTestUser(context, { id: `modal-topic-${runId}`, name: 'Modal Tester' })
      await page.goto('/topics')

      await page.getByRole('button', { name: 'Add new theme idea' }).click()
      await scanOpenModal(page, 'add topic')

      // Save one, then reopen it through Edit — a different code path.
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('textbox').first().fill(`Modal topic ${runId}`)
      await dialog.getByRole('button', { name: /Add Theme|Save/ }).click()
      await expect(page.getByText(`Modal topic ${runId}`)).toBeVisible({ timeout: 15_000 })

      await page.locator('.action-button.edit').first().click()
      await scanOpenModal(page, 'edit topic')
    })

    test('group invite, Judge selection and player pick modals', async ({ browser }) => {
      const runId = testRunId()
      const host = await browser.newContext()
      await seedTestUser(host, { id: `modal-grp-${runId}`, name: 'Modal Tester' })
      const page = await host.newPage()

      await createGroupThroughWizard(page, `Modal Group ${runId}`)
      await expect(page).toHaveURL(/\/group\/.+/)

      await page.getByRole('button', { name: 'Invite players to group' }).click()
      await scanOpenModal(page, 'invite players')
      await page.keyboard.press('Escape')

      // A second member: Start Round stays disabled below two, so without one
      // the Judge modals are unreachable.
      const guest = await browser.newContext()
      await seedTestUser(guest, { id: `modal-grp2-${runId}`, name: 'Second Player' })
      const guestPage = await guest.newPage()
      await joinGroupAs(guestPage, page, 2)

      await page.getByRole('button', { name: 'Start Round', exact: true }).click()
      await scanOpenModal(page, 'select Judge')

      await page.getByRole('button', { name: /Pick Judge/ }).click()
      await scanOpenModal(page, 'pick Judge')

      await host.close()
      await guest.close()
    })

    test('submit video modal, mid-round', async ({ browser }) => {
      const runId = testRunId()
      const players = []
      for (const name of ['Host', 'Second']) {
        const context = await browser.newContext()
        await seedTestUser(context, { id: `modal-round-${name}-${runId}`, name: `${name} Player` })
        players.push({ context, page: await context.newPage() })
      }
      const [host, second] = players

      await createGroupThroughWizard(host.page, `Modal Round ${runId}`)
      await expect(host.page).toHaveURL(/\/group\/.+/)

      await joinGroupAs(second.page, host.page, 2)

      await host.page.getByRole('button', { name: 'Start Round', exact: true }).click()
      await host.page.getByRole('dialog').getByRole('button', { name: /Randomly Assign/ }).click()
      for (const p of players) await p.page.getByRole('button', { name: 'Round', exact: true }).click()

      const judgeIndex = await waitForJudgeIndex(players.map((p) => p.page))
      await selectTopicAsJudge(players[judgeIndex].page)

      // Only the contestant gets a Submit Video control.
      const contestant = players[1 - judgeIndex]
      await contestant.page.getByRole('button', { name: 'Submit Video' }).click()
      await scanOpenModal(contestant.page, 'submit video')

      // With a search result chosen, so the confirmation block is scanned too.
      const dialog = contestant.page.getByRole('dialog')
      await dialog.getByLabel('Search for a video').fill('queen')
      const firstResult = dialog.getByRole('button', { name: /.+/ })
        .filter({ has: contestant.page.locator('img') }).first()
      await expect(firstResult).toBeVisible({ timeout: 15_000 })
      await firstResult.click()
      await scanOpenModal(contestant.page, 'submit video (result selected)')

      for (const p of players) await p.context.close()
    })
  })
}
