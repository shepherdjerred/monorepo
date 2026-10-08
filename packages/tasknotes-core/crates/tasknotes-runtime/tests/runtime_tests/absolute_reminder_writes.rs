//! Canonical absolute reminder writes through actual `SQLite` and controlled file capability.

use super::*;
use tasknotes_vault::{document::TaskDocument, path::VaultPath};

const PATH: &str = "Tasks/reminder.md";

fn object(value: Value) -> Result<serde_json::Map<String, Value>> {
    match value {
        Value::Object(properties) => Ok(properties),
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

fn create(properties: Value) -> Result<Command> {
    let mut properties = object(properties)?;
    properties.insert("title".into(), json!("Reminder"));
    Ok(Command::Create {
        path: Some(PATH.into()),
        properties,
        body: Some("Caller body\n".into()),
    })
}

fn update(properties: Value) -> Result<Command> {
    Ok(Command::Update {
        path: PATH.into(),
        expected_revision: None,
        properties: object(properties)?,
        body: None,
    })
}

fn document(files: &Memory) -> Result<TaskDocument> {
    TaskDocument::parse(
        VaultPath::parse(PATH)?,
        &files.get("a", PATH)?.ok_or(RuntimeError::NotFound)?,
    )
    .map_err(Into::into)
}

fn reminders() -> Value {
    reminder_values("2026-10-01T23:59:59.999999999-02:00")
}

fn reminder_values(absolute_time: &str) -> Value {
    json!([
        {"id":"absolute","type":"absolute","absoluteTime":absolute_time,"description":"Exact","vendor":{"keep":true}},
        {"id":"relative","type":"relative","relatedTo":"due","offset":"-PT0.000000001S","vendor":{"relative":true}}
    ])
}

fn canonical_reminders() -> Value {
    reminder_values("2026-10-02T01:59:59Z")
}

#[test]
fn actual_sqlite_create_persists_absolute_utc_seconds_and_preserves_relative_and_vendor()
-> Result<()> {
    let (engine, files) = setup(
        ":memory:",
        b"title:\n  storage: frontmatter\nvalidation:\n  mode: strict\n",
    )?;
    engine.execute(
        "a",
        &mutation(
            "create",
            create(json!({"due":"2026-10-03","reminders":reminders()}))?,
        ),
    )?;
    assert_eq!(
        document(&files)?.frontmatter().get("reminders"),
        Some(&canonical_reminders())
    );
    assert_eq!(document(&files)?.body(), "Caller body\n");
    Ok(())
}

#[test]
fn configured_physical_create_and_normalize_leave_unknown_reminder_properties_opaque() -> Result<()>
{
    let (engine, files) = setup(
        ":memory:",
        b"title:\n  storage: frontmatter\nmapping:\n  reminders: alerts\n",
    )?;
    engine.execute("a", &mutation("create", create(json!({"due":"2026-10-03","alerts":reminders(),"vendor_reminders":{"absoluteTime":"opaque"}}))?))?;
    assert_eq!(
        document(&files)?.frontmatter().get("alerts"),
        Some(&canonical_reminders())
    );
    let original = format!("---\n{}\n---\nPhysical body\n", serde_json::to_string(&json!({"title":"Physical","status":"open","tags":["task"],"dateCreated":"2026-01-01T00:00:00Z","dateModified":"2026-01-01T00:00:00Z","due":"2026-10-03","alerts":reminders(),"vendor_reminders":{"absoluteTime":"opaque"}}))?).into_bytes();
    files.seed("a", PATH, &original)?;
    engine.refresh("a")?;
    engine.execute(
        "a",
        &mutation(
            "normalize",
            Command::Normalize {
                path: PATH.into(),
                expected_revision: None,
            },
        ),
    )?;
    assert_eq!(
        document(&files)?.frontmatter().get("alerts"),
        Some(&canonical_reminders())
    );
    assert_eq!(
        document(&files)?.frontmatter().get("vendor_reminders"),
        Some(&json!({"absoluteTime":"opaque"}))
    );
    assert_eq!(document(&files)?.body(), "Physical body\n");
    Ok(())
}

#[test]
fn invalid_historical_absolute_normalize_keeps_file_and_receipts_atomic() -> Result<()> {
    let (engine, files) = setup(":memory:", b"title:\n  storage: frontmatter\n")?;
    let original = b"---\ntitle: Legacy\nstatus: open\ntags: [task]\nreminders:\n  - id: bad\n    type: absolute\n    absoluteTime: '2026-02-30T12:00:00Z'\n---\nUnchanged body\n";
    files.seed("a", PATH, original)?;
    engine.refresh("a")?;
    let count = exchanges(&files)?;
    let pending = serde_json::to_value(engine.pending_uploads("a")?)?;
    assert!(matches!(
        engine.execute(
            "a",
            &mutation(
                "bad-normalize",
                Command::Normalize {
                    path: PATH.into(),
                    expected_revision: None
                }
            )
        ),
        Err(RuntimeError::Validation(_))
    ));
    assert_eq!(files.get("a", PATH)?, Some(original.to_vec()));
    assert_eq!(exchanges(&files)?, count);
    assert_eq!(serde_json::to_value(engine.pending_uploads("a")?)?, pending);
    // Failed validation does not reserve a mutation identity or persist a receipt.
    engine.execute(
        "a",
        &mutation(
            "bad-normalize",
            Command::Delete {
                path: PATH.into(),
                expected_revision: None,
            },
        ),
    )?;
    assert_eq!(files.get("a", PATH)?, None);
    Ok(())
}

fn exchanges(files: &Memory) -> Result<u64> {
    Ok(files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock".into()))?
        .exchanges)
}

#[test]
fn mapped_update_and_editor_canonicalize_explicit_reminders_and_keep_exact_noops() -> Result<()> {
    for route in ["semantic", "physical", "editor"] {
        let (engine, files) = setup(":memory:", b"title:\n  storage: frontmatter\nmapping:\n  reminders: alerts\nvalidation:\n  mode: strict\n")?;
        engine.execute(
            "a",
            &mutation(
                "create",
                create(json!({"due":"2026-10-03","vendor":"top"}))?,
            ),
        )?;
        let key = if route == "physical" {
            "alerts"
        } else {
            "reminders"
        };
        let mut properties = serde_json::Map::new();
        properties.insert(key.into(), reminders());
        let command = if route == "editor" {
            Command::EditTask {
                path: PATH.into(),
                expected_revision: None,
                properties,
                body: None,
                status: None,
                occurrence_date: None,
            }
        } else {
            update(Value::Object(properties))?
        };
        engine.execute("a", &mutation("write", command.clone()))?;
        assert_eq!(
            document(&files)?.frontmatter().get("alerts"),
            Some(&canonical_reminders()),
            "{route}"
        );
        assert_eq!(
            document(&files)?.frontmatter().get("vendor"),
            Some(&json!("top"))
        );
        assert_eq!(document(&files)?.body(), "Caller body\n");
        let original = files.get("a", PATH)?;
        let count = exchanges(&files)?;
        assert!(
            engine
                .execute("a", &mutation("noop", command))?
                .paths
                .is_empty()
        );
        assert_eq!(files.get("a", PATH)?, original);
        assert_eq!(exchanges(&files)?, count);
    }
    Ok(())
}

#[test]
fn final_defaults_and_template_reminders_preserve_original_clock_and_expansion_inputs() -> Result<()>
{
    for template in [false, true] {
        let mut settings = "title:\n  storage: frontmatter\ndefaults:\n  reminders:\n    - id: default\n      type: absolute\n      absoluteTime: '2026-10-01T23:59:59.123456789-02:00'\n".to_owned();
        if template {
            settings.push_str("templating:\n  enabled: true\n  template_path: Templates/task.md\n  failure_mode: error_abort\n");
        }
        let (engine, files) = setup(":memory:", settings.as_bytes())?;
        if template {
            files.seed("a", "Templates/task.md", b"---\nreminders:\n  - id: template\n    type: absolute\n    absoluteTime: '2026-10-02T04:05:06.999999999+03:00'\n    vendor: template\n---\n{{milliseconds}} | {{due}} | {{details}}\n")?;
            engine.refresh("a")?;
        }
        let mut request = mutation(
            "create",
            create(json!({"due":"2026-10-03T01:02:03.456-03:00"}))?,
        );
        request.at = "2026-10-03T12:00:00.987654321Z".into();
        engine.execute("a", &request)?;
        let fields = document(&files)?;
        let expected = if template {
            json!([{"id":"template","type":"absolute","absoluteTime":"2026-10-02T01:05:06Z","vendor":"template"}])
        } else {
            json!([{"id":"default","type":"absolute","absoluteTime":"2026-10-02T01:59:59Z"}])
        };
        assert_eq!(fields.frontmatter().get("reminders"), Some(&expected));
        if template {
            assert!(
                fields
                    .body()
                    .contains("987 | 2026-10-03T01:02:03.456-03:00 | Caller body")
            );
        }
        assert_eq!(
            fields.frontmatter().get("dateModified"),
            Some(&json!("2026-10-03T12:00:00Z"))
        );
        assert_eq!(
            engine.execute("a", &request)?.mutation_id,
            request.mutation_id
        );
        let mut changed_identity = request.clone();
        changed_identity.at = "2026-10-03T12:00:00.987654322Z".into();
        assert!(matches!(
            engine.execute("a", &changed_identity),
            Err(RuntimeError::Validation(_))
        ));
    }
    Ok(())
}

#[test]
fn invalid_explicit_absolute_shapes_and_times_fail_before_all_write_effects() -> Result<()> {
    for value in [
        json!("opaque"),
        json!([{"id":"r","type":"absolute"}]),
        json!([{"id":"r","type":"absolute","absoluteTime":null}]),
        json!([{"id":"r","type":"absolute","absoluteTime":42}]),
        json!([{"id":"r","type":"absolute","absoluteTime":"2026-02-30T12:00:00Z"}]),
        json!([{"id":"r","type":"absolute","absoluteTime":"2026-10-01"}]),
        json!([{"id":"r","type":"absolute","absoluteTime":"2026-10-01T12:00:00"}]),
    ] {
        let (engine, files) = setup(":memory:", b"title:\n  storage: frontmatter\n")?;
        assert!(matches!(
            engine.execute(
                "a",
                &mutation("bad-create", create(json!({"reminders":value}))?)
            ),
            Err(RuntimeError::Validation(_))
        ));
        assert_eq!(files.get("a", PATH)?, None);
        assert_eq!(exchanges(&files)?, 0);
        engine.execute("a", &mutation("create", create(json!({}))?))?;
        let original = files.get("a", PATH)?;
        let count = exchanges(&files)?;
        let pending = serde_json::to_value(engine.pending_uploads("a")?)?;
        for (id, command) in [
            ("update", update(json!({"reminders":value}))?),
            (
                "edit",
                Command::EditTask {
                    path: PATH.into(),
                    expected_revision: None,
                    properties: object(json!({"reminders":value}))?,
                    body: Some("Replace\n".into()),
                    status: None,
                    occurrence_date: None,
                },
            ),
        ] {
            assert!(
                matches!(
                    engine.execute("a", &mutation(id, command)),
                    Err(RuntimeError::Validation(_))
                ),
                "{id}: {value}"
            );
            assert_eq!(files.get("a", PATH)?, original);
            assert_eq!(exchanges(&files)?, count);
            assert_eq!(serde_json::to_value(engine.pending_uploads("a")?)?, pending);
        }
    }
    Ok(())
}

#[test]
fn explicit_null_removes_reminders_without_restoring_historical_entries() -> Result<()> {
    let (engine, files) = setup(
        ":memory:",
        b"title:\n  storage: frontmatter\nmapping:\n  reminders: alerts\n",
    )?;
    engine.execute(
        "a",
        &mutation(
            "create",
            create(json!({"reminders":reminders(),"due":"2026-10-03"}))?,
        ),
    )?;
    engine.execute("a", &mutation("remove", update(json!({"alerts":null}))?))?;
    assert!(!document(&files)?.frontmatter().contains_key("alerts"));
    engine.execute(
        "a",
        &mutation(
            "undo",
            Command::Undo {
                receipt_id: "remove".into(),
            },
        ),
    )?;
    assert_eq!(
        document(&files)?.frontmatter().get("alerts"),
        Some(&canonical_reminders())
    );
    Ok(())
}

fn seed_legacy(files: &Memory) -> Result<Vec<u8>> {
    let original = format!("---\n{}\n---\nOriginal body\n", serde_json::to_string(&json!({"title":"Legacy","status":"open","tags":["task"],"dateCreated":"2026-01-01T00:00:00Z","dateModified":"2026-01-01T00:00:00Z","due":"2026-10-03","reminders":reminders(),"vendor":{"nested":true}}))?).into_bytes();
    files.seed("a", PATH, &original)?;
    Ok(original)
}

#[test]
fn unrelated_update_and_editor_preserve_historical_absolute_nanos_and_relative_vendor_bytes()
-> Result<()> {
    let (engine, files) = setup(":memory:", b"title:\n  storage: frontmatter\n")?;
    seed_legacy(&files)?;
    engine.refresh("a")?;
    for (id, command) in [
        ("update", update(json!({"vendor":{"nested":false}}))?),
        (
            "editor",
            Command::EditTask {
                path: PATH.into(),
                expected_revision: None,
                properties: object(json!({"priority":"high"}))?,
                body: None,
                status: None,
                occurrence_date: None,
            },
        ),
    ] {
        engine.execute("a", &mutation(id, command))?;
        assert_eq!(
            document(&files)?.frontmatter().get("reminders"),
            Some(&reminders())
        );
        assert_eq!(document(&files)?.body(), "Original body\n");
    }
    Ok(())
}

#[test]
fn normalize_rewrites_only_absolute_instants_even_when_alias_preview_is_unchanged() -> Result<()> {
    let (engine, files) = setup(":memory:", b"title:\n  storage: frontmatter\n")?;
    let original = seed_legacy(&files)?;
    engine.refresh("a")?;
    assert_eq!(
        tasknotes_vault::migration_policy::preview(document(&files)?.frontmatter()).get("changed"),
        Some(&json!(false))
    );
    let command = Command::Normalize {
        path: PATH.into(),
        expected_revision: None,
    };
    engine.execute("a", &mutation("normalize", command.clone()))?;
    assert_eq!(
        document(&files)?.frontmatter().get("reminders"),
        Some(&canonical_reminders())
    );
    assert_eq!(
        document(&files)?.frontmatter().get("vendor"),
        Some(&json!({"nested":true}))
    );
    let canonical = files.get("a", PATH)?;
    let count = exchanges(&files)?;
    assert!(
        engine
            .execute("a", &mutation("noop", command))?
            .paths
            .is_empty()
    );
    assert_eq!(files.get("a", PATH)?, canonical);
    assert_eq!(exchanges(&files)?, count);
    engine.execute(
        "a",
        &mutation(
            "undo",
            Command::Undo {
                receipt_id: "normalize".into(),
            },
        ),
    )?;
    assert_eq!(files.get("a", PATH)?, Some(original));
    Ok(())
}

#[test]
fn absolute_write_reopens_replays_undo_and_fences_stale_and_racing_revisions() -> Result<()> {
    let directory =
        tempfile::tempdir().map_err(|error| RuntimeError::Storage(error.to_string()))?;
    let database = directory.path().join("reminders.sqlite");
    let database = database.to_str().ok_or(RuntimeError::NotFound)?;
    let (engine, files) = setup(database, b"title:\n  storage: frontmatter\n")?;
    let original = seed_legacy(&files)?;
    engine.refresh("a")?;
    let request = mutation("write", update(json!({"reminders":reminders()}))?);
    let receipt = engine.execute("a", &request)?;
    let saved = files.get("a", PATH)?;
    let count = exchanges(&files)?;
    drop(engine);
    let engine = Engine::open(database, files.clone())?;
    assert_eq!(
        serde_json::to_value(engine.execute("a", &request)?)?,
        serde_json::to_value(receipt)?
    );
    assert_eq!(files.get("a", PATH)?, saved);
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
        properties: object(json!({"reminders":reminders()}))?,
        body: None,
    };
    assert!(matches!(
        engine.execute("a", &mutation("stale", stale)),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(files.get("a", PATH)?, Some(original));
    files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock".into()))?
        .racing_before_compare = Some(b"Foreign writer\n".to_vec());
    assert!(matches!(
        engine.execute(
            "a",
            &mutation("race", update(json!({"reminders":reminders()}))?)
        ),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(files.get("a", PATH)?, Some(b"Foreign writer\n".to_vec()));
    Ok(())
}

#[test]
fn atomic_and_partial_reminder_batches_reject_invalid_absolute_time_before_effects() -> Result<()> {
    for partial in [false, true] {
        let (engine, files) = setup(":memory:", b"title:\n  storage: frontmatter\n")?;
        let original = seed_legacy(&files)?;
        engine.refresh("a")?;
        let commands = vec![
            update(json!({"reminders":reminders()}))?,
            update(
                json!({"reminders":[{"id":"bad","type":"absolute","absoluteTime":"2026-02-30T12:00:00Z"}]}),
            )?,
        ];
        let command = if partial {
            Command::BatchPartial { commands }
        } else {
            Command::Batch { commands }
        };
        let result = engine.execute("a", &mutation("batch", command));
        if partial {
            assert!(result?.applied);
            assert_eq!(
                document(&files)?.frontmatter().get("reminders"),
                Some(&canonical_reminders())
            );
            let outcome: Value = serde_json::from_str(
                &engine.features_json("a", r#"{"kind":"batch_outcome","mutationId":"batch"}"#)?,
            )?;
            assert_eq!(outcome.get("succeeded"), Some(&json!(1)));
            assert_eq!(outcome.get("failed"), Some(&json!(1)));
        } else {
            assert!(matches!(result, Err(RuntimeError::Validation(_))));
            assert_eq!(files.get("a", PATH)?, Some(original));
            assert_eq!(exchanges(&files)?, 0);
        }
    }
    Ok(())
}
