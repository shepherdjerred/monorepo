use async_trait::async_trait;
use std::path::Path;

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
}

/// Options for creating an execution backend session.
#[derive(Debug, Clone, Default)]
pub struct CreateOptions {
    /// Run in print mode (non-interactive, outputs response and exits).
    /// Only applicable to Docker backend.
    pub print_mode: bool,

    /// Start in plan mode (read-only exploration).
    /// Applicable to both Zellij and Docker backends.
    pub plan_mode: bool,

    /// Image file paths to attach to initial prompt
    pub images: Vec<String>,
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
}

// Keep the old name as an alias for backward compatibility during refactoring
#[deprecated(note = "Use ExecutionBackend instead")]
pub type Backend = dyn ExecutionBackend;
