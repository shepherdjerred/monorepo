//! Explicit Facet expectations for seven disputed, immutable upstream inputs.
//!
//! These assertions are separate from the raw upstream matcher and from the
//! 43 withdrawn timing contracts. No other difference is admitted here.

use super::TestResult;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use tasknotes_vault::VaultError;

mod assertions;
mod tests;

pub(super) fn verify_claim(value: &Value) -> TestResult {
    assertions::verify_claim(value)
}

struct Contract {
    id: &'static str,
    operation: &'static str,
    input_sha256: &'static str,
}

const CASES: &[Contract] = &[
    Contract {
        id: "link.0028",
        operation: "link.resolve",
        input_sha256: "c44a52cc423b77076be986f5be2a6e119f5808602fed0ab533344b5fca58deb2",
    },
    Contract {
        id: "link.0029",
        operation: "link.resolve",
        input_sha256: "e690bc221e762d062f2308dda2b4923197a4fb9f4658e0160ba3c4bca1b6658c",
    },
    Contract {
        id: "link.0032",
        operation: "link.resolve",
        input_sha256: "1834316554541d2041ba4203828e135189c24e3215d5981987731972a685103f",
    },
    Contract {
        id: "ops.0066",
        operation: "rename.title_storage_interaction",
        input_sha256: "286fba275335ff2dd19e26b5148b9217e4b5ad6a04f072181d2112bfb66abbb6",
    },
    Contract {
        id: "conformance.0018",
        operation: "meta.claim",
        input_sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    },
    Contract {
        id: "conformance.0019",
        operation: "meta.claim",
        input_sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    },
    Contract {
        id: "conformance.0020",
        operation: "meta.claim",
        input_sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    },
];

pub(super) fn contains(id: &str) -> bool {
    CASES.iter().any(|case| case.id == id)
}

fn canonical(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .collect::<BTreeMap<_, _>>()
                .into_iter()
                .map(|(key, value)| (key.clone(), canonical(value)))
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(canonical).collect()),
        _ => value.clone(),
    }
}

fn admit(id: &str, operation: &str, input: &Value) -> TestResult {
    let case = CASES
        .iter()
        .find(|case| case.id == id)
        .ok_or_else(|| format!("unknown Facet contract: {id}"))?;
    let input_hash = hex::encode(Sha256::digest(serde_json::to_vec(&canonical(input))?));
    if case.operation != operation || case.input_sha256 != input_hash {
        return Err(format!("Facet contract input or operation changed: {id}").into());
    }
    Ok(())
}

pub(super) fn consume(consumed: &mut BTreeSet<String>, id: &str) -> TestResult {
    if !contains(id) || !consumed.insert(id.to_owned()) {
        return Err(format!("unknown or duplicate Facet contract consumption: {id}").into());
    }
    Ok(())
}

pub(super) fn assert_complete(consumed: &BTreeSet<String>) -> TestResult {
    let expected: BTreeSet<String> = CASES.iter().map(|case| case.id.to_owned()).collect();
    if CASES.len() != 7 || expected.len() != 7 || consumed != &expected {
        return Err("Facet contracts missing, duplicated or unrecognized".into());
    }
    Ok(())
}

pub(super) fn verify(
    id: &str,
    operation: &str,
    input: &Value,
    result: &tasknotes_vault::Result<Value>,
) -> TestResult {
    admit(id, operation, input)?;
    verify_result(id, result)
}

pub(super) fn verify_result(id: &str, result: &tasknotes_vault::Result<Value>) -> TestResult {
    match id {
        "link.0028" => {
            if !matches!(result, Err(VaultError::Document(code)) if code == "ambiguous_link") {
                return Err("ambiguous links must not choose a candidate".into());
            }
        }
        "link.0029" | "link.0032" => {
            let path = if id == "link.0029" {
                "escape.md"
            } else {
                "outside/secret.md"
            };
            if !result
                .as_ref()
                .is_ok_and(|value| value == &serde_json::json!({"path":path}))
            {
                return Err(
                    "root-contained relative link must resolve its exact logical path".into(),
                );
            }
        }
        "ops.0066" => assertions::verify_filename_title(result)?,
        "conformance.0018" | "conformance.0019" | "conformance.0020" => {
            verify_claim(result.as_ref().map_err(|_| "conformance metadata failed")?)?;
        }
        _ => return Err(format!("unknown Facet contract assertion: {id}").into()),
    }
    Ok(())
}
