//! Compatibility with a publisher capture independent of the embedded defaults.

use serde_json::{Value, json};
use tasknotes_vault::config::{ConfigurationSource, TaskNotesConfiguration};

#[test]
fn published_mapping_loads_without_yaml_or_standard_approval()
-> Result<(), Box<dyn std::error::Error>> {
    let capture: Value = serde_json::from_str(include_str!(
        "../../../../tasknotes-fixtures/vault/tasknotes-model-0.3.0-rc.18-mapping.json"
    ))?;
    assert_eq!(capture["version"], "0.3.0-rc.18");
    let plugin = serde_json::to_vec(&json!({"fieldMapping": capture["fieldMapping"]}))?;
    let config = TaskNotesConfiguration::resolve(Some(&plugin), None, false)?;
    assert_eq!(config.source, ConfigurationSource::PluginDataJson);
    assert_eq!(
        config.mapping.field("recurrenceParent"),
        "recurrence_parent"
    );
    for role in [
        "assignees",
        "recurrenceOriginalDate",
        "timeEstimate",
        "timeEntries",
        "pomodoros",
    ] {
        assert!(!config.mapping.role_to_field.contains_key(role), "{role}");
    }
    Ok(())
}

#[test]
fn compatibility_roles_do_not_hide_invalid_mapping_declarations()
-> Result<(), Box<dyn std::error::Error>> {
    for mapping in [
        json!({"imaginaryRole":"custom"}),
        json!({"assignees":""}),
        json!({"recurrenceOriginalDate":" "}),
        json!({"assignees":"status"}),
        json!({"assignees":"owners","status":"owners"}),
        json!({"assignees":"owners","recurrenceOriginalDate":"owners"}),
    ] {
        let plugin = serde_json::to_vec(&json!({"fieldMapping":mapping}))?;
        assert!(
            TaskNotesConfiguration::resolve(Some(&plugin), None, false).is_err(),
            "{mapping}"
        );
    }
    Ok(())
}
