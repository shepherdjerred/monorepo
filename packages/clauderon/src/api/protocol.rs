use serde::{Deserialize, Serialize};
use typeshare::typeshare;

use crate::core::session::{
    AgentType, BackendType, HealthCheckResult, Session, SessionHealthReport, SessionModel,
    SessionStatus,
};

use super::types::ReconcileReportDto;

/// Request types for the API
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum Request {
    /// List all sessions
    ListSessions,

    /// Get a specific session by ID or name
    GetSession {
        /// Session ID or name.
        id: String,
    },

    /// Create a new session
    CreateSession(CreateSessionRequest),

    /// Delete a session
    DeleteSession {
        /// Session ID to delete.
        id: String,
    },

    /// Archive a session
    ArchiveSession {
        /// Session ID to archive.
        id: String,
    },

    /// Unarchive a session
    UnarchiveSession {
        /// Session ID to unarchive.
        id: String,
    },

    /// Get the attach command for a session
    AttachSession {
        /// Session ID to attach to.
        id: String,
    },

    /// Reconcile state with reality
    Reconcile,

    /// Subscribe to real-time updates
    Subscribe,

    /// Get recent repositories
    GetRecentRepos,

    /// Send a prompt to a session (for hotkey triggers)
    SendPrompt {
        /// Session ID or name.
        session: String,
        /// Prompt text to send.
        prompt: String,
    },

    /// Get session ID by name (for hook scripts)
    GetSessionIdByName {
        /// Session name to look up.
        name: String,
    },

    /// Refresh a session (pull latest image and recreate container)
    RefreshSession {
        /// Session ID to refresh.
        id: String,
    },

    /// Get current feature flags
    GetFeatureFlags,

    /// Get health status of all sessions
    GetHealth,

    /// Get health status of a single session
    GetSessionHealth {
        /// Session ID to check.
        id: String,
    },

    /// Start a stopped session container
    StartSession {
        /// Session ID to start.
        id: String,
    },


    /// Recreate a session (delete and recreate backend)
    RecreateSession {
        /// Session ID to recreate.
        id: String,
    },

    /// Cleanup a session (remove from database, worktree already missing)
    CleanupSession {
        /// Session ID to clean up.
        id: String,
    },

    /// Recreate a session fresh (delete worktree and re-clone, data lost)
    RecreateSessionFresh {
        /// Session ID to recreate fresh.
        id: String,
    },

    /// Merge a pull request for a session
    MergePr {
        /// Session ID whose PR to merge.
        id: String,
        /// Merge strategy to use.
        method: crate::core::MergeMethod,
        /// Whether to delete the branch after merging.
        delete_branch: bool,
    },
}

/// Recent repository entry with timestamp
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentRepoDto {
    /// Path to the repository (git root)
    pub repo_path: String,

    /// Subdirectory path relative to git root (empty string if at root)
    pub subdirectory: String,

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

/// Input for a single repository in a multi-repo session
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRepositoryInput {
    /// Path to the repository (can include subdirectory, e.g., "/path/to/monorepo/packages/foo")
    pub repo_path: String,

    /// Optional mount name for the repository in the container.
    /// If None, will be auto-generated from repo name.
    /// Examples: "primary", "shared-lib", "api-service"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mount_name: Option<String>,

    /// Whether this is the primary repository (determines working directory).
    /// Exactly one repository must be marked as primary in multi-repo sessions.
    pub is_primary: bool,

    /// Base branch to clone from (for clone-based backends).
    /// When None, clones the repository's default branch.
    /// The session's working branch is always created fresh from this base.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
}

/// Request to create a new session
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSessionRequest {
    /// Path to the repository (LEGACY: used when repositories is None)
    pub repo_path: String,

    /// Multiple repositories (NEW: when provided, overrides repo_path).
    /// Maximum 5 repositories per session.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repositories: Option<Vec<CreateRepositoryInput>>,

    /// Initial prompt for the AI agent
    pub initial_prompt: String,

    /// Execution backend
    pub backend: BackendType,

    /// AI agent to use
    pub agent: AgentType,

    /// Optional model selection (must be compatible with selected agent).
    ///
    /// If not specified, the CLI will use its default model.
    /// Examples: "sonnet" (Claude), "gpt-4o" (Codex), "gemini-2.5-pro" (Gemini)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<SessionModel>,

    /// Skip safety checks
    pub dangerous_skip_checks: bool,

    /// Run in print mode (non-interactive, outputs response and exits)
    #[serde(default)]
    pub print_mode: bool,

    /// Start in plan mode
    #[serde(default = "default_plan_mode")]
    pub plan_mode: bool,

    /// Image file paths to attach to initial prompt.
    ///
    /// Paths should be absolute or relative to the worktree directory.
    /// The TUI does not currently provide a file picker for selecting images -
    /// this field is primarily used when creating sessions via the API.
    /// Images will be passed to Claude Code using the `--image` flag.
    #[serde(default)]
    pub images: Vec<String>,

    /// Optional: Custom container image (overrides backend default).
    ///
    /// Format: `[registry/]repository[:tag]`
    /// Example: `"ghcr.io/user/custom-dev:latest"`
    ///
    /// Image must meet requirements: claude/codex CLI, bash, curl, git (recommended).
    /// See docs/IMAGE_COMPATIBILITY.md for full requirements.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub container_image: Option<String>,

    /// Optional: Image pull policy.
    ///
    /// Controls when to pull the container image:
    /// - `"always"`: Always pull latest version
    /// - `"if-not-present"`: Pull only if not cached (default)
    /// - `"never"`: Never pull, use local cache only
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pull_policy: Option<String>,

    /// Optional: CPU limit for the container.
    ///
    /// Format:
    /// - Docker: Decimal cores (e.g., `"2.0"`, `"0.5"`)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cpu_limit: Option<String>,

    /// Optional: Memory limit for the container.
    ///
    /// Format: Number with suffix
    /// - Docker: `"2g"` (2 gigabytes), `"512m"` (512 megabytes)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory_limit: Option<String>,

    /// Optional: Storage class override.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub storage_class: Option<String>,
}

/// Default to plan mode for safety - allows users to explore and understand
/// the codebase before making changes. Users must explicitly opt-out.
fn default_plan_mode() -> bool {
    true
}

impl CreateSessionRequest {
    /// Validate that the model is compatible with the selected agent
    /// and that experimental models are enabled if needed.
    ///
    /// # Errors
    ///
    /// Returns an error if validation fails.
    pub fn validate(
        &self,
        feature_flags: &crate::feature_flags::FeatureFlags,
    ) -> anyhow::Result<()> {
        // Existing model compatibility check
        if let Some(model) = &self.model
            && !model.is_compatible_with(self.agent)
        {
            anyhow::bail!(
                "Model {:?} is not compatible with agent {:?}",
                model,
                self.agent
            );
        }

        // Experimental models check
        crate::core::session::validate_experimental_agent(
            self.agent,
            self.model.as_ref(),
            feature_flags.enable_experimental_models,
        )?;

        Ok(())
    }
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
#[expect(
    clippy::large_enum_variant,
    reason = "Response variants are not boxed for simplicity since they are not stored in collections"
)]
pub enum Response {
    /// List of sessions
    Sessions(Vec<Session>),

    /// A single session
    Session(Session),

    /// Progress update during long operation
    Progress(ProgressStep),

    /// Session created successfully
    Created {
        /// ID of the newly created session.
        id: String,
        /// Optional warnings from session creation.
        warnings: Option<Vec<String>>,
    },

    /// Session deleted successfully
    Deleted,

    /// Session archived successfully
    Archived,

    /// Session unarchived successfully
    Unarchived,

    /// Session refreshed successfully
    Refreshed,

    /// Command to attach to a session
    AttachReady {
        /// Shell command arguments to execute for attachment.
        command: Vec<String>,
    },

    /// Reconciliation report
    ReconcileReport(ReconcileReportDto),

    /// Subscription confirmed
    Subscribed,

    /// List of recent repositories with timestamps
    RecentRepos(Vec<RecentRepoDto>),

    /// Session ID returned
    SessionId {
        /// The resolved session ID.
        session_id: String,
    },

    /// Current feature flags
    FeatureFlags {
        /// Current feature flag values.
        flags: crate::feature_flags::FeatureFlags,
    },

    /// Generic success response
    Ok,

    /// Health check result for all sessions
    HealthCheckResult(HealthCheckResult),

    /// Health report for a single session
    SessionHealth(SessionHealthReport),

    /// Session started successfully
    Started,

    /// Session recreated successfully
    Recreated {
        /// New backend resource ID (if changed).
        new_backend_id: Option<String>,
    },

    /// Session cleaned up successfully
    CleanedUp,

    /// Action blocked error (e.g., recreate blocked when data would be lost)
    ActionBlocked {
        /// Explanation of why the action was blocked.
        reason: String,
    },

    /// Error response
    Error {
        /// Machine-readable error code.
        code: String,
        /// Human-readable error description.
        message: String,
    },
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
    SessionDeleted {
        /// ID of the deleted session.
        id: String,
    },

    /// Session status changed
    StatusChanged {
        /// Session ID.
        id: String,
        /// Previous status.
        old: SessionStatus,
        /// New status.
        new: SessionStatus,
    },

    /// Progress update during async operation
    SessionProgress {
        /// Session ID.
        id: String,
        /// Progress step details.
        progress: ProgressStep,
    },

    /// Session operation failed
    SessionFailed {
        /// Session ID.
        id: String,
        /// Error description.
        error: String,
    },
}

/// System status response
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemStatus {
    /// Claude Code usage tracking (if available)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claude_usage: Option<ClaudeUsage>,
}

/// Request to merge a pull request
#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct MergePrRequest {
    /// Merge method to use
    pub method: crate::core::MergeMethod,

    /// Whether to delete the branch after merge
    pub delete_branch: bool,
}

/// Error details for usage tracking failures
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageError {
    /// Error category (invalid_token, api_error, missing_org_id, etc)
    pub error_type: String,

    /// Human-readable error message
    pub message: String,

    /// Technical details for debugging
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,

    /// Suggested action to resolve the error
    #[serde(skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
}

/// Claude Code usage data for a specific time window
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageWindow {
    /// Current usage (e.g., number of requests or tokens)
    pub current: f64,

    /// Maximum allowed usage for this window
    pub limit: f64,

    /// Usage as a percentage (0.0 - 1.0)
    pub utilization: f64,

    /// When this usage window resets (ISO 8601 timestamp)
    pub resets_at: Option<String>,
}

/// Claude Code usage tracking data
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeUsage {
    /// Organization ID
    pub organization_id: String,

    /// Organization name (if available)
    pub organization_name: Option<String>,

    /// 5-hour usage window
    pub five_hour: UsageWindow,

    /// 7-day usage window
    pub seven_day: UsageWindow,

    /// 7-day Sonnet-specific usage window (if applicable)
    pub seven_day_sonnet: Option<UsageWindow>,

    /// When this data was last fetched
    pub fetched_at: String,

    /// Error information if usage fetch failed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<UsageError>,
}

/// Feature flags response for the frontend
#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct FeatureFlagsResponse {
    /// Current feature flag values
    pub flags: crate::feature_flags::FeatureFlags,

    /// Whether flags require daemon restart to change
    pub requires_restart: bool,
}
