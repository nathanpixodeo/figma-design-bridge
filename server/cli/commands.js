// The figma-bridge commands that are not one of the server scripts: setup,
// status, approvals and update.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { describeDataDir, prepareDataDir, readConfig, writeConfig, samePath } = require('../data-dir')
const { getOrCreateToken, readToken } = require('../bridge/token')
const { probe } = require('../bridge/daemon')
const { createClient } = require('../bridge/client')
const { APPROVAL_MODES, approvalsMode } = require('../tool-policy')
const { CLIENTS, SetupError } = require('./clients')
const { which, run, failure } = require('./run')

const PKG_DIR = path.resolve(__dirname, '..', '..')
const { name: PACKAGE_NAME, version: VERSION } = require('../../package.json')

class UsageError extends Error {}

const MODE_TEXT = {
  auto: 'design reads run without asking; pairing and REST sync still ask',
  manual: 'every bridge tool asks before it runs',
}

function context(options = {}) {
  return {
    env: options.env || process.env,
    homedir: options.homedir,
    tmpdir: options.tmpdir || os.tmpdir(),
    pkgDir: options.pkgDir || PKG_DIR,
    out: options.out || (line => process.stdout.write(`${line}\n`)),
  }
}

// config.json in the data directory, with a file it cannot parse reported as a
// setup failure rather than a crash.
function saveConfig(changes, dataDir) {
  try {
    return writeConfig(changes, { dataDir })
  } catch (error) {
    throw new SetupError(error.message)
  }
}

function parseSetupArgs(args) {
  const options = { only: null, approvals: null, installed: false }
  for (let index = 0; index < args.length; index++) {
    const [flag, inline] = args[index].split(/=(.*)/s)
    if (flag === '--only') {
      const value = inline !== undefined ? inline : args[++index]
      options.only = String(value || '').split(',').map(item => item.trim()).filter(Boolean)
      const unknown = options.only.filter(key => !CLIENTS.some(client => client.key === key))
      if (!options.only.length || unknown.length) {
        throw new UsageError(`--only takes a comma-separated list of ${CLIENTS.map(c => c.key).join(', ')}`)
      }
    } else if (flag === '--approvals') {
      options.approvals = inline !== undefined ? inline : args[++index]
      if (!APPROVAL_MODES.includes(options.approvals)) throw new UsageError('--approvals takes auto or manual')
    } else if (flag === '--installed') {
      options.installed = true
    } else {
      throw new UsageError(`Unknown option for setup: ${args[index]}`)
    }
  }
  return options
}

// The canonical path, through symbolic links and short names, of a file that
// may not exist yet: its nearest existing folder is resolved instead.
function realPath(file) {
  const rest = []
  let dir = path.resolve(file)
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(dir), ...rest)
    } catch {}
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(file)
    rest.unshift(path.basename(dir))
    dir = parent
  }
}

// npx, pnpm dlx and bunx run a package from a cache or temporary folder that
// may be cleared at any time, so the paths setup writes into each client must
// point at a global install instead.
function isTemporaryCopy(pkgDir, tmpdir = os.tmpdir()) {
  const segments = pkgDir.split(/[\\/]/)
  if (segments.includes('_npx') || segments.includes('dlx')) return true
  const relative = path.relative(realPath(tmpdir), realPath(pkgDir))
  return relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative)
}

function globalPackageDir(ctx) {
  const result = run('npm', ['root', '--global'], ctx)
  if (result.status !== 0) return null
  return path.join(result.stdout.trim(), ...PACKAGE_NAME.split('/'))
}

// Installs a version globally, then hands over to that copy's setup.
function installAndSetup(spec, args, ctx) {
  ctx.out(`Installing ${spec} globally...`)
  const installed = run('npm', ['install', '--global', spec], { ...ctx, inherit: true })
  if (installed.status !== 0) {
    // Windows will not replace a file a running process holds open, and a
    // client session keeps the bridge's files open while it runs.
    const hint = process.platform === 'win32' ? '; if npm reported EPERM or EBUSY, close Claude Code, Codex, agy and Gemini CLI, then try again' : ''
    throw new SetupError(`npm install --global ${spec} failed: ${failure(installed)}${hint}`)
  }
  const pkgDir = globalPackageDir(ctx)
  const bin = pkgDir && path.join(pkgDir, 'bin', 'figma-bridge.js')
  if (!bin || !fs.existsSync(bin)) throw new SetupError(`Could not find the global install of ${PACKAGE_NAME}`)
  const result = spawnSync(process.execPath, [bin, 'setup', '--installed', ...args], { stdio: 'inherit', env: ctx.env })
  return result.status === null ? 1 : result.status
}

function figmaSteps(ctx) {
  return [
    '',
    'Next, in Figma desktop (once per machine):',
    '  1. Plugins > Development > Import plugin from manifest..., and pick',
    `     ${path.join(ctx.pkgDir, 'plugin', 'manifest.json')}`,
    '  2. In the file you want to read, run Design Bridge and press Pair with bridge.',
    '  3. Approve the code it shows: figma-bridge pair <code>',
    '     (or /figma-bridge:pair <code> in Claude Code).',
    'The bridge runs while Claude Code, Codex, agy or Gemini CLI is open, or with figma-bridge start.',
    'Check everything with: figma-bridge status',
  ]
}

async function setup(args, options) {
  const ctx = context(options)
  const parsed = parseSetupArgs(args)
  if (!parsed.installed && isTemporaryCopy(ctx.pkgDir, ctx.tmpdir)) return installAndSetup(`${PACKAGE_NAME}@${VERSION}`, args, ctx)

  ctx.out(`Figma Design Bridge ${VERSION} (${ctx.pkgDir})`)
  const { dataDir } = prepareDataDir({ env: ctx.env, log: message => ctx.out(`  ${message}`) })
  const { created } = getOrCreateToken(dataDir)
  const config = readConfig({ env: ctx.env, dataDir })
  const mode = parsed.approvals || approvalsMode(config)
  if (parsed.approvals || config.approvals === undefined) saveConfig({ approvals: mode }, dataDir)
  ctx.out(`  Data directory: ${dataDir}${created ? ' (created a new pairing token)' : ''}`)
  ctx.out(`  Approvals: ${mode}, ${MODE_TEXT[mode]}`)

  let failed = 0
  for (const client of CLIENTS) {
    if (parsed.only && !parsed.only.includes(client.key)) continue
    if (!which(client.command, ctx.env)) {
      ctx.out(`  ${client.label}: \`${client.command}\` is not on PATH, skipped`)
      continue
    }
    try {
      const done = [...client.setup(ctx), ...client.applyApprovals(mode, ctx)]
      ctx.out(`  ${client.label}:`)
      for (const line of done) ctx.out(`    - ${line}`)
    } catch (error) {
      failed += 1
      ctx.out(`  ${client.label}: FAILED, ${error.message}`)
    }
  }
  for (const line of figmaSteps(ctx)) ctx.out(line)
  return failed ? 1 : 0
}

async function getJson(url, timeoutMs) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    return response.ok ? await response.json() : null
  } catch {
    return null
  }
}

async function describeBridge(port, dataDir, token) {
  const url = `http://127.0.0.1:${port}`
  const probed = await probe(url, { timeoutMs: 2000 })
  if (!probed.ours) {
    if (probed.reason === 'no-listener') return ['not running (it starts with Claude Code, Codex, agy or Gemini CLI, or figma-bridge start)']
    if (probed.reason === 'timeout') return [`port ${port} accepted the connection but did not answer in time (busy with a large read?)`]
    if (probed.reason === 'handing-over') return [`handing port ${port} over to a newer figma-bridge server: check again in a moment`]
    return [`port ${port} is held by another program (${probed.reason})`]
  }
  const legacy = await getJson(`${url}/health`, 2000)
  const theirs = legacy && typeof legacy.dataDir === 'string' ? legacy.dataDir : null
  if (theirs && !samePath(theirs, dataDir)) {
    return [`running at ${url}, but on another data directory (${theirs}), so it does not take this token`]
  }
  const lines = [`running at ${url}`]
  if (!token) return lines
  try {
    const status = await createClient({ url, token, timeoutMs: 3000 }).status()
    const sessions = (status.sessions || []).filter(session => session.alive)
    lines.push(sessions.length
      ? `Figma plugin connected: ${sessions.map(s => s.fileName || s.fileKey).join(', ')}`
      : 'no Figma plugin connected: open Design Bridge in Figma')
    if (status.pairing && status.pairing.pending) lines.push(`${status.pairing.pending} plugin(s) waiting to pair: figma-bridge pair <code>`)
  } catch (error) {
    lines.push(`could not read its status (${error.code || error.message})`)
  }
  return lines
}

async function status(args, options) {
  const ctx = context(options)
  const described = describeDataDir({ env: ctx.env })
  const dataDir = described.dataDir
  const stored = readToken(dataDir)
  const config = readConfig({ env: ctx.env, dataDir })
  const mode = approvalsMode(config)
  const port = ctx.env.FIGMA_BRIDGE_PORT || config.port || 3456

  ctx.out(`Figma Design Bridge ${VERSION}`)
  ctx.out(`  Installed at:    ${ctx.pkgDir}`)
  ctx.out(`  Data directory:  ${dataDir} (${described.source})`)
  ctx.out(`  Pairing token:   ${stored ? 'present' : 'none yet (setup or the first bridge start creates it)'}`)
  ctx.out(`  Approvals:       ${mode}, ${MODE_TEXT[mode]}`)
  const bridge = await describeBridge(port, dataDir, stored && stored.token)
  ctx.out(`  Bridge:          ${bridge[0]}`)
  for (const line of bridge.slice(1)) ctx.out(`                   ${line}`)
  ctx.out(`  Figma manifest:  ${path.join(ctx.pkgDir, 'plugin', 'manifest.json')}`)
  for (const client of CLIENTS) {
    const label = `${client.label}:`.padEnd(17)
    if (!which(client.command, ctx.env)) {
      ctx.out(`  ${label}not installed`)
      continue
    }
    let text
    try { text = client.status(ctx) } catch (error) { text = `could not check (${error.message})` }
    ctx.out(`  ${label}${text}`)
  }
  return 0
}

// The Claude Code command /figma-bridge:approvals passes its argument quoted,
// so no argument arrives as one empty string.
async function approvals(rawArgs, options) {
  const ctx = context(options)
  const dataDir = describeDataDir({ env: ctx.env }).dataDir
  const args = rawArgs.map(arg => arg.trim()).filter(Boolean)
  if (!args.length) {
    const mode = approvalsMode(readConfig({ env: ctx.env, dataDir }))
    ctx.out(`Approvals: ${mode}, ${MODE_TEXT[mode]}`)
    ctx.out(`Change it with: figma-bridge approvals ${mode === 'auto' ? 'manual' : 'auto'}`)
    return 0
  }
  const mode = args[0].toLowerCase()
  if (args.length > 1 || !APPROVAL_MODES.includes(mode)) throw new UsageError('Usage: figma-bridge approvals [auto|manual]')
  saveConfig({ approvals: mode }, dataDir)
  ctx.out(`Approvals: ${mode}, ${MODE_TEXT[mode]}`)
  let failed = 0
  for (const client of CLIENTS) {
    if (!which(client.command, ctx.env)) continue
    try {
      for (const line of client.applyApprovals(mode, ctx)) ctx.out(`  ${client.label}: ${line}`)
      if (!client.installed(ctx)) ctx.out(`  ${client.label}: the bridge is not set up here: run \`figma-bridge setup --only ${client.key}\``)
    } catch (error) {
      failed += 1
      ctx.out(`  ${client.label}: FAILED, ${error.message}`)
    }
  }
  return failed ? 1 : 0
}

async function update(args, options) {
  const ctx = context(options)
  if (args.length) throw new UsageError('Usage: figma-bridge update')
  const globalDir = globalPackageDir(ctx)
  if (!globalDir || !samePath(globalDir, ctx.pkgDir)) {
    ctx.out(`This copy runs from ${ctx.pkgDir}, not from a global install.`)
    ctx.out(`Install the global one with: npm install --global ${PACKAGE_NAME}`)
    return 1
  }
  return installAndSetup(`${PACKAGE_NAME}@latest`, [], ctx)
}

module.exports = {
  setup,
  status,
  approvals,
  update,
  parseSetupArgs,
  isTemporaryCopy,
  UsageError,
  PKG_DIR,
  VERSION,
  PACKAGE_NAME,
}
