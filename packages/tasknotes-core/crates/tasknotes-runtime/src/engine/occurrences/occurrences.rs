//! Durable read dependencies for materialization. These are revision checks,
//! not an atomic transaction across externally writable filesystem objects.

use super::{Engine, Result, RuntimeError};
use crate::{
    commands::occurrences::ReadPlan,
    types::{Command, Mutation},
};
use rusqlite::{Connection, params};
use tasknotes_vault::{document::ContentRevision, path::VaultPath};

fn corrupt() -> RuntimeError {
    RuntimeError::Storage("occurrence journal ownership is corrupt".into())
}

fn validate(reads: &ReadPlan, fingerprint: &str) -> Result<()> {
    let mutation: Mutation = serde_json::from_str(fingerprint).map_err(|_| corrupt())?;
    let Command::MaterializeOccurrence {
        parent_path,
        expected_parent_revision,
        expected_occurrence_revision,
        ..
    } = mutation.command
    else {
        return Err(corrupt());
    };
    if parent_path != reads.parent_path
        || expected_parent_revision != reads.parent_revision
        || expected_occurrence_revision
            .as_ref()
            .is_some_and(|revision| reads.existing_revision.as_ref() != Some(revision))
    {
        return Err(corrupt());
    }
    VaultPath::parse(&reads.parent_path).map_err(|_| corrupt())?;
    VaultPath::parse(&reads.task_path).map_err(|_| corrupt())?;
    for revision in std::iter::once(&reads.parent_revision).chain(reads.existing_revision.iter()) {
        if revision.len() != 64
            || !revision
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(corrupt());
        }
    }
    if reads.parent_path == reads.task_path {
        return Err(corrupt());
    }
    Ok(())
}

pub(super) fn validate_database(db: &Connection) -> Result<()> {
    let missing:i64=db.query_row("SELECT count(*) FROM journals j LEFT JOIN occurrence_plans p ON p.profile=j.profile AND p.id=j.id WHERE json_extract(CASE WHEN json_valid(j.fingerprint) THEN j.fingerprint ELSE '{}' END,'$.command.kind')='materialize_occurrence' AND p.id IS NULL",[],|row|row.get(0))?;
    if missing != 0 {
        return Err(corrupt());
    }
    let mut statement = db.prepare("SELECT p.profile,p.id,p.json,j.fingerprint FROM occurrence_plans p JOIN journals j ON j.profile=p.profile AND j.id=p.id")?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;
    for row in rows {
        let (profile, id, json, fingerprint) = row?;
        let reads: ReadPlan = serde_json::from_str(&json).map_err(|_| corrupt())?;
        validate(&reads, &fingerprint)?;
        validate_owned_files(db, &profile, &id, &reads)?;
    }
    Ok(())
}

fn validate_owned_files(db: &Connection, profile: &str, id: &str, reads: &ReadPlan) -> Result<()> {
    let (count,matching):(i64,i64)=db.query_row("SELECT count(*),coalesce(sum(CASE WHEN path=?3 AND before IS NULL AND bytes IS NOT NULL THEN 1 ELSE 0 END),0) FROM journal_files WHERE profile=?1 AND id=?2",params![profile,id,reads.task_path],|row|Ok((row.get(0)?,row.get(1)?)))?;
    if reads.existing_revision.is_some() {
        if count != 0 {
            return Err(corrupt());
        }
    } else if count != 1 || matching != 1 {
        return Err(corrupt());
    }
    Ok(())
}

fn load(db: &Connection, profile: &str, id: &str) -> Result<Option<ReadPlan>> {
    let (fingerprint,json):(String,Option<String>)=db.query_row("SELECT j.fingerprint,p.json FROM journals j LEFT JOIN occurrence_plans p ON p.profile=j.profile AND p.id=j.id WHERE j.profile=? AND j.id=?",params![profile,id],|row|Ok((row.get(0)?,row.get(1)?)))?;
    if let Some(json) = json {
        let reads: ReadPlan = serde_json::from_str(&json).map_err(|_| corrupt())?;
        validate(&reads, &fingerprint)?;
        validate_owned_files(db, profile, id, &reads)?;
        return Ok(Some(reads));
    }
    if fingerprint.starts_with('{') {
        let value: serde_json::Value = serde_json::from_str(&fingerprint).map_err(|_| corrupt())?;
        if value
            .pointer("/command/kind")
            .and_then(serde_json::Value::as_str)
            == Some("materialize_occurrence")
        {
            return Err(corrupt());
        }
    }
    Ok(None)
}

pub(super) fn task_path(db: &Connection, profile: &str, id: &str) -> Result<Option<String>> {
    Ok(load(db, profile, id)?.map(|reads| reads.task_path))
}

impl Engine {
    pub(super) fn check_occurrence_reads(&self, profile: &str, id: &str) -> Result<()> {
        self.check_progression_effects(profile, id)?;
        self.check_occurrence_window_reads(profile, id)?;
        let Some(reads) = self.database(|db| load(db, profile, id))? else {
            return Ok(());
        };
        for (path, revision) in std::iter::once((&reads.parent_path, &reads.parent_revision)).chain(
            reads
                .existing_revision
                .as_ref()
                .map(|revision| (&reads.task_path, revision)),
        ) {
            let bytes = self
                .files
                .read_file(profile, path)?
                .ok_or(RuntimeError::Conflict)?;
            if ContentRevision::of(&bytes).as_str() != revision {
                return Err(RuntimeError::Conflict);
            }
        }
        Ok(())
    }
}
