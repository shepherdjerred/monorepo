//! Durable standalone Facet runtime; vault and domain semantics remain sans-I/O.
//!
//! This adapter owns private `SQLite` state. Host callbacks own file capabilities
//! and provider coordination. No host callback runs while a database lock is held.
#![forbid(unsafe_code)]

mod commands;
pub mod engine;
mod features;
pub mod merge;
mod projections;
mod query;
pub mod types;

use thiserror::Error;

/// Expected runtime and external-boundary failures.
#[derive(Debug, Error)]
pub enum RuntimeError {
    /// Private durable state could not be read or written.
    #[error("Facet storage is unavailable: {0}")]
    Storage(String),
    /// A vault capability or provider failed.
    #[error("Vault access failed: {0}")]
    Host(String),
    /// Native returned corrupt metadata or violated its owned callback contract.
    #[error("Vault provider contract failed: {0}")]
    HostContract(String),
    /// Input violates the command or data contract.
    #[error("Invalid operation: {0}")]
    Validation(String),
    /// Selected TaskNotes settings are invalid.
    #[error("Invalid TaskNotes configuration: {0}")]
    Configuration(String),
    /// The target changed since it was read.
    #[error("The file changed; reload or resolve its conflict before saving")]
    Conflict,
    /// A profile, file, or conflict no longer exists.
    #[error("The requested profile or file was not found")]
    NotFound,
    /// The engine was explicitly shut down.
    #[error("The engine is closed")]
    Closed,
    /// Nonblocking admission or same-engine callback reentry must be retried.
    #[error("The operation is busy; retry after current work completes")]
    Busy,
}

impl From<rusqlite::Error> for RuntimeError {
    fn from(_: rusqlite::Error) -> Self {
        // SQLite diagnostics can contain user paths and SQL-bound content.
        Self::Storage("database operation failed".to_owned())
    }
}

impl From<serde_json::Error> for RuntimeError {
    fn from(_: serde_json::Error) -> Self {
        Self::Validation("JSON violates its schema".to_owned())
    }
}

impl From<tasknotes_vault::VaultError> for RuntimeError {
    fn from(error: tasknotes_vault::VaultError) -> Self {
        match error {
            tasknotes_vault::VaultError::Configuration(message) => Self::Configuration(message),
            tasknotes_vault::VaultError::Document(message) => Self::Validation(message),
            tasknotes_vault::VaultError::Path => Self::Validation("invalid vault path".to_owned()),
            tasknotes_vault::VaultError::Conflict => Self::Conflict,
        }
    }
}

/// Runtime operation result.
pub type Result<T> = std::result::Result<T, RuntimeError>;
