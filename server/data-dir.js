// Resolves the data directory the way the server does, without creating or
// rewriting config.json, and carries over what an earlier version left
// elsewhere (prepareDataDir).
//
// Several small clients need to find the same directory the running server uses:
// the token printer, the CLI importer. They must not mint a config file as a
// side effect of being run, which is why this is separate from the server's own
// loadConfig().
//
// By default every launcher — Claude Code in any profile, Codex, `npm start` and
// these clients — uses one directory per user of the machine. They then share
// one bridge token, so the Figma plugin pairs once, whichever of them holds the
// port.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { ENTRY_FILENAME_RE } = require('./bridge/cache')

const APP_NAME = 'figma-design-bridge'
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'config.json')
// Where versions before 1.3.0 kept their data, next to the code. `npm start`
// also wrote this path into config.json as its default.
const LEGACY_DATA_DIR = path.join(__dirname, 'data')
const TOKEN_FILENAME = 'bridge-token.json'
const SNAPSHOT_FILENAME = 'latest.json'
const SNAPSHOTS_DIRNAME = 'snapshots'
// The current design carries over whole, but only the newest snapshots of the
// history, and none of the cache, which refills from live reads: the copy runs
// before an MCP server answers its client, and some clients give up after ten
// seconds.
const MIGRATED_SNAPSHOTS = 10
// Antivirus and indexers briefly hold a file that was just written, and Windows
// then refuses to rename it, with EPERM, EACCES or EBUSY.
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const STALE_TEMP_MS = 60_000

// The platform's per-user application data directory. On macOS and Linux it is
// derived from the home directory alone: MCP hosts such as Codex pass a server
// only a short list of variables, without XDG_DATA_HOME, and every launcher has
// to arrive at the same path. LOCALAPPDATA is on those lists.
function userDataDir({ env = process.env, platform = process.platform, homedir = os.homedir() } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA && paths.isAbsolute(env.LOCALAPPDATA)
      ? env.LOCALAPPDATA
      : paths.join(homedir, 'AppData', 'Local')
    return paths.join(local, APP_NAME)
  }
  if (platform === 'darwin') return paths.join(homedir, 'Library', 'Application Support', APP_NAME)
  return paths.join(homedir, '.local', 'share', APP_NAME)
}

function samePath(a, b) {
  const left = path.resolve(a)
  const right = path.resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function configuredDataDir(configPath) {
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      if (config.dataDir) return config.dataDir
    }
  } catch {
    // Fall through to the default: a malformed config should not stop the
    // operator from reading their own token.
  }
  return null
}

// Where the directory comes from: FIGMA_BRIDGE_DATA_DIR, config.json, or the
// shared default. Up to 1.2, launchers were pointed at the legacy directory to
// make them share it — Codex through FIGMA_BRIDGE_DATA_DIR, as its setup guide
// said, and `npm start` through the dataDir it wrote into config.json. Either
// value now means "share the default", so it counts as unset, and the legacy
// directory becomes one to migrate from instead.
function describeDataDir(options = {}) {
  const env = options.env || process.env
  const configPath = options.configPath || DEFAULT_CONFIG_PATH
  const legacyDataDir = options.legacyDataDir || LEGACY_DATA_DIR
  // The Claude Code plugin names the directory it used before.
  const migrateFrom = (env.FIGMA_BRIDGE_MIGRATE_FROM || '').split(path.delimiter).filter(Boolean)
  migrateFrom.push(legacyDataDir)

  const fromEnv = env.FIGMA_BRIDGE_DATA_DIR
  if (fromEnv && !samePath(fromEnv, legacyDataDir)) return { dataDir: fromEnv, source: 'env', migrateFrom: [] }

  const raw = configuredDataDir(configPath)
  if (raw) {
    // A relative dataDir has always been relative to the working directory. It
    // names the legacy directory if it does from there or from the config file.
    const configured = path.resolve(raw)
    const nextToConfig = path.resolve(path.dirname(configPath), raw)
    if (!samePath(configured, legacyDataDir) && !samePath(nextToConfig, legacyDataDir)) {
      return { dataDir: configured, source: 'config', migrateFrom: [] }
    }
    migrateFrom.push(configured)
  }

  let dataDir = options.defaultDataDir
  if (!dataDir) {
    try {
      dataDir = userDataDir({ env, platform: options.platform, homedir: options.homedir })
    } catch {
      // No home directory to derive it from, as in some containers: keep the
      // directory earlier versions used rather than refuse to start.
      dataDir = legacyDataDir
    }
  }
  return { dataDir, source: 'default', migrateFrom }
}

function resolveDataDir(options = {}) {
  return describeDataDir(options).dataDir
}

function hasFile(dir, name) {
  try {
    return fs.statSync(path.join(dir, name)).isFile()
  } catch {
    return false
  }
}

function isDirectory(dir) {
  try {
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

function pause(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

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

function removeQuietly(file) {
  try { fs.rmSync(file, { force: true }) } catch {}
}

// The token must not change under a launcher that may already have read it. A
// hard link fails when the target exists, where a rename would replace it; file
// systems without hard links fall back to checking first.
function placeExclusive(temp, target) {
  try {
    fs.linkSync(temp, target)
    return true
  } catch (error) {
    if (error.code === 'EEXIST' || fs.existsSync(target)) return false
    renameWithRetry(temp, target)
    return true
  }
}

// The copy lands under a temporary name first, so an interrupted copy never
// leaves a truncated file under the real name. Two launchers migrating at once
// copy the same bytes, so whichever rename lands last changes nothing. Returns
// whether this call placed the file.
function copyFileIfMissing(source, target, { exclusive = false } = {}) {
  if (fs.existsSync(target)) return false
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.migrate.tmp`)
  try {
    fs.copyFileSync(source, temp)
    if (exclusive) return placeExclusive(temp, target)
    try {
      renameWithRetry(temp, target)
    } catch (error) {
      if (fs.existsSync(target)) return false
      throw error
    }
    return true
  } finally {
    removeQuietly(temp)
  }
}

// Copies files only: links are not followed, and temporary files of an
// interrupted write are skipped. A file that cannot be copied is recorded and
// skipped, so one locked or vanished snapshot cannot cost the pairing token.
function copyMissing(from, to, result, { skip = () => false, newest = Infinity } = {}) {
  let entries
  try {
    fs.mkdirSync(to, { recursive: true, mode: 0o700 })
    entries = fs.readdirSync(from, { withFileTypes: true })
  } catch (error) {
    result.failed.push(`${from} (${error.code || error.message})`)
    return
  }
  if (newest !== Infinity) {
    entries = entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .sort((a, b) => (a.name < b.name ? 1 : -1))
      .slice(0, newest)
  }
  for (const entry of entries) {
    if (skip(entry.name)) continue
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) {
      copyMissing(source, target, result, entry.name === SNAPSHOTS_DIRNAME ? { newest: MIGRATED_SNAPSHOTS } : {})
    } else if (entry.isFile() && !entry.name.endsWith('.tmp')) {
      try {
        if (copyFileIfMissing(source, target)) result.copied += 1
      } catch (error) {
        // Gone since the listing (a running older bridge pruned it): nothing to copy.
        if (error.code !== 'ENOENT') result.failed.push(`${entry.name} (${error.code || error.message})`)
      }
    }
  }
}

// A migration cut short by a crash leaves its temporary files behind.
function removeStaleTemps(dataDir, now = Date.now()) {
  for (const dir of [dataDir, path.join(dataDir, SNAPSHOTS_DIRNAME)]) {
    let names = []
    try { names = fs.readdirSync(dir) } catch { continue }
    for (const name of names) {
      if (!name.endsWith('.migrate.tmp')) continue
      const file = path.join(dir, name)
      try {
        if (now - fs.statSync(file).mtimeMs > STALE_TEMP_MS) fs.rmSync(file, { force: true })
      } catch {}
    }
  }
}

// Copies what an earlier version kept elsewhere into a shared directory that
// has no token yet, so the plugin's pairing, the current design and the newest
// snapshots carry over. The cache stays behind: it refills from live reads, and
// copying it could hold up the start for seconds. Nothing already in the shared
// directory is replaced, and the source is left as it is for launchers still on
// an older version. The token is copied last, so a migration cut short runs
// again on the next start; a file that fails to copy is skipped and named.
function migrateDataDir(dataDir, candidates, log = () => {}) {
  if (hasFile(dataDir, TOKEN_FILENAME)) return null
  const sources = candidates.filter(dir => dir && !samePath(dir, dataDir) && isDirectory(dir))
  const source = sources.find(dir => hasFile(dir, TOKEN_FILENAME))
    || sources.find(dir => hasFile(dir, SNAPSHOT_FILENAME))
  if (!source) return null

  removeStaleTemps(dataDir)
  const result = { copied: 0, failed: [] }
  copyMissing(source, dataDir, result, { skip: name => name === TOKEN_FILENAME || ENTRY_FILENAME_RE.test(name) })

  let withToken = false
  if (hasFile(source, TOKEN_FILENAME)) {
    const target = path.join(dataDir, TOKEN_FILENAME)
    try {
      withToken = copyFileIfMissing(path.join(source, TOKEN_FILENAME), target, { exclusive: true })
      if (withToken) {
        try { fs.chmodSync(target, 0o600) } catch {}
      }
    } catch (error) {
      log(`Could not copy the pairing token from ${source} to ${dataDir} (${error.code || error.message}). `
        + 'A new one will be created: pair the Figma plugin again when it asks.')
    }
  }
  if (result.copied || withToken) {
    log(`Copied ${result.copied} file(s)${withToken ? ' and the pairing token' : ''} from ${source} to ${dataDir}, `
      + 'the data directory every launcher shares from 1.3.0 on. This version no longer reads the old one.')
  }
  if (result.failed.length) {
    const named = result.failed.slice(0, 5).join(', ') + (result.failed.length > 5 ? ', ...' : '')
    log(`Skipped ${result.failed.length} file(s) that could not be copied from ${source}: ${named}.`)
  }
  return source
}

// Resolves the directory and, when it is the shared default and has no token
// yet, copies in what an earlier version left elsewhere. Every entry point that
// reads or writes the token goes through here, so they all agree on it.
function prepareDataDir(options = {}) {
  const described = describeDataDir(options)
  const migratedFrom = described.source === 'default'
    ? migrateDataDir(described.dataDir, described.migrateFrom, options.log)
    : null
  return { ...described, migratedFrom }
}

module.exports = {
  resolveDataDir,
  describeDataDir,
  prepareDataDir,
  migrateDataDir,
  userDataDir,
  DEFAULT_CONFIG_PATH,
  LEGACY_DATA_DIR,
}
