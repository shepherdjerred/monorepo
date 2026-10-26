//! Bounded failure rows plus one canonical cached relation catalog per snapshot.
//! The catalog scan is metadata-only and is not bounded by the page row limit.
use super::{Engine, Mutation, Result, RuntimeError, occurrence_relations::Index};
use crate::{commands::occurrence_transitions::Fence, features::GenerationCursor, types::Command};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet, btree_map::Entry};

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum Unrepairable {
    ParentMissing,
    InvalidCurrentParent,
    ChildMissing,
    ChangedOrAmbiguousIdentity,
    ChildStateChanged,
}
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum Action {
    Repairable { command: Command },
    Unrepairable { reason: Unrepairable },
}

fn invalid_cursor() -> RuntimeError {
    RuntimeError::Validation("invalid_generation_failure_cursor".into())
}
fn corrupt() -> RuntimeError {
    RuntimeError::Storage("cached generation failure is corrupt".into())
}
fn hash(value: &[u8]) -> String {
    hex::encode(Sha256::digest(value))
}
fn binding(profile: &str, version: u64, configuration: &str, id: &str) -> Result<String> {
    Ok(hash(&serde_json::to_vec(&(
        1,
        "occurrence_generation_failures",
        profile,
        version,
        hash(configuration.as_bytes()),
        id,
    ))?))
}
fn cached(
    db: &Connection,
    profile: &str,
    path: &str,
) -> Result<Option<(String, Map<String, Value>)>> {
    let row:Option<(String,String)>=db.query_row("SELECT json_extract(task,'$.revision'),(SELECT json_group_object(key,value) FROM json_each(task,'$.properties') WHERE key IN ('recurrence','recurrenceAnchor','scheduled','dateCreated','recurrenceParent','occurrenceDate','occurrenceMaterialization','occurrenceNextTrigger','occurrencePastHorizon','occurrenceFutureHorizon','occurrenceTemplate')) FROM files WHERE profile=? AND path=? AND task IS NOT NULL",params![profile,path],|row|Ok((row.get(0)?,row.get(1)?))).optional()?;
    row.map(|(revision, properties)| {
        if revision.len() != 64
            || !revision
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(corrupt());
        }
        Ok((revision, serde_json::from_str(&properties)?))
    })
    .transpose()
}

fn action(
    db: &Connection,
    profile: &str,
    id: &str,
    item: &Value,
    occurrences: &Index,
) -> Result<Action> {
    let parent = item["parentPath"].as_str().ok_or_else(corrupt)?;
    let Some((parent_revision, properties)) = cached(db, profile, parent)? else {
        return Ok(Action::Unrepairable {
            reason: Unrepairable::ParentMissing,
        });
    };
    if crate::commands::occurrences::validate_parent_properties(&properties).is_err() {
        return Ok(Action::Unrepairable {
            reason: Unrepairable::InvalidCurrentParent,
        });
    }
    if item["kind"] == "deferred_progression" {
        let intent = super::deferred_progressions::load_intent(db, profile, id)?;
        let Some((child_revision, _)) = cached(db, profile, &intent.child_path)? else {
            return Ok(Action::Unrepairable {
                reason: Unrepairable::ChildMissing,
            });
        };
        if occurrences.unique_child(parent, &intent.occurrence_date)
            != Some(intent.child_path.as_str())
        {
            return Ok(Action::Unrepairable {
                reason: Unrepairable::ChangedOrAmbiguousIdentity,
            });
        }
        if !occurrences.matches_state(&intent.child_path, intent.child_state) {
            return Ok(Action::Unrepairable {
                reason: Unrepairable::ChildStateChanged,
            });
        }
        Ok(Action::Repairable {
            command: Command::RepairOccurrenceProgression {
                progression_id: id.into(),
                expected_parent_revision: parent_revision,
                expected_child_revision: child_revision,
            },
        })
    } else {
        let day = item["occurrenceDate"].as_str().ok_or_else(corrupt)?;
        if occurrences.ambiguous(parent, day) {
            return Ok(Action::Unrepairable {
                reason: Unrepairable::ChangedOrAmbiguousIdentity,
            });
        }
        let existing = occurrences
            .unique_child(parent, day)
            .map(|path| {
                cached(db, profile, path)?
                    .map(|(revision, _)| revision)
                    .ok_or_else(corrupt)
            })
            .transpose()?;
        Ok(Action::Repairable {
            command: Command::MaterializeOccurrence {
                parent_path: parent.into(),
                expected_parent_revision: parent_revision,
                occurrence_date: day.into(),
                expected_occurrence_revision: existing,
                properties: Map::new(),
                body: None,
            },
        })
    }
}

struct SourceTasks {
    paths: Vec<String>,
    ambiguous: bool,
}

/// Resolve source occurrence identities in the current cached catalog. Historical
/// result paths validate deferred provenance; they never select current tasks.
fn source_tasks(fences: &[Fence], item: &Value, occurrences: &Index) -> Result<SourceTasks> {
    let parent = item["parentPath"].as_str().ok_or_else(corrupt)?;
    let deferred = item["kind"] == "deferred_progression";
    let mut matched = false;
    let mut paths = BTreeSet::new();
    let mut ambiguous = false;
    for fence in fences {
        if fence.parent_result_path != parent
            || deferred
                && (item["completedOccurrenceDate"].as_str()
                    != Some(fence.occurrence_date.as_str())
                    || item["childPath"].as_str() != Some(fence.result_path.as_str()))
        {
            continue;
        }
        matched = true;
        ambiguous |= occurrences.ambiguous(parent, &fence.occurrence_date);
        if let Some(path) = occurrences.unique_child(parent, &fence.occurrence_date) {
            paths.insert(path.to_owned());
        }
    }
    if !matched {
        return Err(corrupt());
    }
    Ok(SourceTasks {
        paths: paths.into_iter().collect(),
        ambiguous,
    })
}

fn row(
    db: &Connection,
    profile: &str,
    id: &str,
    occurrences: &Index,
    primary_fences: &mut BTreeMap<String, Vec<Fence>>,
) -> Result<Option<Value>> {
    let concrete:Option<(String,String,String,Option<String>)>=db.query_row("SELECT primary_id,intent,state,failure FROM occurrence_successors WHERE profile=? AND id=?",params![profile,id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))).optional()?;
    let (primary, item) = if let Some((primary, intent, state, failure)) = concrete {
        let mutation: Mutation = serde_json::from_str(&intent).map_err(|_| corrupt())?;
        if mutation.mutation_id != id {
            return Err(corrupt());
        }
        let item = super::successors::render_outcome(id, &intent, &state, failure.as_deref())?;
        if occurrences.unique(
            item.get("parentPath")
                .and_then(Value::as_str)
                .ok_or_else(corrupt)?,
            item.get("occurrenceDate")
                .and_then(Value::as_str)
                .ok_or_else(corrupt)?,
        ) {
            return Ok(None);
        }
        (primary, item)
    } else {
        let (primary,raw,state):(String,String,String)=db.query_row("SELECT primary_id,intent,state FROM occurrence_deferred_progressions WHERE profile=? AND id=?",params![profile,id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?)))?;
        if super::deferred_progressions::resolved(db, profile, id, occurrences)? {
            return Ok(None);
        }
        let item = super::deferred_progressions::render_outcome(db, profile, id, &raw, &state)?;
        (primary, item)
    };
    let fences = match primary_fences.entry(primary.clone()) {
        Entry::Vacant(entry) => {
            entry.insert(super::occurrence_transitions::load(db, profile, &primary)?)
        }
        Entry::Occupied(entry) => entry.into_mut(),
    };
    let sources = source_tasks(fences, &item, occurrences)?;
    let action = if sources.ambiguous {
        Action::Unrepairable {
            reason: Unrepairable::ChangedOrAmbiguousIdentity,
        }
    } else {
        action(db, profile, id, &item, occurrences)?
    };
    Ok(Some(
        json!({"primaryMutationId":primary,"item":item,"action":action,"sourceTaskPaths":sources.paths}),
    ))
}

impl Engine {
    pub(super) fn occurrence_generation_failures(
        &self,
        profile: &str,
        limit: Option<u32>,
        after: Option<&GenerationCursor>,
        expected_version: Option<u64>,
    ) -> Result<Value> {
        let limit = limit.unwrap_or(128);
        if !(1..=256).contains(&limit) {
            return Err(RuntimeError::Validation(
                "generation failure page limit must be1..256".into(),
            ));
        }
        if let Some(cursor) = after {
            super::validate_identity(&cursor.last_id)?;
            if expected_version != Some(cursor.version) {
                return Err(invalid_cursor());
            }
        }
        self.database(|db|{
            let tx=db.unchecked_transaction()?;
            let (version,configuration):(i64,Option<String>)=tx.query_row("SELECT version,configuration FROM profiles WHERE id=?",[profile],|row|Ok((row.get(0)?,row.get(1)?)))?;
            let version=u64::try_from(version).map_err(|_|corrupt())?;
            if expected_version.is_some_and(|expected|expected!=version){return Err(RuntimeError::Conflict);}
            let configuration=configuration.ok_or_else(||RuntimeError::Configuration("generation repair waits for TaskNotes configuration".into()))?;
            if let Some(cursor)=after && cursor.binding!=binding(profile,version,&configuration,&cursor.last_id)?{return Err(invalid_cursor());}
            if let Some(cursor)=after {let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM occurrence_successors WHERE profile=?1 AND id=?2 AND state IN ('pending','failed') UNION ALL SELECT 1 FROM occurrence_deferred_progressions WHERE profile=?1 AND id=?2 AND state='failed')",params![profile,cursor.last_id],|row|row.get(0))?;if !exists{return Err(invalid_cursor());}}
            let mut query=tx.prepare("SELECT id FROM (SELECT id FROM occurrence_successors WHERE profile=?1 AND state IN ('pending','failed') UNION ALL SELECT id FROM occurrence_deferred_progressions WHERE profile=?1 AND state='failed') WHERE id COLLATE BINARY > ?2 ORDER BY id COLLATE BINARY LIMIT ?3")?;
            let mut ids=query.query_map(params![profile,after.map_or("",|cursor|cursor.last_id.as_str()),i64::from(limit)+1],|row|row.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
            let more=ids.len()>usize::try_from(limit).map_err(|_|corrupt())?;if more{ids.pop();}drop(query);
            let config:Value=serde_json::from_str(&configuration)?;
            let occurrences=Index::read(&tx,profile,&config)?;
            let mut primary_fences=BTreeMap::new();
            let mut items=Vec::new();for id in &ids {if let Some(item)=row(&tx,profile,id,&occurrences,&mut primary_fences)?{items.push(item);}}
            let cursor=if more {let last=ids.last().ok_or_else(corrupt)?;Some(GenerationCursor{last_id:last.clone(),version,binding:binding(profile,version,&configuration,last)?})}else{None};
            Ok(json!({"schemaVersion":1,"profileId":profile,"version":version,"inspectedCount":ids.len(),"items":items,"nextCursor":cursor}))
        })
    }
}
