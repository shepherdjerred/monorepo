use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use typeshare::typeshare;
use uuid::Uuid;

use super::session::{BackendType, ClaudeWorkingStatus, Session, SessionStatus};

/// Event representing a state change in the system (database model)
/// Note: This is not exported to TypeScript. For WebSocket events, see api::protocol::Event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    /// Unique event ID
    pub id: i64,

    /// Session this event relates to
    pub session_id: Uuid,

    /// Type of event
    pub event_type: EventType,

    /// When the event occurred
    pub timestamp: DateTime<Utc>,
}

/// Types of events that can occur
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum EventType {
    /// A new session was created
    SessionCreated {
        name: String,
        repo_path: String,
        backend: BackendType,
        initial_prompt: String,
    },

    /// Session status changed
    StatusChanged {
        old_status: SessionStatus,
        new_status: SessionStatus,
    },

    /// Backend ID was set
    BackendIdSet { backend_id: String },

    /// PR was linked to session
    PrLinked { pr_url: String },

    /// PR check status changed
    CheckStatusChanged {
        old_status: Option<super::session::CheckStatus>,
        new_status: super::session::CheckStatus,
    },

    /// Claude working status changed
    ClaudeStatusChanged {
        old_status: ClaudeWorkingStatus,
        new_status: ClaudeWorkingStatus,
    },

    /// Merge conflict status changed
    ConflictStatusChanged { has_conflict: bool },

    /// Working tree status changed (dirty/clean)
    WorktreeStatusChanged { is_dirty: bool },

    /// Session was archived
    SessionArchived,

    /// Session was deleted
    SessionDeleted { reason: Option<String> },

    /// Session was restored from archive
    SessionRestored,
}

impl Event {
    /// Create a new event
    #[must_use]
    pub fn new(session_id: Uuid, event_type: EventType) -> Self {
        Self {
            id: 0, // Will be set by the database
            session_id,
            event_type,
            timestamp: Utc::now(),
        }
    }
}

/// Replay events to reconstruct session state
#[must_use]
pub fn replay_events(events: &[Event]) -> Option<Session> {
    if events.is_empty() {
        return None;
    }

    // Find the creation event
    let creation_event = events
        .iter()
        .find(|e| matches!(e.event_type, EventType::SessionCreated { .. }))?;

    let EventType::SessionCreated {
        name,
        repo_path,
        backend,
        initial_prompt,
    } = &creation_event.event_type
    else {
        return None;
    };

    // Create base session from creation event
    let worktree_path = crate::utils::paths::worktree_path(name);
    let mut session = Session::new(super::session::SessionConfig {
        name: name.clone(),
        title: None,
        description: None,
        repo_path: repo_path.clone().into(),
        worktree_path,
        subdirectory: std::path::PathBuf::new(),
        branch_name: name.clone(),
        initial_prompt: initial_prompt.clone(),
        backend: *backend,
        agent: super::session::AgentType::ClaudeCode,
        dangerous_skip_checks: false,
        access_mode: Default::default(),
    });

    // Apply all subsequent events
    for event in events {
        if event.session_id != creation_event.session_id {
            continue;
        }

        match &event.event_type {
            EventType::StatusChanged { new_status, .. } => {
                session.set_status(*new_status);
            }
            EventType::BackendIdSet { backend_id } => {
                session.set_backend_id(backend_id.clone());
            }
            EventType::PrLinked { pr_url } => {
                session.set_pr_url(pr_url.clone());
            }
            EventType::CheckStatusChanged { new_status, .. } => {
                session.set_check_status(*new_status);
            }
            EventType::ClaudeStatusChanged { new_status, .. } => {
                session.set_claude_status(*new_status);
            }
            EventType::ConflictStatusChanged { has_conflict } => {
                session.set_merge_conflict(*has_conflict);
            }
            EventType::WorktreeStatusChanged { is_dirty } => {
                session.set_worktree_dirty(*is_dirty);
            }
            EventType::SessionArchived => {
                session.set_status(super::session::SessionStatus::Archived);
            }
            EventType::SessionDeleted { .. } => {
                // Session is deleted, return None or mark as deleted
                return None;
            }
            EventType::SessionRestored => {
                // Unarchive the session
                if session.status == super::session::SessionStatus::Archived {
                    session.set_status(super::session::SessionStatus::Idle);
                }
            }
            EventType::SessionCreated { .. } => {
                // Already handled above
            }
        }
    }

    Some(session)
}
