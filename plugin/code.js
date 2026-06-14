const SERVER_URL = 'http://localhost:3456'

const UI_HTML = `<style>
*{margin:0;padding:0;box-sizing:border-box}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  background:#2C2C2E;color:#F5F5F7;font-size:13px;padding:14px;
  -webkit-font-smoothing:antialiased
}
.header{font-size:15px;font-weight:600;margin-bottom:14px;display:flex;align-items:center;gap:6px}
.status-bar{
  display:flex;align-items:center;gap:7px;padding:8px 10px;
  border-radius:7px;margin-bottom:12px;font-size:12px;font-weight:500
}
.status-bar.connected{background:rgba(48,209,88,0.12);color:#30D158}
.status-bar.disconnected{background:rgba(255,69,58,0.12);color:#FF453A}
.status-bar.connecting{background:rgba(255,214,10,0.12);color:#FFD60A}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex-shrink:0}
.dot.green{background:#30D158}
.dot.red{background:#FF453A}
.dot.yellow{background:#FFD60A}
.info-grid{display:grid;grid-template-columns:auto 1fr;gap:5px 10px;margin-bottom:14px;font-size:12px;line-height:1.6}
.info-grid .label{color:#8E8E93;white-space:nowrap}
.info-grid .value{color:#F5F5F7;word-break:break-all;min-width:0}
.actions{display:flex;flex-direction:column;gap:8px}
.btn-sync{
  background:#007AFF;color:white;border:none;border-radius:7px;
  padding:9px 16px;font-size:13px;font-weight:500;cursor:pointer;
  transition:background .15s;display:flex;align-items:center;justify-content:center;gap:5px
}
.btn-sync:hover{background:#0056CC}
.btn-sync:active{background:#004499}
.btn-sync:disabled{opacity:.5;cursor:not-allowed}
.btn-sync.spinning{pointer-events:none}
.btn-sync.spinning::after{
  content:'';width:12px;height:12px;
  border:2px solid rgba(255,255,255,.3);border-top-color:#fff;
  border-radius:50%;animation:spin .6s linear infinite
}
@keyframes spin{to{transform:rotate(360deg)}}
.checkbox-row{display:flex;align-items:center;gap:7px;font-size:12px;color:#AEAEB2;cursor:pointer;user-select:none}
.checkbox-row input{accent-color:#007AFF;cursor:pointer}
.error{color:#FF453A;font-size:11px;margin-top:6px;line-height:1.4;padding:6px 8px;background:rgba(255,69,58,0.08);border-radius:5px}
.hidden{display:none!important}
</style>
<div id="app">
  <div class="header">\uD83C\uDFA8 Design Bridge</div>
  <div id="statusBar" class="status-bar connecting">
    <span class="dot yellow"></span>
    <span id="statusText">Starting...</span>
  </div>
  <div class="info-grid">
    <span class="label">Page</span>
    <span class="value" id="pageName">\u2014</span>
    <span class="label">Nodes</span>
    <span class="value" id="nodeCount">\u2014</span>
    <span class="label">Last sync</span>
    <span class="value" id="lastSync">\u2014</span>
  </div>
  <div class="actions">
    <button class="btn-sync" id="syncBtn">\u27F3 Sync Now</button>
    <label class="checkbox-row">
      <input type="checkbox" id="autoSync" checked>
      Auto-sync on selection change
    </label>
  </div>
  <div id="errorMsg" class="error hidden"></div>
</div>
<script>
const SERVER_URL = '${SERVER_URL}'
function q(s){return document.getElementById(s)}
function setStatus(type,text){
  const bar=q('statusBar'),el=q('statusText'),dot=bar.querySelector('.dot')
  bar.className='status-bar '+type
  dot.className='dot '+(type==='connected'?'green':type==='disconnected'?'red':'yellow')
  el.textContent=text
}
function updateInfo(d){
  if(d.pageName) q('pageName').textContent=d.pageName
  if(d.nodeCount!==undefined) q('nodeCount').textContent=d.nodeCount.toString()
  if(d.lastSync){try{q('lastSync').textContent=new Date(d.lastSync).toLocaleTimeString()}catch{}}
  if(d.autoSync!==undefined) q('autoSync').checked=d.autoSync
  setStatus(d.connected?'connected':'disconnected',d.connected?'Connected':'Disconnected')
}
function hideError(){q('errorMsg').classList.add('hidden')}
function showError(m){q('errorMsg').textContent=m;q('errorMsg').classList.remove('hidden')}
async function sendToServer(data){
  hideError()
  setStatus('connecting','Syncing...')
  q('syncBtn').disabled=true
  try{
    const r=await fetch(SERVER_URL+'/design',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
    const result=await r.json()
    if(r.ok) parent.postMessage({pluginMessage:{type:'done',success:true,nodeCount:data.nodeCount,serverMessage:result.message}},'*')
    else parent.postMessage({pluginMessage:{type:'done',success:false,error:result.error||r.statusText}},'*')
  }catch(err){
    showError('Cannot connect to server at '+SERVER_URL+'\nMake sure node server/index.js is running.')
    parent.postMessage({pluginMessage:{type:'done',success:false,error:err.message}},'*')
  }finally{
    q('syncBtn').disabled=false
  }
}
window.addEventListener('message',async e=>{
  const msg=e.data.pluginMessage
  if(!msg) return
  switch(msg.type){
    case 'sync': await sendToServer(msg.data); break
    case 'status': updateInfo(msg); break
  }
})
q('syncBtn').addEventListener('click',()=>parent.postMessage({pluginMessage:{type:'request-sync'}},'*'))
q('autoSync').addEventListener('change',e=>parent.postMessage({pluginMessage:{type:'set-auto-sync',enabled:e.target.checked}},'*'))
parent.postMessage({pluginMessage:{type:'ui-ready'}},'*')
<\/script>`

function serializeNode(node, depth) {
  if (depth > 30) return { id: node.id, name: node.name, type: node.type, truncated: true }

  const obj = { id: node.id, name: node.name, type: node.type }

  if ('x' in node) obj.x = Math.round(node.x)
  if ('y' in node) obj.y = Math.round(node.y)
  if ('width' in node) obj.width = Math.round(node.width)
  if ('height' in node) obj.height = Math.round(node.height)
  if ('rotation' in node && node.rotation !== 0) obj.rotation = Math.round(node.rotation * 100) / 100
  if ('opacity' in node && node.opacity < 1) obj.opacity = Math.round(node.opacity * 100) / 100
  if ('visible' in node) obj.visible = node.visible
  if ('locked' in node && node.locked) obj.locked = true
  if ('clipsContent' in node && node.clipsContent) obj.clipsContent = true

  const isBox = node.type === 'RECTANGLE' || node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE' || node.type === 'ELLIPSE'
  if (isBox && 'cornerRadius' in node && node.cornerRadius > 0) {
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
  const nodes = selectionOnly && page.selection.length > 0
    ? page.selection.map(n => serializeNode(n, 0))
    : page.children.map(child => serializeNode(child, 0))

  return {
    type: selectionOnly && page.selection.length > 0 ? 'selection' : 'page',
    pageName: page.name,
    pageId: page.id,
    selectionCount: selectionOnly ? page.selection.length : undefined,
    nodes,
    nodeCount: countNodes(nodes),
    syncedAt: new Date().toISOString(),
  }
}

const state = { autoSync: true, lastNodeCount: 0, lastSyncTime: null, connected: false }

let debounceTimer = null

function debouncedSync() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(triggerSync, 400)
}

function triggerSync() {
  const selectionOnly = figma.currentPage.selection.length > 0
  const data = buildDesignData(selectionOnly)
  figma.ui.postMessage({ type: 'sync', data })
}

function updateUIStatus() {
  figma.ui.postMessage({
    type: 'status',
    connected: state.connected,
    pageName: figma.currentPage?.name || '?',
    pageId: figma.currentPage?.id,
    nodeCount: state.lastNodeCount,
    lastSync: state.lastSyncTime?.toISOString(),
    autoSync: state.autoSync,
  })
}

function main() {
  const isWatch = figma.command === 'watch'
  const isSync = figma.command === 'sync-page' || figma.command === 'sync-selection'

  if (!isWatch && !isSync) {
    figma.closePlugin()
    return
  }

  figma.showUI(UI_HTML, { visible: isWatch, width: 300, height: 360 })

  if (isWatch) {
    figma.on('selectionchange', () => {
      if (state.autoSync) debouncedSync()
    })
  }

  figma.ui.onmessage = msg => {
    switch (msg.type) {
      case 'ui-ready':
        triggerSync()
        break

      case 'done':
        if (msg.success) {
          state.lastSyncTime = new Date()
          state.lastNodeCount = msg.nodeCount
          state.connected = true
        } else {
          state.connected = false
        }

        if (isWatch) {
          updateUIStatus()
          if (!msg.success) {
            figma.notify(`Sync failed: ${msg.error}`, { error: true })
          }
        } else {
          if (msg.success) {
            figma.notify(`Synced ${msg.nodeCount} nodes to server`)
          } else {
            figma.notify(`Sync failed: ${msg.error}`, { error: true })
          }
          figma.closePlugin()
        }
        break

      case 'request-sync':
        if (isWatch) triggerSync()
        break

      case 'set-auto-sync':
        if (isWatch) state.autoSync = msg.enabled
        break
    }
  }
}

main()
