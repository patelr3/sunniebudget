#!/usr/bin/env bash
# Verify the Docker image builds successfully and has required tools
set -euo pipefail

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); echo "  ✓ $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ✗ $1: $2"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== Docker Build Tests ==="
echo ""

# ── Test 1: Docker image builds ────────────────────────────────
echo "Build:"
if docker build -t actualbudget-test:ci "$SCRIPT_DIR" --quiet 2>&1; then
  pass "Docker image builds successfully"
else
  fail "Docker build" "build failed"
  echo "=== Results: $PASS passed, $FAIL failed ==="
  exit 1
fi

# ── Test 2: Required tools installed ───────────────────────────
echo ""
echo "Required Tools:"

if docker run --rm actualbudget-test:ci which rsync >/dev/null 2>&1; then
  pass "rsync is installed"
else
  fail "rsync" "not found in image"
fi

if docker run --rm actualbudget-test:ci which node >/dev/null 2>&1; then
  pass "node is installed"
else
  fail "node" "not found in image"
fi

# ── Test 3: Entrypoint exists and is executable ────────────────
echo ""
echo "Entrypoint:"

if docker run --rm actualbudget-test:ci test -x /entrypoint.sh; then
  pass "/entrypoint.sh exists and is executable"
else
  fail "entrypoint" "/entrypoint.sh not found or not executable"
fi

# ── Test 4: App.js exists ─────────────────────────────────────
echo ""
echo "Application:"

if docker run --rm actualbudget-test:ci test -f /app/app.js; then
  pass "app.js exists in /app"
else
  fail "app.js" "not found"
fi

# Cleanup
docker rmi actualbudget-test:ci >/dev/null 2>&1 || true

# ── Summary ────────────────────────────────────────────────────
echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then exit 1; fi
