const http = require('http')
const fs = require('fs')
const path = require('path')
const { fetchFigmaDesign } = require('./figma-api')
const createBridgeRoutes = require('./bridge/routes')
const createBridgeCache = require('./bridge/cache')
const createBridgeBroker = require('./bridge/broker')
const bridgeIdentity = require('./bridge/identity')
const { getOrCreateToken, createTokenSource } = require('./bridge/token')
const createSnapshotStore = require('./snapshot-store')
const createLegacyRoutes = require('./legacy-routes')
const { prepareDataDir, samePath } = require('./data-dir')

// ── Config ────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, 'config.json')

// There is no dataDir default here: data-dir.js picks the directory every
// launcher shares unless config.json or FIGMA_BRIDGE_DATA_DIR names one.
function loadConfig() {
  const defaults = {
    port: 3456,
    maxSnapshots: 50,
    logLevel: 'info',
  }
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const user = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
      return { ...defaults, ...user }
    }
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaults, null, 2) + '\n')
    console.log(`[figma-bridge] Created default config: ${CONFIG_PATH}`)
  } catch (e) {
    console.warn(`[figma-bridge] Config error: ${e.message}`)
  }
  return defaults
}

const config = loadConfig()
const port = parseInt(process.env.FIGMA_BRIDGE_PORT || config.port, 10)
// Reaching this server has to require being on this machine. Binding elsewhere
// is possible — a container that must be reachable from its host, for one — but
// it has to be asked for, and it is announced at startup rather than happening
// by default.
const host = process.env.FIGMA_BRIDGE_HOST || config.host || '127.0.0.1'
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const maxSnapshots = parseInt(process.env.FIGMA_BRIDGE_MAX_SNAPSHOTS || config.maxSnapshots, 10)
const logLevel = process.env.FIGMA_BRIDGE_LOG_LEVEL || config.logLevel
const maxBodyBytes = parseInt(process.env.FIGMA_BRIDGE_MAX_BODY_BYTES || config.maxBodyBytes || 50_000_000, 10)
const cacheMaxBytes = createBridgeCache.resolveMaxBytes(
  process.env.FIGMA_BRIDGE_CACHE_MAX_BYTES || config.cacheMaxBytes,
  message => console.warn(`[figma-bridge] ${message}`),
)
const allowAnonymousLegacy = process.env.FIGMA_BRIDGE_ALLOW_ANONYMOUS_LEGACY === '1'

// ── Logger ────────────────────────────────────────────────

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const minLevel = LEVELS[logLevel] !== undefined ? LEVELS[logLevel] : 1

function log(level, ...args) {
  if (LEVELS[level] === undefined || LEVELS[level] < minLevel) return
  const ts = new Date().toISOString()
  const prefix = `[${ts}] [${level.toUpperCase()}]`
  const output = [prefix, ...args]
  if (level === 'error') console.error(...output)
  else if (level === 'warn') console.warn(...output)
  else console.log(...output)
}

// ── Data directory ────────────────────────────────────────

const { dataDir } = prepareDataDir({ log: message => log('info', message) })

// The legacy snapshot API and the request-driven bridge deliberately share one
// listener. This keeps `npm start` compatible with existing /design consumers
// while allowing MCP adapters to safely probe/reuse the same process.
// Read from the token file on each request, so a rotation revokes the old
// token without restarting this server.
const bridgeToken = createTokenSource(dataDir, getOrCreateToken(dataDir).token)
const bridgeCache = createBridgeCache({ dataDir, maxBytes: cacheMaxBytes })
const bridgeBroker = createBridgeBroker({ identity: bridgeIdentity, log })
const bridgeRouter = createBridgeRoutes({
  broker: bridgeBroker,
  cache: bridgeCache,
  identity: bridgeIdentity,
  token: bridgeToken,
  log,
})

// The /design and /snapshots routes, with their Host, Origin and token checks,
// live in legacy-routes.js so an MCP process that owns the port serves them too.
const store = createSnapshotStore({ dataDir, maxSnapshots, log })
const legacyRouter = createLegacyRoutes({
  store,
  token: bridgeToken,
  allowAnonymous: allowAnonymousLegacy,
  maxBodyBytes,
  fetchFigmaDesign,
  log,
})

function sendInternalError(res) {
  if (res.headersSent) {
    try { res.end() } catch {}
    return
  }
  res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ error: 'Internal bridge error', code: 'INTERNAL_ERROR' }) + '\n')
}

// Same dispatch as the MCP-owned daemon: the bridge router answers what it
// owns and returns false for anything else, judged on the parsed path, so a
// URL such as /bridge/../health still reaches the legacy routes. Nothing a
// request does may throw out of here: an uncaught exception would end the
// process and every plugin session with it.
function router(req, res) {
  let handled
  try {
    handled = bridgeRouter(req, res)
  } catch (error) {
    log('error', `Bridge router threw: ${error.message}`)
    sendInternalError(res)
    return
  }
  Promise.resolve(handled)
    .then(owned => {
      if (!owned) return legacyRouter(req, res)
    })
    .catch(error => {
      log('error', `Request failed: ${error.message}`)
      sendInternalError(res)
    })
}

// ── Start ──────────────────────────────────────────────────

const server = http.createServer(router)

function shutdown(signal) {
  log('info', `Received ${signal}. Shutting down gracefully...`)
  server.close(() => {
    log('info', 'Server closed.')
    process.exit(0)
  })
  // A connected plugin keeps a long-poll open; close() alone would wait for it.
  server.closeAllConnections()
  setTimeout(() => { log('warn', 'Forced shutdown.'); process.exit(1) }, 5000).unref()
}

// Usually Claude Code's MCP server already hosts the bridge on this port. That
// is not an error worth a stack trace: say so and leave.
server.on('error', async error => {
  if (error.code !== 'EADDRINUSE') {
    log('error', `Server error: ${error.message}`)
    process.exit(1)
  }
  const getJSON = async path => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(4000) })
      return response.ok ? await response.json() : null
    } catch (error) {
      return error && error.name === 'TimeoutError' ? { timedOut: true } : null
    }
  }
  const bridge = await getJSON('/bridge/health')
  if (bridge && bridge.service === createBridgeRoutes.SERVICE_NAME) {
    // Only a bridge on this data directory shares this token; one on another
    // directory (or older than 1.3.0, which has no dataDir to show) would keep
    // the Figma plugin paired with a token this setup does not use.
    const legacy = await getJSON('/health')
    const theirs = legacy && typeof legacy.dataDir === 'string' ? legacy.dataDir : null
    if (theirs && samePath(theirs, dataDir)) {
      log('info', `A Figma Design Bridge is already running on port ${port} with this data directory. `
        + 'It serves the same routes, so this one is not needed.')
      process.exit(0)
    }
    log('error', `A Figma Design Bridge is already running on port ${port}, but it uses `
      + (theirs ? `another data directory (${theirs})` : 'another data directory, or is older than 1.3.0')
      + `, so it does not accept this setup's token. Stop or update that bridge, then run npm start again.`)
    process.exit(1)
  }
  if (bridge && bridge.timedOut) {
    log('error', `Port ${port} accepted the connection but did not answer in time. If it is a Figma Design Bridge `
      + 'busy with a large read, it already serves the plugin; otherwise stop that program, or start the bridge '
      + 'on another port with FIGMA_BRIDGE_PORT.')
    process.exit(1)
  }
  log('error', `Port ${port} is in use by another program. Stop it, or start the bridge on another port with FIGMA_BRIDGE_PORT.`)
  process.exit(1)
})

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

server.listen(port, host, () => {
  log('info', `Server started on http://${host}:${port}`)
  if (!LOOPBACK_HOSTS.has(host)) {
    log('warn', `Listening on ${host}, which is not loopback. Anyone who can reach `
      + `this address can attempt to read, overwrite, or delete the cached design, `
      + `and the token is the only thing stopping them. Unset FIGMA_BRIDGE_HOST to `
      + `bind 127.0.0.1 only.`)
  }
  if (allowAnonymousLegacy) {
    log('warn', `FIGMA_BRIDGE_ALLOW_ANONYMOUS_LEGACY=1: /design and /snapshots accept `
      + `unauthenticated requests. Any web page open in a browser on this machine can `
      + `read, overwrite, or delete the cached design. Unset it to require the token.`)
  }
  log('info', `Data directory: ${dataDir}`)
  log('info', `Max snapshots: ${maxSnapshots}`)
  const currentDesign = store.getCurrent()
  console.log('')
  console.log(`  🎨 Design Bridge Server — http://localhost:${port}`)
  console.log(`  ${'─'.repeat(47)}`)
  if (!currentDesign) {
    console.log(`  Import with: npm run import:figma -- <figma-url>`)
  } else {
    console.log(`  Restored from disk: "${currentDesign.pageName}" (${currentDesign.nodeCount} nodes)`)
  }
  console.log(`\n  Query endpoints:`)
  console.log(`    curl http://localhost:${port}/design/summary`)
  console.log(`    curl http://localhost:${port}/design/tree`)
  console.log(`    curl http://localhost:${port}/design/texts`)
  console.log(`    curl http://localhost:${port}/design/colors`)
  console.log(`    curl http://localhost:${port}/design/search?q=button`)
  console.log(`    curl http://localhost:${port}/snapshots`)
  console.log('')
})
