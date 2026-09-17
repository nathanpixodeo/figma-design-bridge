const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')

const createRoutes = require('./routes')
const {
  getOrCreateToken,
  readToken,
  rotateToken,
  extractToken,
  verifyToken,
  TOKEN_FILENAME,
} = require('./token')

function tempDataDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-bridge-token-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function fakeRequest(headers, url = '/bridge/read') {
  return { method: 'POST', url, headers }
}

test('getOrCreateToken mints a 32-byte hex token and persists it atomically', t => {
  const dir = tempDataDir(t)
  const created = getOrCreateToken(dir)

  assert.equal(created.created, true)
  assert.match(created.token, /^[0-9a-f]{64}$/)
  assert.equal(created.path, path.join(dir, TOKEN_FILENAME))

  const record = JSON.parse(fs.readFileSync(created.path, 'utf8'))
  assert.equal(record.token, created.token)
  assert.match(record.createdAt, /^\d{4}-\d{2}-\d{2}T/)

  // The temp file used for the atomic rename must not survive.
  assert.deepEqual(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')), [])
  assert.deepEqual(fs.readdirSync(dir), [TOKEN_FILENAME])

  // POSIX modes only: on Windows the inherited NTFS ACL wins and 0o600 is a no-op.
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(created.path).mode & 0o777, 0o600)
  }
})

test('getOrCreateToken reuses the stored token and rotateToken replaces it', t => {
  const dir = tempDataDir(t)
  const first = getOrCreateToken(dir)
  const second = getOrCreateToken(dir)

  assert.equal(second.created, false)
  assert.equal(second.token, first.token)
  assert.equal(readToken(dir).token, first.token)

  const rotated = rotateToken(dir)
  assert.equal(rotated.created, true)
  assert.notEqual(rotated.token, first.token)
  assert.equal(readToken(dir).token, rotated.token)
})

test('a missing or corrupt token file is treated as absent, not as a valid token', t => {
  const dir = tempDataDir(t)
  assert.equal(readToken(dir), null)

  for (const contents of ['', 'not json', '{}', '{"token": 42}', '{"token": ""}', '{"token": "short"}']) {
    fs.writeFileSync(path.join(dir, TOKEN_FILENAME), contents)
    assert.equal(readToken(dir), null, contents)
  }

  const minted = getOrCreateToken(dir)
  assert.equal(minted.created, true)
  assert.match(minted.token, /^[0-9a-f]{64}$/)
})

test('extractToken reads headers only, never a query string or a body', () => {
  const token = 'a'.repeat(64)

  assert.equal(extractToken(fakeRequest({ authorization: `Bearer ${token}` })), token)
  assert.equal(extractToken(fakeRequest({ authorization: `bearer   ${token}  ` })), token)
  assert.equal(extractToken(fakeRequest({ 'x-bridge-token': ` ${token} ` })), token)

  // Authorization wins when both are present.
  assert.equal(extractToken(fakeRequest({ authorization: `Bearer ${token}`, 'x-bridge-token': 'other' })), token)

  // A token in a URL or a body leaks into access logs, shell history and
  // Referer headers, so neither location is ever consulted.
  assert.equal(extractToken(fakeRequest({}, `/bridge/read?token=${token}`)), null)
  assert.equal(extractToken({ method: 'POST', url: '/bridge/read', headers: {}, body: { token } }), null)

  assert.equal(extractToken(fakeRequest({ authorization: `Basic ${token}` })), null)
  assert.equal(extractToken(fakeRequest({ authorization: 'Bearer' })), null)
  assert.equal(extractToken(fakeRequest({ 'x-bridge-token': '   ' })), null)
  assert.equal(extractToken({}), null)
  assert.equal(extractToken(null), null)
})

test('verifyToken compares in constant time and survives a length mismatch', () => {
  const token = 'b'.repeat(64)
  const differentSameLength = `c${token.slice(1)}`

  assert.equal(verifyToken(fakeRequest({ authorization: `Bearer ${token}` }), token), true)
  assert.equal(verifyToken(fakeRequest({ 'x-bridge-token': token }), token), true)

  // timingSafeEqual throws on unequal lengths, so the guard has to come first.
  assert.equal(verifyToken(fakeRequest({ authorization: `Bearer ${token.slice(0, 10)}` }), token), false)
  assert.equal(verifyToken(fakeRequest({ authorization: `Bearer ${token}x` }), token), false)
  assert.equal(verifyToken(fakeRequest({ authorization: `Bearer ${differentSameLength}` }), token), false)
  assert.equal(verifyToken(fakeRequest({}), token), false)
  assert.equal(verifyToken(fakeRequest({ authorization: `Bearer ${token}` }), ''), false)
  assert.equal(verifyToken(fakeRequest({ authorization: `Bearer ${token}` }), null), false)
})

test('the bridge token never appears in an unauthenticated health response', async t => {
  const dir = tempDataDir(t)
  const { token } = getOrCreateToken(dir)

  const handler = createRoutes({
    token,
    broker: { listSessions: () => [], hasSessionForFile: () => false },
    cache: { stats: () => ({ entryCount: 0 }) },
    identity: { sameFile: (a, b) => a === b },
  })

  const server = http.createServer((req, res) => {
    Promise.resolve(handler(req, res)).then(handled => {
      if (handled) return
      res.writeHead(404).end()
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
    server.close(() => resolve())
  }))

  const response = await fetch(`http://127.0.0.1:${server.address().port}/bridge/health`)
  const raw = await response.text()

  assert.equal(response.status, 200)
  assert.equal(raw.includes(token), false)
  assert.deepEqual(JSON.parse(raw), {
    status: 'ok',
    protocolVersion: '1.0',
    service: 'figma-design-bridge',
  })
})
