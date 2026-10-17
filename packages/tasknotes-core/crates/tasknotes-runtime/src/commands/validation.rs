//! Strict validation of the actual mapped document after semantic edits.

use crate::{Result, RuntimeError};
use serde_json::Value;
use tasknotes_vault::{config::TaskNotesConfiguration, document::TaskDocument, path::VaultPath};

pub(super) fn enforce(config: &TaskNotesConfiguration, path: &str, bytes: &[u8]) -> Result<()> {
    let document = TaskDocument::parse(VaultPath::parse(path)?, bytes)?;
    if !super::is_task(path, document.frontmatter(), document.body(), config)? {
        return Err(RuntimeError::Validation(
            "task mutation would stop matching configured task detection".to_owned(),
        ));
    }
    let mut mapping = config.mapping.clone();
    mapping.completed_statuses = config
        .statuses
        .iter()
        .filter(|status| status.is_completed)
        .map(|status| status.value.clone())
        .collect();
    let policy = config.effective.get("validation");
    let report = tasknotes_vault::validation::evaluate_mapped(
        &mapping,
        document.frontmatter(),
        Some(path),
        policy.and_then(|value| value.get("reject_unknown_fields")) == Some(&Value::Bool(true)),
    );
    let strict = policy
        .and_then(|value| value.get("mode"))
        .and_then(Value::as_str)
        .is_none_or(|mode| mode == "strict");
    if strict && report.get("hasErrors") == Some(&Value::Bool(true)) {
        return Err(RuntimeError::Validation(format!(
            "mapped document validation failed: {}",
            report.get("issues").unwrap_or(&Value::Null)
        )));
    }
    super::validate_properties(&mapping.normalize(document.frontmatter()), config)
}
