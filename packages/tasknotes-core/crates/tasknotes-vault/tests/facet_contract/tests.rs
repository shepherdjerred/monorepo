use super::{
    CASES, TestResult, admit, assert_complete, consume, verify, verify_claim, verify_result,
};
use serde_json::{Value, json};
use std::{collections::BTreeSet, fs, path::PathBuf};
use tasknotes_vault::VaultError;

fn original_cases() -> Result<Vec<Value>, Box<dyn std::error::Error>> {
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tasknotes-fixtures/vault/upstream");
    let mut selected = Vec::new();
    for file in ["links.json", "operations.json", "conformance.json"] {
        let cases: Vec<Value> = serde_json::from_slice(&fs::read(directory.join(file))?)?;
        selected.extend(cases.into_iter().filter(|case| {
            case.get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| CASES.iter().any(|contract| contract.id == id))
        }));
    }
    Ok(selected)
}

#[test]
fn exact_membership_operation_input_and_consumption_are_closed() -> TestResult {
    let mut consumed = BTreeSet::new();
    for case in original_cases()? {
        let id = case.get("id").and_then(Value::as_str).ok_or("case ID")?;
        let operation = case
            .get("operation")
            .and_then(Value::as_str)
            .ok_or("case operation")?;
        let input = case.get("input").ok_or("case input")?;
        admit(id, operation, input)?;
        let reordered = Value::Object(
            input
                .as_object()
                .ok_or("input object")?
                .iter()
                .rev()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
        );
        admit(id, operation, &reordered)?;
        consume(&mut consumed, id)?;
        assert!(consume(&mut consumed, id).is_err());
        assert!(admit(id, "future.unknown", input).is_err());
        assert!(admit(id, operation, &Value::Null).is_err());
        let mut changed = input.clone();
        changed
            .as_object_mut()
            .ok_or("input object")?
            .insert("changed".into(), Value::Bool(true));
        assert!(admit(id, operation, &changed).is_err());
        assert!(verify(id, operation, input, &Ok(json!({"unexpected":true}))).is_err());
    }
    assert_complete(&consumed)?;
    assert!(consume(&mut consumed, "link.unknown").is_err());
    assert!(admit("link.unknown", "link.resolve", &json!({})).is_err());
    consumed.remove("link.0028");
    assert!(assert_complete(&consumed).is_err());
    consumed.insert("link.unknown".into());
    assert!(assert_complete(&consumed).is_err());
    assert!(verify_result("link.unknown", &Ok(json!({"path":"escape.md"}))).is_err());
    Ok(())
}

#[test]
fn gate_retains_a_failed_contract_even_when_its_upstream_matcher_passes() -> TestResult {
    let case = original_cases()?
        .into_iter()
        .find(|case| case.get("id").and_then(Value::as_str) == Some("link.0028"))
        .ok_or("ambiguous case missing")?;
    let input = case.get("input").ok_or("ambiguous input")?;
    let wrong = Ok(json!({"path":"notes/ambiguous.md"}));
    assert!(super::super::matches_case(
        case.get("assertion")
            .and_then(Value::as_str)
            .ok_or("assertion")?,
        &super::super::envelope(&wrong),
        case.get("expect"),
        input
    )?);
    let mut coverage = super::super::ContractCoverage::default();
    let mut failures = Vec::new();
    coverage.verify(
        "link.0028",
        "link.resolve",
        input,
        &wrong,
        &super::super::corpus_context()?,
        &mut failures,
    )?;
    assert_eq!(failures.len(), 1);
    assert_eq!(coverage.verified_facet, 0);
    assert!(coverage.facet.contains("link.0028"));
    assert!(coverage.assert_complete().is_err());
    Ok(())
}

#[test]
fn link_policy_preserves_containment_without_picking_ambiguous_targets() -> TestResult {
    for candidates in [
        json!(["tasks/ambiguous.md", "notes/ambiguous.md"]),
        json!(["notes/ambiguous.md", "tasks/ambiguous.md"]),
    ] {
        verify_result(
            "link.0028",
            &tasknotes_vault::links::execute(
                "link.resolve",
                &json!({
                    "raw":"[[ambiguous]]", "sourcePath":"tasks/sub/task-002.md", "candidates":candidates
                }),
            ),
        )?;
    }
    assert_eq!(
        tasknotes_vault::links::execute(
            "link.resolve",
            &json!({
                "raw":"[[ambiguous]]", "sourcePath":"tasks/sub/task-002.md", "candidates":["notes/ambiguous.md"]
            })
        )?,
        json!({"path":"notes/ambiguous.md"})
    );
    for (id, raw, source) in [
        ("link.0029", "[[../../escape]]", "tasks/sub/task-002.md"),
        (
            "link.0032",
            "[[../../../outside/secret]]",
            "deep/nested/path/task.md",
        ),
    ] {
        verify_result(
            id,
            &tasknotes_vault::links::execute(
                "link.resolve",
                &json!({
                    "raw":raw, "sourcePath":source, "collectionRoot":"/vault", "candidates":[]
                }),
            ),
        )?;
        assert!(verify_result(id, &Err(VaultError::Document("path_traversal".into()))).is_err());
    }
    for (raw, source) in [
        ("[[../../../escape]]", "tasks/sub/task-002.md"),
        ("[[../../../../outside/secret]]", "deep/nested/path/task.md"),
    ] {
        assert!(
            matches!(tasknotes_vault::links::execute("link.resolve", &json!({
            "raw":raw, "sourcePath":source, "collectionRoot":"/vault", "candidates":[]
        })), Err(VaultError::Document(code)) if code == "path_traversal")
        );
    }
    assert!(verify_result("link.0028", &Ok(json!({"path":"notes/ambiguous.md"}))).is_err());
    assert!(
        verify_result(
            "link.0028",
            &Err(VaultError::Configuration("ambiguous_link".into()))
        )
        .is_err()
    );
    Ok(())
}

#[test]
fn filename_contract_rejects_lost_metadata_new_mirror_and_wrong_path() -> TestResult {
    let expected = json!({"path":"tasks/New Title.md", "renamed":true, "frontmatter":{
        "status":"open", "priority":"normal", "tags":["task"],
        "dateCreated":"2026-02-20T10:00:00Z", "dateModified":"2026-02-20T10:00:00Z"
    }});
    verify_result("ops.0066", &Ok(expected.clone()))?;
    for field in ["status", "priority", "tags", "dateCreated", "dateModified"] {
        let mut lost = expected.clone();
        lost.get_mut("frontmatter")
            .and_then(Value::as_object_mut)
            .ok_or("metadata")?
            .remove(field);
        assert!(verify_result("ops.0066", &Ok(lost)).is_err());
    }
    for (field, value) in [("path", json!("tasks/Other.md")), ("renamed", json!(false))] {
        let mut changed = expected.clone();
        changed
            .as_object_mut()
            .ok_or("rename object")?
            .insert(field.into(), value);
        assert!(verify_result("ops.0066", &Ok(changed)).is_err());
    }
    let mut mirrored = expected;
    mirrored
        .get_mut("frontmatter")
        .and_then(Value::as_object_mut)
        .ok_or("metadata")?
        .insert("title".into(), json!("New Title"));
    assert!(verify_result("ops.0066", &Ok(mirrored)).is_err());
    Ok(())
}

#[test]
fn claim_contract_rejects_unproved_profiles_timing_and_false_readiness() -> TestResult {
    let actual = super::super::runtime_adapter::execute("meta.claim", &json!({}))?;
    verify_claim(&actual)?;
    for profile in [
        "core-lite",
        "recurrence",
        "extended",
        "templating",
        "materialized-occurrences",
    ] {
        let mut fabricated = actual.clone();
        fabricated
            .as_object_mut()
            .ok_or("claim object")?
            .insert("profiles".into(), json!([profile]));
        assert!(verify_claim(&fabricated).is_err());
    }
    for capability in [
        "time-tracking",
        "templating",
        "materialized-occurrences",
        "future.unknown",
    ] {
        let mut fabricated = actual.clone();
        fabricated.as_object_mut().ok_or("claim object")?.insert(
            "capabilities".into(),
            json!(["batch", "concurrency", capability]),
        );
        assert!(verify_claim(&fabricated).is_err());
    }
    for key in ["profileReadiness", "capabilityReadiness"] {
        let mut fabricated = actual.clone();
        let entries = fabricated
            .get_mut(key)
            .and_then(Value::as_array_mut)
            .ok_or("readiness array")?;
        let duplicate = entries.first().ok_or("readiness entry")?.clone();
        entries.push(duplicate);
        assert!(verify_claim(&fabricated).is_err());
    }
    let mut fabricated = actual;
    let readiness = fabricated
        .get_mut("profileReadiness")
        .and_then(Value::as_array_mut)
        .and_then(|entries| entries.first_mut())
        .and_then(Value::as_object_mut)
        .ok_or("readiness object")?;
    readiness.insert("missing".into(), json!([]));
    readiness.insert("implemented".into(), Value::Bool(true));
    assert!(verify_claim(&fabricated).is_err());
    Ok(())
}
