const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const createCache = require('./cache')
const { markStale } = require('./cache')
const { cacheFilename, cacheKey } = require('./identity')

function mkTempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-cache-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('put/get round-trips an entry, filling defaults and computing ageMs', (t) => {
  const dataDir = mkTempDir(t)
  let clock = 1_000_000
  const cache = createCache({ dataDir, now: () => clock })

  const stored = cache.put({ fileKey: 'F1', payload: { a: 1 } })
  assert.equal(stored.fileKey, 'F1')
  assert.equal(stored.fileName, null)
  assert.equal(stored.nodeId, null)
  assert.equal(stored.source, 'legacy')
  assert.equal(stored.truncated, false)
  assert.equal(stored.verifiedFresh, false)
  assert.deepEqual(stored.completeness.truncatedNodeIds, [])
  assert.equal(stored.completeness.byteSize, Buffer.byteLength(JSON.stringify({ a: 1 })))

  clock += 5000
  const got = cache.get({ fileKey: 'F1', nodeId: null, representation: {} })
  assert.ok(got)
  assert.equal(got.ageMs, 5000)
  assert.deepEqual(got.payload, { a: 1 })
})

test('get returns null for a missing entry', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })
  assert.equal(cache.get({ fileKey: 'Nope', nodeId: '1:1', representation: {} }), null)
})

// Acceptance 1: file isolation
test('writing node B of file X never removes or alters node A of file X or any entry of file Y', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })

  cache.put({ fileKey: 'X', nodeId: '1:1', payload: { name: 'A' } })
  cache.put({ fileKey: 'Y', nodeId: '9:9', payload: { name: 'Y-entry' } })
  cache.put({ fileKey: 'X', nodeId: '2:2', payload: { name: 'B' } })

  const nodeA = cache.get({ fileKey: 'X', nodeId: '1:1', representation: {} })
  const nodeB = cache.get({ fileKey: 'X', nodeId: '2:2', representation: {} })
  const nodeY = cache.get({ fileKey: 'Y', nodeId: '9:9', representation: {} })

  assert.equal(nodeA.payload.name, 'A')
  assert.equal(nodeB.payload.name, 'B')
  assert.equal(nodeY.payload.name, 'Y-entry')
  assert.equal(cache.list().length, 3)
})

// Acceptance 2: page/file/node separation
test('a document-index entry (nodeId: null) and a node entry for the same file are independent', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })

  const doc = cache.put({ fileKey: 'X', nodeId: null, payload: { index: true } })
  const node = cache.put({ fileKey: 'X', nodeId: '1:1', payload: { index: false } })
  assert.notEqual(doc.key, node.key)

  const gotDoc = cache.get({ fileKey: 'X', nodeId: null, representation: {} })
  const gotNode = cache.get({ fileKey: 'X', nodeId: '1:1', representation: {} })
  assert.equal(gotDoc.payload.index, true)
  assert.equal(gotNode.payload.index, false)

  // Removing the node entry must not touch the document index entry.
  const removed = cache.invalidateNode({ fileKey: 'X', nodeId: '1:1' }, 'test')
  assert.equal(removed, 1)
  assert.ok(cache.get({ fileKey: 'X', nodeId: null, representation: {} }))
})

// Acceptance 3: atomic writes
test('a corrupt/unparseable entry file makes get() return null, not throw', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })

  const entry = cache.put({ fileKey: 'X', nodeId: '1:1', payload: { ok: true } })
  const filePath = path.join(dataDir, cacheFilename(entry.key))
  fs.writeFileSync(filePath, '{ this is not valid json')

  assert.doesNotThrow(() => cache.get({ fileKey: 'X', nodeId: '1:1', representation: {} }))
  assert.equal(cache.get({ fileKey: 'X', nodeId: '1:1', representation: {} }), null)
})

test('a leftover temp file from an interrupted write is never surfaced by get/list/stats', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })

  cache.put({ fileKey: 'X', nodeId: '1:1', payload: { ok: true } })
  // Simulate a crash between writeFileSync(tmp) and renameSync(tmp, final):
  // a stray temp file sits next to the real entry files.
  fs.writeFileSync(path.join(dataDir, '.deadbeef.json.1234.abcd.tmp'), 'not json at all, mid-write garbage')

  assert.equal(cache.list().length, 1)
  assert.equal(cache.stats().entryCount, 1)
  assert.ok(cache.get({ fileKey: 'X', nodeId: '1:1', representation: {} }))
})

// Acceptance 4: safe filenames
test('a hostile fileKey/nodeId never escapes dataDir and still round-trips correctly', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })
  const hostileFileKey = '../../evil'
  const hostileNodeId = '../../../etc/passwd'

  const stored = cache.put({ fileKey: hostileFileKey, nodeId: hostileNodeId, payload: { secret: 'value' } })
  const got = cache.get({ fileKey: hostileFileKey, nodeId: hostileNodeId, representation: {} })
  assert.ok(got)
  assert.equal(got.payload.secret, 'value')
  assert.equal(stored.fileKey, hostileFileKey)

  // Every file actually written must be a sha256-hex.json entry file — never a
  // path that used the raw fileKey/nodeId.
  for (const name of fs.readdirSync(dataDir)) {
    assert.match(name, /^[0-9a-f]{64}\.json$/)
  }

  // Nothing should have been written outside dataDir via traversal.
  const suspiciousPaths = [
    path.join(dataDir, '..', 'evil'),
    path.join(dataDir, '..', '..', 'evil'),
    path.join(os.tmpdir(), 'evil'),
    path.join(os.tmpdir(), 'etc', 'passwd'),
  ]
  for (const suspicious of suspiciousPaths) {
    assert.equal(fs.existsSync(suspicious), false)
  }
})

// Acceptance 5: freshness is not TTL
test('verifiedFresh is only accepted from a live plugin reply with a sessionId', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })

  assert.throws(
    () => cache.put({ fileKey: 'X', nodeId: '1:1', source: 'rest', verifiedFresh: true, payload: {} }),
    /verifiedFresh/,
  )
  assert.throws(
    () => cache.put({ fileKey: 'X', nodeId: '1:1', source: 'plugin', verifiedFresh: true, payload: {} }),
    /verifiedFresh/,
  )
  assert.throws(
    () => cache.put({ fileKey: 'X', nodeId: '1:1', source: 'legacy', sessionId: 's1', verifiedFresh: true, payload: {} }),
    /verifiedFresh/,
  )

  const ok = cache.put({
    fileKey: 'X', nodeId: '1:1', source: 'plugin', sessionId: 's1', verifiedFresh: true, payload: {},
  })
  assert.equal(ok.verifiedFresh, true)
})

test('get never flips verifiedFresh, and markStale returns a non-mutating stale copy', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })

  cache.put({
    fileKey: 'X', nodeId: '1:1', source: 'plugin', sessionId: 's1', verifiedFresh: true, payload: { a: 1 },
  })
  const got = cache.get({ fileKey: 'X', nodeId: '1:1', representation: {} })
  assert.equal(got.verifiedFresh, true)

  const stale = markStale(got)
  assert.equal(stale.verifiedFresh, false)
  assert.equal(stale.stale, true)
  // Original entry (and what get() would return again) must be untouched.
  assert.equal(got.verifiedFresh, true)
  const gotAgain = cache.get({ fileKey: 'X', nodeId: '1:1', representation: {} })
  assert.equal(gotAgain.verifiedFresh, true)
})

// Acceptance 6: bounded retention
test('more than maxEntries evicts oldest-first by fetchedAt; the newest entry survives', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir, maxEntries: 3 })

  for (let i = 0; i < 5; i++) {
    cache.put({
      fileKey: 'X', nodeId: `${i}:${i}`, fetchedAt: new Date(1000 * (i + 1)).toISOString(), payload: { i },
    })
  }

  const remaining = cache.list()
  assert.equal(remaining.length, 3)

  const newest = cache.get({ fileKey: 'X', nodeId: '4:4', representation: {} })
  assert.ok(newest)
  assert.equal(newest.payload.i, 4)

  assert.equal(cache.get({ fileKey: 'X', nodeId: '0:0', representation: {} }), null)
  assert.equal(cache.get({ fileKey: 'X', nodeId: '1:1', representation: {} }), null)
})

// Acceptance 7: persistence
test('a second createCache over the same dataDir sees everything the first wrote', (t) => {
  const dataDir = mkTempDir(t)
  const cache1 = createCache({ dataDir })
  cache1.put({
    fileKey: 'X', nodeId: '1:1', source: 'plugin', sessionId: 's1', verifiedFresh: true, payload: { hello: 'world' },
  })

  const cache2 = createCache({ dataDir })
  const got = cache2.get({ fileKey: 'X', nodeId: '1:1', representation: {} })
  assert.ok(got)
  assert.equal(got.payload.hello, 'world')
  // verifiedFresh must surface exactly as stored, not re-derived by the new process.
  assert.equal(got.verifiedFresh, true)
  assert.equal(cache2.list().length, 1)
})

// Acceptance 8: invalidation
test('invalidateFile removes exactly that file\'s entries and returns the count; other files survive', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })

  cache.put({ fileKey: 'X', nodeId: '1:1', payload: {} })
  cache.put({ fileKey: 'X', nodeId: '2:2', payload: {} })
  cache.put({ fileKey: 'Y', nodeId: '9:9', payload: {} })

  const removed = cache.invalidateFile('X', 'file changed')
  assert.equal(removed, 2)
  assert.equal(cache.get({ fileKey: 'X', nodeId: '1:1', representation: {} }), null)
  assert.equal(cache.get({ fileKey: 'X', nodeId: '2:2', representation: {} }), null)
  assert.ok(cache.get({ fileKey: 'Y', nodeId: '9:9', representation: {} }))
})

test('invalidateNode removes only the matching file+node entry', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })

  cache.put({ fileKey: 'X', nodeId: '1:1', payload: { v: 1 } })
  cache.put({ fileKey: 'X', nodeId: '2:2', payload: { v: 2 } })

  const removed = cache.invalidateNode({ fileKey: 'X', nodeId: '1:1' }, 'node changed')
  assert.equal(removed, 1)
  assert.equal(cache.get({ fileKey: 'X', nodeId: '1:1', representation: {} }), null)
  assert.ok(cache.get({ fileKey: 'X', nodeId: '2:2', representation: {} }))
})

test('list() returns metadata without payload, newest first, optionally filtered by fileKey', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })

  cache.put({ fileKey: 'X', fileName: 'File X', nodeId: '1:1', fetchedAt: new Date(1000).toISOString(), payload: { big: 'data' } })
  cache.put({ fileKey: 'X', fileName: 'File X', nodeId: '2:2', fetchedAt: new Date(2000).toISOString(), payload: { big: 'data2' } })
  cache.put({ fileKey: 'Y', fileName: 'File Y', nodeId: null, fetchedAt: new Date(3000).toISOString(), payload: { big: 'data3' } })

  const all = cache.list()
  assert.equal(all.length, 3)
  assert.ok(all.every(item => !('payload' in item)))
  assert.equal(all[0].fileKey, 'Y') // newest first

  const onlyX = cache.list({ fileKey: 'X' })
  assert.equal(onlyX.length, 2)
  assert.ok(onlyX.every(item => item.fileKey === 'X'))
})

test('stats() reports entryCount, byteSize and a per-file breakdown', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })

  cache.put({ fileKey: 'X', fileName: 'File X', nodeId: '1:1', payload: { big: 'data' } })
  cache.put({ fileKey: 'X', fileName: 'File X', nodeId: '2:2', payload: { big: 'data2' } })
  cache.put({ fileKey: 'Y', fileName: 'File Y', nodeId: null, payload: { big: 'data3' } })

  const stats = cache.stats()
  assert.equal(stats.entryCount, 3)
  assert.ok(stats.byteSize > 0)
  const xStat = stats.files.find(f => f.fileKey === 'X')
  const yStat = stats.files.find(f => f.fileKey === 'Y')
  assert.equal(xStat.entryCount, 2)
  assert.equal(xStat.fileName, 'File X')
  assert.equal(yStat.entryCount, 1)
})

test('clear() empties the cache', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })

  cache.put({ fileKey: 'X', nodeId: '1:1', payload: {} })
  cache.put({ fileKey: 'Y', nodeId: '2:2', payload: {} })
  cache.clear()

  assert.equal(cache.list().length, 0)
  assert.equal(cache.stats().entryCount, 0)
  assert.equal(cache.get({ fileKey: 'X', nodeId: '1:1', representation: {} }), null)
})

test('representation differences produce independent cache entries for the same file+node', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })

  cache.put({ fileKey: 'X', nodeId: '1:1', representation: { depth: 1 }, payload: { shallow: true } })
  cache.put({ fileKey: 'X', nodeId: '1:1', representation: { depth: 30 }, payload: { deep: true } })

  const shallow = cache.get({ fileKey: 'X', nodeId: '1:1', representation: { depth: 1 } })
  const deep = cache.get({ fileKey: 'X', nodeId: '1:1', representation: { depth: 30 } })
  assert.deepEqual(shallow.payload, { shallow: true })
  assert.deepEqual(deep.payload, { deep: true })
  assert.equal(cache.list().length, 2)
})

test('cacheKey/cacheFilename stay consistent between an external caller and the cache internals', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })
  cache.put({ fileKey: 'X', nodeId: '1:1', representation: {}, payload: { a: 1 } })

  const externalKey = cacheKey({ fileKey: 'X', nodeId: '1:1', representation: {} })
  const externalFilename = cacheFilename(externalKey)
  assert.ok(fs.existsSync(path.join(dataDir, externalFilename)))
})
