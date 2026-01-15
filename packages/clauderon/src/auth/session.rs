use chrono::{Duration, Utc};
use sqlx::SqlitePool;
use uuid::Uuid;

use super::types::{AuthSession, AuthSessionRow};

/// Session store for managing authentication sessions
#[derive(Clone)]
pub struct SessionStore {
    pool: SqlitePool,
}

impl SessionStore {
    /// Create a new session store
    #[must_use] 
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    /// Create a new authentication session
    ///
    /// Sessions expire after 30 days
    ///
    /// # Errors
    /// Returns an error if the database operation fails
    pub async fn create_session(&self, user_id: Uuid) -> anyhow::Result<Uuid> {
        let session_id = Uuid::new_v4();
        let now = Utc::now();
        let expires_at = now + Duration::days(30);

        sqlx::query(
            r"
            INSERT INTO auth_sessions (id, user_id, expires_at, created_at)
            VALUES (?, ?, ?, ?)
            ",
        )
        .bind(session_id.to_string())
        .bind(user_id.to_string())
        .bind(expires_at.to_rfc3339())
        .bind(now.to_rfc3339())
        .execute(&self.pool)
        .await?;

        Ok(session_id)
    }

    /// Get and validate a session by ID
    ///
    /// Returns None if the session doesn't exist or has expired
    ///
    /// # Errors
    /// Returns an error if the database operation fails
    pub async fn get_session(&self, session_id: Uuid) -> anyhow::Result<Option<AuthSession>> {
        let row: Option<AuthSessionRow> = sqlx::query_as::<_, AuthSessionRow>(
            r"
            SELECT id, user_id, expires_at, created_at
            FROM auth_sessions
            WHERE id = ?
            ",
        )
        .bind(session_id.to_string())
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else {
            return Ok(None);
        };

        let session: AuthSession = row.try_into()?;

        // Check if expired
        if session.expires_at < Utc::now() {
            // Delete expired session
            self.delete_session(session_id).await?;
            return Ok(None);
        }

        Ok(Some(session))
    }

    /// Delete a session
    ///
    /// # Errors
    /// Returns an error if the database operation fails
    pub async fn delete_session(&self, session_id: Uuid) -> anyhow::Result<()> {
        sqlx::query("DELETE FROM auth_sessions WHERE id = ?")
            .bind(session_id.to_string())
            .execute(&self.pool)
            .await?;

        Ok(())
    }

    /// Clean up expired sessions
    ///
    /// This should be called periodically to remove expired sessions from the database
    ///
    /// # Errors
    /// Returns an error if the database operation fails
    pub async fn cleanup_expired_sessions(&self) -> anyhow::Result<usize> {
        let now = Utc::now();

        let result = sqlx::query("DELETE FROM auth_sessions WHERE expires_at < ?")
            .bind(now.to_rfc3339())
            .execute(&self.pool)
            .await?;

        Ok(result.rows_affected() as usize)
    }
}

// Implement From for SqliteRow
impl sqlx::FromRow<'_, sqlx::sqlite::SqliteRow> for AuthSessionRow {
    fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(Self {
            id: row.try_get("id")?,
            user_id: row.try_get("user_id")?,
            expires_at: row.try_get("expires_at")?,
            created_at: row.try_get("created_at")?,
        })
    }
}
