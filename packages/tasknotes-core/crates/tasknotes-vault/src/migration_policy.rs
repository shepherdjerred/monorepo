//! Explicit normalization policy and deterministic previews shared by runtime commands.

use crate::{Result, VaultError, migration};
use serde_json::{Map, Value, json};

/// Operations implemented by the explicit normalization policy.
pub const OPERATIONS: &[&str] = &[
    "migration.plan",
    "migration.divergence_register",
    "migration.deprecation_policy",
    "migration.safety_guards",
    "migration.compat_statement",
];

/// Preview known alias and datetime spelling changes without touching storage.
/// Unknown fields, valid date-only values, links, and recurrence semantics remain intact.
#[must_use]
pub fn preview(frontmatter: &Map<String, Value>) -> Value {
    let (mut normalized, issues) = migration::aliases(frontmatter);
    for key in ["dateCreated", "dateModified", "absoluteTime"] {
        if let Some(value) = normalized.get(key) {
            normalized.insert(key.to_owned(), migration::temporal_value(value));
        }
    }
    json!({"frontmatter":normalized,"issues":issues,"changed":&normalized!=frontmatter})
}

/// Read the declared policy or compute an actual deterministic preview.
///
/// # Errors
/// Rejects unknown operations and non-object frontmatter.
pub fn execute(operation: &str, input: &Value) -> Result<Value> {
    match operation {
        "migration.plan" => {
            let frontmatter = match input.get("frontmatter") {
                None => Map::new(),
                Some(value) => value
                    .as_object()
                    .cloned()
                    .ok_or_else(|| VaultError::Document("frontmatter_required".to_owned()))?,
            };
            Ok(
                json!({"deterministic":true,"dryRunSupported":true,"rollbackSafeGuidance":true,"preview":preview(&frontmatter),"rollbackGuidance":"Retain a vault and private SQLite backup before normalization; durable mutation receipts retain exact before-images for fenced Undo."}),
            )
        }
        "migration.divergence_register" => Ok(
            json!({"columns":["section","current_behavior","target_behavior","migration_strategy","deprecation_timeline"],"entries":[
                {"section":"11.4","current_behavior":"Reject ambiguous filename links","target_behavior":"Reject ambiguous filename links","migration_strategy":"Never retarget from an expected test answer","deprecation_timeline":null},
                {"section":"11.5","current_behavior":"Reject paths escaping the collection","target_behavior":"Reject paths escaping the collection","migration_strategy":"Preserve valid within-root targets","deprecation_timeline":null}
            ]}),
        ),
        "migration.deprecation_policy" => Ok(
            json!({"includes":["release_notes","warning_period","migration_tooling","versioned_removal"],"release_notes":"Required before removing compatibility behavior","warning_period":"At least one documented release before removal","migration_tooling":"Explicit read-only preview and durable normalization command","versioned_removal":"Removal requires a documented version boundary"}),
        ),
        "migration.safety_guards" => Ok(
            json!({"prevents":["drop_unknown_fields","date_to_datetime_silent_conversion","silent_link_retarget"],"normalizationIsExplicit":true}),
        ),
        "migration.compat_statement" => Ok(
            json!({"value":"Compatibility mode is never silently enabled. Legacy alias and datetime spelling normalization requires an explicit reviewed mutation; direct Sync replicas use direct cutover without a legacy import project."}),
        ),
        _ => Err(VaultError::Document("unsupported_operation".to_owned())),
    }
}
