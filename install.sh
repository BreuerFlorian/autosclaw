#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="autosclaw-manager"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$REPO_DIR/manager"
START_SCRIPT="$APP_DIR/start.sh"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/$SERVICE_NAME.service"

# Check required dependencies
for cmd in systemctl loginctl node npm docker; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd not found. Please install it before running this script." >&2
    exit 1
  fi
done

echo "==> Installing $SERVICE_NAME as a user service"

# Ensure start.sh is executable
chmod +x "$START_SCRIPT"

# Create systemd user directory
mkdir -p "$SERVICE_DIR"

# Write the service unit
cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Autosclaw Manager
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=$START_SCRIPT
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
EOF

echo "==> Created $SERVICE_FILE"

# Reload, enable, and start
systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"

echo "==> Service enabled and started"

# Enable linger so the service runs without an active login session
loginctl enable-linger "$USER"

echo "==> Linger enabled for $USER"
echo ""
echo "Useful commands:"
echo "  systemctl --user status $SERVICE_NAME"
echo "  systemctl --user restart $SERVICE_NAME"
echo "  systemctl --user stop $SERVICE_NAME"
echo "  journalctl --user -u $SERVICE_NAME -f"
