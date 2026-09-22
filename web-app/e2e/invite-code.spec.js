import { test, expect } from '@playwright/test'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  connectAs,
  createGroupThroughWizard,
  inviteCodeFor,
  seedTestUser,
  testRunId,
} from './helpers.js'

// UI-2: a group's invite code is a random 20-letter A-Z string, separate from
// its (opaque) id. Joining is by code only, by id only for members, and the
// host can reset the code.

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const serverDir = path.resolve(__dirname, '../../server')
const Database = createRequire(path.join(serverDir, 'package.json'))('better-sqlite3')
const dbPath = process.env.PROMPTED_DB_PATH || path.join(serverDir, 'prompted.db')

const CODE = /^[A-Z]{20}$/
const GROUPED_CODE = /^[A-Z]{5}-[A-Z]{5}-[A-Z]{5}-[A-Z]{5}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve))

// The first of `events` to arrive, as { event, payload }.
const first = (socket, events) => new Promise((resolve) => {
  const handlers = events.map((event) => {
    const handler = (payload) => {
      events.forEach((e, i) => socket.off(e, handlers[i]))
      resolve({ event, payload })
    }
    socket.on(event, handler)
    return handler
  })
})

async function joinResult(socket, payload) {
  const result = first(socket, ['group_joined', 'error'])
  socket.emit('join_group', payload)
  return result
}

async function rawGroup(host, name, { isPrivate = false } = {}) {
  host.socket.emit('create_group', { groupData: { name, isPrivate, settings: {} } })
  const { group } = await once(host.socket, 'group_created')
  return group
}

async function newPlayer(browser, { id, name }) {
  const context = await browser.newContext()
  await seedTestUser(context, { id, name })
  const page = await context.newPage()
  return { id, context, page }
}

function readEvents(groupId, names) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    return db
      .prepare(`SELECT name, group_id, actor_id, props FROM events WHERE group_id = ? AND name IN (${names.map(() => '?').join(',')}) ORDER BY ts, rowid`)
      .all(groupId, ...names)
      .map((row) => ({ ...row, props: row.props ? JSON.parse(row.props) : null }))
  } finally {
    db.close()
  }
}

test.describe('invite codes', () => {
  test('a new group gets a random letter code, shown grouped, with a clean /join link', async ({ page, context }) => {
    const runId = testRunId()
    await seedTestUser(context, { id: `ic-fmt-${runId}`, name: 'Code Host' })

    await createGroupThroughWizard(page, `Code Format ${runId}`)
    await expect(page).toHaveURL(/\/group\/.+/)
    const groupId = page.url().split('/group/')[1]
    // The id is opaque and is not the invite code.
    expect(groupId).toMatch(UUID)

    const code = await inviteCodeFor(`ic-fmt-${runId}`, groupId)
    expect(code).toMatch(CODE)

    await page.getByRole('button', { name: 'Invite players to group' }).click()
    const dialog = page.getByRole('dialog')
    const shownCode = await dialog.getByRole('textbox', { name: 'Group Code' }).inputValue()
    expect(shownCode).toMatch(GROUPED_CODE)
    expect(shownCode.replace(/-/g, '')).toBe(code)

    const link = await dialog.getByRole('textbox', { name: 'Shareable Link' }).inputValue()
    const origin = new URL(page.url()).origin
    expect(link).toBe(`${origin}/join/${code}`)
    expect(link).not.toContain('?')
    expect(link).not.toContain(groupId)
  })

  test('opening /join/<code> joins the group and lands on the group page', async ({ browser }) => {
    const runId = testRunId()
    const host = await newPlayer(browser, { id: `ic-link-host-${runId}`, name: 'Link Host' })
    const guest = await newPlayer(browser, { id: `ic-link-guest-${runId}`, name: 'Link Guest' })
    try {
      await createGroupThroughWizard(host.page, `Join Link ${runId}`)
      await expect(host.page).toHaveURL(/\/group\/.+/)
      const groupId = host.page.url().split('/group/')[1]
      const code = await inviteCodeFor(host.id, groupId)

      await guest.page.goto(`/join/${code}`)
      await expect(guest.page).toHaveURL(new RegExp(`/group/${groupId}$`))
      await expect(guest.page.getByRole('button', { name: 'Leave Group' })).toBeVisible()
      await expect(host.page.getByText('2 players')).toBeVisible()

      // The join replaced the /join entry, so Back does not land on it again.
      await guest.page.goBack()
      expect(guest.page.url()).not.toContain('/join/')
    } finally {
      await host.context.close()
      await guest.context.close()
    }
  })

  test('a signed-out visitor who opens an invite link joins after signing in', async ({ browser }) => {
    const runId = testRunId()
    const host = connectAs(`ic-out-host-${runId}`, 'Signed Out Host')
    await host.ready
    const group = await rawGroup(host, `Signed Out ${runId}`)

    const context = await browser.newContext()
    const page = await context.newPage()
    try {
      await page.goto(`/join/${group.inviteCode.toLowerCase()}`)
      // No identity yet: RequireAuth sends the visitor to sign-in.
      await expect(page).toHaveURL(/\/$/)
      await expect(page.getByRole('heading', { name: 'Welcome to Prompted' })).toBeVisible()

      // "Sign in". Real sign-in is Google, which the suite cannot drive; the
      // dev-only test identity is picked up when the app boots, so store it
      // and reload. The router state that remembers the invite survives the
      // reload the same way it survives Google's in-page callback.
      await page.evaluate((user) => window.localStorage.setItem('testUser', JSON.stringify(user)), {
        userId: `ic-out-guest-${runId}`, name: 'Late Guest', email: `ic-out-guest-${runId}@example.com`, avatar: '🎵'
      })
      await page.reload()

      await expect(page).toHaveURL(new RegExp(`/group/${group.id}$`), { timeout: 15_000 })
      await expect(page.getByRole('button', { name: 'Leave Group' })).toBeVisible()
    } finally {
      host.socket.close()
      await context.close()
    }
  })

  test('an unknown code on the /join route shows an error and a way back', async ({ page, context }) => {
    const runId = testRunId()
    await seedTestUser(context, { id: `ic-bad-link-${runId}`, name: 'Bad Link' })

    await page.goto('/join/NOTAREALCODEATALLXYZ')
    await expect(page.getByRole('heading', { name: "Couldn't join this group" })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveText('Invite code not found')
    await page.getByRole('button', { name: 'Back to Dashboard' }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
  })

  test('the Dashboard join accepts lower-case, dashed and spaced codes, and shows a refusal inline', async ({ browser }) => {
    const runId = testRunId()
    const host = connectAs(`ic-dash-host-${runId}`, 'Dashboard Host')
    await host.ready
    const groupA = await rawGroup(host, `Dash A ${runId}`)
    const groupB = await rawGroup(host, `Dash B ${runId}`)
    const guest = await newPlayer(browser, { id: `ic-dash-guest-${runId}`, name: 'Dashboard Guest' })

    const openJoin = async () => {
      await guest.page.goto('/dashboard')
      await guest.page.getByRole('button', { name: 'Join existing group' }).click()
      return guest.page.getByRole('dialog')
    }

    try {
      // A wrong code is explained in the modal, not in a browser alert.
      let dialog = await openJoin()
      await dialog.getByRole('textbox', { name: 'Group Code' }).fill('abcde-abcde-abcde-abcde')
      await dialog.getByRole('button', { name: 'Join Group', exact: true }).click()
      await expect(dialog.getByRole('alert')).toHaveText('Invite code not found')
      await expect(guest.page).toHaveURL(/\/dashboard$/)

      // Lower-case with dashes.
      const dashed = groupA.inviteCode.toLowerCase().match(/.{5}/g).join('-')
      await dialog.getByRole('textbox', { name: 'Group Code' }).fill(dashed)
      await expect(dialog.getByRole('alert')).toHaveCount(0)
      await dialog.getByRole('button', { name: 'Join Group', exact: true }).click()
      await expect(guest.page).toHaveURL(new RegExp(`/group/${groupA.id}$`))

      // Mixed case with spaces and stray whitespace.
      const spaced = ` ${groupB.inviteCode.slice(0, 10).toLowerCase()} ${groupB.inviteCode.slice(10)}  `
      dialog = await openJoin()
      await dialog.getByRole('textbox', { name: 'Group Code' }).fill(spaced)
      await dialog.getByRole('button', { name: 'Join Group', exact: true }).click()
      await expect(guest.page).toHaveURL(new RegExp(`/group/${groupB.id}$`))
    } finally {
      host.socket.close()
      await guest.context.close()
    }
  })
})

test.describe('access by id requires membership', () => {
  test('a non-member cannot read or act on a group by id, or join with it', async () => {
    const runId = testRunId()
    const host = connectAs(`ic-gate-host-${runId}`, 'Gate Host')
    const outsider = connectAs(`ic-gate-out-${runId}`, 'Outsider')
    await Promise.all([host.ready, outsider.ready])

    try {
      const group = await rawGroup(host, `Gate ${runId}`)
      expect(group.id).toMatch(UUID)
      expect(group.inviteCode).toMatch(CODE)

      // Reading by id gives exactly what a missing group gives.
      outsider.socket.emit('get_group', { groupId: group.id })
      expect((await once(outsider.socket, 'error')).message).toBe('Group not found')
      outsider.socket.emit('get_group', { groupId: 'no-such-group' })
      expect((await once(outsider.socket, 'error')).message).toBe('Group not found')

      // Group-scoped actions are refused the same way, host-only ones included.
      for (const [event, payload] of [
        ['get_group_topics', { groupId: group.id }],
        ['update_group', { groupId: group.id, settings: { voteBudget: 5 } }],
        ['start_group', { groupId: group.id }],
        ['reset_invite_code', { groupId: group.id }],
        ['delete_group', { groupId: group.id }],
        ['host_election_open', { groupId: group.id }],
      ]) {
        outsider.socket.emit(event, payload)
        expect((await once(outsider.socket, 'error')).message, event).toBe('Group not found')
      }

      // An id is never an invite code for a new group, in either field.
      for (const payload of [{ groupId: group.id }, { inviteCode: group.id }]) {
        const { event, payload: reply } = await joinResult(outsider.socket, payload)
        expect(event).toBe('error')
        expect(reply.message).toBe('Invite code not found')
      }

      // Nothing leaked into the roster, and the host's own view still works.
      host.socket.emit('get_group', { groupId: group.id })
      const { group: hostView } = await once(host.socket, 'group_details')
      expect(hostView.players.map((p) => p.userId)).toEqual([host.id])
      expect(hostView.inviteCode).toBe(group.inviteCode)
    } finally {
      host.socket.close()
      outsider.socket.close()
    }
  })

  // A group that isn't private shows non-members a view-only page with
  // Request to Join instead (JR-1, covered in open-groups-dashboard.spec.js).
  test('a non-member opening a private /group/<id> sees a not-a-member page', async ({ page, context }) => {
    const runId = testRunId()
    const host = connectAs(`ic-page-host-${runId}`, 'Page Host')
    await host.ready
    try {
      const group = await rawGroup(host, `Private Page ${runId}`, { isPrivate: true })
      await seedTestUser(context, { id: `ic-page-out-${runId}`, name: 'Page Outsider' })

      await page.goto(`/group/${group.id}`)
      await expect(page.getByRole('heading', { name: "You're not a member of this group" })).toBeVisible()
      await expect(page.getByText(`Private Page ${runId}`)).toHaveCount(0)
      await page.getByRole('button', { name: 'Back to Dashboard' }).click()
      await expect(page).toHaveURL(/\/dashboard$/)
    } finally {
      host.socket.close()
    }
  })
})

test.describe('resetting the invite code', () => {
  test('the host resets the code in the Invite modal; the old code dies, members stay', async ({ browser }) => {
    const runId = testRunId()
    const hostId = `ic-reset-host-${runId}`
    const host = await newPlayer(browser, { id: hostId, name: 'Reset Host' })
    const member = connectAs(`ic-reset-member-${runId}`, 'Reset Member')
    const late = connectAs(`ic-reset-late-${runId}`, 'Late Joiner')
    const newcomer = connectAs(`ic-reset-new-${runId}`, 'Newcomer')
    await Promise.all([member.ready, late.ready, newcomer.ready])

    try {
      await createGroupThroughWizard(host.page, `Reset ${runId}`)
      await expect(host.page).toHaveURL(/\/group\/.+/)
      const groupId = host.page.url().split('/group/')[1]
      const oldCode = await inviteCodeFor(hostId, groupId)

      expect((await joinResult(member.socket, { inviteCode: oldCode })).event).toBe('group_joined')
      await expect(host.page.getByText('2 players')).toBeVisible()

      await host.page.getByRole('button', { name: 'Invite players to group' }).click()
      const dialog = host.page.getByRole('dialog')
      const codeField = dialog.getByRole('textbox', { name: 'Group Code' })
      await expect(codeField).toHaveValue(oldCode.match(/.{5}/g).join('-'))

      // The reset asks first, in the page, and can be backed out of.
      await dialog.getByRole('button', { name: 'Reset code' }).click()
      await expect(dialog.getByText('Reset the invite code?')).toBeVisible()
      await dialog.getByRole('button', { name: 'Keep current code' }).click()
      await expect(codeField).toHaveValue(oldCode.match(/.{5}/g).join('-'))

      await dialog.getByRole('button', { name: 'Reset code' }).click()
      await dialog.getByRole('button', { name: 'Yes, reset code' }).click()
      await expect(codeField).not.toHaveValue(oldCode.match(/.{5}/g).join('-'))
      await expect(dialog.getByText('Reset the invite code?')).toHaveCount(0)

      const newCode = (await codeField.inputValue()).replace(/-/g, '')
      expect(newCode).toMatch(CODE)
      expect(newCode).toBe(await inviteCodeFor(hostId, groupId))
      const origin = new URL(host.page.url()).origin
      await expect(dialog.getByRole('textbox', { name: 'Shareable Link' })).toHaveValue(`${origin}/join/${newCode}`)

      // The old code stops working at once; the new one works.
      const stale = await joinResult(late.socket, { inviteCode: oldCode })
      expect(stale.event).toBe('error')
      expect(stale.payload.message).toBe('Invite code not found')
      const fresh = await joinResult(newcomer.socket, { inviteCode: newCode })
      expect(fresh.event).toBe('group_joined')
      expect(fresh.payload.group.id).toBe(groupId)

      // The existing member was untouched and sees the new code.
      member.socket.emit('get_group', { groupId })
      const { group: memberView } = await once(member.socket, 'group_details')
      expect(memberView.players.map((p) => p.userId)).toContain(member.id)
      expect(memberView.inviteCode).toBe(newCode)

      // Only the host may reset.
      member.socket.emit('reset_invite_code', { groupId })
      expect((await once(member.socket, 'error')).message).toBe('Only the host can reset the invite code')
      expect(await inviteCodeFor(hostId, groupId)).toBe(newCode)

      // EVT-1: the link join and the reset are logged, with no code values.
      const rows = readEvents(groupId, ['invite_opened', 'invite_code_reset'])
      expect(rows.filter((r) => r.name === 'invite_code_reset')).toHaveLength(1)
      const opened = rows.filter((r) => r.name === 'invite_opened')
      expect(opened.map((r) => r.props.outcome)).toEqual(['joined', 'joined'])
      for (const row of rows) {
        const json = JSON.stringify(row)
        expect(json).not.toContain(oldCode)
        expect(json).not.toContain(newCode)
      }
    } finally {
      member.socket.close()
      late.socket.close()
      newcomer.socket.close()
      await host.context.close()
    }
  })

  // REP-UI2-1: a connection lost between the request and its reply used to
  // leave the button on "Resetting…" for good.
  test('the reset button recovers when the connection drops mid-reset', async ({ browser }) => {
    const runId = testRunId()
    const hostId = `ic-rdrop-host-${runId}`
    const host = await newPlayer(browser, { id: hostId, name: 'Drop Host' })
    const hostSocket = await routeAppSocket(host.page)

    try {
      await createGroupThroughWizard(host.page, `Reset Drop ${runId}`)
      await expect(host.page).toHaveURL(/\/group\/.+/)
      const groupId = host.page.url().split('/group/')[1]
      const oldCode = await inviteCodeFor(hostId, groupId)
      const grouped = (code) => code.match(/.{5}/g).join('-')

      await host.page.getByRole('button', { name: 'Invite players to group' }).click()
      const dialog = host.page.getByRole('dialog')
      const codeField = dialog.getByRole('textbox', { name: 'Group Code' })

      // The request never reaches the server, so no reply ever comes.
      hostSocket.state.drop = 'reset_invite_code'
      await dialog.getByRole('button', { name: 'Reset code' }).click()
      await dialog.getByRole('button', { name: 'Yes, reset code' }).click()
      await expect(dialog.getByRole('button', { name: 'Resetting…' })).toBeDisabled()
      await expect.poll(() => hostSocket.state.dropped.length).toBe(1)

      // The connection drops: the button is released and the confirm step
      // backed out, with the code unchanged.
      hostSocket.state.drop = null
      await hostSocket.cutAndAwaitReconnect()
      await expect(dialog.getByRole('button', { name: 'Resetting…' })).toHaveCount(0)
      await expect(dialog.getByText('Reset the invite code?')).toHaveCount(0)
      await expect(codeField).toHaveValue(grouped(oldCode))
      expect(await inviteCodeFor(hostId, groupId)).toBe(oldCode)

      // The host can try again, and this time it goes through.
      await dialog.getByRole('button', { name: 'Reset code' }).click()
      await dialog.getByRole('button', { name: 'Yes, reset code' }).click()
      await expect(codeField).not.toHaveValue(grouped(oldCode))
      await expect(dialog.getByText('Reset the invite code?')).toHaveCount(0)
      const newCode = (await codeField.inputValue()).replace(/-/g, '')
      expect(newCode).toBe(await inviteCodeFor(hostId, groupId))

      // Closing the modal mid-reset releases the button too.
      hostSocket.state.drop = 'reset_invite_code'
      await dialog.getByRole('button', { name: 'Reset code' }).click()
      await dialog.getByRole('button', { name: 'Yes, reset code' }).click()
      await expect(dialog.getByRole('button', { name: 'Resetting…' })).toBeDisabled()
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(host.page.getByRole('dialog')).toHaveCount(0)
      hostSocket.state.drop = null
      await host.page.getByRole('button', { name: 'Invite players to group' }).click()
      await expect(dialog.getByRole('button', { name: 'Reset code' })).toBeEnabled()
      await expect(dialog.getByRole('button', { name: 'Resetting…' })).toHaveCount(0)
      await expect(codeField).toHaveValue(grouped(newCode))
    } finally {
      await host.context.close()
    }
  })
})

// Every invite_opened outcome for the one player who joined `groupId` by
// invite, across all groups. Actor ids are stored hashed and a refused join
// (not_found, throttled) carries no group id, so the hash is read off the
// player's own row in this group and then matched everywhere.
function inviteOutcomesOfJoiner(groupId) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    const actors = db
      .prepare(`SELECT DISTINCT actor_id FROM events WHERE name = 'invite_opened' AND group_id = ?`)
      .all(groupId)
    expect(actors).toHaveLength(1)
    return db
      .prepare(`SELECT props FROM events WHERE name = 'invite_opened' AND actor_id = ? ORDER BY ts, rowid`)
      .all(actors[0].actor_id)
      .map((row) => JSON.parse(row.props).outcome)
  } finally {
    db.close()
  }
}

// Proxies a page's socket.io websocket through the test so it can drop one
// outgoing event, or cut the connection to force a real disconnect and the
// client's own reconnect. Must be installed before the page first connects.
async function routeAppSocket(page) {
  const state = { connections: [], drop: null, dropped: [] }
  await page.routeWebSocket(/localhost:5000\/socket\.io\//, (ws) => {
    const server = ws.connectToServer()
    const connection = { ws, server, upgraded: false }
    ws.onMessage((message) => {
      // engine.io's "upgrade" packet: from here on this websocket is the live
      // transport. Before it, it is only a probe, and closing a probe just
      // leaves the client on polling with no disconnect at all.
      if (message === '5') connection.upgraded = true
      if (state.drop && typeof message === 'string' && message.includes(`"${state.drop}"`)) {
        state.dropped.push(message)
        return
      }
      server.send(message)
    })
    state.connections.push(connection)
  })
  const upgradedCount = () => state.connections.filter((c) => c.upgraded).length
  return {
    state,
    // Waits until the client's current connection is a live websocket, closes
    // it (and any older ones, both ends), then waits until the client has
    // reconnected and upgraded again.
    async cutAndAwaitReconnect() {
      await expect.poll(() => state.connections.at(-1)?.upgraded, { timeout: 15_000 }).toBe(true)
      const before = upgradedCount()
      for (const { ws, server } of state.connections) {
        await server.close().catch(() => {})
        await ws.close().catch(() => {})
      }
      await expect.poll(upgradedCount, { timeout: 15_000 }).toBeGreaterThan(before)
    },
  }
}

test.describe('legacy groups', () => {
  test('a pre-UI-2 group is still joinable by its id as a code, until the host resets it', async ({ browser }) => {
    const runId = testRunId()
    const host = connectAs(`ic-legacy-host-${runId}`, 'Legacy Host')
    const typed = connectAs(`ic-legacy-typed-${runId}`, 'Typed Joiner')
    const late = connectAs(`ic-legacy-late-${runId}`, 'Late Legacy')
    await Promise.all([host.ready, typed.ready, late.ready])
    const linkUser = await newPlayer(browser, { id: `ic-legacy-link-${runId}`, name: 'Legacy Link' })
    const pathUser = await newPlayer(browser, { id: `ic-legacy-path-${runId}`, name: 'Legacy Path' })

    try {
      host.socket.emit('test_create_legacy_group', { name: `Legacy ${runId}` })
      const { group } = await once(host.socket, 'test_legacy_group_created')
      expect(group.id).toMatch(/^GROUP\d+_\d+$/)
      expect(group.inviteCode).toBeUndefined()

      // The old Dashboard payload ({ groupId }) and a typed lower-case code.
      expect((await joinResult(typed.socket, { groupId: group.id })).event).toBe('group_joined')
      expect((await joinResult(late.socket, { inviteCode: ` ${group.id.toLowerCase()} ` })).event).toBe('group_joined')

      // An old shared ?join=true link still joins.
      await linkUser.page.goto(`/group/${group.id}?join=true`)
      await expect(linkUser.page.getByRole('button', { name: 'Leave Group' })).toBeVisible()
      // ...and then drops the query, so later visits take the member path.
      await expect(linkUser.page).toHaveURL(new RegExp(`/group/${group.id}$`))

      // The new link shape works with a legacy code too, and the modal shows
      // the legacy code as-is.
      await pathUser.page.goto(`/join/${group.id}`)
      await expect(pathUser.page).toHaveURL(new RegExp(`/group/${group.id}$`))

      // Resetting retires the id as a way in.
      host.socket.emit('reset_invite_code', { groupId: group.id })
      const { inviteCode } = await once(host.socket, 'invite_code_reset')
      expect(inviteCode).toMatch(CODE)

      const stranger = connectAs(`ic-legacy-stranger-${runId}`, 'Stranger')
      await stranger.ready
      const refused = await joinResult(stranger.socket, { groupId: group.id })
      expect(refused.event).toBe('error')
      expect(refused.payload.message).toBe('Invite code not found')
      expect((await joinResult(stranger.socket, { inviteCode })).event).toBe('group_joined')
      stranger.socket.close()

      host.socket.emit('get_group', { groupId: group.id })
      const { group: after } = await once(host.socket, 'group_details')
      expect(after.players).toHaveLength(6)
    } finally {
      host.socket.close()
      typed.socket.close()
      late.socket.close()
      await linkUser.context.close()
      await pathUser.context.close()
    }
  })

  // REP-UI2-1: the reset retires the legacy id as a code, which must not lock
  // out someone who already joined through the old ?join=true link.
  test('a member who joined by a legacy ?join=true link keeps the group after a reset', async ({ browser }) => {
    const runId = testRunId()
    const host = connectAs(`ic-lgm-host-${runId}`, 'Legacy Keep Host')
    await host.ready
    const member = await newPlayer(browser, { id: `ic-lgm-member-${runId}`, name: 'Legacy Keeper' })
    const outsider = await newPlayer(browser, { id: `ic-lgm-out-${runId}`, name: 'Legacy Outsider' })
    const memberSocket = await routeAppSocket(member.page)

    try {
      host.socket.emit('test_create_legacy_group', { name: `Legacy Keep ${runId}` })
      const { group } = await once(host.socket, 'test_legacy_group_created')
      const plainUrl = new RegExp(`/group/${group.id}$`)
      const leave = member.page.getByRole('button', { name: 'Leave Group' })
      const accessHeading = member.page.locator('#group-access-title')

      await member.page.goto(`/group/${group.id}?join=true`)
      await expect(leave).toBeVisible()
      await expect(member.page).toHaveURL(plainUrl)

      host.socket.emit('reset_invite_code', { groupId: group.id })
      await once(host.socket, 'invite_code_reset')

      // A reload after the reset.
      await member.page.reload()
      await expect(leave).toBeVisible()
      await expect(accessHeading).toHaveCount(0)
      await expect(member.page).toHaveURL(plainUrl)

      // A dropped connection: the client reconnects and re-loads the group.
      await memberSocket.cutAndAwaitReconnect()
      await expect(leave).toBeVisible()
      await expect(accessHeading).toHaveCount(0)
      await expect(member.page).toHaveURL(plainUrl)

      // The old bookmark, opened again and again, still shows the group, with
      // no join attempt refused and so nothing counted toward the throttle.
      for (let i = 0; i < 3; i++) {
        await member.page.goto(`/group/${group.id}?join=true`)
        await expect(leave, `visit ${i + 1}`).toBeVisible()
        await expect(member.page).toHaveURL(plainUrl)
        await expect(accessHeading).toHaveCount(0)
        await expect(member.page.getByText('Too many attempts')).toHaveCount(0)
      }
      await memberSocket.cutAndAwaitReconnect()
      await expect(leave).toBeVisible()
      await expect(accessHeading).toHaveCount(0)

      // The member's only invite_opened is the original join: no refused
      // (not_found) or throttled attempt was ever recorded for them.
      expect(inviteOutcomesOfJoiner(group.id)).toEqual(['joined'])

      // A genuine non-member with the retired link is refused, and sees
      // nothing of the group.
      await outsider.page.goto(`/group/${group.id}?join=true`)
      await expect(outsider.page.getByRole('heading', { name: "Couldn't join this group" })).toBeVisible()
      await expect(outsider.page.getByRole('alert')).toHaveText('Invite code not found')
      await expect(outsider.page.getByText(`Legacy Keep ${runId}`)).toHaveCount(0)
      await expect(outsider.page.getByRole('button', { name: 'Leave Group' })).toHaveCount(0)

      host.socket.emit('get_group', { groupId: group.id })
      const { group: after } = await once(host.socket, 'group_details')
      expect(after.players.map((p) => p.userId).sort()).toEqual([host.id, member.id].sort())
    } finally {
      host.socket.close()
      await member.context.close()
      await outsider.context.close()
    }
  })
})

test.describe('join throttle', () => {
  test('repeated wrong codes are throttled per user, even for a valid code', async () => {
    const runId = testRunId()
    const host = connectAs(`ic-thr-host-${runId}`, 'Throttle Host')
    const guesser = connectAs(`ic-thr-guess-${runId}`, 'Guesser')
    const bystander = connectAs(`ic-thr-other-${runId}`, 'Bystander')
    await Promise.all([host.ready, guesser.ready, bystander.ready])

    try {
      const group = await rawGroup(host, `Throttle ${runId}`)

      for (let i = 0; i < 10; i++) {
        const { event, payload } = await joinResult(guesser.socket, { inviteCode: `WRONGCODEWRONGCODE${String.fromCharCode(65 + i)}Z` })
        expect(event, `attempt ${i + 1}`).toBe('error')
        expect(payload.message).toBe('Invite code not found')
      }

      const blocked = await joinResult(guesser.socket, { inviteCode: group.inviteCode })
      expect(blocked.event).toBe('error')
      expect(blocked.payload.message).toBe('Too many attempts, try again shortly')

      // Per user: someone else is unaffected.
      expect((await joinResult(bystander.socket, { inviteCode: group.inviteCode })).event).toBe('group_joined')
    } finally {
      host.socket.close()
      guesser.socket.close()
      bystander.socket.close()
    }
  })
})
