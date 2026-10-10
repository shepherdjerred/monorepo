//! Removed features stay unavailable while existing vaults and journals survive.

use super::*;

const PATH: &str = "Tasks/legacy.md";
const NOTE: &[u8] = b"---\ntitle: Legacy\nstatus: open\ntags: [task]\ndateCreated: 2026-01-01T00:00:00Z\ndateModified: 2026-01-01T00:00:00Z\ntimeEstimate: 45\ntimeEntries:\n  - startTime: 2026-10-03T11:00:00.987654321Z\n    vendor: preserved\npomodoros: 3\n---\nOriginal body\n";

#[test]
fn removed_commands_and_features_are_rejected() -> Result<()> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files)?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    for kind in ["start_time", "stop_time", "set_time_entries", "pomodoro"] {
        let raw = json!({"mutationId":"retired","at":"2026-10-03T12:00:00Z","command":{"kind":kind,"path":PATH}});
        assert!(serde_json::from_value::<Mutation>(raw).is_err(), "{kind}");
    }
    for kind in [
        "tracking_sessions",
        "tracking_history",
        "task_time",
        "time_report",
        "pomodoro",
    ] {
        assert!(
            engine
                .features_json("a", &json!({"kind":kind}).to_string())
                .is_err(),
            "{kind}"
        );
    }
    Ok(())
}

#[test]
fn completion_keeps_retired_frontmatter_opaque_and_undo_preserves_exact_bytes() -> Result<()> {
    let files = Arc::new(Memory::default());
    files.seed("a", "tasknotes.yaml", b"title:\n  storage: frontmatter\n")?;
    files.seed("a", PATH, NOTE)?;
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    let command = Command::SetStatus {
        path: PATH.into(),
        expected_revision: None,
        status: "done".into(),
        occurrence_date: None,
    };
    engine.execute("a", &mutation("complete", command))?;
    let saved = files.get("a", PATH)?.ok_or(RuntimeError::NotFound)?;
    let before = tasknotes_vault::document::TaskDocument::parse(
        tasknotes_vault::path::VaultPath::parse(PATH)?,
        NOTE,
    )?;
    let after = tasknotes_vault::document::TaskDocument::parse(
        tasknotes_vault::path::VaultPath::parse(PATH)?,
        &saved,
    )?;
    for key in ["timeEstimate", "timeEntries", "pomodoros"] {
        assert_eq!(
            after.frontmatter().get(key),
            before.frontmatter().get(key),
            "{key}"
        );
    }
    let snapshot = serde_json::to_value(engine.snapshot("a", &Query::default())?)?;
    let task = &snapshot["tasks"][0];
    assert!(task.get("hasActiveTimeSession").is_none());
    assert!(task.get("totalTrackedMinutes").is_none());
    engine.execute(
        "a",
        &mutation(
            "undo",
            Command::Undo {
                receipt_id: "complete".into(),
            },
        ),
    )?;
    assert_eq!(files.get("a", PATH)?, Some(NOTE.to_vec()));
    Ok(())
}

#[test]
fn historical_mapped_timing_configuration_and_metadata_remain_opaque() -> Result<()> {
    for plugin in [false, true] {
        let files = Arc::new(Memory::default());
        let (settings_path, settings) = if plugin {
            (".obsidian/plugins/tasknotes/data.json", br#"{"storeTitleInFilename":false,"fieldMapping":{"timeEstimate":"budget","timeEntries":"work_log","pomodoros":"rounds"},"autoStopTimeTrackingOnComplete":true,"vendor":{"keep":true}}"#.to_vec())
        } else {
            ("tasknotes.yaml", b"title:\n  storage: frontmatter\nmapping:\n  time_estimate: budget\n  time_entries: work_log\n  pomodoros: rounds\ntime_tracking:\n  auto_stop_on_complete: true\n".to_vec())
        };
        files.seed("a", settings_path, &settings)?;
        let properties = br#"{"budget":{"vendor":"opaque"},"work_log":"historical vendor value","rounds":["opaque"],"title":"Mapped","status":"open","tags":["task"],"dateCreated":"2026-01-01T00:00:00Z","dateModified":"2026-01-01T00:00:00Z"}"#;
        let note = format!(
            "---\n{}\n---\nBody\n",
            std::str::from_utf8(properties).map_err(|_| RuntimeError::NotFound)?
        )
        .into_bytes();
        files.seed("a", PATH, &note)?;
        let engine = Engine::open(":memory:", files.clone())?;
        engine.register_profile(profile(ProfileKind::LocalFolder))?;
        engine.refresh("a")?;
        engine.execute(
            "a",
            &mutation(
                "mapped-complete",
                Command::SetStatus {
                    path: PATH.into(),
                    expected_revision: None,
                    status: "done".into(),
                    occurrence_date: None,
                },
            ),
        )?;
        let saved = files.get("a", PATH)?.ok_or(RuntimeError::NotFound)?;
        let document = tasknotes_vault::document::TaskDocument::parse(
            tasknotes_vault::path::VaultPath::parse(PATH)?,
            &saved,
        )?;
        let original: Value = serde_json::from_slice(properties)?;
        for key in ["budget", "work_log", "rounds"] {
            assert_eq!(document.frontmatter().get(key), original.get(key), "{key}");
        }
        assert_eq!(files.get("a", settings_path)?, Some(settings));
        let snapshot = engine.snapshot("a", &Query::default())?;
        let configuration = &snapshot.configuration;
        for role in ["timeEstimate", "timeEntries", "pomodoros"] {
            assert!(
                configuration["mapping"]["roleToField"].get(role).is_none(),
                "{role}"
            );
        }
    }
    Ok(())
}

#[test]
fn schema_eleven_timer_state_retires_without_stranding_staged_task_journals() -> Result<()> {
    let directory = tempfile::tempdir().map_err(|e| RuntimeError::Storage(e.to_string()))?;
    let database = directory.path().join("legacy.sqlite");
    let database_name = database.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    files.seed("a", "tasknotes.yaml", b"title:\n  storage: frontmatter\n")?;
    files.seed("a", PATH, NOTE)?;
    let engine = Engine::open(database_name, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock".into()))?
        .crash_after_exchange = true;
    let changed = mutation(
        "historical-write",
        Command::Update {
            path: PATH.into(),
            expected_revision: None,
            properties: serde_json::from_value(json!({"vendor":"edited"}))?,
            body: None,
        },
    );
    assert!(matches!(
        engine.execute("a", &changed),
        Err(RuntimeError::Host(_))
    ));
    let published = files.get("a", PATH)?;
    drop(engine);
    let db = rusqlite::Connection::open(&database)?;
    db.execute_batch("CREATE TABLE device_state(profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,device TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(profile,device)); ALTER TABLE journals ADD COLUMN effect TEXT; PRAGMA user_version=11;")?;
    db.execute("INSERT INTO device_state(profile,device,json) VALUES('a','phone','obsolete private state')", [])?;
    let historical = json!({"mutationId":"historical-write","at":changed.at,"executionContext":changed.execution_context,"command":{"kind":"start_time","path":PATH}}).to_string();
    db.execute("UPDATE journals SET fingerprint=?,effect='obsolete private timer effect' WHERE profile='a' AND id='historical-write'", [historical.as_str()])?;
    let timer = json!({"mutationId":"historical-timer","at":"2026-10-03T12:00:00Z","command":{"kind":"pomodoro","deviceId":"phone","action":"start"}}).to_string();
    db.execute("INSERT INTO journals(profile,id,fingerprint,writes,effect) VALUES('a','historical-timer',?,'[]','obsolete private effect')", [timer])?;
    drop(db);
    let engine = Engine::open(database_name, files.clone())?;
    engine.refresh("a")?;
    assert_eq!(files.get("a", PATH)?, published);
    let db = rusqlite::Connection::open(&database)?;
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))?,
        12
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='device_state'",
            [],
            |r| r.get::<_, u32>(0)
        )?,
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM pragma_table_info('journals') WHERE name='effect'",
            [],
            |r| r.get::<_, u32>(0)
        )?,
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT fingerprint FROM journals WHERE id='historical-write'",
            [],
            |r| r.get::<_, String>(0)
        )?,
        historical
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM journals WHERE receipt IS NULL",
            [],
            |r| r.get::<_, u32>(0)
        )?,
        0
    );
    drop(db);
    engine.execute(
        "a",
        &mutation(
            "undo",
            Command::Undo {
                receipt_id: "historical-write".into(),
            },
        ),
    )?;
    assert_eq!(files.get("a", PATH)?, Some(NOTE.to_vec()));
    Ok(())
}

#[test]
fn historical_partial_batch_recovers_staged_images_and_retires_only_unstarted_timing() -> Result<()>
{
    let directory = tempfile::tempdir().map_err(|e| RuntimeError::Storage(e.to_string()))?;
    let database = directory.path().join("partial.sqlite");
    let database_name = database.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    files.seed("a", "tasknotes.yaml", b"title:\n  storage: frontmatter\n")?;
    files.seed("a", PATH, NOTE)?;
    let engine = Engine::open(database_name, files.clone())?;
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    engine.refresh("a")?;
    files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test lock".into()))?
        .crash_after_exchange = true;
    let staged = mutation(
        "partial:legacy:0",
        Command::Update {
            path: PATH.into(),
            expected_revision: None,
            properties: serde_json::from_value(json!({"vendor":"already staged"}))?,
            body: None,
        },
    );
    assert!(matches!(
        engine.execute("a", &staged),
        Err(RuntimeError::Host(_))
    ));
    drop(engine);
    let db = rusqlite::Connection::open(&database)?;
    let parent = install_legacy_partial(&db, &staged)?;
    drop(db);
    let engine = Engine::open(database_name, files.clone())?;
    engine.refresh("a")?;
    let outcome: Value = serde_json::from_str(
        &engine.features_json("a", r#"{"kind":"batch_outcome","mutationId":"legacy"}"#)?,
    )?;
    assert_eq!(outcome["succeeded"], 2);
    assert_eq!(outcome["failed"], 1);
    assert_eq!(
        outcome["items"][0]["receipt"]["mutationId"],
        "partial:legacy:0"
    );
    assert_eq!(outcome["items"][1]["error"], "timing_features_removed");
    assert_eq!(
        outcome["items"][2]["receipt"]["mutationId"],
        "partial:legacy:2"
    );
    let saved = files.get("a", PATH)?.ok_or(RuntimeError::NotFound)?;
    let document = tasknotes_vault::document::TaskDocument::parse(
        tasknotes_vault::path::VaultPath::parse(PATH)?,
        &saved,
    )?;
    assert_eq!(
        document.frontmatter().get("vendor"),
        Some(&json!("ordinary child"))
    );
    assert_eq!(
        document.frontmatter()["timeEntries"][0]["startTime"],
        "2026-10-03T11:00:00.987654321Z"
    );
    assert!(
        document.frontmatter()["timeEntries"][0]
            .get("endTime")
            .is_none()
    );
    let db = rusqlite::Connection::open(&database)?;
    assert_eq!(
        db.query_row(
            "SELECT fingerprint FROM partial_batches WHERE id='legacy'",
            [],
            |row| row.get::<_, String>(0)
        )?,
        parent
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM journals WHERE id='partial:legacy:1'",
            [],
            |row| row.get::<_, u32>(0)
        )?,
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM partial_items WHERE outcome IS NULL",
            [],
            |row| row.get::<_, u32>(0)
        )?,
        0
    );
    Ok(())
}

fn install_legacy_partial(db: &rusqlite::Connection, staged: &Mutation) -> Result<String> {
    let commands = [
        json!({"kind":"start_time","path":PATH}),
        json!({"kind":"stop_time","path":PATH}),
        json!({"kind":"update","path":PATH,"properties":{"vendor":"ordinary child"}}),
    ];
    db.execute_batch("CREATE TABLE device_state(profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,device TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(profile,device)); ALTER TABLE journals ADD COLUMN effect TEXT; PRAGMA user_version=11;")?;
    let parent = json!({"mutationId":"legacy","at":staged.at,"command":{"kind":"batch_partial","commands":commands}}).to_string();
    db.execute(
        "INSERT INTO partial_batches(profile,id,fingerprint) VALUES('a','legacy',?)",
        [parent.as_str()],
    )?;
    for (ordinal, command) in commands.iter().enumerate() {
        let child = json!({"mutationId":format!("partial:legacy:{ordinal}"),"at":staged.at,"command":command}).to_string();
        db.execute(
            "INSERT INTO partial_items(profile,id,ordinal,mutation) VALUES('a','legacy',?,?)",
            rusqlite::params![
                i64::try_from(ordinal).map_err(|_| RuntimeError::Storage("test ordinal".into()))?,
                child
            ],
        )?;
        if ordinal == 0 {
            db.execute(
                "UPDATE journals SET fingerprint=? WHERE id='partial:legacy:0'",
                [child.as_str()],
            )?;
        }
    }
    Ok(parent)
}
