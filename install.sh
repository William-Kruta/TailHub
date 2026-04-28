#!/usr/bin/env bash

# Automatically navigate to project root
cd "$(dirname "$0")" || exit
PROJECT_DIR=$(pwd)

SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="$SERVICE_DIR/tailhub.service"

echo "🦔 Setting up TailHub as a local systemd user service..."

# Create directory if it doesn't exist
mkdir -p "$SERVICE_DIR"

# Generate the service file
cat <<EOF > "$SERVICE_FILE"
[Unit]
Description=TailHub Web Server
After=network.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
ExecStart=$(which uv) run python main.py
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

echo "✓ Created $SERVICE_FILE"

# Reload systemd, enable, and start
systemctl --user daemon-reload
systemctl --user enable tailhub.service
systemctl --user restart tailhub.service

echo ""
echo "🚀 TailHub service enabled and started!"
echo "You can check its status anytime with:"
echo "  systemctl --user status tailhub.service"
echo "And view logs with:"
echo "  journalctl --user -u tailhub.service -f"

echo ""
echo "📢 IMPORTANT: Tailscale requires permission for file transfers."
echo "If you haven't already, please run this command once to allow TailHub to send files:"
echo "  sudo tailscale set --operator=\$USER"
