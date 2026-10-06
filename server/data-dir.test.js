const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {
  resolveDataDir,
  describeDataDir,
  prepareDataDir,
  migrateDataDir,
  userDataDir,
} = require('./data-dir')

// Every client that has to authenticate against the bridge finds the token by
// resolving the same data directory. Getting this wrong does not fail loudly —
// it reads an empty directory, mints a second token, and the caller is refused
// for a reason that looks nothing like the cause.

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-datadir-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value))
}

function readJson(...parts) {
  return JSON.parse(fs.readFileSync(path.join(...parts), 'utf8'))
}

// What an earlier version left in its data directory.
function legacyData(dir, token = 'a'.repeat(64)) {
  writeJson(path.join(dir, 'bridge-token.json'), { token, createdAt: '2026-09-01T00:00:00.000Z' })
  writeJson(path.join(dir, 'latest.json'), { pageName: 'Checkout', nodes: [], nodeCount: 0 })
  writeJson(path.join(dir, 'snapshots', '2026-09-01T00-00-00.000Z.json'), { pageName: 'Checkout' })
  writeJson(path.join(dir, `${'c'.repeat(64)}.json`), { cached: true })
  fs.writeFileSync(path.join(dir, `.${'d'.repeat(64)}.json.123.abc.tmp`), 'half a write')
  return dir
}

// Replaces one fs function for the length of a test; data-dir.js looks them up
// on the module at every call.
function stub(t, name, replacement) {
  const original = fs[name]
  fs[name] = (...args) => replacement(original, ...args)
  t.after(() => { fs[name] = original })
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

test('a missing or malformed config falls back to the directory every launcher shares', t => {
  const dir = tempDir(t)
  const shared = userDataDir({ env: {} })
  const missing = path.join(dir, 'nope.json')
  assert.equal(resolveDataDir({ env: {}, configPath: missing }), shared)

  const broken = path.join(dir, 'broken.json')
  fs.writeFileSync(broken, '{ this is not json')
  assert.equal(resolveDataDir({ env: {}, configPath: broken }), shared)

  const noDataDir = path.join(dir, 'partial.json')
  fs.writeFileSync(noDataDir, JSON.stringify({ port: 4567 }))
  assert.equal(resolveDataDir({ env: {}, configPath: noDataDir }), shared)
})

test('the shared directory is the platform per-user application data directory', () => {
  assert.equal(
    userDataDir({ platform: 'win32', env: { LOCALAPPDATA: 'D:\\Users\\ana\\AppData\\Local' }, homedir: 'D:\\Users\\ana' }),
    'D:\\Users\\ana\\AppData\\Local\\figma-design-bridge',
  )
  for (const env of [{}, { LOCALAPPDATA: 'relative\\dir' }]) {
    assert.equal(
      userDataDir({ platform: 'win32', env, homedir: 'D:\\Users\\ana' }),
      'D:\\Users\\ana\\AppData\\Local\\figma-design-bridge',
    )
  }
  assert.equal(
    userDataDir({ platform: 'darwin', env: {}, homedir: '/Users/ana' }),
    '/Users/ana/Library/Application Support/figma-design-bridge',
  )
  // XDG_DATA_HOME is not among the variables MCP hosts pass a server, so it is
  // not used: a launcher that saw it would pick a directory the others miss.
  assert.equal(
    userDataDir({ platform: 'linux', env: { XDG_DATA_HOME: '/data/ana' }, homedir: '/home/ana' }),
    '/home/ana/.local/share/figma-design-bridge',
  )
})

test('without a home directory the shared default falls back to the legacy directory', t => {
  const dir = tempDir(t)
  const legacyDataDir = path.join(dir, 'server', 'data')
  const realHomedir = os.homedir
  os.homedir = () => { throw new Error('ENOENT: no such file or directory, uv_os_homedir') }
  t.after(() => { os.homedir = realHomedir })

  const described = describeDataDir({ env: {}, configPath: path.join(dir, 'none.json'), legacyDataDir })
  assert.equal(described.dataDir, legacyDataDir)
})

test('a config file or variable naming the legacy directory counts as unset, and that directory is migrated from', t => {
  const dir = tempDir(t)
  const configPath = path.join(dir, 'server', 'config.json')
  const legacyDataDir = path.join(dir, 'server', 'data')
  const options = { configPath, legacyDataDir, defaultDataDir: path.join(dir, 'shared') }
  // What `npm start` wrote before 1.3.0.
  writeJson(configPath, { port: 3456, dataDir: legacyDataDir })

  const described = describeDataDir({ ...options, env: { FIGMA_BRIDGE_MIGRATE_FROM: path.join(dir, 'plugin-data') } })
  assert.equal(described.source, 'default')
  assert.equal(described.dataDir, path.join(dir, 'shared'))
  assert.deepEqual(described.migrateFrom.slice(0, 2), [path.join(dir, 'plugin-data'), legacyDataDir])

  // What the Codex setup guide told people to set before 1.3.0.
  assert.equal(describeDataDir({ ...options, env: { FIGMA_BRIDGE_DATA_DIR: legacyDataDir } }).source, 'default')

  // The old README example: a dataDir relative to the working directory.
  writeJson(configPath, { dataDir: 'data' })
  const relative = describeDataDir({ ...options, env: {} })
  assert.equal(relative.source, 'default')
  assert.ok(relative.migrateFrom.includes(path.resolve('data')))

  writeJson(configPath, { dataDir: path.join('..', 'elsewhere') })
  assert.deepEqual(
    [describeDataDir({ ...options, env: {} }).source, resolveDataDir({ ...options, env: {} })],
    ['config', path.resolve('..', 'elsewhere')],
  )
})

test('on Windows the legacy directory is recognised whatever its case', { skip: process.platform !== 'win32' }, t => {
  const dir = tempDir(t)
  const configPath = path.join(dir, 'config.json')
  const legacyDataDir = path.join(dir, 'server', 'data')
  writeJson(configPath, { dataDir: legacyDataDir.toUpperCase() })
  assert.equal(describeDataDir({ env: {}, configPath, legacyDataDir }).source, 'default')
})

test('resolving the directory never creates a config file', t => {
  const dir = tempDir(t)
  const configPath = path.join(dir, 'config.json')

  resolveDataDir({ env: {}, configPath })
  assert.equal(fs.existsSync(configPath), false, 'reading the config wrote one')
})

test('the first start copies the token and the design an earlier version left, not its cache, and changes nothing there', t => {
  const dir = tempDir(t)
  const source = legacyData(path.join(dir, 'old'))
  const before = fs.readdirSync(source).sort()
  const shared = path.join(dir, 'shared')
  const notes = []

  assert.equal(migrateDataDir(shared, [path.join(dir, 'missing'), source], note => notes.push(note)), source)

  assert.equal(readJson(shared, 'bridge-token.json').token, 'a'.repeat(64))
  assert.equal(readJson(shared, 'latest.json').pageName, 'Checkout')
  assert.equal(readJson(shared, 'snapshots', '2026-09-01T00-00-00.000Z.json').pageName, 'Checkout')
  // The cache refills from live reads, and copying it could hold up the start.
  assert.equal(fs.existsSync(path.join(shared, `${'c'.repeat(64)}.json`)), false, 'a cache entry was copied')
  assert.equal(fs.readdirSync(shared).some(name => name.endsWith('.tmp')), false, 'a temporary file was copied or left behind')
  assert.deepEqual(fs.readdirSync(source).sort(), before)
  assert.equal(notes.length, 1)
  assert.match(notes[0], /pairing token/)
  assert.equal(notes[0].includes('a'.repeat(64)), false, 'the note leaked the token')

  // With a token in place, later starts leave the shared directory alone.
  fs.writeFileSync(path.join(source, 'latest.json'), JSON.stringify({ pageName: 'Changed later' }))
  assert.equal(migrateDataDir(shared, [source]), null)
  assert.equal(readJson(shared, 'latest.json').pageName, 'Checkout')
})

test('migration never replaces what the shared directory already has, and prefers a source with a token', t => {
  const dir = tempDir(t)
  const snapshotOnly = path.join(dir, 'snapshot-only')
  writeJson(path.join(snapshotOnly, 'latest.json'), { pageName: 'Snapshot only' })
  const withToken = legacyData(path.join(dir, 'with-token'), 'b'.repeat(64))
  const shared = path.join(dir, 'shared')
  writeJson(path.join(shared, 'latest.json'), { pageName: 'Already here' })

  assert.equal(migrateDataDir(shared, [snapshotOnly, withToken]), withToken)
  assert.equal(readJson(shared, 'latest.json').pageName, 'Already here')
  assert.equal(readJson(shared, 'bridge-token.json').token, 'b'.repeat(64))
})

test('only the newest snapshots of the history are copied', t => {
  const dir = tempDir(t)
  const source = legacyData(path.join(dir, 'old'))
  for (let day = 10; day < 30; day++) {
    writeJson(path.join(source, 'snapshots', `2026-09-${day}T00-00-00.000Z.json`), { day })
  }
  const shared = path.join(dir, 'shared')

  migrateDataDir(shared, [source])
  const copied = fs.readdirSync(path.join(shared, 'snapshots')).sort()
  assert.equal(copied.length, 10)
  assert.equal(copied[0], '2026-09-20T00-00-00.000Z.json')
  assert.equal(copied.at(-1), '2026-09-29T00-00-00.000Z.json')
})

test('a file that cannot be copied is skipped and named, and the token still carries over', t => {
  const dir = tempDir(t)
  const source = legacyData(path.join(dir, 'old'))
  const shared = path.join(dir, 'shared')
  const notes = []
  stub(t, 'copyFileSync', (original, from, to, ...rest) => {
    if (from.endsWith('latest.json')) throw Object.assign(new Error('locked'), { code: 'EBUSY' })
    // Pruned by a running older bridge since the listing: nothing to report.
    if (from.endsWith('2026-09-01T00-00-00.000Z.json')) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
    return original(from, to, ...rest)
  })

  assert.equal(migrateDataDir(shared, [source], note => notes.push(note)), source)
  assert.equal(readJson(shared, 'bridge-token.json').token, 'a'.repeat(64))
  assert.equal(fs.existsSync(path.join(shared, 'latest.json')), false)
  assert.equal(fs.existsSync(path.join(shared, 'snapshots', '2026-09-01T00-00-00.000Z.json')), false)
  assert.match(notes.join('\n'), /Skipped 1 file\(s\) .*latest\.json \(EBUSY\)/)
  assert.equal(fs.readdirSync(shared).some(name => name.endsWith('.tmp')), false)
})

test('a rename that another process blocks for a moment is retried', t => {
  const dir = tempDir(t)
  const source = legacyData(path.join(dir, 'old'))
  const shared = path.join(dir, 'shared')
  let refusals = 0
  stub(t, 'renameSync', (original, from, to) => {
    if (to.endsWith('latest.json') && refusals < 2) {
      refusals += 1
      throw Object.assign(new Error('held by a scanner'), { code: 'EPERM' })
    }
    return original(from, to)
  })

  migrateDataDir(shared, [source])
  assert.equal(refusals, 2)
  assert.equal(readJson(shared, 'latest.json').pageName, 'Checkout')
})

test('a token another launcher placed first is kept, not replaced', t => {
  const dir = tempDir(t)
  const source = legacyData(path.join(dir, 'old'))
  const shared = path.join(dir, 'shared')
  // Another launcher writes its token while this one is copying.
  stub(t, 'copyFileSync', (original, from, to, ...rest) => {
    original(from, to, ...rest)
    if (from.endsWith('bridge-token.json')) writeJson(path.join(shared, 'bridge-token.json'), { token: 'z'.repeat(64) })
  })

  migrateDataDir(shared, [source])
  assert.equal(readJson(shared, 'bridge-token.json').token, 'z'.repeat(64))
})

test('temporary files a crashed migration left are removed', t => {
  const dir = tempDir(t)
  const source = legacyData(path.join(dir, 'old'))
  const shared = path.join(dir, 'shared')
  const stale = path.join(shared, '.latest.json.999.migrate.tmp')
  writeJson(stale, {})
  const anHourAgo = new Date(Date.now() - 3_600_000)
  fs.utimesSync(stale, anHourAgo, anHourAgo)

  migrateDataDir(shared, [source])
  assert.equal(fs.existsSync(stale), false)
})

test('nothing is migrated into a directory chosen explicitly, or from nowhere', t => {
  const dir = tempDir(t)
  const source = legacyData(path.join(dir, 'old'))
  const explicit = path.join(dir, 'explicit')

  const prepared = prepareDataDir({ env: { FIGMA_BRIDGE_DATA_DIR: explicit, FIGMA_BRIDGE_MIGRATE_FROM: source } })
  assert.equal(prepared.migratedFrom, null)
  assert.equal(fs.existsSync(explicit), false)

  const shared = path.join(dir, 'shared')
  assert.equal(migrateDataDir(shared, [path.join(dir, 'missing'), shared]), null)
  assert.equal(fs.existsSync(shared), false)
})

function runTokenPrinter(env, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'bridge-token.js'), ...args], {
      env,
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
  const env = { ...process.env, FIGMA_BRIDGE_DATA_DIR: dir }

  const first = await runTokenPrinter(env)
  assert.equal(first.code, 0)
  // Exactly the token and a newline, so `$(npm run --silent bridge:token)` is
  // usable directly in a header. Guidance belongs on stderr.
  assert.match(first.stdout, /^[0-9a-f]{64}\n$/)
  assert.ok(!first.stderr.includes(first.stdout.trim()), 'stderr repeated the token')

  const second = await runTokenPrinter(env)
  assert.equal(second.stdout, first.stdout, 'printing the token rotated it')

  const rotated = await runTokenPrinter(env, ['--rotate'])
  assert.match(rotated.stdout, /^[0-9a-f]{64}\n$/)
  assert.notEqual(rotated.stdout, first.stdout, '--rotate returned the same token')
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(dir, 'bridge-token.json'), 'utf8')).token,
    rotated.stdout.trim(),
  )
})

test('without FIGMA_BRIDGE_DATA_DIR the token printer prints the token an earlier version used', async t => {
  if (describeDataDir({ env: {} }).source === 'config') {
    t.skip('server/config.json names its own dataDir')
    return
  }
  const dir = tempDir(t)
  const home = path.join(dir, 'home')
  const legacy = legacyData(path.join(dir, 'plugin-data'), 'e'.repeat(64))
  // The per-user directory is redirected into a temporary one on every platform.
  const env = { ...process.env, LOCALAPPDATA: home, HOME: home, FIGMA_BRIDGE_MIGRATE_FROM: legacy }
  delete env.FIGMA_BRIDGE_DATA_DIR

  const printed = await runTokenPrinter(env)
  assert.equal(printed.code, 0, printed.stderr)
  assert.equal(printed.stdout, `${'e'.repeat(64)}\n`)
  assert.match(printed.stderr, /Copied .* and the pairing token/)
  const shared = userDataDir({ env: { LOCALAPPDATA: home }, homedir: home })
  assert.equal(readJson(shared, 'bridge-token.json').token, 'e'.repeat(64))
})
