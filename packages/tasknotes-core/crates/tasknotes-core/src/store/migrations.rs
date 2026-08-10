//! One-time storage migrations, gated by a stored schema version.
//!
//! **v0 (absent) → v2.** The queue this stack replaced stored *relative*
//! mutations — a `toggle_status` with no target state, a `complete_instance`
//! with no date. Each is converted to an absolute-state [`Command`] so a queue
//! persisted by the previous app version is replayed rather than silently
//! dropped on upgrade. The base task cache needs no conversion: it is already a
//! server snapshot, and the queue's per-element salvage handles stragglers.
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
/// Propagates a storage-layer failure. A v1 entry that no longer parses is not
/// an error — see [`migrate_v1_queue`].
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
        let commands = migrate_v1_queue(legacy.as_deref(), clock.as_ref(), random.as_ref());
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
/// Unparseable entries are dropped rather than failing the migration, which is
/// what the v1 queue's own loader did: one corrupt entry must not strand every
/// other mutation the user is waiting on.
#[must_use]
pub fn migrate_v1_queue(
    legacy: Option<&str>,
    clock: &dyn Clock,
    random: &dyn Randomness,
) -> Vec<Command> {
    let Some(legacy) = legacy.filter(|value| !value.is_empty()) else {
        return Vec::new();
    };
    let Ok(Value::Array(items)) = serde_json::from_str::<Value>(legacy) else {
        return Vec::new();
    };

    let mut commands = Vec::new();
    let mut counter: u64 = 0;
    let mut temp_counter: u64 = 0;
    for item in items {
        let Ok(mutation) = serde_json::from_value::<V1Mutation>(item) else {
            continue;
        };
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
    commands
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
        let commands = migrate_v1_queue(Some(LEGACY), &FixedClock, &HalfUnit);
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
        );
        let ids: Vec<String> = commands
            .iter()
            .map(|command| command.target().as_str().to_owned())
            .collect();
        assert_eq!(ids, ["tmp-10-1", "tmp-10-2"], "two creates, two temp ids");
    }

    #[test]
    fn unparseable_entries_are_dropped_not_fatal() {
        let commands = migrate_v1_queue(
            Some(
                r#"[{"nope":1},{"id":"m3","timestamp":30,"type":"delete","taskId":"Tasks/b.md"}]"#,
            ),
            &FixedClock,
            &HalfUnit,
        );
        assert_eq!(commands.len(), 1);
        assert!(migrate_v1_queue(Some("not json"), &FixedClock, &HalfUnit).is_empty());
        assert!(migrate_v1_queue(None, &FixedClock, &HalfUnit).is_empty());
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
