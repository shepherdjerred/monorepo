//! Owned authenticated protocol bytes are staged once, then dropped before CAS.

use super::{Engine, RemoteMetadata, Result, RuntimeError, lock_profile, try_lock_profile};
use crate::types::{PAYLOAD_CHUNK_BYTES, PayloadInfo, ProfileKind};
use obsidian_sync::session::{Download, RemoteFile, Session};
use rusqlite::OptionalExtension;
use sha2::{Digest, Sha256};

/// Immutable staged remote receipt. Only preparation creates this value; callers
/// cannot substitute metadata or a payload from another owner during application.
pub struct PreparedDownload {
    profile: String,
    namespace: String,
    vault: String,
    binding_epoch: String,
    metadata: RemoteFile,
    image: Option<PayloadInfo>,
    revision_json: String,
}

impl Engine {
    fn validate_durable_notice(&self, profile: &str, metadata: &RemoteFile) -> Result<()> {
        self.database(|db| {
            let uid = i64::try_from(metadata.uid).map_err(|_| {
                RuntimeError::Validation("remote UID exceeds storage range".to_owned())
            })?;
            let raw: String = db
                .query_row(
                    "SELECT json FROM checkpoint_pending WHERE profile=? AND uid=?",
                    rusqlite::params![profile, uid],
                    |row| row.get(0),
                )
                .optional()?
                .ok_or(RuntimeError::NotFound)?;
            let durable: RemoteFile = serde_json::from_str(&raw)?;
            if &durable != metadata {
                return Err(RuntimeError::Conflict);
            }
            Ok(())
        })
    }

    /// Read the immutable generation of one registered profile. Handles from a
    /// removed profile cannot access a later profile with the same public ID.
    ///
    /// # Errors
    /// Rejects absent/closed profiles or corrupt durable identity metadata.
    pub fn profile_lifetime(&self, profile: &str) -> Result<String> {
        self.database(|db| super::payload_handles::lifetime(db, profile))
    }

    /// Create a nonsecret transient session namespace. This is handle identity,
    /// never an encryption nonce, credential or authorization key.
    ///
    /// # Errors
    /// Rejects a closed engine or unavailable durable storage.
    pub fn session_namespace(&self) -> Result<String> {
        self.database(|db| {
            Ok(db.query_row("SELECT lower(hex(randomblob(32)))", [], |row| row.get(0))?)
        })
    }

    /// Read the durable actual-vault binding generation. Removal/recreation of a
    /// profile cannot authorize a prior session's prepared receipt.
    ///
    /// # Errors
    /// Rejects absent/changed bindings, corrupt identities or a closed engine.
    pub fn sync_binding_identity(&self, profile: &str, vault_id: &str) -> Result<String> {
        if self.profile(profile)?.kind != ProfileKind::ObsidianSync {
            return Err(RuntimeError::Validation(
                "Sync requires an app-private replica".to_owned(),
            ));
        }
        self.database(|db| {
            let binding: Option<(String, String)> = db
                .query_row(
                    "SELECT vault_id,binding_epoch FROM profile_sync_bindings WHERE profile=?",
                    [profile],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let (vault, epoch) = binding.ok_or(RuntimeError::NotFound)?;
            if vault != vault_id {
                return Err(RuntimeError::Conflict);
            }
            if epoch.len() != 64
                || !epoch
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            {
                return Err(RuntimeError::Storage(
                    "corrupt durable binding identity".to_owned(),
                ));
            }
            Ok(epoch)
        })
    }

    /// Stage an authenticated owned completion in one owner-scoped `SQLite` image.
    /// The caller retains the original frame on failure and drops it after this
    /// succeeds, before calling apply. No provider callback occurs here.
    ///
    /// # Errors
    /// Rejects wrong profile/vault, pending metadata, hash, disposition or storage.
    pub fn prepare_authenticated_download(
        &self,
        profile: &str,
        session: &Session,
        download: &Download,
    ) -> Result<PreparedDownload> {
        self.prepare_download(profile, None, session, download)
    }

    /// Stage only through the original durable session binding generation.
    ///
    /// # Errors
    /// Rejects expired bindings, incomplete durability and authenticated mismatch.
    pub fn prepare_authenticated_download_fenced(
        &self,
        profile: &str,
        binding_epoch: &str,
        session: &Session,
        download: &Download,
    ) -> Result<PreparedDownload> {
        self.prepare_download(profile, Some(binding_epoch), session, download)
    }

    fn prepare_download(
        &self,
        profile: &str,
        expected_binding: Option<&str>,
        session: &Session,
        download: &Download,
    ) -> Result<PreparedDownload> {
        let coordinator = self.coordinator(profile)?;
        let _operation = try_lock_profile(&coordinator)?;
        let binding_epoch = self.sync_binding_identity(profile, session.vault_id())?;
        if expected_binding.is_some_and(|expected| expected != binding_epoch) {
            return Err(RuntimeError::Closed);
        }
        let metadata = session
            .checkpoint()
            .pending
            .get(&download.uid)
            .ok_or(RuntimeError::NotFound)?
            .clone();
        metadata
            .validate()
            .map_err(|_| RuntimeError::Validation("invalid remote metadata".to_owned()))?;
        self.validate_durable_notice(profile, &metadata)?;
        if metadata.folder || !metadata.selected || metadata.deleted != download.bytes.is_none() {
            return Err(RuntimeError::Validation(
                "download does not match selected remote disposition".to_owned(),
            ));
        }
        let image = if let Some(bytes) = &download.bytes {
            let revision = download.content_hash.as_deref().ok_or_else(|| {
                RuntimeError::Validation("authenticated download is missing its hash".to_owned())
            })?;
            if revision != metadata.hash || hex::encode(Sha256::digest(bytes)) != revision {
                return Err(RuntimeError::Validation(
                    "download does not match authenticated remote hash".to_owned(),
                ));
            }
            let identity = format!(
                "sync:{}",
                hex::encode(Sha256::digest(serde_json::to_vec(&(
                    self.identity()?,
                    profile,
                    session.vault_id(),
                    &metadata
                ))?))
            );
            let info = self.reserve_image(
                profile,
                &identity,
                u64::try_from(bytes.len())
                    .map_err(|_| RuntimeError::Validation("invalid download size".to_owned()))?,
                revision,
                true,
            )?;
            if info.state == crate::types::PayloadState::Sealed {
                Some(info)
            } else {
                for (ordinal, chunk) in bytes.chunks(PAYLOAD_CHUNK_BYTES).enumerate() {
                    let offset = u64::try_from(
                        ordinal
                            .checked_mul(PAYLOAD_CHUNK_BYTES)
                            .ok_or(RuntimeError::Conflict)?,
                    )
                    .map_err(|_| RuntimeError::Conflict)?;
                    self.write_image(profile, &identity, offset, chunk)?;
                }
                Some(self.seal_image(profile, &identity)?)
            }
        } else {
            if download.content_hash.is_some() || !metadata.hash.is_empty() {
                return Err(RuntimeError::Validation(
                    "deleted download must omit its content hash".to_owned(),
                ));
            }
            None
        };
        let revision_json = serde_json::to_string(&RemoteMetadata {
            schema_version: 1,
            uid: metadata.uid,
            ctime: metadata.ctime,
            mtime: metadata.mtime,
            related_path: metadata.related_path.clone(),
            content_hash: image.as_ref().map(|image| image.revision.clone()),
        })?;
        Ok(PreparedDownload {
            profile: profile.to_owned(),
            namespace: self.identity()?.to_owned(),
            vault: session.vault_id().to_owned(),
            binding_epoch,
            metadata,
            image,
            revision_json,
        })
    }

    /// Apply or park the staged receipt after its original protocol frame was
    /// dropped. Remote UID removal remains a separate checkpoint barrier.
    ///
    /// # Errors
    /// Rejects changed owners/pending metadata, unsealed images or provider failure.
    pub fn apply_authenticated_download(
        &self,
        profile: &str,
        prepared: &PreparedDownload,
    ) -> Result<()> {
        let coordinator = self.coordinator(profile)?;
        let _operation = lock_profile(&coordinator)?;
        if prepared.profile != profile
            || prepared.namespace != self.identity()?
            || self.sync_binding_identity(profile, &prepared.vault)? != prepared.binding_epoch
        {
            return Err(RuntimeError::Conflict);
        }
        self.validate_durable_notice(profile, &prepared.metadata)?;
        self.ingest_payload_coordinated(
            profile,
            &prepared.metadata.path,
            prepared.image.as_ref().map(|image| image.id.as_str()),
            &prepared.revision_json,
        )
    }
}
