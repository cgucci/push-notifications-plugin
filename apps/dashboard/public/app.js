const $=id=>document.getElementById(id);
let csrf=null, dashboard=null, settings=null, pendingAction=null, polling=false, signedIn=false;
const escapeText=value=>String(value??'');
function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=escapeText(text);return node;}
function announce(text,type='info'){const box=$('message');box.textContent=text;box.className='notice '+type;box.hidden=false;}
async function api(path,options={}){
  const response=await fetch('/api/'+path,{...options,credentials:'same-origin',cache:'no-store',headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),...options.headers},body:options.body?JSON.stringify(options.body):undefined});
  const body=await response.json();
  if(!response.ok){if(response.status===401&&path!=='login')showLogin();throw new Error(body.error||'Request failed');}
  return body;
}
function showLogin(){signedIn=false;csrf=null;$('app-view').hidden=true;$('login-view').hidden=false;document.querySelectorAll('.app-only').forEach(node=>node.hidden=true);}
function showApp(){signedIn=true;$('app-view').hidden=false;$('login-view').hidden=true;document.querySelectorAll('.app-only').forEach(node=>node.hidden=false);navigate();}
function relative(value){if(!value)return 'never';const seconds=Math.max(0,Math.floor((Date.now()-Number(value))/1000));if(seconds<5)return 'just now';if(seconds<60)return seconds+' sec ago';if(seconds<3600)return Math.floor(seconds/60)+' min ago';if(seconds<86400)return Math.floor(seconds/3600)+' hr ago';return Math.floor(seconds/86400)+'d ago';}
function bytes(value){if(value==null)return '—';if(value>=1073741824)return (value/1073741824).toFixed(1)+' GiB';if(value>=1048576)return (value/1048576).toFixed(0)+' MiB';return (value/1024).toFixed(0)+' KiB';}
function uptime(value){if(value==null)return '—';let seconds=Math.floor(value/1000),days=Math.floor(seconds/86400),hours=Math.floor(seconds%86400/3600),minutes=Math.floor(seconds%3600/60);return [days?days+'d':null,hours?hours+'h':null,minutes+'m'].filter(Boolean).join(' ');}
function percent(value){return value==null?'—':(value*100).toFixed(1)+'%';}
function meter(id,value){$(id).style.width=Math.max(0,Math.min(100,value||0))+'%';}
function metric(id,value,unit){const target=$(id);target.replaceChildren(document.createTextNode(value));if(unit)target.append(element('small','',unit));}
function playerRow(player,detail=false){
  const row=element('div','player'),head=element('span','head',player.name.slice(0,2).toUpperCase()),img=element('img');
  img.src='https://mc-heads.net/avatar/'+encodeURIComponent(player.uuid)+'/64';img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>img.remove());head.append(img);
  const content=element('div');content.append(element('div','player-name',player.name));if(detail)content.append(element('div','player-meta',player.uuid));row.append(head,content,element('span','online-dot'));return row;
}
const activityStyle={join:['success','↗'],leave:['info','↘'],health:['warning','!'],recovery:['success','✓'],control:['info','↻']};
function renderActivity(target,rows){
  target.replaceChildren();if(!rows.length){target.append(element('div','empty','No activity yet. Updates will appear here.'));return;}
  for(const item of rows){const [color,glyph]=activityStyle[item.kind]||['info','·'],row=element('div','activity-row'),content=element('div','activity-content'),time=element('time','',relative(item.at));time.dateTime=new Date(item.at).toISOString();time.title=new Date(item.at).toLocaleString();content.append(element('div','activity-title',item.title));if(item.detail&&item.kind!=='join'&&item.kind!=='leave')content.append(element('div','activity-detail',item.detail));row.append(element('span','activity-dot '+color,glyph),content,time);target.append(row);}
}
function renderDashboard(data){
  dashboard=data;$('server-name').textContent=data.name;$('status').textContent=data.status;$('status').className='badge '+(data.status==='Online'?'success':data.status==='Offline'?'danger':'warning');
  const snap=data.snapshot,res=snap?.resources,date=snap?Date.parse(snap.capturedAt):null;
  $('last-update').textContent=relative(date);$('last-update').title=date?new Date(date).toLocaleString():'No snapshot received';
  $('version-label').textContent=snap?'Minecraft '+snap.minecraftVersion:'Waiting for telemetry';
  $('online-count').textContent=data.players.length+' ONLINE';$('online-count').className='badge '+(data.stale?'warning':'success');
  $('players-preview').replaceChildren(...data.players.slice(0,4).map(player=>playerRow(player)));$('players-empty').hidden=data.players.length>0;
  $('players-empty').querySelector('p').textContent=data.stale?'Waiting for fresh player data':'No players online';
  $('all-players').replaceChildren(document.createTextNode('View everyone'+(data.players.length?' ('+data.players.length+')':'')),element('span','','↗'));
  $('players-list').replaceChildren(...data.players.map(player=>playerRow(player,true)));if(!data.players.length)$('players-list').append(element('div','empty','No players online'));
  metric('tps-value',snap?snap.tps[0].toFixed(1):'—');metric('mspt-value',snap?snap.mspt.toFixed(1):'—','ms');
  metric('heap-value',res?bytes(res.jvmHeapUsedBytes):'—');$('heap-hint').textContent=res?bytes(res.jvmHeapUsedBytes)+' / '+bytes(res.jvmHeapMaxBytes):'JVM heap used / max';meter('heap-meter',res?.jvmHeapMaxBytes?res.jvmHeapUsedBytes/res.jvmHeapMaxBytes*100:0);
  metric('cpu-value',res?percent(res.vmCpuRatio):'—');meter('cpu-meter',(res?.vmCpuRatio||0)*100);
  $('ram-value').textContent=res?.vmTotalRamBytes!=null&&res?.vmFreeRamBytes!=null?bytes(Math.max(0,res.vmTotalRamBytes-res.vmFreeRamBytes))+' / '+bytes(res.vmTotalRamBytes):'—';
  $('ram-hint').textContent=res?.vmFreeRamBytes!=null?bytes(res.vmFreeRamBytes)+' free':'Used / total';meter('ram-meter',res?.vmTotalRamBytes?((res.vmTotalRamBytes-res.vmFreeRamBytes)/res.vmTotalRamBytes)*100:0);
  $('disk-value').textContent=res?bytes(res.diskAvailableBytes):'—';$('disk-hint').textContent=res?.diskTotalBytes?bytes(res.diskTotalBytes)+' total':'Free space for your worlds';meter('disk-meter',res?.diskTotalBytes&&res.diskAvailableBytes!=null?res.diskAvailableBytes/res.diskTotalBytes*100:0);
  $('uptime-value').textContent=uptime(snap?.uptimeMillis);$('process-cpu').textContent=percent(res?.processCpuRatio);$('process-memory').textContent=res?.processResidentMemoryBytes!=null?bytes(res.processResidentMemoryBytes):'Unavailable';
  document.querySelector('.overview-grid').classList.toggle('stale-metrics',data.stale);
  const note=$('health-note');note.hidden=!data.stale&&data.service.state!=='unknown';
  note.textContent=data.stale?(data.status==='Offline'?'Minecraft is offline. Cards show the last reported readings.':'No fresh snapshot in the last 30 seconds. Cards show the last reported readings.'):'Telemetry is current. Systemd status is unavailable on this host.';
  document.querySelectorAll('[data-control]').forEach(button=>{button.disabled=data.controlBusy||!data.controlsAvailable;button.title=!data.controlsAvailable?'Server controls require the configured Debian systemd service':'';});
  renderActivity($('recent-activity'),data.activity);
}
async function refresh(){if(polling||!signedIn||document.hidden)return;polling=true;try{renderDashboard(await api('dashboard'));$('poll-status').textContent='Updates every 5 seconds';if(location.hash==='#activity')await loadActivity();}catch(error){if(signedIn){announce('Could not refresh. '+error.message,'warning');$('poll-status').textContent='Connection lost · showing last readings';}}finally{polling=false;}}
async function loadActivity(){const filter=$('activity-filter').value;renderActivity($('activity-list'),await api('activity'+(filter?'?kind='+encodeURIComponent(filter):'')));}
const toggles=[['joins','Player joins','Know when someone starts playing.'],['leaves','Player leaves','An optional update when someone logs off.'],['telemetry','Missing telemetry','One alert per incident, plus recovery.'],['performance','Sustained performance issues','TPS or tick time outside your limits.'],['disk','Low disk space','Keep enough room for your worlds.']];
async function loadSettings(){
  settings=await api('settings');$('preference-toggles').replaceChildren();for(const[name,title,detail]of toggles){const label=element('label','toggle-row'),text=element('span'),input=element('input');input.type='checkbox';input.name=name;input.checked=settings.preferences[name];text.append(element('strong','',title),element('small','',detail));label.append(text,input);$('preference-toggles').append(label);}
  for(const name of ['tpsBelow','msptAbove','performanceSeconds','diskPercentBelow','diskGiBBelow','diskSeconds'])$('preferences-form').elements[name].value=settings.preferences[name];
  $('devices-list').replaceChildren();for(const device of settings.devices){const row=element('div','device-row'),content=element('div'),button=element('button','','Revoke');content.append(element('strong','',device.name),element('span','','Added '+relative(device.created)));button.addEventListener('click',async()=>{try{await api('subscriptions/'+device.id,{method:'DELETE',body:{}});await loadSettings();announce('Device revoked.');}catch(error){announce(error.message,'danger');}});row.append(content,button);$('devices-list').append(row);}if(!settings.devices.length)$('devices-list').append(element('p','small muted','No devices registered yet.'));
  const supported='serviceWorker'in navigator&&'PushManager'in window&&'Notification'in window;
  const iPhone=/iPhone|iPad|iPod/.test(navigator.userAgent),standalone=navigator.standalone||matchMedia('(display-mode: standalone)').matches;
  $('enable-push').disabled=!supported||(iPhone&&!standalone);$('test-push').disabled=!settings.devices.length;
  $('push-help').textContent=!supported?'Web Push is unavailable in this browser. On iPhone, install from Safari to the Home Screen first.':iPhone&&!standalone?'Add this app to your Home Screen, open it from there, then enable notifications.':'Tap Enable notifications to register this device. You can revoke any device below.';
}
async function navigate(){if(!signedIn)return;const view=['overview','activity','settings'].includes(location.hash.slice(1))?location.hash.slice(1):'overview';for(const name of ['overview','activity','settings'])$(name+'-view').hidden=name!==view;document.querySelectorAll('[data-nav]').forEach(node=>{node.classList.toggle('active',node.dataset.nav===view);if(node.dataset.nav===view)node.setAttribute('aria-current','page');else node.removeAttribute('aria-current');});try{if(view==='activity')await loadActivity();if(view==='settings')await loadSettings();}catch(error){announce(error.message,'danger');}}
$('login-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button[type=submit]');button.disabled=true;$('login-error').hidden=true;try{const data=Object.fromEntries(new FormData(form));const result=await api('login',{method:'POST',body:data});csrf=result.csrf;form.reset();showApp();await refresh();}catch(error){$('login-error').textContent=error.message;$('login-error').hidden=false;}finally{button.disabled=false;}});
$('logout').addEventListener('click',async()=>{try{await api('logout',{method:'POST',body:{}});showLogin();}catch(error){announce(error.message,'danger');}});
$('activity-filter').addEventListener('change',()=>loadActivity().catch(error=>announce(error.message,'danger')));
$('all-players').addEventListener('click',()=>$('players-dialog').showModal());
for(const button of document.querySelectorAll('.close-dialog'))button.addEventListener('click',()=>button.closest('dialog').close());
for(const button of document.querySelectorAll('[data-control]'))button.addEventListener('click',()=>{pendingAction=button.dataset.control;$('control-title').textContent=pendingAction[0].toUpperCase()+pendingAction.slice(1)+' server?';$('control-description').textContent=pendingAction==='start'?'Start Minecraft and wait for fresh telemetry.':'Online players will be disconnected. The server will save the world before '+(pendingAction==='restart'?'restarting.':'stopping.');$('confirm-control').textContent=pendingAction[0].toUpperCase()+pendingAction.slice(1)+' server';$('control-dialog').showModal();});
$('confirm-control').addEventListener('click',async()=>{const action=pendingAction;$('control-dialog').close();document.querySelectorAll('[data-control]').forEach(button=>button.disabled=true);announce('Server '+action+' in progress…');try{await api('controls',{method:'POST',body:{action,confirmed:true}});announce('Server '+action+' completed.');}catch(error){announce(error.message,'danger');}finally{await refresh();}});
$('preferences-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,body={};for(const[name]of toggles)body[name]=form.elements[name].checked;for(const name of ['tpsBelow','msptAbove','performanceSeconds','diskPercentBelow','diskGiBBelow','diskSeconds'])body[name]=Number(form.elements[name].value);try{await api('preferences',{method:'PUT',body});announce('Preferences saved.');}catch(error){announce(error.message,'danger');}});
function urlBytes(base64){const raw=atob(base64.replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(raw,char=>char.charCodeAt(0));}
$('enable-push').addEventListener('click',async()=>{const button=$('enable-push');button.disabled=true;try{const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error('Notification permission was not granted. You can change it in browser settings.');const registration=await navigator.serviceWorker.ready;const subscription=await registration.pushManager.getSubscription()||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlBytes(settings.vapidPublicKey)});const name=/iPhone/.test(navigator.userAgent)?'iPhone':/Mac/.test(navigator.userAgent)?'Mac browser':'Browser device';await api('subscriptions',{method:'POST',body:{subscription:subscription.toJSON(),name}});announce('Notifications enabled for this device.');await loadSettings();}catch(error){announce(error.message,'danger');}finally{button.disabled=false;}});
$('test-push').addEventListener('click',async()=>{try{await api('notifications/test',{method:'POST',body:{}});announce('Test notification queued for your registered devices.');}catch(error){announce(error.message,'danger');}});
$('theme').value=localStorage.getItem('mc-theme')||'system';
function applyTheme(){const value=$('theme').value,dark=value==='dark'||(value==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=dark?'dark':'light';document.querySelector('meta[name="theme-color"]').content=dark?'#111214':'#fcfcfc';}
$('theme').addEventListener('change',()=>{localStorage.setItem('mc-theme',$('theme').value);applyTheme();});matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyTheme);
window.addEventListener('hashchange',navigate);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
(async()=>{try{const session=await api('session');csrf=session.csrf;showApp();await refresh();}catch{showLogin();}})();
setInterval(refresh,5000);
