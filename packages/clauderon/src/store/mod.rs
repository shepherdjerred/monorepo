pub mod sqlite;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use std::path::PathBuf;
use uuid::Uuid;

use crate::core::{Event, Session, SessionRepository};

pub use sqlite::SqliteStore;

/// Recent repository entry
#[derive(Debug, Clone)]
pub struct RecentRepo {
    pub repo_path: PathBuf,
    pub subdirectory: PathBuf,
    pub last_used: DateTime<Utc>,
}

/// Maximum number of recent repositories to track
pub const MAX_RECENT_REPOS: usize = 20;

/// Trait for session storage backends
#[async_trait]
pub trait Store: Send + Sync {
    /// List all sessions
    async fn list_sessions(&self) -> anyhow::Result<Vec<Session>>;

    /// Get a session by ID
    async fn get_session(&self, id: Uuid) -> anyhow::Result<Option<Session>>;

    /// Save or update a session
    async fn save_session(&self, session: &Session) -> anyhow::Result<()>;

    /// Delete a session
    async fn delete_session(&self, id: Uuid) -> anyhow::Result<()>;

    /// Record an event
    async fn record_event(&self, event: &Event) -> anyhow::Result<()>;

    /// Get all events for a session
    async fn get_events(&self, session_id: Uuid) -> anyhow::Result<Vec<Event>>;

    /// Get all events (for replay/recovery)
    async fn get_all_events(&self) -> anyhow::Result<Vec<Event>>;

    /// Add or update a recent repository
    async fn add_recent_repo(
        &self,
        repo_path: PathBuf,
        subdirectory: PathBuf,
    ) -> anyhow::Result<()>;

    /// Get recent repositories, ordered by most recently used
    async fn get_recent_repos(&self) -> anyhow::Result<Vec<RecentRepo>>;

    /// Get repositories for a session (from junction table)
    /// Returns empty vec for legacy single-repo sessions
    async fn get_session_repositories(
        &self,
        session_id: Uuid,
    ) -> anyhow::Result<Vec<SessionRepository>>;

    /// Save repositories for a session (to junction table)
    /// Replaces existing repositories for this session
    async fn save_session_repositories(
        &self,
        session_id: Uuid,
        repositories: &[SessionRepository],
    ) -> anyhow::Result<()>;
}
