const crypto = require('crypto')
const { parseFigmaSource, normalizeNodeId } = require('../figma-api')

// ── Source parsing ────────────────────────────────────────

// parseSource(source) => { fileKey, nodeId: string|null, kind: 'url'|'fileKey' }
// Reuses figma-api's parseFigmaSource (host validation, key/node-id extraction)
// so URL parsing rules live in exactly one place. Throws Error with an
// actionable message for anything invalid, including non-figma.com hosts.
function parseSource(source) {
  const parsed = parseFigmaSource(source)
  const trimmed = String(source).trim()
  const kind = trimmed.includes('://') ? 'url' : 'fileKey'
  return { fileKey: parsed.fileKey, nodeId: parsed.nodeId, kind }
}

// ── Node id forms ─────────────────────────────────────────

// canonicalNodeId('1-23'|'1:23'|null) => '1:23'|null
// URL dash form -> API colon form. Delegates to figma-api's normalizeNodeId.
function canonicalNodeId(nodeId) {
  return normalizeNodeId(nodeId)
}

// urlNodeId('1:23') => '1-23'
// Inverse of canonicalNodeId, for building Figma URLs/back-links. Not exported
// by figma-api.js (only the URL -> API direction is needed there), so it is
// implemented here.
function urlNodeId(nodeId) {
  if (nodeId === undefined || nodeId === null || nodeId === '') return null
  const value = String(nodeId).trim()
  return /^\d+:\d+$/.test(value) ? value.replace(':', '-') : value
}

// ── Cache key ─────────────────────────────────────────────

// Deterministic, order-independent JSON serialization: object keys are sorted
// recursively so { a: 1, b: 2 } and { b: 2, a: 1 } serialize identically.
function stableStringify(value) {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

// cacheKey({ fileKey, nodeId, representation }) => string
// Canonical, stable, order-independent over representation keys. A null/undefined
// nodeId (document index) is encoded explicitly as '#doc' so it never collides
// with an empty-string node id or with any real node id.
function cacheKey({ fileKey, nodeId, representation } = {}) {
  if (typeof fileKey !== 'string' || !fileKey) {
    throw new Error('cacheKey requires a non-empty fileKey string')
  }
  // Canonicalize first, then test for "no node id" — anything that normalizes
  // to null (null, undefined, '') must land on the same explicit '#doc'
  // marker, never on the two characters '' or the four characters 'null'.
  const canonical = nodeId === null || nodeId === undefined ? null : canonicalNodeId(nodeId)
  const nodePart = canonical === null ? '#doc' : canonical
  const representationPart = stableStringify(representation || {})
  return `fileKey=${fileKey}|nodeId=${nodePart}|representation=${representationPart}`
}

// cacheFilename(key) => filesystem-safe filename: sha256 hex of key + '.json'.
// Never derive a filename from a raw fileKey/nodeId (they can contain '/',
// ':', '..'); always go through a cacheKey() string first.
function cacheFilename(key) {
  if (typeof key !== 'string' || !key) {
    throw new Error('cacheFilename requires a non-empty string key')
  }
  return `${crypto.createHash('sha256').update(key, 'utf8').digest('hex')}.json`
}

// ── File identity ─────────────────────────────────────────

// sameFile(a, b) => boolean. Strict fileKey equality, case-sensitive.
// null/undefined never equal anything, including each other.
function sameFile(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  return a === b
}

module.exports = {
  parseSource,
  canonicalNodeId,
  urlNodeId,
  cacheKey,
  cacheFilename,
  sameFile,
}
