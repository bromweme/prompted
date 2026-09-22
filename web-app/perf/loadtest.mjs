// Load harness for the Prompted server.
//
// Not part of the test suite: it has no pass/fail line, it measures. The
// suite proves the rules are right; this says what happens when a lot of
// people play at once, which nothing else in the repo looks at.
//
// What it watches, and why those four things:
//
// 1. Fan-out. `broadcastGroup` re-publicizes the whole group and sends it to
//    every member on every action, so one player's vote costs work
//    proportional to the group's size. The interesting number isn't the
//    actor's own round trip, it's how long the LAST member waits.
// 2. The app-wide emit. `notifyOpenGroupsChanged` does an `io.emit` to every
//    connected socket in the app whenever a listing changes — including
//    people playing in an unrelated group. This counts how many of those
//    each socket actually receives.
// 3. The rate limiter (20 burst, ~5/s per socket). The e2e suite had to be
//    paced around it, which means real clients can hit it too. Refusals are
//    counted rather than retried, so they show up instead of hiding.
// 4. Payload size. Every update carries the whole group, so the cost grows
//    with the group's history as well as with its player count.
//
// Usage:
//   npm run perf                              # 10 groups x 6 players, 1 round
//   npm run perf -- --groups 20 --players 8 --rounds 2
//   npm run perf -- --json perf-result.json
//
// Auth uses the same test-mode handshake the e2e suite uses, so the server
// must be running locally with AUTH_TEST_MODE=1. That is also why this
// refuses a non-localhost URL unless you pass --allow-remote: production
// rejects test-mode sign-in, and a load test is not something to point at a
// live site by accident.

import { io } from 'socket.io-client'

const RATE_LIMIT_MESSAGE = 'You are sending requests too quickly — please slow down'

function parseArgs(argv) {
  const args = {
    url: 'http://localhost:5000',
    groups: 10,
    players: 6,
    rounds: 1,
    ramp: 25,
    pace: 220,
    timeout: 30_000,
    json: null,
    allowRemote: false
  }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const next = () => argv[++i]
    if (flag === '--url') args.url = next()
    else if (flag === '--groups') args.groups = Number(next())
    else if (flag === '--players') args.players = Number(next())
    else if (flag === '--rounds') args.rounds = Number(next())
    else if (flag === '--ramp') args.ramp = Number(next())
    else if (flag === '--pace') args.pace = Number(next())
    else if (flag === '--timeout') args.timeout = Number(next())
    else if (flag === '--json') args.json = next()
    else if (flag === '--allow-remote') args.allowRemote = true
    else if (flag === '--help' || flag === '-h') args.help = true
    else throw new Error(`Unknown flag: ${flag}`)
  }
  return args
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------- measuring

class Samples {
  constructor(name) {
    this.name = name
    this.values = []
  }

  add(ms) {
    this.values.push(ms)
  }

  percentile(p) {
    if (this.values.length === 0) return null
    const sorted = [...this.values].sort((a, b) => a - b)
    const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
    return sorted[index]
  }

  get count() {
    return this.values.length
  }

  get max() {
    return this.values.length ? Math.max(...this.values) : null
  }

  get mean() {
    if (!this.values.length) return null
    return this.values.reduce((a, b) => a + b, 0) / this.values.length
  }
}

const ms = (value) => (value === null ? '—' : `${Math.round(value)}ms`)

// ------------------------------------------------------------------ clients

/**
 * One connected player. Keeps its own latest view of each group it is in,
 * the way the real client does, and records everything it receives so the
 * run can be measured from the receiving side rather than guessed at.
 */
function createPlayer(url, id, name, stats) {
  const socket = io(url, {
    transports: ['websocket'], forceNew: true, reconnection: false,
    auth: { testUser: { userId: id, name, avatar: '🎵' } }
  })

  const player = {
    id,
    socket,
    view: null,
    // Resolvers waiting for a group_updated that satisfies their predicate.
    waiters: [],
    lastActionAt: 0,
    openGroupsChangedCount: 0,
    rateLimited: 0,
    updatesReceived: 0,
    bytesReceived: 0
  }

  const startedAt = Date.now()
  player.ready = new Promise((resolve, reject) => {
    socket.once('session', () => {
      stats.connect.add(Date.now() - startedAt)
      resolve()
    })
    socket.once('connect_error', reject)
  })

  const keep = (payload) => {
    if (!payload?.group) return
    player.updatesReceived += 1
    // Every update carries the whole group; this is what that costs on the
    // wire, measured rather than assumed.
    const size = JSON.stringify(payload).length
    player.bytesReceived += size
    stats.payload.add(size)
    player.view = { ...(player.view || {}), ...payload }
    player.waiters = player.waiters.filter((waiter) => {
      if (!waiter.match(payload)) return true
      waiter.resolve(payload)
      return false
    })
  }

  socket.on('group_updated', keep)
  socket.on('group_details', keep)
  socket.on('group_joined', keep)
  socket.on('open_groups_changed', () => { player.openGroupsChangedCount += 1 })
  socket.on('error', ({ message } = {}) => {
    if (message === RATE_LIMIT_MESSAGE) {
      player.rateLimited += 1
      stats.rateLimited += 1
    } else {
      // Printed as it happens: a run that stalls is usually a refused action,
      // and waiting for the summary would hide the reason behind a timeout.
      console.error(`  server error → ${id}: ${message}`)
      stats.errors.push(`${id}: ${message}`)
    }
  })

  return player
}

function waitForUpdate(player, match, timeoutMs) {
  if (player.view && match(player.view)) return Promise.resolve(player.view)
  return new Promise((resolve, reject) => {
    const waiter = { match, resolve }
    const timer = setTimeout(() => {
      player.waiters = player.waiters.filter((w) => w !== waiter)
      reject(new Error(`${player.id}: no matching update within ${timeoutMs}ms`))
    }, timeoutMs)
    waiter.resolve = (payload) => {
      clearTimeout(timer)
      resolve(payload)
    }
    player.waiters.push(waiter)
  })
}

/**
 * Emits an action and measures two different things: how long the acting
 * player waited, and how long the last OTHER member of the group waited.
 * The second is the fan-out cost, and it is the one that grows with group
 * size.
 */
async function act(actor, others, { event, payload, match }, stats, args) {
  const since = Date.now() - actor.lastActionAt
  if (since < args.pace) await sleep(args.pace - since)

  const startedAt = Date.now()
  const actorSaw = waitForUpdate(actor, match, args.timeout)
  const othersSaw = others.map((p) => waitForUpdate(p, match, args.timeout))

  actor.socket.emit(event, payload)
  actor.lastActionAt = Date.now()

  await actorSaw
  stats.actorRoundTrip.add(Date.now() - startedAt)

  if (othersSaw.length) {
    await Promise.all(othersSaw)
    // Everyone has it now, so this is the time the last member waited.
    stats.fanOut.add(Date.now() - startedAt)
  }
}

// --------------------------------------------------------------------- game

const phaseIs = (groupId, phase) => (view) =>
  view.group?.id === groupId && view.group?.currentTheme?.status === phase

async function buildGroup(args, stats, index, runId) {
  const players = []
  for (let i = 0; i < args.players; i += 1) {
    players.push(createPlayer(args.url, `perf-g${index}p${i}-${runId}`, `Perf ${index}-${i}`, stats))
    if (args.ramp) await sleep(args.ramp)
  }
  await Promise.all(players.map((p) => p.ready))

  const [host] = players
  const created = new Promise((resolve) => host.socket.once('group_created', resolve))
  host.socket.emit('create_group', {
    groupData: { name: `Perf ${index} ${runId}`, settings: { totalRounds: Math.max(args.rounds, 1) } }
  })
  const { group } = await created

  for (const player of players.slice(1)) {
    const joined = new Promise((resolve) => player.socket.once('group_joined', resolve))
    player.socket.emit('join_group', { inviteCode: group.inviteCode })
    await joined
    await sleep(args.pace)
  }

  return { id: group.id, players, host }
}

async function playRound(group, args, stats, runId, round) {
  const { id: groupId, players } = group
  const judge = players.find((p) => p.view?.isRoundLeader === true)
  if (!judge) throw new Error(`group ${groupId}: no Judge in round ${round}`)
  const others = players.filter((p) => p !== judge)

  // The Judge needs a topic to pick.
  const created = new Promise((resolve) => judge.socket.once('topic_submitted', resolve))
  judge.socket.emit('submit_topic', { text: `Perf topic r${round} ${groupId}`, isPublic: false })
  const { topic } = await created
  await sleep(args.pace)

  await act(judge, others, {
    event: 'select_topic',
    payload: { groupId, topicId: topic.id },
    match: phaseIs(groupId, 'submission')
  }, stats, args)

  // Mid-submission the server hides the submissions themselves and publishes
  // only a count (publicizeTheme), so that count is what every member can
  // actually watch. Expecting one more than the actor last saw keeps the
  // wait honest: a stale view can't satisfy it.
  for (const [i, player] of others.entries()) {
    const videoId = `p${round}${i}`.padEnd(11, 'x').slice(0, 11)
    const expected = (player.view?.group?.currentTheme?.submissionCount || 0) + 1
    await act(player, players.filter((p) => p !== player), {
      event: 'submit_video',
      payload: {
        groupId, videoId, title: `Perf song ${round}-${i}`,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`, channelTitle: 'Perf'
      },
      match: (view) => view.group?.id === groupId
        && (view.group?.currentTheme?.submissionCount || 0) >= expected
    }, stats, args)
  }

  // Submissions close on their own once everyone has submitted; wait for the
  // phase rather than forcing it, so this measures the server's own path.
  await Promise.all(players.map((p) => waitForUpdate(p, phaseIs(groupId, 'voting'), args.timeout)))

  for (const player of others) {
    const view = player.view
    const target = view.group.currentTheme.submissions.find((sub) => sub.id !== view.yourSubmissionId)
    if (!target) continue
    const expected = (view.group?.currentTheme?.voteCount || 0) + 1
    await act(player, players.filter((p) => p !== player), {
      event: 'cast_vote',
      payload: { groupId, submissionId: target.id, points: 1 },
      match: (v) => v.group?.id === groupId
        && (v.group?.currentTheme?.voteCount || 0) >= expected
    }, stats, args)
  }

  const winner = judge.view.group.currentTheme.submissions[0]
  await act(judge, others, {
    event: 'czar_select_winner',
    payload: { groupId, submissionId: winner.id },
    match: phaseIs(groupId, 'reveal')
  }, stats, args)
}

// -------------------------------------------------------------------- report

function report(args, stats, players, wallMs) {
  const openGroupsChanged = players.map((p) => p.openGroupsChangedCount)
  const totalUpdates = players.reduce((sum, p) => sum + p.updatesReceived, 0)
  const totalBytes = players.reduce((sum, p) => sum + p.bytesReceived, 0)

  const rows = [
    ['Socket connect', stats.connect],
    ['Actor round trip', stats.actorRoundTrip],
    ['Fan-out (last member sees it)', stats.fanOut]
  ]

  const lines = []
  lines.push('')
  lines.push(`Prompted load test — ${args.groups} groups x ${args.players} players, ${args.rounds} round(s)`)
  lines.push(`${args.url}   pace ${args.pace}ms/socket   wall ${(wallMs / 1000).toFixed(1)}s`)
  lines.push('')
  lines.push('| Measurement                   |    n |   p50 |   p95 |   max |')
  lines.push('|-------------------------------|------|-------|-------|-------|')
  for (const [label, sample] of rows) {
    lines.push(`| ${label.padEnd(29)} | ${String(sample.count).padStart(4)} | ${ms(sample.percentile(50)).padStart(5)} | ${ms(sample.percentile(95)).padStart(5)} | ${ms(sample.max).padStart(5)} |`)
  }
  lines.push('')
  lines.push(`Sockets                     ${players.length}`)
  lines.push(`Updates received (total)    ${totalUpdates}`)
  lines.push(`Update payload p50 / max    ${Math.round(stats.payload.percentile(50) || 0)} B / ${Math.round(stats.payload.max || 0)} B`)
  lines.push(`Data pushed to clients      ${(totalBytes / 1024 / 1024).toFixed(2)} MB`)
  lines.push(`open_groups_changed / socket ${Math.min(...openGroupsChanged)}–${Math.max(...openGroupsChanged)} (app-wide emit)`)
  lines.push(`Rate-limit refusals         ${stats.rateLimited}`)
  lines.push(`Other server errors         ${stats.errors.length}`)
  for (const error of stats.errors.slice(0, 5)) lines.push(`  - ${error}`)
  if (stats.errors.length > 5) lines.push(`  ... and ${stats.errors.length - 5} more`)
  lines.push('')

  return {
    text: lines.join('\n'),
    json: {
      config: { url: args.url, groups: args.groups, players: args.players, rounds: args.rounds, pace: args.pace },
      wallMs,
      sockets: players.length,
      connect: summarize(stats.connect),
      actorRoundTrip: summarize(stats.actorRoundTrip),
      fanOut: summarize(stats.fanOut),
      payloadBytes: summarize(stats.payload),
      updatesReceived: totalUpdates,
      bytesPushed: totalBytes,
      openGroupsChangedPerSocket: { min: Math.min(...openGroupsChanged), max: Math.max(...openGroupsChanged) },
      rateLimited: stats.rateLimited,
      errors: stats.errors
    }
  }
}

const summarize = (sample) => ({
  n: sample.count,
  p50: sample.percentile(50),
  p95: sample.percentile(95),
  p99: sample.percentile(99),
  max: sample.max,
  mean: sample.mean
})

// ---------------------------------------------------------------------- run

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log('npm run perf -- [--groups N] [--players N] [--rounds N] [--url URL] [--pace MS] [--json FILE]')
    return
  }

  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(args.url)
  if (!isLocal && !args.allowRemote) {
    throw new Error(`Refusing to load-test ${args.url}. Pass --allow-remote if you really mean it.`)
  }

  const stats = {
    connect: new Samples('connect'),
    actorRoundTrip: new Samples('actorRoundTrip'),
    fanOut: new Samples('fanOut'),
    payload: new Samples('payload'),
    rateLimited: 0,
    errors: []
  }

  const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const startedAt = Date.now()
  const groups = []

  console.log(`Building ${args.groups} groups of ${args.players}...`)
  for (let i = 0; i < args.groups; i += 1) {
    groups.push(await buildGroup(args, stats, i, runId))
  }

  const allPlayers = groups.flatMap((g) => g.players)
  console.log(`${allPlayers.length} sockets connected. Starting rounds...`)

  // Every group starts at once: this is the point of the exercise, so that
  // the fan-out of one group overlaps with every other group's.
  await Promise.all(groups.map(async (group) => {
    await act(group.host, group.players.filter((p) => p !== group.host), {
      event: 'start_group',
      payload: { groupId: group.id },
      match: (view) => view.group?.id === group.id && view.group?.status === 'active'
    }, stats, args)
  }))

  for (let round = 1; round <= args.rounds; round += 1) {
    console.log(`Round ${round} of ${args.rounds}...`)
    await Promise.all(groups.map((group) => playRound(group, args, stats, runId, round)))
    if (round < args.rounds) {
      await Promise.all(groups.map(async (group) => {
        await sleep(args.pace)
        await act(group.host, group.players.filter((p) => p !== group.host), {
          event: 'start_round',
          payload: { groupId: group.id },
          match: phaseIs(group.id, 'topic_selection')
        }, stats, args)
      }))
    }
  }

  const wallMs = Date.now() - startedAt
  const { text, json } = report(args, stats, allPlayers, wallMs)
  console.log(text)

  if (args.json) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(args.json, JSON.stringify(json, null, 2))
    console.log(`Wrote ${args.json}`)
  }

  allPlayers.forEach((p) => p.socket.close())
}

main().catch((error) => {
  console.error(`\nLoad test failed: ${error.message}`)
  process.exit(1)
})
