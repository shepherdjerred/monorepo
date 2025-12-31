use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use crate::core::session::{AccessMode, AgentType, BackendType, Session, SessionStatus};

use super::types::ReconcileReportDto;

/// Request types for the API
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum Request {
    /// List all sessions
    ListSessions,

    /// Get a specific session by ID or name
    GetSession { id: String },

    /// Create a new session
    CreateSession(CreateSessionRequest),

    /// Delete a session
    DeleteSession { id: String },

    /// Archive a session
    ArchiveSession { id: String },

    /// Get the attach command for a session
    AttachSession { id: String },

    /// Update session access mode
    UpdateAccessMode { id: String, access_mode: AccessMode },

    /// Reconcile state with reality
    Reconcile,

    /// Subscribe to real-time updates
    Subscribe,
}

/// Request to create a new session
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSessionRequest {
    /// Session name (a random suffix will be added)
    pub name: String,

    /// Path to the repository
    pub repo_path: String,

    /// Initial prompt for the AI agent
    pub initial_prompt: String,

    /// Execution backend
    pub backend: BackendType,

    /// AI agent to use
    pub agent: AgentType,

    /// Skip safety checks
    pub dangerous_skip_checks: bool,

    /// Run in print mode (non-interactive, outputs response and exits)
    #[serde(default)]
    pub print_mode: bool,

    /// Access mode for proxy filtering
    #[serde(default)]
    pub access_mode: AccessMode,
}

/// Progress step during session creation
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressStep {
    /// Current step number (1-indexed)
    pub step: u32,
    /// Total number of steps
    pub total: u32,
    /// Description of current step
    pub message: String,
}

/// Response types for the API
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum Response {
    /// List of sessions
    Sessions(Vec<Session>),

    /// A single session
    Session(Session),

    /// Progress update during long operation
    Progress(ProgressStep),

    /// Session created successfully
    Created {
        id: String,
        warnings: Option<Vec<String>>,
    },

    /// Session deleted successfully
    Deleted,

    /// Session archived successfully
    Archived,

    /// Command to attach to a session
    AttachReady { command: Vec<String> },

    /// Reconciliation report
    ReconcileReport(ReconcileReportDto),

    /// Subscription confirmed
    Subscribed,

    /// Access mode updated successfully
    AccessModeUpdated,

    /// Error response
    Error { code: String, message: String },
}

/// Real-time events from the server
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum Event {
    /// A new session was created
    SessionCreated(Session),

    /// A session was updated
    SessionUpdated(Session),

    /// A session was deleted
    SessionDeleted { id: String },

    /// Session status changed
    StatusChanged {
        id: String,
        old: SessionStatus,
        new: SessionStatus,
    },
}
