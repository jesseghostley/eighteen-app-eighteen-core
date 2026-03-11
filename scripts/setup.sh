#!/bin/bash
# Eighteen Core — Interactive First-Run Setup
# Works on: Mac, Linux, Windows (WSL2)
#
# Usage: ./scripts/setup.sh

set -e

echo "========================================"
echo "  Eighteen Core — First-Run Setup"
echo "========================================"
echo ""

# Check prerequisites
check_prereq() {
  if ! command -v "$1" &>/dev/null; then
    echo "ERROR: $1 is not installed."
    echo "  Install it: $2"
    exit 1
  fi
  echo "  [OK] $1"
}

echo "Checking prerequisites..."
check_prereq "node" "https://nodejs.org (v20+)"
check_prereq "npm" "Comes with Node.js"
check_prereq "git" "https://git-scm.com"
echo ""

# Install dependencies
echo "Installing dependencies..."
npm install
echo ""

# Build TypeScript
echo "Building TypeScript..."
npm run build
echo ""

# Create config directory
CONFIG_DIR="$HOME/.eighteen"
mkdir -p "$CONFIG_DIR"

# Generate webhook secret if not exists
if [ ! -f "$CONFIG_DIR/.webhook-secret" ]; then
  WEBHOOK_SECRET=$(openssl rand -hex 32)
  echo "$WEBHOOK_SECRET" > "$CONFIG_DIR/.webhook-secret"
  echo "Generated webhook secret (saved to $CONFIG_DIR/.webhook-secret)"
else
  WEBHOOK_SECRET=$(cat "$CONFIG_DIR/.webhook-secret")
  echo "Using existing webhook secret"
fi

# Create pope-claw config if not exists
if [ ! -f "$CONFIG_DIR/pope-claw.json" ]; then
  cp extensions/pope-claw/config.example.json "$CONFIG_DIR/pope-claw.json"
  echo "Created config at $CONFIG_DIR/pope-claw.json"
  echo "  Edit this file to set your repo and callback URL"
else
  echo "Config already exists at $CONFIG_DIR/pope-claw.json"
fi

# Create .env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "Created .env file — fill in your tokens:"
  echo "  TELEGRAM_BOT_TOKEN  (from @BotFather on Telegram)"
  echo "  ANTHROPIC_API_KEY   (from console.anthropic.com)"
  echo "  GITHUB_PAT          (fine-grained, scoped to your repo)"
  echo ""
  echo "  Then run: npm start"
else
  echo ".env already exists"
fi

echo ""
echo "========================================"
echo "  Setup complete!"
echo ""
echo "  Next steps:"
echo "  1. Edit .env with your API tokens"
echo "  2. Edit $CONFIG_DIR/pope-claw.json"
echo "  3. Run: npm start"
echo "========================================"
