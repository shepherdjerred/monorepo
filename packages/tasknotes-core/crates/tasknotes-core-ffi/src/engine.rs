//! The sync engine as a UniFFI object, and the snapshot the UI reads.
//!
//! ## Why an object, and why a `Mutex`
//!
//! [`tasknotes_core::sync::SyncEngine`] is a mutable state machine: every entry
//! point takes `&mut self`, which is how single-flight replay is a type-system
//! property in this port rather than a runtime `inFlight` flag. UniFFI objects
//! are handed out as `Arc<Self>` and every exported method takes `&self`, so the
//! mutability has to be reintroduced with interior mutability. A `Mutex` is the
//! right one: it also serializes the host's calls, which is exactly the
//! guarantee the engine's `&mut self` signatures encode.
//!
//! Phase 4 pins `SyncEngine: Send + Sync` with a unit test in the *core* crate,
//! so relaxing a host trait's bounds fails there rather than as a wall of macro
//! expansion here.
//!
//! ## No panics, including on a poisoned lock
//!
//! `Mutex::lock` returns a `Result`, and `unwrap()` is denied in this
//! workspace for a reason that is sharper behind an FFI than in front of one: a
//! Rust panic crossing UniFFI surfaces as an untyped internal error and can
//! leave the host app dead. A poisoned lock therefore becomes a typed
//! [`CoreError::Invariant`]. That is also why almost every method here returns
//! a `Result` even when its core counterpart cannot fail — the lock can.
//!
//! ## What the snapshot projection costs
//!
//! [`tasknotes_core::store::TaskStoreSnapshot`] holds an
//! `IndexMap<TaskId, Task>` and an `IndexSet<TaskId>`. UniFFI can express
//! neither, so both are projected to `Vec`s. **The order is the user's list
//! order** — it is the order the server listed the tasks in, with pending
//! commands rebased on top, and the core uses `shift_remove` rather than
//! `swap_remove` specifically to preserve it. A host that re-sorts or
//! de-duplicates this list is discarding information the core went out of its
//! way to keep.

use std::sync::{Arc, Mutex};

use tasknotes_core::{
    domain::{Task, TaskId},
    store::{TaskStore, migrations},
    sync::{self, SyncState},
};

use crate::{
    command::{CommandInput, DeadLetterEntry},
    error::CoreError,
    host::{
        Clock, ClockAdapter, MigrationStorage, MigrationStorageAdapter, QueueStorage,
        QueueStorageAdapter, Randomness, RandomnessAdapter, RetryScheduler, RetrySchedulerAdapter,
        TaskCacheStorage, TaskCacheStorageAdapter,
    },
    net::TaskNotesApi,
};

/// Everything the UI reads, frozen at one instant.
///
/// The projection of [`tasknotes_core::store::TaskStoreSnapshot`]; see the
/// module docs for what `Vec` costs and why the order is load-bearing.
#[derive(Debug, Clone, Default, PartialEq, uniffi::Record)]
pub struct TaskStoreSnapshot {
    /// The visible tasks — the base snapshot with every pending command
    /// applied — **in the user's list order**.
    pub tasks: Vec<Task>,
    /// How many commands are waiting to be sent.
    pub pending_count: u32,
    /// Tasks with at least one unsynced command, in first-queued order. The
    /// quiet trust signal the list rows render.
    pub pending_task_ids: Vec<TaskId>,
    /// Commands parked for review, oldest first.
    pub dead_letters: Vec<DeadLetterEntry>,
    /// When the last successful pull completed, in epoch milliseconds.
    pub last_sync_time: Option<i64>,
}

/// The engine's status, as the UI renders its connection banner.
///
/// Mirrors [`tasknotes_core::sync::SyncStatus`], whose `last_error` is a
/// [`tasknotes_core::Error`] — not a UniFFI type — and so becomes its ABI
/// mirror here.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SyncStatus {
    /// What the engine is doing.
    pub state: SyncState,
    /// The failure that produced the current state, if any.
    pub last_error: Option<CoreError>,
    /// When the armed retry will fire, in epoch milliseconds.
    pub next_retry_at: Option<i64>,
}

impl From<&sync::SyncStatus> for SyncStatus {
    fn from(status: &sync::SyncStatus) -> Self {
        Self {
            state: status.state,
            last_error: status.last_error.as_ref().map(CoreError::from),
            next_retry_at: status.next_retry_at,
        }
    }
}

/// Project the core snapshot, failing loudly if a count will not fit.
///
/// `usize` has no UniFFI shape, so the two counts narrow to `u32`. On every
/// platform this ships to that conversion cannot fail — 4.3 billion queued
/// commands is not a state a task app reaches — but it is reported rather than
/// clamped, because a clamped count is a lie the UI would render as a number.
fn project(
    snapshot: &tasknotes_core::store::TaskStoreSnapshot,
) -> Result<TaskStoreSnapshot, CoreError> {
    let pending_count =
        u32::try_from(snapshot.pending_count).map_err(|_| CoreError::Invariant {
            message: format!(
                "the pending command count {} does not fit in a u32",
                snapshot.pending_count
            ),
        })?;
    Ok(TaskStoreSnapshot {
        tasks: snapshot.tasks.values().cloned().collect(),
        pending_count,
        pending_task_ids: snapshot.pending_task_ids.iter().cloned().collect(),
        dead_letters: snapshot
            .dead_letters
            .iter()
            .cloned()
            .map(DeadLetterEntry::from)
            .collect(),
        last_sync_time: snapshot.last_sync_time,
    })
}

/// The offline-first sync engine, as the host holds it.
///
/// One object owns the queue, the store and the drain loop. Construct exactly
/// one per configured server: when the user changes the URL, call
/// [`FfiSyncEngine::dispose`] on the old one before building its replacement,
/// or a failure already in flight can resurrect a dead engine's retry timer.
#[derive(uniffi::Object)]
pub struct FfiSyncEngine {
    inner: Mutex<sync::SyncEngine>,
    /// The configured API, held **outside** the lock.
    ///
    /// Not a duplicate of what the engine already owns: it is the only way
    /// [`FfiSyncEngine::cancel_all`] can do anything useful. The lock is held
    /// for the whole of a blocking drain, so a cancel that had to take it could
    /// only ever run after the request it meant to cancel had returned.
    api: Option<Arc<TaskNotesApi>>,
}

impl FfiSyncEngine {
    /// Take the lock, reporting poisoning as a typed failure rather than a
    /// panic.
    fn locked(&self) -> Result<std::sync::MutexGuard<'_, sync::SyncEngine>, CoreError> {
        self.inner.lock().map_err(|_| CoreError::Invariant {
            message: "the sync engine's lock was poisoned by an earlier panic; \
                      the engine's state is unknown and it must be rebuilt"
                .to_owned(),
        })
    }
}

#[uniffi::export]
impl FfiSyncEngine {
    /// Wire an engine over the host's capabilities.
    ///
    /// `api` is `None` until the user has configured a server, which is the
    /// [`SyncState::Unconfigured`] state — deliberately not an error, and
    /// deliberately not a state a retry timer can fix. When it is present it is
    /// a [`TaskNotesApi`], which is the *core's* client over a host transport;
    /// the shell supplies bytes, not a wire implementation.
    ///
    /// `auto_sync` mirrors the app's dispatch → trigger wiring: with it on,
    /// every [`FfiSyncEngine::dispatch`] *arms* a pass without running it, so
    /// the host still decides when work happens by calling
    /// [`FfiSyncEngine::settle`] or [`FfiSyncEngine::sync_now`].
    ///
    /// Nothing is read from storage here. Call [`FfiSyncEngine::restore`] once
    /// at startup, after [`run_migrations`].
    #[uniffi::constructor]
    #[must_use]
    pub fn new(
        api: Option<Arc<TaskNotesApi>>,
        queue_storage: Arc<dyn QueueStorage>,
        cache_storage: Arc<dyn TaskCacheStorage>,
        clock: Arc<dyn Clock>,
        scheduler: Arc<dyn RetryScheduler>,
        random: Arc<dyn Randomness>,
        auto_sync: bool,
    ) -> Self {
        let core_clock: Arc<dyn tasknotes_core::sync::Clock> = Arc::new(ClockAdapter(clock));
        let core_random: Arc<dyn tasknotes_core::sync::Randomness> =
            Arc::new(RandomnessAdapter(random));
        let store = TaskStore::new(
            Arc::new(QueueStorageAdapter(queue_storage)),
            Arc::new(TaskCacheStorageAdapter(cache_storage)),
            Arc::clone(&core_clock),
            Arc::clone(&core_random),
        );
        let client: Option<Arc<dyn tasknotes_core::net::TaskApi>> = api
            .as_ref()
            .map(|api| -> Arc<dyn tasknotes_core::net::TaskApi> { api.client() });
        Self {
            inner: Mutex::new(sync::SyncEngine::new(
                client,
                store,
                core_clock,
                Arc::new(RetrySchedulerAdapter(scheduler)),
                core_random,
                auto_sync,
            )),
            api,
        }
    }

    /// Abandon every request currently in flight.
    ///
    /// **Takes no lock**, deliberately: the engine's lock is held for the whole
    /// of a blocking drain, so anything that had to acquire it could only run
    /// once the request it meant to cancel had already returned. This is the
    /// path that works while the app is quitting mid-request, and it is why the
    /// transport carries an explicit cancel rather than relying on a dropped
    /// future — UniFFI async has no cancellation at all.
    ///
    /// A no-op on an unconfigured engine, and safe to call any number of times.
    pub fn cancel_all(&self) {
        if let Some(ref api) = self.api {
            api.cancel_all();
        }
    }

    /// Load every piece of durable client state. Call once at startup.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure, or reports a poisoned lock.
    pub fn restore(&self) -> Result<(), CoreError> {
        self.locked()?.restore().map_err(CoreError::from)
    }

    /// Record a mutation, returning the optimistic result immediately.
    ///
    /// The enqueue is the only wait — never the network. Answers the task as
    /// the UI will now see it, or `None` after a delete.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure, or reports a poisoned lock. Never a
    /// network failure.
    pub fn dispatch(&self, input: CommandInput) -> Result<Option<Task>, CoreError> {
        self.locked()?
            .dispatch(input.into())
            .map_err(CoreError::from)
    }

    /// Arm a pass without running it. Safe from anywhere, any number of times.
    ///
    /// This is what a fired retry timer, a reconnect notification and a
    /// foreground transition all call. A disposed engine ignores it. Nothing
    /// runs until [`FfiSyncEngine::settle`] or [`FfiSyncEngine::sync_now`].
    ///
    /// # Errors
    ///
    /// Reports a poisoned lock.
    pub fn request_sync(&self) -> Result<(), CoreError> {
        self.locked()?.request_sync();
        Ok(())
    }

    /// Run an armed pass, discarding its result.
    ///
    /// The counterpart of a fire-and-forget trigger. Does nothing when no pass
    /// is armed, so it is safe to call on a timer.
    ///
    /// # Errors
    ///
    /// Reports a poisoned lock. The pass's own failure is deliberately
    /// discarded — read it back from [`FfiSyncEngine::status`].
    pub fn settle(&self) -> Result<(), CoreError> {
        self.locked()?.settle();
        Ok(())
    }

    /// Arm a pass and run the drain loop to quiescence.
    ///
    /// # Errors
    ///
    /// The failure that stopped the drain or the pull, or a poisoned lock. The
    /// queue is intact either way: a command is only removed once the server
    /// has acknowledged it or it has been parked.
    pub fn sync_now(&self) -> Result<(), CoreError> {
        self.locked()?.sync_now().map_err(CoreError::from)
    }

    /// Stop this engine from initiating new work.
    ///
    /// Cancels the armed retry timer and arms no new one, so a failure already
    /// in flight cannot resurrect a replaced engine.
    ///
    /// In-flight requests are abandoned **before** the lock is taken. That
    /// ordering is the whole reason cancellation is a transport capability:
    /// were it done after, a shell replacing its server mid-drain would block
    /// here for the length of a network timeout.
    ///
    /// # Errors
    ///
    /// Reports a poisoned lock.
    pub fn shutdown(&self) -> Result<(), CoreError> {
        self.cancel_all();
        self.locked()?.dispose();
        Ok(())
    }

    /// Whether [`FfiSyncEngine::shutdown`] has been called.
    ///
    /// # Errors
    ///
    /// Reports a poisoned lock.
    pub fn is_disposed(&self) -> Result<bool, CoreError> {
        Ok(self.locked()?.is_disposed())
    }

    /// Whether a pass has been armed and not yet run.
    ///
    /// # Errors
    ///
    /// Reports a poisoned lock.
    pub fn is_sync_requested(&self) -> Result<bool, CoreError> {
        Ok(self.locked()?.is_sync_requested())
    }

    /// The engine's status, for the connection banner.
    ///
    /// # Errors
    ///
    /// Reports a poisoned lock.
    pub fn status(&self) -> Result<SyncStatus, CoreError> {
        Ok(SyncStatus::from(self.locked()?.status()))
    }

    /// Everything the UI reads, frozen at this instant.
    ///
    /// # Errors
    ///
    /// Reports a poisoned lock, or a count that does not fit its exported
    /// width.
    pub fn snapshot(&self) -> Result<TaskStoreSnapshot, CoreError> {
        project(self.locked()?.store().snapshot())
    }

    /// Follow a temp id through the alias map recorded when its create was
    /// acked, or answer the id unchanged.
    ///
    /// A UI surface holding an id from before a create was acked — an open
    /// inspector, a deep link, a restored window — stays valid because of this.
    ///
    /// # Errors
    ///
    /// Reports a poisoned lock.
    pub fn resolve_task_id(&self, id: &TaskId) -> Result<TaskId, CoreError> {
        Ok(self.locked()?.store().resolve_task_id(id))
    }

    /// Move a parked command back onto the queue.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure, or reports a poisoned lock.
    pub fn retry_dead_letter(&self, id: &str) -> Result<(), CoreError> {
        self.locked()?
            .retry_dead_letter(id)
            .map_err(CoreError::from)
    }

    /// Drop a parked command for good.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure, or reports a poisoned lock.
    pub fn discard_dead_letter(&self, id: &str) -> Result<(), CoreError> {
        self.locked()?
            .discard_dead_letter(id)
            .map_err(CoreError::from)
    }
}

/// The schema version this release writes.
///
/// Exported so a host can tell "never migrated" from "already current" without
/// hard-coding the number on its own side.
#[uniffi::export]
#[must_use]
pub fn migration_current_schema_version() -> u32 {
    migrations::CURRENT_SCHEMA_VERSION
}

/// Run every pending storage migration.
///
/// Idempotent, and must run **before** anything reads the queue —
/// [`FfiSyncEngine::restore`] included. Converts the v1 relative mutations
/// (`toggle_status` with no target state, `complete_instance` with no date)
/// into absolute v2 commands, so a queue persisted by the previous app version
/// is replayed on upgrade rather than silently dropped.
///
/// # Errors
///
/// Propagates a storage-layer failure. A v1 entry that no longer parses is not
/// an error: it is dropped, because one corrupt entry must not strand every
/// other mutation the user is waiting on.
#[uniffi::export]
pub fn run_migrations(
    storage: Arc<dyn MigrationStorage>,
    clock: Arc<dyn Clock>,
    random: Arc<dyn Randomness>,
) -> Result<(), CoreError> {
    let core_clock: Arc<dyn tasknotes_core::sync::Clock> = Arc::new(ClockAdapter(clock));
    let core_random: Arc<dyn tasknotes_core::sync::Randomness> =
        Arc::new(RandomnessAdapter(random));
    migrations::run_migrations(&MigrationStorageAdapter(storage), &core_clock, &core_random)
        .map_err(CoreError::from)
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    };

    use tasknotes_core::{
        domain::{CreateTaskRequest, Task, TaskId, TaskTitle},
        net::{HttpRequest, HttpResponse},
        sync::TimerId,
    };

    use super::{FfiSyncEngine, run_migrations};
    use crate::{
        command::CommandInput,
        error::CoreError,
        host::{
            Clock, MigrationStorage, QueueStorage, Randomness, RetryScheduler, TaskCacheStorage,
        },
        net::{HttpClient, TaskNotesApi, TransportError},
    };

    /// The in-memory host a Swift shell will implement against a real store.
    #[derive(Default)]
    struct Memory {
        queue: Mutex<Option<String>>,
        dead: Mutex<Option<String>>,
        tasks: Mutex<Vec<Task>>,
        aliases: Mutex<Option<String>>,
        counters: Mutex<Option<String>>,
        restores: Mutex<Option<String>>,
        last_sync: Mutex<Option<i64>>,
        version: Mutex<u32>,
        legacy: Mutex<Option<String>>,
    }

    impl QueueStorage for Memory {
        fn read_queue(&self) -> Result<Option<String>, CoreError> {
            Ok(self.queue.lock().unwrap().clone())
        }
        fn write_queue(&self, data: String) -> Result<(), CoreError> {
            *self.queue.lock().unwrap() = Some(data);
            Ok(())
        }
        fn read_dead_letter(&self) -> Result<Option<String>, CoreError> {
            Ok(self.dead.lock().unwrap().clone())
        }
        fn write_dead_letter(&self, data: String) -> Result<(), CoreError> {
            *self.dead.lock().unwrap() = Some(data);
            Ok(())
        }
    }

    impl TaskCacheStorage for Memory {
        fn read_tasks(&self) -> Result<Vec<Task>, CoreError> {
            Ok(self.tasks.lock().unwrap().clone())
        }
        fn write_tasks(&self, tasks: Vec<Task>) -> Result<(), CoreError> {
            *self.tasks.lock().unwrap() = tasks;
            Ok(())
        }
        fn read_id_aliases(&self) -> Result<Option<String>, CoreError> {
            Ok(self.aliases.lock().unwrap().clone())
        }
        fn write_id_aliases(&self, data: String) -> Result<(), CoreError> {
            *self.aliases.lock().unwrap() = Some(data);
            Ok(())
        }
        fn read_id_counters(&self) -> Result<Option<String>, CoreError> {
            Ok(self.counters.lock().unwrap().clone())
        }
        fn write_id_counters(&self, data: String) -> Result<(), CoreError> {
            *self.counters.lock().unwrap() = Some(data);
            Ok(())
        }
        fn read_completion_restores(&self) -> Result<Option<String>, CoreError> {
            Ok(self.restores.lock().unwrap().clone())
        }
        fn write_completion_restores(&self, data: String) -> Result<(), CoreError> {
            *self.restores.lock().unwrap() = Some(data);
            Ok(())
        }
        fn read_last_sync_time(&self) -> Result<Option<i64>, CoreError> {
            Ok(*self.last_sync.lock().unwrap())
        }
        fn write_last_sync_time(&self, millis: i64) -> Result<(), CoreError> {
            *self.last_sync.lock().unwrap() = Some(millis);
            Ok(())
        }
    }

    impl MigrationStorage for Memory {
        fn read_schema_version(&self) -> Result<u32, CoreError> {
            Ok(*self.version.lock().unwrap())
        }
        fn write_schema_version(&self, version: u32) -> Result<(), CoreError> {
            *self.version.lock().unwrap() = version;
            Ok(())
        }
        fn read_legacy_queue(&self) -> Result<Option<String>, CoreError> {
            Ok(self.legacy.lock().unwrap().clone())
        }
        fn remove_legacy_queue(&self) -> Result<(), CoreError> {
            *self.legacy.lock().unwrap() = None;
            Ok(())
        }
        fn read_queue(&self) -> Result<Option<String>, CoreError> {
            Ok(self.queue.lock().unwrap().clone())
        }
        fn write_queue(&self, data: String) -> Result<(), CoreError> {
            *self.queue.lock().unwrap() = Some(data);
            Ok(())
        }
    }

    struct FixedClock;
    impl Clock for FixedClock {
        fn now_millis(&self) -> i64 {
            1_750_000_000_000
        }
        fn local_ymd(&self, _millis: i64) -> String {
            "2025-06-15".to_owned()
        }
    }

    struct HalfUnit;
    impl Randomness for HalfUnit {
        fn next_unit_ppm(&self) -> u32 {
            500_000
        }
    }

    #[derive(Default)]
    struct Timers {
        next: AtomicU64,
        armed: Mutex<Vec<i64>>,
    }

    impl RetryScheduler for Timers {
        fn arm(&self, delay_millis: i64) -> TimerId {
            self.armed.lock().unwrap().push(delay_millis);
            TimerId::new(self.next.fetch_add(1, Ordering::Relaxed))
        }
        fn cancel(&self, _timer: TimerId) {}
    }

    /// A transport that is always offline, so a drain reaches the retry policy.
    ///
    /// The shape a shell actually implements now: bytes in, a transport failure
    /// out, and no opinion about what the failure *means*. Turning
    /// `TransportErrorKind::Offline` into a transient `Connection` is the
    /// core's decision, and this test is what proves it still happens.
    struct Offline;

    impl HttpClient for Offline {
        fn send(&self, _request: HttpRequest) -> Result<HttpResponse, TransportError> {
            Err(TransportError::Offline {
                message: "the test host is offline".to_owned(),
            })
        }

        fn cancel_all(&self) {}
    }

    /// A [`TaskNotesApi`] over an always-offline transport.
    fn offline_api() -> Arc<TaskNotesApi> {
        let transport: Arc<dyn HttpClient> = Arc::new(Offline);
        Arc::new(
            TaskNotesApi::new(transport, "http://vault.test:8080", 1_000)
                .expect("a literal base url"),
        )
    }

    fn build(memory: &Arc<Memory>, api: Option<Arc<TaskNotesApi>>) -> (FfiSyncEngine, Arc<Timers>) {
        let timers = Arc::new(Timers::default());
        let queue: Arc<dyn QueueStorage> = Arc::<Memory>::clone(memory);
        let cache: Arc<dyn TaskCacheStorage> = Arc::<Memory>::clone(memory);
        let scheduler: Arc<dyn RetryScheduler> = Arc::<Timers>::clone(&timers);
        (
            FfiSyncEngine::new(
                api,
                queue,
                cache,
                Arc::new(FixedClock),
                scheduler,
                Arc::new(HalfUnit),
                false,
            ),
            timers,
        )
    }

    #[test]
    fn a_dispatch_is_visible_in_the_snapshot_and_survives_a_restore() {
        let memory = Arc::new(Memory::default());
        let (engine, _) = build(&memory, None);
        engine.restore().unwrap();

        let optimistic = engine
            .dispatch(CommandInput::Create {
                payload: CreateTaskRequest::new(TaskTitle::parse("Written offline").unwrap()),
            })
            .unwrap()
            .unwrap();
        assert!(optimistic.id.is_temp());

        let snapshot = engine.snapshot().unwrap();
        assert_eq!(snapshot.pending_count, 1);
        assert_eq!(snapshot.tasks.len(), 1);
        assert_eq!(
            snapshot.tasks.first().map(|task| task.title.as_str()),
            Some("Written offline")
        );
        assert_eq!(snapshot.pending_task_ids, vec![optimistic.id.clone()]);

        // A second engine over the same host storage rebuilds the same world:
        // the queue is durable, the rebased view is recomputed.
        let (reopened, _) = build(&memory, None);
        reopened.restore().unwrap();
        let restored = reopened.snapshot().unwrap();
        assert_eq!(restored.pending_count, 1);
        assert_eq!(
            restored.tasks.first().map(|task| task.id.clone()),
            Some(optimistic.id)
        );
    }

    #[test]
    fn a_dispatch_spends_the_id_counters_through_the_host_adapter() {
        // The adapter is a one-line forward, but an un-forwarded storage method
        // is invisible from the Rust side: the core would keep counting in
        // memory and reset on every relaunch, which is exactly the bug the
        // counters exist to close. Pin that the bytes reach the host.
        let memory = Arc::new(Memory::default());
        let (engine, _) = build(&memory, None);
        engine.restore().unwrap();
        assert_eq!(
            memory.counters.lock().unwrap().clone(),
            None,
            "nothing is written before the first dispatch"
        );

        engine
            .dispatch(CommandInput::Create {
                payload: CreateTaskRequest::new(TaskTitle::parse("Written offline").unwrap()),
            })
            .unwrap();

        assert_eq!(
            memory.counters.lock().unwrap().clone(),
            Some(r#"{"command":1,"temp":1}"#.to_owned()),
            "a create spends one command id and one temp id"
        );
    }

    #[test]
    fn the_snapshot_projection_keeps_the_servers_list_order() {
        let memory = Arc::new(Memory::default());
        let seeded: Vec<Task> = ["Tasks/c.md", "Tasks/a.md", "Tasks/b.md"]
            .into_iter()
            .map(|id| serde_json::from_value(serde_json::json!({ "id": id, "title": id })).unwrap())
            .collect();
        memory.write_tasks(seeded).unwrap();

        let (engine, _) = build(&memory, None);
        engine.restore().unwrap();
        let snapshot = engine.snapshot().unwrap();
        let ids: Vec<&str> = snapshot.tasks.iter().map(|task| task.id.as_str()).collect();
        assert_eq!(
            ids,
            ["Tasks/c.md", "Tasks/a.md", "Tasks/b.md"],
            "the IndexMap → Vec projection must not sort"
        );
    }

    #[test]
    fn a_host_reported_failure_keeps_its_class_across_both_mirrors() {
        // The whole point of the `CoreError` ↔ `Error` round trip: a connection
        // failure raised in Swift must reach the classifier as *transient*, so
        // the command backs off instead of dead-lettering.
        let memory = Arc::new(Memory::default());
        let (engine, timers) = build(&memory, Some(offline_api()));
        engine.restore().unwrap();
        engine
            .dispatch(CommandInput::Delete {
                task_id: TaskId::parse("Tasks/a.md").unwrap(),
            })
            .unwrap();

        let error = engine.sync_now().unwrap_err();
        assert!(
            matches!(error, CoreError::Connection { .. }),
            "unexpected error: {error:?}"
        );
        assert_eq!(*timers.armed.lock().unwrap(), vec![1_000]);
        let status = engine.status().unwrap();
        assert_eq!(status.state, tasknotes_core::sync::SyncState::Backoff);
        assert!(status.last_error.is_some());
        let snapshot = engine.snapshot().unwrap();
        assert_eq!(
            snapshot.pending_count, 1,
            "a transient failure keeps the command"
        );
        assert!(snapshot.dead_letters.is_empty());
    }

    #[test]
    fn a_disposed_engine_stops_initiating_work() {
        let memory = Arc::new(Memory::default());
        let (engine, _) = build(&memory, Some(offline_api()));
        engine.restore().unwrap();
        engine.shutdown().unwrap();
        assert!(engine.is_disposed().unwrap());
        engine.request_sync().unwrap();
        engine.settle().unwrap();
        assert!(!engine.is_sync_requested().unwrap() || engine.is_disposed().unwrap());
    }

    #[test]
    fn the_migration_runs_through_the_foreign_storage_trait() {
        let memory = Arc::new(Memory {
            legacy: Mutex::new(Some(
                r#"[{"id":"m1","timestamp":30,"type":"delete","taskId":"Tasks/b.md"}]"#.to_owned(),
            )),
            ..Memory::default()
        });
        let storage: Arc<dyn MigrationStorage> = Arc::<Memory>::clone(&memory);
        run_migrations(storage, Arc::new(FixedClock), Arc::new(HalfUnit)).unwrap();

        assert_eq!(
            *memory.version.lock().unwrap(),
            super::migration_current_schema_version()
        );
        assert!(memory.legacy.lock().unwrap().is_none());

        let (engine, _) = build(&memory, None);
        engine.restore().unwrap();
        assert_eq!(
            engine.snapshot().unwrap().pending_count,
            1,
            "the converted v1 mutation must be replayable"
        );
    }
}
