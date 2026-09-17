const http = require('http')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')
const { fetchFigmaDesign } = require('./figma-api')
const createBridgeRoutes = require('./bridge/routes')
const createBridgeCache = require('./bridge/cache')
const createBridgeBroker = require('./bridge/broker')
const bridgeIdentity = require('./bridge/identity')
const { getOrCreateToken, verifyToken } = require('./bridge/token')

// ── Config ────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, 'config.json')

function loadConfig() {
  const defaults = {
    port: 3456,
    dataDir: path.join(__dirname, 'data'),
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
const dataDir = process.env.FIGMA_BRIDGE_DATA_DIR || config.dataDir
const maxSnapshots = parseInt(process.env.FIGMA_BRIDGE_MAX_SNAPSHOTS || config.maxSnapshots, 10)
const logLevel = process.env.FIGMA_BRIDGE_LOG_LEVEL || config.logLevel
const maxBodyBytes = parseInt(process.env.FIGMA_BRIDGE_MAX_BODY_BYTES || config.maxBodyBytes || 50_000_000, 10)
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

// The legacy snapshot API and the request-driven bridge deliberately share one
// listener. This keeps `npm start` compatible with existing /design consumers
// while allowing MCP adapters to safely probe/reuse the same process.
const bridgeToken = getOrCreateToken(dataDir).token
const bridgeCache = createBridgeCache({ dataDir })
const bridgeBroker = createBridgeBroker({ identity: bridgeIdentity, log })
const bridgeRouter = createBridgeRoutes({
  broker: bridgeBroker,
  cache: bridgeCache,
  identity: bridgeIdentity,
  token: bridgeToken,
  log,
})

// ── Legacy route guard ─────────────────────────────────────

// The /design and /snapshots routes predate the bridge token, and a loopback
// port is reachable from any page the user happens to have open: a browser runs
// on the same machine, so binding to 127.0.0.1 does not keep a web page out.
// Three controls stand in for the authentication these routes never had.
//
//   1. The Host header has to name loopback. This is what defeats DNS
//      rebinding, where a page on attacker.example resolves to 127.0.0.1 and
//      the browser still sends `Host: attacker.example`.
//   2. A cross-origin request is refused outright, and the response never
//      carries `Access-Control-Allow-Origin: *`, so a foreign page can neither
//      send a request that is honoured nor read a reply.
//   3. Anything that reads or writes design data needs the bridge token. The
//      Figma plugin's iframe posts from an opaque origin — the literal string
//      "null" — which an attacker's sandboxed iframe can also produce, so the
//      origin check alone cannot tell the two apart. The token can.
const LEGACY_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
const OPAQUE_ORIGIN = 'null'
const LEGACY_OPEN_PATHS = new Set(['/', '/health'])

function hostIsLoopback(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader) return false
  const name = hostHeader.startsWith('[')
    ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
    : hostHeader.split(':')[0]
  return LEGACY_LOOPBACK_HOSTS.has(name.toLowerCase())
}

function originIsAllowed(origin) {
  // No Origin header at all means no browser imposed one: curl, an editor
  // extension, the MCP adapter. Those are same-machine callers and still have
  // to present the token below.
  if (origin === undefined) return true
  if (origin === OPAQUE_ORIGIN) return true
  try {
    const parsed = new URL(origin)
    return parsed.protocol === 'http:' && LEGACY_LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

function legacyRequestIsAuthorized(req) {
  if (allowAnonymousLegacy) return true
  return verifyToken(req, bridgeToken)
}

// ── Snapshot Store ─────────────────────────────────────────

const snapsDir = path.join(dataDir, 'snapshots')
const latestPath = path.join(dataDir, 'latest.json')

function ensureDirs() {
  fs.mkdirSync(snapsDir, { recursive: true })
}

function snapshotFilename() {
  const now = new Date().toISOString().replace(/:/g, '-')
  return path.join(snapsDir, `${now}.json`)
}

function saveSnapshot(design) {
  ensureDirs()
  const filepath = snapshotFilename()
  const snapshot = { ...design, savedAt: new Date().toISOString() }
  fs.writeFileSync(filepath, JSON.stringify(snapshot, null, 2))
  fs.writeFileSync(latestPath, JSON.stringify(snapshot, null, 2))
  pruneSnapshots()
  log('info', `Snapshot saved: ${path.basename(filepath)} (${design.nodeCount || 0} nodes)`)
  return filepath
}

function loadLatestSnapshot() {
  try {
    if (fs.existsSync(latestPath)) {
      const data = JSON.parse(fs.readFileSync(latestPath, 'utf8'))
      log('info', `Restored latest snapshot: "${data.pageName}" (${data.nodeCount || 0} nodes)`)
      return data
    }
  } catch (e) {
    log('warn', `Could not load latest snapshot: ${e.message}`)
  }
  return null
}

// Snapshot files are written once under a timestamped name and never edited,
// so their metadata can be memoised on identity (name + size + mtime).
const snapshotMetaCache = new Map()

function snapshotMeta(filepath, filename, stat) {
  const key = `${filename}:${stat.size}:${stat.mtimeMs}`
  const hit = snapshotMetaCache.get(key)
  if (hit) return hit

  // The interesting fields (nodeCount, syncedAt, savedAt) are written after the
  // large `nodes` array, so the whole file has to be parsed to reach them.
  const parsed = JSON.parse(fs.readFileSync(filepath, 'utf8'))
  const meta = {
    pageName: parsed.pageName,
    nodeCount: typeof parsed.nodeCount === 'number'
      ? parsed.nodeCount
      : (Array.isArray(parsed.nodes) ? countAllNodes(parsed.nodes) : 0),
    syncedAt: parsed.syncedAt,
    savedAt: parsed.savedAt
  }
  snapshotMetaCache.set(key, meta)
  return meta
}

function listSnapshots() {
  try {
    ensureDirs()
    const files = fs.readdirSync(snapsDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
    return files.map(f => {
      const p = path.join(snapsDir, f)
      const stat = fs.statSync(p)
      const info = { filename: f, size: stat.size }
      try {
        Object.assign(info, snapshotMeta(p, f, stat))
      } catch (e) {
        // A snapshot that cannot be read still belongs in the listing, but the
        // reason has to surface instead of silently becoming `undefined`.
        info.error = `metadata unavailable: ${e.message}`
        log('warn', `Could not read snapshot metadata for ${f}: ${e.message}`)
      }
      return info
    })
  } catch (e) {
    log('error', `Failed to list snapshots: ${e.message}`)
    return []
  }
}

function loadSnapshot(filename) {
  try {
    const filepath = path.join(snapsDir, path.basename(filename))
    if (!fs.existsSync(filepath)) return null
    return JSON.parse(fs.readFileSync(filepath, 'utf8'))
  } catch (e) {
    log('error', `Failed to load snapshot ${filename}: ${e.message}`)
    return null
  }
}

function pruneSnapshots() {
  try {
    ensureDirs()
    const files = fs.readdirSync(snapsDir)
      .filter(f => f.endsWith('.json'))
      .sort()
    while (files.length > maxSnapshots) {
      const oldest = files.shift()
      fs.unlinkSync(path.join(snapsDir, oldest))
      log('debug', `Pruned old snapshot: ${oldest}`)
    }
  } catch (e) {
    log('warn', `Failed to prune snapshots: ${e.message}`)
  }
}

// ── Design Analysis Helpers ────────────────────────────────

function walk(nodes, fn, pathAcc = []) {
  for (const n of nodes) {
    fn(n, pathAcc)
    if (n.children) walk(n.children, fn, [...pathAcc, n])
  }
}

function findNodes(nodes, predicate, pathAcc = []) {
  const results = []
  for (const n of nodes) {
    if (predicate(n, pathAcc)) results.push({ node: n, path: [...pathAcc] })
    if (n.children) results.push(...findNodes(n.children, predicate, [...pathAcc, n]))
  }
  return results
}

function getColorPalette(nodes) {
  const colors = {}
  const addColor = (hex, nodeName, prop) => {
    if (!hex) return
    if (!colors[hex]) colors[hex] = []
    colors[hex].push({ node: nodeName, prop })
  }
  walk(nodes, n => {
    if (n.fills) n.fills.forEach(f => { if (f.type === 'SOLID') addColor(f.color, n.name, 'fill') })
    if (n.strokes) n.strokes.forEach(s => { if (s.type === 'SOLID') addColor(s.color, n.name, 'stroke') })
  })
  return colors
}

function getAllTexts(nodes) {
  const texts = []
  walk(nodes, (n, path) => {
    if (n.type === 'TEXT' && n.characters) {
      texts.push({
        path: [...path.map(p => p.name), n.name].join(' > '),
        id: n.id,
        name: n.name,
        characters: n.characters,
        fontSize: n.fontSize,
        fontFamily: n.fontName?.family || null,
        fontStyle: n.fontName?.style || null,
        color: n.fills?.[0]?.color || null,
      })
    }
  })
  return texts
}

function countAllNodes(nodes) {
  let c = 0
  walk(nodes, () => c++)
  return c
}

function treeNodeToString(n, depth = 1) {
  const indent = '  '.repeat(depth)
  const parts = [n.type, n.name ? `"${n.name}"` : null].filter(Boolean)
  let label = parts.join(' ')
  if (n.width && n.height) label += ` [${n.width}×${n.height}]`
  if (n.type === 'TEXT' && n.characters) {
    const t = n.characters.length > 50 ? n.characters.slice(0, 47) + '...' : n.characters
    label += ` "${t}"`
  }
  if (n.fills && n.fills.length > 0 && n.fills[0].type === 'SOLID') label += ` ${n.fills[0].color}`
  if (n.layoutMode) label += ` [${n.layoutMode}]`

  let result = `${indent}${label}\n`
  if (n.children) n.children.forEach(c => result += treeNodeToString(c, depth + 1))
  return result
}

function generateSummary(data) {
  if (!data) return 'No design data loaded yet. Import a Figma URL first.'
  const { pageName, nodes, type, nodeCount, savedAt } = data
  const texts = getAllTexts(nodes)
  const palette = getColorPalette(nodes)

  let md = `# Design Summary: ${pageName}\n\n`
  if (type === 'selection') md += `> Selection only (${data.selectionCount || nodes.length} node(s))\n\n`
  if (savedAt) md += `> Synced at: ${savedAt}\n\n`

  const frames = findNodes(nodes, n => (n.type === 'FRAME' || n.type === 'COMPONENT') && n.width && n.height)
  if (frames.length > 0) {
    md += '## Screens\n\n'
    for (const { node: f } of frames) {
      md += `- **${f.name || 'Untitled'}** [${f.type}] — ${f.width}×${f.height}`
      if (f.layoutMode) md += `, auto-layout: ${f.layoutMode}`
      if (f.children) { const tc = countAllNodes([f]); if (tc > 1) md += `, ${tc} nodes` }
      md += '\n'
    }
    md += '\n'
  }

  md += '## Layer Tree\n\n```\n'
  md += pageName + (type === 'selection' ? ' [Selection]' : '') + '\n'
  for (const n of nodes) md += treeNodeToString(n)
  md += '```\n\n'

  if (texts.length > 0) {
    md += '## Text Content\n\n| # | Path | Text | Font | Size |\n|---|---|---|---|---|\n'
    texts.slice(0, 100).forEach((t, i) => {
      const dt = t.characters.length > 80 ? t.characters.slice(0, 77) + '...' : t.characters
      md += `| ${i + 1} | ${escapeMd(t.path)} | ${escapeMd(dt)} | ${t.fontFamily || '-'} | ${t.fontSize || '-'} |\n`
    })
    if (texts.length > 100) md += `| ... | *${texts.length - 100} more* | | | |\n`
    md += '\n'
  }

  if (Object.keys(palette).length > 0) {
    md += '## Color Palette\n\n| Color | Usage |\n|---|---|\n'
    const sorted = Object.entries(palette).sort((a, b) => b[1].length - a[1].length)
    for (const [color, usages] of sorted.slice(0, 30)) {
      const sample = [...new Set(usages.map(u => u.node))].slice(0, 5).join(', ')
      md += `| ${color} | ${escapeMd(sample)} (${usages.length}x) |\n`
    }
    md += '\n'
  }

  const comps = findNodes(nodes, n => n.type === 'COMPONENT' || n.type === 'COMPONENT_SET')
  const insts = findNodes(nodes, n => n.type === 'INSTANCE')
  md += '## Structure\n\n'
  md += `- Total nodes: ${nodeCount || countAllNodes(nodes)}\n`
  md += `- Components: ${comps.length}\n`
  md += `- Instances: ${insts.length}\n`
  md += `- Text nodes: ${texts.length}\n`
  md += `- Top-level frames: ${frames.length}\n`
  return md
}

function escapeMd(s) {
  if (!s) return ''
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

// ── HTTP Server ────────────────────────────────────────────

let currentDesign = loadLatestSnapshot()

// The allow-listed origin, when there is one, is set on the response by router
// before dispatch. Neither helper may reintroduce a wildcard: `*` would let any
// page on the internet read a reply from this port.
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data) + '\n')
}

function sendText(res, status, text, contentType = 'text/plain') {
  res.writeHead(status, { 'Content-Type': `${contentType}; charset=utf-8` })
  res.end(text + '\n')
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', c => {
      body += c
      if (body.length > maxBodyBytes) {
        // Stop reading. Rejecting the promise alone leaves the upload streaming,
        // so one request could still grow the buffer without limit.
        req.destroy()
        reject(new Error(`Payload too large (limit ${maxBodyBytes} bytes)`))
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function router(req, res) {
  if (req.url === '/bridge' || req.url.startsWith('/bridge/')) {
    bridgeRouter(req, res)
    return
  }

  if (!hostIsLoopback(req.headers.host)) {
    log('warn', `Refused a request addressed to "${req.headers.host}" instead of loopback`)
    sendJSON(res, 403, { error: 'This server only answers requests addressed to a loopback host.' })
    return
  }

  const origin = req.headers.origin
  if (!originIsAllowed(origin)) {
    sendJSON(res, 403, { error: 'This origin is not allowed to reach the design bridge.' })
    return
  }
  if (typeof origin === 'string') {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Bridge-Token',
      'Access-Control-Max-Age': '600',
    })
    res.end()
    return
  }

  const url = new URL(req.url, `http://127.0.0.1:${port}`)
  const p = url.pathname
  const m = req.method

  if (!LEGACY_OPEN_PATHS.has(p) && !legacyRequestIsAuthorized(req)) {
    sendJSON(res, 401, {
      error: 'A bridge token is required for this route.',
      hint: 'Run `npm run bridge:token` and send it as `Authorization: Bearer <token>`.',
    })
    return
  }

  try {
    // GET / — endpoint listing
    if (m === 'GET' && (p === '/' || p === '/health')) {
      sendJSON(res, 200, {
        status: 'ok',
        port,
        hasDesign: currentDesign !== null,
        pageName: currentDesign?.pageName || null,
        nodeCount: currentDesign?.nodeCount || 0,
        snapshotCount: listSnapshots().length,
        dataDir,
        endpoints: [
          'GET  /health',
          'POST /figma/import',
          'POST /design',
          'GET  /design',
          'DELETE /design',
          'GET  /design/summary',
          'GET  /design/tree',
          'GET  /design/texts',
          'GET  /design/colors',
          'GET  /design/search?q=',
          'GET  /snapshots',
          'GET  /snapshots/:filename',
        ],
      })
      return
    }

    // POST /figma/import — fetch and normalize a file through the official Figma REST API
    if (m === 'POST' && p === '/figma/import') {
      parseBody(req).then(async body => {
        let input
        try { input = JSON.parse(body) } catch { return sendJSON(res, 400, { error: 'Invalid JSON' }) }
        const source = input.source || input.url || input.fileKey
        if (!source) return sendJSON(res, 400, { error: 'Missing "source" (Figma URL or file key)' })

        try {
          const data = await fetchFigmaDesign(source, { nodeIds: input.nodeIds })
          currentDesign = data
          const filepath = saveSnapshot(data)
          log('info', `Figma API import: "${data.pageName}" — ${data.nodeCount} nodes`)
          sendJSON(res, 200, {
            message: `Imported ${data.nodeCount} nodes from Figma`,
            pageName: data.pageName,
            fileName: data.fileName,
            nodeCount: data.nodeCount,
            source: data.source,
            snapshot: path.basename(filepath),
          })
        } catch (error) {
          log('warn', `Figma API import failed: ${error.message}`)
          sendJSON(res, 502, { error: error.message })
        }
      }).catch(error => {
        log('error', `POST /figma/import failed: ${error.message}`)
        sendJSON(res, 413, { error: error.message })
      })
      return
    }

    // POST /design — legacy plugin/manual ingestion
    if (m === 'POST' && p === '/design') {
      parseBody(req).then(body => {
        let data
        try { data = JSON.parse(body) } catch { return sendJSON(res, 400, { error: 'Invalid JSON' }) }
        if (!data.nodes || !data.pageName) return sendJSON(res, 400, { error: 'Missing "nodes" or "pageName"' })
        currentDesign = data
        const filepath = saveSnapshot(data)
        log('info', `Design synced: "${data.pageName}" — ${data.nodeCount} nodes`)
        sendJSON(res, 200, {
          message: `Synced ${data.nodeCount} nodes from "${data.pageName}"`,
          nodeCount: data.nodeCount,
          snapshot: path.basename(filepath),
        })
      }).catch(err => {
        log('error', `POST /design failed: ${err.message}`)
        sendJSON(res, 413, { error: err.message })
      })
      return
    }

    // GET /design
    if (m === 'GET' && p === '/design') {
      sendJSON(res, 200, currentDesign || { message: 'No design data loaded yet. Import a Figma URL first.' })
      return
    }

    // DELETE /design
    if (m === 'DELETE' && p === '/design') {
      currentDesign = null
      sendJSON(res, 200, { message: 'Design data cleared from memory. Snapshots remain on disk.' })
      return
    }

    // GET /design/summary
    if (m === 'GET' && p === '/design/summary') {
      sendText(res, 200, generateSummary(currentDesign), 'text/markdown')
      return
    }

    // GET /design/tree
    if (m === 'GET' && p === '/design/tree') {
      if (!currentDesign) return sendText(res, 200, 'No design data loaded yet.')
      let tree = currentDesign.pageName + '\n'
      for (const n of currentDesign.nodes) tree += treeNodeToString(n)
      sendText(res, 200, tree)
      return
    }

    // GET /design/texts
    if (m === 'GET' && p === '/design/texts') {
      sendJSON(res, 200, { texts: currentDesign ? getAllTexts(currentDesign.nodes) : [] })
      return
    }

    // GET /design/colors
    if (m === 'GET' && p === '/design/colors') {
      sendJSON(res, 200, { colors: currentDesign ? getColorPalette(currentDesign.nodes) : {} })
      return
    }

    // GET /design/search?q=
    if (m === 'GET' && p === '/design/search') {
      const q = url.searchParams.get('q')
      if (!q) return sendJSON(res, 400, { error: 'Missing "q" parameter' })
      if (!currentDesign) return sendJSON(res, 200, { query: q, results: [] })
      const ql = q.toLowerCase()
      const results = findNodes(currentDesign.nodes, n =>
        (n.name && n.name.toLowerCase().includes(ql)) ||
        (n.type === 'TEXT' && n.characters && n.characters.toLowerCase().includes(ql))
      )
      sendJSON(res, 200, {
        query: q, results: results.map(r => ({
          id: r.node.id, name: r.node.name, type: r.node.type,
          path: [...r.path.map(p => p.name), r.node.name].join(' > '),
          characters: r.node.characters, width: r.node.width, height: r.node.height,
          x: r.node.x, y: r.node.y,
        })),
      })
      return
    }

    // GET /snapshots
    if (m === 'GET' && p === '/snapshots') {
      sendJSON(res, 200, { snapshots: listSnapshots() })
      return
    }

    // GET /snapshots/:filename
    const snapMatch = p.match(/^\/snapshots\/([\w\-:.]+\.json)$/)
    if (m === 'GET' && snapMatch) {
      const snapshot = loadSnapshot(snapMatch[1])
      if (!snapshot) return sendJSON(res, 404, { error: 'Snapshot not found' })
      sendJSON(res, 200, snapshot)
      return
    }

    sendJSON(res, 404, { error: 'Not found', path: p })
  } catch (e) {
    log('error', `Request error: ${e.message}`)
    sendJSON(res, 500, { error: 'Internal server error' })
  }
}

// ── Start ──────────────────────────────────────────────────

const server = http.createServer(router)

function shutdown(signal) {
  log('info', `Received ${signal}. Shutting down gracefully...`)
  server.close(() => {
    log('info', 'Server closed.')
    process.exit(0)
  })
  setTimeout(() => { log('warn', 'Forced shutdown.'); process.exit(1) }, 5000)
}

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
