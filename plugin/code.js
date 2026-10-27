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
.section{margin-bottom:12px}
.btn-sync{
  background:#007AFF;color:white;border:none;border-radius:7px;
  padding:9px 16px;font-size:13px;font-weight:500;cursor:pointer;
  transition:background .15s;display:flex;align-items:center;justify-content:center;gap:5px
}
.btn-sync:hover{background:#0056CC}
.btn-sync:active{background:#004499}
.btn-sync:disabled{opacity:.5;cursor:not-allowed}
.checkbox-row{display:flex;align-items:center;gap:7px;font-size:12px;color:#AEAEB2;cursor:pointer;user-select:none}
.checkbox-row input{accent-color:#007AFF;cursor:pointer}
.field{display:flex;flex-direction:column;gap:4px}
.field label{font-size:11px;color:#8E8E93}
.field input{background:#1C1C1E;border:1px solid #48484A;color:#F5F5F7;border-radius:6px;padding:7px 8px;font-size:12px;outline:none}
.field input:focus{border-color:#0A84FF}
.row{display:flex;gap:8px;align-items:center}
.row>*{flex:1}
.btn-stop{background:#3A3A3C;color:#F5F5F7;border:1px solid #545458;border-radius:7px;padding:9px 16px;font-size:13px;font-weight:500;cursor:pointer}
.btn-stop:disabled{opacity:.5;cursor:not-allowed}
.hint{font-size:11px;color:#8E8E93;line-height:1.5}
.wait-hint{margin:-4px 0 12px}
.pair{display:flex;flex-direction:column;gap:6px;padding:10px;border-radius:7px;background:#1C1C1E;border:1px solid #3A3A3C}
.pair-code{font:600 26px/1.3 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:4px;text-align:center}
.pair code{display:block;font:11px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:#2C2C2E;border-radius:5px;padding:5px 7px;color:#D1D1D6;user-select:all;word-break:break-all}
details{margin-top:4px;font-size:12px}
summary{cursor:pointer;color:#8E8E93;user-select:none;margin-bottom:8px}
.error{color:#FF453A;font-size:11px;margin-top:10px;line-height:1.4;padding:6px 8px;background:rgba(255,69,58,0.08);border-radius:5px;white-space:pre-line}
.hidden{display:none!important}
</style>
<div id="app">
  <div class="header">🎨 Design Bridge</div>
  <div id="statusBar" class="status-bar connecting">
    <span class="dot yellow"></span>
    <span id="statusText">Starting...</span>
  </div>
  <p class="hint wait-hint hidden" id="waitHint">The bridge starts with Claude Code (figma-bridge plugin) or figma-bridge start. This panel connects as soon as it is up.</p>
  <div class="info-grid">
    <span class="label" id="pageLabel">Synced page</span>
    <span class="value" id="pageName">—</span>
    <span class="label" id="nodeLabel">Nodes</span>
    <span class="value" id="nodeCount">—</span>
    <span class="label" id="timeLabel">Last sync</span>
    <span class="value" id="lastSync">—</span>
  </div>
  <div class="actions section hidden" id="pairSection">
    <button class="btn-sync" id="pairBtn">Pair with bridge</button>
    <div class="pair hidden" id="pairInfo">
      <div class="pair-code" id="pairCode">—</div>
      <p class="hint">Approve this code in Claude Code:</p>
      <code id="pairCommand">/figma-bridge:pair</code>
      <p class="hint">or in a terminal:</p>
      <code id="pairCli">figma-bridge pair</code>
      <div class="row"><span class="hint" id="pairExpiry"></span><button class="btn-stop" id="cancelPairBtn">Cancel</button></div>
    </div>
  </div>
  <div class="actions section hidden" id="connectSection">
    <div class="row">
      <button class="btn-sync" id="startBtn">Connect</button>
      <button class="btn-stop" id="stopBtn" disabled>Disconnect</button>
    </div>
    <p class="hint">Keep this panel open. Agents can then read any node of this file by its link, on any page, without changing your selection.</p>
  </div>
  <div class="actions section" id="legacyActions">
    <div class="row">
      <button class="btn-sync" id="syncBtn">⟳ Sync page</button>
      <button class="btn-stop hidden" id="syncSelectionBtn">Sync selection</button>
    </div>
    <label class="checkbox-row">
      <input type="checkbox" id="autoSync" checked>
      Auto-sync page changes
    </label>
  </div>
  <details id="advanced">
    <summary>Advanced</summary>
    <div class="actions">
      <div class="field"><label>Bridge token (pairing fills it in)</label><input id="bridgeToken" type="password" autocomplete="off" placeholder="or paste the output of figma-bridge token"></div>
      <div class="actions hidden" id="bridgeActions">
        <div class="field"><label>Bridge URL</label><input id="bridgeUrl" value="${SERVER_URL}"></div>
        <div class="field hidden" id="fileField"><label>This file's link (Share → Copy link)</label><input id="fileSource" placeholder="https://www.figma.com/design/..."></div>
      </div>
    </div>
  </details>
  <div id="errorMsg" class="error hidden"></div>
</div>
<script>
const SERVER_URL = '${SERVER_URL}'
function q(s){return document.getElementById(s)}
function toggle(id,visible){const el=q(id);if(visible)el.classList.remove('hidden');else el.classList.add('hidden')}
let mode='watch',fileKeyKnown=false,connectedNow=false
let bridgeWanted=false,bridgeConfig=null,sessionId=null,sessionSecret=null,pollController=null,heartbeatTimer=null,reconnectTimer=null,reconnectDelay=750
let pairing=null,pairTimer=null
// waitingForBridge: nothing answers at the bridge URL yet, which is normal until
// Claude Code or figma-bridge start runs. tokenRejected: the bridge refused the saved
// token, so only pairing or a new token can help.
let waitingForBridge=false,tokenRejected=false
// invalidating: an invalidate request is in flight. invalidateNext: the latest
// edit made since, sent when invalidateTimer fires.
let invalidating=false,invalidateNext=null,invalidateTimer=null
function bridgeBase(){return ((q('bridgeUrl').value||'').trim()||SERVER_URL).replace(new RegExp('/+$'),'')}
function hasToken(){return Boolean((q('bridgeToken').value||'').trim())}
function timeOf(iso){try{return iso?new Date(iso).toLocaleTimeString():''}catch{return ''}}
function setStatus(type,text){
  const bar=q('statusBar'),el=q('statusText'),dot=bar.querySelector('.dot')
  bar.className='status-bar '+type
  dot.className='dot '+(type==='connected'?'green':type==='disconnected'?'red':'yellow')
  el.textContent=text
}
function refreshSections(){
  const panel=mode==='open'
  toggle('pairSection',(!hasToken()||tokenRejected)&&!connectedNow)
  toggle('waitHint',waitingForBridge&&!connectedNow)
  toggle('connectSection',panel&&hasToken())
  toggle('bridgeActions',panel)
  toggle('fileField',panel&&!fileKeyKnown)
  toggle('syncSelectionBtn',panel)
}
function updateInfo(d){
  if(d.mode) mode=d.mode
  if(d.fileKeyKnown!==undefined) fileKeyKnown=Boolean(d.fileKeyKnown)
  if(d.bridgeUrl) q('bridgeUrl').value=d.bridgeUrl
  if(typeof d.bridgeToken==='string') q('bridgeToken').value=d.bridgeToken
  if(d.fileSource) q('fileSource').value=d.fileSource
  if(d.autoSync!==undefined) q('autoSync').checked=d.autoSync
  connectedNow=Boolean(d.connected)
  if(mode==='open'){
    q('pageLabel').textContent='File';q('nodeLabel').textContent='Last read';q('timeLabel').textContent='Last sync'
    if(d.fileName) q('pageName').textContent=d.fileName
    if(d.lastNode!==undefined) q('nodeCount').textContent=d.lastNode&&d.lastNode!=='—'?d.lastNode+(d.lastRequest?' · '+timeOf(d.lastRequest):''):'—'
    if(d.lastSyncPage!==undefined) q('lastSync').textContent=d.lastSyncPage?d.lastSyncPage+(d.lastSync?' · '+timeOf(d.lastSync):''):'—'
    q('startBtn').disabled=connectedNow;q('stopBtn').disabled=!connectedNow
    // While the panel is reconnecting, keep saying so.
    if(!bridgeWanted||connectedNow) setStatus(connectedNow?'connected':hasToken()&&!tokenRejected?'disconnected':'connecting',connectedNow?'Connected':tokenRejected?'Pairing needed':hasToken()?'Not connected':'Not paired yet')
  }else{
    if(d.pageName) q('pageName').textContent=d.pageName
    if(d.nodeCount!==undefined) q('nodeCount').textContent=d.nodeCount.toString()
    if(d.lastSync) q('lastSync').textContent=timeOf(d.lastSync)
    setStatus(d.connected?'connected':'disconnected',d.connected?'Connected':'Disconnected')
  }
  refreshSections()
}
function hideError(){q('errorMsg').classList.add('hidden')}
function showError(m){q('errorMsg').textContent=m;q('errorMsg').classList.remove('hidden')}
function setSyncing(busy){q('syncBtn').disabled=busy;q('syncSelectionBtn').disabled=busy}
async function sendToServer(data,requestId){
  hideError()
  setStatus('connecting','Syncing...')
  setSyncing(true)
  const base=bridgeBase()
  const controller=new AbortController()
  const timeout=setTimeout(()=>controller.abort(),30000)
  try{
    const headers={'Content-Type':'application/json'}
    const token=(q('bridgeToken').value||'').trim()
    if(token) headers['Authorization']='Bearer '+token
    const r=await fetch(base+'/design',{method:'POST',headers,body:JSON.stringify(data),signal:controller.signal})
    if(r.status===401) throw new Error('The bridge needs pairing first. Press Pair with bridge, or paste the token under Advanced.')
    if(!r.ok) throw new Error('Server returned HTTP '+r.status+' '+r.statusText)
    const result=await r.json()
    parent.postMessage({pluginMessage:{type:'done',requestId,success:true,serverMessage:result.message}},'*')
  }catch(err){
    // A failed fetch is either no bridge at all or a bridge that cut the upload off.
    const failed=err.name==='TypeError',offline=failed&&!(await bridgeAnswers(base))
    const message=err.name==='AbortError'?'Sync timed out after 30 seconds. Try Sync page again.'
      :offline?'No bridge is running at '+base+'. Open Claude Code with the figma-bridge plugin, or run figma-bridge start, then sync again.'
      :failed?'The bridge at '+base+' dropped the upload, most likely because it is larger than the bridge accepts (FIGMA_BRIDGE_MAX_BODY_BYTES). Try Sync selection.'
      :err.message
    showError(failed?message:message+'\\nCheck the bridge at '+base+'.')
    parent.postMessage({pluginMessage:{type:'done',requestId,success:false,error:message}},'*')
  }finally{
    clearTimeout(timeout)
    setSyncing(false)
  }
}
async function bridgeAnswers(base){
  try{return (await fetch(base+'/bridge/health')).ok}catch{return false}
}
function waitingHint(){
  const url=bridgeConfig?String(bridgeConfig.url||'').replace(new RegExp('/+$'),''):bridgeBase()
  let text='Nothing answers at '+url+' yet. The bridge starts with Claude Code (figma-bridge plugin) or figma-bridge start, and this panel connects as soon as it is up.'
  // The manifest lets the plugin reach this one address only.
  if(url!==SERVER_URL) text+=' This plugin can only reach '+SERVER_URL+': reset the Bridge URL under Advanced.'
  return text
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
  if(!r.ok){const error=new Error((body&&body.error)||('Bridge HTTP '+r.status));error.status=r.status;throw error}
  return body
}
function bridgeStatus(connected,error){
  connectedNow=connected
  parent.postMessage({pluginMessage:{type:'bridge-status',connected,error:error||null}},'*')
  q('startBtn').disabled=connected;q('stopBtn').disabled=!connected
  if(connected) setStatus('connected','Connected')
  else if(waitingForBridge) setStatus('connecting','Waiting for the bridge...')
  else if(bridgeWanted) setStatus('connecting','Reconnecting...')
  else if(tokenRejected) setStatus('connecting','Pairing needed')
  else setStatus('disconnected','Disconnected')
  if(error) showError(error); else hideError()
  refreshSections()
}
async function closeBridgeSession(reason){
  if(!sessionId||!bridgeConfig) return
  // Figma tears the plugin down right after it closes; keepalive lets this
  // request outlive the panel instead of being cancelled with it.
  try{await fetch(bridgeConfig.url+'/bridge/session/'+encodeURIComponent(sessionId)+'?reason='+encodeURIComponent(reason||'plugin-stop'),{method:'DELETE',headers:bridgeHeaders(),keepalive:true})}catch{}
  sessionId=null;sessionSecret=null
}
function clearBridgeTimers(){
  if(pollController){pollController.abort();pollController=null}
  if(heartbeatTimer){clearTimeout(heartbeatTimer);heartbeatTimer=null}
  if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null}
  if(invalidateTimer){clearTimeout(invalidateTimer);invalidateTimer=null}
  invalidateNext=null
}
async function stopBridge(reason){
  bridgeWanted=false;waitingForBridge=false;clearBridgeTimers();await closeBridgeSession(reason||'plugin-stop');bridgeStatus(false)
}
function scheduleHeartbeat(){
  if(!bridgeWanted||!sessionId) return
  heartbeatTimer=setTimeout(async()=>{
    const sid=sessionId
    try{await bridgeFetch('/bridge/session/'+encodeURIComponent(sid)+'/heartbeat',{method:'POST',body:{}});if(sid===sessionId)scheduleHeartbeat()}
    // A failure of a session that was already replaced must not end the new one.
    catch(err){if(sid===sessionId)handleBridgeDisconnect(err)}
  },10000)
}
function handleBridgeDisconnect(err){
  if(!bridgeWanted) return
  clearBridgeTimers();sessionId=null;sessionSecret=null
  if(err&&err.tokenRejected){
    // Retrying with a token the bridge does not know cannot succeed; pairing can.
    bridgeWanted=false;waitingForBridge=false;tokenRejected=true
    bridgeStatus(false,'This bridge did not accept the saved token. Press Pair with bridge, or paste its token under Advanced.')
    return
  }
  // A failed fetch means nothing listens yet: wait quietly and keep trying.
  waitingForBridge=Boolean(err&&err.name==='TypeError')
  if(waitingForBridge) q('waitHint').textContent=waitingHint()
  bridgeStatus(false,waitingForBridge?null:err&&err.message)
  reconnectTimer=setTimeout(()=>connectBridge().catch(handleBridgeDisconnect),reconnectDelay)
  reconnectDelay=Math.min(reconnectDelay*2,waitingForBridge?5000:10000)
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
  if(!waitingForBridge) setStatus('connecting','Connecting...')
  let data
  try{
    data=await bridgeFetch('/bridge/session',{method:'POST',body:{fileKey:bridgeConfig.fileKey,fileName:bridgeConfig.fileName,pluginInstanceId:bridgeConfig.pluginInstanceId,capabilities:['read-node','read-document-index','figma-rest','edit-seq','assets','render']}},false)
  }catch(err){
    // Registering checks the token alone, so a 401 here means the token is wrong.
    if(err.status===401) err.tokenRejected=true
    throw err
  }
  if(!bridgeWanted) return
  waitingForBridge=false;tokenRejected=false
  sessionId=data.sessionId;sessionSecret=data.sessionSecret;reconnectDelay=750;bridgeStatus(true);scheduleHeartbeat()
  pollBridge().catch(err=>{if(bridgeWanted&&err.name!=='AbortError')handleBridgeDisconnect(err)})
}
async function beginBridge(config){
  await stopBridge('reconnect');bridgeConfig=config;bridgeWanted=true;tokenRejected=false;reconnectDelay=750
  connectBridge().catch(handleBridgeDisconnect)
}
async function sendBridgeReply(msg){
  if(!bridgeWanted||!sessionId||msg.sessionId!==sessionId) return
  const path='/bridge/session/'+encodeURIComponent(sessionId)+'/reply'
  try{
    await bridgeFetch(path,{method:'POST',body:{requestId:msg.requestId,ok:msg.ok,result:msg.result,error:msg.error}})
  }catch(err){
    // A reply the bridge refuses, such as one over its size limit, fails that
    // read with the reason instead of dropping the session and every queued read.
    // If the session changed meanwhile, the old reply has nowhere to go.
    if(!bridgeWanted||sessionId!==msg.sessionId) return
    try{await bridgeFetch(path,{method:'POST',body:{requestId:msg.requestId,ok:false,error:'The bridge did not accept the plugin reply: '+err.message}})}
    catch(retryErr){handleBridgeDisconnect(retryErr)}
  }
}
// Figma reports every keystroke and drag step as an edit. One invalidate goes
// out at a time; edits made meanwhile share a single one, sent a second after
// it returns. Cached reads are already reported unverified, so the delay is safe.
async function invalidateBridge(msg){
  if(!bridgeWanted||!sessionId) return
  if(invalidating||invalidateTimer){invalidateNext=msg;return}
  invalidating=true
  const sid=sessionId
  try{await bridgeFetch('/bridge/session/'+encodeURIComponent(sid)+'/invalidate',{method:'POST',body:{fileKey:msg.fileKey,reason:msg.reason||'documentchange'}})}
  catch(err){if(sid===sessionId)handleBridgeDisconnect(err)}
  finally{invalidating=false}
  if(invalidateNext) invalidateTimer=setTimeout(sendNextInvalidate,1000)
}
function sendNextInvalidate(){
  const msg=invalidateNext
  invalidateTimer=null;invalidateNext=null
  invalidateBridge(msg)
}
// Pairing: the bridge hands this panel its token once someone who already has
// it approves the code shown here, in Claude Code or in a terminal.
function showExpiry(){
  if(!pairing) return
  const left=Math.max(0,Math.round((pairing.expiresAt-Date.now())/1000))
  q('pairExpiry').textContent='Expires in '+Math.floor(left/60)+':'+String(left%60).padStart(2,'0')
}
function cancelPairing(){
  pairing=null
  if(pairTimer){clearTimeout(pairTimer);pairTimer=null}
  toggle('pairInfo',false)
  q('pairBtn').disabled=false
}
async function startPairing(){
  hideError()
  cancelPairing()
  const base=bridgeBase()
  let r=null,body=null
  try{
    r=await fetch(base+'/bridge/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientName:'Figma Design Bridge plugin',fileName:(q('pageName').textContent||'').slice(0,200)})})
    try{body=await r.json()}catch{}
  }catch(err){
    showError('No bridge is running at '+base+'. Open Claude Code with the figma-bridge plugin, or run figma-bridge start, then press Pair with bridge again.')
    return
  }
  // Asking to pair needs no token since 1.2.0. A bridge that wants one for it,
  // or does not know the route, is older and cannot pair at all.
  if(r.status===401||r.status===404){showError('The bridge running at '+base+' is too old to pair: pairing needs 1.2.0 or later. Update the figma-bridge plugin in Claude Code or Codex, or the clone that runs the bridge, restart it, then press Pair with bridge again.');return}
  if(!r.ok||!body||!body.code){showError((body&&body.error)||('Bridge HTTP '+r.status));return}
  pairing={id:body.pairingId,secret:body.pairingSecret,code:body.code,expiresAt:Date.parse(body.expiresAt)||Date.now()+120000,base}
  q('pairCode').textContent=pairing.code.slice(0,3)+' '+pairing.code.slice(3)
  q('pairCommand').textContent='/figma-bridge:pair '+pairing.code
  q('pairCli').textContent='figma-bridge pair '+pairing.code
  toggle('pairInfo',true)
  q('pairBtn').disabled=true
  showExpiry()
  pairTimer=setTimeout(pollPairing,1500)
}
async function pollPairing(){
  pairTimer=null
  const current=pairing
  if(!current) return
  let r=null,body=null
  try{
    r=await fetch(current.base+'/bridge/pair/'+current.id,{headers:{'X-Pairing-Secret':current.secret}})
    try{body=await r.json()}catch{}
  }catch{}
  if(pairing!==current) return
  if(r&&r.ok&&body&&body.status==='approved'&&body.token){
    cancelPairing()
    q('bridgeToken').value=body.token
    tokenRejected=false
    refreshSections()
    parent.postMessage({pluginMessage:{type:'paired',token:body.token,serverUrl:current.base,fileSource:q('fileSource').value}},'*')
    return
  }
  if(r&&(r.status===404||r.status===410)){
    cancelPairing()
    showError('The pairing code expired. Press Pair with bridge for a new one.')
    return
  }
  showExpiry()
  pairTimer=setTimeout(pollPairing,1500)
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
    case 'bridge-stop': cancelPairing(); await stopBridge(msg.reason); break
  }
})
q('syncBtn').addEventListener('click',()=>parent.postMessage({pluginMessage:{type:'request-sync',scope:'page'}},'*'))
q('syncSelectionBtn').addEventListener('click',()=>parent.postMessage({pluginMessage:{type:'request-sync',scope:'selection'}},'*'))
q('autoSync').addEventListener('change',e=>parent.postMessage({pluginMessage:{type:'set-auto-sync',enabled:e.target.checked}},'*'))
q('bridgeToken').addEventListener('change',e=>{
  // A new token replaces the one the bridge refused: clear what was said about it.
  if(tokenRejected&&!bridgeWanted){tokenRejected=false;hideError();setStatus(hasToken()?'disconnected':'connecting',hasToken()?'Not connected':'Not paired yet')}
  parent.postMessage({pluginMessage:{type:'set-token',token:e.target.value}},'*');refreshSections()
})
q('startBtn').addEventListener('click',()=>parent.postMessage({pluginMessage:{type:'connect-bridge',serverUrl:q('bridgeUrl').value,token:q('bridgeToken').value,fileSource:q('fileSource').value}},'*'))
q('stopBtn').addEventListener('click',()=>{stopBridge('plugin-stop');parent.postMessage({pluginMessage:{type:'bridge-stopped'}},'*')})
q('pairBtn').addEventListener('click',()=>{startPairing()})
q('cancelPairBtn').addEventListener('click',()=>{cancelPairing();hideError()})
parent.postMessage({pluginMessage:{type:'ui-ready'}},'*')
<\/script>`

function markBridgeTruncated(limits, nodeId) {
  if (!limits || !limits.state) return
  limits.state.limitHit = true
  if (nodeId && !limits.state.truncatedNodeIds.includes(nodeId)) {
    limits.state.truncatedNodeIds.push(nodeId)
  }
}

function bridgeBudgetSpent(limits) {
  return limits.state.nodeCount >= limits.maxNodes || limits.state.byteSize >= limits.maxBytes
}

// Decides whether a node is walked. Returns a placeholder when a limit cuts it,
// null for a hidden layer the read leaves out, and undefined to serialize it.
function cutNode(node, depth, limits) {
  if (limits && limits.state) {
    if (depth > limits.maxDepth || bridgeBudgetSpent(limits)) {
      markBridgeTruncated(limits, node.id)
      return placeholderFor(node)
    }
    if (depth > 0 && limits.includeHidden === false && node.visible === false) return null
    limits.state.nodeCount++
  } else if (depth > 30) {
    return { id: node.id, name: node.name, type: node.type, truncated: true }
  }
  return undefined
}

// Counts a node's own fields toward maxBytes. Returns true when that spends the
// budget, so the node is kept but its children are left out.
function spendNodeBytes(obj, node, limits) {
  if (!limits || !limits.state) return false
  try {
    limits.state.byteSize += JSON.stringify(obj).length + 2
  } catch {
    limits.state.byteSize += 256
  }
  if (limits.state.byteSize < limits.maxBytes) return false
  markBridgeTruncated(limits, node.id)
  obj.truncated = true
  return true
}

function serializeNode(node, depth, limits) {
  const cut = cutNode(node, depth, limits)
  if (cut !== undefined) return cut
  const obj = describeNode(node, limits)
  if (spendNodeBytes(obj, node, limits)) return obj

  if ('children' in node && node.children.length > 0) {
    if (limits && limits.state) {
      obj.children = []
      for (const child of node.children) {
        if (bridgeBudgetSpent(limits)) {
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

// Bridge reads walk thousands of nodes at a few hundred a second. Done in one
// go, that freezes Figma and the panel with it, and a panel that cannot send a
// heartbeat for 90 seconds loses its session. The paced walk hands control back
// to Figma whenever it has worked for a slice.
const BRIDGE_SLICE_MS = 50

function createPacer(sliceMs = BRIDGE_SLICE_MS) {
  let sliceStart = Date.now()
  return async function pace() {
    if (Date.now() - sliceStart < sliceMs) return
    await new Promise(resolve => setTimeout(resolve, 0))
    sliceStart = Date.now()
  }
}

async function serializeNodePaced(node, depth, limits, pace) {
  await pace()
  const cut = cutNode(node, depth, limits)
  if (cut !== undefined) return cut
  const obj = describeNode(node, limits)
  if (spendNodeBytes(obj, node, limits)) return obj

  if ('children' in node && node.children.length > 0) {
    obj.children = []
    for (const child of node.children) {
      // Figma may apply an edit while the walk is paused; a layer deleted by
      // then is skipped rather than failing the whole read.
      if (child.removed) continue
      // Once the budget is spent, each child left comes back as a placeholder,
      // so the layers not read are still named.
      if (bridgeBudgetSpent(limits)) {
        if (limits.includeHidden === false && child.visible === false) continue
        if (obj.truncated !== true) {
          markBridgeTruncated(limits, node.id)
          obj.truncated = true
        }
      }
      const serialized = await serializeNodePaced(child, depth + 1, limits, pace)
      if (serialized) obj.children.push(serialized)
    }
    if (obj.children.length === 0) delete obj.children
  }

  return obj
}

function describeNode(node, limits) {
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
  } else if (isBox && typeof node.cornerRadius === 'symbol' && typeof node.topLeftRadius === 'number') {
    // Corners that differ read as figma.mixed, so each one is read on its own,
    // in the order the REST API gives them.
    obj.rectangleCornerRadii = [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius]
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

// The caps keep a read inside what the plugin can serve: 20,000 nodes take
// about 90 seconds to walk, and the bridge waits two minutes at most. Depth
// is not limited unless asked: nested instances put text 20 levels down, and
// maxNodes and maxBytes already bound the read.
function bridgeLimits(options = {}) {
  const integer = (value, fallback, min, max) => Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback
  return {
    maxDepth: integer(options.depth, 50, 0, 50),
    maxNodes: integer(options.maxNodes, 5000, 1, 20_000),
    maxBytes: integer(options.maxBytes, 2_000_000, 1024, 10_000_000),
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

// maxBytes is a promise about the bytes the bridge receives, and non-ASCII text
// takes more UTF-8 bytes than its string length, so sizes are counted in UTF-8.
function utf8Length(text) {
  // Native scan first: an ASCII payload is as long in bytes as in characters,
  // and the loop below is slow in an interpreted plugin sandbox.
  if (!/[^\x00-\x7f]/.test(text)) return text.length
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length
      && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4
      i++
    } else bytes += 3
  }
  return bytes
}

function jsonBytes(value) {
  const text = JSON.stringify(value)
  return typeof text === 'string' ? utf8Length(text) : 0
}

// Counts the nodes the caller actually receives, placeholders included, rather
// than the nodes the walk visited before a limit cut the payload down.
function countPayloadNodes(value) {
  if (!value || typeof value !== 'object') return 0
  if (Array.isArray(value.pages)) {
    return value.pages.reduce((sum, page) => sum + countPayloadNodes(page), 0)
  }
  let count = 1
  if (Array.isArray(value.children)) {
    for (const child of value.children) count += countPayloadNodes(child)
  }
  return count
}

// knownSize spares serializing the payload again when the caller already has it.
function completenessFor(payload, limits, knownSize) {
  let byteSize = 0
  if (knownSize !== undefined) byteSize = knownSize
  else try { byteSize = jsonBytes(payload) } catch { byteSize = limits.state.byteSize }
  return {
    nodeCount: countPayloadNodes(payload),
    byteSize,
    limitHit: limits.state.limitHit || byteSize > limits.maxBytes,
    truncatedNodeIds: limits.state.truncatedNodeIds.slice(0, 200),
  }
}

// What a read leaves in place of a layer it did not include: enough to read
// that layer on its own, by id.
function placeholderFor(node, type = node.type) {
  return { id: node.id, name: node.name, type, truncated: true }
}

function isPlaceholder(node) {
  return node.truncated === true && !Array.isArray(node.children)
    && Object.keys(node).every(key => key === 'id' || key === 'name' || key === 'type' || key === 'truncated')
}

// Trims the payload from the end of the tree until it fits. The last layer
// still whole, deepest first, becomes a placeholder, and a layer whose
// children are all placeholders becomes one itself, so every layer left out
// is still named and can be read by id. The serializer's running estimate
// leaves out the nesting overhead, so a cut subtree can still come out over
// budget; trimming from the end keeps every node that fits instead of dropping
// the whole subtree. Returns the final size.
function pruneTrailingNodes(root, limits, size = jsonBytes(root)) {
  while (size > limits.maxBytes) {
    let parent = null
    let index = -1
    let node = root
    for (;;) {
      const children = Array.isArray(node.children) ? node.children : []
      let last = children.length - 1
      while (last >= 0 && isPlaceholder(children[last])) last--
      if (last < 0) break
      parent = node
      index = last
      node = children[last]
    }

    if (parent) {
      const placeholder = placeholderFor(node)
      parent.children[index] = placeholder
      size -= jsonBytes(node) - jsonBytes(placeholder)
      markBridgeTruncated(limits, node.id)
    } else {
      // Only placeholders are left under the root: they go too, from the end.
      if (!Array.isArray(root.children) || !root.children.length) break
      parent = root
      const removed = root.children.pop()
      if (root.children.length) {
        size -= jsonBytes(removed) + 1 // the placeholder and the comma before it
      } else {
        delete root.children
        size -= jsonBytes(removed) + 14 // `,"children":[` + placeholder + `]`
      }
    }
    // A parent already flagged was recorded when it was flagged, so each one is
    // recorded once rather than once per removed child.
    if (parent.truncated !== true) {
      parent.truncated = true
      size += 17 // `,"truncated":true`
      markBridgeTruncated(limits, parent.id)
    }
    // Confirm against the real serialization before stopping.
    if (size <= limits.maxBytes) size = jsonBytes(root)
  }
  return size
}

function fitNodePayloadToLimit(payload, limits, nodeId, knownSize) {
  if (!payload) return payload
  let size = 0
  if (knownSize !== undefined) size = knownSize
  else try { size = jsonBytes(payload) } catch { size = 0 }
  if (!size || size <= limits.maxBytes) return payload

  if (pruneTrailingNodes(payload, limits, size) <= limits.maxBytes) return payload

  // Only the requested node is left, and it is too large on its own.
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
      if (jsonBytes(fitted) <= limits.maxBytes) low = mid
      else high = mid - 1
    }
    fitted.characters = original.slice(0, low)
  }

  if (jsonBytes(fitted) <= limits.maxBytes) return fitted

  const minimal = {
    id: String(payload.id || nodeId || '').slice(0, 128),
    type: String(payload.type || 'UNKNOWN').slice(0, 64),
    truncated: true,
  }
  if (payload.name) minimal.name = String(payload.name).slice(0, 256)
  while (minimal.name && jsonBytes(minimal) > limits.maxBytes) {
    minimal.name = minimal.name.slice(0, Math.floor(minimal.name.length / 2))
  }
  return minimal
}

// Same trimming as pruneTrailingNodes, with the size kept up to date by
// arithmetic instead of serializing the whole index after every removal.
function fitDocumentIndexToLimit(payload, limits) {
  if (!payload) return payload
  let size = jsonBytes(payload)
  if (size <= limits.maxBytes) return payload
  markBridgeTruncated(limits)
  const pages = payload.pages || []
  while (pages.length && size > limits.maxBytes) {
    const last = pages[pages.length - 1]
    if (last.children && last.children.length) {
      const removed = last.children.pop()
      markBridgeTruncated(limits, removed && removed.id)
      if (last.children.length) {
        size -= jsonBytes(removed) + 1 // the entry and the comma before it
      } else {
        delete last.children
        size -= jsonBytes(removed) + 14 // `,"children":[` + entry + `]`
      }
      if (last.truncated !== true) {
        last.truncated = true
        size += 17 // `,"truncated":true`
      }
    } else {
      const removed = pages.pop()
      markBridgeTruncated(limits, removed && removed.id)
      size -= jsonBytes(removed) + (pages.length ? 1 : 0)
    }
    // Confirm against the real serialization before stopping.
    if (size <= limits.maxBytes) size = jsonBytes(payload)
  }
  return payload
}

function missingBridgeNode(nodeId) {
  return {
    fileKey: state.bridgeFileKey, fileName: state.bridgeFileName, nodeId,
    pageId: null, pageName: null, found: false, truncated: false,
    completeness: { nodeCount: 0, byteSize: 0, limitHit: false, truncatedNodeIds: [] }, payload: null,
  }
}

async function readBridgeNode(request) {
  const params = request.params || {}
  const limits = bridgeLimits(params.options || {})
  const node = await figma.getNodeByIdAsync(params.nodeId)
  if (!node) return missingBridgeNode(params.nodeId)

  // The walked tree is released as soon as it is serialized, and parsing that
  // text gives the copy structured clone accepts (no figma.mixed symbols), so
  // the plugin never holds the tree, its text and the copy at once. The text's
  // size is the payload's, and serializing again is needed only to trim it.
  let text = JSON.stringify(await serializeNodePaced(node, 0, limits, createPacer()))
  let size = utf8Length(text)
  let payload = JSON.parse(text)
  text = null
  if (size > limits.maxBytes) {
    payload = fitNodePayloadToLimit(payload, limits, node.id, size)
    size = undefined
  }
  const completeness = completenessFor(payload, limits, size)
  const page = findPageForNode(node)
  return {
    fileKey: state.bridgeFileKey, fileName: state.bridgeFileName, nodeId: node.id,
    pageId: page ? page.id : null, pageName: page ? page.name : null, found: true,
    truncated: completeness.limitHit, completeness, payload,
  }
}

// The 'figma-rest' representation: Figma serializes the node itself, in the
// JSON of the REST API's GET /v1/files/:key/nodes. That is every property the
// file stores, mixed values included (each corner's radius, every text style
// run, bound variables), much faster than reading properties one at a time,
// and nothing leaves Figma: no REST token, no API quota.
//
// One export holds a subtree whole, so a subtree is measured first and only
// one that fits what is left of the read's limits is exported. A larger one
// is described from its own properties, marked partial, and its children are
// taken one by one.
const MAX_EXPORT_NODES = 5000
const MAX_BRIDGE_VARIABLES = 2000
const REST_MAPS = ['components', 'componentSets', 'styles', 'variables']
const VECTOR_TYPES = ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'LINE', 'ELLIPSE', 'REGULAR_POLYGON', 'RECTANGLE']

// The bridge sends the representation with its limits after a '+', as in
// 'figma-rest+geometry+d4'.
function representationParts(request) {
  return String(request.params?.representation || '').split('+')
}

function wantsRestFormat(request) {
  return representationParts(request)[0] === 'figma-rest'
}

function restNodeType(type) {
  return type === 'PAGE' ? 'CANVAS' : type
}

// Measures a subtree before it is exported: how many layers it has and how
// many levels it goes down, stopping once either is more than the read has
// room for. A subtree measured in full is remembered, so a container found too
// large is not measured again when its children are taken one by one.
async function measureSubtree(node, room, levels, read) {
  const known = read.sizes.get(node.id)
  if (known) return known
  await read.pace()
  const size = { count: 1, height: 0 }
  let children = []
  // A layer deleted while the walk was paused counts as nothing.
  try { if ('children' in node) children = node.children } catch { return { count: 0, height: 0 } }
  for (const child of children) {
    if (size.count > room || size.height > levels) return size
    const below = await measureSubtree(child, room - size.count, levels - 1, read)
    size.count += below.count
    size.height = Math.max(size.height, below.height + 1)
  }
  if (size.count <= room && size.height <= levels) read.sizes.set(node.id, size)
  return size
}

function exportFailure(node, reason) {
  const error = new Error(`Figma could not export layer ${node.id} as JSON: ${reason}`)
  error.exportFailed = true
  return error
}

// One call into Figma. The components, component sets and styles the subtree
// uses are merged into the read's maps.
async function exportRestNode(node, read) {
  const started = Date.now()
  let exported
  try {
    exported = await node.exportAsync({ format: 'JSON_REST_V1' })
  } catch (error) {
    throw exportFailure(node, (error && error.message) || String(error))
  } finally {
    read.timing.exportMs += Date.now() - started
  }
  if (typeof exported === 'string') exported = JSON.parse(exported)
  if (!exported || typeof exported !== 'object') throw exportFailure(node, 'the export is empty')
  const document = exported.document && typeof exported.document === 'object'
    ? exported.document
    : (exported.id && exported.type ? exported : null)
  if (!document) throw exportFailure(node, 'the export has no document')
  for (const key of ['components', 'componentSets', 'styles']) {
    if (exported[key] && typeof exported[key] === 'object') Object.assign(read[key], exported[key])
  }
  read.exports++
  return document
}

// Applies the read's limits to a subtree Figma exported whole: hidden layers
// left out when asked, and text capped along with its per-character styles.
function trimExport(restNode, depth, read) {
  const { limits } = read
  if (depth > 0 && !limits.includeHidden && restNode.visible === false) return null
  limits.state.nodeCount++
  if (typeof restNode.characters === 'string' && restNode.characters.length > limits.maxTextChars) {
    restNode.characters = restNode.characters.slice(0, limits.maxTextChars)
    if (Array.isArray(restNode.characterStyleOverrides)) {
      restNode.characterStyleOverrides = restNode.characterStyleOverrides.slice(0, limits.maxTextChars)
    }
    const lines = restNode.characters.split('\n').length
    for (const key of ['lineTypes', 'lineIndentations']) {
      if (Array.isArray(restNode[key])) restNode[key] = restNode[key].slice(0, lines)
    }
    restNode.textTruncated = true
    markBridgeTruncated(limits, restNode.id)
  }
  if (read.geometry && VECTOR_TYPES.includes(restNode.type)) read.vectors.push(restNode)
  if (Array.isArray(restNode.children)) {
    const kept = []
    for (const child of restNode.children) {
      const trimmed = trimExport(child, depth + 1, read)
      if (trimmed) kept.push(trimmed)
    }
    restNode.children = kept
  }
  return restNode
}

// Read as they are: the plugin API and the REST API use the same names and
// values for these.
const OUTLINE_FIELDS = [
  'blendMode', 'opacity', 'clipsContent', 'layoutMode', 'layoutWrap',
  'primaryAxisSizingMode', 'counterAxisSizingMode', 'primaryAxisAlignItems', 'counterAxisAlignItems',
  'counterAxisAlignContent', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
  'itemSpacing', 'counterAxisSpacing', 'itemReverseZIndex', 'strokesIncludedInLayout',
  'layoutAlign', 'layoutGrow', 'layoutPositioning', 'layoutSizingHorizontal', 'layoutSizingVertical',
  'minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'strokeWeight', 'strokeAlign',
  'cornerRadius', 'cornerSmoothing',
]

function restPaint(paint) {
  const rest = { blendMode: paint.blendMode || 'NORMAL', type: paint.type }
  if (paint.visible === false) rest.visible = false
  if (typeof paint.opacity === 'number' && paint.opacity !== 1) rest.opacity = paint.opacity
  if (paint.color) rest.color = { r: paint.color.r, g: paint.color.g, b: paint.color.b, a: 1 }
  if (paint.gradientStops) rest.gradientStops = sanitizeForMessage(paint.gradientStops)
  if (paint.gradientTransform) rest.gradientTransform = sanitizeForMessage(paint.gradientTransform)
  if (paint.imageHash) rest.imageRef = paint.imageHash
  if (paint.scaleMode) rest.scaleMode = paint.scaleMode
  // Without these a cropped, tiled or rotated image reads as one that fills
  // its layer.
  for (const field of ['imageTransform', 'scalingFactor', 'rotation', 'filters']) {
    if (paint[field] !== undefined) rest[field] = sanitizeForMessage(paint[field])
  }
  if (paint.boundVariables && Object.keys(paint.boundVariables).length) {
    rest.boundVariables = sanitizeForMessage(paint.boundVariables)
  }
  return rest
}

// A layer too large to export whole: its own box, layout and paint, read from
// the plugin API in the REST API's names. Its children follow under it.
function outlineNode(node) {
  const outline = { id: node.id, name: node.name, type: restNodeType(node.type), partial: true }
  const read = key => { try { return node[key] } catch { return undefined } }
  const visible = read('visible')
  if (typeof visible === 'boolean') outline.visible = visible
  for (const field of ['absoluteBoundingBox', 'absoluteRenderBounds']) {
    const box = read(field)
    if (box && typeof box === 'object') outline[field] = { x: box.x, y: box.y, width: box.width, height: box.height }
  }
  for (const field of OUTLINE_FIELDS) {
    const value = read(field)
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') outline[field] = value
  }
  if (typeof read('cornerRadius') === 'symbol' && typeof read('topLeftRadius') === 'number') {
    outline.rectangleCornerRadii = [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius]
  }
  if (typeof read('strokeWeight') === 'symbol' && typeof read('strokeTopWeight') === 'number') {
    outline.individualStrokeWeights = {
      top: node.strokeTopWeight, right: node.strokeRightWeight, bottom: node.strokeBottomWeight, left: node.strokeLeftWeight,
    }
  }
  for (const field of ['fills', 'strokes']) {
    const paints = read(field)
    if (Array.isArray(paints) && paints.length) outline[field] = paints.map(restPaint)
  }
  const effects = read('effects')
  if (Array.isArray(effects) && effects.length) outline.effects = sanitizeForMessage(effects)
  const dashes = read('dashPattern')
  if (Array.isArray(dashes) && dashes.length) outline.strokeDashes = [...dashes]
  const bound = read('boundVariables')
  if (bound && typeof bound === 'object' && Object.keys(bound).length) outline.boundVariables = sanitizeForMessage(bound)
  if (node.type === 'INSTANCE') {
    const main = read('mainComponent')
    if (main) outline.componentId = main.id
    const properties = read('componentProperties')
    if (properties && typeof properties === 'object') outline.componentProperties = sanitizeForMessage(properties)
  }
  if (node.type === 'PAGE') {
    const background = (read('backgrounds') || [])[0]
    if (background && background.type === 'SOLID') {
      outline.backgroundColor = { ...background.color, a: typeof background.opacity === 'number' ? background.opacity : 1 }
    }
  }
  return outline
}

// Returns the node as Figma exports it when its subtree fits, an outline with
// its children taken one by one when it does not, a placeholder once a limit
// is reached, and null for a hidden layer the read leaves out.
async function exportWithin(node, depth, read) {
  const { limits } = read
  await read.pace()
  if (depth > 0 && !limits.includeHidden && node.visible === false) return null
  if (depth > limits.maxDepth || bridgeBudgetSpent(limits)) {
    markBridgeTruncated(limits, node.id)
    return placeholderFor(node, restNodeType(node.type))
  }

  let exportError = null
  // A page is mostly what is on it, and the document has no export.
  if (node.type !== 'PAGE' && node.type !== 'DOCUMENT') {
    const room = Math.min(limits.maxNodes - limits.state.nodeCount, MAX_EXPORT_NODES)
    const levels = limits.maxDepth - depth
    const measured = Date.now()
    const size = await measureSubtree(node, room, levels, read)
    read.timing.countMs += Date.now() - measured
    if (size.count <= room && size.height <= levels) {
      try {
        const exported = trimExport(await exportRestNode(node, read), depth, read)
        if (depth > 0) limits.state.byteSize += JSON.stringify(exported).length + 1
        return exported
      } catch (error) {
        // Until one export has worked, a failure may mean this Figma cannot
        // export JSON at all, and the read falls back as a whole.
        if (!error.exportFailed || read.exports === 0) throw error
        exportError = error.message
      }
    }
  }

  limits.state.nodeCount++
  const outline = outlineNode(node)
  if (exportError) outline.exportError = exportError
  limits.state.byteSize += JSON.stringify(outline).length + 1
  let children = []
  try { if ('children' in node) children = node.children } catch {}
  if (children.length) {
    outline.children = []
    for (const child of children) {
      // Figma may apply an edit while the read is paused; a layer deleted by
      // then is skipped rather than failing the whole read.
      if (child.removed) continue
      // Once the budget is spent, each child left comes back as a placeholder,
      // so the layers not read are still named.
      if (bridgeBudgetSpent(limits) && outline.truncated !== true) {
        markBridgeTruncated(limits, node.id)
        outline.truncated = true
      }
      const exported = await exportWithin(child, depth + 1, read)
      if (exported) outline.children.push(exported)
    }
  }
  return outline
}

// Asked for with 'geometry': the vector paths, as REST returns them for
// geometry=paths. The export leaves them out.
async function addGeometry(read) {
  for (const restNode of read.vectors) {
    await read.pace()
    let node = null
    try { node = await figma.getNodeByIdAsync(restNode.id) } catch {}
    if (!node) continue
    for (const field of ['fillGeometry', 'strokeGeometry']) {
      try {
        const paths = node[field]
        if (paths && paths.length) restNode[field] = Array.from(paths, path => ({ path: String(path.data), windingRule: path.windingRule }))
      } catch {}
    }
  }
}

// Bound variables arrive as ids. Each is named here, with its collection and
// the code syntax set for it, so a value can be traced back to its token.
async function resolveVariables(ids, read) {
  const variables = {}
  const api = figma.variables
  if (!ids.length || !api || typeof api.getVariableByIdAsync !== 'function') return variables
  const collections = new Map()
  for (const id of ids.slice(0, MAX_BRIDGE_VARIABLES)) {
    await read.pace()
    let variable = null
    try { variable = await api.getVariableByIdAsync(id) } catch {}
    // A library variable the file never imported cannot be looked up.
    if (!variable) continue
    const collectionId = variable.variableCollectionId
    if (!collections.has(collectionId)) {
      let collection = null
      try { collection = await api.getVariableCollectionByIdAsync(collectionId) } catch {}
      collections.set(collectionId, collection)
    }
    const collection = collections.get(collectionId)
    const entry = { name: variable.name, resolvedType: variable.resolvedType }
    if (collection && collection.name) entry.collection = collection.name
    if (variable.codeSyntax && Object.keys(variable.codeSyntax).length) entry.codeSyntax = { ...variable.codeSyntax }
    if (variable.description) entry.description = variable.description
    if (variable.remote) entry.remote = true
    if (variable.key) entry.key = variable.key
    variables[id] = entry
  }
  return variables
}

// The tree gives way first: the maps only say what its layers use. They are
// cleared only when they alone leave the tree too little room.
function fitRestPayloadToLimit(payload, limits, nodeId, size) {
  const documentSize = jsonBytes(payload.document)
  let room = limits.maxBytes - (size - documentSize)
  if (room < 1024) {
    for (const key of REST_MAPS) payload[key] = {}
    markBridgeTruncated(limits, nodeId)
    room = limits.maxBytes - (jsonBytes({ ...payload, document: null }) - 4) // "null" is the tree's place
  }
  payload.document = fitNodePayloadToLimit(payload.document, { ...limits, maxBytes: room }, nodeId, documentSize)
  return jsonBytes(payload)
}

async function readBridgeNodeRest(request) {
  const started = Date.now()
  const params = request.params || {}
  const limits = bridgeLimits(params.options || {})
  const node = await figma.getNodeByIdAsync(params.nodeId)
  if (!node) return missingBridgeNode(params.nodeId)

  const read = {
    limits, pace: createPacer(), sizes: new Map(), exports: 0,
    geometry: representationParts(request).includes('geometry'), vectors: [],
    components: {}, componentSets: {}, styles: {},
    timing: { countMs: 0, exportMs: 0, totalMs: 0 },
  }
  let document
  try {
    document = await exportWithin(node, 0, read)
  } catch (error) {
    if (!error.exportFailed || read.exports > 0) throw error
    // This Figma did not export the node as JSON: read it the way older
    // plugins did, and say why.
    const result = await readBridgeNode(request)
    result.format = 'node-subtree'
    result.fallbackReason = error.message
    return result
  }
  read.sizes = null
  if (read.geometry) await addGeometry(read)

  const payload = { document, components: read.components, componentSets: read.componentSets, styles: read.styles }
  let text = JSON.stringify(payload)
  let size = utf8Length(text)
  const variableIds = [...new Set(text.match(/"VariableID:[^"\\]*"/g) || [])].map(id => id.slice(1, -1))
  text = null
  payload.variables = await resolveVariables(variableIds, read)
  size += utf8Length(',"variables":') + jsonBytes(payload.variables)
  if (size > limits.maxBytes) size = fitRestPayloadToLimit(payload, limits, node.id, size)

  const completeness = completenessFor(payload.document, limits, size)
  const page = findPageForNode(node)
  read.timing.totalMs = Date.now() - started
  return {
    fileKey: state.bridgeFileKey, fileName: state.bridgeFileName, nodeId: node.id,
    pageId: page ? page.id : null, pageName: page ? page.name : null, found: true,
    truncated: completeness.limitHit, completeness, format: 'figma-rest', timing: read.timing, payload,
  }
}

// The 'assets' representation: what code takes from a design as files. An icon
// is drawn in Figma as a frame of vector layers, and code needs it as one SVG,
// not as the paths a node read describes. Figma exports it itself, as Copy as
// SVG does, and an image fill's bytes are the file the designer placed.
const PATH_TYPES = ['VECTOR', 'BOOLEAN_OPERATION', 'STAR', 'REGULAR_POLYGON', 'POLYGON']
const SHAPE_TYPES = [...PATH_TYPES, 'ELLIPSE', 'RECTANGLE', 'LINE']
const ICON_CONTAINERS = ['FRAME', 'GROUP', 'INSTANCE', 'COMPONENT']
// Longest side of a rendered node, in pixels: larger renders are scaled down.
const MAX_RENDER_SIDE = 4096

function representationBase(request) {
  return representationParts(request)[0]
}

function readValue(node, key) {
  try { return node[key] } catch { return undefined }
}

function shownPaints(paints) {
  return Array.isArray(paints) ? paints.filter(paint => paint && paint.visible !== false && paint.opacity !== 0) : []
}

// A frame or instance with a fill, stroke or shadow of its own is a box code
// draws, such as a chip or a button, rather than part of an icon.
function hasOwnPaint(node) {
  return shownPaints(readValue(node, 'fills')).length > 0
    || shownPaints(readValue(node, 'strokes')).length > 0
    || shownPaints(readValue(node, 'effects')).length > 0
}

function roundSize(value) {
  return typeof value === 'number' ? Math.round(value * 100) / 100 : null
}

// What one layer in the walk is: a vector it can export as one SVG, with how
// many paths and shapes draw it, or the icons found inside it.
async function walkAssets(node, trail, read) {
  const { limits } = read
  await read.pace()
  if (node.removed || readValue(node, 'visible') === false || readValue(node, 'opacity') === 0) return null
  if (bridgeBudgetSpent(limits)) {
    markBridgeTruncated(limits, node.id)
    return { vector: false, paths: 0, shapes: 0, icons: [] }
  }
  limits.state.nodeCount++

  let drawsImage = false
  for (const field of ['fills', 'strokes']) {
    const paints = shownPaints(readValue(node, field))
    const stack = field === 'fills' ? paints : null
    for (const paint of paints) {
      if (paint.type === 'IMAGE' && paint.imageHash) {
        drawsImage = true
        addImageUse(read, paint.imageHash, 'IMAGE', node, paint, trail, stack)
      } else if (paint.type === 'VIDEO') {
        drawsImage = true
        addImageUse(read, paint.videoHash || node.id, 'VIDEO', node, paint, trail, stack)
      }
    }
  }

  const type = node.type
  if (SHAPE_TYPES.includes(type)) {
    if (drawsImage) return { vector: false, paths: 0, shapes: 0, icons: [] }
    const paths = PATH_TYPES.includes(type) ? 1 : 0
    // A path alone is an icon; a rectangle or circle alone is a box code draws.
    return { vector: true, paths, shapes: 1, isIcon: paths > 0, node: { node, trail }, icons: [] }
  }

  let children = []
  try { if ('children' in node) children = node.children } catch {}
  const below = trail.concat(node.name)
  const parts = []
  for (const child of children) {
    const part = await walkAssets(child, below, read)
    if (part) parts.push(part)
  }
  const icons = parts.flatMap(part => (part.vector ? (part.isIcon ? [part.node] : []) : part.icons))
  const vector = ICON_CONTAINERS.includes(type) && !drawsImage && parts.length > 0 && parts.every(part => part.vector)
    && (type === 'GROUP' || !hasOwnPaint(node))
  if (!vector) return { vector: false, paths: 0, shapes: 0, icons }
  const paths = parts.reduce((sum, part) => sum + part.paths, 0)
  const shapes = parts.reduce((sum, part) => sum + part.shapes, 0)
  // A path, or two shapes or more, is an icon; one rectangle or circle alone
  // is a box code draws itself.
  const isIcon = paths > 0 || shapes >= 2
  return { vector: true, paths, shapes, isIcon, node: { node, trail }, icons: [] }
}

// One layer showing an image: its box, placed from the top left of the node
// read, and the fills under and over the image, bottom first, so the agent can
// write the layer's whole background.
function addImageUse(read, hash, kind, node, paint, trail, fills) {
  let image = read.images.get(hash)
  if (!image) {
    image = { hash, kind, layers: [] }
    read.images.set(hash, image)
  }
  const layer = {
    id: node.id, name: node.name, type: node.type,
    width: roundSize(readValue(node, 'width')), height: roundSize(readValue(node, 'height')),
    path: trail.join(' / '), scaleMode: paint.scaleMode || null,
  }
  const box = readValue(node, 'absoluteBoundingBox')
  if (box && read.origin) {
    layer.x = roundSize(box.x - read.origin.x)
    layer.y = roundSize(box.y - read.origin.y)
  }
  for (const field of ['imageTransform', 'scalingFactor', 'rotation', 'filters']) {
    if (paint[field] !== undefined) layer[field] = sanitizeForMessage(paint[field])
  }
  if (typeof paint.opacity === 'number' && paint.opacity !== 1) layer.opacity = paint.opacity
  const radius = readValue(node, 'cornerRadius')
  if (typeof radius === 'number' && radius) layer.cornerRadius = radius
  if (fills && fills.length > 1) {
    layer.fills = fills.map(fill => {
      const { boundVariables, ...rest } = restPaint(fill)
      return rest
    })
    layer.fillIndex = fills.indexOf(paint)
  }
  image.layers.push(layer)
}

// SVG ids carry the node id, as in clip0_12_34: two copies of one icon differ
// only there, so ids are numbered by order before markup is compared.
function svgShape(svg) {
  const ids = new Map()
  const numbered = id => {
    if (!ids.has(id)) ids.set(id, `i${ids.size}`)
    return ids.get(id)
  }
  return svg
    .replace(/\bid="([^"]+)"/g, (_, id) => `id="${numbered(id)}"`)
    .replace(/url\(#([^)]+)\)/g, (whole, id) => (ids.has(id) ? `url(#${ids.get(id)})` : whole))
    .replace(/href="#([^"]+)"/g, (whole, id) => (ids.has(id) ? `href="#${ids.get(id)}"` : whole))
}

// Figma's own SVG export. A Figma without the string form gives bytes, which
// go to the bridge as base64.
async function exportSvg(node, read) {
  const started = Date.now()
  try {
    try {
      return { svg: await node.exportAsync({ format: 'SVG_STRING' }) }
    } catch {
      return { svgBase64: figma.base64Encode(await node.exportAsync({ format: 'SVG' })) }
    }
  } finally {
    read.timing.exportMs += Date.now() - started
  }
}

async function componentName(node) {
  if (node.type !== 'INSTANCE') return null
  let main = null
  try {
    main = typeof node.getMainComponentAsync === 'function' ? await node.getMainComponentAsync() : node.mainComponent
  } catch {}
  if (!main) return null
  const set = main.parent && main.parent.type === 'COMPONENT_SET' ? main.parent : null
  return set ? `${set.name} / ${main.name}` : main.name
}

// Counts an asset toward maxBytes. One that does not fit is named instead, so
// it can be read on its own by its layer's id.
function fitsBudget(read, bytes) {
  if (read.bytes + bytes > read.limits.maxBytes) return false
  read.bytes += bytes
  return true
}

async function exportIcons(found, read) {
  const icons = []
  const byShape = new Map()
  for (const { node, trail } of found) {
    await read.pace()
    const layer = { id: node.id, name: node.name, path: trail.join(' / ') }
    let exported
    try {
      exported = await exportSvg(node, read)
    } catch (error) {
      icons.push({ ...layer, type: node.type, exportError: (error && error.message) || String(error), layers: [layer] })
      continue
    }
    const key = exported.svg !== undefined ? svgShape(exported.svg) : exported.svgBase64
    const same = byShape.get(key)
    if (same) {
      same.layers.push(layer)
      continue
    }
    const icon = {
      id: node.id, name: node.name, type: node.type,
      width: roundSize(readValue(node, 'width')), height: roundSize(readValue(node, 'height')),
      path: layer.path, layers: [layer],
    }
    const component = await componentName(node)
    if (component) icon.component = component
    const markup = exported.svg !== undefined ? exported.svg : exported.svgBase64
    if (fitsBudget(read, utf8Length(markup) + 512)) Object.assign(icon, exported)
    else {
      icon.truncated = true
      markBridgeTruncated(read.limits, node.id)
    }
    byShape.set(key, icon)
    icons.push(icon)
  }
  return icons
}

async function exportImages(read) {
  const images = []
  for (const image of read.images.values()) {
    await read.pace()
    if (image.kind !== 'IMAGE') {
      images.push(image)
      continue
    }
    const source = typeof figma.getImageByHash === 'function' ? figma.getImageByHash(image.hash) : null
    if (!source) {
      images.push({ ...image, exportError: 'Figma has no image with this hash' })
      continue
    }
    const started = Date.now()
    try {
      const size = typeof source.getSizeAsync === 'function' ? await source.getSizeAsync() : null
      if (size) Object.assign(image, { width: size.width, height: size.height })
      const bytes = await source.getBytesAsync()
      image.byteLength = bytes.length
      if (fitsBudget(read, Math.ceil(bytes.length / 3) * 4 + 512)) image.base64 = figma.base64Encode(bytes)
      else {
        image.truncated = true
        for (const layer of image.layers) markBridgeTruncated(read.limits, layer.id)
      }
    } catch (error) {
      image.exportError = (error && error.message) || String(error)
    } finally {
      read.timing.exportMs += Date.now() - started
    }
    images.push(image)
  }
  return images
}

async function readBridgeAssets(request) {
  const started = Date.now()
  const params = request.params || {}
  const limits = bridgeLimits({ ...(params.options || {}), includeHidden: false })
  const node = await figma.getNodeByIdAsync(params.nodeId)
  if (!node) return missingBridgeNode(params.nodeId)

  const read = {
    limits, pace: createPacer(), images: new Map(), bytes: 0,
    origin: readValue(node, 'absoluteBoundingBox'),
    timing: { countMs: 0, exportMs: 0, totalMs: 0 },
  }
  const walked = await walkAssets(node, [], read)
  read.timing.countMs = Date.now() - started
  // The node asked for is exported whole when it is an icon itself.
  const found = walked && walked.vector && walked.isIcon ? [walked.node] : (walked ? walked.icons : [])
  const payload = {
    type: 'ASSETS', name: node.name,
    width: roundSize(readValue(node, 'width')), height: roundSize(readValue(node, 'height')),
    icons: await exportIcons(found, read), images: await exportImages(read),
  }
  const byteSize = jsonBytes(payload)
  const page = findPageForNode(node)
  read.timing.totalMs = Date.now() - started
  const completeness = {
    nodeCount: limits.state.nodeCount, byteSize,
    limitHit: limits.state.limitHit, truncatedNodeIds: limits.state.truncatedNodeIds,
  }
  return {
    fileKey: state.bridgeFileKey, fileName: state.bridgeFileName, nodeId: node.id,
    pageId: page ? page.id : null, pageName: page ? page.name : null, found: true,
    truncated: completeness.limitHit, completeness, format: 'assets', timing: read.timing, payload,
  }
}

// The 'render' representation: the node as Figma draws it, to compare a
// built page against. 'render+s2+jpg' asks for twice the size, as JPG.
async function readBridgeRender(request) {
  const started = Date.now()
  const params = request.params || {}
  const limits = bridgeLimits(params.options || {})
  const parts = representationParts(request)
  const node = await figma.getNodeByIdAsync(params.nodeId)
  if (!node) return missingBridgeNode(params.nodeId)
  if (typeof node.exportAsync !== 'function') throw new Error(`Figma cannot render layer ${node.id} (${node.type})`)

  const scalePart = parts.find(part => /^s\d+(\.\d+)?$/.test(part))
  const asked = scalePart ? Number(scalePart.slice(1)) : 1
  let scale = Math.min(4, Math.max(0.25, Number.isFinite(asked) ? asked : 1))
  const format = parts.includes('svg') ? 'svg' : parts.includes('jpg') ? 'jpg' : 'png'
  const width = roundSize(readValue(node, 'width'))
  const height = roundSize(readValue(node, 'height'))
  const payload = { type: 'RENDER', name: node.name, format, width, height }
  if (format === 'svg') {
    const exported = await exportSvg(node, { timing: { exportMs: 0 } })
    const markup = exported.svg !== undefined ? exported.svg : exported.svgBase64
    if (utf8Length(markup) + 512 > limits.maxBytes) markBridgeTruncated(limits, node.id)
    else Object.assign(payload, exported)
  } else {
    let constraint = { type: 'SCALE', value: scale }
    const longest = Math.max(width || 0, height || 0)
    if (longest * scale > MAX_RENDER_SIDE) {
      scale = MAX_RENDER_SIDE / longest
      constraint = width >= height ? { type: 'WIDTH', value: MAX_RENDER_SIDE } : { type: 'HEIGHT', value: MAX_RENDER_SIDE }
    }
    const bytes = await node.exportAsync({ format: format === 'jpg' ? 'JPG' : 'PNG', constraint })
    payload.scale = Math.round(scale * 1000) / 1000
    payload.byteLength = bytes.length
    // Too large to send: the answer says so, and the caller asks again smaller.
    if (Math.ceil(bytes.length / 3) * 4 + 512 > limits.maxBytes) markBridgeTruncated(limits, node.id)
    else payload.base64 = figma.base64Encode(bytes)
  }
  const byteSize = jsonBytes(payload)
  const page = findPageForNode(node)
  const completeness = {
    nodeCount: 1, byteSize, limitHit: limits.state.limitHit, truncatedNodeIds: limits.state.truncatedNodeIds,
  }
  return {
    fileKey: state.bridgeFileKey, fileName: state.bridgeFileName, nodeId: node.id,
    pageId: page ? page.id : null, pageName: page ? page.name : null, found: true,
    truncated: completeness.limitHit, completeness, format: 'render',
    timing: { countMs: 0, exportMs: Date.now() - started, totalMs: Date.now() - started }, payload,
  }
}

function readBridgeNodeAs(request) {
  const base = representationBase(request)
  if (base === 'assets') return readBridgeAssets(request)
  if (base === 'render') return readBridgeRender(request)
  return wantsRestFormat(request) ? readBridgeNodeRest(request) : readBridgeNode(request)
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
  const previous = repeatableBridgeRead
  repeatableBridgeRead = null
  if (!request || !request.requestId) return
  // The bridge gave up on a read that waited here past its deadline, and the
  // caller already has its timeout: nobody is left to read it for.
  if (Number.isFinite(request.expiresAt) && Date.now() > request.expiresAt) return
  if (!state.bridgeFileKey || request.params?.fileKey !== state.bridgeFileKey) {
    figma.ui.postMessage({ type: 'bridge-result', sessionId, requestId: request.requestId, ok: false, error: 'Request file does not match the connected Figma file.' })
    return
  }
  const key = bridgeReadKey(request)
  // The read just before this one asked for the same, and nothing was edited
  // since it began: its answer is this one's too.
  if (previous && previous.key === key && previous.editSeq === state.editSeq) {
    keepForNextRead(previous)
    replyBridgeRead(sessionId, request, previous.result)
    return
  }
  state.bridgeReading = true
  // Taken before the read starts: an edit made while it runs leaves the result
  // behind the count, so the bridge never reuses it.
  const editSeq = state.editSeq
  try {
    let result
    if (request.op === 'read-node') result = await readBridgeNodeAs(request)
    else if (request.op === 'read-document-index') result = readBridgeDocumentIndex(request)
    else throw new Error(`Unsupported bridge operation: ${request.op}`)
    result.editSeq = editSeq
    keepForNextRead({ key, editSeq, result })
    replyBridgeRead(sessionId, request, result)
  } catch (error) {
    figma.ui.postMessage({ type: 'bridge-result', sessionId, requestId: request.requestId, ok: false, error: error.message || String(error) })
  } finally {
    state.bridgeReading = false
    if (state.editedDuringRead) {
      state.editedDuringRead = false
      reportBridgeEdit()
    }
  }
}

function replyBridgeRead(sessionId, request, result) {
  state.lastBridgeNode = result.nodeId || 'Document index'
  state.lastBridgeRequest = new Date()
  updateUIStatus()
  figma.ui.postMessage({ type: 'bridge-result', sessionId, requestId: request.requestId, ok: true, result })
}

// One read at a time: a paced walk lets other work run between its slices, and
// two walks at once would hold two trees in the plugin's memory.
let bridgeQueue = Promise.resolve()
// Reads waiting their turn, oldest first.
const waitingBridgeReads = []
// A caller that timed out and retried queues the same read again behind the
// one still running for it. That read's answer is kept for the retry, but only
// while the retry is next in line, so it never sits in memory during another read.
let repeatableBridgeRead = null

function bridgeReadKey(request) {
  const params = (request && request.params) || {}
  return JSON.stringify([request && request.op, params.fileKey, params.nodeId, params.representation, params.options])
}

function keepForNextRead(read) {
  const next = waitingBridgeReads[0]
  if (next && bridgeReadKey(next) === read.key) repeatableBridgeRead = read
}

function queueBridgeRequest(sessionId, request) {
  if (request && request.op === 'edit-seq') {
    answerEditSeq(sessionId, request)
    return Promise.resolve()
  }
  waitingBridgeReads.push(request)
  const run = bridgeQueue.then(() => {
    waitingBridgeReads.shift()
    return handleBridgeRequest(sessionId, request)
  })
  bridgeQueue = run.catch(() => {})
  return run
}

// How many edits Figma reported since the plugin started. Before reusing a
// read it already has, the bridge asks for this, and reuses it only if the
// count still matches the one the read began at. Answered at once, outside
// the queue, even while a read is paused.
function answerEditSeq(sessionId, request) {
  if (!request.requestId) return
  if (!state.bridgeFileKey || request.params?.fileKey !== state.bridgeFileKey) {
    figma.ui.postMessage({ type: 'bridge-result', sessionId, requestId: request.requestId, ok: false, error: 'Request file does not match the connected Figma file.' })
    return
  }
  figma.ui.postMessage({
    type: 'bridge-result', sessionId, requestId: request.requestId, ok: true,
    result: { fileKey: state.bridgeFileKey, editSeq: state.editSeq },
  })
}

// An edit invalidates what the bridge cached for this file. One made while a
// read is paused goes out after that read's reply, as it did when a read could
// not be interrupted, so the bridge drops the reply it just cached.
function reportBridgeEdit() {
  if (!state.bridgeConnected || !state.bridgeFileKey) return
  if (state.bridgeReading) {
    state.editedDuringRead = true
    return
  }
  figma.ui.postMessage({ type: 'bridge-invalidate', fileKey: state.bridgeFileKey, reason: 'documentchange' })
}

// clientStorage is per Figma user, not per document, so a file link is kept per
// document name: another document never inherits it. Links saved by 1.1 under
// a single `fileSource` key are ignored for that reason.
async function loadBridgePreferences() {
  const defaults = { bridgeUrl: SERVER_URL, bridgeToken: '', fileSources: {} }
  if (!figma.clientStorage || typeof figma.clientStorage.getAsync !== 'function') return defaults
  try {
    const saved = await figma.clientStorage.getAsync('design-bridge-pairing')
    const { fileSource, ...rest } = saved && typeof saved === 'object' ? saved : {}
    const merged = { ...defaults, ...rest }
    if (!merged.fileSources || typeof merged.fileSources !== 'object') merged.fileSources = {}
    return merged
  } catch {
    return defaults
  }
}

async function saveBridgePreferences(preferences) {
  if (!figma.clientStorage || typeof figma.clientStorage.setAsync !== 'function') return
  try { await figma.clientStorage.setAsync('design-bridge-pairing', preferences) } catch {}
}

function documentName() {
  return (figma.root && figma.root.name) || (figma.currentPage && figma.currentPage.name) || 'Figma file'
}

// With enablePrivatePluginApi in the manifest, Figma tells a development plugin
// which file it runs in, and nobody has to paste a link.
function knownFileKey() {
  return typeof figma.fileKey === 'string' && figma.fileKey ? figma.fileKey : null
}

function savedFileSource(prefs) {
  if (knownFileKey()) return ''
  const source = prefs.fileSources[documentName()]
  return typeof source === 'string' ? source : ''
}

async function startBridgeSession(serverUrl, token, fileKey, fileSource) {
  state.bridgeFileKey = fileKey
  state.bridgeFileName = documentName()
  state.bridgeToken = token
  const prefs = await loadBridgePreferences()
  const fileSources = { ...prefs.fileSources }
  if (!knownFileKey() && fileSource) fileSources[documentName()] = String(fileSource).trim()
  await saveBridgePreferences({ bridgeUrl: serverUrl, bridgeToken: token, fileSources })
  figma.ui.postMessage({
    type: 'bridge-start',
    config: { url: serverUrl, token, fileKey, fileName: state.bridgeFileName, pluginInstanceId: state.pluginInstanceId },
  })
}

// 'open' is the panel; 'bridge' is what it was called before 1.2.0, and a menu
// imported back then still sends it.
function isOpenCommand() {
  return figma.command === 'open' || figma.command === 'bridge'
}

const state = {
  autoSync: true, lastNodeCount: 0, lastSyncTime: null, lastPageName: null,
  connected: false, ready: false, inFlight: null, pendingSync: null, pendingScope: null, nextRequestId: 0,
  bridgeFileKey: null, bridgeFileName: null, bridgeConnected: false, bridgeToken: '',
  lastBridgeNode: null, lastBridgeRequest: null, bridgeReading: false, editedDuringRead: false, editSeq: 0,
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

function triggerSync(reason = 'manual', scope = 'page') {
  if (!state.ready || (reason === 'auto' && !state.autoSync)) return
  if (state.inFlight) {
    // Coalesce changes while sending. Build the next snapshot only when this one finishes.
    if (state.pendingSync !== 'manual') {
      state.pendingSync = reason
      state.pendingScope = scope
    }
    return
  }
  cancelDebounce()
  state.pendingSync = null
  state.pendingScope = null
  try {
    // Mixed Figma properties are Symbols, which cannot cross the UI message boundary.
    const selectionOnly = scope === 'selection' || figma.command === 'sync-selection'
    const data = sanitizeForMessage(buildDesignData(selectionOnly))
    const requestId = ++state.nextRequestId
    state.inFlight = { requestId, data }
    figma.ui.postMessage({ type: 'sync', requestId, data })
  } catch (error) {
    state.inFlight = null
    figma.notify(`Sync failed: ${error.message}`, { error: true })
    if (figma.command === 'watch' || isOpenCommand()) {
      updateUIStatus()
      figma.ui.postMessage({ type: 'error', error: error.message })
    } else {
      figma.closePlugin()
    }
  }
}

function updateUIStatus(extra = {}) {
  if (isOpenCommand()) {
    figma.ui.postMessage({
      type: 'status', mode: 'open', connected: state.bridgeConnected,
      fileName: documentName(), fileKeyKnown: Boolean(knownFileKey()),
      lastNode: state.lastBridgeNode || '\u2014', lastRequest: state.lastBridgeRequest?.toISOString(),
      lastSyncPage: state.lastPageName || '', lastSync: state.lastSyncTime?.toISOString(),
      nodeCount: state.lastNodeCount, autoSync: state.autoSync, bridgeToken: state.bridgeToken,
      ...extra,
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
  const isOpen = isOpenCommand()
  const isWatch = figma.command === 'watch'
  const isSync = figma.command === 'sync-page' || figma.command === 'sync-selection'
  const isPanel = isOpen || isWatch

  if (!isPanel && !isSync) {
    figma.closePlugin()
    return
  }

  // The panel serves agents first; sending the whole page on every edit is opt-in.
  if (isOpen) state.autoSync = false

  figma.showUI(UI_HTML, { visible: isPanel, width: 320, height: isOpen ? 560 : 440 })

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

  if (isOpen) {
    // One handler per event: an edit invalidates what the bridge cached for this
    // file, and re-syncs the page as well when auto-sync is on.
    figma.on('documentchange', () => {
      state.editSeq++
      reportBridgeEdit()
      debouncedSync()
    })
    figma.on('currentpagechange', debouncedSync)
    figma.on('close', () => {
      cancelDebounce()
      state.ready = false
      state.pendingSync = null
      state.bridgeConnected = false
      figma.ui.postMessage({ type: 'bridge-stop', reason: 'plugin-close' })
    })
  }

  figma.ui.onmessage = async msg => {
    switch (msg.type) {
      case 'ui-ready': {
        if (state.ready) break
        state.ready = true
        const prefs = await loadBridgePreferences()
        state.bridgeToken = prefs.bridgeToken || ''
        if (isOpen) {
          const fileSource = savedFileSource(prefs)
          updateUIStatus({ bridgeUrl: prefs.bridgeUrl, fileSource })
          // Paired before and the file is known: connect without a click.
          const fileKey = knownFileKey() || parseFileKey(fileSource)
          if (state.bridgeToken && fileKey) {
            try {
              await startBridgeSession(normalizeBridgeUrl(prefs.bridgeUrl), state.bridgeToken, fileKey, fileSource)
            } catch (error) {
              figma.ui.postMessage({ type: 'error', error: error.message || String(error) })
            }
          }
        } else {
          // The legacy sync needs the pairing token in the field before it
          // fires, so the stored value goes out first and the sync follows.
          updateUIStatus()
          triggerSync()
        }
        break
      }

      case 'done': {
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

        if (isPanel) {
          updateUIStatus()
          if (!msg.success) {
            figma.notify(`Sync failed: ${msg.error}`, { error: true })
          } else if (isOpen) {
            figma.notify(`Synced ${completed.nodeCount} nodes to the bridge`)
          }
          if (state.pendingSync) triggerSync(state.pendingSync, state.pendingScope || 'page')
        } else {
          if (msg.success) {
            figma.notify(`Synced ${completed.nodeCount} nodes to server`)
          } else {
            figma.notify(`Sync failed: ${msg.error}`, { error: true })
          }
          figma.closePlugin()
        }
        break
      }

      case 'request-sync':
        if (isPanel) triggerSync('manual', msg.scope === 'selection' ? 'selection' : 'page')
        break

      case 'set-token': {
        const token = String(msg.token || '').trim()
        state.bridgeToken = token
        const prefs = await loadBridgePreferences()
        await saveBridgePreferences({ ...prefs, bridgeToken: token })
        break
      }

      case 'paired': {
        // The UI collected the token through pairing: keep it, then use it.
        const token = String(msg.token || '').trim()
        if (!token) break
        state.bridgeToken = token
        const prefs = await loadBridgePreferences()
        let serverUrl = SERVER_URL
        try { serverUrl = normalizeBridgeUrl(msg.serverUrl || prefs.bridgeUrl) } catch {}
        await saveBridgePreferences({ ...prefs, bridgeUrl: serverUrl, bridgeToken: token })
        figma.notify('Paired with the bridge')
        updateUIStatus()
        if (isOpen) {
          const fileSource = String(msg.fileSource || '').trim() || savedFileSource(prefs)
          const fileKey = knownFileKey() || parseFileKey(fileSource)
          if (fileKey) {
            await startBridgeSession(serverUrl, token, fileKey, fileSource)
          } else {
            figma.ui.postMessage({ type: 'error', error: "Paired. Paste this file's link under Advanced, then press Connect." })
          }
        } else if (isWatch) {
          triggerSync()
        }
        break
      }

      case 'set-auto-sync':
        if (isPanel) {
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
        if (!isOpen) break
        try {
          const entered = parseFileKey(msg.fileSource)
          const fileKey = knownFileKey() || entered
          if (!fileKey) throw new Error("Paste this file's link under Advanced before connecting.")
          if (knownFileKey() && entered && entered !== knownFileKey()) {
            throw new Error('The entered file does not match the Figma file currently open in this plugin.')
          }
          const serverUrl = normalizeBridgeUrl(msg.serverUrl)
          const token = String(msg.token || '').trim()
          if (!token) throw new Error('Pair with the bridge first, or paste the bridge token under Advanced.')
          await startBridgeSession(serverUrl, token, fileKey, msg.fileSource)
        } catch (error) {
          state.bridgeConnected = false
          figma.ui.postMessage({ type: 'error', error: error.message || String(error) })
          updateUIStatus()
        }
        break

      case 'bridge-status':
        if (!isOpen) break
        state.bridgeConnected = Boolean(msg.connected)
        updateUIStatus()
        if (msg.error) figma.ui.postMessage({ type: 'error', error: msg.error })
        break

      case 'bridge-request':
        if (isOpen) await queueBridgeRequest(msg.sessionId, msg.request)
        break

      case 'bridge-stopped':
        if (isOpen) {
          state.bridgeConnected = false
          updateUIStatus()
        }
        break
    }
  }
}

main()
