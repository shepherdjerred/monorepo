//! Metadata admission and owned final-frame upload preparation, without I/O.

use super::{Active, Effect, Operation, PIECE_BYTES, PushTransfer, QUEUE_LIMIT, Session};
use crate::{
    Result, SyncError,
    crypto::ContentFrame,
    filter::{extension, validate_path},
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

/// Immutable outbox metadata. It is validated before allocating a file frame.
/// Deleted/folder entries have zero size and no content hash. A zero-byte file
/// remains distinct, with the SHA256 of empty bytes and deleted=false.
pub struct UploadMetadata {
    /// Exact durable mutation receipt.
    pub operation_id: String,
    /// Validated logical destination.
    pub path: String,
    /// Logical previous path, when the receipt represents a rename.
    pub related_path: Option<String>,
    /// Original creation time in epoch milliseconds.
    pub ctime: u64,
    /// Immutable mutation time in epoch milliseconds.
    pub mtime: u64,
    /// Whether this receipt represents a directory.
    pub folder: bool,
    /// Whether this receipt represents a tombstone.
    pub deleted: bool,
    /// Exact plaintext size.
    pub size: u64,
    /// Exact lowercase SHA256 for a file; absent for folders/tombstones.
    pub content_hash: Option<String>,
}

impl std::fmt::Debug for UploadMetadata {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("UploadMetadata([REDACTED])")
    }
}

impl UploadMetadata {
    fn validate(&self) -> Result<()> {
        validate_path(&self.path)?;
        if let Some(path) = &self.related_path {
            validate_path(path)?;
        }
        if self.operation_id.is_empty()
            || self.operation_id.len() > 256
            || self.operation_id.chars().any(char::is_control)
        {
            return Err(SyncError::SessionState);
        }
        if self.folder || self.deleted {
            if self.size != 0 || self.content_hash.is_some() {
                return Err(SyncError::Protocol);
            }
        } else if self.content_hash.as_ref().is_none_or(|hash| {
            hash.len() != 64
                || !hash
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        }) {
            return Err(SyncError::Protocol);
        }
        Ok(())
    }

    fn memory_cost(&self, capacity: u64) -> Result<u64> {
        let path = u64::try_from(self.path.len()).map_err(|_| SyncError::Path)?;
        let related = u64::try_from(self.related_path.as_deref().unwrap_or_default().len())
            .map_err(|_| SyncError::Path)?;
        let identity = u64::try_from(self.operation_id.len()).map_err(|_| SyncError::QueueFull)?;
        capacity
            .checked_add(path.saturating_mul(4))
            .and_then(|cost| cost.checked_add(related.saturating_mul(3)))
            .and_then(|cost| cost.checked_add(identity))
            .and_then(|cost| cost.checked_add(2048))
            .ok_or(SyncError::QueueFull)
    }
}

impl Session {
    /// Check path, immutable metadata, negotiated size and aggregate reservation
    /// before a caller allocates/fills its final owned content frame. Callers
    /// serialize admission, filling and queueing; queueing repeats every check.
    /// No receipt is reserved or acknowledged by this read-only admission.
    ///
    /// # Errors
    /// Rejects malformed/filtered/oversized metadata, duplicate IDs or full queues.
    pub fn admit_upload(&self, upload: &UploadMetadata) -> Result<()> {
        if self.download_reserved() {
            return Err(SyncError::QueueFull);
        }
        upload.validate()?;
        if !self.config.filter.allows(&upload.path, upload.folder) {
            return Err(SyncError::Path);
        }
        if upload.size > self.file_limit() {
            return Err(SyncError::FileTooLarge);
        }
        if self.queued.len() >= QUEUE_LIMIT {
            return Err(SyncError::QueueFull);
        }
        if self
            .queued
            .iter()
            .any(|operation| operation.operation_id().as_deref() == Some(&upload.operation_id))
            || self
                .active
                .as_ref()
                .and_then(Active::operation_id)
                .as_deref()
                == Some(&upload.operation_id)
        {
            return Err(SyncError::SessionState);
        }
        let capacity = if upload.size == 0 {
            0
        } else {
            upload.size.checked_add(28).ok_or(SyncError::FileTooLarge)?
        };
        self.admit_capacity(upload, capacity)?;
        Ok(())
    }

    fn admit_capacity(&self, upload: &UploadMetadata, capacity: u64) -> Result<u64> {
        let cost = upload.memory_cost(capacity)?;
        let reserved = self
            .buffered_upload_bytes
            .checked_add(cost)
            .ok_or(SyncError::QueueFull)?;
        if reserved > self.config.queued_byte_limit {
            return Err(SyncError::QueueFull);
        }
        Ok(cost)
    }

    /// Hash/authenticate an already-filled final frame and encrypt it in place.
    /// The resulting queue owns that same allocation, reused on reconnect.
    /// Metadata-only empty files/folders/tombstones require no allocated frame.
    ///
    /// # Errors
    /// Rejects changed admission, missing/unexpected frames and digest mismatch.
    pub fn queue_content_frame(
        &mut self,
        upload: UploadMetadata,
        frame: Option<ContentFrame>,
        now: u64,
    ) -> Result<Vec<Effect>> {
        self.admit_upload(&upload)?;
        let (encrypted, capacity) = match (upload.size, frame) {
            (0, None) => {
                if !upload.deleted
                    && !upload.folder
                    && upload.content_hash.as_deref() != Some(&hex::encode(Sha256::digest([])))
                {
                    return Err(SyncError::Authentication);
                }
                (Vec::new(), 0)
            }
            (0, Some(_)) | (_, None) => return Err(SyncError::Protocol),
            (_, Some(frame)) => {
                let bytes = frame.content()?;
                if u64::try_from(bytes.len()).map_err(|_| SyncError::FileTooLarge)? != upload.size {
                    return Err(SyncError::Protocol);
                }
                if Some(hex::encode(Sha256::digest(bytes))) != upload.content_hash {
                    return Err(SyncError::Authentication);
                }
                let capacity =
                    u64::try_from(frame.capacity()).map_err(|_| SyncError::FileTooLarge)?;
                self.admit_capacity(&upload, capacity)?;
                (self.cipher.encrypt_content_frame(frame)?, capacity)
            }
        };
        let memory_cost = self.admit_capacity(&upload, capacity)?;
        let hash = upload.content_hash.clone().unwrap_or_default();
        let metadata = self.push_metadata(&upload, encrypted.len())?;
        self.buffered_upload_bytes = self
            .buffered_upload_bytes
            .checked_add(memory_cost)
            .ok_or(SyncError::QueueFull)?;
        self.queued.push_back(Operation::Upload(PushTransfer {
            operation_id: upload.operation_id,
            metadata,
            bytes: encrypted,
            hash,
            memory_cost,
            path: upload.path,
            related_path: upload.related_path,
        }));
        self.pump(now)
    }

    fn push_metadata(&self, upload: &UploadMetadata, wire_size: usize) -> Result<Value> {
        let path = self.cipher.encode_string(&upload.path)?;
        let related = upload
            .related_path
            .as_deref()
            .map(|path| self.cipher.encode_string(path))
            .transpose()?;
        let hash = upload
            .content_hash
            .as_deref()
            .map(|hash| self.cipher.encode_string(hash))
            .transpose()?
            .unwrap_or_default();
        let mut metadata = json!({"op":"push","path":path,"relatedpath":related,"extension":if upload.folder {String::new()}else {extension(upload.path.rsplit('/').next().unwrap_or_default())},"hash":hash,"ctime":if upload.deleted || upload.folder {0}else {upload.ctime},"mtime":if upload.deleted || upload.folder {0}else {upload.mtime},"folder":upload.folder,"deleted":upload.deleted});
        if !upload.deleted && !upload.folder {
            let object = metadata.as_object_mut().ok_or(SyncError::Protocol)?;
            object.insert("size".into(), json!(wire_size));
            object.insert("pieces".into(), json!(wire_size.div_ceil(PIECE_BYTES)));
        }
        Ok(metadata)
    }
}
