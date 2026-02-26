#!/bin/bash
set -e

# /data   = local emptyDir (fast, proper SQLite locking)
# /persistent = Azure File Share (SMB, durable across restarts)
#
# Strategy:
#   1. On startup: wait for Azure File Share, restore /persistent → /data
#   2. While running: sync /data → /persistent every 60s
#      - Use --delete ONLY if initial restore was fully successful
#      - Otherwise use additive sync (never delete from persistent)
#   3. On shutdown (SIGTERM/SIGINT): final sync before exit

SYNC_PID=""
RESTORE_OK=false

sync_to_persistent() {
  if [ -d /persistent ]; then
    if [ "$RESTORE_OK" = true ]; then
      # Full restore succeeded — safe to mirror with --delete
      # Exclude .service-token: it's written directly to /persistent by token injection
      rsync -rl --safe-links --delete --exclude='.service-token' /data/ /persistent/ 2>&1 | tail -3
    else
      # Restore was partial or failed — only add/update, never delete
      echo "[entrypoint] Using additive sync (restore was incomplete)."
      rsync -rl --safe-links /data/ /persistent/ 2>&1 | tail -3
    fi
    echo "[entrypoint] Sync to persistent completed."
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
  # Use -rl instead of -a to avoid permission errors on root-owned dirs
  # (emptyDir root is owned by root, container runs as 'actual')
  if rsync -rl --safe-links /persistent/ /data/ 2>&1; then
    RESTORE_OK=true
    echo "[entrypoint] Restore complete (full)."
  else
    echo "[entrypoint] WARNING: Restore had errors (partial). Sync will be additive only." >&2
  fi
else
  echo "[entrypoint] No files found on Azure File Share — starting fresh."
  RESTORE_OK=true
fi

# ── Step 3: Remove any TLS config (ACA handles HTTPS) ──────────
if [ -f /data/config.json ]; then
  echo "[entrypoint] Removing TLS config (ACA handles HTTPS)..."
  rm -f /data/config.json
fi

# ── Step 4: Background sync (every 60s) ────────────────────────
if [ -d /persistent ]; then
  (
    while true; do
      sleep 60
      if [ "$(find /data/server-files -type f 2>/dev/null | head -1)" ]; then
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

# ── Step 6: Inject MCP service session token ───────────────────
# Wait for the server to initialize its SQLite database, then insert
# a service session token. AB's validateSession() is method-agnostic,
# so this works even with ACTUAL_LOGIN_METHOD=openid.
(
  DB_PATH="/data/server-files/account.sqlite"
  TOKEN_FILE="/persistent/.service-token"
  RETRIES=0
  MAX_RETRIES=60
  while [ $RETRIES -lt $MAX_RETRIES ]; do
    if [ -f "$DB_PATH" ]; then
      # Generate or reuse the service token
      SERVICE_TOKEN=$(cat "$TOKEN_FILE" 2>/dev/null || cat /proc/sys/kernel/random/uuid)
      echo "$SERVICE_TOKEN" > "$TOKEN_FILE"
      # Also write to /data/ so rsync --delete doesn't remove it from /persistent/
      echo "$SERVICE_TOKEN" > /data/.service-token
      # Check if sessions table exists and insert token
      if sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'" 2>/dev/null | grep -q sessions; then
        # Create service user with ADMIN role so it can list all files
        sqlite3 "$DB_PATH" "INSERT OR IGNORE INTO users (id, user_name, display_name, role, enabled, owner) VALUES ('service-mcp', 'service-mcp', 'MCP Service', 'ADMIN', 1, 0);" 2>/dev/null
        sqlite3 "$DB_PATH" "INSERT OR IGNORE INTO sessions (token, expires_at, user_id, auth_method) VALUES ('$SERVICE_TOKEN', -1, 'service-mcp', 'service');" 2>/dev/null
        echo "[entrypoint] Service session token injected for MCP access."
        break
      fi
    fi
    RETRIES=$((RETRIES + 1))
    sleep 2
  done
  if [ $RETRIES -eq $MAX_RETRIES ]; then
    echo "[entrypoint] WARNING: Could not inject service token after ${MAX_RETRIES} attempts." >&2
  fi
) &

# Wait for node process; if it exits, do a final sync
wait $NODE_PID
EXIT_CODE=$?
echo "[entrypoint] Node process exited (code $EXIT_CODE) — syncing data..."
sync_to_persistent
echo "[entrypoint] Final sync complete."
exit $EXIT_CODE
