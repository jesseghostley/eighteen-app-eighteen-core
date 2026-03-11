#!/bin/bash
# Eighteen Core — Docker-Based Setup
# The fastest path: build and run in one command.
#
# Usage: ./scripts/setup-docker.sh

set -e

echo "========================================"
echo "  Eighteen Core — Docker Setup"
echo "========================================"
echo ""

# Check Docker
if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is not installed."
  echo "  Mac/Windows: https://docker.com/products/docker-desktop"
  echo "  Linux: curl -fsSL https://get.docker.com | sh"
  exit 1
fi
echo "  [OK] Docker $(docker --version | awk '{print $3}')"

# Check Docker Compose
if ! docker compose version &>/dev/null; then
  echo "ERROR: Docker Compose is not available."
  echo "  Update Docker Desktop or install docker-compose-plugin"
  exit 1
fi
echo "  [OK] Docker Compose"

# Create .env if not exists
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "Created .env — fill in your tokens before starting:"
  echo "  vim .env  (or nano .env)"
  echo ""
  echo "Required:"
  echo "  TELEGRAM_BOT_TOKEN"
  echo "  ANTHROPIC_API_KEY"
  echo "  GITHUB_PAT"
  echo "  POPE_CLAW_WEBHOOK_SECRET"
  echo ""
  echo "After editing .env, run:"
  echo "  docker compose up -d"
  exit 0
fi

# Check that required vars are set
MISSING=0
for VAR in TELEGRAM_BOT_TOKEN ANTHROPIC_API_KEY GITHUB_PAT POPE_CLAW_WEBHOOK_SECRET; do
  VAL=$(grep "^${VAR}=" .env | cut -d= -f2)
  if [ -z "$VAL" ]; then
    echo "  [MISSING] $VAR in .env"
    MISSING=1
  fi
done

if [ "$MISSING" -eq 1 ]; then
  echo ""
  echo "Fill in the missing values in .env, then run this script again."
  exit 1
fi

# Build and start
echo ""
echo "Building and starting Eighteen Core..."
docker compose up -d --build

echo ""
echo "========================================"
echo "  Eighteen Core is running!"
echo ""
echo "  Health check: curl http://localhost:3000/health"
echo "  Logs:         docker compose logs -f"
echo "  Stop:         docker compose down"
echo "  Restart:      docker compose restart"
echo "========================================"
