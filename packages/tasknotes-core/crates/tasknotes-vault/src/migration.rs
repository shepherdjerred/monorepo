//! Explicit, deterministic legacy normalization preserving unknown fields.

use crate::{Result, VaultError, links, mapping, relationships, temporal};
use serde_json::{Map, Value, json};

/// Normalize known aliases without overwriting conflicting canonical values.
#[must_use]
pub fn aliases(frontmatter: &Map<String, Value>) -> (Map<String, Value>, Vec<Value>) {
    let mut result = frontmatter.clone();
    let mut issues = Vec::new();
    for (alias, value) in frontmatter {
        if let Some(canonical) = mapping::canonical_role(alias) {
            if canonical == alias {
                continue;
            }
            if let Some(existing) = result.get(canonical) {
                if existing != value {
                    issues.push(json!({"code":"alias_conflict_ignored","field":alias}));
                    continue;
                }
            } else {
                result.insert(canonical.into(), value.clone());
            }
            result.remove(alias);
        }
    }
    (result, issues)
}

/// Normalize legacy datetime spelling, preserving date-only and invalid values.
#[must_use]
pub fn temporal_value(value: &Value) -> Value {
    let Some(raw) = value.as_str() else {
        return value.clone();
    };
    let raw = raw.trim();
    if temporal::parse_day(raw).is_ok() {
        return value.clone();
    }
    let normalized = if raw.as_bytes().get(10) == Some(&b' ') {
        raw.replacen(' ', "T", 1)
    } else {
        raw.into()
    };
    temporal::parse_instant(&normalized).map_or_else(
        |_| value.clone(),
        |v| json!(v.to_rfc3339_opts(chrono::SecondsFormat::AutoSi, true)),
    )
}

/// Normalize dependencies with deterministic deduplication and preserved extras.
///
/// # Errors
/// Rejects invalid dependency syntax instead of silently retargeting it.
pub fn dependencies(entries: &[Value], default_reltype: &str) -> Result<Vec<Value>> {
    let default = default_reltype.trim().to_uppercase();
    let default = if relationships::RELATIONSHIP_TYPES.contains(&default.as_str()) {
        default.as_str()
    } else {
        "FINISHTOSTART"
    };
    let mut seen = Vec::new();
    let mut result = Vec::new();
    for entry in entries {
        let mut entry = entry
            .as_object()
            .cloned()
            .ok_or_else(|| invalid("invalid_dependency_entry"))?;
        let uid = relationships::dependency_identity(
            entry
                .get("uid")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("invalid_dependency_uid"))?,
        )?;
        if seen.contains(&uid) {
            continue;
        }
        seen.push(uid.clone());
        entry.insert("uid".into(), json!(format!("[[{uid}]]")));
        let rel = entry
            .get("reltype")
            .and_then(Value::as_str)
            .unwrap_or(default)
            .trim()
            .to_uppercase();
        let rel = if relationships::RELATIONSHIP_TYPES.contains(&rel.as_str()) {
            rel.as_str()
        } else {
            default
        };
        entry.insert("reltype".into(), json!(rel));
        result.push(json!(entry));
    }
    Ok(result)
}

/// Normalize reminder datetimes and assign missing IDs through an explicit source.
///
/// # Errors
/// Rejects invalid entries or duplicate supplied/generated IDs.
pub fn reminders<F>(
    entries: &[Value],
    generate: bool,
    mut allocate: F,
) -> Result<(Vec<Value>, usize)>
where
    F: FnMut() -> Result<String>,
{
    let mut seen = entries
        .iter()
        .filter_map(|v| v.get("id").and_then(Value::as_str))
        .filter(|s| !s.trim().is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let mut result = Vec::new();
    let mut generated = 0;
    for entry in entries {
        let mut entry = entry
            .as_object()
            .cloned()
            .ok_or_else(|| invalid("invalid_reminder_entry"))?;
        if generate
            && entry
                .get("id")
                .and_then(Value::as_str)
                .is_none_or(|s| s.trim().is_empty())
        {
            let id = allocate()?;
            if id.trim().is_empty() || seen.contains(&id) {
                return Err(invalid("duplicate_reminder_id"));
            }
            seen.push(id.clone());
            entry.insert("id".into(), json!(id));
            generated += 1;
        }
        if let Some(value) = entry.get("absoluteTime") {
            entry.insert("absoluteTime".into(), temporal_value(value));
        }
        result.push(json!(entry));
    }
    Ok((result, generated))
}

/// Normalize supported legacy representations without reading a host clock.
///
/// # Errors
/// Rejects invalid entries, missing ID allocation capability, or unsupported requests.
pub fn execute(operation: &str, input: &Value) -> Result<Value> {
    match operation {
        "migration.normalize_aliases" => {
            let (fm, issues) = aliases(&object(input, "frontmatter"));
            Ok(json!({"frontmatter":fm,"issues":issues}))
        }
        "migration.normalize_temporal" => {
            let mut fm = object(input, "frontmatter");
            for key in ["dateCreated", "dateModified", "absoluteTime"] {
                if let Some(value) = fm.get(key) {
                    fm.insert(key.into(), temporal_value(value));
                }
            }
            Ok(json!({"frontmatter":fm}))
        }
        "migration.resolve_instance_overlap" => {
            let mut complete = unique(input, "completeInstances");
            let mut skipped = unique(input, "skippedInstances");
            if text(input, "policy") == "prefer_skip" {
                complete.retain(|v| !skipped.contains(v));
            } else {
                skipped.retain(|v| !complete.contains(v));
            }
            Ok(json!({"completeInstances":complete,"skippedInstances":skipped}))
        }
        "migration.normalize_dependencies" => Ok(
            json!({"blockedBy":dependencies(array(input,"blockedBy"),input.get("defaultReltype").and_then(Value::as_str).unwrap_or("FINISHTOSTART"))?}),
        ),
        "migration.normalize_reminders" => {
            let mut counter = 0;
            let (entries, count) = reminders(
                array(input, "reminders"),
                input.get("generateIds") == Some(&Value::Bool(true)),
                || {
                    counter += 1;
                    Ok(format!("facet-migration-{counter}"))
                },
            )?;
            Ok(json!({"reminders":entries,"generated_ids":count.to_string()}))
        }
        "migration.normalize_links" => {
            let normalized = array(input, "links")
                .iter()
                .filter_map(Value::as_str)
                .map(|raw| {
                    links::parse(raw).map_or_else(
                        |_| raw.trim().to_owned(),
                        |l| {
                            format!(
                                "[[{}{}{}]]",
                                if l.format == "wikilink" {
                                    l.target.as_str()
                                } else {
                                    l.target.strip_suffix(".md").unwrap_or(&l.target)
                                },
                                l.anchor.map_or(String::new(), |s| format!("#{s}")),
                                l.alias.map_or(String::new(), |s| format!("|{s}"))
                            )
                        },
                    )
                })
                .collect::<Vec<_>>();
            Ok(json!({"normalized":normalized}))
        }
        "migration.compat_mode" => Ok(json!({"discoverable":true,"defaultsToEnabled":false})),
        "migration.report_summary" => Ok(
            json!({"spec_version_from":"legacy","spec_version_to":"0.3.0-rc.3","files_scanned":input.get("files_scanned").cloned().unwrap_or(json!(0)),"files_changed":input.get("files_changed").cloned().unwrap_or(json!(0)),"warnings":object(input,"warnings"),"changes":object(input,"changes")}),
        ),
        _ => Err(invalid("unsupported_operation")),
    }
}
fn unique(input: &Value, key: &str) -> Vec<String> {
    let mut result = Vec::new();
    for value in array(input, key).iter().filter_map(Value::as_str) {
        if !result.iter().any(|s| s == value) {
            result.push(value.to_owned());
        }
    }
    result
}
fn text<'a>(input: &'a Value, key: &str) -> &'a str {
    input.get(key).and_then(Value::as_str).unwrap_or_default()
}
fn object(input: &Value, key: &str) -> Map<String, Value> {
    input
        .get(key)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}
fn array<'a>(input: &'a Value, key: &str) -> &'a [Value] {
    input
        .get(key)
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice)
}
fn invalid(message: &str) -> VaultError {
    VaultError::Document(message.into())
}
