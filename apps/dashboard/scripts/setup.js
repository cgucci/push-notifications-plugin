import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import webpush from 'web-push';
import { authenticator } from 'otplib';
import { loadConfig } from '../src/config.js';
import { openStore } from '../src/store.js';
import { provision } from '../src/security.js';
// JSON on stdin is supported for unattended provisioning. Secrets never enter argv.
let input;
if (!process.stdin.isTTY) {
  let raw='';for await(const chunk of process.stdin)raw+=chunk;if(!raw.trim())throw new Error('Provide provisioning JSON on stdin or use an interactive terminal');input=JSON.parse(raw);
} else {
  let muted=false;
  const output=new Writable({write(chunk,encoding,callback){if(!muted)process.stdout.write(chunk);callback();}});
  const reader=createInterface({input:process.stdin,output,terminal:true});
  const ask=async(prompt,hidden=false)=>{process.stdout.write(prompt);muted=hidden;const value=await reader.question('');muted=false;if(hidden)process.stdout.write('\n');return value;};
  input={username:(await ask('Admin username [connor]: '))||'connor',password:await ask('Password (at least 12 characters): ',true),ingestSecret:await ask('Plugin shared-secret (blank to generate): ',true),origin:(await ask('Public origin [https://mc.cgooch.org]: '))||'https://mc.cgooch.org'};
  input.totpSecret=authenticator.generateSecret();
  console.log('\nAdd this account to your authenticator app:\n'+authenticator.keyuri(input.username,'Minecraft Admin',input.totpSecret));
  const code=await ask('Verify authenticator code: ');
  reader.close();if(!authenticator.check(code,input.totpSecret))throw new Error('Authenticator verification failed');
}
const path=process.env.MC_ADMIN_CONFIG||'./config.json';
if(!existsSync(path)) {
  const keys=webpush.generateVAPIDKeys();
  writeFileSync(path,JSON.stringify({name:input.name||'Minecraft',origin:input.origin||'https://mc.cgooch.org',development:input.development===true,webPort:input.webPort||8787,ingestPort:input.ingestPort||8788,ingestSecret:input.ingestSecret||randomBytes(32).toString('base64url'),masterKey:randomBytes(32).toString('base64'),dataPath:input.dataPath||process.env.MC_ADMIN_DATA_PATH||'./data/admin.sqlite',unit:'minecraft.service',helper:'/usr/local/libexec/minecraft-control',vapid:{...keys,subject:input.vapidSubject||'mailto:admin@cgooch.org'}},null,2),{mode:0o600,flag:'wx'});
}
const config=loadConfig(path),store=openStore(config.dataPath);
try { await provision(store,input.username,input.password,input.totpSecret,config.masterKey);console.log('Admin provisioned. Configuration and database remain local.'); }
finally{store.db.close();}
