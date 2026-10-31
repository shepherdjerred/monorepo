//! Cached, bounded eligibility pages; never recovery, provider I/O or writes.
use super::{Engine, Result, RuntimeError};
use crate::features::RollingCursor;
use rusqlite::params;
use serde::Serialize;
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use tasknotes_vault::{path::VaultPath, temporal};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Target {
    parent_path: String,
    expected_parent_revision: String,
    reference_date: String,
    start: String,
    end: String,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum ProblemCode {
    CachedTaskProblem,
    InvalidOccurrenceIdentity,
    InvalidOccurrencePolicy,
    InvalidRecurrenceRule,
    InvalidRecurrenceAnchor,
    InvalidRecurrenceStart,
    MissingRecurrenceSeed,
    MaterializationRequiresValidSeededParent,
    InvalidOccurrenceHorizon,
    NegativeOccurrenceHorizon,
    OccurrenceWindowOverflow,
    OccurrenceWindowResourceLimit,
}

impl ProblemCode {
    fn from_error(error: RuntimeError) -> Result<Self> {
        if let RuntimeError::Validation(code) = &error {
            return Ok(match code.as_str() {
                "invalid_occurrence_identity" => Self::InvalidOccurrenceIdentity,
                "invalid_occurrence_policy" => Self::InvalidOccurrencePolicy,
                "invalid_recurrence_rule" => Self::InvalidRecurrenceRule,
                "invalid_recurrence_anchor" => Self::InvalidRecurrenceAnchor,
                "invalid_recurrence_start" => Self::InvalidRecurrenceStart,
                "missing_recurrence_seed" => Self::MissingRecurrenceSeed,
                "materialization_requires_valid_seeded_parent" => {
                    Self::MaterializationRequiresValidSeededParent
                }
                "invalid_occurrence_horizon" => Self::InvalidOccurrenceHorizon,
                "negative_occurrence_horizon" => Self::NegativeOccurrenceHorizon,
                "occurrence_window_overflow" => Self::OccurrenceWindowOverflow,
                "occurrence_window_resource_limit" => Self::OccurrenceWindowResourceLimit,
                _ => return Err(error),
            });
        }
        Err(error)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Problem {
    task_path: String,
    code: ProblemCode,
}

fn cursor_binding(
    profile: &str,
    reference: &str,
    version: u64,
    configuration: &str,
    last: &str,
) -> Result<String> {
    Ok(hex::encode(Sha256::digest(serde_json::to_vec(&(
        1,
        profile,
        reference,
        version,
        hex::encode(Sha256::digest(configuration.as_bytes())),
        last,
    ))?)))
}

fn valid_revision(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

impl Engine {
    pub(super) fn rolling_maintenance_plan(
        &self,
        profile: &str,
        reference: &str,
        limit: Option<u32>,
        after: Option<&RollingCursor>,
        expected_version: Option<u64>,
    ) -> Result<Value> {
        let day = temporal::parse_day(reference)?;
        let limit = limit.unwrap_or(128);
        if !(1..=256).contains(&limit) {
            return Err(RuntimeError::Validation(
                "rolling maintenance page limit must be1..256".into(),
            ));
        }
        if let Some(cursor) = after {
            VaultPath::parse(&cursor.last_path)?;
            temporal::parse_day(&cursor.reference_date)?;
            if !valid_revision(&cursor.binding)
                || cursor.reference_date != reference
                || expected_version != Some(cursor.version)
            {
                return Err(RuntimeError::Validation(
                    "invalid_rolling_maintenance_cursor".into(),
                ));
            }
        }
        self.database(|db| {
            let tx=db.unchecked_transaction()?;
            let (raw_version, configuration):(i64,Option<String>)=tx.query_row("SELECT version,configuration FROM profiles WHERE id=?",[profile],|row|Ok((row.get(0)?,row.get(1)?)))?;
            let version=u64::try_from(raw_version).map_err(|_|RuntimeError::Storage("invalid state version".into()))?;
            if expected_version.is_some_and(|expected| expected!=version) {return Err(RuntimeError::Conflict);}
            let configuration=configuration.ok_or_else(||RuntimeError::Configuration("rolling maintenance waits for TaskNotes configuration".into()))?;
            let config:Value=serde_json::from_str(&configuration)?;
            let effective=config.get("effective").filter(|value|value.is_object()).ok_or_else(||RuntimeError::Storage("cached configuration is corrupt".into()))?;
            if let Some(cursor)=after {
                if cursor.binding!=cursor_binding(profile,reference,version,&configuration,&cursor.last_path)? {return Err(RuntimeError::Validation("invalid_rolling_maintenance_cursor".into()));}
                let exists:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM files WHERE profile=? AND path=? AND (task IS NOT NULL OR problem IS NOT NULL))",params![profile,cursor.last_path],|row|row.get(0))?;
                if !exists {return Err(RuntimeError::Validation("invalid_rolling_maintenance_cursor".into()));}
            }
            // The extra row is only a path lookahead; inspect metadata for at
            // most limit rows, including excluded tasks and cached problems.
            let mut keys=tx.prepare("SELECT path FROM files WHERE profile=? AND (task IS NOT NULL OR problem IS NOT NULL) AND path COLLATE BINARY > ? ORDER BY path COLLATE BINARY LIMIT ?")?;
            let mut paths=keys.query_map(params![profile,after.map_or("",|cursor|cursor.last_path.as_str()),i64::from(limit)+1],|row|row.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
            let more=paths.len()>usize::try_from(limit).map_err(|_|RuntimeError::Validation("invalid rolling page limit".into()))?;
            if more {paths.pop();}
            drop(keys);
            let mut targets=Vec::new();let mut problems=Vec::new();
            let mut rows=tx.prepare("SELECT json_extract(task,'$.revision'),(SELECT json_group_object(key,value) FROM json_each(task,'$.properties') WHERE key IN ('recurrence','recurrenceAnchor','scheduled','dateCreated','recurrenceParent','occurrenceDate','occurrenceMaterialization','occurrenceNextTrigger','occurrencePastHorizon','occurrenceFutureHorizon','occurrenceTemplate')),problem IS NOT NULL,task IS NULL FROM files WHERE profile=? AND path=?")?;
            for path in &paths {
                VaultPath::parse(path)?;
                let (revision, raw, has_problem, missing_task):(Option<String>,String,bool,bool)=rows.query_row(params![profile,path],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)))?;
                if missing_task {
                    if !has_problem {return Err(RuntimeError::Storage("cached maintenance task is missing".into()));}
                    problems.push(Problem{task_path:path.clone(),code:ProblemCode::CachedTaskProblem});continue;
                }
                let revision=revision.filter(|value|valid_revision(value)).ok_or_else(||RuntimeError::Storage("cached task revision is corrupt".into()))?;
                let properties:Map<String,Value>=serde_json::from_str(&raw)?;
                match crate::commands::occurrence_windows::eligible_bounds(effective,&properties,day) {
                    Ok(Some(window))=>targets.push(Target{parent_path:path.clone(),expected_parent_revision:revision,reference_date:reference.into(),start:window.start().to_string(),end:window.end().to_string()}),
                    Ok(None)=>{},
                    Err(error)=>problems.push(Problem{task_path:path.clone(),code:ProblemCode::from_error(error)?}),
                }
            }
            drop(rows);
            let cursor=if more {let last=paths.last().ok_or_else(||RuntimeError::Storage("rolling cursor has no inspected row".into()))?;Some(RollingCursor{last_path:last.clone(),reference_date:reference.into(),version,binding:cursor_binding(profile,reference,version,&configuration,last)?})}else{None};
            Ok(json!({"schemaVersion":1,"profileId":profile,"version":version,"referenceDate":reference,"inspectedCount":paths.len(),"targets":targets,"problems":problems,"nextCursor":cursor}))
        })
    }
}
