import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import statics from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { equal, digest, authenticate } from './security.js';
import { ingest } from './telemetry.js';
import { createAlerts, evaluateHealth } from './alerts.js';
import { systemdAdapter } from './systemd.js';
const preferencesSchema = z.object({ joins:z.boolean(), leaves:z.boolean(), telemetry:z.boolean(), performance:z.boolean(), disk:z.boolean(), tpsBelow:z.number().min(1).max(20), msptAbove:z.number().min(10).max(1000), performanceSeconds:z.number().int().min(30).max(3600), diskPercentBelow:z.number().min(1).max(90), diskGiBBelow:z.number().min(0).max(1000), diskSeconds:z.number().int().min(30).max(3600) }).strict();
const subscriptionSchema = z.object({ endpoint:z.url().max(2048), keys:z.object({ p256dh:z.string().regex(/^[A-Za-z0-9_-]+$/), auth:z.string().regex(/^[A-Za-z0-9_-]+$/) }).strict() }).strict();
function validateSubscription(body) {
  const subscription = subscriptionSchema.parse(body), url = new URL(subscription.endpoint);
  const allowed = url.hostname === 'fcm.googleapis.com' || url.hostname === 'updates.push.services.mozilla.com' || url.hostname.endsWith('.push.apple.com') || url.hostname.endsWith('.notify.windows.com');
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) throw Object.assign(new Error('Unsupported push endpoint'), {statusCode:400});
  const key = Buffer.from(subscription.keys.p256dh,'base64url');
  if (key.length !== 65 || key[0] !== 4 || Buffer.from(subscription.keys.auth,'base64url').length !== 16) throw Object.assign(new Error('Invalid push keys'),{statusCode:400});
  return subscription;
}
export async function createApp(config, store, options = {}) {
  const web = Fastify({ logger: options.logger ?? false, bodyLimit: 16384, trustProxy: config.development ? false : ['127.0.0.1','::1'] });
  const intake = Fastify({ logger: false, bodyLimit: 512000 });
  const service = options.service || systemdAdapter(config), alerts = createAlerts(store, config, options.sendPush);
  const now = options.now || Date.now, startedAt = now();
  let monitoring = false, controlBusy = false;
  const cookieName = config.development ? 'mc_session' : '__Host-mc_session';
  const cookieOptions = { path:'/', httpOnly:true, secure:!config.development, sameSite:'strict', maxAge:7*86400 };
  await web.register(cookie);
  function fail(reply, code, message) { return reply.code(code).send({ error: message }); }
  web.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff').header('Referrer-Policy','same-origin')
      .header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' https://mc-heads.net; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
      .header('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    if (!request.url.startsWith('/api/')) return;
    if (!['GET','HEAD'].includes(request.method)) {
      if (request.headers.origin !== config.origin || request.headers['content-type']?.split(';')[0] !== 'application/json') return fail(reply,403,'Invalid request origin or content type');
    }
    if (request.url === '/api/login' && request.method === 'POST') return;
    const token = request.cookies[cookieName];
    const session = token && store.db.prepare('SELECT * FROM sessions WHERE token=?').get(digest(token));
    if (!session || session.expires <= now() || session.seen < now()-86400000) return fail(reply,401,'Please sign in');
    request.session = session;
    store.db.prepare('UPDATE sessions SET seen=? WHERE token=?').run(now(),session.token);
    if (!['GET','HEAD'].includes(request.method) && !equal(request.headers['x-csrf-token'], session.csrf)) return fail(reply,403,'Invalid security token');
  });
  web.setErrorHandler((error, request, reply) => { if (error instanceof z.ZodError || error.validation) return fail(reply,400,'Invalid request'); return fail(reply,error.statusCode || 500,error.statusCode && error.statusCode < 500 ? error.message : 'Request failed'); });
  intake.setErrorHandler((error,request,reply) => reply.code(error instanceof z.ZodError ? 400 : error.statusCode || 500).send({error:'Telemetry rejected'}));
  let authInFlight = 0;
  web.post('/api/login', async (request, reply) => {
    const body = z.object({username:z.string().min(1).max(64),password:z.string().min(1).max(256),code:z.string().regex(/^\d{6}$/)}).strict().parse(request.body);
    if (authInFlight >= 4) return fail(reply,429,'Try again shortly');
    authInFlight++;
    try {
      const result = await authenticate(store,config,body.username,body.password,body.code,request.ip,now());
      if (result.throttled) return fail(reply,429,'Too many attempts. Try again in 15 minutes.');
      if (!result.token) return fail(reply,401,'Username, password, or verification code is incorrect');
      reply.setCookie(cookieName,result.token,cookieOptions);
      return { csrf:result.csrf };
    } finally { authInFlight--; }
  });
  web.get('/api/session', async () => ({ name:config.name, csrf:null }));
  // Return the current session's CSRF token only to its authenticated browser.
  web.addHook('preSerialization', async (request,reply,payload) => { if (request.url === '/api/session' && reply.statusCode === 200) payload.csrf = request.session.csrf; return payload; });
  web.post('/api/logout', async (request,reply) => { store.db.prepare('DELETE FROM sessions WHERE token=?').run(request.session.token); reply.clearCookie(cookieName,cookieOptions); return {ok:true}; });
  web.get('/api/dashboard', async () => {
    const snapshot = store.get('snapshot'), unit = store.get('service',{state:'unknown',detail:'Checking service'});
    const stale = !snapshot || now()-Date.parse(snapshot.capturedAt)>30000;
    return { name:config.name, snapshot, players:store.get('players',[]), stale, status:['inactive','failed','deactivating'].includes(unit.state)?'Offline':stale?'Unresponsive':'Online', service:unit, incidents:store.db.prepare('SELECT kind,since FROM incidents').all(), activity:store.db.prepare('SELECT * FROM activity ORDER BY at DESC LIMIT 8').all(), controlBusy, controlsAvailable: unit.state !== 'unknown' };
  });
  web.get('/api/activity', async request => {
    const kind = ['join','leave','health','recovery','control'].includes(request.query.kind) ? request.query.kind : null;
    return kind ? store.db.prepare('SELECT * FROM activity WHERE kind=? ORDER BY at DESC LIMIT 200').all(kind) : store.db.prepare('SELECT * FROM activity ORDER BY at DESC LIMIT 200').all();
  });
  web.get('/api/settings', async () => ({ preferences:store.preferences(), vapidPublicKey:config.vapid.publicKey, devices:store.db.prepare('SELECT id,name,created FROM subscriptions ORDER BY created DESC').all() }));
  web.put('/api/preferences', async request => { const prefs=preferencesSchema.parse(request.body); store.set('preferences',prefs); return {ok:true}; });
  web.post('/api/subscriptions', async request => {
    const body=z.object({subscription:z.unknown(),name:z.string().min(1).max(80)}).strict().parse(request.body);
    const sub=validateSubscription(body.subscription);
    const existing=store.db.prepare('SELECT id FROM subscriptions WHERE endpoint=?').get(sub.endpoint);
    if (!existing && store.db.prepare('SELECT count(*) AS n FROM subscriptions').get().n>=20) throw Object.assign(new Error('Device limit reached'),{statusCode:400});
    const id=existing?.id||randomUUID();
    store.db.prepare('INSERT INTO subscriptions VALUES(?,?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET payload=excluded.payload,name=excluded.name').run(id,sub.endpoint,JSON.stringify(sub),body.name,now());
    return {id};
  });
  web.delete('/api/subscriptions/:id', async request => { store.db.prepare('DELETE FROM subscriptions WHERE id=?').run(request.params.id); return {ok:true}; });
  web.post('/api/notifications/test', async () => { alerts.enqueue(randomUUID(),'test',config.name,'Notifications are enabled for Minecraft Admin.','test',now()); return {ok:true}; });
  web.post('/api/controls', async (request,reply) => {
    const body=z.object({action:z.enum(['start','stop','restart']),confirmed:z.literal(true)}).strict().parse(request.body);
    if (controlBusy) return fail(reply,409,'A server operation is already in progress');
    controlBusy=true;
    const id=randomUUID();
    store.activity(id,now(),'control',`Server ${body.action} requested`,'Confirmed by admin');
    try {
      await service.control(body.action);
      store.activity(randomUUID(),now(),'control',`Server ${body.action} completed`,'Systemd operation completed');
      await monitor();
      return {ok:true};
    } catch { store.activity(randomUUID(),now(),'control',`Server ${body.action} failed`,'Check the Minecraft service logs'); return fail(reply,503,'Server operation failed. Check the service logs.'); }
    finally {controlBusy=false;}
  });
  intake.post('/ingest', async (request,reply) => {
    if (!equal(request.headers.authorization,'Bearer '+config.ingestSecret)) return reply.code(401).send({error:'Unauthorized'});
    if (request.headers['idempotency-key'] !== request.body?.id) return reply.code(400).send({error:'ID mismatch'});
    return ingest(store,request.body,alerts,now());
  });
  await web.register(statics,{root:fileURLToPath(new URL('../public/',import.meta.url)),index:'index.html',dotfiles:'deny'});
  web.setNotFoundHandler((request,reply) => reply.code(404).send({error:'Not found'}));
  async function monitor() {
    if (monitoring) return;
    monitoring=true;
    try { evaluateHealth(store,alerts,await service.status(),now(),startedAt); store.prune(now()); await alerts.drain(now()); }
    finally {monitoring=false;}
  }
  const timer=options.timers===false?null:setInterval(()=>monitor().catch(error=>web.log.error({message:error.message},'Health check failed')),5000);
  timer?.unref();
  web.addHook('onClose',async()=>{if(timer)clearInterval(timer);});
  return { web,intake,store,alerts,monitor,async listen(){await web.listen({host:'127.0.0.1',port:config.webPort});await intake.listen({host:'127.0.0.1',port:config.ingestPort});await monitor();},async close(){await Promise.all([web.close(),intake.close()]);} };
}
