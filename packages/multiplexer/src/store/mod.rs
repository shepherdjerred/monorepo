pub mod sqlite;

use async_trait::async_trait;
use uuid::Uuid;

use crate::core::{Event, Session};

pub use sqlite::SqliteStore;

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
}
