use std::fs::{self, File};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use rusqlite::{Connection, OptionalExtension as _, TransactionBehavior, params};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::archive::{ParsedChartArchive, is_valid_archive_filename};
use crate::error::AppError;
use crate::index_yaml::{
    CatalogSummaryResponse, ChartReleaseView, ChartSummaryItem, RenderedIndexYaml,
    classify_chart_version, group_releases_newest_first, render_index_yaml,
};

static STAGING_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug)]
pub struct StoredRelease {
    pub name: String,
    pub version: String,
    pub app_version: String,
    pub description: String,
    pub api_version: String,
    pub digest_hex: String,
    pub size_bytes: u64,
    pub content_fingerprint: Option<String>,
    pub created_at: String,
    pub archive_filename: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UploadOutcome {
    Created,
    Idempotent,
}

#[derive(Clone, Copy, Debug)]
pub struct RegistryStats {
    pub chart_count: i64,
    pub release_count: i64,
    pub total_bytes: i64,
    pub catalog_revision: i64,
}

#[derive(Clone)]
pub struct ChartStore {
    inner: Arc<ChartStoreInner>,
}

struct ChartStoreInner {
    blobs_dir: PathBuf,
    staging_dir: PathBuf,
    quota_bytes: u64,
    db: Mutex<Connection>,
    write_gate: tokio::sync::Mutex<()>,
    index_cache: Mutex<Option<RenderedIndexYaml>>,
}

impl ChartStore {
    pub fn open(data_dir: &Path, quota_bytes: u64) -> Result<Self, AppError> {
        let blobs_dir = data_dir.join("blobs");
        let staging_dir = data_dir.join("staging");
        fs::create_dir_all(&blobs_dir).map_err(|err| {
            AppError::Storage(format!(
                "failed to create blobs dir '{}': {err}",
                blobs_dir.display()
            ))
        })?;
        fs::create_dir_all(&staging_dir).map_err(|err| {
            AppError::Storage(format!(
                "failed to create staging dir '{}': {err}",
                staging_dir.display()
            ))
        })?;

        clean_staging_files(&staging_dir)?;

        let db_path = data_dir.join("charts.sqlite3");
        let conn = Connection::open(&db_path).map_err(|err| {
            AppError::Storage(format!(
                "failed to open SQLite database '{}': {err}",
                db_path.display()
            ))
        })?;

        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA foreign_keys = ON;

             CREATE TABLE IF NOT EXISTS registry_meta (
               id INTEGER PRIMARY KEY CHECK (id = 1),
               catalog_revision INTEGER NOT NULL
             );
             INSERT OR IGNORE INTO registry_meta (id, catalog_revision) VALUES (1, 0);

             CREATE TABLE IF NOT EXISTS chart_releases (
               name TEXT NOT NULL,
               version TEXT NOT NULL,
               app_version TEXT NOT NULL,
               description TEXT NOT NULL DEFAULT '',
               api_version TEXT NOT NULL DEFAULT 'v2',
               digest_hex TEXT NOT NULL,
               size_bytes INTEGER NOT NULL,
               content_fingerprint TEXT,
               created_at TEXT NOT NULL,
               archive_filename TEXT NOT NULL UNIQUE,
               PRIMARY KEY (name, version)
             );",
        )
        .map_err(|err| AppError::Storage(format!("failed to initialize SQLite schema: {err}")))?;

        reconcile_blobs_on_startup(&conn, &blobs_dir)?;

        Ok(Self {
            inner: Arc::new(ChartStoreInner {
                blobs_dir,
                staging_dir,
                quota_bytes,
                db: Mutex::new(conn),
                write_gate: tokio::sync::Mutex::new(()),
                index_cache: Mutex::new(None),
            }),
        })
    }

    pub fn quota_bytes(&self) -> u64 {
        self.inner.quota_bytes
    }

    pub fn check_ready(&self) -> Result<(), AppError> {
        {
            let conn = self.lock_db()?;
            let one: i64 = conn
                .query_row("SELECT 1", [], |row| row.get(0))
                .map_err(|err| AppError::Unavailable(format!("sqlite check failed: {err}")))?;
            if one != 1 {
                return Err(AppError::Unavailable(
                    "unexpected sqlite probe result".to_owned(),
                ));
            }
        }

        let probe_name = format!(
            ".readyz-{}-{}.probe",
            std::process::id(),
            STAGING_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let probe_path = self.inner.staging_dir.join(probe_name);
        let mut probe = File::create(&probe_path).map_err(|err| {
            AppError::Unavailable(format!("staging directory is not writable: {err}"))
        })?;
        probe
            .write_all(b"ok")
            .map_err(|err| AppError::Unavailable(format!("staging write failed: {err}")))?;
        fs::remove_file(&probe_path)
            .map_err(|err| AppError::Unavailable(format!("staging cleanup failed: {err}")))?;
        Ok(())
    }

    pub fn stats(&self) -> Result<RegistryStats, AppError> {
        let conn = self.lock_db()?;
        let catalog_revision = query_catalog_revision(&conn)?;
        let (chart_count, release_count, total_bytes): (i64, i64, i64) = conn
            .query_row(
                "SELECT COUNT(DISTINCT name), COUNT(*), COALESCE(SUM(size_bytes), 0) FROM chart_releases",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .map_err(|err| AppError::Storage(format!("failed querying stats: {err}")))?;
        Ok(RegistryStats {
            chart_count,
            release_count,
            total_bytes,
            catalog_revision,
        })
    }

    pub async fn store_chart(
        &self,
        parsed: &ParsedChartArchive,
        raw_bytes: &[u8],
    ) -> Result<UploadOutcome, AppError> {
        let _guard = self.inner.write_gate.lock().await;

        let existing = {
            let conn = self.lock_db()?;
            query_existing_release(&conn, &parsed.name, &parsed.version)?
        };

        if let Some(found) = existing {
            if found.digest_hex == parsed.digest_hex {
                let blob_path = self.inner.blobs_dir.join(&found.archive_filename);
                let meta = fs::metadata(&blob_path).map_err(|err| {
                    AppError::Storage(format!(
                        "committed blob '{}' missing on disk: {err}",
                        blob_path.display()
                    ))
                })?;
                if !meta.is_file() || meta.len() != found.size_bytes {
                    return Err(AppError::Storage(format!(
                        "committed blob '{}' size mismatch",
                        blob_path.display()
                    )));
                }
                return Ok(UploadOutcome::Idempotent);
            }
            return Err(AppError::Conflict(format!(
                "chart {}@{} already exists with digest {} (received {})",
                parsed.name, parsed.version, found.digest_hex, parsed.digest_hex
            )));
        }

        // Reject ambiguous `<name>-<version>.tgz` collision before touching blobs/.
        {
            let conn = self.lock_db()?;
            let filename_collision: Option<(String, String)> = conn
                .query_row(
                    "SELECT name, version FROM chart_releases WHERE archive_filename = ?1",
                    params![parsed.archive_filename],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(|err| AppError::Storage(format!("sqlite lookup failed: {err}")))?;
            if let Some((other_name, other_ver)) = filename_collision {
                return Err(AppError::Conflict(format!(
                    "archive filename '{}' collides with existing chart {other_name}@{other_ver}",
                    parsed.archive_filename
                )));
            }
        }

        let staging_name = format!(
            "{}-{}.part",
            parsed.archive_filename,
            STAGING_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let staging_path = self.inner.staging_dir.join(staging_name);
        let blob_path = self.inner.blobs_dir.join(&parsed.archive_filename);

        write_and_sync_staging(&staging_path, raw_bytes)?;
        fs::rename(&staging_path, &blob_path).map_err(|err| {
            let _ = fs::remove_file(&staging_path);
            AppError::Storage(format!(
                "failed renaming staged archive to '{}': {err}",
                blob_path.display()
            ))
        })?;
        sync_directory(&self.inner.blobs_dir)?;

        let created_at = current_rfc3339_utc()?;
        let size_i64 = i64::try_from(parsed.size_bytes)
            .map_err(|_| AppError::BadRequest("archive size overflows i64".to_owned()))?;

        {
            let mut conn = self.lock_db()?;
            let tx_result = (|| -> Result<(), rusqlite::Error> {
                let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                tx.execute(
                    "INSERT INTO chart_releases (
                       name, version, app_version, description, api_version,
                       digest_hex, size_bytes, content_fingerprint, created_at, archive_filename
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
                    params![
                        parsed.name,
                        parsed.version,
                        parsed.app_version,
                        parsed.description,
                        parsed.api_version,
                        parsed.digest_hex,
                        size_i64,
                        parsed.content_fingerprint,
                        created_at,
                        parsed.archive_filename,
                    ],
                )?;
                tx.execute(
                    "UPDATE registry_meta SET catalog_revision = catalog_revision + 1 WHERE id = 1",
                    [],
                )?;
                tx.commit()
            })();

            if let Err(err) = tx_result {
                let _ = fs::remove_file(&blob_path);
                return Err(AppError::Storage(format!(
                    "failed committing SQLite release row: {err}"
                )));
            }
        }

        if let Ok(mut cache) = self.inner.index_cache.lock() {
            *cache = None;
        }

        Ok(UploadOutcome::Created)
    }

    pub fn rendered_index_yaml(&self) -> Result<RenderedIndexYaml, AppError> {
        let (catalog_revision, rows) = {
            let conn = self.lock_db()?;
            let rev = query_catalog_revision(&conn)?;
            if let Ok(cache) = self.inner.index_cache.lock()
                && let Some(cached) = cache.as_ref()
                && cached.catalog_revision == rev
            {
                return Ok(cached.clone());
            }
            (rev, query_all_releases(&conn)?)
        };

        let rendered = render_index_yaml(catalog_revision, rows)?;
        if let Ok(mut cache) = self.inner.index_cache.lock() {
            *cache = Some(rendered.clone());
        }
        Ok(rendered)
    }

    pub fn list_all_charts(
        &self,
    ) -> Result<std::collections::BTreeMap<String, Vec<ChartReleaseView>>, AppError> {
        let rows = {
            let conn = self.lock_db()?;
            query_all_releases(&conn)?
        };
        Ok(group_releases_newest_first(rows))
    }

    pub fn list_chart_releases(
        &self,
        name: &str,
    ) -> Result<Option<Vec<ChartReleaseView>>, AppError> {
        let rows = {
            let conn = self.lock_db()?;
            query_releases_by_name(&conn, name)?
        };
        if rows.is_empty() {
            return Ok(None);
        }
        let mut grouped = group_releases_newest_first(rows);
        Ok(grouped.remove(name))
    }

    pub fn get_chart_release(
        &self,
        name: &str,
        version: &str,
    ) -> Result<Option<ChartReleaseView>, AppError> {
        let conn = self.lock_db()?;
        let row = query_existing_release(&conn, name, version)?;
        Ok(row.as_ref().map(ChartReleaseView::from))
    }

    pub fn resolve_blob_by_filename(
        &self,
        filename: &str,
    ) -> Result<Option<(PathBuf, StoredRelease)>, AppError> {
        if !is_valid_archive_filename(filename) {
            return Err(AppError::BadRequest(format!(
                "invalid chart archive filename '{filename}'"
            )));
        }
        let row = {
            let conn = self.lock_db()?;
            query_release_by_filename(&conn, filename)?
        };
        let Some(release) = row else {
            return Ok(None);
        };
        let path = self.inner.blobs_dir.join(&release.archive_filename);
        Ok(Some((path, release)))
    }

    pub fn catalog_summary(&self) -> Result<CatalogSummaryResponse, AppError> {
        let (catalog_revision, rows) = {
            let conn = self.lock_db()?;
            (query_catalog_revision(&conn)?, query_all_releases(&conn)?)
        };

        let release_count = rows.len();
        let total_bytes: u64 = rows.iter().map(|r| r.size_bytes).sum();
        let grouped = group_releases_newest_first(rows);
        let chart_count = grouped.len();

        let mut charts = Vec::with_capacity(chart_count);
        for (name, releases) in grouped {
            let Some(latest) = releases.first() else {
                continue;
            };
            let chart_bytes: u64 = releases.iter().map(|r| r.size_bytes).sum();
            let latest_url = latest
                .urls
                .first()
                .cloned()
                .unwrap_or_else(|| format!("charts/{name}-{}.tgz", latest.version));

            charts.push(ChartSummaryItem {
                name,
                kind: classify_chart_version(&latest.version),
                latest_version: latest.version.clone(),
                latest_app_version: latest.app_version.clone(),
                description: latest.description.clone(),
                release_count: releases.len(),
                total_bytes: chart_bytes,
                latest_digest: latest.digest.clone(),
                latest_content_fingerprint: latest.content_fingerprint.clone(),
                latest_created: latest.created.clone(),
                latest_url,
                releases,
            });
        }

        Ok(CatalogSummaryResponse {
            chart_count,
            release_count,
            total_bytes,
            quota_bytes: self.inner.quota_bytes,
            catalog_revision,
            charts,
        })
    }

    fn lock_db(&self) -> Result<std::sync::MutexGuard<'_, Connection>, AppError> {
        self.inner
            .db
            .lock()
            .map_err(|_| AppError::Internal("sqlite mutex poisoned".to_owned()))
    }
}

fn clean_staging_files(staging_dir: &Path) -> Result<(), AppError> {
    let entries = fs::read_dir(staging_dir).map_err(|err| {
        AppError::Storage(format!(
            "failed reading staging dir '{}': {err}",
            staging_dir.display()
        ))
    })?;
    for entry_result in entries {
        let entry = entry_result
            .map_err(|err| AppError::Storage(format!("failed reading staging entry: {err}")))?;
        let path = entry.path();
        if path
            .extension()
            .is_some_and(|ext| ext == "part" || ext == "probe")
        {
            fs::remove_file(&path).map_err(|err| {
                AppError::Storage(format!(
                    "failed removing orphaned staging file '{}': {err}",
                    path.display()
                ))
            })?;
        }
    }
    Ok(())
}

fn reconcile_blobs_on_startup(conn: &Connection, blobs_dir: &Path) -> Result<(), AppError> {
    let rows = query_all_releases(conn)?;
    for row in rows {
        if !is_valid_archive_filename(&row.archive_filename) {
            return Err(AppError::Storage(format!(
                "corrupt archive_filename '{}' in SQLite for {}@{}",
                row.archive_filename, row.name, row.version
            )));
        }
        let blob_path = blobs_dir.join(&row.archive_filename);
        let meta = fs::metadata(&blob_path).map_err(|err| {
            AppError::Storage(format!(
                "startup reconciliation failed: missing blob '{}' for {}@{}: {err}",
                blob_path.display(),
                row.name,
                row.version
            ))
        })?;
        if !meta.is_file() {
            return Err(AppError::Storage(format!(
                "startup reconciliation failed: '{}' is not a regular file",
                blob_path.display()
            )));
        }
        if meta.len() != row.size_bytes {
            return Err(AppError::Storage(format!(
                "startup reconciliation failed: blob '{}' has size {} bytes, expected {} bytes",
                blob_path.display(),
                meta.len(),
                row.size_bytes
            )));
        }
    }
    Ok(())
}

fn write_and_sync_staging(staging_path: &Path, raw_bytes: &[u8]) -> Result<(), AppError> {
    let mut file = File::create(staging_path).map_err(|err| {
        AppError::Storage(format!(
            "failed creating staging file '{}': {err}",
            staging_path.display()
        ))
    })?;
    if let Err(err) = file.write_all(raw_bytes).and_then(|()| file.sync_all()) {
        let _ = fs::remove_file(staging_path);
        return Err(AppError::Storage(format!(
            "failed writing staging file '{}': {err}",
            staging_path.display()
        )));
    }
    Ok(())
}

fn sync_directory(dir: &Path) -> Result<(), AppError> {
    let handle = File::open(dir).map_err(|err| {
        AppError::Storage(format!(
            "failed opening directory '{}' for sync: {err}",
            dir.display()
        ))
    })?;
    handle.sync_all().map_err(|err| {
        AppError::Storage(format!(
            "failed syncing directory '{}': {err}",
            dir.display()
        ))
    })
}

fn current_rfc3339_utc() -> Result<String, AppError> {
    let now = OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .map_err(|err| AppError::Internal(format!("invalid nanosecond truncation: {err}")))?;
    now.format(&Rfc3339)
        .map_err(|err| AppError::Internal(format!("failed formatting RFC3339 timestamp: {err}")))
}

fn query_catalog_revision(conn: &Connection) -> Result<i64, AppError> {
    conn.query_row(
        "SELECT catalog_revision FROM registry_meta WHERE id = 1",
        [],
        |row| row.get(0),
    )
    .map_err(|err| AppError::Storage(format!("failed reading catalog_revision: {err}")))
}

fn map_release_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredRelease> {
    let size_i64: i64 = row.get(6)?;
    let size_bytes = u64::try_from(size_i64).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Integer, Box::new(err))
    })?;
    Ok(StoredRelease {
        name: row.get(0)?,
        version: row.get(1)?,
        app_version: row.get(2)?,
        description: row.get(3)?,
        api_version: row.get(4)?,
        digest_hex: row.get(5)?,
        size_bytes,
        content_fingerprint: row.get(7)?,
        created_at: row.get(8)?,
        archive_filename: row.get(9)?,
    })
}

fn query_all_releases(conn: &Connection) -> Result<Vec<StoredRelease>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT name, version, app_version, description, api_version,
                    digest_hex, size_bytes, content_fingerprint, created_at, archive_filename
             FROM chart_releases",
        )
        .map_err(|err| AppError::Storage(format!("sqlite prepare failed: {err}")))?;
    let rows = stmt
        .query_map([], map_release_row)
        .map_err(|err| AppError::Storage(format!("sqlite query failed: {err}")))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|err| AppError::Storage(format!("sqlite row decode failed: {err}")))?);
    }
    Ok(out)
}

fn query_releases_by_name(conn: &Connection, name: &str) -> Result<Vec<StoredRelease>, AppError> {
    let mut stmt = conn
        .prepare(
            "SELECT name, version, app_version, description, api_version,
                    digest_hex, size_bytes, content_fingerprint, created_at, archive_filename
             FROM chart_releases
             WHERE name = ?1",
        )
        .map_err(|err| AppError::Storage(format!("sqlite prepare failed: {err}")))?;
    let rows = stmt
        .query_map(params![name], map_release_row)
        .map_err(|err| AppError::Storage(format!("sqlite query failed: {err}")))?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|err| AppError::Storage(format!("sqlite row decode failed: {err}")))?);
    }
    Ok(out)
}

fn query_existing_release(
    conn: &Connection,
    name: &str,
    version: &str,
) -> Result<Option<StoredRelease>, AppError> {
    conn.query_row(
        "SELECT name, version, app_version, description, api_version,
                digest_hex, size_bytes, content_fingerprint, created_at, archive_filename
         FROM chart_releases
         WHERE name = ?1 AND version = ?2",
        params![name, version],
        map_release_row,
    )
    .optional()
    .map_err(|err| AppError::Storage(format!("sqlite query failed: {err}")))
}

fn query_release_by_filename(
    conn: &Connection,
    filename: &str,
) -> Result<Option<StoredRelease>, AppError> {
    conn.query_row(
        "SELECT name, version, app_version, description, api_version,
                digest_hex, size_bytes, content_fingerprint, created_at, archive_filename
         FROM chart_releases
         WHERE archive_filename = ?1",
        params![filename],
        map_release_row,
    )
    .optional()
    .map_err(|err| AppError::Storage(format!("sqlite query failed: {err}")))
}
