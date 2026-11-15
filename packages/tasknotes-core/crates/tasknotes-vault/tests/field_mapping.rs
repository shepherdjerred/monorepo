//! Execute all pinned upstream cases with explicit contracts for withdrawn roles.

use serde_json::{Map, Value, json};
use tasknotes_vault::mapping::FieldMapping;

const RETIRED_CASES: &[&str] = &[
    "field.0011",
    "field.0018",
    "field.0029",
    "field.0036",
    "field.0090",
    "field.0097",
    "field.0123",
    "field.0124",
    "field.0137",
    "field.0138",
];

const SUPPORTED_CORE_LITE_ROLES: &[&str] = &[
    "title",
    "status",
    "priority",
    "due",
    "scheduled",
    "completedDate",
    "tags",
    "contexts",
    "projects",
    "attachments",
    "dateCreated",
    "dateModified",
    "recurrence",
    "recurrenceAnchor",
    "completeInstances",
    "skippedInstances",
];

#[test]
fn upstream_field_mapping_corpus() -> Result<(), Box<dyn std::error::Error>> {
    let cases: Vec<Value> = serde_json::from_str(include_str!(
        "../../../../tasknotes-fixtures/vault/upstream/field-mapping.json"
    ))?;
    assert_eq!(
        cases.len(),
        139,
        "the pinned fixture corpus must remain complete"
    );
    let mut retired_cases = Vec::new();
    for case in cases {
        let id = case
            .get("id")
            .and_then(Value::as_str)
            .ok_or("missing fixture ID")?;
        let input = case.get("input").ok_or("missing fixture input")?;
        let fields = input
            .get("fields")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let operation = case
            .get("operation")
            .and_then(Value::as_str)
            .ok_or("missing operation")?;
        let mapping = if operation == "field.default_mapping" {
            FieldMapping::default()
        } else {
            FieldMapping::from_fields(&fields, input.get("displayNameKey").and_then(Value::as_str))?
        };
        let result = match operation {
            "field.default_mapping" | "field.build_mapping" => serde_json::to_value(&mapping)?,
            "field.normalize" => {
                json!({"normalized": mapping.normalize(object(input, "frontmatter")?)})
            }
            "field.denormalize" => {
                json!({"denormalized": mapping.denormalize(object(input, "roleData")?)})
            }
            "field.is_completed_status" => {
                json!({"value": input.get("status").and_then(Value::as_str).is_some_and(|s| mapping.completed_statuses.iter().any(|v| v == s))})
            }
            "field.default_completed_status" => {
                json!({"value": mapping.completed_statuses.first().map_or("done", String::as_str)})
            }
            "field.resolve_display_title" => {
                json!({"value": mapping.display_title(object(input, "frontmatter")?, input.get("taskPath").and_then(Value::as_str))})
            }
            other => return Err(format!("unimplemented fixture operation: {other}").into()),
        };
        let actual = json!({"ok":true,"result":result});
        let expected = case.get("expect").ok_or("missing expectation")?;
        // These exact upstream cases exercise deliberately withdrawn semantic roles.
        // Execute their input against an independent preservation contract instead;
        // every other upstream expectation stays untouched.
        if assert_retired_case(id, &mapping, &actual) {
            retired_cases.push(id.to_owned());
            continue;
        }
        assert!(
            matches(&actual, expected),
            "{id}: expected {expected}, got {actual}"
        );
    }
    assert_eq!(retired_cases, RETIRED_CASES);
    Ok(())
}

fn assert_retired_case(id: &str, mapping: &FieldMapping, actual: &Value) -> bool {
    match id {
        "field.0011" | "field.0018" => assert_retired_mapping(mapping, "", true),
        "field.0029" | "field.0036" => assert_retired_mapping(mapping, "custom_", true),
        "field.0090" | "field.0097" => assert_retired_mapping(mapping, "", false),
        "field.0123" => assert_eq!(
            actual,
            &json!({"ok":true,"result":{"normalized":{"mapped_timeEstimate":"PT45M"}}}),
            "{id}"
        ),
        "field.0124" => assert_eq!(
            actual,
            &json!({"ok":true,"result":{"denormalized":{"timeEstimate":"PT45M"}}}),
            "{id}"
        ),
        "field.0137" => assert_eq!(
            actual,
            &json!({"ok":true,"result":{"normalized":{
                "mapped_timeEntries":[{"startTime":"2026-08-19T10:00:00Z","endTime":"2026-08-19T10:30:00Z"}]
            }}}),
            "{id}"
        ),
        "field.0138" => assert_eq!(
            actual,
            &json!({"ok":true,"result":{"denormalized":{
                "timeEntries":[{"startTime":"2026-08-19T10:00:00Z","endTime":"2026-08-19T10:30:00Z"}]
            }}}),
            "{id}"
        ),
        _ => return false,
    }
    for role in [
        "timeEstimate",
        "time_estimate",
        "timeEntries",
        "time_entries",
        "pomodoros",
    ] {
        assert!(!mapping.role_to_field.contains_key(role), "{id}: {role}");
        assert!(
            !mapping.field_to_role.values().any(|mapped| mapped == role),
            "{id}: {role}"
        );
    }
    true
}

fn assert_retired_mapping(mapping: &FieldMapping, prefix: &str, reverse: bool) {
    for role in SUPPORTED_CORE_LITE_ROLES {
        let field = format!("{prefix}{role}");
        assert_eq!(mapping.role_to_field.get(*role), Some(&field));
        if reverse {
            assert_eq!(
                mapping.field_to_role.get(&field).map(String::as_str),
                Some(*role)
            );
        }
    }
    if !reverse {
        assert!(mapping.field_to_role.is_empty());
    } else if !prefix.is_empty() {
        assert_eq!(mapping.field_to_role.len(), SUPPORTED_CORE_LITE_ROLES.len());
    }
    assert_eq!(mapping.display_name_key, format!("{prefix}title"));
    assert_eq!(mapping.completed_statuses, ["done", "cancelled"]);
}

fn object<'a>(
    input: &'a Value,
    key: &str,
) -> Result<&'a Map<String, Value>, Box<dyn std::error::Error>> {
    input
        .get(key)
        .and_then(Value::as_object)
        .ok_or_else(|| format!("missing object: {key}").into())
}

fn matches(actual: &Value, expected: &Value) -> bool {
    if let Some(object) = expected.as_object() {
        if let Some(subset) = object.get("$contains") {
            return matches(actual, subset);
        }
        return actual.as_object().is_some_and(|values| {
            object
                .iter()
                .all(|(key, value)| values.get(key).is_some_and(|v| matches(v, value)))
        });
    }
    actual == expected
}
