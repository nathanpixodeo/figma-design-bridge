const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'code.js'), 'utf8')

function clock() {
  let id = 0
  const timers = new Map()
  const delays = []
  return {
    timers,
    delays,
    setTimeout(callback, delay) { timers.set(++id, callback); delays.push(delay); return id },
    clearTimeout(timer) { timers.delete(timer) },
    flush() {
      const callbacks = [...timers.values()]
      timers.clear()
      callbacks.forEach(callback => callback())
    },
  }
}

function page() {
  const heading = { id: '1:2', name: 'Heading', type: 'TEXT', characters: 'Hello' }
  const frame = { id: '1:1', name: 'Screen', type: 'FRAME', children: [heading] }
  const sibling = { id: '1:3', name: 'Other screen', type: 'FRAME' }
  return { id: '0:1', name: 'Screens', selection: [frame], children: [frame, sibling] }
}

function plugin(command = 'watch', currentPage = page()) {
  const time = clock()
  const sent = [], notifications = [], events = new Map()
  const figma = {
    command, currentPage, closed: false,
    ui: { postMessage(message) { sent.push(structuredClone(message)) } },
    showUI(html) { this.html = html },
    on(event, callback) { events.set(event, callback) },
    notify(message) { notifications.push(message) },
    closePlugin() { this.closed = true },
  }
  vm.runInNewContext(source, { figma, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout })
  return {
    figma, time, sent, notifications,
    syncs: () => sent.filter(message => message.type === 'sync'),
    emit: event => events.get(event)?.(),
    message: message => figma.ui.onmessage(message),
    ready: () => figma.ui.onmessage({ type: 'ui-ready' }),
    done(requestId, success = true) {
      figma.ui.onmessage({ type: 'done', requestId, success, error: success ? undefined : 'Offline' })
    },
  }
}

function bridgePlugin({
  characters = 'Hello from another page', command = 'bridge', fileKey = 'AAAAfileKeyAAAA',
  rootName = 'Bridge Test File', saved, now, manualYield = false,
} = {}) {
  const time = clock()
  // A paced read hands control back to Figma with setTimeout(0). Those run on
  // their own unless a test steps through them with time.flush().
  const setTimeoutFor = (callback, delay) => {
    if (delay === 0 && !manualYield) {
      setImmediate(callback)
      return 0
    }
    return time.setTimeout(callback, delay)
  }
  const sent = [], notifications = [], events = new Map()
  const storage = new Map(saved ? [['design-bridge-pairing', saved]] : [])
  const activePage = { id: '0:1', name: 'Screens', type: 'PAGE', selection: [], children: [] }
  const otherPage = { id: '0:2', name: 'Archive', type: 'PAGE', selection: [], children: [] }
  const target = { id: '2:2', name: 'Archived copy', type: 'TEXT', characters }
  const frame = { id: '2:1', name: 'Archived screen', type: 'FRAME', children: [target] }
  const root = { id: '0:0', name: rootName, type: 'DOCUMENT', children: [activePage, otherPage] }
  activePage.parent = root
  otherPage.parent = root
  frame.parent = otherPage
  target.parent = frame
  otherPage.children = [frame]
  const nodes = new Map([[root.id, root], [activePage.id, activePage], [otherPage.id, otherPage], [frame.id, frame], [target.id, target]])
  const figma = {
    command, currentPage: activePage, root, fileKey, closed: false,
    ui: { postMessage(message) { sent.push(structuredClone(message)) } },
    showUI(html) { this.html = html },
    on(event, callback) { events.set(event, callback) },
    notify(message) { notifications.push(message) },
    closePlugin() { this.closed = true },
    getNodeByIdAsync: async id => nodes.get(id) || null,
    clientStorage: {
      getAsync: async key => storage.get(key),
      setAsync: async (key, value) => storage.set(key, structuredClone(value)),
    },
  }
  const context = { figma, setTimeout: setTimeoutFor, clearTimeout: time.clearTimeout }
  if (now) context.Date = class extends Date { static now() { return now() } }
  vm.runInNewContext(source, context)
  return {
    figma, time, sent, notifications, target, activePage, otherPage, storage,
    emit: event => events.get(event)?.(),
    message: message => figma.ui.onmessage(message),
    ready: () => figma.ui.onmessage({ type: 'ui-ready' }),
  }
}

test('Sync Full Page ignores selection and includes every root and descendant', async () => {
  const p = plugin('sync-page')
  await p.ready()
  const { data, requestId } = p.syncs()[0]
  assert.equal(data.type, 'page')
  assert.equal(data.nodeCount, 3)
  assert.deepEqual(data.nodes.map(node => node.id), ['1:1', '1:3'])
  assert.equal(data.nodes[0].children[0].characters, 'Hello')
  p.done(requestId)
  assert.equal(p.figma.closed, true)
  assert.match(p.notifications[0], /Synced 3 nodes/)
})

test('Sync Selected Nodes includes descendants but not unrelated roots', async () => {
  const p = plugin('sync-selection')
  await p.ready()
  const { data } = p.syncs()[0]
  assert.equal(data.type, 'selection')
  assert.equal(data.selectionCount, 1)
  assert.equal(data.nodeCount, 2)
  assert.equal(data.nodes[0].children[0].id, '1:2')
})

test('empty selection reports an error without overwriting the cache', async () => {
  const currentPage = page()
  currentPage.selection = []
  const p = plugin('sync-selection', currentPage)
  await p.ready()
  assert.equal(p.syncs().length, 0)
  assert.match(p.notifications[0], /Select a frame/)
  assert.equal(p.figma.closed, true)
})

test('Watch initially syncs the whole page once, not the current selection', async () => {
  const p = plugin()
  p.emit('documentchange')
  assert.equal(p.time.timers.size, 0)
  await p.ready()
  await p.ready()
  assert.equal(p.syncs().length, 1)
  assert.equal(p.syncs()[0].data.nodeCount, 3)
  p.done(1)
  p.figma.currentPage.selection = [p.figma.currentPage.children[1]]
  p.emit('selectionchange')
  p.time.flush()
  assert.equal(p.syncs().length, 1, 'selection changes must not replace the page snapshot')
  assert.equal(p.figma.closed, false)
})

test('content changes without selection changes are debounced into one fresh snapshot', async () => {
  const p = plugin()
  await p.ready()
  p.done(1)
  p.figma.currentPage.children[0].children[0].characters = 'Updated'
  for (let i = 0; i < 100; i++) p.emit('documentchange')
  assert.equal(p.time.timers.size, 1)
  assert.equal(p.syncs().length, 1)
  p.time.flush()
  assert.equal(p.syncs().length, 2)
  assert.equal(p.syncs()[1].data.nodes[0].children[0].characters, 'Updated')
})

test('page switches and edits in flight coalesce, with no overlapping sends or stale acknowledgements', async () => {
  const p = plugin()
  await p.ready()
  p.figma.currentPage = { id: '0:2', name: 'Settings', selection: [], children: [] }
  for (let i = 0; i < 3; i++) {
    p.emit('currentpagechange')
    p.time.flush()
  }
  assert.equal(p.syncs().length, 1)
  p.done(99)
  assert.equal(p.syncs().length, 1)
  p.done(1)
  assert.equal(p.syncs().length, 2)
  assert.equal(p.syncs()[1].data.pageId, '0:2')
  assert.equal(p.sent.filter(message => message.type === 'status').at(-1).pageName, 'Screens')
  p.done(1)
  p.done(2)
  assert.equal(p.sent.at(-1).pageName, 'Settings')
  assert.equal(p.sent.at(-1).nodeCount, 0)
})

test('disabling auto sync cancels queued and debounced work; manual sync still works', async () => {
  const p = plugin()
  await p.ready()
  p.emit('documentchange')
  p.time.flush() // Queued behind the initial request.
  p.emit('documentchange') // Another debounced request.
  p.message({ type: 'set-auto-sync', enabled: false })
  assert.equal(p.time.timers.size, 0)
  p.done(1)
  p.emit('documentchange')
  p.time.flush()
  assert.equal(p.syncs().length, 1)
  p.message({ type: 'request-sync' })
  assert.equal(p.syncs().length, 2)
  p.done(2)
  p.message({ type: 'set-auto-sync', enabled: true })
  assert.equal(p.syncs().length, 3, 're-enabling immediately catches up')
})

test('queued manual sync survives disabling auto sync and a failed request', async () => {
  const p = plugin()
  await p.ready()
  p.message({ type: 'request-sync' })
  p.emit('documentchange')
  p.time.flush()
  p.message({ type: 'set-auto-sync', enabled: false })
  p.done(1, false)
  assert.equal(p.syncs().length, 2)
  p.done(2)
  assert.equal(p.sent.at(-1).connected, true)
})

test('mixed text and corner properties do not break full-page serialization or messaging', async () => {
  const currentPage = page()
  currentPage.children[0].cornerRadius = Symbol('mixed')
  Object.assign(currentPage.children[0].children[0], {
    fontSize: Symbol('mixed'), fontName: Symbol('mixed'), letterSpacing: Symbol('mixed'),
  })
  const p = plugin('sync-page', currentPage)
  await p.ready()
  assert.equal(p.notifications.length, 0)
  const frame = p.syncs()[0].data.nodes[0]
  assert.equal(frame.cornerRadius, undefined)
  assert.equal(frame.children[0].fontSize, undefined)
  assert.equal(frame.children[0].characters, 'Hello')
})

test('Sync handles variants without reading unsupported component property definitions', async () => {
  const currentPage = page()
  const variant = { id: '3:2', name: 'State=On', type: 'COMPONENT' }
  const componentSet = {
    id: '3:1', name: 'Button', type: 'COMPONENT_SET', children: [variant],
    componentPropertyDefinitions: { Label: { type: 'TEXT', defaultValue: 'Go' } },
  }
  variant.parent = componentSet
  Object.defineProperty(variant, 'componentPropertyDefinitions', {
    get() { throw new Error('Can only get component property definitions of a component set or non-variant component') },
  })
  const standalone = {
    id: '3:3', name: 'Icon', type: 'COMPONENT',
    componentPropertyDefinitions: { Visible: { type: 'BOOLEAN', defaultValue: true } },
  }
  currentPage.children = [componentSet, standalone]
  const p = plugin('sync-page', currentPage)
  await p.ready()
  assert.equal(p.notifications.length, 0)
  assert.equal(p.syncs().length, 1)
  const [set, component] = p.syncs()[0].data.nodes
  assert.equal(set.componentPropertyDefinitions.Label.defaultValue, 'Go')
  assert.equal(set.children[0].componentPropertyDefinitions, undefined)
  assert.equal(component.componentPropertyDefinitions.Visible.defaultValue, true)
})

test('serialization failures are visible and do not leave Watch stuck busy', async () => {
  const p = plugin()
  const children = p.figma.currentPage.children
  Object.defineProperty(p.figma.currentPage, 'children', {
    configurable: true, get() { throw new Error('Node removed') },
  })
  await p.ready()
  assert.equal(p.syncs().length, 0)
  assert.equal(p.sent.at(-1).type, 'error')
  assert.match(p.sent.at(-1).error, /Node removed/)
  Object.defineProperty(p.figma.currentPage, 'children', { value: children })
  p.message({ type: 'request-sync' })
  assert.equal(p.syncs().length, 1)
})

test('closing Watch cancels scheduled work', async () => {
  const p = plugin()
  await p.ready()
  p.done(1)
  p.emit('documentchange')
  p.emit('close')
  p.time.flush()
  assert.equal(p.syncs().length, 1)
  assert.equal(p.time.timers.size, 0)
})

test('Bridge reads an exact node on another page without switching pages or selection', async () => {
  const p = bridgePlugin()
  const originalPage = p.figma.currentPage
  const originalSelection = p.figma.currentPage.selection
  await p.ready()
  await p.message({
    type: 'connect-bridge', serverUrl: 'http://localhost:3456', token: 'pairing-token',
    fileSource: 'AAAAfileKeyAAAA',
  })
  const start = p.sent.find(message => message.type === 'bridge-start')
  assert.equal(start.config.fileKey, 'AAAAfileKeyAAAA')
  assert.equal(start.config.fileName, 'Bridge Test File')

  await p.message({ type: 'bridge-status', connected: true })
  await p.message({
    type: 'bridge-request', sessionId: 'session-1',
    request: {
      requestId: 'request-1', op: 'read-node',
      params: { fileKey: 'AAAAfileKeyAAAA', nodeId: p.target.id, options: { depth: 4 } },
    },
  })

  const reply = p.sent.filter(message => message.type === 'bridge-result').at(-1)
  assert.equal(reply.ok, true)
  assert.equal(reply.result.nodeId, p.target.id)
  assert.equal(reply.result.pageId, p.otherPage.id)
  assert.equal(reply.result.payload.characters, 'Hello from another page')
  assert.equal(p.figma.currentPage, originalPage)
  assert.equal(p.figma.currentPage.selection, originalSelection)
})

test('Bridge reads a variant without requesting unsupported property definitions', async () => {
  const p = bridgePlugin()
  const componentSet = { id: '2:3', name: 'Button', type: 'COMPONENT_SET', parent: p.target.parent }
  p.target.type = 'COMPONENT'
  p.target.parent = componentSet
  Object.defineProperty(p.target, 'componentPropertyDefinitions', {
    get() { throw new Error('Can only get component property definitions of a component set or non-variant component') },
  })
  await p.ready()
  await p.message({
    type: 'connect-bridge', serverUrl: 'http://localhost:3456', token: 'pairing-token',
    fileSource: 'AAAAfileKeyAAAA',
  })
  await p.message({ type: 'bridge-status', connected: true })
  await p.message({
    type: 'bridge-request', sessionId: 'session-1',
    request: {
      requestId: 'request-variant', op: 'read-node',
      params: { fileKey: 'AAAAfileKeyAAAA', nodeId: p.target.id, options: { depth: 4 } },
    },
  })
  const reply = p.sent.filter(message => message.type === 'bridge-result').at(-1)
  assert.equal(reply.ok, true)
  assert.equal(reply.result.payload.type, 'COMPONENT')
  assert.equal(reply.result.payload.componentPropertyDefinitions, undefined)
  assert.equal(reply.result.pageId, p.otherPage.id)
})

test('Bridge sanitizes mixed nested properties before structured clone and recovers from genuine errors', async () => {
  const p = bridgePlugin()
  p.target.type = 'INSTANCE'
  p.target.strokes = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0 } }]
  p.target.strokeWeight = Symbol('mixed')
  p.target.parent.children = [p.target]
  await p.ready()
  await p.message({
    type: 'connect-bridge', serverUrl: 'http://localhost:3456', token: 'pairing-token',
    fileSource: 'AAAAfileKeyAAAA',
  })
  await p.message({ type: 'bridge-status', connected: true })
  await p.message({
    type: 'bridge-request', sessionId: 'session-1',
    request: {
      requestId: 'request-mixed', op: 'read-node',
      params: { fileKey: 'AAAAfileKeyAAAA', nodeId: p.target.parent.id, options: { depth: 1 } },
    },
  })

  let reply = p.sent.filter(message => message.type === 'bridge-result').at(-1)
  assert.equal(reply.ok, true)
  assert.equal(reply.result.payload.children[0].strokeWeight, undefined)
  assert.equal(reply.result.payload.children[0].strokes[0].color, '#FF0000')

  const children = p.target.parent.children
  Object.defineProperty(p.target.parent, 'children', {
    configurable: true, get() { throw new Error('Node removed') },
  })
  await p.message({
    type: 'bridge-request', sessionId: 'session-1',
    request: {
      requestId: 'request-error', op: 'read-node',
      params: { fileKey: 'AAAAfileKeyAAAA', nodeId: p.target.parent.id, options: { depth: 1 } },
    },
  })
  reply = p.sent.filter(message => message.type === 'bridge-result').at(-1)
  assert.equal(reply.ok, false)
  assert.equal(reply.error, 'Node removed')

  Object.defineProperty(p.target.parent, 'children', { value: children })
  await p.message({
    type: 'bridge-request', sessionId: 'session-1',
    request: {
      requestId: 'request-recovery', op: 'read-node',
      params: { fileKey: 'AAAAfileKeyAAAA', nodeId: p.target.parent.id, options: { depth: 1 } },
    },
  })
  reply = p.sent.filter(message => message.type === 'bridge-result').at(-1)
  assert.equal(reply.ok, true)
  assert.equal(reply.requestId, 'request-recovery')
})

test('Bridge enforces maxBytes for large node payloads and reports truncation', async () => {
  const p = bridgePlugin({ characters: 'x'.repeat(20_000) })
  await p.ready()
  await p.message({
    type: 'connect-bridge', serverUrl: 'http://localhost:3456', token: 'pairing-token',
    fileSource: 'AAAAfileKeyAAAA',
  })
  await p.message({ type: 'bridge-status', connected: true })
  await p.message({
    type: 'bridge-request', sessionId: 'session-1',
    request: {
      requestId: 'request-2', op: 'read-node',
      params: { fileKey: 'AAAAfileKeyAAAA', nodeId: p.target.id, options: { maxBytes: 1024 } },
    },
  })

  const reply = p.sent.filter(message => message.type === 'bridge-result').at(-1)
  assert.equal(reply.ok, true)
  assert.equal(reply.result.truncated, true)
  assert.equal(reply.result.completeness.limitHit, true)
  assert.ok(JSON.stringify(reply.result.payload).length <= 1024)
  assert.ok(reply.result.payload.characters.length < 20_000)
})

async function connectedBridgePlugin(options) {
  const p = bridgePlugin(options)
  await p.ready()
  await p.message({
    type: 'connect-bridge', serverUrl: 'http://localhost:3456', token: 'pairing-token',
    fileSource: 'AAAAfileKeyAAAA',
  })
  await p.message({ type: 'bridge-status', connected: true })
  return p
}

async function readNode(p, nodeId, options) {
  await p.message({
    type: 'bridge-request', sessionId: 'session-1',
    request: { requestId: `read-${nodeId}`, op: 'read-node', params: { fileKey: 'AAAAfileKeyAAAA', nodeId, options } },
  })
  return p.sent.filter(message => message.type === 'bridge-result').at(-1)
}

// Screen > 60 cards > body > 3 text layers: 301 nodes, about 37 KB serialized.
function nestedScreen(parent) {
  const screen = { id: '3:1', name: 'Screen', type: 'FRAME', width: 1440, height: 4000, parent, children: [] }
  const nodes = new Map([[screen.id, screen]])
  let next = 2
  for (let c = 0; c < 60; c++) {
    const card = { id: `3:${next++}`, name: `Card ${c}`, type: 'FRAME', width: 320, height: 200, parent: screen, children: [] }
    const body = { id: `3:${next++}`, name: 'Body', type: 'FRAME', width: 300, height: 180, parent: card, children: [] }
    card.children.push(body)
    for (let t = 0; t < 3; t++) {
      body.children.push({
        id: `3:${next++}`, name: `Text ${t}`, type: 'TEXT', characters: `Card ${c} line ${t}`, parent: body,
        fontSize: 14, fontName: { family: 'Inter', style: 'Regular' },
      })
    }
    screen.children.push(card)
    for (const node of [card, body, ...body.children]) nodes.set(node.id, node)
  }
  return { screen, nodes }
}

function countTree(node) {
  return node ? 1 + (node.children || []).reduce((sum, child) => sum + countTree(child), 0) : 0
}

test('Bridge keeps every node that fits when maxBytes cuts a nested subtree', async () => {
  const p = await connectedBridgePlugin()
  const { screen, nodes } = nestedScreen(p.otherPage)
  p.figma.getNodeByIdAsync = async id => nodes.get(id) || null

  const full = await readNode(p, screen.id, { maxBytes: 1_000_000 })
  assert.equal(full.result.completeness.limitHit, false)
  assert.equal(countTree(full.result.payload), 301)
  assert.equal(full.result.completeness.nodeCount, 301)

  const bounded = await readNode(p, screen.id, { maxBytes: 20_000 })
  const payload = bounded.result.payload
  const bytes = Buffer.byteLength(JSON.stringify(payload))
  assert.equal(bounded.ok, true)
  assert.equal(bounded.result.truncated, true)
  assert.ok(bytes <= 20_000, `${bytes} bytes`)
  assert.equal(bounded.result.completeness.byteSize, bytes)
  assert.ok(countTree(payload) > 100, `only ${countTree(payload)} nodes survived`)
  assert.equal(bounded.result.completeness.nodeCount, countTree(payload))
  assert.equal(payload.children[0].name, 'Card 0')
  assert.equal(payload.truncated, true)
})

test('Bridge trims a document index with non-ASCII names to maxBytes exactly', async () => {
  const p = await connectedBridgePlugin()
  for (let i = 0; i < 80; i++) {
    const frame = { id: `5:${i}`, name: `Màn hình thanh toán số ${i} — “bản nháp”`, type: 'FRAME', width: 390, height: 844, parent: p.otherPage }
    p.otherPage.children.push(frame)
  }
  await p.message({
    type: 'bridge-request', sessionId: 'session-1',
    request: { requestId: 'index-utf8', op: 'read-document-index', params: { fileKey: 'AAAAfileKeyAAAA', options: { maxBytes: 2048 } } },
  })

  const reply = p.sent.filter(message => message.type === 'bridge-result').at(-1)
  const bytes = Buffer.byteLength(JSON.stringify(reply.result.payload))
  const entries = reply.result.payload.pages.reduce((sum, page) => sum + 1 + (page.children || []).length, 0)
  assert.equal(reply.result.truncated, true)
  assert.ok(bytes <= 2048, `${bytes} bytes`)
  assert.ok(bytes > 1500, `trimmed too far: ${bytes} bytes`)
  assert.equal(reply.result.completeness.byteSize, bytes)
  assert.equal(reply.result.completeness.nodeCount, entries)
})

test('Bridge counts maxBytes in UTF-8 bytes, not string length', async () => {
  const p = await connectedBridgePlugin({ characters: 'Đặt hàng ngay hôm nay để nhận ưu đãi. '.repeat(400) })
  const reply = await readNode(p, p.target.id, { maxBytes: 4096 })
  const bytes = Buffer.byteLength(JSON.stringify(reply.result.payload))

  assert.equal(reply.result.truncated, true)
  assert.ok(bytes <= 4096, `${bytes} bytes`)
  assert.equal(reply.result.completeness.byteSize, bytes)
  assert.ok(reply.result.payload.characters.length > 1000)
})

// Every reading of the clock moves it 20 ms, so the walk uses up a 50 ms slice
// every few nodes.
function steppingClock() {
  let t = 0
  return () => (t += 20)
}

function flatScreen(parent, count) {
  const screen = { id: '4:1', name: 'Screen', type: 'FRAME', parent, children: [] }
  const nodes = new Map([[screen.id, screen]])
  for (let i = 0; i < count; i++) {
    const text = { id: `4:${i + 2}`, name: `Label ${i}`, type: 'TEXT', characters: `Label ${i}`, parent: screen }
    screen.children.push(text)
    nodes.set(text.id, text)
  }
  return { screen, nodes }
}

// Runs the timers a paced read leaves behind until the read settles.
async function settle(p, pending) {
  let done = false
  pending.then(() => { done = true }, () => { done = true })
  for (let i = 0; i < 10_000 && !done; i++) {
    await new Promise(resolve => setImmediate(resolve))
    p.time.flush()
  }
  return pending
}

function readRequest(requestId, nodeId, options) {
  return {
    type: 'bridge-request', sessionId: 'session-1',
    request: { requestId, op: 'read-node', params: { fileKey: 'AAAAfileKeyAAAA', nodeId, options } },
  }
}

test('Bridge walks a large node in slices, handing control back to Figma between them', async () => {
  const p = await connectedBridgePlugin({ now: steppingClock(), manualYield: true })
  const { screen, nodes } = flatScreen(p.otherPage, 40)
  p.figma.getNodeByIdAsync = async id => nodes.get(id) || null

  const pending = p.message(readRequest('paced', screen.id))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(p.sent.filter(message => message.type === 'bridge-result').length, 0, 'the read waits for Figma')
  assert.ok(p.time.delays.filter(delay => delay === 0).length > 0, 'the walk yielded')
  await settle(p, pending)

  const reply = p.sent.filter(message => message.type === 'bridge-result').at(-1)
  assert.equal(reply.ok, true)
  assert.equal(reply.result.payload.children.length, 40)
  assert.equal(reply.result.completeness.nodeCount, 41)
  assert.equal(reply.result.completeness.byteSize, Buffer.byteLength(JSON.stringify(reply.result.payload)))
  assert.ok(p.time.delays.filter(delay => delay === 0).length >= 10)
})

test('Bridge reports an edit made while a read is paused only after that read replies', async () => {
  const p = await connectedBridgePlugin({ now: steppingClock(), manualYield: true })
  const { screen, nodes } = flatScreen(p.otherPage, 20)
  p.figma.getNodeByIdAsync = async id => nodes.get(id) || null

  const pending = p.message(readRequest('edited', screen.id))
  await new Promise(resolve => setImmediate(resolve))
  p.emit('documentchange')
  p.emit('documentchange')
  assert.equal(p.sent.filter(message => message.type === 'bridge-invalidate').length, 0)
  await settle(p, pending)

  const types = p.sent.map(message => message.type).filter(type => type === 'bridge-result' || type === 'bridge-invalidate')
  assert.deepEqual(types, ['bridge-result', 'bridge-invalidate'])

  p.emit('documentchange')
  assert.equal(p.sent.filter(message => message.type === 'bridge-invalidate').length, 2, 'later edits go out at once')
})

test('Bridge serves one read at a time, in the order they arrive', async () => {
  const p = await connectedBridgePlugin({ now: steppingClock(), manualYield: true })
  const { screen, nodes } = flatScreen(p.otherPage, 30)
  p.figma.getNodeByIdAsync = async id => nodes.get(id) || null

  const slow = p.message(readRequest('slow', screen.id))
  const quick = p.message({
    type: 'bridge-request', sessionId: 'session-1',
    request: { requestId: 'quick', op: 'read-document-index', params: { fileKey: 'AAAAfileKeyAAAA' } },
  })
  await settle(p, Promise.all([slow, quick]))

  const order = p.sent.filter(message => message.type === 'bridge-result').map(message => message.requestId)
  assert.deepEqual(order, ['slow', 'quick'])
})

test('Bridge skips a layer deleted while the walk was paused', async () => {
  const p = await connectedBridgePlugin()
  const { screen, nodes } = flatScreen(p.otherPage, 3)
  screen.children[1].removed = true
  Object.defineProperty(screen.children[1], 'name', { get() { throw new Error('The node with id "4:3" does not exist') } })
  p.figma.getNodeByIdAsync = async id => nodes.get(id) || null

  const reply = await readNode(p, screen.id)
  assert.equal(reply.ok, true)
  assert.deepEqual(reply.result.payload.children.map(child => child.id), ['4:2', '4:4'])
})

test('Bridge caps maxNodes at 20000 however many a read asks for', async () => {
  const p = await connectedBridgePlugin()
  const { screen, nodes } = flatScreen(p.otherPage, 20_005)
  p.figma.getNodeByIdAsync = async id => nodes.get(id) || null

  const reply = await readNode(p, screen.id, { maxNodes: 200_000, maxBytes: 50_000_000 })
  assert.equal(reply.ok, true)
  assert.equal(reply.result.completeness.nodeCount, 20_000)
  assert.equal(reply.result.completeness.limitHit, true)
  assert.equal(reply.result.payload.truncated, true)
})

test('Bridge document index is lightweight and document changes invalidate only the connected file', async () => {
  const p = bridgePlugin()
  await p.ready()
  await p.message({
    type: 'connect-bridge', serverUrl: 'http://localhost:3456', token: 'pairing-token',
    fileSource: 'AAAAfileKeyAAAA',
  })
  await p.message({ type: 'bridge-status', connected: true })
  await p.message({
    type: 'bridge-request', sessionId: 'session-1',
    request: {
      requestId: 'request-3', op: 'read-document-index',
      params: { fileKey: 'AAAAfileKeyAAAA', options: { maxBytes: 1024 } },
    },
  })

  const reply = p.sent.filter(message => message.type === 'bridge-result').at(-1)
  assert.equal(reply.ok, true)
  assert.equal(reply.result.payload.type, 'DOCUMENT_INDEX')
  assert.deepEqual(reply.result.payload.pages.map(page => page.name), ['Screens', 'Archive'])
  assert.deepEqual(reply.result.payload.pages[1].children.map(node => node.id), ['2:1'])
  assert.equal(reply.result.payload.pages[1].children[0].children, undefined)

  p.emit('documentchange')
  const invalidation = p.sent.filter(message => message.type === 'bridge-invalidate').at(-1)
  assert.equal(invalidation.fileKey, 'AAAAfileKeyAAAA')
})

test('Open Design Bridge connects by itself once paired, with the file key Figma provides', async () => {
  const p = bridgePlugin({ command: 'open', saved: { bridgeUrl: 'http://localhost:3456', bridgeToken: 'pairing-token' } })
  await p.ready()

  const start = p.sent.find(message => message.type === 'bridge-start')
  assert.ok(start, 'no bridge-start after the panel opened')
  assert.equal(start.config.fileKey, 'AAAAfileKeyAAAA')
  assert.equal(start.config.token, 'pairing-token')
  const status = p.sent.find(message => message.type === 'status')
  assert.equal(status.mode, 'open')
  assert.equal(status.fileKeyKnown, true)
  // The panel serves agents; uploading the whole page is opt-in.
  assert.equal(p.sent.filter(message => message.type === 'sync').length, 0)
})

test('without a file key from Figma, a saved link applies only to the document it was saved for', async () => {
  const saved = {
    bridgeUrl: 'http://localhost:3456', bridgeToken: 'pairing-token',
    fileSources: { 'Studio (Copy)': 'https://www.figma.com/design/COPYKEY123/Studio-Copy' },
    // What 1.1 saved: one link for every document. It must not be reused.
    fileSource: 'https://www.figma.com/design/OLDKEY456/Other',
  }
  const other = bridgePlugin({ command: 'open', fileKey: null, rootName: 'Studio', saved })
  await other.ready()
  assert.equal(other.sent.some(message => message.type === 'bridge-start'), false)
  assert.equal(other.sent.find(message => message.type === 'status').fileKeyKnown, false)

  const copy = bridgePlugin({ command: 'open', fileKey: null, rootName: 'Studio (Copy)', saved })
  await copy.ready()
  assert.equal(copy.sent.find(message => message.type === 'bridge-start').config.fileKey, 'COPYKEY123')
})

test('a pairing approval is saved and connects the panel', async () => {
  const p = bridgePlugin({ command: 'open' })
  await p.ready()
  assert.equal(p.sent.some(message => message.type === 'bridge-start'), false)

  await p.message({ type: 'paired', token: 'fresh-token', serverUrl: 'http://localhost:3456' })

  const start = p.sent.find(message => message.type === 'bridge-start')
  assert.equal(start.config.token, 'fresh-token')
  assert.equal(start.config.fileKey, 'AAAAfileKeyAAAA')
  assert.equal(p.storage.get('design-bridge-pairing').bridgeToken, 'fresh-token')
  assert.ok(p.notifications.includes('Paired with the bridge'))
})

test('the panel syncs the selection or the page on request and stays open', async () => {
  const p = bridgePlugin({ command: 'open' })
  const hero = { id: '9:1', name: 'Hero', type: 'FRAME', width: 10, height: 10, parent: p.activePage, children: [] }
  p.activePage.children = [hero]
  p.activePage.selection = [hero]
  await p.ready()

  await p.message({ type: 'request-sync', scope: 'selection' })
  const selection = p.sent.filter(message => message.type === 'sync').at(-1)
  assert.equal(selection.data.type, 'selection')
  await p.message({ type: 'done', requestId: selection.requestId, success: true })

  await p.message({ type: 'request-sync', scope: 'page' })
  const page = p.sent.filter(message => message.type === 'sync').at(-1)
  assert.equal(page.data.type, 'page')
  assert.equal(p.figma.closed, false)
})

function ui(fetch) {
  const time = clock(), elements = new Map(), messages = []
  let onMessage
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set(['hidden'])
      const listeners = {}
      elements.set(id, {
        textContent: '', className: '', disabled: false, checked: true, value: '', listeners,
        classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
        isHidden: () => classes.has('hidden'),
        querySelector: () => element('dot'), addEventListener: (type, callback) => { listeners[type] = callback },
      })
    }
    return elements.get(id)
  }
  const script = plugin().figma.html.match(/<script>([\s\S]*?)<\/script>/)[1]
  vm.runInNewContext(script, {
    document: { getElementById: element },
    parent: { postMessage: message => messages.push(structuredClone(message.pluginMessage)) },
    window: { addEventListener: (_, callback) => { onMessage = callback } },
    fetch, AbortController, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
  })
  return {
    time, element, messages,
    send: () => onMessage({ data: { pluginMessage: {
      type: 'sync', requestId: 7, data: { type: 'page', nodes: [], nodeCount: 0 },
    } } }),
    post: message => onMessage({ data: { pluginMessage: message } }),
    click: id => element(id).listeners.click(),
  }
}

test('generated UI script compiles, boots, posts the snapshot, and acknowledges its request', async () => {
  let request
  const panel = ui(async (url, options) => {
    request = { url, options }
    return { ok: true, json: async () => ({ message: 'Saved' }) }
  })
  assert.equal(panel.messages[0].type, 'ui-ready')
  await panel.send()
  assert.equal(request.url, 'http://localhost:3456/design')
  assert.equal(request.options.method, 'POST')
  assert.equal(JSON.parse(request.options.body).type, 'page')
  assert.equal(panel.messages.at(-1).requestId, 7)
  assert.equal(panel.messages.at(-1).success, true)
  assert.equal(panel.time.timers.size, 0)
  assert.equal(panel.element('syncBtn').disabled, false)
})

test('UI reports HTTP errors and network failures, releasing the request for retry', async () => {
  for (const fetch of [
    async () => ({ ok: false, status: 413, statusText: 'Payload Too Large' }),
    async () => { throw new Error('Network offline') },
  ]) {
    const panel = ui(fetch)
    await panel.send()
    const reply = panel.messages.at(-1)
    assert.equal(reply.success, false)
    assert.equal(reply.requestId, 7)
    assert.match(panel.element('errorMsg').textContent, /HTTP 413|Network offline/)
    assert.equal(panel.time.timers.size, 0)
    assert.equal(panel.element('syncBtn').disabled, false)
  }
})

test('UI turns a refused bridge reply into an error reply instead of dropping the session', async () => {
  const calls = []
  let replies = 0
  const respond = body => ({ ok: true, status: 200, text: async () => JSON.stringify(body) })
  const panel = ui(async (url, options = {}) => {
    calls.push({ url, body: options.body ? JSON.parse(options.body) : null })
    if (url.endsWith('/bridge/session')) return respond({ sessionId: 'sess-1', sessionSecret: 'secret-1' })
    if (url.includes('/poll')) return new Promise(() => {})
    if (url.endsWith('/reply') && ++replies === 1) throw new TypeError('Failed to fetch')
    return respond({ accepted: true })
  })
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)) }
  const lastStatus = () => panel.messages.filter(message => message.type === 'bridge-status').at(-1)

  await panel.post({
    type: 'bridge-start',
    config: { url: 'http://localhost:3456', token: 'pairing-token', fileKey: 'AAAAfileKeyAAAA', fileName: 'File', pluginInstanceId: 'plugin-1' },
  })
  await settle()
  assert.equal(lastStatus().connected, true)

  await panel.post({ type: 'bridge-result', sessionId: 'sess-1', requestId: 'request-9', ok: true, result: { payload: {} } })
  await settle()

  const replyCalls = calls.filter(call => call.url.endsWith('/reply'))
  assert.equal(replyCalls.length, 2)
  assert.equal(replyCalls[1].body.requestId, 'request-9')
  assert.equal(replyCalls[1].body.ok, false)
  assert.match(replyCalls[1].body.error, /did not accept the plugin reply: Failed to fetch/)
  assert.equal(lastStatus().connected, true)
  assert.equal(calls.filter(call => call.url.endsWith('/bridge/session')).length, 1)
})

function respondWith(status, body) {
  return { ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }
}

const settleUi = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)) }

test('the panel shows a pairing code, collects the token once approved and hands it over', async () => {
  const calls = []
  let checks = 0
  const panel = ui(async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', headers: options.headers || {} })
    if (url.endsWith('/bridge/pair')) {
      return respondWith(201, {
        pairingId: 'a'.repeat(32), pairingSecret: 'b'.repeat(64), code: '482913',
        expiresAt: new Date(Date.now() + 120000).toISOString(),
      })
    }
    if (url.includes('/bridge/pair/')) {
      return ++checks < 2 ? respondWith(200, { status: 'pending' }) : respondWith(200, { status: 'approved', token: 'fresh-token' })
    }
    return respondWith(200, {})
  })

  panel.click('pairBtn')
  await settleUi()
  assert.equal(calls[0].method, 'POST')
  assert.equal(panel.element('pairCode').textContent, '482 913')
  assert.equal(panel.element('pairCommand').textContent, '/figma-bridge:pair 482913')
  assert.equal(panel.element('pairCli').textContent, 'npm run bridge:pair -- 482913')

  panel.time.flush()
  await settleUi()
  assert.equal(panel.messages.some(message => message.type === 'paired'), false)

  panel.time.flush()
  await settleUi()
  const paired = panel.messages.find(message => message.type === 'paired')
  assert.equal(paired.token, 'fresh-token')
  assert.equal(panel.element('bridgeToken').value, 'fresh-token')
  const checksSent = calls.filter(call => call.url.includes('/bridge/pair/'))
  assert.equal(checksSent.length, 2)
  assert.ok(checksSent.every(call => call.headers['X-Pairing-Secret'] === 'b'.repeat(64)))
  assert.equal(panel.time.timers.size, 0)
})

test('an expired pairing code asks the user to pair again', async () => {
  const panel = ui(async url => url.endsWith('/bridge/pair')
    ? respondWith(201, { pairingId: 'a'.repeat(32), pairingSecret: 'b'.repeat(64), code: '111222', expiresAt: new Date().toISOString() })
    : respondWith(410, { code: 'PAIRING_EXPIRED', error: 'expired' }))

  panel.click('pairBtn')
  await settleUi()
  panel.time.flush()
  await settleUi()

  assert.match(panel.element('errorMsg').textContent, /expired\. Press Pair with bridge/)
  assert.equal(panel.element('pairBtn').disabled, false)
  assert.equal(panel.messages.some(message => message.type === 'paired'), false)
})

test('UI aborts a stalled upload and reports a timeout instead of hanging', async () => {
  const panel = ui((_, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('Aborted')
      error.name = 'AbortError'
      reject(error)
    })
  }))
  const sending = panel.send()
  assert.equal(panel.element('syncBtn').disabled, true)
  panel.time.flush()
  await sending
  assert.equal(panel.messages.at(-1).success, false)
  assert.match(panel.messages.at(-1).error, /timed out/)
  assert.equal(panel.element('syncBtn').disabled, false)
})

const savedConfig = { url: 'http://localhost:3456', token: 'saved-token', fileKey: 'AAAAfileKeyAAAA', fileName: 'File', pluginInstanceId: 'plugin-1' }
const lastBridgeStatus = panel => panel.messages.filter(message => message.type === 'bridge-status').at(-1)

test('the panel waits quietly while no bridge runs, then connects by itself', async () => {
  let running = false
  const panel = ui(async url => {
    if (!running) throw new TypeError('Failed to fetch')
    if (url.endsWith('/bridge/session')) return respondWith(201, { sessionId: 'sess-1', sessionSecret: 'secret-1' })
    return new Promise(() => {})
  })

  await panel.post({ type: 'bridge-start', config: savedConfig })
  await settleUi()
  assert.equal(panel.element('statusText').textContent, 'Waiting for the bridge...')
  assert.equal(panel.element('waitHint').isHidden(), false)
  assert.match(panel.element('waitHint').textContent, /^Nothing answers at http:\/\/localhost:3456 yet\./)
  assert.equal(panel.element('errorMsg').isHidden(), true, 'nothing running yet is not an error')
  assert.equal(lastBridgeStatus(panel).error, null)
  assert.equal(panel.time.timers.size, 1, 'it stopped trying')

  for (let retry = 0; retry < 4; retry++) {
    panel.time.flush()
    await settleUi()
  }
  assert.equal(panel.element('statusText').textContent, 'Waiting for the bridge...')
  assert.deepEqual(panel.time.delays, [750, 1500, 3000, 5000, 5000])

  running = true
  panel.time.flush()
  await settleUi()
  assert.equal(lastBridgeStatus(panel).connected, true)
  assert.equal(panel.element('statusText').textContent, 'Connected')
  assert.equal(panel.element('waitHint').isHidden(), true)
})

test('a token the bridge rejects stops the retries and offers pairing', async () => {
  const calls = []
  const panel = ui(async url => {
    calls.push(url)
    if (url.endsWith('/bridge/session')) return respondWith(401, { code: 'UNAUTHORIZED', error: 'Missing or invalid bridge token.' })
    if (url.endsWith('/bridge/pair')) {
      return respondWith(201, {
        pairingId: 'a'.repeat(32), pairingSecret: 'b'.repeat(64), code: '482913',
        expiresAt: new Date(Date.now() + 120000).toISOString(),
      })
    }
    return respondWith(200, { status: 'approved', token: 'fresh-token' })
  })
  panel.element('bridgeToken').value = 'saved-token'

  await panel.post({ type: 'bridge-start', config: savedConfig })
  await settleUi()
  assert.equal(panel.time.timers.size, 0, 'it kept retrying a token the bridge refuses')
  assert.equal(calls.filter(url => url.endsWith('/bridge/session')).length, 1)
  assert.equal(panel.element('statusText').textContent, 'Pairing needed')
  assert.equal(panel.element('pairSection').isHidden(), false, 'a saved token hid the way out')
  assert.match(panel.element('errorMsg').textContent, /did not accept the saved token/)

  panel.click('pairBtn')
  await settleUi()
  panel.time.flush()
  await settleUi()
  assert.equal(panel.messages.find(message => message.type === 'paired').token, 'fresh-token')
  assert.equal(panel.element('pairSection').isHidden(), true)
})

test('a sync with no bridge running says how to start one', async () => {
  const panel = ui(async () => { throw new TypeError('Failed to fetch') })
  await panel.send()
  assert.match(panel.element('errorMsg').textContent, /^No bridge is running at http:\/\/localhost:3456\. Open Claude Code/)
  assert.match(panel.messages.at(-1).error, /No bridge is running/)
})

test('an upload the running bridge cuts off is not blamed on a missing bridge', async () => {
  const panel = ui(async url => {
    if (url.endsWith('/bridge/health')) return respondWith(200, { status: 'ok' })
    throw new TypeError('Failed to fetch')
  })
  await panel.send()
  assert.match(panel.messages.at(-1).error, /dropped the upload.*FIGMA_BRIDGE_MAX_BODY_BYTES/)
})

test('a pasted token clears the rejection it replaces', async () => {
  const panel = ui(async () => respondWith(401, { code: 'UNAUTHORIZED', error: 'Missing or invalid bridge token.' }))
  await panel.post({ type: 'bridge-start', config: savedConfig })
  await settleUi()
  assert.equal(panel.element('statusText').textContent, 'Pairing needed')

  panel.element('bridgeToken').value = 'new-token'
  panel.element('bridgeToken').listeners.change({ target: panel.element('bridgeToken') })
  assert.equal(panel.element('statusText').textContent, 'Not connected')
  assert.equal(panel.element('errorMsg').isHidden(), true)
  assert.equal(panel.messages.at(-1).type, 'set-token')
})

test('waiting for the bridge does not reach the panel as an error', async () => {
  const p = bridgePlugin()
  await p.ready()
  p.sent.length = 0
  await p.message({ type: 'bridge-status', connected: false, error: null })
  assert.equal(p.sent.some(message => message.type === 'error'), false)
  assert.equal(p.sent.at(-1).type, 'status')

  await p.message({ type: 'bridge-status', connected: false, error: 'This bridge did not accept the saved token.' })
  assert.equal(p.sent.at(-1).type, 'error')
})

const edit = { type: 'bridge-invalidate', fileKey: 'AAAAfileKeyAAAA', reason: 'documentchange' }

test('the panel keeps one invalidation in flight and folds a burst of edits into one follow-up', async () => {
  const invalidations = []
  const panel = ui(async (url, options = {}) => {
    if (url.endsWith('/bridge/session')) return respondWith(201, { sessionId: 'sess-1', sessionSecret: 'secret-1' })
    if (url.endsWith('/invalidate')) {
      return new Promise(resolve => invalidations.push({ body: JSON.parse(options.body), done: () => resolve(respondWith(200, { invalidated: 1 })) }))
    }
    if (url.endsWith('/heartbeat')) return respondWith(200, { ok: true })
    return new Promise(() => {})
  })
  await panel.post({ type: 'bridge-start', config: savedConfig })
  await settleUi()

  for (let i = 0; i < 10; i++) panel.post(edit)
  await settleUi()
  assert.equal(invalidations.length, 1, 'edits made during an invalidation must wait for it')

  invalidations[0].done()
  await settleUi()
  assert.equal(invalidations.length, 1, 'the follow-up must wait')
  assert.equal(panel.time.delays.at(-1), 1000)

  // An edit made while the follow-up waits rides on it.
  panel.post(edit)
  panel.time.flush()
  await settleUi()
  assert.equal(invalidations.length, 2)
  assert.deepEqual(invalidations[1].body, { fileKey: 'AAAAfileKeyAAAA', reason: 'documentchange' })

  invalidations[1].done()
  await settleUi()
  panel.time.flush()
  await settleUi()
  assert.equal(invalidations.length, 2, 'nothing changed after the follow-up, so nothing more is sent')
})

test('closing the panel drops a waiting invalidation and ends the session with a request that outlives the panel', async () => {
  const calls = []
  const panel = ui(async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith('/bridge/session')) return respondWith(201, { sessionId: 'sess-1', sessionSecret: 'secret-1' })
    if (url.includes('/poll')) return new Promise(() => {})
    return respondWith(200, {})
  })
  await panel.post({ type: 'bridge-start', config: savedConfig })
  await settleUi()
  panel.post(edit)
  panel.post(edit)
  await settleUi()
  assert.equal(panel.time.delays.at(-1), 1000, 'the second edit should wait for a follow-up')

  await panel.post({ type: 'bridge-stop', reason: 'plugin-close' })
  const close = calls.find(call => call.options.method === 'DELETE')
  assert.equal(close.url, 'http://localhost:3456/bridge/session/sess-1?reason=plugin-close')
  assert.equal(close.options.keepalive, true)
  assert.equal(close.options.headers['X-Session-Secret'], 'secret-1')
  assert.equal(panel.time.timers.size, 0, 'a follow-up invalidation outlived the session')
  assert.equal(calls.filter(call => call.url.endsWith('/invalidate')).length, 1)
})

test('a late failure from a replaced session does not end the new one', async () => {
  let sessions = 0
  let failInvalidate
  const panel = ui(async url => {
    if (url.endsWith('/bridge/session')) return respondWith(201, { sessionId: `sess-${++sessions}`, sessionSecret: 'secret' })
    if (url.includes('/poll')) return new Promise(() => {})
    if (url.endsWith('/invalidate')) return new Promise((_, reject) => { failInvalidate = reject })
    return respondWith(200, {})
  })

  await panel.post({ type: 'bridge-start', config: savedConfig })
  await settleUi()
  panel.post({ type: 'bridge-invalidate', fileKey: 'AAAAfileKeyAAAA', reason: 'documentchange' })
  await settleUi()
  // The panel reconnects while that invalidate is still out, then it fails.
  await panel.post({ type: 'bridge-start', config: savedConfig })
  await settleUi()
  failInvalidate(new TypeError('Failed to fetch'))
  await settleUi()

  assert.equal(sessions, 2)
  assert.equal(lastBridgeStatus(panel).connected, true)
  assert.equal(panel.element('statusText').textContent, 'Connected')
})

test('a heartbeat of a replaced session does not start a second heartbeat chain', async () => {
  let sessions = 0
  let finishHeartbeat
  const panel = ui(async url => {
    if (url.endsWith('/bridge/session')) return respondWith(201, { sessionId: `sess-${++sessions}`, sessionSecret: 'secret' })
    if (url.includes('/poll')) return new Promise(() => {})
    if (url.endsWith('/heartbeat') && !finishHeartbeat) return new Promise(resolve => { finishHeartbeat = () => resolve(respondWith(200, { ok: true })) })
    return respondWith(200, { ok: true })
  })
  const heartbeats = () => [...panel.time.timers.keys()].filter(id => panel.time.delays[id - 1] === 10000).length

  await panel.post({ type: 'bridge-start', config: savedConfig })
  await settleUi()
  panel.time.flush() // the first session's heartbeat goes out and stays pending
  await settleUi()
  await panel.post({ type: 'bridge-start', config: savedConfig })
  await settleUi()
  assert.equal(heartbeats(), 1)

  finishHeartbeat()
  await settleUi()
  assert.equal(sessions, 2)
  assert.equal(heartbeats(), 1, 'the old heartbeat scheduled another one for the new session')
})
