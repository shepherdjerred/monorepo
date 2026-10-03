//! Execute every case in the unmodified, pinned upstream field-mapping corpus.

use serde_json::{Map, Value, json};
use tasknotes_vault::mapping::FieldMapping;

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
    for case in cases {
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
        assert!(
            matches(&actual, expected),
            "{}: expected {expected}, got {actual}",
            case.get("id").ok_or("missing fixture ID")?
        );
    }
    Ok(())
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
