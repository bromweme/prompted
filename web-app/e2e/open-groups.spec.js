import { test, expect } from '@playwright/test'
import { connectAs, testRunId } from './helpers.js'

// Open groups (OG-1): a group that isn't private and hasn't started can be
// found from the dashboard and viewed; strangers then ask to join (covered in
// join-requests.spec.js). These drive the server directly over socket.io, so
// they check the contract itself: what the list reveals and when.

const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve))

// Waits for the update that shows the group has started. A plain
// once('group_updated') could instead catch the broadcast from an earlier
// join that happens to arrive late.
function started(socket, groupId) {
  return new Promise((resolve) => {
    const handler = ({ group }) => {
      if (group.id === groupId && group.status === 'active') {
        socket.off('group_updated', handler)
        resolve(group)
      }
    }
    socket.on('group_updated', handler)
  })
}

async function createGroup(host, { name, isPrivate = false }) {
  host.socket.emit('create_group', { groupData: { name, isPrivate, settings: {} } })
  const { group } = await once(host.socket, 'group_created')
  return group
}

async function openList(player) {
  const listed = once(player.socket, 'open_groups_list')
  player.socket.emit('get_open_groups')
  const { groups } = await listed
  return groups
}

test.describe('open groups list', () => {
  let runId, host, outsider

  test.beforeEach(async () => {
    runId = testRunId()
    host = connectAs(`og-host-${runId}`, 'Open Host')
    outsider = connectAs(`og-out-${runId}`, 'Outsider')
    await Promise.all([host.ready, outsider.ready])
  })

  test.afterEach(() => {
    host.socket.close()
    outsider.socket.close()
  })

  test('a group that is not private and not started is listed', async () => {
    const group = await createGroup(host, { name: `Open ${runId}` })

    const listed = (await openList(outsider)).find((g) => g.id === group.id)
    expect(listed).toMatchObject({
      id: group.id,
      name: `Open ${runId}`,
      hostName: 'Open Host',
      playerCount: 1,
    })
  })

  test('the listing reveals no invite code or player ids', async () => {
    const group = await createGroup(host, { name: `NoLeak ${runId}` })

    const listed = (await openList(outsider)).find((g) => g.id === group.id)
    expect(listed).toBeTruthy()
    expect(listed).not.toHaveProperty('inviteCode')
    expect(listed).not.toHaveProperty('players')
    expect(JSON.stringify(listed)).not.toContain(group.inviteCode)
    expect(JSON.stringify(listed)).not.toContain(host.id)
  })

  test('a private group is not listed', async () => {
    const group = await createGroup(host, { name: `Private ${runId}`, isPrivate: true })

    expect((await openList(outsider)).map((g) => g.id)).not.toContain(group.id)
  })

  test('a group that has started is not listed', async () => {
    const group = await createGroup(host, { name: `Started ${runId}` })
    outsider.socket.emit('join_group', { inviteCode: group.inviteCode })
    await once(outsider.socket, 'group_joined')

    const hasStarted = started(host.socket, group.id)
    host.socket.emit('start_group', { groupId: group.id })
    await hasStarted

    const viewer = connectAs(`og-view-${runId}`, 'Viewer')
    await viewer.ready
    expect((await openList(viewer)).map((g) => g.id)).not.toContain(group.id)
    viewer.socket.close()
  })

  test("a player's own groups are left out of their open list", async () => {
    const group = await createGroup(host, { name: `Mine ${runId}` })

    expect((await openList(host)).map((g) => g.id)).not.toContain(group.id)
  })
})

test.describe('open list updates', () => {
  let runId, host, outsider

  test.beforeEach(async () => {
    runId = testRunId()
    host = connectAs(`ogu-host-${runId}`, 'Open Host')
    outsider = connectAs(`ogu-out-${runId}`, 'Outsider')
    await Promise.all([host.ready, outsider.ready])
  })

  test.afterEach(() => {
    host.socket.close()
    outsider.socket.close()
  })

  test('the player count follows members joining', async () => {
    const group = await createGroup(host, { name: `Counted ${runId}` })
    outsider.socket.emit('join_group', { inviteCode: group.inviteCode })
    await once(outsider.socket, 'group_joined')

    const viewer = connectAs(`ogu-view-${runId}`, 'Viewer')
    await viewer.ready
    const listed = (await openList(viewer)).find((g) => g.id === group.id)
    expect(listed.playerCount).toBe(2)
    viewer.socket.close()
  })

  test('the open list tells connected clients when it changes', async () => {
    const changed = once(outsider.socket, 'open_groups_changed')
    await createGroup(host, { name: `Live ${runId}` })
    await changed
  })

  test('there is no way to join an open group without the host', async () => {
    const group = await createGroup(host, { name: `Gated ${runId}` })
    outsider.socket.emit('join_open_group', { groupId: group.id })
    // The old instant-join event is gone: nothing answers it, and the
    // outsider is still not a member.
    await new Promise((r) => setTimeout(r, 300))
    const listed = (await openList(outsider)).find((g) => g.id === group.id)
    expect(listed).toMatchObject({ playerCount: 1 })
  })
})

test.describe('searching open groups', () => {
  let runId, host, searcher

  test.beforeEach(async () => {
    runId = testRunId()
    host = connectAs(`ogs-host-${runId}`, `Hostess ${runId}`)
    searcher = connectAs(`ogs-find-${runId}`, 'Searcher')
    await Promise.all([host.ready, searcher.ready])
  })

  test.afterEach(() => {
    host.socket.close()
    searcher.socket.close()
  })

  async function search(query, extra = {}) {
    const listed = once(searcher.socket, 'open_groups_list')
    searcher.socket.emit('get_open_groups', { query, ...extra })
    return listed
  }

  test('matches name, description, or host name, ignoring case', async () => {
    host.socket.emit('create_group', { groupData: { name: `Vinyl Club ${runId}`, settings: {} } })
    const { group: byName } = await once(host.socket, 'group_created')
    host.socket.emit('create_group', { groupData: { name: `Plain ${runId}`, description: `all about synthwave ${runId}`, settings: {} } })
    const { group: byDescription } = await once(host.socket, 'group_created')

    const nameHits = (await search(`VINYL CLUB ${runId}`)).groups.map((g) => g.id)
    expect(nameHits).toEqual([byName.id])

    const descriptionHits = (await search(`synthwave ${runId}`)).groups.map((g) => g.id)
    expect(descriptionHits).toEqual([byDescription.id])

    const hostHits = (await search(`hostess ${runId}`)).groups.map((g) => g.id)
    expect(hostHits.sort()).toEqual([byName.id, byDescription.id].sort())
  })

  test('a search with no matches returns an empty list and a total of zero', async () => {
    const reply = await search(`no-such-group-${runId}`)
    expect(reply.groups).toEqual([])
    expect(reply.total).toBe(0)
  })

  test('limit caps the page while total counts every match', async () => {
    for (let i = 0; i < 3; i++) {
      host.socket.emit('create_group', { groupData: { name: `Capped ${i} ${runId}`, settings: {} } })
      await once(host.socket, 'group_created')
    }

    // Only this test's three groups contain the run id, so other tests
    // creating groups in parallel can't change the count.
    const reply = await search(runId, { limit: 2 })
    expect(reply.groups).toHaveLength(2)
    expect(reply.total).toBe(3)
  })

  test('offset pages through the matches with no overlap', async () => {
    for (let i = 0; i < 5; i++) {
      host.socket.emit('create_group', { groupData: { name: `Paged ${i} ${runId}`, settings: {} } })
      await once(host.socket, 'group_created')
    }

    const pages = []
    for (const offset of [0, 2, 4]) {
      pages.push((await search(runId, { limit: 2, offset })).groups.map((g) => g.id))
    }
    expect(pages.map((p) => p.length)).toEqual([2, 2, 1])
    expect(new Set(pages.flat()).size).toBe(5)
  })

  test('a page never holds more than 48 groups', async () => {
    // Spread across several hosts: each socket has its own rate-limit bucket.
    const hosts = Array.from({ length: 7 }, (_, i) => connectAs(`ogs-cap${i}-${runId}`, `Cap Host ${i}`))
    await Promise.all(hosts.map((h) => h.ready))
    for (let i = 0; i < 49; i++) {
      const h = hosts[i % hosts.length]
      h.socket.emit('create_group', { groupData: { name: `Cap ${i} ${runId}`, settings: {} } })
      await once(h.socket, 'group_created')
    }

    const reply = await search(runId, { limit: 100 })
    expect(reply.groups).toHaveLength(48)
    expect(reply.total).toBe(49)
    hosts.forEach((h) => h.socket.close())
  })

  test('echoes the request id so a client can drop stale replies', async () => {
    const reply = await search('', { requestId: 42 })
    expect(reply.requestId).toBe(42)
  })
})
