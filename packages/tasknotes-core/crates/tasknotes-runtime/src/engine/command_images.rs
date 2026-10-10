//! Atomic command planning over virtual immutable images. Generic file moves and
//! deletes never parse/clone attachment content; task/config text stays explicit.

use super::{
    Engine, Mutation, Result, RuntimeError, TaskNotesConfiguration,
    plan_files::PlanFiles,
    staged::{self, DurableFile},
};
use crate::types::{Command, PayloadInfo};
use std::collections::BTreeMap;
use tasknotes_vault::path::VaultPath;

pub(super) struct CommandImagePlan {
    pub writes: Vec<DurableFile>,
    pub diagnostics: Vec<crate::types::Diagnostic>,
    pub title_changes: Vec<super::title_lineage::TitleChange>,
}

impl Engine {
    pub(super) fn plan_command_images(
        &self,
        profile: &str,
        config: &TaskNotesConfiguration,
        mutation: &Mutation,
    ) -> Result<CommandImagePlan> {
        let mut changed = BTreeMap::new();
        let mut diagnostics = Vec::new();
        let mut title_changes = Vec::new();
        let writes = self.plan_image_operation(
            profile,
            config,
            mutation,
            &mut changed,
            &mut diagnostics,
            &mut title_changes,
        )?;
        Ok(CommandImagePlan {
            writes,
            diagnostics,
            title_changes,
        })
    }

    fn plan_image_operation(
        &self,
        profile: &str,
        config: &TaskNotesConfiguration,
        mutation: &Mutation,
        changed: &mut BTreeMap<String, Option<PayloadInfo>>,
        diagnostics: &mut Vec<crate::types::Diagnostic>,
        title_changes: &mut Vec<super::title_lineage::TitleChange>,
    ) -> Result<Vec<DurableFile>> {
        if matches!(&mutation.command, Command::Batch { .. }) {
            return self.plan_batch_images(
                profile,
                config,
                mutation,
                changed,
                diagnostics,
                title_changes,
            );
        }
        let view = PlanFiles::new(self, profile, changed);
        let writes = match &mutation.command {
            Command::Rename {
                path,
                new_path,
                expected_revision,
            } => self.move_image(
                profile,
                changed,
                path,
                new_path,
                expected_revision.as_deref(),
            )?,
            Command::RenameReferences {
                path,
                new_path,
                expected_revision,
                update_references,
            } if !path.to_lowercase().ends_with(".md") => {
                let mut writes = self.move_image(
                    profile,
                    changed,
                    path,
                    new_path,
                    expected_revision.as_deref(),
                )?;
                if *update_references {
                    let inline = crate::commands::reference_changes(
                        &view, profile, config, mutation, path, new_path,
                    )?;
                    writes.extend(self.database(|db| staged::inline_files(db, profile, &inline))?);
                }
                writes
            }
            Command::Delete {
                path,
                expected_revision,
            } => self.delete_image(profile, changed, path, expected_revision.as_deref())?,
            Command::DeleteChecked {
                path,
                expected_revision,
                check_backlinks,
                force,
            } => {
                if *check_backlinks
                    && !*force
                    && !crate::commands::reference_changes(
                        &view, profile, config, mutation, path, path,
                    )?
                    .is_empty()
                {
                    return Err(RuntimeError::Validation(
                        "deletion has backlinks; review them or explicitly force deletion"
                            .to_owned(),
                    ));
                }
                self.delete_image(profile, changed, path, expected_revision.as_deref())?
            }
            _ => {
                let (inline, notices) = crate::commands::plan(&view, profile, config, mutation)?;
                for notice in notices {
                    if !diagnostics.contains(&notice) {
                        diagnostics.push(notice);
                    }
                }
                self.database(|db| staged::inline_files(db, profile, &inline))?
            }
        };
        let mut writes = writes;
        for (ordinal, write) in writes.iter_mut().enumerate() {
            write.ordinal = i64::try_from(ordinal)
                .map_err(|_| RuntimeError::Storage("too many command files".to_owned()))?;
        }
        self.database(|db| {
            super::title_lineage::plan_changes(
                db,
                profile,
                config,
                mutation,
                &writes,
                title_changes,
            )
        })?;
        Ok(writes)
    }

    fn plan_batch_images(
        &self,
        profile: &str,
        config: &TaskNotesConfiguration,
        mutation: &Mutation,
        changed: &mut BTreeMap<String, Option<PayloadInfo>>,
        diagnostics: &mut Vec<crate::types::Diagnostic>,
        title_changes: &mut Vec<super::title_lineage::TitleChange>,
    ) -> Result<Vec<DurableFile>> {
        let Command::Batch { commands } = &mutation.command else {
            return Err(RuntimeError::Storage(
                "batch image dispatch mismatch".into(),
            ));
        };
        if crate::commands::filename_requires_uuid(config)
            && commands
                .iter()
                .filter(|command| matches!(command, Command::Create { path: None, .. }))
                .count()
                > 1
        {
            return Err(RuntimeError::Validation(
                "multiple UUID creates require separate caller-owned mutations".into(),
            ));
        }
        let mut merged: Vec<DurableFile> = Vec::new();
        for command in commands {
            let mut child = mutation.clone();
            child.command = command.clone();
            let writes = self.plan_image_operation(
                profile,
                config,
                &child,
                changed,
                diagnostics,
                title_changes,
            )?;
            for write in writes {
                changed.insert(write.path.clone(), write.after.clone());
                if let Some(previous) = merged
                    .iter_mut()
                    .find(|previous| previous.path == write.path)
                {
                    previous.after = write.after;
                } else {
                    merged.push(write);
                }
            }
        }
        for (ordinal, write) in merged.iter_mut().enumerate() {
            write.ordinal = i64::try_from(ordinal)
                .map_err(|_| RuntimeError::Storage("too many atomic files".to_owned()))?;
        }
        Ok(merged)
    }

    fn image_at(
        &self,
        profile: &str,
        changed: &BTreeMap<String, Option<PayloadInfo>>,
        path: &str,
    ) -> Result<Option<PayloadInfo>> {
        VaultPath::parse(path)?;
        changed
            .get(path)
            .cloned()
            .map_or_else(|| self.capture_file_image(profile, path), Ok)
    }

    fn fenced_image(
        &self,
        profile: &str,
        changed: &BTreeMap<String, Option<PayloadInfo>>,
        path: &str,
        expected: Option<&str>,
    ) -> Result<PayloadInfo> {
        let image = self
            .image_at(profile, changed, path)?
            .ok_or(RuntimeError::NotFound)?;
        if expected.is_some_and(|expected| expected != image.revision) {
            return Err(RuntimeError::Conflict);
        }
        Ok(image)
    }

    fn move_image(
        &self,
        profile: &str,
        changed: &BTreeMap<String, Option<PayloadInfo>>,
        path: &str,
        new_path: &str,
        expected: Option<&str>,
    ) -> Result<Vec<DurableFile>> {
        if path == new_path {
            return Err(RuntimeError::Validation(
                "rename destination must differ".to_owned(),
            ));
        }
        if self.image_at(profile, changed, new_path)?.is_some() {
            return Err(RuntimeError::Conflict);
        }
        let old = self.fenced_image(profile, changed, path, expected)?;
        Ok(vec![
            DurableFile {
                ordinal: 0,
                path: new_path.to_owned(),
                expected: None,
                before: None,
                after: Some(old.clone()),
            },
            DurableFile {
                ordinal: 1,
                path: path.to_owned(),
                expected: Some(old.revision.clone()),
                before: Some(old),
                after: None,
            },
        ])
    }

    fn delete_image(
        &self,
        profile: &str,
        changed: &BTreeMap<String, Option<PayloadInfo>>,
        path: &str,
        expected: Option<&str>,
    ) -> Result<Vec<DurableFile>> {
        let old = self.fenced_image(profile, changed, path, expected)?;
        Ok(vec![DurableFile {
            ordinal: 0,
            path: path.to_owned(),
            expected: Some(old.revision.clone()),
            before: Some(old),
            after: None,
        }])
    }
}
