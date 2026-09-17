const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const http = require('node:http')
const net = require('node:net')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

// A loopback port is not a private port: a browser runs on the same machine, so
// any page the user has open can reach 127.0.0.1. These tests pin the three
// controls that stand in for the authentication the legacy /design routes never
// had — loopback Host, no foreign origin, and a token on anything that touches
// design data — and they pin the escape hatch that turns the last one off.

const serverDir = __dirname
const repoRoot = path.join(__dirname, '..')

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

function request(port, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: options.method || 'GET',
      path: options.path || '/',
      headers: options.headers || {},
      // setHost:false keeps Node from appending its own Host header next to a
      // spoofed one, which is the whole point of the rebinding test.
      setHost: !options.headers || options.headers.Host === undefined,
    }, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
    })
    req.on('error', reject)
    if (options.body !== undefined) req.write(options.body)
    req.end()
  })
}

async function waitForHealth(port, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await request(port, { path: '/health' })
      if (res.status === 200) return true
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100))
  }
  return false
}

function startServer(extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-auth-'))
  const child = spawn(process.execPath, [path.join(serverDir, 'index.js')], {
    cwd: repoRoot,
    env: { ...process.env, FIGMA_BRIDGE_DATA_DIR: dataDir, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const output = []
  child.stdout.on('data', d => output.push(d.toString()))
  child.stderr.on('data', d => output.push(d.toString()))
  return {
    child,
    dataDir,
    logs: () => output.join(''),
    token: () => JSON.parse(fs.readFileSync(path.join(dataDir, 'bridge-token.json'), 'utf8')).token,
    stop: () => {
      child.kill()
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  }
}

async function withServer(t, extraEnv = {}) {
  const port = await freePort()
  const server = startServer({ FIGMA_BRIDGE_PORT: String(port), ...extraEnv })
  t.after(() => server.stop())
  assert.ok(await waitForHealth(port), `server never became healthy on ${port}`)
  return { port, server }
}

test('a design read without the bridge token is refused', async t => {
  const { port } = await withServer(t)

  const anonymous = await request(port, { path: '/design' })
  assert.equal(anonymous.status, 401)
  assert.match(anonymous.body, /bridge token is required/i)

  for (const route of ['/design/summary', '/design/texts', '/design/colors', '/snapshots']) {
    const res = await request(port, { path: route })
    assert.equal(res.status, 401, `${route} answered an unauthenticated caller`)
  }
})

test('the bridge token unlocks the design routes', async t => {
  const { port, server } = await withServer(t)
  const headers = { Authorization: `Bearer ${server.token()}` }

  const authorized = await request(port, { path: '/design', headers })
  assert.equal(authorized.status, 200)

  const viaHeader = await request(port, { path: '/design', headers: { 'X-Bridge-Token': server.token() } })
  assert.equal(viaHeader.status, 200)

  const wrong = await request(port, { path: '/design', headers: { Authorization: 'Bearer ' + 'f'.repeat(64) } })
  assert.equal(wrong.status, 401)
})

test('health stays open but never carries a wildcard origin or the token', async t => {
  const { port, server } = await withServer(t)

  const res = await request(port, { path: '/health' })
  assert.equal(res.status, 200)
  assert.notEqual(res.headers['access-control-allow-origin'], '*')
  assert.ok(!res.body.includes(server.token()), 'the health response leaked the bridge token')
})

test('a request addressed to a name other than loopback is refused', async t => {
  const { port } = await withServer(t)

  // DNS rebinding: attacker.example resolves to 127.0.0.1, the connection is
  // genuinely local, and the browser still sends the attacker's Host header.
  const rebound = await request(port, {
    path: '/health',
    headers: { Host: 'attacker.example' }
  })
  assert.equal(rebound.status, 403)
  assert.match(rebound.body, /loopback/i)
})

test('a foreign origin is refused and never granted a CORS header', async t => {
  const { port, server } = await withServer(t)
  const token = server.token()

  for (const origin of ['https://evil.example', 'http://evil.example:3456', 'http://127.0.0.1.evil.example']) {
    const res = await request(port, { path: '/design', headers: { Origin: origin, Authorization: `Bearer ${token}` } })
    assert.equal(res.status, 403, `origin ${origin} was allowed through`)
    assert.equal(res.headers['access-control-allow-origin'], undefined,
      `origin ${origin} was granted a CORS header`)
  }

  const preflight = await request(port, {
    method: 'OPTIONS',
    path: '/design',
    headers: { Origin: 'https://evil.example' }
  })
  assert.equal(preflight.status, 403)
  assert.equal(preflight.headers['access-control-allow-origin'], undefined)
})

// The Figma plugin's iframe posts from an opaque origin, and so does any
// sandboxed iframe a hostile page cares to create. The origin cannot tell them
// apart, which is exactly why the token is not optional.
test('an opaque origin still has to present the token', async t => {
  const { port, server } = await withServer(t)

  const anonymous = await request(port, {
    method: 'POST',
    path: '/design',
    headers: { Origin: 'null', 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageName: 'Injected', nodes: [], nodeCount: 0 })
  })
  assert.equal(anonymous.status, 401)

  const authorized = await request(port, {
    method: 'POST',
    path: '/design',
    headers: {
      Origin: 'null',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${server.token()}`
    },
    body: JSON.stringify({ pageName: 'Real page', nodes: [], nodeCount: 0 })
  })
  assert.equal(authorized.status, 200)
  assert.equal(authorized.headers['access-control-allow-origin'], 'null')
  assert.equal(authorized.headers.vary, 'Origin')
})

test('a refused write never reaches the snapshot store', async t => {
  const { port, server } = await withServer(t)

  const rejected = await request(port, {
    method: 'POST',
    path: '/design',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pageName: 'Injected', nodes: [], nodeCount: 0 })
  })
  assert.equal(rejected.status, 401)

  const cleared = await request(port, { method: 'DELETE', path: '/design' })
  assert.equal(cleared.status, 401)

  const snapsDir = path.join(server.dataDir, 'snapshots')
  const written = fs.existsSync(snapsDir) ? fs.readdirSync(snapsDir) : []
  assert.deepEqual(written, [], 'an unauthenticated POST was persisted')
})

test('the anonymous escape hatch opens the routes and says so loudly', async t => {
  const { port, server } = await withServer(t, { FIGMA_BRIDGE_ALLOW_ANONYMOUS_LEGACY: '1' })

  const res = await request(port, { path: '/design' })
  assert.equal(res.status, 200)
  assert.match(server.logs(), /unauthenticated requests/i)

  // Opting out of the token does not opt out of the other two controls.
  const rebound = await request(port, { path: '/design', headers: { Host: 'attacker.example' } })
  assert.equal(rebound.status, 403)

  const foreign = await request(port, { path: '/design', headers: { Origin: 'https://evil.example' } })
  assert.equal(foreign.status, 403)
})
