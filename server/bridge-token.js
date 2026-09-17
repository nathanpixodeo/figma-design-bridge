#!/usr/bin/env node
// Prints the bridge pairing token so it can be pasted into the Figma plugin.
//
// The token is a credential. It is written to stdout and nothing else, so it can
// be piped, and it is never logged by the server itself. `--rotate` replaces it,
// which invalidates every paired plugin and every stored copy.

const { getOrCreateToken, rotateToken } = require('./bridge/token')
const { resolveDataDir } = require('./data-dir')

function main() {
  const rotate = process.argv.includes('--rotate')
  const dataDir = resolveDataDir()
  const result = rotate ? rotateToken(dataDir) : getOrCreateToken(dataDir)

  if (rotate) {
    process.stderr.write('Token rotated. Every paired plugin has to be reconnected with the new one.\n')
  } else if (result.created) {
    process.stderr.write(`Created a new token in ${dataDir}\n`)
  }
  process.stderr.write('Paste this into the Figma plugin. Do not commit it or share it.\n')
  process.stdout.write(`${result.token}\n`)
}

main()
