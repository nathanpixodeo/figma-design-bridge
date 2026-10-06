// Request broker: the in-memory queue between MCP clients ("askers") and
// live Figma plugin sessions ("answerers"). Pure logic + timers only — no
// HTTP, no filesystem, no dependency on any other bridge module.
//
// See docs/PLAN_PLUGIN_ON_DEMAND_MCP.md section 3 ("Transport, identity and
// authentication", "Cache and freshness") and section 6 ("Worker rules").

const crypto = require('crypto')

const ALLOWED_OPS = new Set(['read-node', 'read-document-index', 'ping'])
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
  timeout(fileKey, requestId) {
    return brokerError('TIMEOUT', 'Request timed out waiting for a plugin reply', { fileKey, requestId })
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

function requestToWireFormat(req) {
  if (!req) return null
  return { requestId: req.requestId, op: req.op, params: req.params, enqueuedAt: req.enqueuedAt, expiresAt: req.expiresAt }
}

function validateRequestInput({ fileKey, op, params, timeoutMs, dedupeKey }, defaultTimeoutMs) {
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

  let dk = null
  if (dedupeKey !== undefined && dedupeKey !== null) {
    if (typeof dedupeKey !== 'string' || dedupeKey.length === 0) {
      throw errors.badRequest('dedupeKey must be a non-empty string')
    }
    dk = dedupeKey
  }

  return { fileKey, op, params: clonedParams, timeoutMs: effectiveTimeout, dedupeKey: dk }
}

// ── Broker factory ───────────────────────────────────────────

function createBroker(options = {}) {
  const requestTimeoutMs = options.requestTimeoutMs || 30000
  const sessionTimeoutMs = options.sessionTimeoutMs || 90000
  const maxQueuePerSession = options.maxQueuePerSession || 32
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
    closeSessionInternal(session, 'Session timed out: no heartbeat or poll received in time')
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
    return rejected
  }

  function handleRequestTimeout(requestId) {
    const req = requests.get(requestId)
    if (!req || req.settled) return
    settleRequest(req, false, null, errors.timeout(req.fileKey, req.requestId))
  }

  // Hands the whole queue to a poll and remembers what went out, so the poll
  // can give it back if its answer never reaches the plugin.
  function handOut(session, waiter) {
    waiter.handed = session.queue.splice(0, session.queue.length)
    waiter.resolve({ requests: waiter.handed.map(id => requestToWireFormat(requests.get(id))).filter(Boolean) })
  }

  function deliverQueuedRequests(session) {
    if (!session.waitingPoll) return
    if (session.queue.length === 0) return
    const waiter = session.waitingPoll
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
    waiter.handed = []
    if (unanswered.length === 0) return
    session.queue.unshift(...unanswered)
    deliverQueuedRequests(session)
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

  function request({ fileKey, op, params, timeoutMs, dedupeKey } = {}) {
    sweep()
    return new Promise((resolve, reject) => {
      let validated
      try {
        validated = validateRequestInput({ fileKey, op, params, timeoutMs, dedupeKey }, requestTimeoutMs)
      } catch (err) {
        reject(err)
        return
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
            existingReq.waiters.push({ resolve, reject })
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
      const req = {
        requestId,
        fileKey: validated.fileKey,
        sessionId: targetSession.sessionId,
        op: validated.op,
        params: validated.params,
        dedupeKey: validated.dedupeKey,
        enqueuedAt,
        expiresAt: enqueuedAt + validated.timeoutMs,
        settled: false,
        settledAt: null,
        timedOut: false,
        timer: null,
        waiters: [{ resolve, reject }],
      }
      requests.set(requestId, req)
      pendingRequestsCount++
      targetSession.pendingRequestIds.add(requestId)
      targetSession.queue.push(requestId)
      if (validated.dedupeKey) dedupeIndex.set(dedupeKeyFor(validated.fileKey, validated.dedupeKey), requestId)

      req.timer = setTimer(() => handleRequestTimeout(requestId), validated.timeoutMs)

      if (targetSession.waitingPoll) deliverQueuedRequests(targetSession)
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

      if (session.queue.length > 0) {
        handOut(session, waiter)
        return
      }

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

    const req = requests.get(requestId)
    if (!req) return { accepted: false, reason: 'UNKNOWN_REQUEST' }
    if (req.settled) return { accepted: false, reason: req.timedOut ? 'REQUEST_TIMED_OUT' : 'ALREADY_SETTLED' }
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

  function cancelAll(reason) {
    const message = reason || 'Broker shutting down'
    for (const req of requests.values()) {
      if (!req.settled) {
        settleRequest(req, false, null, errors.sessionLost(message, { fileKey: req.fileKey, requestId: req.requestId }))
      }
    }
    for (const session of sessions.values()) {
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
    for (const session of sessions.values()) {
      if (session.alive) queuedRequests += session.queue.length
    }
    return {
      sessions: aliveSessionCount,
      pendingRequests: pendingRequestsCount,
      queuedRequests,
      coalescedHits,
    }
  }

  return {
    registerSession,
    heartbeat,
    closeSession,
    listSessions,
    hasSessionForFile,
    request,
    poll,
    reply,
    cancelAll,
    stats,
  }
}

createBroker.errors = errors

module.exports = createBroker
