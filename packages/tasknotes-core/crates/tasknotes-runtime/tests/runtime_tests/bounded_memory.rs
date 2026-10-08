//! Fault-injected small in-memory capability for staged runtime tests. Large
//! allocation evidence uses a separate real file provider, never this Vec store.

use super::{ContentRevision, Memory, Result, RuntimeError};
use tasknotes_runtime::types::{
    DisplacedMetadata, DisplacedVersion, FileSnapshot, PAYLOAD_CHUNK_BYTES, ReplacementStage,
    StagedExchange,
};

pub(super) struct Stage {
    profile: String,
    expected: Option<String>,
    metadata: ReplacementStage,
    bytes: Vec<u8>,
}

impl Memory {
    pub(super) fn snapshot(&self, profile: &str, path: &str) -> Result<Option<FileSnapshot>> {
        let mut storage = self
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability failed".to_owned()))?;
        storage.reads += 1;
        if storage.fail_read.as_deref() == Some(path) {
            return Err(RuntimeError::Host("provider unavailable".to_owned()));
        }
        let Some(bytes) = storage
            .files
            .get(&(profile.to_owned(), path.to_owned()))
            .cloned()
        else {
            return Ok(None);
        };
        let metadata = FileSnapshot {
            id: format!("snapshot:{}", storage.snapshot_sequence),
            size: u64::try_from(bytes.len())
                .map_err(|_| RuntimeError::Host("test size failed".to_owned()))?,
            revision: ContentRevision::of(&bytes).as_str().to_owned(),
        };
        storage.snapshot_sequence += 1;
        storage
            .snapshots
            .insert(metadata.id.clone(), (profile.to_owned(), bytes));
        Ok(Some(metadata))
    }

    pub(super) fn backup_snapshot(&self, profile: &str, id: &str) -> Result<FileSnapshot> {
        let mut storage = self
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability failed".to_owned()))?;
        let bytes = storage
            .backups
            .get(id)
            .filter(|(owner, _)| owner == profile)
            .map(|(_, version)| version.bytes.clone())
            .ok_or(RuntimeError::NotFound)?;
        let metadata = FileSnapshot {
            id: format!("snapshot:{}", storage.snapshot_sequence),
            size: u64::try_from(bytes.len())
                .map_err(|_| RuntimeError::Host("test size failed".to_owned()))?,
            revision: ContentRevision::of(&bytes).as_str().to_owned(),
        };
        storage.snapshot_sequence += 1;
        storage
            .snapshots
            .insert(metadata.id.clone(), (profile.to_owned(), bytes));
        Ok(metadata)
    }

    pub(super) fn snapshot_chunk(
        &self,
        profile: &str,
        id: &str,
        offset: u64,
        length: u32,
    ) -> Result<Vec<u8>> {
        let storage = self
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability failed".to_owned()))?;
        let (_, bytes) = storage
            .snapshots
            .get(id)
            .filter(|(owner, _)| owner == profile)
            .ok_or(RuntimeError::NotFound)?;
        let offset = usize::try_from(offset).map_err(|_| RuntimeError::Conflict)?;
        let length = usize::try_from(length).map_err(|_| RuntimeError::Conflict)?;
        if length > PAYLOAD_CHUNK_BYTES {
            return Err(RuntimeError::Conflict);
        }
        let end = offset.checked_add(length).ok_or(RuntimeError::Conflict)?;
        Ok(bytes
            .get(offset..end)
            .ok_or(RuntimeError::Conflict)?
            .to_vec())
    }

    pub(super) fn snapshot_close(&self, profile: &str, id: &str) -> Result<()> {
        let mut storage = self
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability failed".to_owned()))?;
        if storage
            .snapshots
            .get(id)
            .is_some_and(|(owner, _)| owner != profile)
        {
            return Err(RuntimeError::Conflict);
        }
        storage.snapshots.remove(id);
        Ok(())
    }

    pub(super) fn stage_begin(
        &self,
        profile: &str,
        operation: &str,
        path: &str,
        expected: Option<&str>,
        size: u64,
        revision: &str,
    ) -> Result<ReplacementStage> {
        let mut storage = self
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability failed".to_owned()))?;
        if let Some(stage) = storage.stages.get(operation) {
            if stage.profile != profile
                || stage.expected.as_deref() != expected
                || stage.metadata.path != path
                || stage.metadata.size != size
                || stage.metadata.revision != revision
            {
                return Err(RuntimeError::Conflict);
            }
            return Ok(stage.metadata.clone());
        }
        let metadata = ReplacementStage {
            id: operation.to_owned(),
            operation_id: operation.to_owned(),
            path: path.to_owned(),
            size,
            revision: revision.to_owned(),
            written: 0,
            sealed: false,
        };
        storage.stages.insert(
            operation.to_owned(),
            Stage {
                profile: profile.to_owned(),
                expected: expected.map(str::to_owned),
                metadata: metadata.clone(),
                bytes: Vec::new(),
            },
        );
        Ok(metadata)
    }

    pub(super) fn stage_write(
        &self,
        profile: &str,
        id: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<ReplacementStage> {
        let mut storage = self
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability failed".to_owned()))?;
        let stage = storage
            .stages
            .get_mut(id)
            .filter(|stage| stage.profile == profile)
            .ok_or(RuntimeError::NotFound)?;
        if offset != stage.metadata.written
            || bytes.len() > PAYLOAD_CHUNK_BYTES
            || stage.metadata.sealed
        {
            return Err(RuntimeError::Conflict);
        }
        stage.bytes.extend_from_slice(bytes);
        stage.metadata.written =
            u64::try_from(stage.bytes.len()).map_err(|_| RuntimeError::Conflict)?;
        if stage.metadata.written > stage.metadata.size {
            return Err(RuntimeError::Conflict);
        }
        Ok(stage.metadata.clone())
    }

    pub(super) fn stage_seal(&self, profile: &str, id: &str) -> Result<ReplacementStage> {
        let mut storage = self
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability failed".to_owned()))?;
        let stage = storage
            .stages
            .get_mut(id)
            .filter(|stage| stage.profile == profile)
            .ok_or(RuntimeError::NotFound)?;
        if stage.metadata.written != stage.metadata.size
            || ContentRevision::of(&stage.bytes).as_str() != stage.metadata.revision
        {
            return Err(RuntimeError::Conflict);
        }
        stage.metadata.sealed = true;
        Ok(stage.metadata.clone())
    }

    pub(super) fn stage_discard(&self, profile: &str, id: &str) -> Result<()> {
        let mut storage = self
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability failed".to_owned()))?;
        let stage = storage
            .stages
            .get_mut(id)
            .filter(|stage| stage.profile == profile)
            .ok_or(RuntimeError::NotFound)?;
        stage.bytes.clear();
        Ok(())
    }

    pub(super) fn staged_exchange(
        &self,
        profile: &str,
        operation: &str,
        path: &str,
        expected: Option<&str>,
        stage_id: Option<&str>,
    ) -> Result<StagedExchange> {
        let mut storage = self
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability failed".to_owned()))?;
        if let Some(outcome) = storage.outcomes.get(operation) {
            return Ok(outcome.clone());
        }
        let replacement = stage_id
            .map(|id| {
                storage
                    .stages
                    .get(id)
                    .filter(|stage| {
                        stage.profile == profile
                            && stage.metadata.sealed
                            && stage.metadata.path == path
                            && stage.metadata.operation_id == operation
                            && stage.expected.as_deref() == expected
                    })
                    .map(|stage| stage.bytes.clone())
                    .ok_or(RuntimeError::Conflict)
            })
            .transpose()?;
        let key = (profile.to_owned(), path.to_owned());
        if let Some(race) = storage.racing_before_compare.take() {
            storage.files.insert(key.clone(), race);
        }
        let revision = storage
            .files
            .get(&key)
            .map(|bytes| ContentRevision::of(bytes).as_str().to_owned());
        if revision.as_deref() != expected {
            return Ok(StagedExchange {
                applied: false,
                displaced: None,
            });
        }
        if let Some(race) = storage.racing_bytes.take() {
            storage.files.insert(key.clone(), race);
        }
        let old = storage.files.remove(&key);
        if let Some(replacement) = replacement {
            storage.files.insert(key, replacement);
        }
        storage.exchanges += 1;
        let displaced = old.map(|bytes| {
            let id = format!("backup-{}", storage.exchanges);
            let metadata = DisplacedMetadata {
                id: id.clone(),
                path: path.to_owned(),
                size: u64::try_from(bytes.len()).unwrap_or(u64::MAX),
                revision: ContentRevision::of(&bytes).as_str().to_owned(),
            };
            storage.backups.insert(
                id.clone(),
                (
                    profile.to_owned(),
                    DisplacedVersion {
                        id,
                        path: path.to_owned(),
                        bytes,
                    },
                ),
            );
            metadata
        });
        let outcome = StagedExchange {
            applied: true,
            displaced,
        };
        storage
            .outcomes
            .insert(operation.to_owned(), outcome.clone());
        if storage.crash_after_exchange {
            storage.crash_after_exchange = false;
            return Err(RuntimeError::Host(
                "interrupted after durable exchange".to_owned(),
            ));
        }
        Ok(outcome)
    }
}
