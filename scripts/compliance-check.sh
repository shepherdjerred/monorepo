#!/usr/bin/env bash
set -eu

ERRORS=0
for dir in packages/*/; do
  PKG=$(basename "$dir")

  if [ ! -f "$dir/package.json" ]; then
    echo "  INFO: $PKG has no package.json (non-Bun package)"
    continue
  fi

  # Check for script contract expected by root automation.
  if ! grep -q "\"build\"" "$dir/package.json" 2>/dev/null; then
    echo "  FAIL: $PKG missing build script"
    ERRORS=$((ERRORS+1))
  fi

  if ! grep -q "\"test\"" "$dir/package.json" 2>/dev/null; then
    echo "  FAIL: $PKG missing test script"
    ERRORS=$((ERRORS+1))
  fi

  if ! grep -q "\"lint\"" "$dir/package.json" 2>/dev/null; then
    echo "  FAIL: $PKG missing lint script"
    ERRORS=$((ERRORS+1))
  fi

  if ! grep -q "\"typecheck\"" "$dir/package.json" 2>/dev/null; then
    echo "  FAIL: $PKG missing typecheck script"
    ERRORS=$((ERRORS+1))
  fi
done

if [ "$ERRORS" -gt 0 ]; then
  echo "Compliance check failed with $ERRORS error(s)"
  exit 1
fi
echo "All packages compliant"
