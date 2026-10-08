//! Recovery metadata for journals created before timing features were removed.
//!
//! These commands are never accepted at the public boundary or executed. Their
//! already staged file images still own recovery, uploads and Undo; interpreting
//! only their immutable clocks must not strand those images during an upgrade.

use super::{Mutation, Result, RuntimeError};
use serde_json::{Value, json};

pub(super) fn contains_retired_command(value: &Value) -> bool {
    let command = value.get("command").unwrap_or(value);
    match command.get("kind").and_then(Value::as_str) {
        Some("start_time" | "stop_time" | "set_time_entries" | "pomodoro") => true,
        Some("batch" | "batch_partial") => command
            .get("commands")
            .and_then(Value::as_array)
            .is_some_and(|commands| commands.iter().any(contains_retired_command)),
        _ => false,
    }
}

fn metadata_command(command: &mut Value) -> Result<()> {
    let object = command
        .as_object_mut()
        .ok_or_else(|| RuntimeError::Storage("stored command is not an object".into()))?;
    match object.get("kind").and_then(Value::as_str) {
        Some("start_time" | "stop_time" | "set_time_entries") => {
            let path = object.get("path").and_then(Value::as_str).ok_or_else(|| {
                RuntimeError::Storage("historical journal has no task path".into())
            })?;
            tasknotes_vault::path::VaultPath::parse(path)?;
            // Normalize has no primary-task receipt identity, matching these
            // historical commands. This value is metadata, never a write plan.
            *command = json!({"kind":"normalize","path":path});
        }
        Some("pomodoro") => {
            // A retired private timer has no file identity or resumed effect.
            *command = json!({"kind":"restore_default_views"});
        }
        Some("batch" | "batch_partial") => {
            let commands = object
                .get_mut("commands")
                .and_then(Value::as_array_mut)
                .ok_or_else(|| RuntimeError::Storage("stored batch has no commands".into()))?;
            for command in commands {
                metadata_command(command)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub(super) fn stored_mutation(fingerprint: &str) -> Result<Mutation> {
    let mut value: Value = serde_json::from_str(fingerprint)?;
    metadata_command(
        value
            .get_mut("command")
            .ok_or_else(|| RuntimeError::Storage("stored mutation has no command".into()))?,
    )?;
    Ok(serde_json::from_value(value)?)
}
