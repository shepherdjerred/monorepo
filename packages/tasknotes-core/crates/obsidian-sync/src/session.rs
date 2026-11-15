//! Sequential WebSocket protocol port of the reference client's `Zi` class.
//! Native hosts execute effects, persist checkpoints before acknowledging their
//! revision, and apply remote changes before calling `complete_remote`.

use std::{
    collections::{BTreeMap, VecDeque},
    fmt,
};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

mod uploads;
pub use uploads::UploadMetadata;

use crate::{
    Result, SyncError,
    crypto::VaultCipher,
    filter::{SyncFilter, extension, validate_path},
};

/// Upstream's maximum binary piece size (2 MiB).
pub const PIECE_BYTES: usize = 2 * 1024 * 1024;
/// Maximum UTF-8 text frame size, validated before JSON parsing.
pub const TEXT_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
/// Maximum queued operations and remote changes per session.
pub const QUEUE_LIMIT: usize = 65_536;
/// Upstream default before the login response negotiates a server limit.
pub const DEFAULT_FILE_LIMIT: u64 = 199 * 1024 * 1024;
const CONNECTION_TIMEOUT: u64 = 120_000;
const REQUEST_TIMEOUT: u64 = 60_000;
const HEARTBEAT_INTERVAL: u64 = 20_000;
const HEARTBEAT_IDLE: u64 = 10_000;
const DISCONNECT_IDLE: u64 = 120_000;

/// Ciphertext or credential-bearing text. Borrow only for transport; Debug is
/// redacted and its memory is wiped on drop.
pub struct TextFrame(Zeroizing<String>);

impl TextFrame {
    fn new(value: Value) -> Self {
        Self(crate::sensitive_json(value))
    }
    /// Borrow the exact JSON payload to send on the WebSocket.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for TextFrame {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("TextFrame([REDACTED])")
    }
}

/// Validate the official service host before opening a WebSocket. Hosts are
/// account metadata, not arbitrary URL input; paths, ports, credentials, and
/// suffix lookalikes are rejected. Localhost is not a production destination.
///
/// # Errors
/// Returns `Host` for a destination outside the official DNS boundary.
pub fn server_url(host: &str) -> Result<String> {
    if !host.ends_with(".obsidian.md")
        || host.len() <= ".obsidian.md".len()
        || !host.is_ascii()
        || host.len() > 253
        || host.split('.').any(|label| {
            label.is_empty()
                || label.len() > 63
                || label.starts_with('-')
                || label.ends_with('-')
                || !label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
    {
        return Err(SyncError::Host);
    }
    Ok(format!("wss://{host}"))
}

/// Native-owned profile identity and transport configuration. No token enters
/// the durable checkpoint, vault files, or diagnostic output.
pub struct SessionConfig {
    host: String,
    token: Zeroizing<String>,
    vault_id: String,
    device_name: String,
    /// Profile selection policy; all categories are enabled by default.
    pub filter: SyncFilter,
    /// Hard host-memory boundary in addition to the service limit. Files above
    /// this bound report `FileTooLarge` and remain pending, never truncated.
    pub transfer_limit: u64,
    /// Aggregate encrypted upload and metadata budget. Excess receipts remain
    /// in the host's durable outbox until capacity becomes available.
    pub queued_byte_limit: u64,
}

impl fmt::Debug for SessionConfig {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SessionConfig([REDACTED])")
    }
}

impl SessionConfig {
    /// Configure a private replica's session using a secure-storage token.
    ///
    /// # Errors
    /// Rejects absent account/vault identity and unsupported destinations.
    pub fn new(host: &str, token: &str, vault_id: &str, device_name: &str) -> Result<Self> {
        server_url(host)?;
        if token.is_empty() || vault_id.is_empty() {
            return Err(SyncError::SessionState);
        }
        Ok(Self {
            host: host.into(),
            token: Zeroizing::new(token.into()),
            vault_id: vault_id.into(),
            device_name: device_name.into(),
            filter: SyncFilter::default(),
            transfer_limit: DEFAULT_FILE_LIMIT,
            queued_byte_limit: 256 * 1024 * 1024,
        })
    }
}

/// Authenticated decrypted remote metadata, safe to persist in the profile DB.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "bool", into = "bool")]
pub enum StreamPhase {
    /// Notice precedes the first ready barrier.
    Initial,
    /// Normal cursor-based synchronization.
    #[default]
    Incremental,
}

impl From<bool> for StreamPhase {
    fn from(initial: bool) -> Self {
        if initial {
            Self::Initial
        } else {
            Self::Incremental
        }
    }
}

impl From<StreamPhase> for bool {
    fn from(phase: StreamPhase) -> Self {
        phase == StreamPhase::Initial
    }
}

/// Authenticated decrypted remote metadata, safe to persist in the profile DB.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RemoteFile {
    /// Monotonic server revision and pull identifier.
    pub uid: u64,
    /// Validated case-sensitive logical vault path.
    pub path: String,
    /// Related previous path for a remote rename, when supplied.
    #[serde(default)]
    pub related_path: Option<String>,
    /// Service file size metadata. Pull replies carry the encrypted wire size.
    #[serde(default)]
    pub size: u64,
    /// Decrypted lowercase SHA-256 of original bytes; empty for directories.
    #[serde(default)]
    pub hash: String,
    /// Creation milliseconds from the originating client.
    #[serde(default)]
    pub ctime: u64,
    /// Modification milliseconds from the originating client.
    #[serde(default)]
    pub mtime: u64,
    /// Directory marker.
    #[serde(default)]
    pub folder: bool,
    /// Tombstone marker.
    #[serde(default)]
    pub deleted: bool,
    /// Originating device label.
    #[serde(default)]
    pub device: Option<String>,
    /// Originating account identifier, retaining the service's value type.
    #[serde(default)]
    pub user: Option<Value>,
    /// Whether received before the first ready barrier.
    #[serde(default)]
    pub initial: StreamPhase,
    /// Matching local upload receipt, if the notice arrived during that upload.
    #[serde(default)]
    pub local_operation_id: Option<String>,
    /// Selection under the current profile filter. Hosts retain excluded remote
    /// metadata without downloading or exposing it as a task.
    pub selected: bool,
}

impl RemoteFile {
    /// Validate the persisted metadata boundary before applying a cursor.
    ///
    /// # Errors
    /// Rejects unsafe paths, zero UIDs and malformed integrity hashes.
    pub fn validate(&self) -> Result<()> {
        if self.uid == 0
            || (!self.hash.is_empty()
                && (self.hash.len() != 64
                    || !self.hash.bytes().all(|byte| byte.is_ascii_hexdigit())))
        {
            return Err(SyncError::Protocol);
        }
        validate_path(&self.path)?;
        if let Some(path) = &self.related_path {
            validate_path(path)?;
        }
        Ok(())
    }
}

/// Crash-recovery state. Persist atomically in the profile DB; pending changes
/// remain here until the host has durably applied/parked them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Checkpoint {
    /// Envelope version. Unknown versions fail rather than reset the cursor.
    pub schema_version: u32,
    /// Cursor for reconnect; durable notices through this cursor are retained.
    pub cursor: u64,
    /// Until ready has been received, initial tombstones are ignored upstream.
    pub initial: bool,
    /// Notices not yet durably applied by the host, keyed by server UID.
    pub pending: BTreeMap<u64, RemoteFile>,
}

impl Default for Checkpoint {
    fn default() -> Self {
        Self {
            schema_version: 1,
            cursor: 0,
            initial: true,
            pending: BTreeMap::new(),
        }
    }
}

impl Checkpoint {
    /// Validate restored state before using it to skip server history.
    ///
    /// # Errors
    /// Rejects unknown schema, unsafe paths, excess queues, and invalid UIDs.
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1 || self.pending.len() > QUEUE_LIMIT {
            return Err(SyncError::Protocol);
        }
        for (uid, file) in &self.pending {
            if *uid != file.uid || *uid > self.cursor {
                return Err(SyncError::Protocol);
            }
            file.validate()?;
        }
        Ok(())
    }

    /// Apply one atomic durable delta. A storage adapter performs the same
    /// cursor/upsert/remove transaction without rewriting the full envelope.
    ///
    /// # Errors
    /// Rejects unknown versions, cursor regression, unsafe metadata or overflow.
    pub fn apply_delta(&mut self, delta: &CheckpointDelta) -> Result<()> {
        delta.validate()?;
        if delta.cursor < self.cursor || (!self.initial && delta.initial) {
            return Err(SyncError::Protocol);
        }
        if let Some(file) = &delta.pending_upsert {
            if !self.pending.contains_key(&file.uid) && self.pending.len() >= QUEUE_LIMIT {
                return Err(SyncError::QueueFull);
            }
            self.pending.insert(file.uid, file.clone());
        }
        if let Some(uid) = delta.pending_remove {
            self.pending.remove(&uid);
        }
        self.cursor = delta.cursor;
        self.initial = delta.initial;
        Ok(())
    }
}

/// Atomic cursor/change journal update. The host persists normalized pending
/// rows so initial synchronization writes O(n) bytes rather than O(n²).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CheckpointDelta {
    /// Current delta envelope version; unknown versions fail loudly.
    pub schema_version: u32,
    /// Cursor advanced in the same transaction as the pending row.
    pub cursor: u64,
    /// Whether the initial ready barrier has not yet arrived.
    pub initial: bool,
    /// Authenticated notice to durably upsert, when present.
    pub pending_upsert: Option<RemoteFile>,
    /// Applied/parked notice to durably remove, when present.
    pub pending_remove: Option<u64>,
}

impl CheckpointDelta {
    /// Validate a delta before changing a storage cursor.
    ///
    /// # Errors
    /// Rejects unsafe metadata, unknown schemas, and UIDs beyond the cursor.
    pub fn validate(&self) -> Result<()> {
        if self.schema_version != 1 {
            return Err(SyncError::Protocol);
        }
        if let Some(file) = &self.pending_upsert {
            if file.uid == 0 || file.uid > self.cursor {
                return Err(SyncError::Protocol);
            }
            file.validate()?;
        }
        if self
            .pending_remove
            .is_some_and(|uid| uid == 0 || uid > self.cursor)
        {
            return Err(SyncError::Protocol);
        }
        Ok(())
    }
}

/// Immutable durable outbox receipt. `bytes=None` is a tombstone; folders must
/// also set `folder=true`. The host supplies a fresh nonce per file upload.
pub struct Upload {
    /// Caller receipt used to acknowledge precisely one immutable mutation.
    pub operation_id: String,
    /// Current logical vault path.
    pub path: String,
    /// Previous logical path for rename attribution.
    pub related_path: Option<String>,
    /// Directory marker.
    pub folder: bool,
    /// Preserved creation milliseconds.
    pub ctime: u64,
    /// Snapshot modification milliseconds.
    pub mtime: u64,
    /// Immutable snapshot bytes, or absence for a deletion.
    pub bytes: Option<Vec<u8>>,
}

impl fmt::Debug for Upload {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Upload")
            .field("operation_id", &self.operation_id)
            .finish_non_exhaustive()
    }
}

/// Host inputs. Data payloads must never be sent to application diagnostics.
pub enum Input {
    /// The socket requested by `Connect` is open.
    Opened,
    /// A complete WebSocket text message.
    Text(String),
    /// A complete WebSocket binary message.
    Binary(Vec<u8>),
    /// Transport failed/closed; error strings deliberately stay at the host.
    Disconnected,
    /// Monotonic timer wakeup for deadlines, heartbeat, and reconnection.
    Tick,
    /// Stop the session and return queued receipts to the host.
    Cancel,
    /// The exact emitted checkpoint revision is durably committed.
    CheckpointPersisted(u64),
}

/// Transport and persistence work to execute in order, outside engine locks.
#[derive(Debug)]
pub enum Effect {
    /// Open the validated secure WebSocket destination.
    Connect {
        /// Official regional WebSocket URL.
        url: String,
    },
    /// Send exact credential/ciphertext-bearing JSON without logging it.
    SendText(TextFrame),
    /// Send an encrypted content piece; await its acknowledgement.
    SendBinary(BinaryFrame),
    /// Close the current socket; never opens another socket implicitly.
    Close,
    /// Commit this snapshot before acknowledging its revision.
    PersistCheckpoint {
        /// In-memory barrier revision, distinct from server UID.
        revision: u64,
        /// Full crash-recovery envelope.
        checkpoint: Checkpoint,
    },
    /// Commit cursor/initial/upsert/remove atomically using normalized DB rows.
    PersistCheckpointDelta {
        /// Exact local barrier revision to acknowledge after commit.
        revision: u64,
        /// Versioned, bounded durable delta.
        delta: CheckpointDelta,
    },
    /// Apply or park this notice durably before `complete_remote(uid)`.
    RemoteChange(RemoteFile),
    /// Initial server stream ended, and local outbox uploads may begin.
    Ready {
        /// Current server cursor.
        cursor: u64,
    },
    /// Decrypted authenticated file bytes, or `None` for a remote tombstone.
    Downloaded(Download),
    /// The server acknowledged the final upload frame/metadata.
    Uploaded {
        /// Exact caller receipt.
        operation_id: String,
        /// Original content SHA-256, empty for tombstone/folder.
        content_hash: String,
    },
    /// A terminal or retryable failure; payloads are never embedded.
    Failed {
        /// Typed boundary failure.
        error: SyncError,
        /// True only when safe to reconnect automatically.
        retryable: bool,
        /// Active receipt, if any.
        operation_id: Option<String>,
    },
    /// Cancellation returns receipt ownership without acknowledging it.
    Cancelled {
        /// Caller receipt.
        operation_id: String,
    },
}

/// Encrypted binary data with redacted diagnostics.
pub struct BinaryFrame(Vec<u8>);

impl BinaryFrame {
    /// Borrow a frame solely to send through the transport.
    #[must_use]
    pub fn bytes(&self) -> &[u8] {
        &self.0
    }
}

impl fmt::Debug for BinaryFrame {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("BinaryFrame")
            .field("len", &self.0.len())
            .finish()
    }
}

/// Authenticated download, with plaintext excluded from diagnostics.
pub struct Download {
    /// Pull revision identifier.
    pub uid: u64,
    /// Original content bytes, or `None` when the revision was deleted.
    pub bytes: Option<Vec<u8>>,
    /// SHA-256 over original bytes, for the host's integrity check.
    pub content_hash: Option<String>,
}

impl fmt::Debug for Download {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("Download")
            .field("uid", &self.uid)
            .finish_non_exhaustive()
    }
}

enum Connection {
    Idle,
    Opening { deadline: u64 },
    Authenticating { deadline: u64 },
    Connected,
    Waiting { next: u64 },
    Stopped,
}

struct PushTransfer {
    operation_id: String,
    metadata: Value,
    bytes: Vec<u8>,
    hash: String,
    memory_cost: u64,
    path: String,
    related_path: Option<String>,
}

enum Operation {
    Upload(PushTransfer),
    Download(u64),
}

impl Operation {
    fn operation_id(&self) -> Option<String> {
        match self {
            Self::Upload(upload) => Some(upload.operation_id.clone()),
            Self::Download(_) => None,
        }
    }
}

enum Active {
    PushHeader {
        upload: PushTransfer,
        deadline: u64,
    },
    PushPiece {
        upload: PushTransfer,
        next_offset: usize,
        deadline: u64,
    },
    PullHeader {
        uid: u64,
        deadline: u64,
    },
    PullPieces {
        uid: u64,
        size: usize,
        pieces_remaining: usize,
        bytes: Vec<u8>,
        deadline: u64,
    },
}

impl Active {
    fn deadline(&self) -> u64 {
        match self {
            Self::PushHeader { deadline, .. }
            | Self::PushPiece { deadline, .. }
            | Self::PullHeader { deadline, .. }
            | Self::PullPieces { deadline, .. } => *deadline,
        }
    }
    fn operation_id(&self) -> Option<String> {
        match self {
            Self::PushHeader { upload, .. } | Self::PushPiece { upload, .. } => {
                Some(upload.operation_id.clone())
            }
            _ => None,
        }
    }
    fn into_retry(self) -> Operation {
        match self {
            Self::PushHeader { upload, .. } | Self::PushPiece { upload, .. } => {
                Operation::Upload(upload)
            }
            Self::PullHeader { uid, .. } | Self::PullPieces { uid, .. } => Operation::Download(uid),
        }
    }
}

/// One account-authorized vault WebSocket. Methods perform no I/O. Invoke from
/// one serial host runner and execute returned effects after releasing its lock.
pub struct Session {
    config: SessionConfig,
    cipher: VaultCipher,
    checkpoint: Checkpoint,
    checkpoint_revision: u64,
    durable_revision: u64,
    delivered: BTreeMap<u64, u64>,
    to_deliver: VecDeque<u64>,
    connection: Connection,
    server_ready: bool,
    last_message: u64,
    last_heartbeat: u64,
    failures: u32,
    per_file_max: u64,
    queued: VecDeque<Operation>,
    active: Option<Active>,
    buffered_upload_bytes: u64,
    // Reservation follows the owned Download effect until the consumer has
    // durably disposed its bytes. It gates allocation of every next transfer.
    held_download: Option<(u64, u64)>,
}

impl Session {
    /// Nonsecret remote vault identity used to fence runtime profile bindings.
    #[must_use]
    pub fn vault_id(&self) -> &str {
        &self.config.vault_id
    }

    /// Restore a durable checkpoint and vault cipher.
    ///
    /// # Errors
    /// Rejects invalid checkpoint or profile configuration.
    pub fn new(config: SessionConfig, cipher: VaultCipher, checkpoint: Checkpoint) -> Result<Self> {
        config.filter.validate()?;
        checkpoint.validate()?;
        if config.transfer_limit == 0 || config.queued_byte_limit == 0 {
            return Err(SyncError::FileTooLarge);
        }
        let to_deliver = checkpoint.pending.keys().copied().collect();
        Ok(Self {
            config,
            cipher,
            checkpoint,
            checkpoint_revision: 0,
            durable_revision: 0,
            delivered: BTreeMap::new(),
            to_deliver,
            connection: Connection::Idle,
            server_ready: false,
            last_message: 0,
            last_heartbeat: 0,
            failures: 0,
            per_file_max: DEFAULT_FILE_LIMIT,
            queued: VecDeque::new(),
            active: None,
            buffered_upload_bytes: 0,
            held_download: None,
        })
    }

    /// Snapshot for diagnostics or recovery persistence; contains no credentials.
    #[must_use]
    pub fn checkpoint(&self) -> &Checkpoint {
        &self.checkpoint
    }

    /// Open the connection, replaying already durable pending notices first.
    ///
    /// # Errors
    /// Rejects attempts to open while already opening/connected.
    pub fn begin(&mut self, now: u64) -> Result<Vec<Effect>> {
        if !matches!(
            self.connection,
            Connection::Idle | Connection::Waiting { .. } | Connection::Stopped
        ) {
            return Err(SyncError::SessionState);
        }
        self.connection = Connection::Opening {
            deadline: now.saturating_add(CONNECTION_TIMEOUT),
        };
        self.server_ready = false;
        let mut effects = if self.durable_revision == self.checkpoint_revision {
            self.deliver_pending()
        } else {
            Vec::new()
        };
        effects.push(Effect::Connect {
            url: server_url(&self.config.host)?,
        });
        Ok(effects)
    }

    /// Prepare an immutable encrypted upload. Encryption happens once, so a
    /// reconnect reuses exactly the same snapshot and cipher frame.
    ///
    /// # Errors
    /// Rejects unsafe paths, filtered files, duplicate receipts, or oversized data.
    pub fn queue_upload(
        &mut self,
        upload: Upload,
        nonce: [u8; 12],
        now: u64,
    ) -> Result<Vec<Effect>> {
        if self.download_reserved() {
            return Err(SyncError::QueueFull);
        }
        validate_path(&upload.path)?;
        if let Some(path) = &upload.related_path {
            validate_path(path)?;
        }
        if upload.operation_id.is_empty() || !self.config.filter.allows(&upload.path, upload.folder)
        {
            return Err(SyncError::Path);
        }
        if self.queued.len() >= QUEUE_LIMIT {
            return Err(SyncError::QueueFull);
        }
        if self
            .queued
            .iter()
            .any(|operation| operation.operation_id().as_deref() == Some(&upload.operation_id))
            || self
                .active
                .as_ref()
                .and_then(Active::operation_id)
                .as_deref()
                == Some(&upload.operation_id)
        {
            return Err(SyncError::SessionState);
        }
        let deleted = upload.bytes.is_none();
        let bytes = upload.bytes.as_deref().unwrap_or_default();
        let memory_cost = u64::try_from(bytes.len())
            .map_err(|_| SyncError::FileTooLarge)?
            .saturating_add(
                u64::try_from(upload.path.len())
                    .map_err(|_| SyncError::Path)?
                    .saturating_mul(4),
            )
            .saturating_add(
                u64::try_from(upload.related_path.as_deref().unwrap_or_default().len())
                    .map_err(|_| SyncError::Path)?
                    .saturating_mul(3),
            )
            .saturating_add(
                u64::try_from(upload.operation_id.len()).map_err(|_| SyncError::QueueFull)?,
            )
            .saturating_add(2048);
        let reserved = self
            .buffered_upload_bytes
            .checked_add(memory_cost)
            .ok_or(SyncError::QueueFull)?;
        if reserved > self.config.queued_byte_limit {
            return Err(SyncError::QueueFull);
        }
        if upload.folder && !bytes.is_empty() {
            return Err(SyncError::Protocol);
        }
        if u64::try_from(bytes.len()).map_err(|_| SyncError::FileTooLarge)? > self.file_limit() {
            return Err(SyncError::FileTooLarge);
        }
        let hash = if deleted || upload.folder {
            String::new()
        } else {
            hex::encode(Sha256::digest(bytes))
        };
        let encrypted = if deleted || upload.folder || bytes.is_empty() {
            Vec::new()
        } else {
            self.cipher.encrypt_content(bytes, nonce)?
        };
        let path = self.cipher.encode_string(&upload.path)?;
        let related = upload
            .related_path
            .as_deref()
            .map(|path| self.cipher.encode_string(path))
            .transpose()?;
        let wire_hash = if hash.is_empty() {
            String::new()
        } else {
            self.cipher.encode_string(&hash)?
        };
        let mut metadata = json!({"op":"push","path":path,"relatedpath":related,"extension":if upload.folder { String::new() } else { extension(upload.path.rsplit('/').next().unwrap_or_default()) },"hash":wire_hash,"ctime":if deleted || upload.folder {0} else {upload.ctime},"mtime":if deleted || upload.folder {0} else {upload.mtime},"folder":upload.folder,"deleted":deleted});
        if !deleted && !upload.folder {
            let fields = metadata.as_object_mut().ok_or(SyncError::Protocol)?;
            fields.insert("size".into(), json!(encrypted.len()));
            fields.insert(
                "pieces".into(),
                json!(encrypted.len().div_ceil(PIECE_BYTES)),
            );
        }
        self.buffered_upload_bytes = reserved;
        self.queued.push_back(Operation::Upload(PushTransfer {
            operation_id: upload.operation_id,
            metadata,
            bytes: encrypted,
            hash,
            memory_cost,
            path: upload.path,
            related_path: upload.related_path,
        }));
        self.pump(now)
    }

    /// Queue a revision pull. The runtime validates the resulting plaintext
    /// against its corresponding metadata hash before applying it.
    ///
    /// # Errors
    /// Rejects a zero pull identifier or a full operation queue.
    pub fn queue_download(&mut self, uid: u64, now: u64) -> Result<Vec<Effect>> {
        if uid == 0 {
            return Err(SyncError::Protocol);
        }
        if self.held_download.is_some_and(|(held,_)|held==uid) || self.queued.iter().any(|operation| matches!(operation, Operation::Download(existing) if *existing == uid))
            || self.active.as_ref().is_some_and(|active| matches!(active,Active::PullHeader {uid:existing,..} | Active::PullPieces {uid:existing,..} if *existing==uid)) { return Ok(Vec::new()); }
        if self
            .queued
            .iter()
            .filter(|operation| matches!(operation, Operation::Download(_)))
            .count()
            >= QUEUE_LIMIT
        {
            return Err(SyncError::QueueFull);
        }
        let mut effects = Vec::new();
        // Pending immutable outbox receipts remain durable in the runtime.
        // Return unsent uploads instead of retaining a full upload while pulling
        // another full image. An active upload finishes before the pull starts.
        let mut retained = VecDeque::new();
        while let Some(operation) = self.queued.pop_front() {
            if let Operation::Upload(upload) = operation {
                self.buffered_upload_bytes = self
                    .buffered_upload_bytes
                    .saturating_sub(upload.memory_cost);
                effects.push(Effect::Cancelled {
                    operation_id: upload.operation_id,
                });
            } else {
                retained.push_back(operation);
            }
        }
        self.queued = retained;
        self.queued.push_back(Operation::Download(uid));
        effects.extend(self.pump(now)?);
        Ok(effects)
    }

    /// Release an owned completion only after its bytes have been durably
    /// ingested/parked and dropped. This releases memory, not a checkpoint ACK.
    /// Pumping resumes on the next event, after the durable checkpoint barrier.
    ///
    /// # Errors
    /// Rejects an unrelated or already-released completion identity.
    pub fn release_download(&mut self, uid: u64) -> Result<()> {
        if self.held_download.is_none_or(|(held, _)| held != uid) {
            return Err(SyncError::SessionState);
        }
        self.held_download = None;
        Ok(())
    }

    /// Actual retained transfer capacity, excluding bounded wire/message chunks
    /// and metadata. An emitted download remains counted until explicit release.
    #[must_use]
    pub fn transfer_memory_bytes(&self) -> u64 {
        self.buffered_upload_bytes
            .saturating_add(self.held_download.map_or(0, |(_, capacity)| capacity))
            .saturating_add(match &self.active {
                Some(Active::PullPieces { bytes, .. }) => {
                    u64::try_from(bytes.capacity()).unwrap_or(u64::MAX)
                }
                _ => 0,
            })
    }

    fn download_reserved(&self) -> bool {
        self.held_download.is_some()
            || self
                .queued
                .iter()
                .any(|operation| matches!(operation, Operation::Download(_)))
            || matches!(
                self.active,
                Some(Active::PullHeader { .. } | Active::PullPieces { .. })
            )
    }

    /// Remove a notice only after the host's application/conflict transaction
    /// commits. Persist the emitted checkpoint to bound replay after a crash.
    ///
    /// # Errors
    /// Rejects completion of a notice that has not been durably delivered.
    pub fn complete_remote(&mut self, uid: u64) -> Result<Vec<Effect>> {
        if !self.delivered.contains_key(&uid) || self.checkpoint.pending.remove(&uid).is_none() {
            return Err(SyncError::SessionState);
        }
        self.delivered.remove(&uid);
        self.persist(None, Some(uid))
    }

    /// Consume one socket/timer/storage event, returning ordered side effects.
    ///
    /// # Errors
    /// Rejects impossible host lifecycle transitions. Peer failures are emitted
    /// as `Failed` effects with the connection closed and receipts preserved.
    pub fn handle(&mut self, input: Input, now: u64) -> Result<Vec<Effect>> {
        match input {
            Input::Opened => self.opened(now),
            Input::Text(text) => {
                self.last_message = now;
                match self.text(&text, now) {
                    Ok(effects) => Ok(effects),
                    Err(error) => Ok(self.fail(error, false, now)),
                }
            }
            Input::Binary(bytes) => {
                self.last_message = now;
                match self.binary(bytes, now) {
                    Ok(effects) => Ok(effects),
                    Err(error) => Ok(self.fail(error, false, now)),
                }
            }
            Input::Disconnected => {
                if matches!(
                    self.connection,
                    Connection::Stopped | Connection::Idle | Connection::Waiting { .. }
                ) {
                    return Ok(Vec::new());
                }
                Ok(self.fail(SyncError::SessionState, true, now))
            }
            Input::Tick => self.tick(now),
            Input::Cancel => Ok(self.cancel()),
            Input::CheckpointPersisted(revision) => {
                if revision > self.checkpoint_revision || revision < self.durable_revision {
                    return Err(SyncError::SessionState);
                }
                self.durable_revision = revision;
                if revision != self.checkpoint_revision {
                    return Ok(Vec::new());
                }
                let mut effects = self.deliver_pending();
                if self.server_ready {
                    effects.push(Effect::Ready {
                        cursor: self.checkpoint.cursor,
                    });
                }
                effects.extend(self.pump(now)?);
                Ok(effects)
            }
        }
    }

    fn opened(&mut self, now: u64) -> Result<Vec<Effect>> {
        if !matches!(self.connection, Connection::Opening { .. }) {
            return Err(SyncError::SessionState);
        }
        self.connection = Connection::Authenticating {
            deadline: now.saturating_add(CONNECTION_TIMEOUT),
        };
        self.last_message = now;
        self.last_heartbeat = now;
        Ok(vec![Effect::SendText(TextFrame::new(
            json!({"op":"init","token":&*self.config.token,"id":self.config.vault_id,"keyhash":self.cipher.key_hash(),"version":self.checkpoint.cursor,"initial":self.checkpoint.initial,"device":self.config.device_name,"encryption_version":self.cipher.version()}),
        ))])
    }

    fn text(&mut self, text: &str, now: u64) -> Result<Vec<Effect>> {
        if text.len() > TEXT_MESSAGE_BYTES {
            return Err(SyncError::Protocol);
        }
        let value: Value = serde_json::from_str(text).map_err(|_| SyncError::Protocol)?;
        if !value.is_object() {
            return Err(SyncError::Protocol);
        }
        if value.get("op").and_then(Value::as_str) == Some("pong") {
            return Ok(Vec::new());
        }
        if matches!(self.connection, Connection::Authenticating { .. }) {
            if value.get("status").and_then(Value::as_str) == Some("err")
                || value.get("res").and_then(Value::as_str) == Some("err")
            {
                return Err(SyncError::AccountRejected);
            }
            if value.get("res").and_then(Value::as_str) != Some("ok") {
                return Err(SyncError::Protocol);
            }
            if let Some(limit) = value.get("perFileMax") {
                self.per_file_max = limit.as_u64().ok_or(SyncError::Protocol)?;
            }
            self.connection = Connection::Connected;
            self.failures = 0;
            return Ok(Vec::new());
        }
        if !matches!(self.connection, Connection::Connected) {
            return Err(SyncError::SessionState);
        }
        match value.get("op").and_then(Value::as_str) {
            Some("ready") => {
                let cursor = value
                    .get("version")
                    .and_then(Value::as_u64)
                    .ok_or(SyncError::Protocol)?;
                self.checkpoint.cursor = self.checkpoint.cursor.max(cursor);
                self.checkpoint.initial = false;
                self.server_ready = true;
                self.persist(None, None)
            }
            Some("push") => self.remote_push(value, now),
            _ => self.response(&value, now),
        }
    }

    fn remote_push(&mut self, value: Value, now: u64) -> Result<Vec<Effect>> {
        let wire: WireFile = serde_json::from_value(value).map_err(|_| SyncError::Protocol)?;
        if wire.uid == 0 {
            return Err(SyncError::Protocol);
        }
        if wire.uid <= self.checkpoint.cursor {
            return Ok(Vec::new());
        }
        let local_operation_id = self.active.as_ref().and_then(|active| match active {
            Active::PushHeader { upload, .. } | Active::PushPiece { upload, .. }
                if upload.matches(&wire) =>
            {
                Some(upload.operation_id.clone())
            }
            _ => None,
        });
        let path = self.cipher.decode_string(&wire.path)?;
        validate_path(&path)?;
        let related_path = wire
            .relatedpath
            .as_deref()
            .filter(|path| !path.is_empty())
            .map(|path| self.cipher.decode_string(path))
            .transpose()?;
        if let Some(path) = &related_path {
            validate_path(path)?;
        }
        let hash = if wire.hash.is_empty() {
            String::new()
        } else {
            self.cipher.decode_string(&wire.hash)?
        };
        if !hash.is_empty()
            && (hash.len() != 64 || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
        {
            return Err(SyncError::Protocol);
        }
        let selected = self.config.filter.allows(&path, wire.folder);
        let file = RemoteFile {
            uid: wire.uid,
            path,
            related_path,
            size: wire.size,
            hash,
            ctime: wire.ctime,
            mtime: wire.mtime,
            folder: wire.folder,
            deleted: wire.deleted,
            device: wire.device,
            user: wire.user,
            initial: self.checkpoint.initial.into(),
            local_operation_id,
            selected,
        };
        let invalidated = if file.local_operation_id.is_none() {
            self.invalidate_uploads(&file, now)
        } else {
            Vec::new()
        };
        let pending_upsert = if !self.checkpoint.initial || !file.deleted {
            if self.checkpoint.pending.len() >= QUEUE_LIMIT {
                return Err(SyncError::QueueFull);
            }
            self.checkpoint.pending.insert(file.uid, file.clone());
            self.to_deliver.push_back(file.uid);
            Some(file)
        } else {
            None
        };
        self.checkpoint.cursor = wire.uid;
        let mut effects = self.persist(pending_upsert, None)?;
        effects.extend(invalidated);
        Ok(effects)
    }

    fn response(&mut self, value: &Value, now: u64) -> Result<Vec<Effect>> {
        if value
            .get("err")
            .is_some_and(|error| error != &Value::Null && error != &Value::Bool(false))
            || value.get("res").and_then(Value::as_str) == Some("err")
            || value.get("status").and_then(Value::as_str) == Some("err")
        {
            return Err(SyncError::RemoteRejected);
        }
        let active = self.active.take().ok_or(SyncError::Protocol)?;
        match active {
            Active::PushHeader { upload, .. } => {
                if upload.bytes.is_empty() || value.get("res").and_then(Value::as_str) == Some("ok")
                {
                    self.buffered_upload_bytes = self
                        .buffered_upload_bytes
                        .saturating_sub(upload.memory_cost);
                    let mut effects = vec![Effect::Uploaded {
                        operation_id: upload.operation_id,
                        content_hash: upload.hash,
                    }];
                    effects.extend(self.pump(now)?);
                    Ok(effects)
                } else {
                    self.send_piece(upload, 0, now)
                }
            }
            Active::PushPiece {
                upload,
                next_offset,
                ..
            } => {
                if next_offset == upload.bytes.len() {
                    self.buffered_upload_bytes = self
                        .buffered_upload_bytes
                        .saturating_sub(upload.memory_cost);
                    let mut effects = vec![Effect::Uploaded {
                        operation_id: upload.operation_id,
                        content_hash: upload.hash,
                    }];
                    effects.extend(self.pump(now)?);
                    Ok(effects)
                } else {
                    self.send_piece(upload, next_offset, now)
                }
            }
            Active::PullHeader { uid, .. } => self.pull_header(uid, value, now),
            Active::PullPieces { .. } => Err(SyncError::Protocol),
        }
    }

    fn pull_header(&mut self, uid: u64, value: &Value, now: u64) -> Result<Vec<Effect>> {
        if self.buffered_upload_bytes != 0 || self.held_download.is_some() {
            return Err(SyncError::SessionState);
        }
        if value.get("deleted").and_then(Value::as_bool) == Some(true) {
            if self
                .checkpoint
                .pending
                .get(&uid)
                .is_some_and(|file| !file.deleted)
            {
                return Err(SyncError::RemoteRejected);
            }
            self.held_download = Some((uid, 0));
            let effects = vec![Effect::Downloaded(Download {
                uid,
                bytes: None,
                content_hash: None,
            })];
            return Ok(effects);
        }
        let size = value
            .get("size")
            .and_then(Value::as_u64)
            .ok_or(SyncError::Protocol)?;
        // The encrypted frame adds 28 bytes; zero-byte files stay empty.
        if size > self.file_limit().saturating_add(28) {
            return Err(SyncError::FileTooLarge);
        }
        let size = usize::try_from(size).map_err(|_| SyncError::FileTooLarge)?;
        let pieces = value
            .get("pieces")
            .and_then(Value::as_u64)
            .and_then(|value| usize::try_from(value).ok())
            .ok_or(SyncError::Protocol)?;
        if (size == 0) != (pieces == 0)
            || pieces > size
            || (size > 0 && pieces < size.div_ceil(PIECE_BYTES))
        {
            return Err(SyncError::Protocol);
        }
        if pieces == 0 {
            let hash = hex::encode(Sha256::digest([]));
            if self
                .checkpoint
                .pending
                .get(&uid)
                .is_some_and(|file| !file.hash.is_empty() && file.hash != hash)
            {
                return Err(SyncError::Authentication);
            }
            self.held_download = Some((uid, 0));
            let effects = vec![Effect::Downloaded(Download {
                uid,
                bytes: Some(Vec::new()),
                content_hash: Some(hash),
            })];
            return Ok(effects);
        }
        let mut bytes = Vec::new();
        bytes
            .try_reserve_exact(size)
            .map_err(|_| SyncError::QueueFull)?;
        self.active = Some(Active::PullPieces {
            uid,
            size,
            pieces_remaining: pieces,
            bytes,
            deadline: now.saturating_add(REQUEST_TIMEOUT),
        });
        Ok(Vec::new())
    }

    fn binary(&mut self, piece: Vec<u8>, now: u64) -> Result<Vec<Effect>> {
        if !matches!(self.connection, Connection::Connected) {
            return Err(SyncError::SessionState);
        }
        if !matches!(self.active, Some(Active::PullPieces { .. })) {
            return Err(SyncError::Protocol);
        }
        let Active::PullPieces {
            uid,
            size,
            mut pieces_remaining,
            mut bytes,
            ..
        } = self.active.take().ok_or(SyncError::Protocol)?
        else {
            return Err(SyncError::Protocol);
        };
        if piece.is_empty()
            || piece.len() > PIECE_BYTES
            || piece.len() > size.saturating_sub(bytes.len())
        {
            return Err(SyncError::Protocol);
        }
        bytes.extend(piece);
        pieces_remaining -= 1;
        if pieces_remaining > 0 {
            if bytes.len() >= size {
                return Err(SyncError::Protocol);
            }
            self.active = Some(Active::PullPieces {
                uid,
                size,
                pieces_remaining,
                bytes,
                deadline: now.saturating_add(REQUEST_TIMEOUT),
            });
            return Ok(Vec::new());
        }
        if bytes.len() != size {
            return Err(SyncError::Protocol);
        }
        let plaintext = self.cipher.decrypt_content_owned(bytes)?;
        let hash = hex::encode(Sha256::digest(&plaintext));
        if let Some(file) = self.checkpoint.pending.get(&uid)
            && !file.hash.is_empty()
            && file.hash != hash
        {
            return Err(SyncError::Authentication);
        }
        self.held_download = Some((
            uid,
            u64::try_from(plaintext.capacity()).map_err(|_| SyncError::FileTooLarge)?,
        ));
        let effects = vec![Effect::Downloaded(Download {
            uid,
            bytes: Some(plaintext),
            content_hash: Some(hash),
        })];
        Ok(effects)
    }

    fn send_piece(&mut self, upload: PushTransfer, offset: usize, now: u64) -> Result<Vec<Effect>> {
        let end = offset.saturating_add(PIECE_BYTES).min(upload.bytes.len());
        let bytes = upload
            .bytes
            .get(offset..end)
            .ok_or(SyncError::Protocol)?
            .to_vec();
        self.active = Some(Active::PushPiece {
            upload,
            next_offset: end,
            deadline: now.saturating_add(REQUEST_TIMEOUT),
        });
        Ok(vec![Effect::SendBinary(BinaryFrame(bytes))])
    }

    fn pump(&mut self, now: u64) -> Result<Vec<Effect>> {
        if !matches!(self.connection, Connection::Connected)
            || !self.server_ready
            || self.durable_revision != self.checkpoint_revision
            || self.active.is_some()
            || self.held_download.is_some()
        {
            return Ok(Vec::new());
        }
        let operation = if self.checkpoint.pending.is_empty() {
            self.queued.pop_front()
        } else {
            self.queued
                .iter()
                .position(|operation| matches!(operation, Operation::Download(_)))
                .and_then(|index| self.queued.remove(index))
        };
        let Some(operation) = operation else {
            return Ok(Vec::new());
        };
        match operation {
            Operation::Upload(upload) => {
                let size =
                    u64::try_from(upload.bytes.len()).map_err(|_| SyncError::FileTooLarge)?;
                if size > self.file_limit().saturating_add(28) {
                    self.buffered_upload_bytes = self
                        .buffered_upload_bytes
                        .saturating_sub(upload.memory_cost);
                    return Ok(vec![Effect::Failed {
                        error: SyncError::FileTooLarge,
                        retryable: false,
                        operation_id: Some(upload.operation_id),
                    }]);
                }
                let effect = Effect::SendText(TextFrame::new(upload.metadata.clone()));
                self.active = Some(Active::PushHeader {
                    upload,
                    deadline: now.saturating_add(REQUEST_TIMEOUT),
                });
                Ok(vec![effect])
            }
            Operation::Download(uid) => {
                self.active = Some(Active::PullHeader {
                    uid,
                    deadline: now.saturating_add(REQUEST_TIMEOUT),
                });
                Ok(vec![Effect::SendText(TextFrame::new(
                    json!({"op":"pull","uid":uid}),
                ))])
            }
        }
    }

    fn file_limit(&self) -> u64 {
        self.per_file_max.min(self.config.transfer_limit)
    }

    fn invalidate_uploads(&mut self, file: &RemoteFile, now: u64) -> Vec<Effect> {
        fn affected(upload: &PushTransfer, file: &RemoteFile) -> bool {
            let matches = |path: &str| {
                path == file.path
                    || file.related_path.as_deref() == Some(path)
                    || (file.folder
                        && path
                            .strip_prefix(&file.path)
                            .is_some_and(|suffix| suffix.starts_with('/')))
            };
            matches(&upload.path) || upload.related_path.as_deref().is_some_and(matches)
        }
        let mut effects = Vec::new();
        let mut retained = VecDeque::new();
        for operation in self.queued.drain(..) {
            match operation {
                Operation::Upload(upload) if affected(&upload, file) => {
                    self.buffered_upload_bytes = self
                        .buffered_upload_bytes
                        .saturating_sub(upload.memory_cost);
                    effects.push(Effect::Cancelled {
                        operation_id: upload.operation_id,
                    });
                }
                operation => retained.push_back(operation),
            }
        }
        self.queued = retained;
        if self.active.as_ref().is_some_and(|active|matches!(active,Active::PushHeader {upload,..} | Active::PushPiece {upload,..} if affected(upload,file))) {
            if let Some(Active::PushHeader {upload,..} | Active::PushPiece {upload,..})=self.active.take() {
                self.buffered_upload_bytes=self.buffered_upload_bytes.saturating_sub(upload.memory_cost);
                effects.push(Effect::Close);
                effects.push(Effect::Cancelled {operation_id:upload.operation_id});
            }
            self.server_ready=false;
            self.connection=Connection::Waiting {next:now.saturating_add(5000)};
        }
        effects
    }

    fn persist(
        &mut self,
        pending_upsert: Option<RemoteFile>,
        pending_remove: Option<u64>,
    ) -> Result<Vec<Effect>> {
        self.checkpoint_revision = self
            .checkpoint_revision
            .checked_add(1)
            .ok_or(SyncError::SessionState)?;
        Ok(vec![Effect::PersistCheckpointDelta {
            revision: self.checkpoint_revision,
            delta: CheckpointDelta {
                schema_version: 1,
                cursor: self.checkpoint.cursor,
                initial: self.checkpoint.initial,
                pending_upsert,
                pending_remove,
            },
        }])
    }

    fn deliver_pending(&mut self) -> Vec<Effect> {
        let mut effects = Vec::new();
        while let Some(uid) = self.to_deliver.pop_front() {
            if let Some(file) = self.checkpoint.pending.get(&uid)
                && !self.delivered.contains_key(&uid)
            {
                self.delivered.insert(uid, self.durable_revision);
                let mut file = file.clone();
                file.selected = self.config.filter.allows(&file.path, file.folder);
                effects.push(Effect::RemoteChange(file));
            }
        }
        effects
    }

    fn tick(&mut self, now: u64) -> Result<Vec<Effect>> {
        match self.connection {
            Connection::Opening { deadline } | Connection::Authenticating { deadline }
                if now >= deadline =>
            {
                return Ok(self.fail(SyncError::Timeout, true, now));
            }
            Connection::Waiting { next } if now >= next => return self.begin(now),
            Connection::Connected => {}
            _ => return Ok(Vec::new()),
        }
        if self
            .active
            .as_ref()
            .is_some_and(|active| now >= active.deadline())
            || now.saturating_sub(self.last_message) > DISCONNECT_IDLE
        {
            return Ok(self.fail(SyncError::Timeout, true, now));
        }
        if now.saturating_sub(self.last_heartbeat) >= HEARTBEAT_INTERVAL {
            self.last_heartbeat = now;
            if now.saturating_sub(self.last_message) > HEARTBEAT_IDLE {
                return Ok(vec![Effect::SendText(TextFrame::new(json!({"op":"ping"})))]);
            }
        }
        self.pump(now)
    }

    fn fail(&mut self, error: SyncError, retryable: bool, now: u64) -> Vec<Effect> {
        let operation_id = self.active.as_ref().and_then(Active::operation_id);
        if let Some(active) = self.active.take() {
            self.queued.push_front(active.into_retry());
        }
        self.server_ready = false;
        if retryable {
            self.failures = self.failures.saturating_add(1);
            let shift = self.failures.saturating_sub(1).min(6);
            let delay = 5_000_u64.saturating_mul(1_u64 << shift).min(300_000);
            self.connection = Connection::Waiting {
                next: now.saturating_add(delay),
            };
        } else {
            self.connection = Connection::Stopped;
        }
        vec![
            Effect::Close,
            Effect::Failed {
                error,
                retryable,
                operation_id,
            },
        ]
    }

    fn cancel(&mut self) -> Vec<Effect> {
        let mut effects = vec![Effect::Close];
        if let Some(active) = self.active.take() {
            self.queued.push_front(active.into_retry());
        }
        for operation in self.queued.drain(..) {
            if let Some(operation_id) = operation.operation_id() {
                effects.push(Effect::Cancelled { operation_id });
            }
        }
        self.buffered_upload_bytes = 0;
        self.server_ready = false;
        self.connection = Connection::Stopped;
        effects
    }
}

#[derive(Deserialize)]
struct WireFile {
    uid: u64,
    path: String,
    #[serde(default)]
    relatedpath: Option<String>,
    #[serde(default)]
    size: u64,
    #[serde(default)]
    hash: String,
    #[serde(default)]
    ctime: u64,
    #[serde(default)]
    mtime: u64,
    folder: bool,
    deleted: bool,
    #[serde(default)]
    device: Option<String>,
    #[serde(default)]
    user: Option<Value>,
}

impl PushTransfer {
    fn matches(&self, file: &WireFile) -> bool {
        self.metadata.get("path").and_then(Value::as_str) == Some(&file.path)
            && self.metadata.get("hash").and_then(Value::as_str) == Some(&file.hash)
            && self.metadata.get("folder").and_then(Value::as_bool) == Some(file.folder)
            && self.metadata.get("deleted").and_then(Value::as_bool) == Some(file.deleted)
            && self.metadata.get("mtime").and_then(Value::as_u64) == Some(file.mtime)
    }
}
