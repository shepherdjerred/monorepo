//! Authenticated protocol completion → bounded `SQLite` image → durable CAS.

use super::{Arc, Engine, Memory, ProfileKind, RuntimeError, profile};
use obsidian_sync::{
    crypto::{EncryptionVersion, VaultCipher, VaultKey},
    session::{Checkpoint, Download, RemoteFile, Session, SessionConfig},
};
use tasknotes_vault::document::ContentRevision;

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

fn session(bytes: Option<&[u8]>) -> Result<Session> {
    let metadata: RemoteFile = serde_json::from_value(
        serde_json::json!({"uid":7,"path":"assets/file.bin","ctime":10,"mtime":20,"hash":bytes.map(|bytes|ContentRevision::of(bytes).as_str().to_owned()).unwrap_or_default(),"deleted":bytes.is_none(),"selected":true}),
    )?;
    let checkpoint = Checkpoint {
        cursor: 7,
        initial: false,
        pending: std::collections::BTreeMap::from([(7, metadata)]),
        ..Checkpoint::default()
    };
    let cipher = VaultCipher::new(
        EncryptionVersion::V3,
        &VaultKey::from_bytes(&[2; 32])?,
        "public-salt",
    )?;
    let mut session = Session::new(
        SessionConfig::new(
            "sync-test.obsidian.md",
            "public-token",
            "remote-vault",
            "test",
        )?,
        cipher,
        checkpoint,
    )?;
    session.begin(0)?;
    Ok(session)
}

fn persist(engine: &Engine, session: &Session) -> Result<()> {
    engine.save_checkpoint("a", &serde_json::to_string(session.checkpoint())?)?;
    Ok(())
}

#[test]
fn adopted_remote_content_allows_settled_removal_but_pending_incoming_does_not() -> Result<()> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("remove.db");
    let files = Arc::new(Memory::default());
    let engine = Engine::open(path.to_str().ok_or(RuntimeError::NotFound)?, files)?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.bind_sync_profile("a", "remote-vault")?;
    let bytes = b"remote bytes";
    let session = session(Some(bytes))?;
    persist(&engine, &session)?;
    let prepared = engine.prepare_authenticated_download(
        "a",
        &session,
        &Download {
            uid: 7,
            content_hash: Some(ContentRevision::of(bytes).as_str().into()),
            bytes: Some(bytes.to_vec()),
        },
    )?;
    assert!(matches!(
        engine.remove_profile("a"),
        Err(RuntimeError::Conflict)
    ));
    engine.apply_authenticated_download("a", &prepared)?;
    let db = rusqlite::Connection::open(path)?;
    let origins:(String,String)=db.query_row("SELECT image.origin,state.origin FROM transfer_payloads AS image JOIN transfer_payload_state AS state USING(row_id) LIMIT 1",[],|r|Ok((r.get(0)?,r.get(1)?)))?;
    assert_eq!(origins, ("incoming".into(), "content".into()));
    engine.remove_profile("a")?;
    assert!(engine.profiles()?.is_empty());
    Ok(())
}

#[test]
fn settled_removal_rejects_missing_or_corrupt_authoritative_payload_state() -> Result<()> {
    for corruption in [
        "DELETE FROM transfer_payload_state",
        "UPDATE transfer_payload_state SET origin='unknown'",
        "UPDATE transfer_payload_state SET written=99",
    ] {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("corrupt-remove.db");
        let files = Arc::new(Memory::default());
        files.seed("a", "assets/cached.bin", b"bytes")?;
        let engine = Engine::open(path.to_str().ok_or(RuntimeError::NotFound)?, files)?;
        engine.register_profile(profile(ProfileKind::LocalFolder))?;
        engine.refresh("a")?;
        let db = rusqlite::Connection::open(path)?;
        db.execute(corruption, [])?;
        assert!(matches!(
            engine.remove_profile("a"),
            Err(RuntimeError::Storage(_))
        ));
        assert_eq!(engine.profiles()?.len(), 1);
    }
    Ok(())
}

#[test]
fn staged_download_reopens_original_uid_clock_and_image_after_exchange_interruption() -> Result<()>
{
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("download.db");
    let path_str = path.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    let engine = Engine::open(path_str, files.clone())?;
    let mut selected = profile(ProfileKind::ObsidianSync);
    selected.approve_standard = false;
    engine.register_profile(selected)?;
    engine.bind_sync_profile("a", "remote-vault")?;
    let bytes = vec![6; 2 * 1024 * 1024 + 5];
    let session = session(Some(&bytes))?;
    persist(&engine, &session)?;
    let download = Download {
        uid: 7,
        content_hash: Some(ContentRevision::of(&bytes).as_str().to_owned()),
        bytes: Some(bytes),
    };
    let prepared = engine.prepare_authenticated_download("a", &session, &download)?;
    drop(download);
    files
        .state
        .lock()
        .map_err(|_| RuntimeError::Conflict)?
        .crash_after_exchange = true;
    assert!(matches!(
        engine.apply_authenticated_download("a", &prepared),
        Err(RuntimeError::Host(_))
    ));
    engine.close()?;
    drop(engine);
    let engine = Engine::open(path_str, files.clone())?;
    engine.apply_authenticated_download("a", &prepared)?;
    let reads = files
        .state
        .lock()
        .map_err(|_| RuntimeError::Conflict)?
        .reads;
    engine.apply_authenticated_download("a", &prepared)?;
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Conflict)?
            .reads,
        reads
    );
    let db = rusqlite::Connection::open(path)?;
    let values:(String,String,i64,i64)=db.query_row("SELECT bytes,base,created_ms,modified_ms FROM files WHERE profile='a' AND path='assets/file.bin'",[],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)))?;
    assert_eq!(
        values.0, values.1,
        "current/base must reference one immutable image"
    );
    assert_eq!((values.2, values.3), (10, 20));
    assert_eq!(
        db.query_row(
            "SELECT remote_revision FROM files WHERE profile='a' AND path='assets/file.bin'",
            [],
            |row| row.get::<_, String>(0)
        )?,
        "7"
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM transfer_payloads", [], |row| row
            .get::<_, i64>(0))?,
        1
    );
    assert!(engine.pending_upload_metadata("a")?.is_empty());
    assert_eq!(
        engine.load_checkpoint("a")?,
        Some(serde_json::to_string(session.checkpoint())?)
    );
    Ok(())
}

#[test]
fn download_requires_durable_notice_and_exact_hash_before_provider_or_payload_effect() -> Result<()>
{
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("invalid.db");
    let files = Arc::new(Memory::default());
    let engine = Engine::open(path.to_str().ok_or(RuntimeError::NotFound)?, files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.bind_sync_profile("a", "remote-vault")?;
    let session = session(Some(b"verified"))?;
    let bad = Download {
        uid: 7,
        bytes: Some(b"changed".to_vec()),
        content_hash: Some(ContentRevision::of(b"verified").as_str().to_owned()),
    };
    assert!(matches!(
        engine.prepare_authenticated_download("a", &session, &bad),
        Err(RuntimeError::NotFound)
    ));
    persist(&engine, &session)?;
    assert!(matches!(
        engine.prepare_authenticated_download("a", &session, &bad),
        Err(RuntimeError::Validation(_))
    ));
    assert_eq!(
        files
            .state
            .lock()
            .map_err(|_| RuntimeError::Conflict)?
            .reads,
        0
    );
    let db = rusqlite::Connection::open(path)?;
    assert_eq!(
        db.query_row("SELECT count(*) FROM transfer_payloads", [], |row| row
            .get::<_, i64>(0))?,
        0
    );
    assert_eq!(
        db.query_row("SELECT count(*) FROM journals", [], |row| row
            .get::<_, i64>(0))?,
        0
    );
    Ok(())
}

#[test]
fn prepared_empty_file_and_tombstone_are_distinct_and_binding_generation_is_fenced() -> Result<()> {
    for bytes in [Some(&b""[..]), None] {
        let files = Arc::new(Memory::default());
        let engine = Engine::open(":memory:", files.clone())?;
        engine.register_profile(profile(ProfileKind::ObsidianSync))?;
        engine.bind_sync_profile("a", "remote-vault")?;
        let session = session(bytes)?;
        persist(&engine, &session)?;
        let download = Download {
            uid: 7,
            bytes: bytes.map(<[u8]>::to_vec),
            content_hash: bytes.map(|bytes| ContentRevision::of(bytes).as_str().to_owned()),
        };
        let prepared = engine.prepare_authenticated_download("a", &session, &download)?;
        drop(download);
        if bytes.is_none() {
            let before = engine.sync_binding_identity("a", "remote-vault")?;
            engine.remove_profile("a")?;
            engine.register_profile(profile(ProfileKind::ObsidianSync))?;
            engine.bind_sync_profile("a", "remote-vault")?;
            assert_ne!(engine.sync_binding_identity("a", "remote-vault")?, before);
            assert!(matches!(
                engine.apply_authenticated_download("a", &prepared),
                Err(RuntimeError::Conflict)
            ));
        } else {
            engine.apply_authenticated_download("a", &prepared)?;
            assert_eq!(files.get("a", "assets/file.bin")?, Some(Vec::new()));
        }
    }
    Ok(())
}
