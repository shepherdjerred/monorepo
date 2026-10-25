//! Resource-exhausted future work never rolls back a committed child transition.
//! Immutable failure inputs and owned resolution effects are separate records.
use super::{Engine, Mutation, Result, RuntimeError, TaskNotesConfiguration, staged};
use crate::{
    commands::occurrence_transitions::{DeferredProgression, RepairResult, State},
    types::{Command, FileProblem},
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tasknotes_vault::{document::ContentRevision, path::VaultPath, temporal};

pub(super) struct Prepared {
    id: String,
    intent: DeferredProgression,
    configuration: super::successors::ConfigurationSnapshot,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(super) enum ResolutionKind {
    Materialized,
    Exhausted,
    PolicyNoSuccessor,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Resolution {
    repair_id: String,
    kind: ResolutionKind,
    future_date: Option<String>,
    successor_id: Option<String>,
    parent_revision: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Effect {
    failure_id: String,
    before_resolution: Option<Resolution>,
    after_resolution: Option<Resolution>,
}

fn corrupt() -> RuntimeError {
    RuntimeError::Storage("deferred progression ownership is corrupt".into())
}
fn sha(value: &[u8]) -> String {
    hex::encode(Sha256::digest(value))
}
fn revision(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn identity(profile: &str, primary: &str, intent: &DeferredProgression) -> Result<String> {
    Ok(format!(
        "occprogress:{}",
        sha(&serde_json::to_vec(&(
            profile,
            primary,
            &intent.parent_path,
            &intent.child_path,
            &intent.occurrence_date
        ))?)
    ))
}
fn checked_json<T: for<'a> Deserialize<'a> + Serialize>(raw: &str) -> Result<T> {
    let value: T = serde_json::from_str(raw).map_err(|_| corrupt())?;
    if serde_json::to_string(&value)? != raw {
        return Err(corrupt());
    }
    Ok(value)
}

pub(super) fn load_intent(db: &Connection, profile: &str, id: &str) -> Result<DeferredProgression> {
    let raw: Option<String> = db
        .query_row(
            "SELECT intent FROM occurrence_deferred_progressions WHERE profile=? AND id=?",
            params![profile, id],
            |row| row.get(0),
        )
        .optional()?;
    checked_json(&raw.ok_or(RuntimeError::NotFound)?)
}
fn read_resolution(db: &Connection, profile: &str, id: &str) -> Result<Option<Resolution>> {
    let row:Option<(String,String)>=db.query_row("SELECT json,sha256 FROM occurrence_progression_resolutions WHERE profile=? AND failure_id=?",params![profile,id],|row|Ok((row.get(0)?,row.get(1)?))).optional()?;
    row.map(|(raw, hash)| {
        if sha(raw.as_bytes()) != hash {
            return Err(corrupt());
        }
        checked_json(&raw)
    })
    .transpose()
}
fn load_effects(db: &Connection, profile: &str, id: &str) -> Result<Vec<Effect>> {
    let row: Option<(String, String)> = db
        .query_row(
            "SELECT json,sha256 FROM occurrence_progression_effects WHERE profile=? AND id=?",
            params![profile, id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let Some((raw, hash)) = row else {
        return Ok(Vec::new());
    };
    if sha(raw.as_bytes()) != hash {
        return Err(corrupt());
    }
    let effects: Vec<Effect> = checked_json(&raw)?;
    if effects.is_empty() || effects.len() > 1000 {
        return Err(corrupt());
    }
    for effect in &effects {
        super::validate_identity(&effect.failure_id).map_err(|_| corrupt())?;
        if effect.before_resolution == effect.after_resolution {
            return Err(corrupt());
        }
        let origin = load_intent(db, profile, &effect.failure_id)?;
        for resolution in effect
            .before_resolution
            .iter()
            .chain(effect.after_resolution.iter())
        {
            super::validate_identity(&resolution.repair_id).map_err(|_| corrupt())?;
            if !revision(&resolution.parent_revision) {
                return Err(corrupt());
            }
            match (
                &resolution.kind,
                &resolution.future_date,
                &resolution.successor_id,
            ) {
                (ResolutionKind::Materialized, Some(day), Some(successor)) => {
                    temporal::parse_day(day).map_err(|_| corrupt())?;
                    let expected = format!(
                        "occnext:{}",
                        sha(&serde_json::to_vec(&(
                            profile,
                            &resolution.repair_id,
                            &origin.parent_path,
                            day
                        ))?)
                    );
                    if successor != &expected {
                        return Err(corrupt());
                    }
                }
                (ResolutionKind::Exhausted | ResolutionKind::PolicyNoSuccessor, None, None) => {}
                _ => return Err(corrupt()),
            }
        }
    }
    Ok(effects)
}
fn check_effects(db: &Connection, profile: &str, effects: &[Effect]) -> Result<()> {
    for effect in effects {
        if read_resolution(db, profile, &effect.failure_id)? != effect.before_resolution {
            return Err(RuntimeError::Conflict);
        }
    }
    Ok(())
}

impl Engine {
    pub(super) fn prepare_deferred_progressions(
        &self,
        profile: &str,
        config: &TaskNotesConfiguration,
        primary: &Mutation,
        changed: &std::collections::BTreeMap<String, Option<crate::types::PayloadInfo>>,
        intents: &[DeferredProgression],
    ) -> Result<Vec<Prepared>> {
        if intents.len() > 1000 {
            return Err(RuntimeError::Validation(
                "too many deferred progressions".into(),
            ));
        }
        let snapshot = if intents.is_empty() {
            None
        } else {
            Some(self.successor_configuration_snapshot(profile, config)?)
        };
        intents
            .iter()
            .map(|intent| {
                let mut intent = intent.clone();
                for (path, revision) in [
                    (&intent.parent_path, &mut intent.parent_revision),
                    (&intent.child_path, &mut intent.child_revision),
                ] {
                    if let Some(image) = changed.get(path) {
                        revision
                            .clone_from(&image.as_ref().ok_or(RuntimeError::Conflict)?.revision);
                    }
                }
                Ok(Prepared {
                    id: identity(profile, &primary.mutation_id, &intent)?,
                    intent,
                    configuration: snapshot.as_ref().ok_or_else(corrupt)?.clone(),
                })
            })
            .collect()
    }

    pub(super) fn check_progression_effects(&self, profile: &str, id: &str) -> Result<()> {
        self.database(|db| check_effects(db, profile, &load_effects(db, profile, id)?))
    }

    pub(super) fn plan_progression_repair(
        &self,
        profile: &str,
        config: &TaskNotesConfiguration,
        mutation: &Mutation,
    ) -> Result<super::command_images::CommandImagePlan> {
        let Command::RepairOccurrenceProgression {
            progression_id,
            expected_parent_revision,
            expected_child_revision,
        } = &mutation.command
        else {
            return Err(corrupt());
        };
        let (intent, before) = self.database(|db| {
            let state: Option<String> = db
                .query_row(
                    "SELECT state FROM occurrence_deferred_progressions WHERE profile=? AND id=?",
                    params![profile, progression_id],
                    |row| row.get(0),
                )
                .optional()?;
            if state.as_deref() != Some("failed") {
                return Err(RuntimeError::Conflict);
            }
            Ok((
                load_intent(db, profile, progression_id)?,
                read_resolution(db, profile, progression_id)?,
            ))
        })?;
        let synthetic = repair_transition(mutation, &intent, expected_child_revision)?;
        let unchanged = std::collections::BTreeMap::new();
        let view = super::plan_files::PlanFiles::new(self, profile, &unchanged);
        let parent = crate::types::read_text_file(&view, profile, &intent.parent_path)?
            .ok_or(RuntimeError::NotFound)?;
        if ContentRevision::of(&parent).as_str() != expected_parent_revision {
            return Err(RuntimeError::Conflict);
        }
        let planned = crate::commands::occurrence_transitions::plan_with_repair(
            &view,
            profile,
            config,
            &synthetic,
            Some(&intent),
        )?
        .ok_or_else(corrupt)?;
        if planned.deferred.is_some() {
            return Err(corrupt());
        }
        let writes = self.database(|db| staged::inline_files(db, profile, &planned.writes))?;
        let changed = writes
            .iter()
            .map(|write| (write.path.clone(), write.after.clone()))
            .collect();
        let successors = self.prepare_successors(
            profile,
            config,
            mutation,
            &changed,
            planned.successor.into_iter().collect(),
        )?;
        let parent_revision = writes
            .iter()
            .find(|write| write.path == intent.parent_path)
            .and_then(|write| write.after.as_ref())
            .map_or_else(
                || expected_parent_revision.clone(),
                |image| image.revision.clone(),
            );
        let (kind, future_date, successor_id) = match planned.repair_result.ok_or_else(corrupt)? {
            RepairResult::Materialized { occurrence_date } => {
                let item = successors.first().ok_or_else(corrupt)?;
                (
                    ResolutionKind::Materialized,
                    Some(occurrence_date),
                    Some(item.mutation.mutation_id.clone()),
                )
            }
            RepairResult::Exhausted => (ResolutionKind::Exhausted, None, None),
            RepairResult::PolicyNoSuccessor => (ResolutionKind::PolicyNoSuccessor, None, None),
        };
        let effect = Effect {
            failure_id: progression_id.clone(),
            before_resolution: before,
            after_resolution: Some(Resolution {
                repair_id: mutation.mutation_id.clone(),
                kind,
                future_date,
                successor_id,
                parent_revision,
            }),
        };
        self.database(|db| check_effects(db, profile, std::slice::from_ref(&effect)))?;
        Ok(super::command_images::CommandImagePlan {
            writes,
            diagnostics: planned.diagnostics,
            title_changes: Vec::new(),
            occurrence_reads: None,
            occurrence_window: None,
            transitions: vec![planned.fence],
            successors,
            progressions: Vec::new(),
            progression_effects: vec![effect],
        })
    }
}

fn repair_transition(
    mutation: &Mutation,
    intent: &DeferredProgression,
    revision: &str,
) -> Result<Mutation> {
    let mut synthetic = mutation.clone();
    synthetic.command = match intent.child_state {
        State::Completed => Command::SetCompletion {
            path: intent.child_path.clone(),
            expected_revision: Some(revision.into()),
            completed: true,
            occurrence_date: Some(intent.occurrence_date.clone()),
        },
        State::Skipped => Command::SetOccurrenceSkipped {
            path: intent.child_path.clone(),
            expected_revision: Some(revision.into()),
            occurrence_date: intent.occurrence_date.clone(),
            skipped: true,
        },
        State::Active => return Err(corrupt()),
    };
    Ok(synthetic)
}

pub(super) fn store(
    db: &Connection,
    profile: &str,
    primary: &str,
    progressions: &[Prepared],
    effects: &[Effect],
) -> Result<()> {
    for item in progressions {
        db.execute("INSERT INTO occurrence_deferred_progressions(profile,id,primary_id,intent,configuration,state) VALUES(?,?,?,?,?,'staged')",params![profile,item.id,primary,serde_json::to_string(&item.intent)?,serde_json::to_string(&item.configuration)?])?;
    }
    if !effects.is_empty() {
        check_effects(db, profile, effects)?;
        let raw = serde_json::to_string(effects)?;
        db.execute(
            "INSERT INTO occurrence_progression_effects(profile,id,json,sha256) VALUES(?,?,?,?)",
            params![profile, primary, raw, sha(raw.as_bytes())],
        )?;
    }
    Ok(())
}

pub(super) fn undo_effects(db: &Connection, profile: &str, receipt: &str) -> Result<Vec<Effect>> {
    let original = load_effects(db, profile, receipt)?;
    let inverse = original
        .into_iter()
        .map(|effect| Effect {
            failure_id: effect.failure_id,
            before_resolution: effect.after_resolution,
            after_resolution: effect.before_resolution,
        })
        .collect::<Vec<_>>();
    check_effects(db, profile, &inverse)?;
    Ok(inverse)
}

pub(super) fn committed(
    db: &Connection,
    profile: &str,
    id: &str,
    mutation: Option<&Mutation>,
) -> Result<()> {
    let effects = load_effects(db, profile, id)?;
    check_effects(db, profile, &effects)?;
    for effect in effects {
        if let Some(after) = effect.after_resolution {
            let raw = serde_json::to_string(&after)?;
            db.execute("INSERT INTO occurrence_progression_resolutions(profile,failure_id,json,sha256) VALUES(?,?,?,?) ON CONFLICT(profile,failure_id) DO UPDATE SET json=excluded.json,sha256=excluded.sha256",params![profile,effect.failure_id,raw,sha(raw.as_bytes())])?;
        } else {
            db.execute(
                "DELETE FROM occurrence_progression_resolutions WHERE profile=? AND failure_id=?",
                params![profile, effect.failure_id],
            )?;
        }
    }
    db.execute("UPDATE occurrence_deferred_progressions SET state='failed' WHERE profile=? AND primary_id=? AND state='staged'",params![profile,id])?;
    if let Some(Mutation {
        command: Command::Undo { receipt_id },
        ..
    }) = mutation
    {
        db.execute("UPDATE occurrence_deferred_progressions SET state='cancelled' WHERE profile=? AND primary_id=?",params![profile,receipt_id])?;
    }
    Ok(())
}

pub(super) fn resolved(
    db: &Connection,
    profile: &str,
    failure: &str,
    occurrences: &super::occurrence_relations::Index,
) -> Result<bool> {
    let Some(resolution) = read_resolution(db, profile, failure)? else {
        return Ok(false);
    };
    let receipt: Option<String> = db
        .query_row(
            "SELECT receipt FROM journals WHERE profile=? AND id=?",
            params![profile, resolution.repair_id],
            |row| row.get(0),
        )
        .optional()?
        .flatten();
    let Some(receipt) = receipt else {
        return Ok(false);
    };
    if !super::checked_stored_receipt(db, profile, &resolution.repair_id, &receipt)?.applied {
        return Ok(false);
    }
    let undo:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM journals WHERE profile=?1 AND receipt IS NOT NULL AND json_extract(receipt,'$.applied')=1 AND json_valid(fingerprint) AND json_extract(fingerprint,'$.command.kind')='undo' AND json_extract(fingerprint,'$.command.receiptId')=?2)",params![profile,resolution.repair_id],|row|row.get(0))?;
    if undo {
        return Ok(false);
    }
    match resolution.kind {
        ResolutionKind::Materialized => Ok(occurrences.unique(
            &load_intent(db, profile, failure)?.parent_path,
            resolution.future_date.as_deref().ok_or_else(corrupt)?,
        )),
        ResolutionKind::Exhausted | ResolutionKind::PolicyNoSuccessor => Ok(true),
    }
}

pub(super) fn problems(
    db: &Connection,
    profile: &str,
    occurrences: &super::occurrence_relations::Index,
) -> Result<Vec<FileProblem>> {
    let mut statement=db.prepare("SELECT id,intent FROM occurrence_deferred_progressions WHERE profile=? AND state='failed' ORDER BY rowid")?;
    let rows = statement.query_map([profile], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut problems = Vec::new();
    for row in rows {
        let (id, raw) = row?;
        let intent: DeferredProgression = checked_json(&raw)?;
        if !resolved(db, profile, &id, occurrences)? {
            problems.push(FileProblem{path:intent.parent_path,message:format!("Series progression {id} exceeded its resource limit. Primary {} for {} was preserved. Parent date progression {}. Repair this recorded operation with current parent/child revisions after correcting the rule or policy.",if intent.child_state==State::Skipped{"skip"}else{"completion"},intent.occurrence_date,if intent.parent_projection_owed{"is still owed"}else{"already completed"})});
        }
    }
    Ok(problems)
}

pub(super) fn outcomes(db: &Connection, profile: &str, primary: &str) -> Result<Vec<Value>> {
    let mut statement=db.prepare("SELECT id,intent,state FROM occurrence_deferred_progressions WHERE profile=? AND primary_id=? ORDER BY rowid")?;
    let rows = statement.query_map(params![profile, primary], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut output = Vec::new();
    for row in rows {
        let (id, raw, state) = row?;
        output.push(render_outcome(db, profile, &id, &raw, &state)?);
    }
    Ok(output)
}

pub(super) fn render_outcome(
    db: &Connection,
    profile: &str,
    id: &str,
    raw: &str,
    state: &str,
) -> Result<Value> {
    let intent: DeferredProgression = checked_json(raw)?;
    let failure = match state {
        "cancelled" => Value::Null,
        "staged" | "failed" => {
            json!({"code":"validation","message":"Invalid operation: occurrence_expansion_resource_limit"})
        }
        _ => return Err(corrupt()),
    };
    Ok(
        json!({"kind":"deferred_progression","successorId":id,"parentPath":intent.parent_path,"childPath":intent.child_path,"completedOccurrenceDate":intent.occurrence_date,"childState":intent.child_state,"occurrenceDate":null,"parentProjectionOwed":intent.parent_projection_owed,"successorDiscoveryOwed":intent.successor_discovery_owed,"state":state,"failure":failure,"resolution":read_resolution(db,profile,id)?}),
    )
}

pub(super) fn validate_database(db: &Connection) -> Result<()> {
    let mut statement=db.prepare("SELECT d.profile,d.id,d.primary_id,d.intent,d.configuration,d.state,j.fingerprint,j.receipt FROM occurrence_deferred_progressions d LEFT JOIN journals j ON j.profile=d.profile AND j.id=d.primary_id")?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
        ))
    })?;
    for row in rows {
        let (profile, id, primary, raw, configuration, state, fingerprint, receipt) = row?;
        let intent: DeferredProgression = checked_json(&raw)?;
        let mutation: Mutation =
            serde_json::from_str(&fingerprint.ok_or_else(corrupt)?).map_err(|_| corrupt())?;
        if identity(&profile, &primary, &intent)? != id
            || mutation.mutation_id != primary
            || mutation.at != intent.origin_at
            || serde_json::to_value(&mutation.execution_context)?
                != serde_json::to_value(&intent.origin_context)?
            || matches!(intent.child_state, State::Active)
            || (!intent.parent_projection_owed && !intent.successor_discovery_owed)
            || (intent.parent_projection_owed && intent.anchor_applied)
            || (!matches!(state.as_str(), "staged" | "failed" | "cancelled"))
            || ((state == "staged") != receipt.is_none())
        {
            return Err(corrupt());
        }
        for path in [&intent.parent_path, &intent.child_path] {
            VaultPath::parse(path).map_err(|_| corrupt())?;
        }
        for value in [
            &intent.parent_revision,
            &intent.child_revision,
            &intent.input_parent_revision,
            &intent.input_child_revision,
        ] {
            if !revision(value) {
                return Err(corrupt());
            }
        }
        temporal::parse_day(&intent.occurrence_date).map_err(|_| corrupt())?;
        let config: super::successors::ConfigurationSnapshot =
            serde_json::from_str(&configuration).map_err(|_| corrupt())?;
        let config = config.resolve().map_err(|_| corrupt())?;
        let fences = super::occurrence_transitions::load(db, &profile, &primary)?;
        if !fences.iter().any(|fence| {
            fence.parent_result_path == intent.parent_path
                && fence.result_path == intent.child_path
                && fence.occurrence_date == intent.occurrence_date
        }) {
            return Err(corrupt());
        }
        validate_owned_input(db, &profile, &primary, &intent, &config, &fences)?;
        let fence = fences
            .iter()
            .find(|fence| {
                fence.parent_result_path == intent.parent_path
                    && fence.result_path == intent.child_path
            })
            .ok_or_else(corrupt)?;
        if fence.deferred_input_hash.as_deref()
            != Some(&crate::commands::occurrence_transitions::deferred_input_hash(&intent)?)
            || crate::commands::occurrence_transitions::original_completion_instant(
                &mutation, fence,
            )
            .map_err(|_| corrupt())?
                != intent.completion_instant
        {
            return Err(corrupt());
        }
        if let Some(receipt) = receipt {
            let receipt = super::checked_stored_receipt(db, &profile, &primary, &receipt)?;
            if state == "failed" && !receipt.applied {
                return Err(corrupt());
            }
        }
    }
    validate_effect_owners(db)?;
    validate_resolutions(db)
}

fn validate_effect_owners(db: &Connection) -> Result<()> {
    let mut statement = db.prepare("SELECT profile,id FROM occurrence_progression_effects")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (profile, id) = row?;
        let effects = load_effects(db, &profile, &id)?;
        let raw: String = db.query_row(
            "SELECT fingerprint FROM journals WHERE profile=? AND id=?",
            params![profile, id],
            |row| row.get(0),
        )?;
        let mutation: Mutation = serde_json::from_str(&raw).map_err(|_| corrupt())?;
        match mutation.command {
            Command::RepairOccurrenceProgression { progression_id, .. } => {
                let [effect] = effects.as_slice() else {
                    return Err(corrupt());
                };
                if effect.failure_id != progression_id
                    || effect
                        .after_resolution
                        .as_ref()
                        .is_none_or(|resolution| resolution.repair_id != id)
                {
                    return Err(corrupt());
                }
            }
            Command::Undo { receipt_id } => {
                let original = load_effects(db, &profile, &receipt_id)?;
                let inverse = original
                    .into_iter()
                    .map(|effect| Effect {
                        failure_id: effect.failure_id,
                        before_resolution: effect.after_resolution,
                        after_resolution: effect.before_resolution,
                    })
                    .collect::<Vec<_>>();
                if inverse != effects {
                    return Err(corrupt());
                }
            }
            _ => return Err(corrupt()),
        }
    }
    let missing:i64=db.query_row("SELECT count(*) FROM journals j LEFT JOIN occurrence_progression_effects e ON e.profile=j.profile AND e.id=j.id WHERE json_valid(j.fingerprint) AND json_extract(j.fingerprint,'$.command.kind')='repair_occurrence_progression' AND e.id IS NULL",[],|row|row.get(0))?;
    if missing != 0 {
        return Err(corrupt());
    }
    Ok(())
}

fn validate_resolutions(db: &Connection) -> Result<()> {
    let mut statement =
        db.prepare("SELECT profile,failure_id FROM occurrence_progression_resolutions")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (profile, failure) = row?;
        let resolution = read_resolution(db, &profile, &failure)?.ok_or_else(corrupt)?;
        let effects = load_effects(db, &profile, &resolution.repair_id)?;
        if !effects.iter().any(|effect| {
            effect.failure_id == failure && effect.after_resolution.as_ref() == Some(&resolution)
        }) {
            return Err(corrupt());
        }
        let receipt: Option<String> = db
            .query_row(
                "SELECT receipt FROM journals WHERE profile=? AND id=?",
                params![profile, resolution.repair_id],
                |row| row.get(0),
            )
            .optional()?
            .flatten();
        if !super::checked_stored_receipt(
            db,
            &profile,
            &resolution.repair_id,
            &receipt.ok_or_else(corrupt)?,
        )?
        .applied
        {
            return Err(corrupt());
        }
    }
    Ok(())
}

fn validate_owned_input(
    db: &Connection,
    profile: &str,
    primary: &str,
    intent: &DeferredProgression,
    config: &TaskNotesConfiguration,
    fences: &[crate::commands::occurrence_transitions::Fence],
) -> Result<()> {
    let fence = fences
        .iter()
        .find(|fence| {
            fence.parent_result_path == intent.parent_path && fence.result_path == intent.child_path
        })
        .ok_or_else(corrupt)?;
    let writes = staged::read_files(db, profile, primary)?;
    for (path, expected, fallback) in [
        (
            &intent.parent_path,
            &intent.parent_revision,
            &fence.parent_revision,
        ),
        (
            &intent.child_path,
            &intent.child_revision,
            &fence.task_revision,
        ),
    ] {
        if let Some(image) = writes
            .iter()
            .find(|write| &write.path == path)
            .and_then(|write| write.after.as_ref())
        {
            if &image.revision != expected {
                return Err(corrupt());
            }
            let bytes = super::payloads::read_inline(db, profile, &image.id)?;
            let document =
                tasknotes_vault::document::TaskDocument::parse(VaultPath::parse(path)?, &bytes)
                    .map_err(|_| corrupt())?;
            if document.revision().as_str() != expected {
                return Err(corrupt());
            }
            if path == &intent.parent_path
                && intent.input_parent_revision == intent.parent_revision
                && config.mapping.normalize(document.frontmatter()) != intent.parent_properties
            {
                return Err(corrupt());
            }
            if path == &intent.child_path {
                let Some((_, day)) =
                    crate::commands::occurrences::mapped_identity(config, &document)
                        .map_err(|_| corrupt())?
                else {
                    return Err(corrupt());
                };
                if day != intent.occurrence_date {
                    return Err(corrupt());
                }
            }
        } else if expected != fallback {
            return Err(corrupt());
        }
    }
    if intent.parent_projection_owed && intent.child_state != State::Completed
        || intent.anchor_applied
            != (intent.child_state == State::Completed && !intent.parent_projection_owed)
    {
        return Err(corrupt());
    }
    Ok(())
}
