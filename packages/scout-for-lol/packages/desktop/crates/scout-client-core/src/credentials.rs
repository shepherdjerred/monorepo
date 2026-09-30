//! OS credential-store persistence for the paired device bearer token.

use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;

const SERVICE: &str = "com.scout-for-lol.client";
const USERNAME_PREFIX: &str = "device-credential";

fn credential_username(backend_origin: &str) -> String {
    let digest = Sha256::digest(backend_origin.as_bytes());
    format!("{USERNAME_PREFIX}-{}", hex::encode(digest))
}

fn credential_entry(backend_origin: &str) -> Result<Entry, KeyringError> {
    Entry::new(SERVICE, &credential_username(backend_origin))
}

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
    pub fn load(backend_origin: &str) -> Result<Option<Self>, CredentialError> {
        let entry = credential_entry(backend_origin)?;
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
    pub fn save(&self, backend_origin: &str) -> Result<(), CredentialError> {
        let encoded = serde_json::to_string(self).map_err(CredentialError::Encode)?;
        credential_entry(backend_origin)?.set_password(&encoded)?;
        Ok(())
    }

    /// Remove the credential during disconnect/re-pair.
    ///
    /// # Errors
    ///
    /// Returns [`CredentialError`] when the platform store cannot be changed.
    pub fn delete(backend_origin: &str) -> Result<(), CredentialError> {
        let entry = credential_entry(backend_origin)?;
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

#[cfg(test)]
mod tests {
    use super::credential_username;

    #[test]
    fn credential_slots_are_stable_and_origin_scoped() {
        let production = credential_username("https://scout.sjer.red/");

        assert_eq!(production, credential_username("https://scout.sjer.red/"));
        assert_ne!(
            production,
            credential_username("https://beta.scout.sjer.red/")
        );
        assert_ne!(production, credential_username("http://127.0.0.1:3000/"));
    }

    #[test]
    fn credential_slot_names_match_persisted_keychain_entries() {
        assert_eq!(
            credential_username("https://scout.sjer.red/"),
            "device-credential-002eafed56bdcf9f7e14a9932e57c7253eac1c5431d096985b9330ed9a55f5ff"
        );
    }
}
