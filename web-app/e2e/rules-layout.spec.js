import { test, expect } from '@playwright/test'
import { createGroupThroughWizard, fillGroupName, goToNextWizardStep, seedTestUser, testRunId } from './helpers.js'

// UI-1 + UI-7: an unscoped `.form-row input, .form-row select { flex: 1 }` in
// GroupView.css leaked through the global stylesheet bundle and broke two forms
// it was never meant to touch:
//
//  - UI-1: on the Create Group wizard's Timing step the unit <select> inside
//    `.window-control` collapsed to the native chevron (~34px), clipping the
//    "hours" / "minutes" / "days" label.
//  - UI-7: in the Group Rules edit form the same rule stretched every number
//    input to the full row and every `<input type="checkbox">` across the whole
//    row (tick at the far left, label shoved to the far right), and the form
//    itself stacked one section per row.
//
// The fix is CSS only (scope the growth rule to `.group-view-page`, exclude
// checkboxes/radios, bound the rules number fields, lay the edit form out as a
// grid). These are computed-geometry regression checks for all of that.

// A wide viewport so the rules edit form has room to place sections 2+ across.
test.use({ viewport: { width: 1400, height: 1000 } })

async function newPlayer(browser, id, name) {
  const context = await browser.newContext()
  await seedTestUser(context, { id, name })
  const page = await context.newPage()
  return { context, page }
}

test('UI-1: the Create Group timing unit select shows its label, not just the chevron', async ({ page, context }) => {
  await seedTestUser(context, { id: `ui1-${testRunId()}`, name: 'Timing Host' })

  // advanceToFinalWizardStep lands on step 4 (Topics & Extras); the Timing
  // Settings section is on step 3 (Override & Timing), so stop one step short.
  await page.goto('/create-group')
  await fillGroupName(page, `Timing ${testRunId()}`)
  await goToNextWizardStep(page, 'Game Rules')
  await goToNextWizardStep(page, 'Override & Timing')

  const unitSelect = page.getByLabel('Submission length unit')
  await expect(unitSelect).toBeVisible()
  await expect(unitSelect).toHaveValue('hours')

  const numberInput = page.locator('#submission-time')
  await expect(numberInput).toBeVisible()

  const geom = await page.evaluate(() => {
    const sel = document.querySelector('[aria-label="Submission length unit"]')
    const num = document.getElementById('submission-time')
    const control = sel.closest('.window-control')
    return {
      selectWidth: sel.getBoundingClientRect().width,
      selectPadding: parseFloat(getComputedStyle(sel).paddingLeft) + parseFloat(getComputedStyle(sel).paddingRight),
      numberWidth: num.getBoundingClientRect().width,
      controlWidth: control.getBoundingClientRect().width,
    }
  })

  // The bug collapsed this select to ~34px — with 16px of horizontal padding
  // that leaves almost no room for text, so only the native chevron showed.
  // Require it to be comfortably wider than a bare chevron: wide enough that,
  // after its own padding, there is real space for the "hours" label.
  expect(geom.selectWidth).toBeGreaterThan(70)
  expect(geom.selectWidth - geom.selectPadding).toBeGreaterThan(24)
  // The numeric input still fills the rest of the row beside the select.
  expect(geom.numberWidth).toBeGreaterThan(60)
  expect(geom.numberWidth).toBeGreaterThan(geom.selectWidth)
  // Between them the two controls fill the window-control row.
  expect(geom.selectWidth + geom.numberWidth).toBeGreaterThan(geom.controlWidth * 0.8)
})

test('UI-7: the Group Rules edit form bounds its fields, keeps checkboxes small, and lays sections out across', async ({ browser }) => {
  const runId = testRunId()
  const host = await newPlayer(browser, `ui7-host-${runId}`, 'Rules Layout Host')
  const second = await newPlayer(browser, `ui7-two-${runId}`, 'Rules Layout Two')

  try {
    await createGroupThroughWizard(host.page, `Rules Layout ${runId}`)
    await expect(host.page).toHaveURL(/\/group\/.+/)
    const groupId = host.page.url().split('/group/')[1]

    // A second member so the group is a realistic 2-player group (not required
    // for the layout itself, but mirrors how the form is actually used).
    await second.page.goto(`/group/${groupId}?join=true`)
    await expect(second.page.locator('.group-info-card')).toBeVisible()
    await expect(host.page.getByText('2 players')).toBeVisible()

    await host.page.getByRole('button', { name: 'Rules', exact: true }).click()
    await host.page.getByRole('button', { name: 'Edit Rules' }).click()

    const editForm = host.page.locator('.rules-edit-form')
    await expect(editForm).toBeVisible()

    const totalRounds = host.page.locator('#rules-total-rounds')
    await expect(totalRounds).toBeVisible()

    const measures = await host.page.evaluate(() => {
      const num = document.getElementById('rules-total-rounds')
      const numRow = num.closest('.form-row')
      const cb = document.querySelector('.rules-edit-form .form-row.checkbox input[type="checkbox"]')
      const cbLabel = cb.closest('label')
      const sections = [...document.querySelectorAll('.rules-edit-form .rules-section')]
      const actions = document.querySelector('.rules-edit-form .form-actions')
      const form = document.querySelector('.rules-edit-form')
      return {
        numWidth: num.getBoundingClientRect().width,
        numRowWidth: numRow.getBoundingClientRect().width,
        cbWidth: cb.getBoundingClientRect().width,
        cbRight: cb.getBoundingClientRect().right,
        cbLabelLeft: cbLabel.getBoundingClientRect().left,
        sectionTops: sections.map((s) => Math.round(s.getBoundingClientRect().top)),
        sectionCount: sections.length,
        actionsWidth: actions.getBoundingClientRect().width,
        formWidth: form.getBoundingClientRect().width,
      }
    })

    // 1. A rules number field is bounded, not full-bleed.
    expect(measures.numWidth).toBeLessThan(300)
    expect(measures.numWidth).toBeLessThan(measures.numRowWidth * 0.6)

    // 2. A rules checkbox keeps its intrinsic ~18px box and sits at the left of
    //    its label rather than being stretched across the row.
    expect(measures.cbWidth).toBeLessThan(40)
    expect(measures.cbRight - measures.cbLabelLeft).toBeLessThan(40)

    // 3. Sections lay out 2+ across on a wide viewport: at least two share a top.
    const topCounts = measures.sectionTops.reduce((acc, t) => {
      acc[t] = (acc[t] || 0) + 1
      return acc
    }, {})
    const widestRow = Math.max(...Object.values(topCounts))
    expect(widestRow).toBeGreaterThanOrEqual(2)

    // 4. The Save / Cancel row spans the full grid width.
    expect(measures.actionsWidth).toBeGreaterThan(measures.formWidth * 0.9)
  } finally {
    await host.context.close()
    await second.context.close()
  }
})
