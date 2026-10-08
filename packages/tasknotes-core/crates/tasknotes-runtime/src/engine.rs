//! SQLite-backed standalone engine.

use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex, MutexGuard,
        atomic::{AtomicBool, Ordering},
    },
};

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tasknotes_vault::{
    config::{PLUGIN_CONFIGURATION_PATH, PORTABLE_CONFIGURATION_PATH, TaskNotesConfiguration},
    document::{ContentRevision, TaskDocument},
    path::VaultPath,
};

use crate::{
    Result, RuntimeError,
    types::{
        Conflict, ConflictResolution, FileProblem, Mutation, PendingUpload, Profile, ProfileKind,
        Query, Receipt, SavedView, Snapshot, TaskSnapshot, VaultFiles,
    },
};
mod callbacks;
mod command_images;
mod conformance;
mod downloads;
mod partial;
mod payload_handles;
mod payloads;
mod plan_files;
mod receipt_migration;
mod reminders;
mod remote_images;
mod resolution_images;
mod staged;
mod title_lineage;
mod tracking;
mod undo;
mod uploads;
mod vault_io;
pub use downloads::PreparedDownload;
pub use uploads::UploadPreparationError;
#[cfg(test)]
mod ownership_tests;

fn receipt_task_path(
    mutation: Option<&Mutation>,
    writes: &[staged::DurableFile],
) -> Result<Option<String>> {
    let Some(mutation) = mutation else {
        return Ok(None);
    };
    let original = match &mutation.command {
        crate::types::Command::Create { .. } => {
            return if writes.len() == 1 && writes.first().is_some_and(|write| write.after.is_some())
            {
                Ok(writes.first().map(|write| write.path.clone()))
            } else {
                Err(RuntimeError::Storage(
                    "create plan lacks its primary task identity".to_owned(),
                ))
            };
        }
        crate::types::Command::EditTask { path, .. }
        | crate::types::Command::Update { path, .. } => path,
        _ => return Ok(None),
    };
    if writes
        .iter()
        .any(|write| write.path == *original && write.after.is_none())
    {
        // A relocated edit has one newly created destination; reference rewrites
        // retain their original bytes/revisions and cannot become the primary.
        let mut destinations = writes
            .iter()
            .filter(|write| write.before.is_none() && write.after.is_some());
        let destination = destinations.next().ok_or_else(|| {
            RuntimeError::Storage("relocated edit lacks its destination".to_owned())
        })?;
        if destinations.next().is_some() {
            return Err(RuntimeError::Storage(
                "relocated edit has ambiguous ownership".to_owned(),
            ));
        }
        return Ok(Some(destination.path.clone()));
    }
    Ok(Some(original.clone()))
}

fn stored_receipt(json: &str) -> Result<Receipt> {
    serde_json::from_str(json).map_err(|_| RuntimeError::Storage("invalid stored receipt".into()))
}

fn checked_stored_receipt(db: &Connection, profile: &str, id: &str, json: &str) -> Result<Receipt> {
    let receipt = stored_receipt(json)?;
    let planned: Option<String> = db
        .query_row(
            "SELECT diagnostics FROM journals WHERE profile=? AND id=?",
            params![profile, id],
            |row| row.get(0),
        )
        .optional()?;
    let expected = if let Some(json) = planned {
        crate::types::parse_diagnostics(&json)?
    } else {
        let parent: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM partial_batches WHERE profile=? AND id=?)",
            params![profile, id],
            |row| row.get(0),
        )?;
        if !parent {
            return Err(RuntimeError::Storage(
                "stored receipt has no journal owner".into(),
            ));
        }
        Vec::new()
    };
    if receipt.mutation_id != id || receipt.diagnostics != expected {
        return Err(RuntimeError::Storage(
            "stored receipt diagnostics differ from journal".into(),
        ));
    }
    Ok(receipt)
}

const SCHEMA: &str = "
CREATE TABLE profiles(id TEXT PRIMARY KEY, json TEXT NOT NULL, configuration TEXT, version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE files(profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, path TEXT NOT NULL,
 bytes BLOB, base BLOB, revision TEXT, remote_revision TEXT, task TEXT, problem TEXT, PRIMARY KEY(profile,path));
CREATE TABLE journals(profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, id TEXT NOT NULL,
 fingerprint TEXT NOT NULL, writes TEXT NOT NULL, receipt TEXT, remote INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(profile,id));
CREATE TABLE outbox(sequence INTEGER PRIMARY KEY AUTOINCREMENT,profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 id TEXT NOT NULL, path TEXT NOT NULL, bytes BLOB, revision TEXT, remote_revision TEXT, UNIQUE(profile,id));
CREATE TABLE conflicts(profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, id TEXT NOT NULL,
 path TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(profile,id));
CREATE TABLE checkpoints(profile TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE, json TEXT NOT NULL);
CREATE TABLE displaced(profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,id TEXT NOT NULL, PRIMARY KEY(profile,id));
PRAGMA user_version=1;
";

const SCHEMA_TWO:&str="
CREATE TABLE refresh_stage(profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,path TEXT NOT NULL,bytes BLOB,revision TEXT,task TEXT,problem TEXT,PRIMARY KEY(profile,path));
CREATE TABLE checkpoint_pending(profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,uid INTEGER NOT NULL,json TEXT NOT NULL,PRIMARY KEY(profile,uid));
PRAGMA user_version=2;
";

const SCHEMA_THREE:&str="
CREATE TABLE device_state(profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,device TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(profile,device));
ALTER TABLE journals ADD COLUMN effect TEXT;
PRAGMA user_version=3;
";

const SCHEMA_FOUR: &str = "
ALTER TABLE files ADD COLUMN created_ms INTEGER;
ALTER TABLE files ADD COLUMN modified_ms INTEGER;
ALTER TABLE files ADD COLUMN related_path TEXT;
ALTER TABLE files ADD COLUMN remote_content_hash TEXT;
ALTER TABLE outbox ADD COLUMN created_ms INTEGER;
ALTER TABLE outbox ADD COLUMN modified_ms INTEGER;
ALTER TABLE outbox ADD COLUMN related_path TEXT;
PRAGMA user_version=4;
";

const SCHEMA_FIVE:&str="
CREATE TABLE journal_files(profile TEXT NOT NULL,id TEXT NOT NULL,ordinal INTEGER NOT NULL,path TEXT NOT NULL,expected TEXT,before BLOB,bytes BLOB,PRIMARY KEY(profile,id,ordinal),FOREIGN KEY(profile,id) REFERENCES journals(profile,id) ON DELETE CASCADE);
PRAGMA user_version=5;
";
const SCHEMA_SIX: &str = "
ALTER TABLE conflicts ADD COLUMN base BLOB;
ALTER TABLE conflicts ADD COLUMN local BLOB;
ALTER TABLE conflicts ADD COLUMN remote BLOB;
ALTER TABLE conflicts ADD COLUMN base_revision TEXT;
ALTER TABLE conflicts ADD COLUMN local_revision TEXT;
ALTER TABLE conflicts ADD COLUMN remote_payload_revision TEXT;
PRAGMA user_version=6;
";
const SCHEMA_SEVEN: &str = "
ALTER TABLE journals ADD COLUMN payload_revision TEXT;
ALTER TABLE journals ADD COLUMN resolution_conflict TEXT;
CREATE TABLE conflict_archive(profile TEXT NOT NULL,journal_id TEXT NOT NULL,conflict_id TEXT NOT NULL,path TEXT NOT NULL,json TEXT NOT NULL,base BLOB,local BLOB,remote BLOB,base_revision TEXT,local_revision TEXT,remote_payload_revision TEXT,PRIMARY KEY(profile,journal_id),FOREIGN KEY(profile,journal_id) REFERENCES journals(profile,id) ON DELETE CASCADE);
PRAGMA user_version=7;
";
const SCHEMA_EIGHT: &str = "
CREATE TABLE journal_remote(profile TEXT NOT NULL,journal_id TEXT NOT NULL,path TEXT NOT NULL,uid TEXT NOT NULL,metadata TEXT,base BLOB,PRIMARY KEY(profile,journal_id),FOREIGN KEY(profile,journal_id) REFERENCES journals(profile,id) ON DELETE CASCADE);
PRAGMA user_version=8;
";
const SCHEMA_NINE:&str="
CREATE TABLE partial_batches(profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,id TEXT NOT NULL,fingerprint TEXT NOT NULL,receipt TEXT,result TEXT,PRIMARY KEY(profile,id));
CREATE TABLE partial_items(profile TEXT NOT NULL,id TEXT NOT NULL,ordinal INTEGER NOT NULL,mutation TEXT NOT NULL,outcome TEXT,PRIMARY KEY(profile,id,ordinal),FOREIGN KEY(profile,id) REFERENCES partial_batches(profile,id) ON DELETE CASCADE);
PRAGMA user_version=9;
";

const SCHEMA_TEN: &str = "
CREATE TABLE transfer_payloads(row_id INTEGER PRIMARY KEY,profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,id TEXT NOT NULL,size INTEGER NOT NULL,revision TEXT NOT NULL,origin TEXT NOT NULL DEFAULT 'incoming',bytes BLOB,UNIQUE(profile,id));
CREATE TABLE transfer_payload_state(row_id INTEGER PRIMARY KEY REFERENCES transfer_payloads(row_id) ON DELETE CASCADE,written INTEGER NOT NULL DEFAULT 0,sealed INTEGER NOT NULL DEFAULT 0);
CREATE TABLE payload_references(profile TEXT NOT NULL,payload_id TEXT NOT NULL,kind TEXT NOT NULL,owner TEXT NOT NULL,expected_previous TEXT,PRIMARY KEY(profile,kind,owner),FOREIGN KEY(profile,payload_id) REFERENCES transfer_payloads(profile,id) ON DELETE RESTRICT);
CREATE TABLE engine_metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
ALTER TABLE profiles ADD COLUMN lifetime TEXT NOT NULL DEFAULT '';
UPDATE profiles SET lifetime=lower(hex(randomblob(32)));
CREATE TABLE profile_sync_bindings(profile TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,vault_id TEXT NOT NULL,binding_epoch TEXT NOT NULL DEFAULT (lower(hex(randomblob(32)))));
CREATE TABLE journal_stages(profile TEXT NOT NULL,id TEXT NOT NULL,ordinal INTEGER NOT NULL,operation_id TEXT NOT NULL,stage_id TEXT,backup_id TEXT,cleanup_pending INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(profile,id,ordinal),FOREIGN KEY(profile,id) REFERENCES journals(profile,id) ON DELETE CASCADE);
INSERT INTO engine_metadata(key,value) VALUES('identity',lower(hex(randomblob(32))));
PRAGMA user_version=10;
";

// Mutable metadata is separate from immutable BLOBs, including during migration.
const SCHEMA_ELEVEN: &str = "
ALTER TABLE transfer_payload_state ADD COLUMN origin TEXT NOT NULL DEFAULT 'incoming';
ALTER TABLE journals ADD COLUMN diagnostics TEXT NOT NULL DEFAULT '[]';
ALTER TABLE journals ADD COLUMN title_plans TEXT NOT NULL DEFAULT '[]';
CREATE TABLE title_lineage(profile TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,path TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(profile,path));
PRAGMA user_version=11;
";
const MIGRATE_IMAGE_ORIGIN_SQL: &str = "UPDATE transfer_payload_state SET origin=(SELECT image.origin FROM transfer_payloads AS image WHERE image.row_id=transfer_payload_state.row_id)";

fn migrate_bounded_payloads(db: &mut Connection, version: u32) -> Result<()> {
    if version >= 11 {
        return Ok(());
    }
    let tx = db.transaction()?;
    if version < 10 {
        tx.execute_batch(SCHEMA_TEN)?;
    }
    tx.execute_batch(SCHEMA_ELEVEN)?;
    receipt_migration::migrate(&tx)?;
    tx.execute(MIGRATE_IMAGE_ORIGIN_SQL, [])?;
    if version < 10 {
        payloads::migrate_legacy_images(&tx)?;
    }
    tx.commit()?;
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RemoteMetadata {
    schema_version: u32,
    uid: u64,
    ctime: u64,
    mtime: u64,
    related_path: Option<String>,
    content_hash: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct DeviceEffect {
    device: String,
    state: crate::pomodoro::State,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct PlannedFile {
    pub(crate) path: String,
    pub(crate) expected: Option<String>,
    pub(crate) before: Option<Vec<u8>>,
    pub(crate) bytes: Option<Vec<u8>>,
}

/// One durable engine hosting independent vault profiles.
pub struct Engine {
    db: Mutex<Connection>,
    files: Arc<dyn VaultFiles>,
    coordinators: Mutex<BTreeMap<String, Arc<Mutex<()>>>>,
    closed: AtomicBool,
    shutdown_completed: AtomicBool,
    close_coordinator: Mutex<()>,
    identity: String,
}

impl Engine {
    /// Nonsecret durable database namespace, used only for owner identities.
    /// It is not an encryption nonce, credential, or authorization token.
    ///
    /// # Errors
    /// Returns Closed after explicit shutdown begins.
    pub fn identity(&self) -> Result<&str> {
        if self.closed.load(Ordering::Acquire) {
            return Err(RuntimeError::Closed);
        }
        Ok(&self.identity)
    }

    /// Whether this handle has begun its irreversible shutdown.
    #[must_use]
    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::Acquire)
    }

    /// Stop admission, wait for active profile callbacks, and retire this handle.
    /// Durable pending journals/stages remain for a fresh engine's recovery.
    /// Concurrent/idempotent close calls wait for the same completion boundary.
    ///
    /// # Errors
    /// Returns coordinator failure; no active state is discarded on failure.
    pub fn close(&self) -> Result<()> {
        if callbacks::in_callback(&self.identity) {
            return Err(RuntimeError::Busy);
        }
        let _closing = self
            .close_coordinator
            .lock()
            .map_err(|_| RuntimeError::Storage("engine close coordinator failed".to_owned()))?;
        if self.shutdown_completed.load(Ordering::Acquire) {
            return Ok(());
        }
        self.closed.store(true, Ordering::Release);
        let coordinators: Vec<_> = self
            .coordinators
            .lock()
            .map_err(|_| RuntimeError::Storage("profile coordinator failed".to_owned()))?
            .values()
            .cloned()
            .collect();
        for coordinator in coordinators {
            let _operation = lock_profile(&coordinator)?;
        }
        let _database = self
            .db
            .lock()
            .map_err(|_| RuntimeError::Storage("database coordinator failed".to_owned()))?;
        self.shutdown_completed.store(true, Ordering::Release);
        Ok(())
    }

    /// Open/create private application state and migrate its schema.
    ///
    /// # Errors
    /// Returns a storage error for an inaccessible or unsupported database.
    pub fn open(path: &str, files: Arc<dyn VaultFiles>) -> Result<Self> {
        let mut db = Connection::open(path)?;
        db.busy_timeout(std::time::Duration::from_secs(5))?;
        db.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
        )?;
        let version: u32 = db.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        match version {
            0 => {
                let tx = db.transaction()?;
                tx.execute_batch(SCHEMA)?;
                tx.execute_batch(SCHEMA_TWO)?;
                tx.execute_batch(SCHEMA_THREE)?;
                tx.execute_batch(SCHEMA_FOUR)?;
                tx.commit()?;
            }
            1 => {
                let tx = db.transaction()?;
                tx.execute_batch(SCHEMA_TWO)?;
                tx.execute_batch(SCHEMA_THREE)?;
                tx.execute_batch(SCHEMA_FOUR)?;
                tx.commit()?;
            }
            2 => {
                let tx = db.transaction()?;
                tx.execute_batch(SCHEMA_THREE)?;
                tx.execute_batch(SCHEMA_FOUR)?;
                tx.commit()?;
            }
            3 => {
                let tx = db.transaction()?;
                tx.execute_batch(SCHEMA_FOUR)?;
                tx.commit()?;
            }
            4..=11 => {}
            _ => {
                return Err(RuntimeError::Storage(
                    "unsupported database schema".to_owned(),
                ));
            }
        }
        if version < 5 {
            migrate_journal_payloads(&mut db)?;
        }
        if version < 6 {
            migrate_conflict_payloads(&mut db)?;
        }
        if version < 7 {
            let tx = db.transaction()?;
            tx.execute_batch(SCHEMA_SEVEN)?;
            tx.execute(
                "UPDATE journals SET resolution_conflict=substr(id,9) WHERE id LIKE 'resolve:%'",
                [],
            )?;
            tx.commit()?;
        }
        if version < 8 {
            let tx = db.transaction()?;
            tx.execute_batch(SCHEMA_EIGHT)?;
            tx.commit()?;
        }
        if version < 9 {
            let tx = db.transaction()?;
            tx.execute_batch(SCHEMA_NINE)?;
            tx.commit()?;
        }
        migrate_bounded_payloads(&mut db, version)?;
        let identity: String = db.query_row(
            "SELECT value FROM engine_metadata WHERE key='identity'",
            [],
            |row| row.get(0),
        )?;
        if identity.len() != 64
            || !identity
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(RuntimeError::Storage(
                "invalid durable engine namespace".to_owned(),
            ));
        }
        Ok(Self {
            db: Mutex::new(db),
            files: Arc::new(callbacks::GuardedFiles::new(files, identity.clone())),
            coordinators: Mutex::new(BTreeMap::new()),
            closed: AtomicBool::new(false),
            shutdown_completed: AtomicBool::new(false),
            close_coordinator: Mutex::new(()),
            identity,
        })
    }

    fn database<T>(&self, action: impl FnOnce(&mut Connection) -> Result<T>) -> Result<T> {
        if self.closed.load(Ordering::Acquire) {
            return Err(RuntimeError::Closed);
        }
        let mut db = self
            .db
            .lock()
            .map_err(|_| RuntimeError::Storage("database coordinator failed".to_owned()))?;
        if self.closed.load(Ordering::Acquire) {
            return Err(RuntimeError::Closed);
        }
        action(&mut db)
    }

    fn coordinator(&self, id: &str) -> Result<Arc<Mutex<()>>> {
        if callbacks::in_callback(&self.identity) {
            return Err(RuntimeError::Busy);
        }
        if self.closed.load(Ordering::Acquire) {
            return Err(RuntimeError::Closed);
        }
        let mut coordinators = self
            .coordinators
            .lock()
            .map_err(|_| RuntimeError::Storage("profile coordinator failed".to_owned()))?;
        if self.closed.load(Ordering::Acquire) {
            return Err(RuntimeError::Closed);
        }
        Ok(Arc::clone(
            coordinators
                .entry(id.to_owned())
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        ))
    }

    /// Register a capability category without storing credentials or device paths.
    ///
    /// # Errors
    /// Rejects empty identities and changing an existing profile's category.
    pub fn register_profile(&self, profile: Profile) -> Result<Profile> {
        let coordinator = self.coordinator(&profile.id)?;
        let _operation = lock_profile(&coordinator)?;
        validate_identity(&profile.id)?;
        if profile.name.trim().is_empty() {
            return Err(RuntimeError::Validation(
                "profile name is required".to_owned(),
            ));
        }
        self.database(|db| {
            let old: Option<String> = db.query_row("SELECT json FROM profiles WHERE id=?", [&profile.id], |r| r.get(0)).optional()?;
            if let Some(old) = old {
                let old: Profile = serde_json::from_str(&old)?;
                if old.kind != profile.kind {
                    return Err(RuntimeError::Validation("profile storage category cannot change".to_owned()));
                }
            }
            db.execute("INSERT INTO profiles(id,json,lifetime) VALUES(?,?,lower(hex(randomblob(32)))) ON CONFLICT(id) DO UPDATE SET json=excluded.json", params![profile.id, serde_json::to_string(&profile)?])?;
            Ok(())
        })?;
        Ok(profile)
    }

    /// Return registered profiles in deterministic identity order.
    ///
    /// # Errors
    /// Returns corrupt-state or storage errors.
    pub fn profiles(&self) -> Result<Vec<Profile>> {
        self.database(|db| {
            let mut statement = db.prepare("SELECT json FROM profiles ORDER BY id")?;
            let json = statement
                .query_map([], |r| r.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            json.iter()
                .map(|json| serde_json::from_str(json).map_err(RuntimeError::from))
                .collect()
        })
    }

    fn profile(&self, id: &str) -> Result<Profile> {
        self.database(|db| {
            let json: Option<String> = db
                .query_row("SELECT json FROM profiles WHERE id=?", [id], |r| r.get(0))
                .optional()?;
            serde_json::from_str(&json.ok_or(RuntimeError::NotFound)?).map_err(RuntimeError::from)
        })
    }

    /// Remove private state only after all user work has been resolved.
    ///
    /// # Errors
    /// Rejects profiles with pending journals, uploads, or conflicts.
    pub fn remove_profile(&self, id: &str) -> Result<()> {
        let coordinator = self.coordinator(id)?;
        let _operation = lock_profile(&coordinator)?;
        self.profile(id)?;
        self.database(|db| {
            let tx = db.transaction()?;
            let incoming=payloads::pending_incoming(&tx,id)?;
            let count: i64 = tx.query_row("SELECT (SELECT count(*) FROM outbox WHERE profile=?1)+(SELECT count(*) FROM conflicts WHERE profile=?1)+(SELECT count(*) FROM journals WHERE profile=?1 AND receipt IS NULL)+(SELECT count(*) FROM partial_batches WHERE profile=?1 AND receipt IS NULL)", [id], |r| r.get(0))?;
            if count != 0 || incoming { return Err(RuntimeError::Conflict); }
            // Only settled cached/base ownership can be released by profile
            // removal. Incoming images and pending domain work remain fenced.
            let unresolved: i64 = tx.query_row("SELECT count(*) FROM payload_references WHERE profile=? AND kind NOT IN ('file','base')", [id], |row|row.get(0))?;
            if unresolved != 0 { return Err(RuntimeError::Conflict); }
            tx.execute("DELETE FROM payload_references WHERE profile=?", [id])?;
            tx.execute("DELETE FROM profiles WHERE id=?", [id])?;
            tx.commit()?;
            Ok(())
        })
    }

    fn configuration(&self, profile: &Profile) -> Result<TaskNotesConfiguration> {
        self.configuration_optional(profile)?.ok_or_else(|| {
            RuntimeError::Configuration(
                "select standard settings before editing a vault without configuration".to_owned(),
            )
        })
    }

    fn configuration_optional(&self, profile: &Profile) -> Result<Option<TaskNotesConfiguration>> {
        let plugin = self
            .files
            .read_file(&profile.id, PLUGIN_CONFIGURATION_PATH)?;
        let portable = self
            .files
            .read_file(&profile.id, PORTABLE_CONFIGURATION_PATH)?;
        if plugin.is_none() && portable.is_none() && !profile.approve_standard {
            return Ok(None);
        }
        TaskNotesConfiguration::resolve(
            plugin.as_deref(),
            portable.as_deref(),
            profile.approve_standard,
        )
        .map(Some)
        .map_err(RuntimeError::from)
    }

    /// Recover pending writes, import provider changes, and return current state.
    ///
    /// # Errors
    /// Returns provider/configuration failures and unresolved write conflicts.
    pub fn refresh(&self, id: &str) -> Result<Snapshot> {
        let coordinator = self.coordinator(id)?;
        let _operation = lock_profile(&coordinator)?;
        let profile = self.profile(id)?;
        let config = self.configuration_optional(&profile)?;
        if config.is_none() && profile.kind == ProfileKind::LocalFolder {
            return Err(RuntimeError::Configuration(
                "approve standard settings or provide TaskNotes configuration".to_owned(),
            ));
        }
        self.recover(id, config.as_ref())?;
        let mut paths = self.files.list_files(id)?;
        paths.sort();
        paths.dedup();
        self.database(|db| {
            db.execute("DELETE FROM refresh_stage WHERE profile=?", [id])?;
            Ok(())
        })?;
        for path in &paths {
            VaultPath::parse(path)?;
            let image = self.capture_file_image(id, path)?.ok_or_else(|| {
                RuntimeError::Host("a listed file disappeared; refresh again".to_owned())
            })?;
            self.database(|db| {
                staged::cache_image(db, id, path, Some(&image), config.as_ref(), true)
            })?;
        }
        self.database(|db| {
            let tx=db.transaction()?;
            tx.execute("UPDATE files SET bytes=NULL,revision=NULL,task=NULL,problem=NULL WHERE profile=?1 AND NOT EXISTS(SELECT 1 FROM refresh_stage WHERE refresh_stage.profile=?1 AND refresh_stage.path=files.path)",[id])?;
            tx.execute("INSERT INTO files(profile,path,bytes,revision,task,problem) SELECT profile,path,bytes,revision,task,problem FROM refresh_stage WHERE profile=? ON CONFLICT(profile,path) DO UPDATE SET bytes=excluded.bytes,revision=excluded.revision,task=excluded.task,problem=excluded.problem",[id])?;
            tx.execute("UPDATE profiles SET configuration=?,version=version+1 WHERE id=?",params![config.as_ref().map(serde_json::to_string).transpose()?,id])?;
            tx.execute("DELETE FROM refresh_stage WHERE profile=?",[id])?;
            title_lineage::reconcile_refresh(&tx,id,config.as_ref())?;
            tx.commit()?;
            Ok(())
        })?;
        self.snapshot(id, &Query::default())
    }

    /// Query the durable index without contacting a provider or network.
    ///
    /// # Errors
    /// Rejects invalid query values and unavailable/corrupt private state.
    pub fn snapshot(&self, id: &str, query: &Query) -> Result<Snapshot> {
        self.profile(id)?;
        self.database(|db| {
            let (version, configuration): (i64,Option<String>) = db.query_row("SELECT version,configuration FROM profiles WHERE id=?",[id],|r|Ok((r.get(0)?,r.get(1)?)))?;
            let version=u64::try_from(version).map_err(|_|RuntimeError::Storage("invalid durable state version".to_owned()))?;
            let configuration: Value = configuration.as_deref().map(serde_json::from_str).transpose()?.unwrap_or(Value::Null);
            let mut statement = db.prepare("SELECT task FROM files WHERE profile=? AND task IS NOT NULL ORDER BY path")?;
            let encoded = statement.query_map([id],|r|r.get::<_,String>(0))?;
            let tasks=encoded.map(|json|serde_json::from_str::<TaskSnapshot>(&json?).map_err(RuntimeError::from));
            let (selected,total_count,groups) = crate::query::apply(tasks,query,&configuration)?;
            let relations=read_relations(db,id,&configuration)?;
            let pending_task_ids=read_pending_task_ids(db,id)?;
            let tasks=selected.into_iter().map(|selected| {
                let json:String=db.query_row("SELECT task FROM files WHERE profile=? AND path=?",params![id,selected.path],|r|r.get(0))?;
                let mut task:TaskSnapshot=serde_json::from_str(&json)?;
                crate::projections::local(&mut task,query)?;
                relations.apply(&mut task);
                task.is_pending=pending_task_ids.binary_search(&task.path).is_ok();
                Ok(task)
            }).collect::<Result<Vec<_>>>()?;
            let mut statement = db.prepare("SELECT path,problem FROM files WHERE profile=? AND problem IS NOT NULL ORDER BY path")?;
            let mut problems = statement.query_map([id], |r| Ok(FileProblem { path:r.get(0)?, message:r.get(1)? }))?.collect::<std::result::Result<Vec<_>,_>>()?;
            if configuration.is_null() {
                problems.push(FileProblem { path:PORTABLE_CONFIGURATION_PATH.to_owned(), message:"Waiting for TaskNotes configuration; editing requires configuration or explicit approval of standard settings".to_owned() });
            }
            let views = read_views(db,id)?;
            Ok(Snapshot { profile_id:id.to_owned(), version,tasks,total_count,pending_count:count(db,"outbox",id)?,pending_task_ids,conflict_count:count(db,"conflicts",id)?,configuration,problems,views,groups })
        })
    }

    /// Plan, journal, conditionally apply, and durably commit a semantic command.
    ///
    /// # Errors
    /// Rejects invalid commands, reused mutation identities, and stale revisions.
    pub fn execute(&self, id: &str, mutation: &Mutation) -> Result<Receipt> {
        self.execute_with_payload(id, mutation, None)
    }

    /// Execute an immutable decision with explicit binary replacement content.
    ///
    /// # Errors
    /// Rejects misplaced/missing payloads, changed retry identities, and stale fences.
    pub fn execute_with_payload(
        &self,
        id: &str,
        mutation: &Mutation,
        payload: Option<Vec<u8>>,
    ) -> Result<Receipt> {
        validate_mutation(mutation)?;
        validate_decision_payload(&mutation.command, payload.as_deref())?;
        let image = payload
            .as_deref()
            .map(|bytes| {
                self.database(|db| {
                    payloads::store_inline(db, id, bytes)
                        .and_then(|image| payloads::image_info(db, id, &image))
                })
            })
            .transpose()?;
        drop(payload);
        self.execute_image(id, mutation, image, None)
    }

    /// Execute an immutable decision using a sealed owner-scoped payload ID.
    /// No whole attachment crosses this command boundary.
    ///
    /// # Errors
    /// Rejects changed identities, misplaced/unsealed images and stale fences.
    pub fn execute_with_payload_id(
        &self,
        id: &str,
        mutation: &Mutation,
        payload_id: Option<&str>,
    ) -> Result<Receipt> {
        validate_mutation(mutation)?;
        let requires = matches!(
            &mutation.command,
            crate::types::Command::ResolveConflict {
                resolution: crate::types::ResolutionChoice::ReplacePayload { deleted: false },
                ..
            }
        );
        if requires != payload_id.is_some() {
            return Err(RuntimeError::Validation(
                "binary replacement payload does not match command disposition".to_owned(),
            ));
        }
        let image = payload_id
            .map(|image| self.database(|db| payloads::image_info(db, id, image)))
            .transpose()?;
        self.execute_image(id, mutation, image, None)
    }

    fn execute_image(
        &self,
        id: &str,
        mutation: &Mutation,
        payload: Option<crate::types::PayloadInfo>,
        expected_lifetime: Option<&str>,
    ) -> Result<Receipt> {
        let payload_revision = payload.as_ref().map(|image| image.revision.clone());
        if let crate::types::Command::BatchPartial { commands } = &mutation.command {
            return self.execute_partial(id, mutation, commands);
        }
        let coordinator = self.coordinator(id)?;
        let _operation = lock_profile(&coordinator)?;
        if let Some(lifetime) = expected_lifetime {
            self.database(|db| payload_handles::check_lifetime(db, id, lifetime))?;
        }
        if let Some(image) = &payload {
            self.database(|db| {
                if payloads::image_info(db, id, &image.id)? != *image {
                    return Err(RuntimeError::Conflict);
                }
                Ok(())
            })?;
        }
        let profile = self.profile(id)?;
        let fingerprint = serde_json::to_string(mutation)?;
        if let Some(receipt) = self.existing_receipt(
            id,
            &mutation.mutation_id,
            &fingerprint,
            payload_revision.as_deref(),
        )? {
            return Ok(receipt);
        }
        let config = self.configuration(&profile)?;
        self.recover(id, Some(&config))?;
        // Recovery can finish this exact pending mutation. Return its durable
        // receipt before planning another exchange or inserting its identity.
        if let Some(receipt) = self.existing_receipt(
            id,
            &mutation.mutation_id,
            &fingerprint,
            payload_revision.as_deref(),
        )? {
            return Ok(receipt);
        }
        let mut diagnostics = Vec::new();
        let mut title_changes = Vec::new();
        let writes = match &mutation.command {
            crate::types::Command::Undo { receipt_id } => self.plan_undo(id, receipt_id)?,
            crate::types::Command::ResolveConflict {
                conflict_id,
                expected_revisions,
                resolution,
            } => self.plan_resolution_images(
                id,
                conflict_id,
                Some(expected_revisions),
                resolution,
                payload,
            )?,
            _ => {
                let plan = self.plan_command_images(id, &config, mutation)?;
                diagnostics = plan.diagnostics;
                title_changes = plan.title_changes;
                plan.writes
            }
        };
        if let crate::types::Command::Undo { receipt_id } = &mutation.command {
            title_changes =
                self.database(|db| title_lineage::undo_changes(db, id, receipt_id, &writes))?;
        }
        let effect = self.prepare_device_effect(id, &config, mutation)?;
        self.check_unresolved_writes(id, mutation, &writes)?;
        self.database(|db| {
            let tx = db.transaction()?;
            tx.execute(
                "INSERT INTO journals(profile,id,fingerprint,writes,effect,payload_revision,resolution_conflict,diagnostics,title_plans) VALUES(?,?,?,?,?,?,?,?,?)",
                params![
                    id,
                    mutation.mutation_id,
                    fingerprint,
                    "[]",
                    effect
                        .map(|value| serde_json::to_string(&value))
                        .transpose()?,
                    payload_revision,
                    match &mutation.command {crate::types::Command::ResolveConflict {conflict_id,..}=>Some(conflict_id.as_str()),_=>None},
                    serde_json::to_string(&diagnostics)?,
                    serde_json::to_string(&title_changes)?
                ],
            )?;
            staged::store_files(&tx, id, &mutation.mutation_id, &writes)?;
            tx.commit()?;
            Ok(())
        })?;
        self.finish_staged_journal(id, &mutation.mutation_id, Some(&config), false)
    }

    fn check_unresolved_writes(
        &self,
        id: &str,
        mutation: &Mutation,
        writes: &[staged::DurableFile],
    ) -> Result<()> {
        for write in writes {
            let resolving = match &mutation.command {
                crate::types::Command::ResolveConflict { conflict_id, .. } => {
                    Some(conflict_id.as_str())
                }
                _ => None,
            };
            let unresolved = self.database(|db| {
                Ok(db.query_row(
                    "SELECT count(*) FROM conflicts WHERE profile=? AND path=? AND (? IS NULL OR id!=?)",
                    params![id, write.path,resolving,resolving],
                    |r| r.get::<_, i64>(0),
                )?)
            })?;
            if unresolved != 0 {
                return Err(RuntimeError::Conflict);
            }
        }
        Ok(())
    }

    fn read_device_state(&self, id: &str, device: &str) -> Result<crate::pomodoro::State> {
        self.database(|db| {
            let json: Option<String> = db
                .query_row(
                    "SELECT json FROM device_state WHERE profile=? AND device=?",
                    params![id, device],
                    |row| row.get(0),
                )
                .optional()?;
            json.map(|json| serde_json::from_str(&json).map_err(RuntimeError::from))
                .transpose()
                .map(Option::unwrap_or_default)
        })
    }

    fn prepare_device_effect(
        &self,
        id: &str,
        config: &TaskNotesConfiguration,
        mutation: &Mutation,
    ) -> Result<Option<DeviceEffect>> {
        let crate::types::Command::Pomodoro {
            device_id,
            action,
            task_path,
            duration_seconds,
        } = &mutation.command
        else {
            return Ok(None);
        };
        validate_identity(device_id)?;
        if let Some(path) = task_path {
            VaultPath::parse(path)?;
            if self.files.read_file(id, path)?.is_none() {
                return Err(RuntimeError::NotFound);
            }
        }
        let duration = duration_seconds.map_or_else(
            || {
                config
                    .extra
                    .get("pomodoroWorkDuration")
                    .map_or(Ok(1_500), |value| {
                        value
                            .as_u64()
                            .and_then(|minutes| minutes.checked_mul(60))
                            .ok_or_else(|| {
                                RuntimeError::Configuration(
                                    "Pomodoro work duration must be whole minutes".to_owned(),
                                )
                            })
                    })
            },
            Ok,
        )?;
        let state = crate::pomodoro::transition(
            self.read_device_state(id, device_id)?,
            action,
            task_path.as_deref(),
            duration,
            &mutation.at,
        )?;
        Ok(Some(DeviceEffect {
            device: device_id.clone(),
            state,
        }))
    }

    fn plan_undo(&self, id: &str, receipt_id: &str) -> Result<Vec<staged::DurableFile>> {
        validate_identity(receipt_id)?;
        let (writes, receipt): (String, Option<String>) = self.database(|db| {
            db.query_row(
                "SELECT writes,receipt FROM journals WHERE profile=? AND id=? AND remote=0",
                params![id, receipt_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or(RuntimeError::NotFound)
        })?;
        let receipt = self.database(|db| {
            checked_stored_receipt(db, id, receipt_id, &receipt.ok_or(RuntimeError::Conflict)?)
        })?;
        if !receipt.applied {
            return Err(RuntimeError::Conflict);
        }
        if self
            .latest_undo(id)?
            .as_ref()
            .map(|entry| entry.id.as_str())
            != Some(receipt_id)
        {
            return Err(RuntimeError::Conflict);
        }
        drop(writes);
        let writes = self.database(|db| staged::read_files(db, id, receipt_id))?;
        let mut restored = Vec::new();
        for write in writes.into_iter().rev() {
            let current = self.capture_file_image(id, &write.path)?;
            if current != write.after {
                return Err(RuntimeError::Conflict);
            }
            restored.push(staged::DurableFile {
                ordinal: i64::try_from(restored.len())
                    .map_err(|_| RuntimeError::Storage("too many Undo files".to_owned()))?,
                path: write.path,
                expected: current.as_ref().map(|image| image.revision.clone()),
                before: current,
                after: write.before,
            });
        }
        Ok(restored)
    }

    /// Read shared capture, timing, and onboarding projections.
    ///
    /// # Errors
    /// Rejects unknown contract versions, invalid timestamps and unavailable data.
    pub fn features_json(&self, id: &str, json: &str) -> Result<String> {
        let coordinator = self.coordinator(id)?;
        let _operation = lock_profile(&coordinator)?;
        let profile = self.profile(id)?;
        let request = crate::features::parse_request(json)?;
        let value = match request {
            crate::features::Request::Conformance {} => self.conformance(id)?,
            crate::features::Request::UndoAvailable {} => self.undo_available(id)?,
            crate::features::Request::TrackingSessions {
                at,
                limit,
                after,
                expected_version,
            } => self.tracking_sessions(id, &at, limit, after.as_ref(), expected_version)?,
            crate::features::Request::TrackingHistory {
                path,
                at,
                limit,
                after,
                expected_version,
            } => self.tracking_history(id, &path, &at, limit, after.as_ref(), expected_version)?,
            crate::features::Request::ReminderPlan {
                at,
                timezone,
                from,
                to,
                limit,
                after,
                expected_version,
            } => self.reminder_plan(
                id,
                &reminders::Request {
                    at: &at,
                    timezone: &timezone,
                    from: &from,
                    to: &to,
                    limit,
                    after: after.as_ref(),
                    expected_version,
                },
            )?,
            crate::features::Request::NormalizationPreview { path } => {
                self.normalization_preview(id, &path)?
            }
            crate::features::Request::BatchOutcome { mutation_id } => {
                self.partial_outcome(id, &mutation_id)?
            }
            crate::features::Request::MutationReceipt { mutation_id } => {
                self.mutation_receipt(id, &mutation_id)?
            }
            crate::features::Request::ResolutionHistory { mutation_id } => {
                self.resolution_history(id, &mutation_id)?
            }
            crate::features::Request::CapturePreview {
                input,
                at,
                today,
                context,
            } => crate::features::capture(
                &self.configuration(&profile)?,
                &input,
                &at,
                &today,
                context.as_ref(),
            )?,
            crate::features::Request::TaskTime { path, at } => {
                let config = self.configuration(&profile)?;
                let bytes = self
                    .files
                    .read_file(id, &path)?
                    .ok_or(RuntimeError::NotFound)?;
                let document = TaskDocument::parse(VaultPath::parse(&path)?, &bytes)?;
                crate::features::time_reading(
                    &path,
                    &config.mapping.normalize(document.frontmatter()),
                    &at,
                    None,
                )?
            }
            crate::features::Request::TimeReport { from, to, at } => {
                self.time_report(id, &from, &to, &at)?
            }
            crate::features::Request::Pomodoro { device_id, at } => {
                validate_identity(&device_id)?;
                let mut value = serde_json::to_value(crate::pomodoro::reading(
                    self.read_device_state(id, &device_id)?,
                    &at,
                )?)?;
                value
                    .as_object_mut()
                    .ok_or_else(|| RuntimeError::Storage("timer projection is invalid".to_owned()))?
                    .insert("schemaVersion".to_owned(), Value::from(1));
                value
            }
            crate::features::Request::Discovery {} => self.discovery(&profile)?,
        };
        Ok(serde_json::to_string(&value)?)
    }

    fn discovery(&self, profile: &Profile) -> Result<Value> {
        let configuration = self.configuration_optional(profile)?;
        let checkpoint = self
            .load_checkpoint(&profile.id)?
            .map(|value| serde_json::from_str::<obsidian_sync::session::Checkpoint>(&value))
            .transpose()?;
        let initial_complete = profile.kind == ProfileKind::LocalFolder
            || checkpoint.is_some_and(|value| !value.initial && value.pending.is_empty());
        Ok(
            serde_json::json!({"schemaVersion":1,"configurationAvailable":configuration.is_some(),"initialSyncComplete":initial_complete,"configuration":configuration}),
        )
    }

    fn mutation_receipt(&self, id: &str, mutation_id: &str) -> Result<Value> {
        validate_identity(mutation_id)?;
        self.database(|db| {
            let row:Option<Option<String>>=db.query_row("SELECT receipt FROM journals WHERE profile=?1 AND id=?2 UNION ALL SELECT receipt FROM partial_batches WHERE profile=?1 AND id=?2",params![id,mutation_id],|row|row.get(0)).optional()?;
            let (state,receipt)=match row {
                None=>("absent",Value::Null),Some(None)=>("pending",Value::Null),
                Some(Some(json))=>{
                    let receipt:Receipt=checked_stored_receipt(db,id,mutation_id,&json)?;
                    let state=if receipt.applied {"applied"}else {"parked"};
                    let mut receipt=serde_json::to_value(receipt)?;
                    receipt.as_object_mut().ok_or_else(||RuntimeError::Storage("receipt must be an object".to_owned()))?.insert("schemaVersion".to_owned(),Value::from(1));
                    (state,receipt)
                }
            };
            Ok(serde_json::json!({"schemaVersion":1,"mutationId":mutation_id,"state":state,"receipt":receipt}))
        })
    }

    fn resolution_history(&self, id: &str, mutation_id: &str) -> Result<Value> {
        validate_identity(mutation_id)?;
        let mut value = self.mutation_receipt(id, mutation_id)?;
        self.database(|db| {
            let (original,header):(String,String)=db.query_row("SELECT conflict_id,json FROM conflict_archive WHERE profile=? AND journal_id=?",params![id,mutation_id],|row|Ok((row.get(0)?,row.get(1)?))).optional()?.ok_or(RuntimeError::NotFound)?;
            let mut conflict:Value=serde_json::from_str(&header)?;
            let object=conflict.as_object_mut().ok_or_else(||RuntimeError::Storage("invalid archived conflict metadata".to_owned()))?;
            object.insert("id".to_owned(),Value::String(format!("archive:{mutation_id}")));
            let (base,local,remote,current):(Option<String>,Option<String>,Option<String>,Option<String>)=db.query_row("SELECT base_revision,local_revision,remote_payload_revision,(SELECT expected FROM journal_files WHERE journal_files.profile=conflict_archive.profile AND journal_files.id=conflict_archive.journal_id AND journal_files.path=conflict_archive.path) FROM conflict_archive WHERE profile=? AND journal_id=?",params![id,mutation_id],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?)))?;
            for (name,revision) in [("base",base),("local",local),("remote",remote)] {
                let size:Option<i64>=db.query_row(&format!("SELECT (SELECT size FROM transfer_payloads WHERE profile=conflict_archive.profile AND id=conflict_archive.{name}) FROM conflict_archive WHERE profile=? AND journal_id=?"),params![id,mutation_id],|row|row.get(0))?;
                let payload=match(size,revision) {(Some(size),Some(revision))=>serde_json::json!({"size":size,"revision":revision}),(None,None)=>Value::Null,_=>return Err(RuntimeError::Storage("invalid archived conflict version".to_owned()))};
                object.insert(name.to_owned(),payload);
            }
            object.insert("currentRevision".to_owned(),serde_json::to_value(current)?);
            let response=value.as_object_mut().ok_or_else(||RuntimeError::Storage("invalid resolution response".to_owned()))?;
            response.remove("state");
            response.insert("originalConflictId".to_owned(),Value::String(original));
            response.insert("conflict".to_owned(),conflict);
            Ok(value)
        })
    }

    fn normalization_preview(&self, id: &str, path: &str) -> Result<Value> {
        VaultPath::parse(path)?;
        let bytes = self
            .files
            .read_file(id, path)?
            .ok_or(RuntimeError::NotFound)?;
        let document = TaskDocument::parse(VaultPath::parse(path)?, &bytes)?;
        let mut value = tasknotes_vault::migration_policy::preview(document.frontmatter());
        value
            .as_object_mut()
            .ok_or_else(|| {
                RuntimeError::Storage("normalization preview must be an object".to_owned())
            })?
            .insert("schemaVersion".to_owned(), Value::from(1));
        Ok(value)
    }

    fn time_report(&self, id: &str, from: &str, to: &str, at: &str) -> Result<Value> {
        if crate::features::timestamp(from)? >= crate::features::timestamp(to)? {
            return Err(RuntimeError::Validation(
                "report from must precede to".to_owned(),
            ));
        }
        crate::features::timestamp(at)?;
        self.database(|db| {
            let mut statement=db.prepare("SELECT task FROM files WHERE profile=? AND task IS NOT NULL ORDER BY path")?;
            let mut tasks=statement.query([id])?;
            let mut rows=Vec::new();
            let mut total=0_u64;
            let mut total_minutes=0_u64;
            while let Some(row)=tasks.next()? {
                let task:TaskSnapshot=serde_json::from_str(&row.get::<_,String>(0)?)?;
                let reading=crate::features::time_reading(&task.path,&task.properties,at,Some((from,to)))?;
                let seconds=reading.get("totalSeconds").and_then(Value::as_u64).ok_or_else(||RuntimeError::Storage("time projection is invalid".to_owned()))?;
                let minutes=reading.get("totalMinutes").and_then(Value::as_u64).ok_or_else(||RuntimeError::Storage("time projection is invalid".to_owned()))?;
                total=total.checked_add(seconds).ok_or_else(||RuntimeError::Validation("report total is too large".to_owned()))?;
                total_minutes=total_minutes.checked_add(minutes).ok_or_else(||RuntimeError::Validation("report total is too large".to_owned()))?;
                if seconds>0 {rows.push(serde_json::json!({"path":task.path,"title":task.title,"seconds":seconds,"minutes":minutes}));}
            }
            Ok(serde_json::json!({"schemaVersion":1,"totalSeconds":total,"totalMinutes":total_minutes,"rows":rows}))
        })
    }

    fn existing_receipt(
        &self,
        id: &str,
        mutation_id: &str,
        fingerprint: &str,
        payload_revision: Option<&str>,
    ) -> Result<Option<Receipt>> {
        let receipt:Option<Receipt>=self.database(|db| {
            let previous: Option<(String, Option<String>, Option<String>)> = db
                .query_row(
                    "SELECT fingerprint,receipt,payload_revision FROM journals WHERE profile=?1 AND id=?2 UNION ALL SELECT fingerprint,receipt,NULL FROM partial_batches WHERE profile=?1 AND id=?2",
                    params![id, mutation_id],
                    |r| Ok((r.get(0)?, r.get(1)?,r.get(2)?)),
                )
                .optional()?;
            let Some((old, receipt, stored_payload)) = previous else {
                return Ok(None);
            };
            if old != fingerprint || stored_payload.as_deref()!=payload_revision {
                return Err(RuntimeError::Validation(
                    "mutation identity was reused with a different payload".to_owned(),
                ));
            }
            receipt
                .map(|json| checked_stored_receipt(db,id,mutation_id,&json))
                .transpose()
        })?;
        receipt
            .map(|receipt| self.cleanup_images(id, mutation_id, receipt))
            .transpose()
    }

    /// Read immutable upload receipts, omitting paths paused by conflicts.
    ///
    /// # Errors
    /// Returns profile/storage errors.
    pub fn pending_uploads(&self, id: &str) -> Result<Vec<PendingUpload>> {
        self.read_uploads(id, true)
    }

    /// Read immutable head metadata without allocating attachment payloads.
    ///
    /// # Errors
    /// Returns profile/storage failures.
    pub fn pending_upload_metadata(&self, id: &str) -> Result<Vec<PendingUpload>> {
        self.read_uploads(id, false)
    }

    fn read_uploads(&self, id: &str, include_payload: bool) -> Result<Vec<PendingUpload>> {
        let coordinator = self.coordinator(id)?;
        let _operation = lock_profile(&coordinator)?;
        self.profile(id)?;
        self.database(|db| {
            let mut statement = db.prepare("SELECT id,path,CASE WHEN ?2 THEN bytes ELSE NULL END,revision,remote_revision,created_ms,modified_ms,related_path,coalesce((SELECT size FROM transfer_payloads WHERE transfer_payloads.profile=outbox.profile AND transfer_payloads.id=outbox.bytes),0),bytes IS NULL FROM outbox WHERE profile=?1 AND NOT EXISTS(SELECT 1 FROM conflicts WHERE conflicts.profile=?1 AND conflicts.path=outbox.path) ORDER BY sequence LIMIT 1")?;
            let rows=statement.query_map(params![id,include_payload],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,Option<String>>(2)?,r.get::<_,Option<String>>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,Option<i64>>(5)?,r.get::<_,Option<i64>>(6)?,r.get::<_,Option<String>>(7)?,r.get::<_,i64>(8)?,r.get::<_,bool>(9)?)))?;
            rows.map(|row| {
                let (mutation_id,path,bytes,content_revision,expected_remote_revision,created,modified,related_path,payload_size,deleted)=row?;
                let payload_size=u64::try_from(payload_size).map_err(|_|RuntimeError::Storage("invalid upload payload size".to_owned()))?;
                let bytes=bytes.map(|image|payloads::read_inline(db,id,&image)).transpose()?;
                Ok(PendingUpload {mutation_id,path,bytes,payload_size,deleted,content_revision,expected_remote_revision,ctime:stored_timestamp(created)?,mtime:stored_timestamp(modified)?,related_path,folder:false})
            }).collect()
        })
    }

    /// Fetch one exact immutable upload receipt through the binary boundary.
    ///
    /// # Errors
    /// Rejects absent/paused receipts and mismatched payload revisions.
    pub fn read_upload_payload(
        &self,
        id: &str,
        mutation_id: &str,
        path: &str,
    ) -> Result<Option<Vec<u8>>> {
        self.profile(id)?;
        self.database(|db| {
            let row:Option<(Option<String>,Option<String>)>=db.query_row("SELECT bytes,revision FROM outbox WHERE profile=?1 AND id=?2 AND path=?3 AND NOT EXISTS(SELECT 1 FROM conflicts WHERE conflicts.profile=?1 AND conflicts.path=?3)",params![id,mutation_id,path],|row|Ok((row.get(0)?,row.get(1)?))).optional()?;
            let (image,revision)=row.ok_or(RuntimeError::NotFound)?;
            let info=image.as_deref().map(|image|payloads::image_info(db,id,image)).transpose()?;
            if info.as_ref().map(|info|&info.revision)!=revision.as_ref() {return Err(RuntimeError::Storage("immutable upload payload revision mismatch".to_owned()));}
            image.map(|image|payloads::read_inline(db,id,&image)).transpose()
        })
    }

    /// Commit an exact service acknowledgement without replacing newer edits.
    ///
    /// # Errors
    /// Rejects unknown receipts and storage failures.
    pub fn acknowledge_upload(
        &self,
        id: &str,
        mutation_id: &str,
        remote_revision: &str,
    ) -> Result<()> {
        let coordinator = self.coordinator(id)?;
        let _operation = lock_profile(&coordinator)?;
        self.profile(id)?;
        self.database(|db| {
            let tx = db.transaction()?;
            let upload: Option<(String, Option<String>)> = tx
                .query_row(
                    "SELECT path,bytes FROM outbox WHERE profile=? AND id=?",
                    params![id, mutation_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;
            let (path, bytes) = upload.ok_or(RuntimeError::NotFound)?;
            tx.execute(
                "UPDATE files SET base=?,remote_content_hash=? WHERE profile=? AND path=?",
                params![bytes, remote_revision, id, path],
            )?;
            tx.execute(
                "DELETE FROM outbox WHERE profile=? AND id=?",
                params![id, mutation_id],
            )?;
            tx.execute("UPDATE profiles SET version=version+1 WHERE id=?", [id])?;
            tx.commit()?;
            Ok(())
        })
    }

    /// Persist the protocol cursor before releasing its application effects.
    ///
    /// # Errors
    /// Rejects invalid checkpoint JSON and storage/profile failures.
    pub fn save_checkpoint(&self, id: &str, json: &str) -> Result<()> {
        self.profile(id)?;
        let coordinator = self.coordinator(id)?;
        let _operation = lock_profile(&coordinator)?;
        let mut checkpoint: obsidian_sync::session::Checkpoint = serde_json::from_str(json)?;
        checkpoint
            .validate()
            .map_err(|_| RuntimeError::Validation("invalid Sync checkpoint".to_owned()))?;
        let pending = std::mem::take(&mut checkpoint.pending);
        self.database(|db| {
            let tx=db.transaction()?;
            tx.execute("DELETE FROM checkpoint_pending WHERE profile=?",[id])?;
            for (uid,file) in pending {
                let uid=i64::try_from(uid).map_err(|_|RuntimeError::Validation("Sync UID exceeds storage range".to_owned()))?;
                tx.execute("INSERT INTO checkpoint_pending(profile,uid,json) VALUES(?,?,?)",params![id,uid,serde_json::to_string(&file)?])?;
            }
            tx.execute("INSERT INTO checkpoints(profile,json) VALUES(?,?) ON CONFLICT(profile) DO UPDATE SET json=excluded.json",params![id,serde_json::to_string(&checkpoint)?])?;
            tx.commit()?;Ok(())
        })
    }

    /// Persist one protocol delta atomically without rewriting prior pending rows.
    ///
    /// # Errors
    /// Rejects invalid/cursor-regressing deltas or storage failures.
    pub fn apply_checkpoint_delta(&self, id: &str, json: &str) -> Result<()> {
        self.profile(id)?;
        let coordinator = self.coordinator(id)?;
        let _operation = lock_profile(&coordinator)?;
        let delta: obsidian_sync::session::CheckpointDelta = serde_json::from_str(json)?;
        delta
            .validate()
            .map_err(|_| RuntimeError::Validation("invalid Sync checkpoint delta".to_owned()))?;
        self.database(|db| {
            let tx=db.transaction()?;
            let header:Option<String>=tx.query_row("SELECT json FROM checkpoints WHERE profile=?",[id],|r|r.get(0)).optional()?;
            let mut checkpoint=header.map(|json|serde_json::from_str::<obsidian_sync::session::Checkpoint>(&json)).transpose()?.unwrap_or_default();
            checkpoint.apply_delta(&delta).map_err(|_|RuntimeError::Validation("invalid Sync checkpoint transition".to_owned()))?;
            checkpoint.pending.clear();
            if let Some(file)=delta.pending_upsert {
                let uid=i64::try_from(file.uid).map_err(|_|RuntimeError::Validation("Sync UID exceeds storage range".to_owned()))?;
                tx.execute("INSERT INTO checkpoint_pending(profile,uid,json) VALUES(?,?,?) ON CONFLICT(profile,uid) DO UPDATE SET json=excluded.json",params![id,uid,serde_json::to_string(&file)?])?;
            }
            if let Some(uid)=delta.pending_remove {let uid=i64::try_from(uid).map_err(|_|RuntimeError::Validation("Sync UID exceeds storage range".to_owned()))?;tx.execute("DELETE FROM checkpoint_pending WHERE profile=? AND uid=?",params![id,uid])?;}
            if count(&tx,"checkpoint_pending",id)?>u64::try_from(obsidian_sync::session::QUEUE_LIMIT).map_err(|_|RuntimeError::Storage("invalid checkpoint limit".to_owned()))? {return Err(RuntimeError::Validation("Sync pending queue exceeds its limit".to_owned()));}
            tx.execute("INSERT INTO checkpoints(profile,json) VALUES(?,?) ON CONFLICT(profile) DO UPDATE SET json=excluded.json",params![id,serde_json::to_string(&checkpoint)?])?;
            tx.commit()?;Ok(())
        })
    }

    /// Reconstruct the full durable protocol checkpoint at session startup.
    ///
    /// # Errors
    /// Returns profile/storage failures and rejects corrupt checkpoint metadata.
    pub fn load_checkpoint(&self, id: &str) -> Result<Option<String>> {
        self.profile(id)?;
        self.database(|db| {
            let header: Option<String> = db
                .query_row("SELECT json FROM checkpoints WHERE profile=?", [id], |r| {
                    r.get(0)
                })
                .optional()?;
            let Some(header) = header else {
                return Ok(None);
            };
            let mut checkpoint: obsidian_sync::session::Checkpoint = serde_json::from_str(&header)?;
            let mut statement =
                db.prepare("SELECT uid,json FROM checkpoint_pending WHERE profile=? ORDER BY uid")?;
            let entries = statement
                .query_map([id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            for (uid, json) in entries {
                let uid = u64::try_from(uid)
                    .map_err(|_| RuntimeError::Storage("invalid durable Sync UID".to_owned()))?;
                checkpoint.pending.insert(uid, serde_json::from_str(&json)?);
            }
            checkpoint
                .validate()
                .map_err(|_| RuntimeError::Storage("invalid durable Sync checkpoint".to_owned()))?;
            Ok(Some(serde_json::to_string(&checkpoint)?))
        })
    }

    fn recover(&self, id: &str, config: Option<&TaskNotesConfiguration>) -> Result<()> {
        let journals = self.database(|db| {
            let mut statement = db.prepare(
                "SELECT id,remote FROM journals WHERE profile=? AND receipt IS NULL ORDER BY rowid",
            )?;
            Ok(statement
                .query_map([id], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?))
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?)
        })?;
        for (mutation_id, remote) in journals {
            if let Err(error) = self.finish_staged_journal(id, &mutation_id, config, remote)
                && (!remote || !matches!(error, RuntimeError::Conflict))
            {
                return Err(error);
            }
        }
        self.recover_cleanup(id)?;
        // Original journal outcomes are replayed before unrelated recorded host
        // predecessors. Unrecorded/ambiguous native captures never imply success.
        let mut cursor: Option<String> = None;
        loop {
            let page = self.files.displaced_metadata(id, cursor.as_deref(), 128)?;
            if page.is_empty() {
                break;
            }
            if page.len() > 128 {
                return Err(RuntimeError::Host(
                    "backup metadata page exceeds its limit".to_owned(),
                ));
            }
            for displaced in page {
                if cursor
                    .as_ref()
                    .is_some_and(|cursor| displaced.id <= *cursor)
                {
                    return Err(RuntimeError::Host(
                        "backup metadata cursor did not advance".to_owned(),
                    ));
                }
                VaultPath::parse(&displaced.path)?;
                let retained = self.database(|db| {
                    Ok(db.query_row(
                        "SELECT count(*) FROM displaced WHERE profile=? AND id=?",
                        params![id, displaced.id],
                        |row| row.get::<_, i64>(0),
                    )? != 0)
                })?;
                if !retained {
                    let snapshot = self.files.open_displaced_snapshot(id, &displaced.id)?;
                    let local = self.capture_snapshot(id, &snapshot)?;
                    if local.size != displaced.size || local.revision != displaced.revision {
                        return Err(RuntimeError::Host(
                            "retained backup changed immutable metadata".to_owned(),
                        ));
                    }
                    let current = self.capture_file_image(id, &displaced.path)?;
                    self.database(|db| {
                        let tx = db.transaction()?;
                        staged::conflict_images(
                            &tx,
                            id,
                            (&format!("host:{}", displaced.id), &displaced.path, ""),
                            None,
                            Some(&local),
                            current.as_ref(),
                        )?;
                        tx.execute(
                            "INSERT OR IGNORE INTO displaced(profile,id) VALUES(?,?)",
                            params![id, displaced.id],
                        )?;
                        tx.commit()?;
                        Ok(())
                    })?;
                }
                self.files.acknowledge_displaced(id, &displaced.id)?;
                cursor = Some(displaced.id);
            }
        }
        Ok(())
    }

    fn recover_cleanup(&self, profile: &str) -> Result<()> {
        let receipts=self.database(|db| {
            let mut statement=db.prepare("SELECT id,receipt FROM journals WHERE profile=?1 AND receipt IS NOT NULL AND EXISTS(SELECT 1 FROM journal_stages WHERE journal_stages.profile=?1 AND journal_stages.id=journals.id AND cleanup_pending=1) ORDER BY rowid")?;
            Ok(statement.query_map([profile],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?)
        })?;
        for (id, json) in receipts {
            let receipt = self.database(|db| checked_stored_receipt(db, profile, &id, &json))?;
            self.cleanup_images(profile, &id, receipt)?;
        }
        Ok(())
    }

    /// Read preserved versions without duplicating task notes in the vault.
    ///
    /// # Errors
    /// Returns profile/storage/corrupt-state failures.
    pub fn conflicts(&self, id: &str) -> Result<Vec<Conflict>> {
        self.profile(id)?;
        self.database(|db| {
            let mut statement =
                db.prepare("SELECT json FROM conflicts WHERE profile=? ORDER BY id")?;
            let json = statement
                .query_map([id], |r| r.get::<_, String>(0))?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            json.iter()
                .map(|json| {
                    let metadata: Conflict = serde_json::from_str(json)?;
                    read_conflict_row(db, id, &metadata.id)
                })
                .collect()
        })
    }

    /// Enumerate a bounded conflict page without loading binary payloads.
    ///
    /// # Errors
    /// Rejects unsupported page sizes and inaccessible private state.
    pub fn conflict_metadata(
        &self,
        id: &str,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Vec<Value>> {
        self.profile(id)?;
        if !(1..=128).contains(&limit) {
            return Err(RuntimeError::Validation(
                "conflict page limit must be 1 through 128".to_owned(),
            ));
        }
        self.database(|db| {
            let mut statement=db.prepare("SELECT conflicts.json,(SELECT size FROM transfer_payloads WHERE profile=conflicts.profile AND id=conflicts.base),conflicts.base_revision,(SELECT size FROM transfer_payloads WHERE profile=conflicts.profile AND id=conflicts.local),conflicts.local_revision,(SELECT size FROM transfer_payloads WHERE profile=conflicts.profile AND id=conflicts.remote),conflicts.remote_payload_revision,files.revision FROM conflicts LEFT JOIN files ON files.profile=conflicts.profile AND files.path=conflicts.path WHERE conflicts.profile=? AND conflicts.id>? ORDER BY conflicts.id LIMIT ?")?;
            let mut rows=statement.query(params![id,after.unwrap_or(""),limit])?;
            let mut result=Vec::new();
            while let Some(row)=rows.next()? {
                let mut metadata:Value=serde_json::from_str(&row.get::<_,String>(0)?)?;
                let object=metadata.as_object_mut().ok_or_else(||RuntimeError::Storage("corrupt conflict metadata".to_owned()))?;
                for (name,column) in [("base",1),("local",3),("remote",5)] {
                    let size:Option<i64>=row.get(column)?;
                    let size=size.map(|size|u64::try_from(size).map_err(|_|RuntimeError::Storage("invalid conflict payload size".to_owned()))).transpose()?;
                    let revision:Option<String>=row.get(column+1)?;
                    let value=match (size,revision) {(Some(size),Some(revision))=>serde_json::json!({"size":size,"revision":revision}),(None,None)=>Value::Null,_=>return Err(RuntimeError::Storage("incomplete conflict payload metadata".to_owned()))};
                    object.insert(name.to_owned(),value);
                }
                object.insert("currentRevision".to_owned(),serde_json::to_value(row.get::<_,Option<String>>(7)?)?);
                result.push(metadata);
            }
            Ok(result)
        })
    }

    /// Fetch one preserved conflict version through the binary boundary.
    ///
    /// # Errors
    /// Rejects missing conflicts, unknown version roles, or corrupt revisions.
    pub fn read_conflict_payload(
        &self,
        id: &str,
        conflict_id: &str,
        version: &str,
    ) -> Result<Option<Vec<u8>>> {
        self.profile(id)?;
        let revision = match version {
            "base" => "base_revision",
            "local" => "local_revision",
            "remote" => "remote_payload_revision",
            _ => {
                return Err(RuntimeError::Validation(
                    "unknown conflict version".to_owned(),
                ));
            }
        };
        self.database(|db| {
            let (table, column, identifier) = conflict_id
                .strip_prefix("archive:")
                .map_or(("conflicts", "id", conflict_id), |journal| {
                    ("conflict_archive", "journal_id", journal)
                });
            let row: Option<(Option<String>, Option<String>)> = db
                .query_row(
                    &format!(
                        "SELECT {version},{revision} FROM {table} WHERE profile=? AND {column}=?"
                    ),
                    params![id, identifier],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            let (image, revision) = row.ok_or(RuntimeError::NotFound)?;
            let info = image
                .as_deref()
                .map(|image| payloads::image_info(db, id, image))
                .transpose()?;
            if info.as_ref().map(|info| &info.revision) != revision.as_ref() {
                return Err(RuntimeError::Storage(
                    "conflict payload revision mismatch".to_owned(),
                ));
            }
            image
                .map(|image| payloads::read_inline(db, id, &image))
                .transpose()
        })
    }

    /// Apply a remote version, preserving and merging local divergence.
    ///
    /// # Errors
    /// Rejects external-folder profiles, unsafe paths, and provider failures.
    pub fn ingest_remote(
        &self,
        id: &str,
        path: &str,
        bytes: Option<&[u8]>,
        remote_revision: &str,
    ) -> Result<()> {
        VaultPath::parse(path)?;
        let metadata = parse_remote_metadata(remote_revision)?;
        if let Some(hash) = metadata
            .as_ref()
            .and_then(|metadata| metadata.content_hash.as_deref())
        {
            let payload = bytes.ok_or_else(|| {
                RuntimeError::Validation("deletion metadata must omit contentHash".to_owned())
            })?;
            if ContentRevision::of(payload).as_str() != hash {
                return Err(RuntimeError::Validation(
                    "remote content hash does not match authenticated payload".to_owned(),
                ));
            }
        }
        let image = bytes
            .map(|bytes| self.database(|db| payloads::store_inline(db, id, bytes)))
            .transpose()?;
        self.ingest_payload(id, path, image.as_deref(), remote_revision)
    }

    fn rebuild_configuration(&self, id: &str, profile: &Profile, path: &str) -> Result<()> {
        let configuration = self.configuration_optional(profile);
        self.database(|db| {
                let tx=db.transaction()?;
                match &configuration {
                    Ok(Some(config))=>{
                        // Rebuild one Markdown file at a time; attachments are never read.
                        let mut statement=tx.prepare("SELECT path,bytes FROM files WHERE profile=? AND lower(path) LIKE '%.md' AND bytes IS NOT NULL ORDER BY path")?;
                        let rows=statement.query_map([id],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?)))?;
                        for row in rows {let (path,image)=row?;let bytes=payloads::read_inline(&tx,id,&image)?;cache_file(&tx,id,&path,Some(&bytes),config)?;}
                        tx.execute("UPDATE profiles SET configuration=? WHERE id=?",params![serde_json::to_string(config)?,id])?;
                        tx.execute("UPDATE files SET problem=NULL WHERE profile=? AND path=?",params![id,path])?;
                    }
                    Ok(None)=>{tx.execute("UPDATE files SET task=NULL WHERE profile=?",[id])?;tx.execute("UPDATE profiles SET configuration=NULL WHERE id=?",[id])?;}
                    Err(RuntimeError::Configuration(error))=>{
                        tx.execute("UPDATE files SET task=NULL WHERE profile=?",[id])?;
                        tx.execute("UPDATE profiles SET configuration=NULL WHERE id=?",[id])?;
                        tx.execute("UPDATE files SET problem=? WHERE profile=? AND path=?",params![format!("Invalid TaskNotes configuration: {error}"),id,path])?;
                    }
                    Err(_)=>{}
                }
                tx.commit()?;Ok(())
            })?;
        if let Err(error) = configuration
            && !matches!(error, RuntimeError::Configuration(_))
        {
            return Err(error);
        }
        Ok(())
    }

    /// Resolve preserved versions against the latest active file revision.
    ///
    /// # Errors
    /// Rejects missing/stale conflicts and invalid destinations.
    pub fn resolve_conflict(
        &self,
        id: &str,
        conflict_id: &str,
        resolution: ConflictResolution,
    ) -> Result<Receipt> {
        let coordinator = self.coordinator(id)?;
        let _operation = lock_profile(&coordinator)?;
        let (choice, payload) = match resolution {
            ConflictResolution::KeepLocal {} => {
                (crate::types::ResolutionChoice::KeepLocal {}, None)
            }
            ConflictResolution::KeepRemote {} => {
                (crate::types::ResolutionChoice::KeepRemote {}, None)
            }
            ConflictResolution::KeepBoth { new_path } => {
                (crate::types::ResolutionChoice::KeepBoth { new_path }, None)
            }
            ConflictResolution::Replace { bytes } => (
                crate::types::ResolutionChoice::ReplacePayload {
                    deleted: bytes.is_none(),
                },
                bytes,
            ),
        };
        let fingerprint = format!("resolution:{}", serde_json::to_string(&choice)?);
        let payload_revision = payload
            .as_deref()
            .map(|bytes| ContentRevision::of(bytes).as_str().to_owned());
        let mutation_id = format!("resolve:{conflict_id}");
        if let Some(receipt) =
            self.existing_receipt(id, &mutation_id, &fingerprint, payload_revision.as_deref())?
        {
            return Ok(receipt);
        }
        let profile = self.profile(id)?;
        let config = self.configuration(&profile)?;
        self.recover(id, Some(&config))?;
        if let Some(receipt) =
            self.existing_receipt(id, &mutation_id, &fingerprint, payload_revision.as_deref())?
        {
            return Ok(receipt);
        }
        let image = payload
            .as_deref()
            .map(|bytes| {
                self.database(|db| {
                    payloads::store_inline(db, id, bytes)
                        .and_then(|image| payloads::image_info(db, id, &image))
                })
            })
            .transpose()?;
        drop(payload);
        let writes = self.plan_resolution_images(id, conflict_id, None, &choice, image)?;
        self.database(|db| {
            let tx=db.transaction()?;
            tx.execute("INSERT INTO journals(profile,id,fingerprint,writes,payload_revision,resolution_conflict) VALUES(?,?,?,?,?,?)",params![id,mutation_id,fingerprint,"[]",payload_revision,conflict_id])?;
            staged::store_files(&tx,id,&mutation_id,&writes)?;
            tx.commit()?;
            Ok(())
        })?;
        self.finish_staged_journal(id, &mutation_id, Some(&config), false)
    }
}

fn validate_mutation(mutation: &Mutation) -> Result<()> {
    validate_identity(&mutation.mutation_id)?;
    mutation.command.validate_contract()?;
    chrono::DateTime::parse_from_rfc3339(&mutation.at)
        .map_err(|_| RuntimeError::Validation("at must be an RFC3339 timestamp".to_owned()))?;
    if let Some(context) = &mutation.execution_context {
        let today = tasknotes_vault::temporal::parse_day(&context.today)?;
        if tasknotes_vault::temporal::day_in_timezone(&mutation.at, &context.timezone)? != today {
            return Err(RuntimeError::Validation(
                "civil today does not match the mutation instant/timezone".to_owned(),
            ));
        }
    }
    Ok(())
}

fn validate_decision_payload(
    command: &crate::types::Command,
    payload: Option<&[u8]>,
) -> Result<()> {
    use crate::types::{Command, ResolutionChoice};
    let requires = match command {
        Command::ResolveConflict {
            resolution: ResolutionChoice::ReplacePayload { deleted },
            ..
        } => !deleted,
        _ => false,
    };
    if requires != payload.is_some() {
        return Err(RuntimeError::Validation(
            "binary replacement payload does not match the command disposition".to_owned(),
        ));
    }
    Ok(())
}

fn archive_resolution(db: &Connection, profile: &str, journal: &str) -> Result<()> {
    let conflict: Option<String> = db.query_row(
        "SELECT resolution_conflict FROM journals WHERE profile=? AND id=?",
        params![profile, journal],
        |row| row.get(0),
    )?;
    if let Some(conflict) = conflict {
        db.execute("INSERT OR IGNORE INTO conflict_archive(profile,journal_id,conflict_id,path,json,base,local,remote,base_revision,local_revision,remote_payload_revision) SELECT profile,?,id,path,json,base,local,remote,base_revision,local_revision,remote_payload_revision FROM conflicts WHERE profile=? AND id=?",params![journal,profile,conflict])?;
        let retained:i64=db.query_row("SELECT count(*) FROM conflict_archive WHERE profile=? AND journal_id=? AND conflict_id=?",params![profile,journal,conflict],|row|row.get(0))?;
        if retained != 1 {
            return Err(RuntimeError::Storage(
                "resolution journal has no preserved conflict versions".to_owned(),
            ));
        }
        db.execute(
            "DELETE FROM conflicts WHERE profile=? AND id=?",
            params![profile, conflict],
        )?;
    }
    Ok(())
}

fn restore_resolution(db: &Connection, profile: &str, journal: &str) -> Result<()> {
    db.execute("INSERT INTO conflicts(profile,id,path,json,base,local,remote,base_revision,local_revision,remote_payload_revision) SELECT profile,conflict_id,path,json,base,local,remote,base_revision,local_revision,remote_payload_revision FROM conflict_archive WHERE profile=? AND journal_id=?",params![profile,journal])?;
    Ok(())
}

fn apply_remote_receipt(db: &Connection, profile: &str, journal: &str) -> Result<()> {
    let effect: Option<(String, String, Option<String>)> = db
        .query_row(
            "SELECT path,uid,metadata FROM journal_remote WHERE profile=? AND journal_id=?",
            params![profile, journal],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    let Some((path, uid, metadata)) = effect else {
        return Ok(());
    };
    let metadata = metadata
        .as_deref()
        .map(serde_json::from_str::<RemoteMetadata>)
        .transpose()?;
    db.execute("UPDATE files SET base=(SELECT base FROM journal_remote WHERE profile=?1 AND journal_id=?2),remote_revision=?3 WHERE profile=?1 AND path=?4",params![profile,journal,uid,path])?;
    if let Some(metadata) = metadata {
        let created = i64::try_from(metadata.ctime).map_err(|_| {
            RuntimeError::Storage("remote creation timestamp exceeds storage range".to_owned())
        })?;
        let modified = i64::try_from(metadata.mtime).map_err(|_| {
            RuntimeError::Storage("remote modification timestamp exceeds storage range".to_owned())
        })?;
        db.execute("UPDATE files SET created_ms=?,modified_ms=?,related_path=?,remote_content_hash=? WHERE profile=? AND path=?",params![created,modified,metadata.related_path,metadata.content_hash,profile,path])?;
        if let Some(source) = metadata.related_path {
            db.execute("UPDATE files SET base=NULL,remote_revision=?,remote_content_hash=NULL WHERE profile=? AND path=?",params![uid,profile,source])?;
            db.execute(
                "DELETE FROM outbox WHERE profile=? AND path=?",
                params![profile, source],
            )?;
        }
    }
    db.execute(
        "DELETE FROM outbox WHERE profile=? AND path=?",
        params![profile, path],
    )?;
    db.execute("INSERT INTO outbox(profile,id,path,bytes,revision,remote_revision,created_ms,modified_ms,related_path) SELECT ?,?,path,bytes,revision,remote_revision,created_ms,modified_ms,related_path FROM files WHERE profile=? AND path=? AND bytes IS NOT base",params![profile,format!("merge:{uid}:{path}"),profile,path])?;
    Ok(())
}

fn validate_identity(value: &str) -> Result<()> {
    if value.trim().is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        return Err(RuntimeError::Validation(
            "identity must be a nonempty bounded string".to_owned(),
        ));
    }
    Ok(())
}

fn count(db: &Connection, table: &str, id: &str) -> Result<u64> {
    // Table identifiers are private compile-time constants, never user input.
    let count: i64 = db.query_row(
        &format!("SELECT count(*) FROM {table} WHERE profile=?"),
        [id],
        |r| r.get(0),
    )?;
    u64::try_from(count).map_err(|_| RuntimeError::Storage("invalid durable count".to_owned()))
}

fn cache_file(
    db: &Connection,
    id: &str,
    path: &str,
    bytes: Option<&[u8]>,
    config: &TaskNotesConfiguration,
) -> Result<()> {
    cache_file_in(db, id, path, bytes, Some(config), false)
}

fn lock_profile(coordinator: &Mutex<()>) -> Result<MutexGuard<'_, ()>> {
    coordinator
        .lock()
        .map_err(|_| RuntimeError::Storage("profile operation coordinator failed".to_owned()))
}

fn try_lock_profile(coordinator: &Mutex<()>) -> Result<MutexGuard<'_, ()>> {
    coordinator.try_lock().map_err(|error| match error {
        std::sync::TryLockError::WouldBlock => RuntimeError::Busy,
        std::sync::TryLockError::Poisoned(_) => {
            RuntimeError::Storage("profile operation coordinator failed".to_owned())
        }
    })
}

fn cache_file_in(
    db: &Connection,
    id: &str,
    path: &str,
    bytes: Option<&[u8]>,
    config: Option<&TaskNotesConfiguration>,
    staged: bool,
) -> Result<()> {
    let revision = bytes.map(ContentRevision::of);
    let (task, problem) = if let (Some(bytes), Some(config)) = (
        bytes.filter(|_| path.to_lowercase().ends_with(".md")),
        config,
    ) {
        match title_lineage::project(db, id, path, bytes, config, staged) {
            Ok(task) => (
                task.map(|task| serde_json::to_string(&task)).transpose()?,
                None,
            ),
            Err(error) => (None, Some(error.to_string())),
        }
    } else {
        (None, None)
    };
    let table = if staged { "refresh_stage" } else { "files" };
    let image = bytes
        .map(|bytes| payloads::store_inline(db, id, bytes))
        .transpose()?;
    db.execute(&format!("INSERT INTO {table}(profile,path,bytes,revision,task,problem) VALUES(?,?,?,?,?,?) ON CONFLICT(profile,path) DO UPDATE SET bytes=excluded.bytes,revision=excluded.revision,task=excluded.task,problem=excluded.problem"),params![id,path,image,revision.as_ref().map(ContentRevision::as_str),task,problem])?;
    Ok(())
}

fn project_task(
    path: &str,
    bytes: &[u8],
    config: &TaskNotesConfiguration,
) -> Result<Option<TaskSnapshot>> {
    let document = TaskDocument::parse(VaultPath::parse(path)?, bytes)?;
    let properties = config.mapping.normalize(document.frontmatter());
    if !crate::commands::is_task(path, document.frontmatter(), document.body(), config)? {
        return Ok(None);
    }
    let status = properties
        .get("status")
        .and_then(Value::as_str)
        .or(config.default_status.as_deref())
        .ok_or_else(|| RuntimeError::Validation("task status is required".to_owned()))?
        .to_owned();
    let priority = properties
        .get("priority")
        .and_then(Value::as_str)
        .or(config.default_priority.as_deref())
        .ok_or_else(|| RuntimeError::Validation("task priority is required".to_owned()))?
        .to_owned();
    let title = config
        .display_title(document.frontmatter(), Some(path))
        .unwrap_or_default();
    let completed = config.is_completed(&status)?;
    Ok(Some(TaskSnapshot {
        id: path.to_owned(),
        path: path.to_owned(),
        title,
        status,
        priority,
        completed,
        revision: document.revision().as_str().to_owned(),
        properties,
        body: document.body().to_owned(),
        is_recurring: false,
        is_blocked: false,
        is_blocking: false,
        has_active_time_session: false,
        total_tracked_minutes: 0,
        occurrence_date: None,
        effective_date: None,
        is_pending: false,
    }))
}

fn read_conflict_row(db: &Connection, profile: &str, id: &str) -> Result<Conflict> {
    type ConflictRow = (String, Option<String>, Option<String>, Option<String>);
    let row: Option<ConflictRow> = db
        .query_row(
            "SELECT json,base,local,remote FROM conflicts WHERE profile=? AND id=?",
            params![profile, id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?;
    let (json, base, local, remote) = row.ok_or(RuntimeError::NotFound)?;
    let mut conflict: Conflict = serde_json::from_str(&json)?;
    conflict.base = base
        .map(|image| payloads::read_inline(db, profile, &image))
        .transpose()?;
    conflict.local = local
        .map(|image| payloads::read_inline(db, profile, &image))
        .transpose()?;
    conflict.remote = remote
        .map(|image| payloads::read_inline(db, profile, &image))
        .transpose()?;
    Ok(conflict)
}
fn migrate_conflict_payloads(db: &mut Connection) -> Result<()> {
    let tx = db.transaction()?;
    tx.execute_batch(SCHEMA_SIX)?;
    let mut cursor = 0_i64;
    loop {
        let next: Option<(i64, String, String)> = tx
            .query_row(
                "SELECT rowid,profile,json FROM conflicts WHERE rowid>? ORDER BY rowid LIMIT 1",
                [cursor],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let Some((rowid, _profile, json)) = next else {
            break;
        };
        let conflict: Conflict = serde_json::from_str(&json)?;
        let revision = |bytes: Option<&[u8]>| {
            bytes.map(|bytes| ContentRevision::of(bytes).as_str().to_owned())
        };
        tx.execute("UPDATE conflicts SET json=?,base=?,local=?,remote=?,base_revision=?,local_revision=?,remote_payload_revision=? WHERE rowid=?",params![serde_json::to_string(&conflict)?,conflict.base,conflict.local,conflict.remote,revision(conflict.base.as_deref()),revision(conflict.local.as_deref()),revision(conflict.remote.as_deref()),rowid])?;
        cursor = rowid;
    }
    tx.commit()?;
    Ok(())
}
fn migrate_journal_payloads(db: &mut Connection) -> Result<()> {
    let tx = db.transaction()?;
    tx.execute_batch(SCHEMA_FIVE)?;
    let mut cursor = 0_i64;
    loop {
        let next: Option<(i64, String, String, String)> = tx
            .query_row(
                "SELECT rowid,profile,id,writes FROM journals WHERE rowid>? ORDER BY rowid LIMIT 1",
                [cursor],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .optional()?;
        let Some((rowid, profile, id, json)) = next else {
            break;
        };
        let writes: Vec<PlannedFile> = serde_json::from_str(&json)?;
        // Version4 still has inline images. Preserve those in the version5
        // BLOB table; the atomic version10 migration will stream them later.
        for (ordinal, write) in writes.iter().enumerate() {
            let ordinal = i64::try_from(ordinal)
                .map_err(|_| RuntimeError::Storage("invalid legacy journal count".to_owned()))?;
            tx.execute("INSERT INTO journal_files(profile,id,ordinal,path,expected,before,bytes) VALUES(?,?,?,?,?,?,?)",params![profile,id,ordinal,write.path,write.expected,write.before,write.bytes])?;
        }
        tx.execute("UPDATE journals SET writes='[]' WHERE rowid=?", [rowid])?;
        cursor = rowid;
    }
    tx.commit()?;
    Ok(())
}
fn read_pending_task_ids(db: &Connection, id: &str) -> Result<Vec<String>> {
    let mut statement=db.prepare("SELECT DISTINCT outbox.path FROM outbox JOIN files ON files.profile=outbox.profile AND files.path=outbox.path WHERE outbox.profile=? AND files.task IS NOT NULL ORDER BY outbox.path")?;
    Ok(statement
        .query_map([id], |row| row.get::<_, String>(0))?
        .collect::<std::result::Result<_, _>>()?)
}
fn read_relations(
    db: &Connection,
    id: &str,
    configuration: &Value,
) -> Result<crate::projections::Relations> {
    let mut statement=db.prepare("SELECT path,json_extract(task,'$.properties.id'),json_extract(task,'$.completed'),json_extract(task,'$.properties.blockedBy') FROM files WHERE profile=? AND task IS NOT NULL ORDER BY path")?;
    let rows = statement.query_map([id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, bool>(2)?,
            row.get::<_, Option<String>>(3)?,
        ))
    })?;
    let mut tasks = std::collections::BTreeMap::new();
    for row in rows {
        let (path, uid, completed, dependencies) = row?;
        let dependencies = dependencies
            .map(|raw| serde_json::from_str::<Value>(&raw))
            .transpose()?
            .unwrap_or_else(|| serde_json::json!([]));
        tasks.insert(path, (uid, completed, dependencies));
    }
    let missing_is_blocked = configuration
        .get("effective")
        .and_then(|v| v.get("dependencies"))
        .and_then(|v| v.get("treat_missing_target_as_blocked"))
        .and_then(Value::as_bool)
        .unwrap_or(true);
    Ok(crate::projections::Relations {
        tasks,
        missing_is_blocked,
    })
}
fn read_views(db: &Connection, id: &str) -> Result<Vec<SavedView>> {
    let mut statement=db.prepare("SELECT path,bytes FROM files WHERE profile=? AND path LIKE 'Facet/Views/%.md' AND bytes IS NOT NULL ORDER BY path")?;
    let encoded = statement
        .query_map([id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut views: Vec<SavedView> = encoded
        .into_iter()
        .map(|(path, image)| {
            let bytes = payloads::read_inline(db, id, &image)?;
            let document = TaskDocument::parse(VaultPath::parse(&path)?, &bytes)?;
            let view = document
                .frontmatter()
                .get("facetView")
                .and_then(Value::as_object)
                .ok_or_else(|| {
                    RuntimeError::Validation("saved view document violates its schema".to_owned())
                })?
                .clone();
            let id = path
                .strip_prefix("Facet/Views/")
                .and_then(|s| s.strip_suffix(".md"))
                .ok_or(RuntimeError::NotFound)?
                .to_owned();
            Ok(SavedView {
                id,
                view,
                revision: document.revision().as_str().to_owned(),
            })
        })
        .collect::<Result<_>>()?;
    views.sort_by(|a, b| {
        a.view
            .get("order")
            .and_then(Value::as_u64)
            .cmp(&b.view.get("order").and_then(Value::as_u64))
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(views)
}

fn stored_timestamp(value: Option<i64>) -> Result<Option<u64>> {
    value
        .map(|value| {
            u64::try_from(value)
                .map_err(|_| RuntimeError::Storage("negative persisted file timestamp".to_owned()))
        })
        .transpose()
}

fn parse_remote_metadata(raw: &str) -> Result<Option<RemoteMetadata>> {
    if !raw.trim_start().starts_with('{') {
        // Pre-v1 native bridge compatibility: an explicit positive service UID.
        if !raw.bytes().all(|byte| byte.is_ascii_digit())
            || !raw.parse::<u64>().is_ok_and(|uid| uid > 0)
        {
            return Err(RuntimeError::Validation(
                "remote metadata must be a versioned object or positive legacy UID".to_owned(),
            ));
        }
        return Ok(None);
    }
    let mut value: Value = serde_json::from_str(raw)?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| RuntimeError::Validation("remote metadata must be an object".to_owned()))?;
    for key in ["schemaVersion", "uid", "ctime", "mtime"] {
        if let Some(number) = object.get_mut(key) {
            tasknotes_vault::json_boundary::normalize_unsigned(number)?;
        }
    }
    let metadata: RemoteMetadata = serde_json::from_value(value)?;
    if metadata.schema_version != 1 {
        return Err(RuntimeError::Validation(
            "unsupported remote metadata version".to_owned(),
        ));
    }
    if metadata.uid == 0
        || metadata.content_hash.as_ref().is_some_and(|hash| {
            hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit())
        })
    {
        return Err(RuntimeError::Validation(
            "invalid remote UID or content hash".to_owned(),
        ));
    }
    i64::try_from(metadata.ctime)
        .and_then(|_| i64::try_from(metadata.mtime))
        .map_err(|_| {
            RuntimeError::Validation("remote timestamp exceeds storage range".to_owned())
        })?;
    if let Some(path) = &metadata.related_path {
        VaultPath::parse(path)?;
    }
    Ok(Some(metadata))
}
