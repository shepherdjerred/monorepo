//! Pure semantic planning against host-provided file snapshots.

mod detection;
mod edit;
mod instances;
mod recurrence_writes;
mod temporal_writes;
mod validation;

use serde_json::{Map, Value, json};
use tasknotes_vault::{
    config::{DetectionMethod, TaskNotesConfiguration},
    document::{ContentRevision, PropertyEdit, TaskDocument},
    mapping::canonical_role,
    path::VaultPath,
};

use crate::{
    Result, RuntimeError,
    engine::PlannedFile,
    types::{Command, Diagnostic, DiagnosticCode, Mutation, VaultFiles},
};

pub(crate) fn is_task(
    path: &str,
    properties: &Map<String, Value>,
    body: &str,
    config: &TaskNotesConfiguration,
) -> Result<bool> {
    let policy = config.effective.get("task_detection").ok_or_else(|| {
        RuntimeError::Validation("effective task detection policy is missing".to_owned())
    })?;
    Ok(tasknotes_vault::configuration::detect(
        &json!({"taskDetection":policy,"frontmatter":properties,"body":body,"filePath":path,"tagField":config.mapping.field("tags")}),
    )?)
}

pub(crate) fn plan(
    files: &dyn VaultFiles,
    id: &str,
    config: &TaskNotesConfiguration,
    mutation: &Mutation,
) -> Result<(Vec<PlannedFile>, Vec<Diagnostic>)> {
    let context = PlanContext::new(files, id, config, mutation);
    let result = if let Some(result) = reference_policy(&context, &mutation.command) {
        result
    } else {
        match &mutation.command {
            Command::RenameReferences { .. }
            | Command::DeleteChecked { .. }
            | Command::SetOccurrenceSkipped { .. }
            | Command::EditTask { .. }
            | Command::Normalize { .. } => Err(RuntimeError::Validation(
                "reference policy was not dispatched".to_owned(),
            )),
            Command::ReorderViews { ids } => reorder_views(&context, ids),
            Command::RestoreDefaultViews {} => restore_views(&context),
            Command::Batch { commands } => batch(files, id, config, mutation, commands),
            Command::Undo { .. }
            | Command::ResolveConflict { .. }
            | Command::BatchPartial { .. } => Err(RuntimeError::Validation(
                "operation requires the durable runtime coordinator".to_owned(),
            )),
            Command::SetCompletion {
                path,
                expected_revision,
                completed,
                occurrence_date,
            } => set_completion(
                &context,
                path,
                expected_revision.as_deref(),
                occurrence_date.as_deref(),
                Some(*completed),
            ),
            Command::Create {
                path,
                properties,
                body,
            } => create(&context, path.as_deref(), properties, body.as_deref()),
            Command::Update {
                path,
                expected_revision,
                properties,
                body,
            } => update(
                &context,
                path,
                expected_revision.as_deref(),
                temporal_writes::command_properties(properties.clone(), context.config)?,
                body.as_deref(),
            ),
            Command::Delete {
                path,
                expected_revision,
            } => delete(&context, path, expected_revision.as_deref()),
            Command::SetStatus {
                path,
                expected_revision,
                status,
                occurrence_date,
            } => set_status(
                &context,
                path,
                expected_revision.as_deref(),
                status,
                occurrence_date.as_deref(),
            ),
            Command::ToggleComplete {
                path,
                expected_revision,
                occurrence_date,
            } => set_completion(
                &context,
                path,
                expected_revision.as_deref(),
                occurrence_date.as_deref(),
                None,
            ),
            Command::Rename {
                path,
                new_path,
                expected_revision,
            } => rename(&context, path, new_path, expected_revision.as_deref()),
            Command::Archive {
                path,
                expected_revision,
                archived,
            } => archive(&context, path, expected_revision.as_deref(), *archived),
            Command::SaveView { id: view_id, view } => save_view(&context, view_id, view),
            Command::DeleteView { id: view_id } => {
                let path = view_path(view_id)?;
                delete(&context, &path, None)
            }
        }
    };
    Ok((result?, context.diagnostics.into_inner()))
}

fn reference_policy(context: &PlanContext, command: &Command) -> Option<Result<Vec<PlannedFile>>> {
    match command {
        Command::SetOccurrenceSkipped {
            path,
            expected_revision,
            occurrence_date,
            skipped,
        } => Some(instances::plan(
            context,
            path,
            expected_revision.as_deref(),
            occurrence_date,
            *skipped,
        )),
        Command::EditTask {
            path,
            expected_revision,
            properties,
            body,
            status,
            occurrence_date,
        } => Some(edit::plan(
            context,
            path,
            expected_revision.as_deref(),
            properties,
            body.as_deref(),
            status.as_deref(),
            occurrence_date.as_deref(),
        )),
        Command::Normalize {
            path,
            expected_revision,
        } => Some(normalize(context, path, expected_revision.as_deref())),
        Command::RenameReferences {
            path,
            new_path,
            expected_revision,
            update_references,
        } => Some(rename_references(
            context,
            path,
            new_path,
            expected_revision.as_deref(),
            *update_references,
        )),
        Command::DeleteChecked {
            path,
            expected_revision,
            check_backlinks,
            force,
        } => Some(checked_delete(
            context,
            path,
            expected_revision.as_deref(),
            *check_backlinks,
            *force,
        )),
        _ => None,
    }
}
fn normalize(
    context: &PlanContext,
    path: &str,
    expected: Option<&str>,
) -> Result<Vec<PlannedFile>> {
    let old = read(context.files, context.id, path, expected)?;
    let document = TaskDocument::parse(VaultPath::parse(path)?, &old)?;
    let preview = tasknotes_vault::migration_policy::preview(document.frontmatter());
    let mut normalized = preview
        .get("frontmatter")
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| RuntimeError::Storage("normalization result is invalid".to_owned()))?;
    temporal_writes::canonicalize_document(&mut normalized, context.config)?;
    if &normalized == document.frontmatter() {
        return Ok(Vec::new());
    }
    let mut edits = Vec::new();
    for key in document.frontmatter().keys() {
        if !normalized.contains_key(key) {
            edits.push(PropertyEdit::Remove { key: key.clone() });
        }
    }
    for (key, value) in &normalized {
        if document.frontmatter().get(key) != Some(value) {
            edits.push(PropertyEdit::Set {
                key: key.clone(),
                value: value.clone(),
            });
        }
    }
    edits.push(PropertyEdit::Set {
        key: context.config.mapping.field("dateModified").to_owned(),
        value: json!(tasknotes_vault::temporal::canonical_instant(
            &context.mutation.at
        )?),
    });
    let write = document.plan(&edits, None)?;
    validation::enforce(context.config, path, &write.bytes)?;
    Ok(vec![PlannedFile {
        path: path.to_owned(),
        expected: Some(write.expected_revision.as_str().to_owned()),
        before: Some(old),
        bytes: Some(write.bytes),
    }])
}

fn checked_delete(
    context: &PlanContext,
    path: &str,
    expected: Option<&str>,
    check: bool,
    force: bool,
) -> Result<Vec<PlannedFile>> {
    if check && !force && !reference_writes(context, path, path)?.is_empty() {
        return Err(RuntimeError::Validation(
            "deletion has backlinks; review them or explicitly force deletion".to_owned(),
        ));
    }
    delete(context, path, expected)
}

fn set_status(
    context: &PlanContext,
    path: &str,
    expected: Option<&str>,
    status: &str,
    occurrence_date: Option<&str>,
) -> Result<Vec<PlannedFile>> {
    let old = read(context.files, context.id, path, expected)?;
    let document = TaskDocument::parse(VaultPath::parse(path)?, &old)?;
    instances::validate_sources(context.config, &document)?;
    let normalized = context.config.mapping.normalize(document.frontmatter());
    let properties = status_changes(context, &normalized, status, occurrence_date)?;
    if properties.is_empty() {
        return Ok(Vec::new());
    }
    update(
        context,
        path,
        Some(document.revision().as_str()),
        properties,
        None,
    )
}

fn status_changes(
    context: &PlanContext,
    normalized: &Map<String, Value>,
    status: &str,
    occurrence_date: Option<&str>,
) -> Result<Map<String, Value>> {
    let done = context.config.is_completed(status)?;
    if normalized
        .get("recurrence")
        .and_then(Value::as_str)
        .is_some_and(|rule| !rule.trim().is_empty())
    {
        let mut properties =
            recurring_completion(context, normalized, occurrence_date, Some(done))?
                .unwrap_or_default();
        if !done && normalized.get("status").and_then(Value::as_str) != Some(status) {
            properties.insert("status".to_owned(), json!(status));
        }
        return Ok(properties);
    }
    if normalized.get("status").and_then(Value::as_str) == Some(status) {
        return Ok(Map::new());
    }
    Ok(Map::from_iter([
        ("status".to_owned(), json!(status)),
        (
            "completedDate".to_owned(),
            if done {
                json!(date(context.mutation))
            } else {
                Value::Null
            },
        ),
    ]))
}
fn delete(context: &PlanContext, path: &str, expected: Option<&str>) -> Result<Vec<PlannedFile>> {
    let old = read(context.files, context.id, path, expected)?;
    Ok(vec![PlannedFile {
        path: path.to_owned(),
        expected: Some(ContentRevision::of(&old).as_str().to_owned()),
        before: Some(old),
        bytes: None,
    }])
}

fn batch(
    files: &dyn VaultFiles,
    id: &str,
    config: &TaskNotesConfiguration,
    mutation: &Mutation,
    commands: &[Command],
) -> Result<Vec<PlannedFile>> {
    if commands.is_empty() || commands.len() > 1_000 {
        return Err(RuntimeError::Validation(
            "batch must contain between 1 and 1,000 commands".to_owned(),
        ));
    }
    let mut writes = Vec::new();
    let mut paths = std::collections::BTreeSet::new();
    for command in commands {
        if matches!(
            command,
            Command::Batch { .. } | Command::BatchPartial { .. } | Command::Undo { .. }
        ) {
            return Err(RuntimeError::Validation(
                "nested batches and undo are not batch commands".to_owned(),
            ));
        }
        let item = Mutation {
            command: command.clone(),
            ..mutation.clone()
        };
        for write in plan(files, id, config, &item)?.0 {
            if !paths.insert(write.path.clone()) {
                return Err(RuntimeError::Validation(
                    "batch commands must target distinct files".to_owned(),
                ));
            }
            writes.push(write);
        }
    }
    Ok(writes)
}

fn reorder_views(context: &PlanContext, ids: &[String]) -> Result<Vec<PlannedFile>> {
    let wanted: std::collections::BTreeSet<&String> = ids.iter().collect();
    if wanted.len() != ids.len() {
        return Err(RuntimeError::Validation(
            "view ordering contains duplicates".to_owned(),
        ));
    }
    let mut views = std::collections::BTreeMap::new();
    for path in context.files.list_files(context.id)? {
        if let Some(id) = path
            .strip_prefix("Facet/Views/")
            .and_then(|name| name.strip_suffix(".md"))
        {
            let bytes = read(context.files, context.id, &path, None)?;
            let document = TaskDocument::parse(VaultPath::parse(&path)?, &bytes)?;
            let view = document
                .frontmatter()
                .get("facetView")
                .and_then(Value::as_object)
                .ok_or_else(|| {
                    RuntimeError::Validation("portable view document is invalid".to_owned())
                })?
                .clone();
            views.insert(id.to_owned(), view);
        }
    }
    if views.len() != ids.len() || ids.iter().any(|id| !views.contains_key(id)) {
        return Err(RuntimeError::Validation(
            "ordering must contain every current view".to_owned(),
        ));
    }
    let mut writes = Vec::new();
    for (order, id) in ids.iter().enumerate() {
        let mut view = views.remove(id).ok_or(RuntimeError::NotFound)?;
        view.insert("order".to_owned(), json!(order));
        writes.extend(save_view(context, id, &view)?);
    }
    Ok(writes)
}

fn restore_views(context: &PlanContext) -> Result<Vec<PlannedFile>> {
    let mut writes = Vec::new();
    for (order, (id, name, scope)) in [
        ("default-all", "All tasks", "all"),
        ("default-today", "Today", "today"),
        ("default-upcoming", "Upcoming", "upcoming"),
    ]
    .iter()
    .enumerate()
    {
        let view = json!({"schemaVersion":1,"name":name,"order":order,"viewType":"list","query":{"scope":scope}});
        let view = view.as_object().ok_or_else(|| {
            RuntimeError::Storage("default view definition is invalid".to_owned())
        })?;
        writes.extend(save_view(context, id, view)?);
    }
    Ok(writes)
}

struct PlanContext<'a> {
    files: &'a dyn VaultFiles,
    id: &'a str,
    config: &'a TaskNotesConfiguration,
    mutation: &'a Mutation,
    diagnostics: std::cell::RefCell<Vec<Diagnostic>>,
}

impl<'a> PlanContext<'a> {
    fn new(
        files: &'a dyn VaultFiles,
        id: &'a str,
        config: &'a TaskNotesConfiguration,
        mutation: &'a Mutation,
    ) -> Self {
        Self {
            files,
            id,
            config,
            mutation,
            diagnostics: std::cell::RefCell::new(Vec::new()),
        }
    }
    fn notice(&self, code: DiagnosticCode) {
        let mut diagnostics = self.diagnostics.borrow_mut();
        if !diagnostics.iter().any(|value| value.code == code) {
            diagnostics.push(Diagnostic { code });
        }
    }
}

fn rename(
    context: &PlanContext,
    path: &str,
    new_path: &str,
    expected_revision: Option<&str>,
) -> Result<Vec<PlannedFile>> {
    let files = context.files;
    let id = context.id;
    VaultPath::parse(new_path)?;
    if path == new_path {
        return Err(RuntimeError::Validation(
            "rename destination must differ".to_owned(),
        ));
    }
    if files.read_file(id, new_path)?.is_some() {
        return Err(RuntimeError::Conflict);
    }
    let old = read(files, id, path, expected_revision)?;
    Ok(vec![
        PlannedFile {
            path: new_path.to_owned(),
            expected: None,
            before: None,
            bytes: Some(old.clone()),
        },
        PlannedFile {
            path: path.to_owned(),
            expected: Some(ContentRevision::of(&old).as_str().to_owned()),
            before: Some(old),
            bytes: None,
        },
    ])
}

fn rename_references(
    context: &PlanContext,
    path: &str,
    new_path: &str,
    expected: Option<&str>,
    references: bool,
) -> Result<Vec<PlannedFile>> {
    let mut writes = rename(context, path, new_path, expected)?;
    if references {
        let candidates = context.files.list_files(context.id)?;
        if let Some(write) = writes.first_mut()
            && let Some(bytes) = write.bytes.as_ref()
            && let Ok(text) = std::str::from_utf8(bytes)
        {
            write.bytes = Some(
                tasknotes_vault::links::rewrite_document(
                    text,
                    new_path,
                    path,
                    new_path,
                    &candidates,
                )?
                .into_bytes(),
            );
        }
        writes.extend(reference_writes(context, path, new_path)?);
    }
    Ok(writes)
}

fn reference_writes(
    context: &PlanContext,
    old_path: &str,
    new_path: &str,
) -> Result<Vec<PlannedFile>> {
    let candidates = context.files.list_files(context.id)?;
    let mut writes = Vec::new();
    for path in &candidates {
        if path == old_path
            || path == new_path
            || std::path::Path::new(path)
                .extension()
                .is_none_or(|extension| extension != "md")
        {
            continue;
        }
        let old = read(context.files, context.id, path, None)?;
        let text = std::str::from_utf8(&old).map_err(|_| {
            RuntimeError::Validation("Markdown reference source is not UTF-8".to_owned())
        })?;
        let rewritten =
            tasknotes_vault::links::rewrite_document(text, path, old_path, new_path, &candidates)?;
        let found = if old_path == new_path {
            // The same-path request is an inspection: replace with a safe
            // sentinel only in the pure plan to detect an incoming reference.
            tasknotes_vault::links::rewrite_document(
                text,
                path,
                old_path,
                "Facet/reference-check.md",
                &candidates,
            )? != text
        } else {
            rewritten != text
        };
        if found {
            writes.push(PlannedFile {
                path: path.clone(),
                expected: Some(ContentRevision::of(&old).as_str().to_owned()),
                before: Some(old),
                bytes: Some(rewritten.into_bytes()),
            });
        }
    }
    Ok(writes)
}

pub(crate) fn reference_changes(
    files: &dyn VaultFiles,
    id: &str,
    config: &TaskNotesConfiguration,
    mutation: &Mutation,
    old_path: &str,
    new_path: &str,
) -> Result<Vec<PlannedFile>> {
    reference_writes(
        &PlanContext {
            files,
            id,
            config,
            mutation,
            diagnostics: std::cell::RefCell::new(Vec::new()),
        },
        old_path,
        new_path,
    )
}

fn archive(
    context: &PlanContext,
    path: &str,
    expected: Option<&str>,
    archived: bool,
) -> Result<Vec<PlannedFile>> {
    let policy = context.config.effective.get("archive").ok_or_else(|| {
        RuntimeError::Configuration("archive configuration is missing".to_owned())
    })?;
    let properties = match policy
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("field")
    {
        "field" => Map::from_iter([("archiveTag".to_owned(), json!(archived))]),
        "tag" => {
            let old = read(context.files, context.id, path, expected)?;
            let document = TaskDocument::parse(VaultPath::parse(path)?, &old)?;
            let mut tags = document
                .frontmatter()
                .get("tags")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let tag = policy
                .get("tag")
                .and_then(Value::as_str)
                .unwrap_or("archived");
            tags.retain(|value| value.as_str() != Some(tag));
            if archived {
                tags.push(json!(tag));
            }
            Map::from_iter([("tags".to_owned(), json!(tags))])
        }
        _ => {
            return Err(RuntimeError::Configuration(
                "unsupported archive mode".to_owned(),
            ));
        }
    };
    let mut writes = update(context, path, expected, properties, None)?;
    if archived && policy.get("move_on_archive") == Some(&Value::Bool(true)) {
        let folder = policy
            .get("folder")
            .and_then(Value::as_str)
            .ok_or_else(|| RuntimeError::Configuration("archive folder is missing".to_owned()))?;
        let filename = path.rsplit('/').next().ok_or(RuntimeError::NotFound)?;
        let destination = format!("{}/{filename}", folder.trim_end_matches('/'));
        if destination != path {
            VaultPath::parse(&destination)?;
            if context.files.read_file(context.id, &destination)?.is_some() {
                return Err(RuntimeError::Conflict);
            }
            let changed = writes.pop().ok_or(RuntimeError::NotFound)?;
            writes.push(PlannedFile {
                path: destination,
                expected: None,
                before: None,
                bytes: changed.bytes,
            });
            writes.push(PlannedFile {
                path: path.to_owned(),
                expected: changed.expected,
                before: changed.before,
                bytes: None,
            });
        }
    }
    Ok(writes)
}
fn save_view(
    context: &PlanContext,
    view_id: &str,
    view: &Map<String, Value>,
) -> Result<Vec<PlannedFile>> {
    let files = context.files;
    let id = context.id;
    let path = view_path(view_id)?;
    let old = files.read_file(id, &path)?;
    let document =
        TaskDocument::parse(VaultPath::parse(&path)?, old.as_deref().unwrap_or_default())?;
    let mut view = view.clone();
    if view
        .get("schemaVersion")
        .is_some_and(|v| v.as_f64() != Some(1.0))
    {
        return Err(RuntimeError::Validation(
            "unsupported portable view version".to_owned(),
        ));
    }
    view.insert("schemaVersion".to_owned(), json!(1));
    let write = document.plan(
        &[PropertyEdit::Set {
            key: "facetView".to_owned(),
            value: json!(view),
        }],
        None,
    )?;
    Ok(vec![PlannedFile {
        path,
        expected: old
            .as_deref()
            .map(|bytes| ContentRevision::of(bytes).as_str().to_owned()),
        before: old,
        bytes: Some(write.bytes),
    }])
}
fn create(
    context: &PlanContext,
    path: Option<&str>,
    properties: &Map<String, Value>,
    body: Option<&str>,
) -> Result<Vec<PlannedFile>> {
    let files = context.files;
    let id = context.id;
    let config = context.config;
    let mutation = context.mutation;
    let mut properties = temporal_writes::command_properties(properties.clone(), config)?;
    temporal_writes::canonicalize(&mut properties.clone(), config)?;
    let timestamp = tasknotes_vault::temporal::canonical_instant(&mutation.at)?;
    properties
        .get("title")
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| RuntimeError::Validation("task title is required".to_owned()))?;
    if let Some(status) = &config.default_status {
        properties.entry("status").or_insert(json!(status));
    }
    if let Some(priority) = &config.default_priority {
        properties.entry("priority").or_insert(json!(priority));
    }
    properties.entry("dateCreated").or_insert(json!(timestamp));
    properties.insert("dateModified".to_owned(), json!(timestamp));
    let supplied_body = body.unwrap_or_default();
    let (prepared, body) = creation_template(context, &properties, supplied_body)?;
    properties = prepared;
    let prepared = creation_destination(context, path, &properties, supplied_body)?;
    let path = if path.is_some() {
        prepared.path
    } else if portable_filename_policy(config) {
        unused_path(context, &prepared.path, None)?
    } else {
        prepared.path
    };
    properties = prepared.frontmatter;
    temporal_writes::canonicalize_document(&mut properties, config)?;
    recurrence_writes::canonicalize(&mut properties, config)?;
    if config.store_title_in_filename {
        let semantic = properties
            .get("title")
            .and_then(Value::as_str)
            .ok_or_else(|| RuntimeError::Validation("task title missing".into()))?;
        if path
            .rsplit('/')
            .next()
            .and_then(|name| name.strip_suffix(".md"))
            == Some(semantic)
        {
            properties.remove("title");
        }
    }
    VaultPath::parse(&path)?;
    if files.read_file(id, &path)?.is_some() {
        return Err(RuntimeError::Conflict);
    }
    detection::ensure(&mut properties, config)?;
    validate_properties(&properties, config)?;
    let document = TaskDocument::parse(VaultPath::parse(&path)?, b"")?;
    let edits = document_edits(&properties, config);
    let write = document.plan(&edits, Some(&body))?;
    validation::enforce(config, &path, &write.bytes)?;
    Ok(vec![PlannedFile {
        path,
        expected: None,
        before: None,
        bytes: Some(write.bytes),
    }])
}

fn creation_destination(
    context: &PlanContext,
    path: Option<&str>,
    properties: &Map<String, Value>,
    supplied_body: &str,
) -> Result<tasknotes_vault::creation::CreationPlan> {
    let files = context.files;
    let id = context.id;
    let config = context.config;
    let mutation = context.mutation;
    let task_type = configured_task_type(config)?;
    let zone = mutation
        .execution_context
        .as_ref()
        .map_or("UTC", |context| context.timezone.as_str());
    let now = tasknotes_vault::temporal::parse_instant(&mutation.at)?;
    Ok(if let Some(path) = path {
        tasknotes_vault::creation::CreationPlan {
            path: path.to_owned(),
            frontmatter: tasknotes_vault::creation::defaults(&task_type, properties, now)?,
        }
    } else if portable_filename_policy(config) {
        tasknotes_vault::creation::plan(&task_type, properties, now, zone)?
    } else {
        let title = properties
            .get("title")
            .and_then(Value::as_str)
            .ok_or_else(|| RuntimeError::Validation("task title missing".into()))?;
        let policy = config
            .effective
            .get("title")
            .ok_or_else(|| RuntimeError::Configuration("title policy missing".into()))?;
        let mut filename_properties = properties.clone();
        filename_properties.insert("details".into(), json!(supplied_body));
        let name = tasknotes_vault::filename::basename(
            title,
            policy,
            &filename_properties,
            now,
            zone,
            Some(&mutation.mutation_id),
        )?;
        let folder = config
            .effective
            .get("task_detection")
            .and_then(|value| value.get("default_folder"))
            .and_then(Value::as_str)
            .ok_or_else(|| RuntimeError::Configuration("task folder missing".into()))?;
        let occupied = files
            .list_files(id)?
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>();
        let selected = tasknotes_vault::filename::select(
            folder,
            &name,
            title,
            now.timestamp_millis(),
            |path| Ok(occupied.contains(path)),
        )?;
        if selected.shortened {
            context.notice(DiagnosticCode::FilenameShortened);
        }
        tasknotes_vault::creation::CreationPlan {
            path: selected.path,
            frontmatter: tasknotes_vault::creation::defaults(&task_type, properties, now)?,
        }
    })
}

fn unused_path(context: &PlanContext, wanted: &str, current: Option<&str>) -> Result<String> {
    VaultPath::parse(wanted)?;
    let stem = wanted
        .strip_suffix(".md")
        .ok_or_else(|| RuntimeError::Validation("task destination must be Markdown".to_owned()))?;
    for number in 1..=10_000 {
        let path = if number == 1 {
            wanted.to_owned()
        } else {
            format!("{stem} ({number}).md")
        };
        if current == Some(path.as_str()) || context.files.read_file(context.id, &path)?.is_none() {
            return Ok(path);
        }
    }
    Err(RuntimeError::Conflict)
}

fn portable_filename_policy(config: &TaskNotesConfiguration) -> bool {
    config.extra.get("sectionOrigins").is_some_and(|origins| {
        ["title", "task_type"]
            .iter()
            .any(|key| origins.get(*key).and_then(Value::as_str) == Some("tasknotes-yaml"))
    })
}

pub(crate) fn filename_requires_uuid(config: &TaskNotesConfiguration) -> bool {
    if config.store_title_in_filename || portable_filename_policy(config) {
        return false;
    }
    let policy = config.effective.get("title");
    policy.is_some_and(
        |policy| match policy.get("filename_format").and_then(Value::as_str) {
            Some("uuid") => true,
            Some("custom") => policy
                .get("custom_filename_template")
                .and_then(Value::as_str)
                .is_some_and(|template| template.contains("{uuid}")),
            _ => false,
        },
    )
}

fn configured_task_type(config: &TaskNotesConfiguration) -> Result<Value> {
    if let Some(task_type) = config.effective.get("task_type") {
        return Ok(task_type.clone());
    }
    let folder = config
        .effective
        .get("task_detection")
        .and_then(|v| v.get("default_folder"))
        .and_then(Value::as_str)
        .ok_or_else(|| RuntimeError::Configuration("task creation folder is missing".to_owned()))?;
    let title = config
        .effective
        .get("title")
        .ok_or_else(|| RuntimeError::Configuration("title policy is missing".to_owned()))?;
    let pattern = if config.store_title_in_filename {
        "{title}"
    } else {
        match title
            .get("filename_format")
            .and_then(Value::as_str)
            .unwrap_or("title")
        {
            "title" => "{title}",
            "slug" => "{titleKebab}",
            "zettel" | "timestamp" => "{zettel}",
            "uuid" => "{uuid}",
            "custom" => title
                .get("custom_filename_template")
                .and_then(Value::as_str)
                .filter(|v| !v.trim().is_empty())
                .ok_or_else(|| {
                    RuntimeError::Configuration("custom filename template is missing".to_owned())
                })?,
            _ => {
                return Err(RuntimeError::Configuration(
                    "unsupported filename format".to_owned(),
                ));
            }
        }
    };
    let fields = config
        .effective
        .get("defaults")
        .and_then(Value::as_object)
        .map(|defaults| {
            defaults
                .iter()
                .map(|(key, value)| (key.clone(), json!({"default":value})))
                .collect::<Map<_, _>>()
        })
        .unwrap_or_default();
    Ok(json!({"path_pattern":format!("{}/{pattern}",folder.trim_end_matches('/')),"fields":fields}))
}

fn creation_template(
    context: &PlanContext,
    properties: &Map<String, Value>,
    body: &str,
) -> Result<(Map<String, Value>, String)> {
    let policy =
        context.config.effective.get("templating").ok_or_else(|| {
            RuntimeError::Configuration("templating policy is missing".to_owned())
        })?;
    if policy.get("enabled") != Some(&Value::Bool(true)) {
        return Ok((properties.clone(), body.to_owned()));
    }
    let result = load_creation_template(context, properties, policy, body);
    match result {
        Ok((properties, template_body)) => Ok((
            properties,
            if template_body.trim().is_empty() {
                body.to_owned()
            } else {
                template_body
            },
        )),
        Err(error @ (RuntimeError::NotFound | RuntimeError::Validation(_)))
            if policy.get("failure_mode").and_then(Value::as_str) == Some("warning_fallback") =>
        {
            context.notice(if matches!(error, RuntimeError::NotFound) {
                DiagnosticCode::TemplateMissing
            } else {
                DiagnosticCode::TemplateParseFailed
            });
            Ok((properties.clone(), body.to_owned()))
        }
        Err(error) => Err(error),
    }
}

fn load_creation_template(
    context: &PlanContext,
    properties: &Map<String, Value>,
    policy: &Value,
    caller_body: &str,
) -> Result<(Map<String, Value>, String)> {
    let path = policy
        .get("template_path")
        .and_then(Value::as_str)
        .ok_or_else(|| RuntimeError::Configuration("template path is missing".to_owned()))?;
    let bytes = read(context.files, context.id, path, None)?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| RuntimeError::Validation("template must be UTF-8".to_owned()))?;
    let now = tasknotes_vault::temporal::parse_instant(&context.mutation.at)?;
    let zone = context
        .mutation
        .execution_context
        .as_ref()
        .map_or("UTC", |v| v.timezone.as_str());
    let values =
        tasknotes_vault::templating::production_values(properties, caller_body, now, zone)?;
    let (frontmatter, body) = tasknotes_vault::templating::production_sections(text)?;
    let unknown = policy
        .get("unknown_variable_policy")
        .and_then(Value::as_str)
        .unwrap_or("preserve");
    let template = if frontmatter.is_empty() {
        Map::new()
    } else {
        tasknotes_vault::templating::expand_frontmatter(&frontmatter, &values, unknown)?
    };
    Ok((
        tasknotes_vault::templating::merge(
            properties,
            &context.config.mapping.normalize(&template),
        ),
        tasknotes_vault::templating::expand(&body, &values, unknown)?,
    ))
}
fn set_completion(
    context: &PlanContext,
    path: &str,
    expected_revision: Option<&str>,
    occurrence_date: Option<&str>,
    desired: Option<bool>,
) -> Result<Vec<PlannedFile>> {
    let old = read(context.files, context.id, path, expected_revision)?;
    let document = TaskDocument::parse(VaultPath::parse(path)?, &old)?;
    instances::validate_sources(context.config, &document)?;
    let normalized = context.config.mapping.normalize(document.frontmatter());
    let properties = if normalized
        .get("recurrence")
        .and_then(Value::as_str)
        .is_some_and(|s| !s.trim().is_empty())
    {
        recurring_completion(context, &normalized, occurrence_date, desired)?
    } else {
        ordinary_completion(context, &normalized, desired)?
    };
    let Some(properties) = properties else {
        return Ok(Vec::new());
    };
    update(
        context,
        path,
        Some(document.revision().as_str()),
        properties,
        None,
    )
}

fn ordinary_completion(
    context: &PlanContext,
    normalized: &Map<String, Value>,
    desired: Option<bool>,
) -> Result<Option<Map<String, Value>>> {
    let config = context.config;
    let status = normalized
        .get("status")
        .and_then(Value::as_str)
        .or(config.default_status.as_deref())
        .ok_or_else(|| RuntimeError::Validation("task status is required".to_owned()))?;
    let done = config.is_completed(status)?;
    if desired == Some(done) {
        return Ok(None);
    }
    let target = if done {
        config.default_status.as_deref().and_then(|value| {
            config
                .statuses
                .iter()
                .find(|s| s.value == value && !s.is_completed)
        })
    } else {
        config.statuses.iter().find(|s| s.is_completed)
    }
    .ok_or_else(|| {
        RuntimeError::Configuration("workflow needs open and completed statuses".to_owned())
    })?;
    let properties = if done {
        json!({"status":target.value,"completedDate":null})
    } else {
        tasknotes_vault::operations::completion(
            &json!({"completedValues":[target.value]}),
            tasknotes_vault::temporal::parse_day(date(context.mutation))?,
        )?
    };
    Ok(Some(properties.as_object().cloned().ok_or_else(|| {
        RuntimeError::Storage("completion result violates its contract".to_owned())
    })?))
}

fn recurring_completion(
    context: &PlanContext,
    normalized: &Map<String, Value>,
    occurrence: Option<&str>,
    desired: Option<bool>,
) -> Result<Option<Map<String, Value>>> {
    let (day, instant) = completion_target(context, normalized, occurrence)?;
    let occurrence = day.to_string();
    let instances = tasknotes_vault::instances::InstanceLists::parse(normalized)?;
    let done = instances.completed.iter().any(|entry| entry == &occurrence);
    if desired == Some(done) {
        return Ok(None);
    }
    let mut input = normalized.clone();
    if !done && let Some(rule) = recurrence_writes::seeded_rule(normalized)? {
        input.insert("recurrence".into(), json!(rule));
    }
    validate_occurrence_sources(normalized)?;
    let mut properties = Map::new();
    if done {
        input.insert("targetDate".to_owned(), json!(occurrence));
        let instances = tasknotes_vault::operations::instance(
            "recurrence.uncomplete_instance",
            &Value::Object(input.clone()),
        )?;
        for key in ["completeInstances", "skippedInstances"] {
            let value = result_field(&instances, key)?;
            input.insert(key.to_owned(), value.clone());
            properties.insert(key.to_owned(), value);
        }
    }
    input.insert(
        if done {
            "referenceDate"
        } else {
            "completionDate"
        }
        .to_owned(),
        json!(occurrence),
    );
    let input = Value::Object(input);
    let result = if !done && let Some(instant) = instant {
        tasknotes_vault::progression::complete_at(&input, day, instant)?
    } else {
        tasknotes_vault::progression::execute(
            if done {
                "recurrence.recalculate"
            } else {
                "recurrence.complete"
            },
            &input,
        )?
    };
    if !done {
        for key in ["completeInstances", "skippedInstances"] {
            properties.insert(key.to_owned(), result_field(&result, key)?);
        }
    }
    for (role, key) in [
        ("recurrence", "updatedRecurrence"),
        ("scheduled", "nextScheduled"),
        ("due", "nextDue"),
    ] {
        properties.insert(role.to_owned(), result_field(&result, key)?);
    }
    Ok(Some(properties))
}
fn validate_occurrence_sources(normalized: &Map<String, Value>) -> Result<()> {
    for role in ["scheduled", "due"] {
        if let Some(value) = normalized.get(role).filter(|value| !value.is_null()) {
            let value = value.as_str().ok_or_else(|| {
                RuntimeError::Validation(format!("{role} must be a date or instant"))
            })?;
            if value.len() == 10 {
                tasknotes_vault::temporal::parse_day(value)?;
            } else {
                tasknotes_vault::temporal::parse_instant(value)?;
            }
        }
    }
    Ok(())
}

fn completion_target(
    context: &PlanContext,
    normalized: &Map<String, Value>,
    explicit: Option<&str>,
) -> Result<(chrono::NaiveDate, Option<chrono::DateTime<chrono::Utc>>)> {
    use tasknotes_vault::temporal;
    if let Some(target) = explicit {
        if target.len() == 10 {
            return Ok((temporal::parse_day(target)?, None));
        }
        let instant = temporal::parse_instant(target)?;
        let execution = context.mutation.execution_context.as_ref().ok_or_else(|| {
            RuntimeError::Validation(
                "explicit datetime occurrence requires execution context".into(),
            )
        })?;
        return Ok((
            temporal::day_in_timezone(target, &execution.timezone)?,
            Some(instant),
        ));
    }
    let fallback = normalized
        .get("scheduled")
        .filter(|value| !value.is_null())
        .or_else(|| normalized.get("due").filter(|value| !value.is_null()));
    let Some(fallback) = fallback else {
        return Ok((temporal::parse_day(date(context.mutation))?, None));
    };
    let fallback = fallback
        .as_str()
        .ok_or_else(|| RuntimeError::Validation("invalid occurrence fallback".into()))?;
    if fallback.len() != 10 {
        temporal::parse_instant(fallback)?;
    }
    Ok((temporal::date_part(fallback)?, None))
}

fn update(
    context: &PlanContext,
    path: &str,
    expected: Option<&str>,
    mut properties: Map<String, Value>,
    body: Option<&str>,
) -> Result<Vec<PlannedFile>> {
    let files = context.files;
    let id = context.id;
    let config = context.config;
    let at = &context.mutation.at;
    let old = read(files, id, path, expected)?;
    let document = TaskDocument::parse(VaultPath::parse(path)?, &old)?;
    temporal_writes::canonicalize(&mut properties, config)?;
    let new_path = updated_path(context, path, &properties)?;
    if config.store_title_in_filename
        && !portable_filename_policy(config)
        && let Some(title) = properties.get("title").and_then(Value::as_str)
    {
        let selected = new_path.as_deref().unwrap_or(path);
        if selected
            .rsplit('/')
            .next()
            .and_then(|name| name.strip_suffix(".md"))
            == Some(title)
        {
            properties.insert("title".into(), Value::Null);
        }
    }
    let changed = properties.iter().any(|(role, value)| {
        let key = config.mapping.field(canonical_role(role).unwrap_or(role));
        if value.is_null() {
            document.frontmatter().contains_key(key)
        } else {
            document.frontmatter().get(key) != Some(value)
        }
    }) || body.is_some_and(|body| body != document.body());
    if !changed && new_path.is_none() {
        return Ok(Vec::new());
    }
    properties.insert(
        "dateModified".to_owned(),
        json!(tasknotes_vault::temporal::canonical_instant(at)?),
    );
    let write = document.plan(&edits(&properties, config), body)?;
    validation::enforce(config, path, &write.bytes)?;
    instances::validate_planned(context, path, &write.bytes)?;
    if let Some(new_path) = new_path {
        return relocate_update(context, path, &new_path, &write);
    }
    Ok(vec![PlannedFile {
        path: path.to_owned(),
        expected: Some(write.expected_revision.as_str().to_owned()),
        before: Some(old),
        bytes: Some(write.bytes),
    }])
}

fn updated_path(
    context: &PlanContext,
    path: &str,
    properties: &Map<String, Value>,
) -> Result<Option<String>> {
    let Some(title) = properties.get("title").and_then(Value::as_str) else {
        return Ok(None);
    };
    if !context.config.store_title_in_filename {
        return Ok(None);
    }
    let directory = path.rsplit_once('/').map_or("", |(directory, _)| directory);
    if !portable_filename_policy(context.config) {
        let now = tasknotes_vault::temporal::parse_instant(&context.mutation.at)?;
        let occupied = context
            .files
            .list_files(context.id)?
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>();
        let selected = tasknotes_vault::filename::select(
            directory,
            &tasknotes_vault::filename::sanitize(title),
            title,
            now.timestamp_millis(),
            |candidate| Ok(candidate != path && occupied.contains(candidate)),
        )?;
        if selected.shortened {
            context.notice(DiagnosticCode::FilenameShortened);
        }
        return Ok((selected.path != path).then_some(selected.path));
    }
    let new_path = if directory.is_empty() {
        format!("{}.md", safe_filename(title))
    } else {
        format!("{directory}/{}.md", safe_filename(title))
    };
    let new_path = unused_path(context, &new_path, Some(path))?;
    Ok((new_path != path).then_some(new_path))
}

fn relocate_update(
    context: &PlanContext,
    path: &str,
    new_path: &str,
    write: &tasknotes_vault::document::DocumentWrite,
) -> Result<Vec<PlannedFile>> {
    let mut writes = rename_references(
        context,
        path,
        new_path,
        Some(write.expected_revision.as_str()),
        true,
    )?;
    if let Some(destination) = writes.first_mut() {
        let candidates = context.files.list_files(context.id)?;
        let text = std::str::from_utf8(&write.bytes)
            .map_err(|_| RuntimeError::Validation("task must be UTF-8".to_owned()))?;
        destination.bytes = Some(
            tasknotes_vault::links::rewrite_document(text, path, path, new_path, &candidates)?
                .into_bytes(),
        );
    }
    Ok(writes)
}

fn read(files: &dyn VaultFiles, id: &str, path: &str, expected: Option<&str>) -> Result<Vec<u8>> {
    VaultPath::parse(path)?;
    let bytes = files.read_file(id, path)?.ok_or(RuntimeError::NotFound)?;
    if expected.is_some_and(|expected| expected != ContentRevision::of(&bytes).as_str()) {
        return Err(RuntimeError::Conflict);
    }
    Ok(bytes)
}

fn edits(properties: &Map<String, Value>, config: &TaskNotesConfiguration) -> Vec<PropertyEdit> {
    properties
        .iter()
        .map(|(role, value)| {
            let key = config
                .mapping
                .field(canonical_role(role).unwrap_or(role))
                .to_owned();
            if value.is_null() {
                PropertyEdit::Remove { key }
            } else {
                PropertyEdit::Set {
                    key,
                    value: value.clone(),
                }
            }
        })
        .collect()
}

fn document_edits(
    properties: &Map<String, Value>,
    config: &TaskNotesConfiguration,
) -> Vec<PropertyEdit> {
    // Known canonical roles become configured physical keys; unknown template keys
    // remain physical data rather than being reinterpreted as command aliases.
    config
        .mapping
        .denormalize(properties)
        .into_iter()
        .map(|(key, value)| {
            if value.is_null() {
                PropertyEdit::Remove { key }
            } else {
                PropertyEdit::Set { key, value }
            }
        })
        .collect()
}

fn validate_properties(
    properties: &Map<String, Value>,
    config: &TaskNotesConfiguration,
) -> Result<()> {
    if let Some(status) = properties.get("status").filter(|v| !v.is_null()) {
        config.is_completed(
            status
                .as_str()
                .ok_or_else(|| RuntimeError::Validation("status must be a string".to_owned()))?,
        )?;
    }
    if let Some(priority) = properties.get("priority").filter(|v| !v.is_null()) {
        let priority = priority
            .as_str()
            .ok_or_else(|| RuntimeError::Validation("priority must be a string".to_owned()))?;
        if !config.priorities.iter().any(|p| p.value == priority) {
            return Err(RuntimeError::Validation(
                "unknown configured priority".to_owned(),
            ));
        }
    }
    for role in [
        "tags",
        "contexts",
        "projects",
        "attachments",
        "completeInstances",
        "skippedInstances",
    ] {
        if properties.get(role).is_some_and(|value| {
            !value.is_null()
                && !value
                    .as_array()
                    .is_some_and(|values| values.iter().all(Value::is_string))
        }) {
            return Err(RuntimeError::Validation(format!(
                "{role} must be a string list"
            )));
        }
    }
    for role in [
        "due",
        "scheduled",
        "completedDate",
        "dateCreated",
        "dateModified",
    ] {
        if let Some(value) = properties.get(role).filter(|v| !v.is_null()) {
            let value = value.as_str().ok_or_else(|| {
                RuntimeError::Validation(format!("{role} must be a date or instant"))
            })?;
            if value.len() == 10 {
                tasknotes_vault::temporal::parse_day(value)?;
            } else {
                tasknotes_vault::temporal::parse_instant(value)?;
            }
        }
    }
    if let Some(value) = properties.get("blockedBy").filter(|v| !v.is_null()) {
        let dependencies = value.as_array().ok_or_else(|| {
            RuntimeError::Validation("blockedBy must be a dependency list".to_owned())
        })?;
        tasknotes_vault::relationships::validate_dependencies(
            dependencies,
            properties.get("id").and_then(Value::as_str),
        )?;
    }
    if let Some(value) = properties.get("reminders").filter(|v| !v.is_null()) {
        let reminders = value.as_array().ok_or_else(|| {
            RuntimeError::Validation("reminders must be a reminder list".to_owned())
        })?;
        tasknotes_vault::relationships::validate_reminders(reminders, properties)?;
    }
    Ok(())
}

fn safe_filename(title: &str) -> String {
    title
        .trim()
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '-'
            } else {
                c
            }
        })
        .take(180)
        .collect::<String>()
        .trim_end_matches(['.', ' '])
        .to_owned()
}

fn view_path(id: &str) -> Result<String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err(RuntimeError::Validation(
            "invalid saved view identity".to_owned(),
        ));
    }
    Ok(format!("Facet/Views/{id}.md"))
}

fn date(mutation: &Mutation) -> &str {
    mutation.execution_context.as_ref().map_or_else(
        || mutation.at.split('T').next().unwrap_or(&mutation.at),
        |context| context.today.as_str(),
    )
}

fn result_field(result: &Value, key: &str) -> Result<Value> {
    result.get(key).cloned().ok_or_else(|| {
        RuntimeError::Storage("shared semantic result violates its contract".to_owned())
    })
}
