//! One-time storage migrations, gated by a stored schema version.
//!
//! **v0 (absent) → v2.** The queue this stack replaced stored *relative*
//! mutations — a `toggle_status` with no target state, a `complete_instance`
//! with no date. Each is converted to an absolute-state [`Command`] so a queue
//! persisted by the previous app version is replayed rather than silently
//! dropped on upgrade. The base task cache needs no conversion: it is already a
//! server snapshot.
//!
//! ⚠️ **The conversion is all-or-nothing, unlike every other parse in this
//! crate.** The command queue's own restore and the alias map salvage what they
//! can, and that is safe because they leave their file where it is — the bytes
//! they skipped are still on disk. This migration *deletes* its source, so an
//! entry it could not read is an offline mutation nobody can ever get back. It
//! therefore refuses rather than salvages, on the same reasoning the store's
//! `parse_id_counters` gives: losing a launch to a loud error over a file the
//! user still has is recoverable; a silent deletion is not.
//!
//! The v1 shapes are **frozen copies**, deliberately not the live schemas. A
//! migration has to keep reading the old format forever, so it cannot be
//! coupled to a type that is still evolving.

use std::sync::Arc;

use serde_json::Value;

use crate::{
    Result,
    domain::{CreateTaskRequest, TaskId, TaskStatus, UpdateTaskRequest},
    sync::{Clock, Command, Randomness, command_id},
};

/// The schema version this release writes.
pub const CURRENT_SCHEMA_VERSION: u32 = 2;

/// Durable storage for the migration itself.
///
/// Separate from [`QueueStorage`](crate::sync::QueueStorage) because the
/// migration reads a key — the legacy queue — that nothing else in the stack
/// knows about, and removes it once converted.
pub trait MigrationStorage: Send + Sync {
    /// The stored schema version; `0` when absent.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn read_schema_version(&self) -> Result<u32>;

    /// Record the schema version.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn write_schema_version(&self, version: u32) -> Result<()>;

    /// The v1 mutation queue, if one was ever written.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn read_legacy_queue(&self) -> Result<Option<String>>;

    /// Drop the v1 mutation queue.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn remove_legacy_queue(&self) -> Result<()>;

    /// The v2 command queue, if one was ever written.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn read_queue(&self) -> Result<Option<String>>;

    /// Write the v2 command queue.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn write_queue(&self, data: &str) -> Result<()>;
}

/// Run every pending migration.
///
/// Idempotent: returns immediately once the stored version is current. Call
/// once at startup, **before** anything reads the queue.
///
/// # Errors
///
/// Propagates a storage-layer failure, and the refusal [`migrate_v1_queue`]
/// raises when the legacy queue cannot be converted in full. Both leave the
/// legacy key and the stored version untouched, so the next launch — or a
/// later release that can read those bytes — starts from the same place.
pub fn run_migrations(
    storage: &dyn MigrationStorage,
    clock: &Arc<dyn Clock>,
    random: &Arc<dyn Randomness>,
) -> Result<()> {
    if storage.read_schema_version()? >= CURRENT_SCHEMA_VERSION {
        return Ok(());
    }

    // Skip the conversion when a v2 queue already exists: a previous run got
    // that far and was interrupted before stamping the version, and converting
    // twice would duplicate every mutation.
    if storage.read_queue()?.is_none() {
        let legacy = storage.read_legacy_queue()?;
        // `?`, and that is the whole safety property: a queue this release
        // cannot convert in full must not reach `remove_legacy_queue` below.
        let commands = migrate_v1_queue(legacy.as_deref(), clock.as_ref(), random.as_ref())?;
        if !commands.is_empty() {
            let data = serde_json::to_string(&commands).map_err(|error| {
                crate::Error::invariant(format!("could not serialize the migrated queue: {error}"))
            })?;
            storage.write_queue(&data)?;
        }
    }
    storage.remove_legacy_queue()?;
    storage.write_schema_version(CURRENT_SCHEMA_VERSION)
}

/// The frozen v1 mutation shape.
///
/// A copy, never an import: the live schemas have moved on, and this must keep
/// reading what the old app wrote for as long as an un-upgraded device exists.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum V1Mutation {
    Create {
        timestamp: i64,
        payload: CreateTaskRequest,
    },
    Update {
        timestamp: i64,
        #[serde(rename = "taskId")]
        task_id: TaskId,
        payload: UpdateTaskRequest,
    },
    Delete {
        timestamp: i64,
        #[serde(rename = "taskId")]
        task_id: TaskId,
    },
    ToggleStatus {
        timestamp: i64,
        #[serde(rename = "taskId")]
        task_id: TaskId,
        payload: V1StatusPayload,
    },
    CompleteInstance {
        timestamp: i64,
        #[serde(rename = "taskId")]
        task_id: TaskId,
    },
}

#[derive(Debug, Clone, serde::Deserialize)]
struct V1StatusPayload {
    status: TaskStatus,
}

/// Convert a persisted v1 queue into v2 commands.
///
/// Exposed for testing, and because a host may want to preview an upgrade
/// before committing to it.
///
/// ⚠️ **Anything it cannot read is a refusal, not a dropped entry.** The v1
/// queue's own loader salvaged per element, and copying that here was a data
/// loss bug: [`run_migrations`] deletes the legacy key immediately afterwards,
/// so an entry skipped here is an offline mutation that no later launch can
/// recover. Refusing keeps the bytes on disk, which is the only state from
/// which anything can still be done about them.
///
/// # Errors
///
/// [`crate::Error::Invariant`] when a non-empty legacy queue is not a JSON
/// array, or when any element is not a mutation this release can read.
pub fn migrate_v1_queue(
    legacy: Option<&str>,
    clock: &dyn Clock,
    random: &dyn Randomness,
) -> Result<Vec<Command>> {
    let Some(legacy) = legacy.filter(|value| !value.is_empty()) else {
        return Ok(Vec::new());
    };
    let parsed = serde_json::from_str::<Value>(legacy)
        .map_err(|error| unconvertible(format!("it is not valid JSON: {error}")))?;
    let Value::Array(items) = parsed else {
        return Err(unconvertible("it is not a JSON array"));
    };

    let mut commands = Vec::new();
    let mut counter: u64 = 0;
    let mut temp_counter: u64 = 0;
    for (index, item) in items.into_iter().enumerate() {
        let mutation = serde_json::from_value::<V1Mutation>(item).map_err(|error| {
            unconvertible(format!(
                "entry {index} is not a mutation this release can read: {error}"
            ))
        })?;
        counter = counter.saturating_add(1);
        let id = command_id(clock.now_millis(), counter, random.next_unit_ppm());
        commands.push(match mutation {
            V1Mutation::Create { timestamp, payload } => {
                // Nothing referenced the old optimistic task — it was never
                // persisted — so a fresh temp id is safe.
                temp_counter = temp_counter.saturating_add(1);
                Command::Create {
                    id,
                    created_at: timestamp,
                    temp_id: TaskId::temp(timestamp, temp_counter),
                    payload,
                }
            }
            V1Mutation::Update {
                timestamp,
                task_id,
                payload,
            } => Command::Update {
                id,
                created_at: timestamp,
                task_id,
                payload,
            },
            V1Mutation::Delete { timestamp, task_id } => Command::Delete {
                id,
                created_at: timestamp,
                task_id,
            },
            V1Mutation::ToggleStatus {
                timestamp,
                task_id,
                payload,
            } => Command::SetStatus {
                id,
                created_at: timestamp,
                task_id,
                status: payload.status,
            },
            V1Mutation::CompleteInstance { timestamp, task_id } => Command::SetInstanceComplete {
                id,
                created_at: timestamp,
                task_id,
                // The enqueue timestamp is the only record of the tapped day,
                // and v1 only ever enqueued on a *completion* tap, so the
                // direction is unambiguous. The date is device-local because
                // that is the calendar the user tapped in.
                date: clock.local_ymd(timestamp),
                completed: true,
                // A completion never carries one, and v1 only enqueued
                // completions.
                restore: None,
            },
        });
    }
    Ok(commands)
}

/// The refusal, worded so the message says what is at stake.
///
/// One constructor rather than three call sites spelling it out, because the
/// consequence — not the parse detail — is the part a host has to render.
fn unconvertible(detail: impl std::fmt::Display) -> crate::Error {
    crate::Error::invariant(format!(
        "the legacy mutation queue exists but cannot be converted, and migrating \
         would delete offline work that was never carried over: {detail}"
    ))
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::{CURRENT_SCHEMA_VERSION, MigrationStorage, migrate_v1_queue, run_migrations};
    use crate::{
        Result,
        domain::TaskStatus,
        sync::{Clock, Command, Randomness},
    };

    struct FixedClock;
    impl Clock for FixedClock {
        fn now_millis(&self) -> i64 {
            1_750_000_000_000
        }
        fn local_ymd(&self, millis: i64) -> String {
            // Deliberately not a real calendar: the migration only needs the
            // host's answer, and pinning it keeps the test timezone-free.
            format!("day-{millis}")
        }
    }

    struct HalfUnit;
    impl Randomness for HalfUnit {
        fn next_unit_ppm(&self) -> u32 {
            500_000
        }
    }

    #[derive(Default)]
    struct Memory {
        version: Mutex<u32>,
        legacy: Mutex<Option<String>>,
        queue: Mutex<Option<String>>,
    }

    impl MigrationStorage for Memory {
        fn read_schema_version(&self) -> Result<u32> {
            Ok(*self.version.lock().unwrap())
        }
        fn write_schema_version(&self, version: u32) -> Result<()> {
            *self.version.lock().unwrap() = version;
            Ok(())
        }
        fn read_legacy_queue(&self) -> Result<Option<String>> {
            Ok(self.legacy.lock().unwrap().clone())
        }
        fn remove_legacy_queue(&self) -> Result<()> {
            *self.legacy.lock().unwrap() = None;
            Ok(())
        }
        fn read_queue(&self) -> Result<Option<String>> {
            Ok(self.queue.lock().unwrap().clone())
        }
        fn write_queue(&self, data: &str) -> Result<()> {
            *self.queue.lock().unwrap() = Some(data.to_owned());
            Ok(())
        }
    }

    const LEGACY: &str = r#"[
      {"id":"m1","timestamp":10,"type":"create","payload":{"title":"Made offline"}},
      {"id":"m2","timestamp":20,"type":"update","taskId":"Tasks/a.md","payload":{"title":"Renamed"}},
      {"id":"m3","timestamp":30,"type":"delete","taskId":"Tasks/b.md"},
      {"id":"m4","timestamp":40,"type":"toggle_status","taskId":"Tasks/c.md","payload":{"status":"done"}},
      {"id":"m5","timestamp":50,"type":"complete_instance","taskId":"Tasks/d.md"}
    ]"#;

    #[test]
    fn every_v1_mutation_becomes_an_absolute_v2_command() {
        let commands = migrate_v1_queue(Some(LEGACY), &FixedClock, &HalfUnit).unwrap();
        assert_eq!(commands.len(), 5);
        assert!(matches!(
            commands.first(),
            Some(&Command::Create { created_at: 10, .. })
        ));
        assert!(matches!(
            commands.get(3),
            Some(&Command::SetStatus {
                status: TaskStatus::Done,
                ..
            })
        ));
        let Some(&Command::SetInstanceComplete {
            ref date,
            completed,
            ..
        }) = commands.get(4)
        else {
            panic!("the fifth command should be a set_instance_complete");
        };
        assert!(completed, "v1 only enqueued on a completion tap");
        assert_eq!(
            date, "day-50",
            "the tapped day comes from the mutation's own timestamp"
        );
    }

    #[test]
    fn a_v1_create_gets_a_fresh_temp_id_derived_from_its_own_timestamp() {
        let commands = migrate_v1_queue(
            Some(
                r#"[{"id":"m1","timestamp":10,"type":"create","payload":{"title":"a"}},
                     {"id":"m2","timestamp":10,"type":"create","payload":{"title":"b"}}]"#,
            ),
            &FixedClock,
            &HalfUnit,
        )
        .unwrap();
        let ids: Vec<String> = commands
            .iter()
            .map(|command| command.target().as_str().to_owned())
            .collect();
        assert_eq!(ids, ["tmp-10-1", "tmp-10-2"], "two creates, two temp ids");
    }

    /// ⚠️ **The entry the converter cannot read is the whole reason this
    /// refuses.** Dropping it would return one command for a two-element queue,
    /// and [`run_migrations`] would then delete the file holding the other —
    /// so the mutation the user made offline would be gone with nothing left to
    /// recover it from.
    #[test]
    fn an_entry_the_converter_cannot_read_refuses_the_whole_queue() {
        let refused = migrate_v1_queue(
            Some(
                r#"[{"nope":1},{"id":"m3","timestamp":30,"type":"delete","taskId":"Tasks/b.md"}]"#,
            ),
            &FixedClock,
            &HalfUnit,
        )
        .expect_err("an unreadable entry must not be silently dropped");
        assert!(
            refused.to_string().contains("entry 0"),
            "the refusal names which entry stopped it: {refused}"
        );
    }

    #[test]
    fn a_legacy_queue_that_is_not_an_array_refuses_rather_than_reading_as_empty() {
        assert!(migrate_v1_queue(Some("not json"), &FixedClock, &HalfUnit).is_err());
        assert!(migrate_v1_queue(Some(r#"{"queue":[]}"#), &FixedClock, &HalfUnit).is_err());
    }

    /// The two cases that genuinely mean "nothing was ever queued", and so are
    /// the only ones that may convert to an empty list.
    #[test]
    fn an_absent_or_empty_legacy_queue_converts_to_nothing() {
        assert!(
            migrate_v1_queue(None, &FixedClock, &HalfUnit)
                .unwrap()
                .is_empty()
        );
        assert!(
            migrate_v1_queue(Some(""), &FixedClock, &HalfUnit)
                .unwrap()
                .is_empty()
        );
        assert!(
            migrate_v1_queue(Some("[]"), &FixedClock, &HalfUnit)
                .unwrap()
                .is_empty()
        );
    }

    fn hosts() -> (Arc<dyn Clock>, Arc<dyn Randomness>) {
        (Arc::new(FixedClock), Arc::new(HalfUnit))
    }

    #[test]
    fn running_the_migration_converts_stamps_and_clears_the_legacy_key() {
        let storage = Memory {
            legacy: Mutex::new(Some(LEGACY.to_owned())),
            ..Memory::default()
        };
        let (clock, random) = hosts();
        run_migrations(&storage, &clock, &random).unwrap();

        assert_eq!(*storage.version.lock().unwrap(), CURRENT_SCHEMA_VERSION);
        assert!(storage.legacy.lock().unwrap().is_none());
        let migrated: Vec<Command> =
            serde_json::from_str(&storage.queue.lock().unwrap().clone().unwrap()).unwrap();
        assert_eq!(migrated.len(), 5);
    }

    /// ⚠️ **The bug this pins is the deletion, not the parse.** A queue holding
    /// one entry this release cannot read used to convert to a shorter list,
    /// write it, delete the legacy key and stamp the version current — so the
    /// mutations it skipped were gone, and the next launch had no way to know
    /// anything had ever been there. Every assertion below is about what is
    /// still on disk afterwards.
    #[test]
    fn a_queue_that_cannot_be_converted_in_full_is_kept_rather_than_deleted() {
        let unreadable = r#"[
          {"id":"m1","timestamp":10,"type":"create","payload":{"title":"Made offline"}},
          {"id":"m2","timestamp":20,"type":"a_verb_this_release_never_shipped"}
        ]"#;
        let storage = Memory {
            legacy: Mutex::new(Some(unreadable.to_owned())),
            ..Memory::default()
        };
        let (clock, random) = hosts();

        let refused = run_migrations(&storage, &clock, &random)
            .expect_err("a lossy conversion must fail the migration");
        assert!(
            refused.to_string().contains("delete offline work"),
            "the refusal says what was at stake: {refused}"
        );

        assert_eq!(
            storage.legacy.lock().unwrap().clone(),
            Some(unreadable.to_owned()),
            "the source of the unconverted work is still there to recover from"
        );
        assert_eq!(
            *storage.version.lock().unwrap(),
            0,
            "and the version is not stamped, so the next launch tries again"
        );
        assert!(
            storage.queue.lock().unwrap().is_none(),
            "no half-converted queue was written either"
        );
    }

    #[test]
    fn the_migration_is_idempotent() {
        let storage = Memory {
            legacy: Mutex::new(Some(LEGACY.to_owned())),
            ..Memory::default()
        };
        let (clock, random) = hosts();
        run_migrations(&storage, &clock, &random).unwrap();
        let first = storage.queue.lock().unwrap().clone();
        run_migrations(&storage, &clock, &random).unwrap();
        assert_eq!(storage.queue.lock().unwrap().clone(), first);
    }

    #[test]
    fn an_interrupted_run_does_not_convert_twice() {
        let storage = Memory {
            legacy: Mutex::new(Some(LEGACY.to_owned())),
            queue: Mutex::new(Some("[]".to_owned())),
            ..Memory::default()
        };
        let (clock, random) = hosts();
        run_migrations(&storage, &clock, &random).unwrap();
        assert_eq!(
            storage.queue.lock().unwrap().clone(),
            Some("[]".to_owned()),
            "a v2 queue already exists, so the legacy queue must be discarded"
        );
        assert!(storage.legacy.lock().unwrap().is_none());
    }
}
