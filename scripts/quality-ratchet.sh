#!/usr/bin/env bash
set -eu

BASELINE_ESLINT=$(grep -o '"eslint-disable": [0-9]*' .quality-baseline.json | grep -o '[0-9]*')
BASELINE_TS=$(grep -o '"ts-suppressions": [0-9]*' .quality-baseline.json | grep -o '[0-9]*')
BASELINE_RUST=$(grep -o '"rust-allow": [0-9]*' .quality-baseline.json | grep -o '[0-9]*')
BASELINE_PRETTIER=$(grep -o '"prettier-ignore": [0-9]*' .quality-baseline.json | grep -o '[0-9]*')

CURRENT_ESLINT=$(grep -r "eslint-disable" packages/ .dagger/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules | grep -v dist | grep -v archive | wc -l | tr -d " ")
CURRENT_TS=$(grep -r "@ts-expect-error\|@ts-ignore\|@ts-nocheck" packages/ .dagger/ --include="*.ts" --include="*.tsx" 2>/dev/null | grep -v node_modules | grep -v dist | grep -v archive | wc -l | tr -d " ")
CURRENT_RUST=$(grep -r '#\[allow(' packages/clauderon/src/ --include="*.rs" 2>/dev/null | wc -l | tr -d " ")
CURRENT_PRETTIER=$(grep -r "prettier-ignore" packages/ .dagger/ --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.css" --include="*.json" 2>/dev/null | grep -v node_modules | grep -v dist | grep -v archive | wc -l | tr -d " ")

echo "Suppression counts (current / baseline):"
echo "  eslint-disable: $CURRENT_ESLINT / $BASELINE_ESLINT"
echo "  ts-suppressions: $CURRENT_TS / $BASELINE_TS"
echo "  rust-allow: $CURRENT_RUST / $BASELINE_RUST"
echo "  prettier-ignore: $CURRENT_PRETTIER / $BASELINE_PRETTIER"

FAILED=0
if [ "$CURRENT_ESLINT" -gt "$BASELINE_ESLINT" ]; then
  echo "FAIL: eslint-disable count increased ($CURRENT_ESLINT > $BASELINE_ESLINT)"
  FAILED=1
fi
if [ "$CURRENT_TS" -gt "$BASELINE_TS" ]; then
  echo "FAIL: ts-suppressions count increased ($CURRENT_TS > $BASELINE_TS)"
  FAILED=1
fi
if [ "$CURRENT_RUST" -gt "$BASELINE_RUST" ]; then
  echo "FAIL: rust-allow count increased ($CURRENT_RUST > $BASELINE_RUST)"
  FAILED=1
fi
if [ "$CURRENT_PRETTIER" -gt "$BASELINE_PRETTIER" ]; then
  echo "FAIL: prettier-ignore count increased ($CURRENT_PRETTIER > $BASELINE_PRETTIER)"
  FAILED=1
fi

if [ "$FAILED" -eq 1 ]; then
  echo "Quality ratchet failed. Update .quality-baseline.json if suppressions were intentionally added."
  exit 1
fi
echo "Quality ratchet passed"
