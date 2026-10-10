//! Production policy persistence through actual `SQLite` and the file boundary.

use super::{
    Arc, Command, Engine, Memory, ProfileKind, Query, RuntimeError, json, mutation, profile,
};
type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;
const PLUGIN: &str = ".obsidian/plugins/tasknotes/data.json";

#[test]
fn plugin_workflow_preserves_negative_order_stable_ties_and_signed_zero() -> Result<()> {
    let files = Arc::new(Memory::default());
    let settings = json!({"customStatuses":[
        {"id":"zero-first","value":"first","label":"First","color":"#abc","isCompleted":false,"order":-0.0},
        {"id":"last","value":"last","label":"Last","color":"#abc","isCompleted":true,"order":3},
        {"id":"negative","value":"negative","label":"Negative","color":"#abc","isCompleted":false,"order":-2},
        {"id":"zero-second","value":"second","label":"Second","color":"#abc","isCompleted":false,"order":0.0}]});
    files.seed("a", PLUGIN, &serde_json::to_vec(&settings)?)?;
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    let snapshot = engine.refresh("a")?;
    let cached = snapshot
        .configuration
        .get("statuses")
        .and_then(serde_json::Value::as_array)
        .ok_or(RuntimeError::NotFound)?;
    assert_eq!(
        cached
            .iter()
            .filter_map(|status| status.get("value").and_then(serde_json::Value::as_str))
            .collect::<Vec<_>>(),
        vec!["negative", "first", "second", "last"]
    );
    let config = tasknotes_vault::config::TaskNotesConfiguration::resolve(
        Some(&serde_json::to_vec(&settings)?),
        None,
        false,
    )?;
    assert_eq!(
        config
            .statuses
            .iter()
            .map(|status| status.value.as_str())
            .collect::<Vec<_>>(),
        vec!["negative", "first", "second", "last"]
    );
    assert_eq!(config.next_status("first")?, "second");
    assert_eq!(config.next_status("last")?, "negative");
    assert!(
        config
            .statuses
            .get(1)
            .ok_or(RuntimeError::NotFound)?
            .order
            .is_sign_negative()
    );
    Ok(())
}

#[test]
fn multiple_uuid_creates_require_distinct_caller_mutations_before_any_effect() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed(
        "a",
        PLUGIN,
        br#"{"tasksFolder":"Tasks","storeTitleInFilename":false,"taskFilenameFormat":"uuid"}"#,
    )?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let first = create_title("ignored", "First").command;
    let second = create_title("ignored", "Second").command;
    let batch = mutation(
        "41a22c1a-ff49-4c39-99b1-010203040506",
        Command::Batch {
            commands: vec![first.clone(), second.clone()],
        },
    );
    assert!(
        matches!(engine.execute("a",&batch),Err(RuntimeError::Validation(message)) if message.contains("separate caller-owned"))
    );
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("lock".into()))?
            .exchanges,
        0
    );
    for (id, command) in [
        ("41a22c1a-ff49-4c39-99b1-010203040506", first),
        ("41a22c1a-ff49-4c39-99b1-010203040507", second),
    ] {
        let request = mutation(id, command);
        let receipt = engine.execute("a", &request)?;
        assert_eq!(receipt.task_path, Some(format!("Tasks/{id}.md")));
        assert_eq!(json!(engine.execute("a", &request)?), json!(receipt));
    }
    Ok(())
}

fn create_title(id: &str, title: &str) -> super::Mutation {
    mutation(
        id,
        Command::Create {
            path: None,
            properties: serde_json::Map::from_iter([("title".into(), json!(title))]),
            body: Some("caller body".into()),
        },
    )
}
fn configured(files: &Memory, template: bool) -> Result<()> {
    files.seed("a",PLUGIN,if template{br#"{"tasksFolder":"Tasks","storeTitleInFilename":true,"taskCreationDefaults":{"useBodyTemplate":true,"bodyTemplate":"Templates/Default.md"}}"#}else{br#"{"tasksFolder":"Tasks","storeTitleInFilename":true}"#})?;
    Ok(())
}
fn warning(receipt: &tasknotes_runtime::types::Receipt) -> serde_json::Value {
    json!(receipt.diagnostics)
}

#[test]
fn missing_and_invalid_templates_warn_but_provider_failures_abort() -> Result<()> {
    for (id, bytes, expected) in [
        ("missing", None, "template_missing"),
        (
            "invalid",
            Some(b"---\nbroken: [\n---\n".as_slice()),
            "template_parse_failed",
        ),
    ] {
        let files = Arc::new(Memory::default());
        configured(&files, true)?;
        if let Some(bytes) = bytes {
            files.seed("a", "Templates/Default.md", bytes)?;
        }
        let engine = Engine::open(":memory:", files.clone())?;
        engine.register_profile(profile(ProfileKind::LocalFolder))?;
        engine.refresh("a")?;
        let receipt = engine.execute("a", &create_title(id, "A/B"))?;
        assert_eq!(warning(&receipt), json!([{ "code":expected }]));
        let bytes = files
            .get("a", "Tasks/AB.md")?
            .ok_or(RuntimeError::NotFound)?;
        assert!(std::str::from_utf8(&bytes)?.ends_with("caller body"));
    }
    let files = Arc::new(Memory::default());
    configured(&files, true)?;
    files.seed("a", "Templates/Default.md", b"body")?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("lock".into()))?
        .fail_read = Some("Templates/Default.md".into());
    assert!(matches!(
        engine.execute("a", &create_title("provider", "Title")),
        Err(RuntimeError::Host(_))
    ));
    assert_eq!(files.get("a", "Tasks/Title.md")?, None);
    Ok(())
}

#[test]
fn fallback_diagnostics_survive_exchange_failure_reopen_and_changed_template() -> Result<()> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("diagnostics.db");
    let path = path.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    configured(&files, true)?;
    let engine = Engine::open(path, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let request = create_title("durable-warning", &"😀".repeat(90));
    files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("lock".into()))?
        .crash_after_exchange = true;
    assert!(matches!(
        engine.execute("a", &request),
        Err(RuntimeError::Host(_))
    ));
    engine.close()?;
    drop(engine);
    files.seed("a", "Templates/Default.md", b"replacement template")?;
    let engine = Engine::open(path, files.clone())?;
    let receipt = engine.execute("a", &request)?;
    assert_eq!(
        warning(&receipt),
        json!([{ "code":"template_missing" },{ "code":"filename_shortened" }])
    );
    assert_eq!(json!(engine.execute("a", &request)?), json!(receipt));
    let response: serde_json::Value = serde_json::from_str(&engine.features_json(
        "a",
        r#"{"kind":"mutation_receipt","mutationId":"durable-warning"}"#,
    )?)?;
    println!(
        "FACET_RECEIPT_WIRE {}",
        response.get("receipt").ok_or(RuntimeError::NotFound)?
    );
    let actual = files
        .get(
            "a",
            receipt.task_path.as_deref().ok_or(RuntimeError::NotFound)?,
        )?
        .ok_or(RuntimeError::NotFound)?;
    assert!(std::str::from_utf8(&actual)?.ends_with("caller body"));
    Ok(())
}

#[test]
fn corrupt_pending_diagnostics_fail_before_more_file_effects() -> Result<()> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("corrupt.db");
    let path = path.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    configured(&files, true)?;
    let engine = Engine::open(path, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let request = create_title("corrupt-warning", "A/B");
    files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("lock".into()))?
        .crash_after_exchange = true;
    assert!(matches!(
        engine.execute("a", &request),
        Err(RuntimeError::Host(_))
    ));
    engine.close()?;
    drop(engine);
    let db = rusqlite::Connection::open(path)?;
    db.execute(
        "UPDATE journals SET diagnostics='[{\"code\":\"unknown\"}]' WHERE id='corrupt-warning'",
        [],
    )?;
    let exchanges = files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("lock".into()))?
        .exchanges;
    let engine = Engine::open(path, files.clone())?;
    assert!(matches!(
        engine.execute("a", &request),
        Err(RuntimeError::Storage(_))
    ));
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("lock".into()))?
            .exchanges,
        exchanges
    );
    Ok(())
}

#[test]
fn lossy_title_policy_survives_body_refresh_reopen_rename_and_exact_undo() -> Result<()> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("title.db");
    let path = path.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    configured(&files, false)?;
    let engine = Engine::open(path, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    engine.execute("a", &create_title("lossy-create", "A/B"))?;
    assert_eq!(
        engine.snapshot("a", &Query::default())?.tasks[0].title,
        "A/B"
    );
    let mut original = files
        .get("a", "Tasks/AB.md")?
        .ok_or(RuntimeError::NotFound)?;
    original.extend_from_slice(b"\nexternal body");
    files.seed("a", "Tasks/AB.md", &original)?;
    engine.refresh("a")?;
    assert_eq!(
        engine.snapshot("a", &Query::default())?.tasks[0].title,
        "A/B"
    );
    engine.close()?;
    drop(engine);
    let engine = Engine::open(path, files.clone())?;
    assert_eq!(
        engine.snapshot("a", &Query::default())?.tasks[0].title,
        "A/B"
    );
    let edit = mutation(
        "lossy-rename",
        Command::Update {
            path: "Tasks/AB.md".into(),
            expected_revision: None,
            properties: serde_json::Map::from_iter([("title".into(), json!("C/D"))]),
            body: None,
        },
    );
    let receipt = engine.execute("a", &edit)?;
    assert_eq!(receipt.task_path.as_deref(), Some("Tasks/CD.md"));
    assert_eq!(
        engine.snapshot("a", &Query::default())?.tasks[0].title,
        "C/D"
    );
    engine.execute(
        "a",
        &mutation(
            "lossy-undo",
            Command::Undo {
                receipt_id: receipt.mutation_id,
            },
        ),
    )?;
    assert_eq!(files.get("a", "Tasks/AB.md")?, Some(original));
    assert_eq!(files.get("a", "Tasks/CD.md")?, None);
    assert_eq!(
        engine.snapshot("a", &Query::default())?.tasks[0].title,
        "A/B"
    );
    Ok(())
}

#[test]
fn external_title_changes_and_unknown_files_do_not_inherit_owned_policy() -> Result<()> {
    let files = Arc::new(Memory::default());
    configured(&files, false)?;
    files.seed(
        "a",
        "Tasks/Unknown.md",
        b"---\ntitle: Arbitrary\ntags: [task]\nstatus: open\n---\n",
    )?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    assert_eq!(
        engine.snapshot("a", &Query::default())?.tasks[0].title,
        "Unknown"
    );
    engine.execute("a", &create_title("owned", "A/B"))?;
    let bytes = files
        .get("a", "Tasks/AB.md")?
        .ok_or(RuntimeError::NotFound)?;
    let changed = std::str::from_utf8(&bytes)?.replace("A/B", "Externally changed");
    files.seed("a", "Tasks/AB.md", changed.as_bytes())?;
    engine.refresh("a")?;
    let snapshot = engine.snapshot("a", &Query::default())?;
    let task = snapshot
        .tasks
        .iter()
        .find(|task| task.path == "Tasks/AB.md")
        .ok_or(RuntimeError::NotFound)?;
    assert_eq!(task.title, "AB");
    Ok(())
}

#[test]
fn changed_title_mapping_is_a_visible_problem_for_owned_lossy_titles() -> Result<()> {
    let files = Arc::new(Memory::default());
    configured(&files, false)?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    engine.execute("a", &create_title("owned-mapping", "A/B"))?;
    files.seed("a",PLUGIN,br#"{"tasksFolder":"Tasks","storeTitleInFilename":true,"fieldMapping":{"title":"headline"}}"#)?;
    let snapshot = engine.refresh("a")?;
    assert!(snapshot.tasks.is_empty());
    assert!(
        json!(snapshot)
            .to_string()
            .contains("title lineage mapping changed")
    );
    Ok(())
}

#[test]
fn remote_body_and_uid_changes_preserve_owned_title_after_common_base_and_reopen() -> Result<()> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("remote-title.db");
    let path = path.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    configured(&files, false)?;
    let engine = Engine::open(path, files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    engine.execute("a", &create_title("remote-owned", "A/B"))?;
    let pending = engine
        .pending_upload_metadata("a")?
        .into_iter()
        .next()
        .ok_or(RuntimeError::NotFound)?;
    engine.acknowledge_upload("a", &pending.mutation_id, "1")?;
    let mut bytes = files
        .get("a", "Tasks/AB.md")?
        .ok_or(RuntimeError::NotFound)?;
    bytes.extend_from_slice(b"\nremote body");
    engine.ingest_remote("a", "Tasks/AB.md", Some(&bytes), "2")?;
    assert!(engine.conflicts("a")?.is_empty());
    assert_eq!(
        engine.snapshot("a", &Query::default())?.tasks[0].title,
        "A/B"
    );
    engine.close()?;
    drop(engine);
    let engine = Engine::open(path, files)?;
    assert_eq!(
        engine.snapshot("a", &Query::default())?.tasks[0].title,
        "A/B"
    );
    Ok(())
}

#[test]
fn corrupt_pending_title_policy_fails_before_more_file_effects() -> Result<()> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("corrupt-title.db");
    let path = path.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    configured(&files, false)?;
    let engine = Engine::open(path, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let request = create_title("corrupt-title", "A/B");
    files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("lock".into()))?
        .crash_after_exchange = true;
    assert!(matches!(
        engine.execute("a", &request),
        Err(RuntimeError::Host(_))
    ));
    engine.close()?;
    drop(engine);
    let db = rusqlite::Connection::open(path)?;
    db.execute("UPDATE journals SET title_plans=json_remove(title_plans,'$[0].before') WHERE id='corrupt-title'",[])?;
    let exchanges = files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("lock".into()))?
        .exchanges;
    let engine = Engine::open(path, files.clone())?;
    assert!(matches!(
        engine.execute("a", &request),
        Err(RuntimeError::Storage(_))
    ));
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("lock".into()))?
            .exchanges,
        exchanges
    );
    Ok(())
}

#[test]
fn corrupt_completed_receipt_never_becomes_wire_or_replay_success() -> Result<()> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("receipt.db");
    let path = path.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    configured(&files, false)?;
    let engine = Engine::open(path, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let request = create_title("corrupt-completed", "A/B");
    engine.execute("a", &request)?;
    let db = rusqlite::Connection::open(path)?;
    db.execute("UPDATE journals SET receipt=json_set(receipt,'$.diagnostics',json('[{\"code\":\"filename_shortened\",\"secret\":\"forbidden\"}]')) WHERE id='corrupt-completed'",[])?;
    let exchanges = files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("lock".into()))?
        .exchanges;
    assert!(matches!(
        engine.features_json(
            "a",
            r#"{"kind":"mutation_receipt","mutationId":"corrupt-completed"}"#
        ),
        Err(RuntimeError::Storage(_))
    ));
    assert!(matches!(
        engine.execute("a", &request),
        Err(RuntimeError::Storage(_))
    ));
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("lock".into()))?
            .exchanges,
        exchanges
    );
    Ok(())
}

#[test]
fn missing_or_changed_completed_warning_diagnostics_never_silently_replay_empty() -> Result<()> {
    for transform in [
        "json_remove(receipt,'$.diagnostics')",
        "json_set(receipt,'$.diagnostics',json('[]'))",
        "json_set(receipt,'$.mutationId','foreign-warning')",
    ] {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("warning-corrupt.db");
        let files = Arc::new(Memory::default());
        configured(&files, true)?;
        let engine = Engine::open(path.to_str().ok_or(RuntimeError::NotFound)?, files.clone())?;
        engine.register_profile(profile(ProfileKind::LocalFolder))?;
        engine.refresh("a")?;
        let request = create_title("missing-warning", "A/B");
        let receipt = engine.execute("a", &request)?;
        assert_eq!(warning(&receipt), json!([{"code":"template_missing"}]));
        let bytes = files.get("a", "Tasks/AB.md")?;
        let exchanges = files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("lock".into()))?
            .exchanges;
        let db = rusqlite::Connection::open(path)?;
        db.execute(
            &format!("UPDATE journals SET receipt={transform} WHERE id='missing-warning'"),
            [],
        )?;
        assert!(matches!(
            engine.features_json(
                "a",
                r#"{"kind":"mutation_receipt","mutationId":"missing-warning"}"#
            ),
            Err(RuntimeError::Storage(_))
        ));
        assert!(matches!(
            engine.execute("a", &request),
            Err(RuntimeError::Storage(_))
        ));
        assert_eq!(files.get("a", "Tasks/AB.md")?, bytes);
        assert_eq!(
            files
                .state
                .lock()
                .map_err(|_| RuntimeError::Host("lock".into()))?
                .exchanges,
            exchanges
        );
    }
    Ok(())
}

#[test]
fn corrupt_partial_warning_mirrors_fail_on_outcome_or_item_resume() -> Result<()> {
    for (table, column, prefix) in [
        ("partial_batches", "result", "$.items[0].receipt"),
        ("partial_items", "outcome", "$.receipt"),
    ] {
        for change in ["missing", "empty", "foreign"] {
            let directory = tempfile::tempdir()?;
            let path = directory.path().join("partial-warning.db");
            let files = Arc::new(Memory::default());
            configured(&files, true)?;
            let engine = Engine::open(path.to_str().ok_or(RuntimeError::NotFound)?, files.clone())?;
            engine.register_profile(profile(ProfileKind::LocalFolder))?;
            engine.refresh("a")?;
            let request = mutation(
                "partial-warning",
                Command::BatchPartial {
                    commands: vec![create_title("unused", "A/B").command],
                },
            );
            engine.execute("a", &request)?;
            let bytes = files.get("a", "Tasks/AB.md")?;
            let db = rusqlite::Connection::open(path)?;
            let expression = match change {
                "missing" => format!("json_remove({column},'{prefix}.diagnostics')"),
                "empty" => format!("json_set({column},'{prefix}.diagnostics',json('[]'))"),
                _ => format!("json_set({column},'{prefix}.mutationId','foreign')"),
            };
            db.execute(&format!("UPDATE {table} SET {column}={expression}"), [])?;
            if column == "outcome" {
                db.execute("UPDATE partial_batches SET receipt=NULL,result=NULL", [])?;
                assert!(matches!(
                    engine.execute("a", &request),
                    Err(RuntimeError::Storage(_))
                ));
            } else {
                assert!(matches!(
                    engine.features_json(
                        "a",
                        r#"{"kind":"batch_outcome","mutationId":"partial-warning"}"#
                    ),
                    Err(RuntimeError::Storage(_))
                ));
            }
            assert_eq!(files.get("a", "Tasks/AB.md")?, bytes);
        }
    }
    Ok(())
}
