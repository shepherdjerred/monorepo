//! Mock API client for testing.
//!
//! This module provides a mock implementation of `ApiClient` that can be used
//! in tests without requiring a running daemon.

use async_trait::async_trait;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::core::session::{HealthCheckResult, ResourceState, SessionHealthReport};
use crate::core::{AgentType, BackendType, Session, SessionConfig, SessionStatus};

use super::protocol::CreateSessionRequest;
use super::traits::ApiClient;
use super::types::ReconcileReportDto;

/// Mock implementation of ApiClient for testing.
///
/// Stores sessions in memory and provides configurable responses and failures.
#[derive(Debug)]
pub struct MockApiClient {
    /// In-memory session storage
    sessions: RwLock<HashMap<Uuid, Session>>,

    /// If true, all operations will fail
    should_fail: AtomicBool,

    /// Error message to return when should_fail is true
    error_message: RwLock<String>,

    /// Counter for generating unique session names
    session_counter: RwLock<u32>,
}

impl MockApiClient {
    /// Create a new mock API client
    #[must_use]
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            should_fail: AtomicBool::new(false),
            error_message: RwLock::new("Mock API failure".to_owned()),
            session_counter: RwLock::new(0),
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

    /// Add a session to the mock storage
    pub async fn add_session(&self, session: Session) {
        self.sessions.write().await.insert(session.id, session);
    }

    /// Get all sessions from the mock storage
    pub async fn get_all_sessions(&self) -> Vec<Session> {
        self.sessions.read().await.values().cloned().collect()
    }

    /// Clear all sessions from the mock storage
    pub async fn clear_sessions(&self) {
        self.sessions.write().await.clear();
    }

    /// Check if operations are configured to fail
    fn should_fail(&self) -> bool {
        self.should_fail.load(Ordering::SeqCst)
    }

    /// Create a mock session with the given name
    #[must_use]
    pub fn create_mock_session(name: &str, status: SessionStatus) -> Session {
        let config = SessionConfig {
            name: name.to_owned(),
            title: None,
            description: None,
            repo_path: PathBuf::from("/mock/repo"),
            worktree_path: PathBuf::from(format!("/mock/worktrees/{name}")),
            subdirectory: PathBuf::new(),
            branch_name: format!("feature/{name}"),
            repositories: None, // Mock session uses legacy single-repo mode
            initial_prompt: "Mock prompt".to_owned(),
            backend: BackendType::Zellij,
            agent: AgentType::ClaudeCode,
            model: None, // Mock uses default model
            dangerous_skip_checks: false,
            dangerous_copy_creds: false,
            access_mode: crate::core::AccessMode::default(),
        };

        let mut session = Session::new(config);
        session.set_status(status);
        session.set_backend_id(format!("mock-backend-{name}"));
        session
    }
}

impl Default for MockApiClient {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl ApiClient for MockApiClient {
    async fn list_sessions(&mut self) -> anyhow::Result<Vec<Session>> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        Ok(self.sessions.read().await.values().cloned().collect())
    }

    async fn get_session(&mut self, id: &str) -> anyhow::Result<Session> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        let sessions = self.sessions.read().await;

        // Try to find by UUID first
        if let Ok(uuid) = Uuid::parse_str(id)
            && let Some(session) = sessions.get(&uuid)
        {
            let session = session.clone();
            drop(sessions);
            return Ok(session);
        }

        // Try to find by name
        for session in sessions.values() {
            if session.name == id {
                return Ok(session.clone());
            }
        }

        anyhow::bail!("Session not found: {id}")
    }

    async fn create_session(
        &mut self,
        request: CreateSessionRequest,
    ) -> anyhow::Result<(Session, Option<Vec<String>>)> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        // Generate a unique session name with counter
        let mut counter = self.session_counter.write().await;
        *counter += 1;
        let counter_val = *counter;
        drop(counter);
        let session_name = format!("mock-session-{counter_val:04}");

        let config = SessionConfig {
            name: session_name.clone(),
            title: None,
            description: None,
            repo_path: PathBuf::from(&request.repo_path),
            worktree_path: PathBuf::from(format!("/mock/worktrees/{session_name}")),
            subdirectory: PathBuf::new(),
            branch_name: format!("feature/{session_name}"),
            repositories: None, // Mock session uses legacy single-repo mode
            initial_prompt: request.initial_prompt,
            backend: request.backend,
            agent: request.agent,
            model: request.model,
            dangerous_skip_checks: request.dangerous_skip_checks,
            dangerous_copy_creds: request.dangerous_copy_creds,
            access_mode: request.access_mode,
        };

        let mut session = Session::new(config);
        session.set_status(SessionStatus::Running);
        session.set_backend_id(format!("mock-backend-{session_name}"));

        self.sessions
            .write()
            .await
            .insert(session.id, session.clone());

        Ok((session, None))
    }

    async fn delete_session(&mut self, id: &str) -> anyhow::Result<()> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        let mut sessions = self.sessions.write().await;

        // Try to find by UUID first
        if let Ok(uuid) = Uuid::parse_str(id)
            && sessions.remove(&uuid).is_some()
        {
            drop(sessions);
            return Ok(());
        }

        // Try to find by name
        let uuid_to_remove = sessions
            .iter()
            .find(|(_, s)| s.name == id)
            .map(|(uuid, _)| *uuid);

        if let Some(uuid) = uuid_to_remove {
            sessions.remove(&uuid);
            return Ok(());
        }

        anyhow::bail!("Session not found: {id}")
    }

    async fn archive_session(&mut self, id: &str) -> anyhow::Result<()> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        let mut sessions = self.sessions.write().await;

        // Try to find by UUID first
        if let Ok(uuid) = Uuid::parse_str(id)
            && let Some(session) = sessions.get_mut(&uuid)
        {
            session.set_status(SessionStatus::Archived);
            drop(sessions);
            return Ok(());
        }

        // Try to find by name
        for session in sessions.values_mut() {
            if session.name == id {
                session.set_status(SessionStatus::Archived);
                return Ok(());
            }
        }

        anyhow::bail!("Session not found: {id}")
    }

    async fn unarchive_session(&mut self, id: &str) -> anyhow::Result<()> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        let mut sessions = self.sessions.write().await;

        // Try to find by UUID first
        if let Ok(uuid) = Uuid::parse_str(id)
            && let Some(session) = sessions.get_mut(&uuid)
        {
            if session.status != SessionStatus::Archived {
                anyhow::bail!("Session {id} is not archived");
            }
            session.set_status(SessionStatus::Idle);
            return Ok(());
        }

        // Try to find by name
        for session in sessions.values_mut() {
            if session.name == id {
                if session.status != SessionStatus::Archived {
                    anyhow::bail!("Session {id} is not archived");
                }
                session.set_status(SessionStatus::Idle);
                return Ok(());
            }
        }

        anyhow::bail!("Session not found: {id}")
    }

    async fn refresh_session(&mut self, id: &str) -> anyhow::Result<()> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        // For mock, just verify the session exists (refresh is a no-op for mock sessions)
        let sessions = self.sessions.read().await;

        // Try to find by UUID first
        if let Ok(uuid) = Uuid::parse_str(id)
            && sessions.contains_key(&uuid)
        {
            drop(sessions);
            return Ok(());
        }

        // Try to find by name
        for session in sessions.values() {
            if session.name == id {
                return Ok(());
            }
        }

        anyhow::bail!("Session not found: {id}")
    }

    async fn attach_session(&mut self, id: &str) -> anyhow::Result<Vec<String>> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        let sessions = self.sessions.read().await;

        // Find the session
        let session = if let Ok(uuid) = Uuid::parse_str(id) {
            sessions.get(&uuid)
        } else {
            sessions.values().find(|s| s.name == id)
        };

        match session {
            Some(s) => {
                let backend_id = s
                    .backend_id
                    .clone()
                    .unwrap_or_else(|| "mock-session".to_owned());
                Ok(vec!["zellij".to_owned(), "attach".to_owned(), backend_id])
            }
            None => anyhow::bail!("Session not found: {id}"),
        }
    }

    async fn reconcile(&mut self) -> anyhow::Result<ReconcileReportDto> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        // Return an empty report (everything is healthy)
        Ok(ReconcileReportDto {
            missing_worktrees: vec![],
            missing_backends: vec![],
            orphaned_backends: vec![],
            recreated: vec![],
            recreation_failed: vec![],
            gave_up: vec![],
        })
    }

    async fn get_recent_repos(&mut self) -> anyhow::Result<Vec<super::protocol::RecentRepoDto>> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        // Return mock recent repos with timestamps
        use chrono::Utc;
        Ok(vec![
            super::protocol::RecentRepoDto {
                repo_path: "/home/user/projects/repo1".to_owned(),
                subdirectory: String::new(),
                last_used: Utc::now().to_rfc3339(),
            },
            super::protocol::RecentRepoDto {
                repo_path: "/home/user/projects/repo2".to_owned(),
                subdirectory: "packages/foo".to_owned(),
                last_used: (Utc::now() - chrono::Duration::hours(1)).to_rfc3339(),
            },
        ])
    }

    async fn get_feature_flags(&mut self) -> anyhow::Result<crate::feature_flags::FeatureFlags> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        Ok(crate::feature_flags::FeatureFlags::default())
    }

    async fn get_health(&mut self) -> anyhow::Result<HealthCheckResult> {
        if self.should_fail() {
            let msg = self.error_message.read().await.clone();
            anyhow::bail!("{msg}");
        }

        // Return mock health status - all sessions healthy
        let sessions = self.sessions.read().await;
        #[expect(clippy::cast_possible_truncation, reason = "session count is bounded by application logic")]
        let healthy_count = sessions.len() as u32;
        let reports: Vec<SessionHealthReport> = sessions
            .values()
            .map(|session| SessionHealthReport {
                session_id: session.id,
                session_name: session.name.clone(),
                backend_type: session.backend,
                state: ResourceState::Healthy,
                available_actions: vec![],
                recommended_action: None,
                description: "Session is healthy".to_owned(),
                details: String::new(),
                data_safe: true,
            })
            .collect();

        Ok(HealthCheckResult {
            sessions: reports,
            healthy_count,
            needs_attention_count: 0,
            blocked_count: 0,
        })
    }

    async fn start_session(&mut self, _id: uuid::Uuid) -> anyhow::Result<()> {
        // Mock implementation - no-op
        Ok(())
    }

    async fn wake_session(&mut self, _id: uuid::Uuid) -> anyhow::Result<()> {
        // Mock implementation - no-op
        Ok(())
    }

    async fn recreate_session(&mut self, _id: uuid::Uuid) -> anyhow::Result<()> {
        // Mock implementation - no-op
        Ok(())
    }

    async fn recreate_session_fresh(&mut self, _id: uuid::Uuid) -> anyhow::Result<()> {
        // Mock implementation - no-op
        Ok(())
    }

    async fn update_session_image(&mut self, _id: uuid::Uuid) -> anyhow::Result<()> {
        // Mock implementation - no-op
        Ok(())
    }

    async fn cleanup_session(&mut self, _id: uuid::Uuid) -> anyhow::Result<()> {
        // Mock implementation - no-op
        Ok(())
    }

    async fn merge_pr(
        &mut self,
        _id: &str,
        _method: crate::core::MergeMethod,
        _delete_branch: bool,
    ) -> anyhow::Result<()> {
        // Mock implementation - no-op
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_mock_api_list_empty() {
        let mut client = MockApiClient::new();
        let sessions = client.list_sessions().await.unwrap();
        assert!(sessions.is_empty());
    }

    #[tokio::test]
    async fn test_mock_api_create_session() {
        let mut client = MockApiClient::new();

        let request = CreateSessionRequest {
            repo_path: "/tmp/repo".to_owned(),
            repositories: None, // Test uses legacy single-repo mode
            initial_prompt: "Test prompt".to_owned(),
            backend: BackendType::Zellij,
            agent: AgentType::ClaudeCode,
            model: None, // Test uses default model
            dangerous_skip_checks: false,
            dangerous_copy_creds: false,
            print_mode: false,
            plan_mode: true,
            access_mode: crate::core::AccessMode::default(),
            images: vec![],
            container_image: None,
            pull_policy: None,
            cpu_limit: None,
            memory_limit: None,
            storage_class: None,
        };

        let (session, warnings) = client.create_session(request).await.unwrap();
        assert!(session.name.starts_with("mock-session-"));
        assert_eq!(session.status, SessionStatus::Running);
        assert!(warnings.is_none());

        let sessions = client.list_sessions().await.unwrap();
        assert_eq!(sessions.len(), 1);
    }

    #[tokio::test]
    async fn test_mock_api_get_session_by_name() {
        let mut client = MockApiClient::new();

        let session = MockApiClient::create_mock_session("my-session", SessionStatus::Running);
        let name = session.name.clone();
        client.add_session(session).await;

        let found = client.get_session(&name).await.unwrap();
        assert_eq!(found.name, name);
    }

    #[tokio::test]
    async fn test_mock_api_get_session_by_uuid() {
        let mut client = MockApiClient::new();

        let session = MockApiClient::create_mock_session("uuid-test", SessionStatus::Running);
        let id = session.id.to_string();
        client.add_session(session).await;

        let found = client.get_session(&id).await.unwrap();
        assert_eq!(found.id.to_string(), id);
    }

    #[tokio::test]
    async fn test_mock_api_get_session_not_found() {
        let mut client = MockApiClient::new();
        let result = client.get_session("nonexistent").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not found"));
    }

    #[tokio::test]
    async fn test_mock_api_delete_session() {
        let mut client = MockApiClient::new();

        let session = MockApiClient::create_mock_session("to-delete", SessionStatus::Running);
        let name = session.name.clone();
        client.add_session(session).await;

        client.delete_session(&name).await.unwrap();

        let sessions = client.list_sessions().await.unwrap();
        assert!(sessions.is_empty());
    }

    #[tokio::test]
    async fn test_mock_api_archive_session() {
        let mut client = MockApiClient::new();

        let session = MockApiClient::create_mock_session("to-archive", SessionStatus::Running);
        let name = session.name.clone();
        client.add_session(session).await;

        client.archive_session(&name).await.unwrap();

        let found = client.get_session(&name).await.unwrap();
        assert_eq!(found.status, SessionStatus::Archived);
    }

    #[tokio::test]
    async fn test_mock_api_unarchive_session() {
        let mut client = MockApiClient::new();

        let session = MockApiClient::create_mock_session("to-unarchive", SessionStatus::Archived);
        let name = session.name.clone();
        client.add_session(session).await;

        client.unarchive_session(&name).await.unwrap();

        let found = client.get_session(&name).await.unwrap();
        assert_eq!(found.status, SessionStatus::Idle);
    }

    #[tokio::test]
    async fn test_mock_api_unarchive_not_archived() {
        let mut client = MockApiClient::new();

        let session = MockApiClient::create_mock_session("running-session", SessionStatus::Running);
        let name = session.name.clone();
        client.add_session(session).await;

        let result = client.unarchive_session(&name).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("not archived"));
    }

    #[tokio::test]
    async fn test_mock_api_attach_session() {
        let mut client = MockApiClient::new();

        let session = MockApiClient::create_mock_session("attach-test", SessionStatus::Running);
        let name = session.name.clone();
        client.add_session(session).await;

        let command = client.attach_session(&name).await.unwrap();
        assert_eq!(command[0], "zellij");
        assert_eq!(command[1], "attach");
    }

    #[tokio::test]
    async fn test_mock_api_reconcile() {
        let mut client = MockApiClient::new();
        let report = client.reconcile().await.unwrap();

        assert!(report.missing_worktrees.is_empty());
        assert!(report.missing_backends.is_empty());
        assert!(report.orphaned_backends.is_empty());
    }

    #[tokio::test]
    async fn test_mock_api_should_fail() {
        let mut client = MockApiClient::new();
        client.set_should_fail(true);
        client.set_error_message("Connection refused").await;

        let result = client.list_sessions().await;
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Connection refused")
        );
    }

    #[tokio::test]
    async fn test_mock_api_multiple_sessions() {
        let mut client = MockApiClient::new();

        let s1 = MockApiClient::create_mock_session("session-1", SessionStatus::Running);
        let s2 = MockApiClient::create_mock_session("session-2", SessionStatus::Idle);
        let s3 = MockApiClient::create_mock_session("session-3", SessionStatus::Archived);

        client.add_session(s1).await;
        client.add_session(s2).await;
        client.add_session(s3).await;

        let sessions = client.list_sessions().await.unwrap();
        assert_eq!(sessions.len(), 3);
    }
}
