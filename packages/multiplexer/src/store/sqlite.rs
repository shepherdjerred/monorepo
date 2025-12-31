use async_trait::async_trait;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::Path;
use std::str::FromStr;
use uuid::Uuid;

use super::Store;
use crate::core::{Event, Session};

/// SQLite-based session store
pub struct SqliteStore {
    pool: SqlitePool,
}

impl SqliteStore {
    /// Create a new `SQLite` store at the given path
    ///
    /// # Errors
    ///
    /// Returns an error if the database cannot be created or migrations fail.
    pub async fn new(db_path: &Path) -> anyhow::Result<Self> {
        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", db_path.display()))?
            .create_if_missing(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        // Run migrations
        Self::run_migrations(&pool).await?;

        Ok(Self { pool })
    }

    /// Run database migrations
    async fn run_migrations(pool: &SqlitePool) -> anyhow::Result<()> {
        sqlx::query(
            r"
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                status TEXT NOT NULL,
                backend TEXT NOT NULL,
                agent TEXT NOT NULL,
                repo_path TEXT NOT NULL,
                worktree_path TEXT NOT NULL,
                branch_name TEXT NOT NULL,
                backend_id TEXT,
                initial_prompt TEXT NOT NULL,
                dangerous_skip_checks INTEGER NOT NULL,
                pr_url TEXT,
                pr_check_status TEXT,
                access_mode TEXT NOT NULL DEFAULT 'ReadWrite',
                proxy_port INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            ",
        )
        .execute(pool)
        .await?;

        sqlx::query(
            r"
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                timestamp TEXT NOT NULL
            )
            ",
        )
        .execute(pool)
        .await?;

        sqlx::query(
            r"
            CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id)
            ",
        )
        .execute(pool)
        .await?;

        // Migration: Add access_mode column if it doesn't exist (for existing databases)
        let access_mode_exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'access_mode'"
        )
        .fetch_one(pool)
        .await
        .map(|count: i64| count > 0)
        .unwrap_or(false);

        if !access_mode_exists {
            tracing::info!("Running migration: Adding access_mode column to sessions table");
            sqlx::query(
                "ALTER TABLE sessions ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'ReadWrite'"
            )
            .execute(pool)
            .await?;
        }

        // Migration: Add proxy_port column if it doesn't exist
        let proxy_port_exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'proxy_port'"
        )
        .fetch_one(pool)
        .await
        .map(|count: i64| count > 0)
        .unwrap_or(false);

        if !proxy_port_exists {
            tracing::info!("Running migration: Adding proxy_port column to sessions table");
            sqlx::query(
                "ALTER TABLE sessions ADD COLUMN proxy_port INTEGER"
            )
            .execute(pool)
            .await?;
        }

        Ok(())
    }
}

#[async_trait]
impl Store for SqliteStore {
    async fn list_sessions(&self) -> anyhow::Result<Vec<Session>> {
        let rows = sqlx::query_as::<_, SessionRow>("SELECT * FROM sessions")
            .fetch_all(&self.pool)
            .await?;

        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn get_session(&self, id: Uuid) -> anyhow::Result<Option<Session>> {
        let row = sqlx::query_as::<_, SessionRow>("SELECT * FROM sessions WHERE id = ?")
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(r) => Ok(Some(r.try_into()?)),
            None => Ok(None),
        }
    }

    async fn save_session(&self, session: &Session) -> anyhow::Result<()> {
        sqlx::query(
            r"
            INSERT OR REPLACE INTO sessions (
                id, name, status, backend, agent, repo_path, worktree_path,
                branch_name, backend_id, initial_prompt, dangerous_skip_checks,
                pr_url, pr_check_status, access_mode, proxy_port, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ",
        )
        .bind(session.id.to_string())
        .bind(&session.name)
        .bind(serde_json::to_string(&session.status)?)
        .bind(serde_json::to_string(&session.backend)?)
        .bind(serde_json::to_string(&session.agent)?)
        .bind(session.repo_path.to_string_lossy().to_string())
        .bind(session.worktree_path.to_string_lossy().to_string())
        .bind(&session.branch_name)
        .bind(&session.backend_id)
        .bind(&session.initial_prompt)
        .bind(session.dangerous_skip_checks)
        .bind(&session.pr_url)
        .bind(
            session
                .pr_check_status
                .and_then(|s| serde_json::to_string(&s).ok()),
        )
        .bind(session.access_mode.to_string())
        .bind(session.proxy_port.map(|p| p as i64))
        .bind(session.created_at.to_rfc3339())
        .bind(session.updated_at.to_rfc3339())
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn delete_session(&self, id: Uuid) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM sessions WHERE id = ?")
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    async fn record_event(&self, event: &Event) -> anyhow::Result<()> {
        let payload = serde_json::to_string(&event.event_type)?;

        sqlx::query(
            r"
            INSERT INTO events (session_id, event_type, payload, timestamp)
            VALUES (?, ?, ?, ?)
            ",
        )
        .bind(event.session_id.to_string())
        .bind(event_type_name(&event.event_type))
        .bind(payload)
        .bind(event.timestamp.to_rfc3339())
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn get_events(&self, session_id: Uuid) -> anyhow::Result<Vec<Event>> {
        let rows = sqlx::query_as::<_, EventRow>(
            "SELECT * FROM events WHERE session_id = ? ORDER BY id ASC",
        )
        .bind(session_id.to_string())
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn get_all_events(&self) -> anyhow::Result<Vec<Event>> {
        let rows = sqlx::query_as::<_, EventRow>("SELECT * FROM events ORDER BY id ASC")
            .fetch_all(&self.pool)
            .await?;

        rows.into_iter().map(TryInto::try_into).collect()
    }
}

/// Helper to get event type name for storage
const fn event_type_name(event_type: &crate::core::events::EventType) -> &'static str {
    use crate::core::events::EventType;
    match event_type {
        EventType::SessionCreated { .. } => "SessionCreated",
        EventType::StatusChanged { .. } => "StatusChanged",
        EventType::BackendIdSet { .. } => "BackendIdSet",
        EventType::PrLinked { .. } => "PrLinked",
        EventType::CheckStatusChanged { .. } => "CheckStatusChanged",
        EventType::SessionArchived => "SessionArchived",
        EventType::SessionDeleted { .. } => "SessionDeleted",
        EventType::SessionRestored => "SessionRestored",
    }
}

/// Row type for sessions table
#[derive(sqlx::FromRow)]
struct SessionRow {
    id: String,
    name: String,
    status: String,
    backend: String,
    agent: String,
    repo_path: String,
    worktree_path: String,
    branch_name: String,
    backend_id: Option<String>,
    initial_prompt: String,
    dangerous_skip_checks: bool,
    pr_url: Option<String>,
    pr_check_status: Option<String>,
    access_mode: String,
    proxy_port: Option<i64>,
    created_at: String,
    updated_at: String,
}

impl TryFrom<SessionRow> for Session {
    type Error = anyhow::Error;

    fn try_from(row: SessionRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: Uuid::parse_str(&row.id)?,
            name: row.name,
            status: serde_json::from_str(&row.status)?,
            backend: serde_json::from_str(&row.backend)?,
            agent: serde_json::from_str(&row.agent)?,
            repo_path: row.repo_path.into(),
            worktree_path: row.worktree_path.into(),
            branch_name: row.branch_name,
            backend_id: row.backend_id,
            initial_prompt: row.initial_prompt,
            dangerous_skip_checks: row.dangerous_skip_checks,
            pr_url: row.pr_url,
            pr_check_status: row
                .pr_check_status
                .map(|s| serde_json::from_str(&s))
                .transpose()?,
            access_mode: row.access_mode.parse().unwrap_or_default(),
            proxy_port: row.proxy_port.map(|p| p as u16),
            created_at: chrono::DateTime::parse_from_rfc3339(&row.created_at)?.into(),
            updated_at: chrono::DateTime::parse_from_rfc3339(&row.updated_at)?.into(),
        })
    }
}

/// Row type for events table
#[derive(sqlx::FromRow)]
struct EventRow {
    id: i64,
    session_id: String,
    #[allow(dead_code)]
    event_type: String,
    payload: String,
    timestamp: String,
}

impl TryFrom<EventRow> for Event {
    type Error = anyhow::Error;

    fn try_from(row: EventRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: row.id,
            session_id: Uuid::parse_str(&row.session_id)?,
            event_type: serde_json::from_str(&row.payload)?,
            timestamp: chrono::DateTime::parse_from_rfc3339(&row.timestamp)?.into(),
        })
    }
}
