//! Execute every immutable upstream case, with independently ported matchers.

use std::{collections::BTreeMap, fs, path::PathBuf};

use regex::Regex;
use serde_json::{Value, json};
use tasknotes_vault::{
    compat::{self, ExecutionContext},
    temporal,
};

type TestResult = Result<(), Box<dyn std::error::Error>>;
mod runtime_adapter;

#[test]
fn full_pinned_spec_corpus() -> TestResult {
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tasknotes-fixtures/vault/upstream");
    let manifest: Value = serde_json::from_slice(&fs::read(directory.join("manifest.json"))?)?;
    let files = manifest
        .get("files")
        .and_then(Value::as_array)
        .ok_or("manifest files missing")?;
    let context = ExecutionContext {
        today: temporal::parse_day("2026-02-20")?,
        timezone: "UTC".to_owned(),
        working_directory: "/work".to_owned(),
    };
    let mut results: BTreeMap<String, (usize, usize, String)> = BTreeMap::new();
    let mut total = 0;
    for file in files {
        let name = file
            .get("file")
            .and_then(Value::as_str)
            .ok_or("manifest name missing")?;
        let cases: Vec<Value> = serde_json::from_slice(&fs::read(directory.join(name))?)?;
        assert_eq!(
            u64::try_from(cases.len())?,
            file.get("cases")
                .and_then(Value::as_u64)
                .ok_or("manifest count missing")?
        );
        for case in cases {
            total += 1;
            let operation = case
                .get("operation")
                .and_then(Value::as_str)
                .ok_or("operation missing")?;
            let input = case.get("input").ok_or("input missing")?;
            let id = case.get("id").and_then(Value::as_str).ok_or("id missing")?;
            let row = results.entry(operation.to_owned()).or_default();
            row.1 += 1;
            if !compat::supports(operation) && !runtime_adapter::supports(operation) {
                if row.2.is_empty() {
                    let disposition = if operation.starts_with("time.")
                        || operation == "validation.time_entries"
                    {
                        "withdrawn timing capability outside Facet product scope"
                    } else {
                        "production operation unavailable"
                    };
                    row.2 = format!("{id}: {disposition}");
                }
                continue;
            }
            let result = execute_case(operation, input, &context);
            let envelope = match result {
                Ok(result) => json!({"ok":true,"result":result}),
                Err(
                    tasknotes_vault::VaultError::Document(message)
                    | tasknotes_vault::VaultError::Configuration(message),
                ) => json!({"ok":false,"error":message}),
                Err(tasknotes_vault::VaultError::Conflict) => {
                    json!({"ok":false,"error":"write_conflict"})
                }
                Err(error) => json!({"ok":false,"error":error.to_string()}),
            };
            let assertion = case
                .get("assertion")
                .and_then(Value::as_str)
                .ok_or("assertion missing")?;
            let matched = matches_case(assertion, &envelope, case.get("expect"), input)?;
            if matched {
                row.0 += 1;
            } else if row.2.is_empty() {
                row.2 = format!(
                    "{id}: actual {envelope}; expected {}",
                    case.get("expect").unwrap_or(&Value::Null)
                );
            }
        }
    }
    assert_eq!(total, 4980, "the complete immutable manifest must execute");
    let passed = results.values().map(|r| r.0).sum::<usize>();
    let failures = results
        .iter()
        .filter(|(_, row)| row.0 != row.1)
        .map(|(operation, row)| format!("{operation}: {}/{}; {}", row.0, row.1, row.2))
        .collect::<Vec<_>>()
        .join("\n");
    assert_eq!(
        passed, total,
        "Production conformance: {passed}/{total}\n{failures}"
    );
    Ok(())
}

fn execute_case(
    operation: &str,
    input: &Value,
    context: &ExecutionContext,
) -> tasknotes_vault::Result<Value> {
    if runtime_adapter::supports(operation) {
        return runtime_adapter::execute(operation, input);
    }
    if operation != "create_compat.create" {
        return compat::execute(operation, input, context);
    }
    let now = input
        .get("fixedNow")
        .and_then(Value::as_str)
        .map(tasknotes_vault::creation::timestamp)
        .transpose()?
        .unwrap_or_else(|| context.today.and_time(chrono::NaiveTime::MIN).and_utc());
    let invalid = || tasknotes_vault::VaultError::Document("creation input is invalid".to_owned());
    let frontmatter = input
        .get("frontmatter")
        .and_then(Value::as_object)
        .ok_or_else(invalid)?;
    let task_type = input.get("taskType").ok_or_else(invalid)?;
    let mut calls = 0;
    tasknotes_vault::creation::create_with(task_type,frontmatter,now,&context.timezone,|path,prepared| {
        calls+=1;
        if let Some(error)=input.get("forceCreateError").and_then(Value::as_str) {
            return Err(tasknotes_vault::VaultError::Document(error.to_owned()));
        }
        let path=path.ok_or_else(||tasknotes_vault::VaultError::Document("path_required".to_owned()))?;
        Ok(tasknotes_vault::creation::CreationPlan{path:path.to_owned(),frontmatter:prepared.clone()})
    }).map(|plan|json!({"path":plan.path,"frontmatter":plan.frontmatter,"warnings":[],"callCount":calls}))
}

fn matches_case(
    assertion: &str,
    envelope: &Value,
    expect: Option<&Value>,
    input: &Value,
) -> Result<bool, Box<dyn std::error::Error>> {
    if [
        "recurrence_complete_invariants",
        "recurrence_recalculate_invariants",
    ]
    .contains(&assertion)
    {
        return recurrence_invariants(envelope, input, assertion);
    }
    let expect = expect.ok_or("expectation missing")?;
    match assertion {
        "envelope_equals" => deep_match(envelope, expect, input),
        "create_compat_invariants" => Ok(deep_match(envelope, expect, input)?
            && envelope
                .get("result")
                .and_then(|r| r.get("path"))
                .and_then(Value::as_str)
                .is_none_or(|path| {
                    std::path::Path::new(path)
                        .extension()
                        .is_some_and(|extension| extension == "md")
                        && !path.contains(['{', '}'])
                })),
        "recurrence_complete_invariants" | "recurrence_recalculate_invariants" => {
            recurrence_invariants(envelope, input, assertion)
        }
        "envelope_error" => Ok(envelope.get("ok") == Some(&Value::Bool(false))
            && deep_match(
                envelope.get("error").ok_or("error missing")?,
                expect.get("error").ok_or("error expectation missing")?,
                input,
            )?),
        _ => Ok(false),
    }
}

fn recurrence_invariants(
    envelope: &Value,
    input: &Value,
    assertion: &str,
) -> Result<bool, Box<dyn std::error::Error>> {
    if envelope.get("ok") != Some(&Value::Bool(true)) {
        return Ok(false);
    }
    let result = &envelope["result"];
    let rule = result["updatedRecurrence"].as_str().unwrap_or_default();
    if !rule.contains("FREQ=") {
        return Ok(false);
    }
    let completing = assertion == "recurrence_complete_invariants";
    let target = input[if completing {
        "completionDate"
    } else {
        "referenceDate"
    }]
    .as_str()
    .ok_or("target missing")?;
    let anchor = input["recurrenceAnchor"].as_str().unwrap_or("scheduled");
    if completing {
        let complete = result["completeInstances"]
            .as_array()
            .ok_or("complete array missing")?;
        let skipped = result["skippedInstances"]
            .as_array()
            .ok_or("skip array missing")?;
        if !complete.contains(&json!(target))
            || skipped.contains(&json!(target))
            || !rule.contains("DTSTART:")
        {
            return Ok(false);
        }
        if anchor == "completion" && !rule.contains(&format!("DTSTART:{}", target.replace('-', "")))
        {
            return Ok(false);
        }
    }
    if anchor == "scheduled" {
        if !rule.contains("DTSTART:") {
            return Ok(false);
        }
        if completing
            && let Some(scheduled) = input["scheduled"].as_str()
            && !rule.contains(&format!(
                "DTSTART:{}",
                scheduled
                    .get(..10)
                    .ok_or("scheduled date missing")?
                    .replace('-', "")
            ))
        {
            return Ok(false);
        }
    }
    if let Some(next) = result["nextScheduled"].as_str() {
        let next = temporal::date_part(next)?;
        if next < temporal::parse_day(target)? {
            return Ok(false);
        }
        if !completing {
            let processed = input["skippedInstances"]
                .as_array()
                .is_some_and(|a| a.contains(&json!(next.to_string())))
                || (anchor != "completion"
                    && input["completeInstances"]
                        .as_array()
                        .is_some_and(|a| a.contains(&json!(next.to_string()))));
            if processed {
                return Ok(false);
            }
        }
        if let (Some(due), Some(old_scheduled), Some(old_due)) = (
            result["nextDue"].as_str(),
            input["scheduled"].as_str(),
            input["due"].as_str(),
        ) {
            let original = temporal::date_part(old_due)?
                .signed_duration_since(temporal::date_part(old_scheduled)?);
            let actual = temporal::date_part(due)?.signed_duration_since(next);
            if actual != original {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

fn deep_match(
    actual: &Value,
    expected: &Value,
    input: &Value,
) -> Result<bool, Box<dyn std::error::Error>> {
    if let Some(object) = expected.as_object() {
        if let Some(pattern) = object.get("$regex").and_then(Value::as_str) {
            let regex = Regex::new(pattern)?;
            return Ok(actual.as_str().is_some_and(|value| regex.is_match(value)));
        }
        if let Some(options) = object.get("$oneOf").and_then(Value::as_array) {
            for option in options {
                if deep_match(actual, option, input)? {
                    return Ok(true);
                }
            }
            return Ok(false);
        }
        if let Some(subset) = object.get("$contains") {
            if let Some(values) = actual.as_array() {
                let expected = subset
                    .as_array()
                    .ok_or("$contains array contract missing")?;
                for item in expected {
                    let mut found = false;
                    for value in values {
                        if deep_match(value, item, input)? {
                            found = true;
                            break;
                        }
                    }
                    if !found {
                        return Ok(false);
                    }
                }
                return Ok(true);
            }
            if actual.is_object() && subset.is_object() {
                return deep_match(actual, subset, input);
            }
            return Ok(false);
        }
        if let Some(reference) = object.get("$ref").and_then(Value::as_str) {
            let mut value = input;
            for key in reference
                .strip_prefix("input.")
                .ok_or("unknown matcher reference")?
                .split('.')
            {
                value = value.get(key).ok_or("matcher reference missing")?;
            }
            return deep_match(actual, value, input);
        }
        let Some(values) = actual.as_object() else {
            return Ok(false);
        };
        for (key, value) in object {
            let Some(actual) = values.get(key) else {
                return Ok(false);
            };
            if !deep_match(actual, value, input)? {
                return Ok(false);
            }
        }
        return Ok(true);
    }
    if let Some(expected) = expected.as_array() {
        let Some(actual) = actual.as_array() else {
            return Ok(false);
        };
        if actual.len() != expected.len() {
            return Ok(false);
        }
        for (actual, expected) in actual.iter().zip(expected) {
            if !deep_match(actual, expected, input)? {
                return Ok(false);
            }
        }
        return Ok(true);
    }
    Ok(actual == expected)
}
