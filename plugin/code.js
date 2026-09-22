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
.field{display:flex;flex-direction:column;gap:4px}
.field label{font-size:11px;color:#8E8E93}
.field input{background:#1C1C1E;border:1px solid #48484A;color:#F5F5F7;border-radius:6px;padding:7px 8px;font-size:12px;outline:none}
.field input:focus{border-color:#0A84FF}
.row{display:flex;gap:8px}
.row>*{flex:1}
.btn-stop{background:#3A3A3C;color:#F5F5F7;border:1px solid #545458;border-radius:7px;padding:9px 16px;font-size:13px;font-weight:500;cursor:pointer}
.hint{font-size:11px;color:#8E8E93;line-height:1.5}
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
    <span class="label" id="pageLabel">Synced page</span>
    <span class="value" id="pageName">\u2014</span>
    <span class="label" id="nodeLabel">Nodes</span>
    <span class="value" id="nodeCount">\u2014</span>
    <span class="label" id="timeLabel">Last sync</span>
    <span class="value" id="lastSync">\u2014</span>
  </div>
  <div class="actions" id="authActions">
    <div class="field"><label>Pairing token</label><input id="bridgeToken" type="password" autocomplete="off" placeholder="Run npm run bridge:token"></div>
  </div>
  <div class="actions hidden" id="bridgeActions">
    <div class="field"><label>Bridge URL</label><input id="bridgeUrl" value="${SERVER_URL}"></div>
    <div class="field"><label>Current file URL or file key</label><input id="fileSource" placeholder="https://www.figma.com/design/..."></div>
    <div class="row">
      <button class="btn-sync" id="startBtn">Start</button>
      <button class="btn-stop" id="stopBtn" disabled>Stop</button>
    </div>
    <p class="hint">Keep this panel open. Live MCP reads resolve the requested node directly, including nodes on other pages, without changing your selection.</p>
  </div>
  <div class="actions" id="legacyActions">
    <button class="btn-sync" id="syncBtn">\u27F3 Sync Now</button>
    <label class="checkbox-row">
      <input type="checkbox" id="autoSync" checked>
      Auto-sync page changes
    </label>
    <p class="hint">Syncs the whole current page, including nested layers. Keep this panel open. Switching pages syncs the new page.</p>
  </div>
  <div id="errorMsg" class="error hidden"></div>
</div>
<script>
const SERVER_URL = '${SERVER_URL}'
function q(s){return document.getElementById(s)}
let bridgeWanted=false,bridgeConfig=null,sessionId=null,sessionSecret=null,pollController=null,heartbeatTimer=null,reconnectTimer=null,reconnectDelay=750
function setStatus(type,text){
  const bar=q('statusBar'),el=q('statusText'),dot=bar.querySelector('.dot')
  bar.className='status-bar '+type
  dot.className='dot '+(type==='connected'?'green':type==='disconnected'?'red':'yellow')
  el.textContent=text
}
function updateInfo(d){
  if(d.mode==='bridge'){
    q('bridgeActions').classList.remove('hidden');q('legacyActions').classList.add('hidden')
    q('pageLabel').textContent='Connected file';q('nodeLabel').textContent='Last node';q('timeLabel').textContent='Last request'
  }
  if(d.pageName) q('pageName').textContent=d.pageName
  if(d.nodeCount!==undefined) q('nodeCount').textContent=d.nodeCount.toString()
  if(d.lastNode!==undefined) q('nodeCount').textContent=d.lastNode||'\u2014'
  if(d.lastSync){try{q('lastSync').textContent=new Date(d.lastSync).toLocaleTimeString()}catch{}}
  if(d.lastRequest){try{q('lastSync').textContent=new Date(d.lastRequest).toLocaleTimeString()}catch{}}
  if(d.autoSync!==undefined) q('autoSync').checked=d.autoSync
  if(d.bridgeUrl) q('bridgeUrl').value=d.bridgeUrl
  if(d.bridgeToken) q('bridgeToken').value=d.bridgeToken
  if(d.fileSource) q('fileSource').value=d.fileSource
  if(d.mode==='bridge'){
    q('startBtn').disabled=Boolean(d.connected);q('stopBtn').disabled=!d.connected
  }
  setStatus(d.connected?'connected':'disconnected',d.connected?'Connected':'Disconnected')
}
function hideError(){q('errorMsg').classList.add('hidden')}
function showError(m){q('errorMsg').textContent=m;q('errorMsg').classList.remove('hidden')}
async function sendToServer(data,requestId){
  hideError()
  setStatus('connecting','Syncing...')
  q('syncBtn').disabled=true
  const controller=new AbortController()
  const timeout=setTimeout(()=>controller.abort(),30000)
  try{
    const headers={'Content-Type':'application/json'}
    const token=(q('bridgeToken').value||'').trim()
    if(token) headers['Authorization']='Bearer '+token
    const r=await fetch(SERVER_URL+'/design',{method:'POST',headers,body:JSON.stringify(data),signal:controller.signal})
    if(r.status===401) throw new Error('The server rejected the pairing token. Run npm run bridge:token and paste the value above.')
    if(!r.ok) throw new Error('Server returned HTTP '+r.status+' '+r.statusText)
    const result=await r.json()
    parent.postMessage({pluginMessage:{type:'done',requestId,success:true,serverMessage:result.message}},'*')
  }catch(err){
    const message=err.name==='AbortError'?'Sync timed out after 30 seconds. Try Sync Now again.':err.message
    showError(message+'\\nCheck the bridge server at '+SERVER_URL+'.')
    parent.postMessage({pluginMessage:{type:'done',requestId,success:false,error:message}},'*')
  }finally{
    clearTimeout(timeout)
    q('syncBtn').disabled=false
  }
}
function bridgeHeaders(includeSession=true){
  const h={'Content-Type':'application/json','Authorization':'Bearer '+bridgeConfig.token}
  if(includeSession&&sessionSecret) h['X-Session-Secret']=sessionSecret
  return h
}
async function bridgeFetch(path,options={},includeSession=true){
  const controller=options.controller
  const r=await fetch(bridgeConfig.url+path,{method:options.method||'GET',headers:bridgeHeaders(includeSession),body:options.body===undefined?undefined:JSON.stringify(options.body),signal:controller&&controller.signal})
  const text=await r.text();let body=null
  try{body=text?JSON.parse(text):null}catch{}
  if(!r.ok) throw new Error((body&&body.error)||('Bridge HTTP '+r.status))
  return body
}
function bridgeStatus(connected,error){
  parent.postMessage({pluginMessage:{type:'bridge-status',connected,error:error||null}},'*')
  q('startBtn').disabled=connected;q('stopBtn').disabled=!connected
  setStatus(connected?'connected':bridgeWanted?'connecting':'disconnected',connected?'Connected':bridgeWanted?'Reconnecting...':'Disconnected')
  if(error) showError(error); else hideError()
}
async function closeBridgeSession(reason){
  if(!sessionId||!bridgeConfig) return
  try{await bridgeFetch('/bridge/session/'+encodeURIComponent(sessionId)+'?reason='+encodeURIComponent(reason||'plugin-stop'),{method:'DELETE'})}catch{}
  sessionId=null;sessionSecret=null
}
function clearBridgeTimers(){
  if(pollController){pollController.abort();pollController=null}
  if(heartbeatTimer){clearTimeout(heartbeatTimer);heartbeatTimer=null}
  if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null}
}
async function stopBridge(reason){
  bridgeWanted=false;clearBridgeTimers();await closeBridgeSession(reason||'plugin-stop');bridgeStatus(false)
}
function scheduleHeartbeat(){
  if(!bridgeWanted||!sessionId) return
  heartbeatTimer=setTimeout(async()=>{
    try{await bridgeFetch('/bridge/session/'+encodeURIComponent(sessionId)+'/heartbeat',{method:'POST',body:{}});scheduleHeartbeat()}
    catch(err){handleBridgeDisconnect(err)}
  },10000)
}
function handleBridgeDisconnect(err){
  if(!bridgeWanted) return
  clearBridgeTimers();sessionId=null;sessionSecret=null;bridgeStatus(false,err&&err.message)
  reconnectTimer=setTimeout(()=>connectBridge().catch(handleBridgeDisconnect),reconnectDelay)
  reconnectDelay=Math.min(reconnectDelay*2,10000)
}
async function pollBridge(){
  while(bridgeWanted&&sessionId){
    pollController=new AbortController()
    const sid=sessionId
    const data=await bridgeFetch('/bridge/session/'+encodeURIComponent(sid)+'/poll?waitMs=25000',{controller:pollController})
    pollController=null
    for(const request of (data&&data.requests)||[]){
      parent.postMessage({pluginMessage:{type:'bridge-request',sessionId:sid,request}},'*')
    }
  }
}
async function connectBridge(){
  if(!bridgeWanted||!bridgeConfig) return
  setStatus('connecting','Connecting...')
  const data=await bridgeFetch('/bridge/session',{method:'POST',body:{fileKey:bridgeConfig.fileKey,fileName:bridgeConfig.fileName,pluginInstanceId:bridgeConfig.pluginInstanceId,capabilities:['read-node','read-document-index']}},false)
  if(!bridgeWanted) return
  sessionId=data.sessionId;sessionSecret=data.sessionSecret;reconnectDelay=750;bridgeStatus(true);scheduleHeartbeat()
  pollBridge().catch(err=>{if(bridgeWanted&&err.name!=='AbortError')handleBridgeDisconnect(err)})
}
async function beginBridge(config){
  await stopBridge('reconnect');bridgeConfig=config;bridgeWanted=true;connectBridge().catch(handleBridgeDisconnect)
}
async function sendBridgeReply(msg){
  if(!bridgeWanted||!sessionId||msg.sessionId!==sessionId) return
  try{
    await bridgeFetch('/bridge/session/'+encodeURIComponent(sessionId)+'/reply',{method:'POST',body:{requestId:msg.requestId,ok:msg.ok,result:msg.result,error:msg.error}})
  }catch(err){handleBridgeDisconnect(err)}
}
async function invalidateBridge(msg){
  if(!bridgeWanted||!sessionId) return
  try{await bridgeFetch('/bridge/session/'+encodeURIComponent(sessionId)+'/invalidate',{method:'POST',body:{fileKey:msg.fileKey,reason:msg.reason||'documentchange'}})}catch(err){handleBridgeDisconnect(err)}
}
window.addEventListener('message',async e=>{
  const msg=e.data.pluginMessage
  if(!msg) return
  switch(msg.type){
    case 'sync': await sendToServer(msg.data,msg.requestId); break
    case 'status': updateInfo(msg); break
    case 'error': showError(msg.error); break
    case 'bridge-start': await beginBridge(msg.config); break
    case 'bridge-result': await sendBridgeReply(msg); break
    case 'bridge-invalidate': await invalidateBridge(msg); break
    case 'bridge-stop': await stopBridge(msg.reason); break
  }
})
q('syncBtn').addEventListener('click',()=>parent.postMessage({pluginMessage:{type:'request-sync'}},'*'))
q('autoSync').addEventListener('change',e=>parent.postMessage({pluginMessage:{type:'set-auto-sync',enabled:e.target.checked}},'*'))
q('bridgeToken').addEventListener('change',e=>parent.postMessage({pluginMessage:{type:'set-token',token:e.target.value}},'*'))
q('startBtn').addEventListener('click',()=>parent.postMessage({pluginMessage:{type:'connect-bridge',serverUrl:q('bridgeUrl').value,token:q('bridgeToken').value,fileSource:q('fileSource').value}},'*'))
q('stopBtn').addEventListener('click',()=>{stopBridge('plugin-stop');parent.postMessage({pluginMessage:{type:'bridge-stopped'}},'*')})
parent.postMessage({pluginMessage:{type:'ui-ready'}},'*')
<\/script>`

function markBridgeTruncated(limits, nodeId) {
  if (!limits || !limits.state) return
  limits.state.limitHit = true
  if (nodeId && !limits.state.truncatedNodeIds.includes(nodeId)) {
    limits.state.truncatedNodeIds.push(nodeId)
  }
}

function serializeNode(node, depth, limits) {
  if (limits && limits.state) {
    if (depth > limits.maxDepth || limits.state.nodeCount >= limits.maxNodes || limits.state.byteSize >= limits.maxBytes) {
      markBridgeTruncated(limits, node.id)
      return { id: node.id, name: node.name, type: node.type, truncated: true }
    }
    if (depth > 0 && limits.includeHidden === false && node.visible === false) return null
    limits.state.nodeCount++
  } else if (depth > 30) {
    return { id: node.id, name: node.name, type: node.type, truncated: true }
  }

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
  if (isBox && typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
    obj.cornerRadius = node.cornerRadius
  }

  if (node.type === 'TEXT') {
    try {
      if (limits && typeof node.characters === 'string' && node.characters.length > limits.maxTextChars) {
        obj.characters = node.characters.slice(0, limits.maxTextChars)
        obj.textTruncated = true
        markBridgeTruncated(limits, node.id)
      } else {
        obj.characters = node.characters
      }
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

  if (node.type === 'COMPONENT_SET' || (node.type === 'COMPONENT' && node.parent?.type !== 'COMPONENT_SET')) {
    const definitions = node.componentPropertyDefinitions
    if (definitions) {
      obj.componentPropertyDefinitions = {}
      for (const [key, def] of Object.entries(definitions)) {
        obj.componentPropertyDefinitions[key] = { type: def.type, defaultValue: def.defaultValue }
      }
    }
  }

  if (node.type === 'SECTION') {
    obj.sectionContentsHidden = node.sectionContentsHidden
    obj.expanded = node.expanded
  }

  if (limits && limits.state) {
    try {
      limits.state.byteSize += JSON.stringify(obj).length + 2
    } catch {
      limits.state.byteSize += 256
    }
    if (limits.state.byteSize >= limits.maxBytes) {
      markBridgeTruncated(limits, node.id)
      obj.truncated = true
      return obj
    }
  }

  if ('children' in node && node.children.length > 0) {
    if (limits && limits.state) {
      obj.children = []
      for (const child of node.children) {
        if (limits.state.nodeCount >= limits.maxNodes || limits.state.byteSize >= limits.maxBytes) {
          markBridgeTruncated(limits, node.id)
          obj.truncated = true
          break
        }
        const serialized = serializeNode(child, depth + 1, limits)
        if (serialized) obj.children.push(serialized)
      }
      if (obj.children.length === 0) delete obj.children
    } else {
      obj.children = node.children.map(child => serializeNode(child, depth + 1))
    }
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

function sanitizeForMessage(value) {
  return JSON.parse(JSON.stringify(value))
}

function buildDesignData(selectionOnly) {
  const page = figma.currentPage
  if (selectionOnly && page.selection.length === 0) {
    throw new Error('Select a frame or layers first, or use Sync Full Page / Watch Mode.')
  }
  const nodes = selectionOnly
    ? page.selection.map(n => serializeNode(n, 0))
    : page.children.map(child => serializeNode(child, 0))

  return {
    type: selectionOnly ? 'selection' : 'page',
    pageName: page.name,
    pageId: page.id,
    selectionCount: selectionOnly ? page.selection.length : undefined,
    nodes,
    nodeCount: countNodes(nodes),
    syncedAt: new Date().toISOString(),
  }
}

function parseFileKey(source) {
  const value = String(source || '').trim()
  if (/^[A-Za-z0-9_-]{1,128}$/.test(value)) return value
  const match = value.match(/^https:\/\/(?:www\.)?figma\.com\/(?:design|file)\/([A-Za-z0-9_-]{1,128})(?:[/?#]|$)/i)
  return match ? match[1] : null
}

function normalizeBridgeUrl(value) {
  const url = String(value || SERVER_URL).trim().replace(/\/+$/, '')
  if (!/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/i.test(url)) {
    throw new Error('Bridge URL must be a loopback HTTP URL such as http://localhost:3456')
  }
  return url
}

function bridgeLimits(options = {}) {
  const integer = (value, fallback, min, max) => Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback
  return {
    maxDepth: integer(options.depth, 12, 0, 30),
    maxNodes: integer(options.maxNodes, 5000, 1, 200000),
    maxBytes: integer(options.maxBytes, 2_000_000, 1024, 50_000_000),
    maxTextChars: 100_000,
    includeHidden: options.includeHidden !== false,
    state: { nodeCount: 0, byteSize: 0, limitHit: false, truncatedNodeIds: [] },
  }
}

function findPageForNode(node) {
  let current = node
  while (current && current.type !== 'PAGE') current = current.parent
  return current && current.type === 'PAGE' ? current : null
}

function completenessFor(payload, limits) {
  let byteSize = 0
  try { byteSize = JSON.stringify(payload).length } catch { byteSize = limits.state.byteSize }
  return {
    nodeCount: limits.state.nodeCount,
    byteSize,
    limitHit: limits.state.limitHit || byteSize > limits.maxBytes,
    truncatedNodeIds: limits.state.truncatedNodeIds.slice(0, 200),
  }
}

function fitNodePayloadToLimit(payload, limits, nodeId) {
  if (!payload) return payload
  let serialized = ''
  try { serialized = JSON.stringify(payload) } catch { serialized = '' }
  if (!serialized || serialized.length <= limits.maxBytes) return payload

  markBridgeTruncated(limits, nodeId)
  const fitted = { ...payload, children: undefined, truncated: true }

  if (typeof fitted.characters === 'string') {
    fitted.textTruncated = true
    let low = 0
    let high = fitted.characters.length
    const original = fitted.characters
    while (low < high) {
      const mid = Math.ceil((low + high) / 2)
      fitted.characters = original.slice(0, mid)
      if (JSON.stringify(fitted).length <= limits.maxBytes) low = mid
      else high = mid - 1
    }
    fitted.characters = original.slice(0, low)
  }

  if (JSON.stringify(fitted).length <= limits.maxBytes) return fitted

  const minimal = {
    id: String(payload.id || nodeId || '').slice(0, 128),
    type: String(payload.type || 'UNKNOWN').slice(0, 64),
    truncated: true,
  }
  if (payload.name) minimal.name = String(payload.name).slice(0, 256)
  while (minimal.name && JSON.stringify(minimal).length > limits.maxBytes) {
    minimal.name = minimal.name.slice(0, Math.floor(minimal.name.length / 2))
  }
  return minimal
}

function fitDocumentIndexToLimit(payload, limits) {
  if (!payload || JSON.stringify(payload).length <= limits.maxBytes) return payload
  markBridgeTruncated(limits)
  const pages = payload.pages || []
  while (pages.length && JSON.stringify(payload).length > limits.maxBytes) {
    const last = pages[pages.length - 1]
    if (last.children && last.children.length) {
      const removed = last.children.pop()
      markBridgeTruncated(limits, removed && removed.id)
      last.truncated = true
      if (!last.children.length) delete last.children
    } else {
      const removed = pages.pop()
      markBridgeTruncated(limits, removed && removed.id)
    }
  }
  return payload
}

async function readBridgeNode(request) {
  const params = request.params || {}
  const limits = bridgeLimits(params.options || {})
  const node = await figma.getNodeByIdAsync(params.nodeId)
  if (!node) {
    return {
      fileKey: state.bridgeFileKey, fileName: state.bridgeFileName, nodeId: params.nodeId,
      pageId: null, pageName: null, found: false, truncated: false,
      completeness: { nodeCount: 0, byteSize: 0, limitHit: false, truncatedNodeIds: [] }, payload: null,
    }
  }

  let payload = sanitizeForMessage(serializeNode(node, 0, limits))
  payload = fitNodePayloadToLimit(payload, limits, node.id)
  const completeness = completenessFor(payload, limits)
  const page = findPageForNode(node)
  return {
    fileKey: state.bridgeFileKey, fileName: state.bridgeFileName, nodeId: node.id,
    pageId: page ? page.id : null, pageName: page ? page.name : null, found: true,
    truncated: completeness.limitHit, completeness, payload,
  }
}

function readBridgeDocumentIndex(request) {
  const limits = bridgeLimits(request.params?.options || {})
  const pages = []
  const rootPages = figma.root && Array.isArray(figma.root.children) ? figma.root.children : []
  for (const page of rootPages) {
    if (limits.state.nodeCount >= limits.maxNodes || limits.state.byteSize >= limits.maxBytes) {
      markBridgeTruncated(limits, page.id)
      break
    }
    const item = { id: page.id, name: page.name, type: 'PAGE', children: [] }
    limits.state.nodeCount++
    for (const child of page.children || []) {
      if (limits.state.nodeCount >= limits.maxNodes || limits.state.byteSize >= limits.maxBytes) {
        markBridgeTruncated(limits, page.id)
        item.truncated = true
        break
      }
      if (child.visible === false && limits.includeHidden === false) continue
      if (!['FRAME', 'COMPONENT', 'COMPONENT_SET', 'SECTION'].includes(child.type)) continue
      const summary = { id: child.id, name: child.name, type: child.type }
      if ('width' in child) summary.width = Math.round(child.width)
      if ('height' in child) summary.height = Math.round(child.height)
      item.children.push(summary)
      limits.state.nodeCount++
      limits.state.byteSize += JSON.stringify(summary).length + 2
    }
    if (!item.children.length) delete item.children
    pages.push(item)
    limits.state.byteSize += JSON.stringify({ id: item.id, name: item.name, type: item.type }).length + 2
  }
  const payload = fitDocumentIndexToLimit({ type: 'DOCUMENT_INDEX', pages }, limits)
  const completeness = completenessFor(payload, limits)
  return {
    fileKey: state.bridgeFileKey, fileName: state.bridgeFileName, nodeId: null,
    pageId: null, pageName: null, found: true, truncated: completeness.limitHit,
    completeness, payload,
  }
}

async function handleBridgeRequest(sessionId, request) {
  if (!request || !request.requestId) return
  if (!state.bridgeFileKey || request.params?.fileKey !== state.bridgeFileKey) {
    figma.ui.postMessage({ type: 'bridge-result', sessionId, requestId: request.requestId, ok: false, error: 'Request file does not match the connected Figma file.' })
    return
  }
  try {
    let result
    if (request.op === 'read-node') result = await readBridgeNode(request)
    else if (request.op === 'read-document-index') result = readBridgeDocumentIndex(request)
    else throw new Error(`Unsupported bridge operation: ${request.op}`)
    state.lastBridgeNode = result.nodeId || 'Document index'
    state.lastBridgeRequest = new Date()
    updateUIStatus()
    figma.ui.postMessage({ type: 'bridge-result', sessionId, requestId: request.requestId, ok: true, result })
  } catch (error) {
    figma.ui.postMessage({ type: 'bridge-result', sessionId, requestId: request.requestId, ok: false, error: error.message || String(error) })
  }
}

async function loadBridgePreferences() {
  const defaults = { bridgeUrl: SERVER_URL, bridgeToken: '', fileSource: figma.fileKey || '' }
  if (!figma.clientStorage || typeof figma.clientStorage.getAsync !== 'function') return defaults
  try {
    const saved = await figma.clientStorage.getAsync('design-bridge-pairing')
    return { ...defaults, ...(saved && typeof saved === 'object' ? saved : {}) }
  } catch {
    return defaults
  }
}

async function saveBridgePreferences(preferences) {
  if (!figma.clientStorage || typeof figma.clientStorage.setAsync !== 'function') return
  try { await figma.clientStorage.setAsync('design-bridge-pairing', preferences) } catch {}
}

const state = {
  autoSync: true, lastNodeCount: 0, lastSyncTime: null, lastPageName: null,
  connected: false, ready: false, inFlight: null, pendingSync: null, nextRequestId: 0,
  bridgeFileKey: null, bridgeFileName: null, bridgeConnected: false, bridgeToken: '',
  lastBridgeNode: null, lastBridgeRequest: null,
  pluginInstanceId: `plugin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
}

let debounceTimer = null

function cancelDebounce() {
  if (debounceTimer !== null) clearTimeout(debounceTimer)
  debounceTimer = null
}

function debouncedSync() {
  if (!state.ready || !state.autoSync) return
  cancelDebounce()
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    triggerSync('auto')
  }, 800)
}

function triggerSync(reason = 'manual') {
  if (!state.ready || (reason === 'auto' && !state.autoSync)) return
  if (state.inFlight) {
    // Coalesce changes while sending. Build the next snapshot only when this one finishes.
    if (state.pendingSync !== 'manual') state.pendingSync = reason
    return
  }
  cancelDebounce()
  state.pendingSync = null
  try {
    // Mixed Figma properties are Symbols, which cannot cross the UI message boundary.
    const data = sanitizeForMessage(buildDesignData(figma.command === 'sync-selection'))
    const requestId = ++state.nextRequestId
    state.inFlight = { requestId, data }
    figma.ui.postMessage({ type: 'sync', requestId, data })
  } catch (error) {
    state.inFlight = null
    figma.notify(`Sync failed: ${error.message}`, { error: true })
    if (figma.command === 'watch') {
      updateUIStatus()
      figma.ui.postMessage({ type: 'error', error: error.message })
    } else {
      figma.closePlugin()
    }
  }
}

function updateUIStatus() {
  if (figma.command === 'bridge') {
    figma.ui.postMessage({
      type: 'status', mode: 'bridge', connected: state.bridgeConnected,
      pageName: state.bridgeFileName || '\u2014', lastNode: state.lastBridgeNode || '\u2014',
      lastRequest: state.lastBridgeRequest?.toISOString(),
    })
    return
  }
  figma.ui.postMessage({
    type: 'status',
    connected: state.connected,
    pageName: state.lastPageName || '\u2014',
    nodeCount: state.lastNodeCount,
    lastSync: state.lastSyncTime?.toISOString(),
    autoSync: state.autoSync,
    // The legacy /design route authenticates too, so the UI needs the stored
    // token before its first sync, not only in bridge mode.
    bridgeToken: state.bridgeToken,
  })
}

function main() {
  const isBridge = figma.command === 'bridge'
  const isWatch = figma.command === 'watch'
  const isSync = figma.command === 'sync-page' || figma.command === 'sync-selection'

  if (!isBridge && !isWatch && !isSync) {
    figma.closePlugin()
    return
  }

  figma.showUI(UI_HTML, { visible: isWatch || isBridge, width: 320, height: isBridge ? 520 : 390 })

  if (isWatch) {
    // This development plugin uses legacy document access (no dynamic-page manifest).
    // Watch page content, not selection: clicking a layer must not shrink the cache.
    figma.on('documentchange', debouncedSync)
    figma.on('currentpagechange', debouncedSync)
    figma.on('close', () => {
      cancelDebounce()
      state.ready = false
      state.pendingSync = null
    })
  }

  if (isBridge) {
    figma.on('documentchange', () => {
      if (!state.bridgeConnected || !state.bridgeFileKey) return
      figma.ui.postMessage({ type: 'bridge-invalidate', fileKey: state.bridgeFileKey, reason: 'documentchange' })
    })
    figma.on('close', () => {
      state.bridgeConnected = false
      figma.ui.postMessage({ type: 'bridge-stop', reason: 'plugin-close' })
    })
  }

  figma.ui.onmessage = async msg => {
    switch (msg.type) {
      case 'ui-ready':
        if (state.ready) break
        state.ready = true
        if (isBridge) {
          const prefs = await loadBridgePreferences()
          figma.ui.postMessage({
            type: 'status', mode: 'bridge', connected: false,
            pageName: figma.root?.name || '\u2014', lastNode: '\u2014',
            bridgeUrl: prefs.bridgeUrl, bridgeToken: prefs.bridgeToken, fileSource: prefs.fileSource,
          })
        } else {
          // The legacy sync needs the pairing token in the field before it
          // fires, so the stored value goes out first and the sync follows.
          const prefs = await loadBridgePreferences()
          state.bridgeToken = prefs.bridgeToken || ''
          updateUIStatus()
          triggerSync()
        }
        break

      case 'done':
        if (!state.inFlight || msg.requestId !== state.inFlight.requestId) break
        const completed = state.inFlight.data
        state.inFlight = null
        if (msg.success) {
          state.lastSyncTime = new Date()
          state.lastNodeCount = completed.nodeCount
          state.lastPageName = completed.pageName
          state.connected = true
        } else {
          state.connected = false
        }

        if (isWatch) {
          updateUIStatus()
          if (!msg.success) {
            figma.notify(`Sync failed: ${msg.error}`, { error: true })
          }
          if (state.pendingSync) triggerSync(state.pendingSync)
        } else {
          if (msg.success) {
            figma.notify(`Synced ${completed.nodeCount} nodes to server`)
          } else {
            figma.notify(`Sync failed: ${msg.error}`, { error: true })
          }
          figma.closePlugin()
        }
        break

      case 'request-sync':
        if (isWatch) triggerSync()
        break

      case 'set-token': {
        const token = String(msg.token || '').trim()
        state.bridgeToken = token
        const prefs = await loadBridgePreferences()
        await saveBridgePreferences({ ...prefs, bridgeToken: token })
        break
      }

      case 'set-auto-sync':
        if (isWatch) {
          state.autoSync = Boolean(msg.enabled)
          if (state.autoSync) {
            triggerSync('auto')
          } else {
            cancelDebounce()
            if (state.pendingSync === 'auto') state.pendingSync = null
          }
        }
        break

      case 'connect-bridge':
        if (!isBridge) break
        try {
          const fileKey = parseFileKey(msg.fileSource)
          if (!fileKey) throw new Error('Enter the current Figma file URL or file key before connecting.')
          if (figma.fileKey && figma.fileKey !== fileKey) {
            throw new Error('The entered file does not match the Figma file currently open in this plugin.')
          }
          const serverUrl = normalizeBridgeUrl(msg.serverUrl)
          const token = String(msg.token || '').trim()
          if (!token) throw new Error('Enter the bridge pairing token before connecting.')
          state.bridgeFileKey = fileKey
          state.bridgeFileName = figma.root?.name || figma.currentPage?.name || 'Figma file'
          await saveBridgePreferences({ bridgeUrl: serverUrl, bridgeToken: token, fileSource: String(msg.fileSource || '').trim() })
          figma.ui.postMessage({
            type: 'bridge-start',
            config: {
              url: serverUrl, token, fileKey, fileName: state.bridgeFileName,
              pluginInstanceId: state.pluginInstanceId,
            },
          })
        } catch (error) {
          state.bridgeConnected = false
          figma.ui.postMessage({ type: 'error', error: error.message || String(error) })
          updateUIStatus()
        }
        break

      case 'bridge-status':
        if (!isBridge) break
        state.bridgeConnected = Boolean(msg.connected)
        updateUIStatus()
        if (msg.error) figma.ui.postMessage({ type: 'error', error: msg.error })
        break

      case 'bridge-request':
        if (isBridge) await handleBridgeRequest(msg.sessionId, msg.request)
        break

      case 'bridge-stopped':
        if (isBridge) {
          state.bridgeConnected = false
          updateUIStatus()
        }
        break
    }
  }
}

main()
