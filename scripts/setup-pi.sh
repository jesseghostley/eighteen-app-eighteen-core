#!/bin/bash
# Eighteen Core — Raspberry Pi Setup
# Requires: Raspberry Pi 4/5, 4GB+ RAM, 64-bit OS (Raspberry Pi OS Lite)
#
# Usage: curl -fsSL https://raw.githubusercontent.com/jesseghostley/eighteen-app-eighteen-core/main/scripts/setup-pi.sh | bash

set -e

echo "========================================"
echo "  Eighteen Core — Raspberry Pi Setup"
echo "========================================"
echo ""

# Check architecture
ARCH=$(uname -m)
if [ "$ARCH" != "aarch64" ] && [ "$ARCH" != "arm64" ]; then
  echo "WARNING: Expected ARM64 architecture, got $ARCH"
  echo "  This script is designed for Raspberry Pi 4/5 with 64-bit OS"
  echo "  Continue anyway? (y/N)"
  read -r REPLY
  if [ "$REPLY" != "y" ] && [ "$REPLY" != "Y" ]; then
    exit 1
  fi
fi

# Check memory
MEM_MB=$(free -m | awk '/Mem:/ {print $2}')
if [ "$MEM_MB" -lt 3500 ]; then
  echo "WARNING: Only ${MEM_MB}MB RAM detected. 4GB+ recommended."
fi

# Install Node.js 22 if not present
if ! command -v node &>/dev/null; then
  echo "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "Node.js version: $(node --version)"

# Install Docker if not present
if ! command -v docker &>/dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  echo "NOTE: Log out and back in for Docker group to take effect"
fi

# Clone repo if not already cloned
REPO_DIR="$HOME/eighteen-core"
if [ ! -d "$REPO_DIR" ]; then
  echo "Cloning eighteen-core..."
  git clone https://github.com/jesseghostley/eighteen-app-eighteen-core.git "$REPO_DIR"
fi

cd "$REPO_DIR"

# Run main setup
./scripts/setup.sh

echo ""
echo "========================================"
echo "  Pi Setup Complete!"
echo ""
echo "  For always-on operation:"
echo "    docker compose up -d"
echo ""
echo "  For webhook ingress, install Tailscale:"
echo "    curl -fsSL https://tailscale.com/install.sh | sh"
echo "    sudo tailscale up"
echo "========================================"
