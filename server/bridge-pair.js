#!/usr/bin/env node
// Approves a Figma plugin that asked to pair, from the terminal:
//
//   figma-bridge pair 482913
//
// The code is the one the plugin shows after "Pair with bridge". Approving it
// hands that plugin the bridge token, so only approve a code you see in Figma.
// The token is read from the same data directory the server uses, or from
// FIGMA_BRIDGE_TOKEN; FIGMA_BRIDGE_URL overrides the bridge address.

const { readToken } = require('./bridge/token')
const { normalizeCode } = require('./bridge/pairing')
const { prepareDataDir, readConfig } = require('./data-dir')

function resolvePort(env = process.env) {
  if (env.FIGMA_BRIDGE_PORT) return env.FIGMA_BRIDGE_PORT
  const { port } = readConfig()
  return port ? String(port) : '3456'
}

async function main() {
  const code = normalizeCode(process.argv.slice(2).join(''))
  if (!code) {
    process.stderr.write('Usage: figma-bridge pair <the 6-digit code shown in the Figma plugin>\n')
    process.exit(2)
  }

  const { dataDir } = prepareDataDir({ log: message => process.stderr.write(`${message}\n`) })
  const stored = readToken(dataDir)
  const token = (process.env.FIGMA_BRIDGE_TOKEN || (stored && stored.token) || '').trim()
  if (!token) {
    process.stderr.write(`No bridge token in ${dataDir}. Start the bridge once (open Claude Code with the figma-bridge plugin, or run figma-bridge start), or set FIGMA_BRIDGE_DATA_DIR to the directory it uses.\n`)
    process.exit(1)
  }

  const base = (process.env.FIGMA_BRIDGE_URL || `http://127.0.0.1:${resolvePort()}`).replace(/\/+$/, '')
  let response
  try {
    response = await fetch(`${base}/bridge/pair/approve`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
  } catch (error) {
    process.stderr.write(`Could not reach the bridge at ${base}: ${error.cause?.code || error.message}. Is it running?\n`)
    process.exit(1)
  }

  const body = await response.json().catch(() => ({}))
  if (response.status === 401) {
    process.stderr.write(`The bridge at ${base} rejected the token from ${dataDir}. It uses another data directory: it is older than 1.3.0, or it was started with FIGMA_BRIDGE_DATA_DIR. Update it, or set FIGMA_BRIDGE_DATA_DIR to that directory.\n`)
    process.exit(1)
  }
  if (!response.ok) {
    process.stderr.write(`${body.error || `Bridge returned HTTP ${response.status}`}\n`)
    process.exit(1)
  }
  process.stdout.write(`Paired the Figma plugin${body.fileName ? ` for "${body.fileName}"` : ''}. It connects by itself in a few seconds.\n`)
}

main()
