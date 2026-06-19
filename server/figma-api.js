const FIGMA_API_BASE = 'https://api.figma.com/v1'
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_DEPTH = 30

function parseFigmaSource(source) {
  if (typeof source !== 'string' || !source.trim()) {
    throw new Error('A Figma file URL or file key is required')
  }

  const value = source.trim()
  if (!value.includes('://')) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid Figma file key')
    return { fileKey: value, nodeId: null }
  }

  let url
  try { url = new URL(value) } catch { throw new Error('Invalid Figma URL') }
  if (url.hostname !== 'figma.com' && !url.hostname.endsWith('.figma.com')) {
    throw new Error('URL must point to figma.com')
  }

  const match = url.pathname.match(/^\/(?:design|file|proto|board|slides)\/([^/]+)/i)
  if (!match) throw new Error('Could not find a Figma file key in the URL')

  return {
    fileKey: decodeURIComponent(match[1]),
    nodeId: normalizeNodeId(url.searchParams.get('node-id')),
  }
}

function normalizeNodeId(nodeId) {
  if (nodeId === undefined || nodeId === null || nodeId === '') return null
  const value = String(nodeId).trim()
  return /^\d+-\d+$/.test(value) ? value.replace('-', ':') : value
}

function colorToHex(color) {
  if (!color || typeof color !== 'object') return null
  const channel = value => Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 255)
    .toString(16).padStart(2, '0')
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`.toUpperCase()
}

function normalizePaint(paint) {
  if (!paint || paint.visible === false || !paint.type) return null
  const normalized = { type: paint.type }

  if (paint.type === 'SOLID') {
    normalized.color = colorToHex(paint.color)
  } else if (paint.type.startsWith('GRADIENT_')) {
    normalized.gradientStops = (paint.gradientStops || []).map(stop => ({
      position: stop.position,
      color: colorToHex(stop.color),
      opacity: stop.color?.a,
    }))
    if (paint.gradientHandlePositions) normalized.gradientHandlePositions = paint.gradientHandlePositions
  } else if (paint.type === 'IMAGE') {
    normalized.imageHash = paint.imageRef || null
    normalized.scaleMode = paint.scaleMode
    if (paint.imageTransform) normalized.imageTransform = paint.imageTransform
  }

  if (paint.opacity !== undefined && paint.opacity < 1) normalized.opacity = paint.opacity
  if (paint.blendMode && paint.blendMode !== 'NORMAL') normalized.blendMode = paint.blendMode
  return normalized
}

function copyDefined(target, source, properties) {
  for (const property of properties) {
    if (source[property] !== undefined && source[property] !== null) target[property] = source[property]
  }
}

function normalizeFigmaNode(node, context = {}, depth = 0) {
  if (!node || typeof node !== 'object') return null
  if (depth > MAX_DEPTH) {
    return { id: node.id, name: node.name, type: node.type, truncated: true }
  }

  const result = { id: node.id, name: node.name, type: node.type }
  const box = node.absoluteBoundingBox || node.absoluteRenderBounds
  const transform = node.relativeTransform

  if (Array.isArray(transform) && transform[0] && transform[1]) {
    result.x = Math.round(transform[0][2] || 0)
    result.y = Math.round(transform[1][2] || 0)
  } else if (box) {
    result.x = Math.round(box.x || 0)
    result.y = Math.round(box.y || 0)
  }
  if (box) {
    result.width = Math.round(box.width || 0)
    result.height = Math.round(box.height || 0)
  }

  copyDefined(result, node, [
    'rotation', 'opacity', 'visible', 'locked', 'clipsContent', 'blendMode',
    'cornerRadius', 'rectangleCornerRadii', 'strokeWeight', 'strokeAlign',
    'strokeCap', 'strokeJoin', 'dashPattern', 'layoutMode', 'layoutWrap',
    'primaryAxisAlignItems', 'counterAxisAlignItems', 'primaryAxisSizingMode',
    'counterAxisSizingMode', 'paddingLeft', 'paddingRight', 'paddingTop',
    'paddingBottom', 'itemSpacing', 'itemReverseZIndex', 'strokesIncludedInLayout',
    'layoutGrow', 'layoutAlign', 'layoutPositioning', 'minWidth', 'maxWidth',
    'minHeight', 'maxHeight', 'sectionContentsHidden', 'expanded',
  ])

  if (node.type === 'TEXT') {
    const style = node.style || {}
    result.characters = node.characters || ''
    copyDefined(result, style, [
      'fontSize', 'textAlignHorizontal', 'textAlignVertical', 'textCase',
      'textDecoration', 'paragraphSpacing', 'paragraphIndent',
    ])
    if (style.fontFamily || style.fontPostScriptName || style.fontWeight) {
      result.fontName = {
        family: style.fontFamily || null,
        style: style.fontPostScriptName || (style.fontWeight ? String(style.fontWeight) : null),
      }
    }
    if (style.lineHeightPx !== undefined) result.lineHeight = { unit: 'PIXELS', value: style.lineHeightPx }
    if (style.letterSpacing !== undefined) result.letterSpacing = { unit: 'PIXELS', value: style.letterSpacing }
  }

  const fills = Array.isArray(node.fills) ? node.fills.map(normalizePaint).filter(Boolean) : []
  const strokes = Array.isArray(node.strokes) ? node.strokes.map(normalizePaint).filter(Boolean) : []
  if (fills.length) result.fills = fills
  if (strokes.length) result.strokes = strokes

  if (Array.isArray(node.effects)) {
    const effects = node.effects.filter(effect => effect.visible !== false).map(effect => {
      const normalized = { type: effect.type }
      copyDefined(normalized, effect, ['radius', 'spread', 'blendMode'])
      if (effect.offset) normalized.offset = effect.offset
      if (effect.color) {
        normalized.color = colorToHex(effect.color)
        if (effect.color.a !== undefined && effect.color.a < 1) normalized.opacity = effect.color.a
      }
      return normalized
    })
    if (effects.length) result.effects = effects
  }

  if (node.type === 'INSTANCE' && node.componentId) {
    const component = context.components?.[node.componentId]
    result.componentRef = {
      id: node.componentId,
      name: component?.name || null,
      key: component?.key || null,
    }
    if (node.componentProperties) {
      result.componentProperties = Object.fromEntries(Object.entries(node.componentProperties)
        .map(([key, property]) => [key, property?.value ?? property]))
    }
  }

  if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && node.componentPropertyDefinitions) {
    result.componentPropertyDefinitions = node.componentPropertyDefinitions
  }
  if (node.styles && Object.keys(node.styles).length) result.styleRefs = node.styles

  if (Array.isArray(node.children) && node.children.length) {
    result.children = node.children
      .map(child => normalizeFigmaNode(child, context, depth + 1))
      .filter(Boolean)
  }
  return result
}

function countNodes(nodes) {
  let count = 0
  for (const node of nodes || []) {
    count += 1
    if (node.children) count += countNodes(node.children)
  }
  return count
}

function normalizeFigmaResponse(data, { fileKey, nodeIds = [] } = {}) {
  if (!data || typeof data !== 'object') throw new Error('Figma returned an empty response')

  const context = { components: { ...(data.components || {}) } }
  let sourceNodes

  if (nodeIds.length) {
    sourceNodes = []
    for (const nodeId of nodeIds) {
      const entry = data.nodes?.[nodeId] || data.nodes?.[normalizeNodeId(nodeId)] || data.nodes?.[nodeId.replace(':', '-')]
      if (!entry?.document) throw new Error(`Figma node not found or inaccessible: ${nodeId}`)
      Object.assign(context.components, entry.components || {})
      sourceNodes.push(entry.document)
    }
  } else if (data.document) {
    sourceNodes = data.document.type === 'DOCUMENT' ? data.document.children || [] : [data.document]
  } else {
    throw new Error('Figma response does not contain a document')
  }

  const nodes = sourceNodes.map(node => normalizeFigmaNode(node, context)).filter(Boolean)
  const selectedName = sourceNodes.length === 1 ? sourceNodes[0].name : null
  return {
    type: nodeIds.length ? 'selection' : 'file',
    source: 'figma-rest-api',
    fileKey,
    fileName: data.name || null,
    pageName: (nodeIds.length ? selectedName : data.name) || data.name || 'Figma Design',
    nodes,
    nodeCount: countNodes(nodes),
    selectionCount: nodeIds.length || undefined,
    requestedNodeIds: nodeIds.length ? nodeIds : undefined,
    syncedAt: new Date().toISOString(),
    lastModified: data.lastModified,
    version: data.version,
    editorType: data.editorType,
  }
}

async function fetchFigmaDesign(source, options = {}) {
  const parsed = parseFigmaSource(source)
  const token = options.token || process.env.FIGMA_ACCESS_TOKEN || process.env.FIGMA_TOKEN
  if (!token) {
    throw new Error('Missing FIGMA_ACCESS_TOKEN (a personal access token with file_content:read scope)')
  }

  const requestedNodeIds = Array.isArray(options.nodeIds)
    ? options.nodeIds
    : options.nodeIds ? [options.nodeIds] : [parsed.nodeId]
  const nodeIds = requestedNodeIds
    .filter(Boolean).map(normalizeNodeId)
  const path = nodeIds.length
    ? `/files/${encodeURIComponent(parsed.fileKey)}/nodes?ids=${encodeURIComponent(nodeIds.join(','))}`
    : `/files/${encodeURIComponent(parsed.fileKey)}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS)

  let response
  try {
    response = await (options.fetchImpl || fetch)(`${FIGMA_API_BASE}${path}`, {
      headers: { 'X-Figma-Token': token },
      signal: controller.signal,
    })
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Figma API request timed out')
    throw new Error(`Could not reach Figma API: ${error.message}`)
  } finally {
    clearTimeout(timeout)
  }

  let data
  try { data = await response.json() } catch { data = null }
  if (!response.ok) {
    const details = data?.err || data?.message || response.statusText
    const retryAfter = response.headers.get('retry-after')
    const suffix = retryAfter ? ` Retry after ${retryAfter} seconds.` : ''
    throw new Error(`Figma API ${response.status}: ${details || 'Request failed'}.${suffix}`)
  }

  return normalizeFigmaResponse(data, { fileKey: parsed.fileKey, nodeIds })
}

module.exports = {
  colorToHex,
  countNodes,
  fetchFigmaDesign,
  normalizeFigmaNode,
  normalizeFigmaResponse,
  normalizeNodeId,
  normalizePaint,
  parseFigmaSource,
}
