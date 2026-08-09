//! Everything the sync stack needs from the outside world, as traits.
//!
//! This module is where "sans-I/O" is actually spelled out. The core reads no
//! clock, opens no socket, touches no file and arms no timer: time,
//! randomness, scheduling and persistence all arrive through the traits
//! declared here, and a host shell — Swift on macOS, C# on Windows, a test
//! harness on Linux — supplies them.
//!
//! **The network is not here.** It is [`crate::net::HttpClient`], a byte-level
//! transport, and it is deliberately the only network capability a shell
//! implements: everything above the socket — the URL, the escaping, the wire
//! rename table, the envelope, and the HTTP-status → error mapping the retry
//! classifier reads — is core policy in [`crate::net::client`]. A domain-level
//! network trait lived here until Phase 4.5 and cost three shells three
//! implementations of one layer, one of which reordered the user's frontmatter.
//!
//! Two consequences are deliberate:
//!
//! * **UniFFI's missing async cancellation stops mattering.** UniFFI 0.31 has
//!   no cancellation support for async calls at all, so the core exposes
//!   synchronous, host-driven entry points instead: [`RetryScheduler::cancel`]
//!   and [`crate::net::HttpClient::cancel_all`] are ordinary methods, not
//!   dropped futures.
//! * **Every gate stays testable on Linux.** The scenario corpus drives these
//!   traits with a manual clock, a manual scheduler and an in-memory server.
//!
//! Every trait is `Send + Sync` because the FFI layer wraps the engine in a
//! `Mutex` and hands it to a host that will call it from more than one thread.

use crate::{Result, domain::Task};

/// Wall-clock time, and the device's calendar.
///
/// Both methods are host capabilities rather than one: `now_millis` is the
/// clock, and `local_ymd` needs the host's timezone database. Two places in
/// the stack genuinely want the device-local calendar rather than UTC — the
/// v0→v2 queue migration, which recovers the tapped day from a legacy
/// mutation's timestamp, and the recurring-completion flow that the migration
/// feeds. Everything else uses `now_millis` and stays timezone-free.
pub trait Clock: Send + Sync {
    /// Milliseconds since the Unix epoch.
    ///
    /// Signed, matching JavaScript's `Date.now()`, so a pre-1970 instant is
    /// representable rather than wrapping.
    fn now_millis(&self) -> i64;

    /// The device-local calendar date of an instant, as `YYYY-MM-DD`.
    fn local_ymd(&self, millis: i64) -> String;
}

/// The randomness the core needs, as an integer.
///
/// Deliberately **not** an `f64` in `[0, 1)` the way the TypeScript
/// `Math.random()` injection point is. Two reasons, both structural:
///
/// * The only consumer is the retry backoff's jitter, which must produce an
///   integer millisecond delay. An `f64` route needs a float-to-integer
///   conversion, and `as` is banned in this workspace precisely because it
///   truncates silently.
/// * Parts-per-million integer arithmetic is exact, so the backoff schedule is
///   reproducible bit-for-bit across platforms — which is the point of the
///   cross-platform determinism check.
///
/// The scenario corpus pins the TypeScript injection to `0.5`; the exact
/// counterpart here is [`HALF_UNIT_PPM`], which yields a jitter factor of
/// exactly 1.0 and therefore the bare backoff schedule.
pub trait Randomness: Send + Sync {
    /// A uniformly distributed value in `[0, 1_000_000)`.
    ///
    /// Implementations must stay inside that range; a larger value is clamped
    /// rather than trusted, so a broken host cannot push the backoff past its
    /// documented ceiling.
    fn next_unit_ppm(&self) -> u32;
}

/// One part per million — the divisor [`Randomness::next_unit_ppm`] is scaled
/// against.
pub const UNIT_PPM: u32 = 1_000_000;

/// The parts-per-million spelling of `0.5`.
///
/// The scenario fixtures inject exactly this so the jitter factor is 1.0 and
/// the observed delays are the bare `[1000, 2000, … 60000]` schedule.
pub const HALF_UNIT_PPM: u32 = UNIT_PPM / 2;

/// A retry timer the host owns.
///
/// Opaque on purpose: the core never inspects it, it only hands it back to
/// [`RetryScheduler::cancel`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct TimerId(u64);

impl TimerId {
    /// Wrap a host-assigned timer handle.
    #[must_use]
    pub const fn new(raw: u64) -> Self {
        Self(raw)
    }

    /// The host-assigned handle.
    #[must_use]
    pub const fn get(self) -> u64 {
        self.0
    }
}

/// Arms and cancels the single retry timer the engine keeps.
///
/// The host fires a timer by calling
/// [`SyncEngine::request_sync`](super::engine::SyncEngine::request_sync) — no
/// callback crosses the boundary, because UniFFI cannot express a closure and
/// a callback interface with a throwing method reproduces uniffi-rs#2818.
///
/// **`cancel` must be idempotent.** The engine cancels the timer it believes
/// is armed at the top of every drain, including the timer that just fired and
/// triggered that drain. Cancelling an already-fired or already-cancelled
/// timer is a no-op, never an error.
pub trait RetryScheduler: Send + Sync {
    /// Arm a timer that fires `delay_millis` from now.
    fn arm(&self, delay_millis: i64) -> TimerId;

    /// Cancel a previously armed timer. A no-op if it already fired.
    fn cancel(&self, timer: TimerId);
}

/// Durable storage for the command queue and its dead-letter list.
///
/// Both halves are opaque JSON strings rather than structured values, because
/// the on-disk format has to stay readable by the TypeScript client that wrote
/// it. Parsing is the core's job — see
/// [`CommandQueue::restore`](super::queue::CommandQueue::restore) — so the
/// host only moves bytes.
pub trait QueueStorage: Send + Sync {
    /// Read the persisted queue, or `None` when nothing was ever written.
    ///
    /// # Errors
    ///
    /// A storage-layer failure. The core does not retry.
    fn read_queue(&self) -> Result<Option<String>>;

    /// Persist the queue.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn write_queue(&self, data: &str) -> Result<()>;

    /// Read the persisted dead-letter list, or `None`.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn read_dead_letter(&self) -> Result<Option<String>>;

    /// Persist the dead-letter list.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn write_dead_letter(&self, data: &str) -> Result<()>;
}

/// Durable storage for the base task cache and the temp-id alias map.
///
/// The base cache is the last server snapshot, and the alias map remembers
/// which temp id became which server path. Note what is *not* here: the
/// rebased view. `rebase(base, pending)` is recomputed on every change and
/// never persisted, so no crash can capture half-applied optimistic state.
pub trait TaskCacheStorage: Send + Sync {
    /// Read the cached base snapshot.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn read_tasks(&self) -> Result<Vec<Task>>;

    /// Persist the base snapshot.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn write_tasks(&self, tasks: &[Task]) -> Result<()>;

    /// Read the persisted temp-id alias map as JSON, or `None`.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn read_id_aliases(&self) -> Result<Option<String>>;

    /// Persist the temp-id alias map as JSON.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn write_id_aliases(&self, data: &str) -> Result<()>;

    /// Read the last successful pull's timestamp.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn read_last_sync_time(&self) -> Result<Option<i64>>;

    /// Persist the last successful pull's timestamp.
    ///
    /// # Errors
    ///
    /// A storage-layer failure.
    fn write_last_sync_time(&self, millis: i64) -> Result<()>;
}
