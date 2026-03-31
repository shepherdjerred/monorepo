use async_trait::async_trait;
use std::path::Path;
use tokio::process::Command;
use tracing::instrument;

use super::traits::GitOperations;

/// Git worktree backend
#[derive(Debug, Copy, Clone)]
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
    #[instrument(skip(self), fields(repo_path = %repo_path.display(), worktree_path = %worktree_path.display(), branch_name = %branch_name))]
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
                    "Post-checkout hook failed (no error output)".to_owned()
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
    #[instrument(skip(self), fields(repo_path = %repo_path.display(), worktree_path = %worktree_path.display()))]
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

    /// Clone a repository locally using `git clone --local`
    #[instrument(skip(self), fields(source = %source_repo.display(), target = %target_path.display(), branch = %branch_name))]
    async fn clone_local(
        &self,
        source_repo: &Path,
        target_path: &Path,
        branch_name: &str,
    ) -> anyhow::Result<Option<String>> {
        // Ensure parent directory exists
        if let Some(parent) = target_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        // git clone --local <source> <target>
        let output = Command::new("git")
            .args(["clone", "--local"])
            .arg(source_repo)
            .arg(target_path)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to clone repository: {stderr}");
        }

        // Fetch latest from origin
        let output = Command::new("git")
            .current_dir(target_path)
            .args(["fetch", "origin"])
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            tracing::warn!(target = %target_path.display(), "git fetch origin failed: {stderr}");
        }

        // Create and checkout the branch
        let output = Command::new("git")
            .current_dir(target_path)
            .args(["checkout", "-b", branch_name])
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            // Branch might already exist, try just checking out
            let fallback = Command::new("git")
                .current_dir(target_path)
                .args(["checkout", branch_name])
                .output()
                .await?;
            if !fallback.status.success() {
                let fallback_stderr = String::from_utf8_lossy(&fallback.stderr);
                anyhow::bail!("Failed to checkout branch '{branch_name}': {stderr} / {fallback_stderr}");
            }
        }

        tracing::info!(
            target = %target_path.display(),
            branch = branch_name,
            "Cloned repository locally"
        );

        Ok(None)
    }

    /// Delete a local clone
    #[instrument(skip(self), fields(clone_path = %clone_path.display()))]
    async fn delete_clone(&self, clone_path: &Path) -> anyhow::Result<()> {
        if clone_path.exists() {
            tokio::fs::remove_dir_all(clone_path).await?;
            tracing::info!(clone_path = %clone_path.display(), "Deleted local clone");
        }
        Ok(())
    }

    /// Claim a pre-staged clone from the pool, or fall back to inline clone
    #[instrument(skip(self), fields(source = %source_repo.display(), target = %target_path.display(), branch = %branch_name))]
    async fn claim_or_clone(
        &self,
        source_repo: &Path,
        target_path: &Path,
        branch_name: &str,
    ) -> anyhow::Result<Option<String>> {
        // Derive pool path from repo name
        let repo_name = source_repo
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("repo");
        let pool_dir = dirs::home_dir()
            .unwrap_or_default()
            .join(".clauderon")
            .join("pool");
        let staged_path = pool_dir.join(format!("{repo_name}-next"));

        if staged_path.exists() {
            tracing::info!(staged = %staged_path.display(), "Claiming pre-staged clone");

            // Move staged clone to target
            tokio::fs::rename(&staged_path, target_path).await?;

            // Fetch latest and checkout branch
            let _ = Command::new("git")
                .current_dir(target_path)
                .args(["fetch", "origin"])
                .output()
                .await;

            let output = Command::new("git")
                .current_dir(target_path)
                .args(["checkout", "-b", branch_name])
                .output()
                .await?;

            if !output.status.success() {
                let _ = Command::new("git")
                    .current_dir(target_path)
                    .args(["checkout", branch_name])
                    .output()
                    .await;
            }

            // Spawn background replenish
            let source = source_repo.to_path_buf();
            let git = Self::new();
            tokio::spawn(async move {
                if let Err(e) = git.replenish_pool(&source).await {
                    tracing::warn!(error = %e, "Failed to replenish clone pool");
                }
            });

            Ok(None)
        } else {
            // No staged clone available, fall back to inline clone
            let result = self.clone_local(source_repo, target_path, branch_name).await;

            // Spawn background replenish for next time
            let source = source_repo.to_path_buf();
            let git = Self::new();
            tokio::spawn(async move {
                if let Err(e) = git.replenish_pool(&source).await {
                    tracing::warn!(error = %e, "Failed to replenish clone pool");
                }
            });

            result
        }
    }

    /// Replenish the pre-staged clone pool
    #[instrument(skip(self), fields(source = %source_repo.display()))]
    async fn replenish_pool(&self, source_repo: &Path) -> anyhow::Result<()> {
        let repo_name = source_repo
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("repo");
        let pool_dir = dirs::home_dir()
            .unwrap_or_default()
            .join(".clauderon")
            .join("pool");
        tokio::fs::create_dir_all(&pool_dir).await?;

        let staged_path = pool_dir.join(format!("{repo_name}-next"));
        if staged_path.exists() {
            tracing::debug!("Pool already has a staged clone, skipping replenish");
            return Ok(());
        }

        let wip_path = pool_dir.join(format!("{repo_name}-next-wip"));
        // Clean up any leftover WIP
        if wip_path.exists() {
            tokio::fs::remove_dir_all(&wip_path).await?;
        }

        let output = Command::new("git")
            .args(["clone", "--local"])
            .arg(source_repo)
            .arg(&wip_path)
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            anyhow::bail!("Failed to replenish pool: {stderr}");
        }

        // Atomically move to staged path
        tokio::fs::rename(&wip_path, &staged_path).await?;

        tracing::info!(
            staged = %staged_path.display(),
            "Replenished clone pool"
        );

        Ok(())
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

        let branch = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        Ok(branch)
    }
}
