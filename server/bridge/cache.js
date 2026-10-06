const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { cacheKey, cacheFilename, canonicalNodeId, sameFile } = require('./identity')

// Only filenames produced by identity.cacheFilename() are ever treated as
// entries. This is what keeps a hostile fileKey/nodeId from doing anything:
// no path is ever built from raw input, only from this fixed shape.
const ENTRY_FILENAME_RE = /^[0-9a-f]{64}\.json$/

const VALID_SOURCES = ['plugin', 'rest', 'legacy']

const DEFAULT_MAX_ENTRIES = 500
const DEFAULT_MAX_BYTES = 200_000_000

// An entry keeps its payload last, and the metadata in front of it is small
// (truncatedNodeIds, its longest part, comes capped at 500 ids), so this much
// of the head is enough to index one. An entry whose metadata runs longer is
// read whole.
const HEAD_BYTES = 64 * 1024

// Windows refuses to replace a file that any process has open, even only to
// read it, and reports EPERM, EACCES or EBUSY. Antivirus and indexers open a
// file right after it is written.
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

// Retried for about a second before the write is given up on.
function renameWithRetry(from, to) {
  for (let attempt = 0, delay = 10; ; attempt++, delay = Math.min(delay * 2, 200)) {
    try {
      fs.renameSync(from, to)
      return
    } catch (error) {
      if (!RENAME_RETRY_CODES.has(error.code) || attempt >= 8) throw error
      pause(delay)
    }
  }
}

// ── Stale marking (freshness helper) ────────────────────────

// markStale(entry) => shallow copy with verifiedFresh forced false and a
// stale flag set. Never mutates the entry passed in.
function markStale(entry) {
  if (!entry || typeof entry !== 'object') return entry
  return { ...entry, verifiedFresh: false, stale: true }
}

// ── Cache factory ────────────────────────────────────────────

function createCache({
  dataDir,
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxBytes = DEFAULT_MAX_BYTES,
  now = () => Date.now(),
} = {}) {
  if (typeof dataDir !== 'string' || !dataDir) {
    throw new Error('createCache requires a dataDir path')
  }
  // A limit that is not a positive number (NaN from a mistyped setting) would
  // switch eviction off without a word.
  if (!(maxEntries > 0) || !(maxBytes > 0)) {
    throw new Error(`createCache requires a positive maxEntries and maxBytes (got ${maxEntries} and ${maxBytes})`)
  }
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })

  // What eviction, invalidation and stats need to know about each entry, so
  // that none of them reads an entry back: filename -> { fileKey, fileName,
  // nodeId, size }, from the oldest entry to the newest. Entries this process
  // writes are added as it writes them. The ones an earlier owner of the
  // bridge left are indexed from disk once, on first use rather than at
  // startup.
  let index = null

  function entryPath(filename) {
    return path.join(dataDir, filename)
  }

  // Every write goes to a temp file in the same directory, then an atomic
  // rename onto the target. A crash between these two steps leaves either
  // nothing (readdir/get never see the temp file) or the old file untouched
  // — never a half-written entry at the final path. When the rename fails for
  // good, the temp file is removed rather than left behind. Returns the size
  // of the entry written.
  function writeEntryAtomic(filename, data) {
    const text = JSON.stringify(data)
    const tmpPath = path.join(dataDir, `.${filename}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`)
    try {
      fs.writeFileSync(tmpPath, text)
      renameWithRetry(tmpPath, entryPath(filename))
    } finally {
      try { fs.unlinkSync(tmpPath) } catch { /* renamed into place, or never written */ }
    }
    return Buffer.byteLength(text, 'utf8')
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

  // An entry's metadata, everything but its payload, from the head of the
  // file. Cutting the text before the payload and closing the object parses
  // only when the cut is at the top level, so a parse that succeeds is the
  // whole metadata. A head that does not (a corrupt file, unusually long
  // metadata) is read whole instead.
  function readEntryMeta(filename, buffer) {
    let head
    try {
      const fd = fs.openSync(entryPath(filename), 'r')
      try {
        head = buffer.toString('utf8', 0, fs.readSync(fd, buffer, 0, buffer.length, 0))
      } finally {
        fs.closeSync(fd)
      }
    } catch {
      return null
    }
    const cut = head.indexOf(',"payload":')
    if (cut !== -1) {
      try {
        const meta = JSON.parse(`${head.slice(0, cut)}}`)
        if (typeof meta.fileKey === 'string') return meta
      } catch { /* the cut fell inside a nested value */ }
    }
    const entry = readEntryFile(filename)
    if (!entry) return null
    const { payload, ...meta } = entry
    return meta
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

  function indexRecord({ fileKey, fileName, nodeId }, size) {
    return {
      fileKey: typeof fileKey === 'string' ? fileKey : null,
      fileName: fileName ?? null,
      nodeId: nodeId ?? null,
      size,
    }
  }

  function loadIndex() {
    if (index) return index
    const found = []
    const buffer = Buffer.allocUnsafe(HEAD_BYTES)
    for (const filename of listEntryFilenames()) {
      let stat
      try {
        stat = fs.statSync(entryPath(filename))
      } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      // One that cannot be read still takes space: indexed under no file, it
      // ages out with the others.
      const meta = readEntryMeta(filename, buffer) || {}
      found.push({ filename, mtimeMs: stat.mtimeMs, record: indexRecord(meta, stat.size) })
    }
    found.sort((a, b) => a.mtimeMs - b.mtimeMs)
    index = new Map(found.map(({ filename, record }) => [filename, record]))
    return index
  }

  // Deletes an entry's file and drops it from the index. A file already gone
  // (deleted by hand) is only dropped. One that cannot be deleted yet (held
  // open by a scanner) stays indexed, so the next eviction or invalidation
  // tries it again. Returns whether this call deleted the file.
  function removeEntry(filename) {
    try {
      fs.unlinkSync(entryPath(filename))
    } catch (error) {
      if (error.code === 'ENOENT') index.delete(filename)
      return false
    }
    index.delete(filename)
    return true
  }

  function fetchedAtMs(entry) {
    const ms = Date.parse(entry && entry.fetchedAt)
    return Number.isFinite(ms) ? ms : 0
  }

  // Bounded retention, global rather than per file: the oldest entries go
  // first until both the entry count and the byte budget hold. The entry just
  // written always stays, even when it alone is over the budget.
  function enforceLimits(keep) {
    let bytes = 0
    for (const { size } of index.values()) bytes += size
    for (const [filename, { size }] of index) {
      if (index.size <= maxEntries && bytes <= maxBytes) return
      if (filename === keep) continue
      removeEntry(filename)
      if (!index.has(filename)) bytes -= size
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

    const filename = cacheFilename(key)
    // Indexed before the write, so this entry is never read back to index it.
    loadIndex()
    const size = writeEntryAtomic(filename, entry)
    // Added at the end even when it replaces an entry, so it counts as newest.
    index.delete(filename)
    index.set(filename, indexRecord(entry, size))
    enforceLimits(filename)
    return entry
  }

  function invalidateFile(fileKey, _reason) {
    let removed = 0
    for (const [filename, record] of loadIndex()) {
      if (sameFile(record.fileKey, fileKey) && removeEntry(filename)) removed++
    }
    return removed
  }

  function invalidateNode({ fileKey, nodeId } = {}, _reason) {
    const canonicalNode = nodeId === null || nodeId === undefined ? null : canonicalNodeId(nodeId)
    let removed = 0
    for (const [filename, record] of loadIndex()) {
      if (sameFile(record.fileKey, fileKey) && record.nodeId === canonicalNode && removeEntry(filename)) removed++
    }
    return removed
  }

  function list({ fileKey } = {}) {
    const buffer = Buffer.allocUnsafe(HEAD_BYTES)
    const entries = []
    for (const filename of listEntryFilenames()) {
      const meta = readEntryMeta(filename, buffer)
      if (meta && (!fileKey || sameFile(meta.fileKey, fileKey))) entries.push(meta)
    }
    entries.sort((a, b) => fetchedAtMs(b) - fetchedAtMs(a))
    return entries
  }

  function stats() {
    const entries = loadIndex()
    const byFile = new Map()
    let byteSize = 0
    for (const { fileKey, fileName, size } of entries.values()) {
      byteSize += size
      // An entry that could not be read names no file, though its bytes count.
      if (fileKey === null) continue
      if (!byFile.has(fileKey)) byFile.set(fileKey, { fileKey, fileName: null, entryCount: 0 })
      const file = byFile.get(fileKey)
      file.entryCount += 1
      // The index runs oldest first, so the name a file had last wins.
      if (fileName !== null) file.fileName = fileName
    }
    return { entryCount: entries.size, byteSize, files: Array.from(byFile.values()) }
  }

  function clear() {
    for (const filename of listEntryFilenames()) {
      try { fs.unlinkSync(entryPath(filename)) } catch { /* already gone */ }
    }
    // Indexed again on next use, from whatever a file held open left behind.
    index = null
  }

  return { get, put, invalidateFile, invalidateNode, list, stats, clear }
}

module.exports = createCache
module.exports.markStale = markStale
module.exports.ENTRY_FILENAME_RE = ENTRY_FILENAME_RE
module.exports.DEFAULT_MAX_BYTES = DEFAULT_MAX_BYTES
