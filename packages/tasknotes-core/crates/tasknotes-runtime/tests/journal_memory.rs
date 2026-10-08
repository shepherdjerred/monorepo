//! Real disk/SQLite binary journal memory. This controlled single-writer
//! capability is component evidence, not native provider or power-loss acceptance.

use sha2::{Digest, Sha256};
use stats_alloc::{INSTRUMENTED_SYSTEM, StatsAlloc};
use std::{
    alloc::System,
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
};
use tasknotes_runtime::{
    Result, RuntimeError,
    engine::Engine,
    types::{
        Command, DisplacedMetadata, FileSnapshot, Mutation, PAYLOAD_CHUNK_BYTES, Profile,
        ProfileKind, ReplacementStage, StagedExchange, VaultFiles,
    },
};

#[global_allocator]
static GLOBAL: &StatsAlloc<System> = &INSTRUMENTED_SYSTEM;
const SIZE: usize = 199 * 1024 * 1024;

fn host(error: impl std::fmt::Display) -> RuntimeError {
    RuntimeError::Host(error.to_string())
}
fn hash_file(path: &Path) -> Result<(u64, String)> {
    let mut file = File::open(path).map_err(host)?;
    let mut chunk = vec![0; PAYLOAD_CHUNK_BYTES];
    let mut digest = Sha256::new();
    let mut size = 0;
    loop {
        let count = file.read(&mut chunk).map_err(host)?;
        if count == 0 {
            break;
        }
        digest.update(chunk.get(..count).ok_or(RuntimeError::Conflict)?);
        size += u64::try_from(count).map_err(host)?;
    }
    Ok((size, hex::encode(digest.finalize())))
}

struct Stage {
    expected: Option<String>,
    file: PathBuf,
    metadata: ReplacementStage,
}
#[derive(Default)]
struct State {
    sequence: u64,
    snapshots: BTreeMap<String, PathBuf>,
    stages: BTreeMap<String, Stage>,
    backups: BTreeMap<String, (PathBuf, DisplacedMetadata)>,
    outcomes: BTreeMap<String, StagedExchange>,
}
struct Disk {
    root: PathBuf,
    private: PathBuf,
    state: Mutex<State>,
}
impl Disk {
    fn new(root: &Path) -> Result<Self> {
        let private = root.join("private");
        let root = root.join("vault");
        fs::create_dir_all(&private).map_err(host)?;
        fs::create_dir_all(&root).map_err(host)?;
        Ok(Self {
            root,
            private,
            state: Mutex::new(State::default()),
        })
    }
    fn state(&self) -> Result<MutexGuard<'_, State>> {
        self.state.lock().map_err(host)
    }
    fn path(&self, profile: &str, path: &str) -> Result<PathBuf> {
        if profile != "large" {
            return Err(RuntimeError::NotFound);
        }
        tasknotes_vault::path::VaultPath::parse(path)?;
        Ok(self.root.join(path))
    }
    fn snapshot(&self, source: &Path, state: &mut State) -> Result<FileSnapshot> {
        state.sequence += 1;
        let id = format!("snapshot:{}", state.sequence);
        let target = self.private.join(&id);
        // Independent disk copy; no full-array or writable hard-link alias.
        fs::copy(source, &target).map_err(host)?;
        let (size, revision) = hash_file(&target)?;
        state.snapshots.insert(id.clone(), target);
        Ok(FileSnapshot { id, size, revision })
    }
}
impl VaultFiles for Disk {
    fn list_files(&self, profile: &str) -> Result<Vec<String>> {
        self.path(profile, "asset.bin")?;
        fs::read_dir(&self.root)
            .map_err(host)?
            .map(|item| {
                let item = item.map_err(host)?;
                item.file_name()
                    .into_string()
                    .map_err(|_| host("non-UTF8 fixture path"))
            })
            .collect()
    }
    fn read_file(&self, profile: &str, path: &str) -> Result<Option<Vec<u8>>> {
        // Configuration text has an explicit assembly boundary. The shared
        // adapter rejects binary extensions before opening any snapshot.
        tasknotes_runtime::types::read_text_file(self, profile, path)
    }
    fn open_file_snapshot(&self, profile: &str, path: &str) -> Result<Option<FileSnapshot>> {
        let source = self.path(profile, path)?;
        if !source.try_exists().map_err(host)? {
            return Ok(None);
        }
        let mut state = self.state()?;
        self.snapshot(&source, &mut state).map(Some)
    }
    fn open_displaced_snapshot(&self, profile: &str, backup: &str) -> Result<FileSnapshot> {
        self.path(profile, "asset.bin")?;
        let mut state = self.state()?;
        let source = state
            .backups
            .get(backup)
            .ok_or(RuntimeError::NotFound)?
            .0
            .clone();
        self.snapshot(&source, &mut state)
    }
    fn read_snapshot_chunk(
        &self,
        profile: &str,
        snapshot: &str,
        offset: u64,
        length: u32,
    ) -> Result<Vec<u8>> {
        self.path(profile, "asset.bin")?;
        let state = self.state()?;
        let source = state
            .snapshots
            .get(snapshot)
            .ok_or(RuntimeError::NotFound)?;
        let mut file = File::open(source).map_err(host)?;
        let length = usize::try_from(length).map_err(host)?;
        let size = file.metadata().map_err(host)?.len();
        if length > PAYLOAD_CHUNK_BYTES
            || offset
                .checked_add(u64::try_from(length).map_err(host)?)
                .is_none_or(|end| end > size)
        {
            return Err(RuntimeError::Conflict);
        }
        file.seek(SeekFrom::Start(offset)).map_err(host)?;
        let mut bytes = vec![0; length];
        file.read_exact(&mut bytes).map_err(host)?;
        Ok(bytes)
    }
    fn close_snapshot(&self, profile: &str, snapshot: &str) -> Result<()> {
        self.path(profile, "asset.bin")?;
        let file = self
            .state()?
            .snapshots
            .remove(snapshot)
            .ok_or(RuntimeError::NotFound)?;
        fs::remove_file(file).map_err(host)
    }
    fn begin_replacement(
        &self,
        profile: &str,
        operation: &str,
        path: &str,
        expected: Option<&str>,
        size: u64,
        revision: &str,
    ) -> Result<ReplacementStage> {
        self.path(profile, path)?;
        let mut state = self.state()?;
        if let Some(previous) = state.stages.get(operation) {
            if previous.metadata.path != path
                || previous.expected.as_deref() != expected
                || previous.metadata.size != size
                || previous.metadata.revision != revision
            {
                return Err(RuntimeError::Conflict);
            }
            return Ok(previous.metadata.clone());
        }
        let file = self.private.join(operation);
        File::create(&file)
            .map_err(host)?
            .sync_all()
            .map_err(host)?;
        let metadata = ReplacementStage {
            id: operation.into(),
            operation_id: operation.into(),
            path: path.into(),
            size,
            revision: revision.into(),
            written: 0,
            sealed: false,
        };
        state.stages.insert(
            operation.into(),
            Stage {
                expected: expected.map(str::to_owned),
                file,
                metadata: metadata.clone(),
            },
        );
        Ok(metadata)
    }
    fn write_replacement_chunk(
        &self,
        profile: &str,
        handle: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<ReplacementStage> {
        self.path(profile, "asset.bin")?;
        let mut state = self.state()?;
        let replacement = state.stages.get_mut(handle).ok_or(RuntimeError::NotFound)?;
        if bytes.len() > PAYLOAD_CHUNK_BYTES
            || replacement.metadata.sealed
            || offset > replacement.metadata.written
            || offset
                .checked_add(u64::try_from(bytes.len()).map_err(host)?)
                .is_none_or(|end| end > replacement.metadata.size)
        {
            return Err(RuntimeError::Conflict);
        }
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&replacement.file)
            .map_err(host)?;
        file.seek(SeekFrom::Start(offset)).map_err(host)?;
        if offset < replacement.metadata.written {
            if offset + u64::try_from(bytes.len()).map_err(host)? > replacement.metadata.written {
                return Err(RuntimeError::Conflict);
            }
            let mut original = vec![0; bytes.len()];
            file.read_exact(&mut original).map_err(host)?;
            if original != bytes {
                return Err(RuntimeError::Conflict);
            }
        } else {
            file.write_all(bytes).map_err(host)?;
            file.sync_all().map_err(host)?;
            replacement.metadata.written += u64::try_from(bytes.len()).map_err(host)?;
        }
        Ok(replacement.metadata.clone())
    }
    fn seal_replacement(&self, profile: &str, handle: &str) -> Result<ReplacementStage> {
        self.path(profile, "asset.bin")?;
        let mut state = self.state()?;
        let replacement = state.stages.get_mut(handle).ok_or(RuntimeError::NotFound)?;
        let (size, revision) = hash_file(&replacement.file)?;
        if size != replacement.metadata.size
            || size != replacement.metadata.written
            || revision != replacement.metadata.revision
        {
            return Err(RuntimeError::Conflict);
        }
        replacement.metadata.sealed = true;
        Ok(replacement.metadata.clone())
    }
    fn compare_exchange_staged(
        &self,
        profile: &str,
        operation: &str,
        path: &str,
        expected: Option<&str>,
        handle: Option<&str>,
    ) -> Result<StagedExchange> {
        let destination = self.path(profile, path)?;
        let mut state = self.state()?;
        if let Some(outcome) = state.outcomes.get(operation) {
            return Ok(outcome.clone());
        }
        let replacement = handle
            .map(|id| {
                let source = state.stages.get(id).ok_or(RuntimeError::NotFound)?;
                if source.metadata.operation_id != operation
                    || source.metadata.path != path
                    || source.expected.as_deref() != expected
                    || !source.metadata.sealed
                {
                    return Err(RuntimeError::Conflict);
                }
                Ok(source.file.clone())
            })
            .transpose()?;
        let old = if destination.try_exists().map_err(host)? {
            Some(hash_file(&destination)?)
        } else {
            None
        };
        if old.as_ref().map(|(_, revision)| revision.as_str()) != expected {
            return Ok(StagedExchange {
                applied: false,
                displaced: None,
            });
        }
        let displaced = old
            .map(|(size, revision)| {
                state.sequence += 1;
                let id = format!("backup:{}", state.sequence);
                let file = self.private.join(&id);
                fs::copy(&destination, &file).map_err(host)?;
                File::open(&file).map_err(host)?.sync_all().map_err(host)?;
                let metadata = DisplacedMetadata {
                    id: id.clone(),
                    path: path.into(),
                    size,
                    revision,
                };
                state.backups.insert(id, (file, metadata.clone()));
                Ok::<DisplacedMetadata, RuntimeError>(metadata)
            })
            .transpose()?;
        if let Some(replacement) = replacement {
            fs::rename(replacement, destination).map_err(host)?;
        } else if displaced.is_some() {
            fs::remove_file(destination).map_err(host)?;
        }
        let outcome = StagedExchange {
            applied: true,
            displaced,
        };
        state.outcomes.insert(operation.into(), outcome.clone());
        Ok(outcome)
    }
    fn discard_replacement(&self, profile: &str, handle: &str) -> Result<()> {
        self.path(profile, "asset.bin")?;
        let state = self.state()?;
        let replacement = state.stages.get(handle).ok_or(RuntimeError::NotFound)?;
        if replacement.file.try_exists().map_err(host)? {
            fs::remove_file(&replacement.file).map_err(host)?;
        }
        Ok(())
    }
    fn displaced_metadata(
        &self,
        profile: &str,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Vec<DisplacedMetadata>> {
        self.path(profile, "asset.bin")?;
        Ok(self
            .state()?
            .backups
            .iter()
            .filter(|(id, _)| after.is_none_or(|after| id.as_str() > after))
            .take(usize::try_from(limit).map_err(host)?)
            .map(|(_, (_, metadata))| metadata.clone())
            .collect())
    }
    fn acknowledge_displaced(&self, profile: &str, backup: &str) -> Result<()> {
        self.path(profile, "asset.bin")?;
        let (file, _) = self
            .state()?
            .backups
            .remove(backup)
            .ok_or(RuntimeError::NotFound)?;
        fs::remove_file(file).map_err(host)
    }
}

fn mutation(id: &str, command: Command) -> Mutation {
    Mutation {
        mutation_id: id.into(),
        at: "2026-10-03T12:00:00Z".into(),
        execution_context: None,
        command,
    }
}
fn measure<T>(label: &str, action: impl FnOnce() -> Result<T>) -> Result<T> {
    let before = GLOBAL.stats();
    let result = action()?;
    let after = GLOBAL.stats();
    let allocated = after.bytes_allocated - before.bytes_allocated;
    let freed = after.bytes_deallocated - before.bytes_deallocated;
    assert!(
        allocated.saturating_sub(freed) < PAYLOAD_CHUNK_BYTES * 8,
        "unbounded retained Rust state in {label}"
    );
    eprintln!(
        "phase={label} Rust_retained_delta={} Rust_TOTAL_transient_allocated={allocated}",
        i128::try_from(allocated).map_err(host)? - i128::try_from(freed).map_err(host)?
    );
    Ok(result)
}

fn seed_large_file(path: &Path) -> Result<(u64, String)> {
    let mut file = File::create(path).map_err(host)?;
    let chunk = vec![0x80; PAYLOAD_CHUNK_BYTES];
    for _ in 0..199 {
        file.write_all(&chunk).map_err(host)?;
    }
    file.sync_all().map_err(host)?;
    drop(file);
    hash_file(path)
}

#[test]
fn real_199_mib_sqlite_migration_rename_replay_and_undo_stay_bounded()
-> std::result::Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    let disk = Arc::new(Disk::new(directory.path())?);
    let source = disk.root.join("asset.bin");
    let (size, revision) = seed_large_file(&source)?;
    assert_eq!(size, u64::try_from(SIZE)?);
    let database = directory.path().join("engine.sqlite");
    let path = database.to_str().ok_or(RuntimeError::NotFound)?;
    let engine = Engine::open(path, disk.clone())?;
    engine.register_profile(Profile {
        id: "large".into(),
        name: "Large".into(),
        kind: ProfileKind::LocalFolder,
        approve_standard: true,
    })?;
    measure("refresh", || engine.refresh("large"))?;
    engine.close()?;
    drop(engine);
    let db = rusqlite::Connection::open(&database)?;
    let (image, row_id): (String, i64) = db.query_row("SELECT transfer_payloads.id,row_id FROM transfer_payloads JOIN files ON files.profile=transfer_payloads.profile AND files.bytes=transfer_payloads.id WHERE files.path='asset.bin'", [], |row| Ok((row.get(0)?,row.get(1)?)))?;
    let identity: String = db.query_row(
        "SELECT value FROM engine_metadata WHERE key='identity'",
        [],
        |row| row.get(0),
    )?;
    // Genuine v10 representation: its exact BLOB row is untouched; only remove
    // the metadata-only v11 column and restore the historical schema version.
    db.execute_batch(
        "ALTER TABLE transfer_payload_state DROP COLUMN origin; ALTER TABLE journals DROP COLUMN diagnostics; ALTER TABLE journals DROP COLUMN title_plans; DROP TABLE title_lineage; PRAGMA user_version=10;",
    )?;
    let engine = measure("genuine_v10_to_v11", || Engine::open(path, disk.clone()))?;
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |row| row.get::<_, u32>(0))?,
        11
    );
    assert_eq!(
        db.query_row(
            "SELECT value FROM engine_metadata WHERE key='identity'",
            [],
            |row| row.get::<_, String>(0)
        )?,
        identity
    );
    assert_eq!(
        db.query_row(
            "SELECT row_id FROM transfer_payloads WHERE id=?",
            [&image],
            |row| row.get::<_, i64>(0)
        )?,
        row_id
    );
    let rename = mutation(
        "large-rename",
        Command::Rename {
            path: "asset.bin".into(),
            new_path: "renamed.bin".into(),
            expected_revision: Some(revision.clone()),
        },
    );
    let receipt = measure("rename", || engine.execute("large", &rename))?;
    assert!(receipt.applied);
    assert!(!source.exists());
    assert_eq!(
        hash_file(&disk.root.join("renamed.bin"))?,
        (size, revision.clone())
    );
    engine.close()?;
    drop(engine);
    let engine = Engine::open(path, disk.clone())?;
    let replay = measure("exact_replay_after_reopen", || {
        engine.execute("large", &rename)
    })?;
    assert_eq!(
        serde_json::to_value(&replay)?,
        serde_json::to_value(&receipt)?
    );
    let undo = mutation(
        "large-undo",
        Command::Undo {
            receipt_id: "large-rename".into(),
        },
    );
    assert!(measure("undo", || engine.execute("large", &undo))?.applied);
    assert_eq!(hash_file(&source)?, (size, revision));
    assert!(!disk.root.join("renamed.bin").exists());
    assert_eq!(
        db.query_row("SELECT count(*) FROM transfer_payloads", [], |row| row
            .get::<_, i64>(0))?,
        1
    );
    assert_eq!(
        db.query_row(
            "SELECT bytes FROM files WHERE path='asset.bin'",
            [],
            |row| row.get::<_, String>(0)
        )?,
        image
    );
    assert!(disk.state()?.snapshots.is_empty());
    assert!(disk.state()?.backups.is_empty());
    eprintln!("scope=controlled_disk_SQLite_component; no_native_provider_or_power_loss_claim");
    Ok(())
}
