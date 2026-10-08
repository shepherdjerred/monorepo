//! Bounded metadata-only reminder reads from the same durable index version.

use super::{Engine, Result, RuntimeError};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::BTreeSet;
use tasknotes_vault::{document::ContentRevision, reminder_schedule as schedule, temporal};

pub(super) struct Request<'a> {
    pub at: &'a str,
    pub timezone: &'a str,
    pub from: &'a str,
    pub to: &'a str,
    pub limit: Option<u32>,
    pub after: Option<&'a crate::features::ReminderCursor>,
    pub expected_version: Option<u64>,
}

struct Bounds {
    from: DateTime<Utc>,
    to: DateTime<Utc>,
    after: Option<(DateTime<Utc>, String, String)>,
    limit: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Row {
    notification_id: String,
    task_path: String,
    title: String,
    task_revision: String,
    reminder_id: String,
    fire_at: String,
    occurrence_date: Option<String>,
    description: Option<String>,
    #[serde(skip)]
    instant: DateTime<Utc>,
}

impl Row {
    fn key(&self) -> (DateTime<Utc>, &str, &str) {
        (self.instant, &self.reminder_id, &self.task_path)
    }
    fn cursor(&self) -> Value {
        json!({"fireAt":self.fire_at,"reminderId":self.reminder_id,"taskPath":self.task_path})
    }
}

struct Page {
    rows: Vec<Row>,
    total: u64,
    problems: Vec<Value>,
    problem_count: u64,
    bounds: Bounds,
}

impl Page {
    fn problem(&mut self, path: &str, id: Option<&str>, code: &str) {
        self.problem_count += 1;
        if self.problems.len() < 128 {
            self.problems
                .push(json!({"taskPath":path,"reminderId":id,"code":code}));
        }
    }
    fn insert(&mut self, row: Row) {
        if row.instant < self.bounds.from || row.instant >= self.bounds.to {
            return;
        }
        self.total += 1;
        if self
            .bounds
            .after
            .as_ref()
            .is_some_and(|(at, id, path)| row.key() <= (*at, id.as_str(), path.as_str()))
        {
            return;
        }
        let index = self.rows.partition_point(|other| other.key() < row.key());
        if index <= self.bounds.limit {
            self.rows.insert(index, row);
            if self.rows.len() > self.bounds.limit + 1 {
                self.rows.pop();
            }
        }
    }
    fn finish(mut self, profile: &str, version: u64) -> Value {
        let more = self.rows.len() > self.bounds.limit;
        if more {
            self.rows.pop();
        }
        let cursor = if more {
            self.rows.last().map(Row::cursor)
        } else {
            None
        };
        json!({"schemaVersion":1,"profileId":profile,"version":version,"totalCount":self.total,
            "rows":self.rows,"nextCursor":cursor,"problemCount":self.problem_count,"problems":self.problems})
    }
}

impl Request<'_> {
    fn bounds(&self) -> Result<Bounds> {
        let at = temporal::parse_instant(self.at)?;
        let from = temporal::parse_instant(self.from)?;
        let to = temporal::parse_instant(self.to)?;
        if from >= to || to.signed_duration_since(from) > chrono::Duration::days(366) {
            return Err(RuntimeError::Validation(
                "reminder window must be positive and at most366 days".to_owned(),
            ));
        }
        let limit = self.limit.unwrap_or(128);
        if !(1..=128).contains(&limit) {
            return Err(RuntimeError::Validation(
                "reminder page limit must be1..128".to_owned(),
            ));
        }
        if self.after.is_some() && self.expected_version.is_none() {
            return Err(RuntimeError::Validation(
                "reminder cursor requires expectedVersion".to_owned(),
            ));
        }
        let after = self
            .after
            .map(|cursor| {
                tasknotes_vault::path::VaultPath::parse(&cursor.task_path)?;
                if cursor.reminder_id.is_empty() {
                    return Err(RuntimeError::Validation(
                        "reminder cursor identity is empty".to_owned(),
                    ));
                }
                Ok((
                    temporal::parse_instant(&cursor.fire_at)?,
                    cursor.reminder_id.clone(),
                    cursor.task_path.clone(),
                ))
            })
            .transpose()?;
        Ok(Bounds {
            from: from.max(at),
            to,
            after,
            limit: usize::try_from(limit)
                .map_err(|_| RuntimeError::Validation("invalid reminder page limit".to_owned()))?,
        })
    }
}

impl Engine {
    pub(super) fn reminder_plan(&self, id: &str, request: &Request<'_>) -> Result<Value> {
        let bounds = request.bounds()?;
        schedule::timezone(request.timezone)?;
        self.database(|db|{
            let (version,configuration):(i64,Option<String>)=db.query_row("SELECT version,configuration FROM profiles WHERE id=?",[id],|row|Ok((row.get(0)?,row.get(1)?)))?;
            let version=u64::try_from(version).map_err(|_|RuntimeError::Storage("invalid state version".to_owned()))?;
            if request.expected_version.is_some_and(|expected|expected!=version) {return Err(RuntimeError::Conflict);}
            let config:Value=serde_json::from_str(configuration.as_deref().ok_or_else(||RuntimeError::Configuration("reminder delivery waits for TaskNotes configuration".to_owned()))?)?;
            let policy=config.pointer("/effective/reminders").unwrap_or(&Value::Null);
            let mut page=Page{rows:Vec::new(),total:0,problems:Vec::new(),problem_count:0,bounds};
            let mut statement=db.prepare("SELECT path,json_extract(task,'$.title'),json_extract(task,'$.revision'),json_extract(task,'$.completed'),task -> '$.properties.reminders',json_object('due',json(task -> '$.properties.due'),'scheduled',json(task -> '$.properties.scheduled'),'dateCreated',json(task -> '$.properties.dateCreated'),'recurrence',json(task -> '$.properties.recurrence'),'completeInstances',json(task -> '$.properties.completeInstances'),'skippedInstances',json(task -> '$.properties.skippedInstances'),'archiveTag',json(task -> '$.properties.archiveTag')) FROM files WHERE profile=? AND task IS NOT NULL ORDER BY path")?;
            let mut rows=statement.query([id])?;
            while let Some(row)=rows.next()? {
                let task=Task {path:row.get(0)?,title:row.get(1)?,revision:row.get(2)?,completed:row.get(3)?,properties:serde_json::from_str(&row.get::<_,String>(5)?)?};
                let entries:Option<String>=row.get(4)?;
                if let Some(entries)=entries {
                    let entries:Value=serde_json::from_str(&entries)?;
                    task.apply(id,&entries,policy,request.timezone,&mut page)?;
                }
            }
            Ok(page.finish(id,version))
        })
    }
}

struct Task {
    path: String,
    title: String,
    revision: String,
    completed: bool,
    properties: Map<String, Value>,
}

impl Task {
    fn apply(
        &self,
        profile: &str,
        entries: &Value,
        policy: &Value,
        zone: &str,
        page: &mut Page,
    ) -> Result<()> {
        // Explicit null, like an absent optional reminder list, has no entries.
        if entries.is_null() {
            return Ok(());
        }
        let Some(entries) = entries.as_array() else {
            page.problem(&self.path, None, "invalid_reminder_list");
            return Ok(());
        };
        let mut seen = BTreeSet::new();
        if entries
            .iter()
            .filter_map(|entry| entry.get("id").and_then(Value::as_str))
            .any(|id| !seen.insert(id))
        {
            page.problem(&self.path, None, "duplicate_reminder_id");
            return Ok(());
        }
        let zone = schedule::timezone(zone)?;
        for entry in entries {
            match schedule::project(entry, &self.properties, policy, zone, self.completed) {
                Ok(Some(fire)) => {
                    let fire_at = fire.at.to_rfc3339_opts(SecondsFormat::AutoSi, true);
                    let identity = serde_json::to_vec(&(
                        profile,
                        &self.path,
                        &fire.id,
                        &fire_at,
                        &fire.occurrence_date,
                    ))?;
                    let notification_id =
                        format!("facet:{}", ContentRevision::of(&identity).as_str());
                    page.insert(Row {
                        notification_id,
                        task_path: self.path.clone(),
                        title: self.title.clone(),
                        task_revision: self.revision.clone(),
                        reminder_id: fire.id,
                        fire_at,
                        occurrence_date: fire.occurrence_date,
                        description: fire.description,
                        instant: fire.at,
                    });
                }
                Ok(None) => {}
                Err(tasknotes_vault::VaultError::Document(code)) => {
                    page.problem(&self.path, entry.get("id").and_then(Value::as_str), &code);
                }
                Err(_) => page.problem(
                    &self.path,
                    entry.get("id").and_then(Value::as_str),
                    "invalid_reminder",
                ),
            }
        }
        Ok(())
    }
}
