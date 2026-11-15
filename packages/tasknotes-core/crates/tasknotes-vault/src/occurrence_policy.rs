//! Existing TaskNotes occurrence policy, independent of any application flag.
use crate::{Result, VaultError, reminder_schedule};
use serde_json::{Map, Value};

fn valid(value: &Value, allowed: &[&str]) -> bool {
    value.as_str().is_some_and(|v| allowed.contains(&v))
}
fn duration(value: &Value) -> bool {
    value.as_str().is_some_and(|v| {
        reminder_schedule::offset(v).is_ok_and(|duration| duration >= chrono::Duration::zero())
    })
}

/// Validate collection policy enums and finite nonnegative ISO durations.
/// # Errors
/// Rejects malformed values instead of silently using a different default.
pub fn validate_configuration(value: &Value) -> Result<()> {
    let fields = value
        .as_object()
        .ok_or_else(|| VaultError::Configuration("occurrences must be an object".into()))?;
    for (key, allowed) in [
        (
            "default_materialization",
            &["manual", "on_completion", "rolling"][..],
        ),
        (
            "default_next_trigger",
            &["completion", "completion_or_skip"][..],
        ),
    ] {
        if fields.get(key).is_some_and(|value| !valid(value, allowed)) {
            return Err(VaultError::Configuration(format!(
                "occurrences.{key} is invalid"
            )));
        }
    }
    for key in ["past_horizon", "future_horizon"] {
        if fields.get(key).is_some_and(|value| !duration(value)) {
            return Err(VaultError::Configuration(format!(
                "occurrences.{key} must be a finite nonnegative ISO duration"
            )));
        }
    }
    Ok(())
}

/// Invalid role names for mapped task validation and production writers.
#[must_use]
pub fn invalid_roles(properties: &Map<String, Value>) -> Vec<&'static str> {
    let mut invalid = Vec::new();
    for (role, allowed) in [
        (
            "occurrenceMaterialization",
            &["manual", "on_completion", "rolling"][..],
        ),
        (
            "occurrenceNextTrigger",
            &["completion", "completion_or_skip"][..],
        ),
    ] {
        if properties
            .get(role)
            .is_some_and(|value| !valid(value, allowed))
        {
            invalid.push(role);
        }
    }
    for role in ["occurrencePastHorizon", "occurrenceFutureHorizon"] {
        if properties.get(role).is_some_and(|value| !duration(value)) {
            invalid.push(role);
        }
    }
    if properties.get("occurrenceTemplate").is_some_and(|value| {
        !value.as_str().is_some_and(|path| {
            !path.trim().is_empty() && crate::path::VaultPath::parse(path).is_ok()
        })
    }) {
        invalid.push("occurrenceTemplate");
    }
    invalid
}
