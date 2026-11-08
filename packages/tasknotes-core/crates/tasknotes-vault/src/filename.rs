//! Deterministic production basenames and platform-safe collision plans.

use crate::{Result, VaultError};
use serde_json::{Map, Value};

/// A selected filename whose title-preservation verdict travels with the journal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilenamePlan {
    /// Exact logical destination including its Markdown extension.
    pub path: String,
    /// The filename cannot losslessly represent the semantic title.
    pub retain_title: bool,
    /// A component or total path limit required a short deterministic name.
    pub shortened: bool,
}

/// Apply the pinned basename sanitization and Windows device-name boundary.
#[must_use]
pub fn sanitize(value: &str) -> String {
    let collapsed = value
        .split(crate::templating::js_whitespace)
        .filter(|piece| !piece.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let clean = collapsed
        .chars()
        .filter(|c| !"<>:\"/\\|?*#[]".contains(*c) && !c.is_control())
        .collect::<String>();
    let clean = clean.trim_matches('.').trim();
    let mut clean = if clean.is_empty() {
        "untitled".to_owned()
    } else {
        clean.to_owned()
    };
    let device = clean.split('.').next().unwrap_or("").to_uppercase();
    let numbered = device
        .strip_prefix("COM")
        .or_else(|| device.strip_prefix("LPT"));
    if ["CON", "PRN", "AUX", "NUL"].contains(&device.as_str())
        || numbered.is_some_and(|n| {
            n.len() == 1 && "123456789".contains(n) || ["¹", "²", "³"].contains(&n)
        })
    {
        clean = format!("task-{clean}");
    }
    clean
}

/// Generate a production basename using the original instant and caller entropy.
///
/// # Errors
/// Rejects unsupported formats, invalid local context, or missing requested UUID entropy.
pub fn basename(
    title: &str,
    policy: &Value,
    properties: &Map<String, Value>,
    at: chrono::DateTime<chrono::Utc>,
    timezone: &str,
    uuid: Option<&str>,
) -> Result<String> {
    if title.trim().is_empty() {
        return Err(invalid("task title is required"));
    }
    if policy.get("storage").and_then(Value::as_str) == Some("filename") {
        return Ok(sanitize(title));
    }
    let mut values = filename_values(title, properties, at, timezone)?;
    let format = policy
        .get("filename_format")
        .and_then(Value::as_str)
        .unwrap_or("zettel");
    match format {
        "title" => Ok(sanitize(title)),
        "slug" => Ok(sanitize(
            &title
                .to_lowercase()
                .split(crate::templating::js_whitespace)
                .filter(|piece| !piece.is_empty())
                .collect::<Vec<_>>()
                .join("-"),
        )),
        "zettel" => scalar(&values, "zettel"),
        "timestamp" => scalar(&values, "timestamp"),
        "uuid" => uuid_value(uuid),
        "custom" => render_custom(title, policy, &mut values, uuid),
        _ => Err(invalid("unsupported filename format")),
    }
}

fn filename_values(
    title: &str,
    properties: &Map<String, Value>,
    at: chrono::DateTime<chrono::Utc>,
    timezone: &str,
) -> Result<Map<String, Value>> {
    let mut values = crate::templating::production_values(
        properties,
        properties
            .get("details")
            .and_then(Value::as_str)
            .unwrap_or(""),
        at,
        timezone,
    )?;
    values.insert("title".into(), Value::String(sanitize(title)));
    let zone: chrono_tz::Tz = timezone.parse().map_err(|_| invalid("invalid_timezone"))?;
    values.insert(
        "time".into(),
        Value::String(at.with_timezone(&zone).format("%H%M%S").to_string()),
    );
    let priority = properties
        .get("priority")
        .and_then(Value::as_str)
        .filter(|v| ["low", "normal", "medium", "high"].contains(v))
        .unwrap_or("normal");
    let status = properties
        .get("status")
        .and_then(Value::as_str)
        .map_or_else(|| "open".into(), sanitize);
    values.insert("priority".into(), Value::String(priority.into()));
    values.insert(
        "priorityShort".into(),
        Value::String(priority.chars().take(1).collect::<String>().to_uppercase()),
    );
    values.insert("status".into(), Value::String(status.clone()));
    values.insert(
        "statusShort".into(),
        Value::String(status.chars().take(1).collect::<String>().to_uppercase()),
    );
    let safe_title = sanitize(title);
    values.extend(crate::templating::title_variants(&safe_title)?);
    let mut units = 0;
    let details = properties
        .get("details")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= 50
        })
        .collect::<String>();
    values.insert("details".into(), Value::String(sanitize_optional(&details)));
    values.insert(
        "parentNote".into(),
        Value::String(sanitize_optional(
            properties
                .get("parentNote")
                .and_then(Value::as_str)
                .unwrap_or(""),
        )),
    );
    list_values(&mut values, properties);
    Ok(values)
}

fn list_values(values: &mut Map<String, Value>, properties: &Map<String, Value>) {
    for (field, single, separator) in [
        ("contexts", "context", "/"),
        ("projects", "project", "/"),
        ("tags", "", " , "),
    ] {
        let list = sanitized_list(properties, field);
        values.insert(
            field.into(),
            Value::String(list.join(if field == "tags" { ", " } else { separator })),
        );
        if !single.is_empty() {
            values.insert(
                single.into(),
                Value::String(list.first().cloned().unwrap_or_default()),
            );
        }
        if field == "projects" {
            values.insert(
                "projectId".into(),
                Value::String(
                    list.first()
                        .map(|s| {
                            s.chars()
                                .filter(char::is_ascii_alphanumeric)
                                .take(4)
                                .collect::<String>()
                                .to_uppercase()
                        })
                        .unwrap_or_default(),
                ),
            );
        }
        if field == "tags" {
            values.insert(
                "hashtags".into(),
                Value::String(
                    list.iter()
                        .map(|v| format!("#{v}"))
                        .collect::<Vec<_>>()
                        .join(" "),
                ),
            );
        }
    }
}

fn sanitized_list(properties: &Map<String, Value>, field: &str) -> Vec<String> {
    properties
        .get(field)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter_map(|value| {
                    let display = if field == "projects" {
                        value
                            .strip_prefix("[[")
                            .and_then(|s| s.strip_suffix("]]"))
                            .map_or(value, |s| {
                                s.split_once('|').map_or_else(
                                    || s.rsplit('/').next().unwrap_or(s),
                                    |(_, alias)| alias,
                                )
                            })
                    } else {
                        value
                    };
                    if field == "projects"
                        && display
                            .trim_matches(crate::templating::js_whitespace)
                            .is_empty()
                    {
                        None
                    } else {
                        Some(sanitize(display))
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

fn render_custom(
    title: &str,
    policy: &Value,
    values: &mut Map<String, Value>,
    uuid: Option<&str>,
) -> Result<String> {
    let template = policy
        .get("custom_filename_template")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| invalid("custom filename template missing"))?;
    if template.encode_utf16().count() > 500 {
        return Err(invalid("custom filename template exceeds limit"));
    }
    if template.contains("{uuid}") {
        values.insert("uuid".into(), Value::String(uuid_value(uuid)?));
    }
    let tokens = regex::Regex::new(r"\{\{([^{}]*)\}\}|\{([^{}]*)\}")
        .map_err(|_| invalid("internal_template_pattern"))?;
    let rendered = tokens.replace_all(template, |c: &regex::Captures<'_>| {
        c.get(1)
            .or_else(|| c.get(2))
            .and_then(|v| values.get(v.as_str()))
            .map_or_else(String::new, |v| {
                v.as_str().map_or_else(|| v.to_string(), str::to_owned)
            })
    });
    Ok(sanitize(if rendered.trim().is_empty() {
        title
    } else {
        &rendered
    }))
}

fn uuid_value(value: Option<&str>) -> Result<String> {
    let value = value.ok_or_else(|| invalid("UUID filename requires caller UUID entropy"))?;
    if value.len() != 36
        || !value.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
    {
        return Err(invalid("UUID filename requires caller UUID entropy"));
    }
    Ok(value.to_ascii_lowercase())
}
fn sanitize_optional(value: &str) -> String {
    if value.is_empty() {
        String::new()
    } else {
        sanitize(value)
    }
}
fn scalar(values: &Map<String, Value>, key: &str) -> Result<String> {
    values
        .get(key)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| invalid("filename variable missing"))
}

/// Select an unused destination; availability checks are read-only planning inputs.
/// The host's later coordinated compare-and-exchange remains authoritative.
///
/// # Errors
/// Propagates provider failures, unsafe folders, and exhausted collision destinations.
pub fn select<F>(
    folder: &str,
    stem: &str,
    title: &str,
    clock_ms: i64,
    mut exists: F,
) -> Result<FilenamePlan>
where
    F: FnMut(&str) -> Result<bool>,
{
    if !folder.is_empty() {
        crate::path::VaultPath::parse(&format!("{folder}/probe.md"))?;
    }
    if folder
        .split('/')
        .any(|component| component.len() > 255 || component.encode_utf16().count() > 255)
    {
        return Err(invalid("configured folder exceeds component limit"));
    }
    let stem = sanitize(stem);
    let make = |name: &str| {
        if folder.is_empty() {
            format!("{name}.md")
        } else {
            format!("{folder}/{name}.md")
        }
    };
    let bounded = |name: &str, path: &str| {
        name.len() + 3 <= 255
            && name.encode_utf16().count() + 3 <= 255
            && path.encode_utf16().count() <= 260
    };
    let path = make(&stem);
    if bounded(&stem, &path) {
        for index in 1..=999 {
            let name = if index == 1 {
                stem.clone()
            } else {
                format!("{stem}-{index}")
            };
            let path = make(&name);
            if !bounded(&name, &path) {
                break;
            }
            if !exists(&path)? {
                return Ok(FilenamePlan {
                    path,
                    retain_title: title != name,
                    shortened: false,
                });
            }
        }
        let prefix = stem.chars().take(50).collect::<String>();
        let name = format!("{prefix}-{}", radix36(clock_ms)?);
        let path = make(&name);
        if bounded(&name, &path) && !exists(&path)? {
            return Ok(FilenamePlan {
                path,
                retain_title: true,
                shortened: false,
            });
        }
    }
    let name = format!("task-{}", radix36(clock_ms)?);
    let path = make(&name);
    if !bounded(&name, &path) || exists(&path)? {
        return Err(VaultError::Conflict);
    }
    Ok(FilenamePlan {
        path,
        retain_title: true,
        shortened: true,
    })
}
fn radix36(value: i64) -> Result<String> {
    let mut n = value.unsigned_abs();
    let mut chars = Vec::new();
    loop {
        let digit = u32::try_from(n % 36).map_err(|_| invalid("internal_radix_digit"))?;
        chars.push(char::from_digit(digit, 36).ok_or_else(|| invalid("internal_radix_digit"))?);
        n /= 36;
        if n == 0 {
            break;
        }
    }
    let mut result = chars.into_iter().rev().collect::<String>();
    if value < 0 {
        result.insert(0, '-');
    }
    Ok(result)
}
fn invalid(message: &str) -> VaultError {
    VaultError::Document(message.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn title_storage_wins_format_and_lossy_titles_have_explicit_verdict() -> Result<()> {
        let at = crate::temporal::parse_instant("2026-10-07T19:00:00Z")?;
        let name = basename(
            "A/B",
            &json!({"storage":"filename","filename_format":"uuid"}),
            &Map::new(),
            at,
            "UTC",
            None,
        )?;
        assert_eq!(name, "AB");
        let result = select("Tasks", &name, "A/B", at.timestamp_millis(), |_| Ok(false))?;
        assert!(result.retain_title);
        assert!(!result.shortened);
        assert_eq!(result.path, "Tasks/AB.md");
        Ok(())
    }
    #[test]
    fn collision_suffixes_shortened_paths_and_unusable_fallbacks_are_fenced() -> Result<()> {
        let result = select("Tasks", "Title", "Title", 42, |path| {
            Ok(path == "Tasks/Title.md")
        })?;
        assert_eq!(result.path, "Tasks/Title-2.md");
        assert!(result.retain_title);
        let result = select("Tasks", &"😀".repeat(90), "large", 42, |_| Ok(false))?;
        assert_eq!(result.path, "Tasks/task-16.md");
        assert!(result.shortened);
        assert_eq!(
            select("Tasks", &"x".repeat(300), "large", 42, |_| Ok(true)).err(),
            Some(VaultError::Conflict)
        );
        Ok(())
    }
    #[test]
    fn reserved_aliases_and_timestamps_use_shared_platform_policy() -> Result<()> {
        assert_eq!(sanitize("COM1.txt"), "task-COM1.txt");
        assert_eq!(sanitize("lpt²"), "task-lpt²");
        let at = crate::temporal::parse_instant("2026-10-07T19:00:00Z")?;
        assert_eq!(
            basename(
                "Title",
                &json!({"storage":"frontmatter","filename_format":"timestamp"}),
                &Map::new(),
                at,
                "America/Los_Angeles",
                None
            )?,
            "2026-10-07-120000"
        );
        assert!(
            basename(
                "Title",
                &json!({"storage":"frontmatter","filename_format":"uuid"}),
                &Map::new(),
                at,
                "UTC",
                None
            )
            .is_err()
        );
        Ok(())
    }
}
