//! Canonical occurrence relations from durable metadata; no provider I/O.
use super::{FileProblem, Result};
use crate::types::TaskSnapshot;
use rusqlite::Connection;
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};
use tasknotes_vault::links;

struct Task {
    path: String,
    id: Option<String>,
    status: String,
    completed: bool,
    properties: Map<String, Value>,
}
impl Task {
    fn valid_parent_for(&self, child: &str) -> bool {
        self.path != child && !self.properties.contains_key("recurrenceParent")
    }
    fn is_recurring(&self) -> bool {
        self.properties
            .get("recurrence")
            .and_then(Value::as_str)
            .is_some_and(|rule| {
                tasknotes_core::recurrence::Recurrence::parse(
                    rule,
                    self.properties.get("scheduled").and_then(Value::as_str),
                    self.properties.get("dateCreated").and_then(Value::as_str),
                )
                .is_expandable()
            })
    }
}
#[derive(Default)]
pub(crate) struct Index {
    pairs: BTreeMap<(String, String), Vec<String>>,
    child_days: BTreeMap<String, String>,
    skipped: BTreeSet<String>,
    completed: BTreeSet<String>,
    invalid: BTreeSet<String>,
    pub problems: Vec<FileProblem>,
}
impl Index {
    pub fn read(db: &Connection, profile: &str, configuration: &Value) -> Result<Self> {
        let tasks = read_tasks(db, profile)?;
        let candidates = tasks.iter().map(|t| t.path.clone()).collect::<Vec<_>>();
        let ids = tasks
            .iter()
            .filter_map(|t| t.id.as_ref().map(|id| (t.path.clone(), id.clone())))
            .collect::<BTreeMap<_, _>>();
        let by_path = tasks
            .iter()
            .map(|t| (t.path.as_str(), t))
            .collect::<BTreeMap<_, _>>();
        let skipped = configuration
            .pointer("/effective/status/skipped_values")
            .and_then(Value::as_array);
        let mut index = Self::default();
        for task in &tasks {
            let (raw, day) = match crate::commands::occurrences::identity(&task.properties) {
                Ok(Some(pair)) => pair,
                Ok(None) => continue,
                Err(_) => {
                    index.problem(&task.path, "invalid_occurrence_identity");
                    continue;
                }
            };
            index.child_days.insert(task.path.clone(), day.to_owned());
            if task.completed {
                index.completed.insert(task.path.clone());
            }
            let is_skipped = skipped.is_some_and(|values| {
                values
                    .iter()
                    .any(|value| value.as_str() == Some(task.status.as_str()))
            });
            if is_skipped {
                index.skipped.insert(task.path.clone());
            }
            let resolved = links::resolve(
                &json!({"raw":raw,"sourcePath":task.path,"candidates":candidates,"idIndex":ids}),
            );
            let Some(parent) = resolved
                .ok()
                .and_then(|path| by_path.get(path.as_str()).copied())
            else {
                index.problem(&task.path, "invalid_recurrence_parent");
                continue;
            };
            if !parent.valid_parent_for(&task.path) {
                index.problem(&task.path, "invalid_recurrence_parent");
                continue;
            }
            if !parent.is_recurring() {
                index.problem(&task.path, "invalid_recurrence_parent");
            }
            let pair = (parent.path.clone(), day.to_owned());
            index.pairs.entry(pair).or_default().push(task.path.clone());
            let listed = |key| {
                parent
                    .properties
                    .get(key)
                    .and_then(Value::as_array)
                    .is_some_and(|values| values.iter().any(|v| v.as_str() == Some(day)))
            };
            if listed("completeInstances") != task.completed
                || listed("skippedInstances") != is_skipped
            {
                index.problems.push(FileProblem {
                    path: task.path.clone(),
                    message: "occurrence_state_conflict".into(),
                });
            }
        }
        let duplicates = index
            .pairs
            .values()
            .filter(|paths| paths.len() > 1)
            .flatten()
            .cloned()
            .collect::<Vec<_>>();
        for path in duplicates {
            index.problem(&path, "duplicate_occurrence_note");
        }
        Ok(index)
    }
    fn problem(&mut self, path: &str, code: &str) {
        if matches!(
            code,
            "duplicate_occurrence_note" | "invalid_occurrence_identity"
        ) {
            self.invalid.insert(path.into());
        }
        self.problems.push(FileProblem {
            path: path.into(),
            message: code.into(),
        });
    }
    pub fn covers(&self, parent: &str, day: &str) -> bool {
        self.pairs.contains_key(&(parent.into(), day.into()))
    }
    pub fn unique(&self, parent: &str, day: &str) -> bool {
        self.pairs
            .get(&(parent.into(), day.into()))
            .is_some_and(|paths| paths.len() == 1)
    }
    pub fn unique_child(&self, parent: &str, day: &str) -> Option<&str> {
        self.pairs
            .get(&(parent.into(), day.into()))
            .filter(|paths| paths.len() == 1)
            .and_then(|paths| paths.first())
            .map(String::as_str)
    }
    pub fn ambiguous(&self, parent: &str, day: &str) -> bool {
        self.pairs
            .get(&(parent.into(), day.into()))
            .is_some_and(|paths| paths.len() > 1)
    }
    pub fn matches_state(
        &self,
        path: &str,
        state: crate::commands::occurrence_transitions::State,
    ) -> bool {
        match state {
            crate::commands::occurrence_transitions::State::Completed => {
                self.completed.contains(path) && !self.skipped.contains(path)
            }
            crate::commands::occurrence_transitions::State::Skipped => {
                self.skipped.contains(path) && !self.completed.contains(path)
            }
            crate::commands::occurrence_transitions::State::Active => {
                !self.completed.contains(path) && !self.skipped.contains(path)
            }
        }
    }
    pub fn child_day(&self, path: &str) -> Option<&str> {
        self.child_days.get(path).map(String::as_str)
    }
    pub fn blocks_reminders(&self, path: &str) -> bool {
        self.invalid.contains(path) || self.skipped.contains(path)
    }
    pub fn skips_scope(&self, task: &TaskSnapshot, scope: &str) -> bool {
        self.skipped.contains(&task.path)
            && matches!(scope, "today" | "agenda" | "upcoming" | "overdue")
    }
}

fn read_tasks(db: &Connection, profile: &str) -> Result<Vec<Task>> {
    let mut query=db.prepare("SELECT path,json_extract(task,'$.properties.id'),json_extract(task,'$.status'),json_extract(task,'$.completed'),json_object('recurrenceParent',json(task->'$.properties.recurrenceParent'),'occurrenceDate',json(task->'$.properties.occurrenceDate'),'recurrence',json(task->'$.properties.recurrence'),'scheduled',json(task->'$.properties.scheduled'),'dateCreated',json(task->'$.properties.dateCreated'),'completeInstances',json(task->'$.properties.completeInstances'),'skippedInstances',json(task->'$.properties.skippedInstances')) FROM files WHERE profile=? AND task IS NOT NULL ORDER BY path")?;
    let rows = query.query_map([profile], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, bool>(3)?,
            r.get::<_, String>(4)?,
        ))
    })?;
    let mut tasks = Vec::new();
    for row in rows {
        let (path, id, status, completed, raw) = row?;
        let mut properties: Map<String, Value> = serde_json::from_str(&raw)?;
        properties.retain(|_, value| !value.is_null());
        tasks.push(Task {
            path,
            id,
            status,
            completed,
            properties,
        });
    }
    Ok(tasks)
}
