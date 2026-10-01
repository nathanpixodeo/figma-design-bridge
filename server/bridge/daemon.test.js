const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

const { createDaemon, startOrReuse, probe, baseUrl, SERVICE_NAME, PROTOCOL_VERSION } = require('./daemon')
const { readToken, TOKEN_FILENAME } = require('./token')

const quietLog = () => {}

function tempDataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-bridge-daemon-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

// ── Injected fakes (the real siblings are built in parallel) ──

function createFakeIdentity() {
  return {
    parseSource(source) { return { fileKey: String(source), nodeId: null, kind: 'file' } },
    canonicalNodeId(id) { return typeof id === 'string' ? id.replace('-', ':') : null },
    urlNodeId(id) { return String(id).replace(':', '-') },
    cacheKey({ fileKey, nodeId, representation }) { return `${fileKey}|${nodeId || 'ROOT'}|${representation}` },
    cacheFilename(key) { return `${key}.json` },
    sameFile(a, b) { return a === b },
  }
}

function createFakeCache() {
  return {
    get: () => null,
    put: entry => entry,
    invalidateFile: () => 0,
    invalidateNode: () => 0,
    list: () => [],
    stats: () => ({ entryCount: 0, byteSize: 0, files: [] }),
    clear: () => {},
  }
}

// A broker whose long poll only settles when the daemon cancels it, so close()
// has to release waiters rather than wait for them.
function createFakeBroker() {
  const waiters = []
  const calls = { cancelled: [] }
  return {
    calls,
    waiters,
    registerSession: () => ({ sessionId: 'sess-1', sessionSecret: 'secret-1', registeredAt: null }),
    heartbeat: () => ({ ok: true, pendingCount: 0 }),
    closeSession: () => ({ closed: true, rejected: 0 }),
    listSessions: () => [],
    hasSessionForFile: () => false,
    request: async () => ({ result: {}, sessionId: 'sess-1', requestId: 'req-1' }),
    poll: () => new Promise(resolve => waiters.push(resolve)),
    reply: () => ({ accepted: true, reason: null }),
    cancelAll(reason) {
      calls.cancelled.push(reason)
      while (waiters.length) waiters.shift()({ requests: [] })
    },
    stats: () => ({ pending: waiters.length }),
  }
}

function fakeDeps() {
  return { identity: createFakeIdentity(), cache: createFakeCache(), broker: createFakeBroker() }
}

async function startDaemon(t, options = {}) {
  const daemon = await createDaemon({
    port: 0, // ephemeral: the running bridge on 3456 is never touched
    dataDir: options.dataDir || tempDataDir(t),
    log: quietLog,
    ...fakeDeps(),
    ...options,
  })
  t.after(() => daemon.close('test-teardown'))
  return daemon
}

async function foreignServer(t, handler) {
  const server = http.createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    server.close(() => resolve())
  }))
  const { port } = server.address()
  return { server, port, url: `http://127.0.0.1:${port}` }
}

function json(body) {
  return (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
}

async function freePort(t) {
  const server = http.createServer()
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise(resolve => server.close(() => resolve()))
  return port
}

// ── Binding ───────────────────────────────────────────────

test('createDaemon refuses anything but a loopback bind address', async t => {
  const dataDir = tempDataDir(t)

  for (const host of ['0.0.0.0', '::', '192.168.1.10', 'example.com']) {
    await assert.rejects(
      () => createDaemon({ port: 0, host, dataDir, log: quietLog, ...fakeDeps() }),
      /loopback/,
      host,
    )
  }

  await assert.rejects(() => createDaemon({ port: 0, log: quietLog, ...fakeDeps() }), /dataDir/)
})

test('a started daemon serves health, authenticates and falls through for other paths', async t => {
  const dataDir = tempDataDir(t)
  const fellThrough = []
  const daemon = await startDaemon(t, {
    dataDir,
    fallback: (req, res) => {
      fellThrough.push(req.url)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"legacy":true}')
    },
  })

  assert.equal(daemon.host, '127.0.0.1')
  assert.ok(daemon.port > 0)
  assert.equal(daemon.url, `http://127.0.0.1:${daemon.port}`)
  assert.equal(daemon.protocolVersion, PROTOCOL_VERSION)

  // The token was minted into the temp data dir, not into server/data.
  assert.equal(readToken(dataDir).token, daemon.token)
  assert.ok(fs.existsSync(path.join(dataDir, TOKEN_FILENAME)))

  const health = await fetch(`${daemon.url}/bridge/health`)
  const healthBody = await health.json()
  assert.equal(health.status, 200)
  assert.equal(healthBody.service, SERVICE_NAME)

  const unauthorized = await fetch(`${daemon.url}/bridge/status`)
  assert.equal(unauthorized.status, 401)

  const authorized = await fetch(`${daemon.url}/bridge/status`, {
    headers: { authorization: `Bearer ${daemon.token}` },
  })
  assert.equal(authorized.status, 200)
  assert.equal((await authorized.json()).readiness.ready, false)

  const legacy = await fetch(`${daemon.url}/design/summary`)
  assert.equal(legacy.status, 200)
  assert.deepEqual(fellThrough, ['/design/summary'])
})

test('createFallback builds the legacy handler with the daemon token', async t => {
  const seen = []
  const daemon = await startDaemon(t, {
    createFallback: ({ token, dataDir }) => {
      seen.push({ token, dataDir })
      return (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ authorized: req.headers.authorization === `Bearer ${token}` }))
      }
    },
  })

  assert.equal(seen.length, 1)
  assert.equal(seen[0].token, daemon.token)

  const response = await fetch(`${daemon.url}/design`, { headers: { authorization: `Bearer ${daemon.token}` } })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { authorized: true })
})

test('a daemon without a fallback answers non-bridge paths with a JSON 404', async t => {
  const daemon = await startDaemon(t)
  const response = await fetch(`${daemon.url}/design`)

  assert.equal(response.status, 404)
  assert.equal((await response.json()).code, 'NOT_FOUND')
})

test('the daemon logs to stderr and never writes the token to stdout', async t => {
  const dataDir = tempDataDir(t)
  const stdout = []
  const stderr = []
  const originalOut = process.stdout.write.bind(process.stdout)
  const originalErr = process.stderr.write.bind(process.stderr)
  process.stdout.write = (chunk, ...rest) => { stdout.push(String(chunk)); return originalOut(chunk, ...rest) }
  process.stderr.write = (chunk, ...rest) => { stderr.push(String(chunk)); return true }
  t.after(() => { process.stdout.write = originalOut; process.stderr.write = originalErr })

  // Default logger: no `log` override.
  const daemon = await createDaemon({ port: 0, dataDir, ...fakeDeps() })
  await daemon.close('test-teardown')
  process.stdout.write = originalOut
  process.stderr.write = originalErr

  const out = stdout.join('')
  assert.equal(out.includes(daemon.token), false)
  assert.equal(out.includes('bridge daemon listening'), false)
  assert.match(stderr.join(''), /bridge daemon listening on http:\/\/127\.0\.0\.1:/)
  assert.equal(stderr.join('').includes(daemon.token), false)
})

// ── Probe ─────────────────────────────────────────────────

test('probe recognizes this service and refuses to claim anything else', async t => {
  const daemon = await startDaemon(t)

  assert.deepEqual(await probe(daemon.url), {
    ours: true,
    protocolVersion: PROTOCOL_VERSION,
    reason: 'ok',
  })

  const cases = [
    ['foreign-service', await foreignServer(t, json({ status: 'ok', service: 'some-other-dev-server' }))],
    ['foreign-service', await foreignServer(t, json({ status: 'ok' }))],
    ['incompatible-protocol', await foreignServer(t, json({ service: SERVICE_NAME, protocolVersion: '2.0' }))],
    ['incompatible-protocol', await foreignServer(t, json({ service: SERVICE_NAME }))],
    ['non-json-response', await foreignServer(t, (req, res) => { res.writeHead(200).end('<html>hi</html>') })],
    ['http-404', await foreignServer(t, (req, res) => { res.writeHead(404).end() })],
  ]

  for (const [reason, listener] of cases) {
    const result = await probe(listener.url)
    assert.equal(result.ours, false, reason)
    assert.equal(result.reason, reason)
  }

  const closed = await freePort(t)
  const dead = await probe(baseUrl('127.0.0.1', closed))
  assert.equal(dead.ours, false)
  assert.equal(dead.reason, 'no-listener')

  assert.deepEqual(await probe('not a url'), { ours: false, protocolVersion: null, reason: 'invalid-url' })
})

test('probe times out instead of hanging on a listener that never answers', async t => {
  const listener = await foreignServer(t, () => {}) // accepts, never responds
  const result = await probe(listener.url, { timeoutMs: 150 })

  assert.equal(result.ours, false)
  assert.equal(result.reason, 'timeout')
})

// ── startOrReuse ──────────────────────────────────────────

test('startOrReuse refuses an unknown listener instead of killing it', async t => {
  const dataDir = tempDataDir(t)
  const listener = await foreignServer(t, json({ status: 'ok', service: 'some-other-dev-server' }))

  await assert.rejects(
    () => startOrReuse({ port: listener.port, dataDir, log: quietLog, ...fakeDeps() }),
    error => {
      assert.equal(error.code, 'PORT_OCCUPIED')
      assert.equal(error.reason, 'foreign-service')
      assert.match(error.message, new RegExp(`Port ${listener.port} is already in use`))
      assert.match(error.message, /will not stop or reuse an unknown listener/)
      return true
    },
  )

  // The foreign process is untouched and still serving.
  assert.equal(listener.server.listening, true)
  assert.equal((await fetch(`${listener.url}/bridge/health`)).status, 200)
})

test('startOrReuse reuses a bridge that is already running and never stops it', async t => {
  const dataDir = tempDataDir(t)
  const daemon = await startDaemon(t, { dataDir })

  const reused = await startOrReuse({ port: daemon.port, dataDir, log: quietLog, ...fakeDeps() })

  assert.equal(reused.reused, true)
  assert.equal(reused.started, false)
  assert.equal(reused.owned, false)
  assert.equal(reused.server, null)
  assert.equal(reused.port, daemon.port)
  assert.equal(reused.token, daemon.token)
  assert.equal(reused.protocolVersion, PROTOCOL_VERSION)

  // Closing a descriptor we did not start is a no-op.
  await reused.close()
  assert.equal(daemon.server.listening, true)
  assert.equal((await fetch(`${daemon.url}/bridge/health`)).status, 200)
})

test('startOrReuse requires a fixed port', async t => {
  const dataDir = tempDataDir(t)
  await assert.rejects(() => startOrReuse({ port: 0, dataDir, ...fakeDeps() }), /fixed port/)
  await assert.rejects(() => startOrReuse({ dataDir: '', ...fakeDeps() }), /dataDir/)
})

test('two concurrent startOrReuse calls converge on a single daemon', async t => {
  const dataDir = tempDataDir(t)
  const port = await freePort(t)

  const results = await Promise.all([
    startOrReuse({ port, dataDir, log: quietLog, ...fakeDeps() }),
    startOrReuse({ port, dataDir, log: quietLog, ...fakeDeps() }),
  ])
  t.after(() => Promise.all(results.map(result => result.close('test-teardown'))))

  assert.equal(results.filter(result => result.started).length, 1)
  assert.equal(results[0].url, results[1].url)
  assert.equal(results[0].port, port)
  assert.equal(results[0].token, results[1].token)

  const probed = await probe(results[0].url)
  assert.equal(probed.ours, true)
})

// ── Shutdown ──────────────────────────────────────────────

test('close releases the port and cancels waiting long polls', async t => {
  const dataDir = tempDataDir(t)
  const broker = createFakeBroker()
  const daemon = await createDaemon({
    port: 0, dataDir, log: quietLog, ...fakeDeps(), broker,
  })

  // A long poll parked in the broker must not keep the daemon alive.
  const parked = fetch(`${daemon.url}/bridge/session/sess-1/poll?waitMs=30000`, {
    headers: { authorization: `Bearer ${daemon.token}`, 'x-session-secret': 'secret-1' },
  }).catch(() => 'aborted')
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(broker.waiters.length, 1)

  await daemon.close('test-shutdown')
  await daemon.close('test-shutdown')  // idempotent

  assert.deepEqual(broker.calls.cancelled, ['test-shutdown'])
  assert.equal(daemon.server.listening, false)
  assert.equal((await probe(daemon.url, { timeoutMs: 500 })).reason, 'no-listener')
  await parked
})

// ── Integration with the real sibling modules ─────────────

test('a real daemon carries a live read from the agent to the plugin and back', async t => {
  const dataDir = tempDataDir(t)
  // No injected fakes: the real broker, cache and identity modules.
  const daemon = await createDaemon({ port: 0, dataDir, log: quietLog })
  t.after(() => daemon.close('test-teardown'))

  const auth = { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' }
  const post = (path, body, headers = {}) => fetch(`${daemon.url}${path}`, {
    method: 'POST', headers: { ...auth, ...headers }, body: JSON.stringify(body),
  })

  const registration = await post('/bridge/session', {
    fileKey: 'FILE1', fileName: 'App', pluginInstanceId: 'plugin-a',
  })
  assert.equal(registration.status, 201)
  const session = await registration.json()
  const asPlugin = { 'x-session-secret': session.sessionSecret }

  // Plugin side parks on a long poll; the agent side then asks for a node.
  const polling = fetch(`${daemon.url}/bridge/session/${session.sessionId}/poll?waitMs=5000`, {
    headers: { ...auth, ...asPlugin },
  }).then(response => response.json())
  const reading = post('/bridge/read', { source: 'https://www.figma.com/design/FILE1/App?node-id=12-34' })
    .then(async response => ({ status: response.status, body: await response.json() }))

  const polled = await polling
  assert.equal(polled.requests.length, 1)
  assert.equal(polled.requests[0].op, 'read-node')
  assert.equal(polled.requests[0].params.nodeId, '12:34')

  const reply = await post(`/bridge/session/${session.sessionId}/reply`, {
    requestId: polled.requests[0].requestId,
    ok: true,
    result: {
      fileKey: 'FILE1', fileName: 'App', nodeId: '12:34', pageId: '0:1', pageName: 'Home',
      completeness: { nodeCount: 3, byteSize: 128, limitHit: false, truncatedNodeIds: [] },
      payload: { id: '12:34', name: 'Hero', type: 'FRAME' },
    },
  }, asPlugin)
  assert.equal(reply.status, 200)
  assert.equal((await reply.json()).accepted, true)

  const read = await reading
  assert.equal(read.status, 200)
  assert.equal(read.body.freshness, 'live')
  assert.equal(read.body.verifiedFresh, true)
  assert.equal(read.body.cached, true)
  assert.deepEqual(read.body.payload, { id: '12:34', name: 'Hero', type: 'FRAME' })

  // The same entry read back explicitly from cache admits it cannot prove freshness.
  const cached = await (await post('/bridge/read', {
    source: 'https://www.figma.com/design/FILE1/App?node-id=12-34', mode: 'cached',
  })).json()
  assert.equal(cached.freshness, 'unknown')
  assert.equal(cached.verifiedFresh, false)
  assert.ok(cached.ageMs >= 0)

  const invalidated = await (await post(`/bridge/session/${session.sessionId}/invalidate`,
    { reason: 'documentchange' }, asPlugin)).json()
  assert.equal(invalidated.fileKey, 'FILE1')
  assert.equal(invalidated.invalidated, 1)

  const status = await fetch(`${daemon.url}/bridge/status`, { headers: auth })
  const statusRaw = await status.text()
  assert.equal(statusRaw.includes(daemon.token), false)
  assert.equal(statusRaw.includes(session.sessionSecret), false)
  assert.deepEqual(JSON.parse(statusRaw).readiness.liveFileKeys, ['FILE1'])
})

test('createDaemon reports a missing sibling module as an actionable error', async t => {
  const dataDir = tempDataDir(t)

  // cache.js, identity.js and broker.js are written by other workers. Whichever
  // way this lands, it must not be an import-time crash.
  let daemon = null
  try {
    daemon = await createDaemon({ port: 0, dataDir, log: quietLog })
  } catch (error) {
    assert.equal(error.code, 'BRIDGE_MODULE_MISSING')
    assert.match(error.message, /server\/bridge\/(cache|identity|broker)\.js is not available/)
    assert.match(error.message, /pass a \{ (cache|identity|broker) \} implementation/)
    return
  }
  t.after(() => daemon.close('test-teardown'))
  assert.equal((await fetch(`${daemon.url}/bridge/health`)).status, 200)
})
