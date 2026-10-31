//! Read-only virtual image overlay for atomic mixed task/file plans.

use super::{Engine, Result, RuntimeError};
use crate::types::{DisplacedMetadata, FileSnapshot, PAYLOAD_CHUNK_BYTES, PayloadInfo, VaultFiles};
use std::{collections::BTreeMap, sync::Mutex};

enum Source {
    Database(PayloadInfo),
    Provider,
}

pub(super) struct PlanFiles<'a> {
    pub engine: &'a Engine,
    pub profile: &'a str,
    pub changed: &'a BTreeMap<String, Option<PayloadInfo>>,
    opened: Mutex<BTreeMap<String, Source>>,
}

impl<'a> PlanFiles<'a> {
    pub fn new(
        engine: &'a Engine,
        profile: &'a str,
        changed: &'a BTreeMap<String, Option<PayloadInfo>>,
    ) -> Self {
        Self {
            engine,
            profile,
            changed,
            opened: Mutex::new(BTreeMap::new()),
        }
    }
    fn owner(&self, profile: &str) -> Result<()> {
        if profile != self.profile {
            return Err(RuntimeError::HostContract(
                "plan capability owner changed".to_owned(),
            ));
        }
        Ok(())
    }
}

impl VaultFiles for PlanFiles<'_> {
    fn list_files(&self, profile: &str) -> Result<Vec<String>> {
        self.owner(profile)?;
        let mut files = self
            .engine
            .files
            .list_files(profile)?
            .into_iter()
            .map(|path| (path, ()))
            .collect::<BTreeMap<_, _>>();
        for (path, image) in self.changed {
            if image.is_some() {
                files.insert(path.clone(), ());
            } else {
                files.remove(path);
            }
        }
        Ok(files.into_keys().collect())
    }
    fn open_file_snapshot(&self, profile: &str, path: &str) -> Result<Option<FileSnapshot>> {
        self.owner(profile)?;
        let (snapshot, source) = if let Some(image) = self.changed.get(path) {
            let Some(image) = image else {
                return Ok(None);
            };
            (
                FileSnapshot {
                    id: format!("plan-image:{}", image.id),
                    size: image.size,
                    revision: image.revision.clone(),
                },
                Source::Database(image.clone()),
            )
        } else {
            let Some(snapshot) = self.engine.files.open_file_snapshot(profile, path)? else {
                return Ok(None);
            };
            (snapshot, Source::Provider)
        };
        let mut opened = self
            .opened
            .lock()
            .map_err(|_| RuntimeError::HostContract("plan snapshot registry failed".to_owned()))?;
        if opened.len() >= 4 || opened.contains_key(&snapshot.id) {
            drop(opened);
            if matches!(source, Source::Provider) {
                self.engine.files.close_snapshot(profile, &snapshot.id)?;
            }
            return Err(RuntimeError::HostContract(
                "plan snapshot limit or identity conflict".to_owned(),
            ));
        }
        opened.insert(snapshot.id.clone(), source);
        Ok(Some(snapshot))
    }
    fn read_snapshot_chunk(
        &self,
        profile: &str,
        id: &str,
        offset: u64,
        length: u32,
    ) -> Result<Vec<u8>> {
        self.owner(profile)?;
        let image = {
            let opened = self.opened.lock().map_err(|_| {
                RuntimeError::HostContract("plan snapshot registry failed".to_owned())
            })?;
            match opened.get(id).ok_or(RuntimeError::NotFound)? {
                Source::Provider => None,
                Source::Database(image) => Some(image.clone()),
            }
        };
        if let Some(image) = image {
            let length = usize::try_from(length)
                .map_err(|_| RuntimeError::Validation("invalid image chunk length".to_owned()))?;
            if length > PAYLOAD_CHUNK_BYTES {
                return Err(RuntimeError::Validation(
                    "image chunk exceeds resource bound".to_owned(),
                ));
            }
            let mut bytes = vec![0; length];
            self.engine
                .read_payload_into(profile, &image.id, offset, &mut bytes)?;
            Ok(bytes)
        } else {
            self.engine
                .files
                .read_snapshot_chunk(profile, id, offset, length)
        }
    }
    fn close_snapshot(&self, profile: &str, id: &str) -> Result<()> {
        self.owner(profile)?;
        let source = self
            .opened
            .lock()
            .map_err(|_| RuntimeError::HostContract("plan snapshot registry failed".to_owned()))?
            .remove(id)
            .ok_or(RuntimeError::NotFound)?;
        if matches!(source, Source::Provider) {
            self.engine.files.close_snapshot(profile, id)?;
        }
        Ok(())
    }
    fn displaced_metadata(
        &self,
        _: &str,
        _: Option<&str>,
        _: u32,
    ) -> Result<Vec<DisplacedMetadata>> {
        Err(RuntimeError::HostContract(
            "pure plans do not enumerate predecessors".to_owned(),
        ))
    }
    fn acknowledge_displaced(&self, _: &str, _: &str) -> Result<()> {
        Err(RuntimeError::HostContract(
            "pure plans do not dispose predecessors".to_owned(),
        ))
    }
}
