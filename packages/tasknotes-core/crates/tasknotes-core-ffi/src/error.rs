//! The error every fallible exported function returns.
//!
//! A mirror of [`tasknotes_core::Error`] rather than a remote derive, for two
//! reasons. The core type is `#[non_exhaustive]`, which is right for Rust
//! consumers and wrong for an ABI — adding a variant must be a deliberate,
//! visible act here, because it changes the generated Swift `enum`. And the
//! mirror is where the "a panic must never cross the boundary" rule is
//! enforced: an unrecognised core variant becomes a loud
//! [`CoreError::Invariant`] carrying the thing it could not classify, not a
//! `todo!()` and not a silently dropped error.
//!
//! ## The mirror runs in both directions
//!
//! Phase 6.5 exports the sync stack's host traits as UniFFI *foreign* traits, so
//! a Swift storage or HTTP implementation now fails **inward**: the host returns
//! a [`CoreError`] and the core's [`TaskApi`](tasknotes_core::sync::TaskApi)
//! signature wants a [`tasknotes_core::Error`]. [`From<CoreError> for Error`]
//! closes that direction, and it must be lossless — the sync engine's retry
//! classifier branches on exactly `kind()` and `status()`, so a host's 503
//! arriving as anything other than `Api { status: 503 }` would silently turn a
//! transient failure into a dead-lettered command.
//!
//! [`From<CoreError> for Error`]: CoreError

use tasknotes_core::{Error, ErrorKind};

/// Everything the core can fail with, as the host sees it.
///
/// The variant order is the FFI discriminant — see the crate docs. Adding,
/// removing, or reordering a variant is an ABI change and shows up in the
/// committed bindings diff.
///
/// ⚠️ UniFFI keeps Rust's `PascalCase` for error cases, so this reads
/// `.Invariant(message:)` in Swift while a plain `uniffi::Enum` reads
/// `.inProgress`. That inconsistency is upstream and expected; the generated
/// target is lint-exempt, so it will not fail a build.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error, uniffi::Error)]
pub enum CoreError {
    /// A caller broke a documented contract, or the engine reached a state it
    /// believes is unreachable.
    #[error("invariant violated: {message}")]
    Invariant {
        /// What was expected, and what was seen instead.
        message: String,
    },

    /// The request never reached the server, or the response never arrived.
    #[error("{message}")]
    Network {
        /// What the transport reported.
        message: String,
    },

    /// The server answered with a non-success HTTP status.
    #[error("{message}")]
    Api {
        /// What the server said, or what the client inferred.
        message: String,
        /// The HTTP status. `0` is used for an envelope-level `success: false`,
        /// which carries no HTTP status of its own.
        status: u16,
    },

    /// A payload did not match its schema, in either direction.
    #[error("{message}")]
    Validation {
        /// Which field failed, and how.
        message: String,
    },

    /// The addressed resource does not exist.
    #[error("{message}")]
    NotFound {
        /// The rendered `"<resource> not found: <id>"` message.
        message: String,
    },

    /// No server could be reached at the configured address at all.
    #[error("{message}")]
    Connection {
        /// Why the connection could not be established.
        message: String,
    },
}

impl From<Error> for CoreError {
    fn from(error: Error) -> Self {
        let message = error.message().to_owned();
        match error.kind() {
            ErrorKind::Invariant => Self::Invariant { message },
            ErrorKind::Network => Self::Network { message },
            // `status()` is `Some` on exactly `Api` and `NotFound` — see
            // `tasknotes_core::Error::status`. A `None` here would mean the core
            // broke its own documented invariant, so it is reported as one
            // rather than papered over with a plausible-looking status code.
            ErrorKind::Api => match error.status() {
                Some(status) => Self::Api { message, status },
                None => Self::Invariant {
                    message: format!("an api error carried no http status: {message}"),
                },
            },
            ErrorKind::Validation => Self::Validation { message },
            ErrorKind::NotFound => Self::NotFound { message },
            ErrorKind::Connection => Self::Connection { message },
        }
    }
}

impl From<&Error> for CoreError {
    fn from(error: &Error) -> Self {
        Self::from(error.clone())
    }
}

impl From<CoreError> for Error {
    /// Lift a host-reported failure back into the core's error type.
    ///
    /// The inverse of [`From<Error> for CoreError`](CoreError::from), and
    /// exact: `kind()` and `status()` survive the round trip in both
    /// directions, which is what the retry classifier reads. `NotFound` is
    /// built by naming the variant rather than through
    /// [`Error::not_found`](tasknotes_core::Error::not_found), because that
    /// constructor *renders* `"<resource> not found: <id>"` and the message
    /// coming back from the host is already rendered — re-rendering it would
    /// nest the prefix.
    fn from(error: CoreError) -> Self {
        match error {
            CoreError::Invariant { message } => Self::Invariant { message },
            CoreError::Network { message } => Self::Network { message },
            CoreError::Api { message, status } => Self::Api { message, status },
            CoreError::Validation { message } => Self::Validation { message },
            CoreError::NotFound { message } => Self::NotFound { message },
            CoreError::Connection { message } => Self::Connection { message },
        }
    }
}

#[cfg(test)]
mod tests {
    use tasknotes_core::Error;

    use super::CoreError;

    #[test]
    fn maps_every_core_variant_onto_its_mirror() {
        assert_eq!(
            CoreError::from(Error::invariant("bug")),
            CoreError::Invariant {
                message: "bug".to_owned()
            }
        );
        assert_eq!(
            CoreError::from(Error::network("offline")),
            CoreError::Network {
                message: "offline".to_owned()
            }
        );
        assert_eq!(
            CoreError::from(Error::api("boom", 503)),
            CoreError::Api {
                message: "boom".to_owned(),
                status: 503
            }
        );
        assert_eq!(
            CoreError::from(Error::validation("bad")),
            CoreError::Validation {
                message: "bad".to_owned()
            }
        );
        assert_eq!(
            CoreError::from(Error::not_found("Task", "Tasks/gone.md")),
            CoreError::NotFound {
                message: "Task not found: Tasks/gone.md".to_owned()
            }
        );
        assert_eq!(
            CoreError::from(Error::connection()),
            CoreError::Connection {
                message: "Unable to connect to TaskNotes server".to_owned()
            }
        );
    }

    #[test]
    fn the_mirror_round_trips_every_variant_without_losing_kind_or_status() {
        // The engine's retry classifier reads exactly `kind()` and `status()`,
        // so a host failure that changes either on the way in would silently
        // reclassify a transient failure as a permanent one.
        for error in [
            Error::invariant("bug"),
            Error::network("offline"),
            Error::api("boom", 503),
            Error::api("envelope said no", 0),
            Error::validation("bad"),
            Error::not_found("Task", "Tasks/gone.md"),
            Error::connection(),
        ] {
            let lifted = Error::from(CoreError::from(&error));
            assert_eq!(lifted, error);
            assert_eq!(lifted.kind(), error.kind());
            assert_eq!(lifted.status(), error.status());
        }
    }

    #[test]
    fn a_not_found_message_is_not_re_rendered_on_the_way_back_in() {
        let lifted = Error::from(CoreError::NotFound {
            message: "Task not found: Tasks/gone.md".to_owned(),
        });
        assert_eq!(lifted.message(), "Task not found: Tasks/gone.md");
    }

    #[test]
    fn keeps_the_core_rendering_of_every_message() {
        for error in [
            Error::invariant("bug"),
            Error::network("offline"),
            Error::api("boom", 503),
            Error::not_found("Task", "Tasks/gone.md"),
            Error::connection(),
        ] {
            assert_eq!(CoreError::from(&error).to_string(), error.to_string());
        }
    }
}
