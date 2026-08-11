//! The pure TaskNotes core.
//!
//! Everything in this crate is deterministic and sans-I/O: no clock, no
//! filesystem, no network, no platform APIs. HTTP and storage are traits the
//! host shell implements, which keeps `URLSession` on Apple, keeps this crate
//! testable on Linux, and sidesteps UniFFI's total lack of async cancellation.
//!
//! The HTTP trait is a **transport** — [`net::HttpClient`], bytes out and bytes
//! in — not a domain API. Everything above the socket, including URL
//! construction and escaping, the wire rename table, the response envelope and
//! the HTTP-status → [`Error`] mapping the retry classifier reads, is owned
//! here in [`net::client`] so that no shell has to reimplement it and no two
//! shells can disagree about it.
//!
//! This crate deliberately has **no** `uniffi` dependency, and
//! `tasknotes-core-ffi` exists as a separate crate. Note that the reason is
//! *not* that the two cannot coexist: UniFFI scaffolding does expand to
//! `unsafe extern "C"` items inside its host crate, but rustc's `unsafe_code`
//! lint skips spans originating in an external macro, so `#![forbid(unsafe_code)]`
//! compiles clean even alongside it (verified at uniffi 0.31.2 / rustc 1.97.1).
//!
//! The split earns its keep for different reasons: this crate keeps `forbid`
//! against *hand-written* `unsafe` with no escape hatch, and isolating the FFI
//! layer is what makes coverage thresholds, `cargo-mutants`, and miri tractable
//! — they run here, against a crate with no FFI noise to filter out.

#![forbid(unsafe_code)]

pub mod calendar;
pub mod dates;
pub mod domain;
pub mod elapsed;
pub mod net;
pub mod nlp;
pub mod recurrence;
pub mod store;
pub mod sync;

mod error;

pub use error::{
    DEFAULT_CONNECTION_MESSAGE, Error, ErrorKind, NOT_FOUND_STATUS, Result, SerializedError,
};
