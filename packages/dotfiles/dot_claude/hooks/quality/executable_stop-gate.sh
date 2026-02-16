#!/usr/bin/env bash
# [5] Budget Gate + [8] Taint Audit
# Hook event: Stop

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

INPUT="$(cat)"
SESSION_ID="$(printf '%s' "$INPUT" | python3 -c "
import sys, json
print(json.load(sys.stdin).get('session_id', 'unknown'))
" 2>/dev/null || echo "unknown")"

init_state "$SESSION_ID"

# --- Infinite loop prevention ---
STOP_NUM="$(increment_counter "stop-attempts.txt")"
if (( STOP_NUM > 3 )); then
  exit 0
fi

BLOCK_REASONS=""

# --- [5] Budget gate ---
BUDGET_JSON="$(read_state "budget.json" '{"score":100,"deductions":[]}')"
SCORE="$(printf '%s' "$BUDGET_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['score'])" 2>/dev/null || echo "100")"

if (( SCORE < 0 )); then
  DEDUCTION_SUMMARY="$(printf '%s' "$BUDGET_JSON" | python3 -c "
import sys, json
budget = json.load(sys.stdin)
for d in budget.get('deductions', []):
    print(f\"  - {d['pattern']} in {d['file']} (-{d['cost']} pts)\")
" 2>/dev/null || echo "  (unable to read deductions)")"

  BLOCK_REASONS="${BLOCK_REASONS}BUDGET EXHAUSTED (score: ${SCORE}/100)\nYou have accumulated too many quality violations to stop. You must remediate before completing:\n${DEDUCTION_SUMMARY}\n\nReview each violation above and fix or properly justify it before attempting to stop again.\n\n"
fi

# --- [8] Taint audit ---
TAINTED="$(read_state "tainted-files.json" "[]")"
TAINTED_FILES="$(printf '%s' "$TAINTED" | python3 -c "
import sys, json
files = json.load(sys.stdin)
for f in files:
    print(f)
" 2>/dev/null || echo "")"

if [[ -n "$TAINTED_FILES" ]]; then
  TAINT_REPORT=""
  TAINT_FOUND=false
  while IFS= read -r tfile; do
    [[ -z "$tfile" ]] && continue
    [[ ! -f "$tfile" ]] && continue

    FILE_ISSUES=""
    if grep -q 'as any' "$tfile" 2>/dev/null; then
      FILE_ISSUES="${FILE_ISSUES}    - as any\n"
    fi
    if grep -qi 'eslint-disable' "$tfile" 2>/dev/null; then
      FILE_ISSUES="${FILE_ISSUES}    - eslint-disable\n"
    fi
    if grep -q '@ts-ignore' "$tfile" 2>/dev/null; then
      FILE_ISSUES="${FILE_ISSUES}    - @ts-ignore\n"
    fi
    if grep -q '@ts-nocheck' "$tfile" 2>/dev/null; then
      FILE_ISSUES="${FILE_ISSUES}    - @ts-nocheck\n"
    fi
    if grep -qE 'catch.*\{[[:space:]]*\}' "$tfile" 2>/dev/null; then
      FILE_ISSUES="${FILE_ISSUES}    - empty catch\n"
    fi

    if [[ -n "$FILE_ISSUES" ]]; then
      TAINT_FOUND=true
      TAINT_REPORT="${TAINT_REPORT}  ${tfile}:\n${FILE_ISSUES}"
    fi
  done <<< "$TAINTED_FILES"

  if [[ "$TAINT_FOUND" == "true" ]]; then
    BLOCK_REASONS="${BLOCK_REASONS}TAINT AUDIT FAILED — antipatterns still present in files you edited:\n${TAINT_REPORT}\nClean these files before stopping.\n"
  fi
fi

# --- Decision ---
if [[ -n "$BLOCK_REASONS" ]]; then
  ESCAPED="$(printf '%b' "$BLOCK_REASONS" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null)"
  ESCAPED="${ESCAPED:1:${#ESCAPED}-2}"
  printf '{"decision": "block", "reason": "%s"}\n' "$ESCAPED"
else
  exit 0
fi
