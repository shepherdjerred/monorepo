//! Owner lifetime checks and image use share the same SQL/operation boundary.

use super::{Engine, Mutation, Result, RuntimeError, lock_profile, payloads};
use crate::types::{Command, PayloadInfo, Receipt, ResolutionChoice};
use rusqlite::{Connection, OptionalExtension};

pub(super) fn lifetime(db: &Connection, profile: &str) -> Result<String> {
    let actual: String = db
        .query_row(
            "SELECT lifetime FROM profiles WHERE id=?",
            [profile],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(RuntimeError::NotFound)?;
    if actual.len() != 64
        || !actual
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(RuntimeError::Storage(
            "corrupt durable profile identity".to_owned(),
        ));
    }
    Ok(actual)
}

pub(super) fn check_lifetime(db: &Connection, profile: &str, expected: &str) -> Result<()> {
    match lifetime(db, profile) {
        Ok(actual) if actual == expected => Ok(()),
        Ok(_) | Err(RuntimeError::NotFound) => Err(RuntimeError::Closed),
        Err(error) => Err(error),
    }
}

impl Engine {
    /// Create/resume a caller image and capture its owner generation atomically.
    ///
    /// # Errors
    /// Rejects reserved/changed identity, size/hash bounds or unavailable owners.
    pub fn begin_payload_handle(
        &self,
        profile: &str,
        id: &str,
        size: u64,
        revision: &str,
    ) -> Result<(String, PayloadInfo)> {
        if id.starts_with("blob:") || id.starts_with("sync:") {
            return Err(RuntimeError::Validation(
                "payload identity uses a reserved runtime namespace".to_owned(),
            ));
        }
        let coordinator = self.coordinator(profile)?;
        let _operation = lock_profile(&coordinator)?;
        let lifetime = self.database(|db| lifetime(db, profile))?;
        let info = self.reserve_image(profile, id, size, revision, true)?;
        Ok((lifetime, info))
    }

    /// Capture existing image metadata and its owner in the same DB read.
    ///
    /// # Errors
    /// Rejects absent/corrupt owners or images and a closed engine.
    pub fn open_payload_handle(&self, profile: &str, id: &str) -> Result<(String, PayloadInfo)> {
        self.database(|db| Ok((lifetime(db, profile)?, payloads::metadata(db, profile, id)?)))
    }

    /// Read metadata only after checking the handle's original owner generation.
    ///
    /// # Errors
    /// Rejects retired owners, expired engine or corrupt retained data.
    pub fn payload_handle_info(
        &self,
        profile: &str,
        lifetime: &str,
        id: &str,
    ) -> Result<PayloadInfo> {
        self.database(|db| {
            check_lifetime(db, profile, lifetime)?;
            payloads::metadata(db, profile, id)
        })
    }

    /// Read one immutable chunk with owner validation under the same DB lock.
    ///
    /// # Errors
    /// Rejects retired owners, invalid bounds and incomplete/retired images.
    pub fn read_payload_handle(
        &self,
        profile: &str,
        lifetime: &str,
        id: &str,
        offset: u64,
        target: &mut [u8],
    ) -> Result<()> {
        self.database(|db| {
            check_lifetime(db, profile, lifetime)?;
            payloads::read_into(db, profile, id, offset, target)
        })
    }

    /// Write a bounded exact prefix while profile removal/recreation is excluded.
    ///
    /// # Errors
    /// Rejects retired owners, changed chunks and immutable images.
    pub fn write_payload_handle(
        &self,
        profile: &str,
        lifetime: &str,
        id: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<PayloadInfo> {
        let coordinator = self.coordinator(profile)?;
        let _operation = lock_profile(&coordinator)?;
        self.database(|db| check_lifetime(db, profile, lifetime))?;
        self.write_image(profile, id, offset, bytes)
    }

    /// Verify/seal an incoming image while its original owner remains fenced.
    ///
    /// # Errors
    /// Rejects retired owners and incomplete/corrupt incoming bytes.
    pub fn seal_payload_handle(
        &self,
        profile: &str,
        lifetime: &str,
        id: &str,
    ) -> Result<PayloadInfo> {
        let coordinator = self.coordinator(profile)?;
        let _operation = lock_profile(&coordinator)?;
        self.database(|db| check_lifetime(db, profile, lifetime))?;
        self.seal_image(profile, id)
    }

    /// Retire unreferenced incoming bytes without reaching a recreated owner.
    ///
    /// # Errors
    /// Rejects retired owners and any retained journal/outbox/conflict reference.
    pub fn discard_payload_handle(&self, profile: &str, lifetime: &str, id: &str) -> Result<()> {
        let coordinator = self.coordinator(profile)?;
        let _operation = lock_profile(&coordinator)?;
        self.database(|db| check_lifetime(db, profile, lifetime))?;
        self.discard_image(profile, id)
    }

    /// Execute a sealed handle decision with its lifetime checked under the same
    /// coordinator as planning, journal creation and staged file application.
    ///
    /// # Errors
    /// Rejects retired owners, misplaced/unsealed payloads and changed decisions.
    pub fn execute_payload_handle(
        &self,
        profile: &str,
        lifetime: &str,
        mutation: &Mutation,
        id: &str,
    ) -> Result<Receipt> {
        super::validate_mutation(mutation)?;
        if !matches!(
            &mutation.command,
            Command::ResolveConflict {
                resolution: ResolutionChoice::ReplacePayload { deleted: false },
                ..
            }
        ) {
            return Err(RuntimeError::Validation(
                "binary replacement payload does not match command disposition".to_owned(),
            ));
        }
        let info = self.database(|db| {
            check_lifetime(db, profile, lifetime)?;
            payloads::image_info(db, profile, id)
        })?;
        self.execute_image(profile, mutation, Some(info), Some(lifetime))
    }
}
