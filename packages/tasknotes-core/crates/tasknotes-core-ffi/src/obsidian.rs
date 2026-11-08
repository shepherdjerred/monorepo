//! Thin native projection of the sans-I/O account and WebSocket APIs. Every
//! returned transport payload is transient and must be excluded from logs.

use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex, MutexGuard},
};

use crate::{
    facet::FfiFacetEngine,
    obsidian_runtime::{OwnedDownload, RuntimeBinding, runtime_error},
};
use obsidian_sync::{
    SyncError,
    auth::{AuthRequest, AuthResponse, RemoteVault},
    crypto::{EncryptionVersion, VaultCipher, VaultKey},
    session::{Checkpoint, Effect, Input, Session, SessionConfig},
};

/// Shared framing limits; host transports enforce these before message copying.
#[derive(Debug, Clone, uniffi::Record)]
pub struct ObsidianTransportLimits {
    /// Maximum UTF-8 text message byte count.
    pub text_message_bytes: u64,
    /// Maximum binary piece byte count.
    pub binary_message_bytes: u64,
    /// Protocol's default full plaintext file limit, before service negotiation.
    pub default_file_bytes: u64,
}

/// Return the authoritative native transport resource policy.
///
/// # Errors
/// Reports an unsupported platform integer width.
#[uniffi::export]
pub fn obsidian_transport_limits() -> Result<ObsidianTransportLimits, ObsidianBoundaryError> {
    Ok(ObsidianTransportLimits {
        text_message_bytes: u64::try_from(obsidian_sync::session::TEXT_MESSAGE_BYTES)
            .map_err(|_| ObsidianBoundaryError::Request)?,
        binary_message_bytes: u64::try_from(obsidian_sync::session::PIECE_BYTES)
            .map_err(|_| ObsidianBoundaryError::Request)?,
        default_file_bytes: obsidian_sync::session::DEFAULT_FILE_LIMIT,
    })
}

/// Typed boundary failures never contain credentials or peer/file payloads.
#[derive(Debug, Clone, thiserror::Error, uniffi::Error)]
pub enum ObsidianBoundaryError {
    /// The engine handle's serialization lock was poisoned.
    #[error("Obsidian engine lock failed")]
    Lock,
    /// A malformed local request or unmatched request identifier.
    #[error("Invalid Obsidian engine request")]
    Request,
    /// Nonblocking admission; retain the exact operation and retry later.
    #[error("The operation is busy; retry after current work completes")]
    Busy,
    /// Account, crypto, transport, or protocol rejection, redacted upstream.
    #[error("{detail}")]
    Boundary {
        /// Stable Rust error category, for native recovery UI.
        code: String,
        /// Sanitized, fixed engine message.
        detail: String,
    },
}

impl From<SyncError> for ObsidianBoundaryError {
    fn from(error: SyncError) -> Self {
        let code = match &error {
            SyncError::UnsupportedEncryption(_) => "unsupported_encryption",
            SyncError::Key => "key",
            SyncError::Authentication => "authentication",
            SyncError::Text => "text",
            SyncError::Protocol => "protocol",
            SyncError::Http(_) => "http",
            SyncError::AccountRejected => "account_rejected",
            SyncError::Host => "host",
            SyncError::Path => "path",
            SyncError::FileTooLarge => "file_too_large",
            SyncError::SessionState => "session_state",
            SyncError::RemoteRejected => "remote_rejected",
            SyncError::Timeout => "timeout",
            SyncError::QueueFull => "queue_full",
        };
        Self::Boundary {
            code: code.into(),
            detail: error.to_string(),
        }
    }
}

/// One deterministic account-request HTTP header.
#[derive(uniffi::Record)]
pub struct ObsidianHttpHeader {
    /// Header name.
    pub name: String,
    /// Header value. Tokens/passwords never use this field.
    pub value: String,
}

/// HTTP work for the native transport, not a persistent preference record.
#[derive(uniffi::Record)]
pub struct ObsidianHttpRequest {
    /// Local request identifier; never sent to Obsidian.
    pub request_id: u64,
    /// Fixed official account API destination.
    pub url: String,
    /// True: issue OPTIONS first with Origin, then the POST request.
    pub preflight: bool,
    /// POST headers (the OPTIONS preflight uses only Origin).
    pub headers: Vec<ObsidianHttpHeader>,
    /// Secret-bearing POST body; transport-only, never logged or stored.
    pub body: String,
}

/// Non-secret onboarding metadata for an owned or shared remote vault.
#[derive(uniffi::Record)]
pub struct ObsidianRemoteVault {
    /// Stable service identifier.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Validated regional hostname.
    pub host: String,
    /// Service region identifier.
    pub region: String,
    /// Exact HKDF salt.
    pub salt: String,
    /// Supported encryption version number.
    pub encryption_version: u8,
    /// Service-managed password (the password itself never leaves Rust).
    pub managed: bool,
    /// Appeared in the account's shared-vault list.
    pub shared: bool,
}

/// Account responses. Credential-bearing tokens are secure-storage inputs only.
#[derive(uniffi::Enum)]
pub enum ObsidianAccountResponse {
    /// Repeat sign-in with a one-time code.
    MfaRequired,
    /// A new one-time code is required.
    MfaRejected,
    /// Authenticated account session; immediately save token securely.
    SignedIn {
        /// Secure-storage input; never vault/DB/preference data.
        token: String,
        /// Display name.
        name: String,
        /// Account email.
        email: String,
    },
    /// Account service metadata, not a credential cache.
    UserInfo {
        /// Service metadata retained as JSON.
        metadata_json: String,
    },
    /// Owned/shared vault choices with no managed passwords exposed.
    Vaults {
        /// Stable-ID vault choices.
        vaults: Vec<ObsidianRemoteVault>,
    },
    /// The service accepted the prepared vault key proof.
    AccessGranted,
    /// The service invalidated the account token.
    SignedOut,
}

/// Derived profile secret. Copy key bytes into platform secure storage and
/// release this transient record; never serialize it into the runtime DB.
#[derive(uniffi::Record)]
pub struct ObsidianPreparedVault {
    /// Non-secret selected-vault description.
    pub vault: ObsidianRemoteVault,
    /// Exact 32-byte key for platform secure storage.
    pub key_bytes: Vec<u8>,
}

struct AccountState {
    next_request: u64,
    pending: BTreeMap<u64, AuthRequest>,
    vaults: BTreeMap<String, (RemoteVault, bool)>,
}

/// Account request/response correlation and opaque managed-password ownership.
/// Native code performs HTTP requests outside this handle's lock.
#[derive(uniffi::Object)]
pub struct FfiObsidianAccount {
    state: Mutex<AccountState>,
}

impl FfiObsidianAccount {
    fn locked(&self) -> Result<MutexGuard<'_, AccountState>, ObsidianBoundaryError> {
        self.state.lock().map_err(|_| ObsidianBoundaryError::Lock)
    }
    fn request(
        &self,
        request: AuthRequest,
        reset_account: bool,
    ) -> Result<ObsidianHttpRequest, ObsidianBoundaryError> {
        let mut state = self.locked()?;
        if reset_account {
            state.pending.clear();
            state.vaults.clear();
        }
        if state.pending.len() >= 32 {
            return Err(ObsidianBoundaryError::Request);
        }
        let request_id = state
            .next_request
            .checked_add(1)
            .ok_or(ObsidianBoundaryError::Request)?;
        state.next_request = request_id;
        let output = ObsidianHttpRequest {
            request_id,
            url: request.url(),
            preflight: request.requires_preflight(),
            headers: request
                .headers()
                .into_iter()
                .map(|(name, value)| ObsidianHttpHeader { name, value })
                .collect(),
            body: request.body().into(),
        };
        state.pending.insert(request_id, request);
        Ok(output)
    }
}

#[uniffi::export]
impl FfiObsidianAccount {
    /// Create an account boundary with no stored credentials.
    #[uniffi::constructor]
    #[must_use]
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(AccountState {
                next_request: 0,
                pending: BTreeMap::new(),
                vaults: BTreeMap::new(),
            }),
        })
    }

    /// Prepare sign-in; native UI collects the optional one-time MFA code.
    ///
    /// # Errors
    /// Returns a typed lock/queue error without including credentials.
    pub fn sign_in(
        &self,
        email: &str,
        password: &str,
        mfa: &str,
    ) -> Result<ObsidianHttpRequest, ObsidianBoundaryError> {
        self.request(AuthRequest::sign_in(email, password, mfa), true)
    }

    /// Prepare remote sign-out. Native code also removes its secure token.
    ///
    /// # Errors
    /// Returns a typed lock/queue error.
    pub fn sign_out(&self, token: &str) -> Result<ObsidianHttpRequest, ObsidianBoundaryError> {
        self.request(AuthRequest::sign_out(token), true)
    }

    /// Validate a secure-storage token against current account metadata.
    ///
    /// # Errors
    /// Returns a typed lock/queue error.
    pub fn user_info(&self, token: &str) -> Result<ObsidianHttpRequest, ObsidianBoundaryError> {
        self.request(AuthRequest::user_info(token), false)
    }

    /// Prepare owned/shared vault discovery with version-3 negotiation.
    ///
    /// # Errors
    /// Returns a typed lock/queue error.
    pub fn list_vaults(&self, token: &str) -> Result<ObsidianHttpRequest, ObsidianBoundaryError> {
        self.request(AuthRequest::list_vaults(token), false)
    }

    /// Cancel/release an HTTP request after native cancellation/transport error.
    ///
    /// # Errors
    /// Rejects a poisoned boundary lock. Removal is idempotent for a response
    /// already consumed or invalidated by an account switch.
    pub fn cancel_request(&self, request_id: u64) -> Result<(), ObsidianBoundaryError> {
        self.locked()?.pending.remove(&request_id);
        Ok(())
    }

    /// Decode the matching response; no network operation runs under the lock.
    ///
    /// # Errors
    /// Rejects stale IDs, malformed schemas and service failures with redaction.
    pub fn response(
        &self,
        request_id: u64,
        status: u16,
        body: &str,
    ) -> Result<ObsidianAccountResponse, ObsidianBoundaryError> {
        let mut state = self.locked()?;
        let request = state
            .pending
            .remove(&request_id)
            .ok_or(ObsidianBoundaryError::Request)?;
        match request.decode_response(status, body)? {
            AuthResponse::MfaRequired => Ok(ObsidianAccountResponse::MfaRequired),
            AuthResponse::MfaRejected => Ok(ObsidianAccountResponse::MfaRejected),
            AuthResponse::SignedIn(account) => {
                state.vaults.clear();
                Ok(ObsidianAccountResponse::SignedIn {
                    token: account.token().into(),
                    name: account.name.clone(),
                    email: account.email.clone(),
                })
            }
            AuthResponse::UserInfo(metadata) => Ok(ObsidianAccountResponse::UserInfo {
                metadata_json: metadata.to_string(),
            }),
            AuthResponse::Vaults(list) => {
                let mut choices = Vec::new();
                let mut vaults = BTreeMap::new();
                for (vault, shared) in list
                    .vaults
                    .into_iter()
                    .map(|vault| (vault, false))
                    .chain(list.shared.into_iter().map(|vault| (vault, true)))
                {
                    choices.push(project_vault(&vault, shared));
                    if vaults.insert(vault.id.clone(), (vault, shared)).is_some() {
                        return Err(ObsidianBoundaryError::Request);
                    }
                }
                state.vaults = vaults;
                Ok(ObsidianAccountResponse::Vaults { vaults: choices })
            }
            AuthResponse::AccessGranted => Ok(ObsidianAccountResponse::AccessGranted),
            AuthResponse::SignedOut => {
                state.vaults.clear();
                Ok(ObsidianAccountResponse::SignedOut)
            }
        }
    }

    /// Derive a selected vault key on the background runner. Managed vaults
    /// require no user password; E2E vaults require one. Store returned bytes
    /// only after `vault_access` succeeds.
    ///
    /// # Errors
    /// Rejects an unknown vault, absent password, or key derivation failure.
    pub fn prepare_vault(
        &self,
        vault_id: &str,
        password: Option<String>,
    ) -> Result<ObsidianPreparedVault, ObsidianBoundaryError> {
        let state = self.locked()?;
        let (vault, shared) = state
            .vaults
            .get(vault_id)
            .ok_or(ObsidianBoundaryError::Request)?;
        let password = password.map(zeroize::Zeroizing::new);
        let key = vault.derive_key(password.as_ref().map(|password| password.as_str()))?;
        Ok(ObsidianPreparedVault {
            vault: project_vault(vault, *shared),
            key_bytes: key.secure_storage_bytes().to_vec(),
        })
    }

    /// Prepare service key validation before storing the derived profile key.
    ///
    /// # Errors
    /// Rejects unknown vaults or invalid key lengths.
    pub fn vault_access(
        &self,
        token: &str,
        vault_id: &str,
        key_bytes: Vec<u8>,
    ) -> Result<ObsidianHttpRequest, ObsidianBoundaryError> {
        let request = {
            let state = self.locked()?;
            let (vault, _) = state
                .vaults
                .get(vault_id)
                .ok_or(ObsidianBoundaryError::Request)?;
            let key_bytes = zeroize::Zeroizing::new(key_bytes);
            let key = VaultKey::from_bytes(&key_bytes)?;
            let cipher = VaultCipher::new(
                EncryptionVersion::try_from(vault.encryption_version)?,
                &key,
                &vault.salt,
            )?;
            AuthRequest::vault_access(token, vault, &cipher)
        };
        self.request(request, false)
    }
}

fn project_vault(vault: &RemoteVault, shared: bool) -> ObsidianRemoteVault {
    ObsidianRemoteVault {
        id: vault.id.clone(),
        name: vault.name.clone(),
        host: vault.host.clone(),
        region: vault.region.clone(),
        salt: vault.salt.clone(),
        encryption_version: vault.encryption_version,
        managed: vault.is_managed(),
        shared,
    }
}

/// Native projection of ordered protocol work. Native executors handle these
/// after the Rust call returns; payloads/credentials are never diagnostic data.
#[derive(uniffi::Enum)]
pub enum ObsidianSessionEffect {
    /// Open a new secure socket. Ignore callbacks from superseded socket epochs.
    Connect {
        /// Secure official WebSocket URL.
        url: String,
    },
    /// Transient WebSocket JSON, including the login token/key proof.
    SendText {
        /// Transport-only payload.
        text: String,
    },
    /// An encrypted binary piece.
    SendBinary {
        /// Transport-only ciphertext.
        bytes: Vec<u8>,
    },
    /// Close/cancel the current socket.
    Close,
    /// Save atomically, then call `checkpoint_persisted(revision)`.
    PersistCheckpoint {
        /// Local durability barrier revision.
        revision: u64,
        /// Versioned non-secret durable state.
        checkpoint_json: String,
    },
    /// Apply the atomic delta through the runtime, then acknowledge its revision.
    PersistCheckpointDelta {
        /// Exact local barrier revision.
        revision: u64,
        /// Cursor/initial/pending upsert/remove shared JSON envelope.
        delta_json: String,
    },
    /// Durable notice. Retain selected=false metadata without pulling content.
    RemoteChange {
        /// Shared Rust metadata schema, including uid/path/hash.
        metadata_json: String,
    },
    /// Initial stream and its cursor barrier are committed; uploads may start.
    Ready {
        /// Current service cursor.
        cursor: u64,
    },
    /// Authenticated session-owned payload. Apply by handle before completion.
    DownloadedPayload {
        /// Pull revision identifier.
        uid: u64,
        /// Opaque engine/profile/session-epoch handle, never a logical path.
        transfer_id: String,
        /// Exact authenticated plaintext length; no complete file crosses FFI.
        payload_size: u64,
        /// Tombstone, distinct from a zero-byte file.
        deleted: bool,
        /// Integrity hash over original bytes.
        content_hash: Option<String>,
    },
    /// Exact immutable outbox receipt acknowledged remotely.
    Uploaded {
        /// Caller durable mutation identifier.
        operation_id: String,
        /// SHA-256 over the original snapshot.
        content_hash: String,
    },
    /// Typed failure. Retryable cases reconnect on monotonic ticks.
    Failed {
        /// Stable error category.
        code: String,
        /// Sanitized engine message.
        message: String,
        /// Whether automatic reconnection is permitted.
        retryable: bool,
        /// Active immutable receipt, if any.
        operation_id: Option<String>,
    },
    /// Session cancellation did not acknowledge this receipt.
    Cancelled {
        /// Caller durable mutation identifier.
        operation_id: String,
    },
}

/// Serial native session wrapper. The host owns socket epochs, secure storage,
/// monotonic timers and DB transactions, with no callbacks under this lock.
#[derive(uniffi::Object)]
pub struct FfiObsidianSession {
    state: Mutex<NativeSession>,
}

struct NativeSession {
    session: Session,
    binding: Option<RuntimeBinding>,
    download: Option<OwnedDownload>,
    application: Option<String>,
}

impl NativeSession {
    fn cancel(&mut self, now: u64) -> Result<Vec<Effect>, ObsidianBoundaryError> {
        let effects = self.session.handle(Input::Cancel, now)?;
        if let Some(download) = self.download.take() {
            let uid = download.uid;
            drop(download);
            self.session.release_download(uid)?;
        }
        Ok(effects)
    }
}

/// Session bootstrap. Key/token fields are transient secure-storage reads;
/// filter/checkpoint fields use the shared non-secret JSON contracts.
#[derive(uniffi::Record)]
pub struct ObsidianSessionOptions {
    /// Validated official regional hostname.
    pub host: String,
    /// Transient secure-storage account token.
    pub token: String,
    /// Stable remote vault identifier.
    pub vault_id: String,
    /// Device label for service history.
    pub device_name: String,
    /// Exact negotiated cipher version.
    pub encryption_version: u8,
    /// Exact remote HKDF salt.
    pub salt: String,
    /// Transient secure-storage 32-byte key.
    pub key_bytes: Vec<u8>,
    /// Empty only on first setup; otherwise the saved versioned checkpoint.
    pub checkpoint_json: String,
    /// Optional explicit `SyncFilter` JSON; absence enables all categories.
    pub filter_json: Option<String>,
}

impl FfiObsidianSession {
    fn locked(&self) -> Result<MutexGuard<'_, NativeSession>, ObsidianBoundaryError> {
        let state = self.state.lock().map_err(|_| ObsidianBoundaryError::Lock)?;
        if state.application.is_some() {
            return Err(ObsidianBoundaryError::Busy);
        }
        if let Some(binding) = &state.binding {
            binding.engine()?;
        }
        Ok(state)
    }
    fn input(
        &self,
        input: Input,
        now_ms: u64,
    ) -> Result<Vec<ObsidianSessionEffect>, ObsidianBoundaryError> {
        let mut state = self.locked()?;
        let effects = state.session.handle(input, now_ms)?;
        project_effects(&mut state, effects)
    }
}

#[uniffi::export]
impl FfiObsidianSession {
    /// Restore one private-replica session from secure-storage key/token and
    /// durable checkpoint. Empty checkpoint JSON means first setup only.
    ///
    /// # Errors
    /// Rejects invalid configuration, key, version, or restored state.
    #[uniffi::constructor]
    pub fn new(options: ObsidianSessionOptions) -> Result<Arc<Self>, ObsidianBoundaryError> {
        let key_bytes = zeroize::Zeroizing::new(options.key_bytes);
        let token = zeroize::Zeroizing::new(options.token);
        let key = VaultKey::from_bytes(&key_bytes)?;
        let cipher = VaultCipher::new(
            EncryptionVersion::try_from(options.encryption_version)?,
            &key,
            &options.salt,
        )?;
        let checkpoint = if options.checkpoint_json.is_empty() {
            Checkpoint::default()
        } else {
            serde_json::from_str(&options.checkpoint_json)
                .map_err(|_| ObsidianBoundaryError::Request)?
        };
        let mut config = SessionConfig::new(
            &options.host,
            &token,
            &options.vault_id,
            &options.device_name,
        )?;
        if let Some(filter) = options.filter_json {
            config.filter =
                serde_json::from_str(&filter).map_err(|_| ObsidianBoundaryError::Request)?;
        }
        Ok(Arc::new(Self {
            state: Mutex::new(NativeSession {
                session: Session::new(config, cipher, checkpoint)?,
                binding: None,
                download: None,
                application: None,
            }),
        }))
    }

    /// Begin opening the socket and replay committed pending notices.
    ///
    /// # Errors
    /// Rejects an already active session.
    pub fn begin(&self, now_ms: u64) -> Result<Vec<ObsidianSessionEffect>, ObsidianBoundaryError> {
        let mut state = self.locked()?;
        let effects = state.session.begin(now_ms)?;
        project_effects(&mut state, effects)
    }

    /// Report successful socket opening for the current socket epoch.
    ///
    /// # Errors
    /// Rejects an unexpected lifecycle callback.
    pub fn opened(&self, now_ms: u64) -> Result<Vec<ObsidianSessionEffect>, ObsidianBoundaryError> {
        self.input(Input::Opened, now_ms)
    }

    /// Report a complete text frame without persisting/logging it.
    ///
    /// # Errors
    /// Returns a typed lock/lifecycle failure.
    pub fn receive_text(
        &self,
        text: String,
        now_ms: u64,
    ) -> Result<Vec<ObsidianSessionEffect>, ObsidianBoundaryError> {
        self.input(Input::Text(text), now_ms)
    }

    /// Report a complete encrypted binary frame.
    ///
    /// # Errors
    /// Returns a typed lock/lifecycle failure.
    pub fn receive_binary(
        &self,
        bytes: Vec<u8>,
        now_ms: u64,
    ) -> Result<Vec<ObsidianSessionEffect>, ObsidianBoundaryError> {
        self.input(Input::Binary(bytes), now_ms)
    }

    /// Report current-socket loss; queued upload snapshots remain immutable.
    ///
    /// # Errors
    /// Returns a typed lock failure.
    pub fn disconnected(
        &self,
        now_ms: u64,
    ) -> Result<Vec<ObsidianSessionEffect>, ObsidianBoundaryError> {
        self.input(Input::Disconnected, now_ms)
    }

    /// Wake heartbeat, timeout and reconnect work using a monotonic clock.
    ///
    /// # Errors
    /// Returns a typed lock failure.
    pub fn tick(&self, now_ms: u64) -> Result<Vec<ObsidianSessionEffect>, ObsidianBoundaryError> {
        self.input(Input::Tick, now_ms)
    }

    /// Cancel transport work and return all pending receipt identifiers.
    ///
    /// # Errors
    /// Returns a typed lock failure.
    pub fn cancel(&self, now_ms: u64) -> Result<Vec<ObsidianSessionEffect>, ObsidianBoundaryError> {
        let mut state = self.state.lock().map_err(|_| ObsidianBoundaryError::Lock)?;
        let effects = state.cancel(now_ms)?;
        project_effects(&mut state, effects)
    }

    /// Confirm the exact checkpoint snapshot has committed to profile storage.
    ///
    /// # Errors
    /// Rejects unknown/out-of-order barrier revisions.
    pub fn checkpoint_persisted(
        &self,
        revision: u64,
        now_ms: u64,
    ) -> Result<Vec<ObsidianSessionEffect>, ObsidianBoundaryError> {
        self.input(Input::CheckpointPersisted(revision), now_ms)
    }

    /// Mark a remote revision durably applied or parked in the conflict inbox.
    ///
    /// # Errors
    /// Rejects notices not yet delivered behind the durability barrier.
    pub fn complete_remote(
        &self,
        uid: u64,
    ) -> Result<Vec<ObsidianSessionEffect>, ObsidianBoundaryError> {
        let mut state = self.locked()?;
        let metadata = state
            .session
            .checkpoint()
            .pending
            .get(&uid)
            .ok_or(ObsidianBoundaryError::Request)?;
        if metadata.selected
            && !metadata.folder
            && state
                .download
                .as_ref()
                .is_none_or(|download| download.uid != uid || !download.applied)
        {
            return Err(ObsidianBoundaryError::Request);
        }
        let effects = state.session.complete_remote(uid)?;
        if state
            .download
            .as_ref()
            .is_some_and(|download| download.uid == uid)
        {
            drop(state.download.take());
            state.session.release_download(uid)?;
        }
        project_effects(&mut state, effects)
    }

    /// Queue a service revision download once metadata is durably available.
    ///
    /// # Errors
    /// Rejects invalid revision identifiers or queue exhaustion.
    pub fn queue_download(
        &self,
        uid: u64,
        now_ms: u64,
    ) -> Result<Vec<ObsidianSessionEffect>, ObsidianBoundaryError> {
        let mut state = self.locked()?;
        state
            .binding
            .as_ref()
            .ok_or(ObsidianBoundaryError::Request)?
            .engine()?;
        let effects = state.session.queue_download(uid, now_ms)?;
        project_effects(&mut state, effects)
    }

    /// Bind one actual remote vault to its private runtime profile. The session
    /// holds a Weak engine reference, and creates no engine/callback cycle.
    /// Exact same-owner rebind is idempotent; a different owner requires unbind.
    ///
    /// # Errors
    /// Rejects local profiles, closed engines or changed durable vault ownership.
    pub fn bind_runtime(
        &self,
        engine: Arc<FfiFacetEngine>,
        profile_id: String,
    ) -> Result<(), ObsidianBoundaryError> {
        let mut state = self.locked()?;
        if let Some(binding) = &state.binding {
            if binding.profile == profile_id && Arc::ptr_eq(&binding.engine()?, &engine) {
                return Ok(());
            }
            return Err(ObsidianBoundaryError::Request);
        }
        engine
            .runtime()
            .bind_sync_profile(&profile_id, state.session.vault_id())
            .map_err(runtime_error)?;
        let epoch = engine
            .runtime()
            .session_namespace()
            .map_err(runtime_error)?;
        let vault = state.session.vault_id().to_owned();
        let binding_epoch = engine
            .runtime()
            .sync_binding_identity(&profile_id, &vault)
            .map_err(runtime_error)?;
        state.binding = Some(RuntimeBinding {
            engine: Arc::downgrade(&engine),
            profile: profile_id,
            epoch,
            vault,
            binding_epoch,
        });
        drop(engine);
        Ok(())
    }

    /// Stop socket work, drop transient completions and invalidate this binding.
    /// Durable incoming images, outbox and pending notices remain for replay.
    ///
    /// # Errors
    /// Returns a poisoned serialization lock or protocol state failure.
    pub fn unbind_runtime(
        &self,
        now_ms: u64,
    ) -> Result<Vec<ObsidianSessionEffect>, ObsidianBoundaryError> {
        let mut state = self.state.lock().map_err(|_| ObsidianBoundaryError::Lock)?;
        let effects = state.cancel(now_ms)?;
        state.binding = None;
        project_effects(&mut state, effects)
    }

    /// Queue the exact durable outbox head with its original clocks and bytes.
    /// Admission precedes the single Rust encrypted-frame allocation.
    ///
    /// # Errors
    /// Rejects wrong/closed owners, changed receipts, nonce or memory admission.
    pub fn queue_durable_upload(
        &self,
        operation_id: &str,
        nonce: Vec<u8>,
        now_ms: u64,
    ) -> Result<Vec<ObsidianSessionEffect>, ObsidianBoundaryError> {
        let nonce: [u8; 12] = nonce
            .try_into()
            .map_err(|_| ObsidianBoundaryError::Request)?;
        let mut state = self.locked()?;
        let binding = state
            .binding
            .as_ref()
            .ok_or(ObsidianBoundaryError::Request)?;
        let engine = binding.engine()?;
        let profile = binding.profile.clone();
        let binding_epoch = binding.binding_epoch.clone();
        let effects = engine
            .runtime()
            .queue_durable_upload_fenced(
                &profile,
                &binding_epoch,
                &mut state.session,
                (operation_id, nonce, now_ms),
            )
            .map_err(|error| match error {
                tasknotes_runtime::engine::UploadPreparationError::Runtime(error) => {
                    runtime_error(error)
                }
                tasknotes_runtime::engine::UploadPreparationError::Sync(error) => error.into(),
            })?;
        project_effects(&mut state, effects)
    }

    /// Apply one authenticated opaque download using its original pending
    /// metadata. Exact retry reuses staged bytes and the durable remote journal.
    /// `complete_remote` remains separate and fails before this succeeds.
    ///
    /// # Errors
    /// Rejects stale/wrong-epoch handles, changed owners or application failure.
    pub fn apply_download(&self, transfer_id: &str) -> Result<(), ObsidianBoundaryError> {
        let mut state = self.locked()?;
        let NativeSession {
            session,
            binding,
            download,
            ..
        } = &mut *state;
        let binding = binding.as_ref().ok_or(ObsidianBoundaryError::Request)?;
        let download = download.as_mut().ok_or(ObsidianBoundaryError::Request)?;
        if download.id != transfer_id {
            return Err(ObsidianBoundaryError::Request);
        }
        if download.applied {
            return Ok(());
        }
        download.prepare(binding, session)?;
        let prepared = download
            .prepared
            .as_ref()
            .ok_or(ObsidianBoundaryError::Request)?
            .clone();
        let engine = binding.engine()?;
        let profile = binding.profile.clone();
        let epoch = binding.epoch.clone();
        state.application = Some(transfer_id.to_owned());
        drop(state);
        // Host staged file callbacks run outside both the session and DB locks.
        let result = engine
            .runtime()
            .apply_authenticated_download(&profile, &prepared)
            .map_err(runtime_error);
        let mut state = self.state.lock().map_err(|_| ObsidianBoundaryError::Lock)?;
        state.application = None;
        if state
            .binding
            .as_ref()
            .is_none_or(|binding| binding.epoch != epoch)
        {
            return Err(ObsidianBoundaryError::Request);
        }
        result?;
        state
            .binding
            .as_ref()
            .ok_or(ObsidianBoundaryError::Request)?
            .engine()?;
        let download = state
            .download
            .as_mut()
            .ok_or(ObsidianBoundaryError::Request)?;
        if download.id != transfer_id {
            return Err(ObsidianBoundaryError::Request);
        }
        download.applied = true;
        Ok(())
    }

    /// Non-secret crash-recovery envelope, for explicit lifecycle persistence.
    ///
    /// # Errors
    /// Returns a typed lock/serialization error.
    pub fn checkpoint_json(&self) -> Result<String, ObsidianBoundaryError> {
        serde_json::to_string(self.locked()?.session.checkpoint())
            .map_err(|_| ObsidianBoundaryError::Request)
    }
}

fn project_effects(
    state: &mut NativeSession,
    effects: Vec<Effect>,
) -> Result<Vec<ObsidianSessionEffect>, ObsidianBoundaryError> {
    effects
        .into_iter()
        .map(|effect| {
            Ok(match effect {
                Effect::Connect { url } => ObsidianSessionEffect::Connect { url },
                Effect::SendText(frame) => ObsidianSessionEffect::SendText {
                    text: frame.as_str().into(),
                },
                Effect::SendBinary(frame) => ObsidianSessionEffect::SendBinary {
                    bytes: frame.bytes().into(),
                },
                Effect::Close => ObsidianSessionEffect::Close,
                Effect::PersistCheckpoint {
                    revision,
                    checkpoint,
                } => ObsidianSessionEffect::PersistCheckpoint {
                    revision,
                    checkpoint_json: serde_json::to_string(&checkpoint)
                        .map_err(|_| ObsidianBoundaryError::Request)?,
                },
                Effect::PersistCheckpointDelta { revision, delta } => {
                    ObsidianSessionEffect::PersistCheckpointDelta {
                        revision,
                        delta_json: serde_json::to_string(&delta)
                            .map_err(|_| ObsidianBoundaryError::Request)?,
                    }
                }
                Effect::RemoteChange(metadata) => ObsidianSessionEffect::RemoteChange {
                    metadata_json: serde_json::to_string(&metadata)
                        .map_err(|_| ObsidianBoundaryError::Request)?,
                },
                Effect::Ready { cursor } => ObsidianSessionEffect::Ready { cursor },
                Effect::Downloaded(download) => {
                    let authorization = (|| {
                        let binding = state
                            .binding
                            .as_ref()
                            .ok_or(ObsidianBoundaryError::Request)?;
                        binding.engine()?;
                        if state.download.is_some() {
                            return Err(ObsidianBoundaryError::Request);
                        }
                        Ok(binding)
                    })();
                    let binding = match authorization {
                        Ok(binding) => binding,
                        Err(error) => {
                            let uid = download.uid;
                            drop(download);
                            // Owner expiry cannot strand a full-frame reservation.
                            // The durable pending notice remains for a fresh bound
                            // session to retry; no completion ACK is synthesized.
                            state.session.release_download(uid)?;
                            return Err(error);
                        }
                    };
                    let id = format!("download:{}:{}", binding.epoch, download.uid);
                    let effect = ObsidianSessionEffect::DownloadedPayload {
                        uid: download.uid,
                        transfer_id: id.clone(),
                        payload_size: u64::try_from(download.bytes.as_ref().map_or(0, Vec::len))
                            .map_err(|_| ObsidianBoundaryError::Request)?,
                        deleted: download.bytes.is_none(),
                        content_hash: download.content_hash.clone(),
                    };
                    state.download = Some(OwnedDownload {
                        id,
                        uid: download.uid,
                        frame: Some(download),
                        prepared: None,
                        applied: false,
                    });
                    effect
                }
                Effect::Uploaded {
                    operation_id,
                    content_hash,
                } => ObsidianSessionEffect::Uploaded {
                    operation_id,
                    content_hash,
                },
                Effect::Failed {
                    error,
                    retryable,
                    operation_id,
                } => {
                    let projected = ObsidianBoundaryError::from(error);
                    let ObsidianBoundaryError::Boundary { code, detail } = projected else {
                        return Err(ObsidianBoundaryError::Request);
                    };
                    ObsidianSessionEffect::Failed {
                        code,
                        message: detail,
                        retryable,
                        operation_id,
                    }
                }
                Effect::Cancelled { operation_id } => {
                    ObsidianSessionEffect::Cancelled { operation_id }
                }
            })
        })
        .collect()
}

#[cfg(test)]
#[path = "obsidian_owned_tests.rs"]
mod owned_tests;

#[cfg(test)]
mod tests {
    use super::{
        FfiObsidianAccount, FfiObsidianSession, ObsidianAccountResponse, ObsidianSessionEffect,
        ObsidianSessionOptions,
    };
    use serde_json::json;
    use std::error::Error;

    type TestResult = Result<(), Box<dyn Error>>;

    #[test]
    fn native_http_ids_cancel_and_account_switch_invalidates_old_responses() -> TestResult {
        let account = FfiObsidianAccount::new();
        let stale = account.list_vaults("public-old-token")?;
        let signin = account.sign_in("synthetic@example.test", "public-password", "")?;
        assert!(
            account
                .response(stale.request_id, 200, r#"{"vaults":[],"shared":[]}"#)
                .is_err()
        );
        assert!(matches!(
            account.response(
                signin.request_id,
                200,
                r#"{"error":"Please enter 2FA code"}"#
            )?,
            ObsidianAccountResponse::MfaRequired
        ));
        for _ in 0..40 {
            let request = account.list_vaults("public-token")?;
            account.cancel_request(request.request_id)?;
        }
        let late = account.list_vaults("public-token")?;
        let logout = account.sign_out("public-token")?;
        assert!(
            account
                .response(late.request_id, 200, r#"{"vaults":[],"shared":[]}"#)
                .is_err()
        );
        account.cancel_request(logout.request_id)?;
        assert!(account.prepare_vault("old-vault", None).is_err());
        Ok(())
    }

    #[test]
    fn managed_password_stays_opaque_and_key_proof_uses_the_prepared_secret() -> TestResult {
        let account = FfiObsidianAccount::new();
        let request = account.list_vaults("public-token")?;
        let body=json!({"vaults":[],"shared":[{"id":"synthetic-vault","name":"Shared","host":"sync-test.obsidian.md","region":"test","salt":"public-salt","encryption_version":3,"password":"public-managed-password"}]}).to_string();
        match account.response(request.request_id, 200, &body)? {
            ObsidianAccountResponse::Vaults { vaults } => {
                let vault = vaults.first().ok_or("No vault")?;
                assert!(vault.shared && vault.managed);
            }
            _ => return Err("Wrong vault response".into()),
        }
        let prepared = account.prepare_vault("synthetic-vault", None)?;
        assert_eq!(prepared.key_bytes.len(), 32);
        let access = account.vault_access("public-token", "synthetic-vault", prepared.key_bytes)?;
        let body: serde_json::Value = serde_json::from_str(&access.body)?;
        assert_eq!(body.get("vault_uid"), Some(&json!("synthetic-vault")));
        assert!(
            body.get("keyhash")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|proof| proof.len() == 64)
        );
        assert!(matches!(
            account.response(access.request_id, 200, "{}")?,
            ObsidianAccountResponse::AccessGranted
        ));
        Ok(())
    }

    #[test]
    fn native_session_preserves_effects_and_durability_ack_contract() -> TestResult {
        let session = FfiObsidianSession::new(ObsidianSessionOptions {
            host: "sync-test.obsidian.md".into(),
            token: "public-token".into(),
            vault_id: "synthetic-vault".into(),
            device_name: "Synthetic Device".into(),
            encryption_version: 3,
            salt: "public-salt".into(),
            key_bytes: vec![0; 32],
            checkpoint_json: String::new(),
            filter_json: None,
        })?;
        assert!(
            session
                .begin(0)?
                .iter()
                .any(|effect| matches!(effect, ObsidianSessionEffect::Connect { .. }))
        );
        let login = session.opened(1)?;
        assert!(login.iter().any(|effect|matches!(effect,ObsidianSessionEffect::SendText {text} if text.contains("public-token"))));
        session.receive_text(r#"{"res":"ok"}"#.into(), 2)?;
        let ready = session.receive_text(r#"{"op":"ready","version":0}"#.into(), 3)?;
        let revision = ready
            .iter()
            .find_map(|effect| match effect {
                ObsidianSessionEffect::PersistCheckpointDelta { revision, .. } => Some(*revision),
                _ => None,
            })
            .ok_or("No delta barrier")?;
        assert!(
            !ready
                .iter()
                .any(|effect| matches!(effect, ObsidianSessionEffect::Ready { .. }))
        );
        assert!(
            session
                .checkpoint_persisted(revision, 4)?
                .iter()
                .any(|effect| matches!(effect, ObsidianSessionEffect::Ready { .. }))
        );
        assert!(
            matches!(
                session.queue_durable_upload("synthetic-receipt", vec![0; 12], 5),
                Err(super::ObsidianBoundaryError::Request)
            ),
            "An unbound FFI session cannot accept foreign full-file snapshots"
        );
        assert!(!session.checkpoint_json()?.contains("public-token"));
        Ok(())
    }
}
