//! Exact immutable `SQLite` receipt → final encrypted frame; no native byte arrays.

use super::{Arc, Command, Engine, Memory, ProfileKind, RuntimeError, create, mutation, profile};
use obsidian_sync::{
    SyncError,
    crypto::{EncryptionVersion, VaultCipher, VaultKey},
    session::{Checkpoint, Effect, Input, Session, SessionConfig},
};
use tasknotes_runtime::engine::UploadPreparationError;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn cipher() -> obsidian_sync::Result<VaultCipher> {
    VaultCipher::new(
        EncryptionVersion::V3,
        &VaultKey::from_bytes(&[3; 32])?,
        "public-test-salt",
    )
}

fn connected(vault: &str, budget: u64) -> Result<Session> {
    let mut config =
        SessionConfig::new("sync-test.obsidian.md", "public-test-token", vault, "test")?;
    config.queued_byte_limit = budget;
    let mut session = Session::new(config, cipher()?, Checkpoint::default())?;
    session.begin(0)?;
    session.handle(Input::Opened, 1)?;
    session.handle(Input::Text(r#"{"res":"ok"}"#.into()), 2)?;
    let effects = session.handle(Input::Text(r#"{"op":"ready","version":0}"#.into()), 3)?;
    for effect in effects {
        if let Effect::PersistCheckpointDelta { revision, .. } = effect {
            session.handle(Input::CheckpointPersisted(revision), 4)?;
        }
    }
    Ok(session)
}

#[test]
fn runtime_upload_owns_old_snapshot_original_clock_and_exact_ack_reference_after_reopen()
-> Result<()> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("uploads.db");
    let path_str = path.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    files.seed("a", "tasknotes.yaml", b"title:\n  storage: frontmatter\n")?;
    let engine = Engine::open(path_str, files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("original-create", create()))?;
    let original = files
        .get("a", "Tasks/a.md")?
        .ok_or(RuntimeError::NotFound)?;
    let head = engine
        .pending_upload_metadata("a")?
        .into_iter()
        .next()
        .ok_or(RuntimeError::NotFound)?;
    engine.execute(
        "a",
        &mutation(
            "newer-edit",
            Command::Update {
                path: "Tasks/a.md".into(),
                expected_revision: None,
                properties: serde_json::Map::new(),
                body: Some("newer local bytes".into()),
            },
        ),
    )?;
    engine.bind_sync_profile("a", "remote-vault")?;
    let db = rusqlite::Connection::open(&path)?;
    let image: String = db.query_row(
        "SELECT bytes FROM outbox WHERE profile='a' AND id=?",
        [&head.mutation_id],
        |row| row.get(0),
    )?;
    let images: i64 = db.query_row("SELECT count(*) FROM transfer_payloads", [], |row| {
        row.get(0)
    })?;
    upload_and_ack(&engine, &files, &head, &original)?;
    assert_eq!(
        db.query_row(
            "SELECT base FROM files WHERE profile='a' AND path='Tasks/a.md'",
            [],
            |row| row.get::<_, String>(0)
        )?,
        image
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM transfer_payloads", [], |row| row
            .get::<_, i64>(0))?,
        images,
        "queue and ACK must never duplicate a complete SQLite image"
    );
    let namespace = engine.identity()?.to_owned();
    engine.close()?;
    drop(engine);
    let engine = Engine::open(path_str, files)?;
    assert_eq!(engine.identity()?, namespace);
    assert!(matches!(
        engine.bind_sync_profile("a", "wrong-vault"),
        Err(RuntimeError::Conflict)
    ));
    let next = engine
        .pending_upload_metadata("a")?
        .into_iter()
        .next()
        .ok_or(RuntimeError::NotFound)?;
    let mut wrong = connected("wrong-vault", 256 * 1024 * 1024)?;
    assert!(matches!(
        engine.queue_durable_upload("a", &mut wrong, &next.mutation_id, [1; 12], 8),
        Err(UploadPreparationError::Runtime(RuntimeError::Conflict))
    ));
    Ok(())
}

#[test]
fn runtime_upload_budget_rejection_keeps_receipt_and_never_reads_provider() -> Result<()> {
    let files = Arc::new(Memory::default());
    let engine = Engine::open(":memory:", files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.refresh("a")?;
    engine.execute("a", &mutation("capture", create()))?;
    engine.bind_sync_profile("a", "remote-vault")?;
    let head = engine
        .pending_upload_metadata("a")?
        .into_iter()
        .next()
        .ok_or(RuntimeError::NotFound)?;
    let before = files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test provider lock failed".to_owned()))?
        .reads;
    let mut session = connected("remote-vault", 1)?;
    assert!(matches!(
        engine.queue_durable_upload("a", &mut session, &head.mutation_id, [2; 12], 9),
        Err(UploadPreparationError::Sync(SyncError::QueueFull))
    ));
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test provider lock failed".to_owned()))?
            .reads,
        before
    );
    assert_eq!(
        serde_json::to_value(engine.pending_upload_metadata("a")?)?,
        serde_json::to_value(vec![head])?
    );
    Ok(())
}

fn upload_and_ack(
    engine: &Engine,
    files: &Memory,
    head: &tasknotes_runtime::types::PendingUpload,
    original: &[u8],
) -> Result<()> {
    let before = files
        .state
        .lock()
        .map_err(|_| RuntimeError::Host("test provider lock failed".to_owned()))?
        .reads;
    let mut session = connected("remote-vault", 256 * 1024 * 1024)?;
    let effects = engine.queue_durable_upload("a", &mut session, &head.mutation_id, [0; 12], 5)?;
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Host("test provider lock failed".to_owned()))?
            .reads,
        before
    );
    let header = effects
        .into_iter()
        .find_map(|effect| {
            if let Effect::SendText(frame) = effect {
                Some(frame)
            } else {
                None
            }
        })
        .ok_or("no header")?;
    let header: serde_json::Value = serde_json::from_str(header.as_str())?;
    assert_eq!(
        header.get("ctime").and_then(serde_json::Value::as_u64),
        head.ctime
    );
    assert_eq!(
        header.get("mtime").and_then(serde_json::Value::as_u64),
        head.mtime
    );
    let encrypted = session
        .handle(Input::Text(r#"{"res":"upload"}"#.into()), 6)?
        .into_iter()
        .find_map(|effect| {
            if let Effect::SendBinary(frame) = effect {
                Some(frame)
            } else {
                None
            }
        })
        .ok_or("no binary piece")?;
    assert_eq!(cipher()?.decrypt_content(encrypted.bytes())?, original);
    let uploaded = session.handle(Input::Text(r#"{"res":"ok"}"#.into()), 7)?;
    let acknowledged = uploaded
        .into_iter()
        .find_map(|effect| {
            if let Effect::Uploaded {
                operation_id,
                content_hash,
            } = effect
            {
                Some((operation_id, content_hash))
            } else {
                None
            }
        })
        .ok_or("no exact ACK")?;
    assert_eq!(acknowledged.0, head.mutation_id);
    engine.acknowledge_upload("a", &acknowledged.0, &acknowledged.1)?;
    Ok(())
}
