/// Hook installer for Docker and sprite containers.
pub mod installer;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub use installer::install_hooks_in_container;

/// Message sent from Claude Code hooks to the daemon
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookMessage {
    /// Session ID (parsed from worktree path or .claude/settings.json)
    pub session_id: Uuid,

    /// Hook event that triggered this message
    pub event: HookEvent,

    /// Timestamp of the hook execution
    pub timestamp: chrono::DateTime<chrono::Utc>,
}

/// Events sent from Claude Code hooks to the daemon.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum HookEvent {
    /// User submitted a prompt - Claude is about to start working
    UserPromptSubmit,

    /// Claude is about to use a tool - actively working
    PreToolUse {
        /// Name of the tool being invoked.
        tool_name: String,
    },

    /// Claude needs permission - waiting for approval
    PermissionRequest,

    /// Claude finished responding - now idle
    Stop,

    /// Idle notification - Claude waiting for input 60+ seconds
    IdlePrompt,
}

impl HookMessage {
    /// Create a new hook message
    #[must_use]
    pub fn new(session_id: Uuid, event: HookEvent) -> Self {
        Self {
            session_id,
            event,
            timestamp: chrono::Utc::now(),
        }
    }
}
