# Minecraft Admin

A private mobile dashboard for `mc.cgooch.org`, with a Paper telemetry plugin,
Fastify/SQLite service, authenticator login, Web Push, and restricted systemd controls.

## Monorepo

- `apps/dashboard/` — backend, vanilla HTML/CSS/JavaScript UI, PWA, tests, deployment files.
- `plugins/server-dashboard/` — Paper 26.3 plugin, Java 25, Gradle 9.7.1.
- `docs/` — the original product and UI specifications.

## Build and run

Requires Node 24+, Java 25, and Python 3 for the live Paper verification client.

```sh
npm ci --prefix apps/dashboard
npm run build:plugin
npm test
npm run setup
npm start
```

Setup provisions the single admin, encrypts the authenticator secret, generates
VAPID/master keys, and writes an ignored, mode-0600 configuration. Use the same
plugin secret on both sides. For local development, provisioning JSON on stdin
supports `development: true` and a loopback `origin`; production requires HTTPS.
No password or secret is accepted as a command-line argument.

The browser shows server name, Online/Offline/Unresponsive status, last update,
player heads/names and a full-player modal, TPS/MSPT/heap/VM CPU cards, and VM
RAM/disk/uptime. Activity and Settings contain history, preferences, devices,
revocation, and installation instructions. Appearance follows the supplied
UI-DESIGN with System/Light/Dark themes.

Two listeners: web `127.0.0.1:8787`, plugin ingestion `127.0.0.1:8788`.
Only Caddy exposes the web listener. There is no public ingestion or console API.

## Verification

```sh
npm test
npm run test:e2e
```

Backend tests verify authentication/2FA, CSRF, throttling, anonymous rejection,
secure production cookies, telemetry reconciliation and deduplication, health
incidents/recovery, push retries, preferences, and revocation. Browser E2E checks
all views in light/dark at 320/390/768/1280px, player modal, settings, confirmations,
stale/recovery, logout, and private-cache exclusion. It also copies an installed
Paper server (default `~/Projects/mc server`, override `MC_SERVER_DIR`) and tests
actual plugin snapshots and real player join/leave events through the app.
Browser screenshots and test evidence are ignored under `apps/dashboard/artifacts/`.
The live test uses a captured push transport, not real vendor/iPhone delivery.

Deployment instructions and the target-VM/iPhone acceptance checklist are in
[apps/dashboard/deploy/README.md](apps/dashboard/deploy/README.md). Real closed-app
iPhone delivery, HTTPS configuration, systemd restart, and VM reboot need target
environment verification. Local automated checks cannot establish those results.

Credentials, databases, dependency directories, worlds, and test artifacts are
excluded from Git. Back up the database and its configuration/master key together.
