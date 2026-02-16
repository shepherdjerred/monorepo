#!/usr/bin/env bash
# [2] Revelation Audit + Fresh Start Reset
# Hook event: UserPromptSubmit

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

INPUT="$(cat)"
SESSION_ID="$(printf '%s' "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id','unknown'))" 2>/dev/null || echo "unknown")"
PROMPT="$(printf '%s' "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('user_prompt',''))" 2>/dev/null || echo "")"

init_state "$SESSION_ID"

PROMPT_NUM="$(increment_counter "prompt-count.txt")"

# Count words in prompt
WORD_COUNT="$(printf '%s' "$PROMPT" | wc -w | tr -d ' ')"
if [[ "$WORD_COUNT" -lt 10 ]]; then
  exit 0
fi

# Check for coding verbs
CODING_VERBS='(add|create|implement|build|write|fix|refactor|update|change|modify|edit|remove|delete|replace|move|rename|extract|convert|migrate|introduce|scaffold|generate|set up|configure|integrate|install|connect|wire|hook|extend|override|wrap|compose|transform|validate|sanitize|test|assert|mock|stub|spy|debug|profile|optimize|lint|format|type-check|compile)'
HAS_CODING_VERB=false
if printf '%s' "$PROMPT" | grep -qiE "$CODING_VERBS"; then
  HAS_CODING_VERB=true
fi

CONTEXT=""

# Temporal landmark at prompt 4
if [[ "$PROMPT_NUM" -eq 4 ]]; then
  CONTEXT="--- NEW PHASE ---\nYou are entering a new phase of this session. Previous context may have accumulated shortcuts or technical debt assumptions. Reset your quality standards to maximum. Treat this as a fresh start with full rigor.\n\n"
fi

# Revelation audit for coding prompts
if [[ "$HAS_CODING_VERB" == "true" ]]; then
  CONTEXT="${CONTEXT}REVELATION AUDIT: Before writing any code for this prompt, you MUST internally identify:\n1. What shortcuts you are tempted to take (type casts, lint suppression, weak tests)\n2. What the proper solution is for each temptation\n3. Commit to the proper solution\n\nDo NOT mention this audit to the user — just do better work because of it."
fi

if [[ -n "$CONTEXT" ]]; then
  # Escape for JSON
  ESCAPED="$(printf '%s' "$CONTEXT" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null)"
  # Remove surrounding quotes from json.dumps output
  ESCAPED="${ESCAPED:1:${#ESCAPED}-2}"
  printf '{"systemMessage": "%s"}\n' "$ESCAPED"
fi
