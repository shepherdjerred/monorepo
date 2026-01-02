use std::sync::Arc;
use std::time::Duration;
use tokio::time::interval;
use uuid::Uuid;

use crate::core::{CheckStatus, SessionManager};

/// CI status poller - polls GitHub PR checks for sessions with PRs
pub struct CIPoller {
    manager: Arc<SessionManager>,
    ci_poll_interval: Duration,
    pr_discovery_interval: Duration,
    conflict_check_interval: Duration,
}

impl CIPoller {
    /// Create a new CI poller
    #[must_use]
    pub fn new(manager: Arc<SessionManager>) -> Self {
        Self {
            manager,
            ci_poll_interval: Duration::from_secs(30),  // Poll CI checks every 30 seconds
            pr_discovery_interval: Duration::from_secs(60), // Discover PRs every 60 seconds
            conflict_check_interval: Duration::from_secs(60), // Check for conflicts every 60 seconds
        }
    }

    /// Start the poller (runs in background)
    pub async fn start(self) {
        let mut ci_ticker = interval(self.ci_poll_interval);
        let mut pr_discovery_ticker = interval(self.pr_discovery_interval);
        let mut conflict_ticker = interval(self.conflict_check_interval);

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
            }
        }
    }

    /// Poll CI status for all sessions with PRs
    async fn poll_ci_status(&self) {
        let sessions = self.manager.list_sessions().await;

        for session in sessions {
            // Only poll sessions with PRs
            if let Some(ref pr_url) = session.pr_url {
                if let Err(e) = self.poll_pr_status(&session.id, pr_url).await {
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
            // Only discover PRs for sessions without pr_url
            if session.pr_url.is_none() {
                if let Err(e) = self.discover_pr_for_session(&session.id, &session.branch_name).await {
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
    async fn discover_pr_for_session(&self, session_id: &Uuid, branch_name: &str) -> anyhow::Result<()> {
        // Use gh CLI to find PRs for this branch
        let output = tokio::process::Command::new("gh")
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
            }
        }

        Ok(())
    }

    /// Check for merge conflicts on all sessions with PRs
    async fn check_conflicts(&self) {
        let sessions = self.manager.list_sessions().await;

        for session in sessions {
            // Only check sessions with PRs
            if let Some(ref pr_url) = session.pr_url {
                if let Err(e) = self.check_pr_conflicts(&session.id, pr_url).await {
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
    async fn check_pr_conflicts(&self, session_id: &Uuid, pr_url: &str) -> anyhow::Result<()> {
        // Parse PR number from URL
        let pr_number = pr_url
            .split('/')
            .last()
            .and_then(|s| s.parse::<u32>().ok())
            .ok_or_else(|| anyhow::anyhow!("Invalid PR URL: {}", pr_url))?;

        // Use gh CLI to check if PR is mergeable
        let output = tokio::process::Command::new("gh")
            .args([
                "pr",
                "view",
                &pr_number.to_string(),
                "--json",
                "mergeable",
            ])
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
            Some("MERGEABLE") | Some("UNKNOWN") | None => false,
            _ => false,
        };

        // Update session if conflict status changed
        self.manager
            .update_conflict_status(*session_id, has_conflict)
            .await?;

        Ok(())
    }

    /// Poll CI status for a specific PR
    async fn poll_pr_status(&self, session_id: &Uuid, pr_url: &str) -> anyhow::Result<()> {
        // Parse PR number from URL
        let pr_number = pr_url
            .split('/')
            .last()
            .and_then(|s| s.parse::<u32>().ok())
            .ok_or_else(|| anyhow::anyhow!("Invalid PR URL: {}", pr_url))?;

        // Use gh CLI to check PR status
        let output = tokio::process::Command::new("gh")
            .args([
                "pr",
                "checks",
                &pr_number.to_string(),
                "--json",
                "state,conclusion",
            ])
            .output()
            .await?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
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

        let json_output = String::from_utf8_lossy(&output.stdout);
        if json_output.trim().is_empty() {
            tracing::debug!(pr_url = %pr_url, "gh pr checks returned empty output");
            return Ok(());
        }
        let checks: Vec<serde_json::Value> = serde_json::from_str(&json_output).map_err(|e| {
            anyhow::anyhow!(
                "Failed to parse gh pr checks output: {}. Raw output: {:?}",
                e,
                if json_output.len() > 200 {
                    &json_output[..200]
                } else {
                    &json_output
                }
            )
        })?;

        // Determine overall status
        let new_status = if checks.is_empty() {
            CheckStatus::Pending
        } else if checks.iter().any(|c| {
            c["conclusion"].as_str() == Some("failure")
                || c["conclusion"].as_str() == Some("cancelled")
        }) {
            CheckStatus::Failing
        } else if checks
            .iter()
            .all(|c| c["conclusion"].as_str() == Some("success"))
        {
            CheckStatus::Passing
        } else {
            CheckStatus::Pending
        };

        // Update session if status changed
        let current_session = self.manager.get_session(&session_id.to_string()).await;
        if let Some(session) = current_session {
            if session.pr_check_status != Some(new_status) {
                self.manager
                    .update_pr_check_status(*session_id, new_status)
                    .await?;
            }
        }

        Ok(())
    }
}
