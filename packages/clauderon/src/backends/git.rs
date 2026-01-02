use async_trait::async_trait;
use std::path::Path;
use tokio::process::Command;

use super::traits::GitOperations;

/// Git worktree backend
pub struct GitBackend;

impl GitBackend {
    /// Create a new Git backend
    #[must_use]
    pub const fn new() -> Self {
        Self
    }
}

impl Default for GitBackend {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl GitOperations for GitBackend {
    /// Create a new git worktree
    ///
    /// # Returns
    ///
    /// - `Ok(None)` if the worktree was created successfully
    /// - `Ok(Some(warning))` if the worktree was created but post-checkout hook failed
    /// - `Err(_)` if the worktree creation failed
    ///
    /// # Errors
    ///
    /// Returns an error if the git command fails and the worktree does not exist.
    async fn create_worktree(
        &self,
        repo_path: &Path,
        worktree_path: &Path,
        branch_name: &str,
    ) -> anyhow::Result<Option<String>> {
        // Ensure the worktree parent directory exists
        if let Some(parent) = worktree_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        // Create and checkout a new branch
        let output = Command::new("git")
            .current_dir(repo_path)
            .args(["worktree", "add", "-b", branch_name])
            .arg(worktree_path)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);

            // Check if worktree was actually created despite non-zero exit code
            // (e.g., post-checkout hook failed but worktree itself is fine)
            // Verify .git file exists to confirm it's a proper worktree, not just a directory
            let git_file = worktree_path.join(".git");
            if git_file.exists() && git_file.is_file() {
                tracing::warn!(
                    repo = %repo_path.display(),
                    worktree = %worktree_path.display(),
                    branch = branch_name,
                    stderr = %stderr,
                    "Worktree created but post-checkout hook failed"
                );

                // Build warning message, handling empty stderr
                let warning_msg = if stderr.trim().is_empty() {
                    "Post-checkout hook failed (no error output)".to_string()
                } else {
                    format!("Post-checkout hook failed: {stderr}")
                };
                return Ok(Some(warning_msg));
            }

            // Worktree doesn't exist or is invalid - real failure
            tracing::error!(
                repo = %repo_path.display(),
                worktree = %worktree_path.display(),
                branch = branch_name,
                stderr = %stderr,
                "Failed to create git worktree"
            );
            anyhow::bail!("Failed to create worktree: {stderr}");
        }

        tracing::info!(
            worktree = %worktree_path.display(),
            branch = branch_name,
            "Created git worktree"
        );

        Ok(None)
    }

    /// Delete a git worktree
    ///
    /// # Errors
    ///
    /// Returns an error if the directory removal fails.
    async fn delete_worktree(&self, repo_path: &Path, worktree_path: &Path) -> anyhow::Result<()> {
        // Remove the worktree using git (must run from within a git repo)
        let output = Command::new("git")
            .current_dir(repo_path)
            .args(["worktree", "remove", "--force"])
            .arg(worktree_path)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Log but don't fail - the worktree might already be gone
            tracing::warn!("Failed to remove worktree via git: {stderr}");

            // Try to remove the directory directly
            if worktree_path.exists() {
                tokio::fs::remove_dir_all(worktree_path).await?;
            }
        }

        tracing::info!(
            worktree = %worktree_path.display(),
            "Deleted git worktree"
        );

        Ok(())
    }

    /// Check if a worktree exists
    fn worktree_exists(&self, worktree_path: &Path) -> bool {
        worktree_path.exists()
    }

    /// Get the current branch of a worktree
    ///
    /// # Errors
    ///
    /// Returns an error if the git command fails.
    async fn get_branch(&self, worktree_path: &Path) -> anyhow::Result<String> {
        let output = Command::new("git")
            .current_dir(worktree_path)
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to get branch: {stderr}");
        }

        let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Ok(branch)
    }
}
