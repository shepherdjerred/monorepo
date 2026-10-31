//! Immutable followup plans are journaled before primary publication, but only
//! activated in the transaction that commits its receipt. Failure never undoes
//! a committed primary transition. Provider I/O stays outside database locks.

use super::{
    Engine, Mutation, Result, RuntimeError, TaskNotesConfiguration, plan_files::PlanFiles, staged,
};
use crate::types::{Command, FileProblem, PayloadInfo};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub(super) struct Prepared {
    pub mutation: Mutation,
    pub config: ConfigurationSnapshot,
    pub plan: Option<super::command_images::CommandImagePlan>,
    pub failure: Option<Failure>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ConfigurationSnapshot {
    plugin: Option<Vec<u8>>,
    portable: Option<Vec<u8>>,
    approve_standard: bool,
}
impl ConfigurationSnapshot {
    pub(super) fn resolve(&self) -> Result<TaskNotesConfiguration> {
        Ok(TaskNotesConfiguration::resolve(
            self.plugin.as_deref(),
            self.portable.as_deref(),
            self.approve_standard,
        )?)
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Code {
    Validation,
    Configuration,
    Conflict,
    Host,
    HostContract,
    Storage,
    NotFound,
    Closed,
    Busy,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct Failure {
    code: Code,
    message: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum OutcomeState {
    Staged,
    Pending,
    Applied,
    Failed,
    Cancelled,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OutcomeItem {
    kind: &'static str,
    successor_id: String,
    parent_path: String,
    occurrence_date: String,
    state: OutcomeState,
    failure: Option<Failure>,
}

fn outcome_state(state: &str, failure: Option<&Failure>) -> Result<OutcomeState> {
    let state: OutcomeState = serde_json::from_value(json!(state)).map_err(|_| corrupt())?;
    if matches!(state, OutcomeState::Failed) && failure.is_none()
        || matches!(state, OutcomeState::Applied | OutcomeState::Cancelled) && failure.is_some()
    {
        return Err(corrupt());
    }
    Ok(state)
}
impl Failure {
    fn from_error(error: &RuntimeError) -> Self {
        let code = match error {
            RuntimeError::Validation(_) => Code::Validation,
            RuntimeError::Configuration(_) => Code::Configuration,
            RuntimeError::Conflict => Code::Conflict,
            RuntimeError::Host(_) => Code::Host,
            RuntimeError::HostContract(_) => Code::HostContract,
            RuntimeError::Storage(_) => Code::Storage,
            RuntimeError::NotFound => Code::NotFound,
            RuntimeError::Closed => Code::Closed,
            RuntimeError::Busy => Code::Busy,
        };
        Self {
            code,
            message: error.to_string(),
        }
    }
}

fn corrupt() -> RuntimeError {
    RuntimeError::Storage("occurrence successor ownership is corrupt".into())
}

impl Engine {
    pub(super) fn successor_configuration_snapshot(
        &self,
        profile: &str,
        config: &TaskNotesConfiguration,
    ) -> Result<ConfigurationSnapshot> {
        let snapshot = ConfigurationSnapshot {
            plugin: self
                .files
                .read_file(profile, tasknotes_vault::config::PLUGIN_CONFIGURATION_PATH)?,
            portable: self.files.read_file(
                profile,
                tasknotes_vault::config::PORTABLE_CONFIGURATION_PATH,
            )?,
            approve_standard: self.profile(profile)?.approve_standard,
        };
        if serde_json::to_value(snapshot.resolve()?)? != serde_json::to_value(config)? {
            return Err(RuntimeError::Conflict);
        }
        Ok(snapshot)
    }
    pub(super) fn prepare_successors(
        &self,
        profile: &str,
        config: &TaskNotesConfiguration,
        primary: &Mutation,
        changed: &BTreeMap<String, Option<PayloadInfo>>,
        mutations: Vec<Mutation>,
    ) -> Result<Vec<Prepared>> {
        if mutations.len() > 1000 {
            return Err(RuntimeError::Validation(
                "one mutation cannot schedule more than 1,000 occurrence successors".into(),
            ));
        }
        let mut changed = changed.clone();
        let mut seen = BTreeSet::new();
        let mut prepared = Vec::new();
        let snapshot = if mutations.is_empty() {
            None
        } else {
            Some(self.successor_configuration_snapshot(profile, config)?)
        };
        for mut mutation in mutations {
            let Command::MaterializeOccurrence {
                parent_path,
                expected_parent_revision,
                occurrence_date,
                ..
            } = &mut mutation.command
            else {
                return Err(corrupt());
            };
            if !seen.insert((parent_path.clone(), occurrence_date.clone())) {
                continue;
            }
            if let Some(image) = changed.get(parent_path) {
                expected_parent_revision.clone_from(&image.as_ref().ok_or_else(corrupt)?.revision);
            }
            mutation.mutation_id = format!(
                "occnext:{}",
                hex::encode(Sha256::digest(serde_json::to_vec(&(
                    profile,
                    &primary.mutation_id,
                    parent_path,
                    occurrence_date
                ))?))
            );
            // Snapshot creation output now, including template/default policy.
            // Replaying the stored plan never re-reads a modified template.
            let view = PlanFiles::new(self, profile, &changed);
            let planned = (|| {
                let plan = crate::commands::occurrences::plan(&view, profile, config, &mutation)?;
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
                Ok::<_, RuntimeError>(super::command_images::CommandImagePlan {
                    writes,
                    diagnostics: plan.diagnostics,
                    title_changes,
                    occurrence_reads: Some(plan.reads),
                    occurrence_window: None,
                    transitions: Vec::new(),
                    successors: Vec::new(),
                    progressions: Vec::new(),
                    progression_effects: Vec::new(),
                })
            })();
            let (plan, failure) = match planned {
                Ok(plan) => {
                    for write in &plan.writes {
                        changed.insert(write.path.clone(), write.after.clone());
                    }
                    (Some(plan), None)
                }
                Err(error) => (None, Some(Failure::from_error(&error))),
            };
            prepared.push(Prepared {
                mutation,
                config: snapshot.as_ref().ok_or_else(corrupt)?.clone(),
                plan,
                failure,
            });
        }
        Ok(prepared)
    }

    pub(super) fn recover_successors(&self, profile: &str) -> Result<()> {
        self.recover_successors_before_undo(profile, None)
    }

    pub(super) fn recover_successors_before_undo(
        &self,
        profile: &str,
        undo_primary: Option<&str>,
    ) -> Result<()> {
        // A pending grouped Undo takes precedence over an unstarted followup.
        // Before its journal exists, the incoming Undo suppresses only its own
        // unstarted intent. Already staged/exchanged successors must recover so
        // grouped ownership can be checked; cancellation is committed with Undo.
        let rows=self.database(|db| {
            let mut query=db.prepare("SELECT s.id,s.configuration FROM occurrence_successors s WHERE s.profile=?1 AND s.state='pending' AND NOT (s.primary_id=coalesce(?2,'') AND NOT EXISTS(SELECT 1 FROM journal_stages t WHERE t.profile=s.profile AND t.id=s.id)) AND NOT EXISTS(SELECT 1 FROM journals u WHERE u.profile=s.profile AND json_valid(u.fingerprint) AND json_extract(u.fingerprint,'$.command.kind')='undo' AND json_extract(u.fingerprint,'$.command.receiptId')=s.primary_id AND u.receipt IS NULL) ORDER BY s.rowid")?;
            Ok(query.query_map(params![profile,undo_primary],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?)
        })?;
        for (id, configuration) in rows {
            let snapshot: ConfigurationSnapshot =
                serde_json::from_str(&configuration).map_err(|_| corrupt())?;
            snapshot.resolve().map_err(|_| corrupt())?;
            // Immutable bytes retain the original creation semantics; indexing
            // and profile metadata must still use the current collection mapping.
            let result = self
                .configuration(&self.profile(profile)?)
                .and_then(|config| self.finish_staged_journal(profile, &id, Some(&config), false));
            if let Err(error) = result {
                let terminal = matches!(
                    error,
                    RuntimeError::Conflict
                        | RuntimeError::Validation(_)
                        | RuntimeError::Configuration(_)
                        | RuntimeError::NotFound
                        | RuntimeError::HostContract(_)
                        | RuntimeError::Storage(_)
                );
                self.database(|db| {
                    let tx=db.transaction()?;
                    let changed=tx.execute("UPDATE occurrence_successors SET state=CASE WHEN ?3 THEN 'failed' ELSE 'pending' END,failure=?4 WHERE profile=?1 AND id=?2 AND state='pending' AND (state!=CASE WHEN ?3 THEN 'failed' ELSE 'pending' END OR failure IS NOT ?4)",params![profile,id,terminal,serde_json::to_string(&Failure::from_error(&error))?])?;
                    if changed!=0 {tx.execute("UPDATE profiles SET version=version+1 WHERE id=?",[profile])?;}
                    tx.commit()?;
                    Ok(())
                })?;
            }
        }
        Ok(())
    }

    pub(super) fn successor_outcome(&self, profile: &str, primary: &str) -> Result<Value> {
        super::validate_identity(primary)?;
        self.database(|db| {
            let mut query=db.prepare("SELECT id,intent,state,failure FROM occurrence_successors WHERE profile=? AND primary_id=? ORDER BY rowid")?;
            let rows=query.query_map(params![profile,primary],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,String>(2)?,row.get::<_,Option<String>>(3)?)))?;
            let mut items=Vec::new();
            for row in rows {
                let (id,intent,state,failure)=row?;
                items.push(render_outcome(&id,&intent,&state,failure.as_deref())?);
            }
            items.extend(super::deferred_progressions::outcomes(db,profile,primary)?);
            if items.len()>1000 {return Err(corrupt());}
            Ok(json!({"schemaVersion":1,"mutationId":primary,"items":items}))
        })
    }
}

pub(super) fn render_outcome(
    id: &str,
    intent: &str,
    state: &str,
    failure: Option<&str>,
) -> Result<Value> {
    let mutation: Mutation = serde_json::from_str(intent).map_err(|_| corrupt())?;
    let Command::MaterializeOccurrence {
        parent_path,
        occurrence_date,
        ..
    } = mutation.command
    else {
        return Err(corrupt());
    };
    let failure = failure
        .map(serde_json::from_str::<Failure>)
        .transpose()
        .map_err(|_| corrupt())?;
    let state = outcome_state(state, failure.as_ref())?;
    Ok(serde_json::to_value(OutcomeItem {
        kind: "materialize_occurrence",
        successor_id: id.into(),
        parent_path,
        occurrence_date,
        state,
        failure,
    })?)
}

pub(super) fn store(
    db: &Connection,
    profile: &str,
    primary: &str,
    prepared: &[Prepared],
) -> Result<()> {
    for item in prepared {
        let id = &item.mutation.mutation_id;
        let intent = serde_json::to_string(&item.mutation)?;
        if let Some(plan) = &item.plan {
            db.execute("INSERT INTO journals(profile,id,fingerprint,writes,diagnostics,title_plans) VALUES(?,?,?,'[]',?,?)",params![profile,id,intent,serde_json::to_string(&plan.diagnostics)?,serde_json::to_string(&plan.title_changes)?])?;
            staged::store_files(db, profile, id, &plan.writes)?;
            let reads = plan.occurrence_reads.as_ref().ok_or_else(corrupt)?;
            db.execute(
                "INSERT INTO occurrence_plans(profile,id,json) VALUES(?,?,?)",
                params![profile, id, serde_json::to_string(reads)?],
            )?;
        }
        db.execute("INSERT INTO occurrence_successors(profile,id,primary_id,intent,configuration,state,failure) VALUES(?,?,?,?,?,'staged',?)",params![profile,id,primary,intent,serde_json::to_string(&item.config)?,item.failure.as_ref().map(serde_json::to_string).transpose()?])?;
    }
    Ok(())
}

pub(super) fn undo_journals(db: &Connection, profile: &str, primary: &str) -> Result<Vec<String>> {
    let mut query=db.prepare("SELECT s.id,j.receipt,(SELECT count(*) FROM journal_stages t WHERE t.profile=s.profile AND t.id=s.id) FROM occurrence_successors s LEFT JOIN journals j ON j.profile=s.profile AND j.id=s.id WHERE s.profile=? AND s.primary_id=? ORDER BY s.rowid")?;
    let rows = query.query_map(params![profile, primary], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, i64>(2)?,
        ))
    })?;
    let mut ids = Vec::new();
    for row in rows {
        let (id, receipt, stages) = row?;
        if let Some(receipt) = receipt {
            let receipt = super::checked_stored_receipt(db, profile, &id, &receipt)?;
            if receipt.applied {
                ids.push(id);
            } else if stages != 0 {
                return Err(RuntimeError::Conflict);
            }
        } else if stages != 0 {
            return Err(RuntimeError::Conflict);
        }
    }
    Ok(ids)
}

pub(super) fn committed(
    db: &Connection,
    profile: &str,
    id: &str,
    mutation: Option<&Mutation>,
) -> Result<()> {
    db.execute("UPDATE occurrence_successors SET state=CASE WHEN failure IS NULL THEN 'pending' ELSE 'failed' END WHERE profile=? AND primary_id=? AND state='staged'",params![profile,id])?;
    db.execute("UPDATE occurrence_successors SET state='applied',failure=NULL WHERE profile=? AND id=? AND state='pending'",params![profile,id])?;
    if let Some(Mutation {
        command: Command::Undo { receipt_id },
        ..
    }) = mutation
    {
        db.execute("UPDATE occurrence_successors SET state='cancelled',failure=NULL WHERE profile=? AND primary_id=?",params![profile,receipt_id])?;
    }
    Ok(())
}

pub(super) fn problems(
    db: &Connection,
    profile: &str,
    occurrences: &super::occurrence_relations::Index,
) -> Result<Vec<FileProblem>> {
    let mut query=db.prepare("SELECT intent,state,failure FROM occurrence_successors WHERE profile=? AND state IN ('pending','failed') ORDER BY rowid")?;
    let rows = query.query_map([profile], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    rows.map(|row| {
        let (intent,state,failure)=row?;
        let mutation:Mutation=serde_json::from_str(&intent).map_err(|_|corrupt())?;
        let Command::MaterializeOccurrence {parent_path,occurrence_date,..}=mutation.command else {return Err(corrupt())};
        let failure=failure.map(|value|serde_json::from_str::<Failure>(&value)).transpose().map_err(|_|corrupt())?;
        if occurrences.unique(&parent_path,&occurrence_date) {return Ok(None);}
        Ok(Some(FileProblem {path:parent_path,message:format!("Next occurrence {occurrence_date} is {state}. {} Primary completion was preserved. Reload to retry pending work, or explicitly materialize this date after resolving the reported problem.",failure.map_or_else(||"Creation is queued.".into(),|failure|failure.message))}))
    }).collect::<Result<Vec<_>>>().map(|problems|problems.into_iter().flatten().collect())
}

pub(super) fn validate_database(db: &Connection) -> Result<()> {
    let mut query=db.prepare("SELECT s.id,s.primary_id,s.intent,s.configuration,s.state,s.failure,j.fingerprint,j.receipt,p.receipt,s.profile FROM occurrence_successors s LEFT JOIN journals j ON j.profile=s.profile AND j.id=s.id JOIN journals p ON p.profile=s.profile AND p.id=s.primary_id")?;
    let rows = query.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
            row.get::<_, String>(9)?,
        ))
    })?;
    for row in rows {
        let (
            id,
            primary,
            intent,
            configuration,
            state,
            failure,
            fingerprint,
            receipt,
            primary_receipt,
            profile,
        ) = row?;
        let mutation: Mutation = serde_json::from_str(&intent).map_err(|_| corrupt())?;
        mutation
            .command
            .validate_contract()
            .map_err(|_| corrupt())?;
        let Command::MaterializeOccurrence {
            parent_path,
            occurrence_date,
            ..
        } = &mutation.command
        else {
            return Err(corrupt());
        };
        let expected_id = format!(
            "occnext:{}",
            hex::encode(Sha256::digest(serde_json::to_vec(&(
                &profile,
                &primary,
                parent_path,
                occurrence_date
            ))?))
        );
        if mutation.mutation_id != id
            || id != expected_id
            || id == primary
            || fingerprint
                .as_ref()
                .is_some_and(|fingerprint| fingerprint != &intent)
        {
            return Err(corrupt());
        }
        let snapshot: ConfigurationSnapshot =
            serde_json::from_str(&configuration).map_err(|_| corrupt())?;
        snapshot.resolve().map_err(|_| corrupt())?;
        let _: Option<Failure> = failure
            .as_deref()
            .map(serde_json::from_str)
            .transpose()
            .map_err(|_| corrupt())?;
        if !matches!(
            state.as_str(),
            "staged" | "pending" | "failed" | "applied" | "cancelled"
        ) || (state == "pending" && (fingerprint.is_none() || receipt.is_some()))
            || (state == "applied" && receipt.is_none())
            || ((state == "staged") != primary_receipt.is_none())
            || (fingerprint.is_none() && failure.is_none() && state != "cancelled")
            || (state == "failed" && failure.is_none())
            || (matches!(state.as_str(), "applied" | "cancelled") && failure.is_some())
        {
            return Err(corrupt());
        }
        if let Some(receipt) = receipt {
            let receipt = super::checked_stored_receipt(db, &profile, &id, &receipt)?;
            if state == "applied" && !receipt.applied {
                return Err(corrupt());
            }
        }
        if let Some(primary_receipt) = primary_receipt {
            let receipt = super::checked_stored_receipt(db, &profile, &primary, &primary_receipt)?;
            if state != "cancelled" && !receipt.applied {
                return Err(corrupt());
            }
        }
    }
    Ok(())
}
