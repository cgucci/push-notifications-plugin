# Minecraft Admin — Simple EDD

**Goal:** A private dashboard at https://mc.cgooch.org, installed on Connor’s iPhone as a web app, with player and server-health notifications.

## 1. Architecture

Everything runs inside the existing Debian VM:

| Part | Job |
|---|---|
| Paper plugin | Collect game/resource stats and POST updates to the local service |
| Node.js + Fastify service | Store updates in SQLite, serve the dashboard, handle login and Web Push |
| Caddy | Provide HTTPS and forward web requests to the service |

Use a simple mobile-friendly HTML/CSS/JavaScript frontend with an app manifest and service worker. The dashboard polls the service every five seconds while open. No separate metrics agent or frontend framework is needed.

## 2. Plugin

Send immediate join/leave events and a complete snapshot every ten seconds:
- Online player names and UUIDs; TPS/MSPT; server uptime.
- Java process CPU, JVM heap used/max, VM CPU and total/free RAM, and available disk space.

Resource stats describe the Debian VM, not the whole Proxmox host. Label heap usage separately from total process memory.

POST to a loopback-only ingestion listener using a shared secret. Capture game state on the proper server thread; send HTTP asynchronously with timeouts and bounded retries. Give events stable IDs to prevent duplicates; snapshots correct missed player updates. Monitoring failures must not affect gameplay.

## 3. Dashboard and controls

Show online players, join/leave history, performance/resource cards, last-update time, notification settings, and start/stop/restart buttons.

After thirty seconds without a snapshot, mark telemetry stale. Independently check the Minecraft systemd service to distinguish stopped/failed from running but unresponsive. Send one alert per incident and a recovery notice when updates resume.

Run the dashboard service independently of Paper. Allow it only fixed start/stop/restart operations on the Minecraft unit through a restricted helper; confirm disruptive actions and record them. Ensure stopping saves the world gracefully. No arbitrary shell or console commands.

## 4. Access and notifications

One locally provisioned admin account; no signup. Use a password hashed with Argon2id plus authenticator-app verification. Protect every data/control endpoint with server-side sessions, secure cookies, login throttling, and CSRF checks. Never cache private API responses.

Keep mc.cgooch.org DNS only. Forward TCP 80/443 to Caddy; Minecraft continues using TCP 25565. Expose neither backend listeners nor Proxmox.

Use standard Web Push with VAPID keys. On iPhone, add the dashboard to the Home Screen, log in, and tap Enable notifications (iOS 16.4+). Only authenticated admins may register devices; support revocation.

Default alerts: joins, missing telemetry, and sustained performance/disk problems. Leaves are optional. Store subscriptions/preferences in SQLite; retry push briefly and expire old alerts. Push delivery uses browser-vendor infrastructure; alerts during a total VM/home outage require an external monitor.

## 5. Build and verify

Build in order: plugin + dashboard → login/HTTPS → push → restricted controls. Enable public port forwarding only after authentication is verified.

Verify anonymous users cannot read data, subscribe, or act; joins produce one push with the app closed; missed updates show stale status; graceful restart and VM reboot work.

**Summary:** One plugin gathers the data. One local service turns it into a protected phone dashboard and notifications. Caddy handles HTTPS.

## References

- [Java OS metrics](https://docs.oracle.com/en/java/javase/21/docs/api/jdk.management/com/sun/management/OperatingSystemMXBean.html)
- [iPhone Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [Caddy HTTPS](https://caddyserver.com/docs/quick-starts/https)
- [OWASP sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)

