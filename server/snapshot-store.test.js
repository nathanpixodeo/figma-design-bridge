const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const createSnapshotStore = require('./snapshot-store')

// The HTTP server and the MCP server each hold a store over one data
// directory. Two stores in one test stand in for those two processes.

function tempDataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-store-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function design(pageName, nodeCount = 1) {
  return { pageName, nodes: [{ id: '1:1', name: pageName, type: 'FRAME' }], nodeCount }
}

test('a save is visible to a store that loaded before it, without a restart', t => {
  const dataDir = tempDataDir(t)
  const reader = createSnapshotStore({ dataDir })
  const writer = createSnapshotStore({ dataDir })
  assert.equal(reader.getCurrent(), null)

  writer.save(design('First'))
  assert.equal(reader.getCurrent().pageName, 'First')

  writer.save(design('Second', 2))
  assert.equal(reader.getCurrent().pageName, 'Second')
  assert.equal(reader.getCurrent().nodeCount, 2)
})

test('a new store restores the latest snapshot from disk', t => {
  const dataDir = tempDataDir(t)
  createSnapshotStore({ dataDir }).save(design('Persisted'))

  const restarted = createSnapshotStore({ dataDir })
  assert.equal(restarted.getCurrent().pageName, 'Persisted')
  assert.ok(restarted.getCurrent().savedAt)
})

test('clear forgets the design until the next save, and keeps the files', t => {
  const dataDir = tempDataDir(t)
  const store = createSnapshotStore({ dataDir })
  const other = createSnapshotStore({ dataDir })
  store.save(design('Kept on disk'))

  store.clear()
  assert.equal(store.getCurrent(), null)
  assert.equal(store.list().length, 1)
  assert.ok(fs.existsSync(store.latestPath))

  other.save(design('Next sync'))
  assert.equal(store.getCurrent().pageName, 'Next sync')
})

test('writes leave no temporary files behind and pruning keeps the newest', t => {
  const dataDir = tempDataDir(t)
  const store = createSnapshotStore({ dataDir, maxSnapshots: 2 })
  for (const name of ['One', 'Two', 'Three']) {
    store.save(design(name))
    // Snapshot names carry a millisecond timestamp; keep them distinct.
    const until = Date.now() + 2
    while (Date.now() < until) {}
  }

  const listed = store.list()
  assert.deepEqual(listed.map(entry => entry.pageName), ['Three', 'Two'])
  assert.deepEqual(fs.readdirSync(dataDir).filter(name => name.endsWith('.tmp')), [])
  assert.deepEqual(fs.readdirSync(store.snapshotsDir).filter(name => name.endsWith('.tmp')), [])
})

test('a save succeeds while another process has latest.json open, and leaves no temp file', t => {
  const dataDir = tempDataDir(t)
  const store = createSnapshotStore({ dataDir })
  store.save(design('Before'))

  // Windows refuses to replace a file while any handle to it is open.
  const handle = fs.openSync(store.latestPath, 'r')
  try {
    store.save(design('While open'))
  } finally {
    fs.closeSync(handle)
  }

  assert.equal(createSnapshotStore({ dataDir }).getCurrent().pageName, 'While open')
  assert.deepEqual(fs.readdirSync(dataDir).filter(name => name.endsWith('.tmp')), [])
})

test('an unreadable latest.json is reported, not thrown, and a rewrite is picked up', t => {
  const dataDir = tempDataDir(t)
  fs.writeFileSync(path.join(dataDir, 'latest.json'), '{"pageName": ')
  const warnings = []
  const store = createSnapshotStore({ dataDir, log: (level, message) => { if (level === 'warn') warnings.push(message) } })

  assert.equal(store.getCurrent(), null)
  assert.equal(store.getCurrent(), null)
  assert.equal(warnings.length, 1)

  createSnapshotStore({ dataDir }).save(design('Repaired'))
  assert.equal(store.getCurrent().pageName, 'Repaired')
})
