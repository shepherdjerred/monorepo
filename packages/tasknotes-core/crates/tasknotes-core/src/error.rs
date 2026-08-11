//! The single error type crossing out of the core.
//!
//! Contract violations are a typed [`Error::Invariant`] variant rather than a
//! panic. A panic is caught by UniFFI's `catch_unwind`, but it surfaces to the
//! host as an untyped internal error, can poison a `Mutex`, and leaves the
//! engine in an unknown state. A typed variant is louder, not quieter: it is
//! logged, reported, and returned across the FFI with its message intact.
//!
//! The remaining variants mirror the TypeScript client's tagged error union
//! (`src/domain/errors.ts`) one-for-one, because a `Result` failure has to
//! round-trip through the language-neutral JSON scenario fixtures that drive
//! both implementations. That serialized shape is `{kind, message, status?}`,
//! modelled here by [`SerializedError`].
//!
//! Two details of the TypeScript union are load-bearing and easy to get wrong:
//!
//! * `not_found` is a **sibling** of `api`, not a subclass of it. A subclass
//!   cannot narrow the inherited tag, and the point of the tag is that each
//!   error is exactly one variant.
//! * `status` is present on exactly `api` and `not_found`, and on `not_found`
//!   it is always `404`. [`SerializedError`] enforces both on the way in, so a
//!   parsed [`Error`] can never carry a contradictory status.

use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// The message [`Error::connection`] uses when the host does not supply one.
///
/// Byte-identical to the TypeScript `ConnectionError` default so that a
/// connection failure renders the same string on every platform.
pub const DEFAULT_CONNECTION_MESSAGE: &str = "Unable to connect to TaskNotes server";

/// The HTTP status a `not_found` error always carries.
pub const NOT_FOUND_STATUS: u16 = 404;

/// The closed set of error tags.
///
/// This is the discriminant of the serialized form, so the spellings here are
/// a wire format shared with the TypeScript client — do not rename a variant
/// without changing the fixtures too.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// The request never reached the server, or the response never arrived.
    Network,
    /// The server answered with a non-success HTTP status.
    Api,
    /// A payload did not match its schema, in either direction.
    Validation,
    /// The addressed resource does not exist (HTTP 404).
    NotFound,
    /// No server could be reached at the configured address at all.
    Connection,
    /// A caller broke a documented contract. Rust-only: the TypeScript union
    /// has no counterpart, because in TypeScript this class of bug throws.
    /// It therefore never appears in a shared fixture.
    Invariant,
}

impl ErrorKind {
    /// The human-readable label the TypeScript `Error` subclass carries in its
    /// `name` field.
    ///
    /// The persisted dead-letter format stores `name`, not `kind`, so the sync
    /// layer needs this to write entries a TypeScript client can still read.
    /// Nothing may *branch* on it — that is what [`ErrorKind`] is for.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Network => "NetworkError",
            Self::Api => "ApiError",
            Self::Validation => "ValidationError",
            Self::NotFound => "NotFoundError",
            Self::Connection => "ConnectionError",
            Self::Invariant => "InvariantError",
        }
    }
}

/// Every failure the core can report.
///
/// Non-exhaustive so that adding a variant is not a breaking change for Rust
/// consumers. The FFI layer maps this onto a UniFFI error enum, where adding a
/// variant *is* an ABI-visible change and must be reflected in the committed
/// bindings.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[non_exhaustive]
pub enum Error {
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
    ///
    /// Deliberately a sibling of [`Error::Api`] rather than a wrapper around
    /// it: the sync layer treats `not_found` on a delete as *success*, and on
    /// an update as a rename to be remapped, so it must not be reachable by
    /// accidentally matching a generic API failure first.
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

impl Error {
    /// Build an [`Error::Invariant`] from anything string-like.
    #[must_use]
    pub fn invariant(message: impl Into<String>) -> Self {
        Self::Invariant {
            message: message.into(),
        }
    }

    /// Build an [`Error::Network`].
    #[must_use]
    pub fn network(message: impl Into<String>) -> Self {
        Self::Network {
            message: message.into(),
        }
    }

    /// Build an [`Error::Api`] for a given HTTP status.
    #[must_use]
    pub fn api(message: impl Into<String>, status: u16) -> Self {
        Self::Api {
            message: message.into(),
            status,
        }
    }

    /// Build an [`Error::Validation`].
    #[must_use]
    pub fn validation(message: impl Into<String>) -> Self {
        Self::Validation {
            message: message.into(),
        }
    }

    /// Build an [`Error::NotFound`], rendering the same message the TypeScript
    /// `NotFoundError(resource, id)` constructor produces.
    #[must_use]
    pub fn not_found(resource: &str, id: &str) -> Self {
        Self::NotFound {
            message: format!("{resource} not found: {id}"),
        }
    }

    /// Build an [`Error::Connection`] with the shared default message.
    #[must_use]
    pub fn connection() -> Self {
        Self::Connection {
            message: DEFAULT_CONNECTION_MESSAGE.to_owned(),
        }
    }

    /// Build an [`Error::Connection`] with a specific message.
    #[must_use]
    pub fn connection_with(message: impl Into<String>) -> Self {
        Self::Connection {
            message: message.into(),
        }
    }

    /// The variant tag, for exhaustive dispatch without re-matching the whole
    /// enum (the sync layer's failure classifier is the main consumer).
    #[must_use]
    pub const fn kind(&self) -> ErrorKind {
        match self {
            Self::Invariant { .. } => ErrorKind::Invariant,
            Self::Network { .. } => ErrorKind::Network,
            Self::Api { .. } => ErrorKind::Api,
            Self::Validation { .. } => ErrorKind::Validation,
            Self::NotFound { .. } => ErrorKind::NotFound,
            Self::Connection { .. } => ErrorKind::Connection,
        }
    }

    /// The HTTP status, present on exactly [`Error::Api`] and
    /// [`Error::NotFound`].
    #[must_use]
    pub const fn status(&self) -> Option<u16> {
        match self {
            Self::Api { status, .. } => Some(*status),
            Self::NotFound { .. } => Some(NOT_FOUND_STATUS),
            Self::Invariant { .. }
            | Self::Network { .. }
            | Self::Validation { .. }
            | Self::Connection { .. } => None,
        }
    }

    /// The raw message, without the `Display` decoration
    /// [`Error::Invariant`] adds.
    #[must_use]
    pub fn message(&self) -> &str {
        match self {
            Self::Invariant { message }
            | Self::Network { message }
            | Self::Api { message, .. }
            | Self::Validation { message }
            | Self::NotFound { message }
            | Self::Connection { message } => message,
        }
    }

    /// The TypeScript `Error.name` label for this variant.
    ///
    /// See [`ErrorKind::name`]; this is the form the persisted dead-letter
    /// entries store.
    #[must_use]
    pub const fn name(&self) -> &'static str {
        self.kind().name()
    }
}

/// The language-neutral serialized form of an [`Error`].
///
/// Exists as a distinct type rather than a `#[serde]` attribute soup on
/// [`Error`] because deserializing is a *parse*: `status` must be present on
/// exactly `api` and `not_found`, and must be `404` on `not_found`. Those are
/// invariants of the union, not of any single field, so they are checked once
/// in [`TryFrom`] and never again.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SerializedError {
    /// The variant tag.
    pub kind: ErrorKind,
    /// The human-readable message.
    pub message: String,
    /// The HTTP status, omitted entirely for the non-HTTP variants.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
}

impl From<&Error> for SerializedError {
    fn from(error: &Error) -> Self {
        Self {
            kind: error.kind(),
            message: error.message().to_owned(),
            status: error.status(),
        }
    }
}

impl TryFrom<SerializedError> for Error {
    type Error = Error;

    /// # Errors
    ///
    /// Returns [`Error::Invariant`] when `status` is present on a variant that
    /// cannot carry one, absent from one that must, or not `404` on
    /// `not_found`.
    fn try_from(serialized: SerializedError) -> Result<Self> {
        let SerializedError {
            kind,
            message,
            status,
        } = serialized;

        match (kind, status) {
            (ErrorKind::Api, Some(status)) => Ok(Self::Api { message, status }),
            (ErrorKind::NotFound, Some(NOT_FOUND_STATUS)) => Ok(Self::NotFound { message }),
            (ErrorKind::NotFound, Some(status)) => Err(Self::invariant(format!(
                "a not_found error always carries status {NOT_FOUND_STATUS}, got {status}"
            ))),
            (ErrorKind::Api | ErrorKind::NotFound, None) => Err(Self::invariant(format!(
                "error kind {kind:?} requires a status, none was present"
            ))),
            (
                ErrorKind::Network
                | ErrorKind::Validation
                | ErrorKind::Connection
                | ErrorKind::Invariant,
                Some(status),
            ) => Err(Self::invariant(format!(
                "error kind {kind:?} cannot carry a status, got {status}"
            ))),
            (ErrorKind::Network, None) => Ok(Self::Network { message }),
            (ErrorKind::Validation, None) => Ok(Self::Validation { message }),
            (ErrorKind::Connection, None) => Ok(Self::Connection { message }),
            (ErrorKind::Invariant, None) => Ok(Self::Invariant { message }),
        }
    }
}

impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> core::result::Result<S::Ok, S::Error> {
        SerializedError::from(self).serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Error {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> core::result::Result<Self, D::Error> {
        let serialized = SerializedError::deserialize(deserializer)?;
        Self::try_from(serialized).map_err(serde::de::Error::custom)
    }
}

/// `Result` specialized to the core's [`Error`].
pub type Result<T, E = Error> = core::result::Result<T, E>;

#[cfg(test)]
mod tests {
    use super::{Error, ErrorKind, NOT_FOUND_STATUS, SerializedError};

    #[test]
    fn not_found_renders_the_typescript_message() {
        let error = Error::not_found("Task", "Tasks/gone.md");
        assert_eq!(error.to_string(), "Task not found: Tasks/gone.md");
        assert_eq!(error.status(), Some(NOT_FOUND_STATUS));
        assert_eq!(error.name(), "NotFoundError");
    }

    #[test]
    fn status_is_present_on_exactly_the_http_variants() {
        assert_eq!(Error::api("boom", 500).status(), Some(500));
        assert_eq!(Error::not_found("Task", "x.md").status(), Some(404));
        assert_eq!(Error::network("offline").status(), None);
        assert_eq!(Error::validation("bad").status(), None);
        assert_eq!(Error::connection().status(), None);
        assert_eq!(Error::invariant("bug").status(), None);
    }

    #[test]
    fn round_trips_through_the_shared_json_shape() {
        for error in [
            Error::network("offline"),
            Error::api("server exploded", 503),
            Error::validation("expected a string"),
            Error::not_found("Task", "Tasks/gone.md"),
            Error::connection(),
            Error::invariant("unreachable"),
        ] {
            let json = serde_json::to_string(&error).unwrap();
            let parsed: Error = serde_json::from_str(&json).unwrap();
            assert_eq!(parsed, error, "round trip changed {error:?} via {json}");
        }
    }

    #[test]
    fn serializes_to_the_documented_field_set() {
        let json = serde_json::to_value(Error::api("nope", 418)).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "kind": "api", "message": "nope", "status": 418 })
        );

        let json = serde_json::to_value(Error::connection()).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "kind": "connection",
                "message": "Unable to connect to TaskNotes server"
            })
        );
    }

    #[test]
    fn rejects_a_status_on_a_variant_that_cannot_carry_one() {
        let error = Error::try_from(SerializedError {
            kind: ErrorKind::Network,
            message: "offline".to_owned(),
            status: Some(500),
        })
        .unwrap_err();
        assert!(
            error.to_string().contains("cannot carry a status"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn rejects_a_missing_status_on_a_variant_that_requires_one() {
        let error = Error::try_from(SerializedError {
            kind: ErrorKind::Api,
            message: "boom".to_owned(),
            status: None,
        })
        .unwrap_err();
        assert!(
            error.to_string().contains("requires a status"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn rejects_a_not_found_whose_status_is_not_404() {
        let error = Error::try_from(SerializedError {
            kind: ErrorKind::NotFound,
            message: "gone".to_owned(),
            status: Some(410),
        })
        .unwrap_err();
        assert!(
            error.to_string().contains("always carries status 404"),
            "unexpected error: {error}"
        );
    }

    #[test]
    fn names_match_the_typescript_class_names() {
        assert_eq!(ErrorKind::Network.name(), "NetworkError");
        assert_eq!(ErrorKind::Api.name(), "ApiError");
        assert_eq!(ErrorKind::Validation.name(), "ValidationError");
        assert_eq!(ErrorKind::NotFound.name(), "NotFoundError");
        assert_eq!(ErrorKind::Connection.name(), "ConnectionError");
    }
}
