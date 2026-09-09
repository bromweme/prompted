import { test, expect } from '@playwright/test'
import { seedTestUser, testRunId } from './helpers.js'

// Covers first-time profile setup and the header that replaced the old
// name/email block. Both hinge on the same server-side fact: a profile's
// avatar is null exactly once, on the very first sign-in.

test.describe('profile setup and header', () => {
  test('first sign-in prompts for a display name and avatar, and persists it', async ({ page, context }) => {
    const id = `setup-${testRunId()}`
    // No avatar => a profile that has never been set up.
    await seedTestUser(context, { id, name: 'Fresh Player', avatar: null })

    await page.goto('/dashboard')

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Welcome to Prompted!' })).toBeVisible()

    // The name is pre-filled from the identity, and the modal can't be
    // submitted until an avatar is chosen.
    const nameField = dialog.getByLabel('Display Name')
    await expect(nameField).toHaveValue('Fresh Player')
    const submit = dialog.getByRole('button', { name: 'Get Started' })
    await expect(submit).toBeDisabled()

    await nameField.fill('Renamed Player')
    await dialog.getByRole('radio', { name: 'Avatar 🦊' }).click()
    await expect(submit).toBeEnabled()
    await submit.click()

    // The modal closes only once the server echoes the saved profile back.
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('heading', { name: /Welcome back, Renamed Player/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Account settings for Renamed Player/ })).toContainText('🦊')
  })

  test('a returning player goes straight to the dashboard with no modal', async ({ browser }) => {
    const id = `returning-${testRunId()}`

    // First session: complete setup, exactly as a new player would.
    const firstContext = await browser.newContext()
    await seedTestUser(firstContext, { id, name: 'Repeat Player', avatar: null })
    const firstPage = await firstContext.newPage()
    await firstPage.goto('/dashboard')

    const setupDialog = firstPage.getByRole('dialog')
    await expect(setupDialog).toBeVisible()
    await setupDialog.getByRole('radio', { name: 'Avatar 🚀' }).click()
    await setupDialog.getByRole('button', { name: 'Get Started' }).click()
    await expect(setupDialog).toBeHidden()
    await firstContext.close()

    // Second session, same identity, fresh browser storage — so nothing but
    // the server-side profile can carry the setup state across.
    const secondContext = await browser.newContext()
    await seedTestUser(secondContext, { id, name: 'Repeat Player', avatar: null })
    const secondPage = await secondContext.newPage()
    await secondPage.goto('/dashboard')

    await expect(secondPage.getByRole('heading', { name: /Welcome back/ })).toBeVisible()
    await expect(secondPage.getByRole('dialog')).toHaveCount(0)
    // The avatar chosen in the first session came back from the server.
    await expect(secondPage.getByRole('button', { name: /Account settings/ })).toContainText('🚀')

    await secondContext.close()
  })

  test('header shows only the avatar, and it links to the account page', async ({ page, context }) => {
    const id = `header-${testRunId()}`
    await seedTestUser(context, { id, name: 'Header Player', avatar: '🐼' })

    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible()

    const header = page.getByRole('banner')

    // The email address is gone from the header entirely.
    await expect(header).not.toContainText(`${id}@example.com`)
    await expect(header).not.toContainText('@')

    // "Account" is no longer a separate nav item — the avatar replaces it.
    await expect(page.getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name: 'Account' })).toHaveCount(0)

    const avatarButton = header.getByRole('button', { name: /Account settings for Header Player/ })
    await expect(avatarButton).toContainText('🐼')

    await avatarButton.click()
    await expect(page).toHaveURL(/\/account$/)
    await expect(page.getByRole('heading', { name: 'Account Settings', level: 1 })).toBeVisible()
  })

  test('an avatar picked on the account page reaches the header', async ({ page, context }) => {
    const id = `edit-${testRunId()}`
    await seedTestUser(context, { id, name: 'Editor Player', avatar: '🎵' })

    await page.goto('/account')
    await page.getByRole('button', { name: 'Edit Profile' }).click()

    // The expanded set is shared with the first-time modal, so a choice that
    // was never in the original 14 proves both are reading the same list.
    await page.getByRole('radio', { name: 'Avatar 🦄' }).click()
    await page.getByRole('button', { name: 'Save Changes' }).click()

    await expect(page.getByRole('button', { name: 'Edit Profile' })).toBeVisible()

    await page.goto('/dashboard')
    await expect(page.getByRole('button', { name: /Account settings for Editor Player/ })).toContainText('🦄')
  })
})
