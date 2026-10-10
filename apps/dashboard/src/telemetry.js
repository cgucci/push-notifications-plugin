import { z } from 'zod';
const finite = z.number().finite().nonnegative();
const nullable = finite.nullable();
const player = z.object({ name: z.string().min(1).max(32), uuid: z.uuid() }).strict();
const envelope = { schemaVersion: z.literal(1), id: z.uuid(), serverId: z.string().min(1).max(128), instanceId: z.uuid(), sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), capturedAt: z.iso.datetime() };
const resources = z.object({ capturedAt: z.iso.datetime(), scope: z.literal('server-os'), os: z.string().max(100), availableProcessors: z.number().int().positive(), jvmHeapUsedBytes: finite, jvmHeapMaxBytes: nullable, jvmNonHeapUsedBytes: finite, processResidentMemoryBytes: nullable, processCpuRatio: z.number().min(0).max(1).nullable(), vmCpuRatio: z.number().min(0).max(1).nullable(), vmTotalRamBytes: nullable, vmFreeRamBytes: nullable, diskTotalBytes: nullable, diskAvailableBytes: nullable }).strict();
export const telemetrySchema = z.discriminatedUnion('type', [
  z.object({ ...envelope, type: z.literal('snapshot'), players: z.array(player).max(1000), tps: z.tuple([finite,finite,finite]), mspt: finite, uptimeMillis: finite, minecraftVersion: z.string().max(50), resources }).strict(),
  z.object({ ...envelope, type: z.enum(['player_join','player_leave']), player }).strict()
]);
export function ingest(store, body, alerts, now = Date.now()) {
  const payload = telemetrySchema.parse(body), captured = Date.parse(payload.capturedAt);
  if (captured > now + 5000 || now - captured > (payload.type === 'snapshot' ? 30000 : 120000)) throw Object.assign(new Error('Expired telemetry'), { statusCode: 400 });
  return store.transaction(() => {
    const previous = store.db.prepare('SELECT payload FROM telemetry WHERE id=?').get(payload.id);
    const serialized = JSON.stringify(payload);
    if (previous) {
      if (previous.payload !== serialized) throw Object.assign(new Error('ID conflict'), { statusCode: 409 });
      return { duplicate: true };
    }
    if (store.get('serverId') && store.get('serverId') !== payload.serverId) throw Object.assign(new Error('Wrong server ID'), { statusCode: 409 });
    store.set('serverId', payload.serverId);
    store.db.prepare('INSERT INTO telemetry VALUES(?,?,?,?,?,?,?)').run(payload.id, payload.instanceId, payload.sequence, captured, now, payload.type, serialized);
    let current = store.get('instance');
    const retired = store.get('retiredInstances', []);
    if (!current || (current.id !== payload.instanceId && !retired.includes(payload.instanceId) && captured > current.captured)) {
      if (current) { retired.push(current.id); store.set('retiredInstances', retired.slice(-256)); }
      current = { id: payload.instanceId, sequence: 0, captured };
      store.set('players', []);
      store.set('snapshot', null);
    }
    const active = current?.id === payload.instanceId;
    if (active && payload.sequence > current.sequence) {
      store.set('players', payload.type === 'snapshot' ? payload.players : payload.type === 'player_join'
        ? [...store.get('players', []).filter(p => p.uuid !== payload.player.uuid), payload.player]
        : store.get('players', []).filter(p => p.uuid !== payload.player.uuid));
      current = { id: payload.instanceId, sequence: payload.sequence, captured: Math.max(current.captured, captured) };
      store.set('instance', current);
    }
    if (active && payload.type === 'snapshot') {
      const latest = store.get('snapshot');
      if (!latest || payload.sequence > latest.sequence) store.set('snapshot', payload);
    }
    if (payload.type !== 'snapshot') {
      const join = payload.type === 'player_join';
      store.activity(payload.id, captured, join ? 'join' : 'leave', `${payload.player.name} ${join ? 'joined' : 'left'}`, payload.player.uuid);
      if (active && now - captured < 60000) alerts.enqueue(payload.id, 'player', `${payload.player.name} ${join ? 'joined' : 'left'}`, 'Minecraft player activity', join ? 'joins' : 'leaves', now);
    }
    return { duplicate: false };
  });
}
