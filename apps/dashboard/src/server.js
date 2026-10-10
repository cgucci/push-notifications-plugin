import { loadConfig } from './config.js';
import { openStore } from './store.js';
import { createApp } from './app.js';
const config=loadConfig(),store=openStore(config.dataPath),app=await createApp(config,store,{logger:true});
await app.listen();
console.log(`Minecraft Admin: ${config.origin} (loopback ${config.webPort}; ingestion ${config.ingestPort})`);
let closing=false;
async function shutdown(){if(closing)return;closing=true;await app.close();store.db.close();}
process.on('SIGTERM',()=>shutdown().then(()=>process.exit(0)));
process.on('SIGINT',()=>shutdown().then(()=>process.exit(0)));
