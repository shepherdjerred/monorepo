//! The UniFFI boundary for [`tasknotes_core`].
//!
//! This crate holds the FFI surface and nothing else: no domain logic, no
//! algorithms, no state machines. Everything here is a thin projection of
//! `tasknotes-core` so that the pure crate can keep `#![forbid(unsafe_code)]`
//! and stay tractable for mutation testing, miri, and coverage thresholds.
//!
//! ## Why there is no `#[expect(unsafe_code)]` here
//!
//! `uniffi::setup_scaffolding!()` and `#[uniffi::export]` do expand to
//! `unsafe extern "C"` items inside *this* crate (`uniffi_macros` 0.31.2,
//! `setup_scaffolding.rs` and `export/scaffolding.rs`). But rustc's
//! `unsafe_code` lint skips spans that originate in an external macro, so as
//! of rustc 1.97.1 those items produce no diagnostic at all — measured, not
//! assumed: `#![forbid(unsafe_code)]` compiles clean on this crate today.
//!
//! So the workspace-wide `unsafe_code = "deny"` is inherited as-is with no
//! crate-level attribute. An `#[expect(unsafe_code, ...)]` would be
//! *unfulfilled*, and `unfulfilled_lint_expectations` is denied — a suppression
//! that suppresses nothing is exactly what that gate exists to reject. `deny`
//! rather than `forbid` is deliberate: it still fails any hand-written `unsafe`
//! in this crate (verified), while leaving a documented `#[expect]` available
//! if a future toolchain stops exempting external macros.
//!
//! ## How the projection is built
//!
//! | mechanism | used for | module |
//! |---|---|---|
//! | `uniffi::custom_type!` | the validated string newtypes, `ExtraFields`, `TimerId` | [`convert`] |
//! | `#[uniffi::remote(...)]` | core enums and records that are already exportable | [`types`] |
//! | hand-written mirrors | only where UniFFI cannot express the core type | [`update`], [`error`], [`command`], [`engine`] |
//! | `#[uniffi::export(with_foreign)]` | the traits the *host* implements | [`host`], [`net`] |
//! | `#[derive(uniffi::Object)]` | the one stateful handle, the sync engine | [`engine`] |
//! | `#[uniffi::export]` | the callable surface | [`api`], [`engine`], [`net`], [`recurrence`], [`dates`], [`calendar`], [`nlp`], [`elapsed`] |
//!
//! Preferring `#[uniffi::remote(...)]` over mirrored structs is deliberate: a
//! remote derive re-states the core type's fields *in this crate*, so the ABI
//! is declared in one visible place, and any change to the core struct — a
//! renamed field, a changed type, a field added or removed — becomes a compile
//! error here instead of a silent binding change.
//!
//! ## ABI hazards this crate must respect
//!
//! - UniFFI `Record` fields are **positional** in the FFI buffer. Reordering
//!   fields is a silent ABI break that no Rust tool catches — the committed
//!   `bindings/` directory plus `git diff --exit-code` is the only guard.
//!   Measured during the Phase 6 spike: swapping two same-typed record fields
//!   left all API checksums *and* the generated C header byte-identical.
//!   `cargo xtask check-bindings` is therefore load-bearing, not cosmetic.
//! - Enum variant order is the discriminant, with the same consequence.
//! - UniFFI async has no cancellation support whatsoever. Long-running work
//!   gets an explicit `cancel()`-style API, never a dropped future.
//! - Panics must not escape into `catch_unwind`; return a typed [`CoreError`]
//!   instead.

uniffi::setup_scaffolding!("TaskNotesCore");

pub mod api;
pub mod calendar;
pub mod command;
pub mod convert;
pub mod dates;
pub mod elapsed;
pub mod engine;
pub mod error;
pub mod host;
pub mod net;
pub mod nlp;
pub mod recurrence;
pub mod types;
pub mod update;

pub use api::core_version;
pub use command::{Command, CommandInput, DeadLetterEntry};
pub use engine::{FfiSyncEngine, SyncStatus, TaskStoreSnapshot, run_migrations};
pub use error::CoreError;
pub use host::{
    Clock, MigrationStorage, QueueStorage, Randomness, RetryScheduler, TaskCacheStorage,
};
pub use net::{HttpClient, TaskNotesApi, TransportError};
pub use update::{MinutesUpdate, RecurrenceAnchorUpdate, TextUpdate, UpdateTaskRequest};
