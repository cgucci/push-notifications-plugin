# ServerDashboard Paper plugin

The plugin portion of `Minecraft-Admin-EDD.md`. Built for the installed Paper
26.3 build 142 server and Java 25. Gradle 9.7.1 is pinned in the complete wrapper.

## Build and install

```sh
./gradlew build
```

Copy `build/libs/Server Dashboard-1.0-SNAPSHOT.jar` into the Paper server's
`plugins/` directory, then start Paper. Configuration is generated at
`plugins/ServerDashboard/config.yml`:

```yaml
endpoint: 'http://127.0.0.1:8788/ingest'
shared-secret: '' # replaced with a random 256-bit secret on first start
server-id: 'minecraft'
disk-path: '.'
```

Give the ingestion service the same secret. Restart Paper after editing config.
Use a secret of at least 32 URL-safe characters (`A–Z`, `a–z`, `0–9`, `_`, `-`).
Only literal `127.0.0.1` or `[::1]` HTTP endpoints with an explicit port are
accepted. Redirects and HTTP proxies are disabled. The service must bind to
loopback; the plugin does not open a listener. Keep the config private.

The dashboard/service, login, push delivery, Caddy, and systemd controls are
separate parts of the EDD and are not included in this plugin.

## Ingestion contract (schema version 1)

Each request is a UTF-8 JSON `POST` with:

- `Authorization: Bearer <shared-secret>`
- `Content-Type: application/json`
- `Idempotency-Key: <payload.id>`

Every payload has `schemaVersion`, `id` (UUID), `serverId`, `instanceId`
(UUID per plugin enable), `sequence` (increasing within that instance), `type`,
and `capturedAt` (UTC ISO-8601). The service should authenticate before ingesting,
deduplicate IDs with a unique constraint, and return a 2xx response only after
committing the update. A duplicate already committed should also return 2xx.

`player_join` and `player_leave` carry:

```json
{"player":{"name":"Connor","uuid":"00000000-0000-0000-0000-000000000000"}}
```

`snapshot` carries the full online `players` array (same name/UUID shape),
`tps` (one-, five-, fifteen-minute rolling averages), `mspt` (Paper's average
tick time in milliseconds), `uptimeMillis` (Java server-process uptime),
`minecraftVersion`, and `resources`:

| Resource field | Meaning |
| --- | --- |
| `capturedAt` | Resource sample time, separate from game-state capture time |
| `scope`, `os` | `server-os` and the operating system name |
| `availableProcessors` | Logical processors visible to Java |
| `processCpuRatio` | Java process CPU load, 0–1 across available processors |
| `vmCpuRatio` | CPU load of the OS visible to Java, 0–1 |
| `jvmHeapUsedBytes`, `jvmHeapMaxBytes` | JVM heap, **not total process memory** |
| `jvmNonHeapUsedBytes` | JVM non-heap memory; does not include all native allocations |
| `processResidentMemoryBytes` | Linux `/proc/self/status` VmRSS; null on other OSes |
| `vmTotalRamBytes`, `vmFreeRamBytes` | Total/free RAM visible to Java's OS management bean |
| `diskTotalBytes`, `diskAvailableBytes` | Filesystem capacity and usable space at `disk-path` |

Unsupported/unavailable values are `null`; CPU ratios become percentages by
multiplying by 100. In the target Debian VM, OS metrics describe that VM. In
local macOS verification they describe the Mac. Container-aware JVMs can report
container limits. Free RAM is the management bean's free RAM, not Linux
`MemAvailable`. Resident memory is separate from heap and can include shared pages.

Snapshots are authoritative for online state. Preserve events for history, but
do not let an older event undo a newer snapshot: use `instanceId` and `sequence`
to order updates within an instance, and reject expired instances after a new
instance takes over. Delivery can skip sequence numbers because it is bounded.
Mark telemetry stale using game-state `capturedAt`, not the arrival of a retry
or a player event. A fresh retry must not make an old snapshot look current.

## Failure behavior

Game state is captured on Paper's main thread. A separate wall-clock scheduler
requests a snapshot immediately and every ten seconds, with at most one pending
main-thread capture. A stalled server therefore stops producing fresh snapshots.
Filesystem sampling and HTTP run on a dedicated daemon worker.

There is one in-flight request, at most 256 queued player events, and one latest
queued snapshot. Snapshots take priority over a queued event backlog; older queued
snapshots are replaced. Overflow drops the oldest event. Snapshot/event delivery
expires after 30/120 seconds respectively. There is no durable event queue; the
next complete snapshot repairs missed online-state changes.

Each payload gets at most three attempts with one-/two-second backoff. Connect
timeout is two seconds and request timeout is three seconds. Only connection
failures, HTTP 408/429, and 5xx are retried. Payload and ID remain identical across
attempts. Other statuses (including redirects and auth failures) are dropped.
Warnings are limited to one per minute. Disable interrupts delivery and clears
the queue without waiting for the network on the game thread.

## Verification

`./gradlew build` runs transport/resource tests. The live verification script
copies the installed server binaries and caches into `build/verification/server`,
uses a fresh world, a loopback collector, and a loopback offline test server.
It does not change the installed server directory. Offline mode is used only for
the isolated protocol test client.

```sh
python3 tools/verify-paper.py "$HOME/Projects/mc server"
```

It verifies a real client's join/leave, populated/empty snapshots, ten-second
cadence, all metric fields, authenticated requests, a 503 outage with identical
bounded retries, console responsiveness during the outage, recovery, and graceful
world-saving shutdown. Evidence is in `build/verification/summary.json`,
`requests.json`, `paper.log`, and `client.log`. Evidence excludes auth headers.

API references: [Paper scheduling](https://docs.papermc.io/paper/dev/scheduler/)
and [Java OS metrics](https://docs.oracle.com/en/java/javase/25/docs/api/jdk.management/com/sun/management/OperatingSystemMXBean.html).
