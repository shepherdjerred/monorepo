//! Shared standalone feature projections; timestamps and civil dates are inputs.

use crate::{Result, RuntimeError};
use chrono::{DateTime, FixedOffset, NaiveDate};
use serde::Deserialize;
use serde_json::{Map, Value, json};
use tasknotes_vault::config::TaskNotesConfiguration;

#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum Request {
    Conformance {},
    UndoAvailable {},
    NormalizationPreview {
        path: String,
    },
    BatchOutcome {
        mutation_id: String,
    },
    MutationReceipt {
        mutation_id: String,
    },
    ResolutionHistory {
        mutation_id: String,
    },
    CapturePreview {
        input: String,
        at: String,
        today: String,
        context: Option<CaptureContext>,
    },
    TaskTime {
        path: String,
        at: String,
    },
    TimeReport {
        from: String,
        to: String,
        at: String,
    },
    Pomodoro {
        device_id: String,
        at: String,
    },
    Discovery {},
    TrackingSessions {
        at: String,
        limit: Option<u32>,
        after: Option<TrackingCursor>,
        expected_version: Option<u64>,
    },
    TrackingHistory {
        path: String,
        at: String,
        limit: Option<u32>,
        after: Option<TrackingHistoryCursor>,
        expected_version: Option<u64>,
    },
    ReminderPlan {
        at: String,
        timezone: String,
        from: String,
        to: String,
        limit: Option<u32>,
        after: Option<ReminderCursor>,
        expected_version: Option<u64>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TrackingCursor {
    pub task_path: String,
    pub at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct TrackingHistoryCursor {
    pub entry_index: u64,
    pub at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReminderCursor {
    pub fire_at: String,
    pub reminder_id: String,
    pub task_path: String,
}

pub(crate) fn parse_request(json: &str) -> Result<Request> {
    let mut request: Value = serde_json::from_str(json)?;
    let object = request
        .as_object_mut()
        .ok_or_else(|| RuntimeError::Validation("feature request must be an object".to_owned()))?;
    if object.remove("schemaVersion").is_some_and(|value| {
        !tasknotes_vault::json_boundary::unsigned(&value).is_ok_and(|version| version == 1)
    }) {
        return Err(RuntimeError::Validation(
            "unsupported feature contract version".to_owned(),
        ));
    }
    if matches!(
        object.get("kind").and_then(Value::as_str),
        Some("reminder_plan" | "tracking_sessions" | "tracking_history")
    ) {
        for key in ["limit", "expectedVersion"] {
            if let Some(value) = object.get_mut(key) {
                tasknotes_vault::json_boundary::normalize_unsigned(value)?;
            }
        }
        if let Some(value) = object
            .get_mut("after")
            .and_then(Value::as_object_mut)
            .and_then(|after| after.get_mut("entryIndex"))
        {
            tasknotes_vault::json_boundary::normalize_unsigned(value)?;
        }
    }
    Ok(serde_json::from_value(request)?)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CaptureContext {
    projects: Option<Vec<String>>,
    contexts: Option<Vec<String>>,
    tags: Option<Vec<String>>,
    scheduled: Option<String>,
}

pub(crate) fn timestamp(value: &str) -> Result<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(value)
        .map_err(|_| RuntimeError::Validation("time must be RFC3339".to_owned()))
}

pub(crate) fn time_reading(
    path: &str,
    properties: &Map<String, Value>,
    at: &str,
    period: Option<(&str, &str)>,
) -> Result<Value> {
    let now = timestamp(at)?;
    let bounds = period
        .map(|(from, to)| Ok::<_, RuntimeError>((timestamp(from)?, timestamp(to)?)))
        .transpose()?;
    if bounds.is_some_and(|(from, to)| from >= to) {
        return Err(RuntimeError::Validation(
            "report from must precede to".to_owned(),
        ));
    }
    let entries =
        tasknotes_vault::tracking::normalize(properties.get("timeEntries").unwrap_or(&json!([])))?;
    let mut seconds = 0_u64;
    let mut active = false;
    let mut elapsed_entries = Vec::new();
    for entry in &entries {
        let start = timestamp(
            entry
                .get("startTime")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    RuntimeError::Validation("entry startTime is required".to_owned())
                })?,
        )?;
        let end = entry
            .get("endTime")
            .and_then(Value::as_str)
            .map(timestamp)
            .transpose()?;
        active |= end.is_none();
        let end = end.unwrap_or(now);
        let (start, end) = bounds.map_or((start, end), |(from, to)| (start.max(from), end.min(to)));
        if end > start {
            elapsed_entries
                .push(json!({"startTime":start.to_rfc3339(),"endTime":end.to_rfc3339()}));
            seconds = seconds
                .checked_add(
                    u64::try_from((end - start).num_seconds()).map_err(|_| {
                        RuntimeError::Validation("invalid entry duration".to_owned())
                    })?,
                )
                .ok_or_else(|| RuntimeError::Validation("time total is too large".to_owned()))?;
        }
    }
    let (_, minutes) =
        tasknotes_vault::tracking::totals(&elapsed_entries, now.with_timezone(&chrono::Utc))?;
    Ok(
        json!({"schemaVersion":1,"path":path,"totalSeconds":seconds,"totalMinutes":minutes,"hasActiveSession":active,"entries":entries}),
    )
}

pub(crate) fn capture(
    config: &TaskNotesConfiguration,
    input: &str,
    at: &str,
    today: &str,
    context: Option<&CaptureContext>,
) -> Result<Value> {
    timestamp(at)?;
    let today = NaiveDate::parse_from_str(today, "%Y-%m-%d")
        .map_err(|_| RuntimeError::Validation("today must be a civil date".to_owned()))?;
    let values: Vec<&str> = config.priorities.iter().map(|p| p.value.as_str()).collect();
    let parsed = tasknotes_core::nlp::parse_configured_input(input, today, &values);
    let mut properties = json!({"title":parsed.title,"status":config.default_status,"priority":parsed.priority.or_else(||config.default_priority.clone()),"due":parsed.due,"projects":parsed.projects,"contexts":parsed.contexts,"tags":parsed.tags});
    if let Some(context) = context {
        let object = properties.as_object_mut().ok_or_else(|| {
            RuntimeError::Storage("capture projection violates its contract".to_owned())
        })?;
        for (key, values) in [
            ("projects", &context.projects),
            ("contexts", &context.contexts),
            ("tags", &context.tags),
        ] {
            if object
                .get(key)
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
                && let Some(values) = values
            {
                if values.iter().any(|value| value.trim().is_empty()) {
                    return Err(RuntimeError::Validation(
                        "capture context values must not be blank".to_owned(),
                    ));
                }
                object.insert(key.to_owned(), json!(values));
            }
        }
        if let Some(scheduled) = &context.scheduled {
            tasknotes_vault::temporal::date_part(scheduled)?;
            object.insert("scheduled".to_owned(), json!(scheduled));
        }
    }
    Ok(json!({"schemaVersion":1,"properties":properties,"body":""}))
}
