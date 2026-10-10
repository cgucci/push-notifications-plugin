# One-time VM setup for automatic deployment

GitHub Actions tests the backend, plugin and responsive browser UI on GitHub-hosted
Linux. Successful current-main builds publish a release. A root-owned VM timer
checks every two minutes, verifies its commit and checksums, installs only runtime
files, and health-checks the app plus fresh plugin telemetry. It restores the prior
runtime/plugin/database on failure and blocks that failed commit from repeatedly
restarting the server. A newer successful commit is tried automatically.

The public repository never executes GitHub runner jobs on your VM. No GitHub
secrets, SSH deployment keys, or inbound deployment ports are required. Packages
are Linux x64: confirm `uname -m` prints `x86_64`. The VM must run Paper 26.3 and
Java 25; do not enable deployments on a different server version.

## 1. Prerequisites and checkout

SSH into the VM. Install Node 24 (system path `/usr/bin/node`), Caddy, Python 3,
Git, curl, sudo and build tooling. Existing Java/Paper stay in place.

```sh
sudo apt update
sudo apt install -y git curl ca-certificates python3 sudo build-essential caddy
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource-setup.sh
sudo bash /tmp/nodesource-setup.sh
sudo apt install -y nodejs
node --version
java --version
uname -m

git clone https://github.com/cgucci/push-notifications-plugin.git ~/minecraft-admin-bootstrap
cd ~/minecraft-admin-bootstrap
npm ci --omit=dev --prefix apps/dashboard
```

If Node 24/Caddy are already installed, retain them. Read the existing Minecraft
unit with `systemctl cat YOUR_UNIT`: confirm stopping saves worlds and its stop
timeout permits saves (120 seconds recommended). The provided runner/example unit
in `apps/dashboard/deploy/` is available if your existing unit needs a graceful
stdin `stop` path; retain your actual Java flags, Minecraft user and directory.

## 2. Install the fixed agent and provision the admin

Replace `/opt/minecraft` and `minecraft.service` with your actual directory/unit:

```sh
sudo bash deploy/install-agent.sh /opt/minecraft minecraft.service

cd apps/dashboard
sudo env MC_ADMIN_CONFIG=/etc/minecraft-admin/config.json \
  MC_ADMIN_DATA_PATH=/var/lib/minecraft-admin/admin.sqlite \
  /usr/bin/node scripts/setup.js
```

Choose username/password, leave shared-secret blank to generate one, and use
`https://mc.cgooch.org` for origin. Add the displayed provisioning URI to your
authenticator and verify its code. Password, TOTP, VAPID and ingestion secrets stay
on the VM; they are never sent to GitHub.

```sh
sudo chown root:mcadmin /etc/minecraft-admin/config.json
sudo chmod 0640 /etc/minecraft-admin/config.json
sudo chown -R mcadmin:mcadmin /var/lib/minecraft-admin
cd ../..
sudo python3 deploy/configure-plugin.py
```

The script creates/updates the plugin config with the same secret automatically.
The first tested release supplies the JAR; no manual upload is needed. The script also synchronizes the app's unit name with the installed helper and agent.
Keep config root-owned with group mcadmin, mode 0640. The SQLite directory is
mcadmin-owned/0700. Back up both config and database together.

## 3. Caddy and network

Merge the following block into `/etc/caddy/Caddyfile` without replacing other sites:

```caddy
mc.cgooch.org {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8787
}
```

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Keep the DNS record DNS-only and point it to your public IP. Forward only TCP
80/443 to Caddy after authentication is verified; keep Minecraft on 25565.
Never expose 8787/8788. Caddy certificate issuance requires reachable ACME
validation; use your existing DNS challenge/private TLS setup if testing before
public forwarding. The app requires HTTPS for secure sessions and Web Push.

## 4. Enable updates

```sh
sudo systemctl enable --now minecraft-deploy.timer
sudo systemctl start minecraft-deploy.service
sudo journalctl -u minecraft-deploy.service -n 60 --no-pager
sudo systemctl status minecraft-admin.service --no-pager
```

The timer installs the current successful release as soon as CI publishes it.
App-only updates restart the dashboard. Only changed plugin JARs restart a running
Minecraft service. A deliberately stopped server stays stopped. Worlds, plugin
config, admin config, and database are preserved. The first dashboard deployment
must finish before its service can start (`current` is created by the agent).

Verify login, real data, graceful restart, and iPhone Home Screen notification
delivery. A failed release rolls back, then remains blocked; inspect logs before
retrying with `sudo rm /var/lib/minecraft-deploy/failed-commit` or push a fixed commit.
For emergency pause: `sudo systemctl stop minecraft-deploy.timer`.

For repo security, require the `verify` check on main and disallow force pushes.
Deploys come only from tested main builds; pull requests never publish releases.
