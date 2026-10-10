//! Real disk-backed bounded images for storage fixtures. These controlled effects
//! test runtime journaling, not native provider atomic exchange/power-loss proof.

use super::{Disk, DisplacedMetadata, RuntimeError, host};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
};
use tasknotes_runtime::types::{
    FileSnapshot, PAYLOAD_CHUNK_BYTES, ReplacementStage, StagedExchange,
};

type Result<T> = tasknotes_runtime::Result<T>;
pub(super) fn contract() -> RuntimeError {
    RuntimeError::HostContract("fixture_image_contract".into())
}
pub(super) struct Stage {
    info: ReplacementStage,
    expected: Option<String>,
}

fn fingerprint(path: &Path) -> Result<(u64, String)> {
    let mut file = fs::File::open(path).map_err(host)?;
    let mut digest = Sha256::new();
    let mut chunk = vec![0; 65536];
    let mut size = 0;
    loop {
        let count = file.read(&mut chunk).map_err(host)?;
        if count == 0 {
            break;
        }
        digest.update(chunk.get(..count).ok_or_else(contract)?);
        size += u64::try_from(count).map_err(|_| contract())?;
    }
    Ok((size, hex::encode(digest.finalize())))
}
impl Disk {
    pub(super) fn snapshot(&self, source: &Path) -> Result<Option<FileSnapshot>> {
        if !source.try_exists().map_err(host)? {
            return Ok(None);
        }
        let mut registry = self.state.lock().map_err(|_| contract())?;
        registry.sequence += 1;
        let id = format!("snapshot-{:08}", registry.sequence);
        let path = self.root.join(&id);
        fs::copy(source, &path).map_err(host)?;
        let (size, revision) = fingerprint(&path)?;
        registry.snapshots.insert(id.clone(), path);
        Ok(Some(FileSnapshot { id, size, revision }))
    }
    pub(super) fn snapshot_chunk(&self, id: &str, offset: u64, length: u32) -> Result<Vec<u8>> {
        let registry = self.state.lock().map_err(|_| contract())?;
        let path = registry.snapshots.get(id).ok_or_else(contract)?;
        let mut file = fs::File::open(path).map_err(host)?;
        let count = usize::try_from(length).map_err(|_| contract())?;
        let size = file.metadata().map_err(host)?.len();
        if count > PAYLOAD_CHUNK_BYTES
            || offset
                .checked_add(u64::from(length))
                .is_none_or(|end| end > size)
        {
            return Err(contract());
        }
        file.seek(SeekFrom::Start(offset)).map_err(host)?;
        let mut bytes = vec![0; count];
        file.read_exact(&mut bytes).map_err(host)?;
        Ok(bytes)
    }
    pub(super) fn close_image(&self, id: &str) -> Result<()> {
        let mut registry = self.state.lock().map_err(|_| contract())?;
        let path = registry.snapshots.remove(id).ok_or_else(contract)?;
        fs::remove_file(path).map_err(host)
    }
    pub(super) fn start_stage(
        &self,
        operation: &str,
        path: &str,
        expected: Option<&str>,
        size: u64,
        revision: &str,
    ) -> Result<ReplacementStage> {
        self.path(path)?;
        let mut registry = self.state.lock().map_err(|_| contract())?;
        let id = format!(
            "stage-{}",
            hex::encode(Sha256::digest(operation.as_bytes()))
        );
        if let Some(stage) = registry.stages.get(&id) {
            if stage.info.operation_id != operation
                || stage.info.path != path
                || stage.expected.as_deref() != expected
                || stage.info.size != size
                || stage.info.revision != revision
            {
                return Err(contract());
            }
            return Ok(stage.info.clone());
        }
        fs::File::create(self.root.join(&id))
            .map_err(host)?
            .sync_all()
            .map_err(host)?;
        let info = ReplacementStage {
            id: id.clone(),
            operation_id: operation.into(),
            path: path.into(),
            size,
            revision: revision.into(),
            written: 0,
            sealed: false,
        };
        registry.stages.insert(
            id,
            Stage {
                info: info.clone(),
                expected: expected.map(str::to_owned),
            },
        );
        Ok(info)
    }
    pub(super) fn write_stage(
        &self,
        id: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<ReplacementStage> {
        let mut registry = self.state.lock().map_err(|_| contract())?;
        let stage = registry.stages.get_mut(id).ok_or_else(contract)?;
        let end = offset
            .checked_add(u64::try_from(bytes.len()).map_err(|_| contract())?)
            .ok_or_else(contract)?;
        if bytes.is_empty()
            || bytes.len() > PAYLOAD_CHUNK_BYTES
            || end > stage.info.size
            || offset > stage.info.written
        {
            return Err(contract());
        }
        let mut file = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(self.root.join(id))
            .map_err(host)?;
        file.seek(SeekFrom::Start(offset)).map_err(host)?;
        if end <= stage.info.written {
            let mut previous = vec![0; bytes.len()];
            file.read_exact(&mut previous).map_err(host)?;
            if previous != bytes {
                return Err(contract());
            }
        } else {
            if stage.info.sealed || offset != stage.info.written {
                return Err(contract());
            }
            file.write_all(bytes).map_err(host)?;
            file.sync_all().map_err(host)?;
            stage.info.written = end;
        }
        Ok(stage.info.clone())
    }
    pub(super) fn seal_stage(&self, id: &str) -> Result<ReplacementStage> {
        let mut registry = self.state.lock().map_err(|_| contract())?;
        let stage = registry.stages.get_mut(id).ok_or_else(contract)?;
        let (size, revision) = fingerprint(&self.root.join(id))?;
        if size != stage.info.size || revision != stage.info.revision || stage.info.written != size
        {
            return Err(contract());
        }
        stage.info.sealed = true;
        Ok(stage.info.clone())
    }
    pub(super) fn discard_stage(&self, id: &str) -> Result<()> {
        let registry = self.state.lock().map_err(|_| contract())?;
        if !registry.stages.contains_key(id) {
            return Err(contract());
        }
        let path = self.root.join(id);
        if path.try_exists().map_err(host)? {
            fs::remove_file(path).map_err(host)?;
        }
        Ok(())
    }
    pub(super) fn exchange_stage(
        &self,
        operation: &str,
        path: &str,
        expected: Option<&str>,
        stage_id: Option<&str>,
    ) -> Result<StagedExchange> {
        let mut registry = self.state.lock().map_err(|_| contract())?;
        if let Some(outcome) = registry.outcomes.get(operation) {
            return Ok(outcome.clone());
        }
        let destination = self.path(path)?;
        let current = if destination.try_exists().map_err(host)? {
            Some(fingerprint(&destination)?)
        } else {
            None
        };
        if current.as_ref().map(|(_, revision)| revision.as_str()) != expected {
            return Ok(StagedExchange {
                applied: false,
                displaced: None,
            });
        }
        if registry.race_paths.remove(path) {
            fs::write(&destination,b"---\ntitle: External writer\nstatus: open\ntags: [task]\nvendor: preserved\n---\n").map_err(host)?;
            fs::File::open(&destination)
                .map_err(host)?
                .sync_all()
                .map_err(host)?;
            return Ok(StagedExchange {
                applied: false,
                displaced: None,
            });
        }
        let temporary = self.root.join(format!(
            "slot-{}",
            hex::encode(Sha256::digest(operation.as_bytes()))
        ));
        if let Some(id) = stage_id {
            let stage = registry.stages.get(id).ok_or_else(contract)?;
            if !stage.info.sealed
                || stage.info.operation_id != operation
                || stage.info.path != path
                || stage.expected.as_deref() != expected
            {
                return Err(contract());
            }
            fs::copy(self.root.join(id), &temporary).map_err(host)?;
            fs::File::open(&temporary)
                .map_err(host)?
                .sync_all()
                .map_err(host)?;
        }
        if registry.fail_staging.contains(path) {
            return Err(RuntimeError::Host(
                "injected failure after staging write, before atomic publication".into(),
            ));
        }
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(host)?;
        }
        registry.sequence += 1;
        let displaced = if let Some((size, revision)) = current {
            let id = format!("backup-{:08}", registry.sequence);
            fs::rename(&destination, self.root.join(&id)).map_err(host)?;
            let metadata = DisplacedMetadata {
                id: id.clone(),
                path: path.into(),
                size,
                revision,
            };
            registry.backups.insert(id, metadata.clone());
            Some(metadata)
        } else {
            None
        };
        if stage_id.is_some() {
            fs::rename(&temporary, &destination).map_err(host)?;
        }
        if let Some(parent) = destination.parent() {
            fs::File::open(parent)
                .map_err(host)?
                .sync_all()
                .map_err(host)?;
        }
        registry.exchanges += 1;
        let outcome = StagedExchange {
            applied: true,
            displaced,
        };
        registry.outcomes.insert(operation.into(), outcome.clone());
        Ok(outcome)
    }
}
