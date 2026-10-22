//! Controlled callback lock order and lifetime replacement at actual boundaries.

use super::*;
use crate::types::{DisplacedMetadata, Profile, ProfileKind};
use obsidian_sync::{
    crypto::{EncryptionVersion, VaultCipher, VaultKey},
    session::{Checkpoint, Download, Session, SessionConfig},
};
use std::sync::mpsc;
use std::time::Duration;

type TestResult<T = ()> = std::result::Result<T, Box<dyn std::error::Error>>;
type Callback = Box<dyn Fn() -> Result<()> + Send + Sync>;

#[test]
fn mutable_image_metadata_never_materializes_immutable_blob_in_sqlite_vm() -> TestResult {
    let engine = Engine::open(":memory:", Arc::new(Files::default()))?;
    engine.database(|db| {
        let blob_root: i64 = db.query_row(
            "SELECT rootpage FROM sqlite_schema WHERE name='transfer_payloads'",
            [],
            |row| row.get(0),
        )?;
        for sql in [
            payloads::METADATA_SQL,
            payloads::PREFIX_SQL,
            payloads::SEAL_SQL,
            payloads::CONTENT_SEAL_SQL,
            payloads::RETIRE_SQL,
            payloads::CONTENT_IDENTITY_SQL,
            payloads::PROMOTE_SQL,
            MIGRATE_IMAGE_ORIGIN_SQL,
        ] {
            let mut statement = db.prepare(&format!("EXPLAIN {sql}"))?;
            let bindings = vec![rusqlite::types::Value::Null; statement.parameter_count()];
            let mut rows = statement.query(rusqlite::params_from_iter(bindings))?;
            let mut blob_cursors = std::collections::BTreeSet::new();
            while let Some(row) = rows.next()? {
                let opcode: String = row.get(1)?;
                let cursor: i64 = row.get(2)?;
                let column_or_root: i64 = row.get(3)?;
                if (opcode == "OpenRead" || opcode == "OpenWrite") && column_or_root == blob_root {
                    blob_cursors.insert(cursor);
                }
                if opcode == "Column" && blob_cursors.contains(&cursor) && column_or_root == 6 {
                    let flags: i64 = row.get(6)?;
                    assert_ne!(
                        flags & 0xc0,
                        0,
                        "Unbounded SQLite BLOB materialization in {sql}"
                    );
                }
            }
        }
        db.execute_batch(
            "CREATE TEMP TABLE legacy_images(profile TEXT,path TEXT,bytes BLOB,base BLOB);",
        )?;
        for column in ["bytes", "base"] {
            let sql = payloads::legacy_scan_sql("legacy_images", column, "json_array(path)");
            let mut statement = db.prepare(&format!("EXPLAIN {sql}"))?;
            let mut rows = statement.query([])?;
            while let Some(row) = rows.next()? {
                let opcode: String = row.get(1)?;
                let column: i64 = row.get(3)?;
                if opcode == "Column" && column >= 2 {
                    let flags: i64 = row.get(6)?;
                    assert_ne!(flags & 0xc0, 0, "Legacy scan materialized binary bytes");
                }
            }
        }
        Ok(())
    })?;
    Ok(())
}

#[test]
fn missing_or_corrupt_image_state_fails_without_reinitializing_binary_identity() -> TestResult {
    for corruption in [
        "DELETE FROM transfer_payload_state",
        "UPDATE transfer_payload_state SET written=3",
        "UPDATE transfer_payload_state SET sealed=2",
        "UPDATE transfer_payload_state SET origin='unknown'",
    ] {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("corrupt-state.db");
        let path = path.to_str().ok_or(RuntimeError::NotFound)?;
        let engine = Engine::open(path, Arc::new(Files::default()))?;
        engine.register_profile(profile())?;
        let revision = ContentRevision::of(b"xx");
        engine.begin_payload_handle("a", "immutable", 2, revision.as_str())?;
        engine.database(|db| {
            db.execute(corruption, [])?;
            Ok(())
        })?;
        engine.close()?;
        drop(engine);
        let engine = Engine::open(path, Arc::new(Files::default()))?;
        assert!(matches!(
            engine.begin_payload_handle("a", "immutable", 2, revision.as_str()),
            Err(RuntimeError::Storage(_))
        ));
        assert!(matches!(
            engine.payload_info("a", "immutable"),
            Err(RuntimeError::Storage(_))
        ));
    }
    Ok(())
}

#[test]
fn version_ten_origin_migration_preserves_binary_rows_and_transfer_prefixes() -> TestResult {
    let directory = tempfile::tempdir()?;
    let path = directory.path().join("origin-v10.db");
    let path_str = path.to_str().ok_or(RuntimeError::NotFound)?;
    let engine = Engine::open(path_str, Arc::new(Files::default()))?;
    engine.register_profile(profile())?;
    let revision = ContentRevision::of(b"opaque");
    engine.begin_payload_handle("a", "in-progress", 6, revision.as_str())?;
    engine.write_payload_chunk("a", "in-progress", 0, b"opa")?;
    engine.begin_payload_handle("a", "incoming", 6, revision.as_str())?;
    engine.write_payload_chunk("a", "incoming", 0, b"opaque")?;
    engine.seal_payload("a", "incoming")?;
    engine.database(|db| {
        payloads::promote_content(db, "a", "incoming")?;
        assert_eq!(
            db.query_row(
                "SELECT origin FROM transfer_payloads WHERE id='incoming'",
                [],
                |row| row.get::<_, String>(0)
            )?,
            "incoming"
        );
        Ok(())
    })?;
    engine.close()?;
    drop(engine);
    let db = Connection::open(&path)?;
    // Genuine v10 has origin only on the immutable BLOB table. Materialize its
    // historical values, then remove the new metadata column for this fixture.
    db.execute_batch("UPDATE transfer_payloads SET origin=(SELECT origin FROM transfer_payload_state WHERE transfer_payload_state.row_id=transfer_payloads.row_id); ALTER TABLE transfer_payload_state DROP COLUMN origin; ALTER TABLE journals DROP COLUMN diagnostics; ALTER TABLE journals DROP COLUMN title_plans; DROP TABLE title_lineage; CREATE TABLE device_state(profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,device TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(profile,device)); ALTER TABLE journals ADD COLUMN effect TEXT; PRAGMA user_version=10;")?;
    let before: Vec<(i64, String, String, Vec<u8>)> = db
        .prepare("SELECT row_id,id,origin,bytes FROM transfer_payloads ORDER BY row_id")?
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    let engine = Engine::open(path_str, Arc::new(Files::default()))?;
    let after: Vec<(i64, String, String, Vec<u8>)> = db
        .prepare("SELECT row_id,id,origin,bytes FROM transfer_payloads ORDER BY row_id")?
        .query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    assert_eq!(before, after);
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))?,
        12
    );
    assert_eq!(engine.payload_info("a", "in-progress")?.written, 3);
    assert_eq!(
        engine.payload_info("a", "incoming")?.state,
        crate::types::PayloadState::Sealed
    );
    engine.write_payload_chunk("a", "in-progress", 3, b"que")?;
    engine.seal_payload("a", "in-progress")?;
    engine.database(|db| {
        assert_eq!(
            payloads::content_identity(db, "a", 6, revision.as_str())?,
            "incoming"
        );
        Ok(())
    })?;
    Ok(())
}
#[derive(Default)]
struct Files {
    callback: Mutex<Option<Callback>>,
}
impl VaultFiles for Files {
    fn list_files(&self, _: &str) -> Result<Vec<String>> {
        if let Some(callback) = self
            .callback
            .lock()
            .map_err(|_| RuntimeError::Busy)?
            .as_ref()
        {
            callback()?;
        }
        Ok(Vec::new())
    }
    fn read_file(&self, _: &str, _: &str) -> Result<Option<Vec<u8>>> {
        Ok(None)
    }
    fn displaced_metadata(
        &self,
        _: &str,
        _: Option<&str>,
        _: u32,
    ) -> Result<Vec<DisplacedMetadata>> {
        Ok(Vec::new())
    }
    fn acknowledge_displaced(&self, _: &str, _: &str) -> Result<()> {
        Err(RuntimeError::Host("test has no backups".to_owned()))
    }
}

fn profile() -> Profile {
    Profile {
        id: "a".to_owned(),
        name: "Test".to_owned(),
        kind: ProfileKind::ObsidianSync,
        approve_standard: false,
    }
}
fn session() -> TestResult<Session> {
    let cipher = VaultCipher::new(
        EncryptionVersion::V3,
        &VaultKey::from_bytes(&[1; 32])?,
        "public-salt",
    )?;
    Ok(Session::new(
        SessionConfig::new("sync-test.obsidian.md", "public-token", "vault", "test")?,
        cipher,
        Checkpoint::default(),
    )?)
}

#[test]
fn callback_reentrant_close_rejects_before_mutating_shutdown_state() -> TestResult {
    let files = Arc::new(Files::default());
    let engine = Arc::new(Engine::open(":memory:", files.clone())?);
    engine.register_profile(profile())?;
    let weak = Arc::downgrade(&engine);
    *files.callback.lock().map_err(|_| RuntimeError::Busy)? = Some(Box::new(move || {
        let engine = weak.upgrade().ok_or(RuntimeError::Closed)?;
        assert!(matches!(engine.close(), Err(RuntimeError::Busy)));
        assert!(!engine.is_closed());
        Ok(())
    }));
    let (sent, received) = mpsc::sync_channel(1);
    let worker = engine.clone();
    let thread = std::thread::spawn(move || {
        let result = worker.refresh("a");
        sent.send(result).map_err(|_| RuntimeError::Busy)
    });
    received.recv_timeout(Duration::from_secs(5))??;
    thread.join().map_err(|_| RuntimeError::Busy)??;
    engine.close()?;
    assert!(engine.is_closed());
    Ok(())
}

#[test]
fn session_bridge_admission_never_waits_on_coordinator_held_by_reentrant_callback() -> TestResult {
    let files = Arc::new(Files::default());
    let engine = Arc::new(Engine::open(":memory:", files.clone())?);
    engine.register_profile(profile())?;
    engine.bind_sync_profile("a", "vault")?;
    let session = Arc::new(Mutex::new(session()?));
    let callback_session = session.clone();
    *files.callback.lock().map_err(|_| RuntimeError::Busy)? = Some(Box::new(move || {
        let _session = callback_session.lock().map_err(|_| RuntimeError::Busy)?;
        Ok(())
    }));
    let (ready, wait_ready) = mpsc::sync_channel(1);
    let (go, wait_go) = mpsc::sync_channel(1);
    let callback_engine = engine.clone();
    let callback = std::thread::spawn(move || -> Result<()> {
        let coordinator = callback_engine.coordinator("a")?;
        let _operation = lock_profile(&coordinator)?;
        ready.send(()).map_err(|_| RuntimeError::Busy)?;
        wait_go.recv().map_err(|_| RuntimeError::Busy)?;
        callback_engine.files.list_files("a")?;
        Ok(())
    });
    wait_ready.recv_timeout(Duration::from_secs(5))?;
    let (done, wait_done) = mpsc::sync_channel(1);
    let bridge_engine = engine.clone();
    let bridge = std::thread::spawn(move || -> Result<()> {
        let mut session = session.lock().map_err(|_| RuntimeError::Busy)?;
        go.send(()).map_err(|_| RuntimeError::Busy)?;
        assert!(matches!(
            bridge_engine.bind_sync_profile("a", "vault"),
            Err(RuntimeError::Busy)
        ));
        assert!(matches!(
            bridge_engine.prepare_authenticated_download(
                "a",
                &session,
                &Download {
                    uid: 7,
                    bytes: None,
                    content_hash: None
                }
            ),
            Err(RuntimeError::Busy)
        ));
        assert!(matches!(
            bridge_engine.queue_durable_upload("a", &mut session, "immutable", [0; 12], 0),
            Err(UploadPreparationError::Runtime(RuntimeError::Busy))
        ));
        drop(session);
        done.send(()).map_err(|_| RuntimeError::Busy)?;
        Ok(())
    });
    wait_done.recv_timeout(Duration::from_secs(5))?;
    bridge.join().map_err(|_| RuntimeError::Busy)??;
    callback.join().map_err(|_| RuntimeError::Busy)??;
    Ok(())
}

fn replace_profile_coordinated(engine: &Engine) -> Result<()> {
    engine.database(|db| {
        let tx = db.transaction()?;
        tx.execute("DELETE FROM profiles WHERE id='a'", [])?;
        tx.execute(
            "INSERT INTO profiles(id,json,lifetime) VALUES('a',?,lower(hex(randomblob(32))))",
            [serde_json::to_string(&profile())?],
        )?;
        tx.execute(
            "INSERT INTO profile_sync_bindings(profile,vault_id) VALUES('a','vault')",
            [],
        )?;
        tx.commit()?;
        Ok(())
    })
}

#[test]
fn payload_writer_waiting_for_owner_operation_cannot_touch_recreated_same_id() -> TestResult {
    let engine = Arc::new(Engine::open(":memory:", Arc::new(Files::default()))?);
    engine.register_profile(profile())?;
    let (lifetime, _) =
        engine.begin_payload_handle("a", "incoming", 1, ContentRevision::of(b"x").as_str())?;
    engine.discard_payload_handle("a", &lifetime, "incoming")?;
    let coordinator = engine.coordinator("a")?;
    let operation = lock_profile(&coordinator)?;
    let (started, wait_started) = mpsc::sync_channel(1);
    let (done, wait_done) = mpsc::sync_channel(1);
    let worker = engine.clone();
    let thread = std::thread::spawn(move || {
        started.send(()).map_err(|_| RuntimeError::Busy)?;
        let result = worker.write_payload_handle("a", &lifetime, "incoming", 0, b"x");
        done.send(result).map_err(|_| RuntimeError::Busy)
    });
    wait_started.recv_timeout(Duration::from_secs(5))?;
    // This thread holds the real profile coordinator while committing the
    // lifecycle replacement; the old writer must validate after acquiring it.
    replace_profile_coordinated(&engine)?;
    engine.reserve_image("a", "incoming", 1, ContentRevision::of(b"y").as_str(), true)?;
    engine.write_image("a", "incoming", 0, b"y")?;
    engine.seal_image("a", "incoming")?;
    drop(operation);
    assert!(matches!(
        wait_done.recv_timeout(Duration::from_secs(5))?,
        Err(RuntimeError::Closed)
    ));
    thread.join().map_err(|_| RuntimeError::Busy)??;
    let mut bytes = [0];
    engine.read_payload_into("a", "incoming", 0, &mut bytes)?;
    assert_eq!(&bytes, b"y");
    Ok(())
}

#[test]
fn prepared_download_waiting_for_coordinator_rejects_recreated_vault_binding() -> TestResult {
    let engine = Arc::new(Engine::open(":memory:", Arc::new(Files::default()))?);
    engine.register_profile(profile())?;
    engine.bind_sync_profile("a", "vault")?;
    let mut checkpoint = Checkpoint {
        cursor: 7,
        initial: false,
        ..Checkpoint::default()
    };
    checkpoint.pending.insert(
        7,
        serde_json::from_value(serde_json::json!({
            "uid":7,"path":"assets/deleted.bin","ctime":1,"mtime":2,
            "hash":"","deleted":true,"selected":true
        }))?,
    );
    let cipher = VaultCipher::new(
        EncryptionVersion::V3,
        &VaultKey::from_bytes(&[1; 32])?,
        "public-salt",
    )?;
    let session = Session::new(
        SessionConfig::new("sync-test.obsidian.md", "public-token", "vault", "test")?,
        cipher,
        checkpoint,
    )?;
    let checkpoint_json = serde_json::to_string(session.checkpoint())?;
    engine.save_checkpoint("a", &checkpoint_json)?;
    let prepared = engine.prepare_authenticated_download(
        "a",
        &session,
        &Download {
            uid: 7,
            bytes: None,
            content_hash: None,
        },
    )?;
    let coordinator = engine.coordinator("a")?;
    let operation = lock_profile(&coordinator)?;
    let (started, wait_started) = mpsc::sync_channel(1);
    let (done, wait_done) = mpsc::sync_channel(1);
    let worker = engine.clone();
    let thread = std::thread::spawn(move || {
        started.send(()).map_err(|_| RuntimeError::Busy)?;
        done.send(worker.apply_authenticated_download("a", &prepared))
            .map_err(|_| RuntimeError::Busy)
    });
    wait_started.recv_timeout(Duration::from_secs(5))?;
    replace_profile_coordinated(&engine)?;
    // Even identical actual vault ID and durable pending notice cannot revive
    // a prepared receipt owned by the previous profile generation.
    engine.database(|db| {
        db.execute(
            "INSERT INTO checkpoint_pending(profile,uid,json) VALUES('a',7,?)",
            [serde_json::to_string(
                session
                    .checkpoint()
                    .pending
                    .get(&7)
                    .ok_or(RuntimeError::NotFound)?,
            )?],
        )?;
        Ok(())
    })?;
    drop(operation);
    assert!(matches!(
        wait_done.recv_timeout(Duration::from_secs(5))?,
        Err(RuntimeError::Conflict)
    ));
    thread.join().map_err(|_| RuntimeError::Busy)??;
    engine.database(|db| {
        assert_eq!(
            db.query_row("SELECT count(*) FROM journals", [], |row| row
                .get::<_, i64>(0))?,
            0
        );
        Ok(())
    })?;
    Ok(())
}
