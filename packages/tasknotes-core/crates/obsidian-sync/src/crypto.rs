//! Byte-compatible Obsidian vault encryption using `RustCrypto` primitives.

use std::fmt;

use aes_gcm::{
    Aes256Gcm, Nonce,
    aead::{Aead, KeyInit},
};
use aes_siv::siv::Aes256Siv;
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

use crate::{Result, SyncError};

/// Supported wire encryption versions. No implicit upgrades are performed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EncryptionVersion {
    /// Legacy deterministic AES-GCM paths and direct content key.
    Legacy,
    /// HKDF-derived AES-SIV paths and AES-GCM contents.
    V2,
    /// Current negotiation version with the same encryption framing as V2.
    V3,
}

impl TryFrom<u8> for EncryptionVersion {
    type Error = SyncError;
    fn try_from(value: u8) -> Result<Self> {
        match value {
            0 => Ok(Self::Legacy),
            2 => Ok(Self::V2),
            3 => Ok(Self::V3),
            other => Err(SyncError::UnsupportedEncryption(other)),
        }
    }
}

/// A vault key whose bytes are wiped on drop and redacted in diagnostics.
pub struct VaultKey(Zeroizing<[u8; 32]>);

impl fmt::Debug for VaultKey {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("VaultKey([REDACTED])")
    }
}

impl VaultKey {
    /// Import a key retrieved through the host's secure storage.
    ///
    /// # Errors
    /// Rejects keys other than exactly 32 bytes.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self> {
        Ok(Self(Zeroizing::new(
            bytes.try_into().map_err(|_| SyncError::Key)?,
        )))
    }

    /// Derive a key using the reference client's NFKC normalization and scrypt
    /// parameters. Neither password nor derived key appears in error messages.
    ///
    /// # Errors
    /// Returns a key error if derivation cannot complete.
    pub fn derive(password: &str, salt: &str) -> Result<Self> {
        let password = Zeroizing::new(password.nfkc().collect::<String>());
        let salt = salt.nfkc().collect::<String>();
        let mut key = Zeroizing::new([0u8; 32]);
        let parameters = scrypt::Params::new(15, 8, 1).map_err(|_| SyncError::Key)?;
        scrypt::scrypt(
            password.as_bytes(),
            salt.as_bytes(),
            &parameters,
            key.as_mut(),
        )
        .map_err(|_| SyncError::Key)?;
        Ok(Self(key))
    }

    /// Copy the key into the host's secure storage boundary. The host must not
    /// persist these bytes in preferences, logs, or the vault database.
    #[must_use]
    pub fn secure_storage_bytes(&self) -> Zeroizing<[u8; 32]> {
        self.0.clone()
    }
}

/// Cipher for one vault, retaining no passwords or platform resources.
pub struct VaultCipher {
    version: EncryptionVersion,
    key_hash: Zeroizing<String>,
    content_key: Zeroizing<[u8; 32]>,
    path_key: Option<Zeroizing<[u8; 64]>>,
}

impl fmt::Debug for VaultCipher {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("VaultCipher")
            .field("version", &self.version)
            .finish_non_exhaustive()
    }
}

impl VaultCipher {
    /// Initialize keys using the exact salt bytes from remote vault metadata.
    /// Salt normalization belongs to password derivation, not these HKDFs.
    ///
    /// # Errors
    /// Returns a key error if key expansion fails.
    pub fn new(version: EncryptionVersion, key: &VaultKey, salt: &str) -> Result<Self> {
        if version == EncryptionVersion::Legacy {
            return Ok(Self {
                version,
                key_hash: Zeroizing::new(hex(&Sha256::digest(key.0.as_ref()))),
                content_key: key.0.clone(),
                path_key: None,
            });
        }
        let vault_hkdf = Hkdf::<Sha256>::new(Some(salt.as_bytes()), key.0.as_ref());
        let mut hash_key = Zeroizing::new([0u8; 32]);
        vault_hkdf
            .expand(b"ObsidianKeyHash", hash_key.as_mut())
            .map_err(|_| SyncError::Key)?;
        let mut mac_key = Zeroizing::new([0u8; 32]);
        let mut enc_key = Zeroizing::new([0u8; 32]);
        vault_hkdf
            .expand(b"ObsidianAesSivMac", mac_key.as_mut())
            .map_err(|_| SyncError::Key)?;
        vault_hkdf
            .expand(b"ObsidianAesSivEnc", enc_key.as_mut())
            .map_err(|_| SyncError::Key)?;
        let mut path_key = Zeroizing::new([0u8; 64]);
        let (mac, enc) = path_key.split_at_mut(32);
        mac.copy_from_slice(mac_key.as_ref());
        enc.copy_from_slice(enc_key.as_ref());
        let mut content_key = Zeroizing::new([0u8; 32]);
        Hkdf::<Sha256>::new(Some(&[]), key.0.as_ref())
            .expand(b"ObsidianAesGcm", content_key.as_mut())
            .map_err(|_| SyncError::Key)?;
        Ok(Self {
            version,
            key_hash: Zeroizing::new(hex(hash_key.as_ref())),
            content_key,
            path_key: Some(path_key),
        })
    }

    /// Key proof sent to the access and synchronization endpoints. Redacted
    /// by this type's Debug implementation.
    #[must_use]
    pub fn key_hash(&self) -> &str {
        &self.key_hash
    }

    /// Deterministically encrypt a protocol string, including file paths.
    /// No nonce or associated-data item is added to the reference SIV format.
    ///
    /// # Errors
    /// Returns an authentication error if the primitive cannot encrypt.
    pub fn encode_string(&self, text: &str) -> Result<String> {
        let bytes = if let Some(key) = &self.path_key {
            Aes256Siv::new((&**key).into())
                .encrypt(std::iter::empty::<&[u8]>(), text.as_bytes())
                .map_err(|_| SyncError::Authentication)?
        } else {
            let digest = Sha256::digest(text.as_bytes());
            let nonce: [u8; 12] = digest
                .get(..12)
                .ok_or(SyncError::Key)?
                .try_into()
                .map_err(|_| SyncError::Key)?;
            self.encrypt_content(text.as_bytes(), nonce)?
        };
        Ok(hex(&bytes))
    }

    /// Authenticate and decode a deterministically encrypted string.
    ///
    /// # Errors
    /// Rejects malformed hex, failed authentication, or invalid UTF-8.
    pub fn decode_string(&self, ciphertext: &str) -> Result<String> {
        let bytes = unhex(ciphertext)?;
        let plaintext = if let Some(key) = &self.path_key {
            Aes256Siv::new((&**key).into())
                .decrypt(std::iter::empty::<&[u8]>(), &bytes)
                .map_err(|_| SyncError::Authentication)?
        } else {
            self.decrypt_content(&bytes)?
        };
        String::from_utf8(plaintext).map_err(|_| SyncError::Text)
    }

    /// Encrypt full file content as nonce || ciphertext || authentication tag.
    /// The host must supply a fresh cryptographically random nonce for every
    /// content encryption. Tests inject synthetic nonces explicitly.
    ///
    /// # Errors
    /// Returns an authentication error if encryption fails.
    pub fn encrypt_content(&self, plaintext: &[u8], nonce: [u8; 12]) -> Result<Vec<u8>> {
        let cipher = Aes256Gcm::new((&*self.content_key).into());
        let mut result = nonce.to_vec();
        result.extend(
            cipher
                .encrypt(&Nonce::from(nonce), plaintext)
                .map_err(|_| SyncError::Authentication)?,
        );
        Ok(result)
    }

    /// Authenticate a full content frame before returning any plaintext.
    ///
    /// # Errors
    /// Rejects truncation and authentication failures, including nonce-only
    /// frames. Empty files use the protocol's separate zero-length handling.
    pub fn decrypt_content(&self, ciphertext: &[u8]) -> Result<Vec<u8>> {
        if ciphertext.len() < 28 {
            return Err(SyncError::Authentication);
        }
        let (nonce, payload) = ciphertext.split_at(12);
        let nonce: [u8; 12] = nonce.try_into().map_err(|_| SyncError::Authentication)?;
        Aes256Gcm::new((&*self.content_key).into())
            .decrypt(&Nonce::from(nonce), payload)
            .map_err(|_| SyncError::Authentication)
    }
}

fn hex(bytes: &[u8]) -> String {
    hex::encode(bytes)
}

fn unhex(text: &str) -> Result<Vec<u8>> {
    if !text.len().is_multiple_of(2) || !text.is_ascii() {
        return Err(SyncError::Authentication);
    }
    text.as_bytes()
        .as_chunks::<2>()
        .0
        .iter()
        .map(|chunk| {
            let pair = std::str::from_utf8(chunk).map_err(|_| SyncError::Authentication)?;
            u8::from_str_radix(pair, 16).map_err(|_| SyncError::Authentication)
        })
        .collect()
}
