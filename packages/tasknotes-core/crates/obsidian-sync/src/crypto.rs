//! Byte-compatible Obsidian vault encryption using `RustCrypto` primitives.

use std::fmt;

use aes_gcm::{
    Aes256Gcm, Nonce, Tag,
    aead::{AeadInOut, KeyInit},
};
use aes_siv::siv::Aes256Siv;
use hkdf::Hkdf;
use sha2::{Digest, Sha256};
use unicode_normalization::UnicodeNormalization;
use zeroize::{Zeroize, Zeroizing};

use crate::{Result, SyncError};

/// One reserved final content frame, filled directly by the runtime's bounded
/// storage reads. Unencrypted buffers are wiped if preparation is abandoned.
pub struct ContentFrame {
    bytes: Vec<u8>,
}

impl ContentFrame {
    /// Reserve nonce, plaintext and tag capacity before any payload is loaded.
    /// The caller must supply a fresh host-generated cryptographic nonce.
    ///
    /// # Errors
    /// Rejects arithmetic overflow and failed allocation without partial data.
    pub fn new(plaintext_size: usize, nonce: [u8; 12]) -> Result<Self> {
        let capacity = plaintext_size
            .checked_add(28)
            .ok_or(SyncError::FileTooLarge)?;
        let mut bytes = Vec::new();
        bytes
            .try_reserve_exact(capacity)
            .map_err(|_| SyncError::FileTooLarge)?;
        bytes.extend_from_slice(&nonce);
        bytes.resize(capacity - 16, 0);
        Ok(Self { bytes })
    }

    /// Borrow only the payload region for direct bounded reads into this frame.
    ///
    /// # Errors
    /// Returns Authentication if the private framing invariant is broken.
    pub fn content_mut(&mut self) -> Result<&mut [u8]> {
        self.bytes.get_mut(12..).ok_or(SyncError::Authentication)
    }

    /// Borrow plaintext for incremental digest validation before encryption.
    ///
    /// # Errors
    /// Returns Authentication if the private framing invariant is broken.
    pub fn content(&self) -> Result<&[u8]> {
        self.bytes.get(12..).ok_or(SyncError::Authentication)
    }

    /// Actual reserved byte capacity used by the session admission budget.
    #[must_use]
    pub fn capacity(&self) -> usize {
        self.bytes.capacity()
    }

    fn take_ciphertext(mut self) -> Vec<u8> {
        std::mem::take(&mut self.bytes)
    }
}

impl Drop for ContentFrame {
    fn drop(&mut self) {
        self.bytes.zeroize();
    }
}

impl fmt::Debug for ContentFrame {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ContentFrame([REDACTED])")
    }
}

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
    /// Exact version number sent during vault-access and socket negotiation.
    #[must_use]
    pub fn version(&self) -> u8 {
        match self.version {
            EncryptionVersion::Legacy => 0,
            EncryptionVersion::V2 => 2,
            EncryptionVersion::V3 => 3,
        }
    }

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
        let size = plaintext
            .len()
            .checked_add(28)
            .ok_or(SyncError::FileTooLarge)?;
        let mut result = Vec::new();
        result
            .try_reserve_exact(size)
            .map_err(|_| SyncError::FileTooLarge)?;
        result.extend_from_slice(&nonce);
        result.extend_from_slice(plaintext);
        self.encrypt_reserved_frame(&mut result)?;
        Ok(result)
    }

    /// Encrypt a runtime-filled final frame in place, reusing its allocation.
    /// No complete plaintext or ciphertext copy is created by this operation.
    ///
    /// # Errors
    /// Returns a framing/authentication error; abandoned plaintext is wiped.
    pub fn encrypt_content_frame(&self, mut frame: ContentFrame) -> Result<Vec<u8>> {
        self.encrypt_reserved_frame(&mut frame.bytes)?;
        Ok(frame.take_ciphertext())
    }

    fn encrypt_reserved_frame(&self, result: &mut Vec<u8>) -> Result<()> {
        let nonce: [u8; 12] = result
            .get(..12)
            .ok_or(SyncError::Authentication)?
            .try_into()
            .map_err(|_| SyncError::Authentication)?;
        if result.capacity()
            < result
                .len()
                .checked_add(16)
                .ok_or(SyncError::FileTooLarge)?
        {
            return Err(SyncError::FileTooLarge);
        }
        let tag = Aes256Gcm::new((&*self.content_key).into())
            .encrypt_inout_detached(
                &Nonce::from(nonce),
                b"",
                result
                    .get_mut(12..)
                    .ok_or(SyncError::Authentication)?
                    .into(),
            )
            .map_err(|_| SyncError::Authentication)?;
        result.extend_from_slice(&tag);
        Ok(())
    }

    /// Authenticate a full content frame before returning any plaintext.
    ///
    /// # Errors
    /// Rejects truncation and authentication failures, including nonce-only
    /// frames. Empty files use the protocol's separate zero-length handling.
    pub fn decrypt_content(&self, ciphertext: &[u8]) -> Result<Vec<u8>> {
        self.decrypt_content_owned(ciphertext.to_vec())
    }

    /// Authenticate and reuse an owned frame, returning plaintext only after
    /// authentication succeeds. Capacity stays at the exact encrypted size.
    ///
    /// # Errors
    /// Rejects truncation and failed authentication; failure buffers are wiped.
    pub fn decrypt_content_owned(&self, mut ciphertext: Vec<u8>) -> Result<Vec<u8>> {
        if ciphertext.len() < 28 {
            return Err(SyncError::Authentication);
        }
        let end = ciphertext.len() - 16;
        let nonce: [u8; 12] = ciphertext
            .get(..12)
            .ok_or(SyncError::Authentication)?
            .try_into()
            .map_err(|_| SyncError::Authentication)?;
        let tag: [u8; 16] = ciphertext
            .get(end..)
            .ok_or(SyncError::Authentication)?
            .try_into()
            .map_err(|_| SyncError::Authentication)?;
        let payload = ciphertext
            .get_mut(12..end)
            .ok_or(SyncError::Authentication)?;
        if Aes256Gcm::new((&*self.content_key).into())
            .decrypt_inout_detached(&Nonce::from(nonce), b"", payload.into(), &Tag::from(tag))
            .is_err()
        {
            ciphertext.zeroize();
            return Err(SyncError::Authentication);
        }
        ciphertext.copy_within(12..end, 0);
        ciphertext.truncate(end - 12);
        Ok(ciphertext)
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
