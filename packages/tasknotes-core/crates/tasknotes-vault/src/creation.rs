//! Deterministic creation defaults and configured filename templates.

use crate::{Result, VaultError, temporal};
use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use regex::Regex;
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;

/// The prepared bytes-independent creation result; hosts commit it atomically.
pub struct CreationPlan {
    /// Vault-relative Markdown destination.
    pub path: String,
    /// Preserved frontmatter with configured defaults applied.
    pub frontmatter: Map<String, Value>,
}

/// Execute the compatibility creation retry using a caller-owned storage effect.
///
/// # Errors
/// Preserves storage errors and rejects an unresolved configured destination.
pub fn create_with<F>(
    task_type: &Value,
    frontmatter: &Map<String, Value>,
    now: DateTime<Utc>,
    timezone: &str,
    mut storage: F,
) -> Result<CreationPlan>
where
    F: FnMut(Option<&str>, &Map<String, Value>) -> Result<CreationPlan>,
{
    let fm = defaults(task_type, frontmatter, now)?;
    match storage(None, &fm) {
        Ok(result) => {
            crate::path::VaultPath::parse(&result.path)?;
            return Ok(result);
        }
        Err(VaultError::Document(code)) if code == "path_required" => {}
        Err(error) => return Err(error),
    }
    let plan = plan(task_type, &fm, now, timezone)?;
    let result = storage(Some(&plan.path), &plan.frontmatter)?;
    crate::path::VaultPath::parse(&result.path)?;
    Ok(result)
}

/// Plan a creation with explicit time and IANA timezone.
///
/// # Errors
/// Rejects malformed type declarations, missing template tokens, and unsafe paths.
pub fn plan(
    task_type: &Value,
    frontmatter: &Map<String, Value>,
    now: DateTime<Utc>,
    timezone: &str,
) -> Result<CreationPlan> {
    let task_type = task_type
        .as_object()
        .ok_or_else(|| invalid("invalid_task_type"))?;
    let fm = defaults(&Value::Object(task_type.clone()), frontmatter, now)?;
    let template = task_type
        .get("path_pattern")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| invalid("path_required"))?;
    let values = template_values(&fm, now, timezone)?;
    let tokens =
        Regex::new(r"\{\{(\w+)\}\}|\{(\w+)\}").map_err(|_| invalid("internal_template_pattern"))?;
    let mut missing = false;
    let rendered = tokens.replace_all(template, |captures: &regex::Captures<'_>| {
        let key = captures
            .get(1)
            .or_else(|| captures.get(2))
            .map_or("", |m| m.as_str());
        if let Some(value) = values.get(key).filter(|v| !v.trim().is_empty()) {
            value.clone()
        } else {
            missing = true;
            String::new()
        }
    });
    if missing {
        return Err(invalid("path_required"));
    }
    let path = rendered
        .replace('\\', "/")
        .split('/')
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != ".")
        .collect::<Vec<_>>()
        .join("/");
    if path.is_empty() || path.contains("..") || path.contains(['\0', '{', '}']) {
        return Err(invalid("path_required"));
    }
    let path = if std::path::Path::new(&path)
        .extension()
        .is_some_and(|e| e == "md")
    {
        path
    } else {
        format!("{path}.md")
    };
    crate::path::VaultPath::parse(&path)?;
    Ok(CreationPlan {
        path,
        frontmatter: fm,
    })
}

fn apply_match_defaults(fm: &mut Map<String, Value>, conditions: &Map<String, Value>) {
    for (field, condition) in conditions {
        if condition.is_null() {
            continue;
        }
        if let Some(ops) = condition.as_object() {
            if let Some(eq) = ops.get("eq") {
                if !fm.get(field).is_some_and(has_value) {
                    fm.insert(field.clone(), eq.clone());
                }
                continue;
            }
            if let Some(expected) = ops.get("contains") {
                match fm.get_mut(field) {
                    Some(Value::Array(current)) => {
                        if !current.iter().any(|v| scalar(v) == scalar(expected)) {
                            current.push(expected.clone());
                        }
                    }
                    Some(Value::String(current)) => {
                        let expected = scalar(expected).unwrap_or_default();
                        if !current.contains(&expected) {
                            format!("{current} {expected}").trim().clone_into(current);
                        }
                    }
                    other => {
                        if !other.is_some_and(|v| has_value(v)) {
                            fm.insert(field.clone(), json!([expected]));
                        }
                    }
                }
                continue;
            }
            if ops.get("exists") == Some(&Value::Bool(true))
                && !fm.get(field).is_some_and(has_value)
            {
                fm.insert(field.clone(), Value::Bool(true));
            }
        } else if !fm.get(field).is_some_and(has_value) {
            fm.insert(field.clone(), condition.clone());
        }
    }
}

/// Build supported template tokens without consulting the host environment.
///
/// # Errors
/// Rejects unknown IANA timezone identifiers.
pub fn template_values(
    fm: &Map<String, Value>,
    now: DateTime<Utc>,
    timezone: &str,
) -> Result<BTreeMap<String, String>> {
    let zone: Tz = timezone.parse().map_err(|_| invalid("invalid_timezone"))?;
    let now = now.with_timezone(&zone);
    let raw_title = fm
        .get("title")
        .and_then(scalar)
        .unwrap_or_else(|| "task".into());
    let words = raw_title
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>();
    let title = sanitize(&raw_title);
    let mut values = BTreeMap::new();
    values.insert("title".into(), title);
    for (key, fallback) in [("priority", "normal"), ("status", "open")] {
        let full = sanitize(
            &fm.get(key)
                .and_then(scalar)
                .unwrap_or_else(|| fallback.into()),
        );
        values.insert(
            format!("{key}Short"),
            full.chars().take(3).collect::<String>().to_lowercase(),
        );
        values.insert(key.into(), full);
    }
    for key in ["due", "scheduled"] {
        let value = fm.get(key).and_then(scalar).unwrap_or_default();
        values.insert(key.into(), value.clone());
        values.insert(format!("{key}Date"), value);
    }
    for (key, separator) in [("titleKebab", "-"), ("titleSnake", "_")] {
        values.insert(
            key.into(),
            words
                .iter()
                .map(|s| s.to_lowercase())
                .collect::<Vec<_>>()
                .join(separator),
        );
    }
    values.insert(
        "titleCamel".into(),
        words
            .iter()
            .enumerate()
            .map(|(i, w)| {
                if i == 0 {
                    w.to_lowercase()
                } else {
                    capitalize(w)
                }
            })
            .collect(),
    );
    values.insert(
        "titlePascal".into(),
        words.iter().map(|w| capitalize(w)).collect(),
    );
    values.insert("titleUpper".into(), raw_title.to_uppercase());
    values.insert("titleLower".into(), raw_title.to_lowercase());
    for key in ["contexts", "projects", "tags"] {
        let value = fm
            .get(key)
            .map(|v| {
                if let Some(a) = v.as_array() {
                    a.iter()
                        .filter_map(scalar)
                        .map(|s| sanitize(&s))
                        .collect::<Vec<_>>()
                        .join("-")
                } else {
                    scalar(v).map_or(String::new(), |s| sanitize(&s))
                }
            })
            .unwrap_or_default();
        values.insert(key.into(), value);
    }
    for (key, format) in [
        ("year", "%Y"),
        ("month", "%m"),
        ("monthName", "%B"),
        ("monthNameShort", "%b"),
        ("day", "%d"),
        ("date", "%Y-%m-%d"),
        ("shortDate", "%Y%m%d"),
        ("time", "%H%M%S"),
        ("timestamp", "%Y%m%d%H%M%S"),
        ("week", "%V"),
        ("zettel", "%Y%m%d%H%M%S"),
    ] {
        values.insert(key.into(), now.format(format).to_string());
    }
    extra_values(fm, &mut values);
    Ok(values)
}

fn extra_values(fm: &Map<String, Value>, values: &mut BTreeMap<String, String>) {
    for (key, value) in fm {
        if !values.contains_key(key)
            && let Some(value) = value.as_str()
        {
            values.insert(key.clone(), sanitize(value));
        }
    }
}

/// Decode explicit creation time supplied by the caller.
///
/// # Errors
/// Rejects invalid timestamps.
pub fn timestamp(value: &str) -> Result<DateTime<Utc>> {
    temporal::parse_instant(value)
}
fn sanitize(value: &str) -> String {
    value
        .trim()
        .chars()
        .filter(|c| !['<', '>', ':', '"', '|', '?', '*'].contains(c) && u32::from(*c) > 31)
        .map(|c| if c == '/' || c == '\\' { '-' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
fn scalar(value: &Value) -> Option<String> {
    match value {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_owned()),
        Value::Number(_) | Value::Bool(_) => Some(value.to_string()),
        _ => None,
    }
}
fn has_value(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(s) => !s.trim().is_empty(),
        Value::Array(a) => !a.is_empty(),
        _ => true,
    }
}
fn capitalize(value: &str) -> String {
    let mut chars = value.chars();
    chars.next().map_or(String::new(), |c| {
        format!("{}{}", c.to_uppercase(), chars.as_str().to_lowercase())
    })
}
fn invalid(value: &str) -> VaultError {
    VaultError::Document(value.into())
}

/// Apply configured defaults without requiring a configured destination.
///
/// # Errors
/// Rejects malformed task type or field declarations.
pub fn defaults(
    task_type: &Value,
    frontmatter: &Map<String, Value>,
    now: DateTime<Utc>,
) -> Result<Map<String, Value>> {
    let fields = task_type
        .get("fields")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("invalid_field_schema"))?;
    let mut fm = frontmatter.clone();
    for (name, definition) in fields {
        let definition = definition
            .as_object()
            .ok_or_else(|| invalid("invalid_field_schema"))?;
        if !fm.get(name).is_some_and(has_value)
            && let Some(default) = definition.get("default")
        {
            fm.insert(name.clone(), default.clone());
        }
    }
    for name in ["dateCreated", "dateModified"] {
        if fields.contains_key(name) && !fm.get(name).is_some_and(has_value) {
            fm.insert(
                name.into(),
                json!(now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
            );
        }
    }
    if let Some(conditions) = task_type
        .get("match")
        .and_then(|v| v.get("where"))
        .and_then(Value::as_object)
    {
        apply_match_defaults(&mut fm, conditions);
    }

    Ok(fm)
}
