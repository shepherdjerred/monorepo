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
# Send hook event to clauderon daemon via HTTP
# Usage: send_status.sh <event_type>
#
# Required env vars (set by clauderon for Docker backend):
#   CLAUDERON_SESSION_ID - UUID of the session
#   CLAUDERON_HTTP_PORT - HTTP port of the daemon
#
# Note: This script uses host.docker.internal which only works with Docker.
# For Kubernetes, a different mechanism would be needed (e.g., Service discovery).

set -euo pipefail

EVENT_TYPE="$1"

# Check if running with HTTP transport (Docker/K8s mode)
# These env vars are set by clauderon when creating containers
if [ -z "${CLAUDERON_SESSION_ID:-}" ] || [ -z "${CLAUDERON_HTTP_PORT:-}" ]; then
    # Not running in a clauderon-managed container, exit silently
    exit 0
fi

# Build hook message
MESSAGE=$(cat <<EOF
{
  "session_id": "$CLAUDERON_SESSION_ID",
  "event": {"type": "$EVENT_TYPE"},
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
)

# Send via HTTP to host (curl is available in our container images)
# Use host.docker.internal which works for both Docker Desktop and OrbStack
curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "$MESSAGE" \
    "http://host.docker.internal:${CLAUDERON_HTTP_PORT}/api/hooks" \
    --connect-timeout 2 \
    --max-time 5 \
    >/dev/null 2>&1 || true

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

/// Generate the send_status.sh script for a remote backend
///
/// Unlike Docker which uses `host.docker.internal`, remote backends
/// use the configured `daemon_address` to reach the daemon.
fn generate_remote_send_status_script(daemon_address: &str, http_port: u16) -> String {
    format!(
        r#"#!/usr/bin/env bash
# Send hook event to clauderon daemon via HTTP
# Usage: send_status.sh <event_type>
#
# This script is configured for remote backends (Sprites, Kubernetes)
# using the daemon address: {daemon_address}
#
# Required env var (set by clauderon):
#   CLAUDERON_SESSION_ID - UUID of the session

set -euo pipefail

EVENT_TYPE="$1"

# Check if session ID is set
if [ -z "${{CLAUDERON_SESSION_ID:-}}" ]; then
    # Not running in a clauderon-managed environment, exit silently
    exit 0
fi

# Build hook message
MESSAGE=$(cat <<EOF
{{
  "session_id": "$CLAUDERON_SESSION_ID",
  "event": {{"type": "$EVENT_TYPE"}},
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}}
EOF
)

# Send via HTTP to daemon (using configured daemon address)
curl -s -X POST \
    -H "Content-Type: application/json" \
    -d "$MESSAGE" \
    "http://{daemon_address}:{http_port}/api/hooks" \
    --connect-timeout 2 \
    --max-time 5 \
    >/dev/null 2>&1 || true

exit 0
"#,
        daemon_address = daemon_address,
        http_port = http_port
    )
}

/// Generate the settings.json for sprites (uses /home/sprite/workspace)
fn generate_sprites_settings_json() -> &'static str {
    r#"{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash -c '/home/sprite/workspace/.clauderon/hooks/send_status.sh UserPromptSubmit'"
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
            "command": "bash -c '/home/sprite/workspace/.clauderon/hooks/send_status.sh PreToolUse'"
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
            "command": "bash -c '/home/sprite/workspace/.clauderon/hooks/send_status.sh PermissionRequest'"
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
            "command": "bash -c '/home/sprite/workspace/.clauderon/hooks/send_status.sh Stop'"
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
            "command": "bash -c '/home/sprite/workspace/.clauderon/hooks/send_status.sh IdlePrompt'"
          }
        ]
      }
    ]
  }
}"#
}

/// Hook installation result for sprites
pub struct SpritesHookInstallResult {
    /// Commands to execute in the sprite to install hooks
    pub commands: Vec<Vec<String>>,
}

/// Generate hook installation commands for a sprite
///
/// Returns commands that should be executed in the sprite using `sprite_exec`.
/// Call this when `daemon_address` is configured (connected mode).
///
/// For disconnected mode (`--dangerous-copy-creds`), hooks are not installed
/// and status tracking is limited.
#[must_use]
pub fn generate_sprites_hook_commands(
    daemon_address: &str,
    http_port: u16,
    session_id: &str,
) -> SpritesHookInstallResult {
    let send_status_script = generate_remote_send_status_script(daemon_address, http_port);
    let settings_json = generate_sprites_settings_json();

    let commands = vec![
        // Create hooks directory
        vec![
            "mkdir".to_string(),
            "-p".to_string(),
            "/home/sprite/workspace/.clauderon/hooks".to_string(),
        ],
        // Write send_status.sh
        vec![
            "sh".to_string(),
            "-c".to_string(),
            format!(
                "cat > /home/sprite/workspace/.clauderon/hooks/send_status.sh << 'OUTER_EOF'\n{}\nOUTER_EOF",
                send_status_script
            ),
        ],
        // Make executable
        vec![
            "chmod".to_string(),
            "+x".to_string(),
            "/home/sprite/workspace/.clauderon/hooks/send_status.sh".to_string(),
        ],
        // Create .claude directory
        vec![
            "mkdir".to_string(),
            "-p".to_string(),
            "/home/sprite/workspace/.claude".to_string(),
        ],
        // Write settings.json
        vec![
            "sh".to_string(),
            "-c".to_string(),
            format!(
                "cat > /home/sprite/workspace/.claude/settings.json << 'EOF'\n{}\nEOF",
                settings_json
            ),
        ],
        // Set session ID environment variable in bashrc
        vec![
            "sh".to_string(),
            "-c".to_string(),
            format!(
                "echo 'export CLAUDERON_SESSION_ID=\"{}\"' >> ~/.bashrc",
                session_id
            ),
        ],
    ];

    SpritesHookInstallResult { commands }
}
