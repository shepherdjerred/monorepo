//! Obsidian Sync compatibility implemented without network or platform I/O.
//!
//! The protocol reference is Obsidian Headless 0.0.14, commit
//! `0d0ec4364bfde6c715c539cf3555ff8272bb7a58`. The upstream client is
//! UNLICENSED; its distribution risk is a project decision. This crate uses
//! `RustCrypto` primitives and differential vectors generated from that reference.
#![forbid(unsafe_code)]

pub mod crypto;

/// An external encryption or protocol boundary error. Messages never embed
/// passwords, vault keys, ciphertext, or decrypted file contents.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SyncError {
    /// The peer requested an encryption version this implementation cannot use.
    #[error("Unsupported Obsidian Sync encryption version: {0}")]
    UnsupportedEncryption(u8),
    /// A key has the wrong length or cannot be derived.
    #[error("Invalid vault encryption key")]
    Key,
    /// Ciphertext is truncated, malformed, or fails authentication.
    #[error("Encrypted data failed authentication")]
    Authentication,
    /// Authenticated plaintext is not the string required by the protocol.
    #[error("Decrypted protocol text is not UTF-8")]
    Text,
}

/// A protocol operation result.
pub type Result<T> = std::result::Result<T, SyncError>;
