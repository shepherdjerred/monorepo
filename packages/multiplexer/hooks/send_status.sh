#!/usr/bin/env bash
# Send hook event to multiplexer daemon
# Usage: send_status.sh <event_type>

set -euo pipefail

EVENT_TYPE="$1"
SOCKET_PATH="${HOME}/.multiplexer/hooks.sock"

# Extract session name from worktree path
# Worktree path format: ~/.multiplexer/worktrees/<session-name>
# CLAUDE_CWD is provided by Claude Code hooks
WORKTREE_PATH="${CLAUDE_CWD:-}"

if [ -z "$WORKTREE_PATH" ]; then
    # Not running in Claude Code context, exit silently
    exit 0
fi

# Check if this is a multiplexer worktree
if [[ "$WORKTREE_PATH" != *"/.multiplexer/worktrees/"* ]]; then
    # Not a multiplexer session, exit silently
    exit 0
fi

# Parse session name from path (last component)
SESSION_NAME=$(basename "$WORKTREE_PATH")

# Query daemon for session ID by name
# Using the Unix socket API
SESSION_ID=$(echo '{"type":"GetSessionIdByName","payload":{"name":"'"$SESSION_NAME"'"}}' | \
    nc -U "${HOME}/.multiplexer/mux.sock" 2>/dev/null | \
    jq -r '.payload.session_id // empty' 2>/dev/null)

if [ -z "$SESSION_ID" ]; then
    # Session not found in daemon, exit silently
    exit 0
fi

# Build hook message
MESSAGE=$(cat <<EOF
{
  "session_id": "$SESSION_ID",
  "event": {"type": "$EVENT_TYPE"},
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
)

# Send to hook socket (with timeout)
echo "$MESSAGE" | timeout 1s nc -U "$SOCKET_PATH" 2>/dev/null || true

exit 0
