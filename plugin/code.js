const SERVER_URL = 'http://localhost:3456'

// The panel. figma.showUI is called with themeColors, so every color comes
// from Figma's theme variables and follows the user's light or dark theme.
const UI_HTML = `<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:var(--figma-color-bg,#fff)}
body{
  font:11px/16px Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  color:var(--figma-color-text,#1e1e1e);-webkit-font-smoothing:antialiased
}
#app{display:flex;flex-direction:column;gap:12px;padding:12px 16px 16px}
.header{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:24px}
.title{font-size:12px;font-weight:600}
.status{
  display:inline-flex;align-items:center;gap:6px;height:20px;padding:0 8px;border-radius:10px;
  background:var(--figma-color-bg-secondary,#f5f5f5);color:var(--figma-color-text-secondary,#757575);
  font-weight:500;white-space:nowrap
}
.status::before{content:'';width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0}
.status.success{color:var(--figma-color-text-success,#14ae5c)}
.status.warning{color:var(--figma-color-text-warning,#b86200)}
.status.danger{color:var(--figma-color-text-danger,#dc3412)}
.message{color:var(--figma-color-text-secondary,#757575)}
.message.error{color:var(--figma-color-text-danger,#dc3412)}
.label{color:var(--figma-color-text-secondary,#757575)}
.rows{
  display:grid;grid-template-columns:auto 1fr;gap:4px 12px;padding:8px 0;
  border-top:1px solid var(--figma-color-border,#e6e6e6);border-bottom:1px solid var(--figma-color-border,#e6e6e6)
}
.rows dt{color:var(--figma-color-text-secondary,#757575)}
.rows dd{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.stack{display:flex;flex-direction:column;gap:8px}
.buttons{display:flex;gap:8px}
.buttons>button{flex:1}
button{
  height:28px;padding:0 12px;border-radius:5px;border:1px solid transparent;
  font:inherit;font-weight:500;cursor:pointer;white-space:nowrap
}
button.primary{background:var(--figma-color-bg-brand,#0d99ff);color:var(--figma-color-text-onbrand,#fff)}
button.primary:hover:not(:disabled){background:var(--figma-color-bg-brand-hover,#007be5)}
button.secondary{background:transparent;color:var(--figma-color-text,#1e1e1e);border-color:var(--figma-color-border,#e6e6e6)}
button.secondary:hover:not(:disabled){background:var(--figma-color-bg-hover,#f5f5f5)}
button:disabled{opacity:.4;cursor:default}
button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--figma-color-border-selected,#0d99ff);outline-offset:1px}
.pair{display:flex;flex-direction:column;gap:6px;padding:12px;border-radius:6px;background:var(--figma-color-bg-secondary,#f5f5f5)}
.pair-code{font:600 24px/32px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:4px;text-align:center}
.pair-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:2px}
code{
  display:block;padding:4px 8px;border-radius:4px;font:11px/16px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  background:var(--figma-color-bg,#fff);border:1px solid var(--figma-color-border,#e6e6e6);user-select:all;word-break:break-all
}
.field{display:flex;flex-direction:column;gap:4px}
input{
  height:28px;padding:0 8px;border-radius:5px;border:1px solid var(--figma-color-border,#e6e6e6);
  background:var(--figma-color-bg,#fff);color:var(--figma-color-text,#1e1e1e);font:inherit;outline:none
}
input:focus{border-color:var(--figma-color-border-selected,#0d99ff)}
input::placeholder{color:var(--figma-color-text-tertiary,#b3b3b3)}
summary{cursor:pointer;color:var(--figma-color-text-secondary,#757575);user-select:none;list-style:none}
summary::-webkit-details-marker{display:none}
summary::before{content:'\\25B8';display:inline-block;width:12px}
details[open] summary::before{content:'\\25BE'}
details[open] summary{margin-bottom:8px}
.view{display:flex;flex-direction:column;gap:12px}
.head-side{display:flex;align-items:center;gap:4px;min-width:0}
.head-side .title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.menu-wrap{position:relative}
button.icon{
  display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;flex-shrink:0;
  background:transparent;color:var(--figma-color-icon,#1e1e1e)
}
button.icon:hover{background:var(--figma-color-bg-hover,#f5f5f5)}
button.icon[aria-expanded="true"]{background:var(--figma-color-bg-selected,#e5f4ff)}
.menu{
  position:absolute;right:0;top:28px;z-index:10;width:224px;padding:4px;border-radius:6px;
  background:var(--figma-color-bg,#fff);border:1px solid var(--figma-color-border,#e6e6e6);box-shadow:0 4px 16px rgba(0,0,0,.16)
}
.menu-item{
  display:flex;flex-direction:column;align-items:flex-start;gap:2px;width:100%;height:auto;padding:6px 8px;
  background:transparent;color:inherit;text-align:left;white-space:normal;font-weight:400
}
.menu-item:hover,.menu-item:focus-visible{background:var(--figma-color-bg-hover,#f5f5f5)}
.menu-item strong{font-weight:500}
.menu-item span{color:var(--figma-color-text-secondary,#757575)}
select{
  height:28px;min-width:0;padding:0 4px;border-radius:5px;border:1px solid var(--figma-color-border,#e6e6e6);
  background:var(--figma-color-bg,#fff);color:var(--figma-color-text,#1e1e1e);font:inherit;outline:none
}
select:focus{border-color:var(--figma-color-border-selected,#0d99ff)}
.filters{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.find-foot{display:flex;align-items:center;justify-content:space-between;gap:8px}
.find-foot select{flex-shrink:0;margin-left:auto}
.results{
  list-style:none;max-height:240px;overflow-y:auto;margin:0 -16px;
  border-top:1px solid var(--figma-color-border,#e6e6e6)
}
.result{display:flex;align-items:center;gap:8px;padding:0 16px 0 0}
.result:hover{background:var(--figma-color-bg-hover,#f5f5f5)}
.result-open{
  display:flex;flex-direction:column;align-items:stretch;gap:2px;flex:1;min-width:0;height:auto;padding:6px 0 6px 16px;
  border:0;border-radius:0;background:transparent;color:inherit;text-align:left;font-weight:400
}
.result-name{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.result-name .name{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.result-name .type{flex-shrink:0;color:var(--figma-color-text-tertiary,#b3b3b3);font-size:10px}
.result-meta{color:var(--figma-color-text-secondary,#757575);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button.copy{height:22px;padding:0 8px;flex-shrink:0}
.clipboard{position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0}
.hidden{display:none!important}
</style>
<div id="app">
  <div class="header">
    <div class="head-side">
      <button class="icon hidden" id="backBtn" aria-label="Back to Design Bridge" title="Back">
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <span class="title" id="title">Design Bridge</span>
    </div>
    <div class="head-side">
      <span id="status" class="status" role="status"><span id="statusText">Starting…</span></span>
      <div class="menu-wrap">
        <button class="icon" id="toolsBtn" aria-label="Tools" title="Tools" aria-haspopup="menu" aria-expanded="false">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
        </button>
        <div id="toolsMenu" class="menu hidden" role="menu" aria-label="Tools"></div>
      </div>
    </div>
  </div>
  <div id="bridgeView" class="view">
  <p id="message" class="message hidden"></p>
  <div id="pairSection" class="stack hidden">
    <button class="primary" id="pairBtn">Pair with bridge</button>
  </div>
  <div id="pairInfo" class="pair hidden">
    <div class="pair-code" id="pairCode">—</div>
    <span class="label">Approve it in Claude Code:</span>
    <code id="pairCommand">/figma-bridge:pair</code>
    <span class="label">or in a terminal:</span>
    <code id="pairCli">figma-bridge pair</code>
    <div class="pair-foot"><span class="label" id="pairExpiry"></span><button class="secondary" id="cancelPairBtn">Cancel</button></div>
  </div>
  <div id="fileSection" class="field hidden">
    <label class="label" for="fileSource">File link (Share → Copy link)</label>
    <input id="fileSource" autocomplete="off" spellcheck="false" placeholder="https://www.figma.com/design/…">
  </div>
  <dl id="infoSection" class="rows hidden">
    <dt>File</dt><dd id="fileName">—</dd>
    <dt>Last read</dt><dd id="lastRead">—</dd>
  </dl>
  <div id="actions" class="buttons hidden">
    <button class="primary hidden" id="connectBtn">Connect</button>
    <button class="secondary hidden" id="retryBtn">Retry now</button>
    <button class="secondary hidden" id="disconnectBtn">Disconnect</button>
  </div>
  <details id="advanced">
    <summary>Advanced</summary>
    <div class="field">
      <label class="label" for="bridgeToken">Bridge token</label>
      <input id="bridgeToken" type="password" autocomplete="off" spellcheck="false" placeholder="Paste the output of figma-bridge token">
    </div>
  </details>
  </div>
  <section id="tool-find" class="view hidden" aria-label="Find node">
    <input id="findQuery" type="search" autocomplete="off" spellcheck="false" placeholder="Name, text or node id" aria-label="Find layers">
    <div class="filters">
      <select id="findMatch" aria-label="Match">
        <option value="any">Name or text</option>
        <option value="name">Layer name</option>
        <option value="text">Text content</option>
        <option value="component">Component</option>
      </select>
      <select id="findType" aria-label="Layer type">
        <option value="">Any type</option>
        <option value="FRAME">Frame</option>
        <option value="SECTION">Section</option>
        <option value="GROUP">Group</option>
        <option value="COMPONENT">Component</option>
        <option value="COMPONENT_SET">Component set</option>
        <option value="INSTANCE">Instance</option>
        <option value="TEXT">Text</option>
        <option value="RECTANGLE">Rectangle</option>
        <option value="VECTOR">Vector</option>
      </select>
    </div>
    <div class="find-foot">
      <span id="findStatus" class="message hidden" role="status"></span>
      <select id="findScope" aria-label="Search in">
        <option value="all">All pages</option>
        <option value="page">This page</option>
      </select>
    </div>
    <ul id="findResults" class="results hidden"></ul>
  </section>
  <textarea id="clipboard" class="clipboard" aria-hidden="true" tabindex="-1"></textarea>
</div>
<script>
const SERVER_URL = '${SERVER_URL}'
function q(s){return document.getElementById(s)}
function toggle(id,visible){const el=q(id);if(visible)el.classList.remove('hidden');else el.classList.add('hidden')}
// What the plugin reported. booted: it reported at least once, so the panel
// stops saying Starting.
let booted=false,token='',fileKeyKnown=true,fileName='',lastNode='',lastRequest=null,connectedNow=false
// idle: the user disconnected, or a connect attempt failed before it started,
// so the panel offers Connect instead of saying it is connecting.
let idle=false,errorText='',lastHeight=0
let bridgeWanted=false,bridgeConfig=null,sessionId=null,sessionSecret=null,pollController=null,heartbeatTimer=null,reconnectTimer=null,reconnectDelay=750
let pairing=null,pairTimer=null
// waitingForBridge: nothing answers at the bridge URL yet, which is normal until
// Claude Code or figma-bridge start runs. tokenRejected: the bridge refused the saved
// token, so only pairing or a new token can help.
let waitingForBridge=false,tokenRejected=false
// invalidating: an invalidate request is in flight. invalidateNext: the latest
// edit made since, sent when invalidateTimer fires.
let invalidating=false,invalidateNext=null,invalidateTimer=null
// Tools open from the header, so the panel shows the bridge until one is
// picked. A tool is an entry here and a section with id tool-<id>; open and
// close run when the tool shows and when the panel goes back to the bridge.
const TOOLS=[
  {id:'find',title:'Find node',description:'Find layers by name, text, type, component or node id.',open:openFind,close:closeFind},
]
let activeTool=null,menuOpen=false
// findSeq numbers each search, so a result from an older one is dropped.
// findStale: a search was stopped by leaving the tool, and runs again on return.
let findSeq=0,findTimer=null,findResults=[],findText='',findError=false,findBusy=false,findStale=false
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c])}
function toolById(id){return TOOLS.find(tool=>tool.id===id)||null}
function timeOf(iso){try{return iso?new Date(iso).toLocaleTimeString():''}catch{return ''}}
function fileSource(){return (q('fileSource').value||'').trim()}
function needsFile(){return !fileKeyKnown&&!fileSource()}
function waitingHint(){return 'No bridge at '+SERVER_URL+' yet. Start Claude Code with the figma-bridge plugin, or run figma-bridge start.'}
function view(){
  if(!booted) return 'starting'
  if(pairing) return 'pairing'
  if(connectedNow) return 'connected'
  if(tokenRejected) return 'rejected'
  if(!token) return 'unpaired'
  if(bridgeWanted) return waitingForBridge?'waiting':'connecting'
  if(needsFile()) return 'needs-file'
  return idle?'disconnected':'connecting'
}
const STATUS={
  starting:['','Starting…'],unpaired:['','Not paired'],pairing:['warning','Pairing…'],
  rejected:['danger','Token rejected'],'needs-file':['warning','File link needed'],
  connecting:['warning','Connecting…'],waiting:['warning','Waiting for bridge'],
  connected:['success','Connected'],disconnected:['','Disconnected'],
}
const HINT={
  unpaired:'Pair once. Agents can then read this file while the panel is open.',
  'needs-file':"Figma did not tell the plugin which file this is. Paste the file's link.",
  connected:'Keep this panel open while agents read this file.',
  disconnected:'Agents cannot read this file until you connect.',
}
function render(){
  const v=view(),[tone,label]=STATUS[v]
  const tool=toolById(activeTool)
  toggle('bridgeView',!tool)
  TOOLS.forEach(t=>toggle('tool-'+t.id,t===tool))
  toggle('backBtn',Boolean(tool))
  q('title').textContent=tool?tool.title:'Design Bridge'
  toggle('toolsMenu',menuOpen)
  q('toolsBtn').setAttribute('aria-expanded',String(menuOpen))
  q('status').className='status'+(tone?' '+tone:'')
  q('statusText').textContent=label
  const text=errorText||(v==='waiting'?waitingHint():HINT[v]||'')
  const message=q('message')
  message.textContent=text
  if(errorText||v==='rejected') message.classList.add('error'); else message.classList.remove('error')
  toggle('message',Boolean(text))
  toggle('pairSection',v==='unpaired'||v==='rejected')
  toggle('pairInfo',v==='pairing')
  const linked=v==='needs-file'||v==='disconnected'||v==='connecting'||v==='waiting'
  toggle('fileSection',!fileKeyKnown&&linked)
  toggle('infoSection',v==='connected'||v==='connecting'||v==='waiting'||v==='disconnected')
  q('fileName').textContent=fileName||'—'
  q('lastRead').textContent=lastNode?lastNode+(lastRequest?' · '+timeOf(lastRequest):''):'—'
  const stoppable=v==='connected'||v==='waiting'||(v==='connecting'&&bridgeWanted)
  toggle('connectBtn',v==='disconnected')
  toggle('retryBtn',v==='waiting')
  toggle('disconnectBtn',stoppable)
  toggle('actions',v==='disconnected'||stoppable)
  q('pairBtn').disabled=Boolean(pairing)
  fit()
}
// The plugin window follows the panel's height, so it never scrolls or leaves a
// gap. An open Tools menu floats over the panel, so the window also fits it.
function fit(){
  let height=q('app').offsetHeight
  if(typeof height!=='number'||!height) return
  const menu=q('toolsMenu')
  if(menuOpen&&typeof menu.getBoundingClientRect==='function') height=Math.max(height,Math.ceil(menu.getBoundingClientRect().bottom)+8)
  if(height===lastHeight) return
  lastHeight=height
  parent.postMessage({pluginMessage:{type:'resize',height}},'*')
}
function showError(m){errorText=String(m||'');render()}
function hideError(){errorText='';render()}
function updateInfo(d){
  booted=true
  if(d.fileKeyKnown!==undefined) fileKeyKnown=Boolean(d.fileKeyKnown)
  // Only a token that changed reaches the field, so a status that arrives
  // while the user types a new one does not overwrite it.
  if(typeof d.bridgeToken==='string'&&d.bridgeToken.trim()!==token){token=d.bridgeToken.trim();q('bridgeToken').value=token}
  if(typeof d.fileSource==='string'&&d.fileSource&&!fileSource()) q('fileSource').value=d.fileSource
  if(typeof d.fileName==='string') fileName=d.fileName
  if(d.lastNode!==undefined) lastNode=d.lastNode||''
  if(d.lastRequest!==undefined) lastRequest=d.lastRequest||null
  connectedNow=Boolean(d.connected)
  render()
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
  errorText=error||''
  render()
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
    bridgeStatus(false,'The bridge did not accept the saved token. Pair again, or paste a new token under Advanced.')
    return
  }
  // A failed fetch means nothing listens yet: wait quietly and keep trying.
  waitingForBridge=Boolean(err&&err.name==='TypeError')
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
  render()
  let data
  try{
    data=await bridgeFetch('/bridge/session',{method:'POST',body:{fileKey:bridgeConfig.fileKey,fileName:bridgeConfig.fileName,pluginInstanceId:bridgeConfig.pluginInstanceId,capabilities:['read-node','read-document-index','figma-rest','edit-seq','assets','render','search']}},false)
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
  booted=true;idle=false
  if(config&&config.token) token=config.token
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
  render()
}
async function startPairing(){
  errorText=''
  cancelPairing()
  let r=null,body=null
  try{
    r=await fetch(SERVER_URL+'/bridge/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clientName:'Figma Design Bridge plugin',fileName:fileName.slice(0,200)})})
    try{body=await r.json()}catch{}
  }catch(err){
    showError('No bridge at '+SERVER_URL+'. Start Claude Code with the figma-bridge plugin, or run figma-bridge start, then pair again.')
    return
  }
  // Asking to pair needs no token since 1.2.0. A bridge that wants one for it,
  // or does not know the route, is older and cannot pair at all.
  if(r.status===401||r.status===404){showError('This bridge is too old to pair: pairing needs 1.2.0 or later. Update the figma-bridge plugin, restart the bridge, then pair again.');return}
  if(!r.ok||!body||!body.code){showError((body&&body.error)||('Bridge HTTP '+r.status));return}
  pairing={id:body.pairingId,secret:body.pairingSecret,code:body.code,expiresAt:Date.parse(body.expiresAt)||Date.now()+120000}
  q('pairCode').textContent=pairing.code.slice(0,3)+' '+pairing.code.slice(3)
  q('pairCommand').textContent='/figma-bridge:pair '+pairing.code
  q('pairCli').textContent='figma-bridge pair '+pairing.code
  showExpiry()
  render()
  pairTimer=setTimeout(pollPairing,1500)
}
async function pollPairing(){
  pairTimer=null
  const current=pairing
  if(!current) return
  let r=null,body=null
  try{
    r=await fetch(SERVER_URL+'/bridge/pair/'+current.id,{headers:{'X-Pairing-Secret':current.secret}})
    try{body=await r.json()}catch{}
  }catch{}
  if(pairing!==current) return
  if(r&&r.ok&&body&&body.status==='approved'&&body.token){
    token=body.token;q('bridgeToken').value=body.token
    tokenRejected=false;idle=false;errorText=''
    cancelPairing()
    parent.postMessage({pluginMessage:{type:'paired',token:body.token,fileSource:fileSource()}},'*')
    return
  }
  if(r&&(r.status===404||r.status===410)){
    cancelPairing()
    showError('The pairing code expired. Pair again for a new one.')
    return
  }
  showExpiry()
  pairTimer=setTimeout(pollPairing,1500)
}
function connect(){
  idle=false;errorText=''
  parent.postMessage({pluginMessage:{type:'connect-bridge',token,fileSource:fileSource()}},'*')
  render()
}
function setMenu(open){menuOpen=Boolean(open);render()}
function renderMenu(){
  q('toolsMenu').innerHTML=TOOLS.map(tool=>'<button class="menu-item" role="menuitem" data-tool="'+esc(tool.id)+'">'
    +'<strong>'+esc(tool.title)+'</strong><span>'+esc(tool.description)+'</span></button>').join('')
}
// The bridge session keeps running while a tool is open.
function openTool(id){
  const tool=toolById(id)
  if(!tool) return
  menuOpen=false
  if(activeTool&&activeTool!==id) closeTool()
  activeTool=id
  render()
  if(tool.open) tool.open()
}
function closeTool(){
  const tool=toolById(activeTool)
  activeTool=null
  if(tool&&tool.close) tool.close()
  render()
}
function post(message){parent.postMessage({pluginMessage:message},'*')}
function findValues(){
  return {
    query:(q('findQuery').value||'').trim(),match:q('findMatch').value||'any',
    nodeType:q('findType').value||'',scope:q('findScope').value||'all',
  }
}
function scheduleFind(){clearTimeout(findTimer);findTimer=setTimeout(runFind,250)}
function runFind(){
  clearTimeout(findTimer);findTimer=null;findStale=false
  const values=findValues()
  findSeq++
  findError=false
  if(!values.query&&!values.nodeType){
    findBusy=false;findResults=[];findText=''
    post({type:'find-cancel',seq:findSeq})
  } else {
    findBusy=true;findText='Searching…'
    post({type:'find-nodes',seq:findSeq,query:values.query,match:values.match,nodeType:values.nodeType,scope:values.scope})
  }
  renderFind()
}
function openFind(){
  const input=q('findQuery')
  if(typeof input.focus==='function') input.focus()
  if(findStale) runFind()
}
// Leaving the tool stops a search that is still walking the file.
function closeFind(){
  if(findTimer){clearTimeout(findTimer);findTimer=null;findStale=true}
  if(!findBusy) return
  findSeq++;findBusy=false;findStale=true;findText=''
  post({type:'find-cancel',seq:findSeq})
  renderFind()
}
function count(n){return Number(n||0).toLocaleString()}
function findSummary(msg){
  const n=findResults.length
  if(msg.error) return msg.error
  if(!n) return msg.nodeId?'No layer has id '+msg.nodeId+' in this file.':'No layer matches.'
  if(msg.more) return 'First '+n+' matches. Narrow the search.'
  return n===1?'1 match':count(n)+' matches'
}
function typeLabel(type){const t=String(type||'').toLowerCase().replace(/_/g,' ');return t.charAt(0).toUpperCase()+t.slice(1)}
function resultRow(item,i){
  const meta=[[item.pageName].concat(item.path||[]).filter(Boolean).join(' › ')]
  if(item.component) meta.push(item.component)
  if(item.text) meta.push('“'+item.text+'”')
  if(item.hidden) meta.push('Hidden')
  return '<li class="result">'
    +'<button class="result-open" data-open="'+i+'" title="Select and zoom to this layer">'
    +'<span class="result-name"><span class="name">'+esc(item.name||'Untitled')+'</span><span class="type">'+esc(typeLabel(item.type))+'</span></span>'
    +'<span class="result-meta">'+esc(meta.filter(Boolean).join(' · '))+'</span></button>'
    +'<button class="secondary copy" data-copy="'+i+'" title="'+(item.link?'Copy a link to this layer':'Copy the node id')+'">Copy</button></li>'
}
function renderFind(){
  const status=q('findStatus')
  status.textContent=findText
  if(findError) status.classList.add('error'); else status.classList.remove('error')
  toggle('findStatus',Boolean(findText))
  q('findResults').innerHTML=findResults.map(resultRow).join('')
  toggle('findResults',findResults.length>0)
  fit()
}
// The plugin iframe may not use navigator.clipboard, so a hidden field is copied.
function copyLayer(item){
  if(!item) return
  const text=item.link||item.id
  const box=q('clipboard')
  box.value=text
  box.select()
  let copied=false
  try{copied=document.execCommand('copy')}catch{}
  if(copied) post({type:'notify',message:(item.link?'Link':'Node id')+' copied: '+item.name})
  else {findError=true;findText='Could not copy. '+(item.link?'Link':'Node id')+': '+text;renderFind()}
}
window.addEventListener('message',async e=>{
  const msg=e.data.pluginMessage
  if(!msg) return
  // A paced read waits on this answer instead of a timer Figma throttles while hidden.
  if(msg.type==='bridge-yield'){parent.postMessage({pluginMessage:{type:'bridge-yield-ack',id:msg.id}},'*');return}
  switch(msg.type){
    case 'status': updateInfo(msg); break
    // An error while nothing is connecting leaves the panel idle, with Connect.
    case 'error': if(!bridgeWanted) idle=true; showError(msg.error); break
    case 'bridge-start': await beginBridge(msg.config); break
    case 'bridge-result': await sendBridgeReply(msg); break
    case 'bridge-invalidate': await invalidateBridge(msg); break
    case 'bridge-stop': cancelPairing(); await stopBridge(msg.reason); break
    case 'find-progress':
      if(msg.seq===findSeq&&findBusy){findText='Searching… '+count(msg.checked)+' layers checked';renderFind()}
      break
    case 'find-result':
      if(msg.seq!==findSeq) break
      findBusy=false;findResults=Array.isArray(msg.results)?msg.results:[];findError=Boolean(msg.error);findText=findSummary(msg)
      renderFind()
      break
    case 'find-error': findError=true;findText=String(msg.error||'');renderFind(); break
  }
})
q('bridgeToken').addEventListener('change',e=>{
  // A new token replaces the one the bridge refused, and connects when it can.
  token=String(e.target.value||'').trim();tokenRejected=false;idle=false;errorText=''
  if(token&&!needsFile()) parent.postMessage({pluginMessage:{type:'connect-bridge',token,fileSource:fileSource()}},'*')
  else parent.postMessage({pluginMessage:{type:'set-token',token}},'*')
  render()
})
q('fileSource').addEventListener('change',()=>{if(token&&fileSource()) connect(); else render()})
q('connectBtn').addEventListener('click',connect)
q('retryBtn').addEventListener('click',()=>{if(bridgeConfig) beginBridge(bridgeConfig)})
q('disconnectBtn').addEventListener('click',()=>{idle=true;stopBridge('plugin-stop');parent.postMessage({pluginMessage:{type:'bridge-stopped'}},'*')})
q('pairBtn').addEventListener('click',()=>{startPairing()})
q('cancelPairBtn').addEventListener('click',()=>{errorText='';cancelPairing()})
q('advanced').addEventListener('toggle',fit)
q('toolsBtn').addEventListener('click',()=>setMenu(!menuOpen))
q('backBtn').addEventListener('click',closeTool)
q('toolsMenu').addEventListener('click',e=>{
  const item=e.target.closest&&e.target.closest('[data-tool]')
  if(item) openTool(item.getAttribute('data-tool'))
})
// A click outside the Tools menu, or Escape, closes it.
document.addEventListener('click',e=>{
  if(menuOpen&&!(e.target.closest&&e.target.closest('.menu-wrap'))) setMenu(false)
})
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&menuOpen) setMenu(false)})
q('findQuery').addEventListener('input',scheduleFind)
q('findQuery').addEventListener('keydown',e=>{if(e.key==='Enter') runFind()})
;['findMatch','findType','findScope'].forEach(id=>q(id).addEventListener('change',runFind))
q('findResults').addEventListener('click',e=>{
  const target=e.target.closest&&e.target.closest('[data-open],[data-copy]')
  if(!target) return
  const copy=target.getAttribute('data-copy')
  if(copy!==null){copyLayer(findResults[Number(copy)]);return}
  const item=findResults[Number(target.getAttribute('data-open'))]
  if(item) post({type:'select-node',nodeId:item.id})
})
renderMenu()
render()
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
  return limits.state.nodeCount >= limits.maxNodes || limits.state.byteSize >= limits.maxBytes || readTimeUp(limits)
}

// A read ends by its deadline, with what it has read so far. Figma can leave a
// call unsettled: an export inside a very large section never answered, in
// testing. The plugin serves one read at a time, so without a deadline that
// one read would hold every read after it until the panel was reopened.
function readTimeUp(limits) {
  if (!limits || !limits.state || !Number.isFinite(limits.deadline)) return false
  if (!limits.state.timeUp) {
    if (Date.now() < limits.deadline) return false
    stopForTime(limits)
  }
  return true
}

// Whatever the read skips from here on makes it incomplete.
function stopForTime(limits) {
  limits.state.timeUp = true
  limits.state.limitHit = true
}

// The read stops a little before the bridge gives up on it, so its answer
// still has time to be serialized and sent.
const READ_RESERVE_MIN_MS = 1000
const READ_RESERVE_MAX_MS = 5000

function readDeadline(request) {
  const expiresAt = request && request.expiresAt
  if (!Number.isFinite(expiresAt)) return Infinity
  const enqueuedAt = Number.isFinite(request.enqueuedAt) ? request.enqueuedAt : expiresAt - 30_000
  const reserve = Math.min(READ_RESERVE_MAX_MS, Math.max(READ_RESERVE_MIN_MS, (expiresAt - enqueuedAt) / 5))
  return expiresAt - reserve
}

const TIME_UP_MESSAGES = {
  load: id => `Figma is still loading the page of layer ${id}. Retry the read in a moment, or open that page in Figma first.`,
  export: id => `Figma did not finish exporting layer ${id} before the read's time limit. Pass a larger timeoutMs, or read a smaller layer.`,
}

function timeUpError(step, id) {
  const message = TIME_UP_MESSAGES[step] ? TIME_UP_MESSAGES[step](id) : `Figma did not answer in time (${step} ${id}).`
  const error = new Error(message)
  error.timeUp = true
  return error
}

// Runs one Figma call, waiting for it no longer than the read's deadline. When
// the deadline comes first, the read records the call it was waiting on and
// the call's answer, if it ever comes, is dropped.
function untilDeadline(limits, step, id, call) {
  if (!limits || !limits.state || !Number.isFinite(limits.deadline)) return call()
  if (readTimeUp(limits)) return Promise.reject(timeUpError(step, id))
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      stopForTime(limits)
      limits.state.stalled = { step, nodeId: id, ms: Date.now() - started }
      reject(timeUpError(step, id))
    }, Math.max(0, limits.deadline - started))
    Promise.resolve().then(call).then(
      value => { clearTimeout(timer); resolve(value) },
      error => { clearTimeout(timer); reject(error) },
    )
  })
}

// The layer a read is for. Loading it can load its page, which Figma does
// slowly the first time on a large file.
async function loadBridgeNode(nodeId, limits) {
  return untilDeadline(limits, 'load', nodeId, () => figma.getNodeByIdAsync(nodeId))
}

// One Figma lookup: null when it fails, as a lookup that finds nothing. It
// throws only when the read is out of time.
async function lookupWithin(limits, step, id, call) {
  try {
    return await untilDeadline(limits, step, id, call)
  } catch (error) {
    if (error && error.timeUp) throw error
    return null
  }
}

// The completeness field a read cut by its deadline adds.
function timeUpFields(limits) {
  return limits && limits.state && limits.state.timeUp ? { stoppedBy: 'time' } : {}
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

// Bridge reads walk thousands of nodes at a few hundred a second. Done in one
// go, that freezes Figma and the panel with it, and a panel that cannot send a
// heartbeat for 90 seconds loses its session. The paced walk hands control back
// to Figma whenever it has worked for a slice.
const BRIDGE_SLICE_MS = 50

// Figma throttles timers while its window is hidden or minimized: a
// setTimeout(0) then takes a second, and a minute once the window has been
// hidden for a few minutes, so a walk that yields that way takes minutes. A
// message to the panel and back is not throttled. The walk yields both ways at
// once and goes on with whichever comes back first, so a panel that does not
// answer still leaves the timer.
const pendingYields = new Map()
let yieldSeq = 0

function yieldToFigma() {
  return new Promise(resolve => {
    let settled = false
    let id = null
    let timer = null
    const done = () => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      if (id !== null) pendingYields.delete(id)
      resolve()
    }
    if (state.ready) {
      id = ++yieldSeq
      pendingYields.set(id, done)
      try {
        figma.ui.postMessage({ type: 'bridge-yield', id })
      } catch {
        pendingYields.delete(id)
        id = null
      }
    }
    if (!settled) timer = setTimeout(done, 0)
  })
}

function yieldAnswered(id) {
  const done = pendingYields.get(id)
  if (done) done()
}

// stats, when given, counts the yields and the time spent waiting on them, so
// a read can show whether Figma kept it waiting.
function createPacer(sliceMs = BRIDGE_SLICE_MS, stats = null) {
  let sliceStart = Date.now()
  return async function pace() {
    if (Date.now() - sliceStart < sliceMs) return
    const waited = Date.now()
    await yieldToFigma()
    sliceStart = Date.now()
    if (stats) {
      const ms = sliceStart - waited
      stats.yields = (stats.yields || 0) + 1
      stats.yieldMs = (stats.yieldMs || 0) + ms
      stats.maxYieldMs = Math.max(stats.maxYieldMs || 0, ms)
    }
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

// Mixed Figma properties are Symbols, which cannot cross the UI message boundary.
function sanitizeForMessage(value) {
  return JSON.parse(JSON.stringify(value))
}

function parseFileKey(source) {
  const value = String(source || '').trim()
  if (/^[A-Za-z0-9_-]{1,128}$/.test(value)) return value
  const match = value.match(/^https:\/\/(?:www\.)?figma\.com\/(?:design|file)\/([A-Za-z0-9_-]{1,128})(?:[/?#]|$)/i)
  return match ? match[1] : null
}

// The caps keep a read inside what the plugin can serve: 20,000 nodes take
// about 90 seconds to walk, and the bridge waits two minutes at most. Depth
// is not limited unless asked: nested instances put text 20 levels down, and
// maxNodes and maxBytes already bound the read.
// deadline: when the read stops and answers with what it has (readDeadline).
function bridgeLimits(options = {}, deadline = Infinity) {
  const integer = (value, fallback, min, max) => Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback
  return {
    maxDepth: integer(options.depth, 50, 0, 50),
    maxNodes: integer(options.maxNodes, 5000, 1, 20_000),
    maxBytes: integer(options.maxBytes, 2_000_000, 1024, 10_000_000),
    maxTextChars: 100_000,
    includeHidden: options.includeHidden !== false,
    deadline,
    state: { nodeCount: 0, byteSize: 0, limitHit: false, truncatedNodeIds: [], timeUp: false, stalled: null },
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
    ...timeUpFields(limits),
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
  const limits = bridgeLimits(params.options || {}, readDeadline(request))
  const node = await loadBridgeNode(params.nodeId, limits)
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
  // Out of time: the node does not fit, so it is outlined and its children
  // come back as placeholders.
  if (readTimeUp(read.limits)) return { count: Infinity, height: Infinity }
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
    exported = await untilDeadline(read.limits, 'export', node.id, () => node.exportAsync({ format: 'JSON_REST_V1' }))
  } catch (error) {
    if (error && error.timeUp) throw error
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
        // Out of time while Figma exported it: the node is outlined instead.
        if (!error.timeUp) {
          // Until one export has worked, a failure may mean this Figma cannot
          // export JSON at all, and the read falls back as a whole.
          if (!error.exportFailed || read.exports === 0) throw error
          exportError = error.message
        }
      }
    }
  }

  limits.state.nodeCount++
  const outlined = Date.now()
  const outline = outlineNode(node)
  read.timing.outlineMs += Date.now() - outlined
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
    try {
      node = await lookupWithin(read.limits, 'geometry', restNode.id, () => figma.getNodeByIdAsync(restNode.id))
    } catch (error) {
      if (!error.timeUp) throw error
      // Out of time: the vectors left keep the paths the export gave them.
      markBridgeTruncated(read.limits)
      return
    }
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
    try {
      variable = await lookupWithin(read.limits, 'variable', id, () => api.getVariableByIdAsync(id))
      const collectionId = variable && variable.variableCollectionId
      if (variable && !collections.has(collectionId)) {
        collections.set(collectionId, await lookupWithin(read.limits, 'variable', collectionId, () => api.getVariableCollectionByIdAsync(collectionId)))
      }
    } catch (error) {
      if (!error.timeUp) throw error
      // Out of time: the variables named so far are kept, the rest stay ids.
      markBridgeTruncated(read.limits)
      break
    }
    // A library variable the file never imported cannot be looked up.
    if (!variable) continue
    const collectionId = variable.variableCollectionId
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
  const limits = bridgeLimits(params.options || {}, readDeadline(request))
  const node = await loadBridgeNode(params.nodeId, limits)
  if (!node) return missingBridgeNode(params.nodeId)

  const timing = { countMs: 0, exportMs: 0, outlineMs: 0, variablesMs: 0, totalMs: 0 }
  const read = {
    limits, pace: createPacer(BRIDGE_SLICE_MS, timing), sizes: new Map(), exports: 0,
    geometry: representationParts(request).includes('geometry'), vectors: [],
    components: {}, componentSets: {}, styles: {}, timing,
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
  const named = Date.now()
  payload.variables = await resolveVariables(variableIds, read)
  read.timing.variablesMs = Date.now() - named
  size += utf8Length(',"variables":') + jsonBytes(payload.variables)
  if (size > limits.maxBytes) size = fitRestPayloadToLimit(payload, limits, node.id, size)

  const completeness = completenessFor(payload.document, limits, size)
  const page = findPageForNode(node)
  read.timing.totalMs = Date.now() - started
  if (limits.state.stalled) read.timing.stalled = limits.state.stalled
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
  // A frame placed on the page or in a section is a screen: its image is
  // that screen's background.
  const parent = readValue(node, 'parent')
  if (parent && (parent.type === 'PAGE' || parent.type === 'SECTION')) layer.screen = true
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
      return { svg: await untilDeadline(read.limits, 'export', node.id, () => node.exportAsync({ format: 'SVG_STRING' })) }
    } catch (error) {
      if (error && error.timeUp) throw error
      return { svgBase64: figma.base64Encode(await untilDeadline(read.limits, 'export', node.id, () => node.exportAsync({ format: 'SVG' }))) }
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
      const size = typeof source.getSizeAsync === 'function' ? await untilDeadline(read.limits, 'image', image.hash, () => source.getSizeAsync()) : null
      if (size) Object.assign(image, { width: size.width, height: size.height })
      const bytes = await untilDeadline(read.limits, 'image', image.hash, () => source.getBytesAsync())
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
  const limits = bridgeLimits({ ...(params.options || {}), includeHidden: false }, readDeadline(request))
  const node = await loadBridgeNode(params.nodeId, limits)
  if (!node) return missingBridgeNode(params.nodeId)

  const timing = { countMs: 0, exportMs: 0, totalMs: 0 }
  const read = {
    limits, pace: createPacer(BRIDGE_SLICE_MS, timing), images: new Map(), bytes: 0,
    origin: readValue(node, 'absoluteBoundingBox'), timing,
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
    limitHit: limits.state.limitHit, truncatedNodeIds: limits.state.truncatedNodeIds, ...timeUpFields(limits),
  }
  if (limits.state.stalled) read.timing.stalled = limits.state.stalled
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
  const limits = bridgeLimits(params.options || {}, readDeadline(request))
  const parts = representationParts(request)
  const node = await loadBridgeNode(params.nodeId, limits)
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
    const exported = await exportSvg(node, { limits, timing: { exportMs: 0 } })
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
    const bytes = await untilDeadline(limits, 'export', node.id, () => node.exportAsync({ format: format === 'jpg' ? 'JPG' : 'PNG', constraint }))
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

// The 'search' representation: the layers under a node whose name or text holds
// the query, as the Find node tool matches them. Only names, text, box and
// first fill are read, with no export, so a section of many screens is
// searched in seconds rather than exported layer by layer.
const SEARCH_LIMIT = 200
const SEARCH_TEXT_CHARS = 300

function paintHex(color) {
  const channel = value => Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 255).toString(16).padStart(2, '0')
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`.toUpperCase()
}

// One match, in the fields search_design shows: path holds the names of the
// layers between the node read and the match.
function searchMatch(node, path) {
  const match = { id: node.id, name: node.name, type: node.type, path }
  const characters = node.type === 'TEXT' ? readValue(node, 'characters') : undefined
  if (typeof characters === 'string') {
    match.text = characters.length > SEARCH_TEXT_CHARS ? `${characters.slice(0, SEARCH_TEXT_CHARS - 1)}…` : characters
  }
  for (const key of ['x', 'y', 'width', 'height']) {
    const value = readValue(node, key)
    if (typeof value === 'number') match[key] = Math.round(value)
  }
  const fill = shownPaints(readValue(node, 'fills'))[0]
  if (fill && fill.type === 'SOLID' && fill.color) match.fill = paintHex(fill.color)
  return match
}

async function readBridgeSearch(request) {
  const started = Date.now()
  const params = request.params || {}
  const options = params.options || {}
  const limits = bridgeLimits(options, readDeadline(request))
  const node = await loadBridgeNode(params.nodeId, limits)
  if (!node) return missingBridgeNode(params.nodeId)

  const query = typeof options.query === 'string' ? options.query : ''
  const matches = layerMatcher({ query })
  const timing = { countMs: 0, totalMs: 0 }
  const pace = createPacer(BRIDGE_SLICE_MS, timing)
  const found = []
  const stack = [{ node, depth: 0, path: [] }]
  let checked = 0, more = false
  while (stack.length) {
    await pace()
    // Out of time: the matches so far are the answer, and checked says how far it got.
    if (readTimeUp(limits)) break
    const { node: layer, depth, path } = stack.pop()
    // A layer deleted while the walk was paused is skipped with its children.
    try {
      if (layer.removed) continue
      if (depth > 0 && !limits.includeHidden && layer.visible === false) continue
      checked++
      if (await matches(layer)) {
        if (found.length === SEARCH_LIMIT) { more = true; break }
        found.push(searchMatch(layer, path))
      }
      const children = depth < limits.maxDepth && 'children' in layer ? layer.children : null
      if (children && children.length) {
        const below = [...path, layer.name]
        for (let i = children.length - 1; i >= 0; i--) stack.push({ node: children[i], depth: depth + 1, path: below })
      }
    } catch {}
  }
  timing.countMs = Date.now() - started

  const payload = { query, matches: found, checked, more }
  const completeness = {
    nodeCount: checked, byteSize: utf8Length(JSON.stringify(payload)),
    limitHit: more || Boolean(limits.state.timeUp), truncatedNodeIds: [], ...timeUpFields(limits),
  }
  const page = findPageForNode(node)
  timing.totalMs = Date.now() - started
  return {
    fileKey: state.bridgeFileKey, fileName: state.bridgeFileName, nodeId: node.id,
    pageId: page ? page.id : null, pageName: page ? page.name : null, found: true,
    truncated: completeness.limitHit, completeness, format: 'search', timing, payload,
  }
}

function readBridgeNodeAs(request) {
  const base = representationBase(request)
  if (base === 'assets') return readBridgeAssets(request)
  if (base === 'render') return readBridgeRender(request)
  if (base === 'search') return readBridgeSearch(request)
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

// lane 'heavy' or 'light' (see bridgeLaneOf). Only the heavy lane keeps a read
// for the retry right behind it: a light read is quick to make again.
async function handleBridgeRequest(sessionId, request, lane = 'heavy') {
  let previous = null
  if (lane === 'heavy') {
    previous = repeatableBridgeRead
    repeatableBridgeRead = null
  }
  if (!request || !request.requestId) return
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
  // Too little time is left to read anything: the caller hears why now,
  // rather than a timeout later. A read past its deadline is answered too, so
  // the bridge frees its lane for the reads behind it at once.
  const deadline = readDeadline(request)
  if (Number.isFinite(deadline) && Date.now() >= deadline) {
    figma.ui.postMessage({
      type: 'bridge-result', sessionId, requestId: request.requestId, ok: false,
      error: 'This read waited behind earlier reads until its time limit, so the plugin did not start it. Retry it, or pass a larger timeoutMs.',
    })
    return
  }
  // A count: a light read can run while a heavy one is paused.
  state.bridgeReading++
  // Taken before the read starts: an edit made while it runs leaves the result
  // behind the count, so the bridge never reuses it.
  const editSeq = state.editSeq
  try {
    let result
    if (request.op === 'read-node') result = await readBridgeNodeAs(request)
    else if (request.op === 'read-document-index') result = readBridgeDocumentIndex(request)
    else throw new Error(`Unsupported bridge operation: ${request.op}`)
    result.editSeq = editSeq
    // A read cut by its deadline is not reused: a retry may have more time.
    if (lane === 'heavy' && !(result.completeness && result.completeness.stoppedBy)) keepForNextRead({ key, editSeq, result })
    replyBridgeRead(sessionId, request, result)
  } catch (error) {
    figma.ui.postMessage({ type: 'bridge-result', sessionId, requestId: request.requestId, ok: false, error: error.message || String(error) })
  } finally {
    state.bridgeReading = Math.max(0, state.bridgeReading - 1)
    if (state.bridgeReading === 0 && state.editedDuringRead) {
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

// One heavy read at a time: a paced walk lets other work run between its
// slices, and two walks at once would hold two trees in the plugin's memory.
// Light reads (a search, the document index) hold only names and text, so they
// run on their own queue beside it: a search from one agent session does not
// wait for another session's export of a large frame.
let bridgeQueue = Promise.resolve()
let lightBridgeQueue = Promise.resolve()
// Heavy reads waiting their turn, oldest first.
const waitingBridgeReads = []

function bridgeLaneOf(request) {
  if (request && request.op === 'read-document-index') return 'light'
  if (request && request.op === 'read-node' && representationBase(request) === 'search') return 'light'
  return 'heavy'
}
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
  if (bridgeLaneOf(request) === 'light') {
    const light = lightBridgeQueue.then(() => handleBridgeRequest(sessionId, request, 'light'))
    lightBridgeQueue = light.catch(() => {})
    return light
  }
  waitingBridgeReads.push(request)
  const run = bridgeQueue.then(() => {
    waitingBridgeReads.shift()
    return handleBridgeRequest(sessionId, request, 'heavy')
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

// The Find node tool. The panel asks for layers by name, text, type, component
// or node id, and the plugin walks the document in slices, so Figma stays
// responsive on a large file. A newer search or a cancel changes state.findSeq,
// and the older walk stops at its next slice.
const FIND_LIMIT = 100
const FIND_PROGRESS_MS = 250
const FIND_TEXT_CHARS = 80
const NODE_ID_QUERY = /^I?\d+[:-]\d+(?:;\d+[:-]\d+)*$/

// A node id as Figma shows it (10996:249363), as a link writes it
// (10996-249363), or inside a link's node-id parameter.
function nodeIdFrom(value) {
  const text = String(value || '').trim()
  return NODE_ID_QUERY.test(text) ? text.replace(/(\d+)-(\d+)/g, '$1:$2') : null
}

// What the query asks for when it names one layer: { nodeId, fileKey } for an
// id or a link with node-id, { error } for a link without one, null for text.
function parseNodeQuery(query) {
  const text = String(query || '').trim()
  const nodeId = nodeIdFrom(text)
  if (nodeId) return { nodeId, fileKey: null }
  if (!/^https?:\/\//i.test(text)) return null
  const param = text.match(/[?&#]node-id=([^&#]+)/i)
  let raw = ''
  try { raw = param ? decodeURIComponent(param[1]) : '' } catch {}
  const fromLink = nodeIdFrom(raw)
  if (!fromLink) return { error: 'That link has no node-id. In Figma, right-click the layer and choose Copy link to selection.' }
  return { nodeId: fromLink, fileKey: parseFileKey(text) }
}

function layerMatcher({ query, match, nodeType }) {
  const needle = String(query || '').trim().toLowerCase()
  const type = typeof nodeType === 'string' && nodeType ? nodeType : null
  const has = value => typeof value === 'string' && value.toLowerCase().includes(needle)
  const hasText = node => node.type === 'TEXT' && has(node.characters)
  return async node => {
    if (type && node.type !== type) return false
    if (!needle) return true
    if (match === 'name') return has(node.name)
    if (match === 'text') return hasText(node)
    if (match === 'component') {
      if (node.type === 'COMPONENT_SET') return has(node.name)
      if (node.type === 'COMPONENT') {
        const set = node.parent && node.parent.type === 'COMPONENT_SET' ? node.parent : null
        return has(set ? `${set.name} / ${node.name}` : node.name)
      }
      return node.type === 'INSTANCE' && has(await componentName(node))
    }
    return has(node.name) || hasText(node)
  }
}

// A link an agent can read the layer with, when the plugin knows the file key.
function layerLink(nodeId) {
  const fileKey = knownFileKey() || state.bridgeFileKey
  if (!fileKey) return null
  const slug = documentName().replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Untitled'
  const id = /^\d+:\d+$/.test(nodeId) ? nodeId.replace(':', '-') : encodeURIComponent(nodeId)
  return `https://www.figma.com/design/${fileKey}/${slug}?node-id=${id}`
}

async function describeLayer(node) {
  const page = findPageForNode(node)
  const ancestors = []
  for (let parent = node.parent; parent && parent.type !== 'PAGE' && parent.type !== 'DOCUMENT'; parent = parent.parent) {
    ancestors.unshift(parent.name)
  }
  const item = {
    id: node.id, name: node.name, type: node.type,
    pageId: page ? page.id : null, pageName: page ? page.name : null,
    path: ancestors.length > 3 ? ['…', ...ancestors.slice(-3)] : ancestors,
    hidden: node.visible === false, link: layerLink(node.id),
  }
  if (node.type === 'TEXT' && typeof node.characters === 'string') {
    const text = node.characters.replace(/\s+/g, ' ').trim()
    item.text = text.length > FIND_TEXT_CHARS ? `${text.slice(0, FIND_TEXT_CHARS - 1)}…` : text
  }
  if (node.type === 'INSTANCE') {
    const name = await componentName(node)
    if (name) item.component = name
  }
  return item
}

function pushChildren(stack, node) {
  const children = node.children
  if (!children) return
  for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
}

async function findLayers(msg) {
  const seq = msg.seq
  const current = () => state.findSeq === seq
  const reply = body => {
    if (current()) figma.ui.postMessage(sanitizeForMessage({ type: 'find-result', seq, ...body }))
  }

  const named = parseNodeQuery(msg.query)
  if (named) {
    if (named.error) return reply({ results: [], error: named.error })
    const openFile = knownFileKey() || state.bridgeFileKey
    if (named.fileKey && openFile && named.fileKey !== openFile) {
      return reply({ results: [], error: 'That link is for another file than the one open here.' })
    }
    let node = null
    try { node = await figma.getNodeByIdAsync(named.nodeId) } catch {}
    const found = node && !node.removed && findPageForNode(node) && node.type !== 'PAGE'
    return reply({ results: found ? [await describeLayer(node)] : [], nodeId: named.nodeId, checked: found ? 1 : 0 })
  }

  const matches = layerMatcher(msg)
  const page = figma.currentPage
  const others = (figma.root && figma.root.children ? [...figma.root.children] : []).filter(other => other !== page)
  const pages = msg.scope === 'page' ? [page] : [page, ...others]
  const stack = []
  for (let i = pages.length - 1; i >= 0; i--) pushChildren(stack, pages[i])

  const pace = createPacer()
  const results = []
  let checked = 0, more = false, progressAt = Date.now()
  while (stack.length) {
    await pace()
    if (!current()) return
    if (Date.now() - progressAt >= FIND_PROGRESS_MS) {
      progressAt = Date.now()
      figma.ui.postMessage({ type: 'find-progress', seq, checked })
    }
    const node = stack.pop()
    // A layer deleted while the walk was paused is skipped with its children.
    try {
      if (node.removed) continue
      checked++
      if (await matches(node)) {
        if (results.length === FIND_LIMIT) { more = true; break }
        results.push(await describeLayer(node))
      }
      pushChildren(stack, node)
    } catch {}
  }
  reply({ results, more, checked })
}

// Picking a result shows the layer: its page, selected, in view.
async function selectLayer(msg) {
  let node = null
  try { node = await figma.getNodeByIdAsync(String(msg.nodeId || '')) } catch {}
  const page = node && !node.removed ? findPageForNode(node) : null
  if (!page || node === page) {
    figma.ui.postMessage({ type: 'find-error', error: 'That layer is gone. Search again.' })
    return
  }
  try {
    if (figma.currentPage !== page) {
      if (typeof figma.setCurrentPageAsync === 'function') await figma.setCurrentPageAsync(page)
      else figma.currentPage = page
    }
    page.selection = [node]
    figma.viewport.scrollAndZoomIntoView([node])
  } catch (error) {
    figma.ui.postMessage({ type: 'find-error', error: `Figma could not select that layer: ${error.message || error}` })
  }
}

// clientStorage is per Figma user, not per document, so a file link is kept per
// document name: another document never inherits it. Links saved by 1.1 under
// a single `fileSource` key are ignored for that reason.
async function loadBridgePreferences() {
  const defaults = { bridgeToken: '', fileSources: {} }
  if (!figma.clientStorage || typeof figma.clientStorage.getAsync !== 'function') return defaults
  try {
    const saved = await figma.clientStorage.getAsync('design-bridge-pairing')
    // Before 1.9.0 the panel also kept a bridge URL. The manifest lets the
    // plugin reach SERVER_URL only, so a saved one is dropped.
    const { fileSource, bridgeUrl, ...rest } = saved && typeof saved === 'object' ? saved : {}
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

async function startBridgeSession(token, fileKey, fileSource) {
  state.bridgeFileKey = fileKey
  state.bridgeFileName = documentName()
  state.bridgeToken = token
  const prefs = await loadBridgePreferences()
  const fileSources = { ...prefs.fileSources }
  if (!knownFileKey() && fileSource) fileSources[documentName()] = String(fileSource).trim()
  await saveBridgePreferences({ bridgeToken: token, fileSources })
  figma.ui.postMessage({
    type: 'bridge-start',
    config: { url: SERVER_URL, token, fileKey, fileName: state.bridgeFileName, pluginInstanceId: state.pluginInstanceId },
  })
}

// Since 1.9.0 the manifest has no menu, and running the plugin gives ''. A menu
// imported before keeps its commands until the manifest is imported again:
// 'open', 'bridge' (its name before 1.2.0) and the retired page-sync commands
// all open the panel. Any other command closes the plugin at once.
const PANEL_COMMANDS = ['', 'open', 'bridge', 'watch', 'sync-page', 'sync-selection']

function isOpenCommand() {
  return PANEL_COMMANDS.includes(figma.command || '')
}

const PANEL_WIDTH = 300

// The panel reports its height after each change, so the window fits it.
function resizePanel(height) {
  const value = Math.ceil(Number(height))
  if (!Number.isFinite(value) || typeof figma.ui.resize !== 'function') return
  figma.ui.resize(PANEL_WIDTH, Math.min(560, Math.max(120, value)))
}

const state = {
  ready: false,
  bridgeFileKey: null, bridgeFileName: null, bridgeConnected: false, bridgeToken: '',
  lastBridgeNode: null, lastBridgeRequest: null, bridgeReading: 0, editedDuringRead: false, editSeq: 0,
  findSeq: 0,
  pluginInstanceId: `plugin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
}

function updateUIStatus(extra = {}) {
  figma.ui.postMessage({
    type: 'status', connected: state.bridgeConnected,
    fileName: documentName(), fileKeyKnown: Boolean(knownFileKey()),
    lastNode: state.lastBridgeNode || '', lastRequest: state.lastBridgeRequest?.toISOString(),
    bridgeToken: state.bridgeToken,
    ...extra,
  })
}

function main() {
  if (!isOpenCommand()) {
    figma.closePlugin()
    return
  }

  figma.showUI(UI_HTML, { width: PANEL_WIDTH, height: 240, themeColors: true })

  // An edit invalidates what the bridge cached for this file.
  figma.on('documentchange', () => {
    state.editSeq++
    reportBridgeEdit()
  })
  figma.on('close', () => {
    state.ready = false
    state.bridgeConnected = false
    figma.ui.postMessage({ type: 'bridge-stop', reason: 'plugin-close' })
  })

  figma.ui.onmessage = async msg => {
    switch (msg.type) {
      case 'bridge-yield-ack':
        yieldAnswered(msg.id)
        break

      case 'ui-ready': {
        if (state.ready) break
        state.ready = true
        const prefs = await loadBridgePreferences()
        state.bridgeToken = prefs.bridgeToken || ''
        const fileSource = savedFileSource(prefs)
        updateUIStatus({ fileSource })
        // Paired before and the file is known: connect without a click.
        const fileKey = knownFileKey() || parseFileKey(fileSource)
        if (state.bridgeToken && fileKey) {
          try {
            await startBridgeSession(state.bridgeToken, fileKey, fileSource)
          } catch (error) {
            figma.ui.postMessage({ type: 'error', error: error.message || String(error) })
          }
        }
        break
      }

      case 'resize':
        resizePanel(msg.height)
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
        await saveBridgePreferences({ ...prefs, bridgeToken: token })
        figma.notify('Paired with the bridge')
        updateUIStatus()
        // Without a file key the panel asks for the file's link, and connects
        // once it is pasted.
        const fileSource = String(msg.fileSource || '').trim() || savedFileSource(prefs)
        const fileKey = knownFileKey() || parseFileKey(fileSource)
        if (fileKey) await startBridgeSession(token, fileKey, fileSource)
        break
      }

      case 'connect-bridge':
        try {
          const entered = parseFileKey(msg.fileSource)
          const fileKey = knownFileKey() || entered
          if (!fileKey) {
            throw new Error(msg.fileSource
              ? "That is not a Figma file link. Copy it from Share → Copy link."
              : "Paste this file's link first.")
          }
          if (knownFileKey() && entered && entered !== knownFileKey()) {
            throw new Error('That link is for another file than the one open here.')
          }
          const token = String(msg.token || '').trim()
          if (!token) throw new Error('Pair with the bridge first.')
          await startBridgeSession(token, fileKey, msg.fileSource)
        } catch (error) {
          state.bridgeConnected = false
          figma.ui.postMessage({ type: 'error', error: error.message || String(error) })
          updateUIStatus()
        }
        break

      case 'bridge-status':
        state.bridgeConnected = Boolean(msg.connected)
        updateUIStatus()
        if (msg.error) figma.ui.postMessage({ type: 'error', error: msg.error })
        break

      case 'bridge-request':
        await queueBridgeRequest(msg.sessionId, msg.request)
        break

      case 'bridge-stopped':
        state.bridgeConnected = false
        updateUIStatus()
        break

      // Find node. A search with a newer seq, or a cancel, stops the one before.
      case 'find-nodes':
        state.findSeq = msg.seq
        await findLayers(msg)
        break

      case 'find-cancel':
        state.findSeq = msg.seq
        break

      case 'select-node':
        await selectLayer(msg)
        break

      case 'notify':
        if (msg.message) figma.notify(String(msg.message).slice(0, 200))
        break
    }
  }
}

main()
