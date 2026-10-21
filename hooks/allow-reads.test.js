const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { decide, PREFIX } = require('./allow-reads')
const { READ_TOOLS } = require('../server/tool-policy')

// The Claude Code hook answers "allow" for a bridge read while approvals is
// auto, and says nothing otherwise, which leaves the usual prompt in place.

const HOOK = path.join(__dirname, 'allow-reads.js')
// The hook also reads the config.json a clone may keep next to the code, which
// can set approvals for the whole machine.
function cloneSetsApprovals() {
  try {
    return 'approvals' in JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'config.json'), 'utf8'))
  } catch {
    return false
  }
}
const spawned = { skip: cloneSetsApprovals() && 'server/config.json in this clone sets approvals' }

function runHook(input, dataDir) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [HOOK], {
      env: { ...process.env, FIGMA_BRIDGE_DATA_DIR: dataDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.on('exit', code => resolve({ code, stdout }))
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input))
  })
}

function tempDataDir(t, config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-hook-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  if (config !== undefined) fs.writeFileSync(path.join(dir, 'config.json'), config)
  return dir
}

test('every read tool is allowed in auto, and nothing else is', () => {
  for (const tool of READ_TOOLS) {
    const decision = decide({ tool_name: PREFIX + tool }, {})
    assert.equal(decision.hookSpecificOutput.permissionDecision, 'allow', tool)
    assert.equal(decision.hookSpecificOutput.hookEventName, 'PreToolUse')
  }
  for (const tool of ['approve_figma_pairing', 'sync_figma_design', 'get_design_contextx']) {
    assert.equal(decide({ tool_name: PREFIX + tool }, {}), null, tool)
  }
  // Another server's tool with the same name, and no tool name at all.
  assert.equal(decide({ tool_name: 'mcp__figma__get_design_context' }, {}), null)
  assert.equal(decide({}, {}), null)
  assert.equal(decide({ tool_name: `${PREFIX}get_design_info` }, { approvals: 'manual' }), null)
})

test('the hook prints the allow decision while approvals is auto, the default', spawned, async t => {
  const result = await runHook({ tool_name: `${PREFIX}get_design_context` }, tempDataDir(t))
  assert.equal(result.code, 0)
  assert.deepEqual(JSON.parse(result.stdout).hookSpecificOutput, {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    permissionDecisionReason: 'Figma Design Bridge read (approvals: auto)',
  })
})

test('the hook says nothing for manual, a write tool or input it cannot read', spawned, async t => {
  const manual = tempDataDir(t, JSON.stringify({ approvals: 'manual' }))
  assert.equal((await runHook({ tool_name: `${PREFIX}get_design_context` }, manual)).stdout, '')

  const auto = tempDataDir(t)
  assert.equal((await runHook({ tool_name: `${PREFIX}approve_figma_pairing` }, auto)).stdout, '')
  const broken = await runHook('not json', auto)
  assert.equal(broken.code, 0)
  assert.equal(broken.stdout, '')
})

test('a config file it cannot parse leaves the prompt in place, since it may say manual', spawned, async t => {
  const dir = tempDataDir(t, '{ broken')
  const result = await runHook({ tool_name: `${PREFIX}get_bridge_status` }, dir)
  assert.equal(result.code, 0)
  assert.equal(result.stdout, '')
})

test('hooks.json matches exactly the read tools', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'hooks.json'), 'utf8'))
  const [entry] = config.hooks.PreToolUse
  const matcher = new RegExp(entry.matcher)
  for (const tool of READ_TOOLS) assert.ok(matcher.test(PREFIX + tool), tool)
  assert.equal(matcher.test(`${PREFIX}approve_figma_pairing`), false)
  assert.equal(matcher.test(`${PREFIX}sync_figma_design`), false)
  assert.match(entry.hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/allow-reads\.js/)
})
