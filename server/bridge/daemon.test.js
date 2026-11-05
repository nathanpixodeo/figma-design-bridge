const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

const { createDaemon, startOrReuse, probe, baseUrl, compareVersions, SERVICE_NAME, PROTOCOL_VERSION } = require('./daemon')
const { readToken, rotateToken, TOKEN_FILENAME } = require('./token')

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
    createFallback: ({ token, currentToken, dataDir }) => {
      seen.push({ token, currentToken, dataDir })
      return (req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ authorized: req.headers.authorization === `Bearer ${token}` }))
      }
    },
  })

  assert.equal(seen.length, 1)
  assert.equal(seen[0].token, daemon.token)
  assert.equal(seen[0].currentToken(), daemon.token)

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
    serverVersion: null,
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

test('rotating the token revokes the old one while the daemon keeps running', async t => {
  const dataDir = tempDataDir(t)
  const daemon = await createDaemon({ port: 0, dataDir, log: quietLog })
  t.after(() => daemon.close('test-teardown'))
  const status = token => fetch(`${daemon.url}/bridge/status`, { headers: { authorization: `Bearer ${token}` } })

  assert.equal((await status(daemon.token)).status, 200)
  const { token: rotated } = rotateToken(dataDir)
  assert.equal((await status(daemon.token)).status, 401)
  assert.equal((await status(rotated)).status, 200)
  assert.equal(daemon.currentToken(), rotated)
})

test('a listener that does not answer the health check in time is reported busy, not foreign', async t => {
  const dataDir = tempDataDir(t)
  // Accepts connections, never answers: what a bridge stuck on a long read looks like.
  const stalled = http.createServer(() => {})
  await new Promise(resolve => stalled.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { stalled.closeAllConnections(); stalled.close(() => resolve()) }))

  await assert.rejects(
    startOrReuse({ port: stalled.address().port, dataDir, probeTimeoutMs: 100, log: quietLog }),
    { code: 'BRIDGE_BUSY' },
  )
})

// ── Version handoff ───────────────────────────────────────

test('compareVersions orders x.y.z numerically, with a missing version lowest', () => {
  assert.equal(compareVersions('1.12.0', '1.11.9'), 1)
  assert.equal(compareVersions('1.9.0', '1.10.0'), -1)
  assert.equal(compareVersions('1.12.0', '1.12.0'), 0)
  assert.equal(compareVersions('1.12.0-beta.1', '1.12.0'), 0)
  assert.equal(compareVersions(null, '1.0.0'), -1)
  assert.equal(compareVersions('1.0.0', undefined), 1)
  assert.equal(compareVersions(null, null), 0)
})

// A host on a fixed port, as one MCP server of a given version starts it.
async function hostOnPort(t, port, dataDir, serverVersion, extra = {}) {
  const handoffs = []
  const host = await startOrReuse({
    port, dataDir, serverVersion, log: quietLog, ...fakeDeps(),
    onHandoff: info => handoffs.push(info),
    ...extra,
  })
  t.after(() => host.close('test-teardown'))
  return { host, handoffs }
}

test('probe reports the version of the server that owns the port', async t => {
  const daemon = await startDaemon(t, { serverVersion: '1.12.0' })
  const found = await probe(daemon.url)
  assert.equal(found.ours, true)
  assert.equal(found.serverVersion, '1.12.0')
})

test('startOrReuse has an older owner hand the port over, and starts the bridge itself', async t => {
  const dataDir = tempDataDir(t)
  const port = await freePort(t)
  const old = await hostOnPort(t, port, dataDir, '1.12.0')
  assert.equal(old.host.started, true)

  const { host } = await hostOnPort(t, port, dataDir, '1.12.1')

  assert.equal(host.started, true)
  assert.equal(host.owned, true)
  assert.equal(host.handedOver, true)
  assert.equal(host.outdatedHost, false)
  assert.equal(host.port, port)
  assert.deepEqual(old.handoffs, [{ version: '1.12.1' }])
  assert.equal(old.host.server.listening, false)
  const found = await probe(host.url)
  assert.equal(found.serverVersion, '1.12.1')
})

test('startOrReuse reuses an owner of the same version or newer, and never asks it to hand over', async t => {
  const dataDir = tempDataDir(t)
  const port = await freePort(t)
  const owner = await hostOnPort(t, port, dataDir, '1.12.1')

  for (const version of ['1.12.1', '1.12.0', '1.3.0']) {
    const reused = await startOrReuse({ port, dataDir, serverVersion: version, log: quietLog, ...fakeDeps() })
    assert.equal(reused.reused, true, version)
    assert.equal(reused.hostVersion, '1.12.1')
    assert.equal(reused.outdatedHost, false)
  }
  assert.deepEqual(owner.handoffs, [])
  assert.equal(owner.host.server.listening, true)
})

test('startOrReuse reuses an owner from before 1.12.0 and says it is outdated', async t => {
  const dataDir = tempDataDir(t)
  const port = await freePort(t)
  // No serverVersion: what a bridge from before 1.12.0 reports.
  const owner = await hostOnPort(t, port, dataDir, undefined)

  const reused = await startOrReuse({ port, dataDir, serverVersion: '1.12.0', log: quietLog, ...fakeDeps() })

  assert.equal(reused.reused, true)
  assert.equal(reused.hostVersion, null)
  assert.equal(reused.outdatedHost, true)
  assert.equal(owner.host.server.listening, true)
})

test('an owner refuses a handoff without the token, from a browser, or to a server not newer than it', async t => {
  const dataDir = tempDataDir(t)
  const port = await freePort(t)
  const owner = await hostOnPort(t, port, dataDir, '1.12.0')
  const url = `${owner.host.url}/bridge/handoff`
  const post = (headers, body) => fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  const auth = { authorization: `Bearer ${owner.host.token}` }

  assert.equal((await post({}, { version: '9.0.0' })).status, 401)
  assert.equal((await post({ ...auth, origin: 'https://www.figma.com' }, { version: '9.0.0' })).status, 403)
  const same = await post(auth, { version: '1.12.0' })
  assert.equal(same.status, 409)
  assert.equal((await same.json()).code, 'HANDOFF_REFUSED')
  assert.equal((await post(auth, { version: '1.12.0', extra: true })).status, 400)
  assert.deepEqual(owner.handoffs, [])
  assert.equal(owner.host.server.listening, true)
})

test('five servers starting at once against an older owner converge on one new owner', async t => {
  const dataDir = tempDataDir(t)
  const port = await freePort(t)
  const old = await hostOnPort(t, port, dataDir, '1.12.0')

  const results = await Promise.all(Array.from({ length: 5 }, () => startOrReuse({
    port, dataDir, serverVersion: '1.12.1', log: quietLog, ...fakeDeps(),
  })))
  t.after(() => Promise.all(results.map(result => result.close('test-teardown'))))

  assert.equal(results.filter(result => result.started).length, 1)
  assert.ok(results.every(result => result.url === results[0].url))
  assert.ok(results.every(result => result.outdatedHost === false))
  assert.equal(old.handoffs.length, 1)
  assert.equal((await probe(results[0].url)).serverVersion, '1.12.1')
})

test('a server whose handoff request finds the owner already closing waits for the port instead of reusing that owner', async t => {
  const dataDir = tempDataDir(t)
  const port = await freePort(t)
  const old = await hostOnPort(t, port, dataDir, '1.12.0')
  // Another server's handoff lands first: the owner lets go, and this
  // server's own request finds nobody to answer it.
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/bridge/handoff')) {
      await globalThis.fetch(url, init)
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
    }
    return globalThis.fetch(url, init)
  }

  const host = await startOrReuse({ port, dataDir, serverVersion: '1.12.1', fetchImpl, log: quietLog, ...fakeDeps() })
  t.after(() => host.close('test-teardown'))

  assert.equal(host.outdatedHost, false)
  assert.equal(host.owned, true)
  assert.deepEqual(old.handoffs, [{ version: '1.12.1' }])
  assert.equal((await probe(host.url)).serverVersion, '1.12.1')
})

test('the newest of several servers ends up owning the port', async t => {
  const dataDir = tempDataDir(t)
  const port = await freePort(t)
  await hostOnPort(t, port, dataDir, '1.12.0')

  const middle = await hostOnPort(t, port, dataDir, '1.12.1')
  const newest = await hostOnPort(t, port, dataDir, '1.13.0')
  const late = await startOrReuse({ port, dataDir, serverVersion: '1.12.1', log: quietLog, ...fakeDeps() })

  assert.equal(middle.host.started, true)
  assert.deepEqual(middle.handoffs, [{ version: '1.13.0' }])
  assert.equal(newest.host.owned, true)
  assert.equal(late.reused, true)
  assert.equal(late.hostVersion, '1.13.0')
  assert.equal((await probe(newest.host.url)).serverVersion, '1.13.0')
})

test('a server that just handed the port over waits for its successor instead of taking it back', async t => {
  const dataDir = tempDataDir(t)
  const port = await freePort(t)
  // Nothing listens yet; the successor binds after a moment.
  let successor = null
  setTimeout(() => {
    startOrReuse({ port, dataDir, serverVersion: '1.12.1', log: quietLog, ...fakeDeps() })
      .then(host => { successor = host })
  }, 300)
  t.after(() => successor && successor.close('test-teardown'))

  const reused = await startOrReuse({
    port, dataDir, serverVersion: '1.12.0', awaitHostMs: 5000, log: quietLog, ...fakeDeps(),
  })

  assert.equal(reused.reused, true)
  assert.equal(reused.hostVersion, '1.12.1')
})
