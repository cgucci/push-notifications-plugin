# Verification — 2026-10-09

Passed locally on macOS with Node 24, Java 25, and Paper 26.3 build 142.

- Gradle plugin build and seven transport/resource tests.
- Nine backend integration tests: anonymous rejection, password/TOTP, replay
  prevention, CSRF/origin enforcement, secure production cookie attributes,
  login throttling, fixed controls, ingestion separation, snapshot reconciliation,
  duplicate suppression, instance retirement, subscriptions/revocation, push
  retry/expiration behavior, sustained health incidents, recovery, and persistence
  of sessions/preferences/incident deduplication across service restart.
- Chromium: Overview, Activity, Settings at 320, 390, 768, 1280px, both light and
  dark. No horizontal overflow or uncaught browser JavaScript errors. Screenshots
  visually inspected for mobile light, mobile dark settings, and desktop dark.
- Browser interactions: login, full player list, saved preferences, remembered
  appearance, cancel/confirm server action, stale/recovery, logout, and no private
  HTML/API responses in the service-worker cache.
- Live integration: isolated copy of installed Paper binaries → actual plugin →
  authenticated HTTP ingestion → SQLite → browser. A real protocol client
  produced one join and one leave. One join push was captured with the browser
  closed. Paper's normal `stop` command saved the worlds and exited successfully.

Evidence: `apps/dashboard/artifacts/e2e-report.json`, screenshots, `paper.log`,
`client.log` (ignored; contains test runtime data). Run `npm test`,
`npm run build:plugin`, and `npm run test:e2e` to reproduce.

## Target acceptance remains

These were not established by the local test and must be checked in deployment:

1. Caddy-issued HTTPS and secure-cookie/session behavior at mc.cgooch.org.
2. Root-owned helper/sudoers installation, actual Minecraft systemd status and
   graceful restart, independent dashboard operation, and Debian VM reboot.
3. Standard browser-vendor Web Push delivery to the installed iPhone app while
   closed, plus device revocation. The local test captures the outgoing transport;
   it does not claim a notification reached an iPhone.

No production credentials, public forwarding, remote VM configuration, or
existing Minecraft worlds were modified. The existing plugin payload supports
all requested app cards; no plugin update was necessary.
