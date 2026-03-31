use crate::core::session::{AgentType, ResourceState, SessionRepository};
use async_trait::async_trait;
use std::path::{Path, PathBuf};

use super::container_config::{ImageConfig, ResourceLimits};

// ============================================================================
// Backend Capabilities
// ============================================================================

/// Capabilities of a backend for the health/recreate system
///
/// This struct describes what operations a backend supports and whether
/// data is preserved during recreation. This helps the UI determine what
/// actions to offer and what warnings to show.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "independent capability flags"
)]
pub struct BackendCapabilities {
    /// Whether this backend supports proactive recreation when healthy
    pub can_recreate: bool,

    /// Whether this backend supports pulling/updating the container image
    pub can_update_image: bool,

    /// Whether user data (code, uncommitted changes) is preserved on recreate
    ///
    /// - Docker bind mount: true (code is on host)
    /// - Docker volume: true (volume survives container recreation)
    /// - Zellij: true (code is in local worktree)
    pub preserves_data_on_recreate: bool,

    /// Whether this backend supports starting a stopped resource
    pub can_start: bool,

    /// Human-readable description of data preservation behavior
    pub data_preservation_description: &'static str,
}

impl Default for BackendCapabilities {
    fn default() -> Self {
        Self {
            can_recreate: true,
            can_update_image: false,
            preserves_data_on_recreate: true,
            can_start: false,
            data_preservation_description: "Data is preserved during recreation.",
        }
    }
}

/// Raw resource health state from a backend
///
/// This is the low-level state returned by backends before being mapped
/// to the higher-level `ResourceState` by the health service.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackendResourceHealth {
    /// Resource is running
    Running,

    /// Resource is stopped/exited but exists
    Stopped,

    /// Resource is pending/starting
    Pending,

    /// Resource is in an error state
    Error {
        /// Error description.
        message: String,
    },

    /// Resource is crash-looping
    CrashLoop,

    /// Resource does not exist
    NotFound,
}

impl BackendResourceHealth {
    /// Convert to high-level ResourceState
    ///
    /// This maps the backend-specific health state to the generic ResourceState
    /// used by the health system. The mapping considers whether data is preserved.
    #[must_use]
    pub fn to_resource_state(self, data_preserved: bool) -> ResourceState {
        match self {
            Self::Running => ResourceState::Healthy,
            Self::Stopped => ResourceState::Stopped,
            Self::Pending => ResourceState::Pending,
            Self::Error { message } => ResourceState::Error { message },
            Self::CrashLoop => ResourceState::CrashLoop,
            Self::NotFound => {
                if data_preserved {
                    ResourceState::Missing
                } else {
                    ResourceState::DeletedExternally
                }
            }
        }
    }
}

/// Trait for git worktree operations
#[async_trait]
pub trait GitOperations: Send + Sync {
    /// Create a new git worktree
    ///
    /// Creates a new branch and checks it out to the specified worktree path.
    ///
    /// Returns `Ok(None)` on success, or `Ok(Some(warning))` if the worktree was
    /// created but the post-checkout hook failed.
    async fn create_worktree(
        &self,
        repo_path: &Path,
        worktree_path: &Path,
        branch_name: &str,
    ) -> anyhow::Result<Option<String>>;

    /// Delete a git worktree
    ///
    /// Removes the worktree directory and cleans up git's worktree tracking.
    /// The `repo_path` parameter is the path to the main git repository,
    /// needed to run `git worktree remove` from the correct location.
    async fn delete_worktree(&self, repo_path: &Path, worktree_path: &Path) -> anyhow::Result<()>;

    /// Check if a worktree exists at the given path
    fn worktree_exists(&self, worktree_path: &Path) -> bool;

    /// Get the current branch of a worktree
    async fn get_branch(&self, worktree_path: &Path) -> anyhow::Result<String>;

    /// Clone a repository locally (git clone --local)
    /// Returns Ok(None) on success, Ok(Some(warning)) on partial success
    async fn clone_local(
        &self,
        source_repo: &Path,
        target_path: &Path,
        branch_name: &str,
    ) -> anyhow::Result<Option<String>> {
        let _ = (source_repo, target_path, branch_name);
        anyhow::bail!("clone_local not supported by this git backend")
    }

    /// Delete a local clone (rm -rf)
    async fn delete_clone(&self, clone_path: &Path) -> anyhow::Result<()> {
        let _ = clone_path;
        anyhow::bail!("delete_clone not supported by this git backend")
    }

    /// Claim a pre-staged clone from the pool, or fall back to inline clone
    async fn claim_or_clone(
        &self,
        source_repo: &Path,
        target_path: &Path,
        branch_name: &str,
    ) -> anyhow::Result<Option<String>> {
        self.clone_local(source_repo, target_path, branch_name)
            .await
    }

    /// Replenish the pre-staged clone pool (background task)
    async fn replenish_pool(&self, source_repo: &Path) -> anyhow::Result<()> {
        let _ = source_repo;
        Ok(())
    }
}

/// Options for creating an execution backend session.
#[derive(Debug, Clone, Default)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "independent configuration flags for session creation"
)]
pub struct CreateOptions {
    /// Agent to run (Claude Code, Codex, or Gemini).
    pub agent: AgentType,

    /// Optional model CLI flag value (e.g., "sonnet", "gpt-4o", "gemini-2.5-pro").
    /// If None, the CLI will use its default model.
    pub model: Option<String>,

    /// Run in print mode (non-interactive, outputs response and exits).
    /// Only applicable to Docker backend.
    pub print_mode: bool,

    /// Start in plan mode (read-only exploration).
    /// When enabled, the manager prepends instructions to the prompt before passing to backends.
    pub plan_mode: bool,

    /// Image file paths to attach to initial prompt
    pub images: Vec<String>,

    /// Skip safety checks (dangerous)
    pub dangerous_skip_checks: bool,

    /// Session UUID for tracking.
    pub session_id: Option<uuid::Uuid>,

    /// Initial working directory relative to worktree root
    /// Empty PathBuf means start at worktree root
    pub initial_workdir: PathBuf,

    /// HTTP server port for hook communication.
    /// Required for Docker containers to send status updates via HTTP.
    pub http_port: Option<u16>,

    /// Optional: Override container image settings.
    ///
    /// When provided, overrides the default image configuration from the backend's config file.
    /// Applies to Docker backend.
    pub container_image: Option<ImageConfig>,

    /// Optional: Override container resource limits.
    ///
    /// When provided, overrides the default resource limits from the backend's config file.
    /// For Docker: sets --cpus and --memory flags.
    pub container_resources: Option<ResourceLimits>,

    /// Optional: Override storage class.
    pub storage_class_override: Option<String>,

    /// Repositories to mount in the session.
    /// When empty, use single-repo legacy mode with workdir parameter.
    /// When non-empty, use multi-repo mode and ignore workdir parameter.
    pub repositories: Vec<SessionRepository>,

    /// Use volume mode instead of bind mounts (Docker only).
    ///
    /// When true, creates a Docker volume and clones repositories into it
    /// When false (default), bind mounts
    /// local worktrees directly.
    pub volume_mode: bool,

}

/// Trait for execution backends (Zellij, Docker, etc.)
///
/// This trait abstracts the creation and management of isolated
/// execution environments for AI agents.
#[async_trait]
pub trait ExecutionBackend: Send + Sync {
    /// Create a new session/container
    ///
    /// Returns an identifier for the created resource (session name or container name).
    async fn create(
        &self,
        name: &str,
        workdir: &Path,
        initial_prompt: &str,
        options: CreateOptions,
    ) -> anyhow::Result<String>;

    /// Check if a session/container exists
    async fn exists(&self, id: &str) -> anyhow::Result<bool>;

    /// Delete a session/container
    async fn delete(&self, id: &str) -> anyhow::Result<()>;

    /// Get the command to attach to a session/container
    fn attach_command(&self, id: &str) -> Vec<String>;

    /// Get recent output from the session/container
    async fn get_output(&self, id: &str, lines: usize) -> anyhow::Result<String>;

    /// Whether this backend requires remote connectivity configuration.
    ///
    /// Remote backends cannot mount local directories
    /// and require explicit configuration for credential handling.
    ///
    /// Local backends (Docker, Zellij) return `false`.
    fn is_remote(&self) -> bool {
        false
    }

    /// Whether this backend manages its own repository setup (clone instead of worktree).
    ///
    /// When true, the session manager skips worktree creation and delegates
    /// repository setup to the backend's `create()` method.
    fn manages_own_repo(&self) -> bool {
        false
    }

    /// Get the capabilities of this backend
    ///
    /// Returns information about what operations this backend supports
    /// and whether data is preserved during recreation.
    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities::default()
    }

    /// Check the health of a backend resource
    ///
    /// Returns the current state of the resource (running, stopped, missing, etc.)
    /// without modifying it.
    ///
    /// # Errors
    ///
    /// Returns an error if the health check itself fails (e.g., API unreachable).
    async fn check_health(&self, id: &str) -> anyhow::Result<BackendResourceHealth> {
        // Default implementation: if exists() returns true, assume running
        // Backends should override this for more accurate health checking
        if self.exists(id).await? {
            Ok(BackendResourceHealth::Running)
        } else {
            Ok(BackendResourceHealth::NotFound)
        }
    }

    /// Start a stopped resource
    ///
    /// Only applicable to backends that support starting stopped resources
    /// (e.g., Docker containers that were stopped but not removed).
    ///
    /// # Errors
    ///
    /// Returns an error if the backend doesn't support this operation or if
    /// starting fails.
    async fn start(&self, _id: &str) -> anyhow::Result<()> {
        anyhow::bail!("This backend does not support starting stopped resources")
    }

}

/// Deprecated alias for [`ExecutionBackend`].
#[deprecated(note = "Use ExecutionBackend instead")]
pub type Backend = dyn ExecutionBackend;
