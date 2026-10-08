//! Pure recurring-instance transitions backed by the shared recurrence engine.

use crate::{Result, VaultError, temporal};
use chrono::{DateTime, Days, NaiveDate, Utc};
use serde_json::{Value, json};
use tasknotes_core::{domain::RecurrenceAnchor, recurrence::Recurrence};

/// Complete or recalculate an existing recurring task without reading a clock.
///
/// # Errors
/// Rejects missing seeds, invalid instance days, invalid anchors, and invalid rules.
pub fn execute(operation: &str, input: &Value) -> Result<Value> {
    let complete_operation = operation == "recurrence.complete";
    if !complete_operation && operation != "recurrence.recalculate" {
        return Err(invalid("unsupported_operation"));
    }
    let target = temporal::parse_day(text(
        input,
        if complete_operation {
            "completionDate"
        } else {
            "referenceDate"
        },
    ))?;
    transition(input, complete_operation, target, None)
}

/// Complete the resolved local occurrence using its original explicit instant.
///
/// # Errors
/// Rejects invalid instance lists, recurrence anchors, rules, and missing seeds.
pub fn complete_at(input: &Value, day: NaiveDate, instant: DateTime<Utc>) -> Result<Value> {
    transition(input, true, day, Some(instant))
}

fn transition(
    input: &Value,
    complete_operation: bool,
    target: NaiveDate,
    instant: Option<DateTime<Utc>>,
) -> Result<Value> {
    let anchor = match input
        .get("recurrenceAnchor")
        .and_then(Value::as_str)
        .unwrap_or("scheduled")
    {
        "scheduled" => RecurrenceAnchor::Scheduled,
        "completion" => RecurrenceAnchor::Completion,
        _ => return Err(invalid("invalid_recurrence_anchor")),
    };
    let mut complete = days(input, "completeInstances")?;
    let mut skipped = days(input, "skippedInstances")?;
    if complete_operation {
        if !complete.contains(&target) {
            complete.push(target);
        }
        skipped.retain(|d| *d != target);
    }
    let rule = text(input, "recurrence");
    let parsed = Recurrence::parse(
        rule,
        input.get("scheduled").and_then(Value::as_str),
        input.get("dateCreated").and_then(Value::as_str),
    );
    if parsed.frequency().is_none() {
        return Err(invalid("invalid_recurrence_rule"));
    }
    let seed = if complete_operation && anchor == RecurrenceAnchor::Completion {
        target
    } else {
        parsed
            .resolved_start()
            .ok_or_else(|| invalid("missing_recurrence_seed"))?
    };
    let updated = canonical_start(
        rule,
        seed,
        complete_operation && anchor == RecurrenceAnchor::Completion,
        instant.filter(|_| complete_operation && anchor == RecurrenceAnchor::Completion),
    )?;
    let recurrence = Recurrence::parse(&updated, None, None);
    let reference = instant
        .filter(|_| complete_operation && anchor == RecurrenceAnchor::Completion)
        .map_or(target, |value| value.date_naive());
    let next = recurrence.next_uncompleted_occurrence(reference, anchor, &complete, &skipped);
    let next_scheduled =
        next.map(|day| preserve_time(day, input.get("scheduled").and_then(Value::as_str)));
    let next_due = due(next, input)?;
    if complete_operation {
        Ok(
            json!({"completeInstances":complete.iter().map(ToString::to_string).collect::<Vec<_>>(),"skippedInstances":skipped.iter().map(ToString::to_string).collect::<Vec<_>>(),"updatedRecurrence":updated,"nextScheduled":next_scheduled,"nextDue":next_due}),
        )
    } else {
        Ok(json!({"updatedRecurrence":updated,"nextScheduled":next_scheduled,"nextDue":next_due}))
    }
}

fn canonical_start(
    rule: &str,
    seed: NaiveDate,
    replace: bool,
    instant: Option<DateTime<Utc>>,
) -> Result<String> {
    let mut parts = rule
        .trim()
        .trim_start_matches("RRULE:")
        .split(';')
        .filter(|p| !p.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if replace {
        parts.retain(|p| !p.starts_with("DTSTART:"));
    }
    if !parts.iter().any(|p| p.starts_with("DTSTART:")) {
        let start = instant.map_or_else(
            || seed.format("%Y%m%d").to_string(),
            |value| value.format("%Y%m%dT%H%M%SZ").to_string(),
        );
        parts.insert(0, format!("DTSTART:{start}"));
    }
    if !parts.iter().any(|p| p.starts_with("FREQ=")) {
        return Err(invalid("invalid_recurrence_rule"));
    }
    Ok(parts.join(";"))
}

fn due(next: Option<NaiveDate>, input: &Value) -> Result<Option<String>> {
    let Some(next) = next else { return Ok(None) };
    let (Some(scheduled), Some(due)) = (
        input.get("scheduled").and_then(Value::as_str),
        input.get("due").and_then(Value::as_str),
    ) else {
        return Ok(None);
    };
    let delta = temporal::date_part(due)?
        .signed_duration_since(temporal::date_part(scheduled)?)
        .num_days();
    let next = if delta >= 0 {
        next.checked_add_days(Days::new(delta.unsigned_abs()))
    } else {
        next.checked_sub_days(Days::new(delta.unsigned_abs()))
    }
    .ok_or_else(|| invalid("invalid_date_range"))?;
    Ok(Some(preserve_time(next, Some(due))))
}

fn preserve_time(day: NaiveDate, old: Option<&str>) -> String {
    let suffix = old
        .and_then(|s| s.get(10..))
        .filter(|s| s.starts_with('T'))
        .unwrap_or_default();
    format!("{day}{suffix}")
}
fn days(input: &Value, key: &str) -> Result<Vec<NaiveDate>> {
    let mut out = Vec::new();
    if let Some(values) = input.get(key).and_then(Value::as_array) {
        for value in values {
            let day = temporal::parse_day(
                value
                    .as_str()
                    .ok_or_else(|| invalid("invalid_instance_date"))?,
            )?;
            if !out.contains(&day) {
                out.push(day);
            }
        }
    }
    Ok(out)
}
fn text<'a>(input: &'a Value, key: &str) -> &'a str {
    input.get(key).and_then(Value::as_str).unwrap_or_default()
}
fn invalid(message: &str) -> VaultError {
    VaultError::Document(message.to_owned())
}
