//! Configurable frontmatter validation with stable semantic issue codes.

use crate::{Result, mapping::FieldMapping, temporal};
use serde_json::{Map, Value, json};

/// Evaluate core semantic fields without discarding unknown frontmatter.
///
/// # Errors
/// Rejects invalid field declarations; document problems are returned as issues.
pub fn evaluate(input: &Value) -> Result<Value> {
    let fields = input
        .get("fields")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let fm = input
        .get("frontmatter")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mapping =
        FieldMapping::from_fields(&fields, input.get("displayNameKey").and_then(Value::as_str))?;
    Ok(evaluate_mapped(
        &mapping,
        &fm,
        input.get("taskPath").and_then(Value::as_str),
        input.get("rejectUnknownFields") == Some(&Value::Bool(true)),
    ))
}

/// Evaluate one document using its resolved mapping and configured completion values.
/// Unknown properties remain informational unless the explicit closed-schema policy applies.
#[must_use]
pub fn evaluate_mapped(
    mapping: &FieldMapping,
    fm: &Map<String, Value>,
    path: Option<&str>,
    reject_unknown_fields: bool,
) -> Value {
    let normalized = mapping.normalize(fm);
    let mut issues = Vec::new();
    for (role, message) in [
        ("status", "missing required status"),
        ("dateCreated", "missing required date_created"),
        ("dateModified", "missing required date_modified"),
    ] {
        if blank(normalized.get(role)) {
            issue(
                &mut issues,
                "missing_required",
                "error",
                role,
                message,
                mapping,
            );
        }
    }
    if mapping
        .display_title(fm, path)
        .is_none_or(|s| s.trim().is_empty())
    {
        issue(
            &mut issues,
            "unresolvable_title",
            "error",
            "title",
            "title could not be resolved",
            mapping,
        );
    }
    validate_values(&normalized, &mut issues, mapping);
    issues.extend(crate::instances::issues_mapped(fm, mapping));
    if normalized
        .get("status")
        .and_then(Value::as_str)
        .is_some_and(|s| mapping.completed_statuses.iter().any(|c| s == c))
        && blank(normalized.get("completedDate"))
    {
        issue(
            &mut issues,
            "missing_required",
            "error",
            "completedDate",
            "completed_date is required for completed status",
            mapping,
        );
    }
    modified_order(&normalized, &mut issues, mapping);
    for key in fm.keys() {
        if !mapping.role_to_field.contains_key(key)
            && !mapping.role_to_field.values().any(|f| f == key)
            && !mapping.preserves_retired_field(key)
        {
            issues.push(json!({"code":"unknown_field","severity":if reject_unknown_fields{"error"}else{"info"},"field":key,"message":"field is not mapped to a known semantic role"}));
        }
    }
    let mut all = Vec::new();
    for issue in &issues {
        let code = issue["code"].clone();
        if !all.contains(&code) {
            all.push(code);
        }
    }
    let codes = |severity: &str| {
        issues
            .iter()
            .filter(|i| i["severity"] == severity)
            .map(|i| i["code"].clone())
            .collect::<Vec<_>>()
    };
    let errors = codes("error");
    json!({"hasErrors":!errors.is_empty(),"errorCodes":errors,"warningCodes":codes("warning"),"infoCodes":codes("info"),"allCodes":all,"issues":issues})
}

fn modified_order(
    normalized: &Map<String, Value>,
    issues: &mut Vec<Value>,
    mapping: &FieldMapping,
) {
    let Some(created) = normalized.get("dateCreated").and_then(Value::as_str) else {
        return;
    };
    let Some(modified) = normalized.get("dateModified").and_then(Value::as_str) else {
        return;
    };
    let before = if temporal::has_time(created) && temporal::has_time(modified) {
        temporal::parse_instant(created)
            .ok()
            .zip(temporal::parse_instant(modified).ok())
            .is_some_and(|(a, b)| b < a)
    } else {
        temporal::date_part(created)
            .ok()
            .zip(temporal::date_part(modified).ok())
            .is_some_and(|(a, b)| b < a)
    };
    if before {
        issue(
            issues,
            "date_modified_before_created",
            "error",
            "dateModified",
            "date_modified must be >= date_created",
            mapping,
        );
    }
}
fn blank(value: Option<&Value>) -> bool {
    value.is_none_or(|v| v.is_null() || v.as_str().is_some_and(|s| s.trim().is_empty()))
}
fn issue(
    issues: &mut Vec<Value>,
    code: &str,
    severity: &str,
    role: &str,
    message: &str,
    mapping: &FieldMapping,
) {
    issues.push(json!({"code":code,"severity":severity,"field":mapping.role_to_field.get(role).map_or(role,String::as_str),"message":message}));
}

fn validate_values(
    normalized: &Map<String, Value>,
    issues: &mut Vec<Value>,
    mapping: &FieldMapping,
) {
    for role in [
        "status",
        "due",
        "scheduled",
        "completedDate",
        "dateCreated",
        "dateModified",
    ] {
        if normalized
            .get(role)
            .is_some_and(|v| !v.is_null() && v != &json!("") && !v.is_string())
        {
            issue(
                issues,
                "invalid_type",
                "error",
                role,
                &format!("expected string for {role}"),
                mapping,
            );
        }
    }
    for role in ["tags", "contexts", "projects"] {
        if normalized
            .get(role)
            .is_some_and(|v| !v.is_null() && !v.is_array())
        {
            issue(
                issues,
                "invalid_type",
                "error",
                role,
                &format!("expected array for {role}"),
                mapping,
            );
        }
    }
    for role in [
        "due",
        "scheduled",
        "completedDate",
        "dateCreated",
        "dateModified",
    ] {
        if let Some(value) = normalized
            .get(role)
            .and_then(Value::as_str)
            .filter(|s| !s.trim().is_empty())
            && temporal::parse_utc_day(value).is_err()
        {
            issue(
                issues,
                "invalid_date_value",
                "error",
                role,
                &format!("invalid date value for {role}"),
                mapping,
            );
        }
    }
}
