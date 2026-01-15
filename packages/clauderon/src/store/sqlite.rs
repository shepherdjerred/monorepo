use async_trait::async_trait;
use chrono::Utc;
use sqlx::Row;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use tracing::instrument;
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

        let options = SqliteConnectOptions::from_str(&format!(
            "sqlite:{display}",
            display = db_path.display()
        ))?
        .create_if_missing(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await?;

        // Run migrations
        Self::run_migrations(&pool).await?;

        Ok(Self { pool })
    }

    /// Get a clone of the underlying connection pool
    ///
    /// This is useful when other components need direct database access
    /// (e.g., auth handlers) while ensuring they use the same pool
    /// that has already had migrations applied.
    #[must_use]
    pub fn pool(&self) -> SqlitePool {
        self.pool.clone()
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
        let current_version: Option<i64> =
            sqlx::query_scalar("SELECT MAX(version) FROM schema_version")
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

        if current_version < 3 {
            Self::migrate_to_v3(pool).await?;
        }

        if current_version < 4 {
            Self::migrate_to_v4(pool).await?;
        }

        if current_version < 5 {
            Self::migrate_to_v5(pool).await?;
        }

        if current_version < 6 {
            Self::migrate_to_v6(pool).await?;
        }

        if current_version < 7 {
            Self::migrate_to_v7(pool).await?;
        }

        if current_version < 8 {
            Self::migrate_to_v8(pool).await?;
        }

        if current_version < 9 {
            Self::migrate_to_v9(pool).await?;
        }

        if current_version < 10 {
            Self::migrate_to_v10(pool).await?;
        }

        if current_version < 11 {
            Self::migrate_to_v11(pool).await?;
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
                access_mode TEXT NOT NULL DEFAULT 'ReadWrite',
                proxy_port INTEGER,
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
        sqlx::query("INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)")
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
        sqlx::query("INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)")
            .bind(2)
            .bind(now.to_rfc3339())
            .execute(pool)
            .await?;

        tracing::info!("Migration v2 complete");

        // Migration: Add access_mode column if it doesn't exist (for existing databases)
        let access_mode_exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'access_mode'",
        )
        .fetch_one(pool)
        .await
        .map(|count: i64| count > 0)
        .unwrap_or(false);

        if !access_mode_exists {
            tracing::info!("Running migration: Adding access_mode column to sessions table");
            sqlx::query(
                "ALTER TABLE sessions ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'ReadWrite'",
            )
            .execute(pool)
            .await?;
        }

        // Migration: Add proxy_port column if it doesn't exist
        let proxy_port_exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'proxy_port'",
        )
        .fetch_one(pool)
        .await
        .map(|count: i64| count > 0)
        .unwrap_or(false);

        if !proxy_port_exists {
            tracing::info!("Running migration: Adding proxy_port column to sessions table");
            sqlx::query("ALTER TABLE sessions ADD COLUMN proxy_port INTEGER")
                .execute(pool)
                .await?;
        }

        Ok(())
    }

    /// Migration v3: Add Claude working status tracking
    async fn migrate_to_v3(pool: &SqlitePool) -> anyhow::Result<()> {
        tracing::info!("Applying migration v3: Claude working status");

        // Add claude_status column
        let claude_status_exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'claude_status'",
        )
        .fetch_one(pool)
        .await
        .map(|count: i64| count > 0)
        .unwrap_or(false);

        if !claude_status_exists {
            sqlx::query(
                "ALTER TABLE sessions ADD COLUMN claude_status TEXT NOT NULL DEFAULT 'Unknown'",
            )
            .execute(pool)
            .await?;
        }

        // Add claude_status_updated_at column
        let status_time_exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'claude_status_updated_at'"
        )
        .fetch_one(pool)
        .await
        .map(|count: i64| count > 0)
        .unwrap_or(false);

        if !status_time_exists {
            sqlx::query("ALTER TABLE sessions ADD COLUMN claude_status_updated_at TEXT")
                .execute(pool)
                .await?;
        }

        // Record migration
        let now = Utc::now();
        sqlx::query("INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)")
            .bind(3)
            .bind(now.to_rfc3339())
            .execute(pool)
            .await?;

        tracing::info!("Migration v3 complete");
        Ok(())
    }

    /// Migration v4: Add merge conflict tracking
    async fn migrate_to_v4(pool: &SqlitePool) -> anyhow::Result<()> {
        tracing::info!("Applying migration v4: Merge conflict tracking");

        // Add merge_conflict column
        let merge_conflict_exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'merge_conflict'",
        )
        .fetch_one(pool)
        .await
        .map(|count: i64| count > 0)
        .unwrap_or(false);

        if !merge_conflict_exists {
            sqlx::query(
                "ALTER TABLE sessions ADD COLUMN merge_conflict INTEGER NOT NULL DEFAULT 0",
            )
            .execute(pool)
            .await?;
        }

        // Record migration
        let now = Utc::now();
        sqlx::query("INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)")
            .bind(4)
            .bind(now.to_rfc3339())
            .execute(pool)
            .await?;

        tracing::info!("Migration v4 complete");
        Ok(())
    }

    /// Migration v5: Add title and description to sessions table
    async fn migrate_to_v5(pool: &SqlitePool) -> anyhow::Result<()> {
        tracing::info!("Applying migration v5: Add session title and description");

        // Check if title column exists
        let title_exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('sessions') WHERE name = 'title'",
        )
        .fetch_one(pool)
        .await?;

        if !title_exists {
            sqlx::query("ALTER TABLE sessions ADD COLUMN title TEXT")
                .execute(pool)
                .await?;
            tracing::debug!("Added title column to sessions table");
        }

        // Check if description column exists
        let description_exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('sessions') WHERE name = 'description'",
        )
        .fetch_one(pool)
        .await?;

        if !description_exists {
            sqlx::query("ALTER TABLE sessions ADD COLUMN description TEXT")
                .execute(pool)
                .await?;
            tracing::debug!("Added description column to sessions table");
        }

        // Record migration
        let now = Utc::now();
        sqlx::query("INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)")
            .bind(5)
            .bind(now.to_rfc3339())
            .execute(pool)
            .await?;

        tracing::info!("Migration v5 complete");
        Ok(())
    }

    /// Migration v6: Add history_file_path column
    async fn migrate_to_v6(pool: &SqlitePool) -> anyhow::Result<()> {
        tracing::info!("Applying migration v6: Add history_file_path column");

        // Check if history_file_path column exists
        let history_path_exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('sessions') WHERE name = 'history_file_path'",
        )
        .fetch_one(pool)
        .await?;

        if !history_path_exists {
            sqlx::query("ALTER TABLE sessions ADD COLUMN history_file_path TEXT")
                .execute(pool)
                .await?;
            tracing::debug!("Added history_file_path column to sessions table");
        }

        // Record migration
        let now = Utc::now();
        sqlx::query("INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)")
            .bind(6)
            .bind(now.to_rfc3339())
            .execute(pool)
            .await?;

        tracing::info!("Migration v6 complete");
        Ok(())
    }

    /// Migration v7: Add reconcile tracking and async operation error tracking columns
    async fn migrate_to_v7(pool: &SqlitePool) -> anyhow::Result<()> {
        tracing::info!("Applying migration v7: Add reconcile tracking and error_message columns");

        // Add reconcile_attempts column
        let reconcile_attempts_exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('sessions') WHERE name = 'reconcile_attempts'",
        )
        .fetch_one(pool)
        .await?;

        if !reconcile_attempts_exists {
            sqlx::query(
                "ALTER TABLE sessions ADD COLUMN reconcile_attempts INTEGER NOT NULL DEFAULT 0",
            )
            .execute(pool)
            .await?;
            tracing::debug!("Added reconcile_attempts column to sessions table");
        }

        // Add last_reconcile_error column
        let last_reconcile_error_exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('sessions') WHERE name = 'last_reconcile_error'",
        )
        .fetch_one(pool)
        .await?;

        if !last_reconcile_error_exists {
            sqlx::query("ALTER TABLE sessions ADD COLUMN last_reconcile_error TEXT")
                .execute(pool)
                .await?;
            tracing::debug!("Added last_reconcile_error column to sessions table");
        }

        // Add last_reconcile_at column
        let last_reconcile_at_exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('sessions') WHERE name = 'last_reconcile_at'",
        )
        .fetch_one(pool)
        .await?;

        if !last_reconcile_at_exists {
            sqlx::query("ALTER TABLE sessions ADD COLUMN last_reconcile_at TEXT")
                .execute(pool)
                .await?;
            tracing::debug!("Added last_reconcile_at column to sessions table");
        }

        // Add error_message column
        let error_message_exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('sessions') WHERE name = 'error_message'",
        )
        .fetch_one(pool)
        .await?;

        if !error_message_exists {
            sqlx::query("ALTER TABLE sessions ADD COLUMN error_message TEXT")
                .execute(pool)
                .await?;
            tracing::debug!("Added error_message column to sessions table");
        }

        // Record migration
        let now = Utc::now();
        sqlx::query("INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)")
            .bind(7)
            .bind(now.to_rfc3339())
            .execute(pool)
            .await?;

        tracing::info!("Migration v7 complete");
        Ok(())
    }

    /// Migration v8: Add passkey authentication tables
    async fn migrate_to_v8(pool: &SqlitePool) -> anyhow::Result<()> {
        tracing::info!("Applying migration v8: Passkey authentication");

        // Create users table
        sqlx::query(
            r"
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                display_name TEXT,
                created_at TEXT NOT NULL
            )
            ",
        )
        .execute(pool)
        .await?;

        // Create passkeys table
        sqlx::query(
            r"
            CREATE TABLE IF NOT EXISTS passkeys (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                credential_id BLOB NOT NULL UNIQUE,
                public_key BLOB NOT NULL,
                counter INTEGER NOT NULL,
                transports TEXT NOT NULL,
                device_name TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            ",
        )
        .execute(pool)
        .await?;

        // Create index on passkeys.user_id
        sqlx::query(
            r"
            CREATE INDEX IF NOT EXISTS idx_passkeys_user_id ON passkeys(user_id)
            ",
        )
        .execute(pool)
        .await?;

        // Create index on passkeys.credential_id for authentication lookups
        sqlx::query(
            r"
            CREATE INDEX IF NOT EXISTS idx_passkeys_credential_id ON passkeys(credential_id)
            ",
        )
        .execute(pool)
        .await?;

        // Create auth_sessions table
        sqlx::query(
            r"
            CREATE TABLE IF NOT EXISTS auth_sessions (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            ",
        )
        .execute(pool)
        .await?;

        // Create index on auth_sessions.user_id
        sqlx::query(
            r"
            CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id)
            ",
        )
        .execute(pool)
        .await?;

        // Create index on auth_sessions.expires_at for cleanup
        sqlx::query(
            r"
            CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at ON auth_sessions(expires_at)
            ",
        )
        .execute(pool)
        .await?;

        // Create webauthn_challenges table
        sqlx::query(
            r"
            CREATE TABLE IF NOT EXISTS webauthn_challenges (
                id TEXT PRIMARY KEY,
                username TEXT NOT NULL,
                challenge_json TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
            ",
        )
        .execute(pool)
        .await?;

        // Create index on webauthn_challenges.username
        sqlx::query(
            r"
            CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_username ON webauthn_challenges(username)
            ",
        )
        .execute(pool)
        .await?;

        // Create index on webauthn_challenges.expires_at for cleanup
        sqlx::query(
            r"
            CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_expires_at ON webauthn_challenges(expires_at)
            ",
        )
        .execute(pool)
        .await?;

        // Record migration
        let now = Utc::now();
        sqlx::query("INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)")
            .bind(8)
            .bind(now.to_rfc3339())
            .execute(pool)
            .await?;

        tracing::info!("Migration v8 complete");
        Ok(())
    }

    /// Migration v9: Add subdirectory column for persisting session subdirectory path
    async fn migrate_to_v9(pool: &SqlitePool) -> anyhow::Result<()> {
        tracing::info!("Applying migration v9: Add subdirectory column");

        // Add subdirectory column
        let subdirectory_exists: bool = sqlx::query_scalar(
            "SELECT COUNT(*) > 0 FROM pragma_table_info('sessions') WHERE name = 'subdirectory'",
        )
        .fetch_one(pool)
        .await?;

        if !subdirectory_exists {
            sqlx::query("ALTER TABLE sessions ADD COLUMN subdirectory TEXT NOT NULL DEFAULT ''")
                .execute(pool)
                .await?;
            tracing::debug!("Added subdirectory column to sessions table");
        }

        // Record migration
        let now = Utc::now();
        sqlx::query("INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)")
            .bind(9)
            .bind(now.to_rfc3339())
            .execute(pool)
            .await?;

        tracing::info!("Migration v9 complete");
        Ok(())
    }

    /// Migration v10: Add subdirectory tracking to recent_repos with composite primary key
    async fn migrate_to_v10(pool: &SqlitePool) -> anyhow::Result<()> {
        tracing::info!("Applying migration v10: Add subdirectory column to recent_repos");

        // Step 1: Clean up any partial migration artifacts
        sqlx::query("DROP TABLE IF EXISTS recent_repos_v10_temp")
            .execute(pool)
            .await?;

        // Step 2: Create regular table to hold existing data (not TEMP due to connection pooling)
        sqlx::query(
            r"
            CREATE TABLE recent_repos_v10_temp (
                repo_path TEXT NOT NULL,
                last_used TEXT NOT NULL
            )
            ",
        )
        .execute(pool)
        .await?;

        // Step 3: Copy existing data to temp table
        sqlx::query(
            r"
            INSERT INTO recent_repos_v10_temp (repo_path, last_used)
            SELECT repo_path, last_used FROM recent_repos
            ",
        )
        .execute(pool)
        .await?;

        // Step 4: Drop old index
        sqlx::query("DROP INDEX IF EXISTS idx_recent_repos_last_used")
            .execute(pool)
            .await?;

        // Step 5: Drop old table completely
        sqlx::query("DROP TABLE recent_repos").execute(pool).await?;

        // Step 6: Create new table with correct schema
        sqlx::query(
            r"
            CREATE TABLE recent_repos (
                repo_path TEXT NOT NULL,
                subdirectory TEXT NOT NULL DEFAULT '',
                last_used TEXT NOT NULL,
                PRIMARY KEY (repo_path, subdirectory)
            )
            ",
        )
        .execute(pool)
        .await?;

        // Step 7: Copy data back with empty subdirectory
        sqlx::query(
            r"
            INSERT INTO recent_repos (repo_path, subdirectory, last_used)
            SELECT repo_path, '', last_used FROM recent_repos_v10_temp
            ",
        )
        .execute(pool)
        .await?;

        // Step 8: Drop temp table (if it still exists)
        sqlx::query("DROP TABLE IF EXISTS recent_repos_v10_temp")
            .execute(pool)
            .await?;

        // Step 9: Create index on last_used (IF NOT EXISTS for idempotency on retry)
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
        sqlx::query("INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)")
            .bind(10)
            .bind(now.to_rfc3339())
            .execute(pool)
            .await?;

        tracing::info!("Migration v10 complete");
        Ok(())
    }

    /// Migration v11: Add session_repositories junction table for multi-repo support
    async fn migrate_to_v11(pool: &SqlitePool) -> anyhow::Result<()> {
        tracing::info!("Applying migration v11: Multi-repository support");

        // Create session_repositories junction table
        sqlx::query(
            r"
            CREATE TABLE IF NOT EXISTS session_repositories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                repo_path TEXT NOT NULL,
                subdirectory TEXT NOT NULL DEFAULT '',
                worktree_path TEXT NOT NULL,
                branch_name TEXT NOT NULL,
                mount_name TEXT NOT NULL,
                is_primary INTEGER NOT NULL DEFAULT 0,
                display_order INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
                UNIQUE (session_id, mount_name)
            )
            ",
        )
        .execute(pool)
        .await?;

        // Create index on session_id for faster queries
        sqlx::query(
            r"
            CREATE INDEX IF NOT EXISTS idx_session_repositories_session_id
            ON session_repositories(session_id)
            ",
        )
        .execute(pool)
        .await?;

        // Migrate existing sessions to junction table
        // Each existing session gets one entry with is_primary=1 and mount_name='primary'
        sqlx::query(
            r"
            INSERT INTO session_repositories (
                session_id, repo_path, subdirectory, worktree_path,
                branch_name, mount_name, is_primary, display_order
            )
            SELECT
                id, repo_path, subdirectory, worktree_path,
                branch_name, 'primary', 1, 0
            FROM sessions
            ",
        )
        .execute(pool)
        .await?;

        // Record migration
        let now = Utc::now();
        sqlx::query("INSERT OR REPLACE INTO schema_version (version, applied_at) VALUES (?, ?)")
            .bind(11)
            .bind(now.to_rfc3339())
            .execute(pool)
            .await?;

        tracing::info!("Migration v11 complete");
        Ok(())
    }
}

#[async_trait]
impl Store for SqliteStore {
    #[instrument(skip(self))]
    async fn list_sessions(&self) -> anyhow::Result<Vec<Session>> {
        let rows = sqlx::query_as::<_, SessionRow>("SELECT * FROM sessions")
            .fetch_all(&self.pool)
            .await?;

        tracing::debug!("Loaded {} session rows from database", rows.len());

        let mut sessions = Vec::new();
        for (i, row) in rows.into_iter().enumerate() {
            let mut session: Session = row.try_into().map_err(|e: anyhow::Error| {
                tracing::error!("Failed to parse session row {}: {}", i, e);
                e
            })?;

            // Load repositories from junction table
            match self.get_session_repositories(session.id).await {
                Ok(repos) if !repos.is_empty() => {
                    session.repositories = Some(repos);
                }
                Ok(_) => {
                    // No repositories in junction table, construct from legacy fields
                    // This handles backward compatibility with sessions created before multi-repo
                    session.repositories = Some(vec![crate::core::SessionRepository {
                        repo_path: session.repo_path.clone(),
                        subdirectory: session.subdirectory.clone(),
                        worktree_path: session.worktree_path.clone(),
                        branch_name: session.branch_name.clone(),
                        mount_name: "primary".to_string(),
                        is_primary: true,
                    }]);
                }
                Err(e) => {
                    tracing::warn!(
                        session_id = %session.id,
                        error = %e,
                        "Failed to load repositories for session, using legacy fields"
                    );
                    // Fallback to legacy single-repo
                    session.repositories = Some(vec![crate::core::SessionRepository {
                        repo_path: session.repo_path.clone(),
                        subdirectory: session.subdirectory.clone(),
                        worktree_path: session.worktree_path.clone(),
                        branch_name: session.branch_name.clone(),
                        mount_name: "primary".to_string(),
                        is_primary: true,
                    }]);
                }
            }

            sessions.push(session);
        }

        Ok(sessions)
    }

    #[instrument(skip(self), fields(session_id = %id))]
    async fn get_session(&self, id: Uuid) -> anyhow::Result<Option<Session>> {
        let row = sqlx::query_as::<_, SessionRow>("SELECT * FROM sessions WHERE id = ?")
            .bind(id.to_string())
            .fetch_optional(&self.pool)
            .await?;

        match row {
            Some(r) => {
                let mut session: Session = r.try_into()?;

                // Load repositories from junction table
                match self.get_session_repositories(session.id).await {
                    Ok(repos) if !repos.is_empty() => {
                        session.repositories = Some(repos);
                    }
                    Ok(_) => {
                        // No repositories in junction table, construct from legacy fields
                        session.repositories = Some(vec![crate::core::SessionRepository {
                            repo_path: session.repo_path.clone(),
                            subdirectory: session.subdirectory.clone(),
                            worktree_path: session.worktree_path.clone(),
                            branch_name: session.branch_name.clone(),
                            mount_name: "primary".to_string(),
                            is_primary: true,
                        }]);
                    }
                    Err(e) => {
                        tracing::warn!(
                            session_id = %session.id,
                            error = %e,
                            "Failed to load repositories for session, using legacy fields"
                        );
                        session.repositories = Some(vec![crate::core::SessionRepository {
                            repo_path: session.repo_path.clone(),
                            subdirectory: session.subdirectory.clone(),
                            worktree_path: session.worktree_path.clone(),
                            branch_name: session.branch_name.clone(),
                            mount_name: "primary".to_string(),
                            is_primary: true,
                        }]);
                    }
                }

                Ok(Some(session))
            }
            None => Ok(None),
        }
    }

    #[instrument(skip(self, session), fields(session_id = %session.id, session_name = %session.name))]
    async fn save_session(&self, session: &Session) -> anyhow::Result<()> {
        sqlx::query(
            r"
            INSERT OR REPLACE INTO sessions (
                id, name, title, description, status, backend, agent, repo_path, worktree_path,
                subdirectory, branch_name, backend_id, initial_prompt, dangerous_skip_checks,
                pr_url, pr_check_status, claude_status, claude_status_updated_at,
                merge_conflict, access_mode, proxy_port, history_file_path,
                reconcile_attempts, last_reconcile_error, last_reconcile_at, error_message,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ",
        )
        .bind(session.id.to_string())
        .bind(&session.name)
        .bind(&session.title)
        .bind(&session.description)
        .bind(serde_json::to_string(&session.status)?)
        .bind(serde_json::to_string(&session.backend)?)
        .bind(serde_json::to_string(&session.agent)?)
        .bind(session.repo_path.to_string_lossy().to_string())
        .bind(session.worktree_path.to_string_lossy().to_string())
        .bind(session.subdirectory.to_string_lossy().to_string())
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
        .bind(serde_json::to_string(&session.claude_status)?)
        .bind(session.claude_status_updated_at.map(|t| t.to_rfc3339()))
        .bind(session.merge_conflict)
        .bind(session.access_mode.to_string())
        .bind(session.proxy_port.map(|p| p as i64))
        .bind(
            session
                .history_file_path
                .as_ref()
                .and_then(|p| p.to_str())
                .map(String::from),
        )
        .bind(session.reconcile_attempts as i64)
        .bind(&session.last_reconcile_error)
        .bind(session.last_reconcile_at.map(|t| t.to_rfc3339()))
        .bind(&session.error_message)
        .bind(session.created_at.to_rfc3339())
        .bind(session.updated_at.to_rfc3339())
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[instrument(skip(self), fields(session_id = %id))]
    async fn delete_session(&self, id: Uuid) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM sessions WHERE id = ?")
            .bind(id.to_string())
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    #[instrument(skip(self, event), fields(session_id = %event.session_id, event_type = ?event.event_type))]
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

    #[instrument(skip(self), fields(repo_path = %repo_path.display(), subdirectory = %subdirectory.display()))]
    async fn add_recent_repo(
        &self,
        repo_path: PathBuf,
        subdirectory: PathBuf,
    ) -> anyhow::Result<()> {
        // Canonicalize the path to prevent duplicates from different representations
        // (e.g., /home/user/repo vs /home/user/./repo vs ~/repo)
        let canonical = repo_path
            .canonicalize()
            .unwrap_or_else(|_| repo_path.clone()); // Fall back to original if canonicalization fails

        let now = Utc::now();
        sqlx::query(
            r"
            INSERT OR REPLACE INTO recent_repos (repo_path, subdirectory, last_used)
            VALUES (?, ?, ?)
            ",
        )
        .bind(canonical.to_string_lossy().to_string())
        .bind(subdirectory.to_string_lossy().to_string())
        .bind(now.to_rfc3339())
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[instrument(skip(self))]
    async fn get_recent_repos(&self) -> anyhow::Result<Vec<RecentRepo>> {
        let query = format!(
            "SELECT * FROM recent_repos ORDER BY last_used DESC LIMIT {}",
            super::MAX_RECENT_REPOS
        );

        let rows = sqlx::query_as::<_, RecentRepoRow>(&query)
            .fetch_all(&self.pool)
            .await?;

        let mut repos: Vec<RecentRepo> = rows
            .into_iter()
            .map(TryInto::try_into)
            .collect::<Result<Vec<_>, _>>()?;

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

    #[instrument(skip(self))]
    async fn get_session_repositories(
        &self,
        session_id: Uuid,
    ) -> anyhow::Result<Vec<crate::core::SessionRepository>> {
        use crate::core::SessionRepository;

        let rows = sqlx::query(
            r"
            SELECT repo_path, subdirectory, worktree_path, branch_name, mount_name, is_primary
            FROM session_repositories
            WHERE session_id = ?
            ORDER BY display_order ASC, is_primary DESC
            ",
        )
        .bind(session_id.to_string())
        .fetch_all(&self.pool)
        .await?;

        let mut repositories = Vec::new();
        for row in rows {
            repositories.push(SessionRepository {
                repo_path: PathBuf::from(row.try_get::<String, _>("repo_path")?),
                subdirectory: PathBuf::from(row.try_get::<String, _>("subdirectory")?),
                worktree_path: PathBuf::from(row.try_get::<String, _>("worktree_path")?),
                branch_name: row.try_get("branch_name")?,
                mount_name: row.try_get("mount_name")?,
                is_primary: row.try_get::<i64, _>("is_primary")? != 0,
            });
        }

        tracing::debug!(
            session_id = %session_id,
            count = repositories.len(),
            "Loaded repositories for session"
        );

        Ok(repositories)
    }

    #[instrument(skip(self, repositories), fields(session_id = %session_id, count = repositories.len()))]
    async fn save_session_repositories(
        &self,
        session_id: Uuid,
        repositories: &[crate::core::SessionRepository],
    ) -> anyhow::Result<()> {
        // Begin transaction
        let mut tx = self.pool.begin().await?;

        // Delete existing repositories for this session
        sqlx::query("DELETE FROM session_repositories WHERE session_id = ?")
            .bind(session_id.to_string())
            .execute(&mut *tx)
            .await?;

        // Insert new repositories
        for (index, repo) in repositories.iter().enumerate() {
            sqlx::query(
                r"
                INSERT INTO session_repositories (
                    session_id, repo_path, subdirectory, worktree_path,
                    branch_name, mount_name, is_primary, display_order
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ",
            )
            .bind(session_id.to_string())
            .bind(repo.repo_path.to_string_lossy().to_string())
            .bind(repo.subdirectory.to_string_lossy().to_string())
            .bind(repo.worktree_path.to_string_lossy().to_string())
            .bind(&repo.branch_name)
            .bind(&repo.mount_name)
            .bind(i64::from(repo.is_primary))
            .bind(index as i64)
            .execute(&mut *tx)
            .await?;
        }

        // Commit transaction
        tx.commit().await?;

        tracing::debug!(
            session_id = %session_id,
            count = repositories.len(),
            "Saved repositories for session"
        );

        Ok(())
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
        EventType::ClaudeStatusChanged { .. } => "ClaudeStatusChanged",
        EventType::ConflictStatusChanged { .. } => "ConflictStatusChanged",
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
    title: Option<String>,
    description: Option<String>,
    status: String,
    backend: String,
    agent: String,
    repo_path: String,
    worktree_path: String,
    subdirectory: String,
    branch_name: String,
    backend_id: Option<String>,
    initial_prompt: String,
    dangerous_skip_checks: bool,
    pr_url: Option<String>,
    pr_check_status: Option<String>,
    claude_status: String,
    claude_status_updated_at: Option<String>,
    merge_conflict: bool,
    access_mode: String,
    proxy_port: Option<i64>,
    history_file_path: Option<String>,
    reconcile_attempts: i64,
    last_reconcile_error: Option<String>,
    last_reconcile_at: Option<String>,
    error_message: Option<String>,
    created_at: String,
    updated_at: String,
}

impl TryFrom<SessionRow> for Session {
    type Error = anyhow::Error;

    fn try_from(row: SessionRow) -> Result<Self, Self::Error> {
        let id = Uuid::parse_str(&row.id).map_err(|e| {
            anyhow::anyhow!("session '{}': invalid id '{}': {}", row.name, row.id, e)
        })?;

        let status = serde_json::from_str(&row.status).map_err(|e| {
            anyhow::anyhow!(
                "session '{}': invalid status '{}': {}",
                row.name,
                row.status,
                e
            )
        })?;

        let backend = serde_json::from_str(&row.backend).map_err(|e| {
            anyhow::anyhow!(
                "session '{}': invalid backend '{}': {}",
                row.name,
                row.backend,
                e
            )
        })?;

        let agent = serde_json::from_str(&row.agent).map_err(|e| {
            anyhow::anyhow!(
                "session '{}': invalid agent '{}': {}",
                row.name,
                row.agent,
                e
            )
        })?;

        let pr_check_status = row
            .pr_check_status
            .map(|s| {
                serde_json::from_str(&s).map_err(|e| {
                    anyhow::anyhow!(
                        "session '{}': invalid pr_check_status '{}': {}",
                        row.name,
                        s,
                        e
                    )
                })
            })
            .transpose()?;

        // Try JSON first, then fall back to parsing raw enum variant name
        // (migration v3 used DEFAULT 'Unknown' which is not valid JSON)
        let claude_status: crate::core::ClaudeWorkingStatus =
            serde_json::from_str(&row.claude_status)
                .or_else(|_| row.claude_status.parse())
                .map_err(|e| {
                    anyhow::anyhow!(
                        "session '{}': invalid claude_status '{}': {}",
                        row.name,
                        row.claude_status,
                        e
                    )
                })?;

        let claude_status_updated_at = row
            .claude_status_updated_at
            .map(|s| {
                chrono::DateTime::parse_from_rfc3339(&s)
                    .map(Into::into)
                    .map_err(|e| {
                        anyhow::anyhow!(
                            "session '{}': invalid claude_status_updated_at '{}': {}",
                            row.name,
                            s,
                            e
                        )
                    })
            })
            .transpose()?;

        let created_at = chrono::DateTime::parse_from_rfc3339(&row.created_at)
            .map(Into::into)
            .map_err(|e| {
                anyhow::anyhow!(
                    "session '{}': invalid created_at '{}': {}",
                    row.name,
                    row.created_at,
                    e
                )
            })?;

        let updated_at = chrono::DateTime::parse_from_rfc3339(&row.updated_at)
            .map(Into::into)
            .map_err(|e| {
                anyhow::anyhow!(
                    "session '{}': invalid updated_at '{}': {}",
                    row.name,
                    row.updated_at,
                    e
                )
            })?;

        let last_reconcile_at = row
            .last_reconcile_at
            .map(|s| {
                chrono::DateTime::parse_from_rfc3339(&s)
                    .map(Into::into)
                    .map_err(|e| {
                        anyhow::anyhow!(
                            "session '{}': invalid last_reconcile_at '{}': {}",
                            row.name,
                            s,
                            e
                        )
                    })
            })
            .transpose()?;

        Ok(Self {
            id,
            name: row.name,
            title: row.title,
            description: row.description,
            status,
            backend,
            agent,
            repo_path: row.repo_path.into(),
            worktree_path: row.worktree_path.into(),
            subdirectory: row.subdirectory.into(),
            branch_name: row.branch_name,
            backend_id: row.backend_id,
            initial_prompt: row.initial_prompt,
            dangerous_skip_checks: row.dangerous_skip_checks,
            pr_url: row.pr_url,
            pr_check_status,
            claude_status,
            claude_status_updated_at,
            merge_conflict: row.merge_conflict,
            access_mode: row.access_mode.parse().unwrap_or_default(),
            proxy_port: row.proxy_port.map(|p| p as u16),
            history_file_path: row.history_file_path.map(PathBuf::from),
            reconcile_attempts: row.reconcile_attempts as u32,
            last_reconcile_error: row.last_reconcile_error,
            last_reconcile_at,
            error_message: row.error_message,
            progress: None, // Progress is transient and not persisted to database
            created_at,
            updated_at,
            repositories: None, // Repositories loaded separately via get_session_repositories
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
    subdirectory: String,
    last_used: String,
}

impl TryFrom<RecentRepoRow> for RecentRepo {
    type Error = anyhow::Error;

    fn try_from(row: RecentRepoRow) -> Result<Self, Self::Error> {
        Ok(Self {
            repo_path: row.repo_path.into(),
            subdirectory: row.subdirectory.into(),
            last_used: chrono::DateTime::parse_from_rfc3339(&row.last_used)?.into(),
        })
    }
}
