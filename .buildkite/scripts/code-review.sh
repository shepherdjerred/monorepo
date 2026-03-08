#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/setup-tools.sh"

install_base
install_node
install_gh

# Install Claude Code CLI
# renovate: datasource=npm depName=@anthropic-ai/claude-code
CLAUDE_CODE_VERSION="2.1.71"
echo "--- :robot_face: Installing Claude Code CLI ${CLAUDE_CODE_VERSION}"
bun add -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" > /dev/null 2>&1
claude --version

# Validate required env vars
: "${BUILDKITE_PULL_REQUEST:?Required}"
: "${BUILDKITE_PULL_REQUEST_BASE_BRANCH:?Required}"
: "${BUILDKITE_COMMIT:?Required}"
: "${GH_TOKEN:?Required}"
: "${CLAUDE_CODE_OAUTH_TOKEN:?Required}"

echo "+++ :robot_face: Running code review"

# Run Claude CLI directly for PR review
claude --print \
  --dangerously-skip-permissions \
  --model claude-opus-4-6 \
  --max-turns 35 \
  "Review PR #${BUILDKITE_PULL_REQUEST} on branch ${BUILDKITE_PULL_REQUEST_BASE_BRANCH} (head SHA: ${BUILDKITE_COMMIT}).

Read the CLAUDE.md file first for project context.

Use gh CLI to inspect the PR diff and details:
  gh pr view ${BUILDKITE_PULL_REQUEST} --repo shepherdjerred/monorepo
  gh pr diff ${BUILDKITE_PULL_REQUEST} --repo shepherdjerred/monorepo

Review this PR focusing on things linters and typecheckers can't catch:
- Functionality: Does the code actually do what the PR claims?
- Architectural fit: Does this change fit the codebase patterns?
- Logic errors: Are there bugs, race conditions, or edge cases?
- Security: Any vulnerabilities that static analysis would miss?
- Design: Is this the right approach? Are there simpler alternatives?

After reviewing, post your review using gh CLI:
  gh pr review ${BUILDKITE_PULL_REQUEST} --repo shepherdjerred/monorepo --approve --body 'your review'
  OR
  gh pr review ${BUILDKITE_PULL_REQUEST} --repo shepherdjerred/monorepo --request-changes --body 'your review'

Be direct and concise. If the PR is trivial (pure merge/rebase with minimal changes), approve with a brief note."
