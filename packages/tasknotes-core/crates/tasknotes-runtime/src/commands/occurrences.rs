//! Explicit occurrence creation against current, mapped collection identities.
//! Parent reads become durable journal dependencies; they are not fake writes.

use super::{
    Map, PlanContext, PlannedFile, Result, RuntimeError, TaskDocument, Value, VaultPath, create,
    is_task, json, read, temporal_writes,
};
use crate::types::{Command, Diagnostic, Mutation, VaultFiles};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tasknotes_vault::{config::TaskNotesConfiguration, links, temporal};

/// A persisted read dependency, checked before publication and journal recovery.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReadPlan {
    pub parent_path: String,
    pub parent_revision: String,
    pub task_path: String,
    pub existing_revision: Option<String>,
}

pub(crate) struct Plan {
    pub writes: Vec<PlannedFile>,
    pub diagnostics: Vec<Diagnostic>,
    pub reads: ReadPlan,
    pub creation: Mutation,
}

/// Validate identity shape without interpreting withdrawn custom timing fields.
pub(crate) fn identity(properties: &Map<String, Value>) -> Result<Option<(&str, &str)>> {
    let parent = properties.get("recurrenceParent");
    let date = properties.get("occurrenceDate");
    if parent.is_none() && date.is_none() {
        return Ok(None);
    }
    let parent = parent
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| invalid("invalid_recurrence_parent"))?;
    links::parse(parent).map_err(|_| invalid("invalid_recurrence_parent"))?;
    let date = date
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("invalid_occurrence_date"))?;
    temporal::parse_day(date).map_err(|_| invalid("invalid_occurrence_date"))?;
    if properties
        .get("recurrence")
        .is_some_and(|value| !value.is_null() && value != "")
    {
        return Err(invalid("occurrence_note_cannot_own_parent_recurrence"));
    }
    Ok(Some((parent, date)))
}

pub(crate) fn mapped_identity(
    config: &TaskNotesConfiguration,
    document: &TaskDocument,
) -> Result<Option<(String, String)>> {
    for role in ["recurrenceParent", "occurrenceDate"] {
        let field = config.mapping.field(role);
        if field != role
            && let (Some(physical), Some(canonical)) = (
                document.frontmatter().get(field),
                document.frontmatter().get(role),
            )
            && physical != canonical
        {
            return Err(invalid("ambiguous_occurrence_identity"));
        }
    }
    let properties = config.mapping.normalize(document.frontmatter());
    Ok(identity(&properties)?.map(|(parent, date)| (parent.to_owned(), date.to_owned())))
}

#[derive(Clone)]
pub(super) struct Child {
    pub path: String,
    pub revision: String,
    raw_parent: String,
    pub date: String,
}

pub(super) enum Selection {
    Lookup,
    Known(Option<Child>),
}

pub(super) fn unique_child(
    files: &dyn VaultFiles,
    profile: &str,
    config: &TaskNotesConfiguration,
    parent_path: &str,
    date: &str,
) -> Result<Option<Child>> {
    let mut selected = None;
    for (parent, child) in collection_children(files, profile, config)? {
        if parent == parent_path && child.date == date {
            if selected.is_some() {
                return Err(invalid("duplicate_occurrence_note"));
            }
            selected = Some(child);
        }
    }
    Ok(selected)
}

pub(super) fn collection_children(
    files: &dyn VaultFiles,
    profile: &str,
    config: &TaskNotesConfiguration,
) -> Result<Vec<(String, Child)>> {
    let mut candidates = Vec::new();
    let mut ids = BTreeMap::new();
    let mut children = Vec::new();
    for path in files.list_files(profile)? {
        if !path.to_ascii_lowercase().ends_with(".md") {
            continue;
        }
        let bytes = read(files, profile, &path, None)?;
        let document = TaskDocument::parse(VaultPath::parse(&path)?, &bytes)?;
        if !is_task(&path, document.frontmatter(), document.body(), config)? {
            continue;
        }
        let normalized = config.mapping.normalize(document.frontmatter());
        if let Some(id) = normalized.get("id").and_then(Value::as_str) {
            ids.insert(path.clone(), id.to_owned());
        }
        if let Some((raw_parent, date)) = mapped_identity(config, &document)? {
            children.push(Child {
                path: path.clone(),
                revision: document.revision().as_str().to_owned(),
                raw_parent,
                date,
            });
        }
        candidates.push(path);
    }
    let mut resolved_children = Vec::new();
    for child in children {
        let resolved = links::resolve(&json!({
            "raw":child.raw_parent,"sourcePath":child.path,"candidates":candidates,"idIndex":ids
        }))
        .map_err(|_| invalid("invalid_recurrence_parent"))?;
        if !candidates.contains(&resolved) {
            return Err(invalid("invalid_recurrence_parent"));
        }
        resolved_children.push((resolved, child));
    }
    Ok(resolved_children)
}

pub(crate) fn plan(
    files: &dyn VaultFiles,
    profile: &str,
    config: &TaskNotesConfiguration,
    mutation: &Mutation,
) -> Result<Plan> {
    plan_selected(files, profile, config, mutation, Selection::Lookup)
}

pub(super) fn plan_selected(
    files: &dyn VaultFiles,
    profile: &str,
    config: &TaskNotesConfiguration,
    mutation: &Mutation,
    selection: Selection,
) -> Result<Plan> {
    let Command::MaterializeOccurrence {
        parent_path,
        expected_parent_revision,
        occurrence_date,
        expected_occurrence_revision,
        properties,
        body,
    } = &mutation.command
    else {
        return Err(RuntimeError::Storage(
            "occurrence command dispatch mismatch".into(),
        ));
    };
    let parent = parent_document(
        files,
        profile,
        config,
        parent_path,
        expected_parent_revision,
    )?;
    let parent_properties = config.mapping.normalize(parent.frontmatter());
    let explicit = explicit_properties(config, properties)?;
    let child = match selection {
        Selection::Lookup => unique_child(files, profile, config, parent_path, occurrence_date)?,
        Selection::Known(child) => child,
    };
    if let Some(child) = child {
        if expected_occurrence_revision
            .as_ref()
            .is_some_and(|revision| revision != &child.revision)
        {
            return Err(RuntimeError::Conflict);
        }
        return Ok(Plan {
            writes: Vec::new(),
            diagnostics: Vec::new(),
            reads: ReadPlan {
                parent_path: parent_path.clone(),
                parent_revision: expected_parent_revision.clone(),
                task_path: child.path,
                existing_revision: Some(child.revision),
            },
            creation: mutation.clone(),
        });
    }
    if expected_occurrence_revision.is_some() {
        return Err(RuntimeError::Conflict);
    }
    // Round-trip the exact path through the existing parser before persisting it.
    // Unsupported delimiter spellings fail rather than referring to another parent.
    let reference = format!("[[/{parent_path}]]");
    if links::resolve(&json!({"raw":reference,"sourcePath":"","candidates":[parent_path]}))?
        != *parent_path
    {
        return Err(invalid("parent_path_cannot_be_represented_losslessly"));
    }
    let mut prepared = explicit;
    prepared.entry("title").or_insert_with(|| {
        json!(format!(
            "{} {occurrence_date}",
            config
                .mapping
                .display_title(parent.frontmatter(), Some(parent_path))
                .unwrap_or_else(|| parent_path.clone())
        ))
    });
    prepared.insert("recurrenceParent".into(), json!(reference));
    prepared.insert("occurrenceDate".into(), json!(occurrence_date));
    let child_config = child_configuration(config, &parent_properties)?;
    let mut creation = mutation.clone();
    creation.command = Command::Create {
        path: None,
        properties: prepared.clone(),
        body: body.clone(),
    };
    let mut context = PlanContext::new(files, profile, &child_config, &creation);
    context.occurrence_day = Some(occurrence_date);
    let mut writes = create(&context, None, &prepared, body.as_deref())?;
    let write = writes
        .first_mut()
        .ok_or_else(|| RuntimeError::Storage("occurrence creation lacks its task".into()))?;
    let path = write.path.clone();
    finalize_child(
        &context,
        parent_path,
        occurrence_date,
        &parent_properties,
        write,
    )?;
    Ok(Plan {
        writes,
        diagnostics: context.diagnostics.into_inner(),
        reads: ReadPlan {
            parent_path: parent_path.clone(),
            parent_revision: expected_parent_revision.clone(),
            task_path: path,
            existing_revision: None,
        },
        creation,
    })
}

fn explicit_properties(
    config: &TaskNotesConfiguration,
    properties: &Map<String, Value>,
) -> Result<Map<String, Value>> {
    let explicit = temporal_writes::command_properties(properties.clone(), config)?;
    for role in [
        "recurrenceParent",
        "occurrenceDate",
        "recurrence",
        "recurrenceAnchor",
        "completeInstances",
        "skippedInstances",
        "occurrenceMaterialization",
        "occurrenceNextTrigger",
        "occurrenceTemplate",
        "occurrencePastHorizon",
        "occurrenceFutureHorizon",
    ] {
        if explicit.contains_key(role) {
            return Err(invalid(
                "occurrence_identity_and_series_fields_are_reserved",
            ));
        }
    }
    Ok(explicit)
}

pub(super) fn parent_document(
    files: &dyn VaultFiles,
    profile: &str,
    config: &TaskNotesConfiguration,
    path: &str,
    revision: &str,
) -> Result<TaskDocument> {
    let bytes = read(files, profile, path, Some(revision))?;
    let parent = TaskDocument::parse(VaultPath::parse(path)?, &bytes)?;
    validate_parent(config, path, parent)
}
pub(super) fn validate_parent(
    config: &TaskNotesConfiguration,
    path: &str,
    parent: TaskDocument,
) -> Result<TaskDocument> {
    if !is_task(path, parent.frontmatter(), parent.body(), config)? {
        return Err(invalid("invalid_recurrence_parent"));
    }
    let properties = config.mapping.normalize(parent.frontmatter());
    super::recurrence_writes::validate_mapped_strict(config, &parent)?;
    mapped_identity(config, &parent)?;
    validate_parent_properties(&properties)?;
    Ok(parent)
}

pub(crate) fn validate_parent_properties(properties: &Map<String, Value>) -> Result<()> {
    if !tasknotes_vault::occurrence_policy::invalid_roles(properties).is_empty() {
        return Err(invalid("invalid_occurrence_policy"));
    }
    super::recurrence_writes::validate_strict(properties)?;
    if identity(properties)?.is_some() {
        return Err(invalid("occurrence_note_cannot_be_series_parent"));
    }
    let rule = properties
        .get("recurrence")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("materialization_requires_recurring_parent"))?;
    let recurrence = tasknotes_core::recurrence::Recurrence::parse(
        rule,
        properties.get("scheduled").and_then(Value::as_str),
        properties.get("dateCreated").and_then(Value::as_str),
    );
    if !recurrence.is_expandable() {
        return Err(invalid("materialization_requires_valid_seeded_parent"));
    }
    Ok(())
}

fn child_configuration(
    config: &TaskNotesConfiguration,
    parent: &Map<String, Value>,
) -> Result<TaskNotesConfiguration> {
    let mut config = config.clone();
    if let Some(template) = parent.get("occurrenceTemplate") {
        let template = template
            .as_str()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| invalid("invalid_occurrence_template"))?;
        VaultPath::parse(template)?;
        let policy = config
            .effective
            .get_mut("templating")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| RuntimeError::Configuration("templating policy is missing".into()))?;
        policy.insert("enabled".into(), json!(true));
        policy.insert("template_path".into(), json!(template));
    }
    Ok(config)
}

fn finalize_child(
    context: &PlanContext,
    parent_path: &str,
    occurrence_date: &str,
    parent_properties: &Map<String, Value>,
    write: &mut PlannedFile,
) -> Result<()> {
    let path = &write.path;
    let config = context.config;
    let bytes = write
        .bytes
        .as_ref()
        .ok_or_else(|| RuntimeError::Storage("occurrence creation is a tombstone".into()))?;
    let document = TaskDocument::parse(VaultPath::parse(path)?, bytes)?;
    let final_properties = config.mapping.normalize(document.frontmatter());
    if !final_properties.contains_key("attachments")
        && let Some(attachments) = parent_properties.get("attachments")
    {
        let inherited =
            inherit_attachments(context.files, context.id, parent_path, path, attachments)?;
        let edit = tasknotes_vault::document::PropertyEdit::Set {
            key: config.mapping.field("attachments").into(),
            value: inherited,
        };
        write.bytes = Some(document.plan(&[edit], None)?.bytes);
    }
    let final_document = TaskDocument::parse(
        VaultPath::parse(path)?,
        write
            .bytes
            .as_deref()
            .ok_or_else(|| RuntimeError::Storage("occurrence image is missing".into()))?,
    )?;
    let Some((actual_parent, actual_date)) = mapped_identity(config, &final_document)? else {
        return Err(invalid("invalid_occurrence_identity"));
    };
    if actual_date != occurrence_date
        || links::resolve(
            &json!({"raw":actual_parent,"sourcePath":path,"candidates":[parent_path]}),
        )? != parent_path
    {
        return Err(invalid("occurrence_creation_changed_requested_identity"));
    }
    super::validation::enforce(
        config,
        path,
        write
            .bytes
            .as_deref()
            .ok_or_else(|| RuntimeError::Storage("occurrence image is missing".into()))?,
    )?;
    Ok(())
}

fn inherit_attachments(
    files: &dyn VaultFiles,
    profile: &str,
    parent: &str,
    child: &str,
    value: &Value,
) -> Result<Value> {
    let entries = value
        .as_array()
        .ok_or_else(|| invalid("attachments_must_be_a_list"))?;
    let candidates = files.list_files(profile)?;
    let mut inherited = Vec::with_capacity(entries.len());
    for entry in entries {
        let raw = entry
            .as_str()
            .ok_or_else(|| invalid("attachment_reference_must_be_a_string"))?;
        let parsed = links::parse(raw)?;
        let target =
            links::resolve(&json!({"raw":raw,"sourcePath":parent,"candidates":candidates}))?;
        let anchor = parsed
            .anchor
            .as_ref()
            .map_or_else(String::new, |anchor| format!("#{anchor}"));
        let rebased = match parsed.format.as_str() {
            "wikilink" => format!(
                "[[/{target}{anchor}{}]]",
                parsed
                    .alias
                    .as_ref()
                    .map_or_else(String::new, |alias| format!("|{alias}"))
            ),
            "markdown" => format!(
                "[{}](/{target}{anchor})",
                parsed.alias.as_deref().unwrap_or_default()
            ),
            _ => format!("/{target}{anchor}"),
        };
        if links::resolve(&json!({"raw":rebased,"sourcePath":child,"candidates":candidates}))?
            != target
        {
            return Err(invalid("attachment_reference_cannot_be_rebased_losslessly"));
        }
        inherited.push(json!(rebased));
    }
    Ok(json!(inherited))
}

fn invalid(code: &str) -> RuntimeError {
    RuntimeError::Validation(code.into())
}
