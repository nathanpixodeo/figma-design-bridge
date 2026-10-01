const test = require('node:test')
const assert = require('node:assert/strict')

const createPairing = require('./pairing')

function clock(start = 1_000_000) {
  let now = start
  return { now: () => now, advance: ms => { now += ms } }
}

test('a pairing is approved by its code and hands out its approval exactly once', () => {
  const pairing = createPairing()
  const request = pairing.request({ clientName: 'Figma Design Bridge plugin', fileName: 'Checkout' })

  assert.match(request.code, /^\d{6}$/)
  assert.match(request.pairingId, /^[0-9a-f]{32}$/)
  assert.deepEqual(pairing.check(request.pairingId, request.pairingSecret), { status: 'pending', expiresAt: request.expiresAt })
  assert.deepEqual(pairing.stats(), { pending: 1 })

  const spaced = `${request.code.slice(0, 3)} ${request.code.slice(3)}`
  assert.deepEqual(pairing.approve(spaced), { clientName: 'Figma Design Bridge plugin', fileName: 'Checkout' })
  assert.deepEqual(pairing.stats(), { pending: 0 })

  assert.equal(pairing.check(request.pairingId, request.pairingSecret).status, 'approved')
  assert.throws(() => pairing.check(request.pairingId, request.pairingSecret), { code: 'PAIRING_NOT_FOUND' })
})

test('only the requester holding the pairing secret can collect it', () => {
  const pairing = createPairing()
  const request = pairing.request()
  pairing.approve(request.code)

  assert.throws(() => pairing.check(request.pairingId, 'ab'.repeat(32)), { code: 'UNAUTHORIZED' })
  assert.throws(() => pairing.check(request.pairingId, 'not-hex'), { code: 'UNAUTHORIZED' })
  assert.equal(pairing.check(request.pairingId, request.pairingSecret).status, 'approved')
})

test('codes expire, and an expired code can no longer be approved', () => {
  const time = clock()
  const pairing = createPairing({ ttlMs: 120_000, now: time.now })
  const request = pairing.request()

  time.advance(120_001)
  assert.throws(() => pairing.approve(request.code), { code: 'PAIRING_NOT_FOUND' })
  assert.equal(pairing.check(request.pairingId, request.pairingSecret).status, 'expired')
  assert.throws(() => pairing.check(request.pairingId, request.pairingSecret), { code: 'PAIRING_NOT_FOUND' })
})

test('an approval nobody collects is forgotten after a minute', () => {
  const time = clock()
  const pairing = createPairing({ now: time.now })
  const request = pairing.request()
  pairing.approve(request.code)

  time.advance(60_001)
  pairing.stats()
  assert.throws(() => pairing.check(request.pairingId, request.pairingSecret), { code: 'PAIRING_NOT_FOUND' })
})

test('wrong or malformed codes are refused', () => {
  const pairing = createPairing()
  const request = pairing.request()
  const other = String((Number(request.code) + 1) % 1_000_000).padStart(6, '0')

  assert.throws(() => pairing.approve(other), { code: 'PAIRING_NOT_FOUND' })
  for (const bad of ['', '12345', '1234567', 'abcdef', null]) {
    assert.throws(() => pairing.approve(bad), { code: 'BAD_REQUEST' }, String(bad))
  }
  assert.equal(pairing.check(request.pairingId, request.pairingSecret).status, 'pending')
})

test('pending pairings and the request rate are bounded', () => {
  const time = clock()
  const pairing = createPairing({ maxPending: 2, maxPerMinute: 3, now: time.now })
  const first = pairing.request()
  pairing.request()
  assert.throws(() => pairing.request(), { code: 'PAIRING_LIMIT' })

  pairing.approve(first.code)
  pairing.request()
  assert.throws(() => pairing.request(), { code: 'PAIRING_LIMIT' }, 'four requests inside one minute')

  time.advance(180_000)
  assert.doesNotThrow(() => pairing.request())
})
