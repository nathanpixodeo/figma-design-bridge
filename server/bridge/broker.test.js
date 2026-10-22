const test = require('node:test')
const assert = require('node:assert/strict')
const createBroker = require('./broker')

// ── Fake clock / timer harness ──────────────────────────────
//
// Every test injects this instead of real Date.now/setTimeout so timeout and
// session-expiry behavior is deterministic and instant (no real sleeps).

function createFakeClock(start = 1_000_000) {
  let currentTime = start
  let nextId = 1
  const timers = new Map() // id -> { time, fn }

  function now() {
    return currentTime
  }

  function setTimer(fn, delay) {
    const id = nextId++
    timers.set(id, { time: currentTime + Math.max(0, delay || 0), fn })
    return id
  }

  function clearTimer(id) {
    timers.delete(id)
  }

  // Fires all timers due at or before currentTime + ms, in time order,
  // then lands the clock exactly on the target time.
  function advance(ms) {
    const target = currentTime + ms
    for (;;) {
      let dueId = null
      let dueTime = Infinity
      for (const [id, t] of timers) {
        if (t.time <= target && (t.time < dueTime || (t.time === dueTime && id < dueId))) {
          dueId = id
          dueTime = t.time
        }
      }
      if (dueId === null) break
      const entry = timers.get(dueId)
      timers.delete(dueId)
      currentTime = entry.time
      entry.fn()
    }
    currentTime = target
  }

  function pendingCount() {
    return timers.size
  }

  return { now, setTimer, clearTimer, advance, pendingCount }
}

function makeHarness(overrides = {}) {
  const clock = createFakeClock()
  const broker = createBroker({
    requestTimeoutMs: 1000,
    sessionTimeoutMs: 5000,
    maxQueuePerSession: 32,
    maxPendingRequests: 256,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...overrides,
  })
  return { broker, clock }
}

let pluginCounter = 0
function registerTestSession(broker, overrides = {}) {
  pluginCounter += 1
  return broker.registerSession({
    fileKey: 'FILE_DEFAULT',
    fileName: 'Default File',
    pluginInstanceId: `plugin-${pluginCounter}`,
    capabilities: { readNode: true },
    ...overrides,
  })
}

// ── Requirement 1: wrong-file isolation ─────────────────────

test('a request for file X is never queued to nor answerable by a session for file Y', async () => {
  const { broker, clock } = makeHarness()
  const sessionX = registerTestSession(broker, { fileKey: 'FILE_X', pluginInstanceId: 'plugin-x' })
  const sessionY = registerTestSession(broker, { fileKey: 'FILE_Y', pluginInstanceId: 'plugin-y' })

  const pending = broker.request({ fileKey: 'FILE_X', op: 'read-node', params: { nodeId: '1:1' }, timeoutMs: 200 })

  // The other file's session must never see this request in its queue.
  // Its queue is empty, so poll() only settles via its internal wait timer —
  // advance the fake clock past waitMs or this await would hang forever.
  const pollYPromise = broker.poll(sessionY.sessionId, sessionY.sessionSecret, { waitMs: 10 })
  clock.advance(10)
  const pollY = await pollYPromise
  assert.equal(pollY.requests.length, 0)

  // The owning session does see it.
  const pollX = await broker.poll(sessionX.sessionId, sessionX.sessionSecret, { waitMs: 10 })
  assert.equal(pollX.requests.length, 1)
  const { requestId } = pollX.requests[0]

  // Session Y attempting to answer file X's request must be rejected, not accepted.
  const wrongReply = broker.reply(sessionY.sessionId, sessionY.sessionSecret, { requestId, ok: true, result: { hijacked: true } })
  assert.equal(wrongReply.accepted, false)

  // The asker must still be waiting (and eventually time out) — never resolved by session Y.
  clock.advance(200)
  await assert.rejects(pending, { code: 'TIMEOUT' })
})

// ── Requirement 2: wrong-session reply rejected (same file) ─

test('two live sessions for the same fileKey: a request handed to session 1 cannot be settled by session 2', async () => {
  const { broker } = makeHarness()
  const session1 = registerTestSession(broker, { fileKey: 'FILE_Z', pluginInstanceId: 'plugin-1' })

  const pending = broker.request({ fileKey: 'FILE_Z', op: 'ping' })
  const poll1 = await broker.poll(session1.sessionId, session1.sessionSecret, { waitMs: 10 })
  assert.equal(poll1.requests.length, 1)
  const { requestId } = poll1.requests[0]

  // A second live session registers for the exact same file afterwards.
  const session2 = registerTestSession(broker, { fileKey: 'FILE_Z', pluginInstanceId: 'plugin-2' })

  const wrongReply = broker.reply(session2.sessionId, session2.sessionSecret, { requestId, ok: true, result: { from: 'session2' } })
  assert.deepEqual(wrongReply, { accepted: false, reason: 'WRONG_SESSION' })

  const rightReply = broker.reply(session1.sessionId, session1.sessionSecret, { requestId, ok: true, result: { from: 'session1' } })
  assert.equal(rightReply.accepted, true)

  const settled = await pending
  assert.equal(settled.result.from, 'session1')
  assert.equal(settled.sessionId, session1.sessionId)
})

// ── Requirement 3: late reply ignored ───────────────────────

test('a reply arriving after the request already timed out is rejected without throwing or corrupting state', async () => {
  const { broker, clock } = makeHarness()
  const session = registerTestSession(broker)

  const pending = broker.request({ fileKey: 'FILE_DEFAULT', op: 'ping', timeoutMs: 100 })
  const polled = await broker.poll(session.sessionId, session.sessionSecret, { waitMs: 10 })
  const { requestId } = polled.requests[0]

  clock.advance(100)
  await assert.rejects(pending, { code: 'TIMEOUT' })

  let lateReply
  assert.doesNotThrow(() => {
    lateReply = broker.reply(session.sessionId, session.sessionSecret, { requestId, ok: true, result: { tooLate: true } })
  })
  assert.equal(lateReply.accepted, false)
  assert.equal(lateReply.reason, 'REQUEST_TIMED_OUT')
  // What the late result answers, so the caller can keep it for the next asker.
  assert.deepEqual(lateReply.late, { requestId, fileKey: 'FILE_DEFAULT', op: 'ping', params: {}, sessionId: session.sessionId })

  // State must be clean: nothing left pending/queued for this session.
  const stats = broker.stats()
  assert.equal(stats.pendingRequests, 0)
  assert.equal(stats.queuedRequests, 0)
  const [listed] = broker.listSessions()
  assert.equal(listed.pendingCount, 0)
})

// ── Requirement 4: timeout releases ALL waiters and clears the queue ─

test('on timeout every coalesced waiter rejects with TIMEOUT and the request is removed from the queue', async () => {
  const { broker, clock } = makeHarness()
  const session = registerTestSession(broker)

  const p1 = broker.request({ fileKey: 'FILE_DEFAULT', op: 'ping', dedupeKey: 'k1', timeoutMs: 100 })
  const p2 = broker.request({ fileKey: 'FILE_DEFAULT', op: 'ping', dedupeKey: 'k1', timeoutMs: 100 })

  clock.advance(100)

  await assert.rejects(p1, { code: 'TIMEOUT' })
  await assert.rejects(p2, { code: 'TIMEOUT' })

  // A later poll must never hand out the now-dead request. Queue is empty
  // now (the timed-out request was spliced out), so again advance past waitMs.
  const polledPromise = broker.poll(session.sessionId, session.sessionSecret, { waitMs: 10 })
  clock.advance(10)
  const polled = await polledPromise
  assert.equal(polled.requests.length, 0)
})

// ── Requirement 5: coalescing ───────────────────────────────

test('concurrent requests sharing a dedupeKey coalesce into one queued request; a later call starts a fresh one', async () => {
  const { broker } = makeHarness()
  const session = registerTestSession(broker)

  const p1 = broker.request({ fileKey: 'FILE_DEFAULT', op: 'read-node', params: { nodeId: '1:1' }, dedupeKey: 'node-1:1' })
  const p2 = broker.request({ fileKey: 'FILE_DEFAULT', op: 'read-node', params: { nodeId: '1:1' }, dedupeKey: 'node-1:1' })

  assert.equal(broker.stats().pendingRequests, 1)
  assert.equal(broker.stats().coalescedHits, 1)

  const polled = await broker.poll(session.sessionId, session.sessionSecret, { waitMs: 10 })
  assert.equal(polled.requests.length, 1)
  const firstRequestId = polled.requests[0].requestId

  broker.reply(session.sessionId, session.sessionSecret, { requestId: firstRequestId, ok: true, result: { value: 'shared' } })

  const [r1, r2] = await Promise.all([p1, p2])
  assert.equal(r1.result.value, 'shared')
  assert.equal(r2.result.value, 'shared')
  assert.equal(r1.requestId, firstRequestId)
  assert.equal(r2.requestId, firstRequestId)

  // Same dedupeKey again, AFTER settling: must be a brand-new request, not a stale reuse.
  const p3 = broker.request({ fileKey: 'FILE_DEFAULT', op: 'read-node', params: { nodeId: '1:1' }, dedupeKey: 'node-1:1' })
  const polledAgain = await broker.poll(session.sessionId, session.sessionSecret, { waitMs: 10 })
  assert.equal(polledAgain.requests.length, 1)
  const secondRequestId = polledAgain.requests[0].requestId
  assert.notEqual(secondRequestId, firstRequestId)

  broker.reply(session.sessionId, session.sessionSecret, { requestId: secondRequestId, ok: true, result: { value: 'fresh' } })
  const r3 = await p3
  assert.equal(r3.result.value, 'fresh')
})

// ── Requirement 6: session loss ─────────────────────────────

test('closeSession rejects every in-flight request of that session with SESSION_LOST', async () => {
  const { broker } = makeHarness()
  const session = registerTestSession(broker)

  const p1 = broker.request({ fileKey: 'FILE_DEFAULT', op: 'ping' })
  const p2 = broker.request({ fileKey: 'FILE_DEFAULT', op: 'read-document-index' })

  const result = broker.closeSession(session.sessionId, session.sessionSecret, 'plugin closed by user')
  assert.deepEqual(result, { closed: true, rejected: 2 })

  await assert.rejects(p1, { code: 'SESSION_LOST' })
  await assert.rejects(p2, { code: 'SESSION_LOST' })
  assert.equal(broker.hasSessionForFile('FILE_DEFAULT'), false)
})

test('a session that misses its heartbeat/poll window is expired by the clock and its requests reject with SESSION_LOST', async () => {
  const { broker, clock } = makeHarness({ sessionTimeoutMs: 300 })
  const session = registerTestSession(broker)

  const pending = broker.request({ fileKey: 'FILE_DEFAULT', op: 'ping', timeoutMs: 10_000 })

  clock.advance(300)

  await assert.rejects(pending, { code: 'SESSION_LOST', message: /stopped answering while it had this read.*too large for its memory/ })
  assert.equal(broker.hasSessionForFile('FILE_DEFAULT'), false)
  const [listed] = broker.listSessions()
  assert.equal(listed.alive, false)
})

test('re-registering the same pluginInstanceId replaces the old session and rejects its in-flight requests', async () => {
  const { broker, clock } = makeHarness()
  const first = registerTestSession(broker, { pluginInstanceId: 'same-plugin' })
  const pending = broker.request({ fileKey: 'FILE_DEFAULT', op: 'ping' })

  const second = registerTestSession(broker, { pluginInstanceId: 'same-plugin' })
  assert.notEqual(second.sessionId, first.sessionId)

  await assert.rejects(pending, { code: 'SESSION_LOST' })

  // The new session is the only live one, and never inherits the old queue.
  const sessions = broker.listSessions()
  const alive = sessions.filter(s => s.alive)
  assert.equal(alive.length, 1)
  assert.equal(alive[0].sessionId, second.sessionId)
  assert.equal(alive[0].pendingCount, 0)

  const polledPromise = broker.poll(second.sessionId, second.sessionSecret, { waitMs: 10 })
  clock.advance(10)
  const polled = await polledPromise
  assert.equal(polled.requests.length, 0)
})

// ── Requirement 7: backpressure ─────────────────────────────

test('exceeding maxQueuePerSession rejects QUEUE_FULL and exceeding maxPendingRequests rejects TOO_MANY_PENDING, with no leaked timers', async () => {
  const { broker, clock } = makeHarness({ maxQueuePerSession: 2, maxPendingRequests: 3 })
  registerTestSession(broker, { fileKey: 'FILE_A', pluginInstanceId: 'plugin-a' })
  registerTestSession(broker, { fileKey: 'FILE_B', pluginInstanceId: 'plugin-b' })

  const a1 = broker.request({ fileKey: 'FILE_A', op: 'ping' })
  const a2 = broker.request({ fileKey: 'FILE_A', op: 'ping' })
  // Session A's queue is now full (maxQueuePerSession = 2).
  await assert.rejects(broker.request({ fileKey: 'FILE_A', op: 'ping' }), { code: 'QUEUE_FULL', fileKey: 'FILE_A' })

  const b1 = broker.request({ fileKey: 'FILE_B', op: 'ping' })
  // Global pending cap (maxPendingRequests = 3) is now reached (a1, a2, b1).
  await assert.rejects(broker.request({ fileKey: 'FILE_B', op: 'ping' }), { code: 'TOO_MANY_PENDING' })

  // Clean everything up and confirm no timer / memory was leaked.
  broker.cancelAll('test cleanup')
  await assert.rejects(a1, { code: 'SESSION_LOST' })
  await assert.rejects(a2, { code: 'SESSION_LOST' })
  await assert.rejects(b1, { code: 'SESSION_LOST' })
  assert.equal(clock.pendingCount(), 0)
  assert.deepEqual(broker.stats(), { sessions: 0, pendingRequests: 0, queuedRequests: 0, coalescedHits: 0 })
})

// ── Requirement 8: auth ─────────────────────────────────────

test('wrong sessionSecret on heartbeat/poll/reply/closeSession is rejected with UNAUTHORIZED and has no side effect', async () => {
  const { broker } = makeHarness()
  const session = registerTestSession(broker)

  assert.match(session.sessionSecret, /^[0-9a-f]{64}$/)

  const wrongSameLength = flipLastHexChar(session.sessionSecret)
  const wrongShort = 'ab'
  const unknownSessionId = 'not-a-real-session-id'

  assert.throws(() => broker.heartbeat(session.sessionId, wrongSameLength), { code: 'UNAUTHORIZED' })
  assert.throws(() => broker.heartbeat(session.sessionId, wrongShort), { code: 'UNAUTHORIZED' })
  assert.throws(() => broker.heartbeat(unknownSessionId, session.sessionSecret), { code: 'UNAUTHORIZED' })

  await assert.rejects(broker.poll(session.sessionId, wrongSameLength, { waitMs: 10 }), { code: 'UNAUTHORIZED' })
  assert.throws(() => broker.reply(session.sessionId, wrongShort, { requestId: 'x', ok: true }), { code: 'UNAUTHORIZED' })
  assert.throws(() => broker.closeSession(session.sessionId, wrongSameLength), { code: 'UNAUTHORIZED' })

  // No side effect: the session is still alive and usable with the correct secret.
  const ok = broker.heartbeat(session.sessionId, session.sessionSecret)
  assert.deepEqual(ok, { ok: true, pendingCount: 0 })
  assert.equal(broker.hasSessionForFile('FILE_DEFAULT'), true)
})

test('two sessions never receive the same sessionSecret', () => {
  const { broker } = makeHarness()
  const s1 = registerTestSession(broker, { pluginInstanceId: 'p1', fileKey: 'FILE_A' })
  const s2 = registerTestSession(broker, { pluginInstanceId: 'p2', fileKey: 'FILE_B' })
  assert.notEqual(s1.sessionSecret, s2.sessionSecret)
})

function flipLastHexChar(hex) {
  const last = hex.slice(-1)
  const replacement = last === '0' ? '1' : '0'
  return hex.slice(0, -1) + replacement
}

// ── Requirement 9: no secret leakage ────────────────────────

test('listSessions() and stats() never expose sessionSecret, even serialized to JSON', () => {
  const { broker } = makeHarness()
  const session = registerTestSession(broker)

  const sessionsJson = JSON.stringify(broker.listSessions())
  const statsJson = JSON.stringify(broker.stats())

  assert.equal(sessionsJson.includes(session.sessionSecret), false)
  assert.equal(statsJson.includes(session.sessionSecret), false)

  for (const entry of broker.listSessions()) {
    assert.equal('sessionSecret' in entry, false)
    assert.equal('secret' in entry, false)
  }
})

// ── Requirement 10: clean shutdown ──────────────────────────

test('cancelAll rejects every pending request and resolves (does not hang) an in-flight long-poll', async () => {
  const { broker, clock } = makeHarness()
  const sessionA = registerTestSession(broker, { fileKey: 'FILE_A', pluginInstanceId: 'plugin-a' })
  const sessionB = registerTestSession(broker, { fileKey: 'FILE_B', pluginInstanceId: 'plugin-b' })

  // Session A: a request sits queued; nobody has polled for it yet.
  const queuedOnA = broker.request({ fileKey: 'FILE_A', op: 'ping' })

  // Session B: a poll is actively waiting (its queue is empty).
  const waitingPollOnB = broker.poll(sessionB.sessionId, sessionB.sessionSecret, { waitMs: 50_000 })

  broker.cancelAll('shutting down for test')

  await assert.rejects(queuedOnA, { code: 'SESSION_LOST' })
  const resolvedPoll = await waitingPollOnB
  assert.deepEqual(resolvedPoll, { requests: [] })

  assert.equal(clock.pendingCount(), 0)
  assert.deepEqual(broker.listSessions(), [])
  assert.deepEqual(broker.stats(), { sessions: 0, pendingRequests: 0, queuedRequests: 0, coalescedHits: 0 })
})

test('with real timers (default options), a broker still settles and cancelAll leaves nothing scheduled', async () => {
  const broker = createBroker({ requestTimeoutMs: 20, sessionTimeoutMs: 500 })
  broker.registerSession({ fileKey: 'FILE_REAL', fileName: 'Real', pluginInstanceId: 'real-plugin' })

  const pending = broker.request({ fileKey: 'FILE_REAL', op: 'ping', timeoutMs: 20 })
  await assert.rejects(pending, { code: 'TIMEOUT' })

  broker.cancelAll('done')
  assert.deepEqual(broker.listSessions(), [])
})

// ── Requirement 11: long-poll fairness ──────────────────────

test('a poll already waiting is woken immediately by a new request, not left to sit out its full waitMs', async () => {
  const { broker } = makeHarness()
  const session = registerTestSession(broker)

  const pollPromise = broker.poll(session.sessionId, session.sessionSecret, { waitMs: 60_000 })

  // Deliberately never advance the clock: if this relied on the wait timer,
  // the await below would hang and fail the test on its own timeout.
  const requestPromise = broker.request({ fileKey: 'FILE_DEFAULT', op: 'ping' })
  const polled = await pollPromise

  assert.equal(polled.requests.length, 1)
  assert.equal(polled.requests[0].op, 'ping')

  broker.reply(session.sessionId, session.sessionSecret, { requestId: polled.requests[0].requestId, ok: true, result: {} })
  await requestPromise
})

// ── Routing between sessions of one file ────────────────────

function pendingCountOf(broker, sessionId) {
  return broker.listSessions().find(session => session.sessionId === sessionId).pendingCount
}

test('a read goes to the session heard from most recently, not to an older one a crashed plugin left behind', async () => {
  const { broker, clock } = makeHarness()
  // The old plugin crashed, or its panel was reopened: it is never heard from
  // again, but its session stays registered until it expires.
  const old = registerTestSession(broker, { fileKey: 'FILE_R', pluginInstanceId: 'plugin-old' })
  clock.advance(1000)
  const fresh = registerTestSession(broker, { fileKey: 'FILE_R', pluginInstanceId: 'plugin-new' })
  const freshPoll = broker.poll(fresh.sessionId, fresh.sessionSecret, { waitMs: 60_000 })

  const pending = broker.request({ fileKey: 'FILE_R', op: 'ping' })
  assert.equal(pendingCountOf(broker, fresh.sessionId), 1)
  assert.equal(pendingCountOf(broker, old.sessionId), 0)
  const { requests: [delivered] } = await freshPoll
  broker.reply(fresh.sessionId, fresh.sessionSecret, { requestId: delivered.requestId, ok: true, result: {} })
  assert.equal((await pending).sessionId, fresh.sessionId)

  // The newer session did not close the older one: if that plugin is in fact
  // still running and is heard from again, it serves the file too.
  assert.equal(broker.listSessions().filter(session => session.alive).length, 2)
  clock.advance(1000)
  broker.heartbeat(old.sessionId, old.sessionSecret)
  const next = broker.request({ fileKey: 'FILE_R', op: 'ping' })
  assert.equal(pendingCountOf(broker, old.sessionId), 1)
  broker.cancelAll('test cleanup')
  await assert.rejects(next, { code: 'SESSION_LOST' })
})

test('between sessions heard from at the same moment, the one with a poll waiting takes the read', async () => {
  const { broker } = makeHarness()
  const polling = registerTestSession(broker, { fileKey: 'FILE_T', pluginInstanceId: 'plugin-polling' })
  const idle = registerTestSession(broker, { fileKey: 'FILE_T', pluginInstanceId: 'plugin-idle' })
  const waiting = broker.poll(polling.sessionId, polling.sessionSecret, { waitMs: 60_000 })

  const pending = broker.request({ fileKey: 'FILE_T', op: 'ping' })
  assert.equal(pendingCountOf(broker, polling.sessionId), 1)
  assert.equal(pendingCountOf(broker, idle.sessionId), 0)
  const { requests: [delivered] } = await waiting
  broker.reply(polling.sessionId, polling.sessionSecret, { requestId: delivered.requestId, ok: true, result: {} })
  await pending
})

// ── Polls whose answer never reaches the plugin ─────────────
//
// The HTTP layer aborts a poll's signal when the plugin hung up before the
// poll's answer was fully sent.

test('a poll abandoned while it waits is dropped, so a read arriving afterwards waits for the next poll', async () => {
  const { broker } = makeHarness()
  const session = registerTestSession(broker)
  const connection = new AbortController()
  const abandoned = broker.poll(session.sessionId, session.sessionSecret, { waitMs: 60_000, signal: connection.signal })

  connection.abort()
  const pending = broker.request({ fileKey: 'FILE_DEFAULT', op: 'ping' })
  assert.equal(broker.stats().queuedRequests, 1, 'the read was handed to a poll nobody is listening to')
  assert.deepEqual(await abandoned, { requests: [] })

  const next = await broker.poll(session.sessionId, session.sessionSecret, { waitMs: 10 })
  assert.equal(next.requests.length, 1)
  broker.reply(session.sessionId, session.sessionSecret, { requestId: next.requests[0].requestId, ok: true, result: {} })
  await pending
})

test('reads handed to a poll whose answer never reached the plugin go back to the front of the queue; answered ones do not', async () => {
  const { broker } = makeHarness()
  const session = registerTestSession(broker)
  const lostConnection = new AbortController()
  const lost = broker.poll(session.sessionId, session.sessionSecret, { waitMs: 60_000, signal: lostConnection.signal })
  const first = broker.request({ fileKey: 'FILE_DEFAULT', op: 'ping' })
  const { requests: handed } = await lost
  const second = broker.request({ fileKey: 'FILE_DEFAULT', op: 'read-document-index' })

  lostConnection.abort()
  const connection = new AbortController()
  const next = await broker.poll(session.sessionId, session.sessionSecret, { waitMs: 10, signal: connection.signal })
  assert.deepEqual(next.requests.map(request => request.op), ['ping', 'read-document-index'])
  assert.equal(next.requests[0].requestId, handed[0].requestId)

  for (const request of next.requests) {
    broker.reply(session.sessionId, session.sessionSecret, { requestId: request.requestId, ok: true, result: { op: request.op } })
  }
  assert.equal((await first).result.op, 'ping')
  assert.equal((await second).result.op, 'read-document-index')

  // Losing a poll whose reads were already answered gives nothing back.
  connection.abort()
  assert.equal(broker.stats().queuedRequests, 0)
})

test('a read given back by a lost poll goes straight to a poll already waiting', async () => {
  const { broker, clock } = makeHarness()
  const session = registerTestSession(broker)
  const lostConnection = new AbortController()
  const lost = broker.poll(session.sessionId, session.sessionSecret, { waitMs: 60_000, signal: lostConnection.signal })
  const pending = broker.request({ fileKey: 'FILE_DEFAULT', op: 'ping' })
  const { requests: [handed] } = await lost

  const waiting = broker.poll(session.sessionId, session.sessionSecret, { waitMs: 10 })
  lostConnection.abort()
  clock.advance(10)
  const { requests } = await waiting
  assert.deepEqual(requests.map(request => request.requestId), [handed.requestId])

  broker.reply(session.sessionId, session.sessionSecret, { requestId: handed.requestId, ok: true, result: {} })
  await pending
})

// ── Validation ───────────────────────────────────────────────

test('request() rejects unknown op, non-plain params, oversized params and empty fileKey with BAD_REQUEST', async () => {
  const { broker } = makeHarness()
  registerTestSession(broker)

  await assert.rejects(broker.request({ fileKey: 'FILE_DEFAULT', op: 'delete-everything' }), { code: 'BAD_REQUEST' })
  await assert.rejects(broker.request({ fileKey: 'FILE_DEFAULT', op: 'ping', params: [] }), { code: 'BAD_REQUEST' })
  await assert.rejects(broker.request({ fileKey: 'FILE_DEFAULT', op: 'ping', params: function bad() {} }), { code: 'BAD_REQUEST' })
  await assert.rejects(broker.request({ fileKey: 'FILE_DEFAULT', op: 'ping', params: { blob: 'x'.repeat(300_000) } }), { code: 'BAD_REQUEST' })
  await assert.rejects(broker.request({ fileKey: '', op: 'ping' }), { code: 'BAD_REQUEST' })
  await assert.rejects(broker.request({ fileKey: 'FILE_DEFAULT', op: 'ping', timeoutMs: -5 }), { code: 'BAD_REQUEST' })
  await assert.rejects(broker.request({ fileKey: 'FILE_DEFAULT', op: 'ping', dedupeKey: '' }), { code: 'BAD_REQUEST' })
})

test('registerSession rejects a missing fileKey or pluginInstanceId with BAD_REQUEST', () => {
  const { broker } = makeHarness()
  assert.throws(() => broker.registerSession({ fileKey: '', pluginInstanceId: 'p' }), { code: 'BAD_REQUEST' })
  assert.throws(() => broker.registerSession({ fileKey: 'FILE_X', pluginInstanceId: '' }), { code: 'BAD_REQUEST' })
})

// ── Acceptance case 3: missing node / wrong file / offline / timeout are distinguishable ─

test('missing node, wrong file (no session), and timeout each produce a distinct error code', async () => {
  const { broker, clock } = makeHarness()
  const session = registerTestSession(broker, { fileKey: 'FILE_HAS_PLUGIN' })

  // Wrong file / plugin offline: nobody registered FILE_NO_PLUGIN at all.
  await assert.rejects(
    broker.request({ fileKey: 'FILE_NO_PLUGIN', op: 'read-node', params: { nodeId: '9:9' } }),
    { code: 'NO_SESSION_FOR_FILE', fileKey: 'FILE_NO_PLUGIN' },
  )

  // Missing/deleted node: the plugin is live and answers, but reports its own error.
  const missingNodePending = broker.request({ fileKey: 'FILE_HAS_PLUGIN', op: 'read-node', params: { nodeId: '404:404' } })
  const polled = await broker.poll(session.sessionId, session.sessionSecret, { waitMs: 10 })
  broker.reply(session.sessionId, session.sessionSecret, {
    requestId: polled.requests[0].requestId,
    ok: false,
    error: { code: 'NODE_NOT_FOUND', message: 'Node 404:404 does not exist' },
  })
  await assert.rejects(missingNodePending, { code: 'NODE_NOT_FOUND' })

  // Timeout: the plugin never answers.
  const timeoutPending = broker.request({ fileKey: 'FILE_HAS_PLUGIN', op: 'ping', timeoutMs: 50 })
  clock.advance(50)
  await assert.rejects(timeoutPending, { code: 'TIMEOUT' })

  // All three codes are pairwise distinct by construction: NO_SESSION_FOR_FILE, NODE_NOT_FOUND, TIMEOUT.
})

test('a string plugin error is preserved as a bounded PLUGIN_ERROR', async () => {
  const { broker } = makeHarness()
  const session = registerTestSession(broker)
  const pending = broker.request({ fileKey: 'FILE_DEFAULT', op: 'read-node' })
  const polled = await broker.poll(session.sessionId, session.sessionSecret, { waitMs: 10 })

  broker.reply(session.sessionId, session.sessionSecret, {
    requestId: polled.requests[0].requestId,
    ok: false,
    error: `Could not read node; {"authorization":"Bearer DO-NOT-LEAK","sessionSecret":"ALSO-DO-NOT-LEAK"} ${'x'.repeat(500)}`,
  })

  await assert.rejects(pending, error => {
    assert.equal(error.code, 'PLUGIN_ERROR')
    assert.match(error.message, /Could not read node/)
    assert.match(error.message, /authorization=\[redacted\]/)
    assert.match(error.message, /sessionSecret=\[redacted\]/)
    assert.ok(error.message.length <= 400)
    return true
  })
})

test('hasSessionForFile reflects only currently alive sessions', () => {
  const { broker } = makeHarness()
  assert.equal(broker.hasSessionForFile('FILE_DEFAULT'), false)
  const session = registerTestSession(broker)
  assert.equal(broker.hasSessionForFile('FILE_DEFAULT'), true)
  broker.closeSession(session.sessionId, session.sessionSecret)
  assert.equal(broker.hasSessionForFile('FILE_DEFAULT'), false)
})

test('sessionFor names the session a read would go to and what its plugin can do', () => {
  const { broker, clock } = makeHarness()
  assert.equal(broker.sessionFor('FILE_DEFAULT'), null)
  const old = registerTestSession(broker)
  assert.deepEqual(broker.sessionFor('FILE_DEFAULT'), { sessionId: old.sessionId, capabilities: [] }, 'capabilities that are not a list count as none')

  clock.advance(10)
  const current = registerTestSession(broker, { capabilities: ['read-node', 'figma-rest', 'edit-seq'] })
  assert.deepEqual(broker.sessionFor('FILE_DEFAULT'), { sessionId: current.sessionId, capabilities: ['read-node', 'figma-rest', 'edit-seq'] })
  broker.sessionFor('FILE_DEFAULT').capabilities.push('changed')
  assert.deepEqual(broker.sessionFor('FILE_DEFAULT').capabilities, ['read-node', 'figma-rest', 'edit-seq'])
})

test('a late reply is described only to the session the request went to, and only when it succeeded', async () => {
  const { broker, clock } = makeHarness()
  const session = registerTestSession(broker, { fileKey: 'FILE_LATE', pluginInstanceId: 'plugin-late-1' })
  const other = registerTestSession(broker, { fileKey: 'FILE_LATE', pluginInstanceId: 'plugin-late-2' })

  const pending = broker.request({ fileKey: 'FILE_LATE', op: 'read-node', params: { nodeId: '1:2' }, timeoutMs: 100 })
  const target = broker.sessionFor('FILE_LATE').sessionId === session.sessionId ? session : other
  const stranger = target === session ? other : session
  const { requests } = await broker.poll(target.sessionId, target.sessionSecret, { waitMs: 10 })
  clock.advance(100)
  await assert.rejects(pending, { code: 'TIMEOUT' })

  const requestId = requests[0].requestId
  assert.deepEqual(broker.reply(stranger.sessionId, stranger.sessionSecret, { requestId, ok: true, result: {} }), { accepted: false, reason: 'REQUEST_TIMED_OUT' })
  assert.deepEqual(broker.reply(target.sessionId, target.sessionSecret, { requestId, ok: false, error: 'Boom' }), { accepted: false, reason: 'REQUEST_TIMED_OUT' })
  const late = broker.reply(target.sessionId, target.sessionSecret, { requestId, ok: true, result: {} })
  assert.deepEqual(late.late.params, { nodeId: '1:2' })
  assert.equal(late.late.op, 'read-node')
})

test('a read that times out says how many reads the plugin had to serve before it', async () => {
  const { broker, clock } = makeHarness()
  registerTestSession(broker)

  const first = broker.request({ fileKey: 'FILE_DEFAULT', op: 'read-node', params: { nodeId: '1:1' }, timeoutMs: 500 })
  const check = broker.request({ fileKey: 'FILE_DEFAULT', op: 'edit-seq', params: {}, timeoutMs: 500 })
  const second = broker.request({ fileKey: 'FILE_DEFAULT', op: 'read-node', params: { nodeId: '1:2' }, timeoutMs: 500 })
  const third = broker.request({ fileKey: 'FILE_DEFAULT', op: 'read-document-index', timeoutMs: 500 })
  clock.advance(500)

  await assert.rejects(first, error => error.code === 'TIMEOUT' && error.message === 'Request timed out waiting for a plugin reply')
  await assert.rejects(check, error => error.ahead === 0, 'an edit count is answered at once, never queued behind reads')
  await assert.rejects(second, error => error.ahead === 1 && /1 earlier read was ahead of it/.test(error.message))
  await assert.rejects(third, error => error.ahead === 2 && /2 earlier reads were ahead of it, and the Figma plugin serves one read at a time/.test(error.message))
})
