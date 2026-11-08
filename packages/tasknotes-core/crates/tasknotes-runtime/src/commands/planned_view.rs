//! Read-only Markdown overlay for composing reference-preserving task edits.
use super::{PlannedFile, Result, RuntimeError};
use crate::types::{DisplacedMetadata, VaultFiles};
use std::collections::BTreeSet;

pub(super) struct PlannedView<'a> {
    pub files: &'a dyn VaultFiles,
    pub profile: &'a str,
    pub writes: &'a [PlannedFile],
}
impl VaultFiles for PlannedView<'_> {
    fn list_files(&self, profile: &str) -> Result<Vec<String>> {
        if profile != self.profile {
            return Err(RuntimeError::HostContract(
                "planning profile changed".into(),
            ));
        }
        let mut paths = self
            .files
            .list_files(profile)?
            .into_iter()
            .collect::<BTreeSet<_>>();
        for write in self.writes {
            if write.bytes.is_some() {
                paths.insert(write.path.clone());
            } else {
                paths.remove(&write.path);
            }
        }
        Ok(paths.into_iter().collect())
    }
    fn read_file(&self, profile: &str, path: &str) -> Result<Option<Vec<u8>>> {
        if profile != self.profile {
            return Err(RuntimeError::HostContract(
                "planning profile changed".into(),
            ));
        }
        if let Some(write) = self.writes.iter().rev().find(|write| write.path == path) {
            return Ok(write.bytes.clone());
        }
        self.files.read_file(profile, path)
    }
    fn displaced_metadata(
        &self,
        _profile: &str,
        _after: Option<&str>,
        _limit: u32,
    ) -> Result<Vec<DisplacedMetadata>> {
        Err(RuntimeError::HostContract(
            "semantic planning cannot inspect host exchanges".into(),
        ))
    }
    fn acknowledge_displaced(&self, _profile: &str, _id: &str) -> Result<()> {
        Err(RuntimeError::HostContract(
            "semantic planning cannot retire host captures".into(),
        ))
    }
}
