// Pairing: how a Figma plugin gets the bridge token without anyone copying it.
//
// The plugin asks to pair and shows the 6-digit code it gets back. Someone who
// already holds the token approves that code: Claude Code through the MCP
// server, or a terminal running `npm run bridge:pair -- <code>`. The plugin then
// collects the token, once.
//
// Anything can ask, including a web page through a sandboxed iframe, whose
// origin is the same opaque "null" as the plugin's. That is why nothing is handed
// out until a person types the code they see in Figma into a channel that
// already has the token, and why a code is never shown anywhere but to the
// requester: not in a log line, not in a status response.

const crypto = require('crypto')

const DEFAULT_TTL_MS = 120_000
const DEFAULT_MAX_PENDING = 3
const DEFAULT_MAX_PER_MINUTE = 10
// After approval or expiry, a pairing is kept this long so the plugin can still
// collect the token or learn that its code expired.
const PICKUP_MS = 60_000

function pairingError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}

// Accepts "482913", "482 913" or "482-913".
function normalizeCode(value) {
  const digits = String(value ?? '').replace(/[\s-]/g, '')
  return /^\d{6}$/.test(digits) ? digits : null
}

function verifySecret(stored, providedHex) {
  if (typeof providedHex !== 'string' || !/^[0-9a-f]+$/i.test(providedHex)) return false
  const provided = Buffer.from(providedHex, 'hex')
  if (provided.length !== stored.length) return false
  return crypto.timingSafeEqual(stored, provided)
}

function createPairing(options = {}) {
  const {
    ttlMs = DEFAULT_TTL_MS,
    maxPending = DEFAULT_MAX_PENDING,
    maxPerMinute = DEFAULT_MAX_PER_MINUTE,
    now = () => Date.now(),
  } = options

  const requests = new Map() // pairingId -> entry
  let recent = [] // creation times within the last minute

  function sweep() {
    const t = now()
    for (const [id, entry] of requests) {
      if (t > (entry.approvedAt || entry.expiresAt) + PICKUP_MS) requests.delete(id)
    }
    recent = recent.filter(created => t - created < 60_000)
  }

  function pending() {
    const t = now()
    return [...requests.values()].filter(entry => !entry.approvedAt && t <= entry.expiresAt)
  }

  function request({ clientName = null, fileName = null } = {}) {
    sweep()
    if (recent.length >= maxPerMinute) {
      throw pairingError('PAIRING_LIMIT', 'Too many pairing requests. Wait a minute and press Pair again.')
    }
    const waiting = pending()
    if (waiting.length >= maxPending) {
      throw pairingError('PAIRING_LIMIT', 'Too many pairings are waiting for approval. Approve one or let them expire.')
    }
    const taken = new Set(waiting.map(entry => entry.code))
    let code
    do { code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0') } while (taken.has(code))

    const pairingId = crypto.randomBytes(16).toString('hex')
    const secret = crypto.randomBytes(32)
    const createdAt = now()
    const expiresAt = createdAt + ttlMs
    requests.set(pairingId, { pairingId, secret, code, clientName, fileName, createdAt, expiresAt, approvedAt: null })
    recent.push(createdAt)
    return { pairingId, pairingSecret: secret.toString('hex'), code, expiresAt }
  }

  // The requester's view of its own pairing. An approval is reported once and
  // the pairing is then forgotten, so the token behind it is handed out once.
  function check(pairingId, pairingSecret) {
    const entry = requests.get(pairingId)
    if (!entry) throw pairingError('PAIRING_NOT_FOUND', 'Unknown or finished pairing')
    if (!verifySecret(entry.secret, pairingSecret)) throw pairingError('UNAUTHORIZED', 'Invalid pairing secret')
    if (entry.approvedAt) {
      requests.delete(pairingId)
      return { status: 'approved', fileName: entry.fileName }
    }
    if (now() > entry.expiresAt) {
      requests.delete(pairingId)
      return { status: 'expired' }
    }
    return { status: 'pending', expiresAt: entry.expiresAt }
  }

  function approve(codeInput) {
    sweep()
    const code = normalizeCode(codeInput)
    if (!code) throw pairingError('BAD_REQUEST', 'A pairing code is the 6 digits shown in the Figma plugin')
    const entry = pending().find(candidate => candidate.code === code)
    if (!entry) {
      throw pairingError('PAIRING_NOT_FOUND',
        'No Figma plugin is waiting with that code. Check the code in the plugin, or press Pair again if it expired.')
    }
    entry.approvedAt = now()
    return { clientName: entry.clientName, fileName: entry.fileName }
  }

  function stats() {
    sweep()
    return { pending: pending().length }
  }

  return { request, check, approve, stats }
}

module.exports = createPairing
module.exports.createPairing = createPairing
module.exports.normalizeCode = normalizeCode
