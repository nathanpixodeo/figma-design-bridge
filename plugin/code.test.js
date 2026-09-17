const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, 'code.js'), 'utf8')

function clock() {
  let id = 0
  const timers = new Map()
  return {
    timers,
    setTimeout(callback) { timers.set(++id, callback); return id },
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

function bridgePlugin({ characters = 'Hello from another page' } = {}) {
  const time = clock()
  const sent = [], notifications = [], events = new Map(), storage = new Map()
  const activePage = { id: '0:1', name: 'Screens', type: 'PAGE', selection: [], children: [] }
  const otherPage = { id: '0:2', name: 'Archive', type: 'PAGE', selection: [], children: [] }
  const target = { id: '2:2', name: 'Archived copy', type: 'TEXT', characters }
  const frame = { id: '2:1', name: 'Archived screen', type: 'FRAME', children: [target] }
  const root = { id: '0:0', name: 'Bridge Test File', type: 'DOCUMENT', children: [activePage, otherPage] }
  activePage.parent = root
  otherPage.parent = root
  frame.parent = otherPage
  target.parent = frame
  otherPage.children = [frame]
  const nodes = new Map([[root.id, root], [activePage.id, activePage], [otherPage.id, otherPage], [frame.id, frame], [target.id, target]])
  const figma = {
    command: 'bridge', currentPage: activePage, root, fileKey: 'AAAAfileKeyAAAA', closed: false,
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
  vm.runInNewContext(source, { figma, setTimeout: time.setTimeout, clearTimeout: time.clearTimeout })
  return {
    figma, time, sent, notifications, target, activePage, otherPage,
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

function ui(fetch) {
  const time = clock(), elements = new Map(), messages = []
  let onMessage
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set(['hidden'])
      elements.set(id, {
        textContent: '', className: '', disabled: false, checked: true,
        classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
        querySelector: () => element('dot'), addEventListener() {},
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
