#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=================================================="
echo "  Thai Arts Recommender - Local Startup Script   "
echo "=================================================="

echo "==> Ensuring WSL keepalive process (prevents WSL2 idle-poweroff loop)..."
if ! wsl.exe -d Ubuntu -e sh -c "pgrep -f 'sleep infinity' >/dev/null"; then
  wsl.exe -d Ubuntu -e sh -c "nohup sleep infinity >/dev/null 2>&1 &"
  echo "    Keepalive started."
else
  echo "    Keepalive already running."
fi

echo "==> Starting Docker containers..."
docker compose up -d

echo "==> Verifying containers..."
docker compose ps

echo "=================================================="
echo "  Web App is ready at: http://localhost:3000     "
echo "=================================================="
