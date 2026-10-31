//! Create-time text expansion and frontmatter precedence.

use crate::{Result, VaultError};
use regex::Regex;
use serde_json::{Map, Value, json};

mod production;
pub use production::{expand_frontmatter, production_sections, production_values};
pub(crate) use production::{js_whitespace, title_variants};

/// Build portable body-template variables from semantic task data and an explicit clock.
///
/// # Errors
/// Rejects unknown IANA zones and invalid configured task dates.
pub fn values(
    frontmatter: &Map<String, Value>,
    body: &str,
    now: chrono::DateTime<chrono::Utc>,
    timezone: &str,
) -> Result<Map<String, Value>> {
    let zone: chrono_tz::Tz = timezone.parse().map_err(|_| invalid("invalid_timezone"))?;
    let local = now.with_timezone(&zone);
    let mut values = crate::creation::template_values(frontmatter, now, timezone)?
        .into_iter()
        .map(|(key, value)| (key, json!(value)))
        .collect::<Map<_, _>>();
    for key in ["title", "status", "priority", "parentNote"] {
        values.insert(
            key.to_owned(),
            frontmatter.get(key).cloned().unwrap_or_else(|| json!("")),
        );
    }
    for (role, token) in [("due", "dueDate"), ("scheduled", "scheduledDate")] {
        let value = frontmatter
            .get(role)
            .and_then(Value::as_str)
            .map(crate::temporal::date_part)
            .transpose()?
            .map(|v| v.to_string())
            .unwrap_or_default();
        values.insert(token.to_owned(), json!(value));
    }
    values.insert("details".to_owned(), json!(body));
    for key in ["contexts", "tags"] {
        let list = frontmatter
            .get(key)
            .and_then(Value::as_array)
            .map(|v| v.iter().filter_map(Value::as_str).collect::<Vec<_>>())
            .unwrap_or_default();
        if key == "tags" {
            values.insert(
                "hashtags".to_owned(),
                json!(
                    list.iter()
                        .map(|v| format!("#{}", v.trim_start_matches('#')))
                        .collect::<Vec<_>>()
                        .join(" ")
                ),
            );
        }
        values.insert(key.to_owned(), json!(list.join(", ")));
    }
    for (key, format) in [
        ("time", "%H:%M"),
        ("dateTime", "%Y-%m-%d-%H%M"),
        ("timestamp", "%Y-%m-%d-%H%M%S"),
        ("shortDate", "%y%m%d"),
        ("shortYear", "%y"),
        ("dayName", "%A"),
        ("dayNameShort", "%a"),
        ("hour", "%H"),
        ("minute", "%M"),
        ("second", "%S"),
        ("time12", "%I:%M %p"),
        ("time24", "%H:%M"),
        ("timezone", "%:z"),
        ("utcOffset", "%:z"),
    ] {
        values.insert(key.to_owned(), json!(local.format(format).to_string()));
    }
    values.insert("unix".to_owned(), json!(now.timestamp().to_string()));
    values.insert(
        "unixMs".to_owned(),
        json!(now.timestamp_millis().to_string()),
    );
    Ok(values)
}

/// Separate YAML frontmatter text from a Markdown template body.
///
/// # Errors
/// Rejects an unclosed leading frontmatter delimiter.
pub fn sections(template: &str) -> Result<(String, String)> {
    let normalized = template.replace("\r\n", "\n");
    if let Some(rest) = normalized.strip_prefix("---\n") {
        let end = rest
            .find("\n---")
            .ok_or_else(|| invalid("template_parse_failed"))?;
        let front = rest
            .get(..end)
            .ok_or_else(|| invalid("template_parse_failed"))?;
        let body = rest
            .get(end + 4..)
            .ok_or_else(|| invalid("template_parse_failed"))?
            .trim_start_matches('\n');
        Ok((front.into(), body.into()))
    } else {
        Ok((String::new(), template.into()))
    }
}

/// Expand recognized tokens using an explicit unknown-token policy.
///
/// # Errors
/// Rejects unknown policies or unknown tokens under the error policy.
pub fn expand(template: &str, values: &Map<String, Value>, policy: &str) -> Result<String> {
    if !["preserve", "empty", "error"].contains(&policy) {
        return Err(invalid("invalid_unknown_variable_policy"));
    }
    let pattern = Regex::new(r"\{\{(\w+)\}\}").map_err(|_| invalid("internal_template_pattern"))?;
    let mut unknown = false;
    let value = pattern.replace_all(template, |c: &regex::Captures<'_>| {
        let key = c.get(1).map_or("", |m| m.as_str());
        if let Some(value) = values.get(key) {
            value
                .as_str()
                .map_or_else(|| value.to_string(), str::to_owned)
        } else {
            unknown = true;
            if policy == "empty" {
                String::new()
            } else {
                c.get(0).map_or("", |m| m.as_str()).to_owned()
            }
        }
    });
    if unknown && policy == "error" {
        return Err(invalid("unknown_template_variable"));
    }
    Ok(value.into_owned())
}

/// Merge template fields with explicit creation data taking precedence.
#[must_use]
pub fn merge(base: &Map<String, Value>, template: &Map<String, Value>) -> Map<String, Value> {
    let mut merged = template.clone();
    merged.extend(base.clone());
    merged
}

/// Evaluate a pure template operation, without reading expectation-shaped fields.
///
/// # Errors
/// Rejects invalid templates, policies, and failed required template loads.
pub fn execute(operation: &str, input: &Value) -> Result<Value> {
    match operation {
        "templating.parse_sections" => {
            let (fm, body) = sections(text(input, "templateText"))?;
            Ok(json!({"frontmatterRaw":fm,"body":body}))
        }
        "templating.expand_variables" => Ok(
            json!({"value":expand(text(input,"template"),&object(input,"values"),input.get("unknownVariablePolicy").and_then(Value::as_str).unwrap_or("preserve"))?}),
        ),
        "templating.tokenize" => {
            let pattern =
                Regex::new(r"\{\{(\w+)\}\}").map_err(|_| invalid("internal_template_pattern"))?;
            Ok(
                json!({"tokens":pattern.captures_iter(text(input,"template")).filter_map(|c|c.get(1).map(|m|m.as_str().to_owned())).collect::<Vec<_>>()}),
            )
        }
        "templating.merge_frontmatter" => Ok(
            json!({"value":merge(&object(input,"baseFrontmatter"),&object(input,"templateFrontmatter"))}),
        ),
        "templating.create_pipeline" => Ok(
            json!({"frontmatter":merge(&object(input,"baseFrontmatter"),&object(input,"templateFrontmatter")),"body":if text(input,"templateBody").trim().is_empty(){text(input,"callerBody")}else{text(input,"templateBody")}}),
        ),
        "templating.handle_failure" => {
            if ["error", "error_abort"].contains(&text(input, "failureMode")) {
                return Err(invalid(
                    input
                        .get("errorCode")
                        .and_then(Value::as_str)
                        .unwrap_or("template_error"),
                ));
            }
            if text(input, "failureMode") != "warning_fallback" {
                return Err(invalid("invalid_template_failure_mode"));
            }
            Ok(json!({"mode":"fallback"}))
        }
        "templating.config_defaults" => Ok(
            json!({"failure_mode":input.get("failure_mode").and_then(Value::as_str).unwrap_or("warning_fallback"),"unknown_variable_policy":input.get("unknown_variable_policy").and_then(Value::as_str).unwrap_or("preserve")}),
        ),
        "templating.profile_claim_requirements" => {
            if [
                "supports_create_time_templating",
                "supports_failure_mode",
                "supports_variable_set",
            ]
            .iter()
            .any(|key| input.get(*key) != Some(&Value::Bool(true)))
            {
                return Err(invalid("nonconformant_templating_claim"));
            }
            Ok(json!({"value":"claim_valid"}))
        }
        _ => Err(invalid("unsupported_operation")),
    }
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
fn invalid(value: &str) -> VaultError {
    VaultError::Document(value.into())
}
