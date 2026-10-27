const test = require('node:test')
const assert = require('node:assert/strict')
const { cssColor, fillsBackground, imagePlacement, linearGradient, radialGradient, conicGradient } = require('./paint-css')

const BLACK = { r: 0, g: 0, b: 0 }
const WHITE = { r: 1, g: 1, b: 1 }
const fade = [{ position: 0, color: { ...BLACK, a: 1 } }, { position: 1, color: { ...WHITE, a: 0 } }]
const url = 'url("bg.png")'

test('cssColor gives hex when opaque and rgba otherwise', () => {
  assert.equal(cssColor({ r: 16 / 255, g: 16 / 255, b: 20 / 255 }), '#101014')
  assert.equal(cssColor(WHITE, 0.456), 'rgba(255, 255, 255, 0.46)')
  assert.equal(cssColor({ r: 2, g: -1, b: 0.5 }, 3), '#FF0080', 'channels and alpha are clamped')
})

test('imagePlacement draws FILL as cover, FIT as contain and TILE at its scale', () => {
  const box = { width: 300, height: 200 }
  assert.equal(imagePlacement({ scaleMode: 'FILL' }, url, box).css, `${url} center / cover no-repeat`)
  assert.equal(imagePlacement({}, url, box).css, `${url} center / cover no-repeat`)
  assert.equal(imagePlacement({ scaleMode: 'FIT' }, url, box).css, `${url} center / contain no-repeat`)
  assert.equal(imagePlacement({ scaleMode: 'TILE', scalingFactor: 0.5 }, url, box, { width: 64, height: 40 }).css,
    `${url} left top / 32px 20px repeat`)
  const unknown = imagePlacement({ scaleMode: 'TILE', scalingFactor: 0.5 }, url, box)
  assert.equal(unknown.css, `${url} left top repeat`)
  assert.deepEqual(unknown.notes, ['each tile is the file at 50% of its size'])
})

test('imagePlacement keeps the part of the file a CROP frames', () => {
  // A 1920x1080 slide showing the file at 1543x1234 px, 154 px above its top.
  const slide = imagePlacement({ scaleMode: 'CROP', imageTransform: [[1920 / 1543, 0, 0], [0, 1080 / 1234, 154 / 1234]] }, url,
    { width: 1920, height: 1080 })
  assert.equal(slide.css, `${url} 0% 100% / 80.36% 114.26% no-repeat`)
  assert.equal(slide.img, 'left: 0%; top: -14.26%; width: 80.36%; height: 114.26%')
  assert.equal(slide.exact, true)

  // As wide as its layer, the file is moved in px: a percent cannot move it.
  const band = imagePlacement({ scaleMode: 'CROP', imageTransform: [[1, 0, 0.1], [0, 0.5, 0.25]] }, url, { width: 400, height: 100 })
  assert.equal(band.css, `${url} -40px 50% / 100% 200% no-repeat`)

  const turned = imagePlacement({ scaleMode: 'CROP', imageTransform: [[0, 1, 0], [-1, 0, 1]] }, url, { width: 10, height: 10 })
  assert.equal(turned.exact, false)
  assert.match(turned.notes[0], /rotates or flips/)
})

test('imagePlacement names what CSS cannot draw', () => {
  const placed = imagePlacement({ scaleMode: 'FILL', rotation: 90, opacity: 0.5, filters: { exposure: 0, contrast: 0.3 } }, url,
    { width: 10, height: 10 })
  assert.equal(placed.exact, false)
  assert.deepEqual(placed.notes, [
    'the image is turned 90 degrees: turn the file itself',
    'filters contrast 0.3 change its colors, and CSS filters only come close',
    'the image is at opacity 0.5, which a CSS background cannot set: draw it in its own layer, such as ::before, with that opacity',
  ])
})

test('linearGradient runs across the lines of equal color, on any layer shape', () => {
  const box = { width: 200, height: 100 }
  assert.equal(linearGradient({ gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: fade }, box).css,
    'linear-gradient(90deg, #000000 0%, rgba(255, 255, 255, 0) 100%)')
  // Figma's default: top to bottom.
  assert.equal(linearGradient({ gradientTransform: [[0, 1, 0], [-1, 0, 1]], gradientStops: fade }, box).css,
    'linear-gradient(180deg, #000000 0%, rgba(255, 255, 255, 0) 100%)')
  // Corner to corner, as CSS "to bottom right" draws it.
  assert.equal(linearGradient({ gradientTransform: [[0.5, 0.5, 0], [-0.5, 0.5, 0.5]], gradientStops: fade }, box).css,
    'linear-gradient(153.43deg, #000000 0%, rgba(255, 255, 255, 0) 100%)')
  // The middle third of the layer, with the paint at half opacity.
  assert.equal(linearGradient({ gradientTransform: [[3, 0, -1], [0, 1, 0]], gradientStops: fade, opacity: 0.5 }, box).css,
    'linear-gradient(90deg, rgba(0, 0, 0, 0.5) 33.33%, rgba(255, 255, 255, 0) 66.67%)')
})

test('radialGradient and conicGradient place their center and axes', () => {
  const box = { width: 200, height: 100 }
  assert.deepEqual(radialGradient({ gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: fade }, box), {
    css: 'radial-gradient(50% 50% at 50% 50%, #000000 0%, rgba(255, 255, 255, 0) 100%)', exact: true,
  })
  // Centered on the top left corner, with a radius of a quarter of the layer.
  assert.equal(radialGradient({ gradientTransform: [[2, 0, 0.5], [0, 2, 0.5]], gradientStops: fade }, box).css,
    'radial-gradient(25% 25% at 0% 0%, #000000 0%, rgba(255, 255, 255, 0) 100%)')
  const turned = radialGradient({ gradientTransform: [[0.7, 0.7, -0.2], [-1.4, 1.4, 0.5]], gradientStops: fade }, box)
  assert.equal(turned.exact, false)

  const square = { width: 100, height: 100 }
  assert.equal(conicGradient({ gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: fade }, square).css,
    'conic-gradient(from 90deg at 50% 50%, #000000 0%, rgba(255, 255, 255, 0) 100%)')
  // Mirrored, it turns the other way: the stops are reversed.
  assert.equal(conicGradient({ gradientTransform: [[1, 0, 0], [0, -1, 1]], gradientStops: fade }, square).css,
    'conic-gradient(from 90deg at 50% 50%, rgba(255, 255, 255, 0) 0%, #000000 100%)')
})

test('fillsBackground stacks fills top first, with the bottom solid as the color', () => {
  const box = { width: 1920, height: 1080 }
  const fills = [
    { type: 'SOLID', blendMode: 'NORMAL', color: { r: 16 / 255, g: 16 / 255, b: 20 / 255, a: 1 } },
    { type: 'IMAGE', blendMode: 'NORMAL', imageRef: 'bg', scaleMode: 'CROP', imageTransform: [[1920 / 1543, 0, 0], [0, 1080 / 1234, 154 / 1234]] },
    { type: 'SOLID', blendMode: 'MULTIPLY', color: { ...WHITE, a: 1 }, opacity: 0.2 },
    { type: 'GRADIENT_LINEAR', blendMode: 'NORMAL', gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: fade },
  ]
  const urlFor = hash => `url("${hash}.png")`
  const stacked = fillsBackground(fills, box, { urlFor, imageFor: () => null })
  assert.equal(stacked.css, 'background: linear-gradient(90deg, #000000 0%, rgba(255, 255, 255, 0) 100%), '
    + 'linear-gradient(rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0.2)), '
    + 'url("bg.png") 0% 100% / 80.36% 114.26% no-repeat, #101014; '
    + 'background-blend-mode: normal, multiply, normal;')
  assert.equal(stacked.exact, true)

  const diamond = fillsBackground([
    { type: 'IMAGE', imageRef: 'bg', scaleMode: 'FILL' },
    { type: 'GRADIENT_DIAMOND', gradientTransform: [[1, 0, 0], [0, 1, 0]], gradientStops: fade },
    { type: 'SOLID', blendMode: 'LINEAR_BURN', color: BLACK },
  ], box, { urlFor, imageFor: () => null })
  assert.equal(diamond.css, 'background: linear-gradient(#000000, #000000), url("bg.png") center / cover no-repeat;')
  assert.equal(diamond.exact, false)
  assert.deepEqual(diamond.notes, ['blend mode LINEAR_BURN has no CSS equivalent', 'a diamond gradient has no CSS equivalent and is left out'])
})
