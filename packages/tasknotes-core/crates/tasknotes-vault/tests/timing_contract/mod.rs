//! Closed, independently asserted contracts for the explicitly withdrawn timing surface.

use super::{TestResult, runtime_adapter};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use tasknotes_vault::{
    VaultError,
    compat::{self, ExecutionContext},
};

mod assertions;

const CASES: &[(&str, &str)] = &[
    ("config.0664", "config.map_tasknotes_plugin"),
    ("config.0665", "config.map_tasknotes_plugin"),
    ("config.0668", "config.map_tasknotes_plugin"),
    ("config_schema.0008", "config.validate_schema"),
    ("config_schema.0020", "config.validate_schema"),
    ("config_schema.0021", "config.validate_schema"),
    ("field.0011", "field.default_mapping"),
    ("field.0018", "field.default_mapping"),
    ("field.0029", "field.build_mapping"),
    ("field.0036", "field.build_mapping"),
    ("field.0090", "field.build_mapping"),
    ("field.0097", "field.build_mapping"),
    ("field.0123", "field.normalize"),
    ("field.0124", "field.denormalize"),
    ("field.0137", "field.normalize"),
    ("field.0138", "field.denormalize"),
    ("validation.0055", "validation.core_evaluate"),
    ("validation.0056", "validation.core_evaluate"),
    ("validation.0057", "validation.time_entries"),
    ("validation.0058", "validation.time_entries"),
    ("validation.0059", "validation.time_entries"),
    ("validation.0060", "validation.time_entries"),
    ("ops.0080", "time.start"),
    ("ops.0081", "time.start"),
    ("ops.0082", "time.stop"),
    ("ops.0083", "time.stop"),
    ("ops.0084", "time.replace_entries"),
    ("ops.0085", "time.remove_entry"),
    ("ops.0086", "time.auto_stop_on_complete"),
    ("ops.0087", "time.report_totals"),
    ("ops.0088", "time.report_totals"),
    ("ops.0089", "time.start"),
    ("ops.0090", "time.stop"),
    ("ops.0091", "time.replace_entries"),
    ("ops.0092", "time.replace_entries"),
    ("ops.0093", "time.remove_entry"),
    ("ops.0094", "time.remove_entry"),
    ("ops.0095", "time.auto_stop_on_complete"),
    ("ops.0096", "time.auto_stop_on_complete"),
    ("ops.0097", "time.auto_stop_on_complete"),
    ("ops.0098", "time.report_totals"),
    ("ops.0099", "time.report_totals"),
    ("ops.0100", "time.report_totals"),
];

pub(super) fn contains(id: &str) -> bool {
    CASES.iter().any(|entry| entry.0 == id)
}

pub(super) fn admit(id: &str, operation: &str) -> TestResult {
    if let Some(entry) = CASES.iter().find(|entry| entry.0 == id) {
        if entry.1 != operation {
            return Err(format!("timing contract operation changed: {id}").into());
        }
    } else if !compat::supports(operation) && !runtime_adapter::supports(operation) {
        return Err(format!("unknown production operation: {id}/{operation}").into());
    }
    Ok(())
}

pub(super) fn assert_complete(consumed: &BTreeSet<String>) -> TestResult {
    assert_eq!(
        CASES.len(),
        43,
        "contract table must contain exactly 43 entries"
    );
    let expected: BTreeSet<String> = CASES.iter().map(|entry| entry.0.to_owned()).collect();
    assert_eq!(
        expected.len(),
        43,
        "contract IDs must be unique and complete"
    );
    if consumed != &expected {
        return Err("withdrawal contracts missing or unrecognized".into());
    }
    Ok(())
}

pub(super) fn verify(
    id: &str,
    operation: &str,
    input: &Value,
    result: &tasknotes_vault::Result<Value>,
    context: &ExecutionContext,
) -> TestResult {
    admit(id, operation)?;
    assertions::verify_result(id, result)?;
    // Every exact original payload is independently preserved in a real durable task.
    runtime_adapter::timing_witness::preserve_original(id, operation, input, context)?;
    Ok(())
}

#[test]
fn every_original_withdrawn_input_satisfies_its_closed_contract() -> TestResult {
    let directory = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tasknotes-fixtures/vault/upstream");
    let manifest: Value = serde_json::from_slice(&std::fs::read(directory.join("manifest.json"))?)?;
    let context = super::corpus_context()?;
    let mut consumed = BTreeSet::new();
    for file in manifest
        .get("files")
        .and_then(Value::as_array)
        .ok_or("manifest files")?
    {
        let name = file
            .get("file")
            .and_then(Value::as_str)
            .ok_or("manifest name")?;
        let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(directory.join(name))?)?;
        for case in cases {
            let id = case.get("id").and_then(Value::as_str).ok_or("case ID")?;
            if contains(id) {
                let operation = case
                    .get("operation")
                    .and_then(Value::as_str)
                    .ok_or("operation")?;
                let input = case.get("input").ok_or("input")?;
                let result = super::execute_case(operation, input, &context);
                verify(id, operation, input, &result, &context)?;
                assert!(consumed.insert(id.to_owned()), "duplicate contract");
            }
        }
    }
    assert_complete(&consumed)
}

#[test]
fn closed_membership_and_consumption_reject_unapproved_changes() -> TestResult {
    assert!(admit("ops.0101", "time.start").is_err());
    assert!(admit("ops.0080", "time.stop").is_err());
    assert!(admit("link.0028", "future.unknown").is_err());
    assert!(!contains("link.0028"));
    assert!(!contains("conformance.0018"));
    let mut consumed: BTreeSet<String> = CASES.iter().map(|entry| entry.0.to_owned()).collect();
    assert_complete(&consumed)?;
    consumed.remove("ops.0080");
    assert!(assert_complete(&consumed).is_err());
    consumed.insert("ops.9999".to_owned());
    assert!(assert_complete(&consumed).is_err());
    Ok(())
}

#[test]
fn assertion_mutation_probes_reject_wrong_success_error_and_supported_metadata() -> TestResult {
    assertions::verify_result(
        "ops.0080",
        &Err(VaultError::Document("unsupported_operation".into())),
    )?;
    assert!(assertions::verify_result("ops.0080", &Ok(json!({"started":true}))).is_err());
    assert!(
        assertions::verify_result(
            "ops.0080",
            &Err(VaultError::Configuration("unsupported_operation".into()))
        )
        .is_err()
    );
    assert!(
        assertions::verify_result(
            "config_schema.0008",
            &Err(VaultError::Document("invalid".into()))
        )
        .is_err()
    );
    assert!(
        assertions::verify_result(
            "config_schema.0008",
            &Err(VaultError::Document(
                "config kind unsupported:time_tracking".into()
            ))
        )
        .is_err()
    );
    assert!(assertions::verify_result("config.0668", &Ok(json!({"value":{}}))).is_err());
    assert!(
        assertions::verify_result(
            "field.0123",
            &Ok(json!({"normalized":{"timeEstimate":"PT45M"}}))
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn supported_configuration_and_validation_controls_remain_live() -> TestResult {
    let context = super::corpus_context()?;
    for value in [
        json!({"storage":"frontmatter"}),
        json!({"storage":"filename"}),
    ] {
        assert_eq!(
            compat::execute(
                "config.validate_schema",
                &json!({"kind":"title","value":value}),
                &context
            )?,
            json!({"value":"valid"})
        );
    }
    assert!(
        matches!(compat::execute("config.validate_schema", &json!({"kind":"title","value":{"storage":false}}), &context), Err(VaultError::Configuration(message)) if message == "title.storage invalid unsupported")
    );
    assert_eq!(
        compat::execute(
            "config.validate_schema",
            &json!({"kind":"status","value":{"values":["open","done"],"default":"open"}}),
            &context
        )?,
        json!({"value":"valid"})
    );
    assert!(
        matches!(compat::execute("config.validate_schema", &json!({"kind":"status","value":{"values":["open"],"default":"absent"}}), &context), Err(VaultError::Configuration(message)) if message == "status.default must be one of status.values")
    );
    assert_eq!(
        compat::execute(
            "config.map_tasknotes_plugin",
            &json!({"data":{"storeTitleInFilename":false}}),
            &context
        )?,
        json!({"value":{"title":{"storage":"frontmatter"}}})
    );
    assert_eq!(
        compat::execute(
            "config.map_tasknotes_plugin",
            &json!({"data":{"storeTitleInFilename":true}}),
            &context
        )?,
        json!({"value":{"title":{"storage":"filename"}}})
    );
    let base = json!({"frontmatter":{"title":"Valid","status":"open","dateCreated":"2026-02-01","dateModified":"2026-02-20"}});
    assert_eq!(
        compat::execute("validation.core_evaluate", &base, &context)?,
        assertions::no_issues()
    );
    for (key, value, code) in [
        ("status", json!(123), "invalid_type"),
        ("due", json!("not-a-date"), "invalid_date_value"),
    ] {
        let mut malformed = base.clone();
        malformed
            .get_mut("frontmatter")
            .and_then(Value::as_object_mut)
            .ok_or("frontmatter missing")?
            .insert(key.to_owned(), value);
        let report = compat::execute("validation.core_evaluate", &malformed, &context)?;
        assert_eq!(report.get("hasErrors"), Some(&json!(true)));
        assert!(
            report
                .get("errorCodes")
                .and_then(Value::as_array)
                .ok_or("codes missing")?
                .contains(&json!(code))
        );
    }
    Ok(())
}
