#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/setup-tools.sh"

install_base
install_gh

# Install Node.js + Claude CLI
echo "--- :robot_face: Installing Claude Code CLI"
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - > /dev/null 2>&1
apt-get install -y -qq nodejs > /dev/null
npm install -g @anthropic-ai/claude-code > /dev/null 2>&1
claude --version

# Validate required env vars
: "${PR_NUMBER:?Required}"
: "${COMMENT_BODY:?Required}"
: "${GH_TOKEN:?Required}"
: "${CLAUDE_CODE_OAUTH_TOKEN:?Required}"

echo "+++ :robot_face: Running interactive Claude review"

# Post acknowledgment
gh pr comment "${PR_NUMBER}" \
  --repo shepherdjerred/monorepo \
  --body "🤖 Processing your request..." || true

# Build context for the prompt
CONTEXT=""
if [ -n "${COMMENT_PATH:-}" ]; then
  CONTEXT="Context: This comment is on file \`${COMMENT_PATH}\`"
  if [ -n "${COMMENT_LINE:-}" ] && [ "${COMMENT_LINE}" != "0" ]; then
    CONTEXT="${CONTEXT} at line ${COMMENT_LINE}"
  fi
  if [ -n "${COMMENT_DIFF_HUNK:-}" ]; then
    CONTEXT="${CONTEXT}

Diff context:
\`\`\`diff
${COMMENT_DIFF_HUNK}
\`\`\`"
  fi
fi

# Run Claude CLI directly
RESPONSE=$(claude --print \
  --dangerously-skip-permissions \
  --model claude-opus-4-6 \
  --max-turns 35 \
  "Respond to this comment on PR #${PR_NUMBER} in shepherdjerred/monorepo:

${COMMENT_BODY}

${CONTEXT}

Read CLAUDE.md and relevant code for context. Be direct and concise.")

# Post response (truncate if needed)
if [ ${#RESPONSE} -gt 64000 ]; then
  RESPONSE="${RESPONSE:0:64000}

... (output truncated)"
fi

gh pr comment "${PR_NUMBER}" \
  --repo shepherdjerred/monorepo \
  --body "${RESPONSE}"
