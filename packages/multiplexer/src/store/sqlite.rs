use async_trait::async_trait;
use chrono::Utc;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use uuid::Uuid;

use super::{RecentRepo, Store};
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
        // Create schema_version table if it doesn't exist
        sqlx::query(
            r"
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            )
            ",
        )
        .execute(pool)
        .await?;

        // Get current schema version
        let current_version: Option<i64> = sqlx::query_scalar(
            "SELECT MAX(version) FROM schema_version"
        )
        .fetch_optional(pool)
        .await?
        .flatten();

        let current_version = current_version.unwrap_or(0);

        // Apply migrations sequentially
        if current_version < 1 {
            Self::migrate_to_v1(pool).await?;
        }

        if current_version < 2 {
            Self::migrate_to_v2(pool).await?;
        }

        Ok(())
    }

    /// Migration v1: Initial schema (sessions and events tables)
    async fn migrate_to_v1(pool: &SqlitePool) -> anyhow::Result<()> {
        tracing::info!("Applying migration v1: Initial schema");

        // Create sessions table
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
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            ",
        )
        .execute(pool)
        .await?;

        // Create events table
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

        // Create index on events.session_id
        sqlx::query(
            r"
            CREATE INDEX IF NOT EXISTS idx_events_session_id ON events(session_id)
            ",
        )
        .execute(pool)
        .await?;

        // Record migration
        let now = Utc::now();
        sqlx::query(
            "INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)"
        )
        .bind(1)
        .bind(now.to_rfc3339())
        .execute(pool)
        .await?;

        tracing::info!("Migration v1 complete");
        Ok(())
    }

    /// Migration v2: Add recent repositories tracking
    async fn migrate_to_v2(pool: &SqlitePool) -> anyhow::Result<()> {
        tracing::info!("Applying migration v2: Recent repositories");

        // Create recent_repos table
        sqlx::query(
            r"
            CREATE TABLE IF NOT EXISTS recent_repos (
                repo_path TEXT PRIMARY KEY,
                last_used TEXT NOT NULL
            )
            ",
        )
        .execute(pool)
        .await?;

        // Create index on last_used for efficient ordering
        sqlx::query(
            r"
            CREATE INDEX IF NOT EXISTS idx_recent_repos_last_used
            ON recent_repos(last_used DESC)
            ",
        )
        .execute(pool)
        .await?;

        // Record migration
        let now = Utc::now();
        sqlx::query(
            "INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)"
        )
        .bind(2)
        .bind(now.to_rfc3339())
        .execute(pool)
        .await?;

        tracing::info!("Migration v2 complete");
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
                pr_url, pr_check_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    async fn add_recent_repo(&self, repo_path: PathBuf) -> anyhow::Result<()> {
        // Canonicalize the path to prevent duplicates from different representations
        // (e.g., /home/user/repo vs /home/user/./repo vs ~/repo)
        let canonical = repo_path
            .canonicalize()
            .unwrap_or_else(|_| repo_path.clone()); // Fall back to original if canonicalization fails

        let now = Utc::now();
        sqlx::query(
            r"
            INSERT OR REPLACE INTO recent_repos (repo_path, last_used)
            VALUES (?, ?)
            ",
        )
        .bind(canonical.to_string_lossy().to_string())
        .bind(now.to_rfc3339())
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    async fn get_recent_repos(&self) -> anyhow::Result<Vec<RecentRepo>> {
        // Use compile-time constant instead of format!() for cleaner SQL
        const QUERY: &str = "SELECT * FROM recent_repos ORDER BY last_used DESC LIMIT 10";

        let rows = sqlx::query_as::<_, RecentRepoRow>(QUERY)
            .fetch_all(&self.pool)
            .await?;

        let mut repos: Vec<RecentRepo> = rows.into_iter().map(TryInto::try_into).collect::<Result<Vec<_>, _>>()?;

        // Lazy cleanup: Remove entries for repos that no longer exist on disk
        // This keeps the database clean without requiring periodic maintenance
        let mut paths_to_remove = Vec::new();
        repos.retain(|repo| {
            let exists = repo.repo_path.exists();
            if !exists {
                paths_to_remove.push(repo.repo_path.clone());
                tracing::debug!(
                    path = %repo.repo_path.display(),
                    "Removing stale recent repo entry (path no longer exists)"
                );
            }
            exists
        });

        // Delete stale entries from database
        for path in paths_to_remove {
            if let Err(e) = sqlx::query("DELETE FROM recent_repos WHERE repo_path = ?")
                .bind(path.to_string_lossy().to_string())
                .execute(&self.pool)
                .await
            {
                tracing::warn!("Failed to delete stale recent repo entry: {e}");
            }
        }

        Ok(repos)
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

/// Row type for recent_repos table
#[derive(sqlx::FromRow)]
struct RecentRepoRow {
    repo_path: String,
    last_used: String,
}

impl TryFrom<RecentRepoRow> for RecentRepo {
    type Error = anyhow::Error;

    fn try_from(row: RecentRepoRow) -> Result<Self, Self::Error> {
        Ok(Self {
            repo_path: row.repo_path.into(),
            last_used: chrono::DateTime::parse_from_rfc3339(&row.last_used)?.into(),
        })
    }
}
