//! Immutable native snapshots → `SQLite` BLOB references with bounded callbacks.

use super::{Engine, Result, RuntimeError, lock_profile, payloads, validate_identity};
use crate::types::{FileSnapshot, PAYLOAD_CHUNK_BYTES, PayloadInfo, PayloadState};
use sha2::{Digest, Sha256};
use tasknotes_vault::path::VaultPath;

pub(super) fn validate_snapshot(snapshot: &FileSnapshot) -> Result<()> {
    validate_identity(&snapshot.id)
        .map_err(|_| RuntimeError::HostContract("invalid snapshot identity".to_owned()))?;
    if snapshot.revision.len() != 64
        || !snapshot
            .revision
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(RuntimeError::HostContract(
            "snapshot revision must be lowercase SHA256".to_owned(),
        ));
    }
    i32::try_from(snapshot.size)
        .map_err(|_| RuntimeError::Host("snapshot exceeds SQLite storage range".to_owned()))?;
    Ok(())
}

impl Engine {
    /// Capture a provider file into an immutable owner-scoped `SQLite` image.
    /// No binary image is assembled into an inline Vec. Returned IDs are durable;
    /// this stages data without changing the index, outbox or remote checkpoint.
    ///
    /// # Errors
    /// Returns unsafe paths, provider/cleanup, digest, ownership or storage errors.
    pub fn capture_file_payload(&self, profile: &str, path: &str) -> Result<Option<PayloadInfo>> {
        let coordinator = self.coordinator(profile)?;
        let _operation = lock_profile(&coordinator)?;
        self.capture_file_image(profile, path)
    }

    pub(super) fn capture_file_image(
        &self,
        profile: &str,
        path: &str,
    ) -> Result<Option<PayloadInfo>> {
        VaultPath::parse(path)?;
        self.profile(profile)?;
        let Some(snapshot) = self.files.open_file_snapshot(profile, path)? else {
            return Ok(None);
        };
        self.capture_snapshot(profile, &snapshot).map(Some)
    }

    pub(super) fn capture_snapshot(
        &self,
        profile: &str,
        snapshot: &FileSnapshot,
    ) -> Result<PayloadInfo> {
        // Close is attempted on every validation/read/storage outcome. It releases
        // only a temporary image, never the retained predecessor it may reference.
        let result = self.import_snapshot(profile, snapshot);
        let closed = self.files.close_snapshot(profile, &snapshot.id);
        match (result, closed) {
            (Ok(image), Ok(())) => Ok(image),
            (Err(error), _) | (_, Err(error)) => Err(error),
        }
    }

    fn import_snapshot(&self, profile: &str, snapshot: &FileSnapshot) -> Result<PayloadInfo> {
        validate_snapshot(snapshot)?;
        let identity = self.database(|db| {
            payloads::content_identity(db, profile, snapshot.size, &snapshot.revision)
        })?;
        let original =
            self.reserve_image(profile, &identity, snapshot.size, &snapshot.revision, false)?;
        let mut offset = 0;
        let mut hash = Sha256::new();
        while offset < snapshot.size {
            let mut length = (snapshot.size - offset).min(
                u64::try_from(PAYLOAD_CHUNK_BYTES)
                    .map_err(|_| RuntimeError::Storage("invalid chunk bound".to_owned()))?,
            );
            // Exact prefix retries must not straddle its durable boundary.
            if offset < original.written {
                length = length.min(original.written - offset);
            }
            let length = u32::try_from(length)
                .map_err(|_| RuntimeError::Storage("invalid snapshot chunk".to_owned()))?;
            let chunk = self
                .files
                .read_snapshot_chunk(profile, &snapshot.id, offset, length)?;
            if usize::try_from(length).ok() != Some(chunk.len()) {
                return Err(RuntimeError::HostContract(
                    "snapshot returned an inexact chunk range".to_owned(),
                ));
            }
            hash.update(&chunk);
            if original.state != PayloadState::Sealed {
                self.write_image(profile, &identity, offset, &chunk)?;
            }
            offset += u64::from(length);
        }
        if hex::encode(hash.finalize()) != snapshot.revision {
            return Err(RuntimeError::HostContract(
                "snapshot bytes do not match their immutable revision".to_owned(),
            ));
        }
        self.seal_image(profile, &identity)
    }
}
