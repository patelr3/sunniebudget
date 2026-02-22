#!/bin/bash
set -e

# /data   = local emptyDir (fast, proper SQLite locking)
# /persistent = Azure File Share (SMB, durable across restarts)
#
# Strategy:
#   1. On startup: restore /persistent → /data
#   2. While running: sync /data → /persistent every 60s
#   3. On shutdown (SIGTERM/SIGINT): final sync before exit

SYNC_PID=""

sync_to_persistent() {
  if [ -d /persistent ]; then
    rsync -a --delete --ignore-errors /data/ /persistent/ 2>/dev/null || true
  fi
}

# Graceful shutdown: sync data, then exit
on_shutdown() {
  echo "[entrypoint] Shutdown signal received — syncing data..."
  sync_to_persistent
  echo "[entrypoint] Final sync complete. Exiting."
  # Kill background sync loop if running
  [ -n "$SYNC_PID" ] && kill "$SYNC_PID" 2>/dev/null || true
  exit 0
}
trap on_shutdown SIGTERM SIGINT

# ── Step 1: Restore from persistent storage ─────────────────────
if [ -d /persistent ] && [ "$(ls -A /persistent 2>/dev/null)" ]; then
  echo "[entrypoint] Restoring data from Azure File Share..."
  rsync -a --ignore-errors /persistent/ /data/ 2>/dev/null || true
  echo "[entrypoint] Restore complete."
else
  echo "[entrypoint] No data found on Azure File Share — starting fresh."
fi

# ── Step 2: Remove any TLS config (ACA handles HTTPS) ──────────
if [ -f /data/config.json ]; then
  echo "[entrypoint] Removing TLS config (ACA handles HTTPS)..."
  rm -f /data/config.json
fi

# ── Step 3: Background sync (every 60s) ────────────────────────
if [ -d /persistent ]; then
  (
    while true; do
      sleep 60
      sync_to_persistent
    done
  ) &
  SYNC_PID=$!
  echo "[entrypoint] Background sync to Azure File Share enabled (every 60s)."
fi

# ── Step 4: Start Actual Budget server ──────────────────────────
echo "[entrypoint] Starting Actual Budget..."
node app.js &
NODE_PID=$!

# Wait for node process; if it exits, do a final sync
wait $NODE_PID
EXIT_CODE=$?
echo "[entrypoint] Node process exited (code $EXIT_CODE) — syncing data..."
sync_to_persistent
echo "[entrypoint] Final sync complete."
exit $EXIT_CODE
