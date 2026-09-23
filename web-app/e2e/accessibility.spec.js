import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { connectAs, createGroupThroughWizard, fillGroupName, goToNextWizardStep, seedTestUser, submitVideoThroughSearch, selectTopicAsJudge, waitForJudgeIndex, startRoundAsHost, testRunId, inviteJoinPath } from './helpers.js'

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

// Both colour schemes run the same checks. Dark mode is not a separate
// design with its own rules: it redefines the same tokens, so it can fail the
// same way, and axe's colour-contrast rule is what proves it does not. The
// light pass is the original suite; the dark pass costs one extra line.
for (const colorScheme of ['light', 'dark']) {
  test.describe(`accessibility (WCAG 2.1 AA) — ${colorScheme}`, () => {
    test.use({ colorScheme })
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

    test('Open Groups search page has no violations', async ({ page, context }) => {
      const runId = testRunId()
      // Makes its own listing rather than relying on one another spec happened to
      // leave behind: the status line is empty when nothing is open, so without
      // this the test passes or fails depending on what ran before it.
      const host = connectAs(`a11y-og-host-${runId}`, 'A11y Host')
      await host.ready
      const created = new Promise((resolve) => host.socket.once('group_created', resolve))
      host.socket.emit('create_group', { groupData: { name: `A11y Open ${runId}`, description: 'Listed for the scan', settings: {} } })
      await created

      await seedTestUser(context, { id: `a11y-open-${runId}`, name: 'A11y Tester' })
      await page.goto('/open-groups')
      await expect(page.getByRole('heading', { name: 'Open Groups', level: 1 })).toBeVisible()
      await expect(page.locator('#open-groups-status')).not.toBeEmpty()

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      expect(results.violations, reportViolations(results.violations)).toEqual([])
      host.socket.close()
    })

    test('View-only group page has no violations', async ({ page, context }) => {
      const runId = testRunId()
      const host = connectAs(`a11y-pv-host-${runId}`, 'A11y Host')
      await host.ready
      const created = new Promise((resolve) => host.socket.once('group_created', resolve))
      host.socket.emit('create_group', { groupData: { name: `A11y Preview ${runId}`, description: 'A group to look at', settings: {} } })
      const { group } = await created

      await seedTestUser(context, { id: `a11y-pv-${runId}`, name: 'A11y Tester' })
      await page.goto(`/group/${group.id}`)
      await expect(page.getByRole('button', { name: 'Request to Join' })).toBeVisible()

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      expect(results.violations, reportViolations(results.violations)).toEqual([])
      host.socket.close()
    })

    test('Host Requests tab has no violations', async ({ page, context }) => {
      const runId = testRunId()
      const hostId = `a11y-rq-host-${runId}`
      const host = connectAs(hostId, 'A11y Host')
      const requester = connectAs(`a11y-rq-req-${runId}`, 'A11y Requester')
      await Promise.all([host.ready, requester.ready])
      const created = new Promise((resolve) => host.socket.once('group_created', resolve))
      host.socket.emit('create_group', { groupData: { name: `A11y Requests ${runId}`, settings: {} } })
      const { group } = await created
      requester.socket.emit('request_join', { groupId: group.id })
      host.socket.close()

      await seedTestUser(context, { id: hostId, name: 'A11y Host' })
      await page.goto(`/group/${group.id}`)
      await page.getByRole('button', { name: /^Requests/ }).click()
      await expect(page.getByRole('button', { name: 'Accept A11y Requester' })).toBeVisible()

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      expect(results.violations, reportViolations(results.violations)).toEqual([])
      requester.socket.close()
    })

    test('Notification panel has no violations', async ({ page, context }) => {
      const runId = testRunId()
      const host = connectAs(`a11y-nb-host-${runId}`, 'A11y Host')
      const playerId = `a11y-nb-${runId}`
      const player = connectAs(playerId, 'A11y Tester')
      await Promise.all([host.ready, player.ready])
      const created = new Promise((resolve) => host.socket.once('group_created', resolve))
      host.socket.emit('create_group', { groupData: { name: `A11y Bell ${runId}`, settings: {} } })
      const { group } = await created
      const asked = new Promise((resolve) => player.socket.once('join_request_update', resolve))
      player.socket.emit('request_join', { groupId: group.id })
      await asked
      const told = new Promise((resolve) => player.socket.once('notification', resolve))
      host.socket.emit('respond_join_request', { groupId: group.id, requesterId: playerId, accept: true })
      await told
      host.socket.close()
      player.socket.close()

      await seedTestUser(context, { id: playerId, name: 'A11y Tester' })
      await page.goto('/dashboard')
      await page.getByRole('button', { name: /^Notifications, \d+ unread$/ }).click()
      await expect(page.getByRole('region', { name: 'Notifications' })).toBeVisible()

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      expect(results.violations, reportViolations(results.violations)).toEqual([])
    })

    test('Start modals (players and topics) have no violations', async ({ page, context }) => {
      const runId = testRunId()
      const hostId = `a11y-sm-host-${runId}`
      const host = connectAs(hostId, 'A11y Host')
      await host.ready
      const created = new Promise((resolve) => host.socket.once('group_created', resolve))
      host.socket.emit('create_group', { groupData: { name: `A11y Start ${runId}`, settings: { allowCustomTopics: false, totalRounds: 2 } } })
      const { group } = await created

      await seedTestUser(context, { id: hostId, name: 'A11y Host' })
      await page.goto(`/group/${group.id}`)
      await page.getByRole('button', { name: 'Start Round' }).click()
      await expect(page.getByRole('dialog', { name: 'Invite someone to start' })).toBeVisible()
      let results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      expect(results.violations, reportViolations(results.violations)).toEqual([])
      await page.getByRole('button', { name: 'Close', exact: true }).click()

      const member = connectAs(`a11y-sm-mem-${runId}`, 'A11y Member')
      await member.ready
      const joined = new Promise((resolve) => member.socket.once('group_joined', resolve))
      member.socket.emit('join_group', { inviteCode: group.inviteCode })
      await joined
      await expect(page.getByText('2 players')).toBeVisible()

      await page.getByRole('button', { name: 'Start Round' }).click()
      const modal = page.getByRole('dialog', { name: 'Add your topics to start' })
      await expect(modal).toBeVisible()
      await modal.getByRole('button', { name: 'Add topic' }).click()
      await expect(modal.getByRole('alert')).toBeVisible()
      results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      expect(results.violations, reportViolations(results.violations)).toEqual([])
      host.socket.close()
      member.socket.close()
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

    // /topics and /notifications had no scan at all before this.
    test('My Topics page has no violations', async ({ page, context }) => {
      const runId = testRunId()
      const owner = connectAs(`a11y-tp-${runId}`, 'A11y Tester')
      await owner.ready
      const made = new Promise((resolve) => owner.socket.once('topic_submitted', resolve))
      owner.socket.emit('submit_topic', { text: `A11y topic ${runId}`, isPublic: true })
      await made
      owner.socket.close()

      await seedTestUser(context, { id: `a11y-tp-${runId}`, name: 'A11y Tester' })
      await page.goto('/topics')
      await expect(page.getByRole('heading', { name: 'My Topics', level: 1 })).toBeVisible()

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      expect(results.violations, reportViolations(results.violations)).toEqual([])
    })

    test('Notifications page has no violations', async ({ page, context }) => {
      const runId = testRunId()
      const host = connectAs(`a11y-np-host-${runId}`, 'A11y Host')
      const playerId = `a11y-np-${runId}`
      const player = connectAs(playerId, 'A11y Tester')
      await Promise.all([host.ready, player.ready])
      const created = new Promise((resolve) => host.socket.once('group_created', resolve))
      host.socket.emit('create_group', { groupData: { name: `A11y Notifs ${runId}`, settings: {} } })
      const { group } = await created
      const asked = new Promise((resolve) => player.socket.once('join_request_update', resolve))
      player.socket.emit('request_join', { groupId: group.id })
      await asked
      const told = new Promise((resolve) => player.socket.once('notification', resolve))
      host.socket.emit('respond_join_request', { groupId: group.id, requesterId: playerId, accept: true })
      await told
      host.socket.close()
      player.socket.close()

      await seedTestUser(context, { id: playerId, name: 'A11y Tester' })
      await page.goto('/notifications')
      await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible()

      const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
      expect(results.violations, reportViolations(results.violations)).toEqual([])
    })

    // The Account toggle is the app's only pseudo-element (.slider:before) and
    // the one control axe cannot judge at all: it never sees generated content,
    // and non-text contrast is largely outside what it checks. A switch is a
    // UI component, so WCAG 2.1 AA 1.4.11 wants 3:1 on its track against the
    // card and on its knob against the track — in BOTH of its states, which is
    // what caught the knob being 2.26:1 on the accent track in dark mode.
    test('the settings toggle meets non-text contrast in both states', async ({ page, context }) => {
      await seedTestUser(context, { id: `a11y-tg-${testRunId()}`, name: 'A11y Tester' })
      await page.goto('/account')
      // The toggles live behind the Settings tab.
      await page.locator('.tab-button').filter({ hasText: 'Settings' }).click()
      // The input itself is deliberately invisible (opacity 0, zero size) — the
      // usual styled-checkbox pattern — so the label is what can be seen and
      // clicked. It stays focusable and is labelled, which is what axe checks.
      const toggle = page.locator('.toggle-switch').filter({
        has: page.locator('input[aria-label="Sound Effects"]')
      })
      await expect(toggle).toBeVisible()

      const measure = () => page.evaluate(() => {
        const input = document.querySelector('input[aria-label="Sound Effects"]')
        const slider = input.nextElementSibling
        const card = slider.closest('.setting-item') || slider.parentElement

        const rgb = (value) => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number)
        const lum = ([r, g, b]) => {
          const f = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
        }
        // Walks up for a real background: the immediate parent is often
        // transparent, and comparing against transparent proves nothing.
        const backdrop = (el) => {
          for (let node = el; node; node = node.parentElement) {
            const bg = getComputedStyle(node).backgroundColor
            if (bg && !bg.includes('rgba(0, 0, 0, 0)')) return rgb(bg)
          }
          return [255, 255, 255]
        }
        const ratio = (a, b) => {
          const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
          return (hi + 0.05) / (lo + 0.05)
        }

        const track = rgb(getComputedStyle(slider).backgroundColor)
        const knob = rgb(getComputedStyle(slider, ':before').backgroundColor)
        return {
          state: input.checked ? 'on' : 'off',
          knobOnTrack: ratio(knob, track),
          trackOnCard: ratio(track, backdrop(card.parentElement || card))
        }
      })

      // Read whichever state it starts in, then flip it, rather than assuming:
      // these toggles do not all default the same way, and a label that says
      // "on" while measuring "off" would send the next person the wrong way.
      const check = ({ state, knobOnTrack, trackOnCard }) => {
        expect(knobOnTrack, `knob vs ${state} track: ${knobOnTrack.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
        expect(trackOnCard, `${state} track vs card: ${trackOnCard.toFixed(2)}:1`).toBeGreaterThanOrEqual(3)
      }

      const first = await measure()
      check(first)
      await toggle.click()
      const second = await measure()
      expect(second.state, 'the click did not change the state').not.toBe(first.state)
      check(second)
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

      // Comments on, so the voting phase is scanned with its full markup.
      await host.page.getByRole('button', { name: 'Rules', exact: true }).click()
      await host.page.getByRole('button', { name: 'Edit Rules' }).click()
      await host.page.getByRole('checkbox', { name: 'Allow comments during voting' }).check()
      await host.page.getByRole('button', { name: 'Save Changes' }).click()
      await expect(host.page.getByRole('button', { name: 'Edit Rules' })).toBeVisible()
      await host.page.getByRole('button', { name: 'Overview', exact: true }).click()

      for (const p of rest) {
        await p.page.goto(await inviteJoinPath(host.page))
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
}
