//! Storage corpus adapter using the shipped `SQLite` engine and injected disk effects.

mod bounded;

use serde_json::{Map, Value, json};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    sync::{Arc, Mutex},
};
use tasknotes_runtime::{
    RuntimeError,
    engine::Engine,
    types::{Command, DisplacedMetadata, FileExchange, Mutation, Profile, ProfileKind, VaultFiles},
};
use tasknotes_vault::{
    Result, VaultError,
    document::{ContentRevision, PropertyEdit, TaskDocument},
    path::VaultPath,
};

const PROFILE: &str = "fixture";
const AT: &str = "2026-02-20T10:00:00Z";

#[derive(Default)]
struct State {
    backups: BTreeMap<String, DisplacedMetadata>,
    fail_staging: BTreeSet<String>,
    sequence: u64,
    exchanges: u64,
    race_paths: BTreeSet<String>,
    snapshots: BTreeMap<String, std::path::PathBuf>,
    stages: BTreeMap<String, bounded::Stage>,
    outcomes: BTreeMap<String, tasknotes_runtime::types::StagedExchange>,
}
struct Disk {
    root: std::path::PathBuf,
    state: Mutex<State>,
}
impl Disk {
    fn path(&self, path: &str) -> tasknotes_runtime::Result<std::path::PathBuf> {
        VaultPath::parse(path)?;
        Ok(self.root.join("vault").join(path))
    }
    fn seed(&self, path: &str, bytes: &[u8]) -> tasknotes_runtime::Result<()> {
        let path = self.path(path)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(host)?;
        }
        fs::write(path, bytes).map_err(host)
    }
    fn frontmatter(&self, path: &str) -> Result<Value> {
        let bytes = self
            .read_file(PROFILE, path)
            .map_err(boundary)?
            .ok_or_else(|| invalid("file_missing"))?;
        Ok(json!(
            TaskDocument::parse(VaultPath::parse(path)?, &bytes)?.frontmatter()
        ))
    }
}
impl VaultFiles for Disk {
    fn open_file_snapshot(
        &self,
        _: &str,
        path: &str,
    ) -> tasknotes_runtime::Result<Option<tasknotes_runtime::types::FileSnapshot>> {
        self.snapshot(&self.path(path)?)
    }
    fn open_displaced_snapshot(
        &self,
        _: &str,
        backup: &str,
    ) -> tasknotes_runtime::Result<tasknotes_runtime::types::FileSnapshot> {
        let metadata = self
            .state
            .lock()
            .map_err(|_| bounded::contract())?
            .backups
            .get(backup)
            .cloned()
            .ok_or_else(bounded::contract)?;
        let snapshot = self
            .snapshot(&self.root.join(backup))?
            .ok_or_else(bounded::contract)?;
        if snapshot.size != metadata.size || snapshot.revision != metadata.revision {
            return Err(bounded::contract());
        }
        Ok(snapshot)
    }
    fn read_snapshot_chunk(
        &self,
        _: &str,
        id: &str,
        offset: u64,
        length: u32,
    ) -> tasknotes_runtime::Result<Vec<u8>> {
        self.snapshot_chunk(id, offset, length)
    }
    fn close_snapshot(&self, _: &str, id: &str) -> tasknotes_runtime::Result<()> {
        self.close_image(id)
    }
    fn begin_replacement(
        &self,
        _: &str,
        operation: &str,
        path: &str,
        expected: Option<&str>,
        size: u64,
        revision: &str,
    ) -> tasknotes_runtime::Result<tasknotes_runtime::types::ReplacementStage> {
        self.start_stage(operation, path, expected, size, revision)
    }
    fn write_replacement_chunk(
        &self,
        _: &str,
        stage: &str,
        offset: u64,
        bytes: &[u8],
    ) -> tasknotes_runtime::Result<tasknotes_runtime::types::ReplacementStage> {
        self.write_stage(stage, offset, bytes)
    }
    fn seal_replacement(
        &self,
        _: &str,
        stage: &str,
    ) -> tasknotes_runtime::Result<tasknotes_runtime::types::ReplacementStage> {
        self.seal_stage(stage)
    }
    fn compare_exchange_staged(
        &self,
        _: &str,
        operation: &str,
        path: &str,
        expected: Option<&str>,
        stage: Option<&str>,
    ) -> tasknotes_runtime::Result<tasknotes_runtime::types::StagedExchange> {
        self.exchange_stage(operation, path, expected, stage)
    }
    fn discard_replacement(&self, _: &str, stage: &str) -> tasknotes_runtime::Result<()> {
        self.discard_stage(stage)
    }
    fn list_files(&self, _id: &str) -> tasknotes_runtime::Result<Vec<String>> {
        fn scan(
            root: &std::path::Path,
            base: &std::path::Path,
            paths: &mut Vec<String>,
        ) -> tasknotes_runtime::Result<()> {
            if !root.exists() {
                return Ok(());
            }
            for entry in fs::read_dir(root).map_err(host)? {
                let entry = entry.map_err(host)?;
                let path = entry.path();
                if entry.file_type().map_err(host)?.is_dir() {
                    scan(&path, base, paths)?;
                } else {
                    paths.push(
                        path.strip_prefix(base)
                            .map_err(|_| RuntimeError::Host("invalid fixture root".into()))?
                            .to_string_lossy()
                            .into_owned(),
                    );
                }
            }
            Ok(())
        }
        let base = self.root.join("vault");
        let mut paths = Vec::new();
        scan(&base, &base, &mut paths)?;
        paths.sort();
        Ok(paths)
    }
    fn read_file(&self, _id: &str, path: &str) -> tasknotes_runtime::Result<Option<Vec<u8>>> {
        match fs::read(self.path(path)?) {
            Ok(bytes) => Ok(Some(bytes)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(host(error)),
        }
    }
    fn compare_exchange(
        &self,
        id: &str,
        path: &str,
        expected: Option<&str>,
        replacement: Option<&[u8]>,
    ) -> tasknotes_runtime::Result<FileExchange> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("fixture gate failed".into()))?;
        let current = self.read_file(id, path)?;
        let revision = current
            .as_deref()
            .map(|bytes| ContentRevision::of(bytes).as_str().to_owned());
        if revision.as_deref() != expected {
            return Ok(FileExchange {
                applied: false,
                displaced_bytes: None,
                displaced_version_id: None,
            });
        }
        state.sequence += 1;
        if state.race_paths.remove(path) {
            let destination = self.path(path)?;
            fs::write(&destination,b"---\ntitle: External writer\nstatus: open\ntags: [task]\nvendor: preserved\n---\n").map_err(host)?;
            fs::File::open(&destination)
                .map_err(host)?
                .sync_all()
                .map_err(host)?;
            return Ok(FileExchange {
                applied: false,
                displaced_bytes: None,
                displaced_version_id: None,
            });
        }
        let temporary = self.root.join(format!("stage-{}", state.sequence));
        if let Some(bytes) = replacement {
            fs::write(&temporary, bytes).map_err(host)?;
            fs::File::open(&temporary)
                .map_err(host)?
                .sync_all()
                .map_err(host)?;
        }
        if state.fail_staging.contains(path) {
            if temporary.exists() {
                fs::remove_file(&temporary).map_err(host)?;
            }
            return Err(RuntimeError::Host(
                "injected failure after staging write, before atomic publication".into(),
            ));
        }
        let destination = self.path(path)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(host)?;
        }
        let backup_id = current
            .as_ref()
            .map(|_| format!("backup-{:08}", state.sequence));
        if let (Some(bytes), Some(backup)) = (&current, &backup_id) {
            fs::rename(&destination, self.root.join(backup)).map_err(host)?;
            state.backups.insert(
                backup.clone(),
                DisplacedMetadata {
                    id: backup.clone(),
                    path: path.to_owned(),
                    size: u64::try_from(bytes.len())
                        .map_err(|_| RuntimeError::Host("fixture size overflow".into()))?,
                    revision: ContentRevision::of(bytes).as_str().to_owned(),
                },
            );
        }
        if replacement.is_some() {
            fs::rename(temporary, &destination).map_err(host)?;
        }
        if let Some(parent) = destination.parent() {
            fs::File::open(parent)
                .map_err(host)?
                .sync_all()
                .map_err(host)?;
        }
        state.exchanges += 1;
        Ok(FileExchange {
            applied: true,
            displaced_bytes: current,
            displaced_version_id: backup_id,
        })
    }
    fn displaced_metadata(
        &self,
        _id: &str,
        after: Option<&str>,
        limit: u32,
    ) -> tasknotes_runtime::Result<Vec<DisplacedMetadata>> {
        let state = self
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("fixture gate failed".into()))?;
        Ok(state
            .backups
            .values()
            .filter(|v| after.is_none_or(|after| v.id.as_str() > after))
            .take(
                usize::try_from(limit)
                    .map_err(|_| RuntimeError::Host("fixture limit overflow".into()))?,
            )
            .cloned()
            .collect())
    }
    fn read_displaced(&self, _id: &str, id: &str) -> tasknotes_runtime::Result<Vec<u8>> {
        fs::read(self.root.join(id)).map_err(host)
    }
    fn acknowledge_displaced(&self, _id: &str, id: &str) -> tasknotes_runtime::Result<()> {
        fs::remove_file(self.root.join(id)).map_err(host)?;
        self.state
            .lock()
            .map_err(|_| RuntimeError::Host("fixture gate failed".into()))?
            .backups
            .remove(id);
        Ok(())
    }
}

pub fn supports(operation: &str) -> bool {
    matches!(
        operation,
        "op.atomic_write"
            | "meta.claim"
            | "meta.has_capability"
            | "meta.has_profile"
            | "batch.apply"
            | "op.idempotency_check"
            | "archive.apply"
            | "delete.remove"
            | "rename.apply"
            | "rename.title_storage_interaction"
    )
}

pub fn execute(operation: &str, input: &Value) -> Result<Value> {
    if operation.starts_with("meta.") {
        return conformance(operation, input);
    }
    if operation == "batch.apply" {
        return batch(input);
    }
    let directory = tempfile::tempdir().map_err(|_| invalid("fixture_directory_failed"))?;
    let disk = Arc::new(Disk {
        root: directory.path().to_path_buf(),
        state: Mutex::new(State::default()),
    });
    let plugin = json!({"storeTitleInFilename":input.get("titleStorage").and_then(Value::as_str)==Some("filename")});
    disk.seed(
        ".obsidian/plugins/tasknotes/data.json",
        plugin.to_string().as_bytes(),
    )
    .map_err(boundary)?;
    if operation == "archive.apply" {
        disk.seed(
            "tasknotes.yaml",
            format!(
                "archive:\n  mode: {}\n",
                input.get("mode").and_then(Value::as_str).unwrap_or("field")
            )
            .as_bytes(),
        )
        .map_err(boundary)?;
    }
    let path = input
        .get("oldPath")
        .or_else(|| input.get("fromPath"))
        .or_else(|| input.get("path"))
        .and_then(Value::as_str)
        .unwrap_or("tasks/fixture.md");
    let mut frontmatter = input
        .get("original")
        .or_else(|| input.get("frontmatter"))
        .or_else(|| input.get("first"))
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    frontmatter.entry("title").or_insert(json!("Fixture"));
    frontmatter.entry("status").or_insert(json!("open"));
    frontmatter.entry("priority").or_insert(json!("normal"));
    frontmatter.entry("tags").or_insert(json!(["task"]));
    let create_check = operation == "op.idempotency_check"
        && input.get("operation").and_then(Value::as_str) == Some("create");
    if !create_check {
        seed_document(&disk, path, &frontmatter)?;
    }
    let filename = path
        .rsplit('/')
        .next()
        .unwrap_or(path)
        .strip_suffix(".md")
        .unwrap_or(path);
    let reference = format!("[[{filename}|Fixture reference]]\n");
    if operation == "rename.apply"
        || operation == "delete.remove"
            && input
                .get("brokenLinks")
                .and_then(Value::as_array)
                .is_some_and(|v| !v.is_empty())
    {
        disk.seed("references.md", reference.as_bytes())
            .map_err(boundary)?;
    }
    let database = directory.path().join("runtime.db");
    let database = database
        .to_str()
        .ok_or_else(|| invalid("fixture_database_path"))?;
    let engine = Engine::open(database, disk.clone()).map_err(boundary)?;
    engine
        .register_profile(Profile {
            id: PROFILE.into(),
            name: "Fixture".into(),
            kind: ProfileKind::LocalFolder,
            approve_standard: true,
        })
        .map_err(boundary)?;
    engine.refresh(PROFILE).map_err(boundary)?;
    let command = fixture_command(operation, input, path, create_check, &disk)?;
    let mutation = Mutation {
        mutation_id: "fixture-mutation".into(),
        at: AT.into(),
        execution_context: None,
        command,
    };
    fixture_result(
        operation, &disk, database, path, &reference, engine, &mutation,
    )
}

fn conformance(operation: &str, input: &Value) -> Result<Value> {
    let directory = tempfile::tempdir().map_err(|_| invalid("fixture_directory_failed"))?;
    let disk = Arc::new(Disk {
        root: directory.path().to_path_buf(),
        state: Mutex::new(State::default()),
    });
    let database = directory.path().join("metadata.db");
    let engine = Engine::open(
        database
            .to_str()
            .ok_or_else(|| invalid("fixture_database_path"))?,
        disk,
    )
    .map_err(boundary)?;
    engine
        .register_profile(Profile {
            id: PROFILE.to_owned(),
            name: "Conformance".to_owned(),
            kind: ProfileKind::ObsidianSync,
            approve_standard: false,
        })
        .map_err(boundary)?;
    let claim: Value = serde_json::from_str(
        &engine
            .features_json(PROFILE, r#"{"kind":"conformance"}"#)
            .map_err(boundary)?,
    )
    .map_err(|error| invalid(&format!("invalid_production_metadata:{error}")))?;
    if operation == "meta.claim" {
        return Ok(claim);
    }
    let (input_key, output_key) = match operation {
        "meta.has_capability" => ("capability", "capabilities"),
        "meta.has_profile" => ("profile", "profiles"),
        _ => return Err(invalid("unknown_metadata_operation")),
    };
    let requested = input
        .get(input_key)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("metadata_name_required"))?;
    let supported = claim
        .get(output_key)
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("invalid_production_claim"))?
        .iter()
        .any(|value| value.as_str() == Some(requested));
    Ok(json!({"value":supported}))
}

fn batch(input: &Value) -> Result<Value> {
    let directory = tempfile::tempdir().map_err(|_| invalid("fixture_directory_failed"))?;
    let disk = Arc::new(Disk {
        root: directory.path().to_path_buf(),
        state: Mutex::new(State::default()),
    });
    let mut commands = Vec::new();
    let items = input
        .get("items")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("batch_items_missing"))?;
    for item in items {
        let identity = item
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("batch_item_id_missing"))?;
        let path = format!("tasks/{identity}.md");
        seed_document(
            &disk,
            &path,
            &object(
                &json!({"frontmatter":{"title":identity,"status":"open","priority":"normal","tags":["task"]}}),
                "frontmatter",
            ),
        )?;
        if input
            .get("outcomes")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .any(|outcome| {
                outcome.get("id").and_then(Value::as_str) == Some(identity)
                    && outcome.get("ok") == Some(&Value::Bool(false))
            })
        {
            disk.state
                .lock()
                .map_err(|_| invalid("fixture_gate_failed"))?
                .race_paths
                .insert(path.clone());
        }
        commands.push(Command::Update {
            path,
            expected_revision: None,
            properties: Map::from_iter([("priority".into(), json!("high"))]),
            body: None,
        });
    }
    let database = directory.path().join("runtime.db");
    let database = database
        .to_str()
        .ok_or_else(|| invalid("fixture_database_path"))?;
    let engine = Engine::open(database, disk.clone()).map_err(boundary)?;
    engine
        .register_profile(Profile {
            id: PROFILE.into(),
            name: "Fixture".into(),
            kind: ProfileKind::LocalFolder,
            approve_standard: true,
        })
        .map_err(boundary)?;
    engine.refresh(PROFILE).map_err(boundary)?;
    let mutation = Mutation {
        mutation_id: "partial-fixture".into(),
        at: AT.into(),
        execution_context: None,
        command: Command::BatchPartial { commands },
    };
    let receipt = engine.execute(PROFILE, &mutation).map_err(boundary)?;
    let query = r#"{"kind":"batch_outcome","mutationId":"partial-fixture"}"#;
    let first = engine.features_json(PROFILE, query).map_err(boundary)?;
    let exchanges = disk
        .state
        .lock()
        .map_err(|_| invalid("fixture_gate_failed"))?
        .exchanges;
    drop(engine);
    let reopened = Engine::open(database, disk.clone()).map_err(boundary)?;
    let repeated = reopened.execute(PROFILE, &mutation).map_err(boundary)?;
    assert_eq!(repeated.paths, receipt.paths);
    assert_eq!(
        reopened.features_json(PROFILE, query).map_err(boundary)?,
        first
    );
    assert_eq!(
        disk.state
            .lock()
            .map_err(|_| invalid("fixture_gate_failed"))?
            .exchanges,
        exchanges
    );
    serde_json::from_str(&first).map_err(|_| invalid("fixture_json_failed"))
}

fn fixture_command(
    operation: &str,
    input: &Value,
    path: &str,
    create_check: bool,
    disk: &Disk,
) -> Result<Command> {
    Ok(match operation {
        "op.atomic_write" => {
            if input.get("simulateFailureAfterWrite") == Some(&Value::Bool(true)) {
                disk.state
                    .lock()
                    .map_err(|_| invalid("fixture_gate_failed"))?
                    .fail_staging
                    .insert(path.into());
            }
            let changes = object(input, "patch");
            if changes.len() == 1
                && let Some(status) = changes.get("status").and_then(Value::as_str)
            {
                Command::SetStatus {
                    path: path.into(),
                    expected_revision: None,
                    status: status.into(),
                    occurrence_date: None,
                }
            } else {
                Command::Update {
                    path: path.into(),
                    expected_revision: None,
                    properties: changes,
                    body: None,
                }
            }
        }
        "op.idempotency_check" if create_check => Command::Create {
            path: Some(path.into()),
            properties: object(input, "second"),
            body: None,
        },
        "op.idempotency_check" => Command::SetCompletion {
            path: path.into(),
            expected_revision: None,
            completed: true,
            occurrence_date: None,
        },
        "archive.apply" => Command::Archive {
            path: path.into(),
            expected_revision: None,
            archived: true,
        },
        "delete.remove" => Command::DeleteChecked {
            path: path.into(),
            expected_revision: None,
            check_backlinks: input.get("checkBacklinks") == Some(&Value::Bool(true)),
            force: input.get("force") == Some(&Value::Bool(true)),
        },
        "rename.apply" => Command::RenameReferences {
            path: path.into(),
            new_path: text(input, "toPath").into(),
            expected_revision: None,
            update_references: input.get("updateReferences") == Some(&Value::Bool(true)),
        },
        "rename.title_storage_interaction" => Command::Update {
            path: path.into(),
            expected_revision: None,
            properties: Map::from_iter([("title".into(), json!(text(input, "newTitle")))]),
            body: None,
        },
        _ => return Err(invalid("unsupported_operation")),
    })
}

fn fixture_result(
    operation: &str,
    disk: &Arc<Disk>,
    database: &str,
    path: &str,
    reference: &str,
    engine: Engine,
    mutation: &Mutation,
) -> Result<Value> {
    let result = engine.execute(PROFILE, mutation);
    if operation == "op.atomic_write" {
        let committed = result.as_ref().is_ok_and(|receipt| receipt.applied);
        drop(engine);
        let reopened = Engine::open(database, disk.clone()).map_err(boundary)?;
        let state: Value = serde_json::from_str(
            &reopened
                .features_json(
                    PROFILE,
                    r#"{"kind":"mutation_receipt","mutationId":"fixture-mutation"}"#,
                )
                .map_err(boundary)?,
        )
        .map_err(|_| invalid("fixture_json_failed"))?;
        if committed && state.get("state").and_then(Value::as_str) != Some("applied") {
            return Err(invalid("receipt_not_durable"));
        }
        return Ok(json!({"committed":committed,"persisted":disk.frontmatter(path)?}));
    }
    let receipt = result.map_err(boundary)?;
    if operation == "op.idempotency_check" {
        let before = disk.read_file(PROFILE, path).map_err(boundary)?;
        let exchanges = disk
            .state
            .lock()
            .map_err(|_| invalid("fixture_gate_failed"))?
            .exchanges;
        drop(engine);
        let reopened = Engine::open(database, disk.clone()).map_err(boundary)?;
        let repeated = reopened.execute(PROFILE, mutation).map_err(boundary)?;
        return Ok(
            json!({"idempotent":repeated.applied && repeated.paths==receipt.paths && disk.read_file(PROFILE,path).map_err(boundary)?==before && disk.state.lock().map_err(|_|invalid("fixture_gate_failed"))?.exchanges==exchanges}),
        );
    }
    let deleted = disk.read_file(PROFILE, path).map_err(boundary)?.is_none();
    if operation == "archive.apply" || operation == "delete.remove" {
        return Ok(json!({"deleted":deleted}));
    }
    let mut actual = None;
    for path in &receipt.paths {
        if disk.read_file(PROFILE, path).map_err(boundary)?.is_some() {
            actual = Some(path);
            break;
        }
    }
    let actual = actual.ok_or_else(|| invalid("renamed_file_missing"))?;
    if operation == "rename.apply" {
        let references = disk
            .read_file(PROFILE, "references.md")
            .map_err(boundary)?
            .ok_or_else(|| invalid("references_missing"))?;
        return Ok(json!({"path":actual,"referencesUpdated":references!=reference.as_bytes()}));
    }
    Ok(json!({"path":actual,"renamed":actual!=path,"frontmatter":disk.frontmatter(actual)?}))
}

fn seed_document(disk: &Disk, path: &str, frontmatter: &Map<String, Value>) -> Result<()> {
    let mut frontmatter = frontmatter.clone();
    if frontmatter.contains_key("status") {
        frontmatter.entry("dateCreated").or_insert(json!(AT));
        frontmatter.entry("dateModified").or_insert(json!(AT));
    }
    let document = TaskDocument::parse(VaultPath::parse(path)?, b"")?;
    let edits = frontmatter
        .iter()
        .map(|(key, value)| PropertyEdit::Set {
            key: key.clone(),
            value: value.clone(),
        })
        .collect::<Vec<_>>();
    disk.seed(path, &document.plan(&edits, None)?.bytes)
        .map_err(boundary)
}
fn text<'a>(input: &'a Value, key: &str) -> &'a str {
    input.get(key).and_then(Value::as_str).unwrap_or_default()
}
fn object(input: &Value, key: &str) -> Map<String, Value> {
    input
        .get(key)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default()
}
fn invalid(value: &str) -> VaultError {
    VaultError::Document(value.into())
}
fn host(_: std::io::Error) -> RuntimeError {
    RuntimeError::Host("fixture file operation failed".into())
}
fn boundary(error: RuntimeError) -> VaultError {
    match error {
        RuntimeError::Validation(message) => VaultError::Document(message),
        RuntimeError::Configuration(message) => VaultError::Configuration(message),
        RuntimeError::Conflict => VaultError::Conflict,
        _ => invalid("fixture_runtime_failed"),
    }
}

#[test]
fn configured_creation_template_and_archive_use_the_durable_runtime() -> Result<()> {
    let directory = tempfile::tempdir().map_err(|_| invalid("fixture_directory_failed"))?;
    let disk = Arc::new(Disk {
        root: directory.path().to_path_buf(),
        state: Mutex::new(State::default()),
    });
    disk.seed("tasknotes.yaml",b"title:\n  storage: frontmatter\n  filename_format: custom\n  custom_filename_template: '{status}/{titleKebab}'\ntask_detection:\n  default_folder: Projects\ntemplating:\n  enabled: true\n  template_path: Templates/task.md\n  failure_mode: error_abort\narchive:\n  mode: tag\n  tag: archived\n  move_on_archive: true\n  folder: Done\n").map_err(boundary)?;
    disk.seed("Templates/task.md",b"---\nvendorTicket: ZX-42\nstatus: done\n---\n{{title}} / {{status}} / {{contexts}} / {{details}} / {{time}}\n").map_err(boundary)?;
    let database = directory.path().join("runtime.db");
    let engine = Engine::open(
        database
            .to_str()
            .ok_or_else(|| invalid("fixture_database_path"))?,
        disk.clone(),
    )
    .map_err(boundary)?;
    engine
        .register_profile(Profile {
            id: PROFILE.into(),
            name: "Fixture".into(),
            kind: ProfileKind::LocalFolder,
            approve_standard: false,
        })
        .map_err(boundary)?;
    engine.refresh(PROFILE).map_err(boundary)?;
    let mutation = Mutation {
        mutation_id: "create-template".into(),
        at: AT.into(),
        execution_context: None,
        command: Command::Create {
            path: None,
            properties: json!({"title":"Design API","status":"open","contexts":["work","home"]})
                .as_object()
                .cloned()
                .ok_or_else(|| invalid("fixture_properties"))?,
            body: Some("Capture".into()),
        },
    };
    let receipt = engine.execute(PROFILE, &mutation).map_err(boundary)?;
    assert_eq!(receipt.paths, vec!["Projects/open/design-api.md"]);
    let bytes = disk
        .read_file(PROFILE, "Projects/open/design-api.md")
        .map_err(boundary)?
        .ok_or_else(|| invalid("created_file_missing"))?;
    let document = TaskDocument::parse(VaultPath::parse("Projects/open/design-api.md")?, &bytes)?;
    assert_eq!(document.frontmatter().get("status"), Some(&json!("open")));
    assert_eq!(
        document.frontmatter().get("vendorTicket"),
        Some(&json!("ZX-42"))
    );
    assert_eq!(
        document.body(),
        "Design API / open / work, home / Capture / 10:00\n"
    );
    let archive = Mutation {
        mutation_id: "archive-template".into(),
        at: AT.into(),
        execution_context: None,
        command: Command::Archive {
            path: "Projects/open/design-api.md".into(),
            expected_revision: Some(document.revision().as_str().into()),
            archived: true,
        },
    };
    let receipt = engine.execute(PROFILE, &archive).map_err(boundary)?;
    assert!(receipt.applied);
    assert_eq!(
        disk.read_file(PROFILE, "Projects/open/design-api.md")
            .map_err(boundary)?,
        None
    );
    let archived = disk.frontmatter("Done/design-api.md")?;
    assert_eq!(archived.get("vendorTicket"), Some(&json!("ZX-42")));
    assert!(
        archived
            .get("tags")
            .and_then(Value::as_array)
            .is_some_and(|tags| tags.contains(&json!("archived")) && tags.contains(&json!("task")))
    );
    Ok(())
}
