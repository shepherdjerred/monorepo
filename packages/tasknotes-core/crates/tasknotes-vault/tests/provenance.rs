//! The upstream corpus is an immutable oracle, not an implementation pass count.

use std::{fs, path::PathBuf};

use serde_json::Value;
use sha2::{Digest, Sha256};

#[test]
fn all_pinned_spec_cases_retain_their_original_bytes() -> Result<(), Box<dyn std::error::Error>> {
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../tasknotes-fixtures/vault/upstream");
    let provenance: Value = serde_json::from_slice(&fs::read(directory.join("provenance.json"))?)?;
    assert_eq!(
        provenance.get("revision").and_then(Value::as_str),
        Some("4c619bf130330e1ca7df2c773800857f731ca8c6")
    );
    let files = provenance
        .get("files")
        .and_then(Value::as_array)
        .ok_or("fixture provenance must list files")?;
    assert_eq!(files.len(), 14);
    let mut total = 0;
    for fixture in files {
        let name = fixture
            .get("file")
            .and_then(Value::as_str)
            .ok_or("fixture name is required")?;
        let bytes = fs::read(directory.join(name))?;
        assert_eq!(
            hex::encode(Sha256::digest(&bytes)),
            fixture
                .get("sha256")
                .and_then(Value::as_str)
                .ok_or("fixture hash is required")?,
            "{name} was changed from the pinned oracle"
        );
        let cases: Vec<Value> = serde_json::from_slice(&bytes)?;
        assert_eq!(
            u64::try_from(cases.len())?,
            fixture
                .get("cases")
                .and_then(Value::as_u64)
                .ok_or("fixture count is required")?
        );
        total += cases.len();
    }
    assert_eq!(total, 4980);
    let manifest = fs::read(directory.join("manifest.json"))?;
    assert_eq!(
        hex::encode(Sha256::digest(manifest)),
        provenance
            .get("manifestSha256")
            .and_then(Value::as_str)
            .ok_or("manifest hash is required")?
    );
    Ok(())
}
