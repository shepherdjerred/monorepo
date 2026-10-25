//! Parent/child read fences accompany the immutable multi-file transition plan.
//! Owned before/after images are accepted during recovery of partial exchanges.

use super::{Engine, Result, RuntimeError, staged};
use crate::{
    commands::occurrence_transitions::Fence,
    types::{Command, Mutation},
};
use rusqlite::{Connection, OptionalExtension, params};
use tasknotes_vault::{document::ContentRevision, path::VaultPath, temporal};

fn corrupt() -> RuntimeError {
    RuntimeError::Storage("occurrence transition ownership is corrupt".into())
}
fn target(command: &Command) -> Option<(&str, Option<&str>)> {
    match command {
        Command::SetCompletion {
            path,
            occurrence_date,
            ..
        }
        | Command::ToggleComplete {
            path,
            occurrence_date,
            ..
        }
        | Command::SetStatus {
            path,
            occurrence_date,
            ..
        }
        | Command::EditTask {
            path,
            occurrence_date,
            ..
        } => Some((path, occurrence_date.as_deref())),
        Command::SetOccurrenceSkipped {
            path,
            occurrence_date,
            ..
        } => Some((path, Some(occurrence_date))),
        Command::Update { path, .. } => Some((path, None)),
        _ => None,
    }
}
fn selected_day_matches(value: &str, mutation: &Mutation, expected: &str) -> bool {
    if value.len() == 10 {
        return temporal::parse_day(value).is_ok_and(|day| day.to_string() == expected);
    }
    mutation.execution_context.as_ref().is_some_and(|context| {
        temporal::day_in_timezone(value, &context.timezone)
            .is_ok_and(|day| day.to_string() == expected)
    })
}
pub(super) fn load(db: &Connection, profile: &str, id: &str) -> Result<Vec<Fence>> {
    let row:Option<(String,String)>=db.query_row("SELECT t.json,j.fingerprint FROM occurrence_transitions t JOIN journals j ON j.profile=t.profile AND j.id=t.id WHERE t.profile=? AND t.id=?",params![profile,id],|row|Ok((row.get(0)?,row.get(1)?))).optional()?;
    let Some((json, fingerprint)) = row else {
        return Ok(Vec::new());
    };
    let fences: Vec<Fence> = serde_json::from_str(&json).map_err(|_| corrupt())?;
    let mutation: Mutation = serde_json::from_str(&fingerprint).map_err(|_| corrupt())?;
    let commands = if let Command::Batch { commands } = &mutation.command {
        commands.as_slice()
    } else {
        std::slice::from_ref(&mutation.command)
    };
    let writes = staged::read_files(db, profile, id)?;
    let repair = if let Command::RepairOccurrenceProgression {
        progression_id,
        expected_parent_revision,
        expected_child_revision,
    } = &mutation.command
    {
        Some((
            super::deferred_progressions::load_intent(db, profile, progression_id)?,
            expected_parent_revision,
            expected_child_revision,
        ))
    } else {
        None
    };
    if fences.is_empty() || fences.len() > 1000 {
        return Err(corrupt());
    }
    let mut seen = std::collections::BTreeSet::new();
    for fence in &fences {
        if fence.deferred_input_hash.as_ref().is_some_and(|hash| {
            hash.len() != 64
                || !hash
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        }) {
            return Err(corrupt());
        }
        temporal::parse_day(&fence.occurrence_date).map_err(|_| corrupt())?;
        for path in [
            &fence.parent_path,
            &fence.parent_result_path,
            &fence.task_path,
            &fence.result_path,
        ] {
            VaultPath::parse(path).map_err(|_| corrupt())?;
        }
        if fence.parent_path == fence.task_path
            || !seen.insert(&fence.task_path)
            || !(commands.iter().any(|command| {
                target(command).is_some_and(|(path, day)| {
                    (path == fence.task_path
                        || path == fence.parent_path
                        || path == fence.parent_result_path)
                        && day.is_none_or(|day| {
                            selected_day_matches(day, &mutation, &fence.occurrence_date)
                        })
                })
            }) || repair.as_ref().is_some_and(|(intent, parent, child)| {
                intent.parent_path == fence.parent_path
                    && intent.child_path == fence.task_path
                    && intent.occurrence_date == fence.occurrence_date
                    && *parent == &fence.parent_revision
                    && *child == &fence.task_revision
            }))
        {
            return Err(corrupt());
        }
        for (path, revision) in [
            (&fence.parent_path, &fence.parent_revision),
            (&fence.task_path, &fence.task_revision),
        ] {
            if revision.len() != 64
                || !revision
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            {
                return Err(corrupt());
            }
            if writes
                .iter()
                .find(|write| &write.path == path)
                .is_some_and(|write| write.expected.as_ref() != Some(revision))
            {
                return Err(corrupt());
            }
        }
    }
    Ok(fences)
}
pub(super) fn validate_database(db: &Connection) -> Result<()> {
    let mut query = db.prepare("SELECT profile,id FROM occurrence_transitions")?;
    let rows = query.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (profile, id) = row?;
        load(db, &profile, &id)?;
    }
    Ok(())
}
pub(super) fn task_path(db: &Connection, profile: &str, id: &str) -> Result<Option<String>> {
    let fences = load(db, profile, id)?;
    Ok(if fences.len() == 1 {
        fences.first().map(|fence| fence.result_path.clone())
    } else {
        None
    })
}
impl Engine {
    pub(super) fn check_occurrence_transition_reads(&self, profile: &str, id: &str) -> Result<()> {
        let (fences, writes) =
            self.database(|db| Ok((load(db, profile, id)?, staged::read_files(db, profile, id)?)))?;
        for fence in &fences {
            for (path, revision) in [
                (&fence.parent_path, &fence.parent_revision),
                (&fence.task_path, &fence.task_revision),
            ] {
                let bytes = self.files.read_file(profile, path)?;
                let current = bytes
                    .as_ref()
                    .map(|bytes| ContentRevision::of(bytes).as_str().to_owned());
                let owned_after = writes
                    .iter()
                    .find(|write| &write.path == path)
                    .map(|write| write.after.as_ref().map(|image| image.revision.clone()));
                if current.as_ref() != Some(revision) && owned_after.as_ref() != Some(&current) {
                    return Err(RuntimeError::Conflict);
                }
            }
        }
        Ok(())
    }
}
