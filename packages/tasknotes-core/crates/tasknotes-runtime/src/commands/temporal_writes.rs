//! Canonicalize only temporal roles explicitly included in a write plan.

use super::{Map, Result, RuntimeError, TaskNotesConfiguration, Value, canonical_role};
use tasknotes_vault::temporal;

enum Boundary {
    Command,
    Document,
}

pub(super) fn command_properties(
    properties: Map<String, Value>,
    config: &TaskNotesConfiguration,
) -> Result<Map<String, Value>> {
    let mut result = Map::new();
    for (key, value) in properties {
        let role = command_role(&key, config).to_owned();
        if result.insert(role, value).is_some() {
            return Err(RuntimeError::Validation(
                "command contains duplicate mapped property roles".into(),
            ));
        }
    }
    Ok(result)
}

pub(super) fn canonicalize(
    properties: &mut Map<String, Value>,
    config: &TaskNotesConfiguration,
) -> Result<()> {
    apply(properties, config, true, &Boundary::Command)
}

pub(super) fn canonicalize_document(
    properties: &mut Map<String, Value>,
    config: &TaskNotesConfiguration,
) -> Result<()> {
    apply(properties, config, true, &Boundary::Document)
}

pub(super) fn prepare_transition(
    properties: &mut Map<String, Value>,
    config: &TaskNotesConfiguration,
) -> Result<()> {
    // Validate reminder writes before staging a completion transition.
    apply(properties, config, false, &Boundary::Command)
}

fn apply(
    properties: &mut Map<String, Value>,
    config: &TaskNotesConfiguration,
    write_reminders: bool,
    boundary: &Boundary,
) -> Result<()> {
    for (key, value) in properties.iter_mut() {
        let role = match boundary {
            Boundary::Command => command_role(key, config),
            Boundary::Document => config
                .mapping
                .field_to_role
                .get(key)
                .map_or(key.as_str(), String::as_str),
        };
        if value.is_null() {
            continue;
        }
        if role == "reminders" {
            let reminders = canonical_absolute_reminders(value)?;
            if write_reminders {
                *value = reminders;
            }
            continue;
        }
        if !matches!(
            role,
            "dateCreated" | "dateModified" | "completedDate" | "due" | "scheduled"
        ) {
            continue;
        }
        let text = value
            .as_str()
            .ok_or_else(|| RuntimeError::Validation(format!("{role} must be a temporal string")))?;
        let canonical = if role == "completedDate"
            || (matches!(role, "due" | "scheduled") && text.len() == 10)
        {
            temporal::parse_day(text)?.to_string()
        } else {
            temporal::canonical_instant(text)?
        };
        *value = Value::String(canonical);
    }
    Ok(())
}

fn command_role<'a>(key: &'a str, config: &'a TaskNotesConfiguration) -> &'a str {
    canonical_role(key)
        .or_else(|| config.mapping.field_to_role.get(key).map(String::as_str))
        .unwrap_or(key)
}

fn canonical_absolute_reminders(value: &Value) -> Result<Value> {
    let mut reminders = value
        .as_array()
        .cloned()
        .ok_or_else(|| RuntimeError::Validation("reminders must be a reminder list".into()))?;
    for reminder in &mut reminders {
        if reminder.get("type").and_then(Value::as_str).map(str::trim) != Some("absolute") {
            // Relative entries retain their existing validation and precision rules.
            continue;
        }
        tasknotes_vault::relationships::validate_reminder(reminder)?;
        let raw = reminder
            .get("absoluteTime")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                RuntimeError::Storage("validated absolute reminder lacks an instant".into())
            })?;
        let canonical = temporal::canonical_instant(raw.trim())?;
        reminder
            .as_object_mut()
            .ok_or_else(|| {
                RuntimeError::Storage("validated absolute reminder is not an object".into())
            })?
            .insert("absoluteTime".into(), Value::String(canonical));
    }
    Ok(Value::Array(reminders))
}
