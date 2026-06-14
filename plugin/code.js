const SERVER_URL = 'http://localhost:3456'

const UI_HTML = `<div id="root"></div>
<script>
window.addEventListener('message', async (e) => {
  const msg = e.data.pluginMessage
  if (!msg || msg.type !== 'sync') return
  try {
    const res = await fetch('${SERVER_URL}/design', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg.data)
    })
    const result = await res.json()
    parent.postMessage({ pluginMessage: { type: 'done', success: true, nodeCount: msg.data.nodeCount, serverMessage: result.message } }, '*')
  } catch (err) {
    parent.postMessage({ pluginMessage: { type: 'done', success: false, error: err.message } }, '*')
  }
})
window.parent.postMessage({ pluginMessage: { type: 'ui-ready' } }, '*')
<\/script>`

function serializeNode(node, depth = 0) {
  if (depth > 30) return { id: node.id, name: node.name, type: node.type, truncated: true }

  const obj = {
    id: node.id,
    name: node.name,
    type: node.type,
  }

  if ('x' in node) obj.x = Math.round(node.x)
  if ('y' in node) obj.y = Math.round(node.y)
  if ('width' in node) obj.width = Math.round(node.width)
  if ('height' in node) obj.height = Math.round(node.height)
  if ('rotation' in node && node.rotation !== 0) obj.rotation = Math.round(node.rotation * 100) / 100
  if ('opacity' in node && node.opacity < 1) obj.opacity = Math.round(node.opacity * 100) / 100
  if ('visible' in node) obj.visible = node.visible
  if ('locked' in node && node.locked) obj.locked = true
  if ('clipsContent' in node && node.clipsContent) obj.clipsContent = true

  if ((node.type === 'RECTANGLE' || node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE' || node.type === 'ELLIPSE') && 'cornerRadius' in node && node.cornerRadius > 0) {
    obj.cornerRadius = node.cornerRadius
  }

  if (node.type === 'TEXT') {
    try {
      obj.characters = node.characters
      obj.fontSize = node.fontSize
      obj.fontName = { family: node.fontName.family, style: node.fontName.style }
      obj.textAlignHorizontal = node.textAlignHorizontal
      obj.textAlignVertical = node.textAlignVertical
      if (node.lineHeight && node.lineHeight.unit !== 'AUTO') {
        obj.lineHeight = { unit: node.lineHeight.unit, value: node.lineHeight.value }
      }
      obj.letterSpacing = node.letterSpacing
      obj.textCase = node.textCase
      obj.textDecoration = node.textDecoration
      obj.paragraphSpacing = node.paragraphSpacing
      obj.paragraphIndent = node.paragraphIndent
    } catch (e) {}
  }

  try {
    const fills = node.fills
    if (fills && fills.length > 0) {
      const visible = fills.filter(f => f.visible !== false)
      if (visible.length > 0) obj.fills = visible.map(serializePaint)
    }
  } catch (e) {}

  try {
    const strokes = node.strokes
    if (strokes && strokes.length > 0) {
      const visible = strokes.filter(s => s.visible !== false)
      if (visible.length > 0) {
        obj.strokes = visible.map(serializePaint)
        obj.strokeWeight = node.strokeWeight
        obj.strokeAlign = node.strokeAlign
        obj.strokeCap = node.strokeCap
        obj.strokeJoin = node.strokeJoin
        obj.dashPattern = node.dashPattern
      }
    }
  } catch (e) {}

  try {
    const effects = node.effects
    if (effects && effects.length > 0) {
      obj.effects = effects.filter(e => e.visible !== false).map(e => ({
        type: e.type,
        radius: e.radius,
        offset: e.offset ? { x: e.offset.x, y: e.offset.y } : undefined,
        color: e.color ? rgbToHex(e.color) : undefined,
        spread: e.spread,
      }))
    }
  } catch (e) {}

  if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
    if (node.layoutMode && node.layoutMode !== 'NONE') {
      obj.layoutMode = node.layoutMode
      obj.primaryAxisAlignItems = node.primaryAxisAlignItems
      obj.counterAxisAlignItems = node.counterAxisAlignItems
      obj.primaryAxisSizingMode = node.primaryAxisSizingMode
      obj.counterAxisSizingMode = node.counterAxisSizingMode
      obj.paddingLeft = node.paddingLeft
      obj.paddingRight = node.paddingRight
      obj.paddingTop = node.paddingTop
      obj.paddingBottom = node.paddingBottom
      obj.itemSpacing = node.itemSpacing
      obj.itemReverseZIndex = node.itemReverseZIndex
      obj.strokesIncludedInLayout = node.strokesIncludedInLayout
      obj.layoutWrap = node.layoutWrap
    }
    if ('layoutGrow' in node && node.layoutGrow !== 0) obj.layoutGrow = node.layoutGrow
    if ('layoutAlign' in node && node.layoutAlign !== 'INHERIT') obj.layoutAlign = node.layoutAlign
    if ('layoutPositioning' in node && node.layoutPositioning !== 'AUTO') obj.layoutPositioning = node.layoutPositioning
  }

  if (node.type === 'INSTANCE') {
    try {
      obj.componentRef = { id: node.mainComponent.id, name: node.mainComponent.name, type: node.mainComponent.type }
      if (node.componentProperties) {
        obj.componentProperties = {}
        for (const [key, prop] of Object.entries(node.componentProperties)) {
          obj.componentProperties[key] = prop.value
        }
      }
    } catch (e) {}
  }

  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    if (node.componentPropertyDefinitions) {
      obj.componentPropertyDefinitions = {}
      for (const [key, def] of Object.entries(node.componentPropertyDefinitions)) {
        obj.componentPropertyDefinitions[key] = { type: def.type, defaultValue: def.defaultValue }
      }
    }
  }

  if (node.type === 'SECTION') {
    obj.sectionContentsHidden = node.sectionContentsHidden
    obj.expanded = node.expanded
  }

  if ('children' in node && node.children.length > 0) {
    obj.children = node.children.map(child => serializeNode(child, depth + 1))
  }

  return obj
}

function serializePaint(paint) {
  const obj = { type: paint.type }
  if (paint.type === 'SOLID') {
    obj.color = rgbToHex(paint.color)
    if (paint.opacity !== undefined && paint.opacity < 1) obj.opacity = paint.opacity
  } else if (paint.type === 'GRADIENT_LINEAR' || paint.type === 'GRADIENT_RADIAL' || paint.type === 'GRADIENT_ANGULAR' || paint.type === 'GRADIENT_DIAMOND') {
    obj.gradientStops = paint.gradientStops.map(s => ({
      position: Math.round(s.position * 100) / 100,
      color: rgbToHex(s.color),
      opacity: s.color.a !== undefined && s.color.a < 1 ? s.color.a : undefined,
    }))
  } else if (paint.type === 'IMAGE') {
    obj.imageHash = paint.imageHash
    obj.scaleMode = paint.scaleMode
    obj.imageTransform = paint.imageTransform
  }
  return obj
}

function rgbToHex(color) {
  if (!color) return null
  const r = Math.round(Math.max(0, Math.min(1, color.r)) * 255).toString(16).padStart(2, '0')
  const g = Math.round(Math.max(0, Math.min(1, color.g)) * 255).toString(16).padStart(2, '0')
  const b = Math.round(Math.max(0, Math.min(1, color.b)) * 255).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`.toUpperCase()
}

function countNodes(nodes) {
  let c = 0
  for (const n of nodes) {
    c++
    if (n.children) c += countNodes(n.children)
  }
  return c
}

function buildDesignData(selectionOnly) {
  const page = figma.currentPage
  let nodes

  if (selectionOnly && page.selection.length > 0) {
    nodes = page.selection.map(n => serializeNode(n))
  } else {
    nodes = page.children.map(child => serializeNode(child))
  }

  const data = {
    type: selectionOnly && page.selection.length > 0 ? 'selection' : 'page',
    pageName: page.name,
    pageId: page.id,
    selectionCount: selectionOnly ? page.selection.length : undefined,
    nodes,
    nodeCount: countNodes(nodes),
    syncedAt: new Date().toISOString(),
  }

  return data
}

async function main() {
  const selectionOnly = figma.command === 'sync-selection'
  const data = buildDesignData(selectionOnly)

  figma.showUI(UI_HTML, { visible: false })

  figma.ui.onmessage = msg => {
    if (msg.type === 'ui-ready') {
      figma.ui.postMessage({ type: 'sync', data })
    } else if (msg.type === 'done') {
      if (msg.success) {
        figma.notify(`✅ Synced ${msg.nodeCount} nodes to server`)
      } else {
        figma.notify(`❌ ${msg.error}`, { error: true })
      }
      figma.closePlugin()
    }
  }
}

main()
