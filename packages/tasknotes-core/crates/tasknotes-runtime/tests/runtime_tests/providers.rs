//! Official production defaults and strict recognized provider boundaries.

use super::{
    Arc, Command, Engine, Memory, ProfileKind, Query, Result, RuntimeError, Value, create, json,
    mutation, profile,
};

const PLUGIN: &str = ".obsidian/plugins/tasknotes/data.json";
const NOTE: &[u8] = b"---\ntitle: Frontmatter title\nstatus: open\ntags: [task]\ndateCreated: 2026-01-01T00:00:00Z\ndateModified: 2026-01-01T00:00:00Z\n---\n";

#[test]
fn official_defaults_and_partial_providers_drive_actual_titles_and_completion() -> Result<()> {
    for (plugin, portable, filename, auto_stop, notification) in [
        (None, None, true, true, false),
        (Some(json!({})), None, true, true, false),
        (
            None,
            Some("time_tracking:\n  auto_stop_notification: true\n"),
            true,
            true,
            true,
        ),
        (
            Some(json!({"autoStopTimeTrackingNotification":true})),
            Some("time_tracking:\n  auto_stop_on_complete: false\n"),
            true,
            true,
            true,
        ),
        (
            Some(
                json!({"storeTitleInFilename":false,"autoStopTimeTrackingOnComplete":false,"autoStopTimeTrackingNotification":true}),
            ),
            None,
            false,
            false,
            true,
        ),
        (
            None,
            Some(
                "title:\n  storage: frontmatter\ntime_tracking:\n  auto_stop_on_complete: false\n",
            ),
            false,
            false,
            false,
        ),
    ] {
        let files = Arc::new(Memory::default());
        if let Some(plugin) = plugin {
            files.seed("a", PLUGIN, &serde_json::to_vec(&plugin)?)?;
        }
        if let Some(portable) = portable {
            files.seed("a", "tasknotes.yaml", portable.as_bytes())?;
        }
        files.seed("a", "Tasks/Filename title.md", NOTE)?;
        let engine = Engine::open(":memory:", files)?;
        engine.register_profile(profile(ProfileKind::LocalFolder))?;
        let before = engine.refresh("a")?;
        let task = before.tasks.first().ok_or(RuntimeError::NotFound)?;
        assert_eq!(
            task.title,
            if filename {
                "Filename title"
            } else {
                "Frontmatter title"
            }
        );
        let effective = before
            .configuration
            .get("effective")
            .ok_or(RuntimeError::NotFound)?;
        assert_eq!(
            effective.pointer("/time_tracking/auto_stop_on_complete"),
            Some(&json!(auto_stop))
        );
        assert_eq!(
            effective.pointer("/time_tracking/auto_stop_notification"),
            Some(&json!(notification))
        );
        assert_eq!(
            effective.pointer("/task_detection/property_name"),
            Some(&json!(""))
        );
        assert_completion_policy(&engine, &task.path, auto_stop)?;
    }
    Ok(())
}

fn assert_completion_policy(engine: &Engine, path: &str, auto_stop: bool) -> Result<()> {
    engine.execute(
        "a",
        &mutation(
            "start",
            Command::StartTime {
                path: path.to_owned(),
                expected_revision: None,
            },
        ),
    )?;
    let mut finish = mutation(
        "finish",
        Command::SetStatus {
            path: path.to_owned(),
            expected_revision: None,
            status: "done".to_owned(),
            occurrence_date: None,
        },
    );
    "2026-10-03T12:02:00Z".clone_into(&mut finish.at);
    engine.execute("a", &finish)?;
    let after = engine.snapshot("a", &Query::default())?;
    let task = after.tasks.first().ok_or(RuntimeError::NotFound)?;
    assert_eq!(task.has_active_time_session, !auto_stop);
    assert_eq!(
        task.properties.get("completedDate"),
        Some(&json!("2026-10-03"))
    );
    if auto_stop {
        assert_eq!(task.total_tracked_minutes, 2);
    }
    Ok(())
}

#[test]
fn invalid_recognized_plugin_settings_never_fall_back_or_publish_files() -> Result<()> {
    for invalid in [
        json!({"storeTitleInFilename":"wrong"}),
        json!({"storeTitleInFilename":0}),
        json!({"storeTitleInFilename":null}),
        json!({"autoStopTimeTrackingOnComplete":"wrong"}),
        json!({"autoStopTimeTrackingOnComplete":1}),
        json!({"autoStopTimeTrackingOnComplete":null}),
        json!({"autoStopTimeTrackingNotification":[]}),
        json!({"taskTag":false}),
        json!({"tasksFolder":null}),
        json!({"taskFilenameFormat":"unknown"}),
        json!({"taskIdentificationMethod":"unknown"}),
        json!({"taskCreationDefaults":null}),
        json!({"taskCreationDefaults":{"useBodyTemplate":"true"}}),
        json!({"taskCreationDefaults":{"bodyTemplate":false}}),
    ] {
        let files = Arc::new(Memory::default());
        files.seed("a", PLUGIN, &serde_json::to_vec(&invalid)?)?;
        files.seed("a", "tasknotes.yaml", b"title:\n  storage: frontmatter\n")?;
        files.seed("a", "Tasks/Filename title.md", NOTE)?;
        let engine = Engine::open(":memory:", files.clone())?;
        engine.register_profile(profile(ProfileKind::LocalFolder))?;
        assert!(
            matches!(engine.refresh("a"), Err(RuntimeError::Configuration(_))),
            "{invalid}"
        );
        assert!(
            matches!(
                engine.execute("a", &mutation("invalid-provider", create())),
                Err(RuntimeError::Configuration(_))
            ),
            "{invalid}"
        );
        assert_eq!(
            files.get("a", "Tasks/Filename title.md")?,
            Some(NOTE.to_vec())
        );
        assert_eq!(files.get("a", "Tasks/a.md")?, None);
        assert_eq!(
            files
                .state
                .lock()
                .map_err(|_| RuntimeError::Host("test lock failed".to_owned()))?
                .exchanges,
            0
        );
    }
    Ok(())
}

#[test]
fn invalid_remote_recognized_settings_are_retained_until_explicit_repair() -> Result<()> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    let mut selected = profile(ProfileKind::ObsidianSync);
    selected.approve_standard = false;
    engine.register_profile(selected)?;
    let invalid = br#"{"autoStopTimeTrackingOnComplete":null,"vendor":{"opaque":null}}"#;
    engine.ingest_remote("a", PLUGIN, Some(invalid), "1")?;
    engine.ingest_remote("a", "Tasks/Filename title.md", Some(NOTE), "2")?;
    assert_eq!(files.get("a", PLUGIN)?, Some(invalid.to_vec()));
    assert_eq!(
        files.get("a", "Tasks/Filename title.md")?,
        Some(NOTE.to_vec())
    );
    assert!(matches!(
        engine.features_json("a", r#"{"kind":"discovery"}"#),
        Err(RuntimeError::Configuration(_))
    ));
    let repaired = br#"{"autoStopTimeTrackingOnComplete":false,"vendor":{"opaque":null}}"#;
    engine.ingest_remote("a", PLUGIN, Some(repaired), "3")?;
    let snapshot = engine.snapshot("a", &Query::default())?;
    assert_eq!(
        snapshot.tasks.first().ok_or(RuntimeError::NotFound)?.title,
        "Filename title"
    );
    assert_eq!(
        snapshot.configuration.pointer("/extra/vendor/opaque"),
        Some(&Value::Null)
    );
    assert_eq!(files.get("a", PLUGIN)?, Some(repaired.to_vec()));
    Ok(())
}

#[test]
fn filename_editor_receipt_owns_primary_identity_after_crash_references_and_replay() -> Result<()> {
    let directory =
        tempfile::tempdir().map_err(|error| RuntimeError::Storage(error.to_string()))?;
    let database = directory.path().join("primary.db");
    let database = database.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    files.seed("a", "Tasks/a.md", NOTE)?;
    files.seed("a","Tasks/reference.md",b"---\ntitle: Reference\nstatus: open\ntags: [task]\ndateCreated: 2026-01-01T00:00:00Z\ndateModified: 2026-01-01T00:00:00Z\n---\n[[a|Preserved alias]]\n")?;
    let engine = Engine::open(database, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let edit = mutation(
        "renamed-edit",
        Command::EditTask {
            path: "Tasks/a.md".to_owned(),
            expected_revision: None,
            properties: json!({"title":"Renamed","contexts":["first"]})
                .as_object()
                .cloned()
                .ok_or(RuntimeError::NotFound)?,
            body: None,
            status: None,
            occurrence_date: None,
        },
    );
    files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock failed".to_owned()))?
        .crash_after_exchange = true;
    assert!(matches!(
        engine.execute("a", &edit),
        Err(RuntimeError::Host(_))
    ));
    drop(engine);
    let engine = Engine::open(database, files.clone())?;
    let receipt = engine.execute("a", &edit)?;
    assert_eq!(receipt.task_path.as_deref(), Some("Tasks/Renamed.md"));
    assert_eq!(receipt.paths.len(), 3);
    assert!(receipt.paths.contains(&"Tasks/reference.md".to_owned()));
    let count = files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock failed".to_owned()))?
        .exchanges;
    assert_eq!(
        serde_json::to_value(engine.execute("a", &edit)?)?,
        serde_json::to_value(&receipt)?
    );
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test lock failed".to_owned()))?
            .exchanges,
        count
    );
    let path = receipt.task_path.ok_or(RuntimeError::NotFound)?;
    engine.execute(
        "a",
        &mutation(
            "second-save",
            Command::EditTask {
                path: path.clone(),
                expected_revision: None,
                properties: json!({"contexts":["second"]})
                    .as_object()
                    .cloned()
                    .ok_or(RuntimeError::NotFound)?,
                body: None,
                status: None,
                occurrence_date: None,
            },
        ),
    )?;
    assert_eq!(files.get("a", "Tasks/a.md")?, None);
    let snapshot = engine.snapshot("a", &Query::default())?;
    let edited = snapshot
        .tasks
        .iter()
        .find(|task| task.path == path)
        .ok_or(RuntimeError::NotFound)?;
    assert_eq!(edited.properties.get("contexts"), Some(&json!(["second"])));
    drop(engine);
    let connection = rusqlite::Connection::open(database)?;
    connection.execute("UPDATE journals SET receipt=json_remove(receipt,'$.taskPath') WHERE profile='a' AND id='renamed-edit'",[])?;
    drop(connection);
    let engine = Engine::open(database, files)?;
    assert_eq!(engine.execute("a", &edit)?.task_path, None);
    Ok(())
}
