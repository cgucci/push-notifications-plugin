#!/usr/bin/env python3
"""Run real join/leave and outage tests against a COPY of an installed Paper server.

Requires Java 25 and Python 3. Uses the bundled minimal offline protocol client.
Usage: python3 tools/verify-paper.py '/path/to/mc server'
"""
import http.server
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "build/verification"
SERVER = WORK / "server"
SOURCE = Path(sys.argv[1]).resolve()
records = []
lock = threading.Lock()
secret = secrets.token_urlsafe(32)
reject = threading.Event()


class Collector(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        payload = json.loads(body)
        authenticated = self.headers.get("Authorization") == "Bearer " + secret
        status = 503 if reject.is_set() else 204
        if not authenticated:
            status = 401
        with lock:
            records.append({"time": time.monotonic(), "status": status,
                            "authenticated": authenticated,
                            "key": self.headers.get("Idempotency-Key"),
                            "payload": payload, "raw": body.decode()})
        self.send_response(status)
        self.end_headers()

    def log_message(self, *args):
        pass


def wait_for(predicate, timeout=45):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with lock:
            result = predicate(list(records))
        if result:
            return result
        if paper.poll() is not None:
            raise RuntimeError("Paper exited; see build/verification/paper.log")
        if client is not None and client.poll() not in (None, 0):
            raise RuntimeError("Test client failed; see build/verification/client.log")
        time.sleep(0.2)
    raise TimeoutError("Verification timed out; see build/verification/paper.log and client.log")


SERVER.mkdir(parents=True, exist_ok=True)
for filename in ("server.jar", "eula.txt"):
    shutil.copy2(SOURCE / filename, SERVER / filename)
for directory in ("libraries", "versions", "cache"):
    shutil.copytree(SOURCE / directory, SERVER / directory, dirs_exist_ok=True)
plugins = SERVER / "plugins"
plugins.mkdir(exist_ok=True)
jar = next((ROOT / "build/libs").glob("*.jar"))
shutil.copy2(jar, plugins / jar.name)
config_dir = plugins / "ServerDashboard"
config_dir.mkdir(exist_ok=True)
collector = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Collector)
threading.Thread(target=collector.serve_forever, daemon=True).start()
with socket.socket() as reservation:
    reservation.bind(("127.0.0.1", 0))
    game_port = reservation.getsockname()[1]
(SERVER / "server.properties").write_text(
    f"server-ip=127.0.0.1\nserver-port={game_port}\nonline-mode=false\n"
    "level-name=verification-world\nview-distance=2\nsimulation-distance=2\n"
    "enable-rcon=false\nenable-query=false\nspawn-protection=0\n"
    "white-list=false\nenforce-whitelist=false\n")
(config_dir / "config.yml").write_text(
    f"endpoint: 'http://127.0.0.1:{collector.server_port}/ingest'\n"
    f"shared-secret: '{secret}'\nserver-id: 'verification'\ndisk-path: '.'\n")
os.chmod(config_dir / "config.yml", 0o600)
log = (WORK / "paper.log").open("w")
paper = subprocess.Popen(["java", "-Xms512M", "-Xmx1G", "-jar", "server.jar", "--nogui"],
                         cwd=SERVER, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT, text=True)
client = None
summary = {}
try:
    wait_for(lambda rows: any(row["payload"]["type"] == "snapshot" and row["status"] == 204 for row in rows), 120)
    print("Paper enabled plugin and delivered initial authenticated snapshot", flush=True)
    with (WORK / "client.log").open("w") as client_log:
        client = subprocess.Popen([sys.executable, str(ROOT / "tools/paper-test-client.py"), str(game_port)],
                                  stdout=client_log, stderr=subprocess.STDOUT)
        join = wait_for(lambda rows: next((row for row in rows if row["payload"]["type"] == "player_join"), None))
        populated = wait_for(lambda rows: next((row for row in rows if row["payload"]["type"] == "snapshot"
                         and any(player["name"] == "TelemetryTest" for player in row["payload"]["players"])), None))
        leave = wait_for(lambda rows: next((row for row in rows if row["payload"]["type"] == "player_leave"), None))
        assert client.wait(timeout=10) == 0
    wait_for(lambda rows: any(row["payload"]["type"] == "snapshot" and not row["payload"]["players"]
                             and row["time"] > leave["time"] for row in rows))
    assert join["payload"]["player"] == leave["payload"]["player"]
    print("Real client join/leave delivered once; snapshots reconciled online and empty player lists", flush=True)
    reject.set()
    failed = wait_for(lambda rows: next((row for row in rows if row["status"] == 503), None))
    failed_id = failed["payload"]["id"]
    wait_for(lambda rows: len([row for row in rows if row["payload"]["id"] == failed_id]) == 3)
    # The game thread still services a console command while telemetry is unavailable.
    paper.stdin.write("list\n")
    paper.stdin.flush()
    time.sleep(1)
    assert "There are 0 of a max" in (WORK / "paper.log").read_text()
    reject.clear()
    recovered = wait_for(lambda rows: next((row for row in rows if row["status"] == 204 and row["time"] > failed["time"]), None))
    with lock:
        rows = list(records)
    retry_rows = [row for row in rows if row["payload"]["id"] == failed_id]
    assert len(retry_rows) == 3 and len({row["raw"] for row in retry_rows}) == 1
    assert all(row["authenticated"] and row["key"] == row["payload"]["id"] for row in rows)
    assert sum(row["payload"]["type"] == "player_join" for row in rows) == 1
    assert sum(row["payload"]["type"] == "player_leave" for row in rows) == 1
    snapshots = [row for row in rows if row["payload"]["type"] == "snapshot" and row["status"] == 204]
    intervals = [round(b["time"] - a["time"], 2) for a, b in zip(snapshots, snapshots[1:])]
    assert any(8 <= interval <= 12 for interval in intervals)
    sample = populated["payload"]
    assert len(sample["tps"]) == 3 and sample["mspt"] >= 0 and sample["uptimeMillis"] > 0
    for field in ("jvmHeapUsedBytes", "jvmHeapMaxBytes", "vmTotalRamBytes", "diskAvailableBytes"):
        assert sample["resources"][field] > 0
    assert all(sample["resources"][field] is None or 0 <= sample["resources"][field] <= 1
               for field in ("processCpuRatio", "vmCpuRatio"))
    summary = {"passed": True, "minecraftVersion": sample["minecraftVersion"],
               "sourceServer": str(SOURCE), "realPlayerJoinLeave": True,
               "authenticatedRequests": len(rows), "boundedRetryAttempts": len(retry_rows),
               "identicalRetryPayload": True, "snapshotIntervalsSeconds": intervals,
               "outageRecovery": True, "responsiveDuringOutage": True,
               "snapshotExample": sample}
    print("503 outage: exactly three identical retries, responsive server, successful recovery", flush=True)
finally:
    if client and client.poll() is None:
        client.terminate()
        client.wait(timeout=10)
    if paper.poll() is None:
        paper.stdin.write("stop\n")
        paper.stdin.flush()
        try:
            paper.wait(timeout=45)
        except subprocess.TimeoutExpired:
            paper.terminate()
            paper.wait(timeout=15)
    collector.shutdown()
    collector.server_close()
    log.close()
    summary["gracefulShutdown"] = paper.returncode == 0 and "Saving worlds" in (WORK / "paper.log").read_text()
    (WORK / "summary.json").write_text(json.dumps(summary, indent=2))
    # Keep captured telemetry as evidence, but never retain authentication headers.
    (WORK / "requests.json").write_text(json.dumps(records, indent=2))
if not summary.get("gracefulShutdown"):
    raise RuntimeError("Paper did not stop gracefully")
print("PASS — evidence in build/verification/summary.json", flush=True)
