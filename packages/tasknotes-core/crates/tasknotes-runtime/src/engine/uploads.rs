//! Runtime-owned upload preparation: metadata first, one final Rust allocation.

use super::{Engine, Result, RuntimeError, payloads, try_lock_profile, validate_identity};
use crate::types::{PAYLOAD_CHUNK_BYTES, ProfileKind};
use obsidian_sync::{
    crypto::ContentFrame,
    session::{Effect, Session, UploadMetadata},
};
use rusqlite::{OptionalExtension, params};

type OutboxRow = (
    String,
    String,
    Option<String>,
    Option<String>,
    Option<i64>,
    Option<i64>,
    Option<String>,
);

/// Storage/profile failures remain separate from protocol admission failures.
#[derive(Debug, thiserror::Error)]
pub enum UploadPreparationError {
    /// Durable receipt, owner or storage failure.
    #[error(transparent)]
    Runtime(#[from] RuntimeError),
    /// Typed queue/size/authentication/session rejection; outbox remains retained.
    #[error(transparent)]
    Sync(#[from] obsidian_sync::SyncError),
}

impl Engine {
    /// Bind a private profile to one actual remote vault without changing its
    /// identity, clocks or retained data. Rebinding another vault is rejected;
    /// explicit profile disposition/removal precedes a different-vault setup.
    ///
    /// # Errors
    /// Rejects invalid identities, local profiles, changed bindings and storage.
    pub fn bind_sync_profile(&self, profile: &str, vault_id: &str) -> Result<()> {
        validate_identity(vault_id)?;
        let coordinator = self.coordinator(profile)?;
        let _operation = try_lock_profile(&coordinator)?;
        if self.profile(profile)?.kind != ProfileKind::ObsidianSync {
            return Err(RuntimeError::Validation(
                "Sync requires an app-private replica".to_owned(),
            ));
        }
        self.database(|db| {
            let tx = db.transaction()?;
            let previous: Option<String> = tx
                .query_row(
                    "SELECT vault_id FROM profile_sync_bindings WHERE profile=?",
                    [profile],
                    |row| row.get(0),
                )
                .optional()?;
            if previous
                .as_deref()
                .is_some_and(|previous| previous != vault_id)
            {
                return Err(RuntimeError::Conflict);
            }
            tx.execute(
                "INSERT OR IGNORE INTO profile_sync_bindings(profile,vault_id) VALUES(?,?)",
                params![profile, vault_id],
            )?;
            tx.commit()?;
            Ok(())
        })
    }

    /// Queue the exact immutable outbox head through a runtime-bound session.
    /// The caller holds its serial session lock; there are no native file/byte
    /// callbacks here. Admission runs before allocating, and `SQLite` fills the
    /// final nonce/plaintext/tag frame directly in bounded chunks. Encryption
    /// and reconnect reuse that same allocation; durable ownership stays outbox.
    ///
    /// # Errors
    /// Rejects wrong vault/profile, unavailable receipts, metadata corruption,
    /// immutable hash mismatch and typed protocol admission failures.
    pub fn queue_durable_upload(
        &self,
        profile: &str,
        session: &mut Session,
        operation_id: &str,
        nonce: [u8; 12],
        now: u64,
    ) -> std::result::Result<Vec<Effect>, UploadPreparationError> {
        self.queue_upload_image(profile, None, session, (operation_id, nonce, now))
    }

    /// Queue only through the original durable binding generation.
    ///
    /// # Errors
    /// Rejects expired bindings, unavailable receipts and typed admission limits.
    pub fn queue_durable_upload_fenced(
        &self,
        profile: &str,
        binding_epoch: &str,
        session: &mut Session,
        request: (&str, [u8; 12], u64),
    ) -> std::result::Result<Vec<Effect>, UploadPreparationError> {
        self.queue_upload_image(profile, Some(binding_epoch), session, request)
    }

    fn queue_upload_image(
        &self,
        profile: &str,
        expected_binding: Option<&str>,
        session: &mut Session,
        request: (&str, [u8; 12], u64),
    ) -> std::result::Result<Vec<Effect>, UploadPreparationError> {
        let (operation_id, nonce, now) = request;
        validate_identity(operation_id)?;
        let coordinator = self.coordinator(profile)?;
        let _operation = try_lock_profile(&coordinator)?;
        let binding = self.sync_binding_identity(profile, session.vault_id())?;
        if expected_binding.is_some_and(|expected| expected != binding) {
            return Err(RuntimeError::Closed.into());
        }
        if self.profile(profile)?.kind != ProfileKind::ObsidianSync {
            return Err(RuntimeError::Validation(
                "Sync requires an app-private replica".to_owned(),
            )
            .into());
        }
        let (metadata,image_id)=self.database(|db| {
            let vault:String=db.query_row("SELECT vault_id FROM profile_sync_bindings WHERE profile=?",[profile],|row|row.get(0)).optional()?.ok_or(RuntimeError::NotFound)?;
            if vault!=session.vault_id() {return Err(RuntimeError::Conflict);}
            let row:Option<OutboxRow>=db.query_row("SELECT id,path,bytes,revision,created_ms,modified_ms,related_path FROM outbox WHERE profile=? AND NOT EXISTS(SELECT 1 FROM conflicts WHERE conflicts.profile=outbox.profile AND conflicts.path=outbox.path) ORDER BY sequence LIMIT 1",[profile],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?))).optional()?;
            let (original,path,image,revision,created,modified,related_path)=row.ok_or(RuntimeError::NotFound)?;
            if original!=operation_id {return Err(RuntimeError::Conflict);}
            let info=image.as_deref().map(|image|payloads::image_info(db,profile,image)).transpose()?;
            if info.as_ref().map(|info|&info.revision)!=revision.as_ref() {return Err(RuntimeError::Storage("upload reference metadata mismatch".to_owned()));}
            let metadata=UploadMetadata{operation_id:original,path,related_path,ctime:required_timestamp(created)?,mtime:required_timestamp(modified)?,folder:false,deleted:image.is_none(),size:info.as_ref().map_or(0,|info|info.size),content_hash:revision};
            Ok((metadata,image))
        })?;
        session.admit_upload(&metadata)?;
        let frame = if metadata.size == 0 {
            None
        } else {
            let mut frame = ContentFrame::new(
                usize::try_from(metadata.size)
                    .map_err(|_| RuntimeError::Storage("invalid upload size".to_owned()))?,
                nonce,
            )?;
            let image = image_id.ok_or(RuntimeError::NotFound)?;
            let mut offset = 0_u64;
            for chunk in frame.content_mut()?.chunks_mut(PAYLOAD_CHUNK_BYTES) {
                self.read_payload_into(profile, &image, offset, chunk)?;
                offset += u64::try_from(chunk.len())
                    .map_err(|_| RuntimeError::Storage("invalid upload chunk".to_owned()))?;
            }
            Some(frame)
        };
        Ok(session.queue_content_frame(metadata, frame, now)?)
    }
}

fn required_timestamp(value: Option<i64>) -> Result<u64> {
    value
        .and_then(|value| u64::try_from(value).ok())
        .ok_or_else(|| {
            RuntimeError::Validation(
                "upload is missing its original immutable timestamps".to_owned(),
            )
        })
}
