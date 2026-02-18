#!/usr/bin/env bash
# [4] Constructive Friction — DENY gate for critical antipatterns
# Hook event: PreToolUse (matcher: Edit|Write)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./executable_lib.sh
source "${SCRIPT_DIR}/lib.sh"

INPUT="$(cat)"

# Extract file path and content from tool input
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
# Edit uses new_string, Write uses content
c = ti.get('new_string', '') or ti.get('content', '')
print(c)
" 2>/dev/null || echo "")"

# Skip if no content or no file path
if [[ -z "$CONTENT" || -z "$FILE_PATH" ]]; then
  exit 0
fi

# Skip non-TS/TSX and exception contexts
if should_skip_file "$FILE_PATH"; then
  exit 0
fi

FINDINGS="$(scan_for_antipatterns "$CONTENT" "$FILE_PATH")"
if [[ -z "$FINDINGS" ]]; then
  exit 0
fi

# Check for critical findings
if has_critical "$FINDINGS"; then
  CRITICAL_LIST=""
  while IFS='|' read -r name _cost severity; do
    [[ -z "$name" ]] && continue
    [[ "$severity" == "critical" ]] && CRITICAL_LIST="${CRITICAL_LIST}  - ${name}\n"
  done <<< "$(printf '%b' "$FINDINGS")"

  cat <<EOF
{"hookSpecificOutput": {"permissionDecision": "deny"}, "systemMessage": "BLOCKED: Critical antipattern(s) detected:\n$(printf '%b' "$CRITICAL_LIST")\nYou MUST justify each with:\n1. IMPOSSIBILITY — Why is the proper solution truly impossible here?\n2. BLAST RADIUS — What downstream code is affected?\n3. REMOVAL PLAN — When and how will this be removed?\n\nRewrite without the antipattern, or provide the 3-part justification as a code comment at the violation site and retry."}
EOF
  exit 0
fi

# Soft findings only — warn but allow
WARN_LIST="$(format_findings "$FINDINGS")"
cat <<EOF
{"hookSpecificOutput": {"permissionDecision": "allow"}, "systemMessage": "WARNING: Soft antipatterns detected:\n${WARN_LIST}\nConsider using stronger alternatives. Points will be deducted."}
EOF
