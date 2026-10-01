// Snapshot store behind the legacy single-design API: /design, /snapshots and
// the MCP snapshot tools.
//
// latest.json is the shared source of truth. The HTTP server and the MCP server
// can both write into one data directory, so a reader reloads the file whenever
// it has changed on disk instead of trusting what it loaded at startup.

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

// Windows refuses to replace a file that any process has open, even only to
// read it, and reports EPERM, EACCES or EBUSY.
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
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

function countNodes(nodes) {
  let count = 0
  for (const node of nodes || []) {
    count += 1
    if (node && node.children) count += countNodes(node.children)
  }
  return count
}

function createSnapshotStore({ dataDir, maxSnapshots = 50, log = () => {} } = {}) {
  if (typeof dataDir !== 'string' || !dataDir) {
    throw new Error('createSnapshotStore requires a dataDir')
  }

  const snapshotsDir = path.join(dataDir, 'snapshots')
  const latestPath = path.join(dataDir, 'latest.json')

  let current = null
  // Identity (file id, size, mtime) of the latest.json last read or written here.
  let seenStamp = null
  let restored = false

  function ensureDirs() {
    fs.mkdirSync(snapshotsDir, { recursive: true })
  }

  // Temp file plus rename: a reader in another process sees the old file or the
  // new one, never a half-written latest.json. When Windows keeps refusing the
  // rename because the file is open elsewhere, it is retried for about a second
  // (as graceful-fs does) and then written in place, which Windows allows.
  // Returns the stamp of the file now at filePath; the temp file never survives.
  function writeAtomic(filePath, text) {
    const temp = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
    try {
      fs.writeFileSync(temp, text)
      // A rename keeps the file id, size and mtime, so this is the target's stamp.
      const stamp = stampOf(temp)
      for (let attempt = 0, delay = 10; ; attempt++, delay = Math.min(delay * 2, 200)) {
        try {
          fs.renameSync(temp, filePath)
          return stamp
        } catch (error) {
          if (!RENAME_RETRY_CODES.has(error.code)) throw error
          if (attempt >= 8) break
          pause(delay)
        }
      }
      log('warn', `${path.basename(filePath)} is open in another process; writing it in place`)
      fs.writeFileSync(filePath, text)
      return stampOf(filePath)
    } finally {
      try { fs.unlinkSync(temp) } catch { /* renamed away, or never written */ }
    }
  }

  function refresh() {
    const stamp = stampOf(latestPath)
    if (stamp === null || stamp === seenStamp) return
    let text
    try {
      text = fs.readFileSync(latestPath, 'utf8')
    } catch (e) {
      // Another process may be replacing or scanning the file: try again on
      // the next read rather than skipping this version.
      log('debug', `latest.json is not readable yet: ${e.message}`)
      return
    }
    // A file that does not parse is reported once, not on every read; a later
    // rewrite of it changes the stamp and is picked up.
    seenStamp = stamp
    try {
      current = JSON.parse(text)
      log('info', `${restored ? 'Reloaded' : 'Restored'} latest snapshot: "${current.pageName}" (${current.nodeCount || 0} nodes)`)
      restored = true
    } catch (e) {
      log('warn', `Could not load latest snapshot: ${e.message}`)
    }
  }

  function getCurrent() {
    refresh()
    return current
  }

  function save(design) {
    ensureDirs()
    const savedAt = new Date().toISOString()
    const filepath = path.join(snapshotsDir, `${savedAt.replace(/:/g, '-')}.json`)
    const text = JSON.stringify({ ...design, savedAt }, null, 2)
    writeAtomic(filepath, text)
    // The stamp of what this save wrote, not of whatever is at the path a moment
    // later: another process's newer save must still be picked up.
    seenStamp = writeAtomic(latestPath, text)
    current = design
    restored = true
    prune()
    log('info', `Snapshot saved: ${path.basename(filepath)} (${design.nodeCount || 0} nodes)`)
    return filepath
  }

  // Forgets the design in memory. The files stay, and the latest.json that was
  // current is not reloaded again; a later save, from any process, is.
  function clear() {
    current = null
    seenStamp = stampOf(latestPath)
  }

  // Snapshot files are written once under a timestamped name and never edited,
  // so their metadata can be memoised on identity (name + size + mtime).
  const metaCache = new Map()

  function snapshotMeta(filepath, filename, stat) {
    const key = `${filename}:${stat.size}:${stat.mtimeMs}`
    const hit = metaCache.get(key)
    if (hit) return hit

    // The interesting fields (nodeCount, syncedAt, savedAt) are written after the
    // large `nodes` array, so the whole file has to be parsed to reach them.
    const parsed = JSON.parse(fs.readFileSync(filepath, 'utf8'))
    const meta = {
      pageName: parsed.pageName,
      nodeCount: typeof parsed.nodeCount === 'number'
        ? parsed.nodeCount
        : (Array.isArray(parsed.nodes) ? countNodes(parsed.nodes) : 0),
      syncedAt: parsed.syncedAt,
      savedAt: parsed.savedAt
    }
    metaCache.set(key, meta)
    return meta
  }

  function list() {
    try {
      ensureDirs()
      const files = fs.readdirSync(snapshotsDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .reverse()
      return files.map(f => {
        const p = path.join(snapshotsDir, f)
        const stat = fs.statSync(p)
        const info = { filename: f, size: stat.size }
        try {
          Object.assign(info, snapshotMeta(p, f, stat))
        } catch (e) {
          // A snapshot that cannot be read still belongs in the listing, but the
          // reason has to surface instead of silently becoming `undefined`.
          info.error = `metadata unavailable: ${e.message}`
          log('warn', `Could not read snapshot metadata for ${f}: ${e.message}`)
        }
        return info
      })
    } catch (e) {
      log('error', `Failed to list snapshots: ${e.message}`)
      return []
    }
  }

  function load(filename) {
    try {
      const filepath = path.join(snapshotsDir, path.basename(filename))
      if (!fs.existsSync(filepath)) return null
      return JSON.parse(fs.readFileSync(filepath, 'utf8'))
    } catch (e) {
      log('error', `Failed to load snapshot ${filename}: ${e.message}`)
      return null
    }
  }

  function prune() {
    try {
      ensureDirs()
      const files = fs.readdirSync(snapshotsDir)
        .filter(f => f.endsWith('.json'))
        .sort()
      while (files.length > maxSnapshots) {
        const oldest = files.shift()
        // Two processes can prune one directory; a file already gone is fine.
        try { fs.unlinkSync(path.join(snapshotsDir, oldest)) } catch {}
        log('debug', `Pruned old snapshot: ${oldest}`)
      }
    } catch (e) {
      log('warn', `Failed to prune snapshots: ${e.message}`)
    }
  }

  refresh()

  return { dataDir, snapshotsDir, latestPath, getCurrent, save, clear, list, load, prune }
}

module.exports = createSnapshotStore
module.exports.createSnapshotStore = createSnapshotStore
