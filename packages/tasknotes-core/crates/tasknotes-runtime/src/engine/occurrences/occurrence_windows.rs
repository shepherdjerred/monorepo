//! Durable complete-window ownership and provider read fences.
use super::{Engine, Result, RuntimeError, staged};
use crate::{
    commands::occurrence_windows::ReadPlan,
    types::{Command, Mutation},
};
use rusqlite::{Connection, params};
use std::collections::BTreeSet;
use tasknotes_vault::{
    document::{ContentRevision, TaskDocument},
    path::VaultPath,
    temporal,
};

fn corrupt() -> RuntimeError {
    RuntimeError::Storage("rolling occurrence journal ownership is corrupt".into())
}

fn validate(
    db: &Connection,
    profile: &str,
    id: &str,
    fingerprint: &str,
    reads: &ReadPlan,
    inspect_images: bool,
) -> Result<()> {
    let mutation: Mutation = serde_json::from_str(fingerprint).map_err(|_| corrupt())?;
    let Command::MaterializeOccurrenceWindow {
        parent_path,
        expected_parent_revision,
        reference_date,
        ..
    } = mutation.command
    else {
        return Err(corrupt());
    };
    if parent_path != reads.parent_path
        || expected_parent_revision != reads.parent_revision
        || reference_date != reads.reference_date
    {
        return Err(corrupt());
    }
    VaultPath::parse(&reads.parent_path).map_err(|_| corrupt())?;
    if reads.parent_revision.len() != 64
        || !reads
            .parent_revision
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(corrupt());
    }
    let start = temporal::parse_day(&reads.start).map_err(|_| corrupt())?;
    let end = temporal::parse_day(&reads.end).map_err(|_| corrupt())?;
    let reference = temporal::parse_day(&reads.reference_date).map_err(|_| corrupt())?;
    if start > reference || reference > end || end.signed_duration_since(start).num_days() > 100_000
    {
        return Err(corrupt());
    }
    let writes = staged::read_files(db, profile, id)?;
    let mut paths = BTreeSet::new();
    let mut created = std::collections::BTreeMap::new();
    let mut previous = None;
    for entry in &reads.entries {
        let date = temporal::parse_day(&entry.date).map_err(|_| corrupt())?;
        let child = &entry.reads;
        VaultPath::parse(&child.task_path).map_err(|_| corrupt())?;
        if date < start
            || date > end
            || previous.is_some_and(|p| p >= date)
            || child.parent_path != reads.parent_path
            || child.parent_revision != reads.parent_revision
            || child.task_path == reads.parent_path
            || !paths.insert(&child.task_path)
        {
            return Err(corrupt());
        }
        previous = Some(date);
        if let Some(revision) = &child.existing_revision {
            if revision.len() != 64
                || !revision
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
            {
                return Err(corrupt());
            }
        } else {
            created.insert(&child.task_path, &entry.date);
        }
    }
    if created.len() > 1000 || writes.len() != created.len() {
        return Err(corrupt());
    }
    for write in writes {
        if !created.contains_key(&write.path)
            || write.before.is_some()
            || write.expected.is_some()
            || write.after.is_none()
        {
            return Err(corrupt());
        }
        if !inspect_images {
            continue;
        }
        let image = write.after.as_ref().ok_or_else(corrupt)?;
        let bytes = super::payloads::read_inline(db, profile, &image.id)?;
        let document = TaskDocument::parse(
            VaultPath::parse(&write.path).map_err(|_| corrupt())?,
            &bytes,
        )
        .map_err(|_| corrupt())?;
        let fields = document.frontmatter();
        if fields
            .get(&reads.date_field)
            .and_then(serde_json::Value::as_str)
            != created.get(&write.path).map(|date| date.as_str())
        {
            return Err(corrupt());
        }
        let raw = fields
            .get(&reads.parent_field)
            .and_then(serde_json::Value::as_str)
            .ok_or_else(corrupt)?;
        if tasknotes_vault::links::resolve(&serde_json::json!({"raw":raw,"sourcePath":write.path,"candidates":[reads.parent_path]})).map_err(|_|corrupt())?!=reads.parent_path {return Err(corrupt());}
    }
    Ok(())
}

fn load(
    db: &Connection,
    profile: &str,
    id: &str,
    inspect_images: bool,
) -> Result<Option<ReadPlan>> {
    let (fingerprint,json):(String,Option<String>)=db.query_row("SELECT j.fingerprint,w.json FROM journals j LEFT JOIN occurrence_windows w ON w.profile=j.profile AND w.id=j.id WHERE j.profile=? AND j.id=?",params![profile,id],|r|Ok((r.get(0)?,r.get(1)?)))?;
    if let Some(json) = json {
        let reads: ReadPlan = serde_json::from_str(&json).map_err(|_| corrupt())?;
        validate(db, profile, id, &fingerprint, &reads, inspect_images)?;
        return Ok(Some(reads));
    }
    if serde_json::from_str::<serde_json::Value>(&fingerprint)
        .ok()
        .and_then(|v| v.pointer("/command/kind").cloned())
        .and_then(|v| v.as_str().map(str::to_owned))
        .as_deref()
        == Some("materialize_occurrence_window")
    {
        return Err(corrupt());
    }
    Ok(None)
}

pub(super) fn validate_database(db: &Connection) -> Result<()> {
    let missing:i64=db.query_row("SELECT count(*) FROM journals j LEFT JOIN occurrence_windows w ON w.profile=j.profile AND w.id=j.id WHERE json_extract(CASE WHEN json_valid(j.fingerprint) THEN j.fingerprint ELSE '{}' END,'$.command.kind')='materialize_occurrence_window' AND w.id IS NULL",[],|r|r.get(0))?;
    if missing != 0 {
        return Err(corrupt());
    }
    let mut query = db.prepare("SELECT profile,id FROM occurrence_windows ORDER BY profile,id")?;
    for row in query.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
        let (profile, id) = row?;
        load(db, &profile, &id, true)?.ok_or_else(corrupt)?;
    }
    Ok(())
}

impl Engine {
    pub(super) fn check_occurrence_window_reads(&self, profile: &str, id: &str) -> Result<()> {
        let Some(reads) = self.database(|db| load(db, profile, id, false))? else {
            return Ok(());
        };
        let mut dependencies = vec![(reads.parent_path, reads.parent_revision)];
        dependencies.extend(
            reads
                .entries
                .into_iter()
                .filter_map(|e| e.reads.existing_revision.map(|r| (e.reads.task_path, r))),
        );
        for (path, revision) in dependencies {
            let bytes = self
                .files
                .read_file(profile, &path)?
                .ok_or(RuntimeError::Conflict)?;
            if ContentRevision::of(&bytes).as_str() != revision {
                return Err(RuntimeError::Conflict);
            }
        }
        Ok(())
    }
}
