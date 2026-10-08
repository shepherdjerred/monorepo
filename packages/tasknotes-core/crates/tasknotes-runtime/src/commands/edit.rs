//! A combined edit and workflow transition planned from one original revision.

use super::{Map, PlanContext, PlannedFile, Result, RuntimeError, TaskDocument, Value, VaultPath};
use tasknotes_vault::mapping::canonical_role;

pub(super) fn plan(
    context: &PlanContext,
    path: &str,
    expected: Option<&str>,
    properties: &Map<String, Value>,
    body: Option<&str>,
    status: Option<&str>,
    occurrence: Option<&str>,
) -> Result<Vec<PlannedFile>> {
    let mut properties = canonical_properties(context, properties)?;
    super::temporal_writes::prepare_transition(&mut properties, context.config)?;
    let old = super::read(context.files, context.id, path, expected)?;
    let document = TaskDocument::parse(VaultPath::parse(path)?, &old)?;
    if let Some(status) = status {
        // Stage only in memory: transition semantics see edits to recurrence, dates and entries.
        let staged = document.plan(&super::edits(&properties, context.config), body)?;
        let staged = TaskDocument::parse(VaultPath::parse(path)?, &staged.bytes)?;
        super::instances::validate_sources(context.config, &staged)?;
        let normalized = context.config.mapping.normalize(staged.frontmatter());
        properties.extend(super::status_changes(
            context,
            &normalized,
            status,
            occurrence,
        )?);
    }
    super::update(
        context,
        path,
        Some(document.revision().as_str()),
        properties,
        body,
    )
}

fn canonical_properties(
    context: &PlanContext,
    properties: &Map<String, Value>,
) -> Result<Map<String, Value>> {
    let mut canonical = Map::new();
    for (key, value) in properties {
        let role = canonical_role(key)
            .or_else(|| {
                context
                    .config
                    .mapping
                    .field_to_role
                    .get(key)
                    .map(String::as_str)
            })
            .unwrap_or(key);
        if role == "status" {
            return Err(RuntimeError::Validation(
                "edit_task status must use its named status field".to_owned(),
            ));
        }
        if canonical.insert(role.to_owned(), value.clone()).is_some() {
            return Err(RuntimeError::Validation(
                "edit_task contains duplicate mapped property roles".to_owned(),
            ));
        }
    }
    Ok(canonical)
}
