//! Temporal writes through actual `SQLite` journals and conditional host bytes.

use super::*;
use tasknotes_runtime::types::{FileSnapshot, ReplacementStage, StagedExchange};

// One controlled writer with real disk bytes. The existing bounded test capability
// retains stage/backup identities across engine reopen; provider restart is not tested.
struct Disk {
    root: std::path::PathBuf,
    inner: Memory,
}

impl Disk {
    fn persist(&self, profile: &str, path: &str) -> Result<()> {
        let target = self.root.join(path);
        let bytes = self.inner.get(profile, path)?;
        if let Some(bytes) = bytes {
            let parent = target.parent().ok_or(RuntimeError::NotFound)?;
            std::fs::create_dir_all(parent).map_err(|error| disk_error(&error))?;
            let staged = target.with_extension("temporal-private");
            std::fs::write(&staged, bytes).map_err(|error| disk_error(&error))?;
            std::fs::rename(staged, target).map_err(|error| disk_error(&error))?;
        } else if target.exists() {
            std::fs::remove_file(target).map_err(|error| disk_error(&error))?;
        }
        Ok(())
    }

    fn load(&self, profile: &str, path: &str) -> Result<Option<Vec<u8>>> {
        match std::fs::read(self.root.join(path)) {
            Ok(bytes) => {
                self.inner.seed(profile, path, &bytes)?;
                Ok(Some(bytes))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                self.inner
                    .state
                    .lock()
                    .map_err(|_| RuntimeError::Host("test lock failed".into()))?
                    .files
                    .remove(&(profile.to_owned(), path.to_owned()));
                Ok(None)
            }
            Err(error) => Err(disk_error(&error)),
        }
    }
}

fn disk_error(error: &std::io::Error) -> RuntimeError {
    RuntimeError::Host(error.to_string())
}

impl VaultFiles for Disk {
    fn open_file_snapshot(&self, profile: &str, path: &str) -> Result<Option<FileSnapshot>> {
        if self.load(profile, path)?.is_none() {
            return Ok(None);
        }
        self.inner.snapshot(profile, path)
    }
    fn open_displaced_snapshot(&self, profile: &str, id: &str) -> Result<FileSnapshot> {
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
    ) -> Result<ReplacementStage> {
        self.inner
            .stage_begin(profile, operation, path, expected, size, revision)
    }
    fn write_replacement_chunk(
        &self,
        profile: &str,
        id: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<ReplacementStage> {
        self.inner.stage_write(profile, id, offset, bytes)
    }
    fn seal_replacement(&self, profile: &str, id: &str) -> Result<ReplacementStage> {
        self.inner.stage_seal(profile, id)
    }
    fn compare_exchange_staged(
        &self,
        profile: &str,
        operation: &str,
        path: &str,
        expected: Option<&str>,
        stage: Option<&str>,
    ) -> Result<StagedExchange> {
        self.load(profile, path)?;
        let result = self
            .inner
            .staged_exchange(profile, operation, path, expected, stage)?;
        self.persist(profile, path)?;
        Ok(result)
    }
    fn discard_replacement(&self, profile: &str, id: &str) -> Result<()> {
        self.inner.stage_discard(profile, id)
    }
    fn list_files(&self, profile: &str) -> Result<Vec<String>> {
        self.inner.list_files(profile)
    }
    fn read_file(&self, profile: &str, path: &str) -> Result<Option<Vec<u8>>> {
        self.load(profile, path)
    }
    fn compare_exchange(
        &self,
        profile: &str,
        path: &str,
        expected: Option<&str>,
        bytes: Option<&[u8]>,
    ) -> Result<FileExchange> {
        self.load(profile, path)?;
        let result = self
            .inner
            .compare_exchange(profile, path, expected, bytes)?;
        self.persist(profile, path)?;
        Ok(result)
    }
    fn displaced_metadata(
        &self,
        profile: &str,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Vec<DisplacedMetadata>> {
        self.inner.displaced_metadata(profile, after, limit)
    }
    fn read_displaced(&self, profile: &str, id: &str) -> Result<Vec<u8>> {
        self.inner.read_displaced(profile, id)
    }
    fn acknowledge_displaced(&self, profile: &str, id: &str) -> Result<()> {
        self.inner.acknowledge_displaced(profile, id)
    }
}

fn properties(value: Value) -> Result<serde_json::Map<String, Value>> {
    match value {
        Value::Object(object) => Ok(object),
        _ => Err(RuntimeError::Storage("test object missing".into())),
    }
}

fn update(value: Value) -> Result<Command> {
    Ok(Command::Update {
        path: "Tasks/a.md".into(),
        expected_revision: None,
        properties: properties(value)?,
        body: None,
    })
}

fn document(files: &dyn VaultFiles) -> Result<tasknotes_vault::document::TaskDocument> {
    tasknotes_vault::document::TaskDocument::parse(
        tasknotes_vault::path::VaultPath::parse("Tasks/a.md")?,
        &files
            .read_file("a", "Tasks/a.md")?
            .ok_or(RuntimeError::NotFound)?,
    )
    .map_err(Into::into)
}

fn exchanges(files: &Memory) -> Result<u64> {
    Ok(files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock failed".into()))?
        .exchanges)
}

#[test]
fn temporal_create_edit_replay_and_undo_preserve_request_clock_and_exact_bytes() -> Result<()> {
    let dir = tempfile::tempdir().map_err(|e| RuntimeError::Storage(e.to_string()))?;
    let database = dir.path().join("temporal.sqlite");
    let database = database.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Disk {
        root: dir.path().join("vault"),
        inner: Memory::default(),
    });
    let engine = Engine::open(database, files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    let mut request = mutation(
        "create-offset",
        Command::Create {
            path: Some("Tasks/a.md".into()),
            properties: properties(json!({
                "title":"Temporal",
                "dateCreated":"2026-10-02T23:59:59.987-03:00",
                "due":"2026-10-04",
                "scheduled":"2026-10-03T23:30:00.999-02:00",
                "vendor":{"raw":"2026-10-03T11:00:00.123+02:00"}
            }))?,
            body: Some("Unchanged body\n[[target|Label]]\n".into()),
        },
    );
    request.at = "2026-10-03T23:30:00.999-02:00".into();
    let envelope = serde_json::to_string(&request)?;
    let receipt = engine.execute("a", &request)?;
    assert_eq!(serde_json::to_string(&request)?, envelope);
    let created = files.read_file("a", "Tasks/a.md")?;
    let doc = document(files.as_ref())?;
    for (role, expected) in [
        ("dateCreated", "2026-10-03T02:59:59Z"),
        ("dateModified", "2026-10-04T01:30:00Z"),
        ("due", "2026-10-04"),
        ("scheduled", "2026-10-04T01:30:00Z"),
    ] {
        assert_eq!(doc.frontmatter().get(role), Some(&json!(expected)));
    }
    let mut edit = mutation(
        "edit-offset",
        update(json!({"due":"2026-10-05T00:30:00.999+03:00"}))?,
    );
    edit.at = "2026-10-05T01:00:00.111+03:00".into();
    let edited = engine.execute("a", &edit)?;
    let final_bytes = files.read_file("a", "Tasks/a.md")?;
    let count = exchanges(&files.inner)?;
    drop(engine);
    let restored = Engine::open(database, files.clone())?;
    assert_eq!(
        serde_json::to_value(restored.execute("a", &request)?)?,
        serde_json::to_value(receipt)?
    );
    assert_eq!(
        serde_json::to_value(restored.execute("a", &edit)?)?,
        serde_json::to_value(edited)?
    );
    assert_eq!(exchanges(&files.inner)?, count);
    assert_eq!(files.read_file("a", "Tasks/a.md")?, final_bytes);
    let doc = document(files.as_ref())?;
    assert_eq!(
        doc.frontmatter().get("dateCreated"),
        Some(&json!("2026-10-03T02:59:59Z"))
    );
    assert_eq!(
        doc.frontmatter().get("dateModified"),
        Some(&json!("2026-10-04T22:00:00Z"))
    );
    assert_eq!(
        doc.frontmatter().get("due"),
        Some(&json!("2026-10-04T21:30:00Z"))
    );
    assert_eq!(doc.body(), "Unchanged body\n[[target|Label]]\n");
    assert_eq!(
        doc.frontmatter().get("vendor"),
        Some(&json!({"raw":"2026-10-03T11:00:00.123+02:00"}))
    );
    restored.execute(
        "a",
        &mutation(
            "undo-edit",
            Command::Undo {
                receipt_id: "edit-offset".into(),
            },
        ),
    )?;
    assert_eq!(files.read_file("a", "Tasks/a.md")?, created);
    assert_eq!(
        std::fs::read(files.root.join("Tasks/a.md")).map_err(|error| disk_error(&error))?,
        created.as_deref().ok_or(RuntimeError::NotFound)?
    );
    assert_changed_envelope_and_stale_revision_reject(
        &restored,
        files.as_ref(),
        &request,
        created.as_deref().ok_or(RuntimeError::NotFound)?,
    )?;
    Ok(())
}

fn assert_changed_envelope_and_stale_revision_reject(
    restored: &Engine,
    files: &Disk,
    request: &Mutation,
    created: &[u8],
) -> Result<()> {
    let mut changed_envelope = request.clone();
    changed_envelope.at = "2026-10-04T01:30:00Z".into();
    assert!(matches!(
        restored.execute("a", &changed_envelope),
        Err(RuntimeError::Validation(_))
    ));
    let count = exchanges(&files.inner)?;
    let external = b"---\ntitle: External\nstatus: open\ntags: [task]\n---\nConcurrent edit\n";
    std::fs::write(files.root.join("Tasks/a.md"), external).map_err(|error| disk_error(&error))?;
    let mut stale = update(json!({"due":"2026-10-06T01:30:00.555+02:00"}))?;
    if let Command::Update {
        expected_revision, ..
    } = &mut stale
    {
        *expected_revision = Some(ContentRevision::of(created).as_str().into());
    }
    assert!(matches!(
        restored.execute("a", &mutation("stale", stale)),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(
        std::fs::read(files.root.join("Tasks/a.md")).map_err(|error| disk_error(&error))?,
        external
    );
    assert_eq!(exchanges(&files.inner)?, count);
    Ok(())
}

#[test]
fn equivalent_instant_update_is_noop_and_unrelated_write_preserves_untouched_temporal_spelling()
-> Result<()> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    engine.execute(
        "a",
        &mutation(
            "create",
            Command::Create {
                path: Some("Tasks/a.md".into()),
                properties: properties(json!({"title":"Temporal","due":"2026-10-04T01:30:00Z"}))?,
                body: None,
            },
        ),
    )?;
    let original = files.get("a", "Tasks/a.md")?;
    let count = exchanges(&files)?;
    let mut request = mutation(
        "same-instant",
        update(json!({"due":"2026-10-03T23:30:00.999-02:00"}))?,
    );
    request.at = "2026-10-10T20:00:00+04:00".into();
    let receipt = engine.execute("a", &request)?;
    assert!(receipt.paths.is_empty());
    assert_eq!(files.get("a", "Tasks/a.md")?, original);
    assert_eq!(exchanges(&files)?, count);
    let original = b"---\ntitle: Temporal\nstatus: open\ntags: [task]\ndateCreated: 2026-10-01T13:00:00.125+01:00\ndateModified: 2026-10-02T12:00:00Z\ndue: 2026-10-04T01:30:00.222+02:00 # preserve\nscheduled: 2026-10-04\n---\nBody\n";
    files.seed("a", "Tasks/a.md", original)?;
    engine.refresh("a")?;
    engine.execute(
        "a",
        &mutation("unrelated", update(json!({"priority":"high"}))?),
    )?;
    let bytes = files
        .get("a", "Tasks/a.md")?
        .ok_or(RuntimeError::NotFound)?;
    let text = std::str::from_utf8(&bytes).map_err(|e| RuntimeError::Storage(e.to_string()))?;
    assert!(text.contains("due: 2026-10-04T01:30:00.222+02:00 # preserve"));
    assert!(text.contains("dateCreated: 2026-10-01T13:00:00.125+01:00"));
    assert!(text.contains("scheduled: 2026-10-04"));
    Ok(())
}

#[test]
fn invalid_explicit_role_forms_and_atomic_batch_fail_without_file_or_journal_effects() -> Result<()>
{
    let dir = tempfile::tempdir().map_err(|e| RuntimeError::Storage(e.to_string()))?;
    let database = dir.path().join("invalid.sqlite");
    let files = Arc::new(Memory::default());
    let engine = Engine::open(
        database.to_str().ok_or(RuntimeError::NotFound)?,
        files.clone(),
    )?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("create", create()))?;
    let original = files.get("a", "Tasks/a.md")?;
    let count = exchanges(&files)?;
    let pending = engine.pending_upload_metadata("a")?.len();
    let connection = rusqlite::Connection::open(&database)?;
    let counts = || -> Result<(i64, i64)> {
        Ok((
            connection.query_row("SELECT COUNT(*) FROM journals", [], |row| row.get(0))?,
            connection.query_row("SELECT COUNT(*) FROM outbox", [], |row| row.get(0))?,
        ))
    };
    let before_counts = counts()?;
    for (i, value) in [
        json!({"dateCreated":"2026-10-03"}),
        json!({"dateModified":"2026-10-03"}),
        json!({"completedDate":"2026-10-03T12:00:00Z"}),
        json!({"due":"2026-02-30"}),
        json!({"scheduled":"2026-10-03T12:00:00"}),
        json!({"due":"2026-10-03 12:00:00Z"}),
        json!({"scheduled":"20261003T120000Z"}),
        json!({"due":"2026-10-03T12:00:60Z"}),
        json!({"due":123}),
    ]
    .into_iter()
    .enumerate()
    {
        let request = mutation(&format!("invalid-{i}"), update(value)?);
        assert!(matches!(
            engine.execute("a", &request),
            Err(RuntimeError::Validation(_))
        ));
        assert_eq!(files.get("a", "Tasks/a.md")?, original);
    }
    let invalid_create = mutation(
        "invalid-create",
        Command::Create {
            path: Some("Tasks/invalid.md".into()),
            properties: properties(json!({"title":"Invalid","dateModified":"2026-10-03"}))?,
            body: None,
        },
    );
    assert!(matches!(
        engine.execute("a", &invalid_create),
        Err(RuntimeError::Validation(_))
    ));
    assert_eq!(files.get("a", "Tasks/invalid.md")?, None);
    let batch = mutation(
        "invalid-batch",
        Command::Batch {
            commands: vec![
                update(json!({"due":"2026-10-03T12:00:00.333+01:00"}))?,
                update(json!({"completedDate":"2026-10-03T12:00:00Z"}))?,
            ],
        },
    );
    assert!(matches!(
        engine.execute("a", &batch),
        Err(RuntimeError::Validation(_))
    ));
    assert_eq!(files.get("a", "Tasks/a.md")?, original);
    assert_eq!(exchanges(&files)?, count);
    assert_eq!(engine.pending_upload_metadata("a")?.len(), pending);
    assert_eq!(counts()?, before_counts);
    Ok(())
}

#[test]
fn mapped_editor_and_completion_keep_local_day_context_while_canonicalizing_instants() -> Result<()>
{
    let files = Arc::new(Memory::default());
    files.seed("a","tasknotes.yaml",b"mapping:\n  due: deadline\n  date_created: born\n  date_modified: changed\n  completed_date: settled\n")?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("create", create()))?;
    let mut request = mutation(
        "mapped-edit",
        Command::EditTask {
            path: "Tasks/a.md".into(),
            expected_revision: None,
            properties: properties(
                json!({"deadline":"2026-10-03T23:30:00.999-02:00","born":"2026-10-01T23:00:00+02:00"}),
            )?,
            body: None,
            status: Some("done".into()),
            occurrence_date: None,
        },
    );
    request.at = "2026-10-04T01:30:00.999Z".into();
    request.execution_context = Some(tasknotes_runtime::types::ExecutionContext {
        today: "2026-10-03".into(),
        timezone: "America/New_York".into(),
    });
    engine.execute("a", &request)?;
    let doc = document(files.as_ref())?;
    assert_eq!(
        doc.frontmatter().get("deadline"),
        Some(&json!("2026-10-04T01:30:00Z"))
    );
    assert_eq!(
        doc.frontmatter().get("born"),
        Some(&json!("2026-10-01T21:00:00Z"))
    );
    assert_eq!(
        doc.frontmatter().get("changed"),
        Some(&json!("2026-10-04T01:30:00Z"))
    );
    assert_eq!(doc.frontmatter().get("settled"), Some(&json!("2026-10-03")));
    assert!(!doc.frontmatter().contains_key("dateCreated"));
    Ok(())
}

#[test]
fn create_canonicalizes_final_defaults_and_template_values_after_precedence() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed("a","tasknotes.yaml",b"title:\n  storage: frontmatter\ndefaults:\n  due: 2026-10-08T23:00:00.456-02:00\n  scheduled: 2026-10-09\ntemplating:\n  enabled: true\n  template_path: Templates/task.md\n  failure_mode: error_abort\n")?;
    files.seed("a","Templates/task.md",b"---\ndue: 2026-10-06T23:00:00.999-02:00\nscheduled: 2026-10-07T23:00:00.111-02:00\ndateCreated: 2025-10-01T00:00:00Z\n---\nTemplate body\n")?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    engine.execute(
        "a",
        &mutation(
            "template",
            Command::Create {
                path: Some("Tasks/a.md".into()),
                properties: properties(
                    json!({"title":"Explicit","due":"2026-10-04T23:00:00.777-02:00"}),
                )?,
                body: Some("Caller body".into()),
            },
        ),
    )?;
    let doc = document(files.as_ref())?;
    assert_eq!(
        doc.frontmatter().get("due"),
        Some(&json!("2026-10-05T01:00:00Z"))
    );
    assert_eq!(
        doc.frontmatter().get("scheduled"),
        Some(&json!("2026-10-08T01:00:00Z"))
    );
    assert_eq!(
        doc.frontmatter().get("dateCreated"),
        Some(&json!("2026-10-03T12:00:00Z"))
    );
    assert_eq!(doc.body(), "Template body\n");
    files.seed("a","tasknotes.yaml",b"title:\n  storage: frontmatter\ndefaults:\n  due: 2026-10-08T23:00:00.456-02:00\n  scheduled: 2026-10-09\n")?;
    engine.refresh("a")?;
    engine.execute(
        "a",
        &mutation(
            "defaults",
            Command::Create {
                path: Some("Tasks/defaults.md".into()),
                properties: properties(json!({"title":"Default"}))?,
                body: None,
            },
        ),
    )?;
    let bytes = files
        .get("a", "Tasks/defaults.md")?
        .ok_or(RuntimeError::NotFound)?;
    let doc = tasknotes_vault::document::TaskDocument::parse(
        tasknotes_vault::path::VaultPath::parse("Tasks/defaults.md")?,
        &bytes,
    )?;
    assert_eq!(
        doc.frontmatter().get("due"),
        Some(&json!("2026-10-09T01:00:00Z"))
    );
    assert_eq!(
        doc.frontmatter().get("scheduled"),
        Some(&json!("2026-10-09"))
    );
    Ok(())
}

#[test]
fn explicit_normalization_writes_canonical_generated_and_aliased_timestamps() -> Result<()> {
    let files = Arc::new(Memory::default());
    let original=b"---\ntitle: Legacy\nstatus: open\ntags: [task]\ndate_created: 2026-10-01T23:30:00.987-02:00\ndue: 2026-10-04\nvendor: keep # comment\n---\nBody\n";
    files.seed("a", "Tasks/a.md", original)?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let mut request = mutation(
        "normalize",
        Command::Normalize {
            path: "Tasks/a.md".into(),
            expected_revision: None,
        },
    );
    request.at = "2026-10-03T23:30:00.765-02:00".into();
    engine.execute("a", &request)?;
    let doc = document(files.as_ref())?;
    assert_eq!(
        doc.frontmatter().get("dateCreated"),
        Some(&json!("2026-10-02T01:30:00Z"))
    );
    assert_eq!(
        doc.frontmatter().get("dateModified"),
        Some(&json!("2026-10-04T01:30:00Z"))
    );
    assert_eq!(doc.frontmatter().get("due"), Some(&json!("2026-10-04")));
    assert!(!doc.frontmatter().contains_key("date_created"));
    assert_eq!(doc.body(), "Body\n");
    let bytes = files
        .get("a", "Tasks/a.md")?
        .ok_or(RuntimeError::NotFound)?;
    assert!(
        std::str::from_utf8(&bytes)
            .map_err(|e| RuntimeError::Storage(e.to_string()))?
            .contains("vendor: keep # comment")
    );
    engine.execute(
        "a",
        &mutation(
            "undo-normalize",
            Command::Undo {
                receipt_id: "normalize".into(),
            },
        ),
    )?;
    assert_eq!(files.get("a", "Tasks/a.md")?, Some(original.to_vec()));
    Ok(())
}
