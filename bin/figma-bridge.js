#!/usr/bin/env node
// The figma-bridge command that npm puts on PATH. See server/cli/index.js.

const { main } = require('../server/cli/index.js')

main().then(
  code => {
    if (code !== undefined) process.exitCode = code
  },
  error => {
    process.stderr.write(`figma-bridge: ${error.stack || error.message}\n`)
    process.exitCode = 1
  },
)
