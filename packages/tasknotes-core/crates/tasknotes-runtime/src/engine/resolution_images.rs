//! Conflict choices preserve immutable binary images without array expansion.

use super::{Engine, Result, RuntimeError, payloads, staged::DurableFile};
use crate::types::{ConflictRevisions, PayloadInfo, ResolutionChoice};
use rusqlite::{OptionalExtension, params};
use tasknotes_vault::path::VaultPath;

impl Engine {
    /// Read one preserved image's metadata. The returned durable ID is scoped to
    /// this engine/profile; its bounded read API never synthesizes missing bytes.
    ///
    /// # Errors
    /// Rejects missing owner, unknown role and corrupt stored revision fences.
    pub fn conflict_payload_info(
        &self,
        profile: &str,
        id: &str,
        role: &str,
    ) -> Result<Option<PayloadInfo>> {
        self.profile(profile)?;
        let revision = match role {
            "base" => "base_revision",
            "local" => "local_revision",
            "remote" => "remote_payload_revision",
            _ => {
                return Err(RuntimeError::Validation(
                    "unknown conflict version".to_owned(),
                ));
            }
        };
        self.database(|db| {
            let (table, column, identifier) = id
                .strip_prefix("archive:")
                .map_or(("conflicts", "id", id), |journal| {
                    ("conflict_archive", "journal_id", journal)
                });
            let (image, revision): (Option<String>, Option<String>) = db
                .query_row(
                    &format!(
                        "SELECT {role},{revision} FROM {table} WHERE profile=? AND {column}=?"
                    ),
                    params![profile, identifier],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?
                .ok_or(RuntimeError::NotFound)?;
            let image = image
                .map(|id| payloads::image_info(db, profile, &id))
                .transpose()?;
            if image.as_ref().map(|image| &image.revision) != revision.as_ref() {
                return Err(RuntimeError::Storage(
                    "conflict payload revision mismatch".to_owned(),
                ));
            }
            Ok(image)
        })
    }

    pub(super) fn plan_resolution_images(
        &self,
        profile: &str,
        id: &str,
        expected: Option<&ConflictRevisions>,
        choice: &ResolutionChoice,
        payload: Option<PayloadInfo>,
    ) -> Result<Vec<DurableFile>> {
        if let ResolutionChoice::KeepBoth { new_path } = choice {
            VaultPath::parse(new_path)?;
        }
        let (path,base,local,remote)=self.database(|db|db.query_row("SELECT path,base_revision,local_revision,remote_payload_revision FROM conflicts WHERE profile=? AND id=?",params![profile,id],|row|Ok((row.get::<_,String>(0)?,row.get::<_,Option<String>>(1)?,row.get::<_,Option<String>>(2)?,row.get::<_,Option<String>>(3)?))).optional()?.ok_or(RuntimeError::NotFound))?;
        if expected.is_some_and(|expected| {
            expected.base != base || expected.local != local || expected.remote != remote
        }) {
            return Err(RuntimeError::Conflict);
        }
        let current = self.capture_file_image(profile, &path)?;
        let revision = current.as_ref().map(|image| image.revision.clone());
        if expected.map_or(revision != remote && revision != local, |expected| {
            expected.current != revision
        }) {
            return Err(RuntimeError::Conflict);
        }
        let mut writes = Vec::new();
        let replacement = match choice {
            ResolutionChoice::KeepLocal {} => self.conflict_payload_info(profile, id, "local")?,
            ResolutionChoice::KeepRemote {} => self.conflict_payload_info(profile, id, "remote")?,
            ResolutionChoice::ReplacePayload { .. } => payload,
            ResolutionChoice::KeepBoth { new_path } => {
                if new_path == &path || self.capture_file_image(profile, new_path)?.is_some() {
                    return Err(RuntimeError::Conflict);
                }
                let local = self
                    .conflict_payload_info(profile, id, "local")?
                    .ok_or_else(|| {
                        RuntimeError::Validation(
                            "a deletion has no local bytes to duplicate".to_owned(),
                        )
                    })?;
                writes.push(DurableFile {
                    ordinal: 0,
                    path: new_path.clone(),
                    expected: None,
                    before: None,
                    after: Some(local),
                });
                self.conflict_payload_info(profile, id, "remote")?
            }
        };
        writes.push(DurableFile {
            ordinal: i64::try_from(writes.len())
                .map_err(|_| RuntimeError::Storage("invalid resolution plan".to_owned()))?,
            path,
            expected: revision,
            before: current,
            after: replacement,
        });
        Ok(writes)
    }
}
