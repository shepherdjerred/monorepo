//! Durable image plans and native staged exchange; binary bytes remain bounded.

use super::{
    Engine, Mutation, ProfileKind, Receipt, Result, RuntimeError, TaskNotesConfiguration,
    apply_remote_receipt, archive_resolution, count, payloads, receipt_task_path,
    restore_resolution,
};
use crate::types::{
    Conflict, DisplacedMetadata, PAYLOAD_CHUNK_BYTES, PayloadInfo, ReplacementStage,
};
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};
use tasknotes_vault::path::VaultPath;

#[derive(Clone)]
pub(super) struct DurableFile {
    pub ordinal: i64,
    pub path: String,
    pub expected: Option<String>,
    pub before: Option<PayloadInfo>,
    pub after: Option<PayloadInfo>,
}

pub(super) fn inline_files(
    db: &Connection,
    profile: &str,
    writes: &[super::PlannedFile],
) -> Result<Vec<DurableFile>> {
    writes
        .iter()
        .enumerate()
        .map(|(ordinal, write)| {
            let image = |bytes: Option<&[u8]>| {
                bytes
                    .map(|bytes| {
                        payloads::store_inline(db, profile, bytes)
                            .and_then(|id| payloads::image_info(db, profile, &id))
                    })
                    .transpose()
            };
            Ok(DurableFile {
                ordinal: i64::try_from(ordinal)
                    .map_err(|_| RuntimeError::Storage("too many planned files".to_owned()))?,
                path: write.path.clone(),
                expected: write.expected.clone(),
                before: image(write.before.as_deref())?,
                after: image(write.bytes.as_deref())?,
            })
        })
        .collect()
}

pub(super) fn store_files(
    db: &Connection,
    profile: &str,
    id: &str,
    writes: &[DurableFile],
) -> Result<()> {
    for write in writes {
        for image in [&write.before, &write.after].into_iter().flatten() {
            payloads::promote_content(db, profile, &image.id)?;
        }
        db.execute("INSERT INTO journal_files(profile,id,ordinal,path,expected,before,bytes) VALUES(?,?,?,?,?,?,?)",params![profile,id,write.ordinal,write.path,write.expected,write.before.as_ref().map(|image|&image.id),write.after.as_ref().map(|image|&image.id)])?;
    }
    Ok(())
}

pub(super) fn read_files(db: &Connection, profile: &str, id: &str) -> Result<Vec<DurableFile>> {
    let mut statement=db.prepare("SELECT ordinal,path,expected,before,bytes FROM journal_files WHERE profile=? AND id=? ORDER BY ordinal")?;
    let rows = statement.query_map(params![profile, id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
        ))
    })?;
    rows.map(|row| {
        let (ordinal, path, expected, before, after) = row?;
        VaultPath::parse(&path)?;
        let before = before
            .map(|id| payloads::image_info(db, profile, &id))
            .transpose()?;
        let after = after
            .map(|id| payloads::image_info(db, profile, &id))
            .transpose()?;
        if before.as_ref().map(|image| &image.revision) != expected.as_ref() {
            return Err(RuntimeError::Storage(
                "journal predecessor fence is corrupt".to_owned(),
            ));
        }
        Ok(DurableFile {
            ordinal,
            path,
            expected,
            before,
            after,
        })
    })
    .collect()
}

fn read_diagnostics(
    db: &Connection,
    profile: &str,
    id: &str,
) -> Result<Vec<crate::types::Diagnostic>> {
    let json: String = db.query_row(
        "SELECT diagnostics FROM journals WHERE profile=? AND id=?",
        params![profile, id],
        |row| row.get(0),
    )?;
    crate::types::parse_diagnostics(&json)
}

/// Only Markdown is assembled for its explicit text parsing policy. Attachments
/// and all durable binary images pass metadata/immutable references exclusively.
pub(super) fn cache_image(
    db: &Connection,
    profile: &str,
    path: &str,
    image: Option<&PayloadInfo>,
    config: Option<&TaskNotesConfiguration>,
    staged: bool,
) -> Result<()> {
    let (task, problem) = if let (Some(image), Some(config)) = (
        image.filter(|_| path.to_lowercase().ends_with(".md")),
        config,
    ) {
        let bytes = payloads::read_inline(db, profile, &image.id)?;
        match super::title_lineage::project(db, profile, path, &bytes, config, staged) {
            Ok(task) => (
                task.map(|task| serde_json::to_string(&task)).transpose()?,
                None,
            ),
            Err(error) => (None, Some(error.to_string())),
        }
    } else {
        (None, None)
    };
    let table = if staged { "refresh_stage" } else { "files" };
    db.execute(&format!("INSERT INTO {table}(profile,path,bytes,revision,task,problem) VALUES(?,?,?,?,?,?) ON CONFLICT(profile,path) DO UPDATE SET bytes=excluded.bytes,revision=excluded.revision,task=excluded.task,problem=excluded.problem"),params![profile,path,image.map(|image|&image.id),image.map(|image|&image.revision),task,problem])?;
    Ok(())
}

pub(super) fn conflict_images(
    db: &Connection,
    profile: &str,
    identity: (&str, &str, &str),
    base: Option<&PayloadInfo>,
    local: Option<&PayloadInfo>,
    remote: Option<&PayloadInfo>,
) -> Result<()> {
    let (id, path, remote_revision) = identity;
    let metadata = Conflict {
        id: id.to_owned(),
        path: path.to_owned(),
        base: None,
        local: None,
        remote: None,
        remote_revision: remote_revision.to_owned(),
    };
    db.execute("INSERT OR IGNORE INTO conflicts(profile,id,path,json,base,local,remote,base_revision,local_revision,remote_payload_revision) VALUES(?,?,?,?,?,?,?,?,?,?)",params![profile,id,path,serde_json::to_string(&metadata)?,base.map(|image|&image.id),local.map(|image|&image.id),remote.map(|image|&image.id),base.map(|image|&image.revision),local.map(|image|&image.revision),remote.map(|image|&image.revision)])?;
    Ok(())
}

impl Engine {
    fn commit_images(
        &self,
        profile: &str,
        id: &str,
        writes: &[DurableFile],
        config: Option<&TaskNotesConfiguration>,
        remote: bool,
    ) -> Result<Receipt> {
        let selected = self.profile(profile)?;
        self.database(|db| {
            let tx = db.transaction()?;
            let fingerprint: String = tx.query_row(
                "SELECT fingerprint FROM journals WHERE profile=? AND id=?",
                params![profile, id],
                |row| row.get(0),
            )?;
            let mutation = if fingerprint.starts_with('{') {
                Some(super::retired_timing::stored_mutation(&fingerprint)?)
            } else {
                None
            };
            super::title_lineage::apply_changes(&tx, profile, id, writes)?;
            for write in writes {
                cache_image(
                    &tx,
                    profile,
                    &write.path,
                    write.after.as_ref(),
                    config,
                    false,
                )?;
                if selected.kind == ProfileKind::ObsidianSync
                    && !remote
                    && write.before != write.after
                {
                    queue_image_upload(
                        &tx,
                        profile,
                        &format!("{id}:{}", write.ordinal),
                        write,
                        mutation.as_ref(),
                    )?;
                }
            }
            tx.execute(
                "UPDATE profiles SET configuration=?,version=version+1 WHERE id=?",
                params![config.map(serde_json::to_string).transpose()?, profile],
            )?;
            let receipt = Receipt {
                mutation_id: id.to_owned(),
                applied: true,
                cleanup_pending: false,
                diagnostics: read_diagnostics(&tx, profile, id)?,
                task_path: receipt_task_path(mutation.as_ref(), writes)?,
                paths: writes.iter().map(|write| write.path.clone()).collect(),
                pending_count: count(&tx, "outbox", profile)?,
            };
            archive_resolution(&tx, profile, id)?;
            if let Some(Mutation {
                command: crate::types::Command::Undo { receipt_id },
                ..
            }) = &mutation
            {
                restore_resolution(&tx, profile, receipt_id)?;
            }
            apply_remote_receipt(&tx, profile, id)?;
            tx.execute(
                "UPDATE journals SET receipt=? WHERE profile=? AND id=?",
                params![serde_json::to_string(&receipt)?, profile, id],
            )?;
            tx.commit()?;
            Ok(receipt)
        })
    }

    pub(super) fn cleanup_images(
        &self,
        profile: &str,
        id: &str,
        mut receipt: Receipt,
    ) -> Result<Receipt> {
        let prior = receipt.cleanup_pending;
        receipt.cleanup_pending = false;
        let stages=self.database(|db| {
            let mut statement=db.prepare("SELECT ordinal,stage_id,backup_id FROM journal_stages WHERE profile=? AND id=? AND cleanup_pending=1 ORDER BY ordinal")?;
            Ok(statement.query_map(params![profile,id],|row|Ok((row.get::<_,i64>(0)?,row.get::<_,Option<String>>(1)?,row.get::<_,Option<String>>(2)?)))?.collect::<rusqlite::Result<Vec<_>>>()?)
        })?;
        for (ordinal, stage, backup) in stages {
            let backup_failed = backup
                .as_deref()
                .is_some_and(|backup| self.files.acknowledge_displaced(profile, backup).is_err());
            let stage_failed = stage
                .as_deref()
                .is_some_and(|stage| self.files.discard_replacement(profile, stage).is_err());
            if backup_failed || stage_failed {
                receipt.cleanup_pending = true;
            } else {
                self.database(|db| {db.execute("UPDATE journal_stages SET cleanup_pending=0 WHERE profile=? AND id=? AND ordinal=?",params![profile,id,ordinal])?;Ok(())})?;
            }
        }
        if receipt.cleanup_pending || prior {
            self.database(|db| {
                db.execute(
                    "UPDATE journals SET receipt=? WHERE profile=? AND id=?",
                    params![serde_json::to_string(&receipt)?, profile, id],
                )?;
                Ok(())
            })?;
        }
        Ok(receipt)
    }

    fn park_images(
        &self,
        profile: &str,
        id: &str,
        writes: &[DurableFile],
        config: Option<&TaskNotesConfiguration>,
    ) -> Result<Receipt> {
        for write in writes {
            let current = self.capture_file_image(profile, &write.path)?;
            self.database(|db| {
                let tx = db.transaction()?;
                let predecessor_retained=tx.query_row("SELECT count(*) FROM journal_stages JOIN conflicts ON conflicts.profile=journal_stages.profile AND conflicts.id='host:'||journal_stages.backup_id WHERE journal_stages.profile=? AND journal_stages.id=? AND journal_stages.ordinal=?",params![profile,id,write.ordinal],|row|row.get::<_,i64>(0))?!=0;
                if current!=write.after || !predecessor_retained {conflict_images(
                    &tx,
                    profile,
                    (&format!("journal:{id}:{}", write.path), &write.path,""),
                    write.before.as_ref(),
                    write.after.as_ref(),
                    current.as_ref(),
                )?;}
                cache_image(&tx, profile, &write.path, current.as_ref(), config, false)?;
                tx.commit()?;
                Ok(())
            })?;
        }
        self.database(|db| {
            let tx = db.transaction()?;
            apply_remote_receipt(&tx, profile, id)?;
            let receipt = Receipt {
                mutation_id: id.to_owned(),
                applied: false,
                cleanup_pending: false,
                diagnostics: read_diagnostics(&tx, profile, id)?,
                task_path: None,
                paths: writes.iter().map(|write| write.path.clone()).collect(),
                pending_count: count(&tx, "outbox", profile)?,
            };
            tx.execute(
                "UPDATE journals SET receipt=? WHERE profile=? AND id=?",
                params![serde_json::to_string(&receipt)?, profile, id],
            )?;
            tx.execute(
                "UPDATE profiles SET version=version+1 WHERE id=?",
                [profile],
            )?;
            tx.commit()?;
            Ok(receipt)
        })
    }

    pub(super) fn finish_staged_journal(
        &self,
        profile: &str,
        id: &str,
        config: Option<&TaskNotesConfiguration>,
        remote: bool,
    ) -> Result<Receipt> {
        self.database(|db| read_diagnostics(db, profile, id))?;
        let writes = self.database(|db| read_files(db, profile, id))?;
        self.database(|db| super::title_lineage::read_changes(db, profile, id, &writes))?;
        for write in &writes {
            if !self.exchange_image(profile, id, write)? {
                let receipt = self.park_images(profile, id, &writes, config)?;
                self.cleanup_images(profile, id, receipt)?;
                return Err(RuntimeError::Conflict);
            }
        }
        let receipt = self.commit_images(profile, id, &writes, config, remote)?;
        self.cleanup_images(profile, id, receipt)
    }

    fn operation_id(&self, profile: &str, journal: &str, write: &DurableFile) -> Result<String> {
        let intent = serde_json::to_vec(&(
            self.identity()?,
            profile,
            journal,
            write.ordinal,
            &write.path,
            &write.expected,
            write
                .after
                .as_ref()
                .map(|image| (&image.id, image.size, &image.revision)),
        ))?;
        Ok(format!(
            "facet-write:{}",
            hex::encode(Sha256::digest(intent))
        ))
    }

    fn exchange_image(&self, profile: &str, id: &str, write: &DurableFile) -> Result<bool> {
        let operation = self.operation_id(profile, id, write)?;
        let stage = write
            .after
            .as_ref()
            .map(|image| self.prepare_stage(profile, &operation, write, image))
            .transpose()?;
        self.database(|db| {
            db.execute("INSERT INTO journal_stages(profile,id,ordinal,operation_id,stage_id) VALUES(?,?,?,?,?) ON CONFLICT(profile,id,ordinal) DO NOTHING",params![profile,id,write.ordinal,operation,stage.as_ref().map(|stage|&stage.id)])?;
            let stored:(String,Option<String>)=db.query_row("SELECT operation_id,stage_id FROM journal_stages WHERE profile=? AND id=? AND ordinal=?",params![profile,id,write.ordinal],|row|Ok((row.get(0)?,row.get(1)?)))?;
            if stored.0!=operation || stored.1.as_deref()!=stage.as_ref().map(|stage|stage.id.as_str()) {
                return Err(RuntimeError::Storage("journal stage ownership changed".to_owned()));
            }
            Ok(())
        })?;
        let outcome = self.files.compare_exchange_staged(
            profile,
            &operation,
            &write.path,
            write.expected.as_deref(),
            stage.as_ref().map(|stage| stage.id.as_str()),
        )?;
        if !outcome.applied {
            return Ok(false);
        }
        let captured = outcome
            .displaced
            .as_ref()
            .map(|metadata| self.capture_predecessor(profile, write, metadata))
            .transpose()?;
        self.database(|db| {
            let tx = db.transaction()?;
            if let Some(metadata) = &outcome.displaced {
                tx.execute(
                    "INSERT OR IGNORE INTO displaced(profile,id) VALUES(?,?)",
                    params![profile, metadata.id],
                )?;
            }
            tx.execute(
                "UPDATE journal_stages SET backup_id=? WHERE profile=? AND id=? AND ordinal=?",
                params![
                    outcome.displaced.as_ref().map(|metadata| &metadata.id),
                    profile,
                    id,
                    write.ordinal
                ],
            )?;
            if let (Some(image), Some(metadata)) = (captured.as_ref(), outcome.displaced.as_ref())
                && Some(&image.revision) != write.expected.as_ref()
            {
                conflict_images(
                    &tx,
                    profile,
                    (&format!("host:{}", metadata.id), &write.path, ""),
                    write.before.as_ref(),
                    write.after.as_ref(),
                    Some(image),
                )?;
            }
            tx.commit()?;
            Ok(())
        })?;
        Ok(captured.as_ref().map(|image| &image.revision) == write.expected.as_ref())
    }

    fn capture_predecessor(
        &self,
        profile: &str,
        write: &DurableFile,
        metadata: &DisplacedMetadata,
    ) -> Result<PayloadInfo> {
        if metadata.path != write.path {
            return Err(RuntimeError::HostContract(
                "exchange displaced a different path".to_owned(),
            ));
        }
        let snapshot = self.files.open_displaced_snapshot(profile, &metadata.id)?;
        if snapshot.size != metadata.size || snapshot.revision != metadata.revision {
            let closed = self.files.close_snapshot(profile, &snapshot.id);
            closed?;
            return Err(RuntimeError::HostContract(
                "displaced snapshot changed immutable metadata".to_owned(),
            ));
        }
        self.capture_snapshot(profile, &snapshot)
    }

    fn prepare_stage(
        &self,
        profile: &str,
        operation: &str,
        write: &DurableFile,
        image: &PayloadInfo,
    ) -> Result<ReplacementStage> {
        let mut stage = self.files.begin_replacement(
            profile,
            operation,
            &write.path,
            write.expected.as_deref(),
            image.size,
            &image.revision,
        )?;
        validate_stage(&stage, operation, write, image, None)?;
        let mut buffer = vec![0; PAYLOAD_CHUNK_BYTES];
        while stage.written < image.size {
            let length = usize::try_from(
                (image.size - stage.written).min(
                    u64::try_from(buffer.len())
                        .map_err(|_| RuntimeError::Storage("invalid chunk bound".to_owned()))?,
                ),
            )
            .map_err(|_| RuntimeError::Storage("invalid staged range".to_owned()))?;
            let target = buffer
                .get_mut(..length)
                .ok_or_else(|| RuntimeError::Storage("invalid staged buffer".to_owned()))?;
            self.read_payload_into(profile, &image.id, stage.written, target)?;
            let next =
                self.files
                    .write_replacement_chunk(profile, &stage.id, stage.written, target)?;
            validate_stage(&next, operation, write, image, Some(&stage.id))?;
            if next.written
                != stage.written
                    + u64::try_from(length)
                        .map_err(|_| RuntimeError::Storage("invalid chunk size".to_owned()))?
            {
                return Err(RuntimeError::HostContract(
                    "stage did not persist the exact contiguous prefix".to_owned(),
                ));
            }
            stage = next;
        }
        let sealed = self.files.seal_replacement(profile, &stage.id)?;
        validate_stage(&sealed, operation, write, image, Some(&stage.id))?;
        if !sealed.sealed || sealed.written != image.size {
            return Err(RuntimeError::HostContract(
                "replacement was not durably sealed".to_owned(),
            ));
        }
        Ok(sealed)
    }
}

fn queue_image_upload(
    db: &Connection,
    profile: &str,
    operation: &str,
    write: &DurableFile,
    mutation: Option<&Mutation>,
) -> Result<()> {
    let modified = mutation
        .map(|mutation| crate::features::timestamp(&mutation.at).map(|at| at.timestamp_millis()))
        .transpose()?;
    if modified.is_some_and(|at| at < 0) {
        return Err(RuntimeError::Validation(
            "Sync file timestamps precede the Unix epoch".to_owned(),
        ));
    }
    let (remote_revision, created): (Option<String>, Option<i64>) = db.query_row(
        "SELECT remote_revision,created_ms FROM files WHERE profile=? AND path=?",
        params![profile, write.path],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let related = mutation.and_then(|mutation| match &mutation.command {
        crate::types::Command::Rename { path, new_path, .. } if new_path == &write.path => {
            Some(path.as_str())
        }
        _ => None,
    });
    let created = if let Some(source) = related {
        db.query_row(
            "SELECT created_ms FROM files WHERE profile=? AND path=?",
            params![profile, source],
            |row| row.get::<_, Option<i64>>(0),
        )
        .optional()?
        .flatten()
    } else {
        created
    };
    let created = created.or_else(|| {
        (write.before.is_none() && related.is_none())
            .then_some(modified)
            .flatten()
    });
    db.execute(
        "UPDATE files SET created_ms=?,modified_ms=?,related_path=? WHERE profile=? AND path=?",
        params![created, modified, related, profile, write.path],
    )?;
    db.execute("INSERT OR IGNORE INTO outbox(profile,id,path,bytes,revision,remote_revision,created_ms,modified_ms,related_path) VALUES(?,?,?,?,?,?,?,?,?)",params![profile,operation,write.path,write.after.as_ref().map(|image|&image.id),write.after.as_ref().map(|image|&image.revision),remote_revision,created,modified,related])?;
    Ok(())
}

fn validate_stage(
    stage: &ReplacementStage,
    operation: &str,
    write: &DurableFile,
    image: &PayloadInfo,
    expected_id: Option<&str>,
) -> Result<()> {
    if stage.id.is_empty()
        || stage.id.len() > 256
        || stage.id.chars().any(char::is_control)
        || expected_id.is_some_and(|id| id != stage.id)
        || stage.operation_id != operation
        || stage.path != write.path
        || stage.size != image.size
        || stage.revision != image.revision
        || stage.written > stage.size
        || (stage.sealed && stage.written != stage.size)
    {
        return Err(RuntimeError::HostContract(
            "replacement stage changed immutable ownership or intent".to_owned(),
        ));
    }
    Ok(())
}
