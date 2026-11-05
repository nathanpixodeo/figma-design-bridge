const test = require('node:test')
const assert = require('node:assert/strict')

const { createClient } = require('./client.js')

// Answers every request with answer(body), and records what was sent.
function fakeBridge(answer) {
  const calls = []
  const fetchImpl = async (url, init) => {
    const body = init.body === undefined ? undefined : JSON.parse(init.body)
    calls.push({ url, method: init.method, body })
    const [status, payload] = answer(body)
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) }
  }
  return { calls, client: createClient({ url: 'http://127.0.0.1:3456', token: 'test-token', fetchImpl }) }
}

test('a read sends fresh only when it is asked for', async () => {
  const { calls, client } = fakeBridge(() => [200, { mode: 'live' }])
  await client.read({ source: 'FILE1' })
  await client.read({ source: 'FILE1', fresh: false })
  await client.read({ source: 'FILE1', fresh: true })
  assert.deepEqual(calls.map(call => call.body.fresh), [undefined, undefined, true])
})

test('a bridge too old to know fresh is asked again without it', async () => {
  const { calls, client } = fakeBridge(body => (body.fresh === undefined
    ? [200, { mode: 'live' }]
    : [400, { code: 'BAD_REQUEST', error: 'Unknown field "fresh"' }]))
  const result = await client.read({ source: 'FILE1', options: { depth: 2 }, fresh: true })
  assert.deepEqual(result, { mode: 'live' })
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1].body, { source: 'FILE1', options: { depth: 2 } })
})

test('any other refusal of a read is not retried', async () => {
  const { calls, client } = fakeBridge(() => [400, { code: 'BAD_REQUEST', error: 'Option "depth" must be an integer between 0 and 50' }])
  await assert.rejects(client.read({ source: 'FILE1', fresh: true }), error => error.code === 'BAD_REQUEST' && /depth/.test(error.message))
  assert.equal(calls.length, 1)
})

test('a read sends queueWaitMs only when it waits', async () => {
  const { calls, client } = fakeBridge(() => [200, { mode: 'live' }])
  await client.read({ source: 'FILE1' })
  await client.read({ source: 'FILE1', queueWaitMs: 0 })
  await client.read({ source: 'FILE1', queueWaitMs: 60000 })
  assert.deepEqual(calls.map(call => call.body.queueWaitMs), [undefined, undefined, 60000])
})

test('a bridge too old to know queueWaitMs or fresh is asked again without each, one at a time', async () => {
  const { calls, client } = fakeBridge(body => {
    if (body.queueWaitMs !== undefined) return [400, { code: 'BAD_REQUEST', error: 'Unknown field "queueWaitMs"' }]
    if (body.fresh !== undefined) return [400, { code: 'BAD_REQUEST', error: 'Unknown field "fresh"' }]
    return [200, { mode: 'live' }]
  })
  const result = await client.read({ source: 'FILE1', timeoutMs: 1000, fresh: true, queueWaitMs: 60000 })
  assert.deepEqual(result, { mode: 'live' })
  assert.equal(calls.length, 3)
  assert.deepEqual(calls[2].body, { source: 'FILE1', timeoutMs: 1000 })
})
