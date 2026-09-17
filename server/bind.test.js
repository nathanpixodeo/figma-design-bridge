const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const net = require('node:net')
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')

// The bridge token guards the routes, but the interface the listener binds to is
// what keeps the cached design off the network in the first place. These tests
// assert that property from the outside: reachable on loopback, refused on the
// machine's own LAN address.

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

function externalAddress() {
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses || []) {
      if (address.family === 'IPv4' && !address.internal) return address.address
    }
  }
  return null
}

function connect(host, port, timeoutMs = 2000) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port })
    const done = outcome => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(outcome)
    }
    socket.setTimeout(timeoutMs, () => done('timeout'))
    socket.on('connect', () => done('connected'))
    socket.on('error', error => done(error.code || 'error'))
  })
}

// `localhost` is a name, not an address, and the two loopback families are not
// interchangeable: on a runner where it resolves to ::1 first, a server told to
// bind "localhost" listens on [::1] and nothing answers on 127.0.0.1. Both count
// as loopback for the purpose of these tests, so both are tried.
const LOOPBACK_ADDRESSES = ['127.0.0.1', '::1']

async function waitForListen(port, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    for (const address of LOOPBACK_ADDRESSES) {
      if (await connect(address, port, 500) === 'connected') return address
    }
    await new Promise(r => setTimeout(r, 100))
  }
  return null
}

// Starts an entry point against a throwaway data directory and returns the
// child plus everything it wrote to stderr, which is where both servers log.
function startServer(entry, extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-bind-'))
  const child = spawn(process.execPath, [path.join(serverDir, entry)], {
    cwd: repoRoot,
    env: { ...process.env, FIGMA_BRIDGE_DATA_DIR: dataDir, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const output = []
  child.stdout.on('data', d => output.push(d.toString()))
  child.stderr.on('data', d => output.push(d.toString()))
  return {
    child,
    logs: () => output.join(''),
    stop: () => {
      child.kill()
      fs.rmSync(dataDir, { recursive: true, force: true })
    }
  }
}

for (const entry of ['index.js', 'mcp.mjs']) {
  test(`${entry} binds loopback and refuses the machine's LAN address`, async t => {
    const external = externalAddress()
    if (!external) {
      t.skip('no external IPv4 interface on this machine')
      return
    }

    const port = await freePort()
    const server = startServer(entry, { FIGMA_BRIDGE_PORT: String(port) })
    t.after(() => server.stop())

    assert.ok(await waitForListen(port),
      `${entry} never started listening on a loopback address at port ${port}\n${server.logs()}`)

    const outside = await connect(external, port)
    assert.notEqual(outside, 'connected',
      `${entry} accepted a connection on ${external}:${port}; the cached design is reachable from the network`)
  })
}

test('index.js treats localhost as loopback and stays quiet about it', async t => {
  const port = await freePort()
  const server = startServer('index.js', {
    FIGMA_BRIDGE_PORT: String(port),
    FIGMA_BRIDGE_HOST: 'localhost'
  })
  t.after(() => server.stop())

  const address = await waitForListen(port)
  assert.ok(address, `server never started listening on a loopback address\n${server.logs()}`)
  assert.ok(LOOPBACK_ADDRESSES.includes(address), `bound ${address}, which is not loopback`)
  assert.ok(!/not loopback/.test(server.logs()),
    'localhost was treated as an external bind and warned about')
})
