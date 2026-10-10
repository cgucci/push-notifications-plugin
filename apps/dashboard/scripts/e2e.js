import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdirSync,existsSync,readdirSync,writeFileSync,copyFileSync,cpSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { authenticator } from 'otplib';
import { fixture,snapshot,subscription } from '../test/helpers.js';
let offset=0;
const f=await fixture({appOptions:{now:()=>Date.now()+offset}});
await f.listen();f.config.origin='http://127.0.0.1:'+f.web.server.address().port;
const artifacts=resolve('artifacts');mkdirSync(artifacts,{recursive:true});
const cache=resolve(homedir(),'Library/Caches/ms-playwright');
const executable=chromium.executablePath();
const fallback=existsSync(cache)?readdirSync(cache).filter(name=>name.startsWith('chromium-')).sort().reverse().map(name=>resolve(cache,name,'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')).find(existsSync)||readdirSync(cache).filter(name=>name.startsWith('chromium-')).sort().reverse().map(name=>resolve(cache,name,'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')).find(existsSync):null;
const browser=await chromium.launch({headless:true,...(!existsSync(executable)&&fallback?{executablePath:fallback}:{})});
let paper=null;
const report={checks:[]};
try{
 const players=Array.from({length:8},(_,index)=>({name:['Connor','TelemetryTest','Alex','Steve','WorldBuilder','RedstoneFan','Miner','Explorer'][index],uuid:randomUUID()}));
 const base=snapshot(Date.now(),{players});await f.postTelemetry(base);await f.monitor();
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));await page.route('https://mc-heads.net/**',route=>route.abort());
 await page.goto(f.config.origin);await page.getByRole('heading',{name:'Welcome back.'}).waitFor();
 await page.getByLabel('Username',{exact:true}).fill('connor');await page.getByLabel('Password',{exact:true}).fill(f.password);await page.getByLabel('Authenticator code').fill(authenticator.generate(f.secret));await page.getByRole('button',{name:'Sign in',exact:false}).click();
 await page.locator('#status').filter({hasText:'Online'}).waitFor();assert.equal(await page.locator('#online-count').textContent(),'8 ONLINE');
 await page.getByRole('button',{name:'View everyone',exact:false}).click();assert.equal(await page.locator('#players-list .player').count(),8);await page.getByRole('button',{name:'Close player list'}).click();report.checks.push('Real browser password/TOTP login and full player modal');
 for(const width of [320,390,768,1280])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.getByLabel('Appearance').selectOption(theme);
  for(const view of ['overview','activity','settings']){
   await page.getByRole('link',{name:new RegExp('^'+view+'$','i')}).click();await page.locator('#'+view+'-view').waitFor();
   if(view==='settings')await page.locator('input[name="joins"]').waitFor();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${view} overflows at ${width}/${theme}`);
   await page.screenshot({path:resolve(artifacts,`${view}-${width}-${theme}.png`),fullPage:true});
  }
 }
 report.checks.push('All three views at 320/390/768/1280px in light and dark, without horizontal overflow');
 await page.getByRole('link',{name:/^settings$/i}).click();await page.locator('input[name="leaves"]').check();await page.getByRole('button',{name:'Save preferences'}).click();await page.locator('#message').filter({hasText:'Preferences saved'}).waitFor();assert.equal(f.store.preferences().leaves,true);
 await page.reload();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');await page.getByRole('link',{name:/^overview$/i}).click();
 await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByRole('button',{name:'Cancel',exact:true}).click();assert.equal(f.operations.length,0);
 await page.getByRole('button',{name:'Restart',exact:true}).click();await page.getByRole('button',{name:'Restart server',exact:true}).click();await page.locator('#message').filter({hasText:'completed'}).waitFor();assert.deepEqual(f.operations,['restart']);report.checks.push('Saved preferences, remembered dark mode, cancel and confirmed control actions');
 const cached=await page.evaluate(async()=>{await navigator.serviceWorker.ready;const keys=await caches.keys();return(await Promise.all(keys.map(async key=>(await(await caches.open(key)).keys()).map(req=>new URL(req.url).pathname)))).flat();});assert.ok(!cached.some(path=>path.startsWith('/api/')||path==='/'));report.checks.push('Service worker never caches API responses or private HTML');
 offset=31000;await f.monitor();await page.reload();await page.locator('#status').filter({hasText:'Unresponsive'}).waitFor();offset=0;await f.postTelemetry({...base,id:randomUUID(),sequence:2,capturedAt:new Date().toISOString()});await f.monitor();await page.reload();await page.locator('#status').filter({hasText:'Online'}).waitFor();report.checks.push('Browser stale status and recovery');
 assert.deepEqual(errors,[]);await context.close();
 // Run the actual plugin against the actual intake listener and the bundled real-player client.
 const original=process.env.MC_SERVER_DIR||resolve(homedir(),'Projects/mc server'),server=resolve(artifacts,'paper');mkdirSync(server,{recursive:true});
 for(const file of ['server.jar','eula.txt'])copyFileSync(resolve(original,file),resolve(server,file));for(const dir of ['libraries','versions','cache'])cpSync(resolve(original,dir),resolve(server,dir),{recursive:true});
 const plugin=resolve('../../plugins/server-dashboard/build/libs/Server Dashboard-1.0-SNAPSHOT.jar');assert.ok(existsSync(plugin),'Build plugin first');mkdirSync(resolve(server,'plugins/ServerDashboard'),{recursive:true});copyFileSync(plugin,resolve(server,'plugins/Server Dashboard-1.0-SNAPSHOT.jar'));
 const gamePort=25579;
 writeFileSync(resolve(server,'server.properties'),`server-ip=127.0.0.1\nserver-port=${gamePort}\nonline-mode=false\nwhite-list=false\nenforce-whitelist=false\nlevel-name=e2e-world\nview-distance=2\nsimulation-distance=2\n`);
 writeFileSync(resolve(server,'plugins/ServerDashboard/config.yml'),`endpoint: 'http://127.0.0.1:${f.intake.server.address().port}/ingest'\nshared-secret: '${f.config.ingestSecret}'\nserver-id: 'minecraft'\ndisk-path: '.'\n`,{mode:0o600});
 const chunks=[];paper=spawn('java',['-Xms512M','-Xmx1G','-jar','server.jar','--nogui'],{cwd:server,stdio:['pipe','pipe','pipe']});paper.stdout.on('data',chunk=>chunks.push(chunk));paper.stderr.on('data',chunk=>chunks.push(chunk));
 async function wait(predicate,timeout=120000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(predicate())return;if(paper.exitCode!==null)throw new Error('Paper exited');await new Promise(r=>setTimeout(r,200));}throw new Error('Timed out waiting for real Paper telemetry');}
 await wait(()=>f.store.get('snapshot')?.instanceId!==base.instanceId);console.log('Real Paper plugin is delivering snapshots to the dashboard');
 // Register a local test subscription; outbound vendor delivery is captured by the fixture.
 f.store.db.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?)').run(randomUUID(),subscription().endpoint,JSON.stringify(subscription()),'E2E test device',Date.now());
 const client=spawn('python3',[resolve('../../plugins/server-dashboard/tools/paper-test-client.py'),String(gamePort)],{stdio:['ignore','pipe','pipe']});const clientChunks=[];client.stdout.on('data',c=>clientChunks.push(c));client.stderr.on('data',c=>clientChunks.push(c));
 await wait(()=>f.store.get('players',[]).some(p=>p.name==='TelemetryTest'),45000);await f.alerts.drain(Date.now());assert.equal(f.pushes.filter(push=>push.payload.title==='TelemetryTest joined').length,1);
 const livePage=await browser.newPage({viewport:{width:390,height:844}});await livePage.route('https://mc-heads.net/**',r=>r.abort());offset=0;
 // Browser login is a fresh TOTP counter; wait only if still in the consumed interval.
 const loginTime=Math.ceil(Date.now()/30000)*30000+100;const delay=loginTime-Date.now();if(delay>0&&delay<30000)await new Promise(r=>setTimeout(r,delay));
 await livePage.goto(f.config.origin);await livePage.getByLabel('Username',{exact:true}).fill('connor');await livePage.getByLabel('Password',{exact:true}).fill(f.password);await livePage.getByLabel('Authenticator code').fill(authenticator.generate(f.secret));await livePage.getByRole('button',{name:'Sign in',exact:false}).click();await livePage.locator('#status').filter({hasText:'Online'}).waitFor();await livePage.screenshot({path:resolve(artifacts,'real-paper-mobile.png'),fullPage:true});
 await wait(()=>!f.store.get('players',[]).some(p=>p.name==='TelemetryTest'),45000);await f.alerts.drain(Date.now());assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM activity WHERE kind='join' AND title='TelemetryTest joined'").get().n,1);assert.equal(f.store.db.prepare("SELECT count(*) AS n FROM activity WHERE kind='leave' AND title='TelemetryTest left'").get().n,1);
 writeFileSync(resolve(artifacts,'client.log'),Buffer.concat(clientChunks));report.checks.push('Actual Paper plugin → authenticated ingestion → SQLite → real browser, real join/leave, one captured push while browser is closed');
 paper.stdin.write('stop\n');await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Paper stop timeout')),45000);paper.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(new Error('Paper exited '+code));});});writeFileSync(resolve(artifacts,'paper.log'),Buffer.concat(chunks));assert.ok(Buffer.concat(chunks).toString().includes('Saving worlds'));report.checks.push('Real Paper graceful world-saving shutdown');
 await livePage.getByRole('button',{name:'Sign out'}).click();await livePage.getByRole('heading',{name:'Welcome back.'}).waitFor();assert.equal(await livePage.evaluate(async()=>fetch('/api/dashboard').then(r=>r.status)),401);report.checks.push('Browser logout removes access');
 report.passed=true;writeFileSync(resolve(artifacts,'e2e-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{if(paper&&paper.exitCode===null){paper.stdin.write('stop\n');await new Promise(resolve=>{const timer=setTimeout(()=>{paper.kill('SIGTERM');resolve();},45000);paper.once('exit',()=>{clearTimeout(timer);resolve();});});}await browser.close();await f.close();}
