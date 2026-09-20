//! OS credential-store persistence for the paired device bearer token.

use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

const SERVICE: &str = "com.scout-for-lol.client";
const USERNAME: &str = "device-credential";

/// Paired device identity kept in Keychain or Windows Credential Manager.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceCredential {
    /// Server-issued device id.
    pub device_id: Uuid,
    /// Opaque bearer token. Never include this type in diagnostics or logs.
    pub token: String,
}

impl DeviceCredential {
    /// Load a previously paired credential.
    ///
    /// # Errors
    ///
    /// Returns [`CredentialError`] when the platform credential store is
    /// unavailable or contains malformed Scout data.
    pub fn load() -> Result<Option<Self>, CredentialError> {
        let entry = Entry::new(SERVICE, USERNAME)?;
        match entry.get_password() {
            Ok(value) => serde_json::from_str(&value)
                .map(Some)
                .map_err(CredentialError::Decode),
            Err(KeyringError::NoEntry) => Ok(None),
            Err(error) => Err(CredentialError::Keyring(error)),
        }
    }

    /// Persist the credential in the platform store.
    ///
    /// # Errors
    ///
    /// Returns [`CredentialError`] when encoding or secure persistence fails.
    pub fn save(&self) -> Result<(), CredentialError> {
        let encoded = serde_json::to_string(self).map_err(CredentialError::Encode)?;
        Entry::new(SERVICE, USERNAME)?.set_password(&encoded)?;
        Ok(())
    }

    /// Remove the credential during disconnect/re-pair.
    ///
    /// # Errors
    ///
    /// Returns [`CredentialError`] when the platform store cannot be changed.
    pub fn delete() -> Result<(), CredentialError> {
        let entry = Entry::new(SERVICE, USERNAME)?;
        match entry.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(CredentialError::Keyring(error)),
        }
    }
}

/// Secure credential persistence failure.
#[derive(Debug, Error)]
pub enum CredentialError {
    /// Platform credential-store operation failed.
    #[error("platform credential store failed: {0}")]
    Keyring(#[from] KeyringError),
    /// Stored credential JSON was malformed.
    #[error("stored Scout credential is malformed: {0}")]
    Decode(serde_json::Error),
    /// Credential serialization failed.
    #[error("could not encode Scout credential: {0}")]
    Encode(serde_json::Error),
}
