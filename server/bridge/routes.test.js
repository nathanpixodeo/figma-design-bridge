const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')

const createRoutes = require('./routes')

// Distinctive secrets so a leak is unambiguous when a response body is scanned.
const TOKEN = 'bridge-token-4d5e6f-DO-NOT-LEAK'
const PROTOCOL_VERSION = '1.0'
const FILE_URL = 'https://www.figma.com/design/FILE1/App?node-id=12-34'

// ── Fakes ─────────────────────────────────────────────────

function createFakeIdentity() {
  return {
    parseSource(source) {
      if (typeof source !== 'string' || !source.trim()) throw new Error('A Figma file URL or file key is required')
      const value = source.trim()
      if (!value.includes('://')) {
        if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid Figma file key')
        return { fileKey: value, nodeId: null, kind: 'file' }
      }
      const url = new URL(value)
      if (!url.hostname.endsWith('figma.com')) throw new Error('URL must point to figma.com')
      const match = url.pathname.match(/^\/(?:design|file)\/([^/]+)/)
      if (!match) throw new Error('Could not find a Figma file key in the URL')
      const nodeId = url.searchParams.get('node-id')
      return { fileKey: match[1], nodeId, kind: nodeId ? 'node' : 'file' }
    },
    canonicalNodeId(id) {
      if (typeof id !== 'string') return null
      const value = id.trim()
      return /^\d+[-:]\d+$/.test(value) ? value.replace('-', ':') : null
    },
    urlNodeId(id) { return String(id).replace(':', '-') },
    cacheKey({ fileKey, nodeId, representation }) { return `${fileKey}|${nodeId || 'ROOT'}|${representation}` },
    cacheFilename(key) { return `${key.replace(/[^\w.-]/g, '_')}.json` },
    sameFile(a, b) { return typeof a === 'string' && typeof b === 'string' && a === b },
  }
}

function brokerError(code, message) {
  const error = new Error(message || code)
  error.code = code
  return error
}

function defaultResult() {
  return {
    fileKey: 'FILE1',
    fileName: 'App',
    nodeId: '12:34',
    pageId: '0:1',
    pageName: 'Home',
    truncated: false,
    completeness: { nodeCount: 12, byteSize: 4096, limitHit: false, truncatedNodeIds: [] },
    payload: { id: '12:34', name: 'Hero', type: 'FRAME' },
  }
}

function createFakeBroker() {
  const sessions = new Map()
  const calls = { registered: [], requests: [], replies: [], heartbeats: [], closed: [], polls: [] }
  let counter = 0

  function authorize(sessionId, secret) {
    const session = sessions.get(sessionId)
    if (!session || session.sessionSecret !== secret) {
      throw brokerError('UNAUTHORIZED', 'Invalid session credentials')
    }
    return session
  }

  const broker = {
    calls,
    sessions,
    nextRequestError: null,
    nextResult: null,
    nextPollRequests: [],

    registerSession(input) {
      counter += 1
      const session = {
        sessionId: `sess-${counter}`,
        sessionSecret: `session-secret-${counter}-DO-NOT-LEAK`,
        fileKey: input.fileKey,
        fileName: input.fileName || null,
        pluginInstanceId: input.pluginInstanceId,
        capabilities: input.capabilities || [],
        registeredAt: '2026-09-17T10:00:00.000Z',
        lastSeenAt: '2026-09-17T10:00:00.000Z',
        pendingCount: 0,
        alive: true,
      }
      sessions.set(session.sessionId, session)
      calls.registered.push(input)
      return {
        sessionId: session.sessionId,
        sessionSecret: session.sessionSecret,
        registeredAt: session.registeredAt,
      }
    },
    heartbeat(sessionId, secret) {
      const session = authorize(sessionId, secret)
      calls.heartbeats.push(sessionId)
      return { ok: true, pendingCount: session.pendingCount }
    },
    closeSession(sessionId, secret, reason) {
      authorize(sessionId, secret)
      sessions.delete(sessionId)
      calls.closed.push({ sessionId, reason })
      return { closed: true, rejected: 0 }
    },
    listSessions() {
      // Deliberately includes the secret so the route layer has to strip it.
      return [...sessions.values()].map(session => ({ ...session }))
    },
    hasSessionForFile(fileKey) {
      return [...sessions.values()].some(session => session.fileKey === fileKey && session.alive)
    },
    async request(input) {
      calls.requests.push(input)
      if (broker.nextRequestError) throw broker.nextRequestError
      const session = [...sessions.values()].find(s => s.fileKey === input.fileKey)
      return {
        result: broker.nextResult || defaultResult(),
        sessionId: session ? session.sessionId : null,
        requestId: 'req-42',
        respondedAt: '2026-09-17T10:05:00.000Z',
      }
    },
    async poll(sessionId, secret, options) {
      authorize(sessionId, secret)
      calls.polls.push({ sessionId, options })
      return { requests: broker.nextPollRequests }
    },
    reply(sessionId, secret, payload) {
      authorize(sessionId, secret)
      calls.replies.push({ sessionId, payload })
      return { accepted: true, reason: null }
    },
    cancelAll() {},
    stats() { return { pending: 0 } },
  }
  return broker
}

function entryKey({ fileKey, nodeId, representation }) {
  return `${fileKey}|${nodeId || 'ROOT'}|${representation}`
}

function createFakeCache() {
  const entries = new Map()
  const calls = { gets: [], puts: [], invalidations: [] }
  return {
    entries,
    calls,
    seed(entry) { entries.set(entryKey(entry), entry) },
    get(query) { calls.gets.push(query); return entries.get(entryKey(query)) || null },
    put(entry) { calls.puts.push(entry); entries.set(entryKey(entry), entry); return entry },
    invalidateFile(fileKey, reason) {
      calls.invalidations.push({ fileKey, reason })
      let removed = 0
      for (const [key, value] of entries) {
        if (value.fileKey === fileKey) { entries.delete(key); removed += 1 }
      }
      return removed
    },
    invalidateNode() { return 0 },
    list() { return [] },
    stats() { return { entryCount: entries.size, byteSize: 0, files: [] } },
    clear() { entries.clear() },
  }
}

// ── Harness ───────────────────────────────────────────────

function request(port, options = {}) {
  const { method = 'GET', path = '/', headers = {}, body, host } = options
  return new Promise((resolve, reject) => {
    const requestHeaders = { ...headers }
    if (host) requestHeaders.Host = host
    const req = http.request({
      host: '127.0.0.1',
      port,
      method,
      path,
      headers: requestHeaders,
      setHost: !host,
    }, res => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        let parsed = null
        try { parsed = JSON.parse(raw) } catch {}
        resolve({ status: res.statusCode, headers: res.headers, raw, body: parsed })
      })
    })
    req.on('error', reject)
    if (body !== undefined) req.write(typeof body === 'string' ? body : JSON.stringify(body))
    req.end()
  })
}

async function withServer(t, options = {}) {
  const identity = options.identity || createFakeIdentity()
  const broker = options.broker || createFakeBroker()
  const cache = options.cache || createFakeCache()
  const handler = createRoutes({
    broker,
    cache,
    identity,
    token: TOKEN,
    protocolVersion: PROTOCOL_VERSION,
    ...(options.routeOptions || {}),
  })

  const fellThrough = []
  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).then(handled => {
      if (handled) return
      fellThrough.push(`${req.method} ${req.url}`)
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ legacy: true }) + '\n')
    })
  })

  // Port 0: an ephemeral port, never the running bridge on 3456.
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    server.close(() => resolve())
  }))

  const port = server.address().port
  const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

  return {
    port, broker, cache, identity, fellThrough, auth,
    call: options => request(port, options),
    authed: options => request(port, { ...options, headers: { ...auth, ...(options.headers || {}) } }),
    async register(fileKey = 'FILE1', pluginInstanceId = 'plugin-a') {
      const res = await request(port, {
        method: 'POST',
        path: '/bridge/session',
        headers: auth,
        body: { fileKey, fileName: 'App', pluginInstanceId },
      })
      assert.equal(res.status, 201)
      return res.body
    },
  }
}

function sideEffectCount(ctx) {
  const { calls } = ctx.broker
  return calls.registered.length + calls.requests.length + calls.replies.length
    + calls.heartbeats.length + calls.closed.length + calls.polls.length
    + ctx.cache.calls.puts.length + ctx.cache.calls.gets.length + ctx.cache.calls.invalidations.length
}

// ── Identity and fall-through ─────────────────────────────

test('GET /bridge/health is unauthenticated and discloses only the service identity', async t => {
  const ctx = await withServer(t)
  const res = await ctx.call({ path: '/bridge/health' })

  assert.equal(res.status, 200)
  assert.deepEqual(Object.keys(res.body).sort(), ['protocolVersion', 'service', 'status'])
  assert.equal(res.body.service, 'figma-design-bridge')
  assert.equal(res.body.protocolVersion, PROTOCOL_VERSION)
  assert.equal(res.raw.includes(TOKEN), false)
})

test('the handler declines non-bridge paths so a host server can fall through', async t => {
  const ctx = await withServer(t)
  const res = await ctx.call({ path: '/design/summary' })

  assert.equal(res.status, 404)
  assert.deepEqual(res.body, { legacy: true })
  assert.deepEqual(ctx.fellThrough, ['GET /design/summary'])
})

// ── Authentication ────────────────────────────────────────

const AUTHENTICATED_ROUTES = [
  { method: 'POST', path: '/bridge/session', body: { fileKey: 'FILE1', pluginInstanceId: 'plugin-a' } },
  { method: 'POST', path: '/bridge/session/sess-1/heartbeat' },
  { method: 'DELETE', path: '/bridge/session/sess-1' },
  { method: 'GET', path: '/bridge/session/sess-1/poll' },
  { method: 'POST', path: '/bridge/session/sess-1/reply', body: { requestId: 'req-1', ok: true, result: {} } },
  { method: 'POST', path: '/bridge/session/sess-1/invalidate', body: { reason: 'edited' } },
  { method: 'POST', path: '/bridge/read', body: { source: FILE_URL } },
  { method: 'GET', path: '/bridge/status' },
]

test('every route except health rejects a missing token with 401 and has no side effect', async t => {
  const ctx = await withServer(t)

  for (const route of AUTHENTICATED_ROUTES) {
    const res = await ctx.call({ ...route, headers: { 'content-type': 'application/json' } })
    assert.equal(res.status, 401, `${route.method} ${route.path}`)
    assert.equal(res.body.code, 'UNAUTHORIZED')
    assert.equal(res.raw.includes(TOKEN), false)
  }

  assert.equal(sideEffectCount(ctx), 0)
  assert.equal(ctx.broker.sessions.size, 0)
})

test('a wrong token and a token in the query string are both rejected', async t => {
  const ctx = await withServer(t)
  const wrongToken = `x${TOKEN.slice(1)}`

  const bearer = await ctx.call({
    method: 'POST', path: '/bridge/read',
    headers: { authorization: `Bearer ${wrongToken}`, 'content-type': 'application/json' },
    body: { source: FILE_URL },
  })
  assert.equal(bearer.status, 401)

  // A token in a URL leaks through logs and Referer headers, so it is never read.
  const query = await ctx.call({
    method: 'POST', path: `/bridge/read?token=${encodeURIComponent(TOKEN)}`,
    headers: { 'content-type': 'application/json' },
    body: { source: FILE_URL, token: TOKEN },
  })
  assert.equal(query.status, 401)

  // A short token must not throw inside the constant-time compare.
  const short = await ctx.call({
    method: 'GET', path: '/bridge/status',
    headers: { 'x-bridge-token': 'short' },
  })
  assert.equal(short.status, 401)

  assert.equal(sideEffectCount(ctx), 0)
})

test('the x-bridge-token header is accepted as an alternative to Bearer', async t => {
  const ctx = await withServer(t)
  const res = await ctx.call({ method: 'GET', path: '/bridge/status', headers: { 'x-bridge-token': TOKEN } })
  assert.equal(res.status, 200)
})

test('a session secret does not authorize another session', async t => {
  const ctx = await withServer(t)
  const first = await ctx.register('FILE1', 'plugin-a')
  const second = await ctx.register('FILE2', 'plugin-b')

  const crossed = [
    { method: 'POST', path: `/bridge/session/${second.sessionId}/heartbeat` },
    { method: 'GET', path: `/bridge/session/${second.sessionId}/poll` },
    { method: 'DELETE', path: `/bridge/session/${second.sessionId}` },
    { method: 'POST', path: `/bridge/session/${second.sessionId}/reply`, body: { requestId: 'req-1', ok: true, result: {} } },
    { method: 'POST', path: `/bridge/session/${second.sessionId}/invalidate`, body: { reason: 'edited' } },
  ]

  for (const route of crossed) {
    const res = await ctx.authed({ ...route, headers: { 'x-session-secret': first.sessionSecret } })
    assert.equal(res.status, 401, `${route.method} ${route.path}`)
    assert.equal(res.body.code, 'UNAUTHORIZED')
  }

  assert.equal(ctx.broker.sessions.size, 2)
  assert.equal(ctx.cache.calls.invalidations.length, 0)

  // The owning secret still works.
  const ok = await ctx.authed({
    method: 'POST', path: `/bridge/session/${second.sessionId}/heartbeat`,
    headers: { 'x-session-secret': second.sessionSecret },
  })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.ok, true)
})

test('a session route without the session secret is rejected before the broker is touched', async t => {
  const ctx = await withServer(t)
  const session = await ctx.register()

  const res = await ctx.authed({ method: 'POST', path: `/bridge/session/${session.sessionId}/heartbeat` })
  assert.equal(res.status, 401)
  assert.equal(ctx.broker.calls.heartbeats.length, 0)
})

// ── Transport hardening ───────────────────────────────────

test('a non-loopback Host header is refused (DNS rebinding guard)', async t => {
  const ctx = await withServer(t)

  for (const host of ['evil.example.com', 'evil.example.com:80', '10.0.0.5:3456', 'localhost.evil.example']) {
    const res = await ctx.authed({
      method: 'POST', path: '/bridge/read', host, body: { source: FILE_URL },
    })
    assert.equal(res.status, 403, host)
    assert.equal(res.body.code, 'FORBIDDEN_HOST')
  }

  // Even the unauthenticated identity probe is covered.
  const health = await ctx.call({ path: '/bridge/health', host: 'evil.example.com' })
  assert.equal(health.status, 403)

  for (const host of ['localhost:1234', '127.0.0.1:1234', '[::1]:1234', 'localhost']) {
    const res = await ctx.call({ path: '/bridge/health', host })
    assert.equal(res.status, 200, host)
  }

  assert.equal(sideEffectCount(ctx), 0)
})

test('a body over the limit is refused with 413 and never reaches the broker', async t => {
  const ctx = await withServer(t, { routeOptions: { maxBodyBytes: 256 } })
  const oversized = JSON.stringify({ source: FILE_URL, options: { representation: 'x'.repeat(800) } })

  const res = await ctx.authed({ method: 'POST', path: '/bridge/read', body: oversized })
  assert.equal(res.status, 413)
  assert.equal(res.body.code, 'PAYLOAD_TOO_LARGE')
  assert.equal(ctx.broker.calls.requests.length, 0)
  assert.equal(ctx.cache.calls.puts.length, 0)
})

test('malformed JSON is refused with 400 rather than a 500', async t => {
  const ctx = await withServer(t)
  const res = await ctx.authed({ method: 'POST', path: '/bridge/read', body: '{"source": ' })

  assert.equal(res.status, 400)
  assert.equal(res.body.code, 'INVALID_JSON')
  assert.equal(ctx.broker.calls.requests.length, 0)
})

test('unknown, missing and wrong-typed read fields are refused with 400', async t => {
  const ctx = await withServer(t)
  const bad = [
    {},
    { source: '' },
    { source: FILE_URL, surprise: true },
    { source: FILE_URL, mode: 'whatever' },
    { source: FILE_URL, mode: 7 },
    { source: FILE_URL, options: [] },
    { source: FILE_URL, options: { unknownOption: 1 } },
    { source: FILE_URL, options: { depth: 'deep' } },
    { source: FILE_URL, options: { depth: 999 } },
    { source: FILE_URL, options: { includeHidden: 'yes' } },
    { source: FILE_URL, timeoutMs: -1 },
    { source: 'x'.repeat(2400) },
    { source: 'https://example.com/design/FILE1/App' },
    { source: 'https://www.figma.com/design/FILE1/App?node-id=not-a-node' },
  ]

  for (const body of bad) {
    const res = await ctx.authed({ method: 'POST', path: '/bridge/read', body })
    assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80))
    assert.ok(['BAD_REQUEST', 'INVALID_SOURCE'].includes(res.body.code), res.body.code)
    // Even a rejected read carries the freshness envelope.
    assert.equal(res.body.verifiedFresh, false)
    assert.equal(res.body.freshness, 'unknown')
  }

  assert.equal(ctx.broker.calls.requests.length, 0)
})

test('an unknown bridge route is a 404 and a wrong method on a session route is a 405', async t => {
  const ctx = await withServer(t)
  const session = await ctx.register()

  const unknown = await ctx.authed({ method: 'GET', path: '/bridge/nope' })
  assert.equal(unknown.status, 404)
  assert.equal(unknown.body.code, 'NOT_FOUND')

  const wrongMethod = await ctx.authed({
    method: 'GET', path: `/bridge/session/${session.sessionId}/reply`,
    headers: { 'x-session-secret': session.sessionSecret },
  })
  assert.equal(wrongMethod.status, 405)
})

// ── CORS ──────────────────────────────────────────────────

test('preflight is answered without authentication and without touching state', async t => {
  const ctx = await withServer(t)

  const allowed = await ctx.call({
    method: 'OPTIONS', path: '/bridge/read',
    headers: { origin: 'null', 'access-control-request-method': 'POST' },
  })
  assert.equal(allowed.status, 204)
  assert.equal(allowed.headers['access-control-allow-origin'], 'null')
  assert.match(allowed.headers['access-control-allow-headers'], /Authorization/)
  assert.match(allowed.headers['access-control-allow-headers'], /X-Session-Secret/)
  assert.equal(allowed.headers.vary, 'Origin')

  const foreign = await ctx.call({
    method: 'OPTIONS', path: '/bridge/read',
    headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
  })
  assert.equal(foreign.status, 204)
  assert.equal(foreign.headers['access-control-allow-origin'], undefined)

  assert.equal(sideEffectCount(ctx), 0)
})

test('no authenticated response carries a wildcard Access-Control-Allow-Origin', async t => {
  const ctx = await withServer(t)
  const res = await ctx.authed({ method: 'GET', path: '/bridge/status', headers: { origin: 'https://evil.example' } })

  assert.equal(res.status, 200)
  assert.equal(res.headers['access-control-allow-origin'], undefined)
})

// ── Live reads ────────────────────────────────────────────

test('a live read returns the plugin payload and caches it as verified fresh', async t => {
  const ctx = await withServer(t)
  const session = await ctx.register('FILE1', 'plugin-a')

  const res = await ctx.authed({ method: 'POST', path: '/bridge/read', body: { source: FILE_URL } })

  assert.equal(res.status, 200)
  assert.equal(res.body.fileKey, 'FILE1')
  assert.equal(res.body.fileName, 'App')
  assert.equal(res.body.nodeId, '12:34')
  assert.equal(res.body.pageId, '0:1')
  assert.equal(res.body.source, 'plugin')
  assert.equal(res.body.freshness, 'live')
  assert.equal(res.body.verifiedFresh, true)
  assert.equal(res.body.stale, false)
  assert.equal(res.body.ageMs, 0)
  assert.equal(res.body.truncated, false)
  assert.equal(res.body.fetchedAt, '2026-09-17T10:05:00.000Z')
  assert.deepEqual(res.body.completeness, {
    nodeCount: 12, byteSize: 4096, limitHit: false, truncatedNodeIds: [],
  })
  assert.deepEqual(res.body.payload, { id: '12:34', name: 'Hero', type: 'FRAME' })

  const brokerRequest = ctx.broker.calls.requests[0]
  assert.equal(brokerRequest.op, 'read-node')
  assert.equal(brokerRequest.fileKey, 'FILE1')
  assert.equal(brokerRequest.params.nodeId, '12:34')
  assert.equal(brokerRequest.dedupeKey, 'FILE1|12:34|node-subtree')

  const stored = ctx.cache.calls.puts[0]
  assert.equal(stored.source, 'plugin')
  assert.equal(stored.verifiedFresh, true)
  assert.equal(stored.sessionId, session.sessionId)
  assert.equal(stored.representation, 'node-subtree')
  assert.deepEqual(stored.completeness.truncatedNodeIds, [])
})

test('a file URL without node-id asks for a document index, not a full dump', async t => {
  const ctx = await withServer(t)
  await ctx.register('FILE1', 'plugin-a')
  ctx.broker.nextResult = { ...defaultResult(), nodeId: null, payload: { pages: [] } }

  const res = await ctx.authed({
    method: 'POST', path: '/bridge/read',
    body: { source: 'https://www.figma.com/design/FILE1/App' },
  })

  assert.equal(res.status, 200)
  assert.equal(ctx.broker.calls.requests[0].op, 'read-document-index')
  assert.equal(ctx.broker.calls.requests[0].params.nodeId, null)
  assert.equal(res.body.representation, 'document-index')
})

test('read options change the representation so cache entries cannot collide', async t => {
  const ctx = await withServer(t)
  await ctx.register('FILE1', 'plugin-a')

  await ctx.authed({ method: 'POST', path: '/bridge/read', body: { source: FILE_URL, options: { depth: 2 } } })
  await ctx.authed({ method: 'POST', path: '/bridge/read', body: { source: FILE_URL, options: { depth: 3 } } })

  const representations = ctx.cache.calls.puts.map(entry => entry.representation)
  assert.deepEqual(representations, ['node-subtree+d2', 'node-subtree+d3'])
})

test('a truncated plugin result is reported as truncated', async t => {
  const ctx = await withServer(t)
  await ctx.register('FILE1', 'plugin-a')
  ctx.broker.nextResult = {
    ...defaultResult(),
    completeness: { nodeCount: 5000, byteSize: 900000, limitHit: true, truncatedNodeIds: ['9:9'] },
  }

  const res = await ctx.authed({ method: 'POST', path: '/bridge/read', body: { source: FILE_URL } })

  assert.equal(res.status, 200)
  assert.equal(res.body.truncated, true)
  assert.equal(res.body.completeness.limitHit, true)
  assert.deepEqual(res.body.completeness.truncatedNodeIds, ['9:9'])
})

test('a live read without a session is 409 and never falls back to cache', async t => {
  const ctx = await withServer(t)
  ctx.cache.seed({
    fileKey: 'FILE1', nodeId: '12:34', representation: 'node-subtree',
    source: 'plugin', verifiedFresh: true, payload: { stale: 'data' },
  })

  const res = await ctx.authed({ method: 'POST', path: '/bridge/read', body: { source: FILE_URL } })

  assert.equal(res.status, 409)
  assert.equal(res.body.code, 'NO_SESSION_FOR_FILE')
  assert.match(res.body.error, /FILE1/)
  assert.match(res.body.error, /Design Bridge/)
  assert.equal(res.body.payload, undefined)
  assert.equal(res.body.verifiedFresh, false)
  assert.equal(res.body.freshness, 'unknown')
  // Neither the cache nor the broker was consulted as a fallback.
  assert.equal(ctx.cache.calls.gets.length, 0)
  assert.equal(ctx.broker.calls.requests.length, 0)
})

test('broker failures map to distinct HTTP statuses', async t => {
  const ctx = await withServer(t)
  await ctx.register('FILE1', 'plugin-a')

  const expected = {
    NO_SESSION_FOR_FILE: 409,
    TIMEOUT: 504,
    SESSION_LOST: 503,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    QUEUE_FULL: 429,
    TOO_MANY_PENDING: 429,
  }

  for (const [code, status] of Object.entries(expected)) {
    ctx.broker.nextRequestError = brokerError(code, `broker says ${code}`)
    const res = await ctx.authed({ method: 'POST', path: '/bridge/read', body: { source: FILE_URL } })
    assert.equal(res.status, status, code)
    assert.equal(res.body.code, code)
    assert.equal(res.body.verifiedFresh, false)
  }

  // An unexpected failure is a 500 that does not leak internals.
  ctx.broker.nextRequestError = new Error('boom: /home/user/secret/path')
  const unexpected = await ctx.authed({ method: 'POST', path: '/bridge/read', body: { source: FILE_URL } })
  assert.equal(unexpected.status, 500)
  assert.equal(unexpected.body.code, 'INTERNAL_ERROR')
  assert.equal(unexpected.raw.includes('secret/path'), false)

  assert.equal(ctx.cache.calls.puts.length, 0)
})

test('a node the plugin cannot find is a 404 and is not cached', async t => {
  const ctx = await withServer(t)
  await ctx.register('FILE1', 'plugin-a')
  ctx.broker.nextResult = { found: false }

  const res = await ctx.authed({ method: 'POST', path: '/bridge/read', body: { source: FILE_URL } })

  assert.equal(res.status, 404)
  assert.equal(res.body.code, 'NODE_NOT_FOUND')
  assert.match(res.body.error, /12:34/)
  assert.equal(ctx.cache.calls.puts.length, 0)
})

test('a result claiming another file is discarded instead of cached', async t => {
  const ctx = await withServer(t)
  await ctx.register('FILE1', 'plugin-a')
  ctx.broker.nextResult = { ...defaultResult(), fileKey: 'OTHERFILE' }

  const res = await ctx.authed({ method: 'POST', path: '/bridge/read', body: { source: FILE_URL } })

  assert.equal(res.status, 502)
  assert.equal(res.body.code, 'FILE_MISMATCH')
  assert.equal(ctx.cache.calls.puts.length, 0)
})

test('an unusable plugin result is a 502 rather than an unhandled crash', async t => {
  const ctx = await withServer(t)
  await ctx.register('FILE1', 'plugin-a')
  ctx.broker.nextResult = 'not an object'

  const res = await ctx.authed({ method: 'POST', path: '/bridge/read', body: { source: FILE_URL } })
  assert.equal(res.status, 502)
  assert.equal(res.body.code, 'UPSTREAM_INVALID')
})

test('a cache write failure does not fail a read that already succeeded', async t => {
  const cache = createFakeCache()
  cache.put = () => { throw new Error('disk full') }
  const ctx = await withServer(t, { cache })
  await ctx.register('FILE1', 'plugin-a')

  const res = await ctx.authed({ method: 'POST', path: '/bridge/read', body: { source: FILE_URL } })
  assert.equal(res.status, 200)
  assert.equal(res.body.cached, false)
  assert.equal(res.body.verifiedFresh, true)
})

// ── Cached reads ──────────────────────────────────────────

test('an explicit cached read discloses unknown freshness and never claims to be live', async t => {
  const ctx = await withServer(t)
  ctx.cache.seed({
    fileKey: 'FILE1',
    fileName: 'App',
    nodeId: '12:34',
    pageId: '0:1',
    pageName: 'Home',
    representation: 'node-subtree',
    // The stored entry claims to be verified; the cached read must not repeat it.
    source: 'plugin',
    verifiedFresh: true,
    fetchedAt: '2026-09-17T09:00:00.000Z',
    ageMs: 900000,
    truncated: false,
    completeness: { nodeCount: 12, byteSize: 4096, limitHit: false, truncatedNodeIds: [] },
    payload: { id: '12:34', name: 'Hero' },
  })

  const res = await ctx.authed({ method: 'POST', path: '/bridge/read', body: { source: FILE_URL, mode: 'cached' } })

  assert.equal(res.status, 200)
  assert.equal(res.body.freshness, 'unknown')
  assert.equal(res.body.verifiedFresh, false)
  assert.equal(res.body.stale, true)
  assert.equal(res.body.ageMs, 900000)
  assert.equal(res.body.fetchedAt, '2026-09-17T09:00:00.000Z')
  assert.deepEqual(res.body.payload, { id: '12:34', name: 'Hero' })
  // No live request was made.
  assert.equal(ctx.broker.calls.requests.length, 0)
})

test('a cached read with nothing stored is a 404 carrying the freshness envelope', async t => {
  const ctx = await withServer(t)
  const res = await ctx.authed({ method: 'POST', path: '/bridge/read', body: { source: FILE_URL, mode: 'cached' } })

  assert.equal(res.status, 404)
  assert.equal(res.body.code, 'NO_CACHED_DATA')
  assert.equal(res.body.fileKey, 'FILE1')
  assert.equal(res.body.nodeId, '12:34')
  assert.equal(res.body.freshness, 'unknown')
  assert.equal(res.body.verifiedFresh, false)
  assert.equal(res.body.stale, true)
})

// ── Session lifecycle ─────────────────────────────────────

test('a plugin session can register, heartbeat, poll, reply and close', async t => {
  const ctx = await withServer(t)
  const session = await ctx.register('FILE1', 'plugin-a')
  const secret = { 'x-session-secret': session.sessionSecret }

  assert.equal(typeof session.sessionId, 'string')
  assert.equal(session.protocolVersion, PROTOCOL_VERSION)

  const heartbeat = await ctx.authed({
    method: 'POST', path: `/bridge/session/${session.sessionId}/heartbeat`, headers: secret,
  })
  assert.equal(heartbeat.status, 200)
  assert.equal(heartbeat.body.ok, true)

  ctx.broker.nextPollRequests = [{
    requestId: 'req-42', op: 'read-node', params: { nodeId: '12:34' },
    enqueuedAt: 1, expiresAt: 2,
  }]
  const poll = await ctx.authed({
    method: 'GET', path: `/bridge/session/${session.sessionId}/poll?waitMs=999999`, headers: secret,
  })
  assert.equal(poll.status, 200)
  assert.equal(poll.body.requests[0].requestId, 'req-42')
  // waitMs is clamped to the documented ceiling.
  assert.equal(poll.body.waitMs, 30000)
  assert.equal(ctx.broker.calls.polls[0].options.waitMs, 30000)

  const reply = await ctx.authed({
    method: 'POST', path: `/bridge/session/${session.sessionId}/reply`, headers: secret,
    body: { requestId: 'req-42', ok: true, result: defaultResult() },
  })
  assert.equal(reply.status, 200)
  assert.equal(reply.body.accepted, true)

  const closed = await ctx.authed({
    method: 'DELETE', path: `/bridge/session/${session.sessionId}?reason=user-stop`, headers: secret,
  })
  assert.equal(closed.status, 200)
  assert.equal(closed.body.closed, true)
  assert.equal(ctx.broker.calls.closed[0].reason, 'user-stop')
})

test('session registration validates its own schema', async t => {
  const ctx = await withServer(t)
  const bad = [
    {},
    { fileKey: 'FILE1' },
    { fileKey: 'not a key!', pluginInstanceId: 'plugin-a' },
    { fileKey: 'FILE1', pluginInstanceId: 'plugin-a', extra: 1 },
    { fileKey: 'FILE1', pluginInstanceId: 'plugin-a', capabilities: 'read' },
    { fileKey: 'FILE1', pluginInstanceId: 'plugin-a', fileName: 'x'.repeat(400) },
  ]
  for (const body of bad) {
    const res = await ctx.authed({ method: 'POST', path: '/bridge/session', body })
    assert.equal(res.status, 400, JSON.stringify(body))
    assert.equal(res.body.code, 'BAD_REQUEST')
  }
  assert.equal(ctx.broker.calls.registered.length, 0)
})

test('a reply the broker no longer wants is reported, not treated as an error', async t => {
  const ctx = await withServer(t)
  const session = await ctx.register()
  ctx.broker.reply = () => ({ accepted: false, reason: 'unknown-request' })

  const res = await ctx.authed({
    method: 'POST', path: `/bridge/session/${session.sessionId}/reply`,
    headers: { 'x-session-secret': session.sessionSecret },
    body: { requestId: 'req-999', ok: true, result: {} },
  })

  assert.equal(res.status, 200)
  assert.equal(res.body.accepted, false)
  assert.equal(res.body.reason, 'unknown-request')
})

test('invalidation applies to the session own file and refuses another one', async t => {
  const ctx = await withServer(t)
  const session = await ctx.register('FILE1', 'plugin-a')
  ctx.cache.seed({ fileKey: 'FILE1', nodeId: '12:34', representation: 'node-subtree', payload: {} })
  ctx.cache.seed({ fileKey: 'FILE2', nodeId: '1:1', representation: 'node-subtree', payload: {} })

  const res = await ctx.authed({
    method: 'POST', path: `/bridge/session/${session.sessionId}/invalidate`,
    headers: { 'x-session-secret': session.sessionSecret },
    body: { reason: 'documentchange' },
  })
  assert.equal(res.status, 200)
  assert.equal(res.body.fileKey, 'FILE1')
  assert.equal(res.body.invalidated, 1)
  assert.deepEqual(ctx.cache.calls.invalidations, [{ fileKey: 'FILE1', reason: 'documentchange' }])

  // Reading node B must not have erased file FILE2.
  assert.equal(ctx.cache.entries.size, 1)

  const foreign = await ctx.authed({
    method: 'POST', path: `/bridge/session/${session.sessionId}/invalidate`,
    headers: { 'x-session-secret': session.sessionSecret },
    body: { fileKey: 'FILE2' },
  })
  assert.equal(foreign.status, 403)
  assert.equal(foreign.body.code, 'FILE_MISMATCH')
  assert.equal(ctx.cache.calls.invalidations.length, 1)
})

// ── Status ────────────────────────────────────────────────

test('GET /bridge/status reports readiness without revealing any secret', async t => {
  const ctx = await withServer(t)
  await ctx.register('FILE1', 'plugin-a')

  const res = await ctx.authed({ method: 'GET', path: '/bridge/status' })

  assert.equal(res.status, 200)
  assert.equal(res.body.readiness.ready, true)
  assert.deepEqual(res.body.readiness.liveFileKeys, ['FILE1'])
  assert.deepEqual(res.body.setupHints, [])
  assert.deepEqual(Object.keys(res.body.sessions[0]).sort(), [
    'alive', 'fileKey', 'fileName', 'lastSeenAt', 'pendingCount',
    'pluginInstanceId', 'registeredAt', 'sessionId',
  ])
  assert.equal(res.raw.includes('DO-NOT-LEAK'), false)
  assert.equal(res.body.cache.entryCount, 0)
})

test('GET /bridge/status offers setup hints when no plugin is connected', async t => {
  const ctx = await withServer(t)
  const res = await ctx.authed({ method: 'GET', path: '/bridge/status' })

  assert.equal(res.body.readiness.ready, false)
  assert.ok(res.body.setupHints.length > 0)
  assert.equal(res.raw.includes(TOKEN), false)
})

// ── Secret sweep ──────────────────────────────────────────

test('no response body on any route contains the bridge token or a session secret', async t => {
  const ctx = await withServer(t, { routeOptions: { maxBodyBytes: 4096 } })
  const session = await ctx.register('FILE1', 'plugin-a')
  const secret = { 'x-session-secret': session.sessionSecret }
  const bodies = []

  const collect = res => { bodies.push(res.raw); return res }

  collect(await ctx.call({ path: '/bridge/health' }))
  collect(await ctx.call({ method: 'POST', path: '/bridge/read', body: { source: FILE_URL } }))
  collect(await ctx.call({ path: '/bridge/health', host: 'evil.example.com' }))
  collect(await ctx.authed({ method: 'GET', path: '/bridge/status' }))
  collect(await ctx.authed({ method: 'POST', path: '/bridge/read', body: { source: FILE_URL } }))
  collect(await ctx.authed({ method: 'POST', path: '/bridge/read', body: { source: FILE_URL, mode: 'cached' } }))
  collect(await ctx.authed({ method: 'POST', path: '/bridge/read', body: { source: 'nope!' } }))
  collect(await ctx.authed({ method: 'POST', path: '/bridge/read', body: 'not json' }))
  collect(await ctx.authed({
    method: 'POST', path: '/bridge/session/unknown-session/heartbeat',
    headers: { 'x-session-secret': 'guessed-secret' },
  }))
  collect(await ctx.authed({ method: 'POST', path: `/bridge/session/${session.sessionId}/heartbeat`, headers: secret }))
  collect(await ctx.authed({ method: 'GET', path: `/bridge/session/${session.sessionId}/poll?waitMs=0`, headers: secret }))
  collect(await ctx.authed({
    method: 'POST', path: `/bridge/session/${session.sessionId}/reply`, headers: secret,
    body: { requestId: 'req-42', ok: true, result: defaultResult() },
  }))
  collect(await ctx.authed({
    method: 'POST', path: `/bridge/session/${session.sessionId}/invalidate`, headers: secret, body: {},
  }))
  collect(await ctx.authed({ method: 'GET', path: '/bridge/nope' }))
  collect(await ctx.authed({ method: 'DELETE', path: `/bridge/session/${session.sessionId}`, headers: secret }))

  assert.ok(bodies.length >= 15)
  for (const raw of bodies) {
    assert.equal(raw.includes(TOKEN), false, raw.slice(0, 160))
    assert.equal(raw.includes(session.sessionSecret), false, raw.slice(0, 160))
    assert.equal(raw.includes('DO-NOT-LEAK'), false, raw.slice(0, 160))
  }
})
