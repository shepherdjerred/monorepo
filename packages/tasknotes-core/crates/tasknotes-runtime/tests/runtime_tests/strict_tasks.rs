//! Actual mapped write validation and configured workflow transitions.

use super::{
    Arc, Command, Engine, Memory, Mutation, ProfileKind, Result, RuntimeError, Value, create, json,
    mutation, profile,
};

fn exchanges(files: &Memory) -> Result<u64> {
    Ok(files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test capability failed".to_owned()))?
        .exchanges)
}

fn editor(properties: Value, status: Option<&str>, expected: Option<String>) -> Result<Command> {
    let Value::Object(properties) = properties else {
        return Err(RuntimeError::NotFound);
    };
    Ok(Command::EditTask {
        path: "Tasks/a.md".to_owned(),
        expected_revision: expected,
        properties,
        body: Some("Edited body\n".to_owned()),
        status: status.map(str::to_owned),
        occurrence_date: None,
    })
}

#[test]
fn combined_editor_completion_commits_once_and_undo_restores_exact_original() -> Result<()> {
    let directory =
        tempfile::tempdir().map_err(|error| RuntimeError::Storage(error.to_string()))?;
    let database = directory.path().join("editor.db");
    let database = database.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    files.seed("a", "tasknotes.yaml", workflow())?;
    let engine = Engine::open(database, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    engine.execute(
        "a",
        &create_at("Tasks/a.md", &json!({"title":"Original","vendor":"kept"}))?,
    )?;
    engine.execute(
        "a",
        &mutation(
            "timer",
            Command::StartTime {
                path: "Tasks/a.md".to_owned(),
                expected_revision: None,
            },
        ),
    )?;
    let original = files
        .get("a", "Tasks/a.md")?
        .ok_or(RuntimeError::NotFound)?;
    let expected = tasknotes_vault::document::ContentRevision::of(&original)
        .as_str()
        .to_owned();
    let count = exchanges(&files)?;
    let mut request = mutation(
        "edit-finish",
        editor(
            json!({"title":"Edited","contexts":["home"]}),
            Some("finished"),
            Some(expected),
        )?,
    );
    request.at = "2026-10-03T12:02:00Z".to_owned();
    let receipt = engine.execute("a", &request)?;
    assert!(receipt.applied);
    assert_eq!(receipt.paths, vec!["Tasks/a.md"]);
    assert_eq!(exchanges(&files)?, count + 1);
    let snapshot = engine.snapshot("a", &super::Query::default())?;
    let task = snapshot.tasks.first().ok_or(RuntimeError::NotFound)?;
    assert_eq!(task.status, "finished");
    assert_eq!(task.properties.get("title"), Some(&json!("Edited")));
    assert_eq!(task.properties.get("contexts"), Some(&json!(["home"])));
    assert_eq!(task.properties.get("vendor"), Some(&json!("kept")));
    assert_eq!(
        task.properties.get("completedDate"),
        Some(&json!("2026-10-03"))
    );
    assert_eq!(task.body, "Edited body\n");
    assert!(!task.has_active_time_session);
    assert_eq!(task.total_tracked_minutes, 2);
    drop(engine);
    let engine = Engine::open(database, files.clone())?;
    assert_eq!(
        serde_json::to_value(engine.execute("a", &request)?)?,
        serde_json::to_value(receipt)?
    );
    assert_eq!(exchanges(&files)?, count + 1);
    engine.execute(
        "a",
        &mutation(
            "undo-editor",
            Command::Undo {
                receipt_id: request.mutation_id,
            },
        ),
    )?;
    assert_eq!(files.get("a", "Tasks/a.md")?, Some(original));
    Ok(())
}

#[test]
fn combined_editor_failure_and_stale_fence_publish_no_partial_changes() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed("a", "tasknotes.yaml", workflow())?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    engine.execute("a", &create_at("Tasks/a.md", &json!({"title":"Original"}))?)?;
    let original = files.get("a", "Tasks/a.md")?;
    let count = exchanges(&files)?;
    for (id, properties) in [
        ("invalid-detection", json!({"tags":[]})),
        ("duplicate-status", json!({"state":"queued"})),
        ("invalid-time", json!({"dateCreated":"future"})),
    ] {
        assert!(matches!(
            engine.execute(
                "a",
                &mutation(id, editor(properties, Some("finished"), None)?)
            ),
            Err(RuntimeError::Validation(_))
        ));
        assert_eq!(files.get("a", "Tasks/a.md")?, original);
        assert_eq!(exchanges(&files)?, count);
    }
    assert!(matches!(
        engine.execute(
            "a",
            &mutation(
                "stale",
                editor(
                    json!({"title":"stale"}),
                    Some("finished"),
                    Some("0".repeat(64))
                )?
            )
        ),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(files.get("a", "Tasks/a.md")?, original);
    assert_eq!(exchanges(&files)?, count);
    Ok(())
}

#[test]
fn incomplete_existing_note_requires_explicit_known_metadata_repair() -> Result<()> {
    let files = Arc::new(Memory::default());
    let original =
        b"---\ntitle: Legacy\nstatus: todo\ntags: [task]\nvendor: untouched\n---\nOriginal\n";
    files.seed("a", "Tasks/a.md", original)?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    assert!(matches!(
        engine.execute(
            "a",
            &mutation(
                "incomplete-edit",
                editor(json!({"contexts":["home"]}), None, None)?
            )
        ),
        Err(RuntimeError::Validation(_))
    ));
    assert_eq!(files.get("a", "Tasks/a.md")?, Some(original.to_vec()));
    assert_eq!(exchanges(&files)?, 0);
    engine.execute(
        "a",
        &mutation(
            "explicit-repair",
            editor(
                json!({"dateCreated":"2025-01-02T08:00:00Z","contexts":["home"]}),
                Some("done"),
                None,
            )?,
        ),
    )?;
    let snapshot = engine.snapshot("a", &super::Query::default())?;
    let task = snapshot.tasks.first().ok_or(RuntimeError::NotFound)?;
    assert_eq!(
        task.properties.get("dateCreated"),
        Some(&json!("2025-01-02T08:00:00Z"))
    );
    assert_eq!(task.properties.get("vendor"), Some(&json!("untouched")));
    assert_eq!(task.status, "done");
    assert_eq!(exchanges(&files)?, 1);
    Ok(())
}

#[test]
fn editor_transition_uses_staged_recurrence_and_time_entries() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed("a", "tasknotes.yaml", workflow())?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    engine.execute("a", &create_at("Tasks/a.md", &json!({"title":"Original"}))?)?;
    let mut command = editor(
        json!({"recurrence":"FREQ=DAILY","scheduled":"2026-10-01","timeEntries":[{"startTime":"2026-10-03T12:00:00Z","vendor":"preserved"}]}),
        Some("finished"),
        None,
    )?;
    if let Command::EditTask {
        occurrence_date, ..
    } = &mut command
    {
        *occurrence_date = Some("2026-10-02".to_owned());
    }
    let mut request = mutation("staged-occurrence", command);
    request.at = "2026-10-03T12:02:00Z".to_owned();
    let count = exchanges(&files)?;
    engine.execute("a", &request)?;
    let snapshot = engine.snapshot("a", &super::Query::default())?;
    let task = snapshot.tasks.first().ok_or(RuntimeError::NotFound)?;
    assert_eq!(task.status, "queued");
    assert_eq!(
        task.properties.get("completeInstances"),
        Some(&json!(["2026-10-02"]))
    );
    assert_eq!(task.properties.get("scheduled"), Some(&json!("2026-10-03")));
    assert!(!task.has_active_time_session);
    assert_eq!(task.total_tracked_minutes, 2);
    assert_eq!(
        task.properties
            .get("timeEntries")
            .and_then(Value::as_array)
            .and_then(|entries| entries.first())
            .and_then(|entry| entry.get("vendor")),
        Some(&json!("preserved"))
    );
    assert_eq!(exchanges(&files)?, count + 1);
    Ok(())
}

#[test]
fn conformance_reports_actual_readiness_without_provider_io_or_incomplete_profile_claims()
-> Result<()> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    let mut waiting = profile(ProfileKind::ObsidianSync);
    waiting.approve_standard = false;
    waiting.id = "waiting".to_owned();
    engine.register_profile(waiting)?;
    let reading = |engine: &Engine, id: &str| -> Result<Value> {
        Ok(serde_json::from_str(
            &engine.features_json(id, r#"{"kind":"conformance"}"#)?,
        )?)
    };
    let before = files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock".to_owned()))?
        .reads;
    let claim = reading(&engine, "waiting")?;
    assert_eq!(claim.get("profiles"), Some(&json!([])));
    assert_eq!(
        claim.get("capabilities"),
        Some(&json!(["batch", "concurrency", "time-tracking"]))
    );
    assert_eq!(
        claim
            .get("configurationProviders")
            .and_then(|value| value.get("state")),
        Some(&json!("waiting"))
    );
    for (registry, claims) in [
        ("profileReadiness", "profiles"),
        ("capabilityReadiness", "capabilities"),
    ] {
        let reported = claim
            .get(claims)
            .and_then(Value::as_array)
            .ok_or(RuntimeError::NotFound)?;
        for entry in claim
            .get(registry)
            .and_then(Value::as_array)
            .ok_or(RuntimeError::NotFound)?
        {
            let name = entry.get("name").ok_or(RuntimeError::NotFound)?;
            let missing = entry
                .get("missing")
                .and_then(Value::as_array)
                .ok_or(RuntimeError::NotFound)?;
            assert_eq!(reported.contains(name), missing.is_empty());
            assert_eq!(entry.get("implemented"), Some(&json!(missing.is_empty())));
        }
    }
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test lock".to_owned()))?
            .reads,
        before
    );
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let before = files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock".to_owned()))?
        .reads;
    let claim = reading(&engine, "a")?;
    assert_eq!(
        claim
            .get("configurationProviders")
            .and_then(|value| value.get("selected")),
        Some(&json!("standard"))
    );
    assert_eq!(
        claim
            .get("configurationProviders")
            .and_then(|value| value.get("available")),
        Some(&json!(["standard"]))
    );
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test lock".to_owned()))?
            .reads,
        before
    );
    Ok(())
}

#[test]
fn undo_eligibility_is_durable_lifo_and_excludes_noop_and_waiting_profiles() -> Result<()> {
    let directory = tempfile::tempdir()
        .map_err(|_| RuntimeError::Storage("test directory missing".to_owned()))?;
    let database = directory.path().join("undo.db");
    let database = database
        .to_str()
        .ok_or_else(|| RuntimeError::Storage("test path invalid".to_owned()))?;
    let files = Arc::new(Memory::default());
    let engine = Engine::open(database, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    for path in ["Tasks/a.md", "Tasks/b.md"] {
        engine.execute("a", &create_at(path, &json!({"title":path}))?)?;
    }
    let available = |engine: &Engine| -> Result<Value> {
        Ok(serde_json::from_str(
            &engine.features_json("a", r#"{"kind":"undo_available"}"#)?,
        )?)
    };
    assert_eq!(
        available(&engine)?.get("receiptId"),
        Some(&json!("create:Tasks/b.md"))
    );
    let baseline = exchanges(&files)?;
    let old = mutation(
        "undo-old",
        Command::Undo {
            receipt_id: "create:Tasks/a.md".to_owned(),
        },
    );
    assert!(matches!(
        engine.execute("a", &old),
        Err(RuntimeError::Conflict)
    ));
    assert_eq!(exchanges(&files)?, baseline);
    let latest = mutation(
        "undo-latest",
        Command::Undo {
            receipt_id: "create:Tasks/b.md".to_owned(),
        },
    );
    engine.execute("a", &latest)?;
    assert_eq!(files.get("a", "Tasks/b.md")?, None);
    drop(engine);
    let engine = Engine::open(database, files.clone())?;
    assert_eq!(
        available(&engine)?.get("receiptId"),
        Some(&json!("create:Tasks/a.md"))
    );
    assert!(engine.execute("a", &latest)?.applied);
    assert_eq!(exchanges(&files)?, baseline + 1);
    let noop = mutation(
        "no-op",
        Command::Update {
            path: "Tasks/a.md".to_owned(),
            expected_revision: None,
            properties: serde_json::Map::new(),
            body: None,
        },
    );
    engine.execute("a", &noop)?;
    assert_eq!(
        available(&engine)?.get("receiptId"),
        Some(&json!("create:Tasks/a.md"))
    );
    assert!(matches!(
        engine.execute(
            "a",
            &mutation(
                "undo-no-op",
                Command::Undo {
                    receipt_id: noop.mutation_id
                }
            )
        ),
        Err(RuntimeError::Conflict)
    ));
    let mut waiting = profile(ProfileKind::ObsidianSync);
    waiting.id = "waiting".to_owned();
    waiting.approve_standard = false;
    engine.register_profile(waiting)?;
    let empty: Value =
        serde_json::from_str(&engine.features_json("waiting", r#"{"kind":"undo_available"}"#)?)?;
    assert_eq!(
        empty,
        json!({"schemaVersion":1,"canUndo":false,"receiptId":null,"at":null,"commandKind":null})
    );
    Ok(())
}

#[test]
fn explicit_closed_schema_rejects_unknown_fields_without_discarding_them() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed(
        "a",
        "tasknotes.yaml",
        b"validation:\n  mode: strict\n  reject_unknown_fields: true\n",
    )?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    assert!(matches!(
        engine.execute("a", &mutation("unknown", create())),
        Err(RuntimeError::Validation(_))
    ));
    assert_eq!(files.get("a", "Tasks/a.md")?, None);
    assert_eq!(exchanges(&files)?, 0);
    engine.execute("a", &create_at("Tasks/a.md", &json!({"title":"Known"}))?)?;
    let saved = files.get("a", "Tasks/a.md")?;
    let count = exchanges(&files)?;
    let request = mutation(
        "unknown-patch",
        Command::Update {
            path: "Tasks/a.md".to_owned(),
            expected_revision: None,
            properties: json!({"vendor":"retain-me"})
                .as_object()
                .cloned()
                .ok_or_else(|| RuntimeError::Storage("test properties missing".to_owned()))?,
            body: None,
        },
    );
    assert!(matches!(
        engine.execute("a", &request),
        Err(RuntimeError::Validation(_))
    ));
    assert_eq!(files.get("a", "Tasks/a.md")?, saved);
    assert_eq!(exchanges(&files)?, count);
    Ok(())
}

#[test]
fn strict_task_writes_reject_inconsistent_and_unidentified_results_before_publication() -> Result<()>
{
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("create", create()))?;
    let original = files.get("a", "Tasks/a.md")?;
    let count = exchanges(&files)?;
    for (index, properties) in [
        json!({"status":"done"}),
        json!({"dateCreated":null}),
        json!({"dateCreated":"2026-10-04T12:00:00Z"}),
        json!({"tags":["saved"]}),
    ]
    .into_iter()
    .enumerate()
    {
        let id = format!("invalid-{index}");
        let request = mutation(
            &id,
            Command::Update {
                path: "Tasks/a.md".to_owned(),
                expected_revision: None,
                properties: properties
                    .as_object()
                    .cloned()
                    .ok_or_else(|| RuntimeError::Storage("test properties missing".to_owned()))?,
                body: None,
            },
        );
        assert!(matches!(
            engine.execute("a", &request),
            Err(RuntimeError::Validation(_))
        ));
        assert_eq!(files.get("a", "Tasks/a.md")?, original);
        assert_eq!(exchanges(&files)?, count);
        let state: Value = serde_json::from_str(&engine.features_json(
            "a",
            &json!({"kind":"mutation_receipt","mutationId":id}).to_string(),
        )?)?;
        assert_eq!(state.get("state"), Some(&json!("absent")));
    }
    Ok(())
}

#[test]
fn semantic_noop_keeps_source_timestamp_and_pending_receipts_unchanged() -> Result<()> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("create", create()))?;
    let original = files.get("a", "Tasks/a.md")?;
    let count = exchanges(&files)?;
    let mut request = mutation(
        "no-change",
        Command::Update {
            path: "Tasks/a.md".to_owned(),
            expected_revision: None,
            properties: json!({"vendor":"001"})
                .as_object()
                .cloned()
                .ok_or_else(|| RuntimeError::Storage("test properties missing".to_owned()))?,
            body: Some("Body\n".to_owned()),
        },
    );
    request.at = "2026-10-04T12:00:00Z".to_owned();
    let receipt = engine.execute("a", &request)?;
    assert!(receipt.applied);
    assert_eq!(receipt.paths, Vec::<String>::new());
    assert_eq!(files.get("a", "Tasks/a.md")?, original);
    assert_eq!(exchanges(&files)?, count);
    assert_eq!(engine.pending_upload_metadata("a")?.len(), 1);
    Ok(())
}

fn workflow() -> &'static [u8] {
    b"title:\n  storage: frontmatter\nmapping:\n  status: state\n  date_created: born\n  date_modified: changed\n  completed_date: settled\nstatus:\n  values: [queued, finished, cancelled]\n  completed_values: [finished]\n  default: queued\ntime_tracking:\n  auto_stop_on_complete: true\n"
}

fn create_at(path: &str, properties: &Value) -> Result<Mutation> {
    Ok(mutation(
        &format!("create:{path}"),
        Command::Create {
            path: Some(path.to_owned()),
            properties: properties
                .as_object()
                .cloned()
                .ok_or_else(|| RuntimeError::Storage("test properties missing".to_owned()))?,
            body: None,
        },
    ))
}

#[test]
fn configured_status_completion_stops_only_its_own_task_and_is_idempotent() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed("a", "tasknotes.yaml", workflow())?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    for path in ["Tasks/a.md", "Tasks/b.md"] {
        engine.execute(
            "a",
            &create_at(path, &json!({"title":path,"vendor":"kept"}))?,
        )?;
        engine.execute(
            "a",
            &mutation(
                &format!("start:{path}"),
                Command::StartTime {
                    path: path.to_owned(),
                    expected_revision: None,
                },
            ),
        )?;
    }
    let mut complete = mutation(
        "finish",
        Command::SetStatus {
            path: "Tasks/a.md".to_owned(),
            expected_revision: None,
            status: "finished".to_owned(),
            occurrence_date: None,
        },
    );
    complete.at = "2026-10-03T12:02:00Z".to_owned();
    engine.execute("a", &complete)?;
    let snapshot = engine.snapshot("a", &super::Query::default())?;
    let task = snapshot
        .tasks
        .iter()
        .find(|task| task.path == "Tasks/a.md")
        .ok_or(RuntimeError::NotFound)?;
    assert_eq!(task.status, "finished");
    assert_eq!(
        task.properties.get("completedDate"),
        Some(&json!("2026-10-03"))
    );
    assert_eq!(task.properties.get("vendor"), Some(&json!("kept")));
    assert!(!task.has_active_time_session);
    assert_eq!(task.total_tracked_minutes, 2);
    assert!(
        snapshot
            .tasks
            .iter()
            .find(|task| task.path == "Tasks/b.md")
            .ok_or(RuntimeError::NotFound)?
            .has_active_time_session
    );
    let saved = files.get("a", "Tasks/a.md")?;
    let count = exchanges(&files)?;
    complete.mutation_id = "already-finished".to_owned();
    complete.at = "2026-10-04T13:00:00Z".to_owned();
    assert_eq!(engine.execute("a", &complete)?.paths, Vec::<String>::new());
    assert_eq!(files.get("a", "Tasks/a.md")?, saved);
    assert_eq!(exchanges(&files)?, count);
    Ok(())
}

#[test]
fn recurring_board_status_uses_projected_day_without_rewriting_parent_workflow() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed("a", "tasknotes.yaml", workflow())?;
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    engine.execute(
        "a",
        &create_at(
            "Tasks/recur.md",
            &json!({"title":"Recurring","recurrence":"FREQ=DAILY","scheduled":"2026-10-01"}),
        )?,
    )?;
    for (id, status, completed) in [
        ("finish-occurrence", "finished", true),
        ("reopen-occurrence", "queued", false),
    ] {
        engine.execute(
            "a",
            &mutation(
                id,
                Command::SetStatus {
                    path: "Tasks/recur.md".to_owned(),
                    expected_revision: None,
                    status: status.to_owned(),
                    occurrence_date: Some("2026-10-02".to_owned()),
                },
            ),
        )?;
        let snapshot = engine.snapshot("a", &super::Query::default())?;
        let task = snapshot.tasks.first().ok_or(RuntimeError::NotFound)?;
        assert_eq!(task.status, "queued");
        assert_eq!(
            task.properties.get("completeInstances"),
            Some(&if completed {
                json!(["2026-10-02"])
            } else {
                json!([])
            })
        );
    }
    Ok(())
}
