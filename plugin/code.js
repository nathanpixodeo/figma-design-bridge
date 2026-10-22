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
    data=await bridgeFetch('/bridge/session',{method:'POST',body:{fileKey:bridgeConfig.fileKey,fileName:bridgeConfig.fileName,pluginInstanceId:bridgeConfig.pluginInstanceId,capabilities:['read-node','read-document-index']}},false)
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
      return { id: node.id, name: node.name, type: node.type, truncated: true }
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
      if (bridgeBudgetSpent(limits)) {
        markBridgeTruncated(limits, node.id)
        obj.truncated = true
        break
      }
      // Figma may apply an edit while the walk is paused; a layer deleted by
      // then is skipped rather than failing the whole read.
      if (child.removed) continue
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
// about 90 seconds to walk, and the bridge waits two minutes at most.
function bridgeLimits(options = {}) {
  const integer = (value, fallback, min, max) => Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback
  return {
    maxDepth: integer(options.depth, 12, 0, 30),
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

// Removes the last node in document order, repeatedly, until the payload fits.
// The serializer's running estimate leaves out the nesting overhead, so a cut
// subtree can still come out over budget; trimming from the end keeps every
// node that fits instead of dropping the whole subtree. Returns the final size.
function pruneTrailingNodes(root, limits, size = jsonBytes(root)) {
  while (size > limits.maxBytes) {
    let parent = null
    let node = root
    while (Array.isArray(node.children) && node.children.length) {
      parent = node
      node = node.children[node.children.length - 1]
    }
    if (!parent) break

    parent.children.pop()
    if (parent.children.length) {
      size -= jsonBytes(node) + 1 // the node and the comma before it
    } else {
      delete parent.children
      size -= jsonBytes(node) + 14 // `,"children":[` + node + `]`
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
  state.bridgeReading = true
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
  } finally {
    state.bridgeReading = false
    if (state.editedDuringRead) {
      state.editedDuringRead = false
      reportBridgeEdit()
    }
  }
}

// One read at a time: a paced walk lets other work run between its slices, and
// two walks at once would hold two trees in the plugin's memory.
let bridgeQueue = Promise.resolve()

function queueBridgeRequest(sessionId, request) {
  const run = bridgeQueue.then(() => handleBridgeRequest(sessionId, request))
  bridgeQueue = run.catch(() => {})
  return run
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
  lastBridgeNode: null, lastBridgeRequest: null, bridgeReading: false, editedDuringRead: false,
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
