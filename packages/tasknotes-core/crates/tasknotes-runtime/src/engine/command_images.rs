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
    pub occurrence_reads: Option<crate::commands::occurrences::ReadPlan>,
    pub occurrence_window: Option<crate::commands::occurrence_windows::ReadPlan>,
    pub transitions: Vec<crate::commands::occurrence_transitions::Fence>,
    pub successors: Vec<super::successors::Prepared>,
    pub progressions: Vec<super::deferred_progressions::Prepared>,
    pub progression_effects: Vec<super::deferred_progressions::Effect>,
}

impl CommandImagePlan {
    pub(super) fn ordinary(writes: Vec<DurableFile>) -> Self {
        Self {
            writes,
            diagnostics: Vec::new(),
            title_changes: Vec::new(),
            occurrence_reads: None,
            occurrence_window: None,
            transitions: Vec::new(),
            successors: Vec::new(),
            progressions: Vec::new(),
            progression_effects: Vec::new(),
        }
    }
}
#[derive(Default)]
struct PlanningState {
    initial_revisions: BTreeMap<String, Option<String>>,
    diagnostics: Vec<crate::types::Diagnostic>,
    title_changes: Vec<super::title_lineage::TitleChange>,
    transitions: Vec<crate::commands::occurrence_transitions::Fence>,
    successor_mutations: Vec<Mutation>,
    progressions: Vec<crate::commands::occurrence_transitions::DeferredProgression>,
}

impl Engine {
    pub(super) fn plan_command_images(
        &self,
        profile: &str,
        config: &TaskNotesConfiguration,
        mutation: &Mutation,
    ) -> Result<CommandImagePlan> {
        if matches!(
            &mutation.command,
            Command::RepairOccurrenceProgression { .. }
        ) {
            return self.plan_progression_repair(profile, config, mutation);
        }
        if matches!(
            &mutation.command,
            Command::MaterializeOccurrenceWindow { .. }
        ) {
            return self.plan_occurrence_window(profile, config, mutation);
        }
        if matches!(&mutation.command, Command::MaterializeOccurrence { .. }) {
            let unchanged = BTreeMap::new();
            let view = PlanFiles::new(self, profile, &unchanged);
            let plan = crate::commands::occurrences::plan(&view, profile, config, mutation)?;
            let writes = self.database(|db| staged::inline_files(db, profile, &plan.writes))?;
            let mut title_changes = Vec::new();
            self.database(|db| {
                super::title_lineage::plan_changes(
                    db,
                    profile,
                    config,
                    &plan.creation,
                    &writes,
                    &mut title_changes,
                )
            })?;
            return Ok(CommandImagePlan {
                writes,
                diagnostics: plan.diagnostics,
                title_changes,
                occurrence_reads: Some(plan.reads),
                occurrence_window: None,
                transitions: Vec::new(),
                successors: Vec::new(),
                progressions: Vec::new(),
                progression_effects: Vec::new(),
            });
        }
        let mut changed = BTreeMap::new();
        let mut state = PlanningState::default();
        let writes =
            self.plan_image_operation(profile, config, mutation, &mut changed, &mut state)?;
        for write in &writes {
            changed.insert(write.path.clone(), write.after.clone());
        }
        let successors = self.prepare_successors(
            profile,
            config,
            mutation,
            &changed,
            state.successor_mutations,
        )?;
        if successors.len() + state.progressions.len() > 1000 {
            return Err(RuntimeError::Validation(
                "one mutation cannot schedule more than 1,000 occurrence followups".into(),
            ));
        }
        let progressions = self.prepare_deferred_progressions(
            profile,
            config,
            mutation,
            &changed,
            &state.progressions,
        )?;
        Ok(CommandImagePlan {
            writes,
            diagnostics: state.diagnostics,
            title_changes: state.title_changes,
            occurrence_reads: None,
            occurrence_window: None,
            transitions: state.transitions,
            successors,
            progressions,
            progression_effects: Vec::new(),
        })
    }

    fn plan_occurrence_window(
        &self,
        profile: &str,
        config: &TaskNotesConfiguration,
        mutation: &Mutation,
    ) -> Result<CommandImagePlan> {
        let unchanged = BTreeMap::new();
        let view = PlanFiles::new(self, profile, &unchanged);
        let plan = crate::commands::occurrence_windows::plan(&view, profile, config, mutation)?;
        let mut writes = Vec::new();
        let mut title_changes = Vec::new();
        let mut diagnostics = Vec::new();
        for child in plan.children {
            let child_writes =
                self.database(|db| staged::inline_files(db, profile, &child.writes))?;
            self.database(|db| {
                super::title_lineage::plan_changes(
                    db,
                    profile,
                    config,
                    &child.creation,
                    &child_writes,
                    &mut title_changes,
                )
            })?;
            writes.extend(child_writes);
            diagnostics.extend(child.diagnostics);
        }
        for (ordinal, write) in writes.iter_mut().enumerate() {
            write.ordinal = i64::try_from(ordinal)
                .map_err(|_| RuntimeError::Storage("too many rolling children".into()))?;
        }
        Ok(CommandImagePlan {
            writes,
            diagnostics,
            title_changes,
            occurrence_reads: None,
            occurrence_window: Some(plan.reads),
            transitions: Vec::new(),
            successors: Vec::new(),
            progressions: Vec::new(),
            progression_effects: Vec::new(),
        })
    }

    fn plan_occurrence_transition(
        &self,
        profile: &str,
        config: &TaskNotesConfiguration,
        mutation: &Mutation,
        changed: &BTreeMap<String, Option<PayloadInfo>>,
        state: &mut PlanningState,
    ) -> Result<Option<Vec<DurableFile>>> {
        let view = PlanFiles::new(self, profile, changed);
        if let Some(mut plan) =
            crate::commands::occurrence_transitions::plan(&view, profile, config, mutation)?
        {
            for (path, revision) in [
                (&plan.fence.parent_path, &mut plan.fence.parent_revision),
                (&plan.fence.task_path, &mut plan.fence.task_revision),
            ] {
                if changed.contains_key(path) {
                    let original = state
                        .initial_revisions
                        .get(path)
                        .and_then(Option::as_ref)
                        .ok_or_else(|| {
                            RuntimeError::Validation(
                                "atomic child transitions require a pre-existing parent and child"
                                    .into(),
                            )
                        })?;
                    revision.clone_from(original);
                }
            }
            if state
                .transitions
                .iter()
                .any(|prior| prior.task_path == plan.fence.task_path)
            {
                return Err(RuntimeError::Validation(
                    "batch selects the same materialized occurrence more than once".into(),
                ));
            }
            if let Some(prior) = state
                .transitions
                .iter()
                .find(|prior| prior.parent_path == plan.fence.parent_path)
            {
                plan.fence
                    .parent_revision
                    .clone_from(&prior.parent_revision);
            }
            let writes = self.database(|db| staged::inline_files(db, profile, &plan.writes))?;
            self.database(|db| {
                super::title_lineage::plan_changes(
                    db,
                    profile,
                    config,
                    &plan.child_mutation,
                    &writes,
                    &mut state.title_changes,
                )
            })?;
            if matches!(&mutation.command,Command::EditTask {path,..} if path==&plan.fence.parent_path)
            {
                self.database(|db| {
                    super::title_lineage::plan_changes(
                        db,
                        profile,
                        config,
                        mutation,
                        &writes,
                        &mut state.title_changes,
                    )
                })?;
            }
            for notice in plan.diagnostics {
                if !state.diagnostics.contains(&notice) {
                    state.diagnostics.push(notice);
                }
            }
            state.transitions.push(plan.fence);
            if let Some(successor) = plan.successor {
                state.successor_mutations.push(successor);
            }
            if let Some(progression) = plan.deferred {
                state.progressions.push(progression);
            }
            return Ok(Some(writes));
        }
        Ok(None)
    }

    fn plan_image_operation(
        &self,
        profile: &str,
        config: &TaskNotesConfiguration,
        mutation: &Mutation,
        changed: &mut BTreeMap<String, Option<PayloadInfo>>,
        state: &mut PlanningState,
    ) -> Result<Vec<DurableFile>> {
        if matches!(&mutation.command, Command::Batch { .. }) {
            return self.plan_batch_images(profile, config, mutation, changed, state);
        }
        if let Some(writes) =
            self.plan_occurrence_transition(profile, config, mutation, changed, state)?
        {
            return Ok(writes);
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
                    if !state.diagnostics.contains(&notice) {
                        state.diagnostics.push(notice);
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
                &mut state.title_changes,
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
        state: &mut PlanningState,
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
            let writes = self.plan_image_operation(profile, config, &child, changed, state)?;
            for write in writes {
                state
                    .initial_revisions
                    .entry(write.path.clone())
                    .or_insert_with(|| write.expected.clone());
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
