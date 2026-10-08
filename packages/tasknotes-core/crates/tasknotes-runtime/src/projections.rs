//! Clock-explicit task projections shared by every native host.

use crate::{
    Result, RuntimeError,
    types::{Query, TaskSnapshot},
};
use chrono::NaiveDate;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use tasknotes_core::recurrence::{DateWindow, Recurrence};

/// Minimal vault index needed for normative reference resolution. Bodies and
/// arbitrary frontmatter never accumulate in this index.
pub(crate) struct Relations {
    pub tasks: BTreeMap<String, (Option<String>, bool, Value)>,
    pub missing_is_blocked: bool,
}

impl Relations {
    fn target(&self, source: &str, raw: &str) -> Option<String> {
        let candidates: Vec<_> = self.tasks.keys().collect();
        let ids: BTreeMap<_, _> = self
            .tasks
            .iter()
            .filter_map(|(path, (id, _, _))| id.as_ref().map(|id| (path, id)))
            .collect();
        // A canonical plain UID is a compatibility input; resolution still
        // uses the same scoped ID-first ambiguity rules as wikilinks.
        let raw = if tasknotes_vault::links::parse(raw).is_ok() {
            raw.to_owned()
        } else {
            format!("[[{raw}]]")
        };
        tasknotes_vault::links::resolve(
            &json!({"raw":raw,"sourcePath":source,"candidates":candidates,"idIndex":ids}),
        )
        .ok()
    }

    pub(crate) fn apply(&self, task: &mut TaskSnapshot) {
        task.is_blocked = self.tasks.get(&task.path).is_some_and(|(_, _, deps)| {
            deps.as_array().is_some_and(|deps| {
                deps.iter().any(|dep| {
                    dep.get("uid").and_then(Value::as_str).is_some_and(|uid| {
                        self.target(&task.path, uid)
                            .and_then(|target| self.tasks.get(&target))
                            .map_or(self.missing_is_blocked, |(_, completed, _)| !completed)
                    })
                })
            })
        });
        task.is_blocking = self
            .tasks
            .get(&task.path)
            .is_some_and(|(_, completed, _)| !completed)
            && self.tasks.iter().any(|(source, (_, _, deps))| {
                deps.as_array().is_some_and(|deps| {
                    deps.iter().any(|dep| {
                        dep.get("uid").and_then(Value::as_str).is_some_and(|uid| {
                            self.target(source, uid).as_deref() == Some(task.path.as_str())
                        })
                    })
                })
            });
    }
}

pub(crate) fn local(task: &mut TaskSnapshot, query: &Query) -> Result<()> {
    task.occurrence_date = None;
    let text = task
        .properties
        .get("recurrence")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let recurrence = Recurrence::parse(
        text,
        task.properties.get("scheduled").and_then(Value::as_str),
        task.properties.get("dateCreated").and_then(Value::as_str),
    );
    task.is_recurring = !text.trim().is_empty() && recurrence.frequency().is_some();
    task.effective_date =
        day(task.properties.get("due")).or_else(|| day(task.properties.get("scheduled")));
    if task.is_recurring
        && let Some(today) = query.today.as_deref()
    {
        let today = tasknotes_vault::temporal::parse_day(today)?;
        let end = if query.scope.as_deref() == Some("upcoming") {
            today
                .checked_add_days(chrono::Days::new(u64::from(
                    query.upcoming_days.unwrap_or(7),
                )))
                .ok_or_else(|| RuntimeError::Validation("query date range overflow".to_owned()))?
        } else {
            today
        };
        let skipped = instance_days(task, "skippedInstances")?;
        let complete = instance_days(task, "completeInstances")?;
        let start = if query.scope.as_deref() == Some("upcoming") {
            today
                .succ_opt()
                .ok_or_else(|| RuntimeError::Validation("query date range overflow".to_owned()))?
        } else {
            today
        };
        if start <= end
            && let Some(occurrence) = recurrence
                .occurrences(DateWindow::new(start, end).map_err(|_| {
                    RuntimeError::Validation("invalid recurrence query range".to_owned())
                })?)
                .into_iter()
                .find(|date| !skipped.contains(date))
        {
            task.occurrence_date = Some(occurrence.to_string());
            task.effective_date = task.occurrence_date.clone();
            task.completed = complete.contains(&occurrence);
        }
    }
    let entries = tasknotes_vault::tracking::normalize(
        task.properties.get("timeEntries").unwrap_or(&json!([])),
    )?;
    task.has_active_time_session = entries.iter().any(|entry| entry.get("endTime").is_none());
    // A fixed epoch is an arithmetic argument only for closed entries, whose
    // elapsed result is independent of it. Open entries are excluded explicitly.
    let now = query
        .at
        .as_deref()
        .map(tasknotes_vault::temporal::parse_instant)
        .transpose()?;
    let closed: Vec<_> = entries
        .iter()
        .filter(|entry| entry.get("endTime").is_some())
        .cloned()
        .collect();
    task.total_tracked_minutes = if let Some(now) = now {
        tasknotes_vault::tracking::totals(&entries, now)?.1
    } else {
        tasknotes_vault::tracking::totals(&closed, chrono::DateTime::UNIX_EPOCH)?.0
    };
    Ok(())
}
fn instance_days(task: &TaskSnapshot, key: &str) -> Result<Vec<NaiveDate>> {
    task.properties
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|value| {
            tasknotes_vault::temporal::parse_day(value.as_str().ok_or_else(|| {
                RuntimeError::Validation("instance day must be a string".to_owned())
            })?)
            .map_err(Into::into)
        })
        .collect()
}
fn day(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .and_then(|value| tasknotes_vault::temporal::date_part(value).ok())
        .map(|day| day.to_string())
}
