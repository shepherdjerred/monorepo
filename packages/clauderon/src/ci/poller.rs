use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::time::interval;
use uuid::Uuid;

use crate::core::{CheckStatus, MergeMethod, PrReviewStatus, ReviewDecision, SessionManager, SessionStatus};

/// CI status poller - polls GitHub PR checks for sessions with PRs
pub struct CIPoller {
    manager: Arc<SessionManager>,
    ci_poll_interval: Duration,
    pr_discovery_interval: Duration,
    conflict_check_interval: Duration,
    dirty_check_interval: Duration,
}

impl CIPoller {
    /// Create a new CI poller
    #[must_use]
    pub fn new(manager: Arc<SessionManager>) -> Self {
        Self {
            manager,
            ci_poll_interval: Duration::from_secs(30), // Poll CI checks every 30 seconds
            pr_discovery_interval: Duration::from_secs(60), // Discover PRs every 60 seconds
            conflict_check_interval: Duration::from_secs(60), // Check for conflicts every 60 seconds
            dirty_check_interval: Duration::from_secs(60),    // Check dirty status every 60 seconds
        }
    }

    /// Start the poller (runs in background)
    pub async fn start(self) {
        let mut ci_ticker = interval(self.ci_poll_interval);
        let mut pr_discovery_ticker = interval(self.pr_discovery_interval);
        let mut conflict_ticker = interval(self.conflict_check_interval);
        let mut dirty_ticker = interval(self.dirty_check_interval);

        loop {
            tokio::select! {
                _ = ci_ticker.tick() => {
                    self.poll_ci_status().await;
                }
                _ = pr_discovery_ticker.tick() => {
                    self.discover_prs().await;
                }
                _ = conflict_ticker.tick() => {
                    self.check_conflicts().await;
                }
                _ = dirty_ticker.tick() => {
                    self.check_dirty_status().await;
                }
            }
        }
    }

    /// Poll CI status for all sessions with PRs
    async fn poll_ci_status(&self) {
        let sessions = self.manager.list_sessions().await;

        for session in sessions {
            // Skip archived sessions - they have no active resources
            if session.status == SessionStatus::Archived {
                continue;
            }

            // Only poll sessions with PRs
            if let Some(ref pr_url) = session.pr_url {
                if let Err(e) = self
                    .poll_pr_status(&session.id, pr_url, &session.repo_path)
                    .await
                {
                    tracing::debug!(
                        session_id = %session.id,
                        pr_url = %pr_url,
                        error = %e,
                        "Failed to poll CI status"
                    );
                }
            }
        }
    }

    /// Discover PRs for sessions without pr_url
    async fn discover_prs(&self) {
        let sessions = self.manager.list_sessions().await;

        for session in sessions {
            // Skip archived sessions - they have no active resources
            if session.status == SessionStatus::Archived {
                continue;
            }

            // Only discover PRs for sessions without pr_url
            if session.pr_url.is_none() {
                if let Err(e) = self
                    .discover_pr_for_session(&session.id, &session.branch_name, &session.repo_path)
                    .await
                {
                    tracing::debug!(
                        session_id = %session.id,
                        branch = %session.branch_name,
                        error = %e,
                        "Failed to discover PR (expected if no PR exists yet)"
                    );
                }
            }
        }
    }

    /// Discover PR for a specific session by branch name
    async fn discover_pr_for_session(
        &self,
        session_id: &Uuid,
        branch_name: &str,
        repo_path: &Path,
    ) -> anyhow::Result<()> {
        // Use gh CLI to find PRs for this branch
        // gh infers the repo from the git remote in the working directory
        let output = tokio::process::Command::new("gh")
            .current_dir(repo_path)
            .args([
                "pr",
                "list",
                "--head",
                branch_name,
                "--json",
                "number,url",
                "--limit",
                "1",
            ])
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow::anyhow!("gh pr list failed: {}", stderr));
        }

        let json_output = String::from_utf8_lossy(&output.stdout);
        if json_output.trim().is_empty() || json_output.trim() == "[]" {
            // No PR found (this is expected for new branches)
            return Ok(());
        }

        let prs: Vec<serde_json::Value> = serde_json::from_str(&json_output)?;
        if let Some(pr) = prs.first() {
            if let Some(url) = pr["url"].as_str() {
                tracing::info!(
                    session_id = %session_id,
                    branch = %branch_name,
                    pr_url = %url,
                    "Discovered PR for session"
                );
                self.manager.link_pr(*session_id, url.to_string()).await?;

                // Fetch merge methods and repository settings once when PR is discovered
                self.poll_pr_merge_methods(session_id, repo_path).await.ok(); // Don't fail if merge methods fetch fails
            }
        }

        Ok(())
    }

    /// Check for merge conflicts on all sessions with PRs
    async fn check_conflicts(&self) {
        let sessions = self.manager.list_sessions().await;

        for session in sessions {
            // Skip archived sessions - they have no active resources
            if session.status == SessionStatus::Archived {
                continue;
            }

            // Only check sessions with PRs
            if let Some(ref pr_url) = session.pr_url {
                if let Err(e) = self
                    .check_pr_conflicts(&session.id, pr_url, &session.repo_path)
                    .await
                {
                    tracing::debug!(
                        session_id = %session.id,
                        pr_url = %pr_url,
                        error = %e,
                        "Failed to check PR conflicts"
                    );
                }
            }
        }
    }

    /// Check for merge conflicts on a specific PR
    async fn check_pr_conflicts(
        &self,
        session_id: &Uuid,
        pr_url: &str,
        repo_path: &Path,
    ) -> anyhow::Result<()> {
        // Parse PR number from URL
        let pr_number = pr_url
            .split('/')
            .next_back()
            .and_then(|s| s.parse::<u32>().ok())
            .ok_or_else(|| anyhow::anyhow!("Invalid PR URL: {}", pr_url))?;

        // Use gh CLI to check if PR is mergeable
        // gh infers the repo from the git remote in the working directory
        let output = tokio::process::Command::new("gh")
            .current_dir(repo_path)
            .args(["pr", "view", &pr_number.to_string(), "--json", "mergeable"])
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow::anyhow!("gh pr view failed: {}", stderr));
        }

        let json_output = String::from_utf8_lossy(&output.stdout);
        let data: serde_json::Value = serde_json::from_str(&json_output)?;

        // GitHub mergeable values: "MERGEABLE", "CONFLICTING", "UNKNOWN"
        let has_conflict = match data["mergeable"].as_str() {
            Some("CONFLICTING") => true,
            Some("MERGEABLE" | "UNKNOWN") | None | _ => false,
        };

        // Update session if conflict status changed
        self.manager
            .update_conflict_status(*session_id, has_conflict)
            .await?;

        Ok(())
    }

    /// Poll CI status and review status for a specific PR
    async fn poll_pr_status(
        &self,
        session_id: &Uuid,
        pr_url: &str,
        repo_path: &Path,
    ) -> anyhow::Result<()> {
        // Parse PR number from URL
        let pr_number = pr_url
            .split('/')
            .next_back()
            .and_then(|s| s.parse::<u32>().ok())
            .ok_or_else(|| anyhow::anyhow!("Invalid PR URL: {}", pr_url))?;

        // First, get PR review status (from incoming merge button feature)
        self.poll_pr_review_status(session_id, pr_number, repo_path)
            .await
            .ok(); // Don't fail if review status fetch fails

        // Get CI check status using gh pr checks
        let checks_output = tokio::process::Command::new("gh")
            .current_dir(repo_path)
            .args(["pr", "checks", &pr_number.to_string(), "--json", "state"])
            .output()
            .await?;

        if !checks_output.status.success() {
            let stderr = String::from_utf8_lossy(&checks_output.stderr);
            // Check for expected failures (PR not found, already merged, etc.)
            if stderr.contains("not found") || stderr.contains("no pull request") {
                tracing::debug!(
                    pr_url = %pr_url,
                    "PR not found or merged (expected during cleanup)"
                );
                return Ok(());
            }
            // Log unexpected failures (authentication, network, etc.)
            tracing::warn!(
                pr_url = %pr_url,
                stderr = %stderr.trim(),
                "gh pr checks failed - may need re-auth or network issue"
            );
            return Ok(()); // Don't crash the poller
        }

        let checks_json = String::from_utf8_lossy(&checks_output.stdout);
        if checks_json.trim().is_empty() {
            tracing::debug!(pr_url = %pr_url, "gh pr checks returned empty output");
            return Ok(());
        }
        let checks: Vec<serde_json::Value> = serde_json::from_str(&checks_json).map_err(|e| {
            anyhow::anyhow!(
                "Failed to parse gh pr checks output: {}. Raw output: {:?}",
                e,
                if checks_json.len() > 200 {
                    &checks_json[..200]
                } else {
                    &checks_json
                }
            )
        })?;

        // Determine overall check status
        // State values from gh pr checks: SUCCESS, FAILURE, PENDING, SKIPPED, CANCELLED, etc.
        let new_check_status = if checks.is_empty() {
            CheckStatus::Pending
        } else if checks
            .iter()
            .any(|c| matches!(c["state"].as_str(), Some("FAILURE" | "CANCELLED" | "ERROR")))
        {
            CheckStatus::Failing
        } else if checks
            .iter()
            .all(|c| matches!(c["state"].as_str(), Some("SUCCESS" | "SKIPPED")))
        {
            CheckStatus::Passing
        } else {
            CheckStatus::Pending
        };

        // Second, get review decision using gh pr view
        let review_output = tokio::process::Command::new("gh")
            .current_dir(repo_path)
            .args([
                "pr",
                "view",
                &pr_number.to_string(),
                "--json",
                "reviewDecision",
            ])
            .output()
            .await?;

        let mut new_review_decision: Option<ReviewDecision> = None;
        if review_output.status.success() {
            let review_json = String::from_utf8_lossy(&review_output.stdout);
            if let Ok(data) = serde_json::from_str::<serde_json::Value>(&review_json) {
                // GitHub reviewDecision values: APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, null
                new_review_decision = match data["reviewDecision"].as_str() {
                    Some("APPROVED") => Some(ReviewDecision::Approved),
                    Some("CHANGES_REQUESTED") => Some(ReviewDecision::ChangesRequested),
                    Some("REVIEW_REQUIRED") | None => Some(ReviewDecision::ReviewRequired),
                    _ => None,
                };
            }
        }

        // Update session if status changed
        let current_session = self.manager.get_session(&session_id.to_string()).await;
        if let Some(session) = current_session {
            // Update check status if changed
            if session.pr_check_status != Some(new_check_status) {
                self.manager
                    .update_pr_check_status(*session_id, new_check_status)
                    .await?;
            }

            // Update review decision if changed
            if let Some(decision) = new_review_decision {
                if session.pr_review_decision != Some(decision) {
                    self.manager
                        .update_pr_review_decision(*session_id, decision)
                        .await?;
                }
            }
        }

        Ok(())
    }

    /// Poll PR review status
    async fn poll_pr_review_status(
        &self,
        session_id: &Uuid,
        pr_number: u32,
        repo_path: &Path,
    ) -> anyhow::Result<()> {
        // Use gh CLI to check PR review status
        let output = tokio::process::Command::new("gh")
            .current_dir(repo_path)
            .args([
                "pr",
                "view",
                &pr_number.to_string(),
                "--json",
                "reviewDecision",
            ])
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow::anyhow!("gh pr view failed: {}", stderr));
        }

        let json_output = String::from_utf8_lossy(&output.stdout);
        let data: serde_json::Value = serde_json::from_str(&json_output)?;

        // GitHub reviewDecision values: "APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED", or null
        let review_status = match data["reviewDecision"].as_str() {
            Some("APPROVED") => PrReviewStatus::Approved,
            Some("CHANGES_REQUESTED") => PrReviewStatus::ChangesRequested,
            Some("REVIEW_REQUIRED") => PrReviewStatus::ReviewRequired,
            None | Some(_) => PrReviewStatus::Unknown,
        };

        // Update session if review status changed
        let current_session = self.manager.get_session(&session_id.to_string()).await;
        if let Some(session) = current_session {
            if session.pr_review_status != Some(review_status) {
                self.manager
                    .update_pr_review_status(*session_id, review_status)
                    .await?;
            }
        }

        Ok(())
    }

    /// Poll PR merge methods and repository settings (called once when PR is discovered)
    async fn poll_pr_merge_methods(
        &self,
        session_id: &Uuid,
        repo_path: &Path,
    ) -> anyhow::Result<()> {
        // Get repository full name (owner/repo) from git remote
        let output = tokio::process::Command::new("gh")
            .current_dir(repo_path)
            .args(["repo", "view", "--json", "owner,name"])
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow::anyhow!("gh repo view failed: {}", stderr));
        }

        let json_output = String::from_utf8_lossy(&output.stdout);
        let data: serde_json::Value = serde_json::from_str(&json_output)?;

        let owner = data["owner"]["login"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("Missing owner in repo info"))?;
        let name = data["name"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("Missing name in repo info"))?;

        // Get repository settings via GitHub API
        let output = tokio::process::Command::new("gh")
            .current_dir(repo_path)
            .args([
                "api",
                &format!("repos/{}/{}", owner, name),
                "--jq",
                "{allow_merge_commit,allow_squash_merge,allow_rebase_merge,delete_branch_on_merge}",
            ])
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(anyhow::anyhow!("gh api failed: {}", stderr));
        }

        let json_output = String::from_utf8_lossy(&output.stdout);
        let settings: serde_json::Value = serde_json::from_str(&json_output)?;

        // Build list of available merge methods
        let mut methods = Vec::new();
        if settings["allow_merge_commit"].as_bool().unwrap_or(false) {
            methods.push(MergeMethod::Merge);
        }
        if settings["allow_squash_merge"].as_bool().unwrap_or(false) {
            methods.push(MergeMethod::Squash);
        }
        if settings["allow_rebase_merge"].as_bool().unwrap_or(false) {
            methods.push(MergeMethod::Rebase);
        }

        // Default to first available method (GitHub's default order)
        let default_method = methods.first().copied().unwrap_or(MergeMethod::Merge);
        let delete_branch = settings["delete_branch_on_merge"]
            .as_bool()
            .unwrap_or(false);

        // Update session with merge methods
        self.manager
            .update_pr_merge_methods(*session_id, methods, default_method, delete_branch)
            .await?;

        Ok(())
    }

    /// Check working tree dirty status for all sessions
    async fn check_dirty_status(&self) {
        let sessions = self.manager.list_sessions().await;

        for session in sessions {
            // Skip archived sessions - they have no active resources
            if session.status == SessionStatus::Archived {
                continue;
            }

            // Check all sessions (not just those with PRs)
            if let Err(e) = self
                .check_session_dirty_status(&session.id, &session.worktree_path)
                .await
            {
                tracing::debug!(
                    session_id = %session.id,
                    worktree_path = %session.worktree_path.display(),
                    error = %e,
                    "Failed to check worktree dirty status"
                );
            }
        }
    }

    /// Check dirty status for a specific session
    async fn check_session_dirty_status(
        &self,
        session_id: &Uuid,
        worktree_path: &Path,
    ) -> anyhow::Result<()> {
        use crate::utils::git;

        // Get changed files list (empty if worktree is clean)
        let changed_files = git::get_worktree_changed_files(worktree_path).await?;
        let is_dirty = !changed_files.is_empty();
        let changed_files_opt = if is_dirty { Some(changed_files) } else { None };

        self.manager
            .update_worktree_dirty_status(*session_id, is_dirty, changed_files_opt)
            .await?;

        Ok(())
    }
}
