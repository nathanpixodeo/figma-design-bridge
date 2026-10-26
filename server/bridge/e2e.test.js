// End-to-end exercise of the real bridge daemon over real HTTP sockets.
//
// The other test files mount the router on a bare http.Server and call it with
// hand-built request objects. This one starts the shipped daemon and talks to
// it the way the Figma plugin does: a real TCP connection, real headers, real
// long-polling. It therefore covers the ground unit tests cannot reach —
// daemon startup, the DNS-rebinding Host guard (which fetch() cannot exercise,
// because Host is a forbidden header), coalescing across concurrent sockets,
// and token persistence across a restart.
//
// Every test runs on an ephemeral port with a throwaway data directory, so the
// suite never touches a bridge already listening on 3456 or any real design
// data.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const http = require('http')

const { createDaemon } = require('./daemon.js')

const FILE_A = 'AAAAfileKeyAAAA'
const FILE_B = 'BBBBfileKeyBBBB'

const quietLog = () => {}

// ── Harness ───────────────────────────────────────────────

// Starts a daemon and tears it down with the test, returning the pieces every
// test needs: an authenticated JSON client, a raw http client, and a factory
// for plugin sessions.
async function startBridge(t, { dataDir } = {}) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-e2e-'))
  const daemon = await createDaemon({ port: 0, host: '127.0.0.1', dataDir: dir, log: quietLog })
  t.after(() => daemon.close())

  async function api(method, route, { body, token = daemon.token, headers = {} } = {}) {
    const res = await fetch(`${daemon.url}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = null }
    return { status: res.status, body: json, raw: text, headers: res.headers }
  }

  // fetch() refuses to send a caller-supplied Host header, so the rebinding
  // guard can only be exercised through the raw http client.
  function raw({ method, path: route, headers = {}, payload }) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: daemon.port, method, path: route, headers },
        res => {
          let body = ''
          res.on('data', chunk => { body += chunk })
          res.on('end', () => resolve({ status: res.statusCode, body }))
        },
      )
      req.on('error', reject)
      if (payload) req.write(payload)
      req.end()
    })
  }

  function plugin({ fileKey = FILE_A, fileName = 'Test File A', instanceId = 'plugin-1', capabilities } = {}) {
    return createFakePlugin({ t, url: daemon.url, token: daemon.token, fileKey, fileName, instanceId, capabilities })
  }

  return { daemon, dataDir: dir, url: daemon.url, token: daemon.token, api, raw, plugin }
}

// A plain HTTP client that registers a session, long-polls for work and
// replies — the smallest thing that behaves like the plugin.
function createFakePlugin({ t, url, token, fileKey, fileName, instanceId, capabilities = ['read-node'] }) {
  let sessionId = null
  let secret = null
  let stopped = false
  let polling = null
  const seen = []
  let handler = async () => ({ found: false })

  async function call(method, route, { body, headers = {} } = {}) {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(secret ? { 'X-Session-Secret': secret } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    let json = null
    try { json = text ? JSON.parse(text) : null } catch { json = null }
    return { status: res.status, body: json, raw: text }
  }

  async function start() {
    const res = await call('POST', '/bridge/session', {
      body: { fileKey, fileName, pluginInstanceId: instanceId, capabilities },
    })
    assert.equal(res.status, 201, `register failed: ${res.status} ${res.raw}`)
    sessionId = res.body.sessionId
    secret = res.body.sessionSecret
    if (t) t.after(() => stop())
    return res.body
  }

  async function pumpOnce(waitMs = 3000) {
    const res = await call('GET', `/bridge/session/${sessionId}/poll?waitMs=${waitMs}`)
    if (res.status !== 200) return res
    for (const request of res.body.requests || []) {
      seen.push(request)
      let result
      try { result = await handler(request) } catch (error) { result = { found: false, error: String(error) } }
      // A handler returning null models a plugin that receives the request and
      // never answers. It must not block this loop.
      if (result === null || result === undefined) continue
      const reply = result && typeof result === 'object' && typeof result.ok === 'boolean'
        ? { requestId: request.requestId, ok: result.ok, result: result.result, error: result.error }
        : { requestId: request.requestId, ok: true, result }
      await call('POST', `/bridge/session/${sessionId}/reply`, { body: reply })
    }
    return res
  }

  function run() {
    polling = (async () => {
      while (!stopped) {
        try { await pumpOnce(500) } catch { if (!stopped) await new Promise(r => setTimeout(r, 50)) }
      }
    })()
  }

  async function stop() {
    if (stopped) return
    stopped = true
    if (polling) await polling.catch(() => {})
    if (sessionId) await call('DELETE', `/bridge/session/${sessionId}?reason=test-stop`).catch(() => {})
  }

  return {
    start, run, stop, pumpOnce, call, seen,
    get sessionId() { return sessionId },
    get secret() { return secret },
    setHandler(fn) { handler = fn },
  }
}

// /bridge/read takes a single `source` — a Figma URL or a bare file key — and
// derives the file key and node id from it, exactly as a user pasting a link
// from Figma would supply them.
function sourceFor(fileKey, nodeId) {
  if (!nodeId) return fileKey
  return `https://www.figma.com/design/${fileKey}/Test-File?node-id=${nodeId}`
}

function nodeResult(fileKey, nodeId, extra = {}) {
  return {
    fileKey,
    fileName: 'Test File',
    nodeId,
    pageId: '0:1',
    pageName: 'Page 1',
    found: true,
    truncated: false,
    completeness: { nodeCount: 3, byteSize: 128, limitHit: false, truncatedNodeIds: [] },
    payload: { id: nodeId, name: 'Frame', type: 'FRAME', children: [] },
    ...extra,
  }
}

// ── Tests ─────────────────────────────────────────────────

test('the daemon answers health on a real socket without a token', async t => {
  const { api } = await startBridge(t)
  const res = await api('GET', '/bridge/health', { token: null })
  assert.equal(res.status, 200)
  assert.equal(res.body.service, 'figma-design-bridge')
  assert.ok(!JSON.stringify(res.body).includes('Bearer'))
})

test('an authenticated route rejects a missing or wrong token', async t => {
  const { api } = await startBridge(t)

  const missing = await api('POST', '/bridge/read', { token: null, body: { source: FILE_A } })
  assert.equal(missing.status, 401)
  assert.equal(missing.body.code, 'UNAUTHORIZED')

  const wrong = await api('POST', '/bridge/read', { token: 'deadbeef', body: { source: FILE_A } })
  assert.equal(wrong.status, 401)
  assert.equal(wrong.body.code, 'UNAUTHORIZED')
})

test('a non-loopback Host header is refused before anything else happens', async t => {
  const { raw, token } = await startBridge(t)
  const payload = JSON.stringify({ source: FILE_A })
  const res = await raw({
    method: 'POST',
    path: '/bridge/read',
    headers: {
      Host: 'evil.example.com',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Length': Buffer.byteLength(payload),
    },
    payload,
  })
  assert.equal(res.status, 403)
  assert.equal(JSON.parse(res.body).code, 'FORBIDDEN_HOST')
})

test('a live read with no plugin connected is 409, never a silent fallback', async t => {
  const { api } = await startBridge(t)
  const res = await api('POST', '/bridge/read', { body: { source: sourceFor(FILE_A, '1-2') } })
  assert.equal(res.status, 409)
  assert.equal(res.body.code, 'NO_SESSION_FOR_FILE')
  // The freshness envelope is present even on the error path, so a caller can
  // never mistake a failure for stale-but-usable data.
  assert.equal(res.body.verifiedFresh, false)
})

test('a real string plugin failure reaches HTTP as a diagnostic PLUGIN_ERROR without caching secrets', async t => {
  const { api, plugin, token } = await startBridge(t)
  const p = plugin()
  await p.start()
  p.setHandler(async () => ({
    ok: false,
    error: `Could not read node 26164:111624 (INSTANCE LIVE CONTROL SIDE NAV depth0); `
      + `{"authorization":"Bearer ${token}","sessionSecret":"${p.secret}"}`,
  }))
  p.run()

  const res = await api('POST', '/bridge/read', { body: { source: sourceFor(FILE_A, '26164:111624') } })
  assert.equal(res.status, 502)
  assert.equal(res.body.code, 'PLUGIN_ERROR')
  assert.match(res.body.error, /26164:111624/)
  assert.match(res.body.error, /INSTANCE LIVE CONTROL SIDE NAV depth0/)
  assert.equal(res.body.error.includes(token), false)
  assert.equal(res.body.error.includes(p.secret), false)
  assert.equal(res.raw.includes('Bearer '), false)

  const cached = await api('POST', '/bridge/read', {
    body: { source: sourceFor(FILE_A, '26164:111624'), mode: 'cached' },
  })
  assert.equal(cached.status, 404)
  assert.equal(cached.body.code, 'NO_CACHED_DATA')
})

test('a registered plugin serves a live read end to end', async t => {
  const { api, plugin } = await startBridge(t)
  const p = plugin()
  await p.start()
  p.setHandler(async request => nodeResult(FILE_A, request.params.nodeId))
  p.run()

  const res = await api('POST', '/bridge/read', { body: { source: sourceFor(FILE_A, '12-34') } })
  assert.equal(res.status, 200)
  assert.equal(res.body.verifiedFresh, true)
  assert.equal(res.body.stale, false)
  // A node id copied out of a Figma URL uses a hyphen; the bridge canonicalises
  // it before the plugin ever sees it.
  assert.equal(res.body.nodeId, '12:34')
  assert.equal(p.seen[0].params.nodeId, '12:34')
})

test('two concurrent identical reads cost one plugin round trip', async t => {
  const { api, plugin } = await startBridge(t)
  const p = plugin()
  await p.start()
  let served = 0
  p.setHandler(async request => {
    served++
    await new Promise(r => setTimeout(r, 60))
    return nodeResult(FILE_A, request.params.nodeId)
  })
  p.run()

  const [a, b] = await Promise.all([
    api('POST', '/bridge/read', { body: { source: sourceFor(FILE_A, '5-5') } }),
    api('POST', '/bridge/read', { body: { source: sourceFor(FILE_A, '5-5') } }),
  ])
  assert.equal(a.status, 200)
  assert.equal(b.status, 200)
  assert.equal(served, 1)
})

test('a cached read is served from cache and never claims to be verified', async t => {
  const { api, plugin } = await startBridge(t)
  const p = plugin()
  await p.start()
  p.setHandler(async request => nodeResult(FILE_A, request.params.nodeId))
  p.run()

  const live = await api('POST', '/bridge/read', { body: { source: sourceFor(FILE_A, '7-7') } })
  assert.equal(live.status, 200)
  assert.equal(live.body.mode, 'live')

  const cached = await api('POST', '/bridge/read', {
    body: { source: sourceFor(FILE_A, '7-7'), mode: 'cached' },
  })
  assert.equal(cached.status, 200)
  assert.equal(cached.body.mode, 'cached')
  // `source` records where the data came from originally and stays "plugin";
  // `verifiedFresh` is the only field that says whether this reply is live.
  assert.equal(cached.body.verifiedFresh, false)
  assert.equal(cached.body.freshness, 'unknown')
})

test('a plugin connected to one file cannot serve or invalidate another', async t => {
  const { api, plugin } = await startBridge(t)
  const p = plugin({ fileKey: FILE_A })
  await p.start()
  p.run()

  const other = await api('POST', '/bridge/read', { body: { source: sourceFor(FILE_B, '1-1') } })
  assert.equal(other.status, 409)
  assert.equal(other.body.code, 'NO_SESSION_FOR_FILE')

  const invalidate = await p.call('POST', `/bridge/session/${p.sessionId}/invalidate`, {
    body: { fileKey: FILE_B },
  })
  assert.equal(invalidate.status, 403)
  assert.equal(invalidate.body.code, 'FILE_MISMATCH')
})

test('a plugin that never answers produces a timeout, not a hang', async t => {
  const { api, plugin } = await startBridge(t)
  const p = plugin()
  await p.start()
  p.setHandler(() => null) // receives the request, never replies
  p.run()

  const res = await api('POST', '/bridge/read', {
    body: { source: sourceFor(FILE_A, '9-9'), timeoutMs: 600 },
  })
  assert.equal(res.status, 504)
  assert.equal(res.body.code, 'TIMEOUT')
  assert.equal(res.body.verifiedFresh, false)
})

test('malformed JSON and unknown fields are rejected with distinct codes', async t => {
  const { raw, api, token } = await startBridge(t)

  const payload = '{"source": "AAAA'
  const bad = await raw({
    method: 'POST',
    path: '/bridge/read',
    headers: {
      Host: '127.0.0.1',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Content-Length': Buffer.byteLength(payload),
    },
    payload,
  })
  assert.equal(bad.status, 400)
  assert.equal(JSON.parse(bad.body).code, 'INVALID_JSON')

  const unknown = await api('POST', '/bridge/read', {
    body: { source: sourceFor(FILE_A, '1-1'), notAField: true },
  })
  assert.equal(unknown.status, 400)
})

test('the token survives a restart and never lands in the cache directory', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-e2e-'))

  const first = await startBridge(t, { dataDir })
  const p = first.plugin()
  await p.start()
  p.setHandler(async request => nodeResult(FILE_A, request.params.nodeId))
  p.run()
  const read = await first.api('POST', '/bridge/read', { body: { source: sourceFor(FILE_A, '3-3') } })
  assert.equal(read.status, 200)
  await p.stop()
  await first.daemon.close()

  const second = await startBridge(t, { dataDir })
  assert.equal(second.token, first.token, 'a restart must reuse the stored token')

  // The cache is content-addressed and must never carry a credential.
  const entries = fs.readdirSync(dataDir).filter(f => /^[0-9a-f]{64}\.json$/.test(f))
  assert.ok(entries.length > 0, 'the live read should have populated the cache')
  for (const file of entries) {
    const body = fs.readFileSync(path.join(dataDir, file), 'utf8')
    assert.ok(!body.includes(first.token), `${file} must not contain the bridge token`)
  }
})

test('two plugins on two files are served independently', async t => {
  const { api, plugin } = await startBridge(t)

  const a = plugin({ fileKey: FILE_A, fileName: 'File A', instanceId: 'plugin-a' })
  const b = plugin({ fileKey: FILE_B, fileName: 'File B', instanceId: 'plugin-b' })
  await a.start()
  await b.start()
  a.setHandler(async request => nodeResult(FILE_A, request.params.nodeId, { pageName: 'From A' }))
  b.setHandler(async request => nodeResult(FILE_B, request.params.nodeId, { pageName: 'From B' }))
  a.run()
  b.run()

  const [ra, rb] = await Promise.all([
    api('POST', '/bridge/read', { body: { source: sourceFor(FILE_A, '1-1') } }),
    api('POST', '/bridge/read', { body: { source: sourceFor(FILE_B, '1-1') } }),
  ])
  assert.equal(ra.status, 200)
  assert.equal(rb.status, 200)
  assert.equal(ra.body.pageName, 'From A')
  assert.equal(rb.body.pageName, 'From B')
  assert.equal(a.seen.length, 1)
  assert.equal(b.seen.length, 1)
})

const CURRENT_PLUGIN = ['read-node', 'read-document-index', 'figma-rest', 'edit-seq']

test('a second read of an unchanged node is answered without the plugin reading it again', async t => {
  const { api, plugin } = await startBridge(t)
  const p = plugin({ capabilities: CURRENT_PLUGIN })
  await p.start()
  let editSeq = 2
  let reads = 0
  p.setHandler(async request => {
    if (request.op === 'edit-seq') return { fileKey: FILE_A, editSeq }
    reads++
    return nodeResult(FILE_A, request.params.nodeId, { format: 'figma-rest', editSeq })
  })
  p.run()

  const body = { source: sourceFor(FILE_A, '4-4'), options: { representation: 'figma-rest' } }
  const first = await api('POST', '/bridge/read', { body })
  assert.equal(first.status, 200)
  assert.equal(first.body.format, 'figma-rest')
  assert.equal(first.body.reused, undefined)

  const second = await api('POST', '/bridge/read', { body })
  assert.equal(second.status, 200)
  assert.equal(second.body.reused, true)
  assert.equal(second.body.verifiedFresh, true)
  assert.equal(second.body.fetchedAt, first.body.fetchedAt)
  assert.equal(reads, 1)

  // An edit in Figma moves the count on, and the next read reads again.
  editSeq = 3
  const third = await api('POST', '/bridge/read', { body })
  assert.equal(third.status, 200)
  assert.equal(third.body.reused, undefined)
  assert.equal(reads, 2)
})

test('a read that timed out is kept when the plugin finishes it, so the retry does not read again', async t => {
  const { api, plugin } = await startBridge(t)
  const p = plugin({ capabilities: CURRENT_PLUGIN })
  await p.start()
  let reads = 0
  p.setHandler(async request => {
    if (request.op === 'edit-seq') return { fileKey: FILE_A, editSeq: 7 }
    reads++
    await new Promise(r => setTimeout(r, 600))
    return nodeResult(FILE_A, request.params.nodeId, { format: 'figma-rest', editSeq: 7 })
  })
  p.run()

  const body = { source: sourceFor(FILE_A, '6-6'), options: { representation: 'figma-rest' } }
  const slow = await api('POST', '/bridge/read', { body: { ...body, timeoutMs: 300 } })
  assert.equal(slow.status, 504)
  assert.equal(slow.body.code, 'TIMEOUT')

  let kept = null
  for (let attempt = 0; attempt < 40 && !kept; attempt++) {
    const cached = await api('POST', '/bridge/read', { body: { ...body, mode: 'cached' } })
    if (cached.status === 200) kept = cached
    else await new Promise(r => setTimeout(r, 50))
  }
  assert.ok(kept, 'the late reply should have been kept')

  const retry = await api('POST', '/bridge/read', { body })
  assert.equal(retry.status, 200)
  assert.equal(retry.body.reused, true)
  assert.equal(reads, 1)
})

test('an asset or render read is refused by a plugin too old for it, and needs a node link', async t => {
  const { api, plugin } = await startBridge(t)
  const p = plugin({ capabilities: CURRENT_PLUGIN })
  await p.start()
  p.setHandler(async request => nodeResult(FILE_A, request.params.nodeId, { format: 'figma-rest' }))
  p.run()

  for (const representation of ['assets', 'render+s2']) {
    const res = await api('POST', '/bridge/read', { body: { source: sourceFor(FILE_A, '5-5'), options: { representation } } })
    assert.equal(res.status, 409)
    assert.equal(res.body.code, 'PLUGIN_OUTDATED')
    assert.match(res.body.error, /Close Design Bridge in Figma and open it again/)
    assert.equal(res.body.nodeId, '5:5')
  }
  const fileLink = await api('POST', '/bridge/read', { body: { source: sourceFor(FILE_A), options: { representation: 'assets' } } })
  assert.equal(fileLink.status, 400)
  assert.match(fileLink.body.error, /node-id/)
  assert.equal(p.seen.length, 0, 'the old plugin was never asked')
})

test('an asset read reaches a plugin that names it, and is cached under its own representation', async t => {
  const { api, plugin } = await startBridge(t)
  const p = plugin({ capabilities: [...CURRENT_PLUGIN, 'assets', 'render'] })
  await p.start()
  const payload = { type: 'ASSETS', icons: [{ id: '5:6', name: 'Icon', svg: '<svg/>', layers: [{ id: '5:6' }] }], images: [] }
  p.setHandler(async request => {
    if (request.op === 'edit-seq') return { fileKey: FILE_A, editSeq: 1 }
    return nodeResult(FILE_A, request.params.nodeId, { format: 'assets', payload, editSeq: 1 })
  })
  p.run()

  const body = { source: sourceFor(FILE_A, '5-5'), options: { representation: 'assets', maxBytes: 10000000 } }
  const live = await api('POST', '/bridge/read', { body })
  assert.equal(live.status, 200)
  assert.equal(live.body.format, 'assets')
  assert.equal(live.body.representation, 'assets+b10000000')
  assert.deepEqual(live.body.payload, payload)
  assert.equal(p.seen[0].params.representation, 'assets+b10000000')

  const cached = await api('POST', '/bridge/read', { body: { ...body, mode: 'cached' } })
  assert.equal(cached.status, 200)
  assert.deepEqual(cached.body.payload, payload)
})
