//! Real `SQLite` tracking paging, identity, clock fences and provider independence.

use super::{Arc, Engine, Memory, ProfileKind, Result, RuntimeError, Value, json, profile};

fn seed(files: &Memory, owner: &str, path: &str, entries: Value, projects: Value) -> Result<()> {
    let mut metadata = json!({"title":"Tracked","status":"open","tags":["task"],"dateCreated":"2026-01-01T00:00:00Z"});
    let fields = metadata.as_object_mut().ok_or(RuntimeError::NotFound)?;
    fields.insert("timeEntries".to_owned(), entries);
    fields.insert("projects".to_owned(), projects);
    files.seed(
        owner,
        path,
        format!("---\n{metadata}\n---\nUnchanged body\n").as_bytes(),
    )
}

fn request() -> Value {
    json!({"kind":"tracking_sessions","at":"2026-10-04T12:00:31Z","limit":128})
}
fn read(engine: &Engine, owner: &str, request: &Value) -> Result<Value> {
    Ok(serde_json::from_str(
        &engine.features_json(owner, &request.to_string())?,
    )?)
}
fn active() -> Value {
    json!([{"startTime":"2026-10-04T12:00:00Z","vendor":"retained"}])
}

#[test]
fn tracking_projects_mapped_roles_and_canonical_instants_without_provider_reads() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed(
        "a",
        "tasknotes.yaml",
        b"mapping:\n  timeEntries: sessions\n  projects: work\n",
    )?;
    files.seed("a","Tasks/a.md",b"---\ntitle: Mapped\nstatus: open\ntags: [task]\ndateCreated: 2026-01-01T00:00:00Z\nsessions:\n  - startTime: 2026-10-04T14:00:00+02:00\nwork: ['[[Project]]']\n---\n")?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let before = files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock failed".to_owned()))?
        .reads;
    files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock failed".to_owned()))?
        .fail_read = Some("Tasks/a.md".to_owned());
    let value = read(&engine, "a", &request())?;
    println!("TRACKING_SCHEMA_PROOF sessions {value}");
    assert_eq!(
        value.pointer("/rows/0/startedAt"),
        Some(&json!("2026-10-04T12:00:00Z"))
    );
    assert_eq!(value.pointer("/rows/0/elapsedSeconds"), Some(&json!(31)));
    assert_eq!(
        value.pointer("/rows/0/projectLabels"),
        Some(&json!(["[[Project]]"]))
    );
    assert_eq!(value.get("nextCursor"), Some(&Value::Null));
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test lock failed".to_owned()))?
            .reads,
        before
    );
    Ok(())
}

#[test]
fn tracking_pages_all_129_active_sessions_with_frozen_version_and_clock() -> Result<()> {
    let files = Arc::new(Memory::default());
    for index in 0..129 {
        seed(
            &files,
            "a",
            &format!("Tasks/{index:03}.md"),
            active(),
            json!([]),
        )?;
    }
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let first = read(&engine, "a", &request())?;
    assert_eq!(first.get("totalCount"), Some(&json!(129)));
    assert_eq!(
        first.get("rows").and_then(Value::as_array).map(Vec::len),
        Some(128)
    );
    let mut next = request();
    next["after"] = first
        .get("nextCursor")
        .cloned()
        .ok_or(RuntimeError::NotFound)?;
    next["expectedVersion"] = first
        .get("version")
        .cloned()
        .ok_or(RuntimeError::NotFound)?;
    let second = read(&engine, "a", &next)?;
    assert_eq!(
        second.pointer("/rows/0/taskPath"),
        Some(&json!("Tasks/128.md"))
    );
    assert_eq!(second.get("nextCursor"), Some(&Value::Null));
    next["at"] = json!("2026-10-04T12:01:00Z");
    assert!(matches!(
        engine.features_json("a", &next.to_string()),
        Err(RuntimeError::Validation(_))
    ));
    Ok(())
}

#[test]
fn tracking_revision_changes_reject_old_pages_and_replace_session_identity() -> Result<()> {
    let files = Arc::new(Memory::default());
    seed(&files, "a", "Tasks/a.md", active(), json!([]))?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let first = read(&engine, "a", &request())?;
    seed(
        &files,
        "a",
        "Tasks/a.md",
        json!([{"startTime":"2026-10-04T12:00:15Z"}]),
        json!([]),
    )?;
    engine.refresh("a")?;
    let mut stale = request();
    stale["expectedVersion"] = first
        .get("version")
        .cloned()
        .ok_or(RuntimeError::NotFound)?;
    assert!(matches!(
        engine.features_json("a", &stale.to_string()),
        Err(RuntimeError::Conflict)
    ));
    let second = read(&engine, "a", &request())?;
    assert_ne!(
        first.pointer("/rows/0/sessionId"),
        second.pointer("/rows/0/sessionId")
    );
    assert_ne!(
        first.pointer("/rows/0/taskRevision"),
        second.pointer("/rows/0/taskRevision")
    );
    Ok(())
}

#[test]
fn tracking_bad_entries_and_projects_are_bounded_problems_without_hiding_valid_rows() -> Result<()>
{
    let files = Arc::new(Memory::default());
    for index in 0..129 {
        seed(
            &files,
            "a",
            &format!("Tasks/bad-{index:03}.md"),
            json!(false),
            json!([]),
        )?;
    }
    seed(&files, "a", "Tasks/bad-projects.md", active(), json!([7]))?;
    seed(&files, "a", "Tasks/good.md", active(), json!([]))?;
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    // The committed metadata remains available while the legacy default
    // snapshot reports malformed tracking properties explicitly.
    assert!(
        matches!(engine.refresh("a"), Err(RuntimeError::Validation(message)) if message == "invalid_time_entries")
    );
    let value = read(&engine, "a", &request())?;
    assert_eq!(value.get("totalCount"), Some(&json!(1)));
    assert_eq!(value.get("problemCount"), Some(&json!(130)));
    assert_eq!(
        value
            .get("problems")
            .and_then(Value::as_array)
            .map(Vec::len),
        Some(128)
    );
    assert_eq!(
        value.pointer("/rows/0/taskPath"),
        Some(&json!("Tasks/good.md"))
    );
    Ok(())
}

#[test]
fn tracking_owner_identity_is_distinct_and_survives_actual_sqlite_reopen() -> Result<()> {
    let directory =
        tempfile::tempdir().map_err(|error| RuntimeError::Storage(error.to_string()))?;
    let database_path = directory.path().join("tracking.sqlite");
    let database = database_path
        .to_str()
        .ok_or_else(|| RuntimeError::Storage("test database path is not UTF-8".to_owned()))?;
    let files = Arc::new(Memory::default());
    seed(&files, "a", "Tasks/a.md", active(), json!([]))?;
    seed(&files, "b", "Tasks/a.md", active(), json!([]))?;
    let engine = Engine::open(database, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    let mut other = profile(ProfileKind::LocalFolder);
    other.id = "b".to_owned();
    engine.register_profile(other)?;
    engine.refresh("a")?;
    engine.refresh("b")?;
    let a = read(&engine, "a", &request())?;
    let b = read(&engine, "b", &request())?;
    assert_ne!(
        a.pointer("/rows/0/sessionId"),
        b.pointer("/rows/0/sessionId")
    );
    drop(engine);
    let reopened = Engine::open(database, files)?;
    assert_eq!(read(&reopened, "a", &request())?, a);
    Ok(())
}

#[test]
fn tracking_history_pages_original_entry_indices_and_exact_elapsed_seconds() -> Result<()> {
    let files = Arc::new(Memory::default());
    seed(
        &files,
        "a",
        "Tasks/a.md",
        json!([{"startTime":"2026-10-04T10:00:00Z","endTime":"2026-10-04T10:00:31Z"},{"startTime":"2026-10-04T12:00:00Z"}]),
        json!([]),
    )?;
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let mut request = json!({"kind":"tracking_history","path":"Tasks/a.md","at":"2026-10-04T12:00:31Z","limit":1});
    let first = read(&engine, "a", &request)?;
    println!("TRACKING_SCHEMA_PROOF history {first}");
    assert_eq!(first.pointer("/rows/0/elapsedSeconds"), Some(&json!(31)));
    assert_eq!(first.pointer("/rows/0/state"), Some(&json!("closed")));
    request["after"] = first
        .get("nextCursor")
        .cloned()
        .ok_or(RuntimeError::NotFound)?;
    request["expectedVersion"] = first
        .get("version")
        .cloned()
        .ok_or(RuntimeError::NotFound)?;
    let second = read(&engine, "a", &request)?;
    assert_eq!(second.pointer("/rows/0/entryIndex"), Some(&json!(1)));
    assert_eq!(second.pointer("/rows/0/endedAt"), Some(&Value::Null));
    assert_eq!(second.pointer("/rows/0/state"), Some(&json!("running")));
    assert_eq!(second.get("nextCursor"), Some(&Value::Null));
    Ok(())
}

#[test]
fn tracking_invalid_cursors_limits_unknown_fields_and_numeric_overflow_fail() -> Result<()> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    for invalid in [
        json!({"kind":"tracking_sessions","at":"invalid"}),
        json!({"kind":"tracking_sessions","at":"2026-10-04T12:00:31Z","limit":0}),
        json!({"kind":"tracking_sessions","at":"2026-10-04T12:00:31Z","limit":129}),
        json!({"kind":"tracking_sessions","at":"2026-10-04T12:00:31Z","unknown":1}),
        json!({"kind":"tracking_sessions","at":"2026-10-04T12:00:31Z","after":{"taskPath":"Tasks/a.md","at":"2026-10-04T12:00:31Z"}}),
        json!({"kind":"tracking_sessions","at":"2026-10-04T12:00:31Z","expectedVersion":-1}),
    ] {
        assert!(engine.features_json("a", &invalid.to_string()).is_err());
    }
    assert!(engine.features_json("a",r#"{"kind":"tracking_sessions","at":"2026-10-04T12:00:31Z","expectedVersion":18446744073709551616}"#).is_err());
    Ok(())
}
