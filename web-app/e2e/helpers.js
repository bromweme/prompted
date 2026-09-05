// Shared helpers for driving the Create Group wizard from tests.
import { expect } from '@playwright/test'

const WIZARD_STEP_HEADINGS = ['Basics', 'Game Rules', 'Override & Timing', 'Topics & Extras']

export async function fillGroupName(page, groupName) {
  await page.getByLabel('Group Name').fill(groupName)
}

// Clicking Next moves focus to the new step's heading (an accessibility
// requirement — screen reader users need the announcement), which scrolls
// it into view. Waiting for that heading to be visible before returning
// avoids racing that transition on the very next action.
export async function goToNextWizardStep(page, expectHeading) {
  await page.getByRole('button', { name: 'Next' }).click()
  if (expectHeading) {
    await expect(page.getByRole('heading', { name: expectHeading, level: 2 })).toBeVisible()
  }
}

// Navigates to /create-group, fills the required Basics field, and advances
// through every intermediate step (defaults left untouched), landing on the
// final step without submitting.
export async function advanceToFinalWizardStep(page, groupName) {
  await page.goto('/create-group')
  await fillGroupName(page, groupName)
  await goToNextWizardStep(page, WIZARD_STEP_HEADINGS[1]) // Basics -> Game Rules
  await goToNextWizardStep(page, WIZARD_STEP_HEADINGS[2]) // Game Rules -> Override & Timing
  await goToNextWizardStep(page, WIZARD_STEP_HEADINGS[3]) // Override & Timing -> Topics & Extras
}

// Full flow: create a group with default settings beyond the name.
export async function createGroupThroughWizard(page, groupName) {
  await advanceToFinalWizardStep(page, groupName)
  await page.getByRole('button', { name: 'Create Group' }).click()
}
