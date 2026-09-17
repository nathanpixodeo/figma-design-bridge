// Resolves the data directory the way the server does, without creating or
// rewriting config.json.
//
// Several small clients need to find the same directory the running server uses:
// the token printer, the CLI importer. They must not mint a config file as a
// side effect of being run, which is why this is separate from the server's own
// loadConfig().

const fs = require('fs')
const path = require('path')

const DEFAULT_CONFIG_PATH = path.join(__dirname, 'config.json')
const DEFAULT_DATA_DIR = path.join(__dirname, 'data')

function resolveDataDir(options = {}) {
  const env = options.env || process.env
  const configPath = options.configPath || DEFAULT_CONFIG_PATH
  const fallback = options.defaultDataDir || DEFAULT_DATA_DIR

  if (env.FIGMA_BRIDGE_DATA_DIR) return env.FIGMA_BRIDGE_DATA_DIR
  try {
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
      if (config.dataDir) return config.dataDir
    }
  } catch {
    // Fall through to the default: a malformed config should not stop the
    // operator from reading their own token.
  }
  return fallback
}

module.exports = { resolveDataDir, DEFAULT_CONFIG_PATH, DEFAULT_DATA_DIR }
