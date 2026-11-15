//! Local recordings of live games, in `recordings.sqlite3`.
//!
//! A recording is a series of allowlisted [`LiveSnapshot`]s: one at the start,
//! one every [`SAMPLE_INTERVAL`], and one whenever the game logs a new event.
//! It stays on this device. Uploading needs a server observation kind that
//! does not exist yet, so [`RecordingHandoff`] is the typed place where a
//! finished recording would be offered, and [`LocalOnly`] is the only
//! implementation.
//!
//! Limits, all enforced here:
//!
//! - a game never holds more than [`MAX_GAME_BYTES`] of samples: when the next
//!   sample would not fit, every second interval sample is thinned away
//!   (event samples last), and a sample that still cannot fit is dropped;
//! - at most [`MAX_GAMES`] games are kept, and none older than [`MAX_AGE_DAYS`]:
//!   whichever rule keeps fewer games wins.

use std::path::Path;
use std::time::Duration;

use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use thiserror::Error;

use super::snapshot::LiveSnapshot;

/// The recordings database's file name inside the data directory.
pub const RECORDINGS_FILE: &str = "recordings.sqlite3";
/// Minimum time between interval samples. The runtime polls every two
/// seconds, so a sample lands on the first poll at or after this age.
pub const SAMPLE_INTERVAL: Duration = Duration::from_secs(5);
/// The most sample payload bytes one game may hold.
pub const MAX_GAME_BYTES: u64 = 1_000_000;
/// The most games kept.
pub const MAX_GAMES: u32 = 20;
/// The oldest a kept game may be.
pub const MAX_AGE_DAYS: i64 = 30;

const SCHEMA: &str = "PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at_ms INTEGER NOT NULL,
      ended_at_ms INTEGER,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      game_time_secs INTEGER NOT NULL,
      trigger TEXT NOT NULL,
      recorded_at_ms INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS samples_by_game ON samples (game_id, id);";

/// A recording failure.
#[derive(Debug, Error)]
pub enum RecordingError {
    /// SQLite failed.
    #[error("the local recordings database failed: {0}")]
    Sqlite(#[from] rusqlite::Error),
    /// A snapshot would not encode or a stored one would not decode.
    #[error("a recorded snapshot could not be encoded or decoded: {0}")]
    Json(#[from] serde_json::Error),
    /// The database holds a value this build does not write.
    #[error("the local recordings database holds an unexpected value: {0}")]
    Corrupt(String),
}

/// A recorded game's identifier.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecordingId(i64);

/// Why a sample was taken.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SampleTrigger {
    /// The first sample, or the five-second cadence.
    Interval,
    /// The game logged a new event.
    Event,
}

impl SampleTrigger {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Interval => "interval",
            Self::Event => "event",
        }
    }

    fn parse(value: &str) -> Result<Self, RecordingError> {
        match value {
            "interval" => Ok(Self::Interval),
            "event" => Ok(Self::Event),
            other => Err(RecordingError::Corrupt(format!("sample trigger {other}"))),
        }
    }
}

/// How a recorded game ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GameStatus {
    /// Still being recorded.
    Recording,
    /// Ended normally.
    Finished,
    /// Scout stopped while the game was being recorded.
    Interrupted,
}

impl GameStatus {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Recording => "recording",
            Self::Finished => "finished",
            Self::Interrupted => "interrupted",
        }
    }

    fn parse(value: &str) -> Result<Self, RecordingError> {
        match value {
            "recording" => Ok(Self::Recording),
            "finished" => Ok(Self::Finished),
            "interrupted" => Ok(Self::Interrupted),
            other => Err(RecordingError::Corrupt(format!("game status {other}"))),
        }
    }
}

/// A recorded game's summary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordedGame {
    /// Its identifier.
    pub id: RecordingId,
    /// When recording began.
    pub started_at: DateTime<Utc>,
    /// When recording ended.
    pub ended_at: Option<DateTime<Utc>>,
    /// How it ended.
    pub status: GameStatus,
    /// How many samples it holds.
    pub samples: u32,
    /// How many sample bytes it holds.
    pub bytes: u64,
}

/// One stored sample.
#[derive(Debug, Clone, PartialEq)]
pub struct RecordedSample {
    /// The game clock when it was taken, in whole seconds.
    pub game_time_secs: u32,
    /// Why it was taken.
    pub trigger: SampleTrigger,
    /// When it was taken.
    pub recorded_at: DateTime<Utc>,
    /// What it holds.
    pub snapshot: LiveSnapshot,
}

/// What happened to an offered sample.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppendOutcome {
    /// Stored as is.
    Stored,
    /// Stored after older interval samples were thinned to make room.
    StoredAfterThinning,
    /// Not stored: the game is at its size limit and nothing could be thinned.
    Dropped,
}

/// The recordings database.
pub struct RecordingStore {
    connection: Connection,
}

fn millis(time: DateTime<Utc>) -> i64 {
    time.timestamp_millis()
}

fn from_millis(value: i64) -> Result<DateTime<Utc>, RecordingError> {
    Utc.timestamp_millis_opt(value)
        .single()
        .ok_or_else(|| RecordingError::Corrupt(format!("timestamp {value}")))
}

impl RecordingStore {
    /// Open (creating if needed) the database at `path`. A game left in the
    /// `recording` state by a stopped Scout is marked interrupted.
    ///
    /// # Errors
    ///
    /// [`RecordingError`] when the database cannot be opened or migrated.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, RecordingError> {
        Self::from_connection(Connection::open(path)?)
    }

    /// A store that lives only as long as this value, for tests.
    ///
    /// # Errors
    ///
    /// [`RecordingError`] when SQLite cannot open a memory database.
    pub fn open_in_memory() -> Result<Self, RecordingError> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(connection: Connection) -> Result<Self, RecordingError> {
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch(SCHEMA)?;
        connection.pragma_update(None, "foreign_keys", true)?;
        connection.execute(
            "UPDATE games SET status = ?1 WHERE status = ?2",
            params![
                GameStatus::Interrupted.as_str(),
                GameStatus::Recording.as_str()
            ],
        )?;
        Ok(Self { connection })
    }

    /// Start recording a game and apply the retention limits.
    ///
    /// # Errors
    ///
    /// [`RecordingError`] on a database failure.
    pub fn begin_game(&mut self, now: DateTime<Utc>) -> Result<RecordingId, RecordingError> {
        self.connection.execute(
            "INSERT INTO games (started_at_ms, status) VALUES (?1, ?2)",
            params![millis(now), GameStatus::Recording.as_str()],
        )?;
        let id = RecordingId(self.connection.last_insert_rowid());
        self.prune(now)?;
        Ok(id)
    }

    /// Delete games beyond [`MAX_GAMES`] or older than [`MAX_AGE_DAYS`]. A game
    /// still being recorded is never deleted by age.
    ///
    /// # Errors
    ///
    /// [`RecordingError`] on a database failure.
    pub fn prune(&mut self, now: DateTime<Utc>) -> Result<(), RecordingError> {
        let oldest_kept = millis(now - chrono::Duration::days(MAX_AGE_DAYS));
        self.connection.execute(
            "DELETE FROM games
             WHERE id NOT IN (
                 SELECT id FROM games ORDER BY started_at_ms DESC, id DESC LIMIT ?1
               )
               OR (status != ?2 AND started_at_ms < ?3)",
            params![MAX_GAMES, GameStatus::Recording.as_str(), oldest_kept],
        )?;
        Ok(())
    }

    /// Offer a sample to a game, keeping the game under [`MAX_GAME_BYTES`].
    ///
    /// # Errors
    ///
    /// [`RecordingError`] on a database or encoding failure.
    pub fn append(
        &mut self,
        id: RecordingId,
        snapshot: &LiveSnapshot,
        trigger: SampleTrigger,
        now: DateTime<Utc>,
    ) -> Result<AppendOutcome, RecordingError> {
        let payload = serde_json::to_string(snapshot)?;
        let size = u64::try_from(payload.len()).unwrap_or(u64::MAX);
        let transaction = self.connection.transaction()?;
        let mut thinned = false;
        while game_bytes(&transaction, id)?.saturating_add(size) > MAX_GAME_BYTES {
            if !thin_once(&transaction, id)? {
                return Ok(AppendOutcome::Dropped);
            }
            thinned = true;
        }
        transaction.execute(
            "INSERT INTO samples (game_id, game_time_secs, trigger, recorded_at_ms, payload)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                id.0,
                snapshot.game.game_time_secs,
                trigger.as_str(),
                millis(now),
                payload
            ],
        )?;
        transaction.commit()?;
        Ok(if thinned {
            AppendOutcome::StoredAfterThinning
        } else {
            AppendOutcome::Stored
        })
    }

    /// Mark a game finished and return its summary.
    ///
    /// # Errors
    ///
    /// [`RecordingError`] on a database failure, or when the game is gone.
    pub fn finish_game(
        &mut self,
        id: RecordingId,
        now: DateTime<Utc>,
    ) -> Result<RecordedGame, RecordingError> {
        self.connection.execute(
            "UPDATE games SET status = ?1, ended_at_ms = ?2 WHERE id = ?3",
            params![GameStatus::Finished.as_str(), millis(now), id.0],
        )?;
        self.game(id)?
            .ok_or_else(|| RecordingError::Corrupt(format!("game {} vanished", id.0)))
    }

    /// One game's summary.
    ///
    /// # Errors
    ///
    /// [`RecordingError`] on a database failure.
    pub fn game(&self, id: RecordingId) -> Result<Option<RecordedGame>, RecordingError> {
        self.read_games(Some(id.0)).map(|mut games| games.pop())
    }

    /// Every kept game, newest first.
    ///
    /// # Errors
    ///
    /// [`RecordingError`] on a database failure.
    pub fn games(&self) -> Result<Vec<RecordedGame>, RecordingError> {
        self.read_games(None)
    }

    fn read_games(&self, only: Option<i64>) -> Result<Vec<RecordedGame>, RecordingError> {
        let mut statement = self.connection.prepare(
            "SELECT g.id, g.started_at_ms, g.ended_at_ms, g.status,
                    COUNT(s.id), COALESCE(SUM(LENGTH(s.payload)), 0)
             FROM games g LEFT JOIN samples s ON s.game_id = g.id
             WHERE ?1 IS NULL OR g.id = ?1
             GROUP BY g.id ORDER BY g.started_at_ms DESC, g.id DESC",
        )?;
        let rows = statement.query_map(params![only], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<i64>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?;
        rows.map(|row| {
            let (id, started, ended, status, samples, bytes) = row?;
            Ok(RecordedGame {
                id: RecordingId(id),
                started_at: from_millis(started)?,
                ended_at: ended.map(from_millis).transpose()?,
                status: GameStatus::parse(&status)?,
                samples: u32::try_from(samples).unwrap_or(u32::MAX),
                bytes: u64::try_from(bytes).unwrap_or(0),
            })
        })
        .collect()
    }

    /// A game's samples, oldest first.
    ///
    /// # Errors
    ///
    /// [`RecordingError`] on a database or decoding failure.
    pub fn samples(&self, id: RecordingId) -> Result<Vec<RecordedSample>, RecordingError> {
        let mut statement = self.connection.prepare(
            "SELECT game_time_secs, trigger, recorded_at_ms, payload
             FROM samples WHERE game_id = ?1 ORDER BY id",
        )?;
        let rows = statement.query_map(params![id.0], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        rows.map(|row| {
            let (game_time, trigger, recorded_at, payload) = row?;
            Ok(RecordedSample {
                game_time_secs: u32::try_from(game_time).unwrap_or(0),
                trigger: SampleTrigger::parse(&trigger)?,
                recorded_at: from_millis(recorded_at)?,
                snapshot: serde_json::from_str(&payload)?,
            })
        })
        .collect()
    }
}

fn game_bytes(transaction: &Transaction<'_>, id: RecordingId) -> Result<u64, RecordingError> {
    let bytes: i64 = transaction.query_row(
        "SELECT COALESCE(SUM(LENGTH(payload)), 0) FROM samples WHERE game_id = ?1",
        params![id.0],
        |row| row.get(0),
    )?;
    Ok(u64::try_from(bytes).unwrap_or(0))
}

/// Make room in a game: drop every second interval sample (never the first
/// sample of the game), or else the oldest event sample. `false` when nothing
/// can be removed.
fn thin_once(transaction: &Transaction<'_>, id: RecordingId) -> Result<bool, RecordingError> {
    let first: Option<i64> = transaction
        .query_row(
            "SELECT MIN(id) FROM samples WHERE game_id = ?1",
            params![id.0],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    let Some(first) = first else {
        return Ok(false);
    };
    let ids_of = |trigger: SampleTrigger| -> Result<Vec<i64>, RecordingError> {
        let mut statement = transaction.prepare(
            "SELECT id FROM samples WHERE game_id = ?1 AND trigger = ?2 AND id != ?3 ORDER BY id",
        )?;
        let ids = statement
            .query_map(params![id.0, trigger.as_str(), first], |row| row.get(0))?
            .collect::<Result<Vec<i64>, _>>()?;
        Ok(ids)
    };
    let intervals = ids_of(SampleTrigger::Interval)?;
    let doomed: Vec<i64> = if intervals.len() >= 2 {
        intervals.into_iter().skip(1).step_by(2).collect()
    } else {
        ids_of(SampleTrigger::Event)?.into_iter().take(1).collect()
    };
    for sample in &doomed {
        transaction.execute("DELETE FROM samples WHERE id = ?1", params![sample])?;
    }
    Ok(!doomed.is_empty())
}

/// Where a finished recording would be offered for upload.
///
/// Uploading needs a server observation kind (`live_game_recording`) that does
/// not exist yet and must deploy first. Until then [`LocalOnly`] is the only
/// implementation, and a recording never leaves this device. The upload will
/// read the samples with [`RecordingStore::samples`] after the game reaches
/// `EndOfGame`.
pub trait RecordingHandoff {
    /// A game's recording just ended.
    fn finished(&self, recording: &RecordedGame);
}

/// Keeps every recording on this device.
#[derive(Debug, Clone, Copy, Default)]
pub struct LocalOnly;

impl RecordingHandoff for LocalOnly {
    fn finished(&self, _recording: &RecordedGame) {}
}

struct ActiveGame {
    id: RecordingId,
    last_sample_at: DateTime<Utc>,
    last_event_count: u32,
    last_game_time_secs: u32,
}

/// Decides when to take a sample and writes it.
pub struct LiveRecorder {
    store: RecordingStore,
    active: Option<ActiveGame>,
}

impl LiveRecorder {
    /// Record into `store`.
    #[must_use]
    pub fn new(store: RecordingStore) -> Self {
        Self {
            store,
            active: None,
        }
    }

    /// The underlying store, for reading recordings back.
    #[must_use]
    pub fn store(&self) -> &RecordingStore {
        &self.store
    }

    /// Offer the newest snapshot. A game starts on the first one, and a game
    /// clock that runs backwards means a new game began, which finishes the
    /// previous one and returns it.
    ///
    /// A sample is taken for the first snapshot, whenever the game logs a new
    /// event, and otherwise once [`SAMPLE_INTERVAL`] has passed.
    ///
    /// # Errors
    ///
    /// [`RecordingError`] on a database failure.
    pub fn observe(
        &mut self,
        snapshot: &LiveSnapshot,
        now: DateTime<Utc>,
    ) -> Result<Option<RecordedGame>, RecordingError> {
        let mut finished = None;
        if self
            .active
            .as_ref()
            .is_some_and(|game| snapshot.game.game_time_secs < game.last_game_time_secs)
        {
            finished = self.end_game(now)?;
        }
        let trigger = match &self.active {
            None => Some(SampleTrigger::Interval),
            Some(game) if snapshot.event_count > game.last_event_count => {
                Some(SampleTrigger::Event)
            }
            Some(game)
                if (now - game.last_sample_at)
                    .to_std()
                    .is_ok_and(|age| age >= SAMPLE_INTERVAL) =>
            {
                Some(SampleTrigger::Interval)
            }
            Some(_) => None,
        };
        let id = match &self.active {
            Some(game) => game.id,
            None => self.store.begin_game(now)?,
        };
        if let Some(trigger) = trigger {
            self.store.append(id, snapshot, trigger, now)?;
        }
        let previous = self.active.take();
        self.active = Some(ActiveGame {
            id,
            last_sample_at: if trigger.is_some() {
                now
            } else {
                previous.as_ref().map_or(now, |game| game.last_sample_at)
            },
            last_event_count: snapshot.event_count,
            last_game_time_secs: snapshot.game.game_time_secs,
        });
        Ok(finished)
    }

    /// The game ended (or live data stopped for good): finish its recording.
    /// `None` when no game was being recorded.
    ///
    /// # Errors
    ///
    /// [`RecordingError`] on a database failure.
    pub fn end_game(&mut self, now: DateTime<Utc>) -> Result<Option<RecordedGame>, RecordingError> {
        self.active
            .take()
            .map(|game| self.store.finish_game(game.id, now))
            .transpose()
    }
}

#[cfg(test)]
mod tests {
    use chrono::{DateTime, Duration, TimeZone, Utc};

    use super::{
        AppendOutcome, GameStatus, LiveRecorder, MAX_GAME_BYTES, MAX_GAMES, RecordingStore,
        SampleTrigger,
    };
    use crate::live::snapshot::{LiveSnapshot, tests::fixture_snapshot};

    fn start() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 14, 12, 0, 0)
            .single()
            .unwrap_or_default()
    }

    fn at(snapshot: &LiveSnapshot, secs: u32, events: u32) -> LiveSnapshot {
        let mut next = snapshot.clone();
        next.game.game_time_secs = secs;
        next.event_count = events;
        next
    }

    #[test]
    fn samples_come_at_the_start_every_five_seconds_and_on_each_event()
    -> Result<(), Box<dyn std::error::Error>> {
        let base = fixture_snapshot()?;
        let mut recorder = LiveRecorder::new(RecordingStore::open_in_memory()?);
        let now = start();
        // Polled every two seconds; the event count steps at t=8.
        for (offset, events) in [(0, 4), (2, 4), (4, 4), (6, 4), (8, 5), (10, 5), (12, 5)] {
            recorder.observe(
                &at(&base, 100 + offset, events),
                now + Duration::seconds(i64::from(offset)),
            )?;
        }
        let games = recorder.store().games()?;
        assert_eq!(games.len(), 1);
        let samples = recorder.store().samples(games[0].id)?;
        let taken: Vec<(u32, SampleTrigger)> = samples
            .iter()
            .map(|sample| (sample.game_time_secs, sample.trigger))
            .collect();
        assert_eq!(
            taken,
            [
                (100, SampleTrigger::Interval),
                (106, SampleTrigger::Interval),
                (108, SampleTrigger::Event),
            ]
        );
        Ok(())
    }

    #[test]
    fn a_game_stays_under_the_size_limit_and_keeps_its_ends()
    -> Result<(), Box<dyn std::error::Error>> {
        let base = fixture_snapshot()?;
        let mut recorder = LiveRecorder::new(RecordingStore::open_in_memory()?);
        let now = start();
        // Two hours of six-second samples cannot fit in one megabyte.
        for step in 0..1_200_u32 {
            recorder.observe(
                &at(&base, step * 6, 4),
                now + Duration::seconds(i64::from(step) * 6),
            )?;
        }
        let games = recorder.store().games()?;
        assert!(games[0].bytes <= MAX_GAME_BYTES, "{} bytes", games[0].bytes);
        let samples = recorder.store().samples(games[0].id)?;
        assert_eq!(samples.first().map(|s| s.game_time_secs), Some(0));
        assert_eq!(samples.last().map(|s| s.game_time_secs), Some(1_199 * 6));
        assert!(samples.len() > 50, "thinning must keep a useful series");
        Ok(())
    }

    #[test]
    fn a_sample_that_cannot_fit_is_dropped() -> Result<(), Box<dyn std::error::Error>> {
        let mut store = RecordingStore::open_in_memory()?;
        let id = store.begin_game(start())?;
        let mut oversized = fixture_snapshot()?;
        oversized.game.mode = "X".repeat(usize::try_from(MAX_GAME_BYTES)?);
        assert_eq!(
            store.append(id, &oversized, SampleTrigger::Interval, start())?,
            AppendOutcome::Dropped
        );
        assert_eq!(store.samples(id)?.len(), 0);
        Ok(())
    }

    #[test]
    fn a_clock_that_runs_backwards_starts_a_new_game() -> Result<(), Box<dyn std::error::Error>> {
        let base = fixture_snapshot()?;
        let mut recorder = LiveRecorder::new(RecordingStore::open_in_memory()?);
        let now = start();
        assert!(recorder.observe(&at(&base, 900, 4), now)?.is_none());
        let finished = recorder.observe(&at(&base, 3, 0), now + Duration::seconds(2))?;
        assert_eq!(finished.map(|game| game.status), Some(GameStatus::Finished));
        assert_eq!(recorder.store().games()?.len(), 2);
        let ended = recorder.end_game(now + Duration::seconds(10))?;
        assert_eq!(ended.map(|game| game.samples), Some(1));
        assert!(recorder.end_game(now)?.is_none());
        Ok(())
    }

    #[test]
    fn only_the_newest_twenty_games_are_kept() -> Result<(), Box<dyn std::error::Error>> {
        let mut store = RecordingStore::open_in_memory()?;
        for day in 0..25_i64 {
            let id = store.begin_game(start() + Duration::hours(day))?;
            store.finish_game(id, start() + Duration::hours(day) + Duration::minutes(30))?;
        }
        let games = store.games()?;
        assert_eq!(games.len(), usize::try_from(MAX_GAMES)?);
        assert_eq!(games[0].started_at, start() + Duration::hours(24));
        Ok(())
    }

    #[test]
    fn games_older_than_thirty_days_are_deleted() -> Result<(), Box<dyn std::error::Error>> {
        let mut store = RecordingStore::open_in_memory()?;
        let old = store.begin_game(start())?;
        store.finish_game(old, start() + Duration::minutes(30))?;
        let recent = store.begin_game(start() + Duration::days(29))?;
        store.finish_game(recent, start() + Duration::days(29) + Duration::minutes(30))?;
        assert_eq!(store.games()?.len(), 2);
        store.begin_game(start() + Duration::days(31))?;
        let kept: Vec<_> = store.games()?.iter().map(|game| game.id).collect();
        assert!(!kept.contains(&old));
        assert!(kept.contains(&recent));
        Ok(())
    }

    #[test]
    fn a_game_left_recording_by_a_stopped_scout_is_marked_interrupted()
    -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!("scout-rec-{}.sqlite3", uuid::Uuid::new_v4()));
        {
            let mut store = RecordingStore::open(&path)?;
            store.begin_game(start())?;
        }
        let reopened = RecordingStore::open(&path)?;
        assert_eq!(reopened.games()?[0].status, GameStatus::Interrupted);
        drop(reopened);
        for suffix in ["", "-wal", "-shm"] {
            let mut file = path.clone().into_os_string();
            file.push(suffix);
            let _ = std::fs::remove_file(file);
        }
        Ok(())
    }
}
