const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { cacheKey, cacheFilename, canonicalNodeId, sameFile } = require('./identity')

// Only filenames produced by identity.cacheFilename() are ever treated as
// entries. This is what keeps a hostile fileKey/nodeId from doing anything:
// no path is ever built from raw input, only from this fixed shape.
const ENTRY_FILENAME_RE = /^[0-9a-f]{64}\.json$/

const VALID_SOURCES = ['plugin', 'rest', 'legacy']

// ── Stale marking (freshness helper) ────────────────────────

// markStale(entry) => shallow copy with verifiedFresh forced false and a
// stale flag set. Never mutates the entry passed in.
function markStale(entry) {
  if (!entry || typeof entry !== 'object') return entry
  return { ...entry, verifiedFresh: false, stale: true }
}

// ── Cache factory ────────────────────────────────────────────

function createCache({ dataDir, maxEntries = 500, now = () => Date.now() } = {}) {
  if (typeof dataDir !== 'string' || !dataDir) {
    throw new Error('createCache requires a dataDir path')
  }
  fs.mkdirSync(dataDir, { recursive: true })

  function entryPath(filename) {
    return path.join(dataDir, filename)
  }

  // Every write goes to a temp file in the same directory, then an atomic
  // rename onto the target. A crash between these two steps leaves either
  // nothing (readdir/get never see the temp file) or the old file untouched
  // — never a half-written entry at the final path.
  function writeEntryAtomic(filename, data) {
    const finalPath = entryPath(filename)
    const tmpPath = path.join(dataDir, `.${filename}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`)
    fs.writeFileSync(tmpPath, JSON.stringify(data))
    fs.renameSync(tmpPath, finalPath)
  }

  function readEntryFile(filename) {
    let raw
    try {
      raw = fs.readFileSync(entryPath(filename), 'utf8')
    } catch {
      return null
    }
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return null
      return parsed
    } catch {
      // Corrupt/unparseable entry file: treat as missing, never throw.
      return null
    }
  }

  function listEntryFilenames() {
    let names
    try {
      names = fs.readdirSync(dataDir)
    } catch {
      return []
    }
    return names.filter(name => ENTRY_FILENAME_RE.test(name))
  }

  function readAllEntries() {
    const entries = []
    for (const filename of listEntryFilenames()) {
      const entry = readEntryFile(filename)
      if (entry) entries.push({ filename, entry })
    }
    return entries
  }

  function fetchedAtMs(entry) {
    const ms = Date.parse(entry && entry.fetchedAt)
    return Number.isFinite(ms) ? ms : 0
  }

  // Bounded retention: oldest-first eviction by fetchedAt, globally (not
  // per-file). Runs after every put so the directory never grows past
  // maxEntries entries.
  function enforceMaxEntries() {
    const all = readAllEntries()
    if (all.length <= maxEntries) return
    all.sort((a, b) => fetchedAtMs(a.entry) - fetchedAtMs(b.entry))
    const overflow = all.length - maxEntries
    for (const { filename } of all.slice(0, overflow)) {
      try { fs.unlinkSync(entryPath(filename)) } catch { /* already gone */ }
    }
  }

  function get({ fileKey, nodeId, representation } = {}) {
    const key = cacheKey({ fileKey, nodeId, representation })
    const filename = cacheFilename(key)
    const entry = readEntryFile(filename)
    if (!entry) return null
    const ageMs = now() - fetchedAtMs(entry)
    return { ...entry, ageMs: Number.isFinite(ageMs) ? ageMs : null }
  }

  function put(entryInput = {}) {
    const {
      fileKey,
      fileName = null,
      nodeId = null,
      pageId = null,
      pageName = null,
      representation = {},
      source = 'legacy',
      fetchedAt = new Date(now()).toISOString(),
      sessionId = null,
      pluginInstanceId = null,
      verifiedFresh = false,
      truncated = false,
      completeness = {},
      payload = null,
    } = entryInput

    if (typeof fileKey !== 'string' || !fileKey) {
      throw new Error('put requires a non-empty fileKey')
    }
    if (!VALID_SOURCES.includes(source)) {
      throw new Error(`put requires source to be one of ${VALID_SOURCES.join(', ')} (got ${JSON.stringify(source)})`)
    }
    // verifiedFresh may only be set by a live plugin reply. Everything else
    // (rest/legacy, or a plugin entry with no session) must go in as false —
    // freshness is never assumed, only positively asserted at write time.
    if (verifiedFresh && !(source === 'plugin' && sessionId)) {
      throw new Error('verifiedFresh: true requires source "plugin" and a sessionId')
    }

    const canonicalNode = nodeId === null || nodeId === undefined ? null : canonicalNodeId(nodeId)
    const key = cacheKey({ fileKey, nodeId: canonicalNode, representation })
    const payloadBytes = payload !== undefined && payload !== null
      ? Buffer.byteLength(JSON.stringify(payload), 'utf8')
      : 0

    const entry = {
      key,
      fileKey,
      fileName,
      nodeId: canonicalNode,
      pageId,
      pageName,
      representation,
      source,
      fetchedAt,
      sessionId,
      pluginInstanceId,
      verifiedFresh: Boolean(verifiedFresh),
      truncated: Boolean(truncated),
      completeness: {
        nodeCount: completeness.nodeCount ?? null,
        byteSize: completeness.byteSize ?? payloadBytes,
        limitHit: completeness.limitHit ?? null,
        truncatedNodeIds: completeness.truncatedNodeIds ?? [],
      },
      payload,
    }

    writeEntryAtomic(cacheFilename(key), entry)
    enforceMaxEntries()
    return entry
  }

  function invalidateFile(fileKey, _reason) {
    let removed = 0
    for (const { filename, entry } of readAllEntries()) {
      if (sameFile(entry.fileKey, fileKey)) {
        try { fs.unlinkSync(entryPath(filename)); removed++ } catch { /* already gone */ }
      }
    }
    return removed
  }

  function invalidateNode({ fileKey, nodeId } = {}, _reason) {
    const canonicalNode = nodeId === null || nodeId === undefined ? null : canonicalNodeId(nodeId)
    let removed = 0
    for (const { filename, entry } of readAllEntries()) {
      const entryNode = entry.nodeId === undefined ? null : entry.nodeId
      if (sameFile(entry.fileKey, fileKey) && entryNode === canonicalNode) {
        try { fs.unlinkSync(entryPath(filename)); removed++ } catch { /* already gone */ }
      }
    }
    return removed
  }

  function list({ fileKey } = {}) {
    const entries = readAllEntries()
      .map(({ entry }) => entry)
      .filter(entry => !fileKey || sameFile(entry.fileKey, fileKey))
      .map(({ payload, ...metadata }) => metadata)
    entries.sort((a, b) => fetchedAtMs(b) - fetchedAtMs(a))
    return entries
  }

  function stats() {
    const byFile = new Map()
    let byteSize = 0
    let entryCount = 0
    for (const { filename, entry } of readAllEntries()) {
      entryCount += 1
      try { byteSize += fs.statSync(entryPath(filename)).size } catch { /* races with unlink are fine to skip */ }
      const fileKey = entry.fileKey
      if (!byFile.has(fileKey)) byFile.set(fileKey, { fileKey, fileName: entry.fileName ?? null, entryCount: 0 })
      byFile.get(fileKey).entryCount += 1
    }
    return { entryCount, byteSize, files: Array.from(byFile.values()) }
  }

  function clear() {
    for (const filename of listEntryFilenames()) {
      try { fs.unlinkSync(entryPath(filename)) } catch { /* already gone */ }
    }
  }

  return { get, put, invalidateFile, invalidateNode, list, stats, clear }
}

module.exports = createCache
module.exports.markStale = markStale
