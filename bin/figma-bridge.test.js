const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')

const pkg = require('../package.json')

// The figma-bridge command that npm puts on PATH, run from a directory that is
// not the package, with no AI client on PATH.

const BIN = path.join(__dirname, 'figma-bridge.js')
const TOKEN_SCRIPT = path.join(__dirname, '..', 'server', 'bridge-token.js')

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

// process.env with PATH replaced, whatever case the platform spells it in.
function envWith(overrides) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!Object.keys(overrides).some(name => name.toUpperCase() === key.toUpperCase())) env[key] = value
  }
  return { ...env, ...overrides }
}

function run(file, args, env, cwd) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [file, ...args], { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('exit', code => resolve({ code, stdout, stderr }))
  })
}

function closedPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function setupEnv(t) {
  const dir = tempDir(t, 'figma-bridge-cli-')
  const dataDir = path.join(dir, 'data')
  const emptyBin = path.join(dir, 'bin')
  fs.mkdirSync(emptyBin)
  return { dir, dataDir, env: envWith({ FIGMA_BRIDGE_DATA_DIR: dataDir, PATH: emptyBin }) }
}

test('--version prints the package version, --help the commands', async t => {
  const { dir, env } = setupEnv(t)

  const version = await run(BIN, ['--version'], env, dir)
  assert.equal(version.code, 0)
  assert.equal(version.stdout, `${pkg.version}\n`)

  const help = await run(BIN, ['--help'], env, dir)
  assert.equal(help.code, 0)
  for (const command of ['setup', 'status', 'approvals', 'update', 'start', 'mcp', 'pair', 'token', 'import']) {
    assert.match(help.stdout, new RegExp(`^  ${command}\\b`, 'm'), command)
  }

  const bare = await run(BIN, [], env, dir)
  assert.equal(bare.code, 2)
  assert.match(bare.stdout, /Usage: figma-bridge <command>/)
})

test('an unknown command or option exits 2 and points at --help', async t => {
  const { dir, env } = setupEnv(t)

  const unknown = await run(BIN, ['strat'], env, dir)
  assert.equal(unknown.code, 2)
  assert.match(unknown.stderr, /Unknown command: strat/)

  const option = await run(BIN, ['setup', '--everything'], env, dir)
  assert.equal(option.code, 2)
  assert.match(option.stderr, /Unknown option for setup: --everything/)
})

test('token prints the same token as the script, from any directory', async t => {
  const { dir, env } = setupEnv(t)

  const viaBin = await run(BIN, ['token'], env, dir)
  assert.equal(viaBin.code, 0, viaBin.stderr)
  assert.match(viaBin.stdout, /^[0-9a-f]{64}\n$/)
  const viaScript = await run(TOKEN_SCRIPT, [], env, dir)
  assert.equal(viaScript.stdout, viaBin.stdout)
})

test('pair without a code prints its usage', async t => {
  const { dir, env } = setupEnv(t)
  const result = await run(BIN, ['pair'], env, dir)
  assert.equal(result.code, 2)
  assert.match(result.stderr, /Usage: figma-bridge pair/)
})

test('approvals shows and switches the mode in the data directory config', async t => {
  const { dir, dataDir, env } = setupEnv(t)

  const shown = await run(BIN, ['approvals'], env, dir)
  assert.equal(shown.code, 0)
  assert.match(shown.stdout, /^Approvals: auto, design reads run without asking/)

  const manual = await run(BIN, ['approvals', 'manual'], env, dir)
  assert.equal(manual.code, 0, manual.stderr)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).approvals, 'manual')
  assert.match((await run(BIN, ['approvals'], env, dir)).stdout, /^Approvals: manual/)

  const bad = await run(BIN, ['approvals', 'sometimes'], env, dir)
  assert.equal(bad.code, 2)
  assert.match(bad.stderr, /Usage: figma-bridge approvals \[auto\|manual\]/)
})

test('status reports the token without printing it, and a bridge that is not running', async t => {
  const { dir, dataDir, env } = setupEnv(t)
  const token = (await run(BIN, ['token'], env, dir)).stdout.trim()
  env.FIGMA_BRIDGE_PORT = String(await closedPort())

  const result = await run(BIN, ['status'], env, dir)
  assert.equal(result.code, 0, result.stderr)
  assert.match(result.stdout, /Pairing token: +present/)
  assert.ok(result.stdout.includes(dataDir))
  assert.match(result.stdout, /Bridge: +not running/)
  assert.match(result.stdout, /Claude Code: +not installed/)
  assert.ok(!result.stdout.includes(token), 'status printed the token')
})
