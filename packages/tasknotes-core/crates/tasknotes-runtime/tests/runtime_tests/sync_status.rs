use super::*;
use tasknotes_runtime::types::SyncStatus;

fn status(engine: &Engine, id: &str) -> Result<SyncStatus> {
    let status: SyncStatus =
        serde_json::from_str(&engine.features_json(id, r#"{"kind":"sync_status"}"#)?)?;
    status.validate_contract()?;
    Ok(status)
}

#[test]
fn sync_status_distinguishes_local_ready_from_cloud_without_a_checkpoint() -> Result<()> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    let mut cloud = profile(ProfileKind::ObsidianSync);
    cloud.approve_standard = false;
    engine.register_profile(cloud)?;
    let cloud = status(&engine, "a")?;
    assert_eq!(cloud.profile_kind, ProfileKind::ObsidianSync);
    assert!(!cloud.initial_sync_complete);
    assert_eq!(cloud.version, 0);
    assert_eq!(cloud.pending_remote_count, 0);
    assert_eq!(cloud.pending_upload_count, 0);
    assert_eq!(cloud.conflict_count, 0);
    assert_eq!(cloud.pending_mutation_count, 0);
    let mut local = profile(ProfileKind::LocalFolder);
    local.id = "local".into();
    engine.register_profile(local)?;
    let local = status(&engine, "local")?;
    assert_eq!(local.profile_kind, ProfileKind::LocalFolder);
    assert!(local.initial_sync_complete);
    assert_eq!(status(&engine, "a")?, cloud);
    assert_eq!(files.state.lock().unwrap().exchanges, 0);
    assert!(matches!(
        status(&engine, "missing"),
        Err(RuntimeError::NotFound)
    ));
    assert!(
        engine
            .features_json("a", r#"{"kind":"sync_status","path":"private.md"}"#)
            .is_err()
    );
    assert!(
        engine
            .features_json("a", r#"{"schemaVersion":2,"kind":"sync_status"}"#)
            .is_err()
    );
    Ok(())
}

#[test]
fn sync_status_requires_ready_and_drained_durable_notices_across_relaunch()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let database = directory.path().join("runtime.db");
    let database = database.to_str().unwrap();
    let files = Arc::new(Memory::default());
    let engine = Engine::open(database, files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.save_checkpoint(
        "a",
        &serde_json::to_string(&obsidian_sync::session::Checkpoint::default())?,
    )?;
    assert!(!status(&engine, "a")?.initial_sync_complete);
    let notice = json!({"uid":1,"path":"Reference.md","selected":true});
    engine.apply_checkpoint_delta("a", &json!({"schema_version":1,"cursor":1,"initial":false,"pending_upsert":notice,"pending_remove":null}).to_string())?;
    let pending = status(&engine, "a")?;
    assert!(!pending.initial_sync_complete);
    assert_eq!(pending.pending_remote_count, 1);
    // Merely observing or reconnecting cannot acknowledge an unapplied notice.
    drop(engine);
    let engine = Engine::open(database, files)?;
    assert_eq!(status(&engine, "a")?, pending);
    engine.apply_checkpoint_delta("a", &json!({"schema_version":1,"cursor":1,"initial":false,"pending_upsert":null,"pending_remove":1}).to_string())?;
    let ready = status(&engine, "a")?;
    assert!(ready.initial_sync_complete);
    assert_eq!(ready.pending_remote_count, 0);
    assert_eq!(ready.version, pending.version);
    Ok(())
}

#[test]
fn sync_status_counts_conflict_blocked_uploads_without_exposing_payloads() -> Result<()> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("create", create()))?;
    let created = status(&engine, "a")?;
    assert_eq!(created.pending_upload_count, 1);
    assert_eq!(created.pending_mutation_count, 0);
    files.state.lock().unwrap().racing_bytes = Some(
        b"---\ntitle: External\nstatus: open\npriority: high\ntags: [task]\n---\nPrivate body\n"
            .to_vec(),
    );
    assert!(matches!(
        engine.execute("a", &mutation("complete", update("done"))),
        Err(RuntimeError::Conflict)
    ));
    assert!(engine.pending_uploads("a")?.is_empty());
    let conflicted = status(&engine, "a")?;
    assert_eq!(conflicted.pending_upload_count, 1);
    assert_eq!(conflicted.conflict_count, 1);
    assert_eq!(conflicted.pending_mutation_count, 0);
    assert_eq!(
        conflicted.version,
        engine.snapshot("a", &Query::default())?.version
    );
    let json = engine.features_json("a", r#"{"kind":"sync_status"}"#)?;
    assert!(!json.contains("Private body"));
    assert!(!json.contains("Tasks/a.md"));
    assert_eq!(
        serde_json::from_str::<Value>(&json)?
            .as_object()
            .unwrap()
            .len(),
        9
    );
    Ok(())
}

#[test]
fn sync_status_retains_uncommitted_journal_until_recovery()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let database = directory.path().join("runtime.db");
    let database = database.to_str().unwrap();
    let files = Arc::new(Memory::default());
    let engine = Engine::open(database, files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("create", create()))?;
    files.state.lock().unwrap().crash_after_exchange = true;
    assert!(
        engine
            .execute("a", &mutation("complete", update("done")))
            .is_err()
    );
    let pending = status(&engine, "a")?;
    assert_eq!(pending.pending_mutation_count, 1);
    assert_eq!(pending.pending_upload_count, 1);
    drop(engine);
    let engine = Engine::open(database, files)?;
    assert_eq!(status(&engine, "a")?, pending);
    engine.refresh("a")?;
    let recovered = status(&engine, "a")?;
    assert_eq!(recovered.pending_mutation_count, 0);
    assert_eq!(recovered.pending_upload_count, 2);
    Ok(())
}

#[test]
fn sync_status_counts_partial_parent_after_committed_child()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let database = directory.path().join("runtime.db");
    let database = database.to_str().unwrap();
    let files = Arc::new(Memory::default());
    let engine = Engine::open(database, files)?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    let request = mutation(
        "partial",
        Command::BatchPartial {
            commands: vec![create()],
        },
    );
    let connection = rusqlite::Connection::open(database)?;
    connection.execute_batch("CREATE TRIGGER fail_outcome BEFORE UPDATE OF outcome ON partial_items BEGIN SELECT RAISE(ABORT,'fault after child receipt before outcome'); END;")?;
    assert!(matches!(
        engine.execute("a", &request),
        Err(RuntimeError::Storage(_))
    ));
    let pending = status(&engine, "a")?;
    assert_eq!(pending.pending_mutation_count, 1);
    assert_eq!(pending.pending_upload_count, 1);
    connection.execute_batch("DROP TRIGGER fail_outcome;")?;
    assert!(engine.execute("a", &request)?.applied);
    let complete = status(&engine, "a")?;
    assert_eq!(complete.pending_mutation_count, 0);
    assert_eq!(complete.pending_upload_count, 1);
    Ok(())
}

#[test]
fn sync_status_rejects_corrupt_durable_checkpoint_without_claiming_ready()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let database = directory.path().join("runtime.db");
    let database = database.to_str().unwrap();
    let engine = Engine::open(database, Arc::new(Memory::default()))?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.save_checkpoint(
        "a",
        &serde_json::to_string(&obsidian_sync::session::Checkpoint::default())?,
    )?;
    let connection = rusqlite::Connection::open(database)?;
    connection.execute(
        "UPDATE checkpoints SET json=? WHERE profile='a'",
        [r#"{"schema_version":99,"cursor":0,"initial":false,"pending":{}}"#],
    )?;
    assert!(matches!(
        status(&engine, "a"),
        Err(RuntimeError::Storage(_))
    ));
    Ok(())
}
