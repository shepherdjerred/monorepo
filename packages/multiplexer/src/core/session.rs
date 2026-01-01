use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use typeshare::typeshare;
use uuid::Uuid;

/// Represents a single AI coding session
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    /// Unique identifier
    pub id: Uuid,

    /// Human-friendly name (user-provided + random suffix)
    pub name: String,

    /// Current status of the session
    pub status: SessionStatus,

    /// Execution backend
    pub backend: BackendType,

    /// AI agent running in this session
    pub agent: AgentType,

    /// Path to the source repository
    pub repo_path: PathBuf,

    /// Path to the git worktree
    pub worktree_path: PathBuf,

    /// Git branch name
    pub branch_name: String,

    /// Backend-specific identifier (zellij session name or docker container id)
    pub backend_id: Option<String>,

    /// Initial prompt given to the AI agent
    pub initial_prompt: String,

    /// Whether to skip safety checks
    pub dangerous_skip_checks: bool,

    /// URL of the associated pull request
    pub pr_url: Option<String>,

    /// Status of PR checks
    pub pr_check_status: Option<CheckStatus>,

    /// Access mode for proxy filtering
    pub access_mode: AccessMode,

    /// Port for session-specific HTTP proxy (Docker only)
    pub proxy_port: Option<u16>,

    /// When the session was created
    pub created_at: DateTime<Utc>,

    /// When the session was last updated
    pub updated_at: DateTime<Utc>,
}

/// Configuration for creating a new session
pub struct SessionConfig {
    /// Human-friendly name
    pub name: String,
    /// Path to the source repository
    pub repo_path: PathBuf,
    /// Path to the git worktree
    pub worktree_path: PathBuf,
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
            status: SessionStatus::Creating,
            backend: config.backend,
            agent: config.agent,
            repo_path: config.repo_path,
            worktree_path: config.worktree_path,
            branch_name: config.branch_name,
            backend_id: None,
            initial_prompt: config.initial_prompt,
            dangerous_skip_checks: config.dangerous_skip_checks,
            pr_url: None,
            pr_check_status: None,
            access_mode: config.access_mode,
            proxy_port: None,
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

    /// Update access mode
    pub fn set_access_mode(&mut self, mode: AccessMode) {
        self.access_mode = mode;
        self.updated_at = Utc::now();
    }

    /// Set the proxy port
    pub fn set_proxy_port(&mut self, port: u16) {
        self.proxy_port = Some(port);
        self.updated_at = Utc::now();
    }
}

/// Session lifecycle status
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionStatus {
    /// Session is being created
    Creating,

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
}

/// AI agent type
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AgentType {
    /// Claude Code CLI
    ClaudeCode,

    /// `OpenAI` Codex
    Codex,
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

/// Access mode for proxy filtering
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AccessMode {
    /// Read-only: GET, HEAD, OPTIONS allowed; POST, PUT, DELETE, PATCH blocked
    ReadOnly,
    /// Read-write: All HTTP methods allowed
    ReadWrite,
}

impl Default for AccessMode {
    fn default() -> Self {
        Self::ReadOnly  // Principle of least privilege - secure default
    }
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
