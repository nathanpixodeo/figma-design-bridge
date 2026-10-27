// Turns Figma paints into CSS backgrounds, so an agent places an image, and the
// solids and gradients stacked with it, as Figma draws them at any layer size.
//
// Figma lists a layer's fills bottom first; a CSS background list is top first,
// with the color at the bottom. Gradient and crop transforms map the layer's
// unit square (0..1 on each side) to the paint's own space.

const EPSILON = 1e-6

const round = value => Number(value.toFixed(2)) || 0
const pct = value => `${round(value * 100)}%`
const px = value => `${round(value)}px`

function cssColor(color, alpha = 1) {
  const channel = value => Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 255)
  const [r, g, b] = [channel(color?.r), channel(color?.g), channel(color?.b)]
  const a = round(Math.max(0, Math.min(1, alpha)))
  if (a >= 1) return `#${[r, g, b].map(value => value.toString(16).padStart(2, '0')).join('')}`.toUpperCase()
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

const paintOpacity = paint => (typeof paint.opacity === 'number' ? paint.opacity : 1)

// Figma's blend modes that CSS has under the same name.
const BLEND_MODES = new Set([
  'MULTIPLY', 'SCREEN', 'OVERLAY', 'DARKEN', 'LIGHTEN', 'COLOR_DODGE', 'COLOR_BURN',
  'HARD_LIGHT', 'SOFT_LIGHT', 'DIFFERENCE', 'EXCLUSION', 'HUE', 'SATURATION', 'COLOR', 'LUMINOSITY',
])

function cssBlend(mode) {
  if (!mode || mode === 'NORMAL' || mode === 'PASS_THROUGH') return { blend: 'normal' }
  if (BLEND_MODES.has(mode)) return { blend: mode.toLowerCase().replace(/_/g, '-') }
  return { blend: 'normal', note: `blend mode ${mode} has no CSS equivalent` }
}

function isMatrix(value) {
  return Array.isArray(value) && value.length === 2
    && value.every(row => Array.isArray(row) && row.length === 3 && row.every(Number.isFinite))
}

function invert([[a, b, c], [d, e, f]]) {
  const det = a * e - b * d
  if (Math.abs(det) < EPSILON) return null
  return [[e / det, -b / det, (b * f - e * c) / det], [-d / det, a / det, (d * c - a * f) / det]]
}

// A point of the paint's space, in px from the layer's top left.
function layerPoint(inverse, x, y, box) {
  return {
    x: (inverse[0][0] * x + inverse[0][1] * y + inverse[0][2]) * box.width,
    y: (inverse[1][0] * x + inverse[1][1] * y + inverse[1][2]) * box.height,
  }
}

// CSS angles start at the top and turn clockwise.
const cssAngle = (dx, dy) => ((Math.atan2(dx, -dy) * 180 / Math.PI) + 360) % 360

function stopList(paint, position) {
  const alpha = paintOpacity(paint)
  return (paint.gradientStops || [])
    .map(stop => ({ color: cssColor(stop.color, (stop.color?.a ?? 1) * alpha), at: position(stop.position) }))
    .sort((left, right) => left.at - right.at)
    .map(stop => `${stop.color} ${pct(stop.at)}`)
    .join(', ')
}

// A linear gradient's color is constant along lines where the paint's x is:
// CSS runs across them, and places each stop where the paint's x reaches it.
function linearGradient(paint, box) {
  const [[a, b, c]] = paint.gradientTransform
  const nx = a / box.width
  const ny = b / box.height
  const slope = Math.hypot(nx, ny)
  if (slope < EPSILON) return null
  const angle = cssAngle(nx, ny)
  const radians = angle * Math.PI / 180
  const line = Math.abs(box.width * Math.sin(radians)) + Math.abs(box.height * Math.cos(radians))
  const center = (a + b) / 2 + c
  const stops = stopList(paint, t => (t - center) / (slope * line) + 0.5)
  return { css: `linear-gradient(${round(angle)}deg, ${stops})`, exact: true }
}

// The paint's axes, in px: the radial and angular gradients' center and the
// points where the paint's x and y reach the edge of its unit circle.
function gradientAxes(paint, box) {
  const inverse = invert(paint.gradientTransform)
  if (!inverse) return null
  const center = layerPoint(inverse, 0.5, 0.5, box)
  const along = layerPoint(inverse, 1, 0.5, box)
  const across = layerPoint(inverse, 0.5, 1, box)
  const first = { x: along.x - center.x, y: along.y - center.y }
  const second = { x: across.x - center.x, y: across.y - center.y }
  const [one, two] = [Math.hypot(first.x, first.y), Math.hypot(second.x, second.y)]
  if (one < EPSILON || two < EPSILON) return null
  const square = Math.abs(first.x * second.x + first.y * second.y) <= 0.01 * one * two
  return { center, first, second, one, two, square, round: square && Math.abs(one - two) <= 0.01 * Math.max(one, two) }
}

function radialGradient(paint, box) {
  const axes = gradientAxes(paint, box)
  if (!axes) return null
  const { center, first, one, two } = axes
  // The ellipse's axes lie along the layer's sides, or it is a circle.
  const level = Math.abs(first.y) <= 0.01 * one
  const upright = Math.abs(first.x) <= 0.01 * one
  const [rx, ry] = upright && !level ? [two, one] : [one, two]
  const stops = stopList(paint, t => t)
  const css = `radial-gradient(${pct(rx / box.width)} ${pct(ry / box.height)} at ${pct(center.x / box.width)} ${pct(center.y / box.height)}, ${stops})`
  return { css, exact: axes.round || (axes.square && (level || upright)) }
}

function conicGradient(paint, box) {
  const axes = gradientAxes(paint, box)
  if (!axes) return null
  const { center, first, second } = axes
  const clockwise = first.x * second.y - first.y * second.x > 0
  const stops = stopList(paint, t => (clockwise ? t : 1 - t))
  const css = `conic-gradient(from ${round(cssAngle(first.x, first.y))}deg at ${pct(center.x / box.width)} ${pct(center.y / box.height)}, ${stops})`
  return { css, exact: axes.round }
}

// One axis of a cropped image: its size, and where it sits, as CSS percents
// so it scales with the layer. Percent positions cannot move an image as wide
// as its layer, so that one is placed in px.
function cropAxis(scale, offset, length) {
  const size = pct(1 / scale)
  if (Math.abs(scale - 1) < EPSILON) return { size, position: px(-offset / scale * length) }
  return { size, position: pct(-offset / (scale - 1)) }
}

// Where an image paint puts its file in the layer, as one CSS background layer
// for url(...). `image` is the file's size in px, when known.
function imagePlacement(paint, url, box, image) {
  const notes = []
  let exact = true
  let css
  let img = null
  const mode = paint.scaleMode || 'FILL'
  if (mode === 'FIT') {
    css = `${url} center / contain no-repeat`
  } else if (mode === 'TILE') {
    const factor = Number.isFinite(paint.scalingFactor) ? paint.scalingFactor : 1
    if (Number.isFinite(image?.width) && Number.isFinite(image?.height)) {
      css = `${url} left top / ${px(image.width * factor)} ${px(image.height * factor)} repeat`
    } else {
      css = `${url} left top repeat`
      notes.push(`each tile is the file at ${round(factor * 100)}% of its size`)
    }
  } else if (mode === 'CROP' && isMatrix(paint.imageTransform)) {
    const [[sx, skewX, tx], [skewY, sy, ty]] = paint.imageTransform
    if (Math.abs(skewX) > EPSILON || Math.abs(skewY) > EPSILON || sx <= 0 || sy <= 0) {
      css = `${url} center / cover no-repeat`
      exact = false
      notes.push('the crop rotates or flips the image, which a CSS background cannot do')
    } else {
      const across = cropAxis(sx, tx, box.width)
      const down = cropAxis(sy, ty, box.height)
      css = `${url} ${across.position} ${down.position} / ${across.size} ${down.size} no-repeat`
      img = `left: ${pct(-tx / sx)}; top: ${pct(-ty / sy)}; width: ${across.size}; height: ${down.size}`
    }
  } else {
    css = `${url} center / cover no-repeat`
  }
  if (paint.rotation) {
    exact = false
    notes.push(`the image is turned ${paint.rotation} degrees: turn the file itself`)
  }
  const filters = Object.entries(paint.filters || {}).filter(([, value]) => value)
  if (filters.length) {
    exact = false
    notes.push(`filters ${filters.map(([name, value]) => `${name} ${round(value)}`).join(', ')} change its colors, and CSS filters only come close`)
  }
  if (paintOpacity(paint) !== 1) {
    notes.push(`the image is at opacity ${round(paint.opacity)}, which a CSS background cannot set: draw it in its own layer, such as ::before, with that opacity`)
  }
  return { css, img, exact, notes }
}

// The whole stack of a layer's fills, bottom first as Figma lists them, as one
// CSS background declaration. `urlFor(hash)` names an image's file.
function fillsBackground(fills, box, { urlFor, imageFor }) {
  const layers = []
  const blends = []
  const notes = []
  let exact = true
  for (let index = fills.length - 1; index >= 0; index--) {
    const paint = fills[index]
    let layer = null
    if (paint.type === 'SOLID') {
      const color = cssColor(paint.color, paintOpacity(paint))
      // Only the bottom paint can be the background color.
      if (index === 0) {
        layers.push(color)
        continue
      }
      layer = { css: `linear-gradient(${color}, ${color})`, exact: true }
    } else if (paint.type === 'IMAGE') {
      layer = imagePlacement(paint, urlFor(paint.imageRef), box, imageFor(paint.imageRef))
      notes.push(...layer.notes)
    } else if (paint.type === 'VIDEO') {
      notes.push('a video fill is left out')
      continue
    } else if (isMatrix(paint.gradientTransform)) {
      const build = { GRADIENT_LINEAR: linearGradient, GRADIENT_RADIAL: radialGradient, GRADIENT_ANGULAR: conicGradient }[paint.type]
      layer = build ? build(paint, box) : null
      if (!layer) {
        exact = false
        notes.push(`a ${paint.type.replace('GRADIENT_', '').toLowerCase()} gradient has no CSS equivalent and is left out`)
        continue
      }
      if (!layer.exact) notes.push(`the ${paint.type.replace('GRADIENT_', '').toLowerCase()} gradient's ellipse is turned, so its CSS only comes close`)
    } else {
      continue
    }
    exact = exact && layer.exact
    layers.push(layer.css)
    const { blend, note } = cssBlend(paint.blendMode)
    blends.push(blend)
    if (note) {
      exact = false
      notes.push(note)
    }
  }
  if (!layers.length) return null
  let css = `background: ${layers.join(', ')};`
  if (blends.some(blend => blend !== 'normal')) css += ` background-blend-mode: ${blends.join(', ')};`
  return { css, exact, notes }
}

module.exports = {
  cssColor,
  fillsBackground,
  imagePlacement,
  linearGradient,
  radialGradient,
  conicGradient,
}
