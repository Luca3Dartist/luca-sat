#!/usr/bin/env bash
# One-time setup on the Raspberry Pi. Run from inside the cloned repo:
#   bash deploy/install.sh
# Creates the sat (web app) service and the sat-update timer that auto-deploys
# new commits, running as the current user.
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="$(id -un)"
NODE_BIN="$(command -v node || true)"
PORT="${PORT:-3001}"

if [ -z "$NODE_BIN" ]; then echo "Node is not installed. Install Node 20+ first."; exit 1; fi
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then echo "Node $NODE_MAJOR found, need 20 or newer."; exit 1; fi
NODE_DIR="$(dirname "$NODE_BIN")"

echo "App dir: $APP_DIR  user: $APP_USER  node: $NODE_BIN  port: $PORT"

sudo tee /etc/systemd/system/sat.service >/dev/null <<EOF
[Unit]
Description=Luca's SAT web app
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=$PORT
ExecStart=$NODE_BIN server/src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/sat-update.service >/dev/null <<EOF
[Unit]
Description=Pull and deploy Luca's SAT from git
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=PATH=$NODE_DIR:/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/env bash $APP_DIR/deploy/update.sh
EOF

sudo tee /etc/systemd/system/sat-update.timer >/dev/null <<EOF
[Unit]
Description=Check git for Luca's SAT updates every 2 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
EOF

# Let the update job restart the app without a password, and nothing else.
echo "$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart sat" | sudo tee /etc/sudoers.d/sat >/dev/null
sudo chmod 440 /etc/sudoers.d/sat
sudo visudo -cf /etc/sudoers.d/sat

mkdir -p "$APP_DIR/server/data"

sudo systemctl daemon-reload
sudo systemctl enable sat
bash "$APP_DIR/deploy/update.sh" --force
sudo systemctl enable --now sat-update.timer

echo
echo "Done. Open http://$(hostname).local:$PORT"
echo "Logs: journalctl -u sat -f      Deploy log: journalctl -u sat-update -f"
