use anyhow::{Context, Result};
use tokio::process::Command;

const SETTINGS_JSON_CONTENT: &str = r#"{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c '/workspace/.clauderon/hooks/send_status.sh UserPromptSubmit'"
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
            "command": "bash -c '/workspace/.clauderon/hooks/send_status.sh PreToolUse'"
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
            "command": "bash -c '/workspace/.clauderon/hooks/send_status.sh PermissionRequest'"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c '/workspace/.clauderon/hooks/send_status.sh Stop'"
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c '/workspace/.clauderon/hooks/send_status.sh IdlePrompt'"
          }
        ]
      }
    ]
  }
}"#;

const SEND_STATUS_SCRIPT: &str = r#"#!/usr/bin/env bash
# Send hook event to clauderon daemon
# Usage: send_status.sh <event_type>

set -euo pipefail

EVENT_TYPE="$1"

# Validate HOME is set
if [ -z "${HOME:-}" ]; then
    exit 0
fi

HOOKS_SOCKET="${HOME}/.clauderon/hooks.sock"
DAEMON_SOCKET="${HOME}/.clauderon/clauderon.sock"

# Validate sockets exist
if [ ! -S "$HOOKS_SOCKET" ]; then
    # Hooks socket doesn't exist yet (daemon not started), exit silently
    exit 0
fi

if [ ! -S "$DAEMON_SOCKET" ]; then
    # Daemon socket doesn't exist, exit silently
    exit 0
fi

# Extract session name from worktree path
# Worktree path format: ~/.clauderon/worktrees/<session-name>
# CLAUDE_CWD is provided by Claude Code hooks
WORKTREE_PATH="${CLAUDE_CWD:-}"

if [ -z "$WORKTREE_PATH" ]; then
    # Not running in Claude Code context, exit silently
    exit 0
fi

# Check if this is a clauderon worktree
if [[ "$WORKTREE_PATH" != *"/.clauderon/worktrees/"* ]]; then
    # Not a clauderon session, exit silently
    exit 0
fi

# Parse session name from path (last component)
SESSION_NAME=$(basename "$WORKTREE_PATH")

# Query daemon for session ID by name
# Using the Unix socket API
SESSION_ID=$(echo '{"type":"GetSessionIdByName","payload":{"name":"'"$SESSION_NAME"'"}}' | \
    nc -U "$DAEMON_SOCKET" 2>/dev/null | \
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
echo "$MESSAGE" | timeout 1s nc -U "$HOOKS_SOCKET" 2>/dev/null || true

exit 0
"#;

/// Install Claude Code hooks inside a Docker container
///
/// This function:
/// 1. Creates the hooks directory inside the container
/// 2. Writes the send_status.sh script
/// 3. Writes the Claude Code settings.json with hook definitions
///
/// # Errors
///
/// Returns an error if:
/// - Docker exec commands fail
/// - File creation inside container fails
pub async fn install_hooks_in_container(container_name: &str) -> Result<()> {
    tracing::info!(
        container = container_name,
        "Installing Claude Code hooks in container"
    );

    // Create hooks directory
    let output = Command::new("docker")
        .args([
            "exec",
            container_name,
            "mkdir",
            "-p",
            "/workspace/.clauderon/hooks",
        ])
        .output()
        .await
        .context("Failed to execute docker exec mkdir")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!(
            container = container_name,
            stderr = %stderr,
            "Failed to create hooks directory in container (non-fatal)"
        );
    }

    // Write send_status.sh script
    let output = Command::new("docker")
        .args([
            "exec",
            container_name,
            "bash",
            "-c",
            &format!(
                "cat > /workspace/.clauderon/hooks/send_status.sh << 'OUTER_EOF'\n{}\nOUTER_EOF",
                SEND_STATUS_SCRIPT
            ),
        ])
        .output()
        .await
        .context("Failed to write send_status.sh")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!(
            container = container_name,
            stderr = %stderr,
            "Failed to write send_status.sh (non-fatal)"
        );
    }

    // Make send_status.sh executable
    let output = Command::new("docker")
        .args([
            "exec",
            container_name,
            "chmod",
            "+x",
            "/workspace/.clauderon/hooks/send_status.sh",
        ])
        .output()
        .await
        .context("Failed to chmod send_status.sh")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!(
            container = container_name,
            stderr = %stderr,
            "Failed to chmod send_status.sh (non-fatal)"
        );
    }

    // Create .claude directory
    let output = Command::new("docker")
        .args(["exec", container_name, "mkdir", "-p", "/workspace/.claude"])
        .output()
        .await
        .context("Failed to create .claude directory")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::warn!(
            container = container_name,
            stderr = %stderr,
            "Failed to create .claude directory (non-fatal)"
        );
    }

    // Write settings.json
    let output = Command::new("docker")
        .args([
            "exec",
            container_name,
            "bash",
            "-c",
            &format!(
                "cat > /workspace/.claude/settings.json << 'EOF'\n{}\nEOF",
                SETTINGS_JSON_CONTENT
            ),
        ])
        .output()
        .await
        .context("Failed to write settings.json")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        tracing::error!(
            container = container_name,
            stderr = %stderr,
            "Failed to write settings.json"
        );
        return Err(anyhow::anyhow!(
            "Failed to install hooks: could not write settings.json"
        ));
    }

    tracing::info!(
        container = container_name,
        "Successfully installed Claude Code hooks"
    );

    Ok(())
}
