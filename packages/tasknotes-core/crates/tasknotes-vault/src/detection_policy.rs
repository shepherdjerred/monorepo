//! Required tag/property detection selection for production configuration providers.

use crate::{Result, VaultError, config::DetectionMethod};
use serde_json::Value;

/// Resolve the ordered enabled methods, validating the supported selection rules.
/// Optional field-presence/match extensions are rejected explicitly until implemented.
///
/// # Errors
/// Rejects empty/duplicate methods, invalid combinators and unsupported extensions.
pub fn methods(policy: &Value) -> Result<Vec<DetectionMethod>> {
    let names = if let Some(value) = policy.get("methods") {
        let values = value
            .as_array()
            .filter(|values| !values.is_empty())
            .ok_or_else(|| invalid("methods must be a non-empty array"))?;
        values
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .ok_or_else(|| invalid("detection methods must be strings"))
            })
            .collect::<Result<Vec<_>>>()?
    } else {
        vec![policy.get("method").map_or(Ok("tag"), |value| {
            value
                .as_str()
                .ok_or_else(|| invalid("method must be a string"))
        })?]
    };
    let mut methods = Vec::new();
    for name in names {
        let method = match name {
            "tag" => DetectionMethod::Tag,
            "property" => DetectionMethod::Property,
            _ => return Err(invalid("unsupported detection method")),
        };
        if methods.contains(&method) {
            return Err(invalid("detection methods must be unique"));
        }
        methods.push(method);
    }
    if policy
        .get("combine")
        .is_some_and(|value| !matches!(value.as_str(), Some("and" | "or")))
    {
        return Err(invalid("combine must be and or or"));
    }
    if methods.contains(&DetectionMethod::Tag)
        && policy.get("tag").is_some_and(|value| {
            value
                .as_str()
                .is_none_or(|value| value.trim().trim_start_matches('#').is_empty())
        })
    {
        return Err(invalid("tag must be non-empty"));
    }
    if methods.contains(&DetectionMethod::Property)
        && policy
            .get("property_name")
            .and_then(Value::as_str)
            .is_none_or(|value| value.trim().is_empty())
    {
        return Err(invalid("property_name is required for property detection"));
    }
    Ok(methods)
}

fn invalid(message: &str) -> VaultError {
    VaultError::Configuration(format!("task_detection: {message}"))
}
