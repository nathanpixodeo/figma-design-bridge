// Sets up the AI clients that use the bridge: Claude Code and Codex install it
// as a plugin from this package's own marketplace, agy registers its MCP server.
// Each step is safe to repeat, so setup also serves as the update: it keeps
// what the user changed since, such as a plugin turned off or a server's env.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { run, failure, parseJson } = require('./run')
const { READ_TOOLS } = require('../tool-policy')
const { samePath } = require('../data-dir')

const PLUGIN = 'figma-bridge'
const MARKETPLACE = 'figma-design-bridge'
const PLUGIN_ID = `${PLUGIN}@${MARKETPLACE}`
// The server name the plugin manifest declares, and the one agy registers.
const PLUGIN_SERVER = 'bridge'
const AGY_SERVER = 'figma-bridge'
const SDK_MARKER = path.join('node_modules', '@modelcontextprotocol', 'sdk', 'package.json')
// The first version whose plugin carries the approvals hook.
const HOOK_VERSION = '1.4.0'

class SetupError extends Error {}

function must(result, what) {
  if (result.status !== 0) throw new SetupError(`${what} failed: ${failure(result)}`)
  return result
}

function homeOf(ctx) {
  return ctx.homedir || os.homedir()
}

function codexHome(ctx) {
  return ctx.env.CODEX_HOME || path.join(homeOf(ctx), '.codex')
}

function agySettingsPath(ctx) {
  return path.join(homeOf(ctx), '.gemini', 'antigravity-cli', 'settings.json')
}

function agyServersPath(ctx) {
  return path.join(homeOf(ctx), '.gemini', 'config', 'mcp_config.json')
}

function versionBelow(version, floor) {
  const a = String(version).split(/[.+-]/).map(Number)
  const b = floor.split('.').map(Number)
  for (let i = 0; i < b.length; i++) {
    if ((a[i] || 0) !== b[i]) return (a[i] || 0) < b[i]
  }
  return false
}

// Codex prints a local path in its extended form, \\?\C:\...
function plainPath(file) {
  return String(file).replace(/^\\\\\?\\/, '')
}

// A client copies the plugin into its own cache. Copied from a git marketplace
// it arrives without node_modules, and the MCP server cannot start; this
// package's copy of the dependencies fills that in.
function ensureDependencies(installDir, ctx) {
  if (!installDir || fs.existsSync(path.join(installDir, SDK_MARKER))) return null
  if (!fs.existsSync(path.join(installDir, 'server', 'mcp.mjs'))) return null
  if (!fs.existsSync(path.join(ctx.pkgDir, SDK_MARKER))) {
    throw new SetupError(`${installDir} has no node_modules, and neither has ${ctx.pkgDir} to copy them from`)
  }
  fs.cpSync(path.join(ctx.pkgDir, 'node_modules'), path.join(installDir, 'node_modules'), { recursive: true })
  return `copied the MCP server's dependencies into ${installDir}`
}

// Keeps a copy of a client's config file from before the first change setup
// made to it. Later changes leave that copy alone, so it still holds the file
// as the user had it.
function backup(file) {
  const copy = `${file}.figma-bridge.bak`
  if (fs.existsSync(file) && !fs.existsSync(copy)) fs.copyFileSync(file, copy)
}

function readText(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
}

function writeText(file, text) {
  backup(file)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

// Parses a client's JSON config, allowing a byte order mark. A file it cannot
// parse stops the step with the file named, rather than being replaced.
function parseJsonFile(file, text) {
  if (!text.trim()) return {}
  try {
    const value = JSON.parse(text.replace(/^\uFEFF/, ''))
    if (value && typeof value === 'object' && !Array.isArray(value)) return value
    throw new Error('it does not hold a JSON object')
  } catch (error) {
    throw new SetupError(`cannot read ${file} (${error.message}); fix it by hand, then run the command again`)
  }
}

// JSON in the file's own line endings.
function formatJson(value, before) {
  const newline = before.includes('\r\n') ? '\r\n' : '\n'
  return JSON.stringify(value, null, 2).replace(/\n/g, newline) + newline
}

// A marketplace kept in a folder that no longer exists, such as a deleted
// clone or a Node.js version that was removed, cannot be refreshed.
function goneLocalSource(folder) {
  return Boolean(folder) && !fs.existsSync(plainPath(folder))
}

// ── Claude Code ───────────────────────────────────────────

const claude = {
  key: 'claude',
  label: 'Claude Code',
  command: 'claude',

  installed(ctx) {
    const plugins = parseJson(must(run('claude', ['plugin', 'list', '--json'], ctx), 'Listing plugins').stdout)
    return Array.isArray(plugins) ? plugins.find(p => p.id === PLUGIN_ID && p.scope === 'user') || null : null
  },

  marketplace(ctx) {
    const markets = parseJson(must(run('claude', ['plugin', 'marketplace', 'list', '--json'], ctx), 'Listing marketplaces').stdout)
    return Array.isArray(markets) ? markets.find(m => m.name === MARKETPLACE) || null : null
  },

  setup(ctx) {
    const done = []
    let market = this.marketplace(ctx)
    if (market && market.source === 'directory' && goneLocalSource(market.path)) {
      must(run('claude', ['plugin', 'marketplace', 'remove', MARKETPLACE], ctx), 'Removing the marketplace')
      done.push(`removed the ${MARKETPLACE} marketplace, whose folder ${market.path} no longer exists`)
      market = null
    }
    if (!market) {
      must(run('claude', ['plugin', 'marketplace', 'add', ctx.pkgDir], ctx), 'Adding the marketplace')
      done.push(`added the ${MARKETPLACE} marketplace from ${ctx.pkgDir}`)
    } else {
      must(run('claude', ['plugin', 'marketplace', 'update', MARKETPLACE], ctx), 'Refreshing the marketplace')
      done.push(`refreshed the ${MARKETPLACE} marketplace (${market.repo || market.path || market.source})`)
      if (market.source === 'directory' && !samePath(market.path, ctx.pkgDir)) {
        done.push(`note: it reads ${market.path}, not this install; to use this one, run \`claude plugin marketplace remove ${MARKETPLACE}\`, then setup again`)
      }
    }
    const before = this.installed(ctx)
    must(run('claude', ['plugin', before ? 'update' : 'install', PLUGIN_ID], ctx), before ? 'Updating the plugin' : 'Installing the plugin')
    const after = this.installed(ctx)
    if (!after) throw new SetupError(`${PLUGIN_ID} is not listed after installing it`)
    done.push(before ? `updated ${PLUGIN_ID} to ${after.version}` : `installed ${PLUGIN_ID} ${after.version}`)
    if (after.enabled === false) done.push(`it is turned off; turn it on with \`claude plugin enable ${PLUGIN_ID}\``)
    const old = this.hookWarning(after)
    if (old) done.push(old)
    const copied = ensureDependencies(after.installPath, ctx)
    if (copied) done.push(copied)
    if (ctx.env.CLAUDE_CONFIG_DIR) done.push(`profile ${ctx.env.CLAUDE_CONFIG_DIR}: run setup again with each other CLAUDE_CONFIG_DIR you use`)
    done.push('restart running Claude Code sessions to load it')
    return done
  },

  status(ctx) {
    const plugin = this.installed(ctx)
    return plugin ? `plugin ${plugin.version}${plugin.enabled === false ? ' (turned off)' : ''}` : 'not set up'
  },

  // A plugin from a marketplace that has not caught up, such as a fork.
  hookWarning(plugin) {
    return versionBelow(plugin.version, HOOK_VERSION)
      ? `plugin ${plugin.version} predates the approvals hook (${HOOK_VERSION}); run \`figma-bridge update\``
      : null
  },

  // Reads go through the plugin's PreToolUse hook, which follows config.json at
  // every call, so there is nothing to write. setup reports an old plugin itself.
  applyApprovals(mode, ctx) {
    const plugin = this.installed(ctx)
    if (!plugin) return ['plugin not set up: run `figma-bridge setup --only claude`']
    const old = this.hookWarning(plugin)
    return old ? [old] : []
  },
}

// ── Codex ─────────────────────────────────────────────────

// Reads a dotted key such as a."b c".d starting at line[i]. Quoting and spaces
// around the dots do not matter. Returns the keys and the index after them and
// any following space, or null when no key starts there.
function readKeys(line, i) {
  const keys = []
  const skipSpace = () => { while (line[i] === ' ' || line[i] === '\t') i += 1 }
  for (;;) {
    skipSpace()
    if (line[i] === '"' || line[i] === "'") {
      const end = line.indexOf(line[i], i + 1)
      if (end === -1) return null
      keys.push(line.slice(i + 1, end))
      i = end + 1
    } else {
      const bare = /^[A-Za-z0-9_-]+/.exec(line.slice(i))
      if (!bare) return null
      keys.push(bare[0])
      i += bare[0].length
    }
    skipSpace()
    if (line[i] !== '.') return { keys, end: i }
    i += 1
  }
}

// The keys of a TOML table header such as [a."b c".d] or [[a.b]], or null when
// the line is not a header. Quoting, spacing and a trailing comment do not
// matter, so a header written by hand is still found.
function tomlHeader(line) {
  const start = line.search(/\S/)
  if (start === -1 || line[start] !== '[') return null
  const array = line[start + 1] === '['
  const read = readKeys(line, start + (array ? 2 : 1))
  if (!read) return null
  const close = array ? ']]' : ']'
  if (line.slice(read.end, read.end + close.length) !== close) return null
  const rest = line.slice(read.end + close.length).trim()
  return rest === '' || rest.startsWith('#') ? { keys: read.keys, array } : null
}

// The keys a `key = value` line assigns, or null for any other line.
function tomlAssignment(line) {
  const start = line.search(/\S/)
  if (start === -1 || line[start] === '#' || line[start] === '[') return null
  const read = readKeys(line, start)
  return read && line[read.end] === '=' ? read.keys : null
}

// Which lines lie inside a multi-line string, where nothing is a header or a
// key. The line that opens one is not inside it.
function stringLines(lines) {
  let open = null
  return lines.map(line => {
    const inside = open !== null
    let i = 0
    for (;;) {
      if (open) {
        const close = line.indexOf(open, i)
        if (close === -1) break
        open = null
        i = close + 3
      } else {
        const found = /"""|'''/.exec(line.slice(i))
        if (!found) break
        open = found[0]
        i += found.index + 3
      }
    }
    return inside
  })
}

// The comment that ends a `key = value` line, with a space before it.
function trailingComment(line) {
  let quote = null
  for (let i = line.indexOf('=') + 1; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === '\\' && quote === '"') i += 1
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '#') {
      return ` ${line.slice(i)}`
    }
  }
  return ''
}

// Sets or removes `key = value` in one TOML table, line by line, so the rest of
// the file keeps its comments and layout. value null removes the key, and the
// table header too once only blank lines are left under it. A file that holds
// the table or the key in a form this cannot edit safely is refused rather than
// made invalid: the table twice, the key twice, or the table defined another
// way, through dotted keys or an inline table.
function setTomlKey(text, header, key, value) {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.length ? text.split(/\r?\n/) : []
  const names = tomlHeader(header).keys
  const target = JSON.stringify(names)
  const startsWith = (keys, prefix) => prefix.every((name, index) => keys[index] === name)
  const refuse = why => { throw new SetupError(`${header} ${why}; edit it by hand`) }

  const inString = stringLines(lines)
  const headers = []
  const starts = []
  let current = []
  lines.forEach((line, index) => {
    if (inString[index]) return
    const parsed = tomlHeader(line)
    if (parsed) {
      headers.push(index)
      current = parsed.keys
      if (JSON.stringify(parsed.keys) !== target) return
      if (parsed.array) refuse(`is an array of tables (line ${index + 1})`)
      starts.push(index)
      return
    }
    if (line.trim().startsWith('[') && names.every(name => line.includes(name))) {
      refuse(`is written in a form setup cannot read (line ${index + 1})`)
    }
    // A key under a table above the target that leads into it, such as
    // `"id".enabled = true` under [plugins] or `plugins = { ... }` at the top.
    const assigned = tomlAssignment(line)
    if (assigned && current.length < names.length && startsWith(names, current)) {
      const full = current.concat(assigned)
      if (startsWith(names, full.slice(0, names.length))) {
        refuse(`is also set through dotted keys or an inline table (line ${index + 1})`)
      }
    }
  })
  if (starts.length > 1) refuse('appears more than once')

  if (!starts.length) {
    if (value === null) return text
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    if (lines.length) lines.push('')
    lines.push(header, `${key} = ${value}`, '')
    return lines.join(newline)
  }
  const start = starts[0]
  const end = headers.find(index => index > start) ?? lines.length
  const found = []
  for (let index = start + 1; index < end; index++) {
    const assigned = inString[index] ? null : tomlAssignment(lines[index])
    if (assigned && assigned.length === 1 && assigned[0] === key) found.push(index)
  }
  if (found.length > 1) refuse(`sets ${key} more than once`)

  if (value !== null) {
    if (found.length) lines[found[0]] = `${key} = ${value}${trailingComment(lines[found[0]])}`
    else lines.splice(start + 1, 0, `${key} = ${value}`)
    return lines.join(newline)
  }
  if (!found.length) return text
  lines.splice(found[0], 1)
  if (lines.slice(start + 1, end - 1).every(line => !line.trim())) lines.splice(start, end - 1 - start)
  return lines.join(newline)
}

// setTomlKey on a Codex config file, naming the file when it refuses.
function editToml(file, text, header, key, value) {
  try {
    return setTomlKey(text, header, key, value)
  } catch (error) {
    if (error instanceof SetupError) throw new SetupError(`${file}: ${error.message}`)
    throw error
  }
}

const codex = {
  key: 'codex',
  label: 'Codex',
  command: 'codex',

  installed(ctx) {
    const list = parseJson(must(run('codex', ['plugin', 'list', '--json'], ctx), 'Listing plugins').stdout)
    const installed = list && Array.isArray(list.installed) ? list.installed : []
    return installed.find(p => p.pluginId === PLUGIN_ID && p.installed !== false) || null
  },

  setup(ctx) {
    const done = []
    const listed = parseJson(must(run('codex', ['plugin', 'marketplace', 'list', '--json'], ctx), 'Listing marketplaces').stdout)
    let market = listed && Array.isArray(listed.marketplaces) ? listed.marketplaces.find(m => m.name === MARKETPLACE) : null
    const source = market && market.marketplaceSource
    const local = market && (!source || source.sourceType === 'local')
    const folder = local ? (source && source.source) || market.root : null
    if (local && goneLocalSource(folder)) {
      must(run('codex', ['plugin', 'marketplace', 'remove', MARKETPLACE], ctx), 'Removing the marketplace')
      done.push(`removed the ${MARKETPLACE} marketplace, whose folder ${plainPath(folder)} no longer exists`)
      market = null
    }
    if (!market) {
      must(run('codex', ['plugin', 'marketplace', 'add', ctx.pkgDir], ctx), 'Adding the marketplace')
      done.push(`added the ${MARKETPLACE} marketplace from ${ctx.pkgDir}`)
    } else if (source && source.sourceType === 'git') {
      must(run('codex', ['plugin', 'marketplace', 'upgrade', MARKETPLACE], ctx), 'Refreshing the marketplace')
      done.push(`refreshed the ${MARKETPLACE} marketplace (${source.source})`)
    } else if (local && !samePath(plainPath(folder), ctx.pkgDir)) {
      done.push(`note: it reads ${plainPath(folder)}, not this install; to use this one, run \`codex plugin marketplace remove ${MARKETPLACE}\`, then setup again`)
    }
    const before = this.installed(ctx)
    // Installing turns the plugin on. One the user had turned off stays off, so
    // first make sure config.toml can take that back, while it is still off.
    const file = path.join(codexHome(ctx), 'config.toml')
    const table = `[plugins."${PLUGIN_ID}"]`
    const keepOff = Boolean(before && before.enabled === false)
    if (keepOff) editToml(file, readText(file), table, 'enabled', 'false')
    must(run('codex', ['plugin', 'add', PLUGIN_ID], ctx), 'Installing the plugin')
    const after = this.installed(ctx)
    if (!after) throw new SetupError(`${PLUGIN_ID} is not listed after installing it`)
    done.push(before ? `reinstalled ${PLUGIN_ID} ${after.version}` : `installed ${PLUGIN_ID} ${after.version}`)
    if (keepOff) {
      const text = readText(file)
      const next = editToml(file, text, table, 'enabled', 'false')
      if (next !== text) writeText(file, next)
      done.push(`kept it turned off, as it was; turn it on with \`enabled = true\` under ${table} in ${file}`)
    }
    const copied = ensureDependencies(path.join(codexHome(ctx), 'plugins', 'cache', MARKETPLACE, PLUGIN, String(after.version)), ctx)
    if (copied) done.push(copied)
    // The setup guide before 1.4.0 added the server by hand.
    if (run('codex', ['mcp', 'get', 'figma-bridge'], ctx).status === 0) {
      done.push('note: [mcp_servers.figma-bridge] from an older setup also runs the bridge; remove it with `codex mcp remove figma-bridge`')
    }
    return done
  },

  status(ctx) {
    const plugin = this.installed(ctx)
    return plugin ? `plugin ${plugin.version}${plugin.enabled === false ? ' (turned off)' : ''}` : 'not set up'
  },

  // Codex runs a tool marked readOnlyHint without asking, so auto needs no
  // setting. Manual asks for every bridge tool.
  applyApprovals(mode, ctx) {
    const file = path.join(codexHome(ctx), 'config.toml')
    const before = readText(file)
    const value = mode === 'manual' ? '"prompt"' : null
    let after = editToml(file, before, `[plugins."${PLUGIN_ID}".mcp_servers.${PLUGIN_SERVER}]`, 'default_tools_approval_mode', value)
    if (after.split(/\r?\n/).some(line => {
      const header = tomlHeader(line)
      return header && JSON.stringify(header.keys) === '["mcp_servers","figma-bridge"]'
    })) {
      after = editToml(file, after, '[mcp_servers.figma-bridge]', 'default_tools_approval_mode', value)
    }
    if (after === before) return []
    writeText(file, after)
    return [mode === 'manual' ? `${file}: bridge tools ask before running` : `${file}: design reads run without asking`]
  },
}

// ── agy ───────────────────────────────────────────────────

const AGY_ALLOW = READ_TOOLS.map(tool => `mcp(${AGY_SERVER}/${tool})`)
// Ask outranks allow in agy, so a broad allow rule such as mcp(*) cannot let
// pairing or a REST sync through.
const AGY_ASK = ['approve_figma_pairing', 'sync_figma_design'].map(tool => `mcp(${AGY_SERVER}/${tool})`)

const agy = {
  key: 'agy',
  label: 'agy',
  command: 'agy',

  installed(ctx) {
    const listed = run('agy', ['mcp', 'list'], ctx).stdout
    return listed.split(/\r?\n/).some(line => line.trim().split(/\s+/)[0] === AGY_SERVER)
  },

  // `agy mcp add` replaces the whole entry, dropping its env and turning it
  // back on, so an entry that exists only gets its path changed.
  setup(ctx) {
    const entry = path.join(ctx.pkgDir, 'server', 'mcp.mjs')
    const file = agyServersPath(ctx)
    const text = readText(file)
    const config = parseJsonFile(file, text)
    const servers = config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers : {}
    const current = servers[AGY_SERVER]
    if (!current) {
      must(run('agy', ['mcp', 'add', AGY_SERVER, 'node', entry], ctx), 'Adding the MCP server')
      return [`registered the ${AGY_SERVER} MCP server (node ${entry})`]
    }
    const off = current.disabled === true ? [`it is turned off; turn it on with "disabled": false in ${file}`] : []
    const args = Array.isArray(current.args) ? current.args : []
    if (current.command === 'node' && args.length === 1 && samePath(args[0], entry)) {
      return [`the ${AGY_SERVER} MCP server already runs node ${entry}`, ...off]
    }
    const next = { ...config, mcpServers: { ...servers, [AGY_SERVER]: { ...current, command: 'node', args: [entry] } } }
    writeText(file, formatJson(next, text))
    return [`pointed the ${AGY_SERVER} MCP server at node ${entry}, keeping its other settings`, ...off]
  },

  status(ctx) {
    return this.installed(ctx) ? 'MCP server registered' : 'not set up'
  },

  applyApprovals(mode, ctx) {
    const file = agySettingsPath(ctx)
    const text = readText(file)
    const settings = parseJsonFile(file, text)
    const permissions = settings.permissions && typeof settings.permissions === 'object' ? settings.permissions : {}
    const allow = (Array.isArray(permissions.allow) ? permissions.allow : []).filter(rule => !AGY_ALLOW.includes(rule))
    const ask = (Array.isArray(permissions.ask) ? permissions.ask : []).filter(rule => !AGY_ASK.includes(rule))
    if (mode === 'auto') allow.push(...AGY_ALLOW)
    ask.push(...AGY_ASK)
    const next = { ...settings, permissions: { ...permissions, allow, ask } }
    if (JSON.stringify(next) === JSON.stringify(settings)) return []
    writeText(file, formatJson(next, text))
    return [mode === 'manual' ? `${file}: design reads ask again` : `${file}: design reads run without asking`]
  },
}

const CLIENTS = [claude, codex, agy]

module.exports = {
  CLIENTS,
  SetupError,
  setTomlKey,
  tomlHeader,
  ensureDependencies,
  versionBelow,
  PLUGIN_ID,
  MARKETPLACE,
  AGY_ALLOW,
  AGY_ASK,
}
