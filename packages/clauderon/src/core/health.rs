//! Health checking service for sessions
//!
//! This module provides the `HealthService` which checks the health of sessions
//! by comparing their expected state (in the database) with actual state (backend resources).

use std::sync::Arc;
use tracing::instrument;
use uuid::Uuid;

use crate::backends::{BackendResourceHealth, ExecutionBackend, GitOperations};
use crate::core::session::{
    AvailableAction, BackendType, HealthCheckResult, ResourceState, Session, SessionHealthReport,
    SessionStatus,
};

/// Service for checking session health
///
/// The HealthService compares expected state (from the database) with actual state
/// (from backend resources) to generate health reports for sessions.
pub struct HealthService {
    git: Arc<dyn GitOperations>,
    zellij: Arc<dyn ExecutionBackend>,
    docker: Arc<dyn ExecutionBackend>,
    kubernetes: Arc<dyn ExecutionBackend>,
    #[cfg(target_os = "macos")]
    apple_container: Arc<dyn ExecutionBackend>,
    sprites: Arc<dyn ExecutionBackend>,
}

impl std::fmt::Debug for HealthService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HealthService").finish_non_exhaustive()
    }
}

impl HealthService {
    /// Create a new health service with backend references
    pub fn new(
        git: Arc<dyn GitOperations>,
        zellij: Arc<dyn ExecutionBackend>,
        docker: Arc<dyn ExecutionBackend>,
        kubernetes: Arc<dyn ExecutionBackend>,
        #[cfg(target_os = "macos")] apple_container: Arc<dyn ExecutionBackend>,
        sprites: Arc<dyn ExecutionBackend>,
    ) -> Self {
        Self {
            git,
            zellij,
            docker,
            kubernetes,
            #[cfg(target_os = "macos")]
            apple_container,
            sprites,
        }
    }

    /// Get the backend for a session
    fn get_backend(&self, backend_type: BackendType) -> &dyn ExecutionBackend {
        match backend_type {
            BackendType::Zellij => self.zellij.as_ref(),
            BackendType::Docker => self.docker.as_ref(),
            BackendType::Kubernetes => self.kubernetes.as_ref(),
            #[cfg(target_os = "macos")]
            BackendType::AppleContainer => self.apple_container.as_ref(),
            BackendType::Sprites => self.sprites.as_ref(),
        }
    }

    /// Check health of all sessions
    ///
    /// Returns a `HealthCheckResult` with reports for all sessions.
    #[instrument(skip(self, sessions))]
    pub async fn check_all_sessions(&self, sessions: &[Session]) -> HealthCheckResult {
        let mut reports = Vec::with_capacity(sessions.len());

        for session in sessions {
            // Skip sessions that are still being created or deleted
            if matches!(
                session.status,
                SessionStatus::Creating | SessionStatus::Deleting
            ) {
                continue;
            }

            let report = self.check_session(session).await;
            reports.push(report);
        }

        HealthCheckResult::new(reports)
    }

    /// Check health of a single session
    ///
    /// # Arguments
    ///
    /// * `session` - The session to check
    ///
    /// # Returns
    ///
    /// A `SessionHealthReport` describing the current state and available actions.
    #[instrument(skip(self, session), fields(session_id = %session.id, session_name = %session.name))]
    pub async fn check_session(&self, session: &Session) -> SessionHealthReport {
        // Skip archived sessions - they're always "OK"
        if session.status == SessionStatus::Archived {
            return SessionHealthReport::healthy(session.id, session.name.clone(), session.backend);
        }

        // Check if worktree exists (for non-remote backends)
        let backend = self.get_backend(session.backend);
        if !backend.is_remote() && !self.git.worktree_exists(&session.worktree_path) {
            return self.build_worktree_missing_report(session);
        }

        // Check backend resource state
        let Some(backend_id) = &session.backend_id else {
            // No backend ID means the session is incomplete
            return self.build_missing_report(session, "No backend resource created yet");
        };

        // Check backend health
        match backend.check_health(backend_id).await {
            Ok(health) => self.build_report_from_health(session, health),
            Err(e) => {
                tracing::warn!(
                    session_id = %session.id,
                    backend_id = %backend_id,
                    error = %e,
                    "Failed to check backend health"
                );
                // If we can't check health, assume there's an error
                SessionHealthReport {
                    session_id: session.id,
                    session_name: session.name.clone(),
                    backend_type: session.backend,
                    state: ResourceState::Error {
                        message: format!("Failed to check health: {e}"),
                    },
                    available_actions: vec![AvailableAction::Recreate],
                    recommended_action: Some(AvailableAction::Recreate),
                    description: "Could not determine backend status.".to_owned(),
                    details: format!("Health check error: {e}"),
                    data_safe: true, // Assume safe by default
                }
            }
        }
    }

    /// Build a health report from backend health state
    fn build_report_from_health(
        &self,
        session: &Session,
        health: BackendResourceHealth,
    ) -> SessionHealthReport {
        let backend = self.get_backend(session.backend);
        let capabilities = backend.capabilities();

        match health {
            BackendResourceHealth::Running => {
                // Healthy - offer proactive recreate if supported
                let mut actions = Vec::new();
                if capabilities.can_recreate {
                    actions.push(AvailableAction::Recreate);
                }
                if capabilities.can_update_image {
                    actions.push(AvailableAction::UpdateImage);
                }

                SessionHealthReport {
                    session_id: session.id,
                    session_name: session.name.clone(),
                    backend_type: session.backend,
                    state: ResourceState::Healthy,
                    available_actions: actions,
                    recommended_action: None,
                    description: "Session is running normally.".to_owned(),
                    details: capabilities.data_preservation_description.to_owned(),
                    data_safe: true,
                }
            }

            BackendResourceHealth::Stopped => {
                let mut actions = Vec::new();
                if capabilities.can_start {
                    actions.push(AvailableAction::Start);
                }
                if capabilities.can_recreate {
                    actions.push(AvailableAction::Recreate);
                }

                SessionHealthReport {
                    session_id: session.id,
                    session_name: session.name.clone(),
                    backend_type: session.backend,
                    state: ResourceState::Stopped,
                    available_actions: actions.clone(),
                    recommended_action: actions.first().copied(),
                    description: "The container/resource is stopped.".to_owned(),
                    details: format!(
                        "{}\n\nYou can start it again or recreate it.",
                        capabilities.data_preservation_description
                    ),
                    data_safe: capabilities.preserves_data_on_recreate,
                }
            }

            BackendResourceHealth::Hibernated => {
                let mut actions = Vec::new();
                if capabilities.can_wake {
                    actions.push(AvailableAction::Wake);
                }
                if capabilities.can_recreate {
                    actions.push(AvailableAction::Recreate);
                }

                SessionHealthReport {
                    session_id: session.id,
                    session_name: session.name.clone(),
                    backend_type: session.backend,
                    state: ResourceState::Hibernated,
                    available_actions: actions.clone(),
                    recommended_action: actions.first().copied(),
                    description: "The sprite is hibernated.".to_owned(),
                    details: format!(
                        "{}\n\nWaking will restore the sprite to its previous state.",
                        capabilities.data_preservation_description
                    ),
                    data_safe: capabilities.preserves_data_on_recreate,
                }
            }

            BackendResourceHealth::Pending => SessionHealthReport {
                session_id: session.id,
                session_name: session.name.clone(),
                backend_type: session.backend,
                state: ResourceState::Pending,
                available_actions: vec![],
                recommended_action: None,
                description: "The resource is starting up.".to_owned(),
                details: "Please wait for the resource to become ready.".to_owned(),
                data_safe: true,
            },

            BackendResourceHealth::Error { message } => {
                let mut actions = Vec::new();
                if capabilities.can_recreate {
                    actions.push(AvailableAction::Recreate);
                }
                actions.push(AvailableAction::Cleanup);

                SessionHealthReport {
                    session_id: session.id,
                    session_name: session.name.clone(),
                    backend_type: session.backend,
                    state: ResourceState::Error {
                        message: message.clone(),
                    },
                    available_actions: actions,
                    recommended_action: Some(AvailableAction::Recreate),
                    description: format!("The resource is in an error state: {message}"),
                    details: capabilities.data_preservation_description.to_owned(),
                    data_safe: capabilities.preserves_data_on_recreate,
                }
            }

            BackendResourceHealth::CrashLoop => {
                let mut actions = Vec::new();
                if capabilities.can_recreate {
                    actions.push(AvailableAction::Recreate);
                }
                actions.push(AvailableAction::Cleanup);

                SessionHealthReport {
                    session_id: session.id,
                    session_name: session.name.clone(),
                    backend_type: session.backend,
                    state: ResourceState::CrashLoop,
                    available_actions: actions,
                    recommended_action: Some(AvailableAction::Recreate),
                    description: "The pod is in a crash loop.".to_owned(),
                    details: format!(
                        "{}\n\nThe container keeps crashing and restarting. Recreation may fix the issue.",
                        capabilities.data_preservation_description
                    ),
                    data_safe: capabilities.preserves_data_on_recreate,
                }
            }

            BackendResourceHealth::NotFound => {
                if capabilities.preserves_data_on_recreate {
                    // Data is preserved (bind mount or PVC exists)
                    let mut actions = vec![AvailableAction::Recreate];
                    actions.push(AvailableAction::Cleanup);

                    SessionHealthReport {
                        session_id: session.id,
                        session_name: session.name.clone(),
                        backend_type: session.backend,
                        state: ResourceState::Missing,
                        available_actions: actions,
                        recommended_action: Some(AvailableAction::Recreate),
                        description: "The backend resource is missing.".to_owned(),
                        details: format!(
                            "{}\n\nThe container/pod was deleted but your data is preserved.",
                            capabilities.data_preservation_description
                        ),
                        data_safe: true,
                    }
                } else {
                    // Data is lost (Sprites with auto_destroy, etc.)
                    SessionHealthReport {
                        session_id: session.id,
                        session_name: session.name.clone(),
                        backend_type: session.backend,
                        state: ResourceState::DeletedExternally,
                        available_actions: vec![
                            AvailableAction::Cleanup,
                            AvailableAction::RecreateFresh,
                        ],
                        recommended_action: Some(AvailableAction::Cleanup),
                        description: "The resource was deleted externally.".to_owned(),
                        details: "The backend resource was deleted outside clauderon. \
                            Any uncommitted work and Claude conversation history has been lost.".to_owned(),
                        data_safe: false,
                    }
                }
            }
        }
    }

    /// Build a report for when the worktree is missing
    fn build_worktree_missing_report(&self, session: &Session) -> SessionHealthReport {
        SessionHealthReport {
            session_id: session.id,
            session_name: session.name.clone(),
            backend_type: session.backend,
            state: ResourceState::WorktreeMissing,
            available_actions: vec![AvailableAction::Cleanup],
            recommended_action: Some(AvailableAction::Cleanup),
            description: "The git worktree was deleted.".to_owned(),
            details: format!(
                "The worktree at {} no longer exists. \
                The session should be cleaned up.",
                session.worktree_path.display()
            ),
            data_safe: false,
        }
    }

    /// Build a report for when the backend resource is missing
    fn build_missing_report(&self, session: &Session, reason: &str) -> SessionHealthReport {
        let backend = self.get_backend(session.backend);
        let capabilities = backend.capabilities();

        let mut actions = Vec::new();
        if capabilities.can_recreate && capabilities.preserves_data_on_recreate {
            actions.push(AvailableAction::Recreate);
        }
        actions.push(AvailableAction::Cleanup);

        SessionHealthReport {
            session_id: session.id,
            session_name: session.name.clone(),
            backend_type: session.backend,
            state: ResourceState::Missing,
            available_actions: actions,
            recommended_action: Some(AvailableAction::Recreate),
            description: format!("Backend resource missing: {reason}"),
            details: capabilities.data_preservation_description.to_owned(),
            data_safe: capabilities.preserves_data_on_recreate,
        }
    }

    /// Check if a recreate action is blocked for a session
    ///
    /// Returns `Some(reason)` if blocked, `None` if allowed.
    #[must_use]
    pub fn is_recreate_blocked(&self, session: &Session) -> Option<String> {
        let backend = self.get_backend(session.backend);
        let capabilities = backend.capabilities();

        if !capabilities.can_recreate {
            return Some(format!(
                "Recreation is not supported for this backend. {}",
                capabilities.data_preservation_description
            ));
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backends::mock::{MockExecutionBackend, MockGitBackend};
    use crate::core::session::{
        AccessMode, AgentType, ClaudeWorkingStatus, SessionConfig, SessionRepository, SessionStatus,
    };
    use chrono::Utc;
    use std::path::PathBuf;

    fn create_test_session(name: &str, backend: BackendType, status: SessionStatus) -> Session {
        Session {
            id: Uuid::new_v4(),
            name: name.to_owned(),
            title: None,
            description: None,
            status,
            backend,
            agent: AgentType::ClaudeCode,
            model: None,
            repo_path: PathBuf::from("/test/repo"),
            worktree_path: PathBuf::from("/test/worktree"),
            subdirectory: PathBuf::new(),
            branch_name: "test-branch".to_owned(),
            repositories: None,
            backend_id: Some("test-container".to_owned()),
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
            access_mode: AccessMode::ReadWrite,
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

    #[tokio::test]
    async fn test_healthy_session_returns_ok() {
        let git = Arc::new(MockGitBackend::new());
        let mock_backend: Arc<dyn ExecutionBackend> = Arc::new(MockExecutionBackend::new());

        // Register the worktree so health check doesn't return WorktreeMissing
        git.register_worktree("/test/worktree").await;

        let health_service = HealthService::new(
            git as Arc<dyn GitOperations>,
            Arc::clone(&mock_backend),
            Arc::clone(&mock_backend),
            Arc::clone(&mock_backend),
            #[cfg(target_os = "macos")]
            Arc::clone(&mock_backend),
            mock_backend,
        );

        let session = create_test_session("test", BackendType::Docker, SessionStatus::Running);
        let report = health_service.check_session(&session).await;

        assert!(report.state.is_healthy());
        assert!(report.data_safe);
    }

    #[tokio::test]
    async fn test_archived_session_always_ok() {
        let git: Arc<dyn GitOperations> = Arc::new(MockGitBackend::new());
        let mock_backend: Arc<dyn ExecutionBackend> = Arc::new(MockExecutionBackend::new());

        let health_service = HealthService::new(
            git,
            Arc::clone(&mock_backend),
            Arc::clone(&mock_backend),
            Arc::clone(&mock_backend),
            #[cfg(target_os = "macos")]
            Arc::clone(&mock_backend),
            mock_backend,
        );

        let session = create_test_session("test", BackendType::Docker, SessionStatus::Archived);
        let report = health_service.check_session(&session).await;

        assert!(report.state.is_healthy());
    }

    #[tokio::test]
    async fn test_missing_backend_offers_recreate() {
        let git = Arc::new(MockGitBackend::new());
        let mut mock_backend = MockExecutionBackend::new();
        mock_backend.set_exists(false);
        let mock_backend: Arc<dyn ExecutionBackend> = Arc::new(mock_backend);

        // Register the worktree so health check proceeds to check backend state
        git.register_worktree("/test/worktree").await;

        let health_service = HealthService::new(
            git as Arc<dyn GitOperations>,
            Arc::clone(&mock_backend),
            Arc::clone(&mock_backend),
            Arc::clone(&mock_backend),
            #[cfg(target_os = "macos")]
            Arc::clone(&mock_backend),
            mock_backend,
        );

        let session = create_test_session("test", BackendType::Docker, SessionStatus::Running);
        let report = health_service.check_session(&session).await;

        assert!(matches!(report.state, ResourceState::Missing));
        assert!(
            report
                .available_actions
                .contains(&AvailableAction::Recreate)
        );
    }
}
