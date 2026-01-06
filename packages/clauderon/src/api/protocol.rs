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

    /// Get recent repositories
    GetRecentRepos,

    /// Send a prompt to a session (for hotkey triggers)
    SendPrompt { session: String, prompt: String },

    /// Get session ID by name (for hook scripts)
    GetSessionIdByName { name: String },
}

/// Recent repository entry with timestamp
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentRepoDto {
    /// Path to the repository
    pub repo_path: String,

    /// When this repository was last used (ISO 8601 timestamp)
    pub last_used: String,
}

/// Request to browse a directory on the daemon's filesystem
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowseDirectoryRequest {
    /// Path to the directory to browse
    pub path: String,
}

/// A single directory entry
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectoryEntryDto {
    /// Directory name
    pub name: String,

    /// Absolute path to the directory
    pub path: String,

    /// Whether the directory can be read
    pub is_accessible: bool,
}

/// Response from browsing a directory
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowseDirectoryResponse {
    /// Current directory path (normalized absolute path)
    pub current_path: String,

    /// Parent directory path (None if at filesystem root)
    pub parent_path: Option<String>,

    /// List of subdirectories in the current directory
    pub entries: Vec<DirectoryEntryDto>,

    /// Error message if path doesn't exist or permission denied
    pub error: Option<String>,
}

/// Request to create a new session
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSessionRequest {
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

    /// Start in plan mode
    #[serde(default = "default_plan_mode")]
    pub plan_mode: bool,

    /// Access mode for proxy filtering
    #[serde(default)]
    pub access_mode: AccessMode,

    /// Image file paths to attach to initial prompt.
    ///
    /// Paths should be absolute or relative to the worktree directory.
    /// The TUI does not currently provide a file picker for selecting images -
    /// this field is primarily used when creating sessions via the API.
    /// Images will be passed to Claude Code using the `--image` flag.
    #[serde(default)]
    pub images: Vec<String>,
}

/// Default to plan mode for safety - allows users to explore and understand
/// the codebase before making changes. Users must explicitly opt-out.
fn default_plan_mode() -> bool {
    true
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

/// Response from uploading an image file
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadResponse {
    /// Absolute path to the uploaded file
    pub path: String,
    /// Size of the uploaded file in bytes
    pub size: u32,
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

    /// List of recent repositories with timestamps
    RecentRepos(Vec<RecentRepoDto>),

    /// Access mode updated successfully
    AccessModeUpdated,

    /// Session ID returned
    SessionId { session_id: String },

    /// Generic success response
    Ok,

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

    /// Progress update during async operation
    SessionProgress { id: String, progress: ProgressStep },

    /// Session operation failed
    SessionFailed { id: String, error: String },
}

/// Credential availability status
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialStatus {
    /// Human-readable credential name (e.g., "GitHub", "Anthropic")
    pub name: String,

    /// Service identifier for updates (e.g., "github", "anthropic")
    pub service_id: String,

    /// Whether the credential is available
    pub available: bool,

    /// Source of credential if available ("environment" or "file")
    pub source: Option<String>,

    /// Whether the credential is readonly (from environment)
    pub readonly: bool,

    /// Optional masked preview like "ghp_****...abc123"
    pub masked_value: Option<String>,
}

/// Proxy status information
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyStatus {
    /// Proxy name (e.g., "HTTP Auth Proxy", "Kubernetes Proxy")
    pub name: String,

    /// Port number the proxy is running on
    pub port: u16,

    /// Whether the proxy is currently active
    pub active: bool,

    /// Proxy type ("global" or "session-specific")
    pub proxy_type: String,
}

/// System status response including credentials and proxies
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStatus {
    /// List of credential statuses
    pub credentials: Vec<CredentialStatus>,

    /// List of proxy statuses
    pub proxies: Vec<ProxyStatus>,

    /// Total number of active sessions with proxies
    pub active_session_proxies: u32,
}

/// Request to update a credential
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCredentialRequest {
    /// Service identifier (e.g., "github", "anthropic")
    pub service_id: String,

    /// The credential token/key value
    pub value: String,
}
