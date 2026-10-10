//! Obsidian Sync compatibility implemented without network or platform I/O.
//!
//! The protocol reference is Obsidian Headless 0.0.14, commit
//! `0d0ec4364bfde6c715c539cf3555ff8272bb7a58`. The upstream client is
//! UNLICENSED; its distribution risk is a project decision. This crate uses
//! `RustCrypto` primitives and differential vectors generated from that reference.
#![forbid(unsafe_code)]

pub mod auth;
pub mod crypto;
pub mod filter;
pub mod session;

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
    /// A peer frame violates the supported protocol. No peer payload is logged.
    #[error("Invalid Obsidian Sync protocol frame")]
    Protocol,
    /// The response status indicates an HTTP failure.
    #[error("Obsidian account HTTP status: {0}")]
    Http(u16),
    /// The server rejected an account or vault request.
    #[error("Obsidian account request was rejected")]
    AccountRejected,
    /// A transport destination is outside the official service boundary.
    #[error("Invalid Obsidian Sync server host")]
    Host,
    /// A remote path cannot safely enter a replica.
    #[error("Unsafe Obsidian Sync file path")]
    Path,
    /// A file exceeds the negotiated or configured transfer bound.
    #[error("Obsidian Sync file exceeds the transfer limit")]
    FileTooLarge,
    /// The current session lifecycle does not permit this operation.
    #[error("Obsidian Sync session is not ready for this operation")]
    SessionState,
    /// An operation failed at the remote service boundary.
    #[error("Obsidian Sync operation was rejected")]
    RemoteRejected,
    /// The session or request deadline expired.
    #[error("Obsidian Sync operation timed out")]
    Timeout,
    /// The pending-change queue reached its fixed safety bound.
    #[error("Obsidian Sync pending queue is full")]
    QueueFull,
}

/// A protocol operation result.
pub type Result<T> = std::result::Result<T, SyncError>;

pub(crate) fn sensitive_json(mut value: serde_json::Value) -> zeroize::Zeroizing<String> {
    fn wipe(value: &mut serde_json::Value) {
        use zeroize::Zeroize;
        match value {
            serde_json::Value::String(text) => text.zeroize(),
            serde_json::Value::Array(items) => items.iter_mut().for_each(wipe),
            serde_json::Value::Object(items) => items.values_mut().for_each(wipe),
            _ => {}
        }
    }
    let text = zeroize::Zeroizing::new(value.to_string());
    wipe(&mut value);
    text
}
