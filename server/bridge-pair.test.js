const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createDaemon } = require('./bridge/daemon')

// `npm run bridge:pair -- <code>` approves a waiting Figma plugin from the
// terminal, using the token from the same data directory as the bridge.

function run(args, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(__dirname, 'bridge-pair.js'), ...args], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('exit', code => resolve({ code, stdout, stderr }))
  })
}

async function withBridge(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-pair-'))
  const daemon = await createDaemon({ port: 0, dataDir, log: () => {} })
  t.after(async () => {
    await daemon.close()
    fs.rmSync(dataDir, { recursive: true, force: true })
  })
  const env = { FIGMA_BRIDGE_DATA_DIR: dataDir, FIGMA_BRIDGE_PORT: String(daemon.port) }
  return { daemon, env }
}

test('the terminal command approves the code a plugin shows', async t => {
  const { daemon, env } = await withBridge(t)
  const asked = await (await fetch(`${daemon.url}/bridge/pair`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fileName: 'Checkout' }),
  })).json()

  const result = await run([`${asked.code.slice(0, 3)}-${asked.code.slice(3)}`], env)
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /Paired the Figma plugin for "Checkout"/)
  assert.equal(result.stdout.includes(daemon.token), false)

  const collected = await (await fetch(`${daemon.url}/bridge/pair/${asked.pairingId}`, {
    headers: { 'x-pairing-secret': asked.pairingSecret },
  })).json()
  assert.equal(collected.token, daemon.token)
})

test('the terminal command explains a missing, malformed or unknown code', async t => {
  const { env } = await withBridge(t)

  const usage = await run([], env)
  assert.equal(usage.code, 2)
  assert.match(usage.stderr, /Usage: npm run bridge:pair/)

  const unknown = await run(['123456'], env)
  assert.equal(unknown.code, 1)
  assert.match(unknown.stderr, /No Figma plugin is waiting with that code/)
})
