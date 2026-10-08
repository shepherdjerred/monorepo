//! Retired declarations recognize historical keys without giving them task roles.

use serde_json::{Value, json};
use tasknotes_vault::{mapping::FieldMapping, validation};

#[test]
fn closed_validation_preserves_declared_legacy_keys_but_rejects_other_unknowns()
-> Result<(), Box<dyn std::error::Error>> {
    let fields = json!({"old_budget":{"tn_role":"time_estimate"},"old_log":{"tn_role":"timeEntries"},"old_rounds":{"tn_role":"pomodoros"}});
    let mapping = FieldMapping::from_fields(fields.as_object().ok_or("fields")?, None)?;
    let properties = json!({
        "title":"Task","status":"open","dateCreated":"2026-01-01","dateModified":"2026-10-03",
        "old_budget":{"opaque":true},"old_log":"invalid old timing value","old_rounds":["opaque"],
        "timeEstimate":false,"time_entries":null,"pomodoros":"uninterpreted","vendor":"unknown"
    });
    let report = validation::evaluate_mapped(
        &mapping,
        properties.as_object().ok_or("properties")?,
        None,
        true,
    );
    let issues = report["issues"].as_array().ok_or("issues")?;
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0]["field"], "vendor");
    assert_eq!(issues[0]["code"], "unknown_field");
    assert_eq!(issues[0]["severity"], "error");
    assert_eq!(report["hasErrors"], true);
    for key in ["old_budget", "old_log", "old_rounds"] {
        assert!(!mapping.field_to_role.contains_key(key));
        assert!(!mapping.role_to_field.values().any(|field| field == key));
    }
    let projection = serde_json::to_value(&mapping)?;
    assert!(projection.get("retiredFields").is_none());
    assert_eq!(
        mapping.normalize(properties.as_object().ok_or("properties")?),
        properties.as_object().ok_or("properties")?.clone()
    );
    let mut accepted = properties.as_object().ok_or("properties")?.clone();
    accepted.remove("vendor");
    assert_eq!(
        validation::evaluate_mapped(&mapping, &accepted, None, true)["hasErrors"],
        Value::Bool(false)
    );
    Ok(())
}
