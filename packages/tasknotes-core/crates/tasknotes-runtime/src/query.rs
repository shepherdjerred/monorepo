//! Shared filtering, date scopes, stable ordering, and grouping.

use std::cmp::Ordering;

use chrono::{Days, NaiveDate};
use indexmap::IndexMap;
use serde_json::Value;

use crate::{
    Result, RuntimeError,
    types::{Query, TaskGroup, TaskSnapshot},
};

pub(crate) fn apply(
    tasks: impl Iterator<Item = Result<TaskSnapshot>>,
    query: &Query,
    configuration: &Value,
) -> Result<(Vec<TaskSnapshot>, u64, Vec<TaskGroup>)> {
    let scope = query.scope.as_deref().unwrap_or("all");
    if ![
        "all",
        "today",
        "upcoming",
        "overdue",
        "completed",
        "undated",
        "inbox",
        "agenda",
    ]
    .contains(&scope)
    {
        return Err(RuntimeError::Validation("unknown query scope".to_owned()));
    }
    let today = query.today.as_deref().map(parse_date).transpose()?;
    if ["today", "upcoming", "overdue", "agenda"].contains(&scope) && today.is_none() {
        return Err(RuntimeError::Validation(
            "date scope requires local today".to_owned(),
        ));
    }
    let before = query.due_before.as_deref().map(parse_date).transpose()?;
    let after = query.due_after.as_deref().map(parse_date).transpose()?;
    let direction = query.sort_direction.as_deref().unwrap_or("asc");
    if !["asc", "desc"].contains(&direction) {
        return Err(RuntimeError::Validation(
            "unknown sort direction".to_owned(),
        ));
    }
    let sort = query.sort_field.as_deref().unwrap_or("effectiveDate");
    if ![
        "title",
        "priority",
        "status",
        "dueDate",
        "effectiveDate",
        "manual",
    ]
    .contains(&sort)
    {
        return Err(RuntimeError::Validation("unknown sort field".to_owned()));
    }
    if query.group_by.as_deref().is_some_and(|group| {
        !["status", "priority", "project", "context", "effectiveDate"].contains(&group)
    }) {
        return Err(RuntimeError::Validation("unknown group field".to_owned()));
    }
    let text = query
        .text
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    let offset = usize::try_from(query.offset)
        .map_err(|_| RuntimeError::Validation("invalid page offset".to_owned()))?;
    let limit = usize::try_from(query.limit.unwrap_or(100).min(1000))
        .map_err(|_| RuntimeError::Validation("invalid page size".to_owned()))?;
    let capacity = offset
        .checked_add(limit)
        .ok_or_else(|| RuntimeError::Validation("page bounds exceed supported range".to_owned()))?;
    let mut total = 0_u64;
    let mut selected: Vec<TaskSnapshot> = Vec::new();
    for task in tasks {
        let mut task = task?;
        crate::projections::local(&mut task, query)?;
        if !matches(&task, query, scope, today, before, after, &text) {
            continue;
        }
        total = total
            .checked_add(1)
            .ok_or_else(|| RuntimeError::Storage("index exceeds supported size".to_owned()))?;
        if limit == 0 {
            continue;
        }
        // Body search uses the current row, but bodies and unrelated properties
        // never accumulate in sort candidates. The database reloads page rows.
        task.body.clear();
        task.body.shrink_to_fit();
        task.properties.retain(|key, _| {
            [
                "due",
                "scheduled",
                "sortOrder",
                "projects",
                "contexts",
                "tags",
            ]
            .contains(&key.as_str())
        });
        let position = selected
            .partition_point(|other| compare(other, &task, sort, direction, configuration).is_lt());
        if position < capacity {
            selected.insert(position, task);
            if selected.len() > capacity {
                selected.pop();
            }
        }
    }
    let tasks: Vec<_> = selected.into_iter().skip(offset).take(limit).collect();
    let groups = group(&tasks, query);
    Ok((tasks, total, groups))
}

fn matches(
    task: &TaskSnapshot,
    query: &Query,
    scope: &str,
    today: Option<NaiveDate>,
    before: Option<NaiveDate>,
    after: Option<NaiveDate>,
    text: &str,
) -> bool {
    let due = task
        .properties
        .get("due")
        .and_then(Value::as_str)
        .and_then(date_part);
    let effective = effective_date(task);
    let scheduled = task
        .properties
        .get("scheduled")
        .and_then(Value::as_str)
        .and_then(date_part);
    let archived = task
        .properties
        .get("archiveTag")
        .is_some_and(|v| v.as_bool() == Some(true));
    (!archived || query.include_archived)
        && (text.is_empty()
            || task.title.to_lowercase().contains(text)
            || task.body.to_lowercase().contains(text))
        && query
            .statuses
            .as_ref()
            .is_none_or(|values| values.is_empty() || values.contains(&task.status))
        && query
            .priorities
            .as_ref()
            .is_none_or(|values| values.is_empty() || values.contains(&task.priority))
        && query.completed.is_none_or(|done| done == task.completed)
        && matches_dimension(
            &task.properties,
            "projects",
            query.projects.as_deref(),
            true,
        )
        && matches_dimension(
            &task.properties,
            "contexts",
            query.contexts.as_deref(),
            false,
        )
        && matches_dimension(&task.properties, "tags", query.tags.as_deref(), false)
        && query
            .has_no_due_date
            .is_none_or(|absent| due.is_none() == absent)
        && query
            .has_no_project
            .is_none_or(|absent| strings(&task.properties, "projects").is_empty() == absent)
        && before.is_none_or(|bound| due.is_some_and(|date| date < bound))
        && after.is_none_or(|bound| due.is_some_and(|date| date > bound))
        && scope_matches(task, query, scope, today, due, scheduled, effective)
}

fn scope_matches(
    task: &TaskSnapshot,
    query: &Query,
    scope: &str,
    today: Option<NaiveDate>,
    due: Option<NaiveDate>,
    scheduled: Option<NaiveDate>,
    effective: Option<NaiveDate>,
) -> bool {
    match scope {
        "today" => {
            if task.is_recurring {
                task.occurrence_date.as_deref().and_then(date_part) == today && today.is_some()
            } else {
                !task.completed && (due == today || scheduled == today) && today.is_some()
            }
        }
        "agenda" => {
            if task.is_recurring {
                task.occurrence_date.as_deref().and_then(date_part) == today && today.is_some()
            } else {
                !task.completed
                    && today.is_some_and(|today| {
                        [due, scheduled]
                            .into_iter()
                            .flatten()
                            .any(|day| day <= today)
                    })
            }
        }
        "upcoming" => {
            (!task.completed || task.is_recurring)
                && today.is_some_and(|today| {
                    [
                        due,
                        scheduled,
                        task.occurrence_date.as_deref().and_then(date_part),
                    ]
                    .into_iter()
                    .flatten()
                    .any(|date| {
                        date > today
                            && today
                                .checked_add_days(Days::new(u64::from(
                                    query.upcoming_days.unwrap_or(7),
                                )))
                                .is_some_and(|end| date <= end)
                    })
                })
        }
        "overdue" => {
            !task.completed
                && effective
                    .zip(today)
                    .is_some_and(|(date, today)| date < today)
        }
        "completed" => task.completed,
        "undated" => !task.completed && effective.is_none(),
        "inbox" => {
            !task.completed
                && !task.is_recurring
                && due.is_none()
                && scheduled.is_none()
                && strings(&task.properties, "projects").is_empty()
                && strings(&task.properties, "contexts").is_empty()
        }
        _ => true,
    }
}

fn compare(
    left: &TaskSnapshot,
    right: &TaskSnapshot,
    sort: &str,
    direction: &str,
    configuration: &Value,
) -> Ordering {
    let ordering =
        match sort {
            "title" => left.title.to_lowercase().cmp(&right.title.to_lowercase()),
            "priority" => weight(configuration, "priorities", &right.priority, "weight").total_cmp(
                &weight(configuration, "priorities", &left.priority, "weight"),
            ),
            "status" => weight(configuration, "statuses", &left.status, "order")
                .total_cmp(&weight(configuration, "statuses", &right.status, "order")),
            "manual" => left
                .properties
                .get("sortOrder")
                .and_then(Value::as_f64)
                .unwrap_or(0.0)
                .total_cmp(
                    &right
                        .properties
                        .get("sortOrder")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0),
                ),
            "dueDate" => date_compare(
                left.properties
                    .get("due")
                    .and_then(Value::as_str)
                    .and_then(date_part),
                right
                    .properties
                    .get("due")
                    .and_then(Value::as_str)
                    .and_then(date_part),
                direction,
            ),
            _ => date_compare(effective_date(left), effective_date(right), direction),
        };
    let ordering = if direction == "desc" && !["dueDate", "effectiveDate"].contains(&sort) {
        ordering.reverse()
    } else {
        ordering
    };
    ordering.then_with(|| left.path.cmp(&right.path))
}

fn group(tasks: &[TaskSnapshot], query: &Query) -> Vec<TaskGroup> {
    let mut groups = IndexMap::<String, Vec<String>>::new();
    if let Some(group) = query.group_by.as_deref() {
        for task in tasks {
            let values = match group {
                "status" => vec![task.status.clone()],
                "priority" => vec![task.priority.clone()],
                "project" => strings(&task.properties, "projects")
                    .into_iter()
                    .map(str::to_owned)
                    .collect(),
                "context" => strings(&task.properties, "contexts")
                    .into_iter()
                    .map(str::to_owned)
                    .collect(),
                _ => effective_date(task)
                    .map(|date| vec![date.to_string()])
                    .unwrap_or_default(),
            };
            if values.is_empty() {
                groups
                    .entry(String::new())
                    .or_default()
                    .push(task.id.clone());
            }
            for value in values {
                groups.entry(value).or_default().push(task.id.clone());
            }
        }
    }
    groups
        .into_iter()
        .map(|(key, task_ids)| TaskGroup { key, task_ids })
        .collect()
}

fn weight(configuration: &Value, dimension: &str, value: &str, field: &str) -> f64 {
    configuration
        .get(dimension)
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|item| item.get("value").and_then(Value::as_str) == Some(value))
        })
        .and_then(|item| item.get(field))
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
}

fn strings<'a>(properties: &'a serde_json::Map<String, Value>, key: &str) -> Vec<&'a str> {
    let Some(value) = properties.get(key) else {
        return Vec::new();
    };
    if let Some(values) = value.as_array() {
        values.iter().filter_map(Value::as_str).collect()
    } else {
        value.as_str().into_iter().collect()
    }
}

fn matches_dimension(
    properties: &serde_json::Map<String, Value>,
    key: &str,
    selected: Option<&[String]>,
    project: bool,
) -> bool {
    selected.is_none_or(|selected| {
        selected.is_empty()
            || strings(properties, key).iter().any(|actual| {
                selected.iter().any(|wanted| {
                    if project {
                        tasknotes_core::domain::project::project_matches(actual, wanted)
                    } else {
                        actual.trim_start_matches('#') == wanted.trim_start_matches('#')
                    }
                })
            })
    })
}

fn effective_date(task: &TaskSnapshot) -> Option<NaiveDate> {
    if let Some(day) = task.effective_date.as_deref().and_then(date_part) {
        return Some(day);
    }
    task.properties
        .get("due")
        .and_then(Value::as_str)
        .and_then(date_part)
        .or_else(|| {
            task.properties
                .get("scheduled")
                .and_then(Value::as_str)
                .and_then(date_part)
        })
}

fn date_part(value: &str) -> Option<NaiveDate> {
    value
        .get(..10)
        .and_then(|date| NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
}
fn parse_date(value: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| RuntimeError::Validation("invalid civil date".to_owned()))
}
fn date_compare(left: Option<NaiveDate>, right: Option<NaiveDate>, direction: &str) -> Ordering {
    match (left, right) {
        (Some(left), Some(right)) => {
            if direction == "desc" {
                right.cmp(&left)
            } else {
                left.cmp(&right)
            }
        }
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}
