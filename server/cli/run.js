// Finds and runs the other command-line tools the CLI drives (claude, codex,
// agy, npm). npm installs Node-based tools on Windows as .cmd shims, which Node
// only starts through cmd.exe, so those go through a shell with quoted arguments.

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function envValue(env, name) {
  const key = Object.keys(env).find(candidate => candidate.toUpperCase() === name)
  return key ? env[key] : undefined
}

// The first match on PATH. On Windows only files with a PATHEXT extension
// count: npm also writes an extensionless shell script there, which cmd.exe
// cannot run.
function which(command, env = process.env, platform = process.platform) {
  const dirs = (envValue(env, 'PATH') || '').split(path.delimiter).filter(Boolean)
  const extensions = platform === 'win32'
    ? (envValue(env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : ['']
  for (const dir of dirs) {
    for (const extension of extensions) {
      const file = path.join(dir, command + extension)
      try {
        if (fs.statSync(file).isFile()) return file
      } catch {}
    }
  }
  return null
}

// Quotes one argument for a cmd.exe command line that starts a Node program.
// Inside quotes cmd.exe leaves &, |, <, > and ^ alone. The program then splits
// its command line by the C runtime's rules, where backslashes just before the
// closing quote would escape it, so a trailing run of them is doubled. Nothing
// stops cmd.exe from expanding %NAME% inside quotes; the arguments the CLI
// passes are paths and plugin names, which do not hold one in practice.
function quoteForCmd(arg) {
  const text = String(arg)
  if (/^[\w@+=:,./\\-]+$/.test(text)) return text
  return `"${text.replace(/"/g, '""').replace(/(\\+)$/, '$1$1')}"`
}

// Runs a tool found on PATH. Returns { missing: true } when there is none, so
// a caller can skip a client that is not installed.
function run(command, args, options = {}) {
  const env = options.env || process.env
  const file = which(command, env)
  if (!file) return { missing: true, status: null, stdout: '', stderr: '' }
  const spawnOptions = {
    env,
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    windowsHide: true,
    timeout: options.timeoutMs || 300_000,
  }
  const result = process.platform === 'win32' && /\.(cmd|bat)$/i.test(file)
    ? spawnSync([file, ...args].map(quoteForCmd).join(' '), { ...spawnOptions, shell: true })
    : spawnSync(file, args, spawnOptions)
  return {
    missing: false,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  }
}

// What a failed run printed, cut to one line for a summary.
function failure(result) {
  if (result.error) return result.error.message
  const text = `${result.stderr}\n${result.stdout}`.trim().split(/\r?\n/).filter(Boolean)
  return text.length ? text[text.length - 1] : `exit code ${result.status}`
}

// Parses a tool's --json output, tolerating log lines printed before it.
function parseJson(text) {
  const start = text.search(/[[{]/)
  if (start === -1) return null
  try {
    return JSON.parse(text.slice(start))
  } catch {
    return null
  }
}

module.exports = { which, run, failure, parseJson, quoteForCmd }
