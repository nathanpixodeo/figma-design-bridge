// The figma-bridge command. The server commands load the script they name in
// this process, with the arguments it would get when run by path, so each
// script stays runnable on its own.

const path = require('path')
const { pathToFileURL } = require('url')
const commands = require('./commands')
const { SetupError } = require('./clients')

const SERVER_DIR = path.resolve(__dirname, '..')

const SCRIPTS = {
  start: 'index.js',
  mcp: 'mcp.mjs',
  pair: 'bridge-pair.js',
  token: 'bridge-token.js',
  import: 'import-figma.mjs',
}

const HANDLERS = {
  setup: commands.setup,
  status: commands.status,
  approvals: commands.approvals,
  update: commands.update,
}

const HELP = `Figma Design Bridge ${commands.VERSION}

Usage: figma-bridge <command> [options]

Setup
  setup [--only claude,codex,agy,gemini] [--approvals auto|manual]
                       Install the plugin into Claude Code and Codex, register
                       the MCP server with agy and Gemini CLI, and create the
                       pairing token
  status               Show the install, the bridge, the token and each client
  approvals [auto|manual]
                       Show or set whether design reads ask before they run,
                       in every client on this machine
  update               Install the latest version and run setup again

Bridge
  start                Run the bridge in this terminal (REST on 127.0.0.1:3456)
  mcp                  Run the MCP server on stdio (what the clients launch)
  pair <code>          Approve the 6-digit code the Figma plugin shows
  token [--rotate]     Print the pairing token, or replace it
  import <figma-url>   Pull a design through the Figma REST API
                       (needs FIGMA_ACCESS_TOKEN)

  -v, --version        Print the version
  -h, --help           Print this help
`

async function runScript(name, args, argv) {
  const script = path.join(SERVER_DIR, SCRIPTS[name])
  argv.splice(0, argv.length, process.execPath, script, ...args)
  await import(pathToFileURL(script).href)
  return undefined
}

// Returns the exit code, or undefined when a script took over the process.
async function main(args = process.argv.slice(2), options = {}) {
  const out = options.out || (text => process.stdout.write(text))
  const err = options.err || (text => process.stderr.write(text))
  const [command, ...rest] = args

  if (!command || command === '-h' || command === '--help' || command === 'help') {
    out(HELP)
    return command ? 0 : 2
  }
  if (command === '-v' || command === '--version' || command === 'version') {
    out(`${commands.VERSION}\n`)
    return 0
  }
  if (SCRIPTS[command]) return runScript(command, rest, options.argv || process.argv)
  if (!HANDLERS[command]) {
    err(`Unknown command: ${command}\nRun figma-bridge --help for the list.\n`)
    return 2
  }
  try {
    return await HANDLERS[command](rest, options)
  } catch (error) {
    if (error instanceof commands.UsageError) {
      err(`${error.message}\n`)
      return 2
    }
    if (error instanceof SetupError) {
      err(`${error.message}\n`)
      return 1
    }
    throw error
  }
}

module.exports = { main, HELP, SCRIPTS }
