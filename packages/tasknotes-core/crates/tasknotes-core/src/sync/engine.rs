//! The single-flight drain.
//!
//! Every sync trigger — a dispatch, app launch, reconnect, foregrounding,
//! pull-to-refresh, a fired retry timer — funnels into this one object.
//! Overlapping triggers **coalesce into one more pass** of the running loop
//! instead of executing concurrently. That, plus the FIFO head-ack protocol, is
//! what guarantees each command is sent at most once per attempt; the engine
//! this replaced let every trigger replay the whole queue.
//!
//! ## How coalescing works without async
//!
//! The TypeScript engine is promise-based: `requestSync()` is
//! `void this.syncNow()`, which starts a loop that a later `syncNow()` joins.
//! There is no async here — UniFFI 0.31 cannot cancel an async call at all — so
//! the same semantics are expressed with an explicit flag instead:
//!
//! * [`SyncEngine::request_sync`] is fire-and-forget: it **arms** a pass and
//!   returns. Nothing runs yet.
//! * [`SyncEngine::sync_now`] arms a pass and runs the loop to quiescence,
//!   returning its result. An armed pass is consumed by the loop, so a trigger
//!   that arrived before it becomes that pass rather than a second one.
//! * [`SyncEngine::settle`] runs an armed pass and discards its result — what a
//!   host calls after firing triggers it does not want to wait on.
//!
//! The observable behaviour is the same: N triggers followed by one wait
//! produce exactly one drain, and the retry backoff advances once per failure,
//! not once per trigger.
//!
//! ## Failure policy
//!
//! | class | behaviour |
//! |---|---|
//! | transient | stop the drain, exponential backoff, arm a retry |
//! | auth | stop the drain, surface the auth banner, arm **no** retry |
//! | not found | a delete counts as success; anything else dead-letters |
//! | permanent | dead-letter and keep draining |
//!
//! A successful drain always ends with a full pull that replaces the base.

use std::sync::Arc;

use super::{
    commands::{Command, FailureClass, classify},
    host::{Clock, Randomness, RetryScheduler, TimerId, UNIT_PPM},
};
use crate::{Error, Result, domain::Task, net::TaskApi, store::TaskStore};

/// The first backoff delay, and the base of the doubling schedule.
pub const BACKOFF_BASE_MS: i64 = 1_000;

/// The backoff ceiling. Reached at the seventh consecutive failure.
pub const BACKOFF_MAX_MS: i64 = 60_000;

/// The jitter band, as parts per million: ±20%.
const BACKOFF_JITTER_PPM: u32 = 200_000;

/// The largest exponent the doubling schedule uses.
///
/// The delay saturates at [`BACKOFF_MAX_MS`] long before this, but clamping the
/// exponent is what keeps the shift itself well-defined after a very long
/// offline stretch.
const MAX_BACKOFF_EXPONENT: u32 = 30;

/// What the engine is currently doing, for the UI's connection banner.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncState {
    /// Nothing to do; the last pass succeeded.
    Idle,
    /// A pass is running.
    Syncing,
    /// The last pass failed transiently and a retry is armed.
    Backoff,
    /// The server rejected the credentials. **No retry is armed** — a token
    /// does not fix itself on a schedule, so the next attempt waits for a
    /// deliberate trigger.
    AuthError,
    /// No API client is configured yet.
    Unconfigured,
}

/// The engine's status, as the UI renders it.
#[derive(Debug, Clone, PartialEq)]
pub struct SyncStatus {
    /// What the engine is doing.
    pub state: SyncState,
    /// The failure that produced the current state, if any.
    pub last_error: Option<Error>,
    /// When the armed retry will fire, in epoch milliseconds.
    pub next_retry_at: Option<i64>,
}

impl Default for SyncStatus {
    fn default() -> Self {
        Self {
            state: SyncState::Idle,
            last_error: None,
            next_retry_at: None,
        }
    }
}

/// The offline-first sync engine.
///
/// Owns the [`TaskStore`], which owns the
/// [`CommandQueue`](super::queue::CommandQueue). The single-owner shape is
/// deliberate: in the TypeScript original the store and the engine both hold a
/// reference to the same queue, and two aliases onto one mutable queue is
/// exactly the shape that let a stale snapshot be replayed.
pub struct SyncEngine {
    client: Option<Arc<dyn TaskApi>>,
    store: TaskStore,
    clock: Arc<dyn Clock>,
    scheduler: Arc<dyn RetryScheduler>,
    random: Arc<dyn Randomness>,
    status: SyncStatus,
    auto_sync: bool,
    pass_requested: bool,
    failure_streak: u32,
    armed_retry: Option<TimerId>,
    disposed: bool,
}

impl core::fmt::Debug for SyncEngine {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        formatter
            .debug_struct("SyncEngine")
            .field("status", &self.status)
            .field("pass_requested", &self.pass_requested)
            .field("failure_streak", &self.failure_streak)
            .field("armed_retry", &self.armed_retry)
            .field("disposed", &self.disposed)
            .finish_non_exhaustive()
    }
}

impl SyncEngine {
    /// Wire an engine over a store and the host's capabilities.
    ///
    /// `client` is `None` until the user has configured a server, which is the
    /// [`SyncState::Unconfigured`] state. `auto_sync` mirrors the app's
    /// dispatch → trigger wiring; with it off, only an explicit
    /// [`SyncEngine::sync_now`] moves anything.
    #[must_use]
    pub fn new(
        client: Option<Arc<dyn TaskApi>>,
        store: TaskStore,
        clock: Arc<dyn Clock>,
        scheduler: Arc<dyn RetryScheduler>,
        random: Arc<dyn Randomness>,
        auto_sync: bool,
    ) -> Self {
        Self {
            client,
            store,
            clock,
            scheduler,
            random,
            status: SyncStatus::default(),
            auto_sync,
            pass_requested: false,
            failure_streak: 0,
            armed_retry: None,
            disposed: false,
        }
    }

    /// The store, for reads.
    #[must_use]
    pub const fn store(&self) -> &TaskStore {
        &self.store
    }

    /// The current status.
    #[must_use]
    pub const fn status(&self) -> &SyncStatus {
        &self.status
    }

    /// Load every piece of durable client state. Call once at startup.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure.
    pub fn restore(&mut self) -> Result<()> {
        self.store.restore()
    }

    /// Record a mutation, returning the optimistic result immediately.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure. Never a network failure — the
    /// enqueue is the only wait.
    pub fn dispatch(&mut self, input: super::commands::CommandInput) -> Result<Option<Task>> {
        let optimistic = self.store.dispatch(input)?;
        if self.auto_sync {
            self.request_sync();
        }
        Ok(optimistic)
    }

    /// Move a parked command back onto the queue.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure.
    pub fn retry_dead_letter(&mut self, id: &str) -> Result<()> {
        self.store.retry_dead_letter(id)?;
        if self.auto_sync {
            self.request_sync();
        }
        Ok(())
    }

    /// Drop a parked command for good.
    ///
    /// # Errors
    ///
    /// Propagates a storage-layer failure.
    pub fn discard_dead_letter(&mut self, id: &str) -> Result<()> {
        self.store.discard_dead_letter(id)
    }

    /// Arm a pass without running it. Safe from anywhere, any number of times.
    ///
    /// This is what a fired retry timer, a reconnect notification and a
    /// foreground transition all call. A disposed engine ignores it.
    pub fn request_sync(&mut self) {
        if self.disposed {
            return;
        }
        self.pass_requested = true;
    }

    /// Whether a pass has been armed and not yet run.
    #[must_use]
    pub const fn is_sync_requested(&self) -> bool {
        self.pass_requested
    }

    /// Run an armed pass, discarding its result.
    ///
    /// The counterpart of a fire-and-forget trigger: a host that called
    /// [`SyncEngine::request_sync`] and does not want the result calls this to
    /// let the work actually happen.
    pub fn settle(&mut self) {
        if self.disposed || !self.pass_requested {
            return;
        }
        drop(self.run_loop());
    }

    /// Stop this engine from initiating new work.
    ///
    /// Called when a replacement engine takes over the queue — the user
    /// changed the server URL, say. The retry timer is cancelled and no new one
    /// is armed, so a failure already in flight cannot resurrect a dead engine.
    pub fn dispose(&mut self) {
        self.disposed = true;
        self.clear_retry_timer();
    }

    /// Whether [`SyncEngine::dispose`] has been called.
    #[must_use]
    pub const fn is_disposed(&self) -> bool {
        self.disposed
    }

    /// Trigger a sync and run the loop to quiescence.
    ///
    /// A disposed engine ignores it, exactly as [`SyncEngine::request_sync`] and
    /// [`SyncEngine::settle`] do. The caller may be a host task that captured
    /// this engine before a replacement took over the queue — a changed server
    /// URL — and lost the race against [`SyncEngine::dispose`]. Draining the
    /// shared durable queue against the address the user just replaced away
    /// from is the failure this refusal exists to prevent, and it is a no-op
    /// rather than an error because the host did nothing wrong.
    ///
    /// # Errors
    ///
    /// The failure that stopped the drain or the pull. The queue is intact
    /// either way: a command is only removed once the server has acknowledged
    /// it or it has been parked.
    pub fn sync_now(&mut self) -> Result<()> {
        if self.disposed {
            return Ok(());
        }
        self.pass_requested = true;
        self.run_loop()
    }

    /// The drain loop.
    ///
    /// There is no re-entrancy guard here and none is needed: every entry point
    /// takes `&mut self`, so the compiler already forbids the overlap that the
    /// TypeScript engine's `inFlight` promise has to track by hand. Single
    /// flight is a type-system property in this port, not a runtime check.
    fn run_loop(&mut self) -> Result<()> {
        self.clear_retry_timer();

        let mut result = Ok(());
        while self.pass_requested {
            self.pass_requested = false;
            result = self.sync_once();
            if result.is_err() {
                break;
            }
        }

        if result.is_ok() {
            self.failure_streak = 0;
            self.set_status(SyncStatus {
                state: SyncState::Idle,
                last_error: None,
                next_retry_at: None,
            });
        }
        result
    }

    fn sync_once(&mut self) -> Result<()> {
        let Some(client) = self.client.clone() else {
            let error = Error::connection_with("API URL not configured");
            self.set_status(SyncStatus {
                state: SyncState::Unconfigured,
                last_error: Some(error.clone()),
                next_retry_at: None,
            });
            return Err(error);
        };
        self.set_status(SyncStatus {
            state: SyncState::Syncing,
            last_error: None,
            next_retry_at: None,
        });

        if let Err(error) = self.drain(client.as_ref()) {
            self.handle_stop_error(&error);
            return Err(error);
        }

        let pulled = match client.list_tasks() {
            Ok(tasks) => tasks,
            Err(error) => {
                self.handle_stop_error(&error);
                return Err(error);
            }
        };
        self.store.replace_base(pulled, self.clock.now_millis())
    }

    /// Send queued commands, oldest first, until the queue empties or a
    /// failure says to stop.
    fn drain(&mut self, client: &dyn TaskApi) -> Result<()> {
        loop {
            let Some(command) = self.store.queue().head().cloned() else {
                return Ok(());
            };

            match execute(client, &command) {
                Ok(server_task) => {
                    self.store
                        .apply_server_ack(&command, server_task.as_ref())?;
                }
                Err(error) => match classify(&error) {
                    FailureClass::Transient | FailureClass::Auth => return Err(error),
                    FailureClass::NotFound => {
                        if command.is_delete() {
                            // Already gone is the goal state. Anything else
                            // was renamed or deleted in Obsidian.
                            self.store.apply_server_ack(&command, None)?;
                        } else {
                            self.store.dead_letter_command(command.id(), &error)?;
                        }
                    }
                    FailureClass::Permanent => {
                        self.store.dead_letter_command(command.id(), &error)?;
                    }
                },
            }
        }
    }

    fn handle_stop_error(&mut self, error: &Error) {
        if classify(error) == FailureClass::Auth {
            self.set_status(SyncStatus {
                state: SyncState::AuthError,
                last_error: Some(error.clone()),
                next_retry_at: None,
            });
            return;
        }
        self.schedule_retry(error);
    }

    fn schedule_retry(&mut self, error: &Error) {
        if self.disposed {
            return;
        }
        self.failure_streak = self.failure_streak.saturating_add(1);
        let delay = self.backoff_delay();
        let next_retry_at = self.clock.now_millis().saturating_add(delay);
        self.set_status(SyncStatus {
            state: SyncState::Backoff,
            last_error: Some(error.clone()),
            next_retry_at: Some(next_retry_at),
        });
        self.clear_retry_timer();
        self.armed_retry = Some(self.scheduler.arm(delay));
    }

    /// `[1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, …]`, each with
    /// ±20% jitter.
    ///
    /// All integer arithmetic. A float route would need an `as` cast to land on
    /// a millisecond count, and `as` truncates silently — the jitter is
    /// therefore applied in parts per million, where a
    /// [`Randomness::next_unit_ppm`] of exactly half yields a factor of exactly
    /// 1.0 and the bare schedule above.
    fn backoff_delay(&self) -> i64 {
        let exponent = self
            .failure_streak
            .saturating_sub(1)
            .min(MAX_BACKOFF_EXPONENT);
        let raw = BACKOFF_BASE_MS
            .checked_shl(exponent)
            .unwrap_or(BACKOFF_MAX_MS)
            .clamp(BACKOFF_BASE_MS, BACKOFF_MAX_MS);

        let unit = self.random.next_unit_ppm().min(UNIT_PPM);
        // 1 ± 0.2, as ppm: 0.8 at unit 0, 1.0 at unit 0.5, 1.2 at unit 1.
        let factor = i64::from(UNIT_PPM)
            .saturating_sub(i64::from(BACKOFF_JITTER_PPM))
            .saturating_add(
                i64::from(unit)
                    .saturating_mul(2)
                    .saturating_mul(i64::from(BACKOFF_JITTER_PPM))
                    / i64::from(UNIT_PPM),
            );
        // Round half up, matching `Math.round`.
        raw.saturating_mul(factor)
            .saturating_add(i64::from(UNIT_PPM) / 2)
            / i64::from(UNIT_PPM)
    }

    fn clear_retry_timer(&mut self) {
        if let Some(timer) = self.armed_retry.take() {
            self.scheduler.cancel(timer);
        }
    }

    fn set_status(&mut self, status: SyncStatus) {
        self.status = status;
    }
}

/// Send one command, returning the authoritative task the server answered with.
///
/// A delete answers `None`: there is no task left to merge, and the store
/// removes it from the base on that basis.
fn execute(client: &dyn TaskApi, command: &Command) -> Result<Option<Task>> {
    let mutation_id = Some(command.id());
    match *command {
        Command::Create { ref payload, .. } => client.create_task(payload, mutation_id).map(Some),
        Command::Update {
            ref task_id,
            ref payload,
            ..
        } => client.update_task(task_id, payload, mutation_id).map(Some),
        Command::Delete { ref task_id, .. } => {
            client.delete_task(task_id, mutation_id).map(|()| None)
        }
        Command::SetStatus {
            ref task_id,
            status,
            ..
        } => client
            .toggle_task_status(task_id, status, mutation_id)
            .map(Some),
        Command::SetInstanceComplete { ref task_id, .. } => {
            let instance = command.instance_completion();
            client
                .complete_recurring_instance(task_id, instance.as_ref(), mutation_id)
                .map(Some)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    };

    use super::{SyncEngine, SyncState};
    use crate::{
        Error, Result,
        domain::{CreateTaskRequest, Task, TaskId, TaskStatus, UpdateTaskRequest},
        net::{InstanceCompletion, TaskApi},
        store::TaskStore,
        sync::{
            Clock, CommandInput, QueueStorage, Randomness, RetryScheduler, TaskCacheStorage,
            TimerId,
        },
    };

    #[derive(Default)]
    struct Memory {
        queue: Mutex<Option<String>>,
        dead: Mutex<Option<String>>,
        tasks: Mutex<Vec<Task>>,
        aliases: Mutex<Option<String>>,
        counters: Mutex<Option<String>>,
        restores: Mutex<Option<String>>,
        last_sync: Mutex<Option<i64>>,
    }

    impl QueueStorage for Memory {
        fn read_queue(&self) -> Result<Option<String>> {
            Ok(self.queue.lock().unwrap().clone())
        }
        fn write_queue(&self, data: &str) -> Result<()> {
            *self.queue.lock().unwrap() = Some(data.to_owned());
            Ok(())
        }
        fn read_dead_letter(&self) -> Result<Option<String>> {
            Ok(self.dead.lock().unwrap().clone())
        }
        fn write_dead_letter(&self, data: &str) -> Result<()> {
            *self.dead.lock().unwrap() = Some(data.to_owned());
            Ok(())
        }
    }

    impl TaskCacheStorage for Memory {
        fn read_tasks(&self) -> Result<Vec<Task>> {
            Ok(self.tasks.lock().unwrap().clone())
        }
        fn write_tasks(&self, tasks: &[Task]) -> Result<()> {
            *self.tasks.lock().unwrap() = tasks.to_vec();
            Ok(())
        }
        fn read_id_aliases(&self) -> Result<Option<String>> {
            Ok(self.aliases.lock().unwrap().clone())
        }
        fn write_id_aliases(&self, data: &str) -> Result<()> {
            *self.aliases.lock().unwrap() = Some(data.to_owned());
            Ok(())
        }
        fn read_id_counters(&self) -> Result<Option<String>> {
            Ok(self.counters.lock().unwrap().clone())
        }
        fn write_id_counters(&self, data: &str) -> Result<()> {
            *self.counters.lock().unwrap() = Some(data.to_owned());
            Ok(())
        }
        fn read_completion_restores(&self) -> Result<Option<String>> {
            Ok(self.restores.lock().unwrap().clone())
        }
        fn write_completion_restores(&self, data: &str) -> Result<()> {
            *self.restores.lock().unwrap() = Some(data.to_owned());
            Ok(())
        }
        fn read_last_sync_time(&self) -> Result<Option<i64>> {
            Ok(*self.last_sync.lock().unwrap())
        }
        fn write_last_sync_time(&self, millis: i64) -> Result<()> {
            *self.last_sync.lock().unwrap() = Some(millis);
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
        armed: Mutex<Vec<(TimerId, i64)>>,
    }

    impl RetryScheduler for Timers {
        fn arm(&self, delay_millis: i64) -> TimerId {
            let timer = TimerId::new(self.next.fetch_add(1, Ordering::Relaxed));
            self.armed.lock().unwrap().push((timer, delay_millis));
            timer
        }
        fn cancel(&self, timer: TimerId) {
            self.armed.lock().unwrap().retain(|&(id, _)| id != timer);
        }
    }

    /// Fails every call with a caller-chosen error, and counts attempts.
    struct AlwaysFails {
        error: Error,
        calls: AtomicU64,
    }

    impl AlwaysFails {
        fn new(error: Error) -> Self {
            Self {
                error,
                calls: AtomicU64::new(0),
            }
        }
        fn fail<T>(&self) -> Result<T> {
            self.calls.fetch_add(1, Ordering::Relaxed);
            Err(self.error.clone())
        }
    }

    impl TaskApi for AlwaysFails {
        fn list_tasks(&self) -> Result<Vec<Task>> {
            self.fail()
        }
        fn create_task(&self, _: &CreateTaskRequest, _: Option<&str>) -> Result<Task> {
            self.fail()
        }
        fn update_task(&self, _: &TaskId, _: &UpdateTaskRequest, _: Option<&str>) -> Result<Task> {
            self.fail()
        }
        fn delete_task(&self, _: &TaskId, _: Option<&str>) -> Result<()> {
            self.fail()
        }
        fn toggle_task_status(&self, _: &TaskId, _: TaskStatus, _: Option<&str>) -> Result<Task> {
            self.fail()
        }
        fn complete_recurring_instance(
            &self,
            _: &TaskId,
            _: Option<&InstanceCompletion>,
            _: Option<&str>,
        ) -> Result<Task> {
            self.fail()
        }
    }

    fn engine(client: Option<Arc<dyn TaskApi>>, auto_sync: bool) -> (SyncEngine, Arc<Timers>) {
        let memory = Arc::new(Memory::default());
        let timers = Arc::new(Timers::default());
        let store = TaskStore::new(
            memory.clone(),
            memory,
            Arc::new(FixedClock),
            Arc::new(HalfUnit),
        );
        (
            SyncEngine::new(
                client,
                store,
                Arc::new(FixedClock),
                timers.clone(),
                Arc::new(HalfUnit),
                auto_sync,
            ),
            timers,
        )
    }

    fn queue_a_delete(engine: &mut SyncEngine) {
        engine
            .dispatch(CommandInput::Delete {
                task_id: TaskId::parse("Tasks/a.md").unwrap(),
            })
            .unwrap();
    }

    #[test]
    fn the_engine_is_send_and_sync_so_the_ffi_can_wrap_it_in_a_mutex() {
        // Phase 6 exports a `Mutex<SyncEngine>` as a UniFFI object, which
        // requires `Send + Sync`. That holds only because every host trait
        // declares those as supertraits, so a shell cannot hand the core a
        // thread-bound storage or HTTP implementation. Asserting it here means
        // relaxing one of those bounds fails in this crate rather than in the
        // FFI crate, where the error would be a wall of macro expansion.
        const fn assert_send_sync<T: Send + Sync>() {}
        assert_send_sync::<SyncEngine>();
        assert_send_sync::<TaskStore>();
    }

    #[test]
    fn a_transient_failure_backs_off_on_the_documented_schedule() {
        let client = Arc::new(AlwaysFails::new(Error::connection()));
        let (mut engine, timers) = engine(Some(client), false);
        queue_a_delete(&mut engine);

        for expected in [
            1_000_i64, 2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000,
        ] {
            assert!(engine.sync_now().is_err());
            let armed = timers.armed.lock().unwrap().clone();
            assert_eq!(
                armed.iter().map(|&(_, delay)| delay).collect::<Vec<_>>(),
                vec![expected],
                "one timer, delay {expected}"
            );
            assert_eq!(engine.status().state, SyncState::Backoff);
            engine.request_sync();
        }
    }

    #[test]
    fn an_auth_failure_stops_the_drain_and_arms_no_retry() {
        let client = Arc::new(AlwaysFails::new(Error::api("unauthorized", 401)));
        let (mut engine, timers) = engine(Some(client), false);
        queue_a_delete(&mut engine);

        assert!(engine.sync_now().is_err());
        assert_eq!(engine.status().state, SyncState::AuthError);
        assert!(timers.armed.lock().unwrap().is_empty());
        assert_eq!(engine.store().snapshot().pending_count, 1);
    }

    #[test]
    fn overlapping_triggers_coalesce_into_one_pass() {
        let client = Arc::new(AlwaysFails::new(Error::connection()));
        let (mut engine, _) = engine(Some(client.clone()), false);
        queue_a_delete(&mut engine);

        engine.request_sync();
        engine.request_sync();
        engine.request_sync();
        assert!(engine.sync_now().is_err());

        assert_eq!(
            client.calls.load(Ordering::Relaxed),
            1,
            "three triggers plus one wait must be one attempt, not four"
        );
    }

    #[test]
    fn a_disposed_engine_cancels_its_retry_and_ignores_triggers() {
        let client = Arc::new(AlwaysFails::new(Error::connection()));
        let (mut engine, timers) = engine(Some(client.clone()), false);
        queue_a_delete(&mut engine);
        assert!(engine.sync_now().is_err());
        assert_eq!(timers.armed.lock().unwrap().len(), 1);

        engine.dispose();
        assert!(timers.armed.lock().unwrap().is_empty());

        engine.request_sync();
        engine.settle();
        assert_eq!(
            client.calls.load(Ordering::Relaxed),
            1,
            "a disposed engine must not start new work"
        );

        // An explicit sync is the same refusal: a host task holding the
        // superseded engine must not drain the shared queue against the server
        // address the user replaced away from.
        assert!(engine.sync_now().is_ok());
        assert_eq!(
            client.calls.load(Ordering::Relaxed),
            1,
            "a disposed engine must not run an explicit sync either"
        );
    }

    #[test]
    fn settle_runs_an_armed_pass_and_nothing_otherwise() {
        let client = Arc::new(AlwaysFails::new(Error::connection()));
        let (mut engine, _) = engine(Some(client.clone()), false);
        queue_a_delete(&mut engine);

        engine.settle();
        assert_eq!(client.calls.load(Ordering::Relaxed), 0, "nothing was armed");

        engine.request_sync();
        engine.settle();
        assert_eq!(client.calls.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn auto_sync_arms_a_pass_on_dispatch_without_running_it() {
        let client = Arc::new(AlwaysFails::new(Error::connection()));
        let (mut engine, _) = engine(Some(client.clone()), true);
        queue_a_delete(&mut engine);
        assert!(engine.is_sync_requested());
        assert_eq!(client.calls.load(Ordering::Relaxed), 0);
        engine.settle();
        assert_eq!(client.calls.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn an_unconfigured_engine_reports_itself_rather_than_pretending() {
        let (mut engine, timers) = engine(None, false);
        let error = engine.sync_now().unwrap_err();
        assert_eq!(engine.status().state, SyncState::Unconfigured);
        assert!(error.to_string().contains("API URL not configured"));
        assert!(
            timers.armed.lock().unwrap().is_empty(),
            "no amount of backing off produces a server URL — the state waits \
             for the user, not for a timer"
        );
    }
}
