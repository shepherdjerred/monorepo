//! Incremental `SQLite` payload staging; complete binary files never become Vecs.

use super::{Engine, Result, RuntimeError, lock_profile, validate_identity};
use crate::types::{PAYLOAD_CHUNK_BYTES, PayloadInfo, PayloadRole, PayloadState};
use rusqlite::{Connection, OptionalExtension, blob::ZeroBlob, params};
use sha2::{Digest, Sha256};

pub(super) const METADATA_SQL: &str = "SELECT image.row_id,image.size,image.revision,state.written,state.sealed,typeof(image.bytes)='null',length(image.bytes),typeof(image.bytes),state.origin FROM transfer_payloads AS image LEFT JOIN transfer_payload_state AS state USING(row_id) WHERE image.profile=? AND image.id=?";
pub(super) const PREFIX_SQL: &str = "UPDATE transfer_payload_state SET written=? WHERE row_id=?";
pub(super) const SEAL_SQL: &str = "UPDATE transfer_payload_state SET sealed=1 WHERE row_id=?";
pub(super) const CONTENT_SEAL_SQL: &str = "UPDATE transfer_payload_state SET written=(SELECT size FROM transfer_payloads WHERE row_id=?1),sealed=1 WHERE row_id=?1";
pub(super) const RETIRE_SQL: &str = "UPDATE transfer_payloads SET bytes=NULL WHERE row_id=?";
pub(super) const CONTENT_IDENTITY_SQL: &str = "SELECT image.id FROM transfer_payloads AS image LEFT JOIN transfer_payload_state AS state USING(row_id) WHERE image.profile=? AND image.revision=? AND (state.origin='content' OR state.origin IS NULL OR state.origin NOT IN ('incoming','content')) AND typeof(image.bytes) != 'null' ORDER BY image.row_id LIMIT 1";
pub(super) const PROMOTE_SQL: &str = "UPDATE transfer_payload_state SET origin='content' WHERE row_id=(SELECT row_id FROM transfer_payloads WHERE profile=? AND id=?)";

pub(super) fn promote_content(db: &Connection, profile: &str, id: &str) -> Result<()> {
    // Required metadata validation precedes promotion. Missing/corrupt state
    // must not be recreated, and an unsealed transfer cannot become content.
    image_info(db, profile, id)?;
    if db.execute(PROMOTE_SQL, params![profile, id])? != 1 {
        return Err(RuntimeError::Storage(
            "missing immutable payload state".to_owned(),
        ));
    }
    Ok(())
}

struct Stored {
    row_id: i64,
    info: PayloadInfo,
}

struct LegacyTable {
    name: &'static str,
    keys: &'static str,
    columns: &'static [(&'static str, PayloadRole)],
}

const LEGACY_TABLES: &[LegacyTable] = &[
    LegacyTable {
        name: "files",
        keys: "json_array(path)",
        columns: &[("bytes", PayloadRole::File), ("base", PayloadRole::Base)],
    },
    LegacyTable {
        name: "journal_files",
        keys: "json_array(id,ordinal)",
        columns: &[
            ("before", PayloadRole::JournalBefore),
            ("bytes", PayloadRole::JournalAfter),
        ],
    },
    LegacyTable {
        name: "outbox",
        keys: "json_array(id)",
        columns: &[("bytes", PayloadRole::Outbox)],
    },
    LegacyTable {
        name: "conflicts",
        keys: "json_array(id)",
        columns: &[
            ("base", PayloadRole::ConflictBase),
            ("local", PayloadRole::ConflictLocal),
            ("remote", PayloadRole::ConflictRemote),
        ],
    },
    LegacyTable {
        name: "conflict_archive",
        keys: "json_array(journal_id)",
        columns: &[
            ("base", PayloadRole::ArchiveBase),
            ("local", PayloadRole::ArchiveLocal),
            ("remote", PayloadRole::ArchiveRemote),
        ],
    },
    LegacyTable {
        name: "journal_remote",
        keys: "json_array(journal_id)",
        columns: &[("base", PayloadRole::RemoteBase)],
    },
    LegacyTable {
        name: "refresh_stage",
        keys: "json_array(path)",
        columns: &[("bytes", PayloadRole::Refresh)],
    },
];

/// Replace legacy inline images with owner-scoped immutable references inside
/// the schema transaction. Every image copy uses `SQLite` incremental BLOB I/O;
/// table rebuilding copies only metadata and IDs, never SQL-bound binary data.
pub(super) fn migrate_legacy_images(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TEMP TABLE image_migration(profile TEXT NOT NULL,table_name TEXT NOT NULL,column_name TEXT NOT NULL,source_rowid INTEGER NOT NULL,payload_id TEXT NOT NULL,PRIMARY KEY(profile,table_name,column_name,source_rowid));")?;
    for table in LEGACY_TABLES {
        for &(column, _role) in table.columns {
            let mut statement = db.prepare(&legacy_scan_sql(table.name, column, table.keys))?;
            let mut rows = statement.query([])?;
            while let Some(row) = rows.next()? {
                let row_id: i64 = row.get(0)?;
                let profile: String = row.get(1)?;
                let _keys: String = row.get(2)?;
                let image = copy_legacy_image(db, &profile, table.name, column, row_id)?;
                db.execute(
                    "INSERT INTO image_migration(profile,table_name,column_name,source_rowid,payload_id) VALUES(?,?,?,?,?)",
                    params![profile,table.name,column,row_id,image.id],
                )?;
            }
        }
    }
    for table in LEGACY_TABLES {
        rebuild_metadata_table(db, table)?;
    }
    db.execute_batch("DROP TABLE image_migration;")?;
    Ok(())
}

fn rebuild_metadata_table(db: &Connection, table: &LegacyTable) -> Result<()> {
    let sequence: Option<i64> = db
        .query_row(
            "SELECT seq FROM sqlite_sequence WHERE name=?",
            [table.name],
            |row| row.get(0),
        )
        .optional()?;
    let schema: String = db.query_row(
        "SELECT sql FROM sqlite_schema WHERE type='table' AND name=?",
        [table.name],
        |row| row.get(0),
    )?;
    let (_, definition) = schema
        .split_once('(')
        .ok_or_else(|| RuntimeError::Storage("invalid legacy schema".to_owned()))?;
    let name = format!("{}_payload_refs", table.name);
    // The source schema is our private pinned application schema. Only its BLOB
    // columns change representation; receipt, clock and primary keys stay exact.
    db.execute_batch(&format!("CREATE TABLE {name} ({definition}").replace(" BLOB", " TEXT"))?;
    let mut statement = db.prepare(&format!("PRAGMA table_info({})", table.name))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let expressions=columns.iter().map(|column| {
        if table.columns.iter().any(|(binary,_)|column==binary) {
            format!("(SELECT payload_id FROM image_migration WHERE profile=original.profile AND table_name='{}' AND column_name='{column}' AND source_rowid=original.rowid)",table.name)
        }else {format!("original.{column}")}
    }).collect::<Vec<_>>().join(",");
    db.execute(
        &format!(
            "INSERT INTO {name}({}) SELECT {expressions} FROM {} AS original",
            columns.join(","),
            table.name
        ),
        [],
    )?;
    db.execute_batch(&format!(
        "DROP TABLE {}; ALTER TABLE {name} RENAME TO {};",
        table.name, table.name
    ))?;
    if let Some(sequence) = sequence {
        if sequence < 0 {
            return Err(RuntimeError::Storage("invalid legacy sequence".to_owned()));
        }
        db.execute(
            "UPDATE sqlite_sequence SET seq=max(seq,?1) WHERE name=?2",
            params![sequence, table.name],
        )?;
        db.execute("INSERT INTO sqlite_sequence(name,seq) SELECT ?1,?2 WHERE NOT EXISTS(SELECT 1 FROM sqlite_sequence WHERE name=?1)",params![table.name,sequence])?;
    }
    Ok(())
}

pub(super) fn image_info(db: &Connection, profile: &str, id: &str) -> Result<PayloadInfo> {
    let record = required(db, profile, id)?;
    if record.info.state != PayloadState::Sealed {
        return Err(RuntimeError::Storage(
            "durable reference points to an unsealed image".to_owned(),
        ));
    }
    Ok(record.info)
}

pub(super) fn pending_incoming(db: &Connection, profile: &str) -> Result<bool> {
    let mut query=db.prepare("SELECT image.id,state.origin FROM transfer_payloads AS image LEFT JOIN transfer_payload_state AS state USING(row_id) WHERE image.profile=? ORDER BY image.row_id")?;
    let mut rows = query.query([profile])?;
    let mut pending = false;
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let origin: String = row.get(1)?;
        let record = stored(db, profile, &id)?
            .ok_or_else(|| RuntimeError::Storage("payload state disappeared".into()))?;
        pending |= origin == "incoming" && record.info.state != PayloadState::Discarded;
    }
    Ok(pending)
}

/// Inline bytes are used only by pure note/configuration planners. Storage still
/// writes that borrowed input through the same incremental immutable image store.
pub(super) fn content_identity(
    db: &Connection,
    profile: &str,
    size: u64,
    revision: &str,
) -> Result<String> {
    let shared: Option<String> = db
        .query_row(CONTENT_IDENTITY_SQL, params![profile, revision], |row| {
            row.get(0)
        })
        .optional()?;
    if let Some(shared) = shared {
        let record = required(db, profile, &shared)?;
        if record.info.size != size {
            return Err(RuntimeError::Storage(
                "immutable image identity mismatch".to_owned(),
            ));
        }
        return Ok(shared);
    }
    let mut id = format!("blob:{revision}");
    if let Some(record) = stored(db, profile, &id)? {
        if record.info.state != PayloadState::Discarded {
            return Err(RuntimeError::Storage(
                "immutable image identity mismatch".to_owned(),
            ));
        }
        let generation: i64 = db.query_row(
            "SELECT coalesce(max(row_id),0)+1 FROM transfer_payloads",
            [],
            |row| row.get(0),
        )?;
        id = format!("blob:{revision}:{generation}");
    }
    Ok(id)
}

pub(super) fn store_inline(db: &Connection, profile: &str, bytes: &[u8]) -> Result<String> {
    let revision = hex::encode(Sha256::digest(bytes));
    let id = content_identity(
        db,
        profile,
        u64::try_from(bytes.len())
            .map_err(|_| RuntimeError::Validation("invalid note size".to_owned()))?,
        &revision,
    )?;
    if let Some(record) = stored(db, profile, &id)? {
        if record.info.state != PayloadState::Sealed {
            return Err(RuntimeError::Conflict);
        }
        return Ok(id);
    }
    let size = i32::try_from(bytes.len())
        .map_err(|_| RuntimeError::Validation("note exceeds SQLite image range".to_owned()))?;
    db.execute(
        "INSERT INTO transfer_payloads(profile,id,size,revision,bytes,origin) VALUES(?,?,?,?,?,'content')",
        params![profile, id, size, revision, ZeroBlob(size)],
    )?;
    let row_id = db.last_insert_rowid();
    db.execute(
        "INSERT INTO transfer_payload_state(row_id,origin) VALUES(?,'content')",
        [row_id],
    )?;
    if size != 0 {
        let mut blob = db.blob_open("main", "transfer_payloads", "bytes", row_id, false)?;
        let mut offset = 0;
        for chunk in bytes.chunks(PAYLOAD_CHUNK_BYTES) {
            blob.write_at(chunk, offset)?;
            offset += chunk.len();
        }
        blob.close()?;
    }
    db.execute(CONTENT_SEAL_SQL, [row_id])?;
    Ok(id)
}

/// Explicit inline note parsing convenience; binary transfers use `read_into`.
pub(super) fn read_inline(db: &Connection, profile: &str, id: &str) -> Result<Vec<u8>> {
    let record = required(db, profile, id)?;
    if record.info.state != PayloadState::Sealed {
        return Err(RuntimeError::Conflict);
    }
    let size = usize::try_from(record.info.size)
        .map_err(|_| RuntimeError::Storage("invalid image size".to_owned()))?;
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(size)
        .map_err(|_| RuntimeError::Storage("note allocation failed".to_owned()))?;
    bytes.resize(size, 0);
    if size != 0 {
        let blob = db.blob_open("main", "transfer_payloads", "bytes", record.row_id, true)?;
        for (index, chunk) in bytes.chunks_mut(PAYLOAD_CHUNK_BYTES).enumerate() {
            blob.read_at_exact(chunk, index * PAYLOAD_CHUNK_BYTES)?;
        }
        blob.close()?;
    }
    Ok(bytes)
}

fn copy_legacy_image(
    db: &Connection,
    profile: &str,
    table: &str,
    column: &str,
    row_id: i64,
) -> Result<PayloadInfo> {
    let source = db.blob_open("main", table, column, row_id, true)?;
    let size = i32::try_from(source.len())
        .map_err(|_| RuntimeError::Storage("legacy image exceeds SQLite blob range".to_owned()))?;
    let mut chunk = vec![0; PAYLOAD_CHUNK_BYTES];
    let mut digest = Sha256::new();
    let mut offset = 0;
    while offset < source.len() {
        let count = (source.len() - offset).min(chunk.len());
        let bytes = chunk
            .get_mut(..count)
            .ok_or_else(|| RuntimeError::Storage("invalid migration chunk".to_owned()))?;
        source.read_at_exact(bytes, offset)?;
        digest.update(&*bytes);
        offset += count;
    }
    let revision = hex::encode(digest.finalize());
    let id = format!("blob:{revision}");
    if let Some(previous) = stored(db, profile, &id)? {
        if previous.info.state != PayloadState::Sealed
            || previous.info.size
                != u64::try_from(size)
                    .map_err(|_| RuntimeError::Storage("invalid legacy size".to_owned()))?
            || previous.info.revision != revision
        {
            return Err(RuntimeError::Storage(
                "legacy payload identity collision".to_owned(),
            ));
        }
        source.close()?;
        return Ok(previous.info);
    }
    db.execute(
        "INSERT INTO transfer_payloads(profile,id,size,revision,bytes,origin) VALUES(?,?,?,?,?,'content')",
        params![profile, id, size, revision, ZeroBlob(size)],
    )?;
    let target_row = db.last_insert_rowid();
    db.execute(
        "INSERT INTO transfer_payload_state(row_id,origin) VALUES(?,'content')",
        [target_row],
    )?;
    if size != 0 {
        let mut target = db.blob_open("main", "transfer_payloads", "bytes", target_row, false)?;
        let mut digest = Sha256::new();
        let mut offset = 0;
        while offset < source.len() {
            let count = (source.len() - offset).min(chunk.len());
            let bytes = chunk
                .get_mut(..count)
                .ok_or_else(|| RuntimeError::Storage("invalid migration chunk".to_owned()))?;
            source.read_at_exact(bytes, offset)?;
            digest.update(&*bytes);
            target.write_at(bytes, offset)?;
            offset += count;
        }
        target.close()?;
        if hex::encode(digest.finalize()) != revision {
            return Err(RuntimeError::Storage(
                "legacy image changed during migration".to_owned(),
            ));
        }
    }
    source.close()?;
    db.execute(CONTENT_SEAL_SQL, [target_row])?;
    Ok(required(db, profile, &id)?.info)
}

pub(super) fn legacy_scan_sql(table: &str, column: &str, keys: &str) -> String {
    // Identifiers come from private compile-time table declarations. typeof
    // preserves corrupt non-NULL values for typed failure without copying them.
    format!(
        "SELECT rowid,profile,{keys} FROM {table} WHERE typeof({column}) != 'null' ORDER BY rowid"
    )
}

fn role_name(role: PayloadRole) -> &'static str {
    match role {
        PayloadRole::File => "file",
        PayloadRole::Base => "base",
        PayloadRole::JournalBefore => "journal_before",
        PayloadRole::JournalAfter => "journal_after",
        PayloadRole::Outbox => "outbox",
        PayloadRole::ConflictBase => "conflict_base",
        PayloadRole::ConflictLocal => "conflict_local",
        PayloadRole::ConflictRemote => "conflict_remote",
        PayloadRole::ArchiveBase => "archive_base",
        PayloadRole::ArchiveLocal => "archive_local",
        PayloadRole::ArchiveRemote => "archive_remote",
        PayloadRole::RemoteBase => "remote_base",
        PayloadRole::Refresh => "refresh",
    }
}

fn reference(
    db: &Connection,
    profile: &str,
    role: PayloadRole,
    owner: &str,
) -> Result<Option<String>> {
    db.query_row(
        "SELECT payload_id FROM payload_references WHERE profile=? AND kind=? AND owner=?",
        params![profile, role_name(role), owner],
        |row| row.get(0),
    )
    .optional()
    .map_err(RuntimeError::from)
}

fn retained_count(db: &Connection, profile: &str, id: &str) -> Result<i64> {
    let mut count: i64 = db.query_row(
        "SELECT count(*) FROM payload_references WHERE profile=? AND payload_id=?",
        params![profile, id],
        |row| row.get(0),
    )?;
    for table in LEGACY_TABLES {
        let predicates = table
            .columns
            .iter()
            .map(|(column, _)| format!("{column}=?2"))
            .collect::<Vec<_>>()
            .join(" OR ");
        let next: i64 = db.query_row(
            &format!(
                "SELECT count(*) FROM {} WHERE profile=?1 AND ({predicates})",
                table.name
            ),
            params![profile, id],
            |row| row.get(0),
        )?;
        count = count
            .checked_add(next)
            .ok_or_else(|| RuntimeError::Storage("invalid image reference count".to_owned()))?;
    }
    Ok(count)
}

fn validate_revision(revision: &str) -> Result<()> {
    if revision.len() != 64
        || !revision
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(RuntimeError::Validation(
            "payload revision must be lowercase SHA256".to_owned(),
        ));
    }
    Ok(())
}

fn stored(db: &Connection, profile: &str, id: &str) -> Result<Option<Stored>> {
    let record = db
        .query_row(METADATA_SQL, params![profile, id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, bool>(5)?,
                row.get::<_, Option<i64>>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
            ))
        })
        .optional()?;
    record
        .map(
            |(row_id, size, revision, written, sealed, discarded, length, storage, origin)| {
                if row_id <= 0
                    || !(0..=i64::from(i32::MAX)).contains(&size)
                    || written < 0
                    || written > size
                    || ![0, 1].contains(&sealed)
                    || (sealed == 1 && written != size)
                    || (!discarded && (storage != "blob" || length != Some(size)))
                    || (discarded && storage != "null")
                    || !["incoming", "content"].contains(&origin.as_str())
                    || revision.len() != 64
                    || !revision
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                {
                    return Err(RuntimeError::Storage(
                        "corrupt immutable payload metadata".to_owned(),
                    ));
                }
                Ok(Stored {
                    row_id,
                    info: PayloadInfo {
                        id: id.to_owned(),
                        size: u64::try_from(size).map_err(|_| {
                            RuntimeError::Storage("invalid payload size".to_owned())
                        })?,
                        revision,
                        written: u64::try_from(written).map_err(|_| {
                            RuntimeError::Storage("invalid payload prefix".to_owned())
                        })?,
                        state: if discarded {
                            PayloadState::Discarded
                        } else if sealed == 1 {
                            PayloadState::Sealed
                        } else {
                            PayloadState::Preparing
                        },
                    },
                })
            },
        )
        .transpose()
}

fn required(db: &Connection, profile: &str, id: &str) -> Result<Stored> {
    stored(db, profile, id)?
        .filter(|record| record.info.state != PayloadState::Discarded)
        .ok_or(RuntimeError::NotFound)
}

fn range(info: &PayloadInfo, offset: u64, length: usize) -> Result<usize> {
    if length > PAYLOAD_CHUNK_BYTES
        || offset
            .checked_add(
                u64::try_from(length)
                    .map_err(|_| RuntimeError::Validation("invalid payload range".to_owned()))?,
            )
            .is_none_or(|end| end > info.size)
    {
        return Err(RuntimeError::Validation(
            "payload range exceeds chunk or file bounds".to_owned(),
        ));
    }
    usize::try_from(offset)
        .map_err(|_| RuntimeError::Validation("invalid payload offset".to_owned()))
}

impl Engine {
    /// Atomically retain a sealed payload in an exact revision-fenced owner slot.
    /// Several journals/bases/conflicts can share one image without copying bytes.
    ///
    /// # Errors
    /// Rejects unsealed images, changed owner pointers and invalid identities.
    pub fn retain_payload(
        &self,
        profile: &str,
        id: &str,
        role: PayloadRole,
        owner: &str,
        expected_previous: Option<&str>,
    ) -> Result<()> {
        validate_identity(owner)?;
        let coordinator = self.coordinator(profile)?;
        let _operation = lock_profile(&coordinator)?;
        self.database(|db| {
            let tx = db.transaction()?;
            if required(&tx,profile,id)?.info.state != PayloadState::Sealed {return Err(RuntimeError::Conflict);}
            let previous = reference(&tx,profile,role,owner)?;
            if previous.as_deref() == Some(id) {
                let original:Option<String> = tx.query_row("SELECT expected_previous FROM payload_references WHERE profile=? AND kind=? AND owner=?",params![profile,role_name(role),owner],|row|row.get(0))?;
                if original.as_deref() != expected_previous {return Err(RuntimeError::Conflict);}
                return Ok(());
            }
            if previous.as_deref() != expected_previous {return Err(RuntimeError::Conflict);}
            tx.execute("INSERT INTO payload_references(profile,payload_id,kind,owner,expected_previous) VALUES(?,?,?,?,?) ON CONFLICT(profile,kind,owner) DO UPDATE SET payload_id=excluded.payload_id,expected_previous=excluded.expected_previous",params![profile,id,role_name(role),owner,expected_previous])?;
            tx.commit()?;
            Ok(())
        })
    }

    /// Return one retained owner image's metadata without copying file bytes.
    ///
    /// # Errors
    /// Returns ownership/identity or storage failures.
    pub fn retained_payload(
        &self,
        profile: &str,
        role: PayloadRole,
        owner: &str,
    ) -> Result<Option<PayloadInfo>> {
        self.database(|db| {
            reference(db, profile, role, owner)?
                .map(|id| required(db, profile, &id).map(|record| record.info))
                .transpose()
        })
    }

    /// Release an exact owner pointer after durable disposition; bytes stay until
    /// explicit discard and cannot be removed while another owner retains them.
    ///
    /// # Errors
    /// Rejects changed pointers, invalid identities and storage failures.
    pub fn release_payload(
        &self,
        profile: &str,
        id: &str,
        role: PayloadRole,
        owner: &str,
    ) -> Result<()> {
        validate_identity(owner)?;
        let coordinator = self.coordinator(profile)?;
        let _operation = lock_profile(&coordinator)?;
        self.database(|db| {
            let tx = db.transaction()?;
            match reference(&tx, profile, role, owner)? {
                Some(previous) if previous != id => return Err(RuntimeError::Conflict),
                None => return Ok(()),
                Some(_) => {}
            }
            tx.execute(
                "DELETE FROM payload_references WHERE profile=? AND kind=? AND owner=?",
                params![profile, role_name(role), owner],
            )?;
            tx.commit()?;
            Ok(())
        })
    }

    /// Reserve a transfer-sized zero-filled BLOB with immutable profile/ID/hash.
    /// Exact retries return the durable contiguous prefix without resetting it.
    ///
    /// # Errors
    /// Rejects invalid sizes/hashes, changed retry identities and missing profiles.
    pub fn begin_payload(
        &self,
        profile: &str,
        id: &str,
        size: u64,
        revision: &str,
    ) -> Result<PayloadInfo> {
        if id.starts_with("blob:") || id.starts_with("sync:") {
            return Err(RuntimeError::Validation(
                "payload identity uses a reserved runtime namespace".to_owned(),
            ));
        }
        let coordinator = self.coordinator(profile)?;
        let _operation = lock_profile(&coordinator)?;
        self.reserve_image(profile, id, size, revision, true)
    }

    pub(super) fn reserve_image(
        &self,
        profile: &str,
        id: &str,
        size: u64,
        revision: &str,
        transfer: bool,
    ) -> Result<PayloadInfo> {
        validate_identity(id)?;
        validate_revision(revision)?;
        if transfer && size > obsidian_sync::session::DEFAULT_FILE_LIMIT {
            return Err(RuntimeError::Validation(
                "transfer payload exceeds supported Sync file limit".to_owned(),
            ));
        }
        let size = i32::try_from(size)
            .map_err(|_| RuntimeError::Validation("invalid payload size".to_owned()))?;
        self.profile(profile)?;
        self.database(|db| {
            let tx = db.transaction()?;
            if let Some(previous) = stored(&tx, profile, id)? {
                if previous.info.size
                    != u64::try_from(size)
                        .map_err(|_| RuntimeError::Validation("invalid payload size".to_owned()))?
                    || previous.info.revision != revision
                    || previous.info.state == PayloadState::Discarded
                {
                    return Err(RuntimeError::Conflict);
                }
                return Ok(previous.info);
            }
            tx.execute(
                "INSERT INTO transfer_payloads(profile,id,size,revision,bytes,origin) VALUES(?,?,?,?,?,?)",
                params![profile, id, size, revision, ZeroBlob(size),if transfer {"incoming"}else {"content"}],
            )?;
            tx.execute("INSERT INTO transfer_payload_state(row_id,origin) VALUES(?,?)", params![tx.last_insert_rowid(),if transfer {"incoming"}else {"content"}])?;
            let info = required(&tx, profile, id)?.info;
            tx.commit()?;
            Ok(info)
        })
    }

    /// Commit one bounded contiguous chunk, or verify an exact previous chunk.
    /// Data and prefix metadata commit together before success is returned.
    ///
    /// # Errors
    /// Rejects gaps, partial overlaps, changed retries and ownership/range errors.
    pub fn write_payload_chunk(
        &self,
        profile: &str,
        id: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<PayloadInfo> {
        let coordinator = self.coordinator(profile)?;
        let _operation = lock_profile(&coordinator)?;
        self.write_image(profile, id, offset, bytes)
    }

    pub(super) fn write_image(
        &self,
        profile: &str,
        id: &str,
        offset: u64,
        bytes: &[u8],
    ) -> Result<PayloadInfo> {
        if bytes.is_empty() {
            return Err(RuntimeError::Validation(
                "payload writes must be nonempty".to_owned(),
            ));
        }
        self.database(|db| {
            let tx = db.transaction()?;
            let record = required(&tx, profile, id)?;
            let offset_index = range(&record.info, offset, bytes.len())?;
            let end = offset
                + u64::try_from(bytes.len())
                    .map_err(|_| RuntimeError::Validation("invalid payload chunk".to_owned()))?;
            let mut blob =
                tx.blob_open("main", "transfer_payloads", "bytes", record.row_id, false)?;
            if end <= record.info.written {
                let mut previous = vec![0; bytes.len()];
                blob.read_at_exact(&mut previous, offset_index)?;
                if previous != bytes {
                    return Err(RuntimeError::Conflict);
                }
                blob.close()?;
                return Ok(record.info);
            }
            if offset != record.info.written || record.info.state != PayloadState::Preparing {
                return Err(RuntimeError::Conflict);
            }
            blob.write_at(bytes, offset_index)?;
            blob.close()?;
            tx.execute(
                PREFIX_SQL,
                params![
                    i64::try_from(end).map_err(|_| RuntimeError::Validation(
                        "invalid payload prefix".to_owned()
                    ))?,
                    record.row_id
                ],
            )?;
            let info = required(&tx, profile, id)?.info;
            tx.commit()?;
            Ok(info)
        })
    }

    /// Stream-verify a complete payload and durably make it immutable.
    /// Empty files seal with the SHA256 of empty bytes, without a chunk write.
    ///
    /// # Errors
    /// Rejects incomplete prefixes and mismatched hashes without deleting bytes.
    pub fn seal_payload(&self, profile: &str, id: &str) -> Result<PayloadInfo> {
        let coordinator = self.coordinator(profile)?;
        let _operation = lock_profile(&coordinator)?;
        self.seal_image(profile, id)
    }

    pub(super) fn seal_image(&self, profile: &str, id: &str) -> Result<PayloadInfo> {
        self.database(|db| {
            let tx = db.transaction()?;
            let record = required(&tx, profile, id)?;
            if record.info.state == PayloadState::Sealed {
                return Ok(record.info);
            }
            if record.info.written != record.info.size {
                return Err(RuntimeError::Conflict);
            }
            let mut hash = Sha256::new();
            if record.info.size != 0 {
                let blob =
                    tx.blob_open("main", "transfer_payloads", "bytes", record.row_id, true)?;
                let mut chunk = vec![0; PAYLOAD_CHUNK_BYTES];
                let mut offset = 0;
                while offset < blob.len() {
                    let count = (blob.len() - offset).min(chunk.len());
                    let chunk = chunk
                        .get_mut(..count)
                        .ok_or_else(|| RuntimeError::Storage("invalid chunk buffer".to_owned()))?;
                    blob.read_at_exact(chunk, offset)?;
                    hash.update(&*chunk);
                    offset += count;
                }
                blob.close()?;
            }
            if hex::encode(hash.finalize()) != record.info.revision {
                return Err(RuntimeError::Validation(
                    "payload digest does not match its immutable revision".to_owned(),
                ));
            }
            tx.execute(SEAL_SQL, [record.row_id])?;
            let info = required(&tx, profile, id)?.info;
            tx.commit()?;
            Ok(info)
        })
    }

    /// Read bounded sealed payload bytes directly into an existing owned buffer.
    /// No host callback runs while the database lock is held.
    ///
    /// # Errors
    /// Rejects unsealed/discarded handles, wrong owners and invalid ranges.
    pub fn read_payload_into(
        &self,
        profile: &str,
        id: &str,
        offset: u64,
        target: &mut [u8],
    ) -> Result<()> {
        self.database(|db| read_into(db, profile, id, offset, target))
    }

    /// Load metadata without decoding or copying the payload.
    ///
    /// # Errors
    /// Returns missing-owner/identity or storage failures.
    pub fn payload_info(&self, profile: &str, id: &str) -> Result<PayloadInfo> {
        self.database(|db| {
            stored(db, profile, id)?
                .map(|record| record.info)
                .ok_or(RuntimeError::NotFound)
        })
    }

    /// Explicitly release unreferenced staged bytes and retire their identity.
    /// Journal/outbox/conflict references prevent premature disposition.
    ///
    /// # Errors
    /// Rejects referenced payloads and missing identities; exact retries succeed.
    pub fn discard_payload(&self, profile: &str, id: &str) -> Result<()> {
        let coordinator = self.coordinator(profile)?;
        let _operation = lock_profile(&coordinator)?;
        self.discard_image(profile, id)
    }

    pub(super) fn discard_image(&self, profile: &str, id: &str) -> Result<()> {
        self.database(|db| {
            let tx = db.transaction()?;
            let record = stored(&tx, profile, id)?.ok_or(RuntimeError::NotFound)?;
            let count = retained_count(&tx, profile, id)?;
            if count != 0 {
                return Err(RuntimeError::Conflict);
            }
            tx.execute(RETIRE_SQL, [record.row_id])?;
            tx.commit()?;
            Ok(())
        })
    }
}

pub(super) fn read_into(
    db: &Connection,
    profile: &str,
    id: &str,
    offset: u64,
    target: &mut [u8],
) -> Result<()> {
    let record = required(db, profile, id)?;
    if record.info.state != PayloadState::Sealed {
        return Err(RuntimeError::Conflict);
    }
    let offset = range(&record.info, offset, target.len())?;
    if target.is_empty() {
        return Ok(());
    }
    let blob = db.blob_open("main", "transfer_payloads", "bytes", record.row_id, true)?;
    blob.read_at_exact(target, offset)?;
    blob.close()?;
    Ok(())
}

pub(super) fn metadata(db: &Connection, profile: &str, id: &str) -> Result<PayloadInfo> {
    stored(db, profile, id)?
        .map(|record| record.info)
        .ok_or(RuntimeError::NotFound)
}
