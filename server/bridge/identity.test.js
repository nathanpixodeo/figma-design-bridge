const test = require('node:test')
const assert = require('node:assert/strict')
const {
  parseSource,
  canonicalNodeId,
  urlNodeId,
  cacheKey,
  cacheFilename,
  sameFile,
} = require('./identity')

test('parseSource identifies a bare file key', () => {
  assert.deepEqual(parseSource('AbC_123-x'), { fileKey: 'AbC_123-x', nodeId: null, kind: 'fileKey' })
})

test('parseSource identifies a Figma URL and canonicalizes the node id', () => {
  assert.deepEqual(
    parseSource('https://www.figma.com/design/AbC123/Product?node-id=12-34&t=abc'),
    { fileKey: 'AbC123', nodeId: '12:34', kind: 'url' },
  )
})

test('parseSource rejects non-figma.com hosts with an actionable message', () => {
  assert.throws(() => parseSource('https://example.com/design/AbC123/Test'), /figma\.com/)
})

test('parseSource throws actionable errors for empty or invalid input', () => {
  assert.throws(() => parseSource(''), Error)
  assert.throws(() => parseSource(null), Error)
  assert.throws(() => parseSource('not a valid url://???'), Error)
})

test('canonicalNodeId converts URL dash form to API colon form', () => {
  assert.equal(canonicalNodeId('1-23'), '1:23')
  assert.equal(canonicalNodeId('1:23'), '1:23')
  assert.equal(canonicalNodeId(null), null)
  assert.equal(canonicalNodeId(undefined), null)
})

test('urlNodeId is the inverse of canonicalNodeId', () => {
  assert.equal(urlNodeId('1:23'), '1-23')
  assert.equal(urlNodeId(canonicalNodeId('1-23')), '1-23')
  assert.equal(urlNodeId(null), null)
})

test('cacheKey is order-independent over representation keys, including nested objects', () => {
  const a = cacheKey({ fileKey: 'F1', nodeId: '1:1', representation: { a: 1, b: 2, c: { x: 1, y: 2 } } })
  const b = cacheKey({ fileKey: 'F1', nodeId: '1:1', representation: { c: { y: 2, x: 1 }, b: 2, a: 1 } })
  assert.equal(a, b)
})

test('cacheKey changes when representation values actually differ', () => {
  const a = cacheKey({ fileKey: 'F1', nodeId: '1:1', representation: { depth: 30 } })
  const b = cacheKey({ fileKey: 'F1', nodeId: '1:1', representation: { depth: 10 } })
  assert.notEqual(a, b)
})

test('cacheKey treats dash and colon node id forms as identical', () => {
  const dash = cacheKey({ fileKey: 'F1', nodeId: '1-23', representation: {} })
  const colon = cacheKey({ fileKey: 'F1', nodeId: '1:23', representation: {} })
  assert.equal(dash, colon)
})

test('cacheKey encodes a null nodeId as a distinct "#doc" key, never an empty string', () => {
  const docIndex = cacheKey({ fileKey: 'F1', nodeId: null, representation: {} })
  const emptyStringNode = cacheKey({ fileKey: 'F1', nodeId: '', representation: {} })
  const realNode = cacheKey({ fileKey: 'F1', nodeId: '0:0', representation: {} })
  assert.match(docIndex, /#doc/)
  assert.notEqual(docIndex, realNode)
  // '' normalizes to null via canonicalNodeId, so it must match the doc-index key,
  // not silently become its own distinct (and wrong) key.
  assert.equal(docIndex, emptyStringNode)
})

test('cacheKey requires a non-empty fileKey', () => {
  assert.throws(() => cacheKey({ fileKey: '', nodeId: null, representation: {} }), Error)
  assert.throws(() => cacheKey({ nodeId: null, representation: {} }), Error)
})

test('cacheFilename returns a filesystem-safe sha256-based name, deterministically', () => {
  const key = cacheKey({ fileKey: 'F1', nodeId: '1:1', representation: {} })
  const filename = cacheFilename(key)
  assert.match(filename, /^[0-9a-f]{64}\.json$/)
  assert.equal(cacheFilename(key), filename)
})

test('cacheFilename never leaks a hostile fileKey into the filename', () => {
  const hostileKey = cacheKey({ fileKey: '../../evil', nodeId: '../../../etc/passwd', representation: {} })
  const filename = cacheFilename(hostileKey)
  assert.match(filename, /^[0-9a-f]{64}\.json$/)
  assert.equal(filename.includes('..'), false)
  assert.equal(filename.includes('/'), false)
})

test('cacheFilename differs for different keys', () => {
  const a = cacheFilename(cacheKey({ fileKey: 'F1', nodeId: '1:1', representation: {} }))
  const b = cacheFilename(cacheKey({ fileKey: 'F2', nodeId: '1:1', representation: {} }))
  assert.notEqual(a, b)
})

test('sameFile is strict, case-sensitive fileKey equality', () => {
  assert.equal(sameFile('AbC123', 'AbC123'), true)
  assert.equal(sameFile('AbC123', 'abc123'), false)
})

test('sameFile never treats null/undefined as equal, even to each other', () => {
  assert.equal(sameFile(null, null), false)
  assert.equal(sameFile(undefined, undefined), false)
  assert.equal(sameFile(null, undefined), false)
  assert.equal(sameFile('AbC123', null), false)
  assert.equal(sameFile('AbC123', undefined), false)
})
