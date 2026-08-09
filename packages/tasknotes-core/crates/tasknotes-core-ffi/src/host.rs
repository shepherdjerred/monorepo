//! The non-network host capabilities, as UniFFI foreign traits.
//!
//! `tasknotes-core` is sans-I/O: it reads no clock, opens no socket, touches no
//! file and arms no timer. Time, randomness, timers and storage arrive through
//! the traits in [`tasknotes_core::sync::host`] plus
//! [`tasknotes_core::store::migrations::MigrationStorage`], and this module is
//! where a *Swift* (or, later, C#) implementation of each becomes possible:
//! `#[uniffi::export(with_foreign)]` generates the vtable that lets foreign
//! code implement a Rust trait, not merely call one.
//!
//! **The network is not here.** It is [`crate::net::HttpClient`], a byte-level
//! transport, and it is deliberately the only network capability a shell
//! implements: everything above the socket is core policy. See [`crate::net`]
//! for what that bought and what it cost while it was not true.
//!
//! ## Why these are declarations and not re-exports
//!
//! Each trait here is a **restatement** of its core counterpart with two
//! mechanical differences, and an adapter that bridges them:
//!
//! | difference | why |
//! |---|---|
//! | `Result<T, CoreError>` instead of `Result<T, tasknotes_core::Error>` | the core error is `#[non_exhaustive]` and not a UniFFI type; [`CoreError`] is its ABI mirror, and [`crate::error`] closes the conversion in both directions |
//! | owned parameters instead of `&[Task]` / `&str` | UniFFI lifts a value out of the FFI buffer, so there is no borrow to hand across; the adapter clones at the boundary and the core keeps its allocation-free internal signatures |
//!
//! The adapters are the only place either translation happens, and every one of
//! them is a one-line forward. Nothing branches, nothing decides.
//!
//! ## uniffi-rs#2818
//!
//! **Every trait here has throwing methods**, which is precisely the shape that
//! reproduces uniffi-rs#2818 — a callback interface with a throwing method
//! cannot be compiled inside a `MainActor`-isolated module. The mitigation is
//! `.defaultIsolation(nil)` on the Swift bindings target, which
//! `bindings/Package.swift` already sets. Do not "fix" it by making a method
//! non-throwing: a storage layer that cannot report failure is a storage layer
//! that loses the user's offline work silently.
//!
//! ## Threading
//!
//! Every trait is `Send + Sync`, because [`crate::engine::FfiSyncEngine`] wraps
//! the engine in a `Mutex` and hands it to a host that will call it from more
//! than one thread. `tasknotes-core` asserts the same bound in a unit test, so
//! relaxing it fails there rather than in a wall of macro expansion here.

use std::sync::Arc;

use tasknotes_core::{
    Result as CoreResult,
    domain::Task,
    store::migrations::MigrationStorage as CoreMigrationStorage,
    sync::{
        Clock as CoreClock, QueueStorage as CoreQueueStorage, Randomness as CoreRandomness,
        RetryScheduler as CoreRetryScheduler, TaskCacheStorage as CoreTaskCacheStorage, TimerId,
    },
};

use crate::error::CoreError;

// ── Time, randomness and timers ────────────────────────────────────────────

/// Wall-clock time, and the device's calendar.
///
/// See [`tasknotes_core::sync::Clock`]. Two capabilities rather than one:
/// `now_millis` is the clock, and `local_ymd` needs the host's timezone
/// database. Everything except the queue migration and the recurring-completion
/// flow it feeds stays on `now_millis` and is therefore timezone-free.
#[uniffi::export(with_foreign)]
pub trait Clock: Send + Sync {
    /// Milliseconds since the Unix epoch, signed, matching `Date.now()`.
    fn now_millis(&self) -> i64;

    /// The device-local calendar date of an instant, as `YYYY-MM-DD`.
    fn local_ymd(&self, millis: i64) -> String;
}

/// The randomness the retry backoff's jitter needs, as an integer.
///
/// See [`tasknotes_core::sync::Randomness`]. Deliberately parts-per-million
/// rather than a float in `[0, 1)`: integer arithmetic is exact, so the backoff
/// schedule is reproducible bit-for-bit across platforms, and no `as` cast is
/// needed to land on a millisecond count.
#[uniffi::export(with_foreign)]
pub trait Randomness: Send + Sync {
    /// A uniformly distributed value in `[0, 1_000_000)`.
    ///
    /// A larger value is clamped by the core rather than trusted, so a broken
    /// host cannot push the backoff past its documented ceiling.
    fn next_unit_ppm(&self) -> u32;
}

/// Arms and cancels the single retry timer the engine keeps.
///
/// See [`tasknotes_core::sync::RetryScheduler`]. **No callback crosses the
/// boundary**: the host fires a timer by calling
/// [`FfiSyncEngine::request_sync`](crate::engine::FfiSyncEngine::request_sync)
/// and then `settle`, because UniFFI cannot express a closure.
///
/// **`cancel` must be idempotent.** The engine cancels the timer it believes is
/// armed at the top of every drain, including the one that just fired and
/// triggered that drain.
#[uniffi::export(with_foreign)]
pub trait RetryScheduler: Send + Sync {
    /// Arm a timer that fires `delay_millis` from now.
    fn arm(&self, delay_millis: i64) -> TimerId;

    /// Cancel a previously armed timer. A no-op if it already fired.
    fn cancel(&self, timer: TimerId);
}

// ── Persistence ────────────────────────────────────────────────────────────

/// Durable storage for the command queue and its dead-letter list.
///
/// See [`tasknotes_core::sync::QueueStorage`]. Both halves are opaque JSON
/// strings rather than structured values, because the on-disk format has to
/// stay readable by the TypeScript client that wrote it. Parsing is the core's
/// job; the host only moves bytes.
#[uniffi::export(with_foreign)]
pub trait QueueStorage: Send + Sync {
    /// Read the persisted queue, or `None` when nothing was ever written.
    ///
    /// # Errors
    ///
    /// A storage-layer failure. The core does not retry.
    fn read_queue(&self) -> Result<Option<String>, CoreError>;

    /// Persist the queue.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn write_queue(&self, data: String) -> Result<(), CoreError>;

    /// Read the persisted dead-letter list, or `None`.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn read_dead_letter(&self) -> Result<Option<String>, CoreError>;

    /// Persist the dead-letter list.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn write_dead_letter(&self, data: String) -> Result<(), CoreError>;
}

/// Durable storage for the base task cache and the temp-id alias map.
///
/// See [`tasknotes_core::sync::TaskCacheStorage`]. Note what is *not* here: the
/// rebased view. `rebase(base, pending)` is recomputed on every change and
/// never persisted, so no crash can capture half-applied optimistic state.
#[uniffi::export(with_foreign)]
pub trait TaskCacheStorage: Send + Sync {
    /// Read the cached base snapshot.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn read_tasks(&self) -> Result<Vec<Task>, CoreError>;

    /// Persist the base snapshot.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn write_tasks(&self, tasks: Vec<Task>) -> Result<(), CoreError>;

    /// Read the persisted temp-id alias map as JSON, or `None`.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn read_id_aliases(&self) -> Result<Option<String>, CoreError>;

    /// Persist the temp-id alias map as JSON.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn write_id_aliases(&self, data: String) -> Result<(), CoreError>;

    /// Read the persisted id counters as JSON, or `None`.
    ///
    /// `None` is the fresh-install path *and* the upgrade path, and neither is
    /// a failure — see
    /// [`tasknotes_core::sync::TaskCacheStorage::read_id_counters`].
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn read_id_counters(&self) -> Result<Option<String>, CoreError>;

    /// Persist the id counters as JSON.
    ///
    /// A slot of its own rather than a field folded into the queue or the alias
    /// blob, because both of those are formats shared with the TypeScript
    /// client and both "simplifications" lose user data silently. The reasoning
    /// is on
    /// [`tasknotes_core::sync::TaskCacheStorage::write_id_counters`]; read it
    /// before consolidating these keys.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn write_id_counters(&self, data: String) -> Result<(), CoreError>;

    /// Read the last successful pull's timestamp.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn read_last_sync_time(&self) -> Result<Option<i64>, CoreError>;

    /// Persist the last successful pull's timestamp.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn write_last_sync_time(&self, millis: i64) -> Result<(), CoreError>;
}

/// Durable storage for the v0→v2 migration itself.
///
/// See [`tasknotes_core::store::migrations::MigrationStorage`]. Separate from
/// [`QueueStorage`] because the migration reads a key — the legacy queue — that
/// nothing else in the stack knows about, and removes it once converted.
#[uniffi::export(with_foreign)]
pub trait MigrationStorage: Send + Sync {
    /// The stored schema version; `0` when absent.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn read_schema_version(&self) -> Result<u32, CoreError>;

    /// Record the schema version.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn write_schema_version(&self, version: u32) -> Result<(), CoreError>;

    /// The v1 mutation queue, if one was ever written.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn read_legacy_queue(&self) -> Result<Option<String>, CoreError>;

    /// Drop the v1 mutation queue.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn remove_legacy_queue(&self) -> Result<(), CoreError>;

    /// The v2 command queue, if one was ever written.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn read_queue(&self) -> Result<Option<String>, CoreError>;

    /// Write the v2 command queue.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn write_queue(&self, data: String) -> Result<(), CoreError>;
}

// ── Adapters ───────────────────────────────────────────────────────────────
//
// One per trait, each a pure forward. The `Into::into` on every `Result` is the
// `CoreError` → `tasknotes_core::Error` mirror from [`crate::error`]; it is
// lossless in `kind()` and `status()`, which is what the retry classifier
// reads.

/// Adapts a host [`Clock`] onto [`tasknotes_core::sync::Clock`].
pub(crate) struct ClockAdapter(pub(crate) Arc<dyn Clock>);

impl CoreClock for ClockAdapter {
    fn now_millis(&self) -> i64 {
        self.0.now_millis()
    }

    fn local_ymd(&self, millis: i64) -> String {
        self.0.local_ymd(millis)
    }
}

/// Adapts a host [`Randomness`] onto [`tasknotes_core::sync::Randomness`].
pub(crate) struct RandomnessAdapter(pub(crate) Arc<dyn Randomness>);

impl CoreRandomness for RandomnessAdapter {
    fn next_unit_ppm(&self) -> u32 {
        self.0.next_unit_ppm()
    }
}

/// Adapts a host [`RetryScheduler`] onto
/// [`tasknotes_core::sync::RetryScheduler`].
pub(crate) struct RetrySchedulerAdapter(pub(crate) Arc<dyn RetryScheduler>);

impl CoreRetryScheduler for RetrySchedulerAdapter {
    fn arm(&self, delay_millis: i64) -> TimerId {
        self.0.arm(delay_millis)
    }

    fn cancel(&self, timer: TimerId) {
        self.0.cancel(timer);
    }
}

/// Adapts a host [`QueueStorage`] onto [`tasknotes_core::sync::QueueStorage`].
pub(crate) struct QueueStorageAdapter(pub(crate) Arc<dyn QueueStorage>);

impl CoreQueueStorage for QueueStorageAdapter {
    fn read_queue(&self) -> CoreResult<Option<String>> {
        self.0.read_queue().map_err(Into::into)
    }

    fn write_queue(&self, data: &str) -> CoreResult<()> {
        self.0.write_queue(data.to_owned()).map_err(Into::into)
    }

    fn read_dead_letter(&self) -> CoreResult<Option<String>> {
        self.0.read_dead_letter().map_err(Into::into)
    }

    fn write_dead_letter(&self, data: &str) -> CoreResult<()> {
        self.0
            .write_dead_letter(data.to_owned())
            .map_err(Into::into)
    }
}

/// Adapts a host [`TaskCacheStorage`] onto
/// [`tasknotes_core::sync::TaskCacheStorage`].
pub(crate) struct TaskCacheStorageAdapter(pub(crate) Arc<dyn TaskCacheStorage>);

impl CoreTaskCacheStorage for TaskCacheStorageAdapter {
    fn read_tasks(&self) -> CoreResult<Vec<Task>> {
        self.0.read_tasks().map_err(Into::into)
    }

    fn write_tasks(&self, tasks: &[Task]) -> CoreResult<()> {
        self.0.write_tasks(tasks.to_vec()).map_err(Into::into)
    }

    fn read_id_aliases(&self) -> CoreResult<Option<String>> {
        self.0.read_id_aliases().map_err(Into::into)
    }

    fn write_id_aliases(&self, data: &str) -> CoreResult<()> {
        self.0.write_id_aliases(data.to_owned()).map_err(Into::into)
    }

    fn read_id_counters(&self) -> CoreResult<Option<String>> {
        self.0.read_id_counters().map_err(Into::into)
    }

    fn write_id_counters(&self, data: &str) -> CoreResult<()> {
        self.0
            .write_id_counters(data.to_owned())
            .map_err(Into::into)
    }

    fn read_last_sync_time(&self) -> CoreResult<Option<i64>> {
        self.0.read_last_sync_time().map_err(Into::into)
    }

    fn write_last_sync_time(&self, millis: i64) -> CoreResult<()> {
        self.0.write_last_sync_time(millis).map_err(Into::into)
    }
}

/// Adapts a host [`MigrationStorage`] onto
/// [`tasknotes_core::store::migrations::MigrationStorage`].
pub(crate) struct MigrationStorageAdapter(pub(crate) Arc<dyn MigrationStorage>);

impl CoreMigrationStorage for MigrationStorageAdapter {
    fn read_schema_version(&self) -> CoreResult<u32> {
        self.0.read_schema_version().map_err(Into::into)
    }

    fn write_schema_version(&self, version: u32) -> CoreResult<()> {
        self.0.write_schema_version(version).map_err(Into::into)
    }

    fn read_legacy_queue(&self) -> CoreResult<Option<String>> {
        self.0.read_legacy_queue().map_err(Into::into)
    }

    fn remove_legacy_queue(&self) -> CoreResult<()> {
        self.0.remove_legacy_queue().map_err(Into::into)
    }

    fn read_queue(&self) -> CoreResult<Option<String>> {
        self.0.read_queue().map_err(Into::into)
    }

    fn write_queue(&self, data: &str) -> CoreResult<()> {
        self.0.write_queue(data.to_owned()).map_err(Into::into)
    }
}
