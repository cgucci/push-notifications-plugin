#!/usr/bin/python3
"""Own Java's stdin and translate systemd SIGTERM into Minecraft's graceful stop.

Use only with KillMode=mixed and TimeoutStopSec=120. A watchdog kill is the
systemd timeout fallback; the normal path sends `stop` and waits for world saves.
"""
import signal
import subprocess
import threading
import sys
if not sys.argv[1:]:
    raise SystemExit('Supply the existing Java arguments after minecraft-runner.py')
child=subprocess.Popen(['/usr/bin/java',*sys.argv[1:]],stdin=subprocess.PIPE,text=True)
stopping=threading.Event()
def stop(signum,frame):
    if not stopping.is_set():
        stopping.set()
        try:
            child.stdin.write('stop\n')
            child.stdin.flush()
        except (BrokenPipeError,OSError):
            pass
signal.signal(signal.SIGTERM,stop)
signal.signal(signal.SIGINT,stop)
raise SystemExit(child.wait())
