#!/bin/bash
set -e

# /data   = local emptyDir (fast, proper SQLite locking)
# /persistent = Azure File Share (SMB, durable across restarts)
#
# Strategy:
#   1. On startup: wait for Azure File Share, restore /persistent → /data
#   2. While running: sync /data → /persistent every 60s (only if restore succeeded)
#   3. On shutdown (SIGTERM/SIGINT): final sync before exit

SYNC_PID=""
RESTORE_OK=false

sync_to_persistent() {
  if [ -d /persistent ]; then
    if rsync -av --delete /data/ /persistent/ 2>&1 | tail -1; then
      echo "[entrypoint] Sync to persistent completed."
    else
      echo "[entrypoint] WARNING: Sync to persistent failed!" >&2
    fi
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

# ── Step 1: Wait for Azure File Share mount ─────────────────────
if [ -d /persistent ]; then
  echo "[entrypoint] Waiting for Azure File Share mount..."
  RETRIES=0
  MAX_RETRIES=30
  while [ $RETRIES -lt $MAX_RETRIES ]; do
    # Check if the mount is live by trying to stat the directory
    if stat /persistent >/dev/null 2>&1 && touch /persistent/.mount-test 2>/dev/null; then
      rm -f /persistent/.mount-test 2>/dev/null
      echo "[entrypoint] Azure File Share mount is ready."
      break
    fi
    RETRIES=$((RETRIES + 1))
    echo "[entrypoint] Waiting for mount... (attempt $RETRIES/$MAX_RETRIES)"
    sleep 2
  done
  if [ $RETRIES -eq $MAX_RETRIES ]; then
    echo "[entrypoint] WARNING: Azure File Share mount not ready after ${MAX_RETRIES} attempts!" >&2
  fi
fi

# ── Step 2: Restore from persistent storage ─────────────────────
if [ -d /persistent ] && [ "$(find /persistent -type f 2>/dev/null | head -1)" ]; then
  echo "[entrypoint] Restoring data from Azure File Share..."
  if rsync -av /persistent/ /data/ 2>&1 | tail -3; then
    RESTORE_OK=true
    echo "[entrypoint] Restore complete."
  else
    echo "[entrypoint] WARNING: Restore failed — starting with whatever data exists." >&2
  fi
else
  echo "[entrypoint] No files found on Azure File Share — starting fresh."
fi

# ── Step 3: Remove any TLS config (ACA handles HTTPS) ──────────
if [ -f /data/config.json ]; then
  echo "[entrypoint] Removing TLS config (ACA handles HTTPS)..."
  rm -f /data/config.json
fi

# ── Step 4: Background sync (every 60s) ────────────────────────
# Only sync with --delete if restore succeeded, to avoid wiping good data
if [ -d /persistent ]; then
  (
    while true; do
      sleep 60
      if [ "$RESTORE_OK" = true ] || [ "$(find /data/server-files -type f 2>/dev/null | head -1)" ]; then
        sync_to_persistent
      else
        echo "[entrypoint] Skipping sync — no server data to persist yet."
      fi
    done
  ) &
  SYNC_PID=$!
  echo "[entrypoint] Background sync to Azure File Share enabled (every 60s)."
fi

# ── Step 5: Start Actual Budget server ──────────────────────────
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
