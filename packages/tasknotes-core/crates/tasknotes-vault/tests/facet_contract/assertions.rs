use super::TestResult;
use serde_json::{Value, json};
use std::collections::BTreeSet;

fn require(condition: bool, message: &'static str) -> TestResult {
    if condition {
        Ok(())
    } else {
        Err(message.into())
    }
}

pub(super) fn verify_filename_title(result: &tasknotes_vault::Result<Value>) -> TestResult {
    let value = result
        .as_ref()
        .map_err(|_| "filename-title rename failed")?;
    require(
        value.get("path") == Some(&json!("tasks/New Title.md")),
        "wrong filename title path",
    )?;
    require(
        value.get("renamed") == Some(&Value::Bool(true)),
        "rename result missing",
    )?;
    // The exact original input creates these values before the rename. The title
    // is stored in the filename; it does not create an additional title mirror.
    require(
        value.get("frontmatter")
            == Some(&json!({
                "status":"open", "priority":"normal", "tags":["task"],
                "dateCreated":"2026-02-20T10:00:00Z", "dateModified":"2026-02-20T10:00:00Z"
            })),
        "filename-title rename must preserve original metadata without a new title mirror",
    )
}

pub(super) fn verify_claim(value: &Value) -> TestResult {
    for (key, expected) in [
        ("schemaVersion", json!(1)),
        ("implementation", json!("Facet-Rust")),
        ("version", json!(env!("CARGO_PKG_VERSION"))),
        ("spec_version", json!("0.3.0-rc.9")),
        ("validation_modes", json!(["strict"])),
        ("profiles", json!([])),
        ("capabilities", json!(["batch", "concurrency"])),
    ] {
        require(
            value.get(key) == Some(&expected),
            "unproved conformance claim",
        )?;
    }
    // These are the support policy for this release, not a projection copied
    // from the production registry. Native/runtime prerequisites are incomplete;
    // real batch and stale-revision witnesses prove the two advertised features.
    verify_readiness(
        value,
        "profileReadiness",
        &[
            "core-lite",
            "recurrence",
            "extended",
            "templating",
            "materialized-occurrences",
        ],
        &[],
    )?;
    verify_readiness(
        value,
        "capabilityReadiness",
        &[
            "batch",
            "concurrency",
            "dependencies",
            "reminders",
            "links",
            "rename",
            "archive",
            "dry-run",
            "migration",
            "templating",
            "materialized-occurrences",
        ],
        &["batch", "concurrency"],
    )
}

fn verify_readiness(value: &Value, key: &str, expected: &[&str], supported: &[&str]) -> TestResult {
    let entries = value
        .get(key)
        .and_then(Value::as_array)
        .ok_or("readiness inventory missing")?;
    let mut names = BTreeSet::new();
    for entry in entries {
        let name = entry
            .get("name")
            .and_then(Value::as_str)
            .ok_or("readiness name missing")?;
        require(names.insert(name), "duplicate readiness name")?;
        let missing = entry
            .get("missing")
            .and_then(Value::as_array)
            .ok_or("readiness prerequisites missing")?;
        let ready = supported.contains(&name);
        require(
            entry.get("implemented") == Some(&Value::Bool(ready)),
            "false readiness",
        )?;
        require(
            missing.is_empty() == ready,
            "false prerequisite completeness",
        )?;
        let mut prerequisites = BTreeSet::new();
        for item in missing {
            let item = item
                .as_str()
                .filter(|item| !item.is_empty())
                .ok_or("invalid prerequisite")?;
            require(prerequisites.insert(item), "duplicate prerequisite")?;
        }
    }
    require(
        names == expected.iter().copied().collect(),
        "readiness inventory changed",
    )
}
