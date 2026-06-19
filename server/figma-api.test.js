const test = require('node:test')
const assert = require('node:assert/strict')
const {
  colorToHex,
  fetchFigmaDesign,
  normalizeFigmaResponse,
  parseFigmaSource,
} = require('./figma-api')

test('parseFigmaSource accepts file keys and common Figma URLs', () => {
  assert.deepEqual(parseFigmaSource('AbC_123-x'), { fileKey: 'AbC_123-x', nodeId: null })
  assert.deepEqual(
    parseFigmaSource('https://www.figma.com/design/AbC123/Product?node-id=12-34&t=abc'),
    { fileKey: 'AbC123', nodeId: '12:34' },
  )
  assert.throws(() => parseFigmaSource('https://example.com/design/AbC123/Test'), /figma\.com/)
})

test('colorToHex clamps and converts Figma RGB channels', () => {
  assert.equal(colorToHex({ r: 1, g: 0.5, b: 0 }), '#FF8000')
  assert.equal(colorToHex({ r: 2, g: -1, b: 0 }), '#FF0000')
})

test('normalizeFigmaResponse converts a full REST file to bridge schema', () => {
  const design = normalizeFigmaResponse({
    name: 'Example File',
    lastModified: '2026-06-18T00:00:00Z',
    version: '42',
    document: {
      id: '0:0', name: 'Document', type: 'DOCUMENT', children: [{
        id: '0:1', name: 'Landing', type: 'CANVAS', children: [{
          id: '1:1', name: 'Hero', type: 'FRAME',
          absoluteBoundingBox: { x: 100, y: 200, width: 1440, height: 900 },
          relativeTransform: [[1, 0, 20], [0, 1, 30]],
          layoutMode: 'VERTICAL',
          fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }],
          children: [{
            id: '1:2', name: 'Heading', type: 'TEXT', characters: 'Hello world',
            absoluteBoundingBox: { x: 120, y: 230, width: 400, height: 60 },
            style: { fontFamily: 'Inter', fontPostScriptName: 'Inter-Bold', fontSize: 48, lineHeightPx: 58 },
            fills: [{ type: 'SOLID', color: { r: 0.1, g: 0.2, b: 0.3 } }],
          }],
        }],
      }],
    },
  }, { fileKey: 'AbC123' })

  assert.equal(design.source, 'figma-rest-api')
  assert.equal(design.pageName, 'Example File')
  assert.equal(design.nodeCount, 3)
  assert.equal(design.nodes[0].children[0].x, 20)
  assert.equal(design.nodes[0].children[0].width, 1440)
  assert.equal(design.nodes[0].children[0].fills[0].color, '#FFFFFF')
  assert.deepEqual(design.nodes[0].children[0].children[0].fontName, {
    family: 'Inter', style: 'Inter-Bold',
  })
  assert.equal(design.nodes[0].children[0].children[0].fills[0].color, '#1A334D')
})

test('normalizeFigmaResponse imports selected nodes and resolves component metadata', () => {
  const design = normalizeFigmaResponse({
    name: 'Components',
    nodes: {
      '12:34': {
        components: { '9:9': { name: 'Primary Button', key: 'component-key' } },
        document: {
          id: '12:34', name: 'Button instance', type: 'INSTANCE', componentId: '9:9',
          absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 48 },
          componentProperties: { Label: { type: 'TEXT', value: 'Continue' } },
        },
      },
    },
  }, { fileKey: 'AbC123', nodeIds: ['12:34'] })

  assert.equal(design.type, 'selection')
  assert.equal(design.pageName, 'Button instance')
  assert.deepEqual(design.nodes[0].componentRef, {
    id: '9:9', name: 'Primary Button', key: 'component-key',
  })
  assert.equal(design.nodes[0].componentProperties.Label, 'Continue')
})

test('fetchFigmaDesign uses the node endpoint and never stores the token', async () => {
  let request
  const fetchImpl = async (url, options) => {
    request = { url, options }
    return {
      ok: true,
      headers: { get: () => null },
      json: async () => ({
        name: 'Example',
        nodes: { '12:34': { document: { id: '12:34', name: 'Card', type: 'FRAME' } } },
      }),
    }
  }

  const design = await fetchFigmaDesign(
    'https://www.figma.com/design/AbC123/Test?node-id=12-34',
    { token: 'secret-token', fetchImpl },
  )

  assert.match(request.url, /\/files\/AbC123\/nodes\?ids=12%3A34$/)
  assert.equal(request.options.headers['X-Figma-Token'], 'secret-token')
  assert.equal(JSON.stringify(design).includes('secret-token'), false)
})
