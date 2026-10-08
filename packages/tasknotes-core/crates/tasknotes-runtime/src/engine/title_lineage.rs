//! Owner/path-scoped lossless titles, journaled with exact file revisions.

use super::{
    Mutation, Result, RuntimeError, TaskNotesConfiguration, TaskSnapshot, payloads,
    staged::DurableFile,
};
use crate::types::Command;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TitleRecord {
    field: String,
    title: String,
    revision: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TitleChange {
    path: String,
    #[serde(deserialize_with = "required_nullable_record")]
    before: Option<TitleRecord>,
    #[serde(deserialize_with = "required_nullable_record")]
    after: Option<TitleRecord>,
}
fn required_nullable_record<'de, D: serde::Deserializer<'de>>(
    decoder: D,
) -> std::result::Result<Option<TitleRecord>, D::Error> {
    Option::<TitleRecord>::deserialize(decoder)
}
fn valid(record: &TitleRecord) -> bool {
    !record.field.is_empty()
        && !record.title.trim().is_empty()
        && record.revision.len() == 64
        && record
            .revision
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
fn read(db: &Connection, profile: &str, path: &str) -> Result<Option<TitleRecord>> {
    let json: Option<String> = db
        .query_row(
            "SELECT json FROM title_lineage WHERE profile=? AND path=?",
            params![profile, path],
            |r| r.get(0),
        )
        .optional()?;
    let record = json
        .map(|json| serde_json::from_str::<TitleRecord>(&json))
        .transpose()
        .map_err(|_| RuntimeError::Storage("title lineage is corrupt".into()))?;
    if record.as_ref().is_some_and(|r| !valid(r)) {
        return Err(RuntimeError::Storage("title lineage is corrupt".into()));
    }
    Ok(record)
}
fn store(db: &Connection, profile: &str, path: &str, record: Option<&TitleRecord>) -> Result<()> {
    if let Some(record) = record {
        if !valid(record) {
            return Err(RuntimeError::Storage("title lineage is corrupt".into()));
        }
        db.execute("INSERT INTO title_lineage(profile,path,json) VALUES(?,?,?) ON CONFLICT(profile,path) DO UPDATE SET json=excluded.json",params![profile,path,serde_json::to_string(record)?])?;
    } else {
        db.execute(
            "DELETE FROM title_lineage WHERE profile=? AND path=?",
            params![profile, path],
        )?;
    }
    Ok(())
}
pub(super) fn project(
    db: &Connection,
    profile: &str,
    path: &str,
    bytes: &[u8],
    config: &TaskNotesConfiguration,
    staged: bool,
) -> Result<Option<TaskSnapshot>> {
    let task = super::project_task(path, bytes, config)?;
    let Some(mut task) = task else {
        return Ok(None);
    };
    if let Some(mut known) = read(db, profile, path)? {
        if config.store_title_in_filename && known.field != config.mapping.field("title") {
            return Err(RuntimeError::Validation(
                "title lineage mapping changed; review title settings".into(),
            ));
        }
        if config.store_title_in_filename
            && task.properties.get("title").and_then(Value::as_str) == Some(known.title.as_str())
        {
            task.title.clone_from(&known.title);
            known.revision.clone_from(&task.revision);
            if !staged {
                store(db, profile, path, Some(&known))?;
            }
        } else if !staged {
            store(db, profile, path, None)?;
        }
    }
    Ok(Some(task))
}

pub(super) fn reconcile_refresh(
    db: &Connection,
    profile: &str,
    config: Option<&TaskNotesConfiguration>,
) -> Result<()> {
    let Some(config) = config else { return Ok(()) };
    let paths = db
        .prepare("SELECT path FROM title_lineage WHERE profile=?")?
        .query_map([profile], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for path in paths {
        let Some(mut known) = read(db, profile, &path)? else {
            continue;
        };
        if config.store_title_in_filename && known.field != config.mapping.field("title") {
            continue;
        }
        let task: Option<Option<String>> = db
            .query_row(
                "SELECT task FROM files WHERE profile=? AND path=?",
                params![profile, path],
                |r| r.get(0),
            )
            .optional()?;
        let task = task
            .flatten()
            .map(|json| serde_json::from_str::<TaskSnapshot>(&json))
            .transpose()?;
        if let Some(task) = task.filter(|task| {
            config.store_title_in_filename
                && task.properties.get("title").and_then(Value::as_str)
                    == Some(known.title.as_str())
        }) {
            known.revision = task.revision;
            store(db, profile, &path, Some(&known))?;
        } else {
            store(db, profile, &path, None)?;
        }
    }
    Ok(())
}

pub(super) fn plan_changes(
    db: &Connection,
    profile: &str,
    config: &TaskNotesConfiguration,
    mutation: &Mutation,
    writes: &[DurableFile],
    changes: &mut Vec<TitleChange>,
) -> Result<()> {
    let explicit = match &mutation.command {
        Command::Create { properties, .. }
        | Command::Update { properties, .. }
        | Command::EditTask { properties, .. } => properties.get("title").and_then(Value::as_str),
        _ => None,
    };
    let primary = super::receipt_task_path(Some(mutation), writes)?;
    for write in writes {
        let prior = changes.iter().position(|change| change.path == write.path);
        let mut before = if let Some(index) = prior {
            changes
                .get(index)
                .ok_or_else(|| RuntimeError::Storage("title plan position changed".into()))?
                .after
                .clone()
        } else {
            read(db, profile, &write.path)?
        };
        if before.as_ref().is_some_and(|known| {
            config.store_title_in_filename && known.field != config.mapping.field("title")
        }) {
            return Err(RuntimeError::Validation(
                "title lineage mapping changed; review title settings".into(),
            ));
        }
        if let (Some(record), Some(image)) = (&mut before, &write.before) {
            record.revision.clone_from(&image.revision);
        }
        let mut after = None;
        if let Some(image) = write
            .after
            .as_ref()
            .filter(|_| write.path.to_ascii_lowercase().ends_with(".md"))
        {
            let bytes = payloads::read_inline(db, profile, &image.id)?;
            let document = tasknotes_vault::document::TaskDocument::parse(
                tasknotes_vault::path::VaultPath::parse(&write.path)?,
                &bytes,
            )?;
            let field = config.mapping.field("title");
            let title = document.frontmatter().get(field).and_then(Value::as_str);
            if let Some(requested) = explicit.filter(|_| {
                primary.as_deref() == Some(write.path.as_str()) && config.store_title_in_filename
            }) {
                if title == Some(requested) {
                    after = Some(TitleRecord {
                        field: field.into(),
                        title: requested.into(),
                        revision: image.revision.clone(),
                    });
                }
            } else if let Some(mut known) = before.clone().filter(|known| {
                config.store_title_in_filename
                    && known.field == field
                    && title == Some(known.title.as_str())
            }) {
                known.revision.clone_from(&image.revision);
                after = Some(known);
            }
        }
        if before.is_some() || after.is_some() {
            if let Some(index) = prior {
                changes
                    .get_mut(index)
                    .ok_or_else(|| RuntimeError::Storage("title plan position changed".into()))?
                    .after = after;
            } else {
                changes.push(TitleChange {
                    path: write.path.clone(),
                    before,
                    after,
                });
            }
        }
    }
    Ok(())
}

pub(super) fn read_changes(
    db: &Connection,
    profile: &str,
    id: &str,
    writes: &[DurableFile],
) -> Result<Vec<TitleChange>> {
    let json: String = db.query_row(
        "SELECT title_plans FROM journals WHERE profile=? AND id=?",
        params![profile, id],
        |r| r.get(0),
    )?;
    let changes: Vec<TitleChange> = serde_json::from_str(&json)
        .map_err(|_| RuntimeError::Storage("title journal is corrupt".into()))?;
    let mut paths = std::collections::BTreeSet::new();
    for change in &changes {
        tasknotes_vault::path::VaultPath::parse(&change.path)
            .map_err(|_| RuntimeError::Storage("title journal is corrupt".into()))?;
        let write = writes
            .iter()
            .find(|write| write.path == change.path)
            .ok_or_else(|| RuntimeError::Storage("title journal path changed".into()))?;
        if !paths.insert(&change.path)
            || [
                (&change.before, &write.before),
                (&change.after, &write.after),
            ]
            .into_iter()
            .any(|(record, image)| {
                record.as_ref().is_some_and(|record| {
                    !valid(record)
                        || image
                            .as_ref()
                            .is_none_or(|image| record.revision != image.revision)
                })
            })
        {
            return Err(RuntimeError::Storage(
                "title journal revision changed".into(),
            ));
        }
        for (record, image) in [
            (&change.before, &write.before),
            (&change.after, &write.after),
        ] {
            if let (Some(record), Some(image)) = (record, image) {
                let bytes = payloads::read_inline(db, profile, &image.id)?;
                let document = tasknotes_vault::document::TaskDocument::parse(
                    tasknotes_vault::path::VaultPath::parse(&change.path)?,
                    &bytes,
                )
                .map_err(|_| RuntimeError::Storage("title journal document changed".into()))?;
                if document
                    .frontmatter()
                    .get(&record.field)
                    .and_then(Value::as_str)
                    != Some(record.title.as_str())
                {
                    return Err(RuntimeError::Storage(
                        "title journal property changed".into(),
                    ));
                }
            }
        }
    }
    Ok(changes)
}
pub(super) fn apply_changes(
    db: &Connection,
    profile: &str,
    id: &str,
    writes: &[DurableFile],
) -> Result<()> {
    for change in read_changes(db, profile, id, writes)? {
        store(db, profile, &change.path, change.after.as_ref())?;
    }
    for write in writes.iter().filter(|write| write.after.is_none()) {
        store(db, profile, &write.path, None)?;
    }
    Ok(())
}
pub(super) fn undo_changes(
    db: &Connection,
    profile: &str,
    id: &str,
    writes: &[DurableFile],
) -> Result<Vec<TitleChange>> {
    let original = super::staged::read_files(db, profile, id)?;
    let changes = read_changes(db, profile, id, &original)?;
    let reversed = changes
        .into_iter()
        .map(|change| TitleChange {
            path: change.path,
            before: change.after,
            after: change.before,
        })
        .collect::<Vec<_>>();
    for change in &reversed {
        let write = writes
            .iter()
            .find(|write| write.path == change.path)
            .ok_or_else(|| RuntimeError::Storage("Undo title path missing".into()))?;
        if change.after.as_ref().is_some_and(|record| {
            write
                .after
                .as_ref()
                .is_none_or(|image| record.revision != image.revision)
        }) {
            return Err(RuntimeError::Storage("Undo title revision changed".into()));
        }
    }
    Ok(reversed)
}
