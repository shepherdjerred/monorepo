//! Retired declarations recognize historical keys without giving them task roles.

use serde_json::{Value, json};
use tasknotes_vault::{
    document::{PropertyEdit, TaskDocument},
    mapping::FieldMapping,
    path::VaultPath,
    validation,
};

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

#[test]
fn supported_roles_remap_while_all_retired_aliases_stay_opaque()
-> Result<(), Box<dyn std::error::Error>> {
    let fields = json!({
        "headline":{"tn_role":"title"}, "state":{"tn_role":"status"},
        "finished":{"tn_role":"completed_date"},
        "budget":{"tn_role":"timeEstimate"}, "legacy_budget":{"tn_role":"time_estimate"},
        "log":{"tn_role":"timeEntries"}, "legacy_log":{"tn_role":"time_entries"},
        "rounds":{"tn_role":"pomodoros"}
    });
    let plugin = serde_json::from_value(json!({
        "title":"headline", "status":"state", "completed_date":"finished",
        "timeEstimate":"budget", "time_estimate":"legacy_budget",
        "timeEntries":"log", "time_entries":"legacy_log", "pomodoros":"rounds"
    }))?;
    let physical = json!({
        "headline":"Task", "state":"done", "finished":"2026-10-12",
        "budget":{"opaque":true}, "legacy_budget":false, "log":["vendor"],
        "legacy_log":null, "rounds":"invalid old count", "timeEstimate":"canonical opaque"
    });
    let expected = json!({
        "title":"Task", "status":"done", "completedDate":"2026-10-12",
        "budget":{"opaque":true}, "legacy_budget":false, "log":["vendor"],
        "legacy_log":null, "rounds":"invalid old count", "timeEstimate":"canonical opaque"
    });
    for mapping in [
        FieldMapping::from_fields(fields.as_object().ok_or("fields")?, None)?,
        FieldMapping::from_plugin(&plugin)?,
    ] {
        let normalized = mapping.normalize(physical.as_object().ok_or("physical")?);
        assert_eq!(&normalized, expected.as_object().ok_or("expected")?);
        assert_eq!(
            mapping.denormalize(&normalized),
            *physical.as_object().ok_or("physical")?
        );
        for role in [
            "timeEstimate",
            "time_estimate",
            "timeEntries",
            "time_entries",
            "pomodoros",
        ] {
            assert!(!mapping.role_to_field.contains_key(role));
            assert!(!mapping.field_to_role.values().any(|value| value == role));
        }
    }
    Ok(())
}

#[test]
fn ordinary_document_edits_keep_retired_metadata_bytes() -> Result<(), Box<dyn std::error::Error>> {
    let retained = "budget: '0005' # opaque estimate\r\nlog: [vendor, 'unparsed']\r\nrounds: {vendor: true}\r\ntimeEstimate: false\r\n---\r\n\r\nBody stays.\r\n";
    let source = format!("\u{feff}---\r\nstate: open\r\n{retained}");
    let document = TaskDocument::parse(VaultPath::parse("Tasks/opaque.md")?, source.as_bytes())?;
    assert_eq!(document.plan(&[], None)?.bytes, source.as_bytes());
    let write = document.plan(
        &[PropertyEdit::Set {
            key: "state".to_owned(),
            value: json!("done"),
        }],
        None,
    )?;
    let updated = String::from_utf8(write.bytes.clone())?;
    assert!(updated.starts_with("\u{feff}---\r\n"));
    assert!(updated.ends_with(retained));
    assert!(!updated.replace("\r\n", "").contains('\n'));
    let parsed = TaskDocument::parse(document.path().clone(), &write.bytes)?;
    assert_eq!(parsed.frontmatter().get("state"), Some(&json!("done")));
    assert_eq!(parsed.body(), document.body());
    Ok(())
}
