//! The offline-first sync stack: the command algebra, the durable queue, and
//! the single-flight drain.
//!
//! ## The shape of the layer
//!
//! | module | role |
//! |---|---|
//! | [`host`] | every trait the stack needs from the outside world |
//! | [`commands`] | the algebra: absolute commands, the rebase step, the retry classifier |
//! | [`queue`] | the durable FIFO queue and its dead-letter list |
//! | [`engine`] | the single-flight drain, the backoff, the failure policy |
//!
//! The rebasing projection lives one module over, in
//! [`crate::store`], because it is what the UI reads rather than part of the
//! sync protocol.
//!
//! ## The three invariants worth stating once
//!
//! **Commands carry absolute state, never a delta.** "Set this task to done",
//! not "toggle it". Replaying an absolute command is a no-op, which is what
//! makes both the on-device rebase and the server-side replay safe.
//!
//! **The command id is the idempotency key.** It is minted once, persisted with
//! the command, and sent as `X-Mutation-Id` on every attempt — including the
//! attempt that follows a crash between the server's ack and the client's
//! dequeue. The server answers the replay from its idempotency store instead of
//! applying it again.
//!
//! **Only two things are durable.** The command queue, written on dispatch, and
//! the base task cache, written on ack and on pull. The rebased view is
//! recomputed every time and never written, so there is no crash window in
//! which half-applied optimistic state can be captured.

pub mod commands;
pub mod engine;
pub mod host;
pub mod queue;

pub use commands::{
    Command, CommandInput, FailureClass, apply_command, classify, command_id, materialize_create,
    rebase, remap_task_id,
};
pub use engine::{BACKOFF_BASE_MS, BACKOFF_MAX_MS, SyncEngine, SyncState, SyncStatus};
pub use host::{
    Clock, HALF_UNIT_PPM, InstanceCompletion, QueueStorage, Randomness, RetryScheduler, TaskApi,
    TaskCacheStorage, TimerId, UNIT_PPM,
};
pub use queue::{CommandQueue, DeadLetterEntry, DeadLetterError};
