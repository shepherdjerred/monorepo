//! Durable SQLite outbox for at-least-once observation delivery.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, TransactionBehavior, params};
use thiserror::Error;
use uuid::Uuid;

use crate::protocol::{ObservationEnvelope, ProtocolError};

/// One pending outbox row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingObservation {
    /// Observation idempotency key.
    pub observation_id: Uuid,
    /// Monotonic local sequence.
    pub sequence: u64,
    /// Canonical JSON body.
    pub body: Vec<u8>,
    /// Number of failed delivery attempts.
    pub attempt_count: u32,
}

/// SQLite-backed at-least-once queue.
#[derive(Debug, Clone)]
pub struct ObservationOutbox {
    path: PathBuf,
}

impl ObservationOutbox {
    /// Open or create an outbox and apply its idempotent schema.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if the database cannot be opened or
    /// migrated.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, OutboxError> {
        let outbox = Self {
            path: path.as_ref().to_path_buf(),
        };
        let connection = outbox.connection()?;
        connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             CREATE TABLE IF NOT EXISTS observation_outbox (
               observation_id TEXT PRIMARY KEY,
               sequence INTEGER NOT NULL UNIQUE,
               body BLOB NOT NULL,
               attempt_count INTEGER NOT NULL DEFAULT 0,
               created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE IF NOT EXISTS outbox_metadata (
               singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
               next_sequence INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS uploaded_replay (
               digest TEXT PRIMARY KEY,
               game_id TEXT NOT NULL,
               uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE IF NOT EXISTS rejected_replay (
               digest TEXT PRIMARY KEY,
               game_id TEXT NOT NULL,
               status_code INTEGER NOT NULL,
               rejected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );",
        )?;
        Ok(outbox)
    }

    fn connection(&self) -> Result<Connection, OutboxError> {
        Connection::open(&self.path).map_err(OutboxError::Sqlite)
    }

    /// Return the next durable sequence number.
    ///
    /// # Errors
    ///
    /// Returns a typed SQLite or numeric-range error.
    pub fn next_sequence(&self) -> Result<u64, OutboxError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "INSERT OR IGNORE INTO outbox_metadata (singleton, next_sequence)
             SELECT 1, COALESCE(MAX(sequence), 0) + 1 FROM observation_outbox",
            [],
        )?;
        let sequence: i64 = transaction.query_row(
            "UPDATE outbox_metadata SET next_sequence = next_sequence + 1
             WHERE singleton = 1 RETURNING next_sequence - 1",
            [],
            |row| row.get(0),
        )?;
        transaction.commit()?;
        u64::try_from(sequence).map_err(|_| OutboxError::SequenceRange)
    }

    /// Insert a validated observation. Identical idempotent retries are harmless.
    ///
    /// # Errors
    ///
    /// Returns a protocol validation, serialization, SQLite, or range error.
    pub fn enqueue(&self, observation: &ObservationEnvelope) -> Result<(), OutboxError> {
        observation.validate()?;
        let body = observation.to_bytes()?;
        let sequence =
            i64::try_from(observation.sequence).map_err(|_| OutboxError::SequenceRange)?;
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO observation_outbox (observation_id, sequence, body)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(observation_id) DO NOTHING",
            params![observation.observation_id.to_string(), sequence, body],
        )?;
        Ok(())
    }

    /// Read an ordered delivery page.
    ///
    /// # Errors
    ///
    /// Returns a typed SQLite, UUID, or numeric-range error if persisted state
    /// cannot be decoded safely.
    pub fn pending(&self, limit: usize) -> Result<Vec<PendingObservation>, OutboxError> {
        let bounded_limit = limit.clamp(1, 100);
        let limit = i64::try_from(bounded_limit).map_err(|_| OutboxError::SequenceRange)?;
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT observation_id, sequence, body, attempt_count
             FROM observation_outbox ORDER BY sequence ASC LIMIT ?1",
        )?;
        let rows = statement.query_map([limit], |row| {
            let id: String = row.get(0)?;
            let sequence: i64 = row.get(1)?;
            let attempt_count: i64 = row.get(3)?;
            Ok((id, sequence, row.get(2)?, attempt_count))
        })?;
        rows.map(|row| {
            let (id, sequence, body, attempt_count) = row?;
            Ok(PendingObservation {
                observation_id: Uuid::parse_str(&id).map_err(OutboxError::Uuid)?,
                sequence: u64::try_from(sequence).map_err(|_| OutboxError::SequenceRange)?,
                body,
                attempt_count: u32::try_from(attempt_count)
                    .map_err(|_| OutboxError::SequenceRange)?,
            })
        })
        .collect()
    }

    /// Remove a server-acknowledged observation.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if the acknowledgement cannot be stored.
    pub fn acknowledge(&self, observation_id: Uuid) -> Result<bool, OutboxError> {
        let connection = self.connection()?;
        let changed = connection.execute(
            "DELETE FROM observation_outbox WHERE observation_id = ?1",
            [observation_id.to_string()],
        )?;
        Ok(changed == 1)
    }

    /// Record a failed delivery attempt without changing ordering or bytes.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if the failure count cannot be stored.
    pub fn record_failure(&self, observation_id: Uuid) -> Result<bool, OutboxError> {
        let connection = self.connection()?;
        let changed = connection.execute(
            "UPDATE observation_outbox SET attempt_count = attempt_count + 1
             WHERE observation_id = ?1",
            [observation_id.to_string()],
        )?;
        Ok(changed == 1)
    }

    /// Return whether a content-addressed replay has a durable server receipt.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if local receipt state cannot be read.
    pub fn replay_uploaded(&self, digest: &str) -> Result<bool, OutboxError> {
        let connection = self.connection()?;
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM uploaded_replay WHERE digest = ?1",
            [digest],
            |row| row.get(0),
        )?;
        Ok(count == 1)
    }

    /// Return whether a replay has a successful or terminal server receipt.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if local receipt state cannot be read.
    pub fn replay_handled(&self, digest: &str) -> Result<bool, OutboxError> {
        let connection = self.connection()?;
        let count: i64 = connection.query_row(
            "SELECT
               (SELECT COUNT(*) FROM uploaded_replay WHERE digest = ?1) +
               (SELECT COUNT(*) FROM rejected_replay WHERE digest = ?1)",
            [digest],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }

    /// Persist a successful content-addressed replay receipt.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if the receipt cannot be persisted.
    pub fn mark_replay_uploaded(&self, digest: &str, game_id: &str) -> Result<(), OutboxError> {
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO uploaded_replay (digest, game_id) VALUES (?1, ?2)
             ON CONFLICT(digest) DO NOTHING",
            params![digest, game_id],
        )?;
        Ok(())
    }

    /// Persist a terminal file-specific rejection so later replays can proceed.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if the rejection cannot be persisted.
    pub fn mark_replay_rejected(
        &self,
        digest: &str,
        game_id: &str,
        status_code: u16,
    ) -> Result<(), OutboxError> {
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO rejected_replay (digest, game_id, status_code)
             VALUES (?1, ?2, ?3) ON CONFLICT(digest) DO NOTHING",
            params![digest, game_id, status_code],
        )?;
        Ok(())
    }
}

/// Durable outbox failure.
#[derive(Debug, Error)]
pub enum OutboxError {
    /// SQLite operation failed.
    #[error("SQLite outbox failed: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// Observation failed protocol validation.
    #[error("observation failed validation: {0}")]
    Protocol(#[from] ProtocolError),
    /// Stored UUID is invalid.
    #[error("stored observation id is invalid: {0}")]
    Uuid(uuid::Error),
    /// Sequence could not be represented safely.
    #[error("outbox sequence is outside the supported range")]
    SequenceRange,
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::json;
    use uuid::Uuid;

    use crate::protocol::{ObservationEnvelope, ObservationKind};

    use super::ObservationOutbox;

    fn temporary_database() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("scout-outbox-{}.db", Uuid::new_v4()))
    }

    #[test]
    fn persists_and_acknowledges_in_sequence_order() -> Result<(), Box<dyn std::error::Error>> {
        let path = temporary_database();
        let outbox = ObservationOutbox::open(&path)?;
        let first = ObservationEnvelope::new(
            1,
            ObservationKind::Gameflow,
            "test",
            json!({ "phase": "Lobby" }),
        )?;
        let second = ObservationEnvelope::new(
            2,
            ObservationKind::Gameflow,
            "test",
            json!({ "phase": "InProgress" }),
        )?;
        outbox.enqueue(&second)?;
        outbox.enqueue(&first)?;
        let pending = outbox.pending(100)?;
        assert_eq!(pending.len(), 2);
        assert_eq!(pending[0].sequence, 1);
        assert!(outbox.acknowledge(first.observation_id)?);
        assert_eq!(outbox.pending(100)?.len(), 1);
        assert_eq!(outbox.next_sequence()?, 3);
        assert_eq!(outbox.next_sequence()?, 4);
        assert!(outbox.acknowledge(second.observation_id)?);
        assert_eq!(outbox.next_sequence()?, 5);
        assert!(!outbox.replay_handled("rejected-digest")?);
        outbox.mark_replay_rejected("rejected-digest", "12345", 403)?;
        assert!(outbox.replay_handled("rejected-digest")?);
        drop(outbox);
        fs::remove_file(path)?;
        Ok(())
    }
}
