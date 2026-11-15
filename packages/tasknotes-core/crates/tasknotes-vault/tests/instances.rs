//! Strict stored instance-state invariants, independent of generated RRULE dates.

use serde_json::{Value, json};
use tasknotes_vault::{VaultError, instances::InstanceLists, mapping::FieldMapping, validation};

#[test]
fn typed_lists_preserve_valid_order_and_allow_outside_rule_days()
-> Result<(), Box<dyn std::error::Error>> {
    let value = json!({"recurrence":"DTSTART:20261001;FREQ=DAILY","completeInstances":["2024-02-29","2026-09-30"],"skippedInstances":["2027-01-01"]});
    let lists = InstanceLists::parse(value.as_object().ok_or("object")?)?;
    assert_eq!(lists.completed, ["2024-02-29", "2026-09-30"]);
    assert_eq!(lists.skipped, ["2027-01-01"]);
    assert_eq!(
        InstanceLists::parse(&serde_json::Map::new())?.completed,
        Vec::<String>::new()
    );
    Ok(())
}

#[test]
fn present_corrupt_values_are_rejected_with_exact_codes() -> Result<(), Box<dyn std::error::Error>>
{
    for role in ["completeInstances", "skippedInstances"] {
        for (value, code) in [
            (Value::Null, "invalid_type"),
            (json!("2026-10-01"), "invalid_type"),
            (json!([42]), "invalid_type"),
            (json!(["2026-02-30"]), "invalid_date_value"),
            (json!(["20261001"]), "invalid_date_value"),
            (json!(["2026-10-01T12:00:00Z"]), "invalid_date_value"),
            (
                json!(["2026-10-01", "2026-10-01"]),
                "duplicate_instance_date",
            ),
        ] {
            let properties = serde_json::Map::from_iter([(role.to_owned(), value)]);
            assert!(
                matches!(InstanceLists::parse(&properties), Err(VaultError::Document(actual)) if actual == code)
            );
        }
    }
    let overlap = json!({"completeInstances":["2026-10-01"],"skippedInstances":["2026-10-01"]});
    assert!(
        matches!(InstanceLists::parse(overlap.as_object().ok_or("object")?), Err(VaultError::Document(actual)) if actual == "instance_state_overlap")
    );
    Ok(())
}

#[test]
fn strict_validation_names_actual_mapped_fields_and_role_aliases()
-> Result<(), Box<dyn std::error::Error>> {
    let declarations = json!({"finished_days":{"tn_role":"complete_instances"},"ignored_days":{"tn_role":"skipped_instances"}});
    let mapping = FieldMapping::from_fields(declarations.as_object().ok_or("fields")?, None)?;
    let fm = json!({"title":"Valid","status":"open","dateCreated":"2026-01-01T00:00:00Z","dateModified":"2026-10-03T12:00:00Z","finished_days":["2026-10-01"],"ignored_days":["2026-10-01"]});
    let output = validation::evaluate_mapped(
        &mapping,
        fm.as_object().ok_or("object")?,
        Some("a.md"),
        false,
    );
    let issues = output
        .get("issues")
        .and_then(Value::as_array)
        .ok_or("issues")?;
    assert!(issues.iter().any(
        |issue| issue.get("code") == Some(&json!("instance_state_overlap"))
            && issue.get("field") == Some(&json!("finished_days"))
    ));
    Ok(())
}

#[test]
fn mapped_source_checks_keep_unknown_physical_keys_and_reject_hidden_corruption()
-> Result<(), Box<dyn std::error::Error>> {
    let mapping = FieldMapping::from_plugin(&indexmap::IndexMap::from_iter([
        ("complete_instances".to_owned(), "zz_completed".to_owned()),
        ("skipped_instances".to_owned(), "zz_skipped".to_owned()),
    ]))?;
    let unknown = json!({"zz_completed":["2026-10-01"],"complete_instances":["not-a-day"]});
    assert_eq!(
        InstanceLists::parse_mapped(unknown.as_object().ok_or("object")?, &mapping)?.completed,
        ["2026-10-01"]
    );
    for (bad, good) in [
        ("completeInstances", "zz_completed"),
        ("zz_completed", "completeInstances"),
    ] {
        let fm = serde_json::Map::from_iter([
            (bad.to_owned(), json!(["2026-02-30"])),
            (good.to_owned(), json!(["2026-10-01"])),
        ]);
        assert!(
            matches!(InstanceLists::parse_mapped(&fm, &mapping), Err(VaultError::Document(code)) if code == "invalid_date_value")
        );
        assert!(
            tasknotes_vault::instances::issues_mapped(&fm, &mapping)
                .iter()
                .any(|issue| issue.get("field") == Some(&json!(bad)))
        );
    }
    let conflicting = json!({"completeInstances":["2026-10-01"],"zz_completed":["2026-10-02"]});
    assert!(
        matches!(InstanceLists::parse_mapped(conflicting.as_object().ok_or("object")?, &mapping), Err(VaultError::Document(code)) if code == "instance_alias_conflict")
    );
    let same = json!({"completeInstances":["2026-10-01"],"zz_completed":["2026-10-01"]});
    assert_eq!(
        InstanceLists::parse_mapped(same.as_object().ok_or("object")?, &mapping)?.completed,
        ["2026-10-01"]
    );
    Ok(())
}

#[test]
fn long_lived_instance_lists_keep_order_and_detect_late_duplicates()
-> Result<(), Box<dyn std::error::Error>> {
    let first = chrono::NaiveDate::from_ymd_opt(2020, 1, 1).ok_or("date")?;
    let days = (0..2000)
        .map(|index| {
            first
                .checked_add_days(chrono::Days::new(index))
                .ok_or("date overflow")
                .map(|day| day.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut properties =
        serde_json::Map::from_iter([("completeInstances".to_owned(), json!(days))]);
    assert_eq!(InstanceLists::parse(&properties)?.completed, days);
    let mut duplicated = days.clone();
    duplicated.push(days.first().ok_or("first day")?.clone());
    properties.insert("completeInstances".into(), json!(duplicated));
    assert!(
        matches!(InstanceLists::parse(&properties),Err(VaultError::Document(code)) if code=="duplicate_instance_date")
    );
    properties.insert("completeInstances".into(), json!(days));
    properties.insert(
        "skippedInstances".into(),
        json!([days.last().ok_or("last day")?]),
    );
    assert!(
        matches!(InstanceLists::parse(&properties),Err(VaultError::Document(code)) if code=="instance_state_overlap")
    );
    Ok(())
}
