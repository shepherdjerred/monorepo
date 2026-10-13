//! Observer-scoped transient game context. Legacy rows are retained without joining them.

use super::{OutboxError, has_column};
use rusqlite::{Connection, params};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS pending_end_of_game (
 observer TEXT NOT NULL, game_id TEXT NOT NULL, body BLOB NOT NULL,
 captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(observer, game_id));
CREATE TABLE IF NOT EXISTS pending_game_timing (
 observer TEXT NOT NULL, game_id TEXT NOT NULL, started_at_millis INTEGER, ended_at_millis INTEGER,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(observer, game_id));
CREATE TABLE IF NOT EXISTS observed_lobby (
 observer TEXT PRIMARY KEY, lobby_id TEXT NOT NULL, observed_at_millis INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS game_lobby_binding (
 observer TEXT NOT NULL, game_id TEXT NOT NULL, lobby_id TEXT,
 bound_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(observer, game_id));";

pub(super) fn migrate(connection: &mut Connection) -> Result<(), OutboxError> {
    let transaction = connection.transaction()?;
    for table in [
        "pending_end_of_game",
        "pending_game_timing",
        "observed_lobby",
        "game_lobby_binding",
    ] {
        let exists: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            params![table],
            |row| row.get(0),
        )?;
        if exists && !has_column(&transaction, table, "observer")? {
            transaction.execute_batch(&format!(
                "ALTER TABLE {table} RENAME TO {table}_unqualified_v1;"
            ))?;
        }
    }
    transaction.execute_batch(SCHEMA)?;
    transaction.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::{LobbyBinding, ObservationOutbox};
    use rusqlite::Connection;

    #[test]
    fn fragments_and_lobbies_cannot_cross_accounts() -> Result<(), Box<dyn std::error::Error>> {
        let path =
            std::env::temp_dir().join(format!("scout-context-{}.sqlite", uuid::Uuid::new_v4()));
        let outbox = ObservationOutbox::open(&path)?;
        outbox.remember_end_of_game("one", "123", b"first")?;
        outbox.remember_game_start("one", "123", 1000)?;
        outbox.remember_game_end("one", "123", 2000)?;
        outbox.remember_observed_lobby("one", "party-one", 1000)?;
        assert_eq!(outbox.pending_end_of_game("two", "123")?, None);
        assert_eq!(outbox.pending_game_timing("two", "123")?, None);
        assert_eq!(
            outbox.bind_game_to_lobby("two", "123", 1000)?,
            LobbyBinding::Unwitnessed
        );
        assert_eq!(
            outbox.bind_game_to_lobby("one", "123", 1000)?,
            LobbyBinding::Bound("party-one".to_owned())
        );
        outbox.remember_end_of_game("two", "123", b"second")?;
        let reopened = ObservationOutbox::open(&path)?;
        assert_eq!(
            reopened.pending_end_of_game("one", "123")?,
            Some(b"first".to_vec())
        );
        assert_eq!(
            reopened.pending_end_of_game("two", "123")?,
            Some(b"second".to_vec())
        );
        std::fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn unqualified_legacy_fragments_survive_without_becoming_owned_evidence()
    -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!(
            "scout-context-migration-{}.sqlite",
            uuid::Uuid::new_v4()
        ));
        let connection = Connection::open(&path)?;
        connection.execute_batch("CREATE TABLE pending_end_of_game (game_id TEXT PRIMARY KEY, body BLOB NOT NULL); INSERT INTO pending_end_of_game VALUES ('123', X'7B7D');")?;
        let outbox = ObservationOutbox::open(&path)?;
        assert_eq!(outbox.pending_end_of_game("one", "123")?, None);
        assert_eq!(
            connection.query_row(
                "SELECT body FROM pending_end_of_game_unqualified_v1 WHERE game_id = '123'",
                [],
                |row| row.get::<_, Vec<u8>>(0)
            )?,
            b"{}".to_vec()
        );
        let reopened = ObservationOutbox::open(&path)?;
        assert_eq!(reopened.pending_end_of_game("one", "123")?, None);
        std::fs::remove_file(path)?;
        Ok(())
    }
}
