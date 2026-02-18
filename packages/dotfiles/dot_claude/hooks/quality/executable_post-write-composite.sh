#!/usr/bin/env bash
# [3] Zeigarnik, [5] Budget, [6] Vickrey, [7] Hyperbolic, [8] Taint
# Hook event: PostToolUse (matcher: Edit|Write)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./executable_lib.sh
source "${SCRIPT_DIR}/lib.sh"

INPUT="$(cat)"

SESSION_ID="$(printf '%s' "$INPUT" | python3 -c "
import sys, json
print(json.load(sys.stdin).get('session_id', 'unknown'))
" 2>/dev/null || echo "unknown")"

FILE_PATH="$(printf '%s' "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
ti = d.get('tool_input', {})
print(ti.get('file_path', ''))
" 2>/dev/null || echo "")"

CONTENT="$(printf '%s' "$INPUT" | python3 -c "
import sys, json
d = json.load(sys.stdin)
ti = d.get('tool_input', {})
c = ti.get('new_string', '') or ti.get('content', '')
print(c)
" 2>/dev/null || echo "")"

init_state "$SESSION_ID"

EDIT_NUM="$(increment_counter "edit-count.txt")"
CONTEXT_PARTS=""

# Skip scanning for non-TS/TSX or exception contexts
SKIP_SCAN=false
if [[ -z "$FILE_PATH" ]] || should_skip_file "$FILE_PATH"; then
  SKIP_SCAN=true
fi

FINDINGS=""
TOTAL_COST=0
if [[ "$SKIP_SCAN" == "false" && -n "$CONTENT" ]]; then
  FINDINGS="$(scan_for_antipatterns "$CONTENT" "$FILE_PATH")"
  if [[ -n "$FINDINGS" ]]; then
    TOTAL_COST="$(sum_costs "$FINDINGS")"
  fi
fi

# --- [3] Zeigarnik: every 5th edit, rotating quality question ---
if (( EDIT_NUM % 5 == 0 )); then
  VARIANT=$(( (EDIT_NUM / 5) % 4 ))
  case $VARIANT in
    0) Q="QUALITY CHECK: Is there any code you just wrote that you would be embarrassed to explain in a code review? Fix it now." ;;
    1) Q="QUALITY CHECK: Are your test assertions specific enough to catch real regressions, or are they rubber-stamp tests?" ;;
    2) Q="QUALITY CHECK: Did you just suppress a warning instead of fixing the root cause? Undo and fix properly." ;;
    3) Q="QUALITY CHECK: Could a junior developer understand your last edit without asking questions? If not, simplify." ;;
  esac
  CONTEXT_PARTS="${CONTEXT_PARTS}${Q}"
fi

# --- [5] Budget: deduct points ---
if [[ "$TOTAL_COST" -gt 0 ]]; then
  BUDGET_JSON="$(read_state "budget.json" '{"score":100,"deductions":[]}')"
  CURRENT_SCORE="$(printf '%s' "$BUDGET_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['score'])" 2>/dev/null || echo "100")"
  NEW_SCORE=$(( CURRENT_SCORE - TOTAL_COST ))

  # Build deduction entries and update budget
  DEDUCTION_ENTRIES=""
  while IFS='|' read -r name cost _severity; do
    [[ -z "$name" ]] && continue
    DEDUCTION_ENTRIES="${DEDUCTION_ENTRIES}{\"pattern\":\"${name}\",\"cost\":${cost},\"file\":\"${FILE_PATH}\"},"
  done <<< "$(printf '%b' "$FINDINGS")"

  python3 -c "
import sys, json
budget = json.loads('''${BUDGET_JSON}''')
budget['score'] = ${NEW_SCORE}
new_deductions = [${DEDUCTION_ENTRIES%,}]
budget['deductions'].extend(new_deductions)
json.dump(budget, sys.stdout)
" > "${STATE_DIR}/budget.json" 2>/dev/null || write_state "budget.json" "{\"score\":${NEW_SCORE},\"deductions\":[]}"

  FINDING_LIST="$(format_findings "$FINDINGS")"
  BUDGET_MSG="BUDGET ALERT: -${TOTAL_COST} points (${CURRENT_SCORE} -> ${NEW_SCORE}/100)\nViolations:\n${FINDING_LIST}\nThese points are GONE. You cannot earn them back. Every shortcut permanently degrades your session score."

  if [[ -n "$CONTEXT_PARTS" ]]; then
    CONTEXT_PARTS="${CONTEXT_PARTS}\n---\n${BUDGET_MSG}"
  else
    CONTEXT_PARTS="${BUDGET_MSG}"
  fi

  # --- [6] Vickrey: self-calibration for large edits with significant deductions ---
  CONTENT_LEN="${#CONTENT}"
  if (( CONTENT_LEN > 500 && TOTAL_COST > 5 )); then
    VICKREY="SELF-CALIBRATION REQUIRED: This was a large edit (${CONTENT_LEN} chars) with ${TOTAL_COST} points deducted. On a scale of 1-10, how confident are you that every shortcut in this edit was truly necessary? If below 8, revise the edit now."
    CONTEXT_PARTS="${CONTEXT_PARTS}\n---\n${VICKREY}"
  fi

  # --- [7] Hyperbolic: vivid consequences ---
  CONSEQUENCES=""
  while IFS='|' read -r name _cost _severity; do
    [[ -z "$name" ]] && continue
    case "$name" in
      "as any") CONSEQUENCES="${CONSEQUENCES}\n- \`as any\` → A runtime crash in production when a user hits a code path you assumed was safe. The type system existed to prevent this." ;;
      "eslint-disable") CONSEQUENCES="${CONSEQUENCES}\n- \`eslint-disable\` → The next developer inherits your suppressed warning, copies the pattern, and now 50 files have the same hidden bug." ;;
      "@ts-ignore") CONSEQUENCES="${CONSEQUENCES}\n- \`@ts-ignore\` → A silent type mismatch that compiles fine but corrupts data at runtime. The compiler was trying to help." ;;
      "@ts-nocheck") CONSEQUENCES="${CONSEQUENCES}\n- \`@ts-nocheck\` → An entire file with zero type safety. Every function is now \`any → any\`. You might as well use JavaScript." ;;
      "empty catch") CONSEQUENCES="${CONSEQUENCES}\n- Empty catch → An error is swallowed silently. Users see a blank screen. Logs show nothing. Debugging takes hours instead of seconds." ;;
      ".toBeTruthy()"*|".toBeFalsy()"*) CONSEQUENCES="${CONSEQUENCES}\n- Weak assertion → Your test passes when it returns \`[]\` instead of the expected data. You ship a bug because your test said 'truthy is fine'." ;;
      "expect(true"*) CONSEQUENCES="${CONSEQUENCES}\n- \`expect(true)\` → A test that literally cannot fail. It exists only to inflate coverage numbers. It protects nothing." ;;
      "test.skip"*) CONSEQUENCES="${CONSEQUENCES}\n- \`test.skip\` → A test you disabled 'temporarily' that nobody re-enables. The code it covered silently rots for months." ;;
    esac
  done <<< "$(printf '%b' "$FINDINGS")"

  if [[ -n "$CONSEQUENCES" ]]; then
    HYPER="CONSEQUENCES OF YOUR SHORTCUTS:${CONSEQUENCES}"
    CONTEXT_PARTS="${CONTEXT_PARTS}\n---\n${HYPER}"
  fi
fi

# --- [8] Taint: record tainted files (silent) ---
if [[ -n "$FINDINGS" && -n "$FILE_PATH" ]]; then
  TAINTED="$(read_state "tainted-files.json" "[]")"
  NEW_TAINTED="$(python3 -c "
import sys, json
files = json.loads('''${TAINTED}''')
fp = '${FILE_PATH}'
if fp not in files:
    files.append(fp)
json.dump(files, sys.stdout)
" 2>/dev/null || echo "$TAINTED")"
  write_state "tainted-files.json" "$NEW_TAINTED"
fi

# --- Output combined context ---
if [[ -n "$CONTEXT_PARTS" ]]; then
  ESCAPED="$(printf '%b' "$CONTEXT_PARTS" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null)"
  ESCAPED="${ESCAPED:1:${#ESCAPED}-2}"
  printf '{"systemMessage": "%s"}\n' "$ESCAPED"
fi
