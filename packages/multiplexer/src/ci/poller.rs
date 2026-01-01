use std::sync::Arc;
use std::time::Duration;
use tokio::time::interval;
use uuid::Uuid;

use crate::core::{CheckStatus, SessionManager};

/// CI status poller - polls GitHub PR checks for sessions with PRs
pub struct CIPoller {
    manager: Arc<SessionManager>,
    poll_interval: Duration,
}

impl CIPoller {
    /// Create a new CI poller
    #[must_use]
    pub fn new(manager: Arc<SessionManager>) -> Self {
        Self {
            manager,
            poll_interval: Duration::from_secs(30), // Poll every 30 seconds
        }
    }

    /// Start the poller (runs in background)
    pub async fn start(self) {
        let mut ticker = interval(self.poll_interval);

        loop {
            ticker.tick().await;

            let sessions = self.manager.list_sessions().await;

            for session in sessions {
                // Only poll sessions with PRs
                if let Some(ref pr_url) = session.pr_url {
                    if let Err(e) = self.poll_pr_status(&session.id, pr_url).await {
                        tracing::warn!(
                            session_id = %session.id,
                            pr_url = %pr_url,
                            error = %e,
                            "Failed to poll CI status"
                        );
                    }
                }
            }
        }
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
        let checks: Vec<serde_json::Value> = serde_json::from_str(&json_output)?;

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
