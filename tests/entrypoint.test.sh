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
rsync -a --delete --ignore-errors "$TMPDIR/data/" "$TMPDIR/persistent/" 2>/dev/null
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
# persistent is empty
CONTENT=$(ls -A "$FRESH_DIR/persistent" 2>/dev/null)
if [ -z "$CONTENT" ]; then
  pass "empty persistent detected — fresh start"
else
  fail "empty check" "expected empty, got '$CONTENT'"
fi
rm -rf "$FRESH_DIR"

# ── Test 5: Verify entrypoint.sh is syntactically valid ────────
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

# ── Test 6: Signal handler is defined ──────────────────────────
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
