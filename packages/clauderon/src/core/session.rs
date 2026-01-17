use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
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

    /// AI model for this session (None for sessions created before model selection was added)
    pub model: Option<SessionModel>,

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

    /// Whether the worktree has uncommitted changes (dirty working tree)
    pub worktree_dirty: bool,

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
    /// AI model (optional, uses default if not specified)
    pub model: Option<SessionModel>,
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
            model: config.model,
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
            worktree_dirty: false,
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

    /// Set the working tree dirty status
    pub fn set_worktree_dirty(&mut self, is_dirty: bool) {
        self.worktree_dirty = is_dirty;
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

    /// Get the effective model for CLI invocation
    /// Falls back to agent default if model is not explicitly set
    #[must_use]
    pub fn effective_model(&self) -> SessionModel {
        self.model
            .clone()
            .unwrap_or_else(|| SessionModel::default_for_agent(self.agent))
    }

    /// Get model CLI flag value, or None if session uses legacy CLI default
    /// Returns None for legacy sessions without explicit model selection
    #[must_use]
    pub fn model_cli_flag(&self) -> Option<&'static str> {
        self.model.as_ref().map(SessionModel::to_cli_flag)
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum AgentType {
    /// Claude Code CLI
    #[default]
    ClaudeCode,

    /// OpenAI Codex
    Codex,

    /// Gemini CLI
    Gemini,
}

/// Model selection for Claude Code agent
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClaudeModel {
    /// Claude Sonnet (default, best balance of performance and cost)
    Sonnet,
    /// Claude Opus (most capable model for complex tasks)
    Opus,
    /// Claude Haiku (fastest and cheapest)
    Haiku,
}

impl ClaudeModel {
    /// Convert to CLI flag value
    #[must_use]
    pub const fn to_cli_flag(self) -> &'static str {
        match self {
            Self::Sonnet => "sonnet",
            Self::Opus => "opus",
            Self::Haiku => "haiku",
        }
    }
}

impl Default for ClaudeModel {
    fn default() -> Self {
        Self::Sonnet
    }
}

/// Model selection for Codex agent
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CodexModel {
    /// GPT-4o (default, latest GPT-4 with vision)
    Gpt4o,
    /// GPT-4 (previous generation)
    Gpt4,
    /// GPT-3.5 Turbo (faster, less capable)
    Gpt35Turbo,
    /// o1 (reasoning-focused model)
    O1,
    /// o3 (latest reasoning model)
    O3,
}

impl CodexModel {
    /// Convert to CLI flag value
    #[must_use]
    pub const fn to_cli_flag(self) -> &'static str {
        match self {
            Self::Gpt4o => "gpt-4o",
            Self::Gpt4 => "gpt-4",
            Self::Gpt35Turbo => "gpt-3.5-turbo",
            Self::O1 => "o1",
            Self::O3 => "o3",
        }
    }
}

impl Default for CodexModel {
    fn default() -> Self {
        Self::Gpt4o
    }
}

/// Model selection for Gemini agent
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GeminiModel {
    /// Gemini 2.5 Pro (default, most capable)
    Gemini25Pro,
    /// Gemini 2.0 Flash Thinking Experimental
    Gemini20FlashThinking,
}

impl GeminiModel {
    /// Convert to CLI flag value
    #[must_use]
    pub const fn to_cli_flag(self) -> &'static str {
        match self {
            Self::Gemini25Pro => "gemini-2.5-pro",
            Self::Gemini20FlashThinking => "gemini-2.0-flash-thinking-exp",
        }
    }
}

impl Default for GeminiModel {
    fn default() -> Self {
        Self::Gemini25Pro
    }
}

/// Model configuration for a session
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum SessionModel {
    /// Claude Code model
    Claude(ClaudeModel),
    /// Codex model
    Codex(CodexModel),
    /// Gemini model
    Gemini(GeminiModel),
}

impl SessionModel {
    /// Get default model for an agent type
    #[must_use]
    pub fn default_for_agent(agent: AgentType) -> Self {
        match agent {
            AgentType::ClaudeCode => Self::Claude(ClaudeModel::default()),
            AgentType::Codex => Self::Codex(CodexModel::default()),
            AgentType::Gemini => Self::Gemini(GeminiModel::default()),
        }
    }

    /// Convert to CLI flag value
    #[must_use]
    pub fn to_cli_flag(&self) -> &'static str {
        match self {
            Self::Claude(model) => model.to_cli_flag(),
            Self::Codex(model) => model.to_cli_flag(),
            Self::Gemini(model) => model.to_cli_flag(),
        }
    }

    /// Check if this model is compatible with the given agent type
    #[must_use]
    pub const fn is_compatible_with(&self, agent: AgentType) -> bool {
        matches!(
            (self, agent),
            (Self::Claude(_), AgentType::ClaudeCode)
                | (Self::Codex(_), AgentType::Codex)
                | (Self::Gemini(_), AgentType::Gemini)
        )
    }
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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
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

#[cfg(test)]
mod tests {
    use super::*;

    // ========== Model enum tests ==========

    #[test]
    fn test_claude_model_to_cli_flag() {
        assert_eq!(ClaudeModel::Sonnet.to_cli_flag(), "sonnet");
        assert_eq!(ClaudeModel::Opus.to_cli_flag(), "opus");
        assert_eq!(ClaudeModel::Haiku.to_cli_flag(), "haiku");
    }

    #[test]
    fn test_claude_model_default() {
        assert_eq!(ClaudeModel::default(), ClaudeModel::Sonnet);
    }

    #[test]
    fn test_codex_model_to_cli_flag() {
        assert_eq!(CodexModel::Gpt4o.to_cli_flag(), "gpt-4o");
        assert_eq!(CodexModel::Gpt4.to_cli_flag(), "gpt-4");
        assert_eq!(CodexModel::Gpt35Turbo.to_cli_flag(), "gpt-3.5-turbo");
        assert_eq!(CodexModel::O1.to_cli_flag(), "o1");
        assert_eq!(CodexModel::O3.to_cli_flag(), "o3");
    }

    #[test]
    fn test_codex_model_default() {
        assert_eq!(CodexModel::default(), CodexModel::Gpt4o);
    }

    #[test]
    fn test_gemini_model_to_cli_flag() {
        assert_eq!(GeminiModel::Gemini25Pro.to_cli_flag(), "gemini-2.5-pro");
        assert_eq!(
            GeminiModel::Gemini20FlashThinking.to_cli_flag(),
            "gemini-2.0-flash-thinking-exp"
        );
    }

    #[test]
    fn test_gemini_model_default() {
        assert_eq!(GeminiModel::default(), GeminiModel::Gemini25Pro);
    }

    #[test]
    fn test_session_model_default_for_agent() {
        assert_eq!(
            SessionModel::default_for_agent(AgentType::ClaudeCode),
            SessionModel::Claude(ClaudeModel::Sonnet)
        );
        assert_eq!(
            SessionModel::default_for_agent(AgentType::Codex),
            SessionModel::Codex(CodexModel::Gpt4o)
        );
        assert_eq!(
            SessionModel::default_for_agent(AgentType::Gemini),
            SessionModel::Gemini(GeminiModel::Gemini25Pro)
        );
    }

    #[test]
    fn test_session_model_to_cli_flag() {
        assert_eq!(
            SessionModel::Claude(ClaudeModel::Opus).to_cli_flag(),
            "opus"
        );
        assert_eq!(SessionModel::Codex(CodexModel::O1).to_cli_flag(), "o1");
        assert_eq!(
            SessionModel::Gemini(GeminiModel::Gemini25Pro).to_cli_flag(),
            "gemini-2.5-pro"
        );
    }

    #[test]
    fn test_session_model_is_compatible_with() {
        let claude_model = SessionModel::Claude(ClaudeModel::Sonnet);
        assert!(claude_model.is_compatible_with(AgentType::ClaudeCode));
        assert!(!claude_model.is_compatible_with(AgentType::Codex));
        assert!(!claude_model.is_compatible_with(AgentType::Gemini));

        let codex_model = SessionModel::Codex(CodexModel::Gpt4o);
        assert!(!codex_model.is_compatible_with(AgentType::ClaudeCode));
        assert!(codex_model.is_compatible_with(AgentType::Codex));
        assert!(!codex_model.is_compatible_with(AgentType::Gemini));

        let gemini_model = SessionModel::Gemini(GeminiModel::Gemini25Pro);
        assert!(!gemini_model.is_compatible_with(AgentType::ClaudeCode));
        assert!(!gemini_model.is_compatible_with(AgentType::Codex));
        assert!(gemini_model.is_compatible_with(AgentType::Gemini));
    }

    #[test]
    fn test_session_effective_model_with_explicit_model() {
        let session = Session {
            id: Uuid::new_v4(),
            name: "test".to_string(),
            title: None,
            description: None,
            status: SessionStatus::Running,
            backend: BackendType::Docker,
            agent: AgentType::ClaudeCode,
            model: Some(SessionModel::Claude(ClaudeModel::Opus)),
            repo_path: PathBuf::from("/test"),
            worktree_path: PathBuf::from("/test/worktree"),
            subdirectory: PathBuf::new(),
            branch_name: "test".to_string(),
            backend_id: None,
            initial_prompt: "test".to_string(),
            dangerous_skip_checks: false,
            pr_url: None,
            pr_check_status: None,
            claude_status: ClaudeWorkingStatus::Unknown,
            claude_status_updated_at: None,
            merge_conflict: false,
            worktree_dirty: false,
            access_mode: AccessMode::ReadOnly,
            proxy_port: None,
            history_file_path: None,
            reconcile_attempts: 0,
            last_reconcile_error: None,
            last_reconcile_at: None,
            error_message: None,
            progress: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        assert_eq!(
            session.effective_model(),
            SessionModel::Claude(ClaudeModel::Opus)
        );
    }

    #[test]
    fn test_session_effective_model_with_none_falls_back_to_default() {
        let session = Session {
            id: Uuid::new_v4(),
            name: "test".to_string(),
            title: None,
            description: None,
            status: SessionStatus::Running,
            backend: BackendType::Docker,
            agent: AgentType::ClaudeCode,
            model: None, // Legacy session without explicit model
            repo_path: PathBuf::from("/test"),
            worktree_path: PathBuf::from("/test/worktree"),
            subdirectory: PathBuf::new(),
            branch_name: "test".to_string(),
            backend_id: None,
            initial_prompt: "test".to_string(),
            dangerous_skip_checks: false,
            pr_url: None,
            pr_check_status: None,
            claude_status: ClaudeWorkingStatus::Unknown,
            claude_status_updated_at: None,
            merge_conflict: false,
            worktree_dirty: false,
            access_mode: AccessMode::ReadOnly,
            proxy_port: None,
            history_file_path: None,
            reconcile_attempts: 0,
            last_reconcile_error: None,
            last_reconcile_at: None,
            error_message: None,
            progress: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        // Should fall back to agent default (Sonnet for ClaudeCode)
        assert_eq!(
            session.effective_model(),
            SessionModel::Claude(ClaudeModel::Sonnet)
        );
    }

    #[test]
    fn test_session_model_cli_flag_with_explicit_model() {
        let session = Session {
            id: Uuid::new_v4(),
            name: "test".to_string(),
            title: None,
            description: None,
            status: SessionStatus::Running,
            backend: BackendType::Docker,
            agent: AgentType::ClaudeCode,
            model: Some(SessionModel::Claude(ClaudeModel::Haiku)),
            repo_path: PathBuf::from("/test"),
            worktree_path: PathBuf::from("/test/worktree"),
            subdirectory: PathBuf::new(),
            branch_name: "test".to_string(),
            backend_id: None,
            initial_prompt: "test".to_string(),
            dangerous_skip_checks: false,
            pr_url: None,
            pr_check_status: None,
            claude_status: ClaudeWorkingStatus::Unknown,
            claude_status_updated_at: None,
            merge_conflict: false,
            worktree_dirty: false,
            access_mode: AccessMode::ReadOnly,
            proxy_port: None,
            history_file_path: None,
            reconcile_attempts: 0,
            last_reconcile_error: None,
            last_reconcile_at: None,
            error_message: None,
            progress: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        assert_eq!(session.model_cli_flag(), Some("haiku"));
    }

    #[test]
    fn test_session_model_cli_flag_with_none_returns_none() {
        let session = Session {
            id: Uuid::new_v4(),
            name: "test".to_string(),
            title: None,
            description: None,
            status: SessionStatus::Running,
            backend: BackendType::Docker,
            agent: AgentType::ClaudeCode,
            model: None, // Legacy session
            repo_path: PathBuf::from("/test"),
            worktree_path: PathBuf::from("/test/worktree"),
            subdirectory: PathBuf::new(),
            branch_name: "test".to_string(),
            backend_id: None,
            initial_prompt: "test".to_string(),
            dangerous_skip_checks: false,
            pr_url: None,
            pr_check_status: None,
            claude_status: ClaudeWorkingStatus::Unknown,
            claude_status_updated_at: None,
            merge_conflict: false,
            worktree_dirty: false,
            access_mode: AccessMode::ReadOnly,
            proxy_port: None,
            history_file_path: None,
            reconcile_attempts: 0,
            last_reconcile_error: None,
            last_reconcile_at: None,
            error_message: None,
            progress: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        // Legacy sessions return None (no --model flag passed to CLI)
        assert_eq!(session.model_cli_flag(), None);
    }
}
