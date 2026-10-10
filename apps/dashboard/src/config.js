import { readFileSync, mkdirSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
export function loadConfig(path = process.env.MC_ADMIN_CONFIG || './config.json') {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const origin = new URL(raw.origin);
  const development = raw.development === true;
  if ((!development && origin.protocol !== 'https:') || (development && !['localhost','127.0.0.1','[::1]'].includes(origin.hostname))) throw new Error('Production requires HTTPS; development is loopback-only');
  if (!/^[A-Za-z0-9_-]{32,}$/.test(raw.ingestSecret || '')) throw new Error('Set the plugin shared secret');
  if (Buffer.from(raw.masterKey || '', 'base64').length !== 32) throw new Error('masterKey must be a base64 32-byte key');
  const config = { name: 'Minecraft', webPort: 8787, ingestPort: 8788, unit: 'minecraft.service', helper: '/usr/local/libexec/minecraft-control', dataPath: './data/admin.sqlite', ...raw, development, origin: origin.origin };
  if (!/^[a-zA-Z0-9_.@-]+\.service$/.test(config.unit)) throw new Error('Invalid unit');
  config.dataPath = resolve(config.dataPath);
  mkdirSync(dirname(config.dataPath), { recursive: true, mode: 0o700 });
  chmodSync(dirname(config.dataPath), 0o700);
  return config;
}
