use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::BodyDataStream;
use futures_util::StreamExt;
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::config::Config;
use crate::metrics::NamespaceGauge;

pub const STREAM_CHUNK_BYTES: usize = 64 * 1024;

pub const CANONICAL_NAMESPACES: &[(&str, &str)] = &[
    ("turbo:monorepo", "turbo"),
    ("turbo:monorepo-pull-request", "turbo"),
    ("gradle:main", "gradle"),
    ("sccache:trusted", "sccache"),
    ("sccache:pr", "sccache"),
];

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("payload exceeds maximum allowed size of {limit} bytes")]
    PayloadTooLarge { limit: u64 },
    #[error("request body stream failed: {0}")]
    BodyStream(String),
    #[error("filesystem error: {0}")]
    Io(#[from] std::io::Error),
    #[error("sqlite error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("blocking task failed: {0}")]
    Join(#[from] tokio::task::JoinError),
    #[error("internal synchronization poisoned")]
    Poisoned,
}

#[derive(Debug, Clone)]
pub struct EntryMeta {
    pub namespace: String,
    pub key: String,
    pub protocol: String,
    pub size_bytes: u64,
    pub sha256_hex: String,
    pub artifact_tag: Option<String>,
    pub duration_ms: Option<u64>,
    pub created_at: i64,
    pub last_accessed_at: i64,
    pub hit_count: u64,
}

pub struct OpenedEntry {
    pub meta: EntryMeta,
    pub file: tokio::fs::File,
}

#[derive(Debug, Clone)]
pub struct PutMetadata {
    pub namespace: String,
    pub key: String,
    pub protocol: String,
    pub max_bytes: u64,
    pub content_length_hint: Option<u64>,
    pub artifact_tag: Option<String>,
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Default)]
struct AccessDelta {
    last_accessed_at: i64,
    hit_delta: u64,
}

#[derive(Debug, Clone, Default)]
struct HourlyDelta {
    hits: u64,
    misses: u64,
    bytes_served: u64,
}

#[derive(Debug, Default)]
struct PendingDeltas {
    entries: HashMap<(String, String), AccessDelta>,
    hourly: HashMap<(i64, String, String), HourlyDelta>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryEntry {
    pub namespace: String,
    pub protocol: String,
    pub key: String,
    pub size_bytes: u64,
    pub sha256_hex: String,
    pub has_signature_tag: bool,
    pub duration_ms: Option<u64>,
    pub created_at: i64,
    pub last_accessed_at: i64,
    pub hit_count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryNamespace {
    pub namespace: String,
    pub protocol: String,
    pub entries: u64,
    pub stored_bytes: u64,
    pub ttl_seconds: u64,
    pub hits24h: u64,
    pub misses24h: u64,
    pub hit_rate24h: f64,
    pub bytes_served24h: u64,
    pub evictions24h: u64,
    pub last_accessed_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryWindow24h {
    pub hits: u64,
    pub misses: u64,
    pub hit_rate: f64,
    pub bytes_served: u64,
    pub bytes_ingested: u64,
    pub puts: u64,
    pub evictions: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryResponse {
    pub generated_at: i64,
    pub quota_bytes: u64,
    pub high_watermark_bytes: u64,
    pub low_watermark_bytes: u64,
    pub total_stored_bytes: u64,
    pub total_entries: u64,
    pub window24h: SummaryWindow24h,
    pub namespaces: Vec<SummaryNamespace>,
    pub largest_entries: Vec<SummaryEntry>,
    pub recent_entries: Vec<SummaryEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CleanOutcome {
    pub deleted: u64,
    pub scanned: u64,
}

#[derive(Debug, Clone, Default)]
pub struct EvictionOutcome {
    pub ttl_evicted_by_ns: BTreeMap<String, u64>,
    pub watermark_evicted_by_ns: BTreeMap<String, u64>,
}

struct StagingGuard {
    path: PathBuf,
    armed: bool,
}

impl StagingGuard {
    fn new(path: PathBuf) -> Self {
        Self { path, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }
}

impl Drop for StagingGuard {
    fn drop(&mut self) {
        if self.armed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

pub fn now_unix_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |dur| i64::try_from(dur.as_secs()).unwrap_or(i64::MAX))
}

pub fn now_unix_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |dur| i64::try_from(dur.as_millis()).unwrap_or(i64::MAX))
}

fn hour_bucket(unix_secs: i64) -> i64 {
    unix_secs - unix_secs.rem_euclid(3600)
}

pub fn namespace_dir_slug(namespace: &str) -> String {
    let mut out = String::with_capacity(namespace.len() + 4);
    for ch in namespace.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
            out.push(ch);
        } else if ch == ':' {
            out.push_str("__");
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        "default".to_owned()
    } else {
        out
    }
}

pub fn key_sha256_hex(key: &str) -> String {
    hex::encode(Sha256::digest(key.as_bytes()))
}

pub struct CacheStore {
    data_dir: PathBuf,
    staging_dir: PathBuf,
    blobs_dir: PathBuf,
    db_path: PathBuf,
    writer: Arc<Mutex<Connection>>,
    readers: Vec<Arc<Mutex<Connection>>>,
    reader_cursor: std::sync::atomic::AtomicUsize,
    pending: Arc<Mutex<PendingDeltas>>,
    writer_commits: Arc<std::sync::atomic::AtomicU64>,
}

impl CacheStore {
    pub fn open(data_dir: &Path) -> Result<Arc<Self>, StoreError> {
        let staging_dir = data_dir.join("staging");
        let blobs_dir = data_dir.join("blobs");
        std::fs::create_dir_all(&staging_dir)?;
        std::fs::create_dir_all(&blobs_dir)?;

        // Clean any leftover partial uploads from an unclean crash.
        if let Ok(entries) = std::fs::read_dir(&staging_dir) {
            for entry in entries.flatten() {
                let _ = std::fs::remove_file(entry.path());
            }
        }

        let db_path = data_dir.join("index.sqlite3");
        let writer_conn = Connection::open(&db_path)?;
        writer_conn.pragma_update(None, "journal_mode", "WAL")?;
        writer_conn.pragma_update(None, "synchronous", "NORMAL")?;
        writer_conn.pragma_update(None, "foreign_keys", "ON")?;
        writer_conn.busy_timeout(std::time::Duration::from_secs(5))?;

        writer_conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS entries (
                namespace TEXT NOT NULL,
                key TEXT NOT NULL,
                protocol TEXT NOT NULL,
                size_bytes INTEGER NOT NULL,
                sha256_hex TEXT NOT NULL,
                artifact_tag TEXT,
                duration_ms INTEGER,
                created_at INTEGER NOT NULL,
                last_accessed_at INTEGER NOT NULL,
                hit_count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (namespace, key)
            ) WITHOUT ROWID;
            CREATE INDEX IF NOT EXISTS idx_entries_last_accessed
                ON entries (last_accessed_at ASC);
            CREATE INDEX IF NOT EXISTS idx_entries_ns_last_accessed
                ON entries (namespace, last_accessed_at ASC);
            CREATE INDEX IF NOT EXISTS idx_entries_size_desc
                ON entries (size_bytes DESC);
            CREATE TABLE IF NOT EXISTS hourly_stats (
                hour_epoch INTEGER NOT NULL,
                namespace TEXT NOT NULL,
                protocol TEXT NOT NULL,
                hits INTEGER NOT NULL DEFAULT 0,
                misses INTEGER NOT NULL DEFAULT 0,
                puts INTEGER NOT NULL DEFAULT 0,
                evictions INTEGER NOT NULL DEFAULT 0,
                bytes_served INTEGER NOT NULL DEFAULT 0,
                bytes_ingested INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (hour_epoch, namespace, protocol)
            ) WITHOUT ROWID;",
        )?;

        let mut readers = Vec::with_capacity(4);
        for _ in 0..4 {
            let reader_conn = Connection::open_with_flags(
                &db_path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )?;
            reader_conn.busy_timeout(std::time::Duration::from_secs(5))?;
            readers.push(Arc::new(Mutex::new(reader_conn)));
        }

        Ok(Arc::new(Self {
            data_dir: data_dir.to_path_buf(),
            staging_dir,
            blobs_dir,
            db_path,
            writer: Arc::new(Mutex::new(writer_conn)),
            readers,
            reader_cursor: std::sync::atomic::AtomicUsize::new(0),
            pending: Arc::new(Mutex::new(PendingDeltas::default())),
            writer_commits: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        }))
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    /// Number of write transactions committed to SQLite since process start.
    /// Used by tests to verify zero synchronous SQLite writes on cache hits.
    pub fn writer_commit_count(&self) -> u64 {
        self.writer_commits
            .load(std::sync::atomic::Ordering::SeqCst)
    }

    pub fn blob_path(&self, namespace: &str, key: &str) -> PathBuf {
        let ns_slug = namespace_dir_slug(namespace);
        let key_hash = key_sha256_hex(key);
        let prefix2 = key_hash.get(0..2).unwrap_or("00");
        self.blobs_dir.join(ns_slug).join(prefix2).join(key_hash)
    }

    fn next_reader(&self) -> Arc<Mutex<Connection>> {
        let idx = self
            .reader_cursor
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let len = self.readers.len().max(1);
        Arc::clone(&self.readers[idx % len])
    }

    /// Streams an incoming request body in 64 KiB slices to a `.part` file on disk,
    /// computing SHA-256 on the fly, enforcing `max_bytes`, syncing data, atomically
    /// renaming into the sharded blob tree, and recording metadata in SQLite.
    pub async fn put_stream(
        &self,
        meta: PutMetadata,
        mut stream: BodyDataStream,
    ) -> Result<EntryMeta, StoreError> {
        if let Some(hint) = meta.content_length_hint
            && hint > meta.max_bytes
        {
            return Err(StoreError::PayloadTooLarge {
                limit: meta.max_bytes,
            });
        }

        let staging_path = self.staging_dir.join(format!("{}.part", Uuid::new_v4()));
        let mut guard = StagingGuard::new(staging_path.clone());
        let mut file = tokio::fs::File::create(&staging_path).await?;
        let mut hasher = Sha256::new();
        let mut total_written: u64 = 0;

        while let Some(next_chunk) = stream.next().await {
            let chunk = next_chunk.map_err(|err| StoreError::BodyStream(err.to_string()))?;
            for slice in chunk.chunks(STREAM_CHUNK_BYTES) {
                let slice_len = u64::try_from(slice.len()).unwrap_or(u64::MAX);
                let next_total = total_written.saturating_add(slice_len);
                if next_total > meta.max_bytes {
                    drop(file);
                    return Err(StoreError::PayloadTooLarge {
                        limit: meta.max_bytes,
                    });
                }
                hasher.update(slice);
                file.write_all(slice).await?;
                total_written = next_total;
            }
        }

        file.flush().await?;
        file.sync_data().await?;
        drop(file);

        let sha256_hex = hex::encode(hasher.finalize());
        let target_path = self.blob_path(&meta.namespace, &meta.key);
        if let Some(parent) = target_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::rename(&staging_path, &target_path).await?;
        guard.disarm();

        let now = now_unix_secs();
        let entry = EntryMeta {
            namespace: meta.namespace,
            key: meta.key,
            protocol: meta.protocol,
            size_bytes: total_written,
            sha256_hex,
            artifact_tag: meta.artifact_tag,
            duration_ms: meta.duration_ms,
            created_at: now,
            last_accessed_at: now,
            hit_count: 0,
        };

        // Clear any buffered delta for an overwritten key before upserting.
        if let Ok(mut pending) = self.pending.lock() {
            pending
                .entries
                .remove(&(entry.namespace.clone(), entry.key.clone()));
        }

        let writer = Arc::clone(&self.writer);
        let commits = Arc::clone(&self.writer_commits);
        let entry_for_db = entry.clone();
        tokio::task::spawn_blocking(move || -> Result<(), StoreError> {
            let mut conn = writer.lock().map_err(|_| StoreError::Poisoned)?;
            let tx = conn.transaction()?;
            let size_i64 = i64::try_from(entry_for_db.size_bytes).unwrap_or(i64::MAX);
            let dur_i64 = entry_for_db
                .duration_ms
                .map(|ms| i64::try_from(ms).unwrap_or(i64::MAX));
            tx.execute(
                "INSERT INTO entries (
                    namespace, key, protocol, size_bytes, sha256_hex,
                    artifact_tag, duration_ms, created_at, last_accessed_at, hit_count
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 0)
                ON CONFLICT(namespace, key) DO UPDATE SET
                    protocol = excluded.protocol,
                    size_bytes = excluded.size_bytes,
                    sha256_hex = excluded.sha256_hex,
                    artifact_tag = excluded.artifact_tag,
                    duration_ms = excluded.duration_ms,
                    created_at = excluded.created_at,
                    last_accessed_at = excluded.last_accessed_at,
                    hit_count = 0",
                params![
                    entry_for_db.namespace,
                    entry_for_db.key,
                    entry_for_db.protocol,
                    size_i64,
                    entry_for_db.sha256_hex,
                    entry_for_db.artifact_tag,
                    dur_i64,
                    entry_for_db.created_at,
                    entry_for_db.last_accessed_at,
                ],
            )?;
            let bucket = hour_bucket(entry_for_db.created_at);
            tx.execute(
                "INSERT INTO hourly_stats (hour_epoch, namespace, protocol, puts, bytes_ingested)
                 VALUES (?1, ?2, ?3, 1, ?4)
                 ON CONFLICT(hour_epoch, namespace, protocol) DO UPDATE SET
                    puts = puts + 1,
                    bytes_ingested = bytes_ingested + excluded.bytes_ingested",
                params![
                    bucket,
                    entry_for_db.namespace,
                    entry_for_db.protocol,
                    size_i64,
                ],
            )?;
            tx.commit()?;
            commits.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        })
        .await??;

        Ok(entry)
    }

    /// Reads entry metadata via a read-only SQLite connection and opens the blob
    /// file when `open_file` is true (`GET` vs `HEAD`). Records hit/miss deltas
    /// purely in memory (`PendingDeltas`) so cache hits perform ZERO disk writes.
    pub async fn get_entry(
        &self,
        namespace: &str,
        key: &str,
        protocol: &str,
        open_file: bool,
        record_miss: bool,
    ) -> Result<Option<(EntryMeta, Option<tokio::fs::File>)>, StoreError> {
        let reader = self.next_reader();
        let ns_owned = namespace.to_owned();
        let key_owned = key.to_owned();
        let meta_opt =
            tokio::task::spawn_blocking(move || -> Result<Option<EntryMeta>, StoreError> {
                let conn = reader.lock().map_err(|_| StoreError::Poisoned)?;
                let row = conn
                    .query_row(
                        "SELECT namespace, key, protocol, size_bytes, sha256_hex,
                            artifact_tag, duration_ms, created_at, last_accessed_at, hit_count
                     FROM entries
                     WHERE namespace = ?1 AND key = ?2",
                        params![ns_owned, key_owned],
                        |row| {
                            let size_raw: i64 = row.get(3)?;
                            let dur_raw: Option<i64> = row.get(6)?;
                            let hits_raw: i64 = row.get(9)?;
                            Ok(EntryMeta {
                                namespace: row.get(0)?,
                                key: row.get(1)?,
                                protocol: row.get(2)?,
                                size_bytes: u64::try_from(size_raw.max(0)).unwrap_or(0),
                                sha256_hex: row.get(4)?,
                                artifact_tag: row.get(5)?,
                                duration_ms: dur_raw
                                    .map(|val| u64::try_from(val.max(0)).unwrap_or(0)),
                                created_at: row.get(7)?,
                                last_accessed_at: row.get(8)?,
                                hit_count: u64::try_from(hits_raw.max(0)).unwrap_or(0),
                            })
                        },
                    )
                    .optional()?;
                Ok(row)
            })
            .await??;

        let now = now_unix_secs();
        let bucket = hour_bucket(now);

        let Some(mut meta) = meta_opt else {
            if record_miss {
                self.record_in_memory_miss(bucket, namespace, protocol);
            }
            return Ok(None);
        };

        let path = self.blob_path(namespace, key);
        let opened_file = if open_file {
            match tokio::fs::File::open(&path).await {
                Ok(file) => Some(file),
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                    if record_miss {
                        self.record_in_memory_miss(bucket, namespace, protocol);
                    }
                    return Ok(None);
                }
                Err(err) => return Err(StoreError::Io(err)),
            }
        } else {
            match tokio::fs::metadata(&path).await {
                Ok(_) => None,
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                    if record_miss {
                        self.record_in_memory_miss(bucket, namespace, protocol);
                    }
                    return Ok(None);
                }
                Err(err) => return Err(StoreError::Io(err)),
            }
        };

        let bytes_served_delta = if open_file { meta.size_bytes } else { 0 };
        if let Ok(mut pending) = self.pending.lock() {
            let delta = pending
                .entries
                .entry((namespace.to_owned(), key.to_owned()))
                .or_default();
            delta.last_accessed_at = delta.last_accessed_at.max(now);
            delta.hit_delta = delta.hit_delta.saturating_add(1);
            meta.last_accessed_at = meta.last_accessed_at.max(delta.last_accessed_at);
            meta.hit_count = meta.hit_count.saturating_add(delta.hit_delta);

            let hourly = pending
                .hourly
                .entry((bucket, namespace.to_owned(), protocol.to_owned()))
                .or_default();
            hourly.hits = hourly.hits.saturating_add(1);
            hourly.bytes_served = hourly.bytes_served.saturating_add(bytes_served_delta);
        }

        Ok(Some((meta, opened_file)))
    }

    pub fn record_miss_only(&self, namespace: &str, protocol: &str) {
        let bucket = hour_bucket(now_unix_secs());
        self.record_in_memory_miss(bucket, namespace, protocol);
    }

    fn record_in_memory_miss(&self, bucket: i64, namespace: &str, protocol: &str) {
        if let Ok(mut pending) = self.pending.lock() {
            let hourly = pending
                .hourly
                .entry((bucket, namespace.to_owned(), protocol.to_owned()))
                .or_default();
            hourly.misses = hourly.misses.saturating_add(1);
        }
    }

    /// Flushes buffered `last_accessed_at`, `hit_count`, and hourly hit/miss deltas
    /// in a single batched SQLite transaction.
    pub async fn flush_pending_deltas(&self) -> Result<usize, StoreError> {
        let (entry_deltas, hourly_deltas) = {
            let mut guard = self.pending.lock().map_err(|_| StoreError::Poisoned)?;
            if guard.entries.is_empty() && guard.hourly.is_empty() {
                return Ok(0);
            }
            (
                std::mem::take(&mut guard.entries),
                std::mem::take(&mut guard.hourly),
            )
        };

        let flushed_count = entry_deltas.len();
        let writer = Arc::clone(&self.writer);
        let commits = Arc::clone(&self.writer_commits);
        let retention_cutoff = hour_bucket(now_unix_secs()) - 7 * 86_400;

        tokio::task::spawn_blocking(move || -> Result<(), StoreError> {
            let mut conn = writer.lock().map_err(|_| StoreError::Poisoned)?;
            let tx = conn.transaction()?;
            {
                let mut stmt = tx.prepare_cached(
                    "UPDATE entries
                     SET last_accessed_at = MAX(last_accessed_at, ?3),
                         hit_count = hit_count + ?4
                     WHERE namespace = ?1 AND key = ?2",
                )?;
                for ((ns, key), delta) in &entry_deltas {
                    let hits_i64 = i64::try_from(delta.hit_delta).unwrap_or(i64::MAX);
                    stmt.execute(params![ns, key, delta.last_accessed_at, hits_i64])?;
                }
            }
            {
                let mut hstmt = tx.prepare_cached(
                    "INSERT INTO hourly_stats (hour_epoch, namespace, protocol, hits, misses, bytes_served)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                     ON CONFLICT(hour_epoch, namespace, protocol) DO UPDATE SET
                        hits = hits + excluded.hits,
                        misses = misses + excluded.misses,
                        bytes_served = bytes_served + excluded.bytes_served",
                )?;
                for ((hour_ep, ns, proto), delta) in &hourly_deltas {
                    let hits_i64 = i64::try_from(delta.hits).unwrap_or(i64::MAX);
                    let misses_i64 = i64::try_from(delta.misses).unwrap_or(i64::MAX);
                    let bytes_i64 = i64::try_from(delta.bytes_served).unwrap_or(i64::MAX);
                    hstmt.execute(params![hour_ep, ns, proto, hits_i64, misses_i64, bytes_i64])?;
                }
            }
            tx.execute(
                "DELETE FROM hourly_stats WHERE hour_epoch < ?1",
                params![retention_cutoff],
            )?;
            tx.commit()?;
            commits.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        })
        .await??;

        Ok(flushed_count)
    }

    /// Backdates an entry's timestamps (used by deterministic TTL/clean tests).
    pub async fn set_entry_timestamps(
        &self,
        namespace: &str,
        key: &str,
        created_at: i64,
        last_accessed_at: i64,
    ) -> Result<(), StoreError> {
        self.flush_pending_deltas().await?;
        let writer = Arc::clone(&self.writer);
        let commits = Arc::clone(&self.writer_commits);
        let ns = namespace.to_owned();
        let k = key.to_owned();
        tokio::task::spawn_blocking(move || -> Result<(), StoreError> {
            let conn = writer.lock().map_err(|_| StoreError::Poisoned)?;
            conn.execute(
                "UPDATE entries SET created_at = ?3, last_accessed_at = ?4
                 WHERE namespace = ?1 AND key = ?2",
                params![ns, k, created_at, last_accessed_at],
            )?;
            commits.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        })
        .await??;
        Ok(())
    }

    /// Cleans a `turbo:<slug>` namespace for `/v8/clean?slug=<slug>&olderThan=<days>`.
    pub async fn clean_namespace_older_than_days(
        &self,
        namespace: &str,
        older_than_days: u64,
    ) -> Result<CleanOutcome, StoreError> {
        self.flush_pending_deltas().await?;
        let now = now_unix_secs();
        let days_secs = i64::try_from(older_than_days.saturating_mul(86_400)).unwrap_or(i64::MAX);
        let cutoff = now.saturating_sub(days_secs);
        let inclusive = older_than_days == 0;

        let writer = Arc::clone(&self.writer);
        let commits = Arc::clone(&self.writer_commits);
        let ns_owned = namespace.to_owned();

        let (scanned, candidates) = tokio::task::spawn_blocking(
            move || -> Result<(u64, Vec<(String, String)>), StoreError> {
                let conn = writer.lock().map_err(|_| StoreError::Poisoned)?;
                let scanned_raw: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM entries WHERE namespace = ?1",
                    params![ns_owned],
                    |row| row.get(0),
                )?;
                let sql = if inclusive {
                    "SELECT key, protocol FROM entries
                     WHERE namespace = ?1 AND MAX(last_accessed_at, created_at) <= ?2"
                } else {
                    "SELECT key, protocol FROM entries
                     WHERE namespace = ?1 AND MAX(last_accessed_at, created_at) < ?2"
                };
                let mut stmt = conn.prepare(sql)?;
                let rows = stmt
                    .query_map(params![ns_owned, cutoff], |row| {
                        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                Ok((u64::try_from(scanned_raw.max(0)).unwrap_or(0), rows))
            },
        )
        .await??;

        if candidates.is_empty() {
            return Ok(CleanOutcome {
                deleted: 0,
                scanned,
            });
        }

        for (key, _) in &candidates {
            let blob = self.blob_path(namespace, key);
            match tokio::fs::remove_file(&blob).await {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => return Err(StoreError::Io(err)),
            }
        }

        let writer = Arc::clone(&self.writer);
        let ns_del = namespace.to_owned();
        let bucket = hour_bucket(now);
        let deleted = tokio::task::spawn_blocking(move || -> Result<u64, StoreError> {
            let mut conn = writer.lock().map_err(|_| StoreError::Poisoned)?;
            let tx = conn.transaction()?;
            let mut deleted_count: u64 = 0;
            let mut by_proto: BTreeMap<String, i64> = BTreeMap::new();
            {
                let mut del_stmt =
                    tx.prepare_cached("DELETE FROM entries WHERE namespace = ?1 AND key = ?2")?;
                for (key, proto) in &candidates {
                    let changed = del_stmt.execute(params![ns_del, key])?;
                    if changed > 0 {
                        deleted_count = deleted_count.saturating_add(1);
                        let count = by_proto.entry(proto.clone()).or_insert(0);
                        *count = count.saturating_add(1);
                    }
                }
            }
            for (proto, count) in by_proto {
                tx.execute(
                    "INSERT INTO hourly_stats (hour_epoch, namespace, protocol, evictions)
                     VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(hour_epoch, namespace, protocol) DO UPDATE SET
                        evictions = evictions + excluded.evictions",
                    params![bucket, ns_del, proto, count],
                )?;
            }
            tx.commit()?;
            commits.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(deleted_count)
        })
        .await??;

        Ok(CleanOutcome { deleted, scanned })
    }

    /// Runs continuous TTL + high/low watermark LRU eviction.
    pub async fn run_eviction(&self, config: &Config) -> Result<EvictionOutcome, StoreError> {
        self.flush_pending_deltas().await?;
        let now = now_unix_secs();
        let bucket = hour_bucket(now);
        let config_clone = config.clone();

        // Phase 1: Collect TTL-expired entries across all namespaces.
        let reader = self.next_reader();
        let ttl_candidates: Vec<(String, String, String)> = tokio::task::spawn_blocking(
            move || -> Result<Vec<(String, String, String)>, StoreError> {
                let conn = reader.lock().map_err(|_| StoreError::Poisoned)?;
                let mut namespaces_stmt = conn.prepare("SELECT DISTINCT namespace FROM entries")?;
                let namespaces: Vec<String> = namespaces_stmt
                    .query_map([], |row| row.get(0))?
                    .collect::<Result<Vec<_>, _>>()?;

                let mut expired = Vec::new();
                let mut qstmt = conn.prepare(
                    "SELECT key, protocol FROM entries
                     WHERE namespace = ?1 AND last_accessed_at < ?2",
                )?;
                for ns in namespaces {
                    let ttl_secs =
                        i64::try_from(config_clone.ttl_for_namespace(&ns)).unwrap_or(i64::MAX);
                    let cutoff = now.saturating_sub(ttl_secs);
                    let rows = qstmt.query_map(params![ns, cutoff], |row| {
                        Ok((
                            ns.clone(),
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                        ))
                    })?;
                    for item in rows {
                        expired.push(item?);
                    }
                }
                Ok(expired)
            },
        )
        .await??;

        let mut outcome = EvictionOutcome::default();
        if !ttl_candidates.is_empty() {
            let deleted = self.delete_batch(&ttl_candidates, bucket).await?;
            for (ns, count) in deleted {
                outcome.ttl_evicted_by_ns.insert(ns, count);
            }
        }

        // Phase 2: Check byte watermarks and evict oldest last_accessed_at down to low_watermark.
        let high_wm = config.high_watermark_bytes;
        let low_wm = config.low_watermark_bytes;
        let reader = self.next_reader();
        let watermark_candidates: Vec<(String, String, String)> = tokio::task::spawn_blocking(
            move || -> Result<Vec<(String, String, String)>, StoreError> {
                let conn = reader.lock().map_err(|_| StoreError::Poisoned)?;
                let total_raw: i64 = conn.query_row(
                    "SELECT COALESCE(SUM(size_bytes), 0) FROM entries",
                    [],
                    |row| row.get(0),
                )?;
                let mut remaining = u64::try_from(total_raw.max(0)).unwrap_or(0);
                if remaining <= high_wm {
                    return Ok(Vec::new());
                }

                let mut stmt = conn.prepare(
                    "SELECT namespace, key, protocol, size_bytes
                     FROM entries
                     ORDER BY last_accessed_at ASC, created_at ASC",
                )?;
                let mut rows = stmt.query([])?;
                let mut to_evict = Vec::new();
                while remaining > low_wm {
                    let Some(row) = rows.next()? else {
                        break;
                    };
                    let ns: String = row.get(0)?;
                    let key: String = row.get(1)?;
                    let proto: String = row.get(2)?;
                    let size_raw: i64 = row.get(3)?;
                    let size = u64::try_from(size_raw.max(0)).unwrap_or(0);
                    to_evict.push((ns, key, proto));
                    remaining = remaining.saturating_sub(size);
                }
                Ok(to_evict)
            },
        )
        .await??;

        if !watermark_candidates.is_empty() {
            let deleted = self.delete_batch(&watermark_candidates, bucket).await?;
            for (ns, count) in deleted {
                outcome.watermark_evicted_by_ns.insert(ns, count);
            }
        }

        Ok(outcome)
    }

    async fn delete_batch(
        &self,
        items: &[(String, String, String)],
        bucket: i64,
    ) -> Result<BTreeMap<String, u64>, StoreError> {
        for (ns, key, _) in items {
            let blob = self.blob_path(ns, key);
            match tokio::fs::remove_file(&blob).await {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => return Err(StoreError::Io(err)),
            }
        }

        let writer = Arc::clone(&self.writer);
        let commits = Arc::clone(&self.writer_commits);
        let owned = items.to_vec();
        tokio::task::spawn_blocking(move || -> Result<BTreeMap<String, u64>, StoreError> {
            let mut conn = writer.lock().map_err(|_| StoreError::Poisoned)?;
            let tx = conn.transaction()?;
            let mut by_ns: BTreeMap<String, u64> = BTreeMap::new();
            let mut by_ns_proto: BTreeMap<(String, String), i64> = BTreeMap::new();
            {
                let mut del_stmt =
                    tx.prepare_cached("DELETE FROM entries WHERE namespace = ?1 AND key = ?2")?;
                for (ns, key, proto) in &owned {
                    let changed = del_stmt.execute(params![ns, key])?;
                    if changed > 0 {
                        let ns_entry = by_ns.entry(ns.clone()).or_insert(0);
                        *ns_entry = ns_entry.saturating_add(1);
                        let np_entry = by_ns_proto.entry((ns.clone(), proto.clone())).or_insert(0);
                        *np_entry = np_entry.saturating_add(1);
                    }
                }
            }
            for ((ns, proto), count) in by_ns_proto {
                tx.execute(
                    "INSERT INTO hourly_stats (hour_epoch, namespace, protocol, evictions)
                     VALUES (?1, ?2, ?3, ?4)
                     ON CONFLICT(hour_epoch, namespace, protocol) DO UPDATE SET
                        evictions = evictions + excluded.evictions",
                    params![bucket, ns, proto, count],
                )?;
            }
            tx.commit()?;
            commits.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(by_ns)
        })
        .await?
    }

    /// Readiness probe: verifies SQLite read capability AND writable staging filesystem.
    pub async fn check_ready(&self) -> Result<(), StoreError> {
        let reader = self.next_reader();
        tokio::task::spawn_blocking(move || -> Result<(), StoreError> {
            let conn = reader.lock().map_err(|_| StoreError::Poisoned)?;
            let one: i64 = conn.query_row("SELECT 1", [], |row| row.get(0))?;
            if one != 1 {
                return Err(StoreError::Io(std::io::Error::other(
                    "unexpected sqlite probe value",
                )));
            }
            Ok(())
        })
        .await??;

        let probe_path = self.staging_dir.join(format!(".readyz-{}", Uuid::new_v4()));
        let mut guard = StagingGuard::new(probe_path.clone());
        let mut probe_file = tokio::fs::File::create(&probe_path).await?;
        probe_file.write_all(b"ok").await?;
        probe_file.sync_data().await?;
        drop(probe_file);
        tokio::fs::remove_file(&probe_path).await?;
        guard.disarm();
        Ok(())
    }

    pub async fn namespace_gauges(&self) -> Result<Vec<NamespaceGauge>, StoreError> {
        let reader = self.next_reader();
        tokio::task::spawn_blocking(move || -> Result<Vec<NamespaceGauge>, StoreError> {
            let conn = reader.lock().map_err(|_| StoreError::Poisoned)?;
            let mut map: BTreeMap<String, (u64, u64)> = BTreeMap::new();
            for (ns, _) in CANONICAL_NAMESPACES {
                map.insert((*ns).to_owned(), (0, 0));
            }
            let mut stmt = conn.prepare(
                "SELECT namespace, COUNT(*), COALESCE(SUM(size_bytes), 0)
                 FROM entries
                 GROUP BY namespace",
            )?;
            let rows = stmt.query_map([], |row| {
                let ns: String = row.get(0)?;
                let cnt: i64 = row.get(1)?;
                let sum: i64 = row.get(2)?;
                Ok((
                    ns,
                    u64::try_from(cnt.max(0)).unwrap_or(0),
                    u64::try_from(sum.max(0)).unwrap_or(0),
                ))
            })?;
            for row in rows {
                let (ns, cnt, sum) = row?;
                map.insert(ns, (cnt, sum));
            }
            Ok(map
                .into_iter()
                .map(|(namespace, (entries, stored_bytes))| NamespaceGauge {
                    namespace,
                    entries,
                    stored_bytes,
                })
                .collect())
        })
        .await?
    }

    /// Read-only SPA summary merging SQLite state with in-memory pending deltas
    /// (zero disk writes, real-time hit counts).
    pub async fn summary(&self, config: &Config) -> Result<SummaryResponse, StoreError> {
        let now_s = now_unix_secs();
        let now_ms = now_unix_millis();
        let cutoff_hour = hour_bucket(now_s) - 23 * 3600;
        let config_clone = config.clone();

        let (pending_entries, pending_hourly) = {
            let guard = self.pending.lock().map_err(|_| StoreError::Poisoned)?;
            (guard.entries.clone(), guard.hourly.clone())
        };

        let reader = self.next_reader();
        tokio::task::spawn_blocking(move || -> Result<SummaryResponse, StoreError> {
            let conn = reader.lock().map_err(|_| StoreError::Poisoned)?;

            #[derive(Default, Clone)]
            struct NsAgg {
                protocol: String,
                entries: u64,
                stored_bytes: u64,
                hits24h: u64,
                misses24h: u64,
                bytes_served24h: u64,
                bytes_ingested24h: u64,
                puts24h: u64,
                evictions24h: u64,
                last_accessed_at: Option<i64>,
            }

            let mut ns_map: BTreeMap<String, NsAgg> = BTreeMap::new();
            for (ns, proto) in CANONICAL_NAMESPACES {
                ns_map.insert(
                    (*ns).to_owned(),
                    NsAgg {
                        protocol: (*proto).to_owned(),
                        ..NsAgg::default()
                    },
                );
            }

            {
                let mut stmt = conn.prepare(
                    "SELECT namespace, protocol, COUNT(*), COALESCE(SUM(size_bytes), 0), MAX(last_accessed_at)
                     FROM entries
                     GROUP BY namespace, protocol",
                )?;
                let rows = stmt.query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, Option<i64>>(4)?,
                    ))
                })?;
                for row in rows {
                    let (ns, proto, cnt, sum, max_access) = row?;
                    let agg = ns_map.entry(ns).or_default();
                    agg.protocol = proto;
                    agg.entries = agg
                        .entries
                        .saturating_add(u64::try_from(cnt.max(0)).unwrap_or(0));
                    agg.stored_bytes = agg
                        .stored_bytes
                        .saturating_add(u64::try_from(sum.max(0)).unwrap_or(0));
                    agg.last_accessed_at = match (agg.last_accessed_at, max_access) {
                        (Some(a), Some(b)) => Some(a.max(b)),
                        (Some(a), None) => Some(a),
                        (None, b) => b,
                    };
                }
            }

            {
                let mut hstmt = conn.prepare(
                    "SELECT namespace, protocol,
                            COALESCE(SUM(hits), 0),
                            COALESCE(SUM(misses), 0),
                            COALESCE(SUM(bytes_served), 0),
                            COALESCE(SUM(bytes_ingested), 0),
                            COALESCE(SUM(puts), 0),
                            COALESCE(SUM(evictions), 0)
                     FROM hourly_stats
                     WHERE hour_epoch >= ?1
                     GROUP BY namespace, protocol",
                )?;
                let rows = hstmt.query_map(params![cutoff_hour], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                        row.get::<_, i64>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, i64>(7)?,
                    ))
                })?;
                for row in rows {
                    let (ns, proto, hits, misses, served, ingested, puts, evictions) = row?;
                    let agg = ns_map.entry(ns).or_default();
                    if agg.protocol.is_empty() {
                        agg.protocol = proto;
                    }
                    agg.hits24h = agg
                        .hits24h
                        .saturating_add(u64::try_from(hits.max(0)).unwrap_or(0));
                    agg.misses24h = agg
                        .misses24h
                        .saturating_add(u64::try_from(misses.max(0)).unwrap_or(0));
                    agg.bytes_served24h = agg
                        .bytes_served24h
                        .saturating_add(u64::try_from(served.max(0)).unwrap_or(0));
                    agg.bytes_ingested24h = agg
                        .bytes_ingested24h
                        .saturating_add(u64::try_from(ingested.max(0)).unwrap_or(0));
                    agg.puts24h = agg
                        .puts24h
                        .saturating_add(u64::try_from(puts.max(0)).unwrap_or(0));
                    agg.evictions24h = agg
                        .evictions24h
                        .saturating_add(u64::try_from(evictions.max(0)).unwrap_or(0));
                }
            }

            // Merge unflushed in-memory deltas for real-time SPA accuracy.
            for ((ns, _key), delta) in &pending_entries {
                if let Some(agg) = ns_map.get_mut(ns) {
                    agg.last_accessed_at = Some(
                        agg.last_accessed_at
                            .map_or(delta.last_accessed_at, |prev| prev.max(delta.last_accessed_at)),
                    );
                }
            }
            for ((hour_ep, ns, proto), delta) in &pending_hourly {
                if *hour_ep >= cutoff_hour {
                    let agg = ns_map.entry(ns.clone()).or_default();
                    if agg.protocol.is_empty() {
                        agg.protocol.clone_from(proto);
                    }
                    agg.hits24h = agg.hits24h.saturating_add(delta.hits);
                    agg.misses24h = agg.misses24h.saturating_add(delta.misses);
                    agg.bytes_served24h = agg.bytes_served24h.saturating_add(delta.bytes_served);
                }
            }

            let mut total_stored_bytes: u64 = 0;
            let mut total_entries: u64 = 0;
            let mut w_hits: u64 = 0;
            let mut w_misses: u64 = 0;
            let mut w_served: u64 = 0;
            let mut w_ingested: u64 = 0;
            let mut w_puts: u64 = 0;
            let mut w_evictions: u64 = 0;

            let mut namespaces = Vec::with_capacity(ns_map.len());
            for (namespace, agg) in ns_map {
                total_stored_bytes = total_stored_bytes.saturating_add(agg.stored_bytes);
                total_entries = total_entries.saturating_add(agg.entries);
                w_hits = w_hits.saturating_add(agg.hits24h);
                w_misses = w_misses.saturating_add(agg.misses24h);
                w_served = w_served.saturating_add(agg.bytes_served24h);
                w_ingested = w_ingested.saturating_add(agg.bytes_ingested24h);
                w_puts = w_puts.saturating_add(agg.puts24h);
                w_evictions = w_evictions.saturating_add(agg.evictions24h);

                let denom = agg.hits24h.saturating_add(agg.misses24h);
                let hit_rate24h = if denom == 0 {
                    0.0
                } else {
                    (agg.hits24h as f64) / (denom as f64)
                };
                let protocol = if agg.protocol.is_empty() {
                    if namespace.starts_with("turbo:") {
                        "turbo".to_owned()
                    } else if namespace.starts_with("gradle:") {
                        "gradle".to_owned()
                    } else {
                        "sccache".to_owned()
                    }
                } else {
                    agg.protocol
                };

                namespaces.push(SummaryNamespace {
                    ttl_seconds: config_clone.ttl_for_namespace(&namespace),
                    namespace,
                    protocol,
                    entries: agg.entries,
                    stored_bytes: agg.stored_bytes,
                    hits24h: agg.hits24h,
                    misses24h: agg.misses24h,
                    hit_rate24h,
                    bytes_served24h: agg.bytes_served24h,
                    evictions24h: agg.evictions24h,
                    last_accessed_at: agg.last_accessed_at,
                });
            }

            let total_denom = w_hits.saturating_add(w_misses);
            let window_hit_rate = if total_denom == 0 {
                0.0
            } else {
                (w_hits as f64) / (total_denom as f64)
            };

            let map_entry_row = |row: &rusqlite::Row<'_>| -> rusqlite::Result<SummaryEntry> {
                let ns: String = row.get(0)?;
                let key: String = row.get(1)?;
                let protocol: String = row.get(2)?;
                let size_raw: i64 = row.get(3)?;
                let sha256_hex: String = row.get(4)?;
                let tag: Option<String> = row.get(5)?;
                let dur_raw: Option<i64> = row.get(6)?;
                let created_at: i64 = row.get(7)?;
                let mut last_accessed_at: i64 = row.get(8)?;
                let hits_raw: i64 = row.get(9)?;
                let mut hit_count = u64::try_from(hits_raw.max(0)).unwrap_or(0);

                if let Some(delta) = pending_entries.get(&(ns.clone(), key.clone())) {
                    last_accessed_at = last_accessed_at.max(delta.last_accessed_at);
                    hit_count = hit_count.saturating_add(delta.hit_delta);
                }

                Ok(SummaryEntry {
                    namespace: ns,
                    protocol,
                    key,
                    size_bytes: u64::try_from(size_raw.max(0)).unwrap_or(0),
                    sha256_hex,
                    has_signature_tag: tag.is_some_and(|s| !s.is_empty()),
                    duration_ms: dur_raw.map(|d| u64::try_from(d.max(0)).unwrap_or(0)),
                    created_at,
                    last_accessed_at,
                    hit_count,
                })
            };

            let largest_entries = {
                let mut stmt = conn.prepare(
                    "SELECT namespace, key, protocol, size_bytes, sha256_hex,
                            artifact_tag, duration_ms, created_at, last_accessed_at, hit_count
                     FROM entries
                     ORDER BY size_bytes DESC, last_accessed_at DESC
                     LIMIT 25",
                )?;
                stmt.query_map([], map_entry_row)?
                    .collect::<Result<Vec<_>, _>>()?
            };

            let recent_entries = {
                let mut stmt = conn.prepare(
                    "SELECT namespace, key, protocol, size_bytes, sha256_hex,
                            artifact_tag, duration_ms, created_at, last_accessed_at, hit_count
                     FROM entries
                     ORDER BY last_accessed_at DESC, created_at DESC
                     LIMIT 25",
                )?;
                let mut list = stmt
                    .query_map([], map_entry_row)?
                    .collect::<Result<Vec<_>, _>>()?;
                list.sort_by(|left, right| {
                    right
                        .last_accessed_at
                        .cmp(&left.last_accessed_at)
                        .then_with(|| right.created_at.cmp(&left.created_at))
                });
                list
            };

            Ok(SummaryResponse {
                generated_at: now_ms,
                quota_bytes: config_clone.quota_bytes,
                high_watermark_bytes: config_clone.high_watermark_bytes,
                low_watermark_bytes: config_clone.low_watermark_bytes,
                total_stored_bytes,
                total_entries,
                window24h: SummaryWindow24h {
                    hits: w_hits,
                    misses: w_misses,
                    hit_rate: window_hit_rate,
                    bytes_served: w_served,
                    bytes_ingested: w_ingested,
                    puts: w_puts,
                    evictions: w_evictions,
                },
                namespaces,
                largest_entries,
                recent_entries,
            })
        })
        .await?
    }
}
