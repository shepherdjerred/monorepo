//! The deterministic simulation harness: a manual clock, a manual retry
//! scheduler, and snapshot-able in-memory storage.
//!
//! Everything time- or persistence-dependent is injected, so a scenario
//! reproduces byte-for-byte on any machine in any timezone. The storages clone
//! cheaply and completely, which is what lets a scenario simulate a crash by
//! rebuilding the whole client from durable state alone.

use std::sync::{
    Mutex,
    atomic::{AtomicU64, Ordering},
};

use chrono::TimeZone as _;
use tasknotes_core::{
    Result,
    domain::Task,
    sync::{Clock, QueueStorage, Randomness, RetryScheduler, TaskCacheStorage, TimerId},
};

/// The default start instant, matching the TypeScript harness exactly.
pub const DEFAULT_CLOCK_MS: i64 = 1_750_000_000_000;

/// Lock a mutex, treating poisoning as the unrecoverable bug it is.
///
/// A poisoned mutex here means a previous assertion panicked while holding it,
/// so the run is already over; recovering the guard would only turn one clear
/// failure into a confusing second one.
fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().expect("the harness is single-threaded")
}

/// A clock the scenario moves by hand.
#[derive(Debug)]
pub struct ManualClock {
    current: Mutex<i64>,
}

impl ManualClock {
    /// Start the clock at a given instant.
    pub fn new(start_millis: i64) -> Self {
        Self {
            current: Mutex::new(start_millis),
        }
    }

    /// Move the clock to an absolute instant.
    pub fn set(&self, millis: i64) {
        *lock(&self.current) = millis;
    }

    /// The current instant.
    pub fn now(&self) -> i64 {
        *lock(&self.current)
    }
}

impl Clock for ManualClock {
    fn now_millis(&self) -> i64 {
        self.now()
    }

    fn local_ymd(&self, millis: i64) -> String {
        local_ymd(millis)
    }
}

/// The device-local calendar date of an instant.
///
/// Genuinely local, not UTC: the legacy `completeRecurringInstance` branch this
/// mirrors derives "today" from device-local getters, which is exactly why the
/// scenarios that exercise it pin the clock to a local wall-clock time rather
/// than an absolute instant.
pub fn local_ymd(millis: i64) -> String {
    chrono::DateTime::from_timestamp_millis(millis).map_or_else(
        || "1970-01-01".to_owned(),
        |instant| {
            instant
                .with_timezone(&chrono::Local)
                .format("%Y-%m-%d")
                .to_string()
        },
    )
}

/// Interpret a naive local wall-clock time as an instant.
///
/// # Errors
///
/// A value that is not `YYYY-MM-DDTHH:MM:SS`, or that names a wall-clock time
/// the host's timezone skips or repeats across a DST transition.
pub fn local_naive_millis(value: &str) -> core::result::Result<i64, String> {
    let naive = chrono::NaiveDateTime::parse_from_str(value, "%Y-%m-%dT%H:%M:%S")
        .map_err(|error| format!("{value:?} is not a local wall-clock time: {error}"))?;
    chrono::Local
        .from_local_datetime(&naive)
        .single()
        .map(|instant| instant.timestamp_millis())
        .ok_or_else(|| format!("{value:?} is ambiguous or skipped in the host's timezone"))
}

/// The randomness source the fixtures pin.
///
/// The TypeScript harness injects `random: () => 0.5`; this is the exact
/// counterpart, and it makes the jitter factor 1.0 so the observed backoff is
/// the bare `[1000, 2000, …]` schedule.
#[derive(Debug, Default)]
pub struct HalfUnitRandomness;

impl Randomness for HalfUnitRandomness {
    fn next_unit_ppm(&self) -> u32 {
        tasknotes_core::sync::HALF_UNIT_PPM
    }
}

/// One armed timer.
#[derive(Debug, Clone, Copy)]
struct Entry {
    timer: TimerId,
    delay: i64,
    cancelled: bool,
    fired: bool,
}

/// Captures retry timers so the scenario decides when — and whether — they
/// fire.
#[derive(Debug, Default)]
pub struct ManualScheduler {
    next: AtomicU64,
    entries: Mutex<Vec<Entry>>,
}

impl ManualScheduler {
    /// The delays of every timer that is armed and has neither fired nor been
    /// cancelled.
    pub fn pending_delays(&self) -> Vec<i64> {
        lock(&self.entries)
            .iter()
            .filter(|entry| !entry.cancelled && !entry.fired)
            .map(|entry| entry.delay)
            .collect()
    }

    /// Mark the oldest live timer as fired.
    ///
    /// The caller is then responsible for the trigger itself — in the real app
    /// the timer callback calls `requestSync`, and the scenario runner does the
    /// same.
    ///
    /// # Errors
    ///
    /// No timer is armed.
    pub fn fire_next(&self) -> core::result::Result<(), String> {
        let mut entries = lock(&self.entries);
        let entry = entries
            .iter_mut()
            .find(|entry| !entry.cancelled && !entry.fired)
            .ok_or_else(|| "no pending timer".to_owned())?;
        entry.fired = true;
        Ok(())
    }
}

impl RetryScheduler for ManualScheduler {
    fn arm(&self, delay_millis: i64) -> TimerId {
        let timer = TimerId::new(self.next.fetch_add(1, Ordering::Relaxed));
        lock(&self.entries).push(Entry {
            timer,
            delay: delay_millis,
            cancelled: false,
            fired: false,
        });
        timer
    }

    fn cancel(&self, timer: TimerId) {
        for entry in lock(&self.entries).iter_mut() {
            if entry.timer == timer && !entry.fired {
                entry.cancelled = true;
            }
        }
    }
}

/// In-memory command-queue storage that can be cloned wholesale.
#[derive(Debug, Default)]
pub struct MemoryQueueStorage {
    queue: Mutex<Option<String>>,
    dead: Mutex<Option<String>>,
}

impl MemoryQueueStorage {
    /// An independent copy of the durable bytes as they stand right now.
    ///
    /// This is the crash simulation: what a relaunch gets back is exactly this
    /// and nothing else.
    pub fn snapshot(&self) -> Self {
        Self {
            queue: Mutex::new(lock(&self.queue).clone()),
            dead: Mutex::new(lock(&self.dead).clone()),
        }
    }
}

impl QueueStorage for MemoryQueueStorage {
    fn read_queue(&self) -> Result<Option<String>> {
        Ok(lock(&self.queue).clone())
    }

    fn write_queue(&self, data: &str) -> Result<()> {
        *lock(&self.queue) = Some(data.to_owned());
        Ok(())
    }

    fn read_dead_letter(&self) -> Result<Option<String>> {
        Ok(lock(&self.dead).clone())
    }

    fn write_dead_letter(&self, data: &str) -> Result<()> {
        *lock(&self.dead) = Some(data.to_owned());
        Ok(())
    }
}

/// In-memory base-cache storage that can be cloned wholesale.
#[derive(Debug, Default)]
pub struct MemoryCacheStorage {
    tasks: Mutex<Vec<Task>>,
    aliases: Mutex<Option<String>>,
    counters: Mutex<Option<String>>,
    last_sync: Mutex<Option<i64>>,
}

impl MemoryCacheStorage {
    /// An independent copy of the durable bytes as they stand right now.
    ///
    /// The id counters are carried like everything else, which is the whole
    /// point: a relaunch that forgot them would be simulating a *different*
    /// device than the one the scenario describes, and the persisted-counter
    /// mechanism would be untestable here.
    pub fn snapshot(&self) -> Self {
        Self {
            tasks: Mutex::new(lock(&self.tasks).clone()),
            aliases: Mutex::new(lock(&self.aliases).clone()),
            counters: Mutex::new(lock(&self.counters).clone()),
            last_sync: Mutex::new(*lock(&self.last_sync)),
        }
    }
}

impl TaskCacheStorage for MemoryCacheStorage {
    fn read_tasks(&self) -> Result<Vec<Task>> {
        Ok(lock(&self.tasks).clone())
    }

    fn write_tasks(&self, tasks: &[Task]) -> Result<()> {
        *lock(&self.tasks) = tasks.to_vec();
        Ok(())
    }

    fn read_id_aliases(&self) -> Result<Option<String>> {
        Ok(lock(&self.aliases).clone())
    }

    fn write_id_aliases(&self, data: &str) -> Result<()> {
        *lock(&self.aliases) = Some(data.to_owned());
        Ok(())
    }

    fn read_id_counters(&self) -> Result<Option<String>> {
        Ok(lock(&self.counters).clone())
    }

    fn write_id_counters(&self, data: &str) -> Result<()> {
        *lock(&self.counters) = Some(data.to_owned());
        Ok(())
    }

    fn read_last_sync_time(&self) -> Result<Option<i64>> {
        Ok(*lock(&self.last_sync))
    }

    fn write_last_sync_time(&self, millis: i64) -> Result<()> {
        *lock(&self.last_sync) = Some(millis);
        Ok(())
    }
}
