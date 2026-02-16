#!/usr/bin/env bash
set -eu

ERRORS=0
for dir in packages/*/; do
  PKG=$(basename "$dir")
  case "$PKG" in
    resume|eslint-config|clauderon|claude-plugin|a2ui-poc|discord-claude|fonts) continue ;;
  esac

  # Check for eslint config
  if ! ls "$dir"eslint.config.* >/dev/null 2>&1; then
    echo "  FAIL: $PKG missing eslint.config.*"
    ERRORS=$((ERRORS+1))
  fi

  # Check for lint script
  if ! grep -q "\"lint\"" "$dir/package.json" 2>/dev/null; then
    echo "  FAIL: $PKG missing lint script"
    ERRORS=$((ERRORS+1))
  fi

  # Check for typecheck script
  if ! grep -q "\"typecheck\"" "$dir/package.json" 2>/dev/null; then
    echo "  FAIL: $PKG missing typecheck script"
    ERRORS=$((ERRORS+1))
  fi

  # Check for tsconfig.json
  if [ ! -f "$dir/tsconfig.json" ]; then
    echo "  FAIL: $PKG missing tsconfig.json"
    ERRORS=$((ERRORS+1))
  fi
done

if [ "$ERRORS" -gt 0 ]; then
  echo "Compliance check failed with $ERRORS error(s)"
  exit 1
fi
echo "All packages compliant"
