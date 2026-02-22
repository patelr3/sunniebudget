#!/bin/bash
set -e

# /data is the local emptyDir (fast, supports SQLite locking)
# /persistent is the Azure File Share (slow SMB, for backup/restore)

# Restore from persistent storage if available
if [ -d /persistent ] && [ "$(ls -A /persistent 2>/dev/null)" ]; then
  echo "[entrypoint] Restoring data from persistent storage..."
  rsync -a --ignore-errors /persistent/ /data/ 2>/dev/null || true
  echo "[entrypoint] Restore complete."
fi

# Remove any TLS config — ACA handles TLS termination
if [ -f /data/config.json ]; then
  echo "[entrypoint] Removing TLS config (ACA handles HTTPS)..."
  rm -f /data/config.json
fi

# Background sync: periodically copy data back to persistent storage
if [ -d /persistent ]; then
  (
    while true; do
      sleep 300  # every 5 minutes
      rsync -a --delete --ignore-errors /data/ /persistent/ 2>/dev/null || true
    done
  ) &
  echo "[entrypoint] Background sync to persistent storage enabled (every 5 min)."
fi

# Start Actual Budget server
echo "[entrypoint] Starting Actual Budget..."
exec node app.js
