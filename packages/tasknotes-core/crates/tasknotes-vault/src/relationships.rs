//! Dependency and reminder validation, independent of storage and scheduling I/O.

use std::collections::BTreeSet;

use serde_json::{Map, Value};

use crate::{Result, VaultError, temporal};

/// The four standardized dependency relationship types.
pub const RELATIONSHIP_TYPES: [&str; 4] = [
    "FINISHTOSTART",
    "STARTTOSTART",
    "FINISHTOFINISH",
    "STARTTOFINISH",
];

/// Validate a signed ISO 8601 duration without accepting trailing garbage.
#[must_use]
pub fn valid_duration(value: &str) -> bool {
    let value = value.strip_prefix('-').unwrap_or(value);
    let Some(body) = value.strip_prefix('P') else {
        return false;
    };
    let mut time = false;
    let mut digits = String::new();
    let mut units = BTreeSet::new();
    let mut any = false;
    let mut previous = 0;
    for character in body.chars() {
        if character == 'T' {
            if time || !digits.is_empty() {
                return false;
            }
            time = true;
            previous = 0;
            continue;
        }
        if character.is_ascii_digit() || character == '.' {
            digits.push(character);
            continue;
        }
        let order = match (time, character) {
            (false, 'Y') | (true, 'H') => 1,
            (false | true, 'M') => 2,
            (false, 'W') | (true, 'S') => 3,
            (false, 'D') => 4,
            _ => return false,
        };
        if digits.is_empty()
            || !digits
                .parse::<f64>()
                .is_ok_and(|number| number.is_finite() && number >= 0.0)
            || order < previous
            || !units.insert((time, character))
        {
            return false;
        }
        digits.clear();
        previous = order;
        any = true;
    }
    any && digits.is_empty() && !body.ends_with('T')
}

/// Canonical dependency identity, with Markdown/wikilink aliases removed.
///
/// # Errors
/// Rejects blank or malformed link-shaped identities.
pub fn dependency_identity(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(invalid("invalid_dependency_entry"));
    }
    let target = if let Some(inner) = value.strip_prefix("[[").and_then(|v| v.strip_suffix("]]")) {
        inner
            .split(['#', '|'])
            .next()
            .ok_or_else(|| invalid("invalid_dependency_entry"))?
    } else if value.starts_with('[') {
        let (_, target) = value
            .split_once("](")
            .ok_or_else(|| invalid("invalid_dependency_entry"))?;
        target
            .strip_suffix(')')
            .ok_or_else(|| invalid("invalid_dependency_entry"))?
            .split('#')
            .next()
            .ok_or_else(|| invalid("invalid_dependency_entry"))?
    } else {
        value
    };
    let target = target
        .trim()
        .strip_prefix("./")
        .unwrap_or(target.trim())
        .trim_start_matches('/');
    let target = if target.to_ascii_lowercase().ends_with(".md") {
        target
            .get(..target.len().saturating_sub(3))
            .ok_or_else(|| invalid("invalid_dependency_entry"))?
    } else {
        target
    };
    if target.is_empty() || target.chars().any(char::is_control) {
        return Err(invalid("invalid_dependency_entry"));
    }
    Ok(target.to_owned())
}

/// Validate one dependency, retaining arbitrary extension properties in its owner.
///
/// # Errors
/// Rejects malformed identities, unknown relationship types, and invalid gaps.
pub fn validate_dependency(entry: &Value) -> Result<String> {
    let object = entry
        .as_object()
        .ok_or_else(|| invalid("invalid_dependency_entry"))?;
    let uid = dependency_identity(text(object, "uid"))?;
    if !RELATIONSHIP_TYPES.contains(&text(object, "reltype").trim()) {
        return Err(invalid("invalid_dependency_reltype"));
    }
    if let Some(gap) = object.get("gap")
        && !gap.as_str().is_some_and(valid_duration)
    {
        return Err(invalid("invalid_dependency_gap"));
    }
    Ok(uid)
}

/// Validate dependency uniqueness and self-reference after identity normalization.
///
/// # Errors
/// Rejects invalid, duplicated, or self-referencing dependencies.
pub fn validate_dependencies(entries: &[Value], task_uid: Option<&str>) -> Result<()> {
    let own = task_uid.map(dependency_identity).transpose()?;
    let mut seen = BTreeSet::new();
    for entry in entries {
        let uid = validate_dependency(entry)?;
        if own.as_ref() == Some(&uid) {
            return Err(invalid("self_dependency"));
        }
        if !seen.insert(uid) {
            return Err(invalid("duplicate_dependency_uid"));
        }
    }
    Ok(())
}

/// Validate one reminder's tagged absolute/relative representation.
///
/// # Errors
/// Rejects missing IDs, unknown types, invalid instants/bases, and invalid offsets.
pub fn validate_reminder(entry: &Value) -> Result<()> {
    let object = entry
        .as_object()
        .ok_or_else(|| invalid("invalid_reminder_entry"))?;
    if text(object, "id").trim().is_empty() {
        return Err(invalid("invalid_reminder_entry"));
    }
    match text(object, "type").trim() {
        "absolute" => {
            temporal::parse_instant(text(object, "absoluteTime").trim())
                .map_err(|_| invalid("invalid_reminder_absolute_time"))?;
        }
        "relative" => {
            if !["due", "scheduled"].contains(&text(object, "relatedTo").trim()) {
                return Err(invalid("invalid_reminder_related_to"));
            }
            if !valid_duration(text(object, "offset").trim()) {
                return Err(invalid("invalid_reminder_offset"));
            }
        }
        _ => return Err(invalid("invalid_reminder_type")),
    }
    Ok(())
}

/// Validate reminder identities and resolvable bases for one task commit.
///
/// # Errors
/// Rejects invalid reminders, duplicate IDs, or an unavailable relative base.
pub fn validate_reminders(entries: &[Value], properties: &Map<String, Value>) -> Result<()> {
    let mut seen = BTreeSet::new();
    for entry in entries {
        validate_reminder(entry)?;
        let object = entry
            .as_object()
            .ok_or_else(|| invalid("invalid_reminder_entry"))?;
        if !seen.insert(text(object, "id")) {
            return Err(invalid("duplicate_reminder_id"));
        }
        if text(object, "type") == "relative" {
            let base = properties
                .get(text(object, "relatedTo"))
                .and_then(Value::as_str)
                .filter(|value| !value.trim().is_empty());
            if base.is_none() {
                return Err(invalid("unresolvable_reminder_base"));
            }
        }
    }
    Ok(())
}

fn text<'a>(object: &'a Map<String, Value>, key: &str) -> &'a str {
    object.get(key).and_then(Value::as_str).unwrap_or_default()
}
fn invalid(message: &str) -> VaultError {
    VaultError::Document(message.to_owned())
}
