// The single shared loopback daemon.
//
// One process owns the sessions, the request queue and the cache; MCP adapters
// and the legacy server are thin clients of it. Startup is deliberately
// conservative: an unknown listener on the configured port is reported, never
// killed and never assumed to be us.

const http = require('http')
const fs = require('fs')

const createRoutes = require('./routes')
const { getOrCreateToken, createTokenSource, readToken } = require('./token')

const PROTOCOL_VERSION = '1.0'
const SERVICE_NAME = 'figma-design-bridge'
const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = 3456
const DEFAULT_PROBE_TIMEOUT_MS = 1500
// How long a server that asked for the port waits for the older owner to let go.
const HANDOFF_WAIT_MS = 5000
// Rounds of probe, hand over and start before startOrReuse settles on reuse.
const MAX_START_ROUNDS = 3
// After a handoff the plugin registers again within seconds; reads arriving in
// that window wait for it instead of failing at once.
const HANDOFF_SESSION_GRACE_MS = 30_000
// Lets the answers to reads cancelled by a handoff reach their callers.
const HANDOFF_DRAIN_MS = 200

// Binding anywhere else would expose the bridge, and its token, to the network.
const LOOPBACK_BIND_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

// stderr only. stdout belongs to the MCP stdio protocol, and neither the bridge
// token nor a session secret is ever passed to a logger.
function defaultLog(level, ...args) {
  process.stderr.write(`[${new Date().toISOString()}] [${String(level).toUpperCase()}] ${args.join(' ')}\n`)
}

// ── URL helpers ───────────────────────────────────────────

function baseUrl(host, port) {
  const authority = host.includes(':') ? `[${host}]` : host
  return `http://${authority}:${port}`
}

function normalizeBase(url) {
  try {
    const parsed = new URL(String(url))
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return null
  }
}

function portOf(url) {
  try { return Number(new URL(String(url)).port) || null } catch { return null }
}

function majorOf(version) {
  const match = /^(\d+)\./.exec(String(version || ''))
  return match ? match[1] : null
}

// Orders two x.y.z versions: -1, 0 or 1. A missing or malformed version sorts
// before any real one, because only servers from before 1.12.0 report none.
function compareVersions(a, b) {
  const parse = value => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(value || ''))
    return match ? match.slice(1).map(Number) : null
  }
  const x = parse(a)
  const y = parse(b)
  if (!x || !y) return x ? 1 : (y ? -1 : 0)
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  }
  return 0
}

function isCompatibleProtocol(remote, local) {
  const a = majorOf(remote)
  return Boolean(a) && a === majorOf(local)
}

function errorCode(error, depth = 0) {
  if (!error || depth > 4) return null
  if (typeof error.code === 'string') return error.code
  if (error.cause) return errorCode(error.cause, depth + 1)
  if (Array.isArray(error.errors) && error.errors.length) return errorCode(error.errors[0], depth + 1)
  return null
}

function unreachableReason(error) {
  if (error && error.name === 'AbortError') return 'timeout'
  const code = errorCode(error)
  if (code === 'ECONNREFUSED') return 'no-listener'
  if (code === 'ECONNRESET') return 'connection-reset'
  return code ? `unreachable-${code.toLowerCase()}` : 'unreachable'
}

// ── Sibling modules ───────────────────────────────────────

// cache.js, identity.js and broker.js are required lazily and only when they
// are not injected, so a missing sibling produces an actionable error at
// daemon construction instead of a crash at import time.
function loadSibling(name) {
  try {
    return require(`./${name}`)
  } catch (error) {
    if (error && error.code === 'MODULE_NOT_FOUND' && String(error.message).includes(`./${name}`)) {
      const missing = new Error(
        `The bridge module server/bridge/${name}.js is not available. `
        + `Add the module, or pass a { ${name} } implementation to createDaemon().`,
      )
      missing.code = 'BRIDGE_MODULE_MISSING'
      missing.module = name
      throw missing
    }
    throw error
  }
}

function factoryFrom(mod, name, file) {
  if (typeof mod === 'function') return mod
  if (mod && typeof mod[name] === 'function') return mod[name]
  throw new Error(`server/bridge/${file}.js does not export ${name}()`)
}

// ── Daemon ────────────────────────────────────────────────

// Async because listen() is: resolves to { server, url, port, host, token, close }.
async function createDaemon(options = {}) {
  const {
    port = DEFAULT_PORT,
    host = DEFAULT_HOST,
    dataDir,
    maxEntries,
    maxBytes,
    maxBodyBytes,
    allowedOrigins,
    protocolVersion = PROTOCOL_VERSION,
    serverVersion = null,
    sessionGraceMs = 0,
    onHandoff = null,
    now = () => Date.now(),
    log = defaultLog,
    fallback = null,
    createFallback = null,
  } = options

  if (typeof dataDir !== 'string' || !dataDir.trim()) {
    throw new Error('createDaemon requires a dataDir')
  }
  if (!LOOPBACK_BIND_HOSTS.has(host)) {
    throw new Error(`The bridge only binds to a loopback address; refusing to bind ${host}`)
  }

  // Owner-only: the directory holds cached designs as well as the token.
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })

  const fixedToken = typeof options.token === 'string' && options.token ? options.token : null
  const token = fixedToken || getOrCreateToken(dataDir).token
  // Routes check the token file's current value, so a rotation revokes the old
  // token while this daemon runs. A token passed in by the caller stays fixed.
  const currentToken = fixedToken ? () => fixedToken : createTokenSource(dataDir, token)

  const identity = options.identity || loadSibling('identity')
  const cache = options.cache
    || factoryFrom(loadSibling('cache'), 'createCache', 'cache')({ dataDir, maxEntries, maxBytes, now })
  const broker = options.broker
    || factoryFrom(loadSibling('broker'), 'createBroker', 'broker')({ now, log, identity })

  let actualPort = port
  let closeDaemon = null

  // A newer server asked for the port: stop listening at once so it can bind,
  // and tell the owner, which carries on as that server's client.
  let handedOver = false
  function handOver(version) {
    if (handedOver || !closeDaemon) return
    handedOver = true
    log('info', `bridge daemon: handing port ${actualPort} over to figma-bridge ${version}`)
    try {
      if (typeof onHandoff === 'function') onHandoff({ version })
    } catch (error) {
      log('warn', `bridge daemon: handoff callback failed: ${error.message}`)
    }
    closeDaemon('handoff').catch(() => {})
  }

  const handler = createRoutes({
    broker, cache, identity, token: currentToken, protocolVersion, serverVersion, sessionGraceMs,
    canHandOver: requester => Boolean(serverVersion) && compareVersions(requester, serverVersion) > 0,
    onHandoff: handOver,
    maxBodyBytes, allowedOrigins, now, log,
  })

  // The legacy router authenticates with the daemon's own token, which is only
  // known here, so a caller can hand over a factory instead of a handler.
  const fallbackHandler = typeof createFallback === 'function'
    ? createFallback({ token, currentToken, dataDir })
    : fallback

  const server = http.createServer((req, res) => {
    let handled
    try {
      handled = handler(req, res)
    } catch (error) {
      log('error', `bridge daemon: handler threw: ${error.message}`)
      endJSON(res, 500, { error: 'Internal bridge error', code: 'INTERNAL_ERROR' })
      return
    }
    Promise.resolve(handled)
      .then(ok => {
        if (ok) return
        // Not a bridge route. The MCP adapter passes the legacy router in, so
        // /design imports reach this daemon too.
        if (typeof fallbackHandler === 'function') return fallbackHandler(req, res)
        endJSON(res, 404, { error: 'Not found', code: 'NOT_FOUND' })
      })
      .catch(error => {
        log('error', `bridge daemon: request failed: ${error.message}`)
        if (!res.headersSent) endJSON(res, 500, { error: 'Internal bridge error', code: 'INTERNAL_ERROR' })
        else { try { res.end() } catch {} }
      })
  })

  await new Promise((resolve, reject) => {
    const onError = error => { server.removeListener('listening', onListening); reject(error) }
    const onListening = () => { server.removeListener('error', onError); resolve() }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })

  // A late socket error must not take the process down.
  server.on('error', error => log('error', `bridge daemon: server error: ${error.message}`))

  const address = server.address()
  actualPort = address && typeof address === 'object' ? address.port : port
  const url = baseUrl(host, actualPort)

  let closing = null
  function close(reason = 'daemon-close') {
    if (closing) return closing
    closing = (async () => {
      // Stop listening first, so a successor can take the port at once.
      const done = new Promise(resolve => server.close(() => resolve()))
      // Release every waiter so an in-flight long poll cannot keep the
      // process alive after close() resolves.
      try { if (typeof broker.cancelAll === 'function') broker.cancelAll(reason) } catch {}
      if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections()
      // A handoff lets the answers to the reads it cancelled reach their
      // callers, who retry them on the new owner.
      if (reason === 'handoff') await new Promise(resolve => setTimeout(resolve, HANDOFF_DRAIN_MS))
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
      await done
    })()
    return closing
  }
  closeDaemon = close

  log('info', `bridge daemon listening on ${url}`)
  return { server, url, port: actualPort, host, token, currentToken, broker, cache, identity, protocolVersion, serverVersion, close }
}

function endJSON(res, status, body) {
  if (res.writableEnded || res.destroyed) return
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body) + '\n')
}

// ── Probe and startup ─────────────────────────────────────

// Identity check before reuse: anything that is not this service on the
// expected protocol major is somebody else's process.
async function probe(url, options = {}) {
  const {
    timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    protocolVersion = PROTOCOL_VERSION,
  } = options

  const base = normalizeBase(url)
  if (!base) return { ours: false, protocolVersion: null, reason: 'invalid-url' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetchImpl(`${base}/bridge/health`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
  } catch (error) {
    return { ours: false, protocolVersion: null, reason: unreachableReason(error) }
  } finally {
    clearTimeout(timer)
  }

  if (!response.ok) return { ours: false, protocolVersion: null, reason: `http-${response.status}` }

  let body
  try { body = await response.json() } catch {
    return { ours: false, protocolVersion: null, reason: 'non-json-response' }
  }

  const reported = body && typeof body.protocolVersion === 'string' ? body.protocolVersion : null
  if (!body || body.service !== SERVICE_NAME) {
    return { ours: false, protocolVersion: reported, reason: 'foreign-service' }
  }
  if (!isCompatibleProtocol(reported, protocolVersion)) {
    return { ours: false, protocolVersion: reported, reason: 'incompatible-protocol' }
  }
  // null: a bridge from before 1.12.0, which reports no version and cannot hand over.
  const serverVersion = typeof body.serverVersion === 'string' ? body.serverVersion : null
  return { ours: true, protocolVersion: reported, serverVersion, reason: 'ok' }
}

function occupiedError(url, result) {
  const error = new Error(
    `Port ${portOf(url)} is already in use by another process (${result.reason}). `
    + 'Figma Design Bridge will not stop or reuse an unknown listener. '
    + 'Stop that process yourself, or run the bridge on another port with FIGMA_BRIDGE_PORT.',
  )
  error.code = 'PORT_OCCUPIED'
  error.reason = result.reason
  error.url = url
  return error
}

// A listener that accepts the connection but does not answer the health check
// in time is most likely a bridge busy with a large read, not a foreign program.
function busyError(url) {
  const error = new Error(
    `The process on port ${portOf(url)} accepted the connection but did not answer the bridge health check in time. `
    + 'If it is a Figma Design Bridge busy with a large read, the next call tries again. '
    + 'If it is another program, stop it or run the bridge on another port with FIGMA_BRIDGE_PORT.',
  )
  error.code = 'BRIDGE_BUSY'
  error.url = url
  return error
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function reuseDescriptor(url, dataDir, result, serverVersion) {
  const stored = readToken(dataDir)
  return {
    reused: true,
    started: false,
    owned: false,
    url,
    port: portOf(url),
    token: stored ? stored.token : null,
    currentToken: stored ? createTokenSource(dataDir, stored.token) : () => null,
    protocolVersion: result.protocolVersion,
    // The owner's version: null for a bridge from before 1.12.0.
    hostVersion: result.serverVersion || null,
    // The owner is older than this server and did not hand the port over.
    outdatedHost: Boolean(serverVersion) && compareVersions(result.serverVersion, serverVersion) < 0,
    server: null,
    // We did not start it, so we never stop it.
    close: async () => {},
  }
}

// A busy owner is probed again with more time. awaitHostMs keeps probing a
// free port that long: right after this server handed the port over, its
// successor may not listen yet.
async function probeOwner(url, probeOptions, awaitHostMs = 0) {
  let found = await probe(url, probeOptions)
  for (let retry = 0; found.reason === 'timeout' && retry < 2; retry++) {
    found = await probe(url, { ...probeOptions, timeoutMs: probeOptions.timeoutMs * 2 })
  }
  const deadline = Date.now() + awaitHostMs
  while (found.reason === 'no-listener' && Date.now() < deadline) {
    await sleep(200)
    found = await probe(url, probeOptions)
  }
  return found
}

// Asks an older owner to hand the port over, then waits until it lets go.
// false: the owner refused or could not be asked, or did not let go in time.
async function requestHandoff(url, dataDir, serverVersion, probeOptions) {
  const stored = readToken(dataDir)
  if (!stored || !stored.token) return false
  const fetchImpl = probeOptions.fetchImpl || globalThis.fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), probeOptions.timeoutMs * 2)
  try {
    const response = await fetchImpl(`${url}/bridge/handoff`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${stored.token}` },
      body: JSON.stringify({ version: serverVersion }),
      signal: controller.signal,
    })
    if (response.status !== 202) return false
  } catch {
    // No answer: most likely the owner already stopped listening for another
    // server's handoff. Wait for the port like an accepted handoff, rather
    // than reuse an owner that is going away.
  } finally {
    clearTimeout(timer)
  }
  const deadline = Date.now() + HANDOFF_WAIT_MS
  while (Date.now() < deadline) {
    const found = await probe(url, probeOptions)
    // Free, or already taken by a server at least as new as this one.
    if (found.reason === 'no-listener') return true
    if (found.ours && compareVersions(found.serverVersion, serverVersion) >= 0) return true
    await sleep(100)
  }
  return false
}

// Reuses the bridge on the port, has an older owner hand it over, or starts
// one. Many servers may run this at once: every round probes again, so they
// converge on one owner, the newest of them.
async function startOrReuse(options = {}) {
  const {
    port = DEFAULT_PORT,
    host = DEFAULT_HOST,
    dataDir,
    probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
    fetchImpl,
    serverVersion = null,
    awaitHostMs = 0,
  } = options

  if (typeof dataDir !== 'string' || !dataDir.trim()) throw new Error('startOrReuse requires a dataDir')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('startOrReuse requires a fixed port; use createDaemon() for an ephemeral one')
  }

  const url = baseUrl(host, port)
  const probeOptions = { timeoutMs: probeTimeoutMs, fetchImpl }
  let handedOver = false

  for (let round = 0; round < MAX_START_ROUNDS; round++) {
    const found = await probeOwner(url, probeOptions, round === 0 ? awaitHostMs : 0)
    if (found.ours) {
      // Only an owner that reports its version can hand over. One from before
      // 1.12.0 is reused, and the descriptor says it is outdated.
      const older = Boolean(serverVersion && found.serverVersion)
        && compareVersions(found.serverVersion, serverVersion) < 0
      if (!older || round === MAX_START_ROUNDS - 1) return reuseDescriptor(url, dataDir, found, serverVersion)
      if (!(await requestHandoff(url, dataDir, serverVersion, probeOptions))) {
        return reuseDescriptor(url, dataDir, found, serverVersion)
      }
      handedOver = true
      // Another server may have taken the freed port first: decide again.
      const after = await probe(url, probeOptions)
      if (after.ours) continue
    } else if (found.reason === 'timeout') {
      throw busyError(url)
    } else if (found.reason !== 'no-listener') {
      throw occupiedError(url, found)
    }

    try {
      const daemon = await createDaemon({
        ...options,
        sessionGraceMs: handedOver
          ? Math.max(options.sessionGraceMs || 0, HANDOFF_SESSION_GRACE_MS)
          : options.sessionGraceMs,
      })
      return {
        reused: false,
        started: true,
        owned: true,
        handedOver,
        url: daemon.url,
        port: daemon.port,
        token: daemon.token,
        currentToken: daemon.currentToken,
        protocolVersion: daemon.protocolVersion,
        hostVersion: serverVersion,
        outdatedHost: false,
        server: daemon.server,
        close: daemon.close,
      }
    } catch (error) {
      if (errorCode(error) !== 'EADDRINUSE') throw error
      // Lost the race between the probe and listen(): the next round converges
      // on the winner rather than failing or starting a second.
    }
  }

  const last = await probeOwner(url, probeOptions)
  if (last.ours) return reuseDescriptor(url, dataDir, last, serverVersion)
  if (last.reason === 'timeout') throw busyError(url)
  throw occupiedError(url, last)
}

module.exports = {
  createDaemon,
  startOrReuse,
  probe,
  compareVersions,
  HANDOFF_SESSION_GRACE_MS,
  PROTOCOL_VERSION,
  SERVICE_NAME,
  baseUrl,
}
