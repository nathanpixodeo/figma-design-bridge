// The legacy single-design HTTP API: /design, /figma/import and /snapshots.
//
// Both the standalone server (server/index.js) and an MCP process that owns the
// bridge port serve these routes, so the Figma plugin's Sync commands reach
// whichever of the two is listening. The /bridge/* routes are mounted beside
// them by the caller.

const path = require('path')
const { URL } = require('url')
const { verifyToken } = require('./bridge/token')

// ── Access control ─────────────────────────────────────────

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

// ── HTTP helpers ───────────────────────────────────────────

// The allow-listed origin, when there is one, is set on the response by the
// handler before dispatch. Neither helper may reintroduce a wildcard: `*` would
// let any page on the internet read a reply from this port.
function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data) + '\n')
}

function sendText(res, status, text, contentType = 'text/plain') {
  res.writeHead(status, { 'Content-Type': `${contentType}; charset=utf-8` })
  res.end(text + '\n')
}

// ── Routes ─────────────────────────────────────────────────

function createLegacyRoutes({
  store,
  token,
  allowAnonymous = false,
  maxBodyBytes = 50_000_000,
  fetchFigmaDesign,
  log = () => {},
} = {}) {
  if (!store) throw new Error('createLegacyRoutes requires a snapshot store')
  if (!allowAnonymous && (typeof token !== 'string' || !token)) {
    throw new Error('createLegacyRoutes requires the bridge token')
  }

  function isAuthorized(req) {
    if (allowAnonymous) return true
    return verifyToken(req, token)
  }

  function parseBody(req) {
    return new Promise((resolve, reject) => {
      let body = ''
      // Decode as one stream: a multi-byte character split across two chunks
      // would otherwise become two U+FFFD characters in the stored design.
      req.setEncoding('utf8')
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

  return function handle(req, res) {
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

    const url = new URL(req.url, 'http://127.0.0.1')
    const p = url.pathname
    const m = req.method

    if (!LEGACY_OPEN_PATHS.has(p) && !isAuthorized(req)) {
      sendJSON(res, 401, {
        error: 'A bridge token is required for this route.',
        hint: 'Run `npm run bridge:token` and send it as `Authorization: Bearer <token>`.',
      })
      return
    }

    try {
      // GET / — endpoint listing
      if (m === 'GET' && (p === '/' || p === '/health')) {
        const design = store.getCurrent()
        sendJSON(res, 200, {
          status: 'ok',
          port: req.socket.localPort,
          hasDesign: design !== null,
          pageName: design?.pageName || null,
          nodeCount: design?.nodeCount || 0,
          snapshotCount: store.list().length,
          dataDir: store.dataDir,
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
            const filepath = store.save(data)
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
          let filepath
          try {
            filepath = store.save(data)
          } catch (error) {
            // A disk failure is not a payload-size problem: keep 413 for parseBody.
            log('error', `POST /design could not save the design: ${error.message}`)
            return sendJSON(res, 500, { error: `The design could not be saved (${error.code || 'write failed'}).` })
          }
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
        sendJSON(res, 200, store.getCurrent() || { message: 'No design data loaded yet. Import a Figma URL first.' })
        return
      }

      // DELETE /design
      if (m === 'DELETE' && p === '/design') {
        store.clear()
        sendJSON(res, 200, { message: 'Design data cleared from memory. Snapshots remain on disk.' })
        return
      }

      // GET /design/summary
      if (m === 'GET' && p === '/design/summary') {
        sendText(res, 200, generateSummary(store.getCurrent()), 'text/markdown')
        return
      }

      // GET /design/tree
      if (m === 'GET' && p === '/design/tree') {
        const design = store.getCurrent()
        if (!design) return sendText(res, 200, 'No design data loaded yet.')
        let tree = design.pageName + '\n'
        for (const n of design.nodes) tree += treeNodeToString(n)
        sendText(res, 200, tree)
        return
      }

      // GET /design/texts
      if (m === 'GET' && p === '/design/texts') {
        const design = store.getCurrent()
        sendJSON(res, 200, { texts: design ? getAllTexts(design.nodes) : [] })
        return
      }

      // GET /design/colors
      if (m === 'GET' && p === '/design/colors') {
        const design = store.getCurrent()
        sendJSON(res, 200, { colors: design ? getColorPalette(design.nodes) : {} })
        return
      }

      // GET /design/search?q=
      if (m === 'GET' && p === '/design/search') {
        const q = url.searchParams.get('q')
        if (!q) return sendJSON(res, 400, { error: 'Missing "q" parameter' })
        const design = store.getCurrent()
        if (!design) return sendJSON(res, 200, { query: q, results: [] })
        const ql = q.toLowerCase()
        const results = findNodes(design.nodes, n =>
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
        sendJSON(res, 200, { snapshots: store.list() })
        return
      }

      // GET /snapshots/:filename
      const snapMatch = p.match(/^\/snapshots\/([\w\-:.]+\.json)$/)
      if (m === 'GET' && snapMatch) {
        const snapshot = store.load(snapMatch[1])
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
}

module.exports = createLegacyRoutes
module.exports.createLegacyRoutes = createLegacyRoutes
