use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use typeshare::typeshare;
use uuid::Uuid;

use crate::api::protocol::ProgressStep;

/// Represents a repository mounted in a session
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SessionRepository {
    /// Path to the repository root (git root)
    #[typeshare(serialized_as = "String")]
    pub repo_path: PathBuf,

    /// Subdirectory path relative to git root (empty if at root)
    #[typeshare(serialized_as = "String")]
    pub subdirectory: PathBuf,

    /// Path to the git worktree for this repository
    #[typeshare(serialized_as = "String")]
    pub worktree_path: PathBuf,

    /// Git branch name for this repository's worktree
    pub branch_name: String,

    /// Mount name in the container (e.g., "primary", "shared-lib")
    pub mount_name: String,

    /// Whether this is the primary repository (determines working directory)
    pub is_primary: bool,

    /// Base branch to clone from (for clone-based backends like Sprites)
    /// When None, clones the repository's default branch
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_branch: Option<String>,
}

/// Represents a single AI coding session
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[expect(clippy::struct_excessive_bools, reason = "session has many independent boolean state fields")]
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

    /// Multiple repositories mounted in this session (when Some, overrides single-repo fields above)
    /// None indicates a legacy single-repo session using the fields above
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repositories: Option<Vec<SessionRepository>>,

    /// Backend-specific identifier (zellij session name, docker container id, or kubernetes pod name)
    pub backend_id: Option<String>,

    /// Initial prompt given to the AI agent
    pub initial_prompt: String,

    /// Whether to skip safety checks
    pub dangerous_skip_checks: bool,

    /// Whether this session was created with --dangerous-copy-creds
    /// Sessions with copy-creds have no hook-based status tracking (degraded mode)
    #[serde(default)]
    pub dangerous_copy_creds: bool,

    /// URL of the associated pull request
    pub pr_url: Option<String>,

    /// Status of PR checks
    pub pr_check_status: Option<CheckStatus>,

    /// PR review decision (approval status)
    pub pr_review_decision: Option<ReviewDecision>,

    /// PR review status (approved, changes requested, etc.)
    pub pr_review_status: Option<PrReviewStatus>,

    /// Available merge methods for the repository
    pub pr_merge_methods: Option<Vec<MergeMethod>>,

    /// Default merge method based on repository settings
    pub pr_default_merge_method: Option<MergeMethod>,

    /// Whether to delete branch after merge (from repository settings)
    pub pr_delete_branch_on_merge: Option<bool>,

    /// Whether this PR can be merged (all requirements met: PR exists, checks passing, approved, no conflicts)
    #[serde(skip_deserializing)]
    pub can_merge_pr: bool,

    /// Current Claude agent working status (from hooks)
    pub claude_status: ClaudeWorkingStatus,

    /// Timestamp of last Claude status update
    #[typeshare(serialized_as = "String")]
    pub claude_status_updated_at: Option<DateTime<Utc>>,

    /// Whether the session branch has merge conflicts with main
    pub merge_conflict: bool,

    /// Whether the worktree has uncommitted changes (dirty working tree)
    pub worktree_dirty: bool,

    /// List of changed files in the worktree with their git status
    pub worktree_changed_files: Option<Vec<crate::utils::git::ChangedFile>>,

    /// Access mode for proxy filtering
    pub access_mode: AccessMode,

    /// Port for session-specific HTTP proxy (container backends: Docker and Apple Container)
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
#[derive(Debug)]
pub struct SessionConfig {
    /// Human-friendly name
    pub name: String,
    /// AI-generated title for display (optional)
    pub title: Option<String>,
    /// AI-generated description of the task (optional)
    pub description: Option<String>,
    /// Path to the source repository (LEGACY: used when repositories is None)
    pub repo_path: PathBuf,
    /// Path to the git worktree (LEGACY: used when repositories is None)
    pub worktree_path: PathBuf,
    /// Subdirectory path relative to git root (LEGACY: used when repositories is None)
    pub subdirectory: PathBuf,
    /// Git branch name (LEGACY: used when repositories is None)
    pub branch_name: String,
    /// Multiple repositories (NEW: when Some, overrides legacy fields above)
    pub repositories: Option<Vec<SessionRepository>>,
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
    /// Whether using copy-creds mode (degraded status tracking)
    pub dangerous_copy_creds: bool,
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
            repositories: config.repositories,
            backend_id: None,
            initial_prompt: config.initial_prompt,
            dangerous_skip_checks: config.dangerous_skip_checks,
            dangerous_copy_creds: config.dangerous_copy_creds,
            pr_url: None,
            pr_check_status: None,
            pr_review_decision: None,
            pr_review_status: None,
            pr_merge_methods: None,
            pr_default_merge_method: None,
            pr_delete_branch_on_merge: None,
            can_merge_pr: false,
            claude_status: ClaudeWorkingStatus::Unknown,
            claude_status_updated_at: None,
            merge_conflict: false,
            worktree_dirty: false,
            worktree_changed_files: None,
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

    /// Clear the backend identifier (used when archiving)
    pub fn clear_backend_id(&mut self) {
        self.backend_id = None;
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

    /// Update PR review decision
    pub fn set_pr_review_decision(&mut self, decision: ReviewDecision) {
        self.pr_review_decision = Some(decision);
        self.updated_at = Utc::now();
    }

    /// Update PR review status
    pub fn set_pr_review_status(&mut self, status: PrReviewStatus) {
        self.pr_review_status = Some(status);
        self.updated_at = Utc::now();
    }

    /// Update PR merge methods and settings
    pub fn set_pr_merge_methods(
        &mut self,
        methods: Vec<MergeMethod>,
        default: MergeMethod,
        delete_branch: bool,
    ) {
        self.pr_merge_methods = Some(methods);
        self.pr_default_merge_method = Some(default);
        self.pr_delete_branch_on_merge = Some(delete_branch);
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

    /// Set the list of changed files in the worktree
    pub fn set_worktree_changed_files(
        &mut self,
        files: Option<Vec<crate::utils::git::ChangedFile>>,
    ) {
        self.worktree_changed_files = files;
        self.updated_at = Utc::now();
    }

    /// Get the current workflow stage based on session state
    #[must_use]
    pub fn workflow_stage(&self) -> WorkflowStage {
        // If PR has been merged, show merged
        if self.pr_check_status == Some(CheckStatus::Merged) {
            return WorkflowStage::Merged;
        }

        // If ready to merge, show ready
        if self.can_merge_pr {
            return WorkflowStage::ReadyToMerge;
        }

        // If there's a merge conflict or reconcile error, show blocked
        if self.merge_conflict
            || (self.reconcile_attempts > 0 && self.last_reconcile_error.is_some())
        {
            return WorkflowStage::Blocked;
        }

        // If PR exists but not ready yet, show review
        if self.pr_url.is_some() {
            return WorkflowStage::Review;
        }

        // If Claude is actively working or we have dirty/uncommitted changes, show implementation
        if self.claude_status == ClaudeWorkingStatus::Working
            || self.claude_status == ClaudeWorkingStatus::WaitingApproval
            || self.worktree_dirty
        {
            return WorkflowStage::Implementation;
        }

        // Default to planning
        WorkflowStage::Planning
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
            .unwrap_or_else(|| SessionModel::default_for_agent(self.agent))
    }

    /// Get model CLI flag value, or None if session uses legacy CLI default
    /// Returns None for legacy sessions without explicit model selection
    #[must_use]
    pub fn model_cli_flag(&self) -> Option<&'static str> {
        self.model.as_ref().map(SessionModel::to_cli_flag)
    }

    /// Check if the session has any blockers
    #[must_use]
    pub fn has_blockers(&self) -> bool {
        // CI is failing
        let ci_failing = matches!(self.pr_check_status, Some(CheckStatus::Failing));

        // Has merge conflicts
        let has_conflict = self.merge_conflict;

        // Changes requested on PR
        let changes_requested = matches!(
            self.pr_review_decision,
            Some(ReviewDecision::ChangesRequested)
        );

        ci_failing || has_conflict || changes_requested
    }

    /// Get detailed blocker information
    #[must_use]
    pub fn blocker_details(&self) -> BlockerDetails {
        BlockerDetails {
            ci_failing: matches!(self.pr_check_status, Some(CheckStatus::Failing)),
            merge_conflict: self.merge_conflict,
            changes_requested: matches!(
                self.pr_review_decision,
                Some(ReviewDecision::ChangesRequested)
            ),
        }
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

    /// Apple Container (macOS 26+ with Apple silicon)
    #[cfg(target_os = "macos")]
    AppleContainer,

    /// Sprites.dev cloud container
    Sprites,
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

impl AgentType {
    /// Returns true if this agent is experimental (Codex or Gemini)
    #[must_use]
    pub const fn is_experimental(self) -> bool {
        matches!(self, Self::Codex | Self::Gemini)
    }
}

/// Model selection for Claude Code agent
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClaudeModel {
    /// Claude Opus 4.5 (most capable, best for complex workflows)
    Opus4_5,
    /// Claude Sonnet 4.5 (default, balanced performance for agents and coding)
    Sonnet4_5,
    /// Claude Haiku 4.5 (fastest, optimized for low latency)
    Haiku4_5,
    /// Claude Opus 4.1 (focused on agentic tasks and reasoning)
    Opus4_1,
    /// Claude Opus 4 (previous generation flagship)
    Opus4,
    /// Claude Sonnet 4 (previous generation balanced)
    Sonnet4,
}

impl ClaudeModel {
    /// Convert to CLI flag value
    #[must_use]
    pub const fn to_cli_flag(self) -> &'static str {
        match self {
            Self::Opus4_5 => "opus-4-5",
            Self::Sonnet4_5 => "sonnet-4-5",
            Self::Haiku4_5 => "haiku-4-5",
            Self::Opus4_1 => "opus-4-1",
            Self::Opus4 => "opus-4",
            Self::Sonnet4 => "sonnet-4",
        }
    }
}

#[expect(clippy::derivable_impls, reason = "explicit default makes the chosen default variant clear")]
impl Default for ClaudeModel {
    fn default() -> Self {
        Self::Sonnet4_5
    }
}

/// Model selection for Codex agent
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum CodexModel {
    /// GPT-5.2-Codex (default, most advanced for software engineering)
    #[default]
    Gpt5_2Codex,
    /// GPT-5.2 (most capable for professional knowledge work)
    Gpt5_2,
    /// GPT-5.2 Instant (fast variant)
    Gpt5_2Instant,
    /// GPT-5.2 Thinking (reasoning variant)
    Gpt5_2Thinking,
    /// GPT-5.2 Pro (premium variant)
    Gpt5_2Pro,
    /// GPT-5.1 (previous flagship)
    Gpt5_1,
    /// GPT-5.1 Instant (fast variant)
    Gpt5_1Instant,
    /// GPT-5.1 Thinking (reasoning variant)
    Gpt5_1Thinking,
    /// GPT-4.1 (specialized for coding)
    Gpt4_1,
    /// o3-mini (small reasoning model for science/math/coding)
    O3Mini,
}

impl CodexModel {
    /// Convert to CLI flag value
    #[must_use]
    pub const fn to_cli_flag(self) -> &'static str {
        match self {
            Self::Gpt5_2Codex => "gpt-5-2-codex",
            Self::Gpt5_2 => "gpt-5-2",
            Self::Gpt5_2Instant => "gpt-5-2-instant",
            Self::Gpt5_2Thinking => "gpt-5-2-thinking",
            Self::Gpt5_2Pro => "gpt-5-2-pro",
            Self::Gpt5_1 => "gpt-5-1",
            Self::Gpt5_1Instant => "gpt-5-1-instant",
            Self::Gpt5_1Thinking => "gpt-5-1-thinking",
            Self::Gpt4_1 => "gpt-4-1",
            Self::O3Mini => "o3-mini",
        }
    }
}

/// Model selection for Gemini agent
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum GeminiModel {
    /// Gemini 3 Pro (default, state-of-the-art reasoning with 1M token context)
    #[default]
    Gemini3Pro,
    /// Gemini 3 Flash (fast frontier-class performance at lower cost)
    Gemini3Flash,
    /// Gemini 2.5 Pro (production tier)
    Gemini2_5Pro,
    /// Gemini 2.0 Flash (previous generation fast model)
    Gemini2_0Flash,
}

impl GeminiModel {
    /// Convert to CLI flag value
    #[must_use]
    pub const fn to_cli_flag(self) -> &'static str {
        match self {
            Self::Gemini3Pro => "gemini-3-pro",
            Self::Gemini3Flash => "gemini-3-flash",
            Self::Gemini2_5Pro => "gemini-2-5-pro",
            Self::Gemini2_0Flash => "gemini-2-0-flash",
        }
    }
}

/// Model configuration for a session
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "content")]
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

    /// Returns true if this model is experimental (Codex or Gemini)
    #[must_use]
    pub const fn is_experimental(&self) -> bool {
        matches!(self, Self::Codex(_) | Self::Gemini(_))
    }
}

/// Validate that agent/model is allowed based on feature flags
///
/// # Errors
///
/// Returns an error if the agent or model is experimental and the flag is disabled
pub fn validate_experimental_agent(
    agent: AgentType,
    model: Option<&SessionModel>,
    enable_experimental: bool,
) -> anyhow::Result<()> {
    if agent.is_experimental() && !enable_experimental {
        anyhow::bail!(
            "Agent {:?} is experimental and requires the enable_experimental_models feature flag.\n\
            \n\
            Enable via:\n\
            - CLI: clauderon daemon --enable-experimental-models\n\
            - Environment: CLAUDERON_FEATURE_ENABLE_EXPERIMENTAL_MODELS=true\n\
            - Config file (~/.clauderon/config.toml):\n\
              [feature_flags]\n\
              enable_experimental_models = true\n\
            \n\
            Restart the daemon after changing configuration.",
            agent
        );
    }

    if let Some(m) = model {
        if m.is_experimental() && !enable_experimental {
            anyhow::bail!(
                "Model {:?} is experimental and requires the enable_experimental_models feature flag",
                m
            );
        }
    }

    Ok(())
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

/// PR review decision status
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReviewDecision {
    /// Review is required but not yet provided
    ReviewRequired,

    /// Changes have been requested
    ChangesRequested,

    /// PR has been approved
    Approved,
}

/// PR review status
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PrReviewStatus {
    /// Review status is unknown or not applicable
    Unknown,

    /// Review is required but not yet provided
    ReviewRequired,

    /// Reviewers have requested changes
    ChangesRequested,

    /// PR has been approved
    Approved,
}

/// Git merge method for pull requests
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MergeMethod {
    /// Create a merge commit
    Merge,

    /// Squash commits and merge
    Squash,

    /// Rebase and merge
    Rebase,
}

impl MergeMethod {
    /// Convert to gh CLI flag
    #[must_use]
    pub const fn to_gh_flag(self) -> &'static str {
        match self {
            Self::Merge => "--merge",
            Self::Squash => "--squash",
            Self::Rebase => "--rebase",
        }
    }
}

/// Workflow stage computed from session state
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorkflowStage {
    /// Planning phase - no PR yet, Claude is working
    Planning,

    /// Implementation phase - PR created, CI running or waiting
    Implementation,

    /// Review phase - PR waiting for approval
    Review,

    /// Blocked phase - has blockers (CI failing, conflicts, changes requested)
    Blocked,

    /// Ready to merge - all checks pass, approved, no conflicts
    ReadyToMerge,

    /// Merged - PR has been merged
    Merged,
}

/// Blocker details for a session
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlockerDetails {
    /// Whether CI checks are failing
    pub ci_failing: bool,

    /// Whether the branch has merge conflicts
    pub merge_conflict: bool,

    /// Whether changes have been requested on the PR
    pub changes_requested: bool,
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
    ReadOnly,
    /// Read-write: All HTTP methods allowed
    #[default]
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

// ============================================================================
// Health System Types
// ============================================================================

/// State of a session's backend resource
///
/// This enum represents the actual state of the underlying resource (container,
/// pod, or sprite) as observed during a health check.
#[typeshare]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "content")]
pub enum ResourceState {
    /// Backend is running and healthy
    Healthy,

    /// Backend is stopped/exited (can be started)
    Stopped,

    /// Sprites: sprite is hibernated (can be woken)
    Hibernated,

    /// Kubernetes: pod is waiting for resources (Pending state)
    Pending,

    /// Backend resource is gone but can be recreated (data preserved)
    Missing,

    /// Backend is in an error state
    Error {
        /// Error description.
        message: String,
    },

    /// Kubernetes: pod is in CrashLoopBackOff
    CrashLoop,

    /// Resource was deleted externally (outside clauderon)
    DeletedExternally,

    /// Data has been lost and cannot be recovered
    /// (e.g., PVC deleted, sprite with auto_destroy deleted)
    DataLost {
        /// Why data was lost.
        reason: String,
    },

    /// Git worktree was deleted
    WorktreeMissing,
}

impl ResourceState {
    /// Returns true if this state represents a healthy/running backend
    #[must_use]
    pub const fn is_healthy(&self) -> bool {
        matches!(self, Self::Healthy)
    }

    /// Returns true if the session needs user attention
    #[must_use]
    pub const fn needs_attention(&self) -> bool {
        !matches!(self, Self::Healthy | Self::Pending)
    }

    /// Get a human-readable label for TUI display
    #[must_use]
    pub fn display_label(&self) -> &'static str {
        match self {
            Self::Healthy => "OK",
            Self::Stopped => "Stopped",
            Self::Hibernated => "Hibernated",
            Self::Pending => "Pending",
            Self::Missing => "Missing",
            Self::Error { .. } => "Error",
            Self::CrashLoop => "Crash Loop",
            Self::DeletedExternally => "Deleted Externally",
            Self::DataLost { .. } => "Data Lost",
            Self::WorktreeMissing => "Worktree Missing",
        }
    }
}

impl std::fmt::Display for ResourceState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Healthy => write!(f, "Healthy"),
            Self::Stopped => write!(f, "Stopped"),
            Self::Hibernated => write!(f, "Hibernated"),
            Self::Pending => write!(f, "Pending"),
            Self::Missing => write!(f, "Missing"),
            Self::Error { message } => write!(f, "Error: {message}"),
            Self::CrashLoop => write!(f, "CrashLoopBackOff"),
            Self::DeletedExternally => write!(f, "Deleted Externally"),
            Self::DataLost { reason } => write!(f, "Data Lost: {reason}"),
            Self::WorktreeMissing => write!(f, "Worktree Missing"),
        }
    }
}

/// Actions that can be performed on a session based on its current state
#[typeshare]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum AvailableAction {
    /// Start a stopped container (Docker: docker start)
    Start,

    /// Wake a hibernated sprite
    Wake,

    /// Delete and recreate the backend resource (preserves data)
    Recreate,

    /// Recreate with a fresh git clone (data will be lost)
    RecreateFresh,

    /// Pull new Docker image and recreate container
    UpdateImage,

    /// Remove the session from clauderon (cleanup orphaned session)
    Cleanup,
}

impl AvailableAction {
    /// Get a human-readable label for the action
    #[must_use]
    pub const fn label(&self) -> &'static str {
        match self {
            Self::Start => "Start",
            Self::Wake => "Wake",
            Self::Recreate => "Recreate",
            Self::RecreateFresh => "Recreate Fresh",
            Self::UpdateImage => "Update Image",
            Self::Cleanup => "Clean Up",
        }
    }

    /// Get a description of what the action does
    #[must_use]
    pub const fn description(&self) -> &'static str {
        match self {
            Self::Start => "Start the stopped container",
            Self::Wake => "Wake the hibernated sprite",
            Self::Recreate => "Delete and recreate the backend (data preserved)",
            Self::RecreateFresh => "Recreate with fresh git clone (uncommitted changes lost)",
            Self::UpdateImage => "Pull the latest Docker image and recreate",
            Self::Cleanup => "Remove this session from clauderon",
        }
    }

    /// Returns true if this action could result in data loss
    #[must_use]
    pub const fn may_lose_data(&self) -> bool {
        matches!(self, Self::RecreateFresh | Self::Cleanup)
    }
}

impl std::fmt::Display for AvailableAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.label())
    }
}

/// Detailed health report for a single session
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionHealthReport {
    /// Session ID
    #[typeshare(serialized_as = "String")]
    pub session_id: Uuid,

    /// Session name
    pub session_name: String,

    /// Backend type (Docker, Kubernetes, Zellij, Sprites)
    pub backend_type: BackendType,

    /// Current resource state
    pub state: ResourceState,

    /// Actions available for this session based on current state
    pub available_actions: Vec<AvailableAction>,

    /// Recommended action (if any)
    pub recommended_action: Option<AvailableAction>,

    /// Human-readable summary of the current state
    pub description: String,

    /// Technical details (for expandable section in UI)
    pub details: String,

    /// Is user work preserved if we take action?
    pub data_safe: bool,
}

impl SessionHealthReport {
    /// Create a healthy session report
    #[must_use]
    pub fn healthy(session_id: Uuid, session_name: String, backend_type: BackendType) -> Self {
        Self {
            session_id,
            session_name,
            backend_type,
            state: ResourceState::Healthy,
            available_actions: vec![AvailableAction::Recreate],
            recommended_action: None,
            description: "Session is running normally.".to_owned(),
            details: "The backend resource is running and the worktree exists.".to_owned(),
            data_safe: true,
        }
    }

    /// Returns true if this session needs user attention
    #[must_use]
    pub fn needs_attention(&self) -> bool {
        self.state.needs_attention()
    }

    /// Returns true if recreation is blocked for this session
    #[must_use]
    pub fn is_blocked(&self) -> bool {
        self.available_actions.is_empty()
    }
}

/// Result of checking health of all sessions
#[typeshare]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HealthCheckResult {
    /// Health reports for all sessions
    pub sessions: Vec<SessionHealthReport>,

    /// Count of healthy sessions
    pub healthy_count: u32,

    /// Count of sessions needing attention
    pub needs_attention_count: u32,

    /// Count of sessions that are blocked (cannot be recreated)
    pub blocked_count: u32,
}

impl HealthCheckResult {
    /// Create a new health check result from a list of reports
    #[must_use]
    #[expect(clippy::cast_possible_truncation, reason = "session counts are bounded by application logic")]
    pub fn new(sessions: Vec<SessionHealthReport>) -> Self {
        let healthy_count = sessions.iter().filter(|r| r.state.is_healthy()).count() as u32;
        let needs_attention_count = sessions.iter().filter(|r| r.needs_attention()).count() as u32;
        let blocked_count = sessions.iter().filter(|r| r.is_blocked()).count() as u32;

        Self {
            sessions,
            healthy_count,
            needs_attention_count,
            blocked_count,
        }
    }

    /// Get only the sessions that need attention
    #[must_use]
    pub fn sessions_needing_attention(&self) -> Vec<&SessionHealthReport> {
        self.sessions
            .iter()
            .filter(|r| r.needs_attention())
            .collect()
    }

    /// Returns true if there are any sessions needing attention
    #[must_use]
    pub fn has_issues(&self) -> bool {
        self.needs_attention_count > 0
    }
}

/// Result of a recreate operation
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecreateResult {
    /// Session ID that was recreated
    #[typeshare(serialized_as = "String")]
    pub session_id: Uuid,

    /// New backend ID after recreation
    pub new_backend_id: String,

    /// Whether the operation was successful
    pub success: bool,

    /// Human-readable message about the result
    pub message: String,
}

/// Error returned when a recreate operation is blocked
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecreateBlockedError {
    /// Session ID
    pub session_id: Uuid,

    /// Reason the recreate is blocked
    pub reason: String,

    /// Suggested alternative actions
    pub suggestions: Vec<String>,
}

impl std::fmt::Display for RecreateBlockedError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Cannot recreate session: {}", self.reason)
    }
}

impl std::error::Error for RecreateBlockedError {}

/// Get the path to the Claude Code session history file
///
/// Claude Code stores session history at:
/// - Root directory: `<worktree>/.claude/projects/-workspace/<session-id>.jsonl`
/// - Subdirectory: `<worktree>/.claude/projects/-workspace-<subdir>/<session-id>.jsonl`
///   where <subdir> has `/` replaced with `-`
///
/// # Arguments
/// * `worktree_path` - Path to the git worktree
/// * `session_id` - UUID of the session
/// * `subdirectory` - Subdirectory path relative to git root (empty if at root)
///
/// # Returns
/// The path to the history file (may not exist yet)
#[must_use]
pub fn get_history_file_path(
    worktree_path: &Path,
    session_id: &Uuid,
    subdirectory: &Path,
) -> PathBuf {
    let project_path = if subdirectory.as_os_str().is_empty() {
        "-workspace".to_owned()
    } else {
        format!(
            "-workspace-{}",
            subdirectory.display().to_string().replace('/', "-")
        )
    };

    worktree_path
        .join(".claude")
        .join("projects")
        .join(project_path)
        .join(format!("{session_id}.jsonl"))
}

/// Find Codex history file by searching <worktree>/.codex/sessions
///
/// Codex stores session history at:
/// `<worktree>/.codex/sessions/{year}/{month}/{day}/*-{codex_session_id}.jsonl`
///
/// Note: Codex uses its own internal session IDs, not clauderon session IDs.
/// This function finds the most recently modified `.jsonl` file in the sessions directory.
///
/// # Arguments
/// * `worktree_path` - Path to the git worktree
/// * `_session_id` - Unused (kept for API compatibility, but Codex uses its own session IDs)
///
/// # Returns
/// The path to the most recent history file if found, None otherwise
#[must_use]
pub fn find_codex_history_file(worktree_path: &Path, _session_id: &Uuid) -> Option<PathBuf> {
    let codex_sessions = worktree_path.join(".codex/sessions");
    if !codex_sessions.exists() {
        return None;
    }

    // Find all .jsonl files and return the most recently modified one
    let mut most_recent: Option<(PathBuf, std::time::SystemTime)> = None;

    for entry in walkdir::WalkDir::new(&codex_sessions)
        .max_depth(4) // year/month/day/file
        .into_iter()
        .filter_map(Result::ok)
    {
        let path = entry.path();
        if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
            if filename.to_lowercase().ends_with(".jsonl") {
                if let Ok(metadata) = path.metadata() {
                    if let Ok(modified) = metadata.modified() {
                        match &most_recent {
                            None => most_recent = Some((path.to_path_buf(), modified)),
                            Some((_, prev_time)) if modified > *prev_time => {
                                most_recent = Some((path.to_path_buf(), modified));
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    most_recent.map(|(path, _)| path)
}

/// Validate Codex history path is safe to serve
///
/// Ensures the path:
/// - Starts with `<worktree>/.codex/sessions`
/// - Is a `.jsonl` file
///
/// Note: We don't validate the session ID in the filename because Codex uses
/// its own internal session IDs, not clauderon session IDs.
///
/// # Arguments
/// * `path` - Path to validate
/// * `worktree_path` - Path to the git worktree
/// * `_session_id` - Unused (kept for API compatibility)
///
/// # Returns
/// True if the path is valid and safe to serve
#[must_use]
pub fn validate_codex_history_path(path: &Path, worktree_path: &Path, _session_id: &Uuid) -> bool {
    let codex_sessions = worktree_path.join(".codex/sessions");
    path.starts_with(&codex_sessions)
        && path
            .file_name()
            .and_then(|n| n.to_str())
            .is_some_and(|n| n.to_lowercase().ends_with(".jsonl"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // ========== Model enum tests ==========

    #[test]
    fn test_claude_model_to_cli_flag() {
        assert_eq!(ClaudeModel::Sonnet4_5.to_cli_flag(), "sonnet-4-5");
        assert_eq!(ClaudeModel::Opus4_5.to_cli_flag(), "opus-4-5");
        assert_eq!(ClaudeModel::Haiku4_5.to_cli_flag(), "haiku-4-5");
        assert_eq!(ClaudeModel::Opus4_1.to_cli_flag(), "opus-4-1");
        assert_eq!(ClaudeModel::Opus4.to_cli_flag(), "opus-4");
        assert_eq!(ClaudeModel::Sonnet4.to_cli_flag(), "sonnet-4");
    }

    #[test]
    fn test_claude_model_default() {
        assert_eq!(ClaudeModel::default(), ClaudeModel::Sonnet4_5);
    }

    #[test]
    fn test_codex_model_to_cli_flag() {
        assert_eq!(CodexModel::Gpt5_2Codex.to_cli_flag(), "gpt-5-2-codex");
        assert_eq!(CodexModel::Gpt5_2.to_cli_flag(), "gpt-5-2");
        assert_eq!(CodexModel::Gpt5_2Instant.to_cli_flag(), "gpt-5-2-instant");
        assert_eq!(CodexModel::Gpt5_2Thinking.to_cli_flag(), "gpt-5-2-thinking");
        assert_eq!(CodexModel::Gpt5_2Pro.to_cli_flag(), "gpt-5-2-pro");
        assert_eq!(CodexModel::Gpt5_1.to_cli_flag(), "gpt-5-1");
        assert_eq!(CodexModel::Gpt5_1Instant.to_cli_flag(), "gpt-5-1-instant");
        assert_eq!(CodexModel::Gpt5_1Thinking.to_cli_flag(), "gpt-5-1-thinking");
        assert_eq!(CodexModel::Gpt4_1.to_cli_flag(), "gpt-4-1");
        assert_eq!(CodexModel::O3Mini.to_cli_flag(), "o3-mini");
    }

    #[test]
    fn test_codex_model_default() {
        assert_eq!(CodexModel::default(), CodexModel::Gpt5_2Codex);
    }

    #[test]
    fn test_gemini_model_to_cli_flag() {
        assert_eq!(GeminiModel::Gemini3Pro.to_cli_flag(), "gemini-3-pro");
        assert_eq!(GeminiModel::Gemini3Flash.to_cli_flag(), "gemini-3-flash");
        assert_eq!(GeminiModel::Gemini2_5Pro.to_cli_flag(), "gemini-2-5-pro");
        assert_eq!(
            GeminiModel::Gemini2_0Flash.to_cli_flag(),
            "gemini-2-0-flash"
        );
    }

    #[test]
    fn test_gemini_model_default() {
        assert_eq!(GeminiModel::default(), GeminiModel::Gemini3Pro);
    }

    #[test]
    fn test_session_model_default_for_agent() {
        assert_eq!(
            SessionModel::default_for_agent(AgentType::ClaudeCode),
            SessionModel::Claude(ClaudeModel::Sonnet4_5)
        );
        assert_eq!(
            SessionModel::default_for_agent(AgentType::Codex),
            SessionModel::Codex(CodexModel::Gpt5_2Codex)
        );
        assert_eq!(
            SessionModel::default_for_agent(AgentType::Gemini),
            SessionModel::Gemini(GeminiModel::Gemini3Pro)
        );
    }

    #[test]
    fn test_session_model_to_cli_flag() {
        assert_eq!(
            SessionModel::Claude(ClaudeModel::Opus4_5).to_cli_flag(),
            "opus-4-5"
        );
        assert_eq!(
            SessionModel::Codex(CodexModel::O3Mini).to_cli_flag(),
            "o3-mini"
        );
        assert_eq!(
            SessionModel::Gemini(GeminiModel::Gemini3Pro).to_cli_flag(),
            "gemini-3-pro"
        );
    }

    #[test]
    fn test_session_model_is_compatible_with() {
        let claude_model = SessionModel::Claude(ClaudeModel::Sonnet4_5);
        assert!(claude_model.is_compatible_with(AgentType::ClaudeCode));
        assert!(!claude_model.is_compatible_with(AgentType::Codex));
        assert!(!claude_model.is_compatible_with(AgentType::Gemini));

        let codex_model = SessionModel::Codex(CodexModel::Gpt5_2Codex);
        assert!(!codex_model.is_compatible_with(AgentType::ClaudeCode));
        assert!(codex_model.is_compatible_with(AgentType::Codex));
        assert!(!codex_model.is_compatible_with(AgentType::Gemini));

        let gemini_model = SessionModel::Gemini(GeminiModel::Gemini3Pro);
        assert!(!gemini_model.is_compatible_with(AgentType::ClaudeCode));
        assert!(!gemini_model.is_compatible_with(AgentType::Codex));
        assert!(gemini_model.is_compatible_with(AgentType::Gemini));
    }

    #[test]
    fn test_session_effective_model_with_explicit_model() {
        let session = Session {
            id: Uuid::new_v4(),
            name: "test".to_owned(),
            title: None,
            description: None,
            status: SessionStatus::Running,
            backend: BackendType::Docker,
            agent: AgentType::ClaudeCode,
            model: Some(SessionModel::Claude(ClaudeModel::Opus4_5)),
            repo_path: PathBuf::from("/test"),
            worktree_path: PathBuf::from("/test/worktree"),
            subdirectory: PathBuf::new(),
            branch_name: "test".to_owned(),
            repositories: None,
            backend_id: None,
            initial_prompt: "test".to_owned(),
            dangerous_skip_checks: false,
            dangerous_copy_creds: false,
            pr_url: None,
            pr_check_status: None,
            pr_review_decision: None,
            pr_review_status: None,
            pr_merge_methods: None,
            pr_default_merge_method: None,
            pr_delete_branch_on_merge: None,
            can_merge_pr: false,
            claude_status: ClaudeWorkingStatus::Unknown,
            claude_status_updated_at: None,
            merge_conflict: false,
            worktree_dirty: false,
            worktree_changed_files: None,
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
            SessionModel::Claude(ClaudeModel::Opus4_5)
        );
    }

    #[test]
    fn test_session_effective_model_with_none_falls_back_to_default() {
        let session = Session {
            id: Uuid::new_v4(),
            name: "test".to_owned(),
            title: None,
            description: None,
            status: SessionStatus::Running,
            backend: BackendType::Docker,
            agent: AgentType::ClaudeCode,
            model: None, // Legacy session without explicit model
            repo_path: PathBuf::from("/test"),
            worktree_path: PathBuf::from("/test/worktree"),
            subdirectory: PathBuf::new(),
            branch_name: "test".to_owned(),
            repositories: None,
            backend_id: None,
            initial_prompt: "test".to_owned(),
            dangerous_skip_checks: false,
            dangerous_copy_creds: false,
            pr_url: None,
            pr_check_status: None,
            pr_review_decision: None,
            pr_review_status: None,
            pr_merge_methods: None,
            pr_default_merge_method: None,
            pr_delete_branch_on_merge: None,
            can_merge_pr: false,
            claude_status: ClaudeWorkingStatus::Unknown,
            claude_status_updated_at: None,
            merge_conflict: false,
            worktree_dirty: false,
            worktree_changed_files: None,
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

        // Should fall back to agent default (Sonnet4_5 for ClaudeCode)
        assert_eq!(
            session.effective_model(),
            SessionModel::Claude(ClaudeModel::Sonnet4_5)
        );
    }

    #[test]
    fn test_session_model_cli_flag_with_explicit_model() {
        let session = Session {
            id: Uuid::new_v4(),
            name: "test".to_owned(),
            title: None,
            description: None,
            status: SessionStatus::Running,
            backend: BackendType::Docker,
            agent: AgentType::ClaudeCode,
            model: Some(SessionModel::Claude(ClaudeModel::Haiku4_5)),
            repo_path: PathBuf::from("/test"),
            worktree_path: PathBuf::from("/test/worktree"),
            subdirectory: PathBuf::new(),
            branch_name: "test".to_owned(),
            repositories: None,
            backend_id: None,
            initial_prompt: "test".to_owned(),
            dangerous_skip_checks: false,
            dangerous_copy_creds: false,
            pr_url: None,
            pr_check_status: None,
            pr_review_decision: None,
            pr_review_status: None,
            pr_merge_methods: None,
            pr_default_merge_method: None,
            pr_delete_branch_on_merge: None,
            can_merge_pr: false,
            claude_status: ClaudeWorkingStatus::Unknown,
            claude_status_updated_at: None,
            merge_conflict: false,
            worktree_dirty: false,
            worktree_changed_files: None,
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

        assert_eq!(session.model_cli_flag(), Some("haiku-4-5"));
    }

    #[test]
    fn test_session_model_cli_flag_with_none_returns_none() {
        let session = Session {
            id: Uuid::new_v4(),
            name: "test".to_owned(),
            title: None,
            description: None,
            status: SessionStatus::Running,
            backend: BackendType::Docker,
            agent: AgentType::ClaudeCode,
            model: None, // Legacy session
            repo_path: PathBuf::from("/test"),
            worktree_path: PathBuf::from("/test/worktree"),
            subdirectory: PathBuf::new(),
            branch_name: "test".to_owned(),
            repositories: None,
            backend_id: None,
            initial_prompt: "test".to_owned(),
            dangerous_skip_checks: false,
            dangerous_copy_creds: false,
            pr_url: None,
            pr_check_status: None,
            pr_review_decision: None,
            pr_review_status: None,
            pr_merge_methods: None,
            pr_default_merge_method: None,
            pr_delete_branch_on_merge: None,
            can_merge_pr: false,
            claude_status: ClaudeWorkingStatus::Unknown,
            claude_status_updated_at: None,
            merge_conflict: false,
            worktree_dirty: false,
            worktree_changed_files: None,
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

    #[test]
    fn test_workflow_stage_planning_no_pr() {
        let session = Session {
            pr_url: None,
            pr_check_status: None,
            pr_review_decision: None,
            merge_conflict: false,
            ..create_test_session()
        };

        assert_eq!(session.workflow_stage(), WorkflowStage::Planning);
    }

    #[test]
    fn test_workflow_stage_merged() {
        let session = Session {
            pr_url: Some("https://github.com/test/test/pull/1".to_owned()),
            pr_check_status: Some(CheckStatus::Merged),
            pr_review_decision: None,
            ..create_test_session()
        };

        assert_eq!(session.workflow_stage(), WorkflowStage::Merged);
    }

    #[test]
    fn test_workflow_stage_blocked_by_ci_failure() {
        let session = Session {
            pr_url: Some("https://github.com/test/test/pull/1".to_owned()),
            pr_check_status: Some(CheckStatus::Failing),
            pr_review_decision: Some(ReviewDecision::ReviewRequired),
            merge_conflict: false,
            ..create_test_session()
        };

        // New workflow_stage() checks merge_conflict (not CI status) for Blocked
        assert_eq!(session.workflow_stage(), WorkflowStage::Review);
    }

    #[test]
    fn test_workflow_stage_blocked_by_merge_conflict() {
        let session = Session {
            pr_url: Some("https://github.com/test/test/pull/1".to_owned()),
            pr_check_status: Some(CheckStatus::Passing),
            pr_review_decision: Some(ReviewDecision::Approved),
            merge_conflict: true,
            ..create_test_session()
        };

        assert_eq!(session.workflow_stage(), WorkflowStage::Blocked);
    }

    #[test]
    fn test_workflow_stage_blocked_by_changes_requested() {
        let session = Session {
            pr_url: Some("https://github.com/test/test/pull/1".to_owned()),
            pr_check_status: Some(CheckStatus::Passing),
            pr_review_decision: Some(ReviewDecision::ChangesRequested),
            merge_conflict: false,
            ..create_test_session()
        };

        // New workflow_stage() checks merge_conflict (not changes_requested) for Blocked
        assert_eq!(session.workflow_stage(), WorkflowStage::Review);
    }

    #[test]
    fn test_workflow_stage_ready_to_merge() {
        let session = Session {
            pr_url: Some("https://github.com/test/test/pull/1".to_owned()),
            pr_check_status: Some(CheckStatus::Passing),
            pr_review_decision: Some(ReviewDecision::Approved),
            merge_conflict: false,
            can_merge_pr: true,
            ..create_test_session()
        };

        assert_eq!(session.workflow_stage(), WorkflowStage::ReadyToMerge);
    }

    #[test]
    fn test_workflow_stage_ready_to_merge_with_mergeable() {
        let session = Session {
            pr_url: Some("https://github.com/test/test/pull/1".to_owned()),
            pr_check_status: Some(CheckStatus::Mergeable),
            pr_review_decision: Some(ReviewDecision::Approved),
            merge_conflict: false,
            can_merge_pr: true,
            ..create_test_session()
        };

        assert_eq!(session.workflow_stage(), WorkflowStage::ReadyToMerge);
    }

    #[test]
    fn test_workflow_stage_review_awaiting() {
        let session = Session {
            pr_url: Some("https://github.com/test/test/pull/1".to_owned()),
            pr_check_status: Some(CheckStatus::Passing),
            pr_review_decision: Some(ReviewDecision::ReviewRequired),
            merge_conflict: false,
            ..create_test_session()
        };

        assert_eq!(session.workflow_stage(), WorkflowStage::Review);
    }

    #[test]
    fn test_workflow_stage_review_no_decision() {
        let session = Session {
            pr_url: Some("https://github.com/test/test/pull/1".to_owned()),
            pr_check_status: Some(CheckStatus::Passing),
            pr_review_decision: None,
            merge_conflict: false,
            ..create_test_session()
        };

        assert_eq!(session.workflow_stage(), WorkflowStage::Review);
    }

    #[test]
    fn test_workflow_stage_implementation_pending_ci() {
        let session = Session {
            pr_url: Some("https://github.com/test/test/pull/1".to_owned()),
            pr_check_status: Some(CheckStatus::Pending),
            pr_review_decision: Some(ReviewDecision::Approved),
            merge_conflict: false,
            ..create_test_session()
        };

        // New workflow_stage() treats any PR without can_merge_pr as Review
        assert_eq!(session.workflow_stage(), WorkflowStage::Review);
    }

    #[test]
    fn test_has_blockers_ci_failing() {
        let session = Session {
            pr_check_status: Some(CheckStatus::Failing),
            merge_conflict: false,
            pr_review_decision: None,
            ..create_test_session()
        };

        assert!(session.has_blockers());
    }

    #[test]
    fn test_has_blockers_merge_conflict() {
        let session = Session {
            pr_check_status: Some(CheckStatus::Passing),
            merge_conflict: true,
            pr_review_decision: None,
            ..create_test_session()
        };

        assert!(session.has_blockers());
    }

    #[test]
    fn test_has_blockers_changes_requested() {
        let session = Session {
            pr_check_status: Some(CheckStatus::Passing),
            merge_conflict: false,
            pr_review_decision: Some(ReviewDecision::ChangesRequested),
            ..create_test_session()
        };

        assert!(session.has_blockers());
    }

    #[test]
    fn test_has_blockers_none() {
        let session = Session {
            pr_check_status: Some(CheckStatus::Passing),
            merge_conflict: false,
            pr_review_decision: Some(ReviewDecision::Approved),
            ..create_test_session()
        };

        assert!(!session.has_blockers());
    }

    #[test]
    fn test_blocker_details_all_blockers() {
        let session = Session {
            pr_check_status: Some(CheckStatus::Failing),
            merge_conflict: true,
            pr_review_decision: Some(ReviewDecision::ChangesRequested),
            ..create_test_session()
        };

        let blockers = session.blocker_details();
        assert!(blockers.ci_failing);
        assert!(blockers.merge_conflict);
        assert!(blockers.changes_requested);
    }

    #[test]
    fn test_blocker_details_single_blocker() {
        let session = Session {
            pr_check_status: Some(CheckStatus::Failing),
            merge_conflict: false,
            pr_review_decision: None,
            ..create_test_session()
        };

        let blockers = session.blocker_details();
        assert!(blockers.ci_failing);
        assert!(!blockers.merge_conflict);
        assert!(!blockers.changes_requested);
    }

    /// Helper function to create a test session with default values
    fn create_test_session() -> Session {
        Session {
            id: Uuid::new_v4(),
            name: "test".to_owned(),
            title: None,
            description: None,
            status: SessionStatus::Running,
            backend: BackendType::Docker,
            agent: AgentType::ClaudeCode,
            model: None,
            repo_path: PathBuf::from("/test"),
            worktree_path: PathBuf::from("/test/worktree"),
            subdirectory: PathBuf::new(),
            branch_name: "test".to_owned(),
            repositories: None,
            backend_id: None,
            initial_prompt: "test".to_owned(),
            dangerous_skip_checks: false,
            dangerous_copy_creds: false,
            pr_url: None,
            pr_check_status: None,
            pr_review_decision: None,
            pr_review_status: None,
            pr_merge_methods: None,
            pr_default_merge_method: None,
            pr_delete_branch_on_merge: None,
            can_merge_pr: false,
            claude_status: ClaudeWorkingStatus::Unknown,
            claude_status_updated_at: None,
            merge_conflict: false,
            worktree_dirty: false,
            worktree_changed_files: None,
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
        }
    }

    // ========== Codex history file tests ==========

    #[test]
    fn test_validate_codex_history_path_valid() {
        let worktree = PathBuf::from("/workspace");
        let session_id = Uuid::parse_str("12345678-1234-1234-1234-123456789abc").unwrap();
        let path = PathBuf::from(
            "/workspace/.codex/sessions/2025/01/15/test-20250115-12345678-1234-1234-1234-123456789abc.jsonl",
        );

        assert!(super::validate_codex_history_path(
            &path,
            &worktree,
            &session_id
        ));
    }

    #[test]
    fn test_validate_codex_history_path_outside_codex_sessions() {
        let worktree = PathBuf::from("/workspace");
        let session_id = Uuid::parse_str("12345678-1234-1234-1234-123456789abc").unwrap();
        // Path outside .codex/sessions
        let path =
            PathBuf::from("/workspace/.claude/projects/12345678-1234-1234-1234-123456789abc.jsonl");

        assert!(!super::validate_codex_history_path(
            &path,
            &worktree,
            &session_id
        ));
    }

    #[test]
    fn test_validate_codex_history_path_different_codex_session_id() {
        // Codex uses its own internal session IDs, not clauderon session IDs.
        // Validation should pass as long as it's a .jsonl file in .codex/sessions.
        let worktree = PathBuf::from("/workspace");
        let clauderon_session_id = Uuid::parse_str("12345678-1234-1234-1234-123456789abc").unwrap();
        // Different session ID in filename (this is normal for Codex)
        let path = PathBuf::from(
            "/workspace/.codex/sessions/2025/01/15/test-20250115-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl",
        );

        // Should pass because we don't validate session ID for Codex
        assert!(super::validate_codex_history_path(
            &path,
            &worktree,
            &clauderon_session_id
        ));
    }

    #[test]
    fn test_validate_codex_history_path_path_traversal() {
        let worktree = PathBuf::from("/workspace");
        let session_id = Uuid::parse_str("12345678-1234-1234-1234-123456789abc").unwrap();
        // Attempted path traversal
        let path = PathBuf::from("/other/location/12345678-1234-1234-1234-123456789abc.jsonl");

        assert!(!super::validate_codex_history_path(
            &path,
            &worktree,
            &session_id
        ));
    }

    #[test]
    fn test_validate_codex_history_path_non_jsonl_file() {
        let worktree = PathBuf::from("/workspace");
        let session_id = Uuid::parse_str("12345678-1234-1234-1234-123456789abc").unwrap();
        // Non-jsonl file should be rejected
        let path = PathBuf::from("/workspace/.codex/sessions/2025/01/15/config.toml");

        assert!(!super::validate_codex_history_path(
            &path,
            &worktree,
            &session_id
        ));
    }

    // ========== Experimental agent/model tests ==========

    #[test]
    fn test_agent_is_experimental() {
        assert!(!AgentType::ClaudeCode.is_experimental());
        assert!(AgentType::Codex.is_experimental());
        assert!(AgentType::Gemini.is_experimental());
    }

    #[test]
    fn test_model_is_experimental() {
        assert!(!SessionModel::Claude(ClaudeModel::Sonnet4_5).is_experimental());
        assert!(SessionModel::Codex(CodexModel::Gpt5_2Codex).is_experimental());
        assert!(SessionModel::Gemini(GeminiModel::Gemini3Pro).is_experimental());
    }

    #[test]
    fn test_validate_experimental_blocks_codex() {
        let result = validate_experimental_agent(AgentType::Codex, None, false);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("experimental"));
    }

    #[test]
    fn test_validate_experimental_blocks_gemini() {
        let result = validate_experimental_agent(AgentType::Gemini, None, false);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("experimental"));
    }

    #[test]
    fn test_validate_experimental_allows_with_flag() {
        let result = validate_experimental_agent(AgentType::Codex, None, true);
        assert!(result.is_ok());

        let result = validate_experimental_agent(AgentType::Gemini, None, true);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_experimental_always_allows_claude() {
        let result = validate_experimental_agent(AgentType::ClaudeCode, None, false);
        assert!(result.is_ok());
    }

    #[test]
    fn test_validate_experimental_blocks_codex_model() {
        let model = SessionModel::Codex(CodexModel::Gpt5_2Codex);
        let result = validate_experimental_agent(AgentType::Codex, Some(&model), false);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_experimental_allows_claude_model() {
        let model = SessionModel::Claude(ClaudeModel::Sonnet4_5);
        let result = validate_experimental_agent(AgentType::ClaudeCode, Some(&model), false);
        assert!(result.is_ok());
    }
}
