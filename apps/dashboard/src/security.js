import { randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import argon2 from 'argon2';
import { authenticator } from 'otplib';
export const randomToken = () => randomBytes(32).toString('base64url');
export const digest = value => createHash('sha256').update(value).digest('hex');
export function equal(a, b) { const left = Buffer.from(a || ''), right = Buffer.from(b || ''); return left.length === right.length && timingSafeEqual(left, right); }
export function encrypt(text, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(key, 'base64'), iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
}
export function decrypt(text, key) {
  const data = Buffer.from(text, 'base64'), cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'base64'), data.subarray(0,12));
  cipher.setAuthTag(data.subarray(12,28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString();
}
export async function provision(store, username, password, secret, masterKey) {
  if (store.db.prepare('SELECT id FROM admin').get()) throw new Error('Admin already exists');
  if (password.length < 10 || password.length > 256) throw new Error('Password must be 10–256 characters');
  const hash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 3, parallelism: 1 });
  store.db.prepare('INSERT INTO admin(id,username,password,totp) VALUES(1,?,?,?)').run(username, hash, encrypt(secret, masterKey));
}
export async function authenticate(store, config, username, password, code, ip, now = Date.now()) {
  const scopes = ['ip:' + ip, 'account'];
  for (const scope of scopes) {
    const count = store.db.prepare('SELECT count(*) AS n FROM attempts WHERE scope=? AND at>?').get(scope, now - 900000).n;
    if (count >= (scope === 'account' ? 20 : 5)) return { throttled: true };
  }
  for (const scope of scopes) store.db.prepare('INSERT INTO attempts VALUES(?,?)').run(scope, now);
  const admin = store.db.prepare('SELECT * FROM admin WHERE id=1').get();
  if (!admin) return {};
  // Always perform the password check, including for the wrong username.
  const validPassword = await argon2.verify(admin.password, password);
  const otp = authenticator.clone();
  otp.options = { epoch: now, window: 1 };
  const delta = otp.checkDelta(code, decrypt(admin.totp, config.masterKey));
  if (!validPassword || username !== admin.username || delta === null) return {};
  const counter = Math.floor(now / 30000) + delta;
  const consumed = store.db.prepare('UPDATE admin SET last_counter=? WHERE id=1 AND last_counter<?').run(counter, counter);
  if (!consumed.changes) return {};
  const token = randomToken(), csrf = randomToken();
  store.db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(digest(token), csrf, now, now, now + 7 * 86400000);
  return { token, csrf };
}
