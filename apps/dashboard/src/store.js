import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';
export const defaults = { joins: true, leaves: false, telemetry: true, performance: true, disk: true, tpsBelow: 18, msptAbove: 50, performanceSeconds: 120, diskPercentBelow: 10, diskGiBBelow: 5, diskSeconds: 300 };
export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS admin(id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, password TEXT NOT NULL, totp TEXT NOT NULL, last_counter INTEGER NOT NULL DEFAULT -1);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, csrf TEXT NOT NULL, created INTEGER NOT NULL, seen INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS attempts(scope TEXT NOT NULL, at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS attempts_scope ON attempts(scope,at);
    CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS telemetry(id TEXT PRIMARY KEY, instance TEXT NOT NULL, sequence INTEGER NOT NULL, captured INTEGER NOT NULL, received INTEGER NOT NULL, type TEXT NOT NULL, payload TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS telemetry_received ON telemetry(received);
    CREATE TABLE IF NOT EXISTS activity(id TEXT PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS subscriptions(id TEXT PRIMARY KEY, endpoint TEXT UNIQUE NOT NULL, payload TEXT NOT NULL, name TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS deliveries(id TEXT PRIMARY KEY, subscription TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE, payload TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS incidents(kind TEXT PRIMARY KEY, since INTEGER NOT NULL, alerted INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS pending_health(kind TEXT PRIMARY KEY, since INTEGER NOT NULL);`);
  if (path !== ':memory:') chmodSync(path, 0o600);
  const store = {
    db,
    get(key, fallback = null) { const row = db.prepare('SELECT value FROM state WHERE key=?').get(key); return row ? JSON.parse(row.value) : fallback; },
    set(key, value) { db.prepare('INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); },
    transaction(fn) { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } },
    activity(id, at, kind, title, detail = '') { db.prepare('INSERT OR IGNORE INTO activity VALUES(?,?,?,?,?)').run(id, at, kind, title, detail); },
    preferences() { return { ...defaults, ...store.get('preferences', {}) }; },
    prune(now) {
      db.prepare('DELETE FROM sessions WHERE expires<? OR seen<?').run(now, now - 86400000);
      db.prepare('DELETE FROM attempts WHERE at<?').run(now - 3600000);
      db.prepare('DELETE FROM deliveries WHERE expires<?').run(now);
      db.prepare('DELETE FROM telemetry WHERE received<?').run(now - 7 * 86400000);
      db.prepare('DELETE FROM activity WHERE at<?').run(now - 90 * 86400000);
    }
  };
  return store;
}
