//! Durable SQLite outbox for at-least-once observation delivery.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use thiserror::Error;
use uuid::Uuid;

use crate::protocol::{
    LOBBY_ID_MAX_BYTES, MAX_OBSERVATION_BYTES, ObservationEnvelope, ProtocolError,
};

/// How long a remembered lobby stays eligible to claim a starting game.
///
/// The lobby endpoint answers right up to champion select and disappears as the
/// game begins, so the real gap between the last lobby read and the first
/// `InProgress` read is a tick or two. This bound exists only to stop an
/// abandoned lobby from claiming an unrelated game hours later: a stale key is
/// worse than no key, because it would silently attach one game's roster to
/// another.
const LOBBY_BINDING_WINDOW_MILLIS: i64 = 15 * 60 * 1000;

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

/// Durable local timing evidence for a game observed from start through EOG.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingGameTiming {
    /// Playable-game start derived from the live client clock.
    pub started_at_millis: i64,
    /// First local observation of the end-of-game transition.
    pub ended_at_millis: i64,
}

/// The one recorded outcome of a game's lobby join.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LobbyBinding {
    /// This call recorded the join, to the named lobby.
    Bound(String),
    /// This call recorded that no lobby was witnessed for the game. The client
    /// was not watching when the lobby existed — it started mid-game, or the
    /// game was joined from outside a lobby this device saw.
    Unwitnessed,
    /// An earlier call already recorded this game's outcome.
    AlreadyRecorded,
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
        connection.execute_batch(SCHEMA)?;
        // Columns first: the partial index below is over `coalesce_key`, which
        // an outbox created by an older build does not have yet.
        add_missing_columns(&connection)?;
        connection.execute_batch(COALESCE_KEY_INDEX)?;
        Ok(outbox)
    }

    fn connection(&self) -> Result<Connection, OutboxError> {
        Connection::open(&self.path).map_err(OutboxError::Sqlite)
    }
}

/// Tables the outbox creates on open.
///
/// Every statement is idempotent, so this runs the same way against a new file
/// and against one an earlier build left behind.
const SCHEMA: &str = "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             CREATE TABLE IF NOT EXISTS observation_outbox (
               observation_id TEXT PRIMARY KEY,
               sequence INTEGER NOT NULL UNIQUE,
               body BLOB NOT NULL,
               coalesce_key TEXT,
               attempt_count INTEGER NOT NULL DEFAULT 0,
               created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE IF NOT EXISTS outbox_metadata (
               singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
               next_sequence INTEGER NOT NULL,
               sequence_synchronized INTEGER NOT NULL DEFAULT 0
                 CHECK (sequence_synchronized IN (0, 1))
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
             );
             CREATE TABLE IF NOT EXISTS deferred_replay (
               digest TEXT PRIMARY KEY,
               game_id TEXT NOT NULL,
               attempts INTEGER NOT NULL DEFAULT 0,
               first_deferred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
               last_deferred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE IF NOT EXISTS handled_replay_file (
               path TEXT PRIMARY KEY,
               bytes INTEGER NOT NULL,
               modified_at_millis INTEGER NOT NULL,
               digest TEXT NOT NULL,
               handled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE IF NOT EXISTS pending_end_of_game (
               game_id TEXT PRIMARY KEY,
               body BLOB NOT NULL,
               captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE IF NOT EXISTS pending_game_timing (
               game_id TEXT PRIMARY KEY,
               started_at_millis INTEGER,
               ended_at_millis INTEGER,
               updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );
             CREATE TABLE IF NOT EXISTS observed_lobby (
               singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
               lobby_id TEXT NOT NULL,
               observed_at_millis INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS game_lobby_binding (
               game_id TEXT PRIMARY KEY,
               lobby_id TEXT,
               bound_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
             );";

/// Enforces one pending row per coalescing key, ignoring uncoalesced rows.
const COALESCE_KEY_INDEX: &str = "CREATE UNIQUE INDEX IF NOT EXISTS
             observation_outbox_coalesce_key
             ON observation_outbox(coalesce_key) WHERE coalesce_key IS NOT NULL;";

fn has_column(connection: &Connection, table: &str, column: &str) -> Result<bool, OutboxError> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let mut columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    columns.try_fold(false, |found, name| Ok(found || name? == column))
}

/// Add columns to tables an earlier build created without them.
///
/// `CREATE TABLE IF NOT EXISTS` leaves an existing table alone, so a column
/// added to [`SCHEMA`] after a release has to be backfilled here.
fn add_missing_columns(connection: &Connection) -> Result<(), OutboxError> {
    if !has_column(connection, "observation_outbox", "coalesce_key")? {
        connection.execute(
            "ALTER TABLE observation_outbox ADD COLUMN coalesce_key TEXT",
            [],
        )?;
    }
    if !has_column(connection, "outbox_metadata", "sequence_synchronized")? {
        connection.execute(
            "ALTER TABLE outbox_metadata ADD COLUMN sequence_synchronized INTEGER NOT NULL DEFAULT 0
             CHECK (sequence_synchronized IN (0, 1))",
            [],
        )?;
        // Older runtimes allocated observations only after a successful
        // check-in. A legacy metadata row therefore proves that this
        // device already learned its backend sequence floor.
        connection.execute("UPDATE outbox_metadata SET sequence_synchronized = 1", [])?;
    }
    Ok(())
}

impl ObservationOutbox {
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

    /// Whether this outbox has learned the paired device's backend sequence floor.
    ///
    /// A freshly recreated database must not collect while check-in is
    /// unavailable: allocating from one would collide with observations the
    /// backend retained before the local file disappeared.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if metadata cannot be read.
    pub fn sequence_is_synchronized(&self) -> Result<bool, OutboxError> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT sequence_synchronized FROM outbox_metadata WHERE singleton = 1",
                [],
                |row| row.get::<_, bool>(0),
            )
            .optional()
            .map(|value| value.unwrap_or(false))
            .map_err(OutboxError::Sqlite)
    }

    /// Raise the local allocator to a backend-confirmed sequence floor.
    ///
    /// Existing pending observations keep their immutable sequence and body;
    /// only newly created observations use the synchronized floor.
    ///
    /// # Errors
    ///
    /// Returns a typed SQLite or numeric-range error.
    pub fn ensure_next_sequence_at_least(&self, floor: u64) -> Result<(), OutboxError> {
        let floor = i64::try_from(floor).map_err(|_| OutboxError::SequenceRange)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let maximum: Option<i64> =
            transaction.query_row("SELECT MAX(sequence) FROM observation_outbox", [], |row| {
                row.get(0)
            })?;
        let local_floor = maximum.map_or(Ok(1_i64), |sequence| {
            sequence.checked_add(1).ok_or(OutboxError::SequenceRange)
        })?;
        let synchronized_floor = floor.max(local_floor);
        transaction.execute(
            "INSERT OR IGNORE INTO outbox_metadata
               (singleton, next_sequence, sequence_synchronized)
             VALUES (1, ?1, 1)",
            [synchronized_floor],
        )?;
        transaction.execute(
            "UPDATE outbox_metadata
             SET next_sequence = MAX(next_sequence, ?1),
                 sequence_synchronized = 1
             WHERE singleton = 1",
            [synchronized_floor],
        )?;
        transaction.commit()?;
        Ok(())
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

    /// Replace an older unsent sample for the same bounded resource.
    ///
    /// # Errors
    ///
    /// Returns a validation, serialization, SQLite, or numeric-range error.
    pub fn enqueue_coalesced(
        &self,
        coalesce_key: &str,
        observation: &ObservationEnvelope,
    ) -> Result<(), OutboxError> {
        if coalesce_key.is_empty() || coalesce_key.len() > 128 {
            return Err(OutboxError::InvalidCoalesceKey);
        }
        observation.validate()?;
        let body = observation.to_bytes()?;
        let sequence =
            i64::try_from(observation.sequence).map_err(|_| OutboxError::SequenceRange)?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        transaction.execute(
            "DELETE FROM observation_outbox WHERE coalesce_key = ?1",
            [coalesce_key],
        )?;
        transaction.execute(
            "INSERT INTO observation_outbox
               (observation_id, sequence, body, coalesce_key)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(observation_id) DO NOTHING",
            params![
                observation.observation_id.to_string(),
                sequence,
                body,
                coalesce_key
            ],
        )?;
        transaction.commit()?;
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

    /// Retain transient end-game evidence until match history can complete it.
    ///
    /// # Errors
    ///
    /// Returns a typed validation or SQLite error.
    pub fn remember_end_of_game(&self, game_id: &str, body: &[u8]) -> Result<(), OutboxError> {
        if game_id.is_empty() || game_id.len() > 32 {
            return Err(OutboxError::InvalidGameId);
        }
        if body.len() > MAX_OBSERVATION_BYTES {
            return Err(OutboxError::FragmentTooLarge(body.len()));
        }
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO pending_end_of_game (game_id, body) VALUES (?1, ?2)
             ON CONFLICT(game_id) DO UPDATE SET
               body = excluded.body,
               captured_at = CURRENT_TIMESTAMP",
            params![game_id, body],
        )?;
        Ok(())
    }

    /// Read retained end-game evidence for one Riot game id.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if local state cannot be read.
    pub fn pending_end_of_game(&self, game_id: &str) -> Result<Option<Vec<u8>>, OutboxError> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT body FROM pending_end_of_game WHERE game_id = ?1",
                [game_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(OutboxError::Sqlite)
    }

    /// Remove an end-game fragment after its complete bundle is durable.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if local state cannot be changed.
    pub fn forget_end_of_game(&self, game_id: &str) -> Result<(), OutboxError> {
        let connection = self.connection()?;
        connection.execute(
            "DELETE FROM pending_end_of_game WHERE game_id = ?1",
            [game_id],
        )?;
        Ok(())
    }

    /// Retain the latest live-clock estimate until EOG freezes the timing pair.
    ///
    /// # Errors
    ///
    /// Returns a typed validation or SQLite error.
    pub fn remember_game_start(
        &self,
        game_id: &str,
        started_at_millis: i64,
    ) -> Result<(), OutboxError> {
        validate_game_timing(game_id, started_at_millis)?;
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO pending_game_timing (game_id, started_at_millis)
             VALUES (?1, ?2)
             ON CONFLICT(game_id) DO UPDATE SET
               started_at_millis = CASE
                 WHEN pending_game_timing.started_at_millis IS NULL
                   THEN excluded.started_at_millis
                 WHEN pending_game_timing.ended_at_millis IS NULL
                   THEN excluded.started_at_millis
                 ELSE pending_game_timing.started_at_millis
               END,
               updated_at = CURRENT_TIMESTAMP",
            params![game_id, started_at_millis],
        )?;
        Ok(())
    }

    /// Retain the earliest observation of a game's end-of-game transition.
    ///
    /// # Errors
    ///
    /// Returns a typed validation or SQLite error.
    pub fn remember_game_end(
        &self,
        game_id: &str,
        ended_at_millis: i64,
    ) -> Result<(), OutboxError> {
        validate_game_timing(game_id, ended_at_millis)?;
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO pending_game_timing (game_id, ended_at_millis)
             VALUES (?1, ?2)
             ON CONFLICT(game_id) DO UPDATE SET
               ended_at_millis = CASE
                 WHEN pending_game_timing.ended_at_millis IS NULL
                   THEN excluded.ended_at_millis
                 ELSE MIN(pending_game_timing.ended_at_millis, excluded.ended_at_millis)
               END,
               updated_at = CURRENT_TIMESTAMP",
            params![game_id, ended_at_millis],
        )?;
        Ok(())
    }

    /// Read timing only after both the playable start and EOG were observed.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if local state cannot be read.
    pub fn pending_game_timing(
        &self,
        game_id: &str,
    ) -> Result<Option<PendingGameTiming>, OutboxError> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT started_at_millis, ended_at_millis
                 FROM pending_game_timing
                 WHERE game_id = ?1
                   AND started_at_millis IS NOT NULL
                   AND ended_at_millis IS NOT NULL",
                [game_id],
                |row| {
                    Ok(PendingGameTiming {
                        started_at_millis: row.get(0)?,
                        ended_at_millis: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(OutboxError::Sqlite)
    }

    /// Retain the lobby the local player is in, so a later game can claim it.
    ///
    /// Only the most recent lobby is kept: a player is in one lobby at a time,
    /// and an older one can no longer be the lobby a game starts from.
    ///
    /// # Errors
    ///
    /// Returns a typed validation or SQLite error.
    pub fn remember_observed_lobby(
        &self,
        lobby_id: &str,
        observed_at_millis: i64,
    ) -> Result<(), OutboxError> {
        validate_lobby_identity(lobby_id, observed_at_millis)?;
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO observed_lobby (singleton, lobby_id, observed_at_millis)
             VALUES (1, ?1, ?2)
             ON CONFLICT(singleton) DO UPDATE SET
               lobby_id = excluded.lobby_id,
               observed_at_millis = MAX(
                 observed_lobby.observed_at_millis,
                 excluded.observed_at_millis
               )",
            params![lobby_id, observed_at_millis],
        )?;
        Ok(())
    }

    /// Tie a starting game to the lobby that assembled it, at most once.
    ///
    /// LCU exposes `partyId` on the lobby and `gameId` only once the game is in
    /// progress, and nothing links the two: the in-progress session carries no
    /// lobby identity at all. The client is the only party that sees both, so
    /// it records the join here and stamps it onto later observations.
    ///
    /// Exactly one outcome is recorded per game, and the first one wins. A
    /// game's roster cannot change identity partway through, so a later tick
    /// must not be able to move it — and since `InProgress` is read on every
    /// tick for the length of a match, a caller that reacted to the outcome
    /// repeatedly would bury its own log.
    ///
    /// # Errors
    ///
    /// Returns a typed validation or SQLite error.
    pub fn bind_game_to_lobby(
        &self,
        game_id: &str,
        observed_at_millis: i64,
    ) -> Result<LobbyBinding, OutboxError> {
        validate_game_timing(game_id, observed_at_millis)?;
        let connection = self.connection()?;
        let already = connection
            .query_row(
                "SELECT 1 FROM game_lobby_binding WHERE game_id = ?1",
                [game_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if already {
            return Ok(LobbyBinding::AlreadyRecorded);
        }
        let lobby_id = connection
            .query_row(
                "SELECT lobby_id FROM observed_lobby
                 WHERE singleton = 1
                   AND observed_at_millis >= ?1
                   AND observed_at_millis <= ?2",
                params![
                    observed_at_millis.saturating_sub(LOBBY_BINDING_WINDOW_MILLIS),
                    observed_at_millis
                ],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        connection.execute(
            "INSERT INTO game_lobby_binding (game_id, lobby_id)
             VALUES (?1, ?2)
             ON CONFLICT(game_id) DO NOTHING",
            params![game_id, lobby_id],
        )?;
        Ok(match lobby_id {
            Some(lobby_id) => LobbyBinding::Bound(lobby_id),
            None => LobbyBinding::Unwitnessed,
        })
    }

    /// The lobby this game was started from, when the client witnessed both.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if local state cannot be read.
    pub fn lobby_for_game(&self, game_id: &str) -> Result<Option<String>, OutboxError> {
        let connection = self.connection()?;
        connection
            .query_row(
                "SELECT lobby_id FROM game_lobby_binding
                 WHERE game_id = ?1 AND lobby_id IS NOT NULL",
                [game_id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(OutboxError::Sqlite)
    }

    /// Remove timing evidence after its complete post-game bundle is durable.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if local state cannot be changed.
    pub fn forget_game_timing(&self, game_id: &str) -> Result<(), OutboxError> {
        let connection = self.connection()?;
        connection.execute(
            "DELETE FROM pending_game_timing WHERE game_id = ?1",
            [game_id],
        )?;
        Ok(())
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

    /// Return whether this unchanged file already has a durable terminal receipt.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if local file identity state cannot be read.
    pub fn replay_file_handled(
        &self,
        path: &str,
        bytes: i64,
        modified_at_millis: i64,
    ) -> Result<bool, OutboxError> {
        let connection = self.connection()?;
        let count: i64 = connection.query_row(
            "SELECT COUNT(*) FROM handled_replay_file
             WHERE path = ?1 AND bytes = ?2 AND modified_at_millis = ?3",
            params![path, bytes, modified_at_millis],
            |row| row.get(0),
        )?;
        Ok(count == 1)
    }

    /// Associate an unchanged local replay with its durable terminal receipt.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if local file identity state cannot be written.
    pub fn mark_replay_file_handled(
        &self,
        path: &str,
        bytes: i64,
        modified_at_millis: i64,
        digest: &str,
    ) -> Result<(), OutboxError> {
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO handled_replay_file (path, bytes, modified_at_millis, digest)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(path) DO UPDATE SET
               bytes = excluded.bytes,
               modified_at_millis = excluded.modified_at_millis,
               digest = excluded.digest,
               handled_at = CURRENT_TIMESTAMP",
            params![path, bytes, modified_at_millis, digest],
        )?;
        Ok(())
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

    /// Count one deferral of a replay and return how many it has now had.
    ///
    /// A deferral is the backend saying "not yet", so the file stays unhandled
    /// and is offered again next scan. Without a tally that loop is invisible:
    /// a replay the backend will never accept looks exactly like one that is
    /// about to succeed.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if the tally cannot be persisted.
    pub fn record_replay_deferral(&self, digest: &str, game_id: &str) -> Result<i64, OutboxError> {
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO deferred_replay (digest, game_id, attempts)
             VALUES (?1, ?2, 1)
             ON CONFLICT(digest) DO UPDATE SET
               attempts = attempts + 1,
               last_deferred_at = CURRENT_TIMESTAMP",
            params![digest, game_id],
        )?;
        let attempts = connection.query_row(
            "SELECT attempts FROM deferred_replay WHERE digest = ?1",
            [digest],
            |row| row.get(0),
        )?;
        Ok(attempts)
    }

    /// How many times this replay has been deferred so far.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if the tally cannot be read.
    pub fn replay_deferrals(&self, digest: &str) -> Result<i64, OutboxError> {
        let connection = self.connection()?;
        let attempts = connection.query_row(
            "SELECT COALESCE((SELECT attempts FROM deferred_replay WHERE digest = ?1), 0)",
            [digest],
            |row| row.get(0),
        )?;
        Ok(attempts)
    }

    /// Every replay this device has reached a conclusion about.
    ///
    /// The server cannot see a machine's disk, so without this it has no idea a
    /// replay exists until the device happens to offer it. Reporting the
    /// inventory lets it come back for one later, once a match it could not
    /// vouch for earlier becomes known.
    ///
    /// # Errors
    ///
    /// Returns [`OutboxError::Sqlite`] if the inventory cannot be read.
    pub fn replay_inventory(&self, limit: u32) -> Result<Vec<ReplayInventoryRow>, OutboxError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT digest, game_id, 'uploaded' AS state FROM uploaded_replay
             UNION ALL
             SELECT digest, game_id, 'rejected' AS state FROM rejected_replay
             UNION ALL
             SELECT digest, game_id, 'deferred' AS state FROM deferred_replay
             WHERE digest NOT IN (SELECT digest FROM uploaded_replay)
               AND digest NOT IN (SELECT digest FROM rejected_replay)
             LIMIT ?1",
        )?;
        let rows = statement.query_map([limit], |row| {
            Ok(ReplayInventoryRow {
                digest: row.get(0)?,
                game_id: row.get(1)?,
                state: row.get(2)?,
            })
        })?;
        let mut inventory = Vec::new();
        for row in rows {
            inventory.push(row?);
        }
        Ok(inventory)
    }
}

/// One replay this device holds, and what became of it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplayInventoryRow {
    /// Content address of the file.
    pub digest: String,
    /// Game the replay claims to be.
    pub game_id: String,
    /// `uploaded`, `rejected`, or `deferred`.
    pub state: String,
}

fn validate_lobby_identity(lobby_id: &str, observed_at_millis: i64) -> Result<(), OutboxError> {
    if lobby_id.is_empty() || lobby_id.len() > LOBBY_ID_MAX_BYTES {
        return Err(OutboxError::InvalidLobbyId);
    }
    if observed_at_millis <= 0 {
        return Err(OutboxError::InvalidGameTimestamp);
    }
    Ok(())
}

fn validate_game_timing(game_id: &str, timestamp_millis: i64) -> Result<(), OutboxError> {
    if game_id.is_empty() || game_id.len() > 32 {
        return Err(OutboxError::InvalidGameId);
    }
    if timestamp_millis <= 0 {
        return Err(OutboxError::InvalidGameTimestamp);
    }
    Ok(())
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
    /// A coalescing key must be short and non-empty.
    #[error("outbox coalescing key is invalid")]
    InvalidCoalesceKey,
    /// A retained end-game fragment must have a bounded game id.
    #[error("end-game fragment has an invalid game id")]
    InvalidGameId,
    /// Local game timing must contain a positive Unix timestamp.
    #[error("local game timing contains an invalid timestamp")]
    InvalidGameTimestamp,
    /// A remembered lobby must have an identity within the protocol bound.
    #[error("observed lobby has an invalid identity")]
    InvalidLobbyId,
    /// A retained end-game fragment exceeded the observation wire bound.
    #[error("end-game fragment contains {0} bytes, exceeding the wire limit")]
    FragmentTooLarge(usize),
}

#[cfg(test)]
mod tests {
    use std::fs;

    use rusqlite::Connection;
    use serde_json::json;
    use uuid::Uuid;

    use crate::protocol::{ObservationEnvelope, ObservationKind};

    use super::{LOBBY_BINDING_WINDOW_MILLIS, LobbyBinding, ObservationOutbox, PendingGameTiming};

    fn temporary_database() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("scout-outbox-{}.db", Uuid::new_v4()))
    }

    /// A fixed, positive clock. The binding window is relative, so these tests
    /// only need two instants a known distance apart.
    const NOW: i64 = 1_700_000_000_000;

    #[test]
    fn a_game_claims_the_lobby_that_assembled_it() -> Result<(), Box<dyn std::error::Error>> {
        let path = temporary_database();
        let outbox = ObservationOutbox::open(&path)?;
        outbox.remember_observed_lobby("party-1", NOW)?;

        assert_eq!(
            outbox.bind_game_to_lobby("game-1", NOW + 90_000)?,
            LobbyBinding::Bound("party-1".to_owned()),
        );
        assert_eq!(
            outbox.lobby_for_game("game-1")?,
            Some("party-1".to_owned()),
            "the join has to survive for the observations that follow it",
        );

        let _ = fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn a_games_lobby_is_recorded_once_and_cannot_be_moved() -> Result<(), Box<dyn std::error::Error>>
    {
        let path = temporary_database();
        let outbox = ObservationOutbox::open(&path)?;
        outbox.remember_observed_lobby("party-1", NOW)?;
        outbox.bind_game_to_lobby("game-1", NOW)?;

        // A new lobby appearing mid-match must not retarget a started game.
        outbox.remember_observed_lobby("party-2", NOW + 60_000)?;
        assert_eq!(
            outbox.bind_game_to_lobby("game-1", NOW + 60_000)?,
            LobbyBinding::AlreadyRecorded,
        );
        assert_eq!(outbox.lobby_for_game("game-1")?, Some("party-1".to_owned()));

        let _ = fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn a_game_no_lobby_was_seen_for_records_that_it_has_none()
    -> Result<(), Box<dyn std::error::Error>> {
        let path = temporary_database();
        let outbox = ObservationOutbox::open(&path)?;

        assert_eq!(
            outbox.bind_game_to_lobby("game-1", NOW)?,
            LobbyBinding::Unwitnessed,
            "a client started mid-game never saw the lobby",
        );
        assert_eq!(outbox.lobby_for_game("game-1")?, None);
        assert_eq!(
            outbox.bind_game_to_lobby("game-1", NOW + 3_000)?,
            LobbyBinding::AlreadyRecorded,
            "the absence is recorded too, so the caller reports it once",
        );

        let _ = fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn an_abandoned_lobby_cannot_claim_a_much_later_game() -> Result<(), Box<dyn std::error::Error>>
    {
        let path = temporary_database();
        let outbox = ObservationOutbox::open(&path)?;
        outbox.remember_observed_lobby("party-1", NOW)?;

        assert_eq!(
            outbox.bind_game_to_lobby("game-1", NOW + LOBBY_BINDING_WINDOW_MILLIS + 1)?,
            LobbyBinding::Unwitnessed,
            "a stale key would attach one game's roster to another",
        );

        let _ = fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn only_the_current_lobby_is_remembered() -> Result<(), Box<dyn std::error::Error>> {
        let path = temporary_database();
        let outbox = ObservationOutbox::open(&path)?;
        outbox.remember_observed_lobby("party-1", NOW)?;
        outbox.remember_observed_lobby("party-2", NOW + 60_000)?;

        assert_eq!(
            outbox.bind_game_to_lobby("game-1", NOW + 120_000)?,
            LobbyBinding::Bound("party-2".to_owned()),
            "a player is in one lobby at a time, and it is the latest one",
        );

        let _ = fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn a_lobby_identity_outside_the_protocol_bound_is_refused()
    -> Result<(), Box<dyn std::error::Error>> {
        let path = temporary_database();
        let outbox = ObservationOutbox::open(&path)?;

        assert!(outbox.remember_observed_lobby("", NOW).is_err());
        assert!(
            outbox
                .remember_observed_lobby(&"p".repeat(129), NOW)
                .is_err(),
            "the envelope would reject it later; fail at the boundary instead",
        );

        let _ = fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn the_inventory_reports_one_state_per_replay() -> Result<(), Box<dyn std::error::Error>> {
        let path = temporary_database();
        let outbox = ObservationOutbox::open(&path)?;
        outbox.mark_replay_uploaded("digest-up", "game-1")?;
        outbox.mark_replay_rejected("digest-no", "game-2", 413)?;
        outbox.record_replay_deferral("digest-wait", "game-3")?;

        let inventory = outbox.replay_inventory(100)?;
        let state = |digest: &str| {
            inventory
                .iter()
                .find(|row| row.digest == digest)
                .map(|row| row.state.clone())
        };
        assert_eq!(state("digest-up"), Some("uploaded".to_owned()));
        assert_eq!(state("digest-no"), Some("rejected".to_owned()));
        assert_eq!(state("digest-wait"), Some("deferred".to_owned()));
        assert_eq!(inventory.len(), 3);

        let _ = std::fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn a_settled_replay_is_not_also_reported_as_waiting() -> Result<(), Box<dyn std::error::Error>>
    {
        // A replay is deferred before it is finally accepted, so both rows
        // exist. Reporting it twice would tell the server two different things
        // about one file.
        let path = temporary_database();
        let outbox = ObservationOutbox::open(&path)?;
        outbox.record_replay_deferral("digest-a", "game-1")?;
        outbox.mark_replay_uploaded("digest-a", "game-1")?;

        let inventory = outbox.replay_inventory(100)?;
        assert_eq!(inventory.len(), 1);
        assert_eq!(inventory[0].state, "uploaded");

        let _ = std::fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn deferrals_accumulate_per_replay() -> Result<(), Box<dyn std::error::Error>> {
        let path = temporary_database();
        let outbox = ObservationOutbox::open(&path)?;

        assert_eq!(outbox.replay_deferrals("digest-a")?, 0);
        assert_eq!(outbox.record_replay_deferral("digest-a", "game-1")?, 1);
        assert_eq!(outbox.record_replay_deferral("digest-a", "game-1")?, 2);
        assert_eq!(outbox.record_replay_deferral("digest-a", "game-1")?, 3);
        assert_eq!(outbox.replay_deferrals("digest-a")?, 3);

        // A second replay keeps its own tally.
        assert_eq!(outbox.record_replay_deferral("digest-b", "game-2")?, 1);
        assert_eq!(outbox.replay_deferrals("digest-a")?, 3);

        let _ = std::fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn a_deferred_replay_is_not_recorded_as_handled() -> Result<(), Box<dyn std::error::Error>> {
        // Deferral means "ask again later", so the durable receipts that would
        // stop a retry must stay empty.
        let path = temporary_database();
        let outbox = ObservationOutbox::open(&path)?;
        outbox.record_replay_deferral("digest-a", "game-1")?;
        assert!(!outbox.replay_handled("digest-a")?);
        let _ = std::fs::remove_file(&path);
        Ok(())
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
        assert!(!outbox.replay_file_handled("/replays/12345.rofl", 12, 34)?);
        outbox.mark_replay_file_handled("/replays/12345.rofl", 12, 34, "rejected-digest")?;
        assert!(outbox.replay_file_handled("/replays/12345.rofl", 12, 34)?);
        assert!(!outbox.replay_file_handled("/replays/12345.rofl", 13, 34)?);
        assert!(!outbox.replay_file_handled("/replays/12345.rofl", 12, 35)?);
        outbox.remember_end_of_game("12345", br#"{"gameId":12345}"#)?;
        outbox.remember_game_start("12345", 1_000)?;
        outbox.remember_game_start("12345", 1_250)?;
        outbox.remember_game_end("12345", 5_000)?;
        outbox.remember_game_start("12345", 1_500)?;
        drop(outbox);
        let outbox = ObservationOutbox::open(&path)?;
        assert_eq!(
            outbox.pending_end_of_game("12345")?,
            Some(br#"{"gameId":12345}"#.to_vec())
        );
        assert_eq!(
            outbox.pending_game_timing("12345")?,
            Some(PendingGameTiming {
                started_at_millis: 1_250,
                ended_at_millis: 5_000,
            })
        );
        outbox.forget_end_of_game("12345")?;
        outbox.forget_game_timing("12345")?;
        assert_eq!(outbox.pending_end_of_game("12345")?, None);
        assert_eq!(outbox.pending_game_timing("12345")?, None);
        drop(outbox);
        fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn synchronizes_a_recreated_outbox_with_the_backend_sequence()
    -> Result<(), Box<dyn std::error::Error>> {
        let path = temporary_database();
        let outbox = ObservationOutbox::open(&path)?;

        assert!(!outbox.sequence_is_synchronized()?);
        assert_eq!(outbox.next_sequence()?, 1);
        assert!(!outbox.sequence_is_synchronized()?);
        outbox.ensure_next_sequence_at_least(42)?;
        assert!(outbox.sequence_is_synchronized()?);
        assert_eq!(outbox.next_sequence()?, 42);
        outbox.ensure_next_sequence_at_least(10)?;
        assert_eq!(outbox.next_sequence()?, 43);

        drop(outbox);
        let outbox = ObservationOutbox::open(&path)?;
        assert!(outbox.sequence_is_synchronized()?);
        drop(outbox);
        fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn treats_legacy_allocator_metadata_as_already_synchronized()
    -> Result<(), Box<dyn std::error::Error>> {
        let path = temporary_database();
        let connection = Connection::open(&path)?;
        connection.execute_batch(
            "CREATE TABLE outbox_metadata (
               singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
               next_sequence INTEGER NOT NULL
             );
             INSERT INTO outbox_metadata (singleton, next_sequence) VALUES (1, 42);",
        )?;
        drop(connection);

        let outbox = ObservationOutbox::open(&path)?;
        assert!(outbox.sequence_is_synchronized()?);
        assert_eq!(outbox.next_sequence()?, 42);

        drop(outbox);
        fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn coalesces_unsent_resource_snapshots_without_dropping_other_observations()
    -> Result<(), Box<dyn std::error::Error>> {
        let path = temporary_database();
        let outbox = ObservationOutbox::open(&path)?;
        let first_frame = ObservationEnvelope::new(
            1,
            ObservationKind::LiveGameFrame,
            "test",
            json!({ "gameTime": 10 }),
        )?;
        let phase = ObservationEnvelope::new(
            2,
            ObservationKind::Gameflow,
            "test",
            json!({ "phase": "InProgress" }),
        )?;
        let latest_frame = ObservationEnvelope::new(
            3,
            ObservationKind::LiveGameFrame,
            "test",
            json!({ "gameTime": 12 }),
        )?;
        let first_lobby_refresh = ObservationEnvelope::new(
            4,
            ObservationKind::Lobby,
            "test",
            json!({ "lobbyId": "lobby-1" }),
        )?;
        let latest_lobby_refresh = ObservationEnvelope::new(
            5,
            ObservationKind::Lobby,
            "test",
            json!({ "lobbyId": "lobby-1" }),
        )?;

        outbox.enqueue_coalesced("live_game_frame", &first_frame)?;
        outbox.enqueue(&phase)?;
        outbox.enqueue_coalesced("live_game_frame", &latest_frame)?;
        outbox.enqueue_coalesced("lobby_refresh", &first_lobby_refresh)?;
        outbox.enqueue_coalesced("lobby_refresh", &latest_lobby_refresh)?;

        let pending = outbox.pending(100)?;
        assert_eq!(pending.len(), 3);
        assert_eq!(pending[0].observation_id, phase.observation_id);
        assert_eq!(pending[1].observation_id, latest_frame.observation_id);
        assert_eq!(
            pending[2].observation_id,
            latest_lobby_refresh.observation_id
        );
        drop(outbox);
        fs::remove_file(path)?;
        Ok(())
    }
}
