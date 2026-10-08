//! Durable runtime behavior through the actual `SQLite` adapter and file boundary.

#[path = "runtime_tests/datetime_completion.rs"]
mod datetime_completion;

#[path = "runtime_tests/absolute_reminder_writes.rs"]
mod absolute_reminder_writes;

#[path = "runtime_tests/canonical_writes.rs"]
mod canonical_writes;

#[path = "runtime_tests/native_tracking_capture.rs"]
mod native_tracking_capture;

#[path = "runtime_tests/domain_gap_review.rs"]
mod domain_gap_review;

#[path = "runtime_tests/instances.rs"]
mod instances;

#[path = "runtime_tests/binary_commands.rs"]
mod binary_commands;
#[path = "runtime_tests/bounded_memory.rs"]
mod bounded_memory;
#[path = "runtime_tests/detection.rs"]
mod detection;
#[path = "runtime_tests/downloads.rs"]
mod downloads;
#[path = "runtime_tests/payload_close.rs"]
mod payload_close;
#[path = "runtime_tests/payload_migration.rs"]
mod payload_migration;
#[path = "runtime_tests/payloads.rs"]
mod payloads;
#[path = "runtime_tests/production.rs"]
mod production;
#[path = "runtime_tests/production_review.rs"]
mod production_review;
#[path = "runtime_tests/providers.rs"]
mod providers;
#[path = "runtime_tests/reminder_scalars.rs"]
mod reminder_scalars;
#[path = "runtime_tests/reminders.rs"]
mod reminders;
#[path = "runtime_tests/strict_tasks.rs"]
mod strict_tasks;
#[path = "runtime_tests/temporal_writes.rs"]
mod temporal_writes;
#[path = "runtime_tests/tracking.rs"]
mod tracking;
#[path = "runtime_tests/tracking_schema_review.rs"]
mod tracking_schema_review;
#[path = "runtime_tests/uploads.rs"]
mod uploads;

use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};

struct ReadPause {
    path: String,
    entered: std::sync::mpsc::SyncSender<()>,
    release: std::sync::mpsc::Receiver<()>,
}
#[derive(Default)]
struct GatedMemory {
    inner: Memory,
    pause: Mutex<Option<ReadPause>>,
}
impl GatedMemory {
    fn pause_read(&self, path: &str) -> Result<()> {
        let pause = {
            let mut guard = self
                .pause
                .lock()
                .map_err(|_| RuntimeError::Host("test gate lock failed".to_owned()))?;
            if guard.as_ref().is_some_and(|pause| pause.path == path) {
                guard.take()
            } else {
                None
            }
        };
        if let Some(pause) = pause {
            pause
                .entered
                .send(())
                .map_err(|_| RuntimeError::Host("test gate receiver failed".to_owned()))?;
            pause
                .release
                .recv_timeout(std::time::Duration::from_secs(5))
                .map_err(|_| RuntimeError::Host("test gate did not release".to_owned()))?;
        }
        Ok(())
    }
}
impl VaultFiles for GatedMemory {
    fn open_file_snapshot(
        &self,
        profile: &str,
        path: &str,
    ) -> Result<Option<tasknotes_runtime::types::FileSnapshot>> {
        let snapshot = self.inner.snapshot(profile, path)?;
        self.pause_read(path)?;
        Ok(snapshot)
    }
    fn open_displaced_snapshot(
        &self,
        profile: &str,
        id: &str,
    ) -> Result<tasknotes_runtime::types::FileSnapshot> {
        self.inner.backup_snapshot(profile, id)
    }
    fn read_snapshot_chunk(
        &self,
        profile: &str,
        id: &str,
        offset: u64,
        length: u32,
    ) -> Result<Vec<u8>> {
        self.inner.snapshot_chunk(profile, id, offset, length)
    }
    fn close_snapshot(&self, profile: &str, id: &str) -> Result<()> {
        self.inner.snapshot_close(profile, id)
    }
    fn begin_replacement(
        &self,
        profile: &str,
        operation: &str,
        path: &str,
        expected: Option<&str>,
        size: u64,
        revision: &str,
    ) -> Result<tasknotes_runtime::types::ReplacementStage> {
        self.inner
            .stage_begin(profile, operation, path, expected, size, revision)
    }
    fn write_replacement_chunk(
        &self,
        profile: &str,
        id: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<tasknotes_runtime::types::ReplacementStage> {
        self.inner.stage_write(profile, id, offset, bytes)
    }
    fn seal_replacement(
        &self,
        profile: &str,
        id: &str,
    ) -> Result<tasknotes_runtime::types::ReplacementStage> {
        self.inner.stage_seal(profile, id)
    }
    fn compare_exchange_staged(
        &self,
        profile: &str,
        operation: &str,
        path: &str,
        expected: Option<&str>,
        stage: Option<&str>,
    ) -> Result<tasknotes_runtime::types::StagedExchange> {
        self.inner
            .staged_exchange(profile, operation, path, expected, stage)
    }
    fn discard_replacement(&self, profile: &str, id: &str) -> Result<()> {
        self.inner.stage_discard(profile, id)
    }
    fn list_files(&self, id: &str) -> Result<Vec<String>> {
        self.inner.list_files(id)
    }
    fn read_file(&self, id: &str, path: &str) -> Result<Option<Vec<u8>>> {
        let bytes = self.inner.read_file(id, path)?;
        self.pause_read(path)?;
        Ok(bytes)
    }
    fn compare_exchange(
        &self,
        id: &str,
        path: &str,
        expected: Option<&str>,
        bytes: Option<&[u8]>,
    ) -> Result<FileExchange> {
        self.inner.compare_exchange(id, path, expected, bytes)
    }
    fn displaced_metadata(
        &self,
        id: &str,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Vec<DisplacedMetadata>> {
        self.inner.displaced_metadata(id, after, limit)
    }
    fn read_displaced(&self, id: &str, backup: &str) -> Result<Vec<u8>> {
        self.inner.read_displaced(id, backup)
    }
    fn acknowledge_displaced(&self, id: &str, backup: &str) -> Result<()> {
        self.inner.acknowledge_displaced(id, backup)
    }
}

use serde_json::{Value, json};
use tasknotes_runtime::{
    Result, RuntimeError,
    engine::Engine,
    types::{
        Command, ConflictResolution, DisplacedMetadata, DisplacedVersion, FileExchange, Mutation,
        Profile, ProfileKind, Query, VaultFiles,
    },
};
use tasknotes_vault::document::ContentRevision;

#[derive(Default)]
struct State {
    snapshots: BTreeMap<String, (String, Vec<u8>)>,
    stages: BTreeMap<String, bounded_memory::Stage>,
    outcomes: BTreeMap<String, tasknotes_runtime::types::StagedExchange>,
    snapshot_sequence: u64,
    files: BTreeMap<(String, String), Vec<u8>>,
    backups: BTreeMap<String, (String, DisplacedVersion)>,
    exchanges: u64,
    reads: u64,
    crash_after_exchange: bool,
    racing_bytes: Option<Vec<u8>>,
    racing_before_compare: Option<Vec<u8>>,
    fail_read: Option<String>,
    fail_acknowledgement: bool,
}
#[derive(Default)]
struct Memory {
    state: Mutex<State>,
}
impl Memory {
    fn seed(&self, profile: &str, path: &str, bytes: &[u8]) -> Result<()> {
        self.state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability lock failed".to_owned()))?
            .files
            .insert((profile.to_owned(), path.to_owned()), bytes.to_vec());
        Ok(())
    }
    fn get(&self, profile: &str, path: &str) -> Result<Option<Vec<u8>>> {
        Ok(self
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability lock failed".to_owned()))?
            .files
            .get(&(profile.to_owned(), path.to_owned()))
            .cloned())
    }
}
impl VaultFiles for Memory {
    fn open_file_snapshot(
        &self,
        profile: &str,
        path: &str,
    ) -> Result<Option<tasknotes_runtime::types::FileSnapshot>> {
        self.snapshot(profile, path)
    }
    fn open_displaced_snapshot(
        &self,
        profile: &str,
        id: &str,
    ) -> Result<tasknotes_runtime::types::FileSnapshot> {
        self.backup_snapshot(profile, id)
    }
    fn read_snapshot_chunk(
        &self,
        profile: &str,
        id: &str,
        offset: u64,
        length: u32,
    ) -> Result<Vec<u8>> {
        self.snapshot_chunk(profile, id, offset, length)
    }
    fn close_snapshot(&self, profile: &str, id: &str) -> Result<()> {
        self.snapshot_close(profile, id)
    }
    fn begin_replacement(
        &self,
        profile: &str,
        operation: &str,
        path: &str,
        expected: Option<&str>,
        size: u64,
        revision: &str,
    ) -> Result<tasknotes_runtime::types::ReplacementStage> {
        self.stage_begin(profile, operation, path, expected, size, revision)
    }
    fn write_replacement_chunk(
        &self,
        profile: &str,
        id: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<tasknotes_runtime::types::ReplacementStage> {
        self.stage_write(profile, id, offset, bytes)
    }
    fn seal_replacement(
        &self,
        profile: &str,
        id: &str,
    ) -> Result<tasknotes_runtime::types::ReplacementStage> {
        self.stage_seal(profile, id)
    }
    fn compare_exchange_staged(
        &self,
        profile: &str,
        operation: &str,
        path: &str,
        expected: Option<&str>,
        stage: Option<&str>,
    ) -> Result<tasknotes_runtime::types::StagedExchange> {
        self.staged_exchange(profile, operation, path, expected, stage)
    }
    fn discard_replacement(&self, profile: &str, id: &str) -> Result<()> {
        self.stage_discard(profile, id)
    }
    fn list_files(&self, id: &str) -> Result<Vec<String>> {
        Ok(self
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability lock failed".to_owned()))?
            .files
            .keys()
            .filter(|(profile, _)| profile == id)
            .map(|(_, path)| path.clone())
            .collect())
    }
    fn read_file(&self, id: &str, path: &str) -> Result<Option<Vec<u8>>> {
        self.state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability lock failed".to_owned()))?
            .reads += 1;
        let state = self
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability lock failed".to_owned()))?;
        if state.fail_read.as_deref() == Some(path) {
            return Err(RuntimeError::Host("provider unavailable".to_owned()));
        }
        Ok(state.files.get(&(id.to_owned(), path.to_owned())).cloned())
    }
    fn compare_exchange(
        &self,
        id: &str,
        path: &str,
        expected: Option<&str>,
        replacement: Option<&[u8]>,
    ) -> Result<FileExchange> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability lock failed".to_owned()))?;
        let key = (id.to_owned(), path.to_owned());
        if let Some(race) = state.racing_before_compare.take() {
            state.files.insert(key.clone(), race);
        }
        let revision = state
            .files
            .get(&key)
            .map(|bytes| ContentRevision::of(bytes).as_str().to_owned());
        if revision.as_deref() != expected {
            return Ok(FileExchange {
                applied: false,
                displaced_bytes: None,
                displaced_version_id: None,
            });
        }
        if let Some(race) = state.racing_bytes.take() {
            state.files.insert(key.clone(), race);
        }
        let old = state.files.remove(&key);
        if let Some(bytes) = replacement {
            state.files.insert(key, bytes.to_vec());
        }
        state.exchanges += 1;
        let backup_id = old.as_ref().map(|_| format!("backup-{}", state.exchanges));
        if let (Some(bytes), Some(backup_id)) = (&old, &backup_id) {
            state.backups.insert(
                backup_id.clone(),
                (
                    id.to_owned(),
                    DisplacedVersion {
                        id: backup_id.clone(),
                        path: path.to_owned(),
                        bytes: bytes.clone(),
                    },
                ),
            );
        }
        if state.crash_after_exchange {
            state.crash_after_exchange = false;
            return Err(RuntimeError::Host(
                "interrupted after durable exchange".to_owned(),
            ));
        }
        Ok(FileExchange {
            applied: true,
            displaced_bytes: old,
            displaced_version_id: backup_id,
        })
    }
    fn displaced_metadata(
        &self,
        id: &str,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Vec<DisplacedMetadata>> {
        Ok(self
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability lock failed".to_owned()))?
            .backups
            .values()
            .filter(|(profile, version)| {
                profile == id && after.is_none_or(|after| version.id.as_str() > after)
            })
            .take(
                usize::try_from(limit)
                    .map_err(|_| RuntimeError::Host("invalid page limit".to_owned()))?,
            )
            .map(|(_, version)| DisplacedMetadata {
                id: version.id.clone(),
                path: version.path.clone(),
                size: u64::try_from(version.bytes.len()).unwrap_or(u64::MAX),
                revision: ContentRevision::of(&version.bytes).as_str().to_owned(),
            })
            .collect())
    }
    fn read_displaced(&self, id: &str, backup: &str) -> Result<Vec<u8>> {
        self.state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability lock failed".to_owned()))?
            .backups
            .get(backup)
            .filter(|(profile, _)| profile == id)
            .map(|(_, version)| version.bytes.clone())
            .ok_or(RuntimeError::NotFound)
    }
    fn acknowledge_displaced(&self, id: &str, backup_id: &str) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test capability lock failed".to_owned()))?;
        if state.fail_acknowledgement {
            state.fail_acknowledgement = false;
            return Err(RuntimeError::Host(
                "backup cleanup was interrupted".to_owned(),
            ));
        }
        if state
            .backups
            .get(backup_id)
            .is_some_and(|(profile, _)| profile != id)
        {
            return Err(RuntimeError::Host("wrong backup profile".to_owned()));
        }
        state.backups.remove(backup_id);
        Ok(())
    }
}

fn profile(kind: ProfileKind) -> Profile {
    Profile {
        id: "a".to_owned(),
        name: "Vault".to_owned(),
        kind,
        approve_standard: true,
    }
}
fn mutation(id: &str, command: Command) -> Mutation {
    Mutation {
        mutation_id: id.to_owned(),
        at: "2026-10-03T12:00:00Z".to_owned(),
        execution_context: None,
        command,
    }
}

#[test]
fn explicit_normalization_preview_preserves_unknowns_and_dates_and_undo_restores_bytes()
-> Result<()> {
    let files = Arc::new(Memory::default());
    let original=b"---\ntitle: Legacy\nstatus: open\ntags: [task]\ndate_created: 2026-02-20 10:00:00+00:00\ndue: 2026-02-21\nvendor:\n  ticket: ZX-42\n---\n# Original body\n[[unresolved|Untouched]]\n";
    files.seed("a", "Tasks/legacy.md", original)?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let preview: Value = serde_json::from_str(&engine.features_json(
        "a",
        r#"{"kind":"normalization_preview","path":"Tasks/legacy.md"}"#,
    )?)?;
    assert_eq!(preview.get("changed"), Some(&json!(true)));
    assert_eq!(
        preview
            .get("frontmatter")
            .and_then(|value| value.get("due")),
        Some(&json!("2026-02-21"))
    );
    assert_eq!(files.get("a", "Tasks/legacy.md")?, Some(original.to_vec()));
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test gate failed".to_owned()))?
            .exchanges,
        0
    );
    let request = mutation(
        "normalize",
        Command::Normalize {
            path: "Tasks/legacy.md".to_owned(),
            expected_revision: Some(ContentRevision::of(original).as_str().to_owned()),
        },
    );
    let receipt = engine.execute("a", &request)?;
    assert!(receipt.applied);
    let bytes = files
        .get("a", "Tasks/legacy.md")?
        .ok_or(RuntimeError::NotFound)?;
    let document = tasknotes_vault::document::TaskDocument::parse(
        tasknotes_vault::path::VaultPath::parse("Tasks/legacy.md")?,
        &bytes,
    )?;
    assert_eq!(
        document.frontmatter().get("dateCreated"),
        Some(&json!("2026-02-20T10:00:00Z"))
    );
    assert!(!document.frontmatter().contains_key("date_created"));
    assert_eq!(
        document.frontmatter().get("due"),
        Some(&json!("2026-02-21"))
    );
    assert_eq!(
        document.frontmatter().get("vendor"),
        Some(&json!({"ticket":"ZX-42"}))
    );
    assert_eq!(
        document.body(),
        "# Original body\n[[unresolved|Untouched]]\n"
    );
    let no_op = engine.execute(
        "a",
        &mutation(
            "normalize-again",
            Command::Normalize {
                path: "Tasks/legacy.md".to_owned(),
                expected_revision: Some(document.revision().as_str().to_owned()),
            },
        ),
    )?;
    assert_eq!(no_op.paths, Vec::<String>::new());
    let undone = engine.execute(
        "a",
        &mutation(
            "undo-normalize",
            Command::Undo {
                receipt_id: request.mutation_id,
            },
        ),
    )?;
    assert!(undone.applied);
    assert_eq!(files.get("a", "Tasks/legacy.md")?, Some(original.to_vec()));
    Ok(())
}

#[test]
fn partial_batch_recovers_an_applied_child_before_its_outcome_and_preserves_identity() -> Result<()>
{
    let directory = tempfile::tempdir()
        .map_err(|_| RuntimeError::Storage("test directory unavailable".to_owned()))?;
    let database = directory.path().join("runtime.db");
    let database = database
        .to_str()
        .ok_or_else(|| RuntimeError::Storage("test path is invalid".to_owned()))?;
    let files = Arc::new(Memory::default());
    let engine = Engine::open(database, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let create = |path: &str| Command::Create {
        path: Some(path.to_owned()),
        properties: json!({"title":path,"status":"open"})
            .as_object()
            .cloned()
            .unwrap_or_default(),
        body: None,
    };
    let request = mutation(
        "partial-recovery",
        Command::BatchPartial {
            commands: vec![create("Tasks/a.md"), create("Tasks/b.md")],
        },
    );
    let db = rusqlite::Connection::open(database)?;
    db.execute_batch("CREATE TRIGGER fail_first_outcome BEFORE UPDATE OF outcome ON partial_items WHEN NEW.ordinal=0 BEGIN SELECT RAISE(ABORT,'fault after child receipt before outcome'); END;")?;
    assert!(matches!(
        engine.execute("a", &request),
        Err(RuntimeError::Storage(_))
    ));
    assert!(files.get("a", "Tasks/a.md")?.is_some());
    assert_eq!(files.get("a", "Tasks/b.md")?, None);
    let state: Value = serde_json::from_str(&engine.features_json(
        "a",
        r#"{"kind":"mutation_receipt","mutationId":"partial-recovery"}"#,
    )?)?;
    assert_eq!(state.get("state"), Some(&json!("pending")));
    assert!(matches!(
        engine.remove_profile("a"),
        Err(RuntimeError::Conflict)
    ));
    drop(engine);
    db.execute_batch("DROP TRIGGER fail_first_outcome;")?;
    drop(db);
    let engine = Engine::open(database, files.clone())?;
    let receipt = engine.execute("a", &request)?;
    assert!(receipt.applied);
    assert_eq!(receipt.paths, vec!["Tasks/a.md", "Tasks/b.md"]);
    let count = files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test gate failed".to_owned()))?
        .exchanges;
    assert_eq!(count, 2);
    let outcome: Value = serde_json::from_str(&engine.features_json(
        "a",
        r#"{"kind":"batch_outcome","mutationId":"partial-recovery"}"#,
    )?)?;
    assert_eq!(outcome.get("total"), Some(&json!(2)));
    assert_eq!(outcome.get("succeeded"), Some(&json!(2)));
    assert_eq!(outcome.get("failed"), Some(&json!(0)));
    assert!(
        outcome
            .get("items")
            .and_then(Value::as_array)
            .is_some_and(|items| items.iter().all(|item| item
                .get("receipt")
                .and_then(|receipt| receipt.get("schemaVersion"))
                == Some(&json!(1))))
    );
    assert_eq!(engine.execute("a", &request)?.paths, receipt.paths);
    let mut changed = request.clone();
    changed.at = "2026-10-03T12:00:01Z".to_owned();
    assert!(matches!(
        engine.execute("a", &changed),
        Err(RuntimeError::Validation(_))
    ));
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test gate failed".to_owned()))?
            .exchanges,
        count
    );
    Ok(())
}
#[test]
fn partial_batch_contract_rejects_nested_and_unknown_fields() -> Result<()> {
    let empty: Command = serde_json::from_value(json!({"kind":"batch_partial","commands":[]}))?;
    empty.validate_contract()?;
    for command in [
        json!({"kind":"batch_partial","commands":[],"unexpected":true}),
        json!({"kind":"normalize","path":"Tasks/a.md","unexpected":true}),
    ] {
        assert!(serde_json::from_value::<Command>(command).is_err());
    }
    for child in [
        json!({"kind":"batch_partial","commands":[]}),
        json!({"kind":"undo","receiptId":"earlier"}),
    ] {
        let request: Command =
            serde_json::from_value(json!({"kind":"batch_partial","commands":[child]}))?;
        assert!(matches!(
            request.validate_contract(),
            Err(RuntimeError::Validation(_))
        ));
    }
    let oversized = Command::BatchPartial {
        commands: vec![create(); 1001],
    };
    assert!(matches!(
        oversized.validate_contract(),
        Err(RuntimeError::Validation(_))
    ));
    Ok(())
}

fn create() -> Command {
    Command::Create {
        path: Some("Tasks/a.md".to_owned()),
        properties: serde_json::Map::from_iter([
            ("title".to_owned(), json!("First")),
            ("vendor".to_owned(), json!("001")),
        ]),
        body: Some("Body\n".to_owned()),
    }
}

#[test]
fn invalid_remote_metadata_and_mismatched_hashes_fail_before_any_file_io()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    let mut invalid = Vec::new();
    for (key, value) in [
        ("uid", json!(0)),
        ("contentHash", json!("xyz")),
        ("contentHash", json!("a".repeat(64))),
        ("relatedPath", json!("../escape.bin")),
        ("ctime", json!(u64::MAX)),
        ("schemaVersion", json!(2)),
    ] {
        let mut metadata = json!({"schemaVersion":1,"uid":5,"ctime":1,"mtime":2});
        metadata[key] = value;
        invalid.push(metadata.to_string());
    }
    invalid.extend([
        "00".to_owned(),
        r#"{"schemaVersion":1.0000000000000000001,"uid":5,"ctime":1,"mtime":2}"#.to_owned(),
        r#"{"schemaVersion":1,"uid":9007199254740993.1,"ctime":1,"mtime":2}"#.to_owned(),
    ]);
    let baseline = {
        let state = files.state.lock().unwrap();
        (state.reads, state.exchanges)
    };
    for metadata in invalid {
        assert!(
            matches!(
                engine.ingest_remote("a", "asset.bin", Some(b"authenticated bytes"), &metadata),
                Err(RuntimeError::Validation(_))
            ),
            "accepted {metadata}"
        );
        let state = files.state.lock().unwrap();
        assert_eq!((state.reads, state.exchanges), baseline);
    }
    let hash = ContentRevision::of(b"").as_str().to_owned();
    let metadata = json!({"schemaVersion":1,"uid":5,"ctime":1,"mtime":2,"contentHash":hash});
    engine.ingest_remote("a", "empty.bin", Some(b""), &metadata.to_string())?;
    assert_eq!(files.get("a", "empty.bin")?, Some(Vec::new()));
    assert!(matches!(
        engine.ingest_remote("a", "empty.bin", None, &metadata.to_string()),
        Err(RuntimeError::Validation(_))
    ));
    assert!(engine.pending_upload_metadata("a")?.is_empty());
    Ok(())
}

#[test]
fn snapshot_projects_configured_dependencies_occurrences_time_and_all_pending_paths()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    files.seed("a", "tasknotes.yaml", b"title:\n  storage: frontmatter\n")?;
    files.seed("a","Tasks/parent.md",b"---\nid: parent\ntitle: Parent\nstatus: open\npriority: normal\ntags: [task]\nscheduled: 2026-10-03\nrecurrence: 'DTSTART:20261003;FREQ=DAILY'\ncompleteInstances: ['2026-10-03']\ntimeEntries:\n  - startTime: 2026-10-03T10:00:00Z\n    endTime: 2026-10-03T10:00:31Z\n  - startTime: 2026-10-03T12:00:00Z\n---\n")?;
    files.seed("a","Tasks/dependent.md",b"---\ntitle: Dependent\nstatus: open\npriority: normal\ntags: [task]\nblockedBy:\n  - uid: '[[parent]]'\n    reltype: FINISHTOSTART\n---\n")?;
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    let all = engine.snapshot("a", &Query::default())?;
    let parent = all
        .tasks
        .iter()
        .find(|task| task.path.ends_with("parent.md"))
        .unwrap();
    assert!(parent.is_recurring && parent.is_blocking && parent.has_active_time_session);
    assert_eq!(parent.total_tracked_minutes, 1);
    assert!(
        all.tasks
            .iter()
            .find(|task| task.path.ends_with("dependent.md"))
            .unwrap()
            .is_blocked
    );
    let today = engine.snapshot(
        "a",
        &serde_json::from_value(
            json!({"scope":"today","today":"2026-10-03","at":"2026-10-03T12:00:31Z"}),
        )?,
    )?;
    assert_eq!(today.total_count, 1);
    let task = today.tasks.first().unwrap();
    assert!(task.completed && task.is_blocking);
    assert_eq!(task.occurrence_date.as_deref(), Some("2026-10-03"));
    assert_eq!(task.total_tracked_minutes, 2);
    let inbox = engine.snapshot("a", &serde_json::from_value(json!({"scope":"inbox"}))?)?;
    assert_eq!(inbox.total_count, 1);
    assert_eq!(inbox.tasks.first().unwrap().title, "Dependent");
    engine.execute("a", &mutation("one", create()))?;
    let mut second = create();
    if let Command::Create { path, .. } = &mut second {
        *path = Some("Tasks/b.md".to_owned());
    }
    engine.execute("a", &mutation("two", second))?;
    let snapshot = engine.snapshot("a", &Query::default())?;
    assert_eq!(snapshot.pending_task_ids, vec!["Tasks/a.md", "Tasks/b.md"]);
    assert_eq!(
        snapshot.tasks.iter().filter(|task| task.is_pending).count(),
        2
    );
    let head = engine.pending_upload_metadata("a")?;
    assert_eq!(head.len(), 1);
    assert!(head.first().unwrap().bytes.is_none());
    Ok(())
}

#[test]
fn attachment_journals_conflicts_and_upload_lists_keep_payloads_in_blob_rows()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("binary.sqlite");
    let files = Arc::new(Memory::default());
    let engine = Engine::open(path.to_str().unwrap(), files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    let base = vec![0xff; 8 * 1024 * 1024];
    engine.ingest_remote("a", "asset.bin", Some(&base), "1")?;
    let local = vec![0xfe; base.len()];
    files.seed("a", "asset.bin", &local)?;
    let remote = vec![0xfd; base.len()];
    engine.ingest_remote("a", "asset.bin", Some(&remote), "2")?;
    let metadata = engine.conflict_metadata("a", None, 128)?;
    assert_eq!(metadata.len(), 1);
    assert!(serde_json::to_string(&metadata)?.len() < 2048);
    let id = metadata.first().unwrap()["id"].as_str().unwrap();
    assert_eq!(metadata.first().unwrap()["local"]["size"], base.len());
    assert_eq!(
        engine.read_conflict_payload("a", id, "local")?,
        Some(local.clone())
    );
    engine.resolve_conflict("a", id, ConflictResolution::KeepLocal {})?;
    let head = engine.pending_upload_metadata("a")?.remove(0);
    assert_eq!(head.payload_size, u64::try_from(local.len())?);
    assert!(!head.deleted);
    assert!(serde_json::to_string(&head)?.len() < 2048);
    assert_eq!(
        engine.read_upload_payload("a", &head.mutation_id, &head.path)?,
        Some(local)
    );
    drop(engine);
    let db = rusqlite::Connection::open(path)?;
    let (json,blob):(i64,i64)=db.query_row("SELECT max(length(writes)),sum((SELECT size FROM transfer_payloads WHERE profile=journal_files.profile AND id=journal_files.bytes)) FROM journals JOIN journal_files USING(profile,id)",[],|row|Ok((row.get(0)?,row.get(1)?)))?;
    assert_eq!(json, 2);
    assert!(blob >= i64::try_from(base.len() * 3)?);
    Ok(())
}
fn update(status: &str) -> Command {
    Command::SetStatus {
        path: "Tasks/a.md".to_owned(),
        expected_revision: None,
        status: status.to_owned(),
        occurrence_date: None,
    }
}

#[test]
fn durable_task_commands_are_idempotent_and_preserve_unknown_properties()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let dir = tempfile::tempdir()?;
    let files = Arc::new(Memory::default());
    let db = dir.path().join("state.sqlite");
    let engine = Engine::open(db.to_str().unwrap(), files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let command = mutation("create", create());
    let first = engine.execute("a", &command)?;
    let duplicate = engine.execute("a", &command)?;
    assert_eq!(first.paths, duplicate.paths);
    assert_eq!(files.state.lock().unwrap().exchanges, 1);
    engine.execute("a", &mutation("complete", update("done")))?;
    let snapshot = engine.snapshot("a", &Query::default())?;
    assert_eq!(snapshot.tasks.len(), 1);
    let task = snapshot.tasks.first().unwrap();
    assert_eq!(task.properties.get("vendor"), Some(&json!("001")));
    assert_eq!(task.body, "Body\n");
    assert!(task.completed);
    assert_eq!(snapshot.pending_count, 0);
    assert!(
        engine
            .execute("a", &mutation("create", update("open")))
            .is_err()
    );
    drop(engine);
    let restored = Engine::open(db.to_str().unwrap(), files)?;
    assert_eq!(
        restored
            .snapshot("a", &Query::default())?
            .tasks
            .first()
            .unwrap()
            .status,
        "done"
    );
    Ok(())
}

#[test]
fn crash_between_file_exchange_and_index_commit_recovers_without_losing_backup()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let dir = tempfile::tempdir()?;
    let files = Arc::new(Memory::default());
    let db = dir.path().join("state.sqlite");
    let engine = Engine::open(db.to_str().unwrap(), files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("create", create()))?;
    files.state.lock().unwrap().crash_after_exchange = true;
    assert!(
        engine
            .execute("a", &mutation("complete", update("done")))
            .is_err()
    );
    assert_eq!(files.state.lock().unwrap().backups.len(), 1);
    drop(engine);
    let restored = Engine::open(db.to_str().unwrap(), files.clone())?;
    let snapshot = restored.refresh("a")?;
    assert_eq!(snapshot.tasks.first().unwrap().status, "done");
    assert!(files.state.lock().unwrap().backups.is_empty());
    assert_eq!(snapshot.conflict_count, 0);
    Ok(())
}

#[test]
fn retrying_the_same_mutation_after_exchange_crash_returns_the_recovered_receipt()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let dir = tempfile::tempdir()?;
    let files = Arc::new(Memory::default());
    let db = dir.path().join("state.sqlite");
    let engine = Engine::open(db.to_str().unwrap(), files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("create", create()))?;
    let command = mutation("complete", update("done"));
    files.state.lock().unwrap().crash_after_exchange = true;
    assert!(matches!(
        engine.execute("a", &command),
        Err(RuntimeError::Host(_))
    ));
    drop(engine);

    let restored = Engine::open(db.to_str().unwrap(), files.clone())?;
    let recovered = restored.execute("a", &command)?;
    assert!(recovered.applied);
    assert_eq!(recovered.mutation_id, "complete");
    assert_eq!(recovered.paths, vec!["Tasks/a.md"]);
    assert_eq!(files.state.lock().unwrap().exchanges, 2);
    assert!(files.state.lock().unwrap().backups.is_empty());
    let repeated = restored.execute("a", &command)?;
    assert_eq!(
        serde_json::to_value(recovered)?,
        serde_json::to_value(repeated)?
    );
    assert_eq!(files.state.lock().unwrap().exchanges, 2);
    assert!(matches!(
        restored.execute("a", &mutation("complete", update("open"))),
        Err(RuntimeError::Validation(_))
    ));
    Ok(())
}

#[test]
fn an_uncooperative_external_write_is_retained_and_uploads_are_paused()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("create", create()))?;
    let raced =
        b"---\ntitle: External\nstatus: open\npriority: high\ntags: [task]\n---\nExternal body\n"
            .to_vec();
    files.state.lock().unwrap().racing_bytes = Some(raced.clone());
    assert!(matches!(
        engine.execute("a", &mutation("complete", update("done"))),
        Err(RuntimeError::Conflict)
    ));
    let conflicts = engine.conflicts("a")?;
    assert_eq!(conflicts.len(), 1);
    assert_eq!(conflicts.first().unwrap().remote, Some(raced));
    assert!(engine.pending_uploads("a")?.is_empty());
    assert!(matches!(
        engine.remove_profile("a"),
        Err(RuntimeError::Conflict)
    ));
    assert!(files.state.lock().unwrap().backups.is_empty());
    Ok(())
}

#[test]
fn upload_acknowledgements_do_not_replace_newer_local_edits()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("create", create()))?;
    let first = engine.pending_uploads("a")?.first().unwrap().clone();
    engine.execute("a", &mutation("complete", update("done")))?;
    engine.acknowledge_upload("a", &first.mutation_id, "10")?;
    let snapshot = engine.snapshot("a", &Query::default())?;
    assert_eq!(snapshot.tasks.first().unwrap().status, "done");
    assert_eq!(snapshot.pending_count, 1);
    assert_eq!(
        engine.pending_uploads("a")?.first().unwrap().bytes,
        files.get("a", "Tasks/a.md")?
    );
    Ok(())
}

#[test]
fn overlapping_remote_edits_preserve_both_versions_and_resolve_durably()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    files.seed("a", "tasknotes.yaml", b"title:\n  storage: frontmatter\n")?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    let base = b"---\ntitle: A\nstatus: open\npriority: normal\ntags: [task]\ndateCreated: 2026-01-01T00:00:00Z\n---\nbase\n".to_vec();
    engine.ingest_remote("a", "Tasks/a.md", Some(base).as_deref(), "1")?;
    engine.execute(
        "a",
        &mutation(
            "local",
            Command::Update {
                path: "Tasks/a.md".to_owned(),
                expected_revision: None,
                properties: json!({"title":"Local"}).as_object().unwrap().clone(),
                body: None,
            },
        ),
    )?;
    let remote =
        b"---\ntitle: Remote\nstatus: open\npriority: normal\ntags: [task]\ndateCreated: 2026-01-01T00:00:00Z\n---\nbase\n".to_vec();
    engine.ingest_remote("a", "Tasks/a.md", Some(remote.clone()).as_deref(), "2")?;
    let conflict = engine.conflicts("a")?.first().unwrap().clone();
    assert_eq!(files.get("a", "Tasks/a.md")?, Some(remote));
    assert!(engine.pending_uploads("a")?.is_empty());
    engine.resolve_conflict("a", &conflict.id, ConflictResolution::KeepLocal {})?;
    assert!(engine.conflicts("a")?.is_empty());
    assert_eq!(files.get("a", "Tasks/a.md")?, conflict.local);
    assert_eq!(engine.pending_uploads("a")?.len(), 1);
    Ok(())
}

fn seed_binary_conflict(
    engine: &Engine,
    files: &Memory,
) -> Result<tasknotes_runtime::types::Conflict> {
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    engine.ingest_remote("a", "asset.bin", Some(b"base"), "1")?;
    files.seed("a", "asset.bin", b"local")?;
    engine.ingest_remote("a", "asset.bin", Some(b"remote"), "2")?;
    engine
        .conflicts("a")?
        .into_iter()
        .next()
        .ok_or(RuntimeError::NotFound)
}

#[test]
fn resolution_compare_exchange_race_preserves_original_and_competing_versions()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    let original = seed_binary_conflict(&engine, &files)?;
    files.state.lock().unwrap().racing_before_compare = Some(b"external latest".to_vec());
    assert!(matches!(
        engine.resolve_conflict("a", &original.id, ConflictResolution::KeepLocal {}),
        Err(RuntimeError::Conflict)
    ));
    let conflicts = engine.conflicts("a")?;
    let retained = conflicts
        .iter()
        .find(|item| item.id == original.id)
        .unwrap();
    assert_eq!(retained.base, original.base);
    assert_eq!(retained.local, original.local);
    assert_eq!(retained.remote, original.remote);
    assert!(conflicts.iter().any(|item| {
        item.id != original.id && item.remote.as_deref() == Some(b"external latest")
    }));
    assert_eq!(
        files.get("a", "asset.bin")?,
        Some(b"external latest".to_vec())
    );
    assert!(engine.pending_uploads("a")?.is_empty());
    Ok(())
}

#[test]
fn resolution_receipt_and_inbox_cleanup_commit_atomically_and_replay_immutably()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("resolution.sqlite");
    let files = Arc::new(Memory::default());
    let engine = Engine::open(path.to_str().unwrap(), files.clone())?;
    let original = seed_binary_conflict(&engine, &files)?;
    let database = rusqlite::Connection::open(&path)?;
    database.execute_batch(
        "CREATE TRIGGER interrupt_resolution_cleanup BEFORE DELETE ON conflicts
         BEGIN SELECT RAISE(ABORT,'interrupted resolution cleanup'); END;",
    )?;
    assert!(matches!(
        engine.resolve_conflict("a", &original.id, ConflictResolution::KeepLocal {}),
        Err(RuntimeError::Storage(_))
    ));
    let journal_id = format!("resolve:{}", original.id);
    let committed: Option<String> = database.query_row(
        "SELECT receipt FROM journals WHERE profile='a' AND id=?",
        [&journal_id],
        |row| row.get(0),
    )?;
    assert!(
        committed.is_none(),
        "receipt cannot commit before inbox cleanup"
    );
    assert_eq!(files.get("a", "asset.bin")?, original.local);
    assert_eq!(engine.conflicts("a")?.len(), 1);
    drop(engine);
    database.execute_batch("DROP TRIGGER interrupt_resolution_cleanup;")?;
    let restored = Engine::open(path.to_str().unwrap(), files.clone())?;
    assert!(matches!(
        restored.resolve_conflict("a", &original.id, ConflictResolution::KeepRemote {}),
        Err(RuntimeError::Validation(_))
    ));
    let retained: Option<String> = database.query_row(
        "SELECT receipt FROM journals WHERE profile='a' AND id=?",
        [&journal_id],
        |row| row.get(0),
    )?;
    assert_eq!(retained, committed);
    assert_eq!(files.get("a", "asset.bin")?, original.local);
    let receipt = restored.resolve_conflict("a", &original.id, ConflictResolution::KeepLocal {})?;
    assert!(receipt.applied);
    assert!(restored.conflicts("a")?.is_empty());
    let version = restored.snapshot("a", &Query::default())?.version;
    let replay = restored.resolve_conflict("a", &original.id, ConflictResolution::KeepLocal {})?;
    assert_eq!(
        serde_json::to_value(replay)?,
        serde_json::to_value(receipt)?
    );
    assert_eq!(restored.snapshot("a", &Query::default())?.version, version);
    let preserved: (Vec<u8>, Vec<u8>, Vec<u8>) = database.query_row(
        "SELECT (SELECT bytes FROM transfer_payloads WHERE profile=conflict_archive.profile AND id=conflict_archive.base),(SELECT bytes FROM transfer_payloads WHERE profile=conflict_archive.profile AND id=conflict_archive.local),(SELECT bytes FROM transfer_payloads WHERE profile=conflict_archive.profile AND id=conflict_archive.remote) FROM conflict_archive WHERE profile='a' AND journal_id=?",
        [journal_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    assert_eq!(
        preserved,
        (b"base".to_vec(), b"local".to_vec(), b"remote".to_vec())
    );
    Ok(())
}

#[test]
fn unconfigured_private_replica_exposes_waiting_state_and_accepts_remote_settings()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    let mut selected = profile(ProfileKind::ObsidianSync);
    selected.approve_standard = false;
    engine.register_profile(selected)?;
    let discovery: Value = serde_json::from_str(
        &engine.features_json("a", r#"{"schemaVersion":1,"kind":"discovery"}"#)?,
    )?;
    assert_eq!(discovery["configurationAvailable"], false);
    assert_eq!(discovery["initialSyncComplete"], false);
    assert!(matches!(
        engine.execute("a", &mutation("early-create", create())),
        Err(RuntimeError::Configuration(_))
    ));
    let waiting = engine.refresh("a")?;
    assert!(waiting.tasks.is_empty());
    assert!(waiting.configuration.is_null());
    assert!(!waiting.problems.is_empty());
    let task = b"---\ntitle: Remote task\nstatus: open\ntags: [task]\n---\nbody\n";
    engine.ingest_remote("a", "Tasks/remote.md", Some(task), "1")?;
    let unindexed = engine.snapshot("a", &Query::default())?;
    assert!(unindexed.tasks.is_empty());
    assert!(unindexed.configuration.is_null());
    engine.ingest_remote(
        "a",
        ".obsidian/plugins/tasknotes/data.json",
        Some(
            br#"{"taskIdentificationMethod":"tag","taskTag":"task","storeTitleInFilename":false}"#,
        ),
        "2",
    )?;
    let configured = engine.snapshot("a", &Query::default())?;
    assert_eq!(configured.tasks.len(), 1);
    assert!(!configured.configuration.is_null());
    assert_eq!(configured.tasks.first().unwrap().title, "Remote task");
    Ok(())
}

#[test]
fn related_path_remote_rename_applies_both_paths_through_one_ingest()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    let bytes = b"remote attachment";
    engine.ingest_remote("a", "Attachments/old.bin", Some(bytes), "1")?;
    let metadata = json!({
        "schemaVersion":1,"uid":2,"ctime":1000,"mtime":2000,
        "relatedPath":"Attachments/old.bin","contentHash":ContentRevision::of(bytes).as_str()
    });
    engine.ingest_remote(
        "a",
        "Attachments/new.bin",
        Some(bytes),
        &metadata.to_string(),
    )?;
    assert_eq!(files.get("a", "Attachments/old.bin")?, None);
    assert_eq!(files.get("a", "Attachments/new.bin")?, Some(bytes.to_vec()));
    assert!(engine.conflicts("a")?.is_empty());
    assert!(engine.pending_uploads("a")?.is_empty());
    Ok(())
}

fn resolution_mutation(
    id: &str,
    conflict: &tasknotes_runtime::types::Conflict,
    resolution: tasknotes_runtime::types::ResolutionChoice,
) -> Mutation {
    let revision =
        |bytes: Option<&[u8]>| bytes.map(|bytes| ContentRevision::of(bytes).as_str().to_owned());
    mutation(
        id,
        Command::ResolveConflict {
            conflict_id: conflict.id.clone(),
            expected_revisions: tasknotes_runtime::types::ConflictRevisions {
                base: revision(conflict.base.as_deref()),
                local: revision(conflict.local.as_deref()),
                remote: revision(conflict.remote.as_deref()),
                current: revision(conflict.remote.as_deref()),
            },
            resolution,
        },
    )
}

fn receipt_state(engine: &Engine, id: &str) -> Result<Value> {
    Ok(serde_json::from_str(&engine.features_json(
        "a",
        &json!({"schemaVersion":1,"kind":"mutation_receipt","mutationId":id}).to_string(),
    )?)?)
}

#[test]
fn typed_resolution_replays_after_commit_and_rejects_changed_binary_identity_before_io()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    let conflict = seed_binary_conflict(&engine, &files)?;
    assert_eq!(receipt_state(&engine, "replace")?["state"], "absent");
    let decision = resolution_mutation(
        "replace",
        &conflict,
        tasknotes_runtime::types::ResolutionChoice::ReplacePayload { deleted: false },
    );
    let baseline = files.state.lock().unwrap().reads;
    assert!(matches!(
        engine.execute("a", &decision),
        Err(RuntimeError::Validation(_))
    ));
    assert_eq!(files.state.lock().unwrap().reads, baseline);
    files.state.lock().unwrap().fail_acknowledgement = true;
    let receipt =
        engine.execute_with_payload("a", &decision, Some(b"reviewed replacement".to_vec()))?;
    assert!(receipt.applied && receipt.cleanup_pending);
    assert!(engine.conflicts("a")?.is_empty());
    assert_eq!(receipt_state(&engine, "replace")?["state"], "applied");
    let reads = files.state.lock().unwrap().reads;
    let replay =
        engine.execute_with_payload("a", &decision, Some(b"reviewed replacement".to_vec()))?;
    assert!(!replay.cleanup_pending);
    assert!(files.state.lock().unwrap().backups.is_empty());
    let mut durable_fields = serde_json::to_value(receipt)?;
    durable_fields["cleanupPending"] = Value::Bool(false);
    assert_eq!(serde_json::to_value(replay)?, durable_fields);
    assert!(matches!(
        engine.execute_with_payload("a", &decision, Some(b"different replacement".to_vec())),
        Err(RuntimeError::Validation(_))
    ));
    assert_eq!(files.state.lock().unwrap().reads, reads);
    let history: Value = serde_json::from_str(&engine.features_json(
        "a",
        r#"{"kind":"resolution_history","mutationId":"replace"}"#,
    )?)?;
    assert_eq!(history["originalConflictId"], conflict.id);
    assert_eq!(
        engine.read_conflict_payload("a", history["conflict"]["id"].as_str().unwrap(), "local")?,
        conflict.local
    );
    let upload = engine.pending_upload_metadata("a")?.remove(0);
    assert_eq!(
        upload.mtime,
        Some(u64::try_from(
            chrono::DateTime::parse_from_rfc3339(&decision.at)?.timestamp_millis()
        )?)
    );
    Ok(())
}

#[test]
fn interrupted_keep_both_recovers_two_paths_and_undo_restores_preserved_conflict()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("both.sqlite");
    let files = Arc::new(Memory::default());
    let engine = Engine::open(path.to_str().unwrap(), files.clone())?;
    let conflict = seed_binary_conflict(&engine, &files)?;
    let decision = resolution_mutation(
        "both",
        &conflict,
        tasknotes_runtime::types::ResolutionChoice::KeepBoth {
            new_path: "retained.bin".to_owned(),
        },
    );
    files.state.lock().unwrap().crash_after_exchange = true;
    assert!(matches!(
        engine.execute("a", &decision),
        Err(RuntimeError::Host(_))
    ));
    assert_eq!(receipt_state(&engine, "both")?["state"], "pending");
    assert_eq!(files.get("a", "retained.bin")?, conflict.local);
    assert_eq!(files.get("a", "asset.bin")?, conflict.remote);
    drop(engine);
    let restored = Engine::open(path.to_str().unwrap(), files.clone())?;
    let receipt = restored.execute("a", &decision)?;
    assert!(receipt.applied);
    assert_eq!(restored.pending_upload_metadata("a")?.len(), 1);
    assert!(restored.conflicts("a")?.is_empty());
    restored.execute(
        "a",
        &mutation(
            "undo-both",
            Command::Undo {
                receipt_id: "both".to_owned(),
            },
        ),
    )?;
    assert_eq!(files.get("a", "retained.bin")?, None);
    assert_eq!(files.get("a", "asset.bin")?, conflict.remote);
    let restored_conflict = restored.conflicts("a")?.remove(0);
    assert_eq!(restored_conflict.base, conflict.base);
    assert_eq!(restored_conflict.local, conflict.local);
    assert_eq!(restored_conflict.remote, conflict.remote);
    assert_eq!(receipt_state(&restored, "both")?["state"], "applied");
    assert_eq!(
        restored.read_conflict_payload("a", "archive:both", "base")?,
        conflict.base
    );
    Ok(())
}

#[test]
fn remote_receipt_base_uid_metadata_and_merged_outbox_commit_together_after_interruption()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("remote.sqlite");
    let files = Arc::new(Memory::default());
    files.seed("a", "tasknotes.yaml", b"title:\n  storage: frontmatter\n")?;
    let engine = Engine::open(path.to_str().unwrap(), files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    let base = b"---\ntitle: A\npriority: normal\nstatus: open\ntags: [task]\ndateCreated: 2026-01-01T00:00:00Z\n---\nbody\n";
    engine.ingest_remote("a", "Tasks/a.md", Some(base), "1")?;
    engine.execute(
        "a",
        &mutation(
            "local",
            Command::Update {
                path: "Tasks/a.md".to_owned(),
                expected_revision: None,
                properties: json!({"title":"Local"}).as_object().unwrap().clone(),
                body: None,
            },
        ),
    )?;
    let remote = b"---\ntitle: A\npriority: high\nstatus: open\ntags: [task]\ndateCreated: 2026-01-01T00:00:00Z\n---\nbody\n";
    let metadata=json!({"schemaVersion":1,"uid":2,"ctime":1000,"mtime":9999,"relatedPath":null,"contentHash":ContentRevision::of(remote).as_str()}).to_string();
    let db = rusqlite::Connection::open(&path)?;
    db.execute_batch("CREATE TRIGGER interrupt_remote_effect BEFORE UPDATE OF remote_revision ON files WHEN NEW.remote_revision='2' BEGIN SELECT RAISE(ABORT,'remote metadata interruption'); END;")?;
    assert!(matches!(
        engine.ingest_remote("a", "Tasks/a.md", Some(remote), &metadata),
        Err(RuntimeError::Storage(_))
    ));
    let before:(Option<String>,String,Vec<u8>)=db.query_row("SELECT journals.receipt,files.remote_revision,(SELECT bytes FROM transfer_payloads WHERE profile=files.profile AND id=files.base) FROM journals JOIN files ON files.profile=journals.profile WHERE journals.id='remote:2:Tasks/a.md' AND files.path='Tasks/a.md'",[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?)))?;
    assert!(before.0.is_none());
    assert_eq!(before.1, "1");
    assert_eq!(before.2, base);
    assert_eq!(
        engine.pending_upload_metadata("a")?.remove(0).mutation_id,
        "local:0"
    );
    drop(engine);
    db.execute_batch("DROP TRIGGER interrupt_remote_effect;")?;
    let restored = Engine::open(path.to_str().unwrap(), files.clone())?;
    restored.ingest_remote("a", "Tasks/a.md", Some(remote), &metadata)?;
    let committed:(String,Vec<u8>,i64,i64)=db.query_row("SELECT remote_revision,(SELECT bytes FROM transfer_payloads WHERE profile=files.profile AND id=files.base),created_ms,modified_ms FROM files WHERE profile='a' AND path='Tasks/a.md'",[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)))?;
    assert_eq!(committed, ("2".to_owned(), remote.to_vec(), 1000, 9999));
    let task = restored.snapshot("a", &Query::default())?.tasks.remove(0);
    assert_eq!(
        (task.title.as_str(), task.priority.as_str()),
        ("Local", "high")
    );
    assert!(restored.conflicts("a")?.is_empty());
    let upload = restored.pending_upload_metadata("a")?.remove(0);
    assert_eq!(upload.expected_remote_revision.as_deref(), Some("2"));
    assert_eq!((upload.ctime, upload.mtime), (Some(1000), Some(9999)));
    let reads = files.state.lock().unwrap().reads;
    restored.ingest_remote("a", "Tasks/a.md", Some(remote), &metadata)?;
    assert_eq!(files.state.lock().unwrap().reads, reads);
    assert!(matches!(
        restored.ingest_remote("a", "Tasks/a.md", Some(b"changed same uid"), "2"),
        Err(RuntimeError::Validation(_))
    ));
    Ok(())
}

#[test]
fn interrupted_remote_rename_preserves_a_newer_source_and_parks_both_paths()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("rename.sqlite");
    let files = Arc::new(Memory::default());
    let engine = Engine::open(path.to_str().unwrap(), files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    engine.ingest_remote("a", "old.bin", Some(b"base"), "1")?;
    files.seed("a", "old.bin", b"local before rename")?;
    let remote = b"remote renamed";
    let metadata=json!({"schemaVersion":1,"uid":2,"ctime":1000,"mtime":2000,"relatedPath":"old.bin","contentHash":ContentRevision::of(remote).as_str()}).to_string();
    files.state.lock().unwrap().crash_after_exchange = true;
    assert!(matches!(
        engine.ingest_remote("a", "new.bin", Some(remote), &metadata),
        Err(RuntimeError::Host(_))
    ));
    files.seed("a", "old.bin", b"latest after interrupted rename")?;
    drop(engine);
    let restored = Engine::open(path.to_str().unwrap(), files.clone())?;
    restored.ingest_remote("a", "new.bin", Some(remote), &metadata)?;
    assert_eq!(
        files.get("a", "old.bin")?,
        Some(b"latest after interrupted rename".to_vec())
    );
    assert_eq!(files.get("a", "new.bin")?, Some(remote.to_vec()));
    let conflicts = restored.conflicts("a")?;
    assert!(
        conflicts
            .iter()
            .any(|conflict| conflict.local.as_deref() == Some(b"local before rename"))
    );
    assert!(
        conflicts
            .iter()
            .any(|conflict| conflict.remote.as_deref() == Some(b"latest after interrupted rename"))
    );
    assert_eq!(
        receipt_state(&restored, "remote:2:new.bin")?["state"],
        "parked"
    );
    Ok(())
}

#[test]
fn initial_sync_retains_tasks_before_configuration_and_rebuilds_custom_mapping()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    let mut configured = profile(ProfileKind::ObsidianSync);
    configured.approve_standard = false;
    engine.register_profile(configured)?;
    let task = b"---\nheadline: Mapped\nstatus: open\npriority: normal\ntags: [task]\n---\nbody\n"
        .to_vec();
    engine.ingest_remote("a", "Tasks/a.md", Some(task.clone()).as_deref(), "1")?;
    assert_eq!(files.get("a", "Tasks/a.md")?, Some(task));
    engine.ingest_remote(
        "a",
        ".obsidian/plugins/tasknotes/data.json",
        Some(br#"{"fieldMapping":{"title":"headline"},"storeTitleInFilename":false}"#.to_vec())
            .as_deref(),
        "2",
    )?;
    let snapshot = engine.snapshot("a", &Query::default())?;
    assert_eq!(snapshot.tasks.first().unwrap().title, "Mapped");
    assert_eq!(snapshot.pending_count, 0);
    Ok(())
}

#[test]
fn time_minutes_round_each_session_and_reports_clip_before_rounding()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("create", create()))?;
    let entries = json!([
        {"startTime":"2026-10-03T11:00:00Z","endTime":"2026-10-03T11:00:31Z","duration":99,"vendor":"retained"},
        {"startTime":"2026-10-03T11:01:00Z","endTime":"2026-10-03T11:01:31Z"},
        {"startTime":"2026-10-03T11:02:00Z","endTime":"2026-10-03T11:02:29Z"},
        {"startTime":"2026-10-03T11:59:29Z"}
    ]);
    engine.execute(
        "a",
        &mutation(
            "entries",
            Command::SetTimeEntries {
                path: "Tasks/a.md".to_owned(),
                expected_revision: None,
                entries: serde_json::from_value(entries)?,
            },
        ),
    )?;
    let reading: Value = serde_json::from_str(&engine.features_json(
        "a",
        r#"{"kind":"task_time","path":"Tasks/a.md","at":"2026-10-03T12:00:00Z"}"#,
    )?)?;
    assert_eq!(reading["totalSeconds"], 122);
    assert_eq!(reading["totalMinutes"], 3);
    assert_eq!(reading["hasActiveSession"], true);
    assert_eq!(reading["entries"][0]["duration"], 99);
    assert_eq!(reading["entries"][0]["vendor"], "retained");
    let closed:Value=serde_json::from_str(&engine.features_json("a",r#"{"kind":"time_report","from":"2026-10-03T11:00:00Z","to":"2026-10-03T11:03:00Z","at":"2026-10-03T12:00:00Z"}"#)?)?;
    assert_eq!(closed["totalMinutes"], 2);
    let clipped:Value=serde_json::from_str(&engine.features_json("a",r#"{"kind":"time_report","from":"2026-10-03T11:00:21Z","to":"2026-10-03T11:00:31Z","at":"2026-10-03T12:00:00Z"}"#)?)?;
    assert_eq!(clipped["totalSeconds"], 10);
    assert_eq!(clipped["totalMinutes"], 0);
    Ok(())
}

#[test]
fn completion_uses_explicit_local_day_and_recurrence_advances_offsets()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let mut created = mutation("create", create());
    created.at = "2026-10-02T20:00:00Z".to_owned();
    engine.execute("a", &created)?;
    let mut complete = mutation(
        "civil",
        Command::SetCompletion {
            path: "Tasks/a.md".to_owned(),
            expected_revision: None,
            completed: true,
            occurrence_date: None,
        },
    );
    complete.at = "2026-10-03T00:15:00Z".to_owned();
    complete.execution_context = Some(tasknotes_runtime::types::ExecutionContext {
        today: "2026-10-02".to_owned(),
        timezone: "America/Los_Angeles".to_owned(),
    });
    engine.execute("a", &complete)?;
    assert_eq!(
        engine.snapshot("a", &Query::default())?.tasks[0].properties["completedDate"],
        "2026-10-02"
    );
    complete.mutation_id = "bad-context".to_owned();
    complete.execution_context.as_mut().unwrap().today = "2026-10-03".to_owned();
    assert!(engine.execute("a", &complete).is_err());
    let properties = json!({"title":"Recurring","recurrence":"FREQ=DAILY","scheduled":"2026-10-03","due":"2026-10-05","blockedBy":[{"uid":"Tasks/a","reltype":"FINISHTOSTART","vendor":true}]});
    engine.execute(
        "a",
        &mutation(
            "recurring",
            Command::Create {
                path: Some("Tasks/recur.md".to_owned()),
                properties: properties.as_object().unwrap().clone(),
                body: None,
            },
        ),
    )?;
    engine.execute(
        "a",
        &mutation(
            "occurrence",
            Command::SetCompletion {
                path: "Tasks/recur.md".to_owned(),
                expected_revision: None,
                completed: true,
                occurrence_date: Some("2026-10-03".to_owned()),
            },
        ),
    )?;
    let snapshot = engine.snapshot("a", &Query::default())?;
    let task = snapshot
        .tasks
        .iter()
        .find(|t| t.path == "Tasks/recur.md")
        .unwrap();
    assert_eq!(task.properties["scheduled"], "2026-10-04");
    assert_eq!(task.properties["due"], "2026-10-06");
    assert_eq!(task.properties["completeInstances"], json!(["2026-10-03"]));
    assert_eq!(task.properties["blockedBy"][0]["vendor"], true);
    Ok(())
}

#[test]
fn immutable_upload_metadata_preserves_service_uid_across_hash_ack()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    let original = b"---\ntitle: Remote\nstatus: open\npriority: normal\ntags: [task]\ndateCreated: 2026-01-01T00:00:00Z\n---\n";
    let metadata = json!({"schemaVersion":1,"uid":42,"ctime":1234,"mtime":5678,"relatedPath":null,"contentHash":ContentRevision::of(original).as_str()});
    engine.ingest_remote("a", "Tasks/a.md", Some(original), &metadata.to_string())?;
    engine.execute("a", &mutation("first", update("done")))?;
    let first = engine.pending_uploads("a")?.remove(0);
    assert_eq!(first.expected_remote_revision.as_deref(), Some("42"));
    assert_eq!(first.ctime, Some(1234));
    assert_eq!(
        first.mtime,
        Some(u64::try_from(
            chrono::DateTime::parse_from_rfc3339("2026-10-03T12:00:00Z")?.timestamp_millis()
        )?)
    );
    engine.acknowledge_upload("a", &first.mutation_id, "upload-content-hash")?;
    engine.execute("a", &mutation("second", update("open")))?;
    let second = engine.pending_uploads("a")?.remove(0);
    assert_eq!(second.expected_remote_revision.as_deref(), Some("42"));
    assert_eq!(second.ctime, Some(1234));
    assert_eq!(second.mtime, first.mtime);
    Ok(())
}

#[test]
fn invalid_remote_configuration_is_retained_and_does_not_block_other_imports()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    let mut selected = profile(ProfileKind::ObsidianSync);
    selected.approve_standard = false;
    engine.register_profile(selected)?;
    let invalid = br#"{"fieldMapping":null}"#;
    engine.ingest_remote(
        "a",
        ".obsidian/plugins/tasknotes/data.json",
        Some(invalid),
        "1",
    )?;
    assert_eq!(
        files.get("a", ".obsidian/plugins/tasknotes/data.json")?,
        Some(invalid.to_vec())
    );
    engine.ingest_remote(
        "a",
        "Tasks/a.md",
        Some(b"---\ntitle: Imported\ntags: [task]\n---\n"),
        "2",
    )?;
    assert!(matches!(
        engine.features_json("a", r#"{"kind":"discovery"}"#),
        Err(RuntimeError::Configuration(_))
    ));
    engine.ingest_remote(
        "a",
        ".obsidian/plugins/tasknotes/data.json",
        Some(br#"{"storeTitleInFilename":false}"#),
        "3",
    )?;
    assert_eq!(
        engine.snapshot("a", &Query::default())?.tasks[0].title,
        "Imported"
    );
    Ok(())
}

#[test]
fn a_failed_scan_retains_the_last_complete_snapshot()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("create", create()))?;
    files.seed("a", "Tasks/b.md", b"---\ntitle: B\ntags: [task]\n---\n")?;
    files.state.lock().unwrap().fail_read = Some("Tasks/b.md".to_owned());
    assert!(engine.refresh("a").is_err());
    assert_eq!(engine.snapshot("a", &Query::default())?.tasks.len(), 1);
    files.state.lock().unwrap().fail_read = None;
    assert_eq!(engine.refresh("a")?.tasks.len(), 2);
    Ok(())
}

#[test]
fn checkpoint_deltas_reconstruct_pending_notices_after_relaunch()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let dir = tempfile::tempdir()?;
    let db = dir.path().join("state.sqlite");
    let files = Arc::new(Memory::default());
    let engine = Engine::open(db.to_str().unwrap(), files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    let delta = json!({"schema_version":1,"cursor":1,"initial":true,"pending_upsert":null,"pending_remove":null});
    engine.apply_checkpoint_delta("a", &delta.to_string())?;
    assert!(engine.apply_checkpoint_delta("a",&json!({"schema_version":99,"cursor":2,"initial":true,"pending_upsert":null,"pending_remove":null}).to_string()).is_err());
    drop(engine);
    let restored = Engine::open(db.to_str().unwrap(), files)?;
    let checkpoint: Value = serde_json::from_str(&restored.load_checkpoint("a")?.unwrap())?;
    assert_eq!(checkpoint.get("cursor"), Some(&json!(1)));
    Ok(())
}

#[test]
fn absolute_completion_and_batch_undo_survive_relaunch_and_reject_later_edits()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let dir = tempfile::tempdir()?;
    let db = dir.path().join("state.sqlite");
    let files = Arc::new(Memory::default());
    let engine = Engine::open(db.to_str().unwrap(), files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("a", create()))?;
    let mut second = create();
    if let Command::Create { path, .. } = &mut second {
        *path = Some("Tasks/b.md".to_owned());
    }
    engine.execute("a", &mutation("b", second))?;
    let completion = |path: &str| Command::SetCompletion {
        path: path.to_owned(),
        expected_revision: None,
        completed: true,
        occurrence_date: None,
    };
    engine.execute(
        "a",
        &mutation(
            "both",
            Command::Batch {
                commands: vec![completion("Tasks/a.md"), completion("Tasks/b.md")],
            },
        ),
    )?;
    assert!(
        engine
            .snapshot("a", &Query::default())?
            .tasks
            .iter()
            .all(|task| task.completed)
    );
    let exchanges = files.state.lock().unwrap().exchanges;
    engine.execute("a", &mutation("already", completion("Tasks/a.md")))?;
    assert_eq!(files.state.lock().unwrap().exchanges, exchanges);
    drop(engine);
    let restored = Engine::open(db.to_str().unwrap(), files.clone())?;
    restored.execute(
        "a",
        &mutation(
            "undo",
            Command::Undo {
                receipt_id: "both".to_owned(),
            },
        ),
    )?;
    assert!(
        restored
            .snapshot("a", &Query::default())?
            .tasks
            .iter()
            .all(|task| !task.completed)
    );
    restored.execute("a", &mutation("again", completion("Tasks/a.md")))?;
    files.seed(
        "a",
        "Tasks/a.md",
        b"---\ntitle: Concurrent\nstatus: done\ntags: [task]\n---\nnew bytes\n",
    )?;
    assert!(matches!(
        restored.execute(
            "a",
            &mutation(
                "undo-race",
                Command::Undo {
                    receipt_id: "again".to_owned()
                }
            )
        ),
        Err(RuntimeError::Conflict)
    ));
    assert!(String::from_utf8(files.get("a", "Tasks/a.md")?.unwrap())?.contains("new bytes"));
    Ok(())
}

#[test]
fn durable_time_entries_and_period_reports_use_exact_timestamp_intersections()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("create", create()))?;
    engine.execute(
        "a",
        &mutation(
            "start",
            Command::StartTime {
                path: "Tasks/a.md".to_owned(),
                expected_revision: None,
            },
        ),
    )?;
    let request = json!({"kind":"task_time","path":"Tasks/a.md","at":"2026-10-03T12:02:30Z"});
    let reading: Value = serde_json::from_str(&engine.features_json("a", &request.to_string())?)?;
    assert_eq!(reading["totalSeconds"], 150);
    assert_eq!(reading["hasActiveSession"], true);
    let mut stop = mutation(
        "stop",
        Command::StopTime {
            path: "Tasks/a.md".to_owned(),
            expected_revision: None,
        },
    );
    stop.at = "2026-10-03T12:03:30Z".to_owned();
    engine.execute("a", &stop)?;
    let request = json!({"kind":"time_report","from":"2026-10-03T12:01:00Z","to":"2026-10-03T12:03:00Z","at":"2026-10-03T12:10:00Z"});
    let report: Value = serde_json::from_str(&engine.features_json("a", &request.to_string())?)?;
    assert_eq!(report["totalSeconds"], 120);
    assert_eq!(report["rows"][0]["minutes"], 2);
    assert!(
        engine
            .execute("a", &mutation("stop-twice", stop.command))
            .is_err()
    );
    Ok(())
}

#[test]
fn configured_capture_preserves_unknown_priority_tokens_and_rejects_schema_drift()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let request = json!({"schemaVersion":1,"kind":"capture_preview","input":"Fix !not-configured tomorrow #work","today":"2026-10-03","at":"2026-10-03T12:00:00Z"});
    let preview: Value = serde_json::from_str(&engine.features_json("a", &request.to_string())?)?;
    assert_eq!(preview["properties"]["title"], "Fix !not-configured");
    assert_eq!(preview["properties"]["due"], "2026-10-04");
    let request = json!({"kind":"discovery","magic":true});
    assert!(matches!(
        engine.features_json("a", &request.to_string()),
        Err(RuntimeError::Validation(_))
    ));
    assert!(
        serde_json::from_value::<Command>(
            json!({"kind":"delete","path":"Tasks/a.md","magic":true})
        )
        .is_err()
    );
    assert!(
        serde_json::from_value::<ConflictResolution>(json!({"kind":"keep_local","magic":true}))
            .is_err()
    );
    Ok(())
}

#[test]
fn a_post_commit_backup_cleanup_failure_returns_the_applied_receipt()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("create", create()))?;
    files.state.lock().unwrap().fail_acknowledgement = true;
    let command = mutation("complete", update("done"));
    let receipt = engine.execute("a", &command)?;
    assert!(receipt.applied);
    assert_eq!(
        engine
            .snapshot("a", &Query::default())?
            .tasks
            .first()
            .unwrap()
            .status,
        "done"
    );
    assert_eq!(files.state.lock().unwrap().backups.len(), 1);
    assert_eq!(
        engine.execute("a", &command)?.mutation_id,
        receipt.mutation_id
    );
    engine.refresh("a")?;
    assert!(files.state.lock().unwrap().backups.is_empty());
    assert_eq!(files.state.lock().unwrap().exchanges, 2);
    Ok(())
}

#[test]
fn interrupted_rename_with_changed_source_is_parked_and_never_replayed_after_resolution()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let dir = tempfile::tempdir()?;
    let db = dir.path().join("state.sqlite");
    let files = Arc::new(Memory::default());
    let engine = Engine::open(db.to_str().unwrap(), files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("create", create()))?;
    let original = files.get("a", "Tasks/a.md")?.unwrap();
    let rename = mutation(
        "rename",
        Command::Rename {
            path: "Tasks/a.md".to_owned(),
            new_path: "Tasks/renamed.md".to_owned(),
            expected_revision: None,
        },
    );
    files.state.lock().unwrap().crash_after_exchange = true;
    assert!(matches!(
        engine.execute("a", &rename),
        Err(RuntimeError::Host(_))
    ));
    let newer =
        b"---\ntitle: New external text\nstatus: open\ntags: [task]\n---\nLATEST\n".to_vec();
    files.seed("a", "Tasks/a.md", &newer)?;
    drop(engine);
    let restored = Engine::open(db.to_str().unwrap(), files.clone())?;
    assert!(matches!(
        restored.execute("a", &rename),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(files.get("a", "Tasks/a.md")?, Some(newer.clone()));
    assert_eq!(files.get("a", "Tasks/renamed.md")?, Some(original));
    for conflict in restored.conflicts("a")? {
        restored.resolve_conflict("a", &conflict.id, ConflictResolution::KeepRemote {})?;
    }
    let receipt = restored.execute("a", &rename)?;
    assert!(!receipt.applied);
    restored.refresh("a")?;
    assert_eq!(files.get("a", "Tasks/a.md")?, Some(newer));
    assert!(restored.conflicts("a")?.is_empty());
    Ok(())
}

#[test]
fn device_local_pomodoro_restores_paused_elapsed_time_and_keeps_other_devices_independent()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let database = directory.path().join("timer.sqlite");
    let files = Arc::new(Memory::default());
    let engine = Engine::open(database.to_str().unwrap(), files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    let action = |action: &str| Command::Pomodoro {
        device_id: "phone".to_owned(),
        action: action.to_owned(),
        task_path: None,
        duration_seconds: Some(600),
    };
    engine.execute("a", &mutation("start", action("start")))?;
    let mut pause = mutation("pause", action("pause"));
    pause.at = "2026-10-03T12:02:00Z".to_owned();
    engine.execute("a", &pause)?;
    assert!(engine.pending_uploads("a")?.is_empty());
    drop(engine);
    let restored = Engine::open(database.to_str().unwrap(), files)?;
    let request = json!({"kind":"pomodoro","deviceId":"phone","at":"2026-10-03T12:30:00Z"});
    let reading: Value = serde_json::from_str(&restored.features_json("a", &request.to_string())?)?;
    assert_eq!(reading["status"], "paused");
    assert_eq!(reading["elapsedSeconds"], 120);
    let request = json!({"kind":"pomodoro","deviceId":"desktop","at":"2026-10-03T12:30:00Z"});
    let reading: Value = serde_json::from_str(&restored.features_json("a", &request.to_string())?)?;
    assert_eq!(reading["status"], "idle");
    let mut resume = mutation("resume", action("resume"));
    resume.at = "2026-10-03T12:30:00Z".to_owned();
    restored.execute("a", &resume)?;
    let request = json!({"kind":"pomodoro","deviceId":"phone","at":"2026-10-03T12:38:00Z"});
    let reading: Value = serde_json::from_str(&restored.features_json("a", &request.to_string())?)?;
    assert_eq!(reading["status"], "completed");
    assert_eq!(reading["elapsedSeconds"], 600);
    Ok(())
}

#[test]
fn view_reordering_and_restored_defaults_preserve_custom_preferences()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let view = json!({"name":"Custom","vendor":{"width":42},"query":{"scope":"all"}})
        .as_object()
        .unwrap()
        .clone();
    engine.execute(
        "a",
        &mutation(
            "custom",
            Command::SaveView {
                id: "custom".to_owned(),
                view,
            },
        ),
    )?;
    engine.execute("a", &mutation("restore", Command::RestoreDefaultViews {}))?;
    let ids = vec!["custom", "default-upcoming", "default-today", "default-all"]
        .into_iter()
        .map(str::to_owned)
        .collect();
    engine.execute("a", &mutation("order", Command::ReorderViews { ids }))?;
    let snapshot = engine.snapshot("a", &Query::default())?;
    assert_eq!(snapshot.views.len(), 4);
    let custom = snapshot
        .views
        .iter()
        .find(|view| view.id == "custom")
        .unwrap();
    assert_eq!(custom.view["vendor"]["width"], 42);
    assert_eq!(custom.view["order"], 0);
    assert!(
        engine
            .execute(
                "a",
                &mutation(
                    "bad-order",
                    Command::ReorderViews {
                        ids: vec!["custom".to_owned()]
                    }
                )
            )
            .is_err()
    );
    Ok(())
}

#[test]
fn refresh_serializes_same_profile_mutations_without_blocking_another_profile()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let files = Arc::new(GatedMemory::default());
    let engine = Arc::new(Engine::open(":memory:", files.clone())?);
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    let mut second = profile(ProfileKind::LocalFolder);
    second.id = "b".to_owned();
    engine.register_profile(second)?;
    engine.refresh("a")?;
    engine.refresh("b")?;
    engine.execute("a", &mutation("create", create()))?;
    let (entered_tx, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release_tx, release_rx) = std::sync::mpsc::sync_channel(1);
    *files.pause.lock().unwrap() = Some(ReadPause {
        path: "Tasks/a.md".to_owned(),
        entered: entered_tx,
        release: release_rx,
    });
    let scanning = engine.clone();
    let refresh = std::thread::spawn(move || scanning.refresh("a"));
    entered_rx.recv_timeout(std::time::Duration::from_secs(5))?;
    let (attempt_tx, attempt_rx) = std::sync::mpsc::sync_channel(1);
    let (done_tx, done_rx) = std::sync::mpsc::sync_channel(1);
    let changing = engine.clone();
    let change = std::thread::spawn(move || {
        attempt_tx
            .send(())
            .map_err(|_| RuntimeError::Host("test attempt channel failed".to_owned()))?;
        let receipt = changing.execute("a", &mutation("complete", update("done")))?;
        done_tx
            .send(())
            .map_err(|_| RuntimeError::Host("test completion channel failed".to_owned()))?;
        Ok::<_, RuntimeError>(receipt)
    });
    attempt_rx.recv_timeout(std::time::Duration::from_secs(5))?;
    assert!(matches!(
        done_rx.recv_timeout(std::time::Duration::from_millis(20)),
        Err(std::sync::mpsc::RecvTimeoutError::Timeout)
    ));
    let independent = engine.execute("b", &mutation("independent", create()))?;
    assert!(independent.applied);
    release_tx.send(())?;
    refresh.join().unwrap()?;
    change.join().unwrap()?;
    assert_eq!(
        engine
            .snapshot("a", &Query::default())?
            .tasks
            .first()
            .unwrap()
            .status,
        "done"
    );
    assert_eq!(
        engine
            .snapshot("b", &Query::default())?
            .tasks
            .first()
            .unwrap()
            .status,
        "open"
    );
    Ok(())
}
