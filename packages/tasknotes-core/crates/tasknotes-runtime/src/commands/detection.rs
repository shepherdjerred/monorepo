//! Creation defaults use the same enabled detection methods as the index.

use super::{DetectionMethod, Map, Result, RuntimeError, TaskNotesConfiguration, Value, json};

pub(super) fn ensure(
    properties: &mut Map<String, Value>,
    config: &TaskNotesConfiguration,
) -> Result<()> {
    let policy = config.effective.get("task_detection").ok_or_else(|| {
        RuntimeError::Validation("effective task detection policy is missing".to_owned())
    })?;
    let methods = tasknotes_vault::detection_policy::methods(policy)?;
    let count = if policy.get("combine").and_then(Value::as_str) == Some("and") {
        methods.len()
    } else {
        1
    };
    for method in methods.into_iter().take(count) {
        match method {
            DetectionMethod::Tag => {
                let tag = policy
                    .get("tag")
                    .and_then(Value::as_str)
                    .unwrap_or("task")
                    .trim()
                    .trim_start_matches('#');
                let tags = properties
                    .entry("tags")
                    .or_insert_with(|| json!([]))
                    .as_array_mut()
                    .ok_or_else(|| RuntimeError::Validation("tags must be a list".to_owned()))?;
                if !tags.iter().any(|value| {
                    value.as_str().is_some_and(|value| {
                        value
                            .trim()
                            .trim_start_matches('#')
                            .eq_ignore_ascii_case(tag)
                    })
                }) {
                    tags.push(json!(tag));
                }
            }
            DetectionMethod::Property => {
                let name = policy
                    .get("property_name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        RuntimeError::Validation("property_name is required".to_owned())
                    })?;
                let expected = policy
                    .get("property_value")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let role = config
                    .mapping
                    .field_to_role
                    .get(name)
                    .map_or(name, String::as_str);
                if expected.is_empty() {
                    if properties.get(role).is_none_or(Value::is_null) {
                        properties.insert(role.to_owned(), json!(""));
                    }
                } else {
                    let value =
                        serde_json::from_str::<Value>(expected).unwrap_or_else(|_| json!(expected));
                    properties.insert(role.to_owned(), value);
                }
            }
        }
    }
    Ok(())
}
