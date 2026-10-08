//! Actual incremental `SQLite` transfer storage, interruption and owner fencing.

use super::{Arc, Engine, Memory, ProfileKind, Result, RuntimeError, profile};
use tasknotes_runtime::types::{PAYLOAD_CHUNK_BYTES, PayloadRole, PayloadState};
use tasknotes_vault::document::ContentRevision;

#[test]
fn corrupt_durable_namespace_fails_reopen_without_replacement() -> Result<()> {
    let directory =
        tempfile::tempdir().map_err(|error| RuntimeError::Storage(error.to_string()))?;
    let path = directory.path().join("namespace.db");
    let path_str = path.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    let engine = Engine::open(path_str, files.clone())?;
    assert_eq!(engine.identity()?.len(), 64);
    engine.close()?;
    let db = rusqlite::Connection::open(&path)?;
    for invalid in ["", "a", &"A".repeat(64), &"g".repeat(64)] {
        db.execute(
            "UPDATE engine_metadata SET value=? WHERE key='identity'",
            [invalid],
        )?;
        assert!(matches!(
            Engine::open(path_str, files.clone()),
            Err(RuntimeError::Storage(_))
        ));
        assert_eq!(
            db.query_row(
                "SELECT value FROM engine_metadata WHERE key='identity'",
                [],
                |row| row.get::<_, String>(0)
            )?,
            invalid
        );
    }
    Ok(())
}

#[test]
fn settled_profile_removal_clears_only_its_owner_references() -> Result<()> {
    let directory =
        tempfile::tempdir().map_err(|error| RuntimeError::Storage(error.to_string()))?;
    let path = directory.path().join("owners.db");
    let files = Arc::new(Memory::default());
    let engine = Engine::open(path.to_str().ok_or(RuntimeError::NotFound)?, files.clone())?;
    for id in ["a", "b"] {
        let mut selected = profile(ProfileKind::LocalFolder);
        id.clone_into(&mut selected.id);
        engine.register_profile(selected)?;
        files.seed(id, "asset.bin", b"settled")?;
        engine.refresh(id)?;
    }
    let db = rusqlite::Connection::open(path)?;
    let image: String = db.query_row(
        "SELECT bytes FROM files WHERE profile='a' AND path='asset.bin'",
        [],
        |row| row.get(0),
    )?;
    for id in ["a", "b"] {
        engine.retain_payload(id, &image, PayloadRole::File, "cached", None)?;
        engine.retain_payload(id, &image, PayloadRole::Base, "base", None)?;
    }
    engine.retain_payload("a", &image, PayloadRole::ConflictLocal, "unresolved", None)?;
    assert!(matches!(
        engine.remove_profile("a"),
        Err(RuntimeError::Conflict)
    ));
    assert!(
        engine
            .retained_payload("a", PayloadRole::File, "cached")?
            .is_some()
    );
    engine.release_payload("a", &image, PayloadRole::ConflictLocal, "unresolved")?;
    engine.remove_profile("a")?;
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM payload_references WHERE profile='a'",
            [],
            |row| row.get::<_, i64>(0)
        )?,
        0
    );
    assert_eq!(
        db.query_row(
            "SELECT count(*) FROM transfer_payloads WHERE profile='a'",
            [],
            |row| row.get::<_, i64>(0)
        )?,
        0
    );
    assert!(
        engine
            .retained_payload("b", PayloadRole::File, "cached")?
            .is_some()
    );
    engine.register_profile(profile(ProfileKind::LocalFolder))?;
    assert!(matches!(
        engine.payload_info("a", &image),
        Err(RuntimeError::NotFound)
    ));
    assert!(
        engine
            .retained_payload("a", PayloadRole::File, "cached")?
            .is_none()
    );
    Ok(())
}

#[test]
fn payload_chunks_resume_after_reopen_and_exact_retries_are_immutable() -> Result<()> {
    let directory =
        tempfile::tempdir().map_err(|error| RuntimeError::Storage(error.to_string()))?;
    let path = directory.path().join("payloads.db");
    let path = path.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    let engine = Engine::open(path, files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    let info = engine.begin_payload(
        "a",
        "download:1",
        6,
        ContentRevision::of(b"abcdef").as_str(),
    )?;
    assert_eq!(info.state, PayloadState::Preparing);
    assert_eq!(
        engine
            .write_payload_chunk("a", "download:1", 0, b"abc")?
            .written,
        3
    );
    assert!(matches!(
        engine.write_payload_chunk("a", "download:1", 4, b"ef"),
        Err(RuntimeError::Conflict)
    ));
    assert!(matches!(
        engine.write_payload_chunk("a", "download:1", 2, b"cd"),
        Err(RuntimeError::Conflict)
    ));
    assert!(matches!(
        engine.seal_payload("a", "download:1"),
        Err(RuntimeError::Conflict)
    ));
    drop(engine);
    let engine = Engine::open(path, files)?;
    let resumed = engine.begin_payload(
        "a",
        "download:1",
        6,
        ContentRevision::of(b"abcdef").as_str(),
    )?;
    assert_eq!(resumed.written, 3);
    assert_eq!(
        engine.write_payload_chunk("a", "download:1", 0, b"abc")?,
        resumed
    );
    assert!(matches!(
        engine.write_payload_chunk("a", "download:1", 0, b"ABC"),
        Err(RuntimeError::Conflict)
    ));
    assert!(matches!(
        engine.begin_payload(
            "a",
            "download:1",
            6,
            ContentRevision::of(b"changed").as_str()
        ),
        Err(RuntimeError::Conflict)
    ));
    engine.write_payload_chunk("a", "download:1", 3, b"def")?;
    let sealed = engine.seal_payload("a", "download:1")?;
    assert_eq!(sealed.state, PayloadState::Sealed);
    assert_eq!(engine.seal_payload("a", "download:1")?, sealed);
    assert_eq!(
        engine.write_payload_chunk("a", "download:1", 0, b"abcdef")?,
        sealed
    );
    let mut actual = [0; 6];
    engine.read_payload_into("a", "download:1", 0, &mut actual)?;
    assert_eq!(&actual, b"abcdef");
    assert!(matches!(
        engine.write_payload_chunk("a", "download:1", 0, b"ABCDEF"),
        Err(RuntimeError::Conflict)
    ));
    assert!(matches!(
        engine.read_payload_into("a", "download:1", 6, &mut [0; 1]),
        Err(RuntimeError::Validation(_))
    ));
    Ok(())
}

#[test]
fn payload_ownership_empty_files_and_explicit_disposition_are_fenced() -> Result<()> {
    let engine = Engine::open(":memory:", Arc::new(Memory::default()))?;
    for id in ["a", "b"] {
        let mut selected = profile(ProfileKind::ObsidianSync);
        id.clone_into(&mut selected.id);
        engine.register_profile(selected)?;
    }
    engine.begin_payload("a", "same", 1, ContentRevision::of(b"a").as_str())?;
    assert!(matches!(
        engine.write_payload_chunk("b", "same", 0, b"a"),
        Err(RuntimeError::NotFound)
    ));
    engine.begin_payload("b", "same", 1, ContentRevision::of(b"b").as_str())?;
    for (id, bytes) in [("a", b"a"), ("b", b"b")] {
        engine.write_payload_chunk(id, "same", 0, bytes)?;
        engine.seal_payload(id, "same")?;
        let mut read = [0; 1];
        engine.read_payload_into(id, "same", 0, &mut read)?;
        assert_eq!(&read, bytes);
    }
    assert!(matches!(
        engine.remove_profile("a"),
        Err(RuntimeError::Conflict)
    ));
    engine.discard_payload("a", "same")?;
    engine.discard_payload("a", "same")?;
    assert_eq!(
        engine.payload_info("a", "same")?.state,
        PayloadState::Discarded
    );
    assert!(matches!(
        engine.begin_payload("a", "same", 1, ContentRevision::of(b"a").as_str()),
        Err(RuntimeError::Conflict)
    ));
    assert!(matches!(
        engine.read_payload_into("a", "same", 0, &mut [0; 1]),
        Err(RuntimeError::NotFound)
    ));
    engine.remove_profile("a")?;
    let mut read = [0; 1];
    engine.read_payload_into("b", "same", 0, &mut read)?;
    assert_eq!(&read, b"b");
    engine.begin_payload("b", "empty", 0, ContentRevision::of(b"").as_str())?;
    assert_eq!(
        engine.seal_payload("b", "empty")?.state,
        PayloadState::Sealed
    );
    engine.read_payload_into("b", "empty", 0, &mut [])?;
    Ok(())
}

#[test]
fn payload_hash_failure_preserves_unsealed_bytes_and_rejects_invalid_ranges() -> Result<()> {
    let engine = Engine::open(":memory:", Arc::new(Memory::default()))?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    let revision = ContentRevision::of(b"good");
    engine.begin_payload("a", "bad", 4, revision.as_str())?;
    engine.write_payload_chunk("a", "bad", 0, b"BAD!")?;
    assert!(matches!(
        engine.seal_payload("a", "bad"),
        Err(RuntimeError::Validation(_))
    ));
    assert_eq!(engine.payload_info("a", "bad")?.written, 4);
    assert_eq!(
        engine.payload_info("a", "bad")?.state,
        PayloadState::Preparing
    );
    assert!(matches!(
        engine.read_payload_into("a", "bad", 0, &mut [0; 4]),
        Err(RuntimeError::Conflict)
    ));
    for invalid in ["", "UPPERCASE", &"f".repeat(65)] {
        assert!(matches!(
            engine.begin_payload("a", "invalid", 4, invalid),
            Err(RuntimeError::Validation(_))
        ));
    }
    assert!(matches!(
        engine.begin_payload(
            "a",
            "oversize",
            obsidian_sync::session::DEFAULT_FILE_LIMIT + 1,
            revision.as_str()
        ),
        Err(RuntimeError::Validation(_))
    ));
    let too_large = vec![0; PAYLOAD_CHUNK_BYTES + 1];
    assert!(matches!(
        engine.write_payload_chunk("a", "bad", 0, &too_large),
        Err(RuntimeError::Validation(_))
    ));
    assert!(matches!(
        engine.write_payload_chunk("a", "bad", u64::MAX, b"x"),
        Err(RuntimeError::Validation(_))
    ));
    Ok(())
}

#[test]
fn payload_blob_and_prefix_commit_atomically_when_metadata_write_is_interrupted()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("fault.db");
    let files = Arc::new(Memory::default());
    let engine = Engine::open(path.to_str().ok_or(RuntimeError::NotFound)?, files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    engine.begin_payload("a", "fault", 4, ContentRevision::of(b"data").as_str())?;
    let db = rusqlite::Connection::open(&path)?;
    db.execute_batch("CREATE TRIGGER interrupt_prefix BEFORE UPDATE OF written ON transfer_payload_state BEGIN SELECT RAISE(ABORT,'injected interruption'); END;")?;
    assert!(matches!(
        engine.write_payload_chunk("a", "fault", 0, b"data"),
        Err(RuntimeError::Storage(_))
    ));
    drop(engine);
    let bytes: Vec<u8> = db.query_row(
        "SELECT bytes FROM transfer_payloads WHERE profile='a' AND id='fault'",
        [],
        |row| row.get(0),
    )?;
    assert_eq!(bytes, vec![0; 4]);
    db.execute_batch("DROP TRIGGER interrupt_prefix;")?;
    let engine = Engine::open(path.to_str().ok_or(RuntimeError::NotFound)?, files)?;
    assert_eq!(engine.payload_info("a", "fault")?.written, 0);
    engine.write_payload_chunk("a", "fault", 0, b"data")?;
    engine.seal_payload("a", "fault")?;
    let mut read = [0; 4];
    engine.read_payload_into("a", "fault", 0, &mut read)?;
    assert_eq!(&read, b"data");
    db.execute("INSERT INTO payload_references(profile,payload_id,kind,owner) VALUES('a','fault','journal','operation')",[])?;
    assert!(matches!(
        engine.discard_payload("a", "fault"),
        Err(RuntimeError::Conflict)
    ));
    let mut read = [0; 4];
    engine.read_payload_into("a", "fault", 0, &mut read)?;
    assert_eq!(&read, b"data");
    Ok(())
}

#[test]
fn immutable_payload_owner_pointers_are_fenced_without_copying_images() -> Result<()> {
    let engine = Engine::open(":memory:", Arc::new(Memory::default()))?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    for (id, bytes) in [("first", b"first"), ("later", b"later")] {
        engine.begin_payload("a", id, 5, ContentRevision::of(bytes).as_str())?;
        engine.write_payload_chunk("a", id, 0, bytes)?;
        engine.seal_payload("a", id)?;
    }
    engine.retain_payload("a", "first", PayloadRole::Outbox, "receipt", None)?;
    engine.retain_payload("a", "first", PayloadRole::Outbox, "receipt", None)?;
    assert!(matches!(
        engine.retain_payload("a", "first", PayloadRole::Outbox, "receipt", Some("wrong")),
        Err(RuntimeError::Conflict)
    ));
    engine.retain_payload("a", "first", PayloadRole::JournalBefore, "journal", None)?;
    engine.retain_payload("a", "first", PayloadRole::ConflictBase, "conflict", None)?;
    assert!(matches!(
        engine.discard_payload("a", "first"),
        Err(RuntimeError::Conflict)
    ));
    assert!(matches!(
        engine.retain_payload("a", "later", PayloadRole::Outbox, "receipt", None),
        Err(RuntimeError::Conflict)
    ));
    engine.retain_payload("a", "later", PayloadRole::Outbox, "receipt", Some("first"))?;
    assert_eq!(
        engine
            .retained_payload("a", PayloadRole::Outbox, "receipt")?
            .map(|info| info.id),
        Some("later".to_owned())
    );
    assert!(matches!(
        engine.release_payload("a", "first", PayloadRole::Outbox, "receipt"),
        Err(RuntimeError::Conflict)
    ));
    engine.release_payload("a", "first", PayloadRole::JournalBefore, "journal")?;
    engine.release_payload("a", "first", PayloadRole::ConflictBase, "conflict")?;
    engine.discard_payload("a", "first")?;
    let mut read = [0; 5];
    engine.read_payload_into("a", "later", 0, &mut read)?;
    assert_eq!(&read, b"later");
    Ok(())
}

#[test]
fn engine_close_preserves_durable_prefix_and_namespace_for_reopen() -> Result<()> {
    let directory =
        tempfile::tempdir().map_err(|error| RuntimeError::Storage(error.to_string()))?;
    let path = directory.path().join("close.db");
    let path = path.to_str().ok_or(RuntimeError::NotFound)?;
    let files = Arc::new(Memory::default());
    let engine = Engine::open(path, files.clone())?;
    engine.register_profile(profile(ProfileKind::ObsidianSync))?;
    let identity = engine.identity()?.to_owned();
    engine.begin_payload("a", "retained", 4, ContentRevision::of(b"data").as_str())?;
    engine.write_payload_chunk("a", "retained", 0, b"da")?;
    engine.close()?;
    engine.close()?;
    assert!(engine.is_closed());
    assert!(matches!(
        engine.payload_info("a", "retained"),
        Err(RuntimeError::Closed)
    ));
    assert!(matches!(
        engine.discard_payload("a", "retained"),
        Err(RuntimeError::Closed)
    ));
    drop(engine);
    let engine = Engine::open(path, files)?;
    assert_eq!(engine.identity()?, identity);
    assert_eq!(engine.payload_info("a", "retained")?.written, 2);
    engine.write_payload_chunk("a", "retained", 2, b"ta")?;
    engine.seal_payload("a", "retained")?;
    Ok(())
}
