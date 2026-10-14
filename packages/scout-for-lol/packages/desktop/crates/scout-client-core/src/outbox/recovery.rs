//! Resumable game discovery and artifact collection, independent of delivery.

use rusqlite::{OptionalExtension as _, params};

use super::{ObservationOutbox, OutboxError};

pub(super) const SCHEMA: &str = "
  CREATE TABLE IF NOT EXISTS game_recovery (
    observer TEXT NOT NULL, platform TEXT NOT NULL, game_id TEXT NOT NULL,
    live INTEGER NOT NULL DEFAULT 0,
    result_queued INTEGER NOT NULL DEFAULT 0,
    timeline_queued INTEGER NOT NULL DEFAULT 0,
    full_game BLOB,
    next_attempt_millis INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (observer, platform, game_id)
  );
  CREATE TABLE IF NOT EXISTS history_scan (
    observer TEXT PRIMARY KEY, next_index INTEGER NOT NULL DEFAULT 20,
    next_scan_millis INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS game_hint (
    observer TEXT NOT NULL, game_id TEXT NOT NULL,
    resolved INTEGER NOT NULL DEFAULT 0,
    next_attempt_millis INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (observer, game_id)
  );";

/// A discovered game whose result or timeline still needs collecting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecoveryGame {
    /// Platform-qualified identity prevents equal numeric IDs from joining.
    pub platform: String,
    /// Validated decimal game identifier.
    pub game_id: String,
    /// Whether the desktop witnessed a complete end transition.
    pub live: bool,
    /// Whether result evidence is durable in the observation outbox.
    pub result_queued: bool,
    /// Whether timeline evidence is durable in the observation outbox.
    pub timeline_queued: bool,
    /// Full history is retained while the independent timeline is pending.
    pub full_game: Option<Vec<u8>>,
}

impl ObservationOutbox {
    /// Keep gameflow, EOG, Clash and local replay references even if history omits them.
    ///
    /// # Errors
    /// Returns a SQLite error when discovery cannot be persisted.
    pub fn remember_game_hint(&self, observer: &str, game_id: &str) -> Result<(), OutboxError> {
        self.connection()?.execute(
            "INSERT OR IGNORE INTO game_hint (observer, game_id) VALUES (?1, ?2)",
            params![observer, game_id],
        )?;
        Ok(())
    }

    /// Read a bounded set of unresolved references for the signed-in account.
    ///
    /// # Errors
    /// Returns a SQLite error when references cannot be read.
    pub fn game_hints(&self, observer: &str, now: i64) -> Result<Vec<String>, OutboxError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare("SELECT game_id FROM game_hint WHERE observer = ?1 AND resolved = 0 AND next_attempt_millis <= ?2 ORDER BY next_attempt_millis, game_id LIMIT 4")?;
        statement
            .query_map(params![observer, now], |row| row.get(0))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(OutboxError::Sqlite)
    }

    /// Mark a reference resolved only after its qualified discovery is durable.
    ///
    /// # Errors
    /// Returns a SQLite error when progress cannot be saved.
    pub fn checkpoint_game_hint(
        &self,
        observer: &str,
        game_id: &str,
        resolved: bool,
        now: i64,
    ) -> Result<(), OutboxError> {
        self.connection()?.execute("UPDATE game_hint SET resolved = ?3, next_attempt_millis = ?4 + 300000 WHERE observer = ?1 AND game_id = ?2", params![observer, game_id, resolved, now])?;
        Ok(())
    }

    /// Discover once; a later witnessed completion upgrades historical evidence.
    ///
    /// # Errors
    /// Returns a SQLite error if discovery cannot be made durable.
    pub fn discover_game(
        &self,
        observer: &str,
        platform: &str,
        game_id: &str,
        live: bool,
    ) -> Result<(), OutboxError> {
        self.connection()?.execute(
            "INSERT INTO game_recovery (observer, platform, game_id, live) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (observer, platform, game_id) DO UPDATE SET
               result_queued = CASE WHEN excluded.live > game_recovery.live THEN 0 ELSE game_recovery.result_queued END,
               next_attempt_millis = CASE WHEN excluded.live > game_recovery.live THEN 0 ELSE game_recovery.next_attempt_millis END,
               live = MAX(game_recovery.live, excluded.live)",
            params![observer, platform, game_id, live],
        )?;
        Ok(())
    }

    /// Read bounded due work for the currently authenticated League account.
    ///
    /// # Errors
    /// Returns a SQLite error when pending evidence cannot be read.
    pub fn recovery_games(
        &self,
        observer: &str,
        now_millis: i64,
        limit: u32,
    ) -> Result<Vec<RecoveryGame>, OutboxError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT platform, game_id, live, result_queued, timeline_queued, full_game FROM game_recovery
             WHERE observer = ?1 AND next_attempt_millis <= ?2 AND (result_queued = 0 OR timeline_queued = 0)
             ORDER BY live DESC, next_attempt_millis, game_id LIMIT ?3",
        )?;
        let rows = statement.query_map(params![observer, now_millis, limit], |row| {
            Ok(RecoveryGame {
                platform: row.get(0)?,
                game_id: row.get(1)?,
                live: row.get(2)?,
                result_queued: row.get(3)?,
                timeline_queued: row.get(4)?,
                full_game: row.get(5)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(OutboxError::Sqlite)
    }

    /// Cache a qualified full-game response before attempting outbox writes.
    ///
    /// # Errors
    /// Returns a SQLite error when the recovery cache cannot be saved.
    pub fn cache_recovery_game(
        &self,
        observer: &str,
        game: &RecoveryGame,
        body: &[u8],
    ) -> Result<(), OutboxError> {
        self.connection()?.execute(
            "UPDATE game_recovery SET full_game = ?4 WHERE observer = ?1 AND platform = ?2 AND game_id = ?3",
            params![observer, game.platform, game.game_id, body],
        )?;
        Ok(())
    }

    /// Record only fragments already persisted in the at-least-once outbox.
    /// Missing fragments remain retryable without a retry-count cutoff.
    ///
    /// # Errors
    /// Returns a SQLite error when the collection checkpoint cannot be saved.
    pub fn checkpoint_game(
        &self,
        observer: &str,
        game: &RecoveryGame,
        full_game: Option<&[u8]>,
        result_queued: bool,
        timeline_queued: bool,
        now_millis: i64,
    ) -> Result<(), OutboxError> {
        self.connection()?.execute(
            "UPDATE game_recovery SET full_game = COALESCE(?4, full_game),
               result_queued = MAX(result_queued, ?5), timeline_queued = MAX(timeline_queued, ?6),
               attempts = attempts + 1,
               next_attempt_millis = ?7 + MIN(300000, 5000 * (attempts + 1))
             WHERE observer = ?1 AND platform = ?2 AND game_id = ?3",
            params![
                observer,
                game.platform,
                game.game_id,
                full_game,
                result_queued,
                timeline_queued,
                now_millis
            ],
        )?;
        Ok(())
    }

    /// The next overlapping page of this account's all-history scan.
    ///
    /// # Errors
    /// Returns a SQLite error when a checkpoint cannot be read.
    pub fn history_page(
        &self,
        observer: &str,
        now_millis: i64,
    ) -> Result<Option<u32>, OutboxError> {
        let connection = self.connection()?;
        let cursor: Option<(u32, i64)> = connection
            .query_row(
                "SELECT next_index, next_scan_millis FROM history_scan WHERE observer = ?1",
                [observer],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        Ok(match cursor {
            Some((index, due)) if due <= now_millis => Some(index),
            None => Some(10),
            _ => None,
        })
    }

    /// Advance after the entire page is durable; an exhausted scan restarts daily.
    /// The newest page is collected separately on every pass.
    ///
    /// # Errors
    /// Returns a SQLite error when progress cannot be committed.
    pub fn checkpoint_history(
        &self,
        observer: &str,
        index: u32,
        exhausted: bool,
        now_millis: i64,
    ) -> Result<(), OutboxError> {
        self.connection()?.execute(
            "INSERT INTO history_scan (observer, next_index, next_scan_millis) VALUES (?1, ?2, ?3)
             ON CONFLICT (observer) DO UPDATE SET next_index = excluded.next_index, next_scan_millis = excluded.next_scan_millis",
            params![observer, if exhausted { 10 } else { index.saturating_add(10) }, if exhausted { now_millis.saturating_add(86_400_000) } else { 0 }],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::super::ObservationOutbox;

    #[test]
    fn retains_omitted_game_references_across_restarts_and_retry_deferrals()
    -> Result<(), Box<dyn std::error::Error>> {
        let path =
            std::env::temp_dir().join(format!("scout-hints-{}.sqlite", uuid::Uuid::new_v4()));
        let outbox = ObservationOutbox::open(&path)?;
        outbox.remember_game_hint("owner", "123")?;
        outbox.remember_game_hint("other", "456")?;
        outbox.checkpoint_game_hint("owner", "123", false, 0)?;
        let reopened = ObservationOutbox::open(&path)?;
        assert_eq!(reopened.game_hints("owner", 299_999)?, Vec::<String>::new());
        assert_eq!(reopened.game_hints("owner", 300_000)?, vec!["123"]);
        reopened.discover_game("owner", "NA1", "123", false)?;
        reopened.checkpoint_game_hint("owner", "123", true, 300_000)?;
        reopened.remember_game_hint("owner", "123")?;
        assert_eq!(reopened.game_hints("owner", 900_000)?, Vec::<String>::new());
        assert_eq!(reopened.recovery_games("owner", 0, 4)?.len(), 1);
        assert_eq!(reopened.game_hints("other", 0)?, vec!["456"]);
        std::fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn recovers_fragments_across_restarts_without_crossing_accounts_or_platforms()
    -> Result<(), Box<dyn std::error::Error>> {
        let path =
            std::env::temp_dir().join(format!("scout-recovery-{}.sqlite", uuid::Uuid::new_v4()));
        let outbox = ObservationOutbox::open(&path)?;
        outbox.discover_game("observer", "NA1", "123", false)?;
        outbox.discover_game("observer", "EUW1", "123", false)?;
        outbox.discover_game("other", "NA1", "123", false)?;
        let game = outbox.recovery_games("observer", 0, 1)?.remove(0);
        outbox.cache_recovery_game("observer", &game, b"{\"cached\":true}")?;
        let cached = ObservationOutbox::open(&path)?
            .recovery_games("observer", 0, 1)?
            .remove(0);
        assert!(!cached.result_queued);
        assert_eq!(cached.full_game, Some(b"{\"cached\":true}".to_vec()));
        outbox.checkpoint_game("observer", &game, Some(b"{}"), true, false, 0)?;
        let reopened = ObservationOutbox::open(&path)?;
        let pending = reopened.recovery_games("observer", 10_000, 10)?;
        assert_eq!(pending.len(), 2);
        assert!(pending.iter().any(|game| game.result_queued
            && !game.timeline_queued
            && game.full_game == Some(b"{}".to_vec())));
        reopened.discover_game("observer", &game.platform, "123", true)?;
        let upgraded = reopened.recovery_games("observer", 10_000, 1)?.remove(0);
        assert!(upgraded.live);
        assert!(!upgraded.result_queued);
        assert_eq!(reopened.history_page("observer", 0)?, Some(10));
        reopened.checkpoint_history("observer", 10, false, 0)?;
        assert_eq!(reopened.history_page("observer", 0)?, Some(20));
        reopened.checkpoint_history("observer", 20, true, 0)?;
        assert_eq!(reopened.history_page("observer", 0)?, None);
        assert_eq!(reopened.history_page("observer", 86_400_001)?, Some(10));
        std::fs::remove_file(path)?;
        Ok(())
    }
}
