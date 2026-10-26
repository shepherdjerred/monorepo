//! Real feature-request admission and the canonical metadata producer seam.

use super::{FfiFacetEngine, tests::EmptyVault};
use serde_json::Value;
use std::sync::Arc;

#[test]
fn dependency_editor_shared_requests_use_the_actual_ffi_feature_seam()
-> Result<(), Box<dyn std::error::Error>> {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../../tasknotes-fixtures/vault/facet-dependency-editor-contract.json"
    ))?;
    let engine = FfiFacetEngine::new(":memory:", Arc::new(EmptyVault))?;
    engine.register_profile(
        r#"{"id":"a","name":"Example","kind":"local_folder","approveStandard":true}"#,
    )?;
    engine.refresh("a")?;
    let cases = corpus["cases"]
        .as_array()
        .ok_or("dependency cases missing")?;
    assert_eq!(cases.len(), 13);
    let mut identifiers = std::collections::BTreeSet::new();
    for case in cases {
        assert!(identifiers.insert(case["id"].as_str().ok_or("case id missing")?));
        if case["definition"] == "featureRequest" {
            assert_eq!(
                engine
                    .features_json("a", &serde_json::to_string(&case["value"])?)
                    .is_ok(),
                case["valid"].as_bool().ok_or("case validity missing")?,
                "{}",
                case["id"]
            );
        }
    }
    let actual: Value = serde_json::from_str(
        &engine.features_json("a", r#"{"schemaVersion":1,"kind":"dependency_editor"}"#)?,
    )?;
    let expected = cases
        .iter()
        .find(|case| case["id"] == "dependency-editor-response-without-default")
        .ok_or("default response missing")?;
    assert_eq!(actual, expected["value"]);
    Ok(())
}
