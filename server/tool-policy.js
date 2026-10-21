// Which bridge tools only read, for the MCP annotations and the approvals switch.
//
// Reading a design or the bridge status changes nothing, so with approvals set
// to auto (the default) a client runs these without asking. Pairing hands a
// Figma plugin the bridge token, and a REST sync calls Figma and replaces the
// current design: those two always ask, whatever the setting.

const READ_TOOLS = Object.freeze([
  'get_design_context',
  'get_design_summary',
  'get_design_tree',
  'get_design_texts',
  'get_design_colors',
  'search_design',
  'get_design_info',
  'get_bridge_status',
])

const APPROVAL_MODES = Object.freeze(['auto', 'manual'])

// Anything but "manual" is auto: a typo must not start prompting on every read,
// and the CLI only ever writes one of the two. "Manual" or " manual" written by
// hand still means manual.
function approvalsMode(config = {}) {
  return String(config.approvals ?? '').trim().toLowerCase() === 'manual' ? 'manual' : 'auto'
}

module.exports = { READ_TOOLS, APPROVAL_MODES, approvalsMode }
