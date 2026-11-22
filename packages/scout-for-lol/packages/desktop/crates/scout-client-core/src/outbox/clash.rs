//! Clash reads the League client refused, remembered across restarts.
//!
//! The player's Clash history names every tournament they ever entered, and
//! the League client answers `400 Bad Request` for each one that is no longer
//! running. Held only in memory, that refusal was relearned on every app start
//! — one refused request per past tournament. Persisting it makes a restart
//! with unchanged payloads issue none.

use rusqlite::params;

use super::{ObservationOutbox, OutboxError};

pub(super) const SCHEMA: &str = "
  CREATE TABLE IF NOT EXISTS refused_clash_read (
    read TEXT NOT NULL,
    id TEXT NOT NULL,
    evidence TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    refused_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (read, id)
  );";

/// One Clash entity read the League client refused.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefusedClashRead {
    /// Which read: `clash_tournament`, `clash_roster_stats`, and so on.
    pub read: String,
    /// The tournament, roster or bracket ID it was asked for.
    pub id: String,
    /// Fingerprint of the payloads that named the ID when it was refused. A
    /// different fingerprint means those payloads changed, which reopens it.
    pub evidence: String,
    /// The League client's HTTP status.
    pub status_code: u16,
}

impl ObservationOutbox {
    /// Every Clash read the League client has refused.
    ///
    /// # Errors
    /// Returns a SQLite error when the refusals cannot be read.
    pub fn refused_clash_reads(&self) -> Result<Vec<RefusedClashRead>, OutboxError> {
        let connection = self.connection()?;
        let mut statement =
            connection.prepare("SELECT read, id, evidence, status_code FROM refused_clash_read")?;
        statement
            .query_map([], |row| {
                Ok(RefusedClashRead {
                    read: row.get(0)?,
                    id: row.get(1)?,
                    evidence: row.get(2)?,
                    status_code: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(OutboxError::Sqlite)
    }

    /// Record a refusal, replacing any earlier one for the same read and ID.
    ///
    /// # Errors
    /// Returns a SQLite error when the refusal cannot be persisted.
    pub fn remember_refused_clash_read(
        &self,
        refusal: &RefusedClashRead,
    ) -> Result<(), OutboxError> {
        self.connection()?.execute(
            "INSERT INTO refused_clash_read (read, id, evidence, status_code)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(read, id) DO UPDATE SET
               evidence = excluded.evidence,
               status_code = excluded.status_code,
               refused_at = CURRENT_TIMESTAMP",
            params![
                refusal.read,
                refusal.id,
                refusal.evidence,
                refusal.status_code
            ],
        )?;
        Ok(())
    }

    /// Forget a refusal once the League client answers the read.
    ///
    /// # Errors
    /// Returns a SQLite error when the refusal cannot be removed.
    pub fn forget_refused_clash_read(&self, read: &str, id: &str) -> Result<(), OutboxError> {
        self.connection()?.execute(
            "DELETE FROM refused_clash_read WHERE read = ?1 AND id = ?2",
            params![read, id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::{ObservationOutbox, RefusedClashRead};

    #[test]
    fn a_refusal_survives_reopening_and_is_replaced_or_forgotten()
    -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!("scout-clash-refusal-{}.db", Uuid::new_v4()));
        let refusal = |evidence: &str| RefusedClashRead {
            read: "clash_tournament".to_owned(),
            id: "1001".to_owned(),
            evidence: evidence.to_owned(),
            status_code: 400,
        };
        ObservationOutbox::open(&path)?.remember_refused_clash_read(&refusal("a"))?;

        let reopened = ObservationOutbox::open(&path)?;
        assert_eq!(reopened.refused_clash_reads()?, [refusal("a")]);
        reopened.remember_refused_clash_read(&refusal("b"))?;
        assert_eq!(reopened.refused_clash_reads()?, [refusal("b")]);
        reopened.forget_refused_clash_read("clash_tournament", "1001")?;
        assert_eq!(reopened.refused_clash_reads()?, []);
        std::fs::remove_file(path)?;
        Ok(())
    }
}
