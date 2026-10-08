//! Bounded tracking projections from the durable metadata index, without provider I/O.

use super::{Engine, Result, RuntimeError};
use chrono::{DateTime, SecondsFormat, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tasknotes_vault::{path::VaultPath, temporal};

fn canonical(at: DateTime<Utc>) -> String {
    at.to_rfc3339_opts(SecondsFormat::AutoSi, true)
}

fn limit(value: Option<u32>, has_cursor: bool, expected_version: Option<u64>) -> Result<usize> {
    let value = value.unwrap_or(128);
    if !(1..=128).contains(&value) || (has_cursor && expected_version.is_none()) {
        return Err(RuntimeError::Validation(
            "tracking limit must be1..128 and cursors require expectedVersion".to_owned(),
        ));
    }
    usize::try_from(value)
        .map_err(|_| RuntimeError::Validation("invalid tracking limit".to_owned()))
}

fn version(db: &Connection, profile: &str, expected: Option<u64>) -> Result<u64> {
    let value: i64 = db.query_row(
        "SELECT version FROM profiles WHERE id=?",
        [profile],
        |row| row.get(0),
    )?;
    let value = u64::try_from(value)
        .map_err(|_| RuntimeError::Storage("invalid state version".to_owned()))?;
    if expected.is_some_and(|expected| expected != value) {
        return Err(RuntimeError::Conflict);
    }
    Ok(value)
}

fn elapsed(start: DateTime<Utc>, end: DateTime<Utc>) -> Result<u64> {
    u64::try_from(end.signed_duration_since(start).num_seconds().max(0))
        .map_err(|_| RuntimeError::Validation("tracking elapsed time overflow".to_owned()))
}

fn entries(raw: Option<String>) -> Result<Option<Vec<Value>>> {
    let value = raw
        .map(|raw| serde_json::from_str::<Value>(&raw))
        .transpose()?
        .unwrap_or_else(|| json!([]));
    match tasknotes_vault::tracking::normalize(&value) {
        Ok(entries) => Ok(Some(entries)),
        Err(tasknotes_vault::VaultError::Document(_)) => Ok(None),
        Err(other) => Err(other.into()),
    }
}

struct Problems {
    count: u64,
    rows: Vec<Value>,
}
impl Problems {
    fn add(&mut self, path: &str, code: &str) {
        self.count += 1;
        if self.rows.len() < 128 {
            self.rows.push(json!({"taskPath":path,"code":code}));
        }
    }
}

impl Engine {
    pub(super) fn tracking_sessions(
        &self,
        profile: &str,
        at: &str,
        page_limit: Option<u32>,
        after: Option<&crate::features::TrackingCursor>,
        expected: Option<u64>,
    ) -> Result<Value> {
        let now = temporal::parse_instant(at)?;
        let at = canonical(now);
        let limit = limit(page_limit, after.is_some(), expected)?;
        if let Some(cursor) = after {
            VaultPath::parse(&cursor.task_path)?;
            if temporal::parse_instant(&cursor.at)? != now {
                return Err(RuntimeError::Validation(
                    "tracking cursor clock changed".to_owned(),
                ));
            }
        }
        self.database(|db| {
            let version = version(db, profile, expected)?;
            let mut statement = db.prepare("SELECT path,json_extract(task,'$.title'),json_extract(task,'$.revision'),task -> '$.properties.timeEntries',task -> '$.properties.projects' FROM files WHERE profile=? AND task IS NOT NULL ORDER BY path")?;
            let mut records = statement.query([profile])?;
            let mut rows = Vec::new();
            let mut total = 0_u64;
            let mut problems = Problems { count: 0, rows: Vec::new() };
            while let Some(record) = records.next()? {
                let path: String = record.get(0)?;
                let Some(entries) = entries(record.get(3)?)? else {
                    problems.add(&path, "invalid_time_entries"); continue;
                };
                let Some(active) = entries.iter().find(|entry| entry.get("endTime").is_none()) else { continue; };
                let raw: Option<String> = record.get(4)?;
                let labels = raw.map(|raw| serde_json::from_str::<Value>(&raw)).transpose()?.unwrap_or_else(|| json!([]));
                let Some(labels) = labels.as_array().filter(|labels| labels.iter().all(|label| label.as_str().is_some())) else {
                    problems.add(&path, "invalid_projects"); continue;
                };
                let started = active.get("startTime").and_then(Value::as_str).ok_or_else(|| RuntimeError::Storage("normalized tracking start is absent".to_owned()))?;
                let title: String = record.get(1)?;
                let revision: String = record.get(2)?;
                let identity = serde_json::to_vec(&(profile, &path, &revision, started))?;
                let session_id = format!("facet-tracking:{}", hex::encode(Sha256::digest(identity)));
                total += 1;
                if after.is_some_and(|after| path <= after.task_path) || rows.len() > limit { continue; }
                rows.push(json!({"sessionId":session_id,"taskPath":path,"title":title,"taskRevision":revision,"startedAt":started,"elapsedSeconds":elapsed(temporal::parse_instant(started)?,now)?,"state":"running","projectLabels":labels}));
            }
            let more = rows.len() > limit;
            if more { rows.pop(); }
            let cursor = if more { rows.last().map(|row| json!({"taskPath":row.get("taskPath"),"at":at})) } else { None };
            Ok(json!({"schemaVersion":1,"profileId":profile,"version":version,"at":at,"totalCount":total,"rows":rows,"nextCursor":cursor,"problemCount":problems.count,"problems":problems.rows}))
        })
    }

    pub(super) fn tracking_history(
        &self,
        profile: &str,
        path: &str,
        at: &str,
        page_limit: Option<u32>,
        after: Option<&crate::features::TrackingHistoryCursor>,
        expected: Option<u64>,
    ) -> Result<Value> {
        VaultPath::parse(path)?;
        let now = temporal::parse_instant(at)?;
        let at = canonical(now);
        let limit = limit(page_limit, after.is_some(), expected)?;
        if after
            .is_some_and(|cursor| temporal::parse_instant(&cursor.at).is_ok_and(|time| time != now))
        {
            return Err(RuntimeError::Validation(
                "tracking cursor clock changed".to_owned(),
            ));
        }
        if let Some(cursor) = after {
            temporal::parse_instant(&cursor.at)?;
        }
        self.database(|db| {
            let version = version(db, profile, expected)?;
            let task: Option<(String, Option<String>)> = db.query_row("SELECT json_extract(task,'$.revision'),task -> '$.properties.timeEntries' FROM files WHERE profile=? AND path=? AND task IS NOT NULL", params![profile,path], |row| Ok((row.get(0)?,row.get(1)?))).optional()?;
            let (revision, raw) = task.ok_or(RuntimeError::NotFound)?;
            let mut problems = Problems { count:0, rows:Vec::new() };
            let entries = if let Some(entries) = entries(raw)? { entries } else { problems.add(path,"invalid_time_entries");Vec::new() };
            let total = u64::try_from(entries.len()).map_err(|_| RuntimeError::Storage("tracking history count overflow".to_owned()))?;
            let mut rows = Vec::new();
            for (index, entry) in entries.iter().enumerate() {
                let index = u64::try_from(index).map_err(|_| RuntimeError::Storage("tracking history index overflow".to_owned()))?;
                if after.is_some_and(|cursor| index <= cursor.entry_index) || rows.len() > limit { continue; }
                let start = entry.get("startTime").and_then(Value::as_str).ok_or_else(|| RuntimeError::Storage("normalized tracking start is absent".to_owned()))?;
                let end = entry.get("endTime").and_then(Value::as_str);
                let effective_end = end.map(temporal::parse_instant).transpose()?.unwrap_or(now);
                rows.push(json!({"entryIndex":index,"startedAt":start,"endedAt":end,"elapsedSeconds":elapsed(temporal::parse_instant(start)?,effective_end)?,"state":if end.is_some(){"closed"}else{"running"}}));
            }
            let more = rows.len() > limit;
            if more { rows.pop(); }
            let cursor = if more { rows.last().map(|row| json!({"entryIndex":row.get("entryIndex"),"at":at})) } else { None };
            Ok(json!({"schemaVersion":1,"profileId":profile,"version":version,"at":at,"taskPath":path,"taskRevision":revision,"totalCount":total,"rows":rows,"nextCursor":cursor,"problemCount":problems.count,"problems":problems.rows}))
        })
    }
}
