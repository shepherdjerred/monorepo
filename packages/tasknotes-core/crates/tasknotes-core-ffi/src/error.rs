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
