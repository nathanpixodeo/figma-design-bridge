// Thin HTTP client for the shared bridge daemon.
//
// This is what an MCP adapter uses instead of owning its own HTTP server and
// its own store. It has no dependencies, keeps no state and never logs: the
// bridge token passes through in an Authorization header and nowhere else.

const DEFAULT_TIMEOUT_MS = 60_000

class BridgeClientError extends Error {
  constructor(message, { code, status, details } = {}) {
    super(message)
    this.name = 'BridgeClientError'
    this.code = code || 'BRIDGE_ERROR'
    this.status = status || null
    this.details = details || null
  }
}

function normalizeBase(url) {
  const parsed = new URL(String(url))
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('The bridge URL must be an http(s) URL')
  }
  return `${parsed.protocol}//${parsed.host}`
}

function causeCode(error, depth = 0) {
  if (!error || depth > 4) return null
  if (typeof error.code === 'string') return error.code
  if (error.cause) return causeCode(error.cause, depth + 1)
  if (Array.isArray(error.errors) && error.errors.length) return causeCode(error.errors[0], depth + 1)
  return null
}

function createClient(options = {}) {
  const {
    url,
    token = null,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  if (!url) throw new Error('createClient requires a bridge url')
  if (typeof fetchImpl !== 'function') throw new Error('createClient requires a fetch implementation')
  const base = normalizeBase(url)

  async function send(method, path, { body, auth = true, signal, timeout = timeoutMs } = {}) {
    const headers = { accept: 'application/json' }
    if (auth) {
      if (!token) throw new BridgeClientError('No bridge token configured', { code: 'NO_TOKEN' })
      headers.authorization = `Bearer ${token}`
    }
    if (body !== undefined) headers['content-type'] = 'application/json'

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    const onAbort = () => controller.abort()
    if (signal) signal.addEventListener('abort', onAbort, { once: true })

    let response
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      const code = error && error.name === 'AbortError' ? 'TIMEOUT' : (causeCode(error) || 'UNREACHABLE')
      throw new BridgeClientError(
        `Could not reach the Figma bridge at ${base}: ${error.message}`,
        { code: code === 'ECONNREFUSED' ? 'UNREACHABLE' : code },
      )
    } finally {
      clearTimeout(timer)
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    const text = await response.text()
    let payload = null
    if (text.trim()) {
      try { payload = JSON.parse(text) } catch { payload = null }
    }

    if (!response.ok) {
      const code = payload && typeof payload.code === 'string' ? payload.code : `HTTP_${response.status}`
      const message = (payload && typeof payload.error === 'string' && payload.error)
        || `Bridge request failed with HTTP ${response.status}`
      // The server's own code is preserved so callers can still tell
      // NO_SESSION_FOR_FILE from TIMEOUT, SESSION_LOST and NODE_NOT_FOUND.
      throw new BridgeClientError(message, { code, status: response.status, details: payload })
    }

    if (payload === null) {
      throw new BridgeClientError('The bridge returned a non-JSON response', {
        code: 'INVALID_RESPONSE',
        status: response.status,
      })
    }
    return payload
  }

  return {
    url: base,

    // Unauthenticated identity probe.
    health({ timeout } = {}) {
      return send('GET', '/bridge/health', { auth: false, timeout: timeout || 5000 })
    },

    status({ signal } = {}) {
      return send('GET', '/bridge/status', { signal })
    },

    read({ source, options: readOptions, mode, timeoutMs: readTimeoutMs, signal } = {}) {
      const body = { source }
      if (readOptions !== undefined) body.options = readOptions
      if (mode !== undefined) body.mode = mode
      if (readTimeoutMs !== undefined) body.timeoutMs = readTimeoutMs
      // Give the server room to hit its own deadline before the socket does.
      const timeout = readTimeoutMs ? readTimeoutMs + 5000 : timeoutMs
      return send('POST', '/bridge/read', { body, signal, timeout })
    },
  }
}

module.exports = createClient
module.exports.createClient = createClient
module.exports.BridgeClientError = BridgeClientError
