# Debian deployment

Run the dashboard independently of Minecraft. Do not enable public forwarding
until the access tests pass. No backend port, ingestion port, RCON, or Proxmox
service should be exposed publicly.

1. Install Node 24 LTS, Java 25 for Paper 26.3, Python 3, and Caddy. Create separate
   `mcadmin` and `minecraft` system users. Place this repo at `/opt/minecraft-admin`.
   Run `npm ci --prefix /opt/minecraft-admin/apps/dashboard`.
2. Create `/etc/minecraft-admin` (root-owned, 0750, group `mcadmin`) and
   `/var/lib/minecraft-admin` (owned by `mcadmin`, 0700). Run setup with
   `MC_ADMIN_CONFIG=/etc/minecraft-admin/config.json`, then set the file owner to
   `mcadmin` and mode 0600. Set `dataPath` to `/var/lib/minecraft-admin/admin.sqlite`
   and `origin` to `https://mc.cgooch.org`. Back up config and database together;
   config's master key decrypts the authenticator secret.
3. Configure the Paper plugin with the same `ingestSecret` as `shared-secret`,
   `http://127.0.0.1:8788/ingest`, and a stable `server-id`. Restrict its config
   to the Minecraft user. Synchronize the VM clock for TOTP and telemetry freshness.
4. Install `minecraft-control` root-owned/0755 at `/usr/local/libexec/`, and the
   exact sudoers rule root-owned/0440 in `/etc/sudoers.d/`. Run
   `visudo -cf /etc/sudoers.d/minecraft-admin`. The application user must not be
   able to edit the helper, Minecraft unit, runner, or sudoers file.
5. Inspect the existing Minecraft unit's shutdown behavior. If it already sends
   `stop` and waits for saves, retain it. Otherwise use the provided runner and
   example unit, updating only the server path and Java heap size. The runner
   receives SIGTERM, writes `stop` to Java stdin, and waits; `KillMode=mixed`
   avoids terminating Java before world saving. No console API is exposed.
6. Install and enable `minecraft-admin.service`. Install the Caddyfile. Both app
   listeners bind only to 127.0.0.1. Caddy forwards to the web listener only;
   `/ingest` does not exist there. DNS for `mc.cgooch.org` stays DNS-only.
7. Confirm login/2FA, anonymous rejection, CSRF, secure cookies, and controls on
   the target VM; then forward only TCP 80/443 to Caddy. Keep Minecraft on 25565.
8. On iPhone (iOS 16.4+), install from Safari to the Home Screen, log in, enable
   notifications, close the app, and join Minecraft to verify one push. Verify
   device revocation, stale alert/recovery, graceful restart, and VM reboot.

The web service resumes persisted sessions, subscriptions, preferences, pending
pushes, and incidents after a reboot. Historical telemetry never becomes fresh
just because the dashboard restarted. The service worker only caches public
assets and an offline message; it never caches private API responses.

Data retention: raw telemetry 7 days, activity 90 days. Sessions expire after
7 days absolute or 24 hours idle. Pushes expire after 2 minutes and retry at
most 3 times. One alert/recovery pair per health incident; thresholds are editable.
Total VM/home outages require an external monitor.
