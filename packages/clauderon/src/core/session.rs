use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use typeshare::typeshare;
use uuid::Uuid;

use crate::api::protocol::ProgressStep;

/// Represents a single AI coding session
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    /// Unique identifier
    #[typeshare(serialized_as = "String")]
    pub id: Uuid,

    /// Human-friendly name (user-provided + random suffix)
    pub name: String,

    /// AI-generated title for display (optional, falls back to name)
    pub title: Option<String>,

    /// AI-generated description of the task (optional)
    pub description: Option<String>,

    /// Current status of the session
    pub status: SessionStatus,

    /// Execution backend
    pub backend: BackendType,

    /// AI agent running in this session
    pub agent: AgentType,

    /// Path to the source repository
    #[typeshare(serialized_as = "String")]
    pub repo_path: PathBuf,

    /// Path to the git worktree
    #[typeshare(serialized_as = "String")]
    pub worktree_path: PathBuf,

    /// Subdirectory path relative to git root (empty if at root)
    /// Example: "packages/clauderon" for a subdirectory session
    #[typeshare(serialized_as = "String")]
    pub subdirectory: PathBuf,

    /// Git branch name
    pub branch_name: String,

    /// Backend-specific identifier (zellij session name, docker container id, or kubernetes pod name)
    pub backend_id: Option<String>,

    /// Initial prompt given to the AI agent
    pub initial_prompt: String,

    /// Whether to skip safety checks
    pub dangerous_skip_checks: bool,

    /// URL of the associated pull request
    pub pr_url: Option<String>,

    /// Status of PR checks
    pub pr_check_status: Option<CheckStatus>,

    /// Current Claude agent working status (from hooks)
    pub claude_status: ClaudeWorkingStatus,

    /// Timestamp of last Claude status update
    #[typeshare(serialized_as = "String")]
    pub claude_status_updated_at: Option<DateTime<Utc>>,

    /// Whether the session branch has merge conflicts with main
    pub merge_conflict: bool,

    /// Access mode for proxy filtering
    pub access_mode: AccessMode,

    /// Port for session-specific HTTP proxy (Docker only)
    pub proxy_port: Option<u16>,

    /// Path to Claude Code's session history file (.jsonl)
    #[typeshare(serialized_as = "String")]
    pub history_file_path: Option<PathBuf>,

    /// Number of times we've attempted to recreate the container
    pub reconcile_attempts: u32,

    /// Last reconciliation error message
    pub last_reconcile_error: Option<String>,

    /// When the last reconciliation attempt occurred
    #[typeshare(serialized_as = "String")]
    pub last_reconcile_at: Option<DateTime<Utc>>,

    /// Error message if status is Failed (None otherwise)
    pub error_message: Option<String>,

    /// Current operation progress (for Creating/Deleting states)
    pub progress: Option<ProgressStep>,

    /// When the session was created
    #[typeshare(serialized_as = "String")]
    pub created_at: DateTime<Utc>,

    /// When the session was last updated
    #[typeshare(serialized_as = "String")]
    pub updated_at: DateTime<Utc>,
}

/// Configuration for creating a new session
pub struct SessionConfig {
    /// Human-friendly name
    pub name: String,
    /// AI-generated title for display (optional)
    pub title: Option<String>,
    /// AI-generated description of the task (optional)
    pub description: Option<String>,
    /// Path to the source repository
    pub repo_path: PathBuf,
    /// Path to the git worktree
    pub worktree_path: PathBuf,
    /// Subdirectory path relative to git root (empty if at root)
    pub subdirectory: PathBuf,
    /// Git branch name
    pub branch_name: String,
    /// Initial prompt given to the AI agent
    pub initial_prompt: String,
    /// Execution backend
    pub backend: BackendType,
    /// AI agent type
    pub agent: AgentType,
    /// Whether to skip safety checks
    pub dangerous_skip_checks: bool,
    /// Access mode for proxy filtering
    pub access_mode: AccessMode,
}

impl Session {
    /// Create a new session with default values
    #[must_use]
    pub fn new(config: SessionConfig) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            name: config.name,
            title: config.title,
            description: config.description,
            status: SessionStatus::Creating,
            backend: config.backend,
            agent: config.agent,
            repo_path: config.repo_path,
            worktree_path: config.worktree_path,
            subdirectory: config.subdirectory,
            branch_name: config.branch_name,
            backend_id: None,
            initial_prompt: config.initial_prompt,
            dangerous_skip_checks: config.dangerous_skip_checks,
            pr_url: None,
            pr_check_status: None,
            claude_status: ClaudeWorkingStatus::Unknown,
            claude_status_updated_at: None,
            merge_conflict: false,
            access_mode: config.access_mode,
            proxy_port: None,
            history_file_path: None,
            reconcile_attempts: 0,
            last_reconcile_error: None,
            last_reconcile_at: None,
            error_message: None,
            progress: None,
            created_at: now,
            updated_at: now,
        }
    }

    /// Update the session status
    pub fn set_status(&mut self, status: SessionStatus) {
        self.status = status;
        self.updated_at = Utc::now();
    }

    /// Set the backend identifier
    pub fn set_backend_id(&mut self, backend_id: String) {
        self.backend_id = Some(backend_id);
        self.updated_at = Utc::now();
    }

    /// Set the PR URL
    pub fn set_pr_url(&mut self, url: String) {
        self.pr_url = Some(url);
        self.updated_at = Utc::now();
    }

    /// Update PR check status
    pub fn set_check_status(&mut self, status: CheckStatus) {
        self.pr_check_status = Some(status);
        self.updated_at = Utc::now();
    }

    /// Set the Claude working status
    pub fn set_claude_status(&mut self, status: ClaudeWorkingStatus) {
        self.claude_status = status;
        self.claude_status_updated_at = Some(Utc::now());
        self.updated_at = Utc::now();
    }

    /// Update access mode
    pub fn set_access_mode(&mut self, mode: AccessMode) {
        self.access_mode = mode;
        self.updated_at = Utc::now();
    }

    /// Set the session title
    pub fn set_title(&mut self, title: Option<String>) {
        self.title = title;
        self.updated_at = Utc::now();
    }

    /// Set the session description
    pub fn set_description(&mut self, description: Option<String>) {
        self.description = description;
        self.updated_at = Utc::now();
    }

    /// Set the proxy port
    pub fn set_proxy_port(&mut self, port: u16) {
        self.proxy_port = Some(port);
        self.updated_at = Utc::now();
    }

    /// Set the merge conflict status
    pub fn set_merge_conflict(&mut self, has_conflict: bool) {
        self.merge_conflict = has_conflict;
        self.updated_at = Utc::now();
    }

    /// Record a failed reconciliation attempt
    pub fn record_reconcile_failure(&mut self, error: String) {
        self.reconcile_attempts += 1;
        self.last_reconcile_error = Some(error);
        self.last_reconcile_at = Some(Utc::now());
        self.updated_at = Utc::now();
    }

    /// Reset reconciliation state after successful recreation
    pub fn reset_reconcile_state(&mut self) {
        self.reconcile_attempts = 0;
        self.last_reconcile_error = None;
        self.last_reconcile_at = None;
        self.updated_at = Utc::now();
    }

    /// Check if we should attempt reconciliation based on backoff timing
    /// Returns true if enough time has passed since last attempt
    #[must_use] 
    pub fn should_attempt_reconcile(&self) -> bool {
        use std::time::Duration;

        let Some(last_attempt) = self.last_reconcile_at else {
            return true; // No previous attempt
        };

        let delay = match self.reconcile_attempts {
            0 => Duration::from_secs(30),  // First retry after 30s
            1 => Duration::from_secs(120), // Second retry after 2min
            2 => Duration::from_secs(300), // Third retry after 5min
            _ => return false,             // Max attempts exceeded
        };

        let elapsed = Utc::now()
            .signed_duration_since(last_attempt)
            .to_std()
            .unwrap_or(Duration::ZERO);

        elapsed >= delay
    }

    /// Check if we've exceeded maximum reconciliation attempts
    #[must_use] 
    pub fn exceeded_max_reconcile_attempts(&self) -> bool {
        self.reconcile_attempts >= 3
    }

    /// Set the error status and message
    pub fn set_error(&mut self, status: SessionStatus, error: String) {
        self.status = status;
        self.error_message = Some(error);
        self.updated_at = Utc::now();
    }

    /// Update the operation progress
    pub fn set_progress(&mut self, progress: ProgressStep) {
        self.progress = Some(progress);
        self.updated_at = Utc::now();
    }

    /// Clear the operation progress
    pub fn clear_progress(&mut self) {
        self.progress = None;
        self.updated_at = Utc::now();
    }
}

/// Session lifecycle status
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionStatus {
    /// Session is being created
    Creating,

    /// Session is being deleted
    Deleting,

    /// Agent is actively working
    Running,

    /// Agent is waiting for input
    Idle,

    /// Work is done, PR merged
    Completed,

    /// Something went wrong
    Failed,

    /// User archived the session
    Archived,
}

/// Execution backend type
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BackendType {
    /// Zellij terminal multiplexer
    Zellij,

    /// Docker container
    Docker,

    /// Kubernetes pod
    Kubernetes,
}

/// AI agent type
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[derive(Default)]
pub enum AgentType {
    /// Claude Code CLI
    #[default]
    ClaudeCode,

    /// OpenAI Codex
    Codex,

    /// Gemini CLI
    Gemini,
}


/// PR check status
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CheckStatus {
    /// Checks are pending
    Pending,

    /// All checks are passing
    Passing,

    /// Some checks are failing
    Failing,

    /// PR is ready to merge
    Mergeable,

    /// PR has been merged
    Merged,
}

/// Claude agent working status
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum ClaudeWorkingStatus {
    /// Unknown state (no hooks configured or no data yet)
    #[default]
    Unknown,

    /// Claude is actively working (PreToolUse hook triggered)
    Working,

    /// Waiting for permission approval (PermissionRequest hook)
    WaitingApproval,

    /// Waiting for user input (idle_prompt notification or Stop hook)
    WaitingInput,

    /// Agent is idle (60+ seconds without activity)
    Idle,
}

impl std::str::FromStr for ClaudeWorkingStatus {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "Unknown" => Ok(Self::Unknown),
            "Working" => Ok(Self::Working),
            "WaitingApproval" => Ok(Self::WaitingApproval),
            "WaitingInput" => Ok(Self::WaitingInput),
            "Idle" => Ok(Self::Idle),
            _ => anyhow::bail!("unknown ClaudeWorkingStatus: {s}"),
        }
    }
}

/// Access mode for proxy filtering
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[derive(Default)]
pub enum AccessMode {
    /// Read-only: GET, HEAD, OPTIONS allowed; POST, PUT, DELETE, PATCH blocked
    #[default]
    ReadOnly,
    /// Read-write: All HTTP methods allowed
    ReadWrite,
}


impl std::fmt::Display for AccessMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ReadOnly => write!(f, "ReadOnly"),
            Self::ReadWrite => write!(f, "ReadWrite"),
        }
    }
}

impl std::str::FromStr for AccessMode {
    type Err = anyhow::Error;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "readonly" | "read-only" | "ro" => Ok(Self::ReadOnly),
            "readwrite" | "read-write" | "rw" => Ok(Self::ReadWrite),
            _ => Err(anyhow::anyhow!("Invalid access mode: {}", s)),
        }
    }
}

/// Get the path to the Claude Code session history file
///
/// Claude Code stores session history at:
/// `<worktree>/.claude/projects/-workspace/<session-id>.jsonl`
///
/// # Arguments
/// * `worktree_path` - Path to the git worktree
/// * `session_id` - UUID of the session
///
/// # Returns
/// The path to the history file (may not exist yet)
#[must_use]
pub fn get_history_file_path(worktree_path: &Path, session_id: &Uuid) -> PathBuf {
    worktree_path
        .join(".claude")
        .join("projects")
        .join("-workspace")
        .join(format!("{session_id}.jsonl"))
}
