const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { setup, approvals, parseSetupArgs, isTemporaryCopy, UsageError } = require('./commands')
const { setTomlKey, tomlHeader, ensureDependencies, versionBelow, SetupError, PLUGIN_ID, AGY_ALLOW, AGY_ASK } = require('./clients')

// setup drives the claude, codex and agy command-line tools. Here they are small
// scripts on PATH that log their arguments and keep what they "installed" in a
// state file, in a temporary home, so no real client configuration is touched.
// Like the real ones, `codex plugin add` turns a plugin back on and `agy mcp add`
// replaces a server's whole entry.

const FAKE = `
const fs = require('fs')
const path = require('path')
const [client, ...args] = process.argv.slice(2)
const stateFile = process.env.FAKE_STATE
const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'))
state.calls.push([client, ...args].join(' '))
const save = () => fs.writeFileSync(stateFile, JSON.stringify(state))
const say = value => process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value))
const command = args.filter(arg => arg !== '--json').join(' ')
const codexConfig = path.join(process.env.CODEX_HOME, 'config.toml')
const codexTable = '[plugins."figma-bridge@figma-design-bridge"]'
const codexOff = () => fs.existsSync(codexConfig) && fs.readFileSync(codexConfig, 'utf8').includes(codexTable + '\\nenabled = false')
const agyFile = path.join(process.env.FAKE_HOME, '.gemini', 'config', 'mcp_config.json')
const agyServers = () => fs.existsSync(agyFile) ? JSON.parse(fs.readFileSync(agyFile, 'utf8')).mcpServers || {} : {}
let code = 0
if (state.fail === client) {
  process.stderr.write(client + ': something went wrong\\n')
  code = 1
} else if (client === 'claude') {
  if (command === 'plugin marketplace list') say(state.claudeMarkets)
  else if (command.startsWith('plugin marketplace add ')) state.claudeMarkets.push({ name: 'figma-design-bridge', source: 'directory', path: args[3] })
  else if (command.startsWith('plugin marketplace remove ')) state.claudeMarkets = state.claudeMarkets.filter(m => m.name !== args[3])
  else if (command === 'plugin list') say(state.claudePlugins)
  else if (command.startsWith('plugin install ')) state.claudePlugins.push({ id: args[2], version: '9.9.9', scope: 'user', enabled: true, installPath: state.installPath })
} else if (client === 'codex') {
  if (command === 'plugin marketplace list') say({ marketplaces: state.codexMarkets })
  else if (command.startsWith('plugin marketplace add ')) state.codexMarkets.push({ name: 'figma-design-bridge', root: args[3], marketplaceSource: { sourceType: 'local', source: args[3] } })
  else if (command.startsWith('plugin marketplace remove ')) state.codexMarkets = state.codexMarkets.filter(m => m.name !== args[3])
  else if (command === 'plugin list') say({ installed: state.codexPlugins.map(p => ({ ...p, enabled: state.codexEnabled ?? !codexOff() })) })
  else if (command.startsWith('plugin add ')) {
    state.codexPlugins = [{ pluginId: args[2], version: '9.9.9', installed: true }]
    if (codexOff()) fs.writeFileSync(codexConfig, fs.readFileSync(codexConfig, 'utf8').replace(codexTable + '\\nenabled = false', codexTable + '\\nenabled = true'))
  } else if (command === 'mcp get figma-bridge') code = state.codexLegacy ? 0 : 1
} else if (client === 'agy') {
  if (command === 'mcp list') say('NAME TYPE STATUS COMMAND/URL\\n' + Object.keys(agyServers()).map(name => name + ' stdio ok node').join('\\n'))
  else if (command.startsWith('mcp add ')) {
    const rest = args.slice(2)
    while (rest[0] === '--env') rest.splice(0, 2)
    const [name, cmd, ...cmdArgs] = rest
    fs.mkdirSync(path.dirname(agyFile), { recursive: true })
    fs.writeFileSync(agyFile, JSON.stringify({ mcpServers: { ...agyServers(), [name]: { args: cmdArgs, command: cmd, disabled: false } } }))
  }
}
save()
process.exit(code)
`

// process.env with these variables replaced, whatever case the platform spells
// them in.
function envWith(overrides) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!Object.keys(overrides).some(name => name.toUpperCase() === key.toUpperCase())) env[key] = value
  }
  return { ...env, ...overrides }
}

function sandbox(t, { clients = ['claude', 'codex', 'agy'], state = {} } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-bridge-setup-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const home = path.join(root, 'home')
  const bin = path.join(root, 'bin')
  // A space and an ampersand, which cmd.exe would split on unless quoted.
  const pkgDir = path.join(root, 'pkg & co')
  const installPath = path.join(root, 'claude-cache', 'figma-bridge')
  for (const dir of [home, bin, pkgDir, installPath]) fs.mkdirSync(dir, { recursive: true })

  const fake = path.join(root, 'fake-client.js')
  fs.writeFileSync(fake, FAKE)
  for (const client of clients) {
    if (process.platform === 'win32') {
      fs.writeFileSync(path.join(bin, `${client}.cmd`), `@"${process.execPath}" "${fake}" ${client} %*\r\n`)
    } else {
      fs.writeFileSync(path.join(bin, client), `#!/bin/sh\nexec "${process.execPath}" "${fake}" ${client} "$@"\n`, { mode: 0o755 })
    }
  }
  const stateFile = path.join(root, 'state.json')
  fs.writeFileSync(stateFile, JSON.stringify({
    calls: [], claudeMarkets: [], claudePlugins: [], codexMarkets: [], codexPlugins: [],
    installPath, ...state,
  }))

  const dataDir = path.join(root, 'data')
  const env = envWith({
    PATH: bin,
    FAKE_STATE: stateFile,
    FAKE_HOME: home,
    FIGMA_BRIDGE_DATA_DIR: dataDir,
    CODEX_HOME: path.join(home, '.codex'),
  })
  delete env.CLAUDE_CONFIG_DIR
  const lines = []
  // The package sits in the system temporary folder, which setup would take
  // for an npx copy and install globally.
  const options = { env, homedir: home, tmpdir: path.join(root, 'tmp'), pkgDir, out: line => lines.push(line) }
  return {
    root,
    options,
    lines,
    dataDir,
    pkgDir,
    entry: path.join(pkgDir, 'server', 'mcp.mjs'),
    codexConfig: path.join(home, '.codex', 'config.toml'),
    agySettings: path.join(home, '.gemini', 'antigravity-cli', 'settings.json'),
    agyServers: path.join(home, '.gemini', 'config', 'mcp_config.json'),
    state: () => JSON.parse(fs.readFileSync(stateFile, 'utf8')),
    reset: () => { lines.length = 0 },
  }
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))

function writeFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

test('setup installs into every client it finds and lets reads run without asking', async t => {
  const box = sandbox(t)
  writeFile(box.agySettings, JSON.stringify({ theme: 'dark', permissions: { allow: ['mcp(other/tool)'] } }))

  assert.equal(await setup([], box.options), 0, box.lines.join('\n'))
  const { calls } = box.state()
  assert.deepEqual(calls.filter(call => call.startsWith('claude')), [
    'claude plugin marketplace list --json',
    `claude plugin marketplace add ${box.pkgDir}`,
    'claude plugin list --json',
    `claude plugin install ${PLUGIN_ID}`,
    'claude plugin list --json',
  ])
  assert.deepEqual(calls.filter(call => call.startsWith('codex')), [
    'codex plugin marketplace list --json',
    `codex plugin marketplace add ${box.pkgDir}`,
    'codex plugin list --json',
    `codex plugin add ${PLUGIN_ID}`,
    'codex plugin list --json',
    'codex mcp get figma-bridge',
  ])
  assert.deepEqual(calls.filter(call => call.startsWith('agy')), [
    `agy mcp add figma-bridge node ${box.entry}`,
  ])

  assert.equal(readJson(path.join(box.dataDir, 'config.json')).approvals, 'auto')
  assert.ok(fs.existsSync(path.join(box.dataDir, 'bridge-token.json')))
  // Codex needs no setting for auto: the tools carry readOnlyHint.
  assert.equal(fs.existsSync(box.codexConfig), false)
  assert.deepEqual(readJson(box.agyServers).mcpServers['figma-bridge'].args, [box.entry])
  const agy = readJson(box.agySettings)
  assert.equal(agy.theme, 'dark')
  assert.deepEqual(agy.permissions.allow, ['mcp(other/tool)', ...AGY_ALLOW])
  assert.deepEqual(agy.permissions.ask, AGY_ASK)
  assert.ok(fs.existsSync(`${box.agySettings}.figma-bridge.bak`))

  const output = box.lines.join('\n')
  assert.match(output, new RegExp(`installed ${PLUGIN_ID} 9\\.9\\.9`))
  assert.ok(output.includes(path.join(box.pkgDir, 'plugin', 'manifest.json')))
  assert.ok(!output.includes(fs.readFileSync(path.join(box.dataDir, 'bridge-token.json'), 'utf8').match(/[0-9a-f]{64}/)[0]))
})

test('running setup again updates instead of installing, and changes no settings', async t => {
  const box = sandbox(t)
  await setup([], box.options)
  const settings = fs.readFileSync(box.agySettings, 'utf8')
  const servers = fs.readFileSync(box.agyServers, 'utf8')
  const before = box.state().calls.length
  box.reset()

  assert.equal(await setup([], box.options), 0, box.lines.join('\n'))
  const calls = box.state().calls.slice(before)
  assert.ok(calls.includes('claude plugin marketplace update figma-design-bridge'))
  assert.ok(calls.includes(`claude plugin update ${PLUGIN_ID}`))
  assert.ok(!calls.some(call => call.startsWith('claude plugin marketplace add') || call.startsWith('codex plugin marketplace add')))
  assert.ok(!calls.some(call => call.startsWith('agy')), calls.join('\n'))
  assert.equal(fs.readFileSync(box.agySettings, 'utf8'), settings)
  assert.equal(fs.readFileSync(box.agyServers, 'utf8'), servers)
  const output = box.lines.join('\n')
  assert.match(output, /updated figma-bridge@figma-design-bridge to 9\.9\.9/)
  assert.match(output, /figma-bridge MCP server already runs node/)
})

test('setup moves an agy server to this install and keeps its env and on/off state', async t => {
  const box = sandbox(t)
  const old = path.join(box.root, 'old clone', 'server', 'mcp.mjs')
  const other = { command: 'npx', args: ['other'] }
  writeFile(box.agyServers, JSON.stringify({
    mcpServers: {
      other,
      'figma-bridge': { args: [old], command: 'node', disabled: true, env: { FIGMA_ACCESS_TOKEN: 'figd_x' } },
    },
  }, null, 2).replace(/\n/g, '\r\n'))

  assert.equal(await setup(['--only', 'agy'], box.options), 0, box.lines.join('\n'))
  assert.ok(!box.state().calls.some(call => call.startsWith('agy mcp add')))
  const text = fs.readFileSync(box.agyServers, 'utf8')
  assert.ok(text.includes('\r\n') && !/[^\r]\n/.test(text), 'changed the line endings')
  assert.deepEqual(JSON.parse(text).mcpServers, {
    other,
    'figma-bridge': { args: [box.entry], command: 'node', disabled: true, env: { FIGMA_ACCESS_TOKEN: 'figd_x' } },
  })
  assert.match(fs.readFileSync(`${box.agyServers}.figma-bridge.bak`, 'utf8'), /old clone/)
  assert.match(box.lines.join('\n'), /keeping its other settings/)
})

test('setup leaves a Codex plugin the user turned off turned off', async t => {
  const box = sandbox(t, {
    state: {
      codexMarkets: [{ name: 'figma-design-bridge', root: '' }],
      codexPlugins: [{ pluginId: PLUGIN_ID, version: '1.3.2', installed: true }],
    },
  })
  // The marketplace reads this install, which only exists once the sandbox does.
  const state = box.state()
  state.codexMarkets[0].root = `\\\\?\\${box.pkgDir}`
  fs.writeFileSync(box.options.env.FAKE_STATE, JSON.stringify(state))
  writeFile(box.codexConfig, `model = "gpt"\n\n[plugins."${PLUGIN_ID}"]\nenabled = false\n`)

  assert.equal(await setup(['--only', 'codex'], box.options), 0, box.lines.join('\n'))
  assert.ok(box.state().calls.includes(`codex plugin add ${PLUGIN_ID}`))
  assert.ok(!box.state().calls.some(call => call.startsWith('codex plugin marketplace')
    && !call.endsWith('list --json')), 'touched a marketplace that is in place')
  assert.equal(fs.readFileSync(box.codexConfig, 'utf8'), `model = "gpt"\n\n[plugins."${PLUGIN_ID}"]\nenabled = false\n`)
  assert.match(box.lines.join('\n'), /kept it turned off/)
})

test('setup replaces a marketplace whose folder is gone', async t => {
  const gone = path.join(os.tmpdir(), 'figma-bridge-deleted-clone-that-does-not-exist')
  const box = sandbox(t, {
    state: {
      claudeMarkets: [{ name: 'figma-design-bridge', source: 'directory', path: gone }],
      codexMarkets: [{ name: 'figma-design-bridge', root: `\\\\?\\${gone}` }],
    },
  })

  assert.equal(await setup(['--only', 'claude,codex'], box.options), 0, box.lines.join('\n'))
  const calls = box.state().calls
  for (const client of ['claude', 'codex']) {
    const remove = calls.indexOf(`${client} plugin marketplace remove figma-design-bridge`)
    const add = calls.indexOf(`${client} plugin marketplace add ${box.pkgDir}`)
    assert.ok(remove !== -1 && add > remove, `${client}: ${calls.join('\n')}`)
  }
  assert.match(box.lines.join('\n'), /no longer exists/)
})

test('manual makes every tool ask in Codex and agy, and auto undoes it', async t => {
  const box = sandbox(t, { state: { codexLegacy: true } })
  writeFile(box.codexConfig, 'model = "gpt"\n\n[mcp_servers.figma-bridge]\ncommand = "node"\n')

  assert.equal(await setup(['--approvals', 'manual'], box.options), 0, box.lines.join('\n'))
  assert.equal(readJson(path.join(box.dataDir, 'config.json')).approvals, 'manual')
  const toml = fs.readFileSync(box.codexConfig, 'utf8')
  assert.match(toml, /\[mcp_servers\.figma-bridge\]\ndefault_tools_approval_mode = "prompt"\ncommand = "node"/)
  assert.match(toml, new RegExp(`\\[plugins\\."${PLUGIN_ID}"\\.mcp_servers\\.bridge\\]\\ndefault_tools_approval_mode = "prompt"`))
  assert.equal(fs.readFileSync(`${box.codexConfig}.figma-bridge.bak`, 'utf8'), 'model = "gpt"\n\n[mcp_servers.figma-bridge]\ncommand = "node"\n')
  assert.deepEqual(readJson(box.agySettings).permissions, { allow: [], ask: AGY_ASK })
  assert.match(box.lines.join('\n'), /codex mcp remove figma-bridge/)

  box.reset()
  assert.equal(await approvals(['auto'], box.options), 0, box.lines.join('\n'))
  assert.equal(fs.readFileSync(box.codexConfig, 'utf8'), 'model = "gpt"\n\n[mcp_servers.figma-bridge]\ncommand = "node"\n')
  assert.deepEqual(readJson(box.agySettings).permissions, { allow: AGY_ALLOW, ask: AGY_ASK })
  assert.match(box.lines.join('\n'), /Claude Code: the plugin's hook follows this/)
  // The backup still holds the file from before setup first changed it.
  assert.equal(fs.readFileSync(`${box.codexConfig}.figma-bridge.bak`, 'utf8'), 'model = "gpt"\n\n[mcp_servers.figma-bridge]\ncommand = "node"\n')
})

test('approvals says when the Claude Code plugin is too old for the hook, or missing', async t => {
  const old = sandbox(t, { clients: ['claude'], state: { claudePlugins: [{ id: PLUGIN_ID, version: '1.3.2', scope: 'user', enabled: true }] } })
  assert.equal(await approvals(['manual'], old.options), 0)
  assert.match(old.lines.join('\n'), /Claude Code: plugin 1\.3\.2 predates the approvals hook \(1\.4\.0\); run `figma-bridge update`/)

  const missing = sandbox(t, { clients: ['claude'] })
  assert.equal(await approvals(['auto'], missing.options), 0)
  assert.match(missing.lines.join('\n'), /Claude Code: plugin not set up/)
})

test('a client config setup cannot parse fails that client and is left as it was', async t => {
  const box = sandbox(t, { clients: ['agy'] })
  writeFile(box.agySettings, '{ "permissions": ')

  assert.equal(await setup([], box.options), 1)
  assert.match(box.lines.join('\n'), /agy: FAILED, cannot read .*settings\.json/)
  assert.equal(fs.readFileSync(box.agySettings, 'utf8'), '{ "permissions": ')
})

test('a config.json setup cannot parse stops it with the file named', async t => {
  const box = sandbox(t, { clients: [] })
  writeFile(path.join(box.dataDir, 'config.json'), '{ hand edited')

  await assert.rejects(setup([], box.options), error => error instanceof SetupError && /cannot read .*config\.json/.test(error.message))
})

test('--only limits setup to the clients named, and a client not on PATH is skipped', async t => {
  const box = sandbox(t, { clients: ['claude', 'agy'] })

  assert.equal(await setup(['--only=agy,codex'], box.options), 0, box.lines.join('\n'))
  assert.ok(box.state().calls.every(call => call.startsWith('agy')))
  assert.match(box.lines.join('\n'), /Codex: `codex` is not on PATH, skipped/)
  assert.doesNotMatch(box.lines.join('\n'), /Claude Code:/)
})

test('a client that fails does not stop the others, and setup exits 1', async t => {
  const box = sandbox(t, { state: { fail: 'claude' } })

  assert.equal(await setup([], box.options), 1)
  const output = box.lines.join('\n')
  assert.match(output, /Claude Code: FAILED, Listing marketplaces failed: claude: something went wrong/)
  assert.ok(box.state().calls.some(call => call.startsWith('agy mcp add')))
  assert.match(output, /Next, in Figma desktop/)
})

test('setup options are checked before anything runs', () => {
  assert.deepEqual(parseSetupArgs(['--only', 'claude,agy', '--approvals=manual']), { only: ['claude', 'agy'], approvals: 'manual', installed: false })
  assert.throws(() => parseSetupArgs(['--only', 'cursor']), UsageError)
  assert.throws(() => parseSetupArgs(['--only']), UsageError)
  assert.throws(() => parseSetupArgs(['--approvals', 'sometimes']), UsageError)
  assert.equal(parseSetupArgs(['--installed']).installed, true)
})

test('a copy run by npx, pnpm dlx or bunx counts as not installed', t => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-bridge-tmp-'))
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
  const elsewhere = path.join(path.parse(tmp).root, 'not-temp')

  assert.equal(isTemporaryCopy(path.join('C:', 'Users', 'me', 'AppData', 'Local', 'npm-cache', '_npx', 'abc', 'node_modules', '@pixodeo', 'figma-bridge'), elsewhere), true)
  assert.equal(isTemporaryCopy('/home/me/.npm/_npx/abc/node_modules/@pixodeo/figma-bridge', elsewhere), true)
  assert.equal(isTemporaryCopy('/home/me/.local/share/pnpm/dlx/abc/node_modules/@pixodeo/figma-bridge', elsewhere), true)
  assert.equal(isTemporaryCopy(path.join(tmp, 'bunx-1000-@pixodeo', 'node_modules', '@pixodeo', 'figma-bridge'), tmp), true)
  assert.equal(isTemporaryCopy(path.join(path.parse(tmp).root, 'usr', 'lib', 'node_modules', '@pixodeo', 'figma-bridge'), tmp), false)
  assert.equal(isTemporaryCopy(`${tmp}-sibling`, tmp), false)
})

test('setTomlKey edits one table and keeps the rest of the file as it was', () => {
  const header = '[plugins."figma-bridge@figma-design-bridge".mcp_servers.bridge]'
  assert.equal(setTomlKey('', header, 'mode', '"prompt"'), `${header}\nmode = "prompt"\n`)

  const crlf = '# mine\r\nmodel = "gpt"\r\n'
  const added = setTomlKey(crlf, header, 'mode', '"prompt"')
  assert.equal(added, `# mine\r\nmodel = "gpt"\r\n\r\n${header}\r\nmode = "prompt"\r\n`)
  assert.equal(setTomlKey(added, header, 'mode', '"approve"'), added.replace('"prompt"', '"approve"'))
  assert.equal(setTomlKey(added, header, 'mode', null), crlf)

  const shared = `${header}\nmode = "prompt"\nother = 1\n\n[next]\nmode = "x"\n`
  assert.equal(setTomlKey(shared, header, 'mode', null), `${header}\nother = 1\n\n[next]\nmode = "x"\n`)
  assert.equal(setTomlKey('[next]\nmode = "x"\n', header, 'mode', null), '[next]\nmode = "x"\n')

  // A table that still holds a comment stays.
  assert.equal(setTomlKey(`${header}\n# why\nmode = "prompt"\n`, header, 'mode', null), `${header}\n# why\n`)
})

test('setTomlKey finds a table however its header is written', () => {
  const header = '[plugins."figma-bridge@figma-design-bridge".mcp_servers.bridge]'
  for (const written of [
    `${header} # added by hand`,
    "[plugins.'figma-bridge@figma-design-bridge'.mcp_servers.bridge]",
    '[ plugins . "figma-bridge@figma-design-bridge" . mcp_servers . "bridge" ]',
    `  ${header}`,
  ]) {
    const text = `${written}\n"mode" = "approve"\n\n[other]\nmode = 1\n`
    assert.equal(setTomlKey(text, header, 'mode', '"prompt"'), `${written}\nmode = "prompt"\n\n[other]\nmode = 1\n`, written)
  }
  // A multi-line array in the table is not taken for the end of it.
  const array = `${header}\nargs = [\n  "a",\n  "b",\n]\nmode = "approve"\n`
  assert.equal(setTomlKey(array, header, 'mode', null), `${header}\nargs = [\n  "a",\n  "b",\n]\n`)
})

test('setTomlKey refuses a file it cannot edit safely', () => {
  const header = '[plugins."figma-bridge@figma-design-bridge".mcp_servers.bridge]'
  const cases = {
    'appears more than once': `${header}\nmode = 1\n\n${header}\nother = 2\n`,
    'sets mode more than once': `${header}\nmode = 1\nmode = 2\n`,
    'dotted keys': '[plugins."figma-bridge@figma-design-bridge"]\nmcp_servers.bridge.mode = "x"\n',
    'array of tables': '[[plugins."figma-bridge@figma-design-bridge".mcp_servers.bridge]]\nmode = 1\n',
    'dotted keys under a parent table': '[plugins."figma-bridge@figma-design-bridge".mcp_servers]\nbridge.mode = "approve"\n',
    'an inline table': '[plugins."figma-bridge@figma-design-bridge"]\nmcp_servers = { bridge = { enabled = true } }\n',
    'quoted dotted keys': '[plugins."figma-bridge@figma-design-bridge"]\n"mcp_servers"."bridge".mode = "x"\n',
    'spaced dotted keys': '[plugins."figma-bridge@figma-design-bridge"]\nmcp_servers . bridge.mode = "x"\n',
  }
  for (const [why, text] of Object.entries(cases)) {
    assert.throws(() => setTomlKey(text, header, 'mode', '"prompt"'), SetupError, why)
  }

  const plugin = '[plugins."figma-bridge@figma-design-bridge"]'
  const off = {
    'a dotted key under [plugins]': '[plugins]\n"figma-bridge@figma-design-bridge".enabled = true\n',
    'an inline table under [plugins]': '[plugins]\n"figma-bridge@figma-design-bridge" = { enabled = true }\n',
    'a dotted key at the top': 'plugins."figma-bridge@figma-design-bridge".enabled = true\n',
  }
  for (const [why, text] of Object.entries(off)) {
    assert.throws(() => setTomlKey(text, plugin, 'enabled', 'false'), SetupError, why)
  }
})

test('setTomlKey edits around what it does not need to refuse', () => {
  const header = '[plugins."figma-bridge@figma-design-bridge".mcp_servers.bridge]'
  // Dotted keys under another plugin.
  const other = '[plugins."other@x"]\nmcp_servers.bridge.mode = "x"\n'
  assert.equal(setTomlKey(other, header, 'mode', '"prompt"'), `${other}\n${header}\nmode = "prompt"\n`)
  // A comment after the value stays.
  assert.equal(setTomlKey(`${header}\nmode = "approve" # mine\n`, header, 'mode', '"prompt"'), `${header}\nmode = "prompt" # mine\n`)
  assert.equal(setTomlKey(`${header}\nmode = "a#b"\n`, header, 'mode', '"prompt"'), `${header}\nmode = "prompt"\n`)
  // A header inside a multi-line string is text.
  const string = `notes = """\n${header}\nmode = "x"\n"""\n`
  assert.equal(setTomlKey(string, header, 'mode', '"prompt"'), `${string}\n${header}\nmode = "prompt"\n`)
})

test('setup stops before turning a Codex plugin back on when it cannot turn it off again', async t => {
  const unsafe = '[plugins]\n"figma-bridge@figma-design-bridge".enabled = false\n'
  const box = sandbox(t, {
    clients: ['codex'],
    state: { codexEnabled: false, codexPlugins: [{ pluginId: PLUGIN_ID, version: '1.3.2', installed: true }] },
  })
  writeFile(box.codexConfig, unsafe)

  assert.equal(await setup([], box.options), 1)
  assert.ok(!box.state().calls.includes(`codex plugin add ${PLUGIN_ID}`), box.state().calls.join('\n'))
  assert.equal(fs.readFileSync(box.codexConfig, 'utf8'), unsafe)
  assert.match(box.lines.join('\n'), /Codex: FAILED, .*config\.toml: \[plugins\."figma-bridge@figma-design-bridge"\] is also set through dotted keys/)
})

test('tomlHeader reads table headers and nothing else', () => {
  assert.deepEqual(tomlHeader('[a."b c".d] # note'), { keys: ['a', 'b c', 'd'], array: false })
  assert.deepEqual(tomlHeader("[[ a . 'b' ]]"), { keys: ['a', 'b'], array: true })
  for (const line of ['a = [1]', '[a] b', '[a.]', '["a"', '  "x",', '[1, 2],', '']) {
    assert.equal(tomlHeader(line), null, line)
  }
})

test('versionBelow compares release numbers', () => {
  assert.equal(versionBelow('1.3.2', '1.4.0'), true)
  assert.equal(versionBelow('1.4.0', '1.4.0'), false)
  assert.equal(versionBelow('1.10.0', '1.4.0'), false)
  assert.equal(versionBelow('2.0.0-beta.1', '1.4.0'), false)
})

test('ensureDependencies fills in node_modules for a copy that arrived without them', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-bridge-deps-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const pkgDir = path.join(root, 'pkg')
  const sdk = path.join(pkgDir, 'node_modules', '@modelcontextprotocol', 'sdk')
  fs.mkdirSync(sdk, { recursive: true })
  fs.writeFileSync(path.join(sdk, 'package.json'), '{"name":"@modelcontextprotocol/sdk"}')
  const copy = path.join(root, 'copy')
  fs.mkdirSync(path.join(copy, 'server'), { recursive: true })
  fs.writeFileSync(path.join(copy, 'server', 'mcp.mjs'), '')

  assert.match(ensureDependencies(copy, { pkgDir }), /copied the MCP server's dependencies/)
  assert.ok(fs.existsSync(path.join(copy, 'node_modules', '@modelcontextprotocol', 'sdk', 'package.json')))
  assert.equal(ensureDependencies(copy, { pkgDir }), null)
  assert.equal(ensureDependencies(path.join(root, 'not-a-plugin'), { pkgDir }), null)
})
