//! API client trait for dependency injection and testing.

use async_trait::async_trait;

use crate::core::Session;

use super::protocol::CreateSessionRequest;
use super::types::ReconcileReportDto;

/// Trait for API client operations.
///
/// This trait allows for dependency injection of the API client,
/// enabling testing with mock implementations.
#[async_trait]
pub trait ApiClient: Send + Sync {
    /// List all sessions.
    async fn list_sessions(&mut self) -> anyhow::Result<Vec<Session>>;

    /// Get a session by ID or name.
    async fn get_session(&mut self, id: &str) -> anyhow::Result<Session>;

    /// Create a new session.
    ///
    /// Returns the created session and optionally a list of warnings.
    async fn create_session(
        &mut self,
        request: CreateSessionRequest,
    ) -> anyhow::Result<(Session, Option<Vec<String>>)>;

    /// Delete a session.
    async fn delete_session(&mut self, id: &str) -> anyhow::Result<()>;

    /// Archive a session.
    async fn archive_session(&mut self, id: &str) -> anyhow::Result<()>;

    /// Unarchive a session.
    async fn unarchive_session(&mut self, id: &str) -> anyhow::Result<()>;

    /// Refresh a session (pull latest image and recreate container).
    async fn refresh_session(&mut self, id: &str) -> anyhow::Result<()>;

    /// Get the attach command for a session.
    async fn attach_session(&mut self, id: &str) -> anyhow::Result<Vec<String>>;

    /// Reconcile state with reality.
    async fn reconcile(&mut self) -> anyhow::Result<ReconcileReportDto>;

    /// Get recent repositories with timestamps.
    async fn get_recent_repos(&mut self) -> anyhow::Result<Vec<super::protocol::RecentRepoDto>>;
}
