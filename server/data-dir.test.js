const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { resolveDataDir, DEFAULT_DATA_DIR } = require('./data-dir')

// Every client that has to authenticate against the bridge finds the token by
// resolving the same data directory. Getting this wrong does not fail loudly —
// it reads an empty directory, mints a second token, and the caller is refused
// for a reason that looks nothing like the cause.

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-datadir-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('the environment variable wins over the config file', t => {
  const dir = tempDir(t)
  const configPath = path.join(dir, 'config.json')
  fs.writeFileSync(configPath, JSON.stringify({ dataDir: path.join(dir, 'from-config') }))

  const resolved = resolveDataDir({
    env: { FIGMA_BRIDGE_DATA_DIR: path.join(dir, 'from-env') },
    configPath,
  })
  assert.equal(resolved, path.join(dir, 'from-env'))
})

test('the config file is used when the environment says nothing', t => {
  const dir = tempDir(t)
  const configPath = path.join(dir, 'config.json')
  fs.writeFileSync(configPath, JSON.stringify({ dataDir: path.join(dir, 'from-config') }))

  assert.equal(resolveDataDir({ env: {}, configPath }), path.join(dir, 'from-config'))
})

test('a missing or malformed config falls back to the default directory', t => {
  const dir = tempDir(t)
  const missing = path.join(dir, 'nope.json')
  assert.equal(resolveDataDir({ env: {}, configPath: missing }), DEFAULT_DATA_DIR)

  const broken = path.join(dir, 'broken.json')
  fs.writeFileSync(broken, '{ this is not json')
  assert.equal(resolveDataDir({ env: {}, configPath: broken }), DEFAULT_DATA_DIR)

  const noDataDir = path.join(dir, 'partial.json')
  fs.writeFileSync(noDataDir, JSON.stringify({ port: 4567 }))
  assert.equal(resolveDataDir({ env: {}, configPath: noDataDir }), DEFAULT_DATA_DIR)
})

test('resolving the directory never creates a config file', t => {
  const dir = tempDir(t)
  const configPath = path.join(dir, 'config.json')

  resolveDataDir({ env: {}, configPath })
  assert.equal(fs.existsSync(configPath), false, 'reading the config wrote one')
})

function runTokenPrinter(dataDir, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'bridge-token.js'), ...args], {
      env: { ...process.env, FIGMA_BRIDGE_DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => { stdout += d.toString() })
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', reject)
    child.on('close', code => resolve({ code, stdout, stderr }))
  })
}

test('the token printer puts the credential on stdout and nothing else', async t => {
  const dir = tempDir(t)

  const first = await runTokenPrinter(dir)
  assert.equal(first.code, 0)
  // Exactly the token and a newline, so `$(npm run --silent bridge:token)` is
  // usable directly in a header. Guidance belongs on stderr.
  assert.match(first.stdout, /^[0-9a-f]{64}\n$/)
  assert.ok(!first.stderr.includes(first.stdout.trim()), 'stderr repeated the token')

  const second = await runTokenPrinter(dir)
  assert.equal(second.stdout, first.stdout, 'printing the token rotated it')

  const rotated = await runTokenPrinter(dir, ['--rotate'])
  assert.match(rotated.stdout, /^[0-9a-f]{64}\n$/)
  assert.notEqual(rotated.stdout, first.stdout, '--rotate returned the same token')
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dir, 'bridge-token.json'), 'utf8')).token,
    rotated.stdout.trim(),
  )
})
