//! Validated time entries and deterministic elapsed-minute accounting.

use crate::{Result, VaultError, temporal};
use chrono::{DateTime, Utc};
use serde_json::{Value, json};

/// Canonicalize time entry instants while retaining additional entry fields.
///
/// # Errors
/// Rejects malformed instants, inverted ranges, and multiple active sessions.
pub fn normalize(value: &Value) -> Result<Vec<Value>> {
    let entries = value
        .as_array()
        .ok_or_else(|| invalid("invalid_time_entries"))?;
    let mut active = 0;
    let mut result = Vec::new();
    for entry in entries {
        let mut entry = entry
            .as_object()
            .cloned()
            .ok_or_else(|| invalid("invalid_time_entry"))?;
        let start = entry
            .get("startTime")
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| invalid("missing_time_entry_start"))?;
        let start = temporal::parse_instant(start.trim())
            .map_err(|_| invalid("invalid_time_entry_start"))?;
        let end = entry
            .get("endTime")
            .filter(|v| !v.is_null() && v.as_str() != Some(""));
        if let Some(end) = end {
            let end = temporal::parse_instant(
                end.as_str()
                    .ok_or_else(|| invalid("invalid_time_entry_end"))?
                    .trim(),
            )
            .map_err(|_| invalid("invalid_time_entry_end"))?;
            if end < start {
                return Err(invalid("invalid_time_range"));
            }
            entry.insert("endTime".into(), json!(canonical(end)));
        } else {
            active += 1;
            entry.remove("endTime");
        }
        entry.insert("startTime".into(), json!(canonical(start)));
        result.push(json!(entry));
    }
    if active > 1 {
        return Err(invalid("multiple_active_time_entries"));
    }
    Ok(result)
}

/// Evaluate a time operation using caller-supplied current time.
///
/// # Errors
/// Rejects invalid entry state, missing entries, and invalid temporal ranges.
pub fn execute(operation: &str, input: &Value, now: DateTime<Utc>) -> Result<Value> {
    let now = input
        .get("now")
        .and_then(Value::as_str)
        .map(temporal::parse_instant)
        .transpose()?
        .unwrap_or(now);
    if operation == "time.auto_stop_on_complete" {
        if input.get("autoStopOnComplete") != Some(&Value::Bool(true))
            || input.get("isCompletionTransition") != Some(&Value::Bool(true))
        {
            return Ok(json!({"stopped":false}));
        }
        let entries = normalize(input.get("taskEntries").unwrap_or(&json!([])))?;
        return Ok(json!({"stopped":entries.iter().any(|e|e.get("endTime").is_none())}));
    }
    let mut entries = normalize(input.get("entries").unwrap_or(&json!([])))?;
    let modified = input
        .get("dateModified")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(temporal::parse_instant)
        .transpose()?
        .unwrap_or(now);
    match operation {
        "validation.time_entries" => Ok(json!({"value":"valid"})),
        "time.start" => {
            if entries.iter().any(|e| e.get("endTime").is_none()) {
                return Err(invalid("time_tracking_already_active"));
            }
            entries.push(json!({"startTime":canonical(now)}));
            Ok(json!({"value":entries,"dateModified":canonical(now)}))
        }
        "time.stop" => {
            let entry = entries
                .iter_mut()
                .find(|e| e.get("endTime").is_none())
                .ok_or_else(|| invalid("no_active_time_entry"))?;
            let start = temporal::parse_instant(
                entry["startTime"]
                    .as_str()
                    .ok_or_else(|| invalid("invalid_time_entry_start"))?,
            )?;
            if now < start {
                return Err(invalid("invalid_time_range"));
            }
            entry["endTime"] = json!(canonical(now));
            Ok(json!({"value":entries,"dateModified":canonical(now)}))
        }
        "time.replace_entries" => Ok(json!({"value":entries,"dateModified":canonical(modified)})),
        "time.remove_entry" => {
            let index = input
                .get("selector")
                .and_then(|s| s.get("index"))
                .and_then(Value::as_u64)
                .and_then(|n| usize::try_from(n).ok())
                .filter(|n| *n < entries.len())
                .ok_or_else(|| invalid("time_entry_not_found"))?;
            entries.remove(index);
            Ok(json!({"value":entries,"dateModified":canonical(modified)}))
        }
        "time.report_totals" => {
            let (closed, live) = totals(&entries, now)?;
            Ok(json!({"closed_minutes":closed,"live_minutes":live}))
        }
        _ => Err(invalid("unsupported_operation")),
    }
}

/// Count closed and live elapsed minutes, rounding each elapsed session.
///
/// # Errors
/// Rejects invalid entries and arithmetic overflow.
pub fn totals(entries: &[Value], now: DateTime<Utc>) -> Result<(u64, u64)> {
    let mut closed = 0_u64;
    let mut active = 0_u64;
    for entry in entries {
        let start = temporal::parse_instant(
            entry
                .get("startTime")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("invalid_time_entry_start"))?,
        )?;
        let end = entry
            .get("endTime")
            .and_then(Value::as_str)
            .map(temporal::parse_instant)
            .transpose()?;
        let millis = end
            .unwrap_or(now)
            .signed_duration_since(start)
            .num_milliseconds()
            .max(0);
        let minutes = u64::try_from(millis)
            .map_err(|_| invalid("time_total_overflow"))?
            .checked_add(30_000)
            .ok_or_else(|| invalid("time_total_overflow"))?
            / 60_000;
        let total = if end.is_some() {
            &mut closed
        } else {
            &mut active
        };
        *total = total
            .checked_add(minutes)
            .ok_or_else(|| invalid("time_total_overflow"))?;
    }
    Ok((
        closed,
        closed
            .checked_add(active)
            .ok_or_else(|| invalid("time_total_overflow"))?,
    ))
}

fn canonical(value: DateTime<Utc>) -> String {
    value.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true)
}
fn invalid(message: &str) -> VaultError {
    VaultError::Document(message.into())
}
