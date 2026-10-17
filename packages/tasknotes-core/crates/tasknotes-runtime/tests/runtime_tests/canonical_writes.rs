//! Actual `SQLite` production writes; upstream temporal/recurrence helpers stay unchanged.

use super::*;
use tasknotes_vault::{document::TaskDocument, path::VaultPath};

const PATH: &str = "Tasks/a.md";

fn object(value: Value) -> Result<serde_json::Map<String, Value>> {
    match value {
        Value::Object(object) => Ok(object),
        _ => Err(RuntimeError::NotFound),
    }
}

fn setup(database: &str, settings: &[u8]) -> Result<(Engine, Arc<Memory>)> {
    let files = Arc::new(Memory::default());
    files.seed("a", "tasknotes.yaml", settings)?;
    let engine = Engine::open(database, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    Ok((engine, files))
}

fn standard(database: &str) -> Result<(Engine, Arc<Memory>)> {
    setup(
        database,
        b"title:\n  storage: frontmatter\nvalidation:\n  mode: strict\n",
    )
}

fn create(value: Value) -> Result<Command> {
    let mut properties = object(value)?;
    properties.insert("title".into(), json!("Canonical"));
    Ok(Command::Create {
        path: Some(PATH.into()),
        properties,
        body: Some("Caller body\n".into()),
    })
}

fn update(value: Value) -> Result<Command> {
    Ok(Command::Update {
        path: PATH.into(),
        expected_revision: None,
        properties: object(value)?,
        body: None,
    })
}

fn doc(files: &Memory) -> Result<TaskDocument> {
    TaskDocument::parse(
        VaultPath::parse(PATH)?,
        &files.get("a", PATH)?.ok_or(RuntimeError::NotFound)?,
    )
    .map_err(Into::into)
}

fn entries() -> Value {
    json!([{"startTime":"2026-10-01T23:59:59.999999999-02:00","endTime":"2026-10-02T00:01:30.000000001-02:00","duration":777,"vendor":{"keep":true}}])
}

fn exchanges(files: &Memory) -> Result<u64> {
    Ok(files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock".into()))?
        .exchanges)
}

#[test]
fn create_seed_precedence_granularity_and_existing_dtstart_are_exact() -> Result<()> {
    for (values, expected) in [
        (
            json!({"recurrence":"FREQ=DAILY;INTERVAL=2;COUNT=4","scheduled":"2026-10-01","dateCreated":"2020-01-01T00:00:00Z"}),
            "DTSTART:20261001;FREQ=DAILY;INTERVAL=2;COUNT=4",
        ),
        (
            json!({"recurrence":"FREQ=DAILY","scheduled":"2026-10-01T00:00:00.999999999+02:00"}),
            "DTSTART:20260930T220000Z;FREQ=DAILY",
        ),
        (
            json!({"recurrence":"FREQ=DAILY","dateCreated":"2026-09-30T23:59:59.123456789-02:00"}),
            "DTSTART:20261001T015959Z;FREQ=DAILY",
        ),
        (
            json!({"recurrence":"DTSTART:20240229;FREQ=DAILY;INTERVAL=2;COUNT=4","scheduled":"2026-10-01"}),
            "DTSTART:20240229;FREQ=DAILY;INTERVAL=2;COUNT=4",
        ),
        (
            json!({"recurrence":"DTSTART:20240229T235959Z;FREQ=DAILY;COUNT=4","scheduled":"2026-10-01"}),
            "DTSTART:20240229T235959Z;FREQ=DAILY;COUNT=4",
        ),
    ] {
        let (engine, files) = standard(":memory:")?;
        engine.execute("a", &mutation("create", create(values)?))?;
        assert_eq!(
            doc(&files)?.frontmatter().get("recurrence"),
            Some(&json!(expected))
        );
        assert_eq!(doc(&files)?.body(), "Caller body\n");
    }
    Ok(())
}

#[test]
fn prefixed_rule_create_stays_completable_and_preserves_parameters() -> Result<()> {
    let (engine, files) = standard(":memory:")?;
    engine.execute("a", &mutation("create", create(json!({"recurrence":"RRULE:FREQ=DAILY;INTERVAL=2;COUNT=5","scheduled":"2026-10-01"}))?))?;
    assert_eq!(
        doc(&files)?.frontmatter().get("recurrence"),
        Some(&json!("DTSTART:20261001;FREQ=DAILY;INTERVAL=2;COUNT=5"))
    );
    engine.execute(
        "a",
        &mutation(
            "complete",
            Command::SetCompletion {
                path: PATH.into(),
                expected_revision: None,
                completed: true,
                occurrence_date: Some("2026-10-01".into()),
            },
        ),
    )?;
    assert_eq!(
        doc(&files)?.frontmatter().get("recurrence"),
        Some(&json!("DTSTART:20261001;FREQ=DAILY;INTERVAL=2;COUNT=5"))
    );
    Ok(())
}

#[test]
fn invalid_present_seed_and_existing_start_fail_before_create_effects() -> Result<()> {
    for values in [
        json!({"recurrence":"FREQ=DAILY","scheduled":"2026-02-30","dateCreated":"2026-01-01T00:00:00Z"}),
        json!({"recurrence":"FREQ=DAILY","scheduled":null}),
        json!({"recurrence":"DTSTART:20260230;FREQ=DAILY"}),
        json!({"recurrence":"DTSTART:20260101T240000Z;FREQ=DAILY"}),
        json!({"recurrence":"DTSTART:20260101T000060Z;FREQ=DAILY"}),
        json!({"recurrence":"DTSTART:20260101;DTSTART:20260102;FREQ=DAILY"}),
    ] {
        let (engine, files) = standard(":memory:")?;
        assert!(matches!(
            engine.execute("a", &mutation("invalid", create(values)?)),
            Err(RuntimeError::Validation(_))
        ));
        assert_eq!(files.get("a", PATH)?, None);
        assert_eq!(exchanges(&files)?, 0);
    }
    Ok(())
}

#[test]
fn final_template_and_provider_defaults_choose_seed_and_preserve_unknown_values() -> Result<()> {
    let (engine, files) = setup(":memory:", b"title:\n  storage: frontmatter\ndefaults:\n  recurrence: FREQ=WEEKLY\n  scheduled: 2026-11-01\ntemplating:\n  enabled: true\n  template_path: Templates/task.md\n  failure_mode: error_abort\n")?;
    files.seed("a", "Templates/task.md", b"---\nrecurrence: FREQ=DAILY;INTERVAL=2\nscheduled: 2026-10-01T23:00:00.999-02:00\ntimeEntries:\n  - startTime: 2026-10-01T14:00:00.123+02:00\n    endTime: 2026-10-01T14:01:00.987+02:00\n    vendor: template\n---\n{{due}} | {{details}}\n")?;
    engine.refresh("a")?;
    engine.execute(
        "a",
        &mutation(
            "template",
            create(json!({"due":"2026-10-03T01:02:03.456-03:00"}))?,
        ),
    )?;
    let document = doc(&files)?;
    assert_eq!(
        document.frontmatter().get("recurrence"),
        Some(&json!("DTSTART:20261002T010000Z;FREQ=DAILY;INTERVAL=2"))
    );
    assert_eq!(
        document.frontmatter().get("timeEntries"),
        Some(
            &json!([{"startTime":"2026-10-01T14:00:00.123+02:00","endTime":"2026-10-01T14:01:00.987+02:00","vendor":"template"}])
        )
    );
    assert!(document.body().contains("2026-10-03T01:02:03.456-03:00"));
    assert!(document.body().contains("Caller body"));
    Ok(())
}

#[test]
fn interrupted_canonical_create_replays_original_seed_and_unknown_fields_after_reopen() -> Result<()>
{
    let dir = tempfile::tempdir().map_err(|error| RuntimeError::Storage(error.to_string()))?;
    let database = dir.path().join("recovery.sqlite");
    let database = database.to_str().ok_or(RuntimeError::NotFound)?;
    let (engine, files) = standard(database)?;
    files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock".into()))?
        .crash_after_exchange = true;
    let mut request = mutation(
        "create",
        create(
            json!({"timeEntries":entries(),"recurrence":"FREQ=DAILY","scheduled":"2026-10-01T00:00:00.987+02:00"}),
        )?,
    );
    request.at = "2026-10-03T12:00:00.123456789Z".into();
    assert!(matches!(
        engine.execute("a", &request),
        Err(RuntimeError::Host(_))
    ));
    let bytes = files.get("a", PATH)?;
    drop(engine);
    let engine = Engine::open(database, files.clone())?;
    assert!(engine.execute("a", &request)?.applied);
    assert_eq!(files.get("a", PATH)?, bytes);
    assert_eq!(exchanges(&files)?, 1);
    let document = doc(&files)?;
    assert_eq!(
        document.frontmatter().get("recurrence"),
        Some(&json!("DTSTART:20260930T220000Z;FREQ=DAILY"))
    );
    assert_eq!(document.frontmatter().get("timeEntries"), Some(&entries()));
    assert_eq!(
        document.frontmatter().get("dateModified"),
        Some(&json!("2026-10-03T12:00:00Z"))
    );
    engine.execute(
        "a",
        &mutation(
            "undo",
            Command::Undo {
                receipt_id: "create".into(),
            },
        ),
    )?;
    assert_eq!(files.get("a", PATH)?, None);
    Ok(())
}

#[test]
fn recurring_completion_seeds_before_progression_and_reports_missing_seed() -> Result<()> {
    for (seed, expected) in [
        (
            json!({"scheduled":"2026-10-01"}),
            "DTSTART:20261001;FREQ=DAILY;INTERVAL=2",
        ),
        (
            json!({"dateCreated":"2026-10-01T01:02:03.987Z"}),
            "DTSTART:20261001T010203Z;FREQ=DAILY;INTERVAL=2",
        ),
    ] {
        let (engine, files) = standard(":memory:")?;
        let mut properties = object(
            json!({"title":"Legacy","status":"open","tags":["task"],"dateCreated":"2020-01-01T00:00:00Z","dateModified":"2026-10-01T00:00:00Z","recurrence":"FREQ=DAILY;INTERVAL=2"}),
        )?;
        properties.extend(object(seed)?);
        files.seed(
            "a",
            PATH,
            format!("---\n{}\n---\nBody\n", serde_json::to_string(&properties)?).as_bytes(),
        )?;
        engine.refresh("a")?;
        engine.execute(
            "a",
            &mutation(
                "complete",
                Command::SetCompletion {
                    path: PATH.into(),
                    expected_revision: None,
                    occurrence_date: Some("2026-10-01".into()),
                    completed: true,
                },
            ),
        )?;
        assert_eq!(
            doc(&files)?.frontmatter().get("recurrence"),
            Some(&json!(expected))
        );
        assert_eq!(
            doc(&files)?.frontmatter().get("status"),
            Some(&json!("open"))
        );
    }
    let (engine, files) = standard(":memory:")?;
    let original =
        b"---\ntitle: Legacy\nstatus: open\ntags: [task]\nrecurrence: FREQ=DAILY\n---\nBody\n";
    files.seed("a", PATH, original)?;
    engine.refresh("a")?;
    let result = engine.execute(
        "a",
        &mutation(
            "missing",
            Command::SetCompletion {
                path: PATH.into(),
                expected_revision: None,
                occurrence_date: Some("2026-10-01".into()),
                completed: true,
            },
        ),
    );
    assert!(
        matches!(&result, Err(RuntimeError::Validation(message)) if message == "missing_recurrence_seed"),
        "{result:?}"
    );
    assert_eq!(files.get("a", PATH)?, Some(original.to_vec()));
    assert_eq!(exchanges(&files)?, 0);
    Ok(())
}

#[test]
fn mapped_malformed_preferred_completion_seed_never_falls_back_to_valid_created() -> Result<()> {
    for seed in [
        json!("2026-02-30"),
        json!("2026-10-01T12:00:00"),
        Value::Null,
        json!(42),
    ] {
        let (engine, files) = setup(":memory:", b"title:\n  storage: frontmatter\nmapping:\n  recurrence: tn_rule\n  scheduled: tn_when\n  date_created: tn_created\n")?;
        let original = format!("---\n{}\n---\nOriginal\n", serde_json::to_string(&json!({"title":"Legacy","status":"open","tags":["task"],"tn_rule":"FREQ=DAILY","tn_when":seed,"tn_created":"2026-01-01T00:00:00Z"}))?).into_bytes();
        files.seed("a", PATH, &original)?;
        engine.refresh("a")?;
        let request = mutation(
            "complete",
            Command::SetCompletion {
                path: PATH.into(),
                expected_revision: None,
                occurrence_date: Some("2026-10-01".into()),
                completed: true,
            },
        );
        let result = engine.execute("a", &request);
        assert!(
            matches!(&result, Err(RuntimeError::Validation(message)) if message == "missing_recurrence_seed"),
            "{seed}: {result:?}"
        );
        assert_eq!(files.get("a", PATH)?, Some(original));
        assert_eq!(exchanges(&files)?, 0);
        assert!(engine.pending_uploads("a")?.is_empty());
    }
    Ok(())
}

#[test]
fn template_unknown_physical_snake_keys_survive_alongside_real_temporal_roles() -> Result<()> {
    let (engine, files) = setup(":memory:", b"title:\n  storage: frontmatter\ntemplating:\n  enabled: true\n  template_path: Templates/task.md\n  failure_mode: error_abort\n")?;
    files.seed("a", "Templates/task.md", b"---\ntime_entries: opaqueVendorValue\ndate_created: opaqueCreatedVendor\ndate_modified: opaqueModifiedVendor\ncompleted_date: opaqueCompletionVendor\n---\nTemplate body\n")?;
    engine.refresh("a")?;
    engine.execute(
        "a",
        &mutation("create", create(json!({"timeEntries":entries()}))?),
    )?;
    let document = doc(&files)?;
    assert_eq!(document.frontmatter().get("timeEntries"), Some(&entries()));
    for (key, expected) in [
        ("time_entries", "opaqueVendorValue"),
        ("date_created", "opaqueCreatedVendor"),
        ("date_modified", "opaqueModifiedVendor"),
        ("completed_date", "opaqueCompletionVendor"),
    ] {
        assert_eq!(
            document.frontmatter().get(key),
            Some(&json!(expected)),
            "{key}"
        );
    }
    assert_eq!(document.body(), "Template body\n");
    Ok(())
}

#[test]
fn canonical_write_reopen_replay_undo_and_revision_race_preserve_bytes() -> Result<()> {
    let dir = tempfile::tempdir().map_err(|error| RuntimeError::Storage(error.to_string()))?;
    let database = dir.path().join("canonical.sqlite");
    let database = database.to_str().ok_or(RuntimeError::NotFound)?;
    let (engine, files) = standard(database)?;
    engine.execute("a", &mutation("create", create(json!({}))?))?;
    let original = files.get("a", PATH)?.ok_or(RuntimeError::NotFound)?;
    let request = mutation("write", update(json!({"timeEntries":entries()}))?);
    let receipt = engine.execute("a", &request)?;
    let count = exchanges(&files)?;
    drop(engine);
    let engine = Engine::open(database, files.clone())?;
    assert_eq!(
        serde_json::to_value(engine.execute("a", &request)?)?,
        serde_json::to_value(receipt)?
    );
    assert_eq!(exchanges(&files)?, count);
    engine.execute(
        "a",
        &mutation(
            "undo",
            Command::Undo {
                receipt_id: "write".into(),
            },
        ),
    )?;
    assert_eq!(files.get("a", PATH)?, Some(original.clone()));
    let stale = Command::Update {
        path: PATH.into(),
        expected_revision: Some("stale".into()),
        properties: object(json!({"timeEntries":entries()}))?,
        body: None,
    };
    assert!(matches!(
        engine.execute("a", &mutation("stale", stale)),
        Err(RuntimeError::Conflict)
    ));
    files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock".into()))?
        .racing_before_compare = Some(b"Foreign writer\n".to_vec());
    assert!(matches!(
        engine.execute(
            "a",
            &mutation("race", update(json!({"timeEntries":entries()}))?)
        ),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(files.get("a", PATH)?, Some(b"Foreign writer\n".to_vec()));
    Ok(())
}
