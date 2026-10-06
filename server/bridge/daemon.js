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

  const handler = createRoutes({
    broker, cache, identity, token: currentToken, protocolVersion, maxBodyBytes, allowedOrigins, now, log,
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
        // the Figma plugin's /design syncs reach this daemon too.
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
  const actualPort = address && typeof address === 'object' ? address.port : port
  const url = baseUrl(host, actualPort)

  let closing = null
  function close(reason = 'daemon-close') {
    if (closing) return closing
    closing = (async () => {
      // Release every waiter first so an in-flight long poll cannot keep the
      // process alive after close() resolves.
      try { if (typeof broker.cancelAll === 'function') broker.cancelAll(reason) } catch {}
      if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections()
      const done = new Promise(resolve => server.close(() => resolve()))
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
      await done
    })()
    return closing
  }

  log('info', `bridge daemon listening on ${url}`)
  return { server, url, port: actualPort, host, token, currentToken, broker, cache, identity, protocolVersion, close }
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
  return { ours: true, protocolVersion: reported, reason: 'ok' }
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

function reuseDescriptor(url, dataDir, result) {
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
    server: null,
    // We did not start it, so we never stop it.
    close: async () => {},
  }
}

async function startOrReuse(options = {}) {
  const {
    port = DEFAULT_PORT,
    host = DEFAULT_HOST,
    dataDir,
    probeTimeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
    fetchImpl,
  } = options

  if (typeof dataDir !== 'string' || !dataDir.trim()) throw new Error('startOrReuse requires a dataDir')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('startOrReuse requires a fixed port; use createDaemon() for an ephemeral one')
  }

  const url = baseUrl(host, port)
  const probeOptions = { timeoutMs: probeTimeoutMs, fetchImpl }

  let first = await probe(url, probeOptions)
  for (let retry = 0; first.reason === 'timeout' && retry < 2; retry++) {
    first = await probe(url, { ...probeOptions, timeoutMs: probeTimeoutMs * 2 })
  }
  if (first.ours) return reuseDescriptor(url, dataDir, first)
  if (first.reason === 'timeout') throw busyError(url)
  if (first.reason !== 'no-listener') throw occupiedError(url, first)

  try {
    const daemon = await createDaemon(options)
    return {
      reused: false,
      started: true,
      owned: true,
      url: daemon.url,
      port: daemon.port,
      token: daemon.token,
      currentToken: daemon.currentToken,
      protocolVersion: daemon.protocolVersion,
      server: daemon.server,
      close: daemon.close,
    }
  } catch (error) {
    if (errorCode(error) !== 'EADDRINUSE') throw error
    // Lost the race between the probe and listen(). Re-probe once: if the
    // winner is ours, converge on it rather than failing or starting a second.
    const second = await probe(url, { ...probeOptions, timeoutMs: probeTimeoutMs * 2 })
    if (second.ours) return reuseDescriptor(url, dataDir, second)
    if (second.reason === 'timeout') throw busyError(url)
    throw occupiedError(url, second)
  }
}

module.exports = {
  createDaemon,
  startOrReuse,
  probe,
  PROTOCOL_VERSION,
  SERVICE_NAME,
  baseUrl,
}
