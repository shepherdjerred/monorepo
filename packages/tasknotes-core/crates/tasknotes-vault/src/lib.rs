//! TaskNotes vault semantics without filesystem, networking, clocks, or FFI.
//!
//! Documents retain their original bytes. Changes produce conditional plans;
//! hosts must compare the supplied content revision before committing them.
#![forbid(unsafe_code)]

pub mod compat;
pub mod config;
pub mod configuration;
pub mod creation;
pub mod detection_policy;
pub mod document;
mod effective;
pub mod filename;
pub mod instances;
pub mod json_boundary;
pub mod links;
pub mod mapping;
pub mod migration;
pub mod migration_policy;
pub mod operations;
pub mod path;
mod plugin_boundary;
pub mod progression;
pub mod relationships;
pub mod reminder_schedule;
pub mod templating;
pub mod temporal;
pub mod validation;

use thiserror::Error;

/// An expected configuration, document, or host-boundary failure.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum VaultError {
    /// A configuration exists but cannot be used safely.
    #[error("Invalid TaskNotes configuration: {0}")]
    Configuration(String),
    /// Markdown frontmatter cannot be read or edited safely.
    #[error("Invalid task document: {0}")]
    Document(String),
    /// A path does not name a file inside the logical vault.
    #[error("Invalid vault-relative path")]
    Path,
    /// The document changed since the caller read it.
    #[error("The document changed; reload before saving")]
    Conflict,
}

/// A vault operation result.
pub type Result<T> = std::result::Result<T, VaultError>;
