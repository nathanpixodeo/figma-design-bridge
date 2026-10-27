#!/usr/bin/env node
// Claude Code PreToolUse hook: allows a bridge read without a permission prompt
// while approvals is auto. A plugin cannot ship permission rules, but its hook
// can answer for the tools it owns. The user's own deny and ask rules still win.
// `figma-bridge approvals` also writes the same reads into the profile's
// settings.json, for a session where the hook does not run.
//
// It prints nothing, so Claude Code asks as usual, for manual, for any tool
// that is not a read, and on any error.

const { readConfig } = require('../server/data-dir')
const { READ_TOOLS, approvalsMode } = require('../server/tool-policy')

const PREFIX = 'mcp__plugin_figma-bridge_bridge__'

function decide(input, config) {
  const tool = input && typeof input.tool_name === 'string' ? input.tool_name : ''
  if (!tool.startsWith(PREFIX) || !READ_TOOLS.includes(tool.slice(PREFIX.length))) return null
  if (approvalsMode(config) !== 'auto') return null
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'Figma Design Bridge read (approvals: auto)',
    },
  }
}

function main() {
  let text = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', chunk => { text += chunk })
  process.stdin.on('end', () => {
    try {
      // A config file it cannot read may say manual.
      let unreadable = false
      const config = readConfig({ log: () => { unreadable = true } })
      const decision = unreadable ? null : decide(JSON.parse(text), config)
      if (decision) process.stdout.write(JSON.stringify(decision))
    } catch {
      // Say nothing: Claude Code then asks, which is the safe answer.
    }
  })
}

if (require.main === module) main()

module.exports = { decide, PREFIX }
