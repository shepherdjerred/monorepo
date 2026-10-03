//! Acceptance tests for configuration boundaries and workflow policies.

use serde_json::json;
use tasknotes_vault::config::{ConfigurationSource, DetectionMethod, TaskNotesConfiguration};

#[test]
fn portable_configuration_uses_spec_keys_and_preserves_extensions()
-> Result<(), Box<dyn std::error::Error>> {
    let yaml = b"spec_version: 0.3.0-rc.9\nmapping:\n  status: state\n  completed_date: finishedOn\nstatus:\n  values: [backlog, working, finished]\n  default: backlog\n  completed_values: [finished]\ndefaults:\n  status: working\n  priority: high\n  reminders: []\ntask_detection:\n  method: property\n  property_name: kind\n  property_value: task\n  excluded_folders: Archive, Templates\ntitle:\n  storage: frontmatter\n  filename_format: timestamp\nlinks:\n  use_markdown_format: true\n";
    let config = TaskNotesConfiguration::resolve(None, Some(yaml), false)?;
    assert_eq!(config.source, ConfigurationSource::TasknotesYaml);
    assert_eq!(config.mapping.field("status"), "state");
    assert_eq!(config.mapping.field("completedDate"), "finishedOn");
    assert_eq!(config.default_status.as_deref(), Some("working"));
    assert_eq!(config.default_priority.as_deref(), Some("high"));
    assert!(config.is_completed("finished")?);
    assert_eq!(config.next_status("finished")?, "backlog");
    assert_eq!(config.identification.method, DetectionMethod::Property);
    assert_eq!(config.identification.property_name, "kind");
    assert_eq!(config.identification.property_value, "task");
    assert_eq!(config.identification.excluded_folders, "Archive, Templates");
    assert!(!config.store_title_in_filename);
    assert_eq!(
        config.extra.get("links"),
        Some(&json!({"use_markdown_format":true}))
    );
    assert_eq!(
        config.extra.get("portableTitle"),
        Some(&json!({"filename_format":"timestamp"}))
    );
    Ok(())
}

#[test]
fn invalid_portable_settings_fail_without_falling_back() {
    for yaml in [
        "spec_version: 1.0.0",
        "spec_version: 0.3",
        "spec_version: 0.03.0",
        "spec_version: 0.3.0-",
        "spec_version: null",
        "mapping: null",
        "mapping: {imaginary: key}",
        "mapping: {status: ''}",
        "status: null",
        "defaults: null",
        "title: null",
        "task_detection: null",
        "status: {values: [open, done], default: missing, completed_values: [done]}",
        "status: {values: [open, done], default: open, completed_values: []}",
        "status: {values: [open, done], default: open, completed_values: [missing]}",
        "status: {values: [open, open], default: open, completed_values: [open]}",
        "defaults: {status: missing}",
        "defaults: {priority: missing}",
        "defaults: {status: 1}",
        "defaults: {priority: 1}",
        "title: {storage: unsupported}",
        "task_detection: {method: unsupported}",
        "task_detection: {method: tag, tag: ''}",
        "task_detection: {method: property, property_name: ''}",
        "task_detection: {methods: [tag, property]}",
        "task_detection: {field_presence: status}",
        "task_detection: {field_match: {type: task}}",
        "spec_version: 0.3.0\nspec_version: 0.2.0",
        "[one, two]",
    ] {
        assert!(
            TaskNotesConfiguration::resolve(None, Some(yaml.as_bytes()), true).is_err(),
            "accepted {yaml}"
        );
    }
    assert!(TaskNotesConfiguration::resolve(None, Some(&[255]), true).is_err());
}

#[test]
fn plugin_settings_apply_custom_priorities_detection_and_creation_defaults()
-> Result<(), Box<dyn std::error::Error>> {
    let settings = json!({
        "customPriorities":[{"id":"urgent","value":"urgent","label":"Urgent","color":"#abc","weight":5,"icon":"flag"}],
        "defaultTaskPriority":"urgent", "defaultTaskStatus":"done", "taskIdentificationMethod":"property", "taskPropertyName":"kind", "taskPropertyValue":"task",
        "taskTag":"custom", "excludedFolders":"Archive", "storeTitleInFilename":false, "extension":{"enabled":true}
    });
    let config =
        TaskNotesConfiguration::resolve(Some(&serde_json::to_vec(&settings)?), None, false)?;
    assert_eq!(config.default_priority.as_deref(), Some("urgent"));
    assert_eq!(config.default_status.as_deref(), Some("done"));
    assert_eq!(
        config.priorities.first().map(|p| p.extra.get("icon")),
        Some(Some(&json!("flag")))
    );
    assert_eq!(config.identification.tag, "custom");
    assert_eq!(config.identification.property_value, "task");
    assert_eq!(config.identification.excluded_folders, "Archive");
    assert!(!config.store_title_in_filename);
    assert_eq!(
        config.extra.get("extension"),
        Some(&json!({"enabled":true}))
    );
    Ok(())
}

#[test]
fn invalid_plugin_settings_and_workflows_are_rejected() -> Result<(), Box<dyn std::error::Error>> {
    for key in [
        "fieldMapping",
        "customStatuses",
        "customPriorities",
        "taskTag",
        "taskIdentificationMethod",
        "taskPropertyName",
        "taskPropertyValue",
        "excludedFolders",
        "storeTitleInFilename",
        "defaultTaskStatus",
        "defaultTaskPriority",
    ] {
        let bytes = serde_json::to_vec(&json!({key:null}))?;
        assert!(TaskNotesConfiguration::resolve(Some(&bytes), None, true).is_err());
    }
    for value in [
        json!([]),
        json!({"defaultTaskStatus":"unknown"}),
        json!({"defaultTaskPriority":"unknown"}),
        json!({"customPriorities":[]}),
        json!({"taskTag":"#"}),
        json!({"taskIdentificationMethod":"property","taskPropertyName":""}),
        json!({"customPriorities":[{"id":"","value":"x","label":"x","color":"#abc","weight":0}]}),
    ] {
        assert!(
            TaskNotesConfiguration::resolve(Some(&serde_json::to_vec(&value)?), None, true)
                .is_err()
        );
    }
    let status = json!({"id":"a","value":"a","label":"A","color":"#abc","order":0,"isCompleted":false,"excludeFromCycle":true});
    let config = TaskNotesConfiguration::resolve(
        Some(&serde_json::to_vec(
            &json!({"customStatuses":[status.clone()]}),
        )?),
        None,
        false,
    )?;
    assert!(config.next_status("a").is_err());
    assert!(config.next_status("unknown").is_err());
    let mut invalid_next = status.as_object().ok_or("status not object")?.clone();
    invalid_next.insert("nextStatus".to_owned(), json!("unknown"));
    for statuses in [
        json!([status.clone(), status.clone()]),
        json!([invalid_next]),
    ] {
        assert!(
            TaskNotesConfiguration::resolve(
                Some(&serde_json::to_vec(&json!({"customStatuses":statuses}))?),
                None,
                false
            )
            .is_err()
        );
    }
    Ok(())
}

#[test]
fn missing_portable_nested_settings_use_documented_defaults()
-> Result<(), Box<dyn std::error::Error>> {
    let config = TaskNotesConfiguration::resolve(
        None,
        Some(b"title: {storage: filename}\ntask_detection: {}"),
        false,
    )?;
    assert!(config.store_title_in_filename);
    assert_eq!(config.identification.method, DetectionMethod::Tag);
    assert_eq!(config.identification.property_value, "");
    Ok(())
}
