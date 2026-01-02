#!/usr/bin/env bash
# Install Claude Code hooks for clauderon status tracking

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_SETTINGS="${HOME}/.claude/settings.json"

# Ensure .claude directory exists
mkdir -p "${HOME}/.claude"

# Create/update settings.json with hooks
cat > "$CLAUDE_SETTINGS" <<'EOF'
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ["bash", "-c", "${HOME}/.clauderon/hooks/send_status.sh UserPromptSubmit"]
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": ["bash", "-c", "${HOME}/.clauderon/hooks/send_status.sh PreToolUse"]
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": ["bash", "-c", "${HOME}/.clauderon/hooks/send_status.sh PermissionRequest"]
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ["bash", "-c", "${HOME}/.clauderon/hooks/send_status.sh Stop"]
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": {
          "notification_type": "idle_prompt"
        },
        "hooks": [
          {
            "type": "command",
            "command": ["bash", "-c", "${HOME}/.clauderon/hooks/send_status.sh IdlePrompt"]
          }
        ]
      }
    ]
  }
}
EOF

# Create hooks directory in ~/.clauderon if it doesn't exist
mkdir -p "${HOME}/.clauderon/hooks"

# Copy hook script to ~/.clauderon/hooks
cp "$HOOK_DIR/send_status.sh" "${HOME}/.clauderon/hooks/send_status.sh"
chmod +x "${HOME}/.clauderon/hooks/send_status.sh"

echo "✓ Claude Code hooks installed to $CLAUDE_SETTINGS"
echo "✓ Hook script copied to ${HOME}/.clauderon/hooks/send_status.sh"
echo ""
echo "Clauderon status tracking is now active!"
echo "Claude's working status will be displayed in the session manager TUI."
