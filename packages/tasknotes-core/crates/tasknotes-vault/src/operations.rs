//! Pure task mutation planning shared with durable native runtimes.

use crate::{Result, VaultError, temporal, validation};
use chrono::NaiveDate;
use serde_json::{Map, Value, json};

/// Apply an explicit patch preserving all unmentioned fields.
#[must_use]
pub fn patch(
    original: &Map<String, Value>,
    patch: &Map<String, Value>,
) -> (bool, Map<String, Value>) {
    let changed = patch.iter().any(|(k, v)| original.get(k) != Some(v));
    let mut result = original.clone();
    result.extend(patch.clone());
    (changed, result)
}

/// Select configured completed state and explicit/local operation date.
///
/// # Errors
/// Rejects invalid explicit dates.
pub fn completion(input: &Value, today: NaiveDate) -> Result<Value> {
    let status = input
        .get("completedValues")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .find(|s| !s.trim().is_empty())
        .unwrap_or("done");
    let date = input
        .get("explicitDate")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(temporal::date_part)
        .transpose()?
        .unwrap_or(today);
    Ok(json!({"status":status,"completedDate":date.to_string()}))
}

/// Apply day-level recurring instance state with set semantics.
///
/// # Errors
/// Rejects invalid target/instance dates and unknown operations.
pub fn instance(operation: &str, input: &Value) -> Result<Value> {
    let target = temporal::parse_day(text(input, "targetDate"))?.to_string();
    let mut complete = unique_dates(input, "completeInstances")?;
    let mut skipped = unique_dates(input, "skippedInstances")?;
    match operation {
        "recurrence.effective_state" => {
            return Ok(
                json!({"value":if complete.contains(&target){"completed"}else if skipped.contains(&target){"skipped"}else{"open"}}),
            );
        }
        "recurrence.uncomplete_instance" => complete.retain(|s| s != &target),
        "recurrence.skip_instance" => {
            complete.retain(|s| s != &target);
            if !skipped.contains(&target) {
                skipped.push(target);
            }
        }
        "recurrence.unskip_instance" => skipped.retain(|s| s != &target),
        _ => return Err(invalid("unsupported_operation")),
    }
    let mut result = json!({"completeInstances":complete,"skippedInstances":skipped});
    if operation == "recurrence.uncomplete_instance"
        && let Some(rule) = input.get("recurrence").and_then(Value::as_str)
    {
        result
            .as_object_mut()
            .ok_or_else(|| invalid("invalid_instance_result"))?
            .insert("updatedRecurrence".into(), json!(rule));
    }
    Ok(result)
}

/// Evaluate deterministic task planning operations.
///
/// # Errors
/// Returns typed validation, conflict, and invalid-operation failures.
pub fn execute(operation: &str, input: &Value, today: NaiveDate) -> Result<Value> {
    match operation {
        "op.update_patch" => {
            let (changed, fm) = patch(&object(input, "original"), &object(input, "patch"));
            Ok(json!({"changed":changed,"frontmatter":fm}))
        }
        "op.complete_nonrecurring" => completion(input, today),
        "op.uncomplete_nonrecurring" => Ok(
            json!({"status":input.get("defaultStatus").and_then(Value::as_str).filter(|s|!s.trim().is_empty()).unwrap_or("open"),"completedDate":if boolean(input,"clearCompletedDate"){Value::Null}else{input.get("frontmatter").and_then(|v|v.get("completedDate")).cloned().unwrap_or(Value::Null)}}),
        ),
        "op.mutate_with_validation" => {
            let mut input = input.clone();
            let strict = boolean(&input, "strict");
            input
                .as_object_mut()
                .ok_or_else(|| invalid("invalid_request_schema"))?
                .insert("rejectUnknownFields".into(), json!(strict));
            let report = validation::evaluate(&input)?;
            if report.get("hasErrors") == Some(&Value::Bool(true)) {
                return Err(invalid(&format!(
                    "validation:{}",
                    report
                        .get("errorCodes")
                        .and_then(Value::as_array)
                        .and_then(|a| a.first())
                        .and_then(Value::as_str)
                        .unwrap_or("invalid")
                )));
            }
            Ok(json!({"value":"accepted"}))
        }
        "op.detect_conflict" => {
            let expected = text(input, "expectedVersion");
            let actual = text(input, "actualVersion");
            if !boolean(input, "overwrite")
                && !expected.is_empty()
                && !actual.is_empty()
                && expected != actual
            {
                return Err(VaultError::Conflict);
            }
            Ok(json!({"conflict":false}))
        }
        "op.dry_run" => {
            let (_, plan) = patch(&object(input, "original"), &object(input, "patch"));
            let changes = object(input, "patch").keys().cloned().collect::<Vec<_>>();
            Ok(json!({"wrote":false,"plannedChanges":changes,"frontmatter":plan}))
        }
        "op.error_shape" => {
            let operation = input
                .get("operation")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("unknown");
            let code = input
                .get("code")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("unknown_error");
            let message = input
                .get("message")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .unwrap_or(code);
            let mut result = json!({"operation":operation,"code":code,"message":message});
            if let Some(field) = input.get("field").and_then(Value::as_str) {
                result
                    .as_object_mut()
                    .ok_or_else(|| invalid("invalid_error_result"))?
                    .insert("field".into(), json!(field));
            }
            Ok(result)
        }
        _ => Err(invalid("unsupported_operation")),
    }
}
fn unique_dates(input: &Value, key: &str) -> Result<Vec<String>> {
    let mut result = Vec::new();
    for value in input
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let day = temporal::parse_day(
            value
                .as_str()
                .ok_or_else(|| invalid("invalid_instance_date"))?,
        )?
        .to_string();
        if !result.contains(&day) {
            result.push(day);
        }
    }
    Ok(result)
}
fn boolean(input: &Value, key: &str) -> bool {
    input.get(key).and_then(Value::as_bool) == Some(true)
}
fn object(input: &Value, key: &str) -> Map<String, Value> {
    input
        .get(key)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}
fn text<'a>(input: &'a Value, key: &str) -> &'a str {
    input.get(key).and_then(Value::as_str).unwrap_or_default()
}
fn invalid(message: &str) -> VaultError {
    VaultError::Document(message.into())
}
