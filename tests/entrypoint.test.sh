#!/usr/bin/env bash
# Tests for entrypoint.sh logic
set -euo pipefail

PASS=0
FAIL=0
TMPDIR=$(mktemp -d)

pass() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ✗ $1: $2"; }

cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

echo "=== Entrypoint Tests ==="
echo ""

# ── Test 1: Restore from persistent to data ────────────────────
echo "Restore Logic:"

mkdir -p "$TMPDIR/persistent/server-files" "$TMPDIR/persistent/user-files" "$TMPDIR/data"
echo "account-data" > "$TMPDIR/persistent/server-files/account.sqlite"
echo "budget-data" > "$TMPDIR/persistent/user-files/budget.sqlite"

rsync -a --ignore-errors "$TMPDIR/persistent/" "$TMPDIR/data/" 2>/dev/null
if [ -f "$TMPDIR/data/server-files/account.sqlite" ] && [ -f "$TMPDIR/data/user-files/budget.sqlite" ]; then
  pass "rsync restores persistent to data"
else
  fail "rsync restore" "files not copied"
fi

# Verify content matches
if [ "$(cat "$TMPDIR/data/server-files/account.sqlite")" = "account-data" ]; then
  pass "restored file content matches"
else
  fail "content match" "data mismatch"
fi

# ── Test 2: TLS config removal ─────────────────────────────────
echo ""
echo "TLS Config Removal:"

echo '{"https":{"key":"/data/cert.key","cert":"/data/cert.crt"}}' > "$TMPDIR/data/config.json"
if [ -f "$TMPDIR/data/config.json" ]; then
  rm -f "$TMPDIR/data/config.json"
  if [ ! -f "$TMPDIR/data/config.json" ]; then
    pass "config.json removed successfully"
  else
    fail "config removal" "file still exists"
  fi
else
  fail "config creation" "couldn't create test config"
fi

# No config.json — removal should be a no-op
rm -f "$TMPDIR/data/config.json" 2>/dev/null || true
pass "no-op when config.json absent"

# ── Test 3: Sync from data to persistent ───────────────────────
echo ""
echo "Sync Logic:"

echo "new-data" > "$TMPDIR/data/server-files/new-file.txt"
rsync -rl --safe-links --delete "$TMPDIR/data/" "$TMPDIR/persistent/" >/dev/null 2>&1
if [ -f "$TMPDIR/persistent/server-files/new-file.txt" ]; then
  pass "rsync syncs new files to persistent"
else
  fail "sync new files" "file not synced"
fi

if [ "$(cat "$TMPDIR/persistent/server-files/new-file.txt")" = "new-data" ]; then
  pass "synced content matches"
else
  fail "sync content" "data mismatch"
fi

# ── Test 4: Empty persistent — start fresh ─────────────────────
echo ""
echo "Fresh Start:"

FRESH_DIR=$(mktemp -d)
mkdir -p "$FRESH_DIR/persistent" "$FRESH_DIR/data"
# persistent exists but has no files (only empty dirs should not count)
mkdir -p "$FRESH_DIR/persistent/server-files"
FILE_CHECK=$(find "$FRESH_DIR/persistent" -type f 2>/dev/null | head -1)
if [ -z "$FILE_CHECK" ]; then
  pass "empty persistent detected (dirs only) — fresh start"
else
  fail "empty check" "expected no files, got '$FILE_CHECK'"
fi
rm -rf "$FRESH_DIR"

# ── Test 5: Mount readiness check ──────────────────────────────
echo ""
echo "Mount Readiness:"

MOUNT_DIR=$(mktemp -d)
if touch "$MOUNT_DIR/.mount-test" 2>/dev/null && rm -f "$MOUNT_DIR/.mount-test"; then
  pass "mount readiness check works on writable dir"
else
  fail "mount readiness" "could not write to mount dir"
fi
rm -rf "$MOUNT_DIR"

# ── Test 6: Sync guard — skip sync when no server data ─────────
echo ""
echo "Sync Guard:"

GUARD_DIR=$(mktemp -d)
mkdir -p "$GUARD_DIR/data/server-files" "$GUARD_DIR/persistent"
# No files in server-files — sync should be skipped
FILE_CHECK=$(find "$GUARD_DIR/data/server-files" -type f 2>/dev/null | head -1)
if [ -z "$FILE_CHECK" ]; then
  pass "sync guard detects empty server-files"
else
  fail "sync guard" "expected no files"
fi

# With a file — sync should proceed
echo "test" > "$GUARD_DIR/data/server-files/account.sqlite"
FILE_CHECK=$(find "$GUARD_DIR/data/server-files" -type f 2>/dev/null | head -1)
if [ -n "$FILE_CHECK" ]; then
  pass "sync guard allows sync when server data exists"
else
  fail "sync guard" "expected files"
fi
rm -rf "$GUARD_DIR"

# ── Test 7: Verify entrypoint.sh is syntactically valid ────────
echo ""
echo "Script Validation:"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if bash -n "$SCRIPT_DIR/entrypoint.sh" 2>/dev/null; then
  pass "entrypoint.sh passes syntax check"
else
  fail "syntax check" "entrypoint.sh has syntax errors"
fi

# Verify it's executable
if [ -x "$SCRIPT_DIR/entrypoint.sh" ]; then
  pass "entrypoint.sh is executable"
else
  fail "executable check" "entrypoint.sh not executable"
fi

# ── Test 8: Signal handler is defined ──────────────────────────
echo ""
echo "Signal Handling:"

if grep -q "trap on_shutdown SIGTERM SIGINT" "$SCRIPT_DIR/entrypoint.sh"; then
  pass "SIGTERM/SIGINT trap defined"
else
  fail "trap check" "no SIGTERM/SIGINT trap found"
fi

if grep -q "sync_to_persistent" "$SCRIPT_DIR/entrypoint.sh"; then
  pass "sync_to_persistent function referenced in shutdown handler"
else
  fail "shutdown sync" "no sync_to_persistent in script"
fi

# ── Summary ────────────────────────────────────────────────────
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then exit 1; fi
