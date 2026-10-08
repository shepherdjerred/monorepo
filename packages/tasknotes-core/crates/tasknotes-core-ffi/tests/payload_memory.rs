//! Isolated actual SQLite↔Rust FFI-object allocation test. Foreign ABI/provider
//! allocator peaks are separate; no native app or Sync journey is executed.

use stats_alloc::{INSTRUMENTED_SYSTEM, Region, StatsAlloc};
use std::{alloc::System, sync::Arc};
use tasknotes_core_ffi::facet::{
    FacetDisplacedMetadata, FacetFileSnapshot, FacetHostError, FacetReplacementStage,
    FacetStagedExchange, FacetVaultFiles, FfiFacetEngine,
};
use tasknotes_runtime::types::PAYLOAD_CHUNK_BYTES;

#[global_allocator]
static GLOBAL: &StatsAlloc<System> = &INSTRUMENTED_SYSTEM;
type TestResult<T = ()> = Result<T, Box<dyn std::error::Error>>;

struct NoProvider;
fn unexpected<T>() -> Result<T, FacetHostError> {
    Err(FacetHostError::Contract {
        detail: "payload_storage_must_not_access_provider".into(),
    })
}
impl FacetVaultFiles for NoProvider {
    fn list_files(&self, _: String) -> Result<Vec<String>, FacetHostError> {
        unexpected()
    }
    fn open_file_snapshot(
        &self,
        _: String,
        _: String,
    ) -> Result<Option<FacetFileSnapshot>, FacetHostError> {
        unexpected()
    }
    fn open_displaced_snapshot(
        &self,
        _: String,
        _: String,
    ) -> Result<FacetFileSnapshot, FacetHostError> {
        unexpected()
    }
    fn read_snapshot_chunk(
        &self,
        _: String,
        _: String,
        _: u64,
        _: u32,
    ) -> Result<Vec<u8>, FacetHostError> {
        unexpected()
    }
    fn close_snapshot(&self, _: String, _: String) -> Result<(), FacetHostError> {
        unexpected()
    }
    fn begin_replacement(
        &self,
        _: String,
        _: String,
        _: String,
        _: Option<String>,
        _: u64,
        _: String,
    ) -> Result<FacetReplacementStage, FacetHostError> {
        unexpected()
    }
    fn write_replacement_chunk(
        &self,
        _: String,
        _: String,
        _: u64,
        _: Vec<u8>,
    ) -> Result<FacetReplacementStage, FacetHostError> {
        unexpected()
    }
    fn seal_replacement(
        &self,
        _: String,
        _: String,
    ) -> Result<FacetReplacementStage, FacetHostError> {
        unexpected()
    }
    fn compare_exchange_staged(
        &self,
        _: String,
        _: String,
        _: String,
        _: Option<String>,
        _: Option<String>,
    ) -> Result<FacetStagedExchange, FacetHostError> {
        unexpected()
    }
    fn discard_replacement(&self, _: String, _: String) -> Result<(), FacetHostError> {
        unexpected()
    }
    fn displaced_metadata(
        &self,
        _: String,
        _: Option<String>,
        _: u32,
    ) -> Result<Vec<FacetDisplacedMetadata>, FacetHostError> {
        unexpected()
    }
    fn acknowledge_displaced(&self, _: String, _: String) -> Result<(), FacetHostError> {
        unexpected()
    }
}

fn live_bytes() -> usize {
    let stats = GLOBAL.stats();
    stats
        .bytes_allocated
        .saturating_sub(stats.bytes_deallocated)
}

#[test]
fn supported_limit_streams_through_ffi_sqlite_reopen_hash_and_disposition_with_bounded_rust_peak()
-> TestResult {
    // Independently captured SHA256 of 199 one-MiB chunks of 0xa5. The runtime
    // streams/verifies actual stored bytes; no full plaintext fixture is loaded.
    let directory = tempfile::tempdir()?;
    let database = directory.path().join("payload.db");
    let database = database.to_str().ok_or("Invalid path")?;
    let size = obsidian_sync::session::DEFAULT_FILE_LIMIT;
    let revision = "d0e1dd9a108aaf17044942b6451f72d2ffdfdc38a4eb2975fb0548f49f000b4b";
    let engine = FfiFacetEngine::new(database, Arc::new(NoProvider))?;
    engine.register_profile(r#"{"schemaVersion":1,"id":"a","name":"Memory","kind":"obsidian_sync","approveStandard":false}"#)?;
    let baseline = live_bytes();
    let handle = engine
        .clone()
        .begin_payload("a".into(), "draft:199MiB".into(), size, revision)?;
    let mut peak = live_bytes().saturating_sub(baseline);
    let mut offset = 0;
    while offset < size {
        let before = live_bytes().saturating_sub(baseline);
        let region = Region::new(GLOBAL);
        let count = usize::try_from((size - offset).min(u64::try_from(PAYLOAD_CHUNK_BYTES)?))?;
        let bytes = vec![0xa5; count];
        peak = peak.max(live_bytes().saturating_sub(baseline));
        handle.write_chunk(offset, bytes)?;
        peak = peak.max(before.saturating_add(region.change().bytes_allocated));
        peak = peak.max(live_bytes().saturating_sub(baseline));
        offset += u64::try_from(count)?;
    }
    // The exact SHA256 is verified by the real incremental SQLite seal reader.
    let before = live_bytes().saturating_sub(baseline);
    let region = Region::new(GLOBAL);
    handle.seal()?;
    peak = peak.max(before.saturating_add(region.change().bytes_allocated));
    peak = peak.max(live_bytes().saturating_sub(baseline));
    handle.close_handle();
    engine.close_runtime()?;
    drop(engine);
    let engine = FfiFacetEngine::new(database, Arc::new(NoProvider))?;
    let handle = engine
        .clone()
        .open_payload("a".into(), "draft:199MiB".into())?;
    let info: serde_json::Value = serde_json::from_str(&handle.info_json()?)?;
    assert_eq!(
        info.get("size").and_then(serde_json::Value::as_u64),
        Some(size)
    );
    let mut offset = 0;
    while offset < size {
        let before = live_bytes().saturating_sub(baseline);
        let region = Region::new(GLOBAL);
        let count = u32::try_from((size - offset).min(u64::try_from(PAYLOAD_CHUNK_BYTES)?))?;
        let bytes = handle.read_chunk(offset, count)?;
        peak = peak.max(before.saturating_add(region.change().bytes_allocated));
        assert!(bytes.iter().all(|byte| *byte == 0xa5));
        peak = peak.max(live_bytes().saturating_sub(baseline));
        offset += u64::from(count);
    }
    assert_eq!(handle.read_chunk(size, 0)?, Vec::<u8>::new());
    handle.discard()?;
    handle.discard()?;
    let retired: serde_json::Value = serde_json::from_str(&handle.info_json()?)?;
    assert_eq!(
        retired.get("state").and_then(serde_json::Value::as_str),
        Some("discarded")
    );
    assert!(
        peak < 8 * PAYLOAD_CHUNK_BYTES,
        "Unexpected Rust payload allocation peak: {peak}"
    );
    eprintln!(
        "SQLite/Rust FFI 199MiB payload: conservative Rust live peak above baseline={peak} bytes (each bounded call includes total transient allocations); SQLite C and foreign host allocations excluded"
    );
    Ok(())
}
