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

fn entry_objects(value: &Value) -> Result<Vec<serde_json::Map<String, Value>>> {
    value
        .as_array()
        .ok_or(RuntimeError::NotFound)?
        .iter()
        .cloned()
        .map(object)
        .collect()
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

fn canonical_entries() -> Value {
    json!([{"startTime":"2026-10-02T01:59:59Z","endTime":"2026-10-02T02:01:30Z","duration":777,"vendor":{"keep":true}}])
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
fn final_template_and_provider_defaults_choose_seed_and_entry_values() -> Result<()> {
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
            &json!([{"startTime":"2026-10-01T12:00:00Z","endTime":"2026-10-01T12:01:00Z","vendor":"template"}])
        )
    );
    assert!(document.body().contains("2026-10-03T01:02:03.456-03:00"));
    assert!(document.body().contains("Caller body"));
    Ok(())
}

#[test]
fn original_precision_ranges_and_multiple_active_entries_fail_on_every_explicit_route() -> Result<()>
{
    let invalid = [
        json!([{"startTime":"2026-10-01T00:00:00.9Z","endTime":"2026-10-01T00:00:00.8Z"}]),
        json!([{"startTime":"2026-10-01T00:00:00Z"},{"startTime":"2026-10-01T01:00:00Z"}]),
        json!([{"startTime":"2026-02-30T00:00:00Z"}]),
    ];
    for entries in invalid {
        let (engine, files) = standard(":memory:")?;
        assert!(matches!(
            engine.execute(
                "a",
                &mutation("bad-create", create(json!({"time_entries":entries}))?)
            ),
            Err(RuntimeError::Validation(_))
        ));
        assert_eq!(files.get("a", PATH)?, None);
        engine.execute("a", &mutation("create", create(json!({}))?))?;
        let original = files.get("a", PATH)?;
        let count = exchanges(&files)?;
        for (id, command) in [
            ("update", update(json!({"time_entries":entries}))?),
            (
                "edit",
                Command::EditTask {
                    path: PATH.into(),
                    expected_revision: None,
                    properties: object(json!({"time_entries":entries}))?,
                    body: Some("Replacement".into()),
                    status: None,
                    occurrence_date: None,
                },
            ),
            (
                "set",
                Command::SetTimeEntries {
                    path: PATH.into(),
                    expected_revision: None,
                    entries: entry_objects(&entries)?,
                },
            ),
        ] {
            assert!(
                matches!(
                    engine.execute("a", &mutation(id, command)),
                    Err(RuntimeError::Validation(_))
                ),
                "{id}"
            );
            assert_eq!(files.get("a", PATH)?, original);
            assert_eq!(exchanges(&files)?, count);
        }
    }
    Ok(())
}

#[test]
fn mapped_entries_editor_set_and_update_preserve_vendor_and_exact_noops() -> Result<()> {
    let (engine, files) = setup(":memory:", b"title:\n  storage: frontmatter\nmapping:\n  time_entries: tn_clock\n  recurrence: tn_rule\n  scheduled: tn_when\n")?;
    engine.execute("a", &mutation("create", create(json!({"time_entries":entries(),"recurrence":"FREQ=DAILY","scheduled":"2026-10-01"}))?))?;
    let document = doc(&files)?;
    assert_eq!(
        document.frontmatter().get("tn_clock"),
        Some(&canonical_entries())
    );
    assert_eq!(
        document.frontmatter().get("tn_rule"),
        Some(&json!("DTSTART:20261001;FREQ=DAILY"))
    );
    assert!(!document.frontmatter().contains_key("time_entries"));
    let original = files.get("a", PATH)?;
    let count = exchanges(&files)?;
    for (id, command) in [
        ("update", update(json!({"tn_clock":entries()}))?),
        (
            "edit",
            Command::EditTask {
                path: PATH.into(),
                expected_revision: None,
                properties: object(json!({"time_entries":entries()}))?,
                body: None,
                status: None,
                occurrence_date: None,
            },
        ),
        (
            "set",
            Command::SetTimeEntries {
                path: PATH.into(),
                expected_revision: None,
                entries: entry_objects(&entries())?,
            },
        ),
    ] {
        let receipt = engine.execute("a", &mutation(id, command))?;
        assert!(receipt.paths.is_empty(), "{id}");
        assert_eq!(files.get("a", PATH)?, original);
        assert_eq!(exchanges(&files)?, count);
    }
    Ok(())
}

#[test]
fn changed_mapped_editor_set_and_update_canonicalize_their_owned_role() -> Result<()> {
    for route in ["update", "edit", "set"] {
        let (engine, files) = setup(
            ":memory:",
            b"title:\n  storage: frontmatter\nmapping:\n  time_entries: tn_clock\n",
        )?;
        engine.execute("a", &mutation("create", create(json!({"vendor":"top"}))?))?;
        let command = match route {
            "update" => update(json!({"tn_clock":entries()}))?,
            "edit" => Command::EditTask {
                path: PATH.into(),
                expected_revision: None,
                properties: object(json!({"time_entries":entries()}))?,
                body: Some("Editor body\n".into()),
                status: None,
                occurrence_date: None,
            },
            _ => Command::SetTimeEntries {
                path: PATH.into(),
                expected_revision: None,
                entries: entry_objects(&entries())?,
            },
        };
        assert_eq!(
            engine.execute("a", &mutation(route, command))?.paths,
            [PATH]
        );
        let document = doc(&files)?;
        assert_eq!(
            document.frontmatter().get("tn_clock"),
            Some(&canonical_entries()),
            "{route}"
        );
        assert_eq!(document.frontmatter().get("vendor"), Some(&json!("top")));
        assert_eq!(
            document.body(),
            if route == "edit" {
                "Editor body\n"
            } else {
                "Caller body\n"
            }
        );
    }
    Ok(())
}

#[test]
fn explicit_null_removes_entries_and_bad_original_ranges_block_normalize() -> Result<()> {
    let (engine, files) = standard(":memory:")?;
    engine.execute(
        "a",
        &mutation("create", create(json!({"timeEntries":entries()}))?),
    )?;
    engine.execute(
        "a",
        &mutation("remove", update(json!({"time_entries":null}))?),
    )?;
    assert!(!doc(&files)?.frontmatter().contains_key("timeEntries"));
    let invalid = b"---\ntitle: Invalid\nstatus: open\ntags: [task]\ndateCreated: 2026-01-01T00:00:00Z\ntimeEntries: [{startTime: '2026-10-01T00:00:00.9Z', endTime: '2026-10-01T00:00:00.8Z'}]\n---\nBody\n";
    files.seed("a", PATH, invalid)?;
    assert!(matches!(
        engine.refresh("a"),
        Err(RuntimeError::Validation(_))
    ));
    let count = exchanges(&files)?;
    assert!(matches!(
        engine.execute(
            "a",
            &mutation(
                "normalize",
                Command::Normalize {
                    path: PATH.into(),
                    expected_revision: None
                }
            )
        ),
        Err(RuntimeError::Validation(_))
    ));
    assert_eq!(files.get("a", PATH)?, Some(invalid.to_vec()));
    assert_eq!(exchanges(&files)?, count);
    Ok(())
}

#[test]
fn interrupted_canonical_create_replays_original_seed_and_entries_after_reopen() -> Result<()> {
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
    assert_eq!(
        document.frontmatter().get("timeEntries"),
        Some(&canonical_entries())
    );
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
fn generated_start_stop_and_auto_stop_write_seconds_keep_clock_identity() -> Result<()> {
    for auto in [false, true] {
        let (engine, files) = standard(":memory:")?;
        engine.execute("a", &mutation("create", create(json!({}))?))?;
        let mut start = mutation(
            "start",
            Command::StartTime {
                path: PATH.into(),
                expected_revision: None,
            },
        );
        start.at = "2026-10-03T12:00:00.999999999Z".into();
        engine.execute("a", &start)?;
        assert_eq!(
            doc(&files)?.frontmatter().get("timeEntries"),
            Some(&json!([{"startTime":"2026-10-03T12:00:00Z"}]))
        );
        let command = if auto {
            Command::SetCompletion {
                path: PATH.into(),
                expected_revision: None,
                occurrence_date: None,
                completed: true,
            }
        } else {
            Command::StopTime {
                path: PATH.into(),
                expected_revision: None,
            }
        };
        let mut stop = mutation("stop", command);
        stop.at = "2026-10-03T14:01:30.123456789+02:00".into();
        engine.execute("a", &stop)?;
        assert_eq!(
            doc(&files)?.frontmatter().get("timeEntries"),
            Some(&json!([{"startTime":"2026-10-03T12:00:00Z","endTime":"2026-10-03T12:01:30Z"}]))
        );
        assert_eq!(engine.execute("a", &stop)?.mutation_id, stop.mutation_id);
        let mut different = stop.clone();
        different.at = "2026-10-03T12:01:30.123456789Z".into();
        assert!(matches!(
            engine.execute("a", &different),
            Err(RuntimeError::Validation(_))
        ));
    }
    Ok(())
}

#[test]
fn editor_auto_stop_compares_original_entry_precision_before_persisting() -> Result<()> {
    let (engine, files) = standard(":memory:")?;
    engine.execute("a", &mutation("create", create(json!({}))?))?;
    let original = files.get("a", PATH)?;
    let mut edit = mutation(
        "edit",
        Command::EditTask {
            path: PATH.into(),
            expected_revision: None,
            properties: object(json!({"timeEntries":[{"startTime":"2026-10-03T12:00:00.9Z"}]}))?,
            body: None,
            status: Some("done".into()),
            occurrence_date: None,
        },
    );
    edit.at = "2026-10-03T12:00:00.8Z".into();
    assert!(matches!(
        engine.execute("a", &edit),
        Err(RuntimeError::Validation(_))
    ));
    assert_eq!(files.get("a", PATH)?, original);
    Ok(())
}

#[test]
fn explicit_normalize_canonicalizes_entries_without_preview_alias_changes_and_preserves_noop()
-> Result<()> {
    let (engine, files) = standard(":memory:")?;
    let original = format!("---\n{}\n---\nOriginal\n", serde_json::to_string(&json!({"title":"Legacy","status":"open","tags":["task"],"dateCreated":"2026-01-01T00:00:00Z","dateModified":"2026-10-01T00:00:00Z","timeEntries":entries(),"vendor":"keep"}))?).into_bytes();
    files.seed("a", PATH, &original)?;
    engine.refresh("a")?;
    let command = Command::Normalize {
        path: PATH.into(),
        expected_revision: None,
    };
    engine.execute("a", &mutation("normalize", command.clone()))?;
    assert_eq!(
        doc(&files)?.frontmatter().get("timeEntries"),
        Some(&canonical_entries())
    );
    assert_eq!(doc(&files)?.body(), "Original\n");
    let canonical = files.get("a", PATH)?;
    let count = exchanges(&files)?;
    assert!(
        engine
            .execute("a", &mutation("again", command))?
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
        &mutation("create", create(json!({"time_entries":entries()}))?),
    )?;
    let document = doc(&files)?;
    assert_eq!(
        document.frontmatter().get("timeEntries"),
        Some(&canonical_entries())
    );
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
fn legacy_unknown_physical_snake_values_survive_normalize_start_and_stop() -> Result<()> {
    let (engine, files) = standard(":memory:")?;
    let original = format!("---\n{}\n---\nOriginal\n", serde_json::to_string(&json!({"title":"Legacy","status":"open","tags":["task"],"dateCreated":"2026-01-01T00:00:00Z","dateModified":"2026-10-01T00:00:00Z","timeEntries":entries(),"time_entries":"opaqueVendorValue","date_created":"opaqueCreatedVendor","date_modified":"opaqueModifiedVendor"}))?).into_bytes();
    files.seed("a", PATH, &original)?;
    engine.refresh("a")?;
    for (id, command) in [
        (
            "normalize",
            Command::Normalize {
                path: PATH.into(),
                expected_revision: None,
            },
        ),
        (
            "start",
            Command::StartTime {
                path: PATH.into(),
                expected_revision: None,
            },
        ),
        (
            "stop",
            Command::StopTime {
                path: PATH.into(),
                expected_revision: None,
            },
        ),
    ] {
        engine.execute("a", &mutation(id, command))?;
        let document = doc(&files)?;
        for (key, expected) in [
            ("time_entries", "opaqueVendorValue"),
            ("date_created", "opaqueCreatedVendor"),
            ("date_modified", "opaqueModifiedVendor"),
        ] {
            assert_eq!(
                document.frontmatter().get(key),
                Some(&json!(expected)),
                "{id}: {key}"
            );
        }
        assert_eq!(document.body(), "Original\n");
    }
    Ok(())
}

fn transition_setup(
    database: &str,
    physical: bool,
    auto_stop: bool,
) -> Result<(Engine, Arc<Memory>)> {
    let mapping = if physical {
        "mapping:\n  time_entries: tn_clock\n  status: tn_status\n"
    } else {
        ""
    };
    let settings = format!(
        "title:\n  storage: frontmatter\nvalidation:\n  mode: strict\ntime_tracking:\n  auto_stop_on_complete: {auto_stop}\n{mapping}"
    );
    let (engine, files) = setup(database, settings.as_bytes())?;
    engine.execute(
        "a",
        &mutation("create", create(json!({"vendor":"original"}))?),
    )?;
    Ok((engine, files))
}

fn transition_update(physical: bool, start: &str) -> Result<Command> {
    let mut properties = object(json!({"completedDate":"2026-10-03"}))?;
    properties.insert(
        if physical { "tn_status" } else { "status" }.into(),
        json!("done"),
    );
    properties.insert(
        if physical { "tn_clock" } else { "time_entries" }.into(),
        json!([{"startTime":start,"duration":777,"vendor":{"keep":true}}]),
    );
    update(Value::Object(properties))
}

fn invalid_update_alias_auto_stop(physical: bool) -> Result<()> {
    let (engine, files) = transition_setup(":memory:", physical, true)?;
    let original = files.get("a", PATH)?;
    let count = exchanges(&files)?;
    let uploads = engine.pending_uploads("a")?;
    let mut request = mutation(
        "complete",
        transition_update(physical, "2026-10-03T12:00:00.9Z")?,
    );
    request.at = "2026-10-03T12:00:00.8Z".into();
    let result = engine.execute("a", &request);
    assert!(
        matches!(&result, Err(RuntimeError::Validation(message)) if message.contains("invalid_time_range")),
        "physical={physical}: {result:?}"
    );
    assert_eq!(files.get("a", PATH)?, original);
    assert_eq!(exchanges(&files)?, count);
    assert_eq!(
        serde_json::to_value(engine.pending_uploads("a")?)?,
        serde_json::to_value(uploads)?
    );
    Ok(())
}

#[test]
fn update_alias_auto_stop_rejects_snake_entry_original_precision_before_effects() -> Result<()> {
    invalid_update_alias_auto_stop(false)
}

#[test]
fn update_alias_auto_stop_rejects_physical_entry_original_precision_before_effects() -> Result<()> {
    invalid_update_alias_auto_stop(true)
}

#[test]
fn update_alias_auto_stop_owns_new_entries_and_honors_explicit_disabled_policy() -> Result<()> {
    for physical in [false, true] {
        for auto_stop in [false, true] {
            let (engine, files) = transition_setup(":memory:", physical, auto_stop)?;
            let mut request = mutation(
                "complete",
                transition_update(physical, "2026-10-03T14:00:00.7+02:00")?,
            );
            request.at = "2026-10-03T12:00:00.8Z".into();
            engine.execute("a", &request)?;
            let key = if physical { "tn_clock" } else { "timeEntries" };
            let expected = if auto_stop {
                json!([{"startTime":"2026-10-03T12:00:00Z","endTime":"2026-10-03T12:00:00Z","duration":777,"vendor":{"keep":true}}])
            } else {
                json!([{"startTime":"2026-10-03T12:00:00Z","duration":777,"vendor":{"keep":true}}])
            };
            assert_eq!(
                doc(&files)?.frontmatter().get(key),
                Some(&expected),
                "physical={physical} auto_stop={auto_stop}"
            );
            assert_eq!(
                doc(&files)?.frontmatter().get("vendor"),
                Some(&json!("original"))
            );
        }
    }
    Ok(())
}

#[test]
fn update_alias_auto_stop_keeps_explicit_null_removal_and_rejects_duplicate_roles() -> Result<()> {
    for physical in [false, true] {
        let (engine, files) = transition_setup(":memory:", physical, true)?;
        engine.execute(
            "a",
            &mutation(
                "active",
                update(json!({"timeEntries":[{"startTime":"2026-10-03T10:00:00.7Z"}]}))?,
            ),
        )?;
        let original = files.get("a", PATH)?;
        let key = if physical { "tn_clock" } else { "time_entries" };
        let mut duplicate = object(json!({"timeEntries":[]}))?;
        duplicate.insert(key.into(), json!([]));
        assert!(matches!(
            engine.execute(
                "a",
                &mutation("duplicate", update(Value::Object(duplicate))?)
            ),
            Err(RuntimeError::Validation(_))
        ));
        assert_eq!(files.get("a", PATH)?, original);
        let mut removal = object(json!({"status":"done","completedDate":"2026-10-03"}))?;
        removal.insert(key.into(), Value::Null);
        engine.execute("a", &mutation("remove", update(Value::Object(removal))?))?;
        let stored_key = if physical { "tn_clock" } else { "timeEntries" };
        assert!(!doc(&files)?.frontmatter().contains_key(stored_key));
        assert_eq!(
            doc(&files)?.frontmatter().get("vendor"),
            Some(&json!("original"))
        );
    }
    Ok(())
}

#[test]
fn update_alias_auto_stop_unrelated_update_preserves_unwritten_fractional_history_and_vendor_aliases()
-> Result<()> {
    for physical in [false, true] {
        let (engine, files) = transition_setup(":memory:", physical, true)?;
        let document = doc(&files)?;
        let mut fields = document.frontmatter().clone();
        let key = if physical { "tn_clock" } else { "timeEntries" };
        fields.insert(key.into(), entries());
        fields.insert("time_entries".into(), json!("opaquePhysicalVendor"));
        let original = format!(
            "---\n{}\n---\nOriginal body\n",
            serde_json::to_string(&fields)?
        )
        .into_bytes();
        files.seed("a", PATH, &original)?;
        engine.refresh("a")?;
        engine.execute(
            "a",
            &mutation("unrelated", update(json!({"vendor":"changed"}))?),
        )?;
        let changed = doc(&files)?;
        assert_eq!(changed.frontmatter().get(key), Some(&entries()));
        assert_eq!(
            changed.frontmatter().get("time_entries"),
            Some(&json!("opaquePhysicalVendor"))
        );
        assert_eq!(changed.body(), "Original body\n");
    }
    Ok(())
}

#[test]
fn update_alias_auto_stop_reopens_replays_and_undo_restores_original_bytes() -> Result<()> {
    for physical in [false, true] {
        let directory =
            tempfile::tempdir().map_err(|error| RuntimeError::Storage(error.to_string()))?;
        let database = directory.path().join("update-auto-stop.sqlite");
        let database = database.to_str().ok_or(RuntimeError::NotFound)?;
        let (engine, files) = transition_setup(database, physical, true)?;
        let original = files.get("a", PATH)?;
        let mut request = mutation(
            "complete",
            transition_update(physical, "2026-10-03T12:00:00.7Z")?,
        );
        request.at = "2026-10-03T12:00:00.8Z".into();
        let receipt = engine.execute("a", &request)?;
        let saved = files.get("a", PATH)?;
        let count = exchanges(&files)?;
        drop(engine);
        let engine = Engine::open(database, files.clone())?;
        assert_eq!(
            serde_json::to_value(engine.execute("a", &request)?)?,
            serde_json::to_value(receipt)?
        );
        assert_eq!(exchanges(&files)?, count);
        let mut changed_identity = request.clone();
        changed_identity.at = "2026-10-03T12:00:00.9Z".into();
        assert!(matches!(
            engine.execute("a", &changed_identity),
            Err(RuntimeError::Validation(_))
        ));
        let mut noop = object(json!({"status":"done","completedDate":"2026-10-03"}))?;
        noop.insert(if physical { "tn_clock" } else { "time_entries" }.into(), json!([{"startTime":"2026-10-03T12:00:00Z","endTime":"2026-10-03T12:00:00Z","duration":777,"vendor":{"keep":true}}]));
        let mut noop = mutation("noop", update(Value::Object(noop))?);
        noop.at = "2026-10-04T12:00:00.123Z".into();
        assert!(engine.execute("a", &noop)?.paths.is_empty());
        assert_eq!(files.get("a", PATH)?, saved);
        assert_eq!(exchanges(&files)?, count);
        engine.execute(
            "a",
            &mutation(
                "undo",
                Command::Undo {
                    receipt_id: "complete".into(),
                },
            ),
        )?;
        assert_eq!(files.get("a", PATH)?, original);
    }
    Ok(())
}

#[test]
fn update_alias_auto_stop_obeys_stale_revision_and_provider_compare_exchange() -> Result<()> {
    for physical in [false, true] {
        let (engine, files) = transition_setup(":memory:", physical, true)?;
        let original = files.get("a", PATH)?;
        let count = exchanges(&files)?;
        let Command::Update {
            properties, body, ..
        } = transition_update(physical, "2026-10-03T12:00:00.7Z")?
        else {
            return Err(RuntimeError::NotFound);
        };
        let stale = Command::Update {
            path: PATH.into(),
            expected_revision: Some("stale".into()),
            properties,
            body,
        };
        assert!(matches!(
            engine.execute("a", &mutation("stale", stale)),
            Err(RuntimeError::Conflict)
        ));
        assert_eq!(files.get("a", PATH)?, original);
        assert_eq!(exchanges(&files)?, count);
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test lock".into()))?
            .racing_before_compare = Some(b"Foreign writer\n".to_vec());
        let mut request = mutation(
            "race",
            transition_update(physical, "2026-10-03T12:00:00.7Z")?,
        );
        request.at = "2026-10-03T12:00:00.8Z".into();
        assert!(matches!(
            engine.execute("a", &request),
            Err(RuntimeError::Conflict)
        ));
        assert_eq!(files.get("a", PATH)?, Some(b"Foreign writer\n".to_vec()));
        assert_eq!(exchanges(&files)?, count);
    }
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

#[test]
fn atomic_and_partial_batches_keep_invalid_precision_before_effects() -> Result<()> {
    for partial in [false, true] {
        let (engine, files) = standard(":memory:")?;
        engine.execute("a", &mutation("create", create(json!({}))?))?;
        let original = files.get("a", PATH)?;
        let commands = vec![
            update(json!({"timeEntries":entries()}))?,
            update(
                json!({"timeEntries":[{"startTime":"2026-10-01T00:00:00.9Z","endTime":"2026-10-01T00:00:00.8Z"}]}),
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
                doc(&files)?.frontmatter().get("timeEntries"),
                Some(&canonical_entries())
            );
            let outcome: Value = serde_json::from_str(
                &engine.features_json("a", r#"{"kind":"batch_outcome","mutationId":"batch"}"#)?,
            )?;
            assert_eq!(outcome.get("succeeded"), Some(&json!(1)));
            assert_eq!(outcome.get("failed"), Some(&json!(1)));
        } else {
            assert!(matches!(result, Err(RuntimeError::Validation(_))));
            assert_eq!(files.get("a", PATH)?, original);
        }
    }
    Ok(())
}
