const http = require('http')
const { URL } = require('url')

const PORT = parseInt(process.env.FIGMA_BRIDGE_PORT || '3456', 10)
let designData = null

function rgbToHex(c) {
  if (!c) return null
  const r = Math.round(Math.max(0, Math.min(1, c.r)) * 255).toString(16).padStart(2, '0')
  const g = Math.round(Math.max(0, Math.min(1, c.g)) * 255).toString(16).padStart(2, '0')
  const b = Math.round(Math.max(0, Math.min(1, c.b)) * 255).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`.toUpperCase()
}

function walk(nodes, fn, path = []) {
  for (const n of nodes) {
    fn(n, path)
    if (n.children) walk(n.children, fn, [...path, n])
  }
}

function findNodes(nodes, predicate, path = []) {
  const results = []
  for (const n of nodes) {
    if (predicate(n, path)) results.push({ node: n, path: [...path] })
    if (n.children) results.push(...findNodes(n.children, predicate, [...path, n]))
  }
  return results
}

function getColorPalette(nodes) {
  const colors = {}
  walk(nodes, n => {
    if (n.fills) {
      for (const f of n.fills) {
        if (f.type === 'SOLID' && f.color) {
          if (!colors[f.color]) colors[f.color] = []
          colors[f.color].push({ node: n.name, prop: 'fill' })
        }
      }
    }
    if (n.strokes) {
      for (const s of n.strokes) {
        if (s.type === 'SOLID' && s.color) {
          if (!colors[s.color]) colors[s.color] = []
          colors[s.color].push({ node: n.name, prop: 'stroke' })
        }
      }
    }
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
        fontFamily: n.fontName?.family,
        fontStyle: n.fontName?.style,
        color: n.fills?.[0]?.color || null,
      })
    }
  })
  return texts
}

function generateTreeText(nodes, indent = 0) {
  let result = ''
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    const isLast = i === nodes.length - 1
    const prefix = indent === 0 ? '' : (isLast ? '└── ' : '├── ')
    const childPrefix = indent === 0 ? '' : (isLast ? '    ' : '│   ')

    const parts = [n.type, n.name ? `"${n.name}"` : null].filter(Boolean)
    let label = parts.join(' ')

    if (n.width && n.height) label += ` [${n.width}×${n.height}]`
    if (n.type === 'TEXT' && n.characters) {
      const text = n.characters.length > 60 ? n.characters.slice(0, 57) + '...' : n.characters
      label += ` "${text}"`
    }
    if (n.fills && n.fills.length > 0 && n.fills[0].type === 'SOLID') {
      label += ` ${n.fills[0].color}`
    }

    const indentation = '  '.repeat(indent)
    result += `${indentation}${prefix}${label}\n`

    if (n.children) {
      result += generateTreeText(n.children, indent + 1)
    }
  }
  return result
}

function generateSummary(data) {
  if (!data) return 'No design data. Run the Figma plugin first.'

  const { pageName, nodes, type, nodeCount } = data
  const texts = getAllTexts(nodes)
  const palette = getColorPalette(nodes)

  let md = `# Design Summary: ${pageName}\n\n`

  if (type === 'selection') {
    md += `> Selection: ${data.selectionCount || nodes.length} node(s)\n\n`
  }

  const frames = findNodes(nodes, n => (n.type === 'FRAME' || n.type === 'COMPONENT') && n.width && n.height)
  if (frames.length > 0) {
    md += '## Screens\n\n'
    for (const { node: f } of frames) {
      md += `- **${f.name || 'Untitled'}** [${f.type}] — ${f.width}×${f.height}`
      if (f.layoutMode) md += `, auto-layout: ${f.layoutMode}`
      if (f.children) md += `, ${countAllNodes([f])} nodes total`
      md += '\n'
    }
    md += '\n'
  }

  md += '## Layer Tree\n\n```\n'
  const title = `${pageName}` + (type === 'selection' ? ' [Selection]' : '')
  md += title + '\n'
  for (const n of nodes) {
    md += treeNodeToString(n, 1)
  }
  md += '```\n\n'

  if (texts.length > 0) {
    md += '## Text Content\n\n'
    md += '| # | Path | Text | Font | Size |\n'
    md += '|---|------|------|------|------|\n'
    texts.slice(0, 100).forEach((t, i) => {
      const displayText = t.characters.length > 80 ? t.characters.slice(0, 77) + '...' : t.characters
      md += `| ${i + 1} | ${escapeMd(t.path)} | ${escapeMd(displayText)} | ${t.fontFamily || '-'} | ${t.fontSize || '-'} |\n`
    })
    if (texts.length > 100) md += `| ... | *${texts.length - 100} more text nodes* | | | |\n`
    md += '\n'
  }

  if (Object.keys(palette).length > 0) {
    md += '## Color Palette\n\n'
    md += '| Color | Usage |\n'
    md += '|-------|-------|\n'
    const sorted = Object.entries(palette).sort((a, b) => {
      const countA = a[1].length
      const countB = b[1].length
      return countB - countA
    })
    for (const [color, usages] of sorted.slice(0, 30)) {
      const sample = [...new Set(usages.map(u => u.node))].slice(0, 5).join(', ')
      md += `| ${color} | ${escapeMd(sample)} (${usages.length}x) |\n`
    }
    md += '\n'
  }

  const componentNodes = findNodes(nodes, n => n.type === 'COMPONENT' || n.type === 'COMPONENT_SET')
  const instanceNodes = findNodes(nodes, n => n.type === 'INSTANCE')
  md += '## Structure\n\n'
  md += `- Total nodes: ${nodeCount}\n`
  md += `- Components: ${componentNodes.length}\n`
  md += `- Instances: ${instanceNodes.length}\n`
  md += `- Text nodes: ${texts.length}\n`
  md += `- Top-level frames: ${frames.length}\n`

  return md
}

function countAllNodes(nodes) {
  let c = 0
  walk(nodes, () => c++)
  return c
}

function treeNodeToString(n, depth = 0, isLast = true) {
  const indent = '  '.repeat(depth - 1)
  const prefix = depth === 0 ? '' : (isLast ? '└── ' : '├── ')

  const parts = [n.type, n.name ? `"${n.name}"` : null].filter(Boolean)
  let label = parts.join(' ')
  if (n.width && n.height) label += ` [${n.width}×${n.height}]`
  if (n.type === 'TEXT' && n.characters) {
    const text = n.characters.length > 50 ? n.characters.slice(0, 47) + '...' : n.characters
    label += ` "${text}"`
  }
  if (n.fills && n.fills.length > 0 && n.fills[0].type === 'SOLID') {
    label += ` ${n.fills[0].color}`
  }
  if (n.layoutMode) label += ` [${n.layoutMode}]`

  let result = `${indent}${prefix}${label}\n`
  if (n.children) {
    n.children.forEach((child, i) => {
      result += treeNodeToString(child, depth + 1, i === n.children.length - 1)
    })
  }
  return result
}

function escapeMd(s) {
  if (!s) return ''
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function sendJSON(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(data))
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  })
  res.end(text)
}

function server() {
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    const path = url.pathname
    const method = req.method

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      res.end()
      return
    }

    if (method === 'POST' && path === '/design') {
      let body = ''
      req.on('data', chunk => body += chunk)
      req.on('end', () => {
        try {
          const data = JSON.parse(body)
          designData = {
            pageName: data.pageName,
            pageId: data.pageId,
            type: data.type,
            selectionCount: data.selectionCount,
            nodes: data.nodes,
            nodeCount: data.nodeCount,
            syncedAt: data.syncedAt,
          }
          sendJSON(res, 200, { message: `Synced ${data.nodeCount} nodes from "${data.pageName}"`, nodeCount: data.nodeCount })
        } catch (e) {
          sendJSON(res, 400, { error: 'Invalid JSON' })
        }
      })
      return
    }

    if (method === 'GET' && path === '/design') {
      if (!designData) return sendJSON(res, 200, { ...designData, message: 'No design data synced yet. Run the Figma plugin first.' })
      sendJSON(res, 200, { ...designData })
      return
    }

    if (method === 'GET' && path === '/design/summary') {
      const format = url.searchParams.get('format') || 'markdown'
      const summary = generateSummary(designData)
      if (format === 'markdown') {
        res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
        res.end(summary)
      } else {
        sendText(res, 200, summary)
      }
      return
    }

    if (method === 'GET' && path === '/design/texts') {
      if (!designData) return sendJSON(res, 200, { texts: [], message: 'No design data synced yet.' })
      sendJSON(res, 200, { texts: getAllTexts(designData.nodes) })
      return
    }

    if (method === 'GET' && path === '/design/colors') {
      if (!designData) return sendJSON(res, 200, { colors: {}, message: 'No design data synced yet.' })
      sendJSON(res, 200, { colors: getColorPalette(designData.nodes) })
      return
    }

    if (method === 'GET' && path === '/design/search') {
      if (!designData) return sendJSON(res, 200, { results: [], message: 'No design data synced yet.' })
      const q = url.searchParams.get('q')?.toLowerCase()
      if (!q) return sendJSON(res, 400, { error: 'Missing "q" parameter' })
      const results = findNodes(designData.nodes, n => {
        return (n.name && n.name.toLowerCase().includes(q)) ||
               (n.type === 'TEXT' && n.characters && n.characters.toLowerCase().includes(q))
      })
      sendJSON(res, 200, { query: q, results: results.map(r => ({
        id: r.node.id,
        name: r.node.name,
        type: r.node.type,
        path: [...r.path.map(p => p.name), r.node.name].join(' > '),
        characters: r.node.characters,
        width: r.node.width,
        height: r.node.height,
        x: r.node.x,
        y: r.node.y,
      })) })
      return
    }

    if (path === '/design/tree') {
      if (!designData) return sendText(res, 200, 'No design data synced yet.')
      let tree = designData.pageName + '\n'
      for (const n of designData.nodes) {
        tree += treeNodeToString(n, 1)
      }
      sendText(res, 200, tree)
      return
    }

    if (path === '/health' || path === '/') {
      sendJSON(res, 200, {
        status: 'ok',
        port: PORT,
        hasDesign: designData !== null,
        pageName: designData?.pageName || null,
        nodeCount: designData?.nodeCount || 0,
        endpoints: [
          'GET  /',
          'POST /design',
          'GET  /design',
          'GET  /design/summary',
          'GET  /design/tree',
          'GET  /design/texts',
          'GET  /design/colors',
          'GET  /design/search?q=',
          'GET  /health',
        ],
      })
      return
    }

    sendJSON(res, 404, { error: 'Not found' })
  })

  srv.listen(PORT, () => {
    console.log(`\n  🎨 Design Bridge Server running on http://localhost:${PORT}`)
    console.log(`  ─────────────────────────────────────────────`)
    console.log(`  Run the "Design Bridge" plugin in Figma to sync`)
    console.log(`  Then query design data from Claude CLI:\n`)
    console.log(`    curl http://localhost:${PORT}/design/summary`)
    console.log(`    curl http://localhost:${PORT}/design/texts`)
    console.log(`    curl http://localhost:${PORT}/design/search?q=button`)
    console.log(`    curl http://localhost:${PORT}/design/tree`)
    console.log(`    curl http://localhost:${PORT}/health\n`)
  })
}

server()
