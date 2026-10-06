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

// Replaces one fs function for the length of a test; cache.js looks them up on
// the module at every call.
function stub(t, name, replacement) {
  const original = fs[name]
  fs[name] = (...args) => replacement(original, ...args)
  t.after(() => { fs[name] = original })
}

// Counts the entry files the cache opens to read their head, and the ones it
// reads whole.
function countEntryReads(t) {
  const reads = { opened: 0, readWhole: 0 }
  const isEntry = file => typeof file === 'string' && /[0-9a-f]{64}\.json$/.test(file)
  stub(t, 'openSync', (original, file, ...rest) => {
    if (isEntry(file)) reads.opened += 1
    return original(file, ...rest)
  })
  stub(t, 'readFileSync', (original, file, ...rest) => {
    if (isEntry(file)) reads.readWhole += 1
    return original(file, ...rest)
  })
  return reads
}

function filesByKey(stats) {
  return Object.fromEntries(stats.files.map(file => [file.fileKey, file]))
}

function bytesOnDisk(dataDir) {
  return fs.readdirSync(dataDir).reduce((sum, name) => sum + fs.statSync(path.join(dataDir, name)).size, 0)
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
test('more than maxEntries evicts the oldest writes first, whatever their fetchedAt; the newest entry survives', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir, maxEntries: 3 })

  for (let i = 0; i < 5; i++) {
    // fetchedAt runs backwards, so it cannot be what decides.
    cache.put({
      fileKey: 'X', nodeId: `${i}:${i}`, fetchedAt: new Date(1000 * (10 - i)).toISOString(), payload: { i },
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

// ── Bookkeeping without reading entries back ─────────────────

test('invalidation, stats and eviction never read back an entry this process wrote', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir, maxEntries: 3 })

  cache.put({ fileKey: 'X', fileName: 'File X', nodeId: '1:1', payload: { n: 1 } })
  cache.put({ fileKey: 'X', fileName: 'File X', nodeId: '2:2', payload: { n: 2 } })
  cache.put({ fileKey: 'Y', fileName: 'File Y', nodeId: '3:3', payload: { n: 3 } })
  // None of them parses any more, so bookkeeping that read them back would
  // lose track of which file each one belongs to.
  for (const name of fs.readdirSync(dataDir)) fs.writeFileSync(path.join(dataDir, name), 'not json')
  const reads = countEntryReads(t)

  // Over maxEntries: the oldest, X 1:1, is evicted.
  cache.put({ fileKey: 'Y', fileName: 'File Y', nodeId: '4:4', payload: { n: 4 } })
  assert.deepEqual(filesByKey(cache.stats()), {
    X: { fileKey: 'X', fileName: 'File X', entryCount: 1 },
    Y: { fileKey: 'Y', fileName: 'File Y', entryCount: 2 },
  })
  assert.equal(cache.invalidateFile('X', 'edited'), 1)
  assert.equal(cache.invalidateNode({ fileKey: 'Y', nodeId: '3:3' }, 'edited'), 1)
  assert.equal(cache.stats().entryCount, 1)
  assert.equal(fs.readdirSync(dataDir).length, 1)
  assert.deepEqual(reads, { opened: 0, readWhole: 0 })
})

test('entries an earlier process left are indexed once, on first use, from the head of each file', (t) => {
  const dataDir = mkTempDir(t)
  const earlier = createCache({ dataDir })
  // Far larger than the head that indexing reads.
  const payload = { big: 'x'.repeat(200_000) }
  earlier.put({ fileKey: 'X', fileName: 'File X', nodeId: '1:1', payload })
  earlier.put({ fileKey: 'X', fileName: 'File X', nodeId: '2:2', payload })
  earlier.put({ fileKey: 'Y', fileName: 'File Y', nodeId: '3:3', payload })
  const byteSize = bytesOnDisk(dataDir)

  const reads = countEntryReads(t)
  const cache = createCache({ dataDir })
  assert.deepEqual(reads, { opened: 0, readWhole: 0 }, 'indexed at startup rather than on first use')

  const stats = cache.stats()
  assert.equal(stats.entryCount, 3)
  assert.equal(stats.byteSize, byteSize)
  assert.deepEqual(filesByKey(stats), {
    X: { fileKey: 'X', fileName: 'File X', entryCount: 2 },
    Y: { fileKey: 'Y', fileName: 'File Y', entryCount: 1 },
  })
  assert.equal(cache.invalidateFile('X', 'edited'), 2)
  cache.put({ fileKey: 'Z', nodeId: '4:4', payload: {} })
  assert.equal(cache.stats().entryCount, 2)
  assert.equal(cache.invalidateNode({ fileKey: 'Y', nodeId: '3:3' }, 'edited'), 1)
  // Each opened once for its head and none read whole: no payload was parsed.
  assert.deepEqual(reads, { opened: 3, readWhole: 0 })
})

test('an entry whose metadata outgrows the head, or nests a payload key, is read whole and indexed right', (t) => {
  const dataDir = mkTempDir(t)
  const earlier = createCache({ dataDir })
  earlier.put({ fileKey: 'X', fileName: 'n'.repeat(100_000), nodeId: '1:1', payload: {} })
  earlier.put({
    fileKey: 'Y', fileName: 'File Y', nodeId: '2:2', representation: { depth: 1, payload: 'nested' }, payload: {},
  })

  const reads = countEntryReads(t)
  const cache = createCache({ dataDir })
  const files = filesByKey(cache.stats())
  assert.equal(files.X.fileName, 'n'.repeat(100_000))
  assert.equal(files.Y.fileName, 'File Y')
  assert.equal(reads.readWhole, 2)
  assert.deepEqual(cache.list({ fileKey: 'Y' })[0].representation, { depth: 1, payload: 'nested' })
  assert.equal(cache.invalidateNode({ fileKey: 'Y', nodeId: '2:2' }, 'edited'), 1)
})

test('entries an earlier process left are evicted oldest modification time first', (t) => {
  const dataDir = mkTempDir(t)
  const earlier = createCache({ dataDir })
  const first = earlier.put({ fileKey: 'X', nodeId: '1:1', payload: {} })
  const second = earlier.put({ fileKey: 'X', nodeId: '2:2', payload: {} })
  // Written last, but last modified an hour ago.
  const anHourAgo = new Date(Date.now() - 3_600_000)
  fs.utimesSync(path.join(dataDir, cacheFilename(second.key)), anHourAgo, anHourAgo)

  const cache = createCache({ dataDir, maxEntries: 2 })
  cache.put({ fileKey: 'X', nodeId: '3:3', payload: {} })
  assert.ok(cache.get(first))
  assert.equal(cache.get(second), null)
})

test('an unreadable entry left on disk counts toward the limits, names no file, and ages out', (t) => {
  const dataDir = mkTempDir(t)
  const corruptPath = path.join(dataDir, `${'e'.repeat(64)}.json`)
  fs.writeFileSync(corruptPath, '{ this is not valid json')
  const cache = createCache({ dataDir, maxEntries: 1 })

  assert.deepEqual(cache.stats(), { entryCount: 1, byteSize: fs.statSync(corruptPath).size, files: [] })
  cache.put({ fileKey: 'X', nodeId: '1:1', payload: {} })
  assert.equal(fs.existsSync(corruptPath), false)
  assert.deepEqual(cache.stats().files, [{ fileKey: 'X', fileName: null, entryCount: 1 }])
})

// ── Byte budget ──────────────────────────────────────────────

test('the byte budget evicts the oldest entries until the cache fits, but never the entry just written', (t) => {
  // Entries that differ only in their node id serialize to the same size.
  const entryFor = (nodeId, payload = 'p'.repeat(1000)) => ({
    fileKey: 'X', nodeId, fetchedAt: '2026-10-01T00:00:00.000Z', payload,
  })
  const probeDir = mkTempDir(t)
  const probe = createCache({ dataDir: probeDir }).put(entryFor('9:9'))
  const entrySize = fs.statSync(path.join(probeDir, cacheFilename(probe.key))).size

  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir, maxBytes: Math.floor(entrySize * 2.5) })
  const has = nodeId => cache.get({ fileKey: 'X', nodeId, representation: {} }) !== null
  cache.put(entryFor('1:1'))
  cache.put(entryFor('2:2'))
  cache.put(entryFor('3:3'))
  assert.deepEqual(['1:1', '2:2', '3:3'].map(has), [false, true, true])
  assert.equal(bytesOnDisk(dataDir), entrySize * 2)
  assert.equal(cache.stats().byteSize, entrySize * 2)

  // Over the budget on its own: everything older goes, and it stays.
  cache.put(entryFor('4:4', 'p'.repeat(entrySize * 3)))
  assert.deepEqual(['2:2', '3:3', '4:4'].map(has), [false, false, true])
  assert.equal(cache.stats().entryCount, 1)
})

test('a limit that is not a positive number is refused rather than ignored', (t) => {
  const dataDir = mkTempDir(t)
  assert.throws(() => createCache({ dataDir, maxBytes: Number.NaN }), /got 500 and NaN/)
  assert.throws(() => createCache({ dataDir, maxEntries: 0 }), /got 0 and 200000000/)
})

// ── Entries that vanish or resist ────────────────────────────

test('an entry deleted underneath the cache counts as already gone when invalidating and evicting', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir, maxEntries: 2 })
  const pathOf = entry => path.join(dataDir, cacheFilename(entry.key))
  const has = (fileKey, nodeId) => cache.get({ fileKey, nodeId, representation: {} }) !== null

  const gone = cache.put({ fileKey: 'X', nodeId: '1:1', payload: {} })
  cache.put({ fileKey: 'X', nodeId: '2:2', payload: {} })
  fs.unlinkSync(pathOf(gone))
  // Only what this call deleted counts.
  assert.equal(cache.invalidateFile('X', 'edited'), 1)
  assert.equal(cache.stats().entryCount, 0)

  const goneToo = cache.put({ fileKey: 'Y', nodeId: '1:1', payload: {} })
  cache.put({ fileKey: 'Y', nodeId: '2:2', payload: {} })
  fs.unlinkSync(pathOf(goneToo))
  // One over maxEntries, and the oldest is already gone: nothing else is evicted.
  cache.put({ fileKey: 'Y', nodeId: '3:3', payload: {} })
  assert.deepEqual([has('Y', '2:2'), has('Y', '3:3')], [true, true])
  assert.equal(cache.stats().entryCount, 2)
})

test('an entry that vanishes while the index is built is left out of it', (t) => {
  const dataDir = mkTempDir(t)
  const earlier = createCache({ dataDir })
  const gone = earlier.put({ fileKey: 'X', nodeId: '1:1', payload: {} })
  earlier.put({ fileKey: 'X', nodeId: '2:2', payload: {} })
  const gonePath = path.join(dataDir, cacheFilename(gone.key))
  // Listed, then deleted before it could be looked at.
  stub(t, 'statSync', (original, file, ...rest) => {
    if (file === gonePath) fs.unlinkSync(file)
    return original(file, ...rest)
  })

  const cache = createCache({ dataDir })
  assert.equal(cache.stats().entryCount, 1)
  assert.equal(cache.invalidateFile('X', 'edited'), 1)
})

test('an entry that cannot be deleted yet stays indexed and is tried again', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })
  const held = cache.put({ fileKey: 'X', nodeId: '1:1', payload: {} })
  cache.put({ fileKey: 'X', nodeId: '2:2', payload: {} })
  const heldPath = path.join(dataDir, cacheFilename(held.key))
  let holding = true
  stub(t, 'unlinkSync', (original, file) => {
    if (holding && file === heldPath) throw Object.assign(new Error('held by a scanner'), { code: 'EPERM' })
    return original(file)
  })

  assert.equal(cache.invalidateFile('X', 'edited'), 1)
  assert.equal(cache.stats().entryCount, 1)
  holding = false
  assert.equal(cache.invalidateFile('X', 'edited again'), 1)
  assert.equal(cache.stats().entryCount, 0)
})

test('a rename another process blocks for a moment is retried, and leaves no temp file', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })
  let refusals = 0
  stub(t, 'renameSync', (original, from, to) => {
    if (refusals < 2) {
      refusals += 1
      throw Object.assign(new Error('held by a scanner'), { code: 'EPERM' })
    }
    return original(from, to)
  })

  cache.put({ fileKey: 'X', nodeId: '1:1', payload: { ok: true } })
  assert.equal(refusals, 2)
  assert.deepEqual(cache.get({ fileKey: 'X', nodeId: '1:1', representation: {} }).payload, { ok: true })
  assert.deepEqual(fs.readdirSync(dataDir).filter(name => name.endsWith('.tmp')), [])
})

test('a rename refused for good gives up after nine attempts, keeps the previous entry and leaves no temp file', (t) => {
  const dataDir = mkTempDir(t)
  const cache = createCache({ dataDir })
  cache.put({ fileKey: 'X', nodeId: '1:1', payload: { version: 1 } })
  let attempts = 0
  stub(t, 'renameSync', () => {
    attempts += 1
    throw Object.assign(new Error('held by a scanner'), { code: 'EBUSY' })
  })

  assert.throws(() => cache.put({ fileKey: 'X', nodeId: '1:1', payload: { version: 2 } }), { code: 'EBUSY' })
  assert.equal(attempts, 9)
  assert.deepEqual(cache.get({ fileKey: 'X', nodeId: '1:1', representation: {} }).payload, { version: 1 })
  assert.deepEqual(fs.readdirSync(dataDir).filter(name => name.endsWith('.tmp')), [])
  assert.equal(cache.stats().entryCount, 1)
})

test('the directory the cache creates is private to its user', { skip: process.platform === 'win32' }, (t) => {
  const dataDir = path.join(mkTempDir(t), 'data')
  createCache({ dataDir })
  assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700)
})

test('an entry that cannot even be stat-ed does not disable the cache', t => {
  const dir = mkTempDir(t)
  const writer = createCache({ dataDir: dir })
  writer.put({ fileKey: 'F1', nodeId: '1:1', payload: { name: 'held' } })
  writer.put({ fileKey: 'F1', nodeId: '1:2', payload: { name: 'fine' } })
  const held = fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort()[0]

  // A new process builds its index while a scanner holds one entry.
  let refused = 0
  stub(t, 'statSync', (original, file, ...rest) => {
    if (String(file).endsWith(held)) {
      refused += 1
      throw Object.assign(new Error('held'), { code: 'EPERM' })
    }
    return original(file, ...rest)
  })
  const reader = createCache({ dataDir: dir })
  assert.equal(reader.stats().entryCount, 2)
  assert.ok(refused > 0, 'the stub never saw the held entry')
  assert.doesNotThrow(() => reader.invalidateFile('F1'))
  assert.doesNotThrow(() => reader.put({ fileKey: 'F2', nodeId: '2:1', payload: { name: 'new' } }))
})

test('the cache budget setting accepts only a whole number of bytes', () => {
  const { resolveMaxBytes, DEFAULT_MAX_BYTES } = createCache
  const warnings = []
  const warn = message => warnings.push(message)
  assert.equal(resolveMaxBytes(undefined, warn), DEFAULT_MAX_BYTES)
  assert.equal(resolveMaxBytes('50000000', warn), 50_000_000)
  assert.equal(resolveMaxBytes(75_000_000, warn), 75_000_000)
  assert.equal(warnings.length, 0)
  // parseInt would have read "200MB" as 200 bytes and evicted everything.
  for (const bad of ['200MB', '0', '-5', 'abc', '1.5e8']) assert.equal(resolveMaxBytes(bad, warn), DEFAULT_MAX_BYTES, bad)
  assert.equal(warnings.length, 5)
})
