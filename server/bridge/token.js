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

function writeTokenFile(filePath, record) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temp = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
  fs.writeFileSync(temp, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 })
  restrictPermissions(temp)
  fs.renameSync(temp, filePath)
  restrictPermissions(filePath)
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
  return rotateToken(dataDir)
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
  readToken,
  rotateToken,
  extractToken,
  verifyToken,
  TOKEN_FILENAME,
}
