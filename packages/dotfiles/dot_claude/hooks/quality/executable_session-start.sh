#!/usr/bin/env bash
# [1] Pre-commitment Anchoring + [5] Budget Init
# Hook event: SessionStart

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

INPUT="$(cat)"
SESSION_ID="$(printf '%s' "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id','unknown'))" 2>/dev/null || echo "unknown")"

init_state "$SESSION_ID"

# Init budget
write_state "budget.json" '{"score":100,"deductions":[]}'
write_state "edit-count.txt" "0"
write_state "stop-attempts.txt" "0"
write_state "prompt-count.txt" "0"
write_state "tainted-files.json" "[]"

# Output quality contract as systemMessage
cat <<'HOOK_OUTPUT'
{"systemMessage": "QUALITY CONTRACT — You have committed to these standards for this session:\n1. NO `as any` — solve the type properly or use a narrowing assertion.\n2. NO lint suppression (`eslint-disable`, `@ts-ignore`, `@ts-nocheck`) — fix the root cause.\n3. NO empty catch blocks — handle or re-throw errors.\n4. NO weak assertions (`.toBeTruthy()`, `expect(true)`) — assert specific values.\n5. NO `test.skip` — fix or delete, don't skip.\n\nBUDGET: You start with 100 quality points. Every shortcut costs points. If you reach 0, you must stop and remediate before continuing. Points cannot be recovered — only spent wisely.\n\nThis contract is non-negotiable. Hooks will BLOCK writes that violate critical rules and DEDUCT points for soft violations."}
HOOK_OUTPUT
