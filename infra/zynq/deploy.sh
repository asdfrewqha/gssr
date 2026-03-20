#!/usr/bin/env bash
# Deploy bare binary to all Zynq nodes.
# Usage: ./deploy.sh [binary-path]
# Default binary: ../../services/game/dist/game-server-arm

set -euo pipefail

BINARY="${1:-../../services/game/dist/game-server-arm}"
NODES=("zynq1" "zynq2" "zynq3" "zynq4" "zynq5")
DEPLOY_USER="${DEPLOY_USER:-deploy}"
REMOTE_PATH="/opt/gssr/game-server"

if [ ! -f "$BINARY" ]; then
  echo "Error: binary not found at $BINARY"
  echo "Build first: cd services/game && make build-arm"
  exit 1
fi

for node in "${NODES[@]}"; do
  echo "=== Deploying to $node ==="
  scp "$BINARY" "${DEPLOY_USER}@${node}:${REMOTE_PATH}.new"
  ssh "${DEPLOY_USER}@${node}" \
    "mv ${REMOTE_PATH}.new ${REMOTE_PATH} && chmod +x ${REMOTE_PATH} && sudo systemctl restart gssr-game && echo 'restarted'"
  echo "$node: OK"
done

echo "=== All nodes updated ==="
