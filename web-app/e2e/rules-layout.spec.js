import { test, expect } from '@playwright/test'
import { createGroupThroughWizard, fillGroupName, goToNextWizardStep, seedTestUser, testRunId, inviteJoinPath } from './helpers.js'

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

// REP-UI7-1: the original UI-7 assertions (`numWidth < 300`,
// `numWidth < numRowWidth * 0.6`) pass even while the row overflows its
// section — a squeezed, overflowing ~155px input in an overflowing ~356px
// row satisfies both. This helper pulls the computed geometry needed to
// actually catch that: overflow, section-overlap, and row-containment.
async function measureRulesLayout(page) {
  return page.evaluate(() => {
    function contentBoxRight(el) {
      const rect = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return rect.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth)
    }

    const num = document.getElementById('rules-total-rounds')
    const numRow = num.closest('.form-row')
    const cb = document.querySelector('.rules-edit-form .form-row.checkbox input[type="checkbox"]')
    const cbLabel = cb.closest('label')
    const sections = [...document.querySelectorAll('.rules-edit-form .rules-section')]
    const actions = document.querySelector('.rules-edit-form .form-actions')
    const form = document.querySelector('.rules-edit-form')
    const mainContent = document.querySelector('.group-main-content')
    const timingNum = document.getElementById('rules-submission-time')
    const timingRow = timingNum.closest('.form-row')

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

      formScrollWidth: form.scrollWidth,
      formClientWidth: form.clientWidth,
      mainScrollWidth: mainContent.scrollWidth,
      mainClientWidth: mainContent.clientWidth,

      sectionRects: sections.map((s) => {
        const r = s.getBoundingClientRect()
        return { top: r.top, left: r.left, right: r.right, bottom: r.bottom }
      }),

      numRowRight: numRow.getBoundingClientRect().right,
      numSectionContentRight: contentBoxRight(num.closest('.rules-section')),

      timingNumWidth: timingNum.getBoundingClientRect().width,
      timingRowRight: timingRow.getBoundingClientRect().right,
      timingSectionContentRight: contentBoxRight(timingNum.closest('.rules-section')),
    }
  })
}

// Two rects overlap iff their horizontal AND vertical ranges both intersect.
// A small epsilon absorbs the sub-pixel jitter of adjacent (gap-separated,
// not touching) grid cells without masking a real overlap.
function rectsOverlap(a, b, eps = 1) {
  const noHorizontalOverlap = a.right <= b.left + eps || b.right <= a.left + eps
  const noVerticalOverlap = a.bottom <= b.top + eps || b.bottom <= a.top + eps
  return !(noHorizontalOverlap || noVerticalOverlap)
}

function assertNoSectionOverlap(sectionRects) {
  for (let i = 0; i < sectionRects.length; i++) {
    for (let j = i + 1; j < sectionRects.length; j++) {
      expect(rectsOverlap(sectionRects[i], sectionRects[j])).toBe(false)
    }
  }
}

// Shared assertions for REP-UI7-1: no horizontal overflow of the form or its
// scroll container, no two sections overlapping, the numeric and Timing rows
// stay inside their section's content box, and the Timing number input keeps
// a genuinely usable width (matching UI-1's own >60px chevron-vs-label
// threshold). Called at more than one viewport so the defect — which
// reproduced at 1400px, 1920px and 2560px alike, since the old fixed 300px
// track floor never widened to fit — can't hide at just one width.
function assertNoOverflowOrOverlap(measures) {
  const OVERFLOW_TOLERANCE = 2
  expect(measures.formScrollWidth).toBeLessThanOrEqual(measures.formClientWidth + OVERFLOW_TOLERANCE)
  expect(measures.mainScrollWidth).toBeLessThanOrEqual(measures.mainClientWidth + OVERFLOW_TOLERANCE)

  assertNoSectionOverlap(measures.sectionRects)

  const CONTAINMENT_TOLERANCE = 2
  expect(measures.numRowRight).toBeLessThanOrEqual(measures.numSectionContentRight + CONTAINMENT_TOLERANCE)
  expect(measures.timingRowRight).toBeLessThanOrEqual(measures.timingSectionContentRight + CONTAINMENT_TOLERANCE)

  expect(measures.timingNumWidth).toBeGreaterThan(60)
}

test('UI-1: the Create Group timing unit select shows its label, not just the chevron', async ({ page, context }) => {
  await seedTestUser(context, { id: `ui1-${testRunId()}`, name: 'Timing Host' })

  // advanceToFinalWizardStep lands on step 4 (Extras); the Timing
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

    // A second member so the group is a realistic 2-player group (not required
    // for the layout itself, but mirrors how the form is actually used).
    await second.page.goto(await inviteJoinPath(host.page))
    await expect(second.page.locator('.group-info-card')).toBeVisible()
    await expect(host.page.getByText('2 players')).toBeVisible()

    await host.page.getByRole('button', { name: 'Rules', exact: true }).click()
    await host.page.getByRole('button', { name: 'Edit Rules' }).click()

    const editForm = host.page.locator('.rules-edit-form')
    await expect(editForm).toBeVisible()

    const totalRounds = host.page.locator('#rules-total-rounds')
    await expect(totalRounds).toBeVisible()

    const measures = await measureRulesLayout(host.page)

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

    // 5. REP-UI7-1: no horizontal overflow, no overlapping sections, every
    //    row stays inside its section, and the Timing number input is usable.
    //    (This is the check that the original numWidth-only assertions above
    //    missed: a squeezed, overflowing input in an overflowing row still
    //    satisfied both of them.)
    assertNoOverflowOrOverlap(measures)

    // 6. REP-UI7-1: re-check at a second, wider viewport — the old fixed
    //    300px track floor reproduced the overflow at 1400px, 1920px and
    //    2560px alike, so a single width isn't enough to prove the fix.
    await host.page.setViewportSize({ width: 1920, height: 1080 })
    const wideMeasures = await measureRulesLayout(host.page)
    assertNoOverflowOrOverlap(wideMeasures)
    const wideTopCounts = wideMeasures.sectionTops.reduce((acc, t) => {
      acc[t] = (acc[t] || 0) + 1
      return acc
    }, {})
    expect(Math.max(...Object.values(wideTopCounts))).toBeGreaterThanOrEqual(2)
  } finally {
    await host.context.close()
    await second.context.close()
  }
})
