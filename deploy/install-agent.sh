#!/usr/bin/env bash
# One-time root installation. Usage: sudo bash deploy/install-agent.sh /path/to/server minecraft.service
set -euo pipefail
if [ "$EUID" -ne 0 ] || [ "$#" -ne 2 ]; then
  echo 'Usage: sudo bash deploy/install-agent.sh /path/to/minecraft minecraft.service' >&2
  exit 1
fi
MC_DIRECTORY=$(realpath "$1")
MC_UNIT=$2
if { [ ! -f "$MC_DIRECTORY/server.jar" ] && [ ! -f "$MC_DIRECTORY/paper.jar" ]; } || [[ ! "$MC_UNIT" =~ ^[A-Za-z0-9_.@-]+\.service$ ]]; then
  echo 'Supply your existing server directory and unit.' >&2
  exit 1
fi
if [ "$(systemctl show "$MC_UNIT" --property=LoadState --value)" != 'loaded' ]; then
  echo 'Minecraft systemd unit is not loaded.' >&2
  exit 1
fi
SOURCE_ROOT=$(cd "$(dirname "$0")/.." && pwd)
/usr/bin/node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'
getent passwd mcadmin >/dev/null || useradd --system --user-group --home-dir /var/lib/minecraft-admin --shell /usr/sbin/nologin mcadmin
install -d -o root -g mcadmin -m 0750 /etc/minecraft-admin
install -d -o mcadmin -g mcadmin -m 0700 /var/lib/minecraft-admin
install -d -o root -g root -m 0700 /var/lib/minecraft-deploy
install -d -o root -g root -m 0755 /opt/minecraft-admin/releases /usr/local/libexec
python3 - "$MC_DIRECTORY" "$MC_UNIT" <<'PY'
import json,os,sys
path='/etc/minecraft-admin/deploy.json'
with open(path,'w') as file:json.dump({'minecraftDirectory':sys.argv[1],'minecraftUnit':sys.argv[2]},file)
os.chmod(path,0o600)
PY
install -o root -g root -m 0755 "$SOURCE_ROOT/deploy/minecraft-deploy.py" /usr/local/libexec/minecraft-deploy.py
install -o root -g root -m 0644 "$SOURCE_ROOT/deploy/minecraft-deploy.service" /etc/systemd/system/minecraft-deploy.service
install -o root -g root -m 0644 "$SOURCE_ROOT/deploy/minecraft-deploy.timer" /etc/systemd/system/minecraft-deploy.timer
python3 - "$SOURCE_ROOT" "$MC_UNIT" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1]);unit=sys.argv[2]
service=(root/'apps/dashboard/deploy/minecraft-admin.service').read_text().replace('/opt/minecraft-admin/apps/dashboard','/opt/minecraft-admin/current/app')
Path('/etc/systemd/system/minecraft-admin.service').write_text(service)
helper=(root/'apps/dashboard/deploy/minecraft-control').read_text().replace("'minecraft.service'",repr(unit))
Path('/usr/local/libexec/minecraft-control').write_text(helper)
PY
chmod 0755 /usr/local/libexec/minecraft-control
install -o root -g root -m 0440 "$SOURCE_ROOT/apps/dashboard/deploy/minecraft-admin.sudoers" /etc/sudoers.d/minecraft-admin
visudo -cf /etc/sudoers.d/minecraft-admin
if [ -f /etc/minecraft-admin/config.json ]; then
  chown root:mcadmin /etc/minecraft-admin/config.json
  chmod 0640 /etc/minecraft-admin/config.json
fi
systemctl daemon-reload
systemctl enable minecraft-admin.service
printf '\nAgent installed but NOT started. Complete account/plugin configuration, then run:\n'
printf '  sudo systemctl enable --now minecraft-deploy.timer\n  sudo systemctl start minecraft-deploy.service\n'
