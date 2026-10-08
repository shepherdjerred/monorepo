//! Strict recognized-key validation before compatibility mapping can filter values.

use crate::{Result, VaultError};
use serde_json::{Map, Value};

pub(crate) fn validate(source: &Map<String, Value>) -> Result<()> {
    for key in [
        "storeTitleInFilename",
        "autoStopTimeTrackingOnComplete",
        "autoStopTimeTrackingNotification",
        "moveArchivedTasks",
        "useFrontmatterMarkdownLinks",
    ] {
        if source.get(key).is_some_and(|value| !value.is_boolean()) {
            return Err(invalid(key, "boolean"));
        }
    }
    for key in [
        "taskTag",
        "taskIdentificationMethod",
        "taskPropertyName",
        "taskProperty",
        "taskPropertyValue",
        "excludedFolders",
        "tasksFolder",
        "taskFilenameFormat",
        "customFilenameTemplate",
        "archiveFolder",
        "defaultTaskStatus",
        "defaultTaskPriority",
    ] {
        if source.get(key).is_some_and(|value| !value.is_string()) {
            return Err(invalid(key, "string"));
        }
    }
    if let Some(defaults) = source.get("taskCreationDefaults") {
        let defaults = defaults
            .as_object()
            .ok_or_else(|| invalid("taskCreationDefaults", "object"))?;
        for key in ["useBodyTemplate", "useOccurrenceBodyTemplate"] {
            if defaults.get(key).is_some_and(|value| !value.is_boolean()) {
                return Err(invalid(key, "boolean"));
            }
        }
        for key in ["bodyTemplate", "occurrenceBodyTemplate"] {
            if defaults.get(key).is_some_and(|value| !value.is_string()) {
                return Err(invalid(key, "string"));
            }
        }
    }
    Ok(())
}

pub(crate) fn mapped_section(key: &str, value: &Value) -> Result<()> {
    if key == "title" {
        if value
            .get("storage")
            .is_some_and(|value| !matches!(value.as_str(), Some("filename" | "frontmatter")))
        {
            return Err(invalid("title.storage", "filename or frontmatter"));
        }
        if value.get("filename_format").is_some_and(|value| {
            !matches!(
                value.as_str(),
                Some("title" | "slug" | "custom" | "zettel" | "timestamp" | "uuid")
            )
        }) {
            return Err(invalid(
                "title.filename_format",
                "supported filename format",
            ));
        }
        return Ok(());
    }
    if [
        "validation",
        "templating",
        "dependencies",
        "links",
        "reminders",
        "time_tracking",
        "status",
        "task_detection",
    ]
    .contains(&key)
    {
        crate::configuration::validate_schema(key, value)
            .map_err(|error| VaultError::Configuration(error.to_string()))?;
    }
    Ok(())
}

fn invalid(key: &str, expected: &str) -> VaultError {
    VaultError::Configuration(format!("plugin setting {key} must be {expected}"))
}
