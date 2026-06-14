const http = require('http')
const fs = require('fs')
const path = require('path')
const { URL } = require('url')

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
const { port, dataDir, maxSnapshots, logLevel } = config

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

function listSnapshots() {
  try {
    ensureDirs()
    const files = fs.readdirSync(snapsDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .reverse()
    return files.map(f => {
      const p = path.join(snapsDir, f)
      let info = { filename: f, size: fs.statSync(p).size }
      try {
        const raw = fs.readFileSync(p, 'utf8').slice(0, 300)
        const parsed = JSON.parse(raw.slice(0, raw.indexOf('"nodes"') > 0 ? raw.indexOf('"nodes"') + 50 : raw.length) + '}')
        info.pageName = parsed.pageName
        info.nodeCount = parsed.nodeCount
        info.syncedAt = parsed.syncedAt
        info.savedAt = parsed.savedAt
      } catch {}
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
  if (!data) return 'No design data synced yet. Run the Figma plugin first.'
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

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(data) + '\n')
}

function sendText(res, status, text, contentType = 'text/plain') {
  res.writeHead(status, {
    'Content-Type': `${contentType}; charset=utf-8`,
    'Access-Control-Allow-Origin': '*',
  })
  res.end(text + '\n')
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', c => { body += c; if (body.length > 50e6) reject(new Error('Payload too large')) })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function router(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }

  const url = new URL(req.url, `http://localhost:${port}`)
  const p = url.pathname
  const m = req.method

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

    // POST /design
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
      sendJSON(res, 200, currentDesign || { message: 'No design data synced yet. Run the Figma plugin first.' })
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
      if (!currentDesign) return sendText(res, 200, 'No design data synced yet.')
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

server.listen(port, () => {
  log('info', `Server started on http://localhost:${port}`)
  log('info', `Data directory: ${dataDir}`)
  log('info', `Max snapshots: ${maxSnapshots}`)
  console.log('')
  console.log(`  🎨 Design Bridge Server — http://localhost:${port}`)
  console.log(`  ${'─'.repeat(47)}`)
  if (!currentDesign) {
    console.log(`  Run "Design Bridge" plugin in Figma to sync design data.`)
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
