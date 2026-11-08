//! Existing workflow commands converge here for materialized children. The
//! selected occurrence day identifies the child; it is not its completion clock.

use super::{
    Map, PlanContext, PlannedFile, Result, RuntimeError, TaskDocument, Value, VaultPath, json, read,
};
use crate::types::{Command, Diagnostic, Mutation, VaultFiles};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use tasknotes_vault::{
    config::TaskNotesConfiguration, document::ContentRevision, instances::InstanceLists, links,
    temporal,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Fence {
    pub parent_path: String,
    pub parent_revision: String,
    pub parent_result_path: String,
    pub task_path: String,
    pub task_revision: String,
    pub result_path: String,
    pub occurrence_date: String,
    pub deferred_input_hash: Option<String>,
}

pub(crate) struct Plan {
    pub writes: Vec<PlannedFile>,
    pub diagnostics: Vec<Diagnostic>,
    pub fence: Fence,
    pub successor: Option<Mutation>,
    pub child_mutation: Mutation,
    pub deferred: Option<DeferredProgression>,
    pub repair_result: Option<RepairResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DeferredProgression {
    pub parent_path: String,
    pub parent_revision: String,
    pub input_parent_revision: String,
    pub child_path: String,
    pub child_revision: String,
    pub input_child_revision: String,
    pub occurrence_date: String,
    pub completion_instant: Option<DateTime<Utc>>,
    pub child_state: State,
    pub parent_projection_owed: bool,
    pub successor_discovery_owed: bool,
    pub anchor_applied: bool,
    pub origin_at: String,
    pub origin_context: Option<crate::types::ExecutionContext>,
    pub parent_properties: Map<String, Value>,
}

pub(crate) enum RepairResult {
    Materialized { occurrence_date: String },
    Exhausted,
    PolicyNoSuccessor,
}

pub(crate) fn deferred_input_hash(intent: &DeferredProgression) -> Result<String> {
    let inputs = (
        (
            &intent.parent_path,
            &intent.input_parent_revision,
            &intent.parent_properties,
        ),
        (
            &intent.child_path,
            &intent.input_child_revision,
            intent.child_state,
        ),
        (&intent.occurrence_date, intent.completion_instant),
        (
            intent.parent_projection_owed,
            intent.successor_discovery_owed,
            intent.anchor_applied,
        ),
        (&intent.origin_at, &intent.origin_context),
    );
    Ok(hex::encode(Sha256::digest(serde_json::to_vec(&inputs)?)))
}

fn resource_exhaustion(error: &RuntimeError) -> bool {
    matches!(error,RuntimeError::Validation(code) if code=="occurrence_expansion_resource_limit")
}

fn invalid(message: &str) -> RuntimeError {
    RuntimeError::Validation(message.into())
}

fn target(command: &Command) -> Option<(&str, Option<&str>, Option<&str>)> {
    match command {
        Command::SetCompletion {
            path,
            expected_revision,
            occurrence_date,
            ..
        }
        | Command::ToggleComplete {
            path,
            expected_revision,
            occurrence_date,
        }
        | Command::SetStatus {
            path,
            expected_revision,
            occurrence_date,
            ..
        }
        | Command::EditTask {
            path,
            expected_revision,
            occurrence_date,
            ..
        } => Some((
            path,
            expected_revision.as_deref(),
            occurrence_date.as_deref(),
        )),
        Command::SetOccurrenceSkipped {
            path,
            expected_revision,
            occurrence_date,
            ..
        } => Some((path, expected_revision.as_deref(), Some(occurrence_date))),
        Command::Update {
            path,
            expected_revision,
            ..
        } => Some((path, expected_revision.as_deref(), None)),
        _ => None,
    }
}

pub(crate) fn original_completion_instant(
    mutation: &Mutation,
    fence: &Fence,
) -> Result<Option<DateTime<Utc>>> {
    let commands = match &mutation.command {
        Command::Batch { commands } => commands.as_slice(),
        command => std::slice::from_ref(command),
    };
    let mut selected = None;
    for command in commands {
        let Some((path, _, Some(explicit))) = target(command) else {
            continue;
        };
        if path != fence.task_path && path != fence.parent_path
            || path == fence.parent_path
                && matches!(command, Command::EditTask { status: None, .. })
        {
            continue;
        }
        let (day, instant) = super::explicit_completion_target(mutation, explicit)?;
        if day.to_string() == fence.occurrence_date && selected.replace(instant).is_some() {
            return Err(RuntimeError::Storage(
                "multiple completion selections own one occurrence".into(),
            ));
        }
    }
    Ok(selected.flatten())
}

fn resolve_parent(
    files: &dyn VaultFiles,
    profile: &str,
    config: &TaskNotesConfiguration,
    source: &str,
    raw: &str,
) -> Result<String> {
    let mut candidates = Vec::new();
    let mut ids = BTreeMap::new();
    for path in files.list_files(profile)? {
        if !path.to_ascii_lowercase().ends_with(".md") {
            continue;
        }
        let bytes = read(files, profile, &path, None)?;
        let doc = TaskDocument::parse(VaultPath::parse(&path)?, &bytes)?;
        if !super::is_task(&path, doc.frontmatter(), doc.body(), config)? {
            continue;
        }
        if let Some(id) = config
            .mapping
            .normalize(doc.frontmatter())
            .get("id")
            .and_then(Value::as_str)
        {
            ids.insert(path.clone(), id.to_owned());
        }
        candidates.push(path);
    }
    let path = links::resolve(
        &json!({"raw":raw,"sourcePath":source,"candidates":candidates,"idIndex":ids}),
    )
    .map_err(|_| invalid("invalid_recurrence_parent"))?;
    if !candidates.contains(&path) {
        return Err(invalid("invalid_recurrence_parent"));
    }
    Ok(path)
}

struct ParentEdit {
    document: TaskDocument,
    properties: Map<String, Value>,
    body: Option<String>,
}
fn parent_edit(context: &PlanContext, document: &TaskDocument) -> Result<Option<ParentEdit>> {
    let Command::EditTask {
        path,
        properties,
        body,
        ..
    } = &context.mutation.command
    else {
        return Ok(None);
    };
    if path != document.path().as_str() {
        return Ok(None);
    }
    let mut properties = super::edit::canonical_properties(context, properties)?;
    super::temporal_writes::prepare_transition(&mut properties, context.config)?;
    let staged = document.plan(&super::edits(&properties, context.config), body.as_deref())?;
    let document = TaskDocument::parse(VaultPath::parse(path)?, &staged.bytes)?;
    Ok(Some(ParentEdit {
        document,
        properties,
        body: body.clone(),
    }))
}

struct Selection {
    parent_path: String,
    day: String,
    instant: Option<DateTime<Utc>>,
    child_path: String,
    child_revision: String,
}
fn select(context: &PlanContext) -> Result<Option<Selection>> {
    let files = context.files;
    let profile = context.id;
    let config = context.config;
    let mutation = context.mutation;
    let Some((path, expected, selected)) = target(&mutation.command) else {
        return Ok(None);
    };
    let bytes = read(files, profile, path, expected)?;
    let document = TaskDocument::parse(VaultPath::parse(path)?, &bytes)?;
    let identity = super::occurrences::mapped_identity(config, &document)?;
    let (parent_path, day, instant, child_path, child_revision) = if let Some((raw, day)) = identity
    {
        let normalized = config.mapping.normalize(document.frontmatter());
        let selection = selected
            .map(|selected| super::completion_target(context, &normalized, Some(selected)))
            .transpose()?;
        if selection.is_some_and(|(selected, _)| selected.to_string() != day) {
            return Err(invalid("occurrence_selection_mismatch"));
        }
        let parent_path = resolve_parent(files, profile, config, path, &raw)?;
        let unique = super::occurrences::unique_child(files, profile, config, &parent_path, &day)?
            .ok_or_else(|| invalid("invalid_occurrence_identity"))?;
        if unique.path != path {
            return Err(invalid("duplicate_occurrence_note"));
        }
        (
            parent_path,
            day,
            selection.and_then(|(_, instant)| instant),
            path.to_owned(),
            document.revision().as_str().to_owned(),
        )
    } else {
        if matches!(
            &mutation.command,
            Command::Update { .. } | Command::EditTask { status: None, .. }
        ) {
            return Ok(None);
        }
        let staged = parent_edit(context, &document)?;
        let source = staged.as_ref().map_or(&document, |edit| &edit.document);
        let normalized = config.mapping.normalize(source.frontmatter());
        if normalized
            .get("recurrence")
            .and_then(Value::as_str)
            .is_none_or(|rule| rule.trim().is_empty())
        {
            return Ok(None);
        }
        let (day, instant) = super::completion_target(context, &normalized, selected)?;
        let day = day.to_string();
        let Some(child) = super::occurrences::unique_child(files, profile, config, path, &day)?
        else {
            return Ok(None);
        };
        (path.to_owned(), day, instant, child.path, child.revision)
    };
    Ok(Some(Selection {
        parent_path,
        day,
        instant,
        child_path,
        child_revision,
    }))
}

fn parent_state(context: &PlanContext, path: &str, bytes: &[u8]) -> Result<ParentEdit> {
    let original = TaskDocument::parse(VaultPath::parse(path)?, bytes)?;
    let edit = parent_edit(context, &original)?;
    let mut parent = edit.unwrap_or(ParentEdit {
        document: original,
        properties: Map::new(),
        body: None,
    });
    parent.document = super::occurrences::validate_parent(context.config, path, parent.document)?;
    Ok(parent)
}

fn recurrence_start(properties: &Map<String, Value>) -> Result<DateTime<Utc>> {
    let rule = super::recurrence_writes::seeded_rule(properties)?
        .ok_or_else(|| invalid("missing_recurrence_seed"))?;
    let start = rule
        .strip_prefix("RRULE:")
        .unwrap_or(&rule)
        .split(';')
        .next()
        .and_then(|part| part.strip_prefix("DTSTART:"))
        .ok_or_else(|| invalid("invalid_recurrence_start"))?;
    if start.len() == 8 {
        chrono::NaiveDate::parse_from_str(start, "%Y%m%d")
            .ok()
            .and_then(|day| day.and_hms_opt(0, 0, 0))
            .map(|value| value.and_utc())
            .ok_or_else(|| invalid("invalid_recurrence_start"))
    } else {
        chrono::NaiveDateTime::parse_from_str(start, "%Y%m%dT%H%M%SZ")
            .map(|value| value.and_utc())
            .map_err(|_| invalid("invalid_recurrence_start"))
    }
}

fn validate_repair_anchor(
    repair: Option<&DeferredProgression>,
    config: &TaskNotesConfiguration,
    parent: &TaskDocument,
) -> Result<()> {
    let Some(repair) = repair
        .filter(|intent| intent.parent_projection_owed && intent.child_state == State::Completed)
    else {
        return Ok(());
    };
    let current = config.mapping.normalize(parent.frontmatter());
    if current.get("recurrenceAnchor").and_then(Value::as_str) != Some("completion") {
        return Ok(());
    }
    let selected = if let Some(instant) = repair.completion_instant {
        instant
    } else {
        temporal::parse_day(&repair.occurrence_date)?
            .and_hms_opt(0, 0, 0)
            .ok_or_else(|| invalid("invalid_occurrence_date"))?
            .and_utc()
    };
    let current = recurrence_start(&current)?;
    if current > recurrence_start(&repair.parent_properties)? && current > selected {
        return Err(RuntimeError::Conflict);
    }
    Ok(())
}

pub(crate) fn plan(
    files: &dyn VaultFiles,
    profile: &str,
    config: &TaskNotesConfiguration,
    mutation: &Mutation,
) -> Result<Option<Plan>> {
    plan_with_repair(files, profile, config, mutation, None)
}

pub(crate) fn plan_with_repair(
    files: &dyn VaultFiles,
    profile: &str,
    config: &TaskNotesConfiguration,
    mutation: &Mutation,
    repair: Option<&DeferredProgression>,
) -> Result<Option<Plan>> {
    let context = PlanContext::new(files, profile, config, mutation);
    let Some(Selection {
        parent_path,
        day,
        instant,
        child_path,
        child_revision,
    }) = select(&context)?
    else {
        return Ok(None);
    };
    let parent_bytes = read(files, profile, &parent_path, None)?;
    let parent_revision = ContentRevision::of(&parent_bytes).as_str().to_owned();
    let ParentEdit {
        document: parent,
        properties: mut changes,
        body: parent_body,
    } = parent_state(&context, &parent_path, &parent_bytes)?;
    validate_repair_anchor(repair, config, &parent)?;
    let ChildTransition {
        mut writes,
        diagnostics,
        result_path,
        before_state,
        after_state,
        child_mutation,
    } = plan_child(&context, &parent_path, &child_path, &child_revision, &day)?;
    validate_repair_selection(
        repair,
        (before_state, after_state),
        &result_path,
        &day,
        &parent_path,
    )?;
    let mut reconciled = reconciliation(
        config,
        &parent,
        &day,
        before_state,
        after_state,
        repair.is_some_and(|debt| debt.parent_projection_owed),
        repair.map_or(instant, |debt| debt.completion_instant),
    )?;
    if reconciled.parent_projection_owed && repair.is_some() {
        return Err(invalid("occurrence_expansion_resource_limit"));
    }
    changes.extend(std::mem::take(&mut reconciled.changes));
    let ParentPublication {
        parent_result_path,
        parent_after,
        parent_writes,
        notices,
    } = plan_parent_publication(
        &context,
        &parent_path,
        &parent_bytes,
        &parent_revision,
        changes,
        parent_body.as_deref(),
        &writes,
    )?;
    let diagnostics = merge_diagnostics(diagnostics, notices);
    merge_writes(&mut writes, parent_writes)?;
    verify_final_identity(
        files,
        profile,
        config,
        &writes,
        &result_path,
        &parent_result_path,
        &day,
    )?;
    let plan = Plan {
        writes,
        diagnostics,
        fence: Fence {
            parent_path,
            parent_revision,
            parent_result_path,
            task_path: child_path,
            task_revision: child_revision,
            result_path,
            occurrence_date: day,
            deferred_input_hash: None,
        },
        successor: None,
        child_mutation,
        deferred: None,
        repair_result: None,
    };
    plan_future(
        &context,
        repair,
        &parent_after,
        (before_state, after_state),
        &reconciled,
        instant,
        plan,
    )
    .map(Some)
}

struct ParentPublication {
    parent_result_path: String,
    parent_after: Vec<u8>,
    parent_writes: Vec<PlannedFile>,
    notices: Vec<Diagnostic>,
}

fn merge_diagnostics(
    mut diagnostics: Vec<Diagnostic>,
    notices: Vec<Diagnostic>,
) -> Vec<Diagnostic> {
    for notice in notices {
        if !diagnostics.contains(&notice) {
            diagnostics.push(notice);
        }
    }
    diagnostics
}

fn validate_repair_selection(
    repair: Option<&DeferredProgression>,
    states: (State, State),
    child: &str,
    day: &str,
    parent: &str,
) -> Result<()> {
    if repair.is_some_and(|debt| {
        debt.child_state != states.0
            || debt.child_state != states.1
            || debt.child_path != child
            || debt.occurrence_date != day
            || debt.parent_path != parent
    }) {
        return Err(invalid("deferred_progression_child_state_changed"));
    }
    Ok(())
}

fn plan_parent_publication(
    context: &PlanContext,
    path: &str,
    bytes: &[u8],
    revision: &str,
    changes: Map<String, Value>,
    body: Option<&str>,
    writes: &[PlannedFile],
) -> Result<ParentPublication> {
    let view = super::planned_view::PlannedView {
        files: context.files,
        profile: context.id,
        writes,
    };
    let parent_context = PlanContext::new(&view, context.id, context.config, context.mutation);
    let parent_writes = super::update(&parent_context, path, Some(revision), changes, body)?;
    let parent_result_path = parent_writes
        .first()
        .map_or_else(|| path.to_owned(), |write| write.path.clone());
    let parent_after = parent_writes
        .first()
        .map(|write| {
            write
                .bytes
                .clone()
                .ok_or_else(|| RuntimeError::Storage("parent transition image is missing".into()))
        })
        .transpose()?
        .unwrap_or_else(|| bytes.to_vec());
    Ok(ParentPublication {
        parent_result_path,
        parent_after,
        parent_writes,
        notices: parent_context.diagnostics.into_inner(),
    })
}

fn plan_future(
    context: &PlanContext,
    repair: Option<&DeferredProgression>,
    parent_after: &[u8],
    states: (State, State),
    reconciled: &Reconciliation,
    completion_instant: Option<DateTime<Utc>>,
    mut plan: Plan,
) -> Result<Plan> {
    let config = context.config;
    let mutation = context.mutation;
    let (before_state, after_state) = states;
    let fence = &plan.fence;
    let successor_completed =
        after_state == State::Completed && (before_state != State::Completed || repair.is_some());
    let successor_skipped =
        after_state == State::Skipped && (before_state != State::Skipped || repair.is_some());
    let parent_properties = config.mapping.normalize(
        TaskDocument::parse(VaultPath::parse(&fence.parent_result_path)?, parent_after)?
            .frontmatter(),
    );
    let enabled = successor_policy(
        config,
        &parent_properties,
        successor_completed,
        successor_skipped,
    )?;
    let (successor, successor_discovery_owed) = if reconciled.parent_projection_owed {
        (None, enabled)
    } else {
        match successor(
            config,
            mutation,
            &fence.parent_result_path,
            &fence.occurrence_date,
            parent_after,
            successor_completed,
            successor_skipped,
        ) {
            Ok(successor) => (successor, false),
            Err(error) if resource_exhaustion(&error) && repair.is_none() => (None, true),
            Err(error) => return Err(error),
        }
    };
    let deferred = if reconciled.parent_projection_owed || successor_discovery_owed {
        Some(deferred_intent(
            context,
            &plan,
            parent_after,
            after_state,
            (reconciled.parent_projection_owed, successor_discovery_owed),
            completion_instant,
            parent_properties,
        ))
    } else {
        None
    };
    let repair_result =
        repair.map(
            |_| match successor.as_ref().map(|mutation| &mutation.command) {
                Some(Command::MaterializeOccurrence {
                    occurrence_date, ..
                }) => RepairResult::Materialized {
                    occurrence_date: occurrence_date.clone(),
                },
                _ if reconciled.progression == Progression::Exhausted || enabled => {
                    RepairResult::Exhausted
                }
                _ => RepairResult::PolicyNoSuccessor,
            },
        );
    plan.fence.deferred_input_hash = deferred.as_ref().map(deferred_input_hash).transpose()?;
    plan.successor = successor;
    plan.deferred = deferred;
    plan.repair_result = repair_result;
    Ok(plan)
}

fn deferred_intent(
    context: &PlanContext,
    plan: &Plan,
    parent_after: &[u8],
    child_state: State,
    debt: (bool, bool),
    completion_instant: Option<DateTime<Utc>>,
    parent_properties: Map<String, Value>,
) -> DeferredProgression {
    let fence = &plan.fence;
    let child_after = plan
        .writes
        .iter()
        .find(|write| write.path == fence.result_path)
        .and_then(|write| write.bytes.as_ref());
    let parent_revision = ContentRevision::of(parent_after).as_str().to_owned();
    let child_revision = child_after.map_or_else(
        || fence.task_revision.clone(),
        |bytes| ContentRevision::of(bytes).as_str().to_owned(),
    );
    DeferredProgression {
        parent_path: fence.parent_result_path.clone(),
        parent_revision: parent_revision.clone(),
        input_parent_revision: parent_revision,
        child_path: fence.result_path.clone(),
        child_revision: child_revision.clone(),
        input_child_revision: child_revision,
        occurrence_date: fence.occurrence_date.clone(),
        completion_instant,
        child_state,
        parent_projection_owed: debt.0,
        successor_discovery_owed: debt.1,
        anchor_applied: child_state == State::Completed && !debt.0,
        origin_at: context.mutation.at.clone(),
        origin_context: context.mutation.execution_context.clone(),
        parent_properties,
    }
}

struct ChildTransition {
    writes: Vec<PlannedFile>,
    diagnostics: Vec<Diagnostic>,
    result_path: String,
    before_state: State,
    after_state: State,
    child_mutation: Mutation,
}
fn plan_child(
    context: &PlanContext,
    parent_path: &str,
    child_path: &str,
    child_revision: &str,
    day: &str,
) -> Result<ChildTransition> {
    let files = context.files;
    let profile = context.id;
    let config = context.config;
    let mutation = context.mutation;
    let child_bytes = read(files, profile, child_path, Some(child_revision))?;
    let child = TaskDocument::parse(VaultPath::parse(child_path)?, &child_bytes)?;
    let before_values = config.mapping.normalize(child.frontmatter());
    let mut child_mutation = mutation.clone();
    let command = if let Command::EditTask {
        path,
        status: Some(status),
        ..
    } = &mutation.command
        && path == parent_path
    {
        Some(Command::SetStatus {
            path: child_path.to_owned(),
            expected_revision: Some(child_revision.to_owned()),
            status: status.clone(),
            occurrence_date: None,
        })
    } else {
        child_command(
            config,
            &mutation.command,
            child_path,
            child_revision,
            &before_values,
        )?
    };
    let (writes, diagnostics) = if let Some(command) = command {
        child_mutation.command = command;
        super::plan(files, profile, config, &child_mutation)?
    } else {
        (Vec::new(), Vec::new())
    };
    let after_write = writes.first();
    let (after_path, after_bytes) = if let Some(write) = after_write {
        (
            write.path.as_str(),
            write.bytes.as_deref().ok_or_else(|| {
                RuntimeError::Storage("occurrence result image is missing".into())
            })?,
        )
    } else {
        (child_path, child_bytes.as_slice())
    };
    let after = TaskDocument::parse(VaultPath::parse(after_path)?, after_bytes)?;
    let after_values = config.mapping.normalize(after.frontmatter());
    let result_path = after_path.to_owned();
    let (raw, after_day) = super::occurrences::mapped_identity(config, &after)?
        .ok_or_else(|| invalid("occurrence_identity_is_immutable"))?;
    if after_day != day || resolve_parent(files, profile, config, after_path, &raw)? != parent_path
    {
        return Err(invalid("occurrence_identity_is_immutable"));
    }
    let before_state = state(config, &before_values)?;
    let after_state = state(config, &after_values)?;
    Ok(ChildTransition {
        writes,
        diagnostics,
        result_path,
        before_state,
        after_state,
        child_mutation,
    })
}

fn merge_writes(writes: &mut Vec<PlannedFile>, later: Vec<PlannedFile>) -> Result<()> {
    for write in later {
        if let Some(prior) = writes.iter_mut().find(|prior| prior.path == write.path) {
            let revision = prior
                .bytes
                .as_ref()
                .map(|bytes| ContentRevision::of(bytes).as_str().to_owned());
            if revision != write.expected {
                return Err(RuntimeError::Storage(
                    "composed occurrence predecessor changed".into(),
                ));
            }
            prior.bytes = write.bytes;
        } else {
            writes.push(write);
        }
    }
    Ok(())
}
fn verify_final_identity(
    files: &dyn VaultFiles,
    profile: &str,
    config: &TaskNotesConfiguration,
    writes: &[PlannedFile],
    child: &str,
    parent: &str,
    day: &str,
) -> Result<()> {
    let view = super::planned_view::PlannedView {
        files,
        profile,
        writes,
    };
    let bytes = read(&view, profile, child, None)?;
    let document = TaskDocument::parse(VaultPath::parse(child)?, &bytes)?;
    let (raw, date) = super::occurrences::mapped_identity(config, &document)?
        .ok_or_else(|| invalid("occurrence_identity_is_immutable"))?;
    if date != day || resolve_parent(&view, profile, config, child, &raw)? != parent {
        return Err(invalid("occurrence_identity_is_immutable"));
    }
    Ok(())
}

struct Reconciliation {
    changes: Map<String, Value>,
    parent_projection_owed: bool,
    progression: Progression,
}

#[derive(PartialEq, Eq)]
enum Progression {
    Unchanged,
    Scheduled,
    Exhausted,
}

fn reconciliation(
    config: &TaskNotesConfiguration,
    parent: &TaskDocument,
    day: &str,
    before_state: State,
    after_state: State,
    force_progression: bool,
    completion_instant: Option<DateTime<Utc>>,
) -> Result<Reconciliation> {
    if !force_progression
        && before_state == after_state
        && let Ok(lists) = InstanceLists::parse_mapped(parent.frontmatter(), &config.mapping)
        && lists.completed.iter().any(|entry| entry == day) == (after_state == State::Completed)
        && lists.skipped.iter().any(|entry| entry == day) == (after_state == State::Skipped)
    {
        // Preserve bytes, optional field absence and list order for an already
        // consistent authoritative child. Target-day contradictions still go
        // through the strict targeted reconciliation below.
        return Ok(Reconciliation {
            changes: Map::new(),
            parent_projection_owed: false,
            progression: Progression::Unchanged,
        });
    }
    let mut parent_values = config.mapping.normalize(parent.frontmatter());
    let mut lists = reconciliable_lists(config, parent, day)?;
    lists.completed.retain(|entry| entry != day);
    lists.skipped.retain(|entry| entry != day);
    match after_state {
        State::Completed => lists.completed.push(day.to_owned()),
        State::Skipped => lists.skipped.push(day.to_owned()),
        State::Active => {}
    }
    let mut changes = Map::from_iter([
        ("completeInstances".into(), json!(lists.completed)),
        ("skippedInstances".into(), json!(lists.skipped)),
    ]);
    parent_values.extend(changes.clone());
    let newly_completed = after_state == State::Completed && before_state != State::Completed;
    let mut next_scheduled = Progression::Unchanged;
    if newly_completed || (force_progression && after_state == State::Completed) {
        if let Some(rule) = super::recurrence_writes::seeded_rule(&parent_values)? {
            parent_values.insert("recurrence".into(), json!(rule));
        }
        parent_values.insert("completionDate".into(), json!(day));
        let input = Value::Object(parent_values);
        let progression = match completion_instant.map_or_else(
            || {
                tasknotes_vault::progression::execute_bounded(
                    "recurrence.complete",
                    &input,
                    crate::RECURRENCE_WORK_LIMIT,
                )
            },
            |instant| {
                tasknotes_vault::progression::complete_at_bounded(
                    &input,
                    temporal::parse_day(day)?,
                    instant,
                    crate::RECURRENCE_WORK_LIMIT,
                )
            },
        ) {
            Ok(progression) => progression,
            Err(error) => {
                let error = RuntimeError::from(error);
                if resource_exhaustion(&error) {
                    return Ok(Reconciliation {
                        changes,
                        parent_projection_owed: true,
                        progression: Progression::Unchanged,
                    });
                }
                return Err(error);
            }
        };
        next_scheduled = if progression
            .get("nextScheduled")
            .and_then(Value::as_str)
            .is_some()
        {
            Progression::Scheduled
        } else {
            Progression::Exhausted
        };
        for (role, key) in [
            ("recurrence", "updatedRecurrence"),
            ("scheduled", "nextScheduled"),
            ("due", "nextDue"),
        ] {
            changes.insert(role.into(), super::result_field(&progression, key)?);
        }
    }
    Ok(Reconciliation {
        changes,
        parent_projection_owed: false,
        progression: next_scheduled,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum State {
    Active,
    Completed,
    Skipped,
}
fn skipped_statuses(config: &TaskNotesConfiguration) -> Result<Vec<String>> {
    let policy = config
        .effective
        .get("status")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("invalid_status_policy"))?;
    let Some(values) = policy.get("skipped_values") else {
        return Ok(Vec::new());
    };
    let values = values
        .as_array()
        .ok_or_else(|| invalid("invalid_skipped_status_policy"))?;
    let mut result = Vec::new();
    for value in values {
        let value = value
            .as_str()
            .filter(|value| !value.is_empty())
            .ok_or_else(|| invalid("invalid_skipped_status_policy"))?;
        if config.is_completed(value)? || result.iter().any(|old| old == value) {
            return Err(invalid("invalid_skipped_status_policy"));
        }
        result.push(value.to_owned());
    }
    Ok(result)
}
fn state(config: &TaskNotesConfiguration, properties: &Map<String, Value>) -> Result<State> {
    let status = properties
        .get("status")
        .and_then(Value::as_str)
        .or(config.default_status.as_deref())
        .ok_or_else(|| invalid("missing_task_status"))?;
    Ok(if config.is_completed(status)? {
        State::Completed
    } else if skipped_statuses(config)?
        .iter()
        .any(|value| value == status)
    {
        State::Skipped
    } else {
        State::Active
    })
}
fn skipped_status(config: &TaskNotesConfiguration) -> Result<String> {
    let values = skipped_statuses(config)?;
    let default = config.effective.pointer("/status/default_skipped");
    if let Some(default) = default {
        let default = default
            .as_str()
            .ok_or_else(|| invalid("invalid_skipped_status_policy"))?;
        if !values.iter().any(|value| value == default) {
            return Err(invalid("invalid_skipped_status_policy"));
        }
        return Ok(default.into());
    }
    values
        .first()
        .cloned()
        .ok_or_else(|| invalid("missing_skipped_status"))
}
fn active_status(config: &TaskNotesConfiguration) -> Result<String> {
    let status = config
        .default_status
        .as_deref()
        .ok_or_else(|| invalid("missing_active_status"))?;
    if config.is_completed(status)?
        || skipped_statuses(config)?
            .iter()
            .any(|value| value == status)
    {
        return Err(invalid("missing_active_status"));
    }
    Ok(status.into())
}
fn negative_setter_is_noop(command: &Command, current: State) -> bool {
    matches!(
        command,
        Command::SetCompletion {
            completed: false,
            ..
        }
    ) && current != State::Completed
        || matches!(
            command,
            Command::SetOccurrenceSkipped { skipped: false, .. }
        ) && current != State::Skipped
}

fn child_command(
    config: &TaskNotesConfiguration,
    command: &Command,
    path: &str,
    revision: &str,
    values: &Map<String, Value>,
) -> Result<Option<Command>> {
    if negative_setter_is_noop(command, state(config, values)?) {
        return Ok(None);
    }
    let path = path.to_owned();
    let expected_revision = Some(revision.to_owned());
    Ok(Some(match command {
        Command::SetCompletion {
            completed: false, ..
        } => Command::SetStatus {
            path,
            expected_revision,
            status: active_status(config)?,
            occurrence_date: None,
        },
        Command::SetCompletion { completed, .. } => Command::SetCompletion {
            path,
            expected_revision,
            completed: *completed,
            occurrence_date: None,
        },
        Command::ToggleComplete { .. } if state(config, values)? == State::Completed => {
            Command::SetStatus {
                path,
                expected_revision,
                status: active_status(config)?,
                occurrence_date: None,
            }
        }
        Command::ToggleComplete { .. } => Command::ToggleComplete {
            path,
            expected_revision,
            occurrence_date: None,
        },
        Command::SetStatus { status, .. } => Command::SetStatus {
            path,
            expected_revision,
            status: status.clone(),
            occurrence_date: None,
        },
        Command::SetOccurrenceSkipped { skipped, .. } => {
            let status = if *skipped {
                skipped_status(config)?
            } else {
                active_status(config)?
            };
            Command::SetStatus {
                path,
                expected_revision,
                status,
                occurrence_date: None,
            }
        }
        Command::EditTask {
            properties,
            body,
            status,
            ..
        } => Command::EditTask {
            path,
            expected_revision,
            properties: properties.clone(),
            body: body.clone(),
            status: status.clone(),
            occurrence_date: None,
        },
        Command::Update {
            properties, body, ..
        } => {
            let mut properties =
                super::temporal_writes::command_properties(properties.clone(), config)?;
            let status = properties
                .remove("status")
                .map(|value| {
                    value
                        .as_str()
                        .map(str::to_owned)
                        .ok_or_else(|| invalid("invalid_task_status"))
                })
                .transpose()?;
            Command::EditTask {
                path,
                expected_revision,
                properties,
                body: body.clone(),
                status,
                occurrence_date: None,
            }
        }
        _ => {
            return Err(RuntimeError::Storage(
                "occurrence transition dispatch mismatch".into(),
            ));
        }
    }))
}

fn reconciliable_lists(
    config: &TaskNotesConfiguration,
    parent: &TaskDocument,
    day: &str,
) -> Result<InstanceLists> {
    // The child's state is authoritative for this day, even when both parent
    // lists mention it. Every other malformed/ambiguous entry still fails.
    let mut source = parent.frontmatter().clone();
    for key in [
        "completeInstances",
        "skippedInstances",
        config.mapping.field("completeInstances"),
        config.mapping.field("skippedInstances"),
    ] {
        if let Some(value) = source.get_mut(key).and_then(Value::as_array_mut) {
            value.retain(|entry| entry.as_str() != Some(day));
        }
    }
    Ok(InstanceLists::parse_mapped(&source, &config.mapping)?)
}

fn setting<'a>(
    config: &'a TaskNotesConfiguration,
    parent: &'a Map<String, Value>,
    role: &str,
    key: &str,
) -> Result<&'a str> {
    parent
        .get(role)
        .or_else(|| {
            config
                .effective
                .get("occurrences")
                .and_then(|policy| policy.get(key))
        })
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("invalid_occurrence_policy"))
}
fn successor(
    config: &TaskNotesConfiguration,
    mutation: &Mutation,
    parent_path: &str,
    day: &str,
    parent_bytes: &[u8],
    completed: bool,
    skipped: bool,
) -> Result<Option<Mutation>> {
    let parent = TaskDocument::parse(VaultPath::parse(parent_path)?, parent_bytes)?;
    let mut values = config.mapping.normalize(parent.frontmatter());
    if !successor_policy(config, &values, completed, skipped)? {
        return Ok(None);
    }
    values.insert("referenceDate".into(), json!(day));
    let result = tasknotes_vault::progression::execute_bounded(
        "recurrence.recalculate",
        &Value::Object(values),
        crate::RECURRENCE_WORK_LIMIT,
    )?;
    let Some(next) = result.get("nextScheduled").and_then(Value::as_str) else {
        return Ok(None);
    };
    let next = temporal::date_part(next)?.to_string();
    let mut successor = mutation.clone();
    successor.command = Command::MaterializeOccurrence {
        parent_path: parent_path.into(),
        expected_parent_revision: parent.revision().as_str().into(),
        occurrence_date: next,
        expected_occurrence_revision: None,
        properties: Map::new(),
        body: None,
    };
    Ok(Some(successor))
}

fn successor_policy(
    config: &TaskNotesConfiguration,
    values: &Map<String, Value>,
    completed: bool,
    skipped: bool,
) -> Result<bool> {
    let mode = setting(
        config,
        values,
        "occurrenceMaterialization",
        "default_materialization",
    )?;
    if !matches!(mode, "manual" | "on_completion" | "rolling") {
        return Err(invalid("invalid_occurrence_materialization"));
    }
    let trigger = setting(
        config,
        values,
        "occurrenceNextTrigger",
        "default_next_trigger",
    )?;
    if !matches!(trigger, "completion" | "completion_or_skip") {
        return Err(invalid("invalid_occurrence_next_trigger"));
    }
    Ok(mode == "on_completion" && (completed || (skipped && trigger == "completion_or_skip")))
}
