//! Isolated allocator measurement of real `SQLite` attachment imports.
//! SQLite/provider allocations outside Rust's allocator are a separate native gate.

use stats_alloc::{INSTRUMENTED_SYSTEM, StatsAlloc};
use std::{
    alloc::System,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};
use tasknotes_runtime::{
    Result, RuntimeError,
    engine::Engine,
    types::{FileExchange, FileSnapshot, Profile, ProfileKind, VaultFiles},
};

#[global_allocator]
static GLOBAL: &StatsAlloc<System> = &INSTRUMENTED_SYSTEM;
const FILES: usize = 128;
const PAYLOAD: usize = 1024 * 1024;

#[derive(Default)]
struct SyntheticAttachments {
    baseline: AtomicUsize,
    peak: AtomicUsize,
    reads: AtomicUsize,
}
fn live_bytes() -> usize {
    let stats = GLOBAL.stats();
    stats
        .bytes_allocated
        .saturating_sub(stats.bytes_deallocated)
}
impl VaultFiles for SyntheticAttachments {
    fn open_file_snapshot(&self, _: &str, path: &str) -> Result<Option<FileSnapshot>> {
        if !path.starts_with("Attachments/") {
            return Ok(None);
        }
        let bytes = vec![0x80; PAYLOAD];
        Ok(Some(FileSnapshot {
            id: path.to_owned(),
            size: u64::try_from(PAYLOAD)
                .map_err(|_| RuntimeError::Host("test size failed".to_owned()))?,
            revision: tasknotes_vault::document::ContentRevision::of(&bytes)
                .as_str()
                .to_owned(),
        }))
    }
    fn read_snapshot_chunk(&self, _: &str, _: &str, offset: u64, length: u32) -> Result<Vec<u8>> {
        let length = usize::try_from(length)
            .map_err(|_| RuntimeError::Host("test size failed".to_owned()))?;
        if length > PAYLOAD
            || offset
                .checked_add(u64::try_from(length).map_err(|_| RuntimeError::Conflict)?)
                .is_none_or(|end| end > u64::try_from(PAYLOAD).unwrap_or(0))
        {
            return Err(RuntimeError::Conflict);
        }
        let payload = vec![0x80; length];
        self.reads.fetch_add(1, Ordering::SeqCst);
        self.peak.fetch_max(
            live_bytes().saturating_sub(self.baseline.load(Ordering::SeqCst)),
            Ordering::SeqCst,
        );
        Ok(payload)
    }
    fn close_snapshot(&self, _: &str, _: &str) -> Result<()> {
        Ok(())
    }
    fn list_files(&self, _: &str) -> Result<Vec<String>> {
        Ok((0..FILES)
            .map(|i| format!("Attachments/{i:04}.bin"))
            .collect())
    }
    fn read_file(&self, _: &str, path: &str) -> Result<Option<Vec<u8>>> {
        if path.starts_with("Attachments/") {
            return Err(RuntimeError::Host(
                "binary full-array read is forbidden".to_owned(),
            ));
        }
        Ok(None)
    }
    fn compare_exchange(
        &self,
        _: &str,
        _: &str,
        _: Option<&str>,
        _: Option<&[u8]>,
    ) -> Result<FileExchange> {
        Err(RuntimeError::Host(
            "synthetic attachment provider is read-only".to_owned(),
        ))
    }
    fn displaced_metadata(
        &self,
        _: &str,
        _: Option<&str>,
        _: u32,
    ) -> Result<Vec<tasknotes_runtime::types::DisplacedMetadata>> {
        Ok(Vec::new())
    }
    fn read_displaced(&self, _: &str, _: &str) -> Result<Vec<u8>> {
        Err(RuntimeError::NotFound)
    }
    fn acknowledge_displaced(&self, _: &str, _: &str) -> Result<()> {
        Err(RuntimeError::Host(
            "synthetic provider has no displaced versions".to_owned(),
        ))
    }
}

#[test]
fn refresh_does_not_retain_payloads_from_previous_attachments()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let database = directory.path().join("streaming.sqlite");
    let files = Arc::new(SyntheticAttachments::default());
    let engine = Engine::open(database.to_str().unwrap(), files.clone())?;
    engine.register_profile(Profile {
        id: "large".to_owned(),
        name: "Large".to_owned(),
        kind: ProfileKind::LocalFolder,
        approve_standard: true,
    })?;
    files.baseline.store(live_bytes(), Ordering::SeqCst);
    let snapshot = engine.refresh("large")?;
    assert_eq!(files.reads.load(Ordering::SeqCst), FILES);
    assert!(snapshot.tasks.is_empty());
    let peak = files.peak.load(Ordering::SeqCst);
    assert!(
        peak < PAYLOAD * 8,
        "live Rust attachment allocations grew to {peak} bytes"
    );
    drop(engine);
    let db = rusqlite::Connection::open(database)?;
    let (count, total): (i64, i64) = db.query_row(
        "SELECT count(*),sum(transfer_payloads.size) FROM files JOIN transfer_payloads ON transfer_payloads.profile=files.profile AND transfer_payloads.id=files.bytes WHERE files.profile='large'",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    assert_eq!(count, i64::try_from(FILES)?);
    assert_eq!(total, i64::try_from(FILES * PAYLOAD)?);
    eprintln!("128 MiB durably imported; measured peak live Rust allocation delta {peak} bytes");
    Ok(())
}
