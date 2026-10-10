import webpush from 'web-push';
import { randomUUID } from 'node:crypto';
export function createAlerts(store, config, send = webpush.sendNotification.bind(webpush)) {
  let sending = false;
  return {
    enqueue(id, kind, title, body, preference, now = Date.now()) {
      if (preference !== 'test' && !store.preferences()[preference]) return;
      const payload = JSON.stringify({ id, kind, title, body, url: '/', at: now });
      for (const sub of store.db.prepare('SELECT id FROM subscriptions').all()) {
        store.db.prepare('INSERT OR IGNORE INTO deliveries(id,subscription,payload,due,expires) VALUES(?,?,?,?,?)').run(`${id}:${sub.id}`, sub.id, payload, now, now + 120000);
      }
    },
    async drain(now = Date.now()) {
      if (sending) return;
      sending = true;
      try {
        store.db.prepare('DELETE FROM deliveries WHERE expires<=?').run(now);
        const rows = store.db.prepare('SELECT d.*,s.payload AS subscription_payload FROM deliveries d JOIN subscriptions s ON s.id=d.subscription WHERE d.due<=? ORDER BY d.due LIMIT 20').all(now);
        for (const row of rows) {
          try {
            await send(JSON.parse(row.subscription_payload), row.payload, { TTL: Math.max(1, Math.floor((row.expires - now) / 1000)), timeout: 5000, vapidDetails: { subject: config.vapid.subject, publicKey: config.vapid.publicKey, privateKey: config.vapid.privateKey } });
            store.db.prepare('DELETE FROM deliveries WHERE id=?').run(row.id);
          } catch (error) {
            if ([404,410].includes(error.statusCode)) store.db.prepare('DELETE FROM subscriptions WHERE id=?').run(row.subscription);
            else if (row.attempts >= 2 || (error.statusCode >= 400 && error.statusCode < 500 && ![408,429].includes(error.statusCode))) store.db.prepare('DELETE FROM deliveries WHERE id=?').run(row.id);
            else store.db.prepare('UPDATE deliveries SET attempts=attempts+1,due=? WHERE id=?').run(now + (row.attempts + 1) * 10000, row.id);
          }
        }
      } finally { sending = false; }
    }
  };
}
export function evaluateHealth(store, alerts, service, now = Date.now(), startedAt = now) {
  const snapshot = store.get('snapshot'), prefs = store.preferences();
  const stale = !snapshot || now - Date.parse(snapshot.capturedAt) > 30000;
  store.set('service', { ...service, checkedAt: now });
  const conditions = [
    ['telemetry', stale && now - (snapshot ? Date.parse(snapshot.capturedAt) : startedAt) > 30000, 0, 'Telemetry missing', service.state === 'active' ? 'Minecraft is running without fresh telemetry.' : `Minecraft service is ${service.state}.`, 'telemetry'],
    ['performance', !stale && (snapshot.tps[0] < prefs.tpsBelow || snapshot.mspt > prefs.msptAbove), prefs.performanceSeconds * 1000, 'Minecraft performance degraded', 'TPS or MSPT stayed outside your configured limits.', 'performance'],
    ['disk', !stale && snapshot.resources.diskAvailableBytes !== null && (snapshot.resources.diskAvailableBytes < prefs.diskGiBBelow * 1073741824 || (snapshot.resources.diskTotalBytes > 0 && snapshot.resources.diskAvailableBytes / snapshot.resources.diskTotalBytes * 100 < prefs.diskPercentBelow)), prefs.diskSeconds * 1000, 'Minecraft disk space low', 'Available disk space stayed below your configured limit.', 'disk']
  ];
  for (const [kind, bad, duration, title, detail, preference] of conditions) {
    if (stale && kind !== 'telemetry') {
      store.db.prepare('DELETE FROM pending_health WHERE kind=?').run(kind);
      continue;
    }
    const existing = store.db.prepare('SELECT * FROM incidents WHERE kind=?').get(kind);
    if (bad) {
      let pending = store.db.prepare('SELECT * FROM pending_health WHERE kind=?').get(kind);
      if (!pending) { store.db.prepare('INSERT INTO pending_health VALUES(?,?)').run(kind, now); pending = { since: now }; }
      if (!existing && now - pending.since >= duration) {
        store.transaction(() => {
          store.db.prepare('INSERT INTO incidents VALUES(?,?,1)').run(kind, pending.since);
          const id = randomUUID();
          store.activity(id, now, 'health', title, detail);
          alerts.enqueue(id, kind, title, detail, preference, now);
        });
      }
    } else if (kind === 'telemetry' || !stale) {
      store.db.prepare('DELETE FROM pending_health WHERE kind=?').run(kind);
      if (existing) store.transaction(() => {
        store.db.prepare('DELETE FROM incidents WHERE kind=?').run(kind);
        const id = randomUUID(), title = kind === 'telemetry' ? 'Telemetry recovered' : kind === 'disk' ? 'Disk space recovered' : 'Minecraft performance recovered';
        store.activity(id, now, 'recovery', title, 'Fresh readings are within the configured limits.');
        alerts.enqueue(id, 'recovery', title, 'Fresh readings are within the configured limits.', preference, now);
      });
    }
  }
  return { stale, status: ['inactive','failed','deactivating'].includes(service.state) ? 'Offline' : stale ? 'Unresponsive' : 'Online' };
}
