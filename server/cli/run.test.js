const { test } = require('node:test')
const assert = require('node:assert/strict')

const { quoteForCmd, parseJson } = require('./run')

test('quoteForCmd leaves plain arguments alone and quotes the rest for cmd.exe', () => {
  assert.equal(quoteForCmd('figma-bridge@figma-design-bridge'), 'figma-bridge@figma-design-bridge')
  assert.equal(quoteForCmd('C:\\Users\\me\\pkg\\'), 'C:\\Users\\me\\pkg\\')
  assert.equal(quoteForCmd('C:\\pkg & co'), '"C:\\pkg & co"')
  assert.equal(quoteForCmd('say "hi"'), '"say ""hi"""')
  // A trailing backslash would escape the closing quote.
  assert.equal(quoteForCmd('C:\\Program Files\\'), '"C:\\Program Files\\\\"')
  assert.equal(quoteForCmd(''), '""')
})

test('parseJson skips log lines printed before the JSON', () => {
  assert.deepEqual(parseJson('Loading...\n[{"name":"a"}]'), [{ name: 'a' }])
  assert.equal(parseJson('no json here'), null)
  assert.equal(parseJson('{ broken'), null)
})
