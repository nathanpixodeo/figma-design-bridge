// Request broker: the in-memory queue between MCP clients ("askers") and
// live Figma plugin sessions ("answerers"). Pure logic + timers only — no
// HTTP, no filesystem, no dependency on any other bridge module.
//
// See docs/PLAN_PLUGIN_ON_DEMAND_MCP.md section 3 ("Transport, identity and
// authentication", "Cache and freshness") and section 6 ("Worker rules").

const crypto = require('crypto')

const ALLOWED_OPS = new Set(['read-node', 'read-document-index', 'ping', 'edit-seq'])
// Answered by the plugin at once, outside its one-read-at-a-time queue, so it
// never counts as a read waiting ahead of another.
const INSTANT_OPS = new Set(['ping', 'edit-seq'])
// The plugin runs heavy reads (exports, walks of whole subtrees) one at a time
// and light ones (search, the document index) beside them. The broker hands a
// read to the plugin only when its lane has room, so a read's time starts when
// the plugin can start it, not while it waits behind others.
const LANE_LIMITS = { heavy: 1, light: 2 }
const LIGHT_REPRESENTATIONS = new Set(['search'])
// A handed read the plugin never answers stops holding its lane this long
// after its deadline. Answers that late do happen while Figma is hidden.
const LATE_REPLY_GRACE_MS = 15_000
const MAX_PARAMS_BYTES = 256 * 1024
const MAX_PLUGIN_ERROR_MESSAGE = 400
const PLUGIN_ERROR_CODES = new Set(['NODE_NOT_FOUND'])

// ── Typed errors ─────────────────────────────────────────────

function brokerError(code, message, extra) {
  const err = new Error(message)
  err.code = code
  if (extra) Object.assign(err, extra)
  return err
}

function sanitizePluginErrorMessage(value) {
  if (typeof value !== 'string' || !value) return 'Plugin reported an error'
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/['"]?(bridge[-_ ]?token|session[-_ ]?secret|x-session-secret|authorization|bearer|token|secret|password|api[-_ ]?key)['"]?\s*[:=]\s*(?:"[^"]*"|'[^']*'|\S+)/gi, '$1=[redacted]')
    .replace(/\b[0-9a-f]{32,}\b/gi, '[redacted]')
    .slice(0, MAX_PLUGIN_ERROR_MESSAGE)
}

const errors = {
  unauthorized(message = 'Unauthorized') {
    return brokerError('UNAUTHORIZED', message)
  },
  noSessionForFile(fileKey) {
    return brokerError('NO_SESSION_FOR_FILE', `No live plugin session for file "${fileKey}"`, { fileKey })
  },
  sessionLost(message = 'Session is no longer connected', extra) {
    return brokerError('SESSION_LOST', message, extra)
  },
  timeout(fileKey, requestId, ahead = 0) {
    // The plugin serves the reads of one lane in turn, so a read can time out
    // because others of its kind were served first. Saying so tells the caller why.
    const message = ahead > 0
      ? `Request timed out waiting for a plugin reply: ${ahead} earlier ${ahead === 1 ? 'read was' : 'reads were'} ahead of it, `
        + 'and the Figma plugin serves reads like it one at a time. Pass queueWaitMs to let a read wait its turn'
      : 'Request timed out waiting for a plugin reply'
    return brokerError('TIMEOUT', message, { fileKey, requestId, ahead })
  },
  queueFull(fileKey, sessionId) {
    return brokerError('QUEUE_FULL', `Session queue is full for file "${fileKey}"`, { fileKey, sessionId })
  },
  badRequest(message) {
    return brokerError('BAD_REQUEST', message)
  },
  tooManyPending() {
    return brokerError('TOO_MANY_PENDING', 'Too many pending broker requests')
  },
  handoff(extra) {
    return brokerError('BRIDGE_HANDOFF',
      'This bridge handed its port to a newer figma-bridge server before the read finished. Retry the call.', extra)
  },
  cancelled(extra) {
    return brokerError('CANCELLED', 'The caller stopped waiting for this read', extra)
  },
}

function laneOf(op, params) {
  if (INSTANT_OPS.has(op)) return 'instant'
  if (op === 'read-document-index') return 'light'
  const representation = params && typeof params.representation === 'string' ? params.representation : ''
  return LIGHT_REPRESENTATIONS.has(representation.split('+')[0]) ? 'light' : 'heavy'
}

// ── Small helpers ────────────────────────────────────────────

function randomId() {
  return crypto.randomBytes(16).toString('hex')
}

function verifySecret(storedBuffer, providedHex) {
  if (typeof providedHex !== 'string' || providedHex.length === 0) return false
  if (!/^[0-9a-f]+$/i.test(providedHex)) return false
  const providedBuffer = Buffer.from(providedHex, 'hex')
  // Guard the length check before timingSafeEqual: it throws on unequal
  // length buffers, and the length itself must not leak timing information.
  if (providedBuffer.length !== storedBuffer.length) return false
  return crypto.timingSafeEqual(storedBuffer, providedBuffer)
}

function dedupeKeyFor(fileKey, dedupeKey) {
  return `${fileKey}\u0000${dedupeKey}`
}

// enqueuedAt on the wire is when the read's time began, which is when it was
// handed to the plugin: the plugin keeps a share of that time for its reply.
function requestToWireFormat(req) {
  if (!req) return null
  return {
    requestId: req.requestId, op: req.op, params: req.params,
    enqueuedAt: req.handedAt || req.enqueuedAt, expiresAt: req.expiresAt,
  }
}

function validateRequestInput({ fileKey, op, params, timeoutMs, queueWaitMs, dedupeKey }, defaultTimeoutMs) {
  if (typeof fileKey !== 'string' || fileKey.length === 0) {
    throw errors.badRequest('fileKey must be a non-empty string')
  }
  if (typeof op !== 'string' || !ALLOWED_OPS.has(op)) {
    throw errors.badRequest(`op must be one of: ${Array.from(ALLOWED_OPS).join(', ')}`)
  }

  let rawParams = params
  if (rawParams === undefined) rawParams = {}
  if (typeof rawParams === 'function' || Array.isArray(rawParams) || typeof rawParams !== 'object' || rawParams === null) {
    throw errors.badRequest('params must be a plain object')
  }

  let serialized
  try {
    serialized = JSON.stringify(rawParams)
  } catch {
    throw errors.badRequest('params must be JSON-serializable')
  }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_PARAMS_BYTES) {
    throw errors.badRequest('params payload is too large')
  }
  // Round-trip through JSON so a caller mutating its own object afterwards
  // cannot affect the queued request.
  const clonedParams = JSON.parse(serialized)

  let effectiveTimeout = defaultTimeoutMs
  if (timeoutMs !== undefined) {
    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw errors.badRequest('timeoutMs must be a positive number')
    }
    effectiveTimeout = timeoutMs
  }

  let queueWait = 0
  if (queueWaitMs !== undefined && queueWaitMs !== null) {
    if (typeof queueWaitMs !== 'number' || !Number.isFinite(queueWaitMs) || queueWaitMs < 0) {
      throw errors.badRequest('queueWaitMs must be a non-negative number')
    }
    queueWait = queueWaitMs
  }

  let dk = null
  if (dedupeKey !== undefined && dedupeKey !== null) {
    if (typeof dedupeKey !== 'string' || dedupeKey.length === 0) {
      throw errors.badRequest('dedupeKey must be a non-empty string')
    }
    dk = dedupeKey
  }

  return { fileKey, op, params: clonedParams, timeoutMs: effectiveTimeout, queueWaitMs: queueWait, dedupeKey: dk }
}

// ── Broker factory ───────────────────────────────────────────

function createBroker(options = {}) {
  const requestTimeoutMs = options.requestTimeoutMs || 30000
  const sessionTimeoutMs = options.sessionTimeoutMs || 90000
  // Many agent sessions read the same file at once; a coalesced read counts once.
  const maxQueuePerSession = options.maxQueuePerSession || 128
  const maxPendingRequests = options.maxPendingRequests || 256
  const now = options.now || (() => Date.now())
  const setTimer = options.setTimer || setTimeout
  const clearTimer = options.clearTimer || clearTimeout

  const sessions = new Map() // sessionId -> session
  const requests = new Map() // requestId -> request (kept briefly after settling as a tombstone)
  const dedupeIndex = new Map() // `${fileKey}\0${dedupeKey}` -> requestId (only while pending)
  const pluginInstanceIndex = new Map() // pluginInstanceId -> sessionId (only while alive)
  const sessionsByFile = new Map() // fileKey -> Set<sessionId> (only alive sessions)

  let pendingRequestsCount = 0
  let aliveSessionCount = 0
  let coalescedHits = 0

  // ── Housekeeping ───────────────────────────────────────────

  // Lazily reap dead-session and settled-request tombstones so late replies
  // and heartbeats-after-close can still be told apart from "never existed",
  // without ever needing a dedicated sweep timer (there is nothing to leak).
  function sweep() {
    const nowTs = now()
    for (const [id, session] of sessions) {
      if (!session.alive && session.closedAt !== null && nowTs - session.closedAt > sessionTimeoutMs) {
        sessions.delete(id)
      }
    }
    for (const [id, req] of requests) {
      if (req.settled && nowTs - req.settledAt > requestTimeoutMs) {
        requests.delete(id)
      }
    }
  }

  function scheduleExpiry(session) {
    if (session.expiryTimer) clearTimer(session.expiryTimer)
    session.expiryTimer = setTimer(() => handleSessionExpiry(session.sessionId), sessionTimeoutMs)
  }

  function touchSession(session) {
    session.lastSeenAt = now()
    scheduleExpiry(session)
  }

  function handleSessionExpiry(sessionId) {
    const session = sessions.get(sessionId)
    if (!session || !session.alive) return
    // A panel goes quiet with reads outstanding when Figma closed the plugin,
    // which is what Figma does when a read runs the plugin out of memory.
    const reason = session.pendingRequestIds.size
      ? 'The Figma plugin stopped answering while it had this read: no heartbeat or poll received in time. '
        + 'Figma closes the plugin when a read is too large for its memory'
      : 'Session timed out: no heartbeat or poll received in time'
    closeSessionInternal(session, reason)
  }

  function authSession(sessionId, sessionSecret) {
    const session = sessions.get(sessionId)
    if (!session) throw errors.unauthorized('Unknown session')
    if (!verifySecret(session.secret, sessionSecret)) throw errors.unauthorized('Invalid session credentials')
    if (!session.alive) throw errors.sessionLost('Session is no longer connected', { sessionId })
    return session
  }

  function settleRequest(req, ok, result, err) {
    if (req.settled) return
    req.settled = true
    req.settledAt = now()
    req.timedOut = !ok && !!err && err.code === 'TIMEOUT'
    if (req.timer) {
      clearTimer(req.timer)
      req.timer = null
    }

    const session = sessions.get(req.sessionId)
    if (session) {
      session.pendingRequestIds.delete(req.requestId)
      const idx = session.queue.indexOf(req.requestId)
      if (idx !== -1) session.queue.splice(idx, 1)
    }

    if (req.dedupeKey) {
      const key = dedupeKeyFor(req.fileKey, req.dedupeKey)
      if (dedupeIndex.get(key) === req.requestId) dedupeIndex.delete(key)
    }

    pendingRequestsCount = Math.max(0, pendingRequestsCount - 1)

    const waiters = req.waiters
    req.waiters = []
    for (const waiter of waiters) {
      if (ok) waiter.resolve({ result, sessionId: req.sessionId, requestId: req.requestId, respondedAt: req.settledAt })
      else waiter.reject(err)
    }
  }

  function closeSessionInternal(session, reason) {
    if (!session.alive) return 0
    session.alive = false
    session.closedAt = now()

    if (session.expiryTimer) {
      clearTimer(session.expiryTimer)
      session.expiryTimer = null
    }
    if (session.waitingPoll) {
      clearTimer(session.waitingPoll.timer)
      session.waitingPoll.resolve({ requests: [] })
      session.waitingPoll = null
    }

    if (pluginInstanceIndex.get(session.pluginInstanceId) === session.sessionId) {
      pluginInstanceIndex.delete(session.pluginInstanceId)
    }
    const fileSet = sessionsByFile.get(session.fileKey)
    if (fileSet) {
      fileSet.delete(session.sessionId)
      if (fileSet.size === 0) sessionsByFile.delete(session.fileKey)
    }
    aliveSessionCount = Math.max(0, aliveSessionCount - 1)

    let rejected = 0
    for (const requestId of Array.from(session.pendingRequestIds)) {
      const req = requests.get(requestId)
      if (!req || req.settled) continue
      settleRequest(req, false, null, errors.sessionLost(reason, { fileKey: req.fileKey, requestId }))
      rejected++
    }
    session.pendingRequestIds.clear()
    session.queue.length = 0
    clearInPlugin(session)
    return rejected
  }

  function handleRequestTimeout(requestId) {
    const req = requests.get(requestId)
    if (!req || req.settled) return
    settleRequest(req, false, null, errors.timeout(req.fileKey, req.requestId, req.ahead))
    // A read that timed out in the queue lets the one behind it start.
    if (!req.handedAt) deliverToSession(req.sessionId)
  }

  function deliverToSession(sessionId) {
    const session = sessions.get(sessionId)
    if (session && session.alive) deliverQueuedRequests(session)
  }

  function armTimer(req, at) {
    if (req.timer) clearTimer(req.timer)
    req.timer = setTimer(() => handleRequestTimeout(req.requestId), Math.max(0, at - now()))
  }

  // Reads of the same lane already waiting for the session, which the plugin
  // serves before this one.
  function readsAhead(session, lane) {
    let ahead = 0
    for (const requestId of session.pendingRequestIds) {
      const req = requests.get(requestId)
      if (req && !req.settled && req.lane === lane) ahead++
    }
    for (const requestId of session.inPlugin.keys()) {
      const req = requests.get(requestId)
      // A read that timed out still keeps the plugin busy until it answers.
      if (req && req.settled && req.lane === lane) ahead++
    }
    return ahead
  }

  // ── Lanes ────────────────────────────────────────────────────

  function clearInPlugin(session) {
    for (const entry of session.inPlugin.values()) clearTimer(entry.releaseTimer)
    session.inPlugin.clear()
  }

  // The plugin answered a read, or stayed silent past its grace: its lane has
  // room again.
  function releaseFromPlugin(session, requestId) {
    const entry = session.inPlugin.get(requestId)
    if (!entry) return
    clearTimer(entry.releaseTimer)
    session.inPlugin.delete(requestId)
    deliverQueuedRequests(session)
  }

  // The queued reads the plugin can start now, oldest first in each lane.
  function startableRequests(session) {
    const busy = { heavy: 0, light: 0 }
    for (const entry of session.inPlugin.values()) busy[entry.lane]++
    const ready = []
    for (const requestId of session.queue) {
      const req = requests.get(requestId)
      if (!req || req.settled) continue
      if (req.lane === 'instant') {
        ready.push(requestId)
      } else if (busy[req.lane] < LANE_LIMITS[req.lane]) {
        busy[req.lane]++
        ready.push(requestId)
      }
    }
    return ready
  }

  // A handed read's time starts now, bounded by how long its caller waits.
  function markHanded(session, req) {
    const handedAt = now()
    req.handedAt = handedAt
    req.expiresAt = Math.min(req.deadlineAt, handedAt + req.timeoutMs)
    armTimer(req, req.expiresAt)
    if (req.lane === 'instant') return
    const releaseTimer = setTimer(
      () => releaseFromPlugin(session, req.requestId),
      Math.max(0, req.expiresAt - handedAt) + LATE_REPLY_GRACE_MS,
    )
    session.inPlugin.set(req.requestId, { lane: req.lane, releaseTimer })
  }

  // A handed read that never reached the plugin waits in the queue again, on
  // the clock it had there.
  function markQueued(session, req) {
    const entry = session.inPlugin.get(req.requestId)
    if (entry) {
      clearTimer(entry.releaseTimer)
      session.inPlugin.delete(req.requestId)
    }
    req.handedAt = null
    req.expiresAt = req.deadlineAt
    armTimer(req, req.deadlineAt)
  }

  // Hands a poll the reads the plugin can start now and remembers what went
  // out, so the poll can give them back if its answer never reaches the plugin.
  // false: nothing could be handed.
  function handOut(session, waiter) {
    const ready = startableRequests(session)
    if (ready.length === 0) return false
    const handed = new Set(ready)
    session.queue = session.queue.filter(id => !handed.has(id))
    for (const requestId of ready) markHanded(session, requests.get(requestId))
    waiter.handed = ready
    waiter.resolve({ requests: ready.map(id => requestToWireFormat(requests.get(id))).filter(Boolean) })
    return true
  }

  // The wait for a lane is the only wait queueWaitMs covers. Once a read could
  // start, timeoutMs runs whether or not the plugin polls for it, so a plugin
  // that stopped polling fails a read in timeoutMs, not timeoutMs + queueWaitMs.
  function startClocks(session) {
    for (const requestId of startableRequests(session)) {
      const req = requests.get(requestId)
      if (!req || req.lane === 'instant' || req.startableAt !== null) continue
      req.startableAt = now()
      const capped = req.startableAt + req.timeoutMs
      if (capped >= req.deadlineAt) continue
      req.deadlineAt = capped
      req.expiresAt = capped
      armTimer(req, capped)
    }
  }

  function deliverQueuedRequests(session) {
    startClocks(session)
    if (!session.waitingPoll) return
    if (session.queue.length === 0) return
    const waiter = session.waitingPoll
    if (startableRequests(session).length === 0) return
    session.waitingPoll = null
    clearTimer(waiter.timer)
    handOut(session, waiter)
  }

  // The poll's answer never reached the plugin. A poll still waiting is dropped
  // so nothing is handed to it; requests it was already handed go back to the
  // front of the queue, in order, for the session's next poll.
  function abandonPoll(session, waiter) {
    if (session.waitingPoll === waiter) {
      clearTimer(waiter.timer)
      session.waitingPoll = null
      waiter.resolve({ requests: [] })
      return
    }
    const unanswered = waiter.handed.filter(id => {
      const req = requests.get(id)
      return req && !req.settled
    })
    // A read that settled meanwhile never reached the plugin either: it holds
    // no lane, and nothing is left to send it to.
    for (const requestId of waiter.handed) {
      if (!unanswered.includes(requestId) && session.inPlugin.has(requestId)) {
        clearTimer(session.inPlugin.get(requestId).releaseTimer)
        session.inPlugin.delete(requestId)
      }
    }
    waiter.handed = []
    for (const requestId of unanswered) markQueued(session, requests.get(requestId))
    session.queue.unshift(...unanswered)
    if (session.alive) deliverQueuedRequests(session)
  }

  // The caller stopped waiting. Other callers of a coalesced read still get
  // it; a read nobody waits for any more is dropped unless the plugin has it.
  function abandonRequest(req, waiter) {
    const index = req.waiters.indexOf(waiter)
    if (index === -1 || req.settled) return
    req.waiters.splice(index, 1)
    waiter.reject(errors.cancelled({ fileKey: req.fileKey, requestId: req.requestId }))
    if (req.waiters.length === 0 && !req.handedAt) {
      settleRequest(req, false, null, errors.cancelled({ fileKey: req.fileKey, requestId: req.requestId }))
      deliverToSession(req.sessionId)
    }
  }

  // The session a new request goes to: the one heard from most recently. A
  // plugin that crashed, or whose panel was reopened, leaves its old session
  // registered until it expires, and that session must not keep taking the
  // file's reads from the one that replaced it. Between sessions heard from at
  // the same moment, one with a poll waiting takes the request at once.
  function sessionToServe(fileKey) {
    const fileSessions = sessionsByFile.get(fileKey)
    if (!fileSessions) return null
    let best = null
    for (const sessionId of fileSessions) {
      const candidate = sessions.get(sessionId)
      if (!candidate || !candidate.alive) continue
      if (!best || candidate.lastSeenAt > best.lastSeenAt
        || (candidate.lastSeenAt === best.lastSeenAt && (candidate.waitingPoll || !best.waitingPoll))) {
        best = candidate
      }
    }
    return best
  }

  // ── Public API ───────────────────────────────────────────────

  function registerSession({ fileKey, fileName, pluginInstanceId, capabilities } = {}) {
    sweep()
    if (typeof fileKey !== 'string' || fileKey.length === 0) {
      throw errors.badRequest('fileKey must be a non-empty string')
    }
    if (typeof pluginInstanceId !== 'string' || pluginInstanceId.length === 0) {
      throw errors.badRequest('pluginInstanceId must be a non-empty string')
    }

    const existingSessionId = pluginInstanceIndex.get(pluginInstanceId)
    if (existingSessionId) {
      const existing = sessions.get(existingSessionId)
      if (existing && existing.alive) {
        closeSessionInternal(existing, 'Replaced by a new session registration for the same plugin instance')
      }
    }

    const sessionId = randomId()
    const secret = crypto.randomBytes(32)
    const registeredAt = now()
    const session = {
      sessionId,
      secret,
      fileKey,
      fileName: typeof fileName === 'string' ? fileName : null,
      pluginInstanceId,
      capabilities: capabilities !== undefined ? capabilities : null,
      registeredAt,
      lastSeenAt: registeredAt,
      alive: true,
      closedAt: null,
      queue: [],
      pendingRequestIds: new Set(),
      // requestId -> { lane, releaseTimer }: handed reads the plugin has not answered.
      inPlugin: new Map(),
      waitingPoll: null,
      expiryTimer: null,
    }
    sessions.set(sessionId, session)
    pluginInstanceIndex.set(pluginInstanceId, sessionId)
    if (!sessionsByFile.has(fileKey)) sessionsByFile.set(fileKey, new Set())
    sessionsByFile.get(fileKey).add(sessionId)
    aliveSessionCount++
    scheduleExpiry(session)

    return { sessionId, sessionSecret: secret.toString('hex'), registeredAt }
  }

  function heartbeat(sessionId, sessionSecret) {
    const session = authSession(sessionId, sessionSecret)
    touchSession(session)
    return { ok: true, pendingCount: session.pendingRequestIds.size }
  }

  function closeSession(sessionId, sessionSecret, reason) {
    const session = authSession(sessionId, sessionSecret)
    const rejected = closeSessionInternal(session, reason || 'Closed by caller')
    return { closed: true, rejected }
  }

  function listSessions() {
    sweep()
    const out = []
    for (const session of sessions.values()) {
      out.push({
        sessionId: session.sessionId,
        fileKey: session.fileKey,
        fileName: session.fileName,
        pluginInstanceId: session.pluginInstanceId,
        registeredAt: session.registeredAt,
        lastSeenAt: session.lastSeenAt,
        pendingCount: session.pendingRequestIds.size,
        alive: session.alive,
      })
    }
    return out
  }

  function hasSessionForFile(fileKey) {
    const set = sessionsByFile.get(fileKey)
    if (!set) return false
    for (const sessionId of set) {
      const session = sessions.get(sessionId)
      if (session && session.alive) return true
    }
    return false
  }

  // The session a request for this file would go to now, and what its plugin
  // said it can do when it registered.
  function sessionFor(fileKey) {
    const session = sessionToServe(fileKey)
    if (!session) return null
    return {
      sessionId: session.sessionId,
      capabilities: Array.isArray(session.capabilities) ? session.capabilities.slice() : [],
    }
  }

  // queueWaitMs: how long the read may wait for its lane on top of timeoutMs.
  // 0 keeps the clock of older callers: the wait counts against timeoutMs.
  // signal: aborts when the caller stops waiting.
  function request({ fileKey, op, params, timeoutMs, queueWaitMs, dedupeKey, signal } = {}) {
    sweep()
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(errors.cancelled({ fileKey }))
        return
      }
      let validated
      try {
        validated = validateRequestInput({ fileKey, op, params, timeoutMs, queueWaitMs, dedupeKey }, requestTimeoutMs)
      } catch (err) {
        reject(err)
        return
      }
      const waiter = { resolve, reject }
      const watch = req => {
        if (signal) signal.addEventListener('abort', () => abandonRequest(req, waiter), { once: true })
      }

      const targetSession = sessionToServe(validated.fileKey)
      if (!targetSession) {
        reject(errors.noSessionForFile(validated.fileKey))
        return
      }

      if (validated.dedupeKey) {
        const key = dedupeKeyFor(validated.fileKey, validated.dedupeKey)
        const existingId = dedupeIndex.get(key)
        if (existingId) {
          const existingReq = requests.get(existingId)
          if (existingReq && !existingReq.settled) {
            existingReq.waiters.push(waiter)
            watch(existingReq)
            coalescedHits++
            return
          }
          dedupeIndex.delete(key)
        }
      }

      if (pendingRequestsCount >= maxPendingRequests) {
        reject(errors.tooManyPending())
        return
      }
      if (targetSession.pendingRequestIds.size >= maxQueuePerSession) {
        reject(errors.queueFull(validated.fileKey, targetSession.sessionId))
        return
      }

      const requestId = randomId()
      const enqueuedAt = now()
      const lane = laneOf(validated.op, validated.params)
      // The caller gives up at deadlineAt; the plugin gets timeoutMs from the
      // moment it is handed the read, within that.
      const deadlineAt = enqueuedAt + validated.timeoutMs + (lane === 'instant' ? 0 : validated.queueWaitMs)
      const req = {
        requestId,
        fileKey: validated.fileKey,
        sessionId: targetSession.sessionId,
        op: validated.op,
        params: validated.params,
        dedupeKey: validated.dedupeKey,
        lane,
        enqueuedAt,
        timeoutMs: validated.timeoutMs,
        deadlineAt,
        handedAt: null,
        // When the read's lane first had room for it: see startClocks.
        startableAt: null,
        expiresAt: deadlineAt,
        ahead: lane === 'instant' ? 0 : readsAhead(targetSession, lane),
        settled: false,
        settledAt: null,
        timedOut: false,
        timer: null,
        waiters: [waiter],
      }
      requests.set(requestId, req)
      pendingRequestsCount++
      targetSession.pendingRequestIds.add(requestId)
      targetSession.queue.push(requestId)
      if (validated.dedupeKey) dedupeIndex.set(dedupeKeyFor(validated.fileKey, validated.dedupeKey), requestId)

      armTimer(req, deadlineAt)
      watch(req)

      deliverQueuedRequests(targetSession)
    })
  }

  // `signal` aborts when the poll's answer cannot reach the plugin, typically
  // because the plugin closed the connection; see abandonPoll.
  function poll(sessionId, sessionSecret, { waitMs = 25000, signal } = {}) {
    let session
    try {
      session = authSession(sessionId, sessionSecret)
    } catch (err) {
      return Promise.reject(err)
    }
    touchSession(session)
    if (signal && signal.aborted) return Promise.resolve({ requests: [] })

    return new Promise(resolve => {
      const waiter = { resolve, timer: null, handed: [] }
      if (signal) signal.addEventListener('abort', () => abandonPoll(session, waiter), { once: true })

      if (session.queue.length > 0 && handOut(session, waiter)) return

      // A well-behaved client only keeps one poll in flight; if a second one
      // arrives anyway, resolve the superseded one immediately instead of
      // leaking its timer.
      if (session.waitingPoll) {
        clearTimer(session.waitingPoll.timer)
        const previousResolve = session.waitingPoll.resolve
        session.waitingPoll = null
        previousResolve({ requests: [] })
      }

      waiter.timer = setTimer(() => {
        session.waitingPoll = null
        resolve({ requests: [] })
      }, waitMs)
      session.waitingPoll = waiter
    })
  }

  function reply(sessionId, sessionSecret, { requestId, ok, result, error } = {}) {
    const session = authSession(sessionId, sessionSecret)
    // Any answer, even a late one or an error, means the plugin is done with
    // the read. Released after the settle below, so the next read in the lane
    // is handed out with this one's outcome already known.
    const holding = session.inPlugin.has(requestId)
    try {
      return answerRequest(session, requestId, ok, result, error)
    } finally {
      if (holding) releaseFromPlugin(session, requestId)
    }
  }

  function answerRequest(session, requestId, ok, result, error) {
    const req = requests.get(requestId)
    if (!req) return { accepted: false, reason: 'UNKNOWN_REQUEST' }
    if (req.settled) {
      if (!req.timedOut) return { accepted: false, reason: 'ALREADY_SETTLED' }
      // Nobody waits for it any more, but the plugin did the work: the caller
      // may keep the result, for whoever asks next.
      if (!ok || req.sessionId !== session.sessionId) return { accepted: false, reason: 'REQUEST_TIMED_OUT' }
      return {
        accepted: false,
        reason: 'REQUEST_TIMED_OUT',
        late: { requestId: req.requestId, fileKey: req.fileKey, op: req.op, params: req.params, sessionId: req.sessionId },
      }
    }
    if (req.sessionId !== session.sessionId) return { accepted: false, reason: 'WRONG_SESSION' }

    if (ok) {
      settleRequest(req, true, result, null)
    } else {
      const rawMessage = typeof error === 'string' ? error : error && error.message
      const rawCode = error && typeof error.code === 'string' ? error.code : null
      const code = PLUGIN_ERROR_CODES.has(rawCode) ? rawCode : 'PLUGIN_ERROR'
      const err = brokerError(code, sanitizePluginErrorMessage(rawMessage), {
        fileKey: req.fileKey,
        requestId: req.requestId,
      })
      settleRequest(req, false, null, err)
    }
    return { accepted: true }
  }

  // reason 'handoff': a newer server takes the port, and callers retry there.
  function cancelAll(reason) {
    const message = reason || 'Broker shutting down'
    for (const req of requests.values()) {
      if (!req.settled) {
        const extra = { fileKey: req.fileKey, requestId: req.requestId }
        settleRequest(req, false, null, reason === 'handoff' ? errors.handoff(extra) : errors.sessionLost(message, extra))
      }
    }
    for (const session of sessions.values()) {
      clearInPlugin(session)
      if (session.expiryTimer) {
        clearTimer(session.expiryTimer)
        session.expiryTimer = null
      }
      if (session.waitingPoll) {
        clearTimer(session.waitingPoll.timer)
        session.waitingPoll.resolve({ requests: [] })
        session.waitingPoll = null
      }
    }

    sessions.clear()
    requests.clear()
    dedupeIndex.clear()
    pluginInstanceIndex.clear()
    sessionsByFile.clear()
    pendingRequestsCount = 0
    aliveSessionCount = 0
    coalescedHits = 0
  }

  function stats() {
    let queuedRequests = 0
    let inPluginRequests = 0
    for (const session of sessions.values()) {
      if (!session.alive) continue
      queuedRequests += session.queue.length
      inPluginRequests += session.inPlugin.size
    }
    return {
      sessions: aliveSessionCount,
      pendingRequests: pendingRequestsCount,
      queuedRequests,
      inPluginRequests,
      coalescedHits,
    }
  }

  return {
    registerSession,
    heartbeat,
    closeSession,
    listSessions,
    hasSessionForFile,
    sessionFor,
    request,
    poll,
    reply,
    cancelAll,
    stats,
  }
}

createBroker.errors = errors

module.exports = createBroker
