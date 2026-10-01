const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const createLegacyRoutes = require('./legacy-routes')
const createSnapshotStore = require('./snapshot-store')

// Access control on these routes is covered end to end by legacy-auth.test.js,
// which runs server/index.js. These tests drive the module directly.

const TOKEN = 'a'.repeat(64)

async function withRoutes(t, store) {
  const handler = createLegacyRoutes({ store, token: TOKEN, fetchFigmaDesign: async () => { throw new Error('not used') } })
  const server = http.createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(() => resolve())))
  return server.address().port
}

// Sends the body as separate writes, so it reaches the server as several chunks.
function post(port, path, parts) {
  return new Promise((resolve, reject) => {
    const length = parts.reduce((sum, part) => sum + part.length, 0)
    const req = http.request({
      host: '127.0.0.1', port, method: 'POST', path,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'content-length': length },
    }, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }))
    })
    req.on('error', reject)
    ;(async () => {
      for (const part of parts.slice(0, -1)) {
        req.write(part)
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      req.end(parts[parts.length - 1])
    })()
  })
}

test('a sync split inside a multi-byte character is stored intact', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-routes-'))
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }))
  const store = createSnapshotStore({ dataDir })
  const port = await withRoutes(t, store)

  const text = 'Đặt hàng — “ngay” 🎨'
  const body = Buffer.from(JSON.stringify({ pageName: 'Checkout', nodes: [{ id: '1:1', name: text, type: 'TEXT', characters: text }], nodeCount: 1 }))
  const cut = body.indexOf(Buffer.from('Đ')) + 1

  const res = await post(port, '/design', [body.subarray(0, cut), body.subarray(cut)])
  assert.equal(res.status, 200)
  assert.equal(store.getCurrent().nodes[0].characters, text)
  assert.equal(createSnapshotStore({ dataDir }).getCurrent().nodes[0].name, text)
})

test('a sync that cannot be saved is a 500, not a payload-size 413', async t => {
  const failingStore = {
    dataDir: os.tmpdir(),
    getCurrent: () => null,
    list: () => [],
    save() {
      const error = new Error('no space left on device')
      error.code = 'ENOSPC'
      throw error
    },
  }
  const port = await withRoutes(t, failingStore)

  const res = await post(port, '/design', [Buffer.from(JSON.stringify({ pageName: 'P', nodes: [], nodeCount: 0 }))])
  assert.equal(res.status, 500)
  assert.match(res.body.error, /ENOSPC/)
})
