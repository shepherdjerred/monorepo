//! Durable skip membership over typed original lists and the ordinary CAS plan.

use super::{
    Map, PlanContext, PlannedFile, Result, RuntimeError, TaskDocument, VaultPath, json, read,
    update,
};
use crate::types::Command;
use tasknotes_vault::{config::TaskNotesConfiguration, instances::InstanceLists, temporal};

pub(super) fn validate_planned(context: &PlanContext, path: &str, bytes: &[u8]) -> Result<()> {
    if matches!(
        &context.mutation.command,
        Command::SetOccurrenceSkipped { .. }
            | Command::SetCompletion { .. }
            | Command::ToggleComplete { .. }
            | Command::SetStatus { .. }
            | Command::EditTask {
                status: Some(_),
                ..
            }
    ) {
        validate_sources(
            context.config,
            &TaskDocument::parse(VaultPath::parse(path)?, bytes)?,
        )?;
    }
    Ok(())
}

pub(super) fn validate_sources(
    config: &TaskNotesConfiguration,
    document: &TaskDocument,
) -> Result<()> {
    if config
        .mapping
        .normalize(document.frontmatter())
        .get("recurrence")
        .and_then(serde_json::Value::as_str)
        .is_some_and(|rule| !rule.trim().is_empty())
    {
        InstanceLists::parse_mapped(document.frontmatter(), &config.mapping)?;
    }
    Ok(())
}

pub(super) fn plan(
    context: &PlanContext,
    path: &str,
    expected: Option<&str>,
    day: &str,
    skipped: bool,
) -> Result<Vec<PlannedFile>> {
    temporal::parse_day(day)?;
    let original = read(context.files, context.id, path, expected)?;
    let document = TaskDocument::parse(VaultPath::parse(path)?, &original)?;
    let properties = context.config.mapping.normalize(document.frontmatter());
    let rule = properties
        .get("recurrence")
        .and_then(serde_json::Value::as_str)
        .filter(|rule| !rule.trim().is_empty())
        .ok_or_else(|| RuntimeError::Validation("skip requires a recurring task".into()))?;
    let recurrence = tasknotes_core::recurrence::Recurrence::parse(
        rule,
        properties
            .get("scheduled")
            .and_then(serde_json::Value::as_str),
        properties
            .get("dateCreated")
            .and_then(serde_json::Value::as_str),
    );
    if !recurrence.is_expandable() {
        return Err(RuntimeError::Validation(
            "skip requires a valid seeded recurrence".into(),
        ));
    }
    let mut lists = InstanceLists::parse_mapped(document.frontmatter(), &context.config.mapping)?;
    let before = lists.clone();
    if skipped {
        lists.completed.retain(|value| value != day);
        if !lists.skipped.iter().any(|value| value == day) {
            lists.skipped.push(day.to_owned());
        }
    } else {
        lists.skipped.retain(|value| value != day);
    }
    if lists == before {
        return Ok(Vec::new());
    }
    update(
        context,
        path,
        Some(document.revision().as_str()),
        Map::from_iter([
            ("completeInstances".into(), json!(lists.completed)),
            ("skippedInstances".into(), json!(lists.skipped)),
        ]),
        None,
    )
}
