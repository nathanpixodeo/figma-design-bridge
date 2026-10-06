// Local bridge token: the single shared secret that authenticates every
// mutating and design-reading route on the loopback daemon.
//
// The token is written to <dataDir>/bridge-token.json; by default <dataDir> is
// the per-user directory every launcher shares, outside any repository (see
// data-dir.js). It must never appear in a health response, a session listing, a
// log line, an error message or a URL.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const TOKEN_FILENAME = 'bridge-token.json'
const TOKEN_BYTES = 32
const TOKEN_PATTERN = /^[0-9a-f]{64}$/i

// A Bearer credential is limited to the token68 character set by RFC 6750.
const BEARER_PATTERN = /^Bearer[ \t]+([A-Za-z0-9._~+/=-]+)[ \t]*$/i

// ── Storage ───────────────────────────────────────────────

function tokenPath(dataDir) {
  if (typeof dataDir !== 'string' || !dataDir.trim()) {
    throw new Error('A data directory is required to locate the bridge token')
  }
  return path.join(dataDir, TOKEN_FILENAME)
}

// Best effort only. POSIX modes are honoured on macOS/Linux; on Windows the
// inherited NTFS ACL wins and 0o600 is a no-op, so the real protection there is
// that the token lives in the per-user data directory.
function restrictPermissions(filePath) {
  try { fs.chmodSync(filePath, 0o600) } catch {}
}

// The data directory holds cached designs as well as the token: owner-only.
function writeTempTokenFile(filePath, record) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  fs.writeFileSync(temp, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 })
  restrictPermissions(temp)
  return temp
}

function writeTokenFile(filePath, record) {
  const temp = writeTempTokenFile(filePath, record)
  fs.renameSync(temp, filePath)
  restrictPermissions(filePath)
}

// Places a first token only if there is none yet. Two launchers starting at
// the same moment would otherwise each mint one, and the loser would keep
// accepting a token that is no longer on disk. A hard link fails when the
// target exists; file systems without hard links fall back to checking first.
function createTokenFile(filePath, record) {
  const temp = writeTempTokenFile(filePath, record)
  try {
    fs.linkSync(temp, filePath)
    return true
  } catch (error) {
    if (error.code === 'EEXIST' || fs.existsSync(filePath)) return false
    fs.renameSync(temp, filePath)
    return true
  } finally {
    try { fs.rmSync(temp, { force: true }) } catch {}
    restrictPermissions(filePath)
  }
}

function readToken(dataDir) {
  const filePath = tokenPath(dataDir)
  try {
    const record = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!record || typeof record.token !== 'string') return null
    if (!TOKEN_PATTERN.test(record.token)) return null
    return { token: record.token, createdAt: record.createdAt || null, path: filePath }
  } catch {
    // Missing, unreadable or malformed: treat as absent so a fresh token is minted.
    return null
  }
}

function rotateToken(dataDir) {
  const filePath = tokenPath(dataDir)
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex')
  writeTokenFile(filePath, { token, createdAt: new Date().toISOString() })
  return { token, created: true, path: filePath }
}

function getOrCreateToken(dataDir) {
  const existing = readToken(dataDir)
  if (existing) return { token: existing.token, created: false, path: existing.path }
  const filePath = tokenPath(dataDir)
  const token = crypto.randomBytes(TOKEN_BYTES).toString('hex')
  if (createTokenFile(filePath, { token, createdAt: new Date().toISOString() })) {
    return { token, created: true, path: filePath }
  }
  // Another launcher created one first: use that.
  const raced = readToken(dataDir)
  if (raced) return { token: raced.token, created: false, path: raced.path }
  return rotateToken(dataDir)
}

// bigint: an NTFS file id does not fit in a double, and mtimeNs separates two
// writes inside the same millisecond.
function stampOf(filePath) {
  try {
    const stat = fs.statSync(filePath, { bigint: true })
    return `${stat.ino}:${stat.size}:${stat.mtimeNs}`
  } catch {
    return null
  }
}

// The token a running bridge accepts follows bridge-token.json, so
// `npm run bridge:token:rotate` revokes the old token at once rather than at the
// bridge's next restart. Each call costs one stat; the file is read again only
// when it changed. A missing or unreadable file keeps the last good token
// instead of locking everyone out.
function createTokenSource(dataDir, initialToken) {
  const filePath = tokenPath(dataDir)
  let current = initialToken
  let stamp = stampOf(filePath)
  return function currentToken() {
    const next = stampOf(filePath)
    if (next && next !== stamp) {
      const record = readToken(dataDir)
      if (record) {
        current = record.token
        stamp = next
      }
    }
    return current
  }
}

// ── Request authentication ────────────────────────────────

// Headers only. A token in a query string or a body leaks into access logs,
// shell history and Referer headers, so those locations are never consulted.
function extractToken(req) {
  const headers = (req && req.headers) || {}

  const authorization = headers.authorization
  if (typeof authorization === 'string') {
    const match = authorization.match(BEARER_PATTERN)
    if (match) return match[1]
  }

  const header = headers['x-bridge-token']
  if (typeof header === 'string' && header.trim()) return header.trim()

  return null
}

// Constant-time string comparison. crypto.timingSafeEqual throws when the two
// buffers differ in length, so the length guard has to come first; a length
// mismatch is reported as a plain mismatch rather than an exception.
function constantTimeEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false
  if (actual.length === 0 || expected.length === 0) return false
  const a = Buffer.from(actual, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function verifyToken(req, expected) {
  return constantTimeEqual(extractToken(req), expected)
}

module.exports = {
  getOrCreateToken,
  createTokenSource,
  readToken,
  rotateToken,
  extractToken,
  verifyToken,
  TOKEN_FILENAME,
}
