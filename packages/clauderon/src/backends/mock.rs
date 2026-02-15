//! Mock implementations of backend traits for testing.
//!
//! These mocks provide in-memory implementations that don't require
//! external tools like git, zellij, or docker.

use async_trait::async_trait;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::RwLock;

use super::traits::{ExecutionBackend, GitOperations};

/// Mock implementation of GitOperations for testing.
///
/// Tracks worktree state in memory without executing actual git commands.
pub struct MockGitBackend {
    /// Set of worktree paths that "exist"
    worktrees: RwLock<HashSet<PathBuf>>,

    /// If true, all operations will fail
    should_fail: AtomicBool,

    /// Error message to return when should_fail is true
    error_message: RwLock<String>,
}

impl std::fmt::Debug for MockGitBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MockGitBackend").finish_non_exhaustive()
    }
}

impl MockGitBackend {
    /// Create a new mock git backend
    #[must_use]
    pub fn new() -> Self {
        Self {
            worktrees: RwLock::new(HashSet::new()),
            should_fail: AtomicBool::new(false),
            error_message: RwLock::new("Mock failure".to_owned()),
        }
    }

    /// Configure the mock to fail all operations
    pub fn set_should_fail(&self, should_fail: bool) {
        self.should_fail.store(should_fail, Ordering::SeqCst);
    }

    /// Set the error message to return when operations fail
    pub async fn set_error_message(&self, message: impl Into<String>) {
        *self.error_message.write().await = message.into();
    }

    /// Get a list of all worktrees that have been created
    pub async fn get_worktrees(&self) -> Vec<PathBuf> {
        self.worktrees.read().await.iter().cloned().collect()
    }

    /// Register a worktree as existing (for testing without async create)
    pub async fn register_worktree(&self, path: impl Into<PathBuf>) {
        self.worktrees.write().await.insert(path.into());
    }

    /// Check if operations are configured to fail
    fn should_fail(&self) -> bool {
        self.should_fail.load(Ordering::SeqCst)
    }
}

impl Default for MockGitBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl GitOperations for MockGitBackend {
    async fn create_worktree(
        &self,
        _repo_path: &Path,
        worktree_path: &Path,
        _branch_name: &str,
    ) -> anyhow::Result<Option<String>> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        // Create the actual directory so reconcile() can check existence
        if let Err(e) = std::fs::create_dir_all(worktree_path) {
            tracing::warn!("Mock failed to create worktree directory: {}", e);
        }

        self.worktrees
            .write()
            .await
            .insert(worktree_path.to_path_buf());
        Ok(None)
    }

    async fn delete_worktree(&self, _repo_path: &Path, worktree_path: &Path) -> anyhow::Result<()> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        // Delete the actual directory
        if worktree_path.exists() {
            if let Err(e) = std::fs::remove_dir_all(worktree_path) {
                tracing::warn!("Mock failed to delete worktree directory: {}", e);
            }
        }

        self.worktrees.write().await.remove(worktree_path);
        Ok(())
    }

    fn worktree_exists(&self, worktree_path: &Path) -> bool {
        // Use try_read to avoid blocking
        self.worktrees
            .try_read()
            .map(|guard| guard.contains(worktree_path))
            .unwrap_or(false)
    }

    async fn get_branch(&self, _worktree_path: &Path) -> anyhow::Result<String> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        // Return a mock branch name
        Ok("mock-branch".to_owned())
    }
}

/// Mock implementation of ExecutionBackend for testing.
///
/// Tracks session/container state in memory without executing actual commands.
pub struct MockExecutionBackend {
    /// Set of session/container names that "exist"
    sessions: RwLock<HashSet<String>>,

    /// If true, all operations will fail
    should_fail: AtomicBool,

    /// Error message to return when should_fail is true
    error_message: RwLock<String>,

    /// Name prefix to use (e.g., "zellij" or "docker")
    name_prefix: String,

    /// Whether exists() should return true (for health check testing)
    exists_result: AtomicBool,

    /// Simulated health state for check_health()
    health_state: RwLock<super::traits::BackendResourceHealth>,
}

impl std::fmt::Debug for MockExecutionBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MockExecutionBackend")
            .field("name_prefix", &self.name_prefix)
            .finish_non_exhaustive()
    }
}

impl MockExecutionBackend {
    /// Create a new mock execution backend with default prefix
    #[must_use]
    pub fn new() -> Self {
        Self::with_prefix("mock")
    }

    /// Create a new mock execution backend with a specific name prefix
    #[must_use]
    pub fn with_prefix(name_prefix: impl Into<String>) -> Self {
        Self {
            sessions: RwLock::new(HashSet::new()),
            should_fail: AtomicBool::new(false),
            error_message: RwLock::new("Mock failure".to_owned()),
            name_prefix: name_prefix.into(),
            exists_result: AtomicBool::new(true),
            health_state: RwLock::new(super::traits::BackendResourceHealth::Running),
        }
    }

    /// Create a mock Zellij backend
    #[must_use]
    pub fn zellij() -> Self {
        Self::with_prefix("zellij")
    }

    /// Create a mock Docker backend
    #[must_use]
    pub fn docker() -> Self {
        Self::with_prefix("docker")
    }

    /// Create a mock Kubernetes backend
    #[must_use]
    pub fn kubernetes() -> Self {
        Self::with_prefix("kubernetes")
    }

    /// Create a mock Sprites backend
    #[must_use]
    pub fn sprites() -> Self {
        Self::with_prefix("sprites")
    }

    /// Create a mock Apple Container backend
    #[cfg(target_os = "macos")]
    #[must_use]
    pub fn apple_container() -> Self {
        Self::with_prefix("apple_container")
    }

    /// Configure the mock to fail all operations
    pub fn set_should_fail(&self, should_fail: bool) {
        self.should_fail.store(should_fail, Ordering::SeqCst);
    }

    /// Set the error message to return when operations fail
    pub async fn set_error_message(&self, message: impl Into<String>) {
        *self.error_message.write().await = message.into();
    }

    /// Get a list of all sessions/containers that have been created
    pub async fn get_sessions(&self) -> Vec<String> {
        self.sessions.read().await.iter().cloned().collect()
    }

    /// Manually add a session (useful for testing existence checks)
    pub async fn add_session(&self, name: impl Into<String>) {
        self.sessions.write().await.insert(name.into());
    }

    /// Check if operations are configured to fail
    fn should_fail(&self) -> bool {
        self.should_fail.load(Ordering::SeqCst)
    }

    /// Set whether exists() should return true (for testing)
    pub fn set_exists(&mut self, exists: bool) {
        self.exists_result.store(exists, Ordering::SeqCst);
    }

    /// Set the health state to return from check_health()
    pub async fn set_health_state(&self, state: super::traits::BackendResourceHealth) {
        *self.health_state.write().await = state;
    }
}

impl Default for MockExecutionBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ExecutionBackend for MockExecutionBackend {
    async fn create(
        &self,
        name: &str,
        _workdir: &Path,
        _initial_prompt: &str,
        _options: super::traits::CreateOptions,
    ) -> anyhow::Result<String> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        let session_name = format!(
            "{name_prefix}-{name}",
            name_prefix = self.name_prefix,
            name = name
        );
        self.sessions.write().await.insert(session_name.clone());
        Ok(session_name)
    }

    async fn exists(&self, id: &str) -> anyhow::Result<bool> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        Ok(self.sessions.read().await.contains(id))
    }

    async fn delete(&self, id: &str) -> anyhow::Result<()> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        self.sessions.write().await.remove(id);
        Ok(())
    }

    fn attach_command(&self, id: &str) -> Vec<String> {
        vec![self.name_prefix.clone(), "attach".to_owned(), id.to_owned()]
    }

    async fn get_output(&self, _id: &str, _lines: usize) -> anyhow::Result<String> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        Ok("Mock output".to_owned())
    }

    fn capabilities(&self) -> super::traits::BackendCapabilities {
        super::traits::BackendCapabilities {
            can_recreate: true,
            can_update_image: true,
            preserves_data_on_recreate: true,
            can_start: true,
            can_wake: false,
            data_preservation_description: "Mock backend - data is preserved.",
        }
    }

    async fn check_health(
        &self,
        _id: &str,
    ) -> anyhow::Result<super::traits::BackendResourceHealth> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        // If the session doesn't exist, return NotFound
        if !self.exists_result.load(Ordering::SeqCst) {
            return Ok(super::traits::BackendResourceHealth::NotFound);
        }

        // Return the configured health state
        Ok(self.health_state.read().await.clone())
    }

    async fn start(&self, _id: &str) -> anyhow::Result<()> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_mock_git_create_worktree() {
        let git = MockGitBackend::new();
        let worktree = PathBuf::from("/tmp/test-worktree");

        git.create_worktree(Path::new("/repo"), &worktree, "branch")
            .await
            .unwrap();

        assert!(git.worktree_exists(&worktree));
    }

    #[tokio::test]
    async fn test_mock_git_delete_worktree() {
        let git = MockGitBackend::new();
        let repo = Path::new("/repo");
        let worktree = PathBuf::from("/tmp/test-worktree");

        git.create_worktree(repo, &worktree, "branch")
            .await
            .unwrap();
        assert!(git.worktree_exists(&worktree));

        git.delete_worktree(repo, &worktree).await.unwrap();
        assert!(!git.worktree_exists(&worktree));
    }

    #[tokio::test]
    async fn test_mock_git_should_fail() {
        let git = MockGitBackend::new();
        git.set_should_fail(true);
        git.set_error_message("Simulated failure").await;

        let result = git
            .create_worktree(Path::new("/repo"), Path::new("/worktree"), "branch")
            .await;

        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Simulated failure")
        );
    }

    #[tokio::test]
    async fn test_mock_execution_create() {
        use crate::backends::CreateOptions;
        let backend = MockExecutionBackend::zellij();

        let name = backend
            .create(
                "test-session",
                Path::new("/workdir"),
                "prompt",
                CreateOptions::default(),
            )
            .await
            .unwrap();

        assert!(name.starts_with("zellij-"));
        assert!(backend.exists(&name).await.unwrap());
    }

    #[tokio::test]
    async fn test_mock_execution_delete() {
        use crate::backends::CreateOptions;
        let backend = MockExecutionBackend::docker();

        let name = backend
            .create(
                "test-container",
                Path::new("/workdir"),
                "prompt",
                CreateOptions::default(),
            )
            .await
            .unwrap();
        assert!(backend.exists(&name).await.unwrap());

        backend.delete(&name).await.unwrap();
        assert!(!backend.exists(&name).await.unwrap());
    }

    #[tokio::test]
    async fn test_mock_execution_attach_command() {
        let backend = MockExecutionBackend::zellij();
        let cmd = backend.attach_command("my-session");

        assert_eq!(cmd, vec!["zellij", "attach", "my-session"]);
    }

    #[tokio::test]
    async fn test_mock_execution_should_fail() {
        use crate::backends::CreateOptions;
        let backend = MockExecutionBackend::with_prefix("test");
        backend.set_should_fail(true);
        backend.set_error_message("Docker error").await;

        let result = backend
            .create(
                "session",
                Path::new("/workdir"),
                "prompt",
                CreateOptions::default(),
            )
            .await;

        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Docker error"));
    }
}
