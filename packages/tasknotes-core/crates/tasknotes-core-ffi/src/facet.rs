//! Thin standalone engine projection; algorithms and persistence live in runtime.

use std::sync::Arc;

use serde_json::Value;
use tasknotes_runtime::{
    RuntimeError,
    engine::Engine,
    types::{
        DisplacedMetadata, FileSnapshot, Mutation, Profile, Query, ReplacementStage,
        StagedExchange, VaultFiles,
    },
};

/// Expected filesystem capability failure, without note contents or secrets.
#[derive(Debug, Clone, thiserror::Error, uniffi::Error)]
pub enum FacetHostError {
    /// A provider or persisted capability is temporarily unavailable.
    #[error("{detail}")]
    Unavailable {
        /// Safe recovery diagnostic.
        detail: String,
    },
    /// User must restore folder permission.
    #[error("{detail}")]
    PermissionDenied {
        /// Safe recovery diagnostic.
        detail: String,
    },
    /// Durable filesystem operation failed.
    #[error("{detail}")]
    Io {
        /// Safe recovery diagnostic.
        detail: String,
    },
    /// Permanent owned-callback violation; no provider outage retry or fallback.
    #[error("{detail}")]
    Contract {
        /// Content-free invariant code or fixed diagnostic.
        detail: String,
    },
}

/// Standalone engine failures, independent of the retired server API.
#[derive(Debug, thiserror::Error, uniffi::Error, serde::Serialize)]
#[serde(tag = "kind", deny_unknown_fields)]
pub enum FacetEngineError {
    /// Private state cannot be read/written.
    #[error("{detail}")]
    Storage {
        /// Safe diagnostic.
        detail: String,
    },
    /// Platform provider/capability failure.
    #[error("{detail}")]
    Host {
        /// Safe diagnostic.
        detail: String,
    },
    /// Permanent provider metadata/ownership/range contract failure.
    #[error("{detail}")]
    HostContract {
        /// Content-free invariant diagnostic.
        detail: String,
    },
    /// Requested semantic operation is invalid.
    #[error("{detail}")]
    Validation {
        /// Safe diagnostic.
        detail: String,
    },
    /// Selected configuration cannot be used.
    #[error("{detail}")]
    Configuration {
        /// Safe diagnostic.
        detail: String,
    },
    /// Reload or resolve a preserved overlap before saving.
    #[error("The file changed; reload or resolve its conflict before saving")]
    Conflict,
    /// Profile, file, or conflict no longer exists.
    #[error("Requested profile or file was not found")]
    NotFound,
    /// Explicitly retired engine handle.
    #[error("The engine is closed")]
    Closed,
    /// Nonblocking admission or callback reentry; preserve the exact draft.
    #[error("The operation is busy; retry after current work completes")]
    Busy,
}

impl<'de> serde::Deserialize<'de> for FacetEngineError {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Wire {
            kind: String,
            #[serde(default, deserialize_with = "error_detail")]
            detail: Option<String>,
        }
        let wire = <Wire as serde::Deserialize>::deserialize(deserializer)?;
        match (wire.kind.as_str(), wire.detail) {
            ("Storage", Some(detail)) => Ok(Self::Storage { detail }),
            ("Host", Some(detail)) => Ok(Self::Host { detail }),
            ("HostContract", Some(detail)) => Ok(Self::HostContract { detail }),
            ("Validation", Some(detail)) => Ok(Self::Validation { detail }),
            ("Configuration", Some(detail)) => Ok(Self::Configuration { detail }),
            ("Conflict", None) => Ok(Self::Conflict),
            ("NotFound", None) => Ok(Self::NotFound),
            ("Closed", None) => Ok(Self::Closed),
            ("Busy", None) => Ok(Self::Busy),
            _ => Err(serde::de::Error::custom("invalid engine error projection")),
        }
    }
}

fn error_detail<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<String>, D::Error> {
    <String as serde::Deserialize>::deserialize(deserializer).map(Some)
}

impl From<RuntimeError> for FacetEngineError {
    fn from(error: RuntimeError) -> Self {
        match error {
            RuntimeError::Storage(detail) => Self::Storage { detail },
            RuntimeError::Host(detail) => Self::Host { detail },
            RuntimeError::HostContract(detail) => Self::HostContract { detail },
            RuntimeError::Validation(detail) => Self::Validation { detail },
            RuntimeError::Configuration(detail) => Self::Configuration { detail },
            RuntimeError::Conflict => Self::Conflict,
            RuntimeError::NotFound => Self::NotFound,
            RuntimeError::Closed => Self::Closed,
            RuntimeError::Busy => Self::Busy,
        }
    }
}

/// Profile/lifetime-owned immutable read image; bytes use bounded chunks.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FacetFileSnapshot {
    /// Opaque owner-checked image identity, never a path.
    pub id: String,
    /// Exact immutable byte count.
    pub size: u64,
    /// Lowercase SHA256 of the complete image.
    pub revision: String,
}

/// Durable immutable replacement intent and committed byte prefix.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FacetReplacementStage {
    /// Opaque durable host stage identity.
    pub id: String,
    /// Exact original facet-write operation identity.
    pub operation_id: String,
    /// Logical vault-relative destination.
    pub path: String,
    /// Exact declared replacement byte count.
    pub size: u64,
    /// Exact lowercase SHA256 target digest.
    pub revision: String,
    /// Durably committed contiguous prefix length.
    pub written: u64,
    /// Source is verified, immutable and ready for exchange.
    pub sealed: bool,
}

/// Original recorded atomic outcome with metadata-only retained predecessor.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FacetStagedExchange {
    /// Whether replacement/deletion actually occurred.
    pub applied: bool,
    /// Exact durable captured predecessor, including competing writer effects.
    pub displaced: Option<FacetDisplacedMetadata>,
}

/// Durable captured provider version surviving process termination.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FacetDisplacedMetadata {
    /// Stable host backup identity.
    pub id: String,
    /// Logical vault-relative source.
    pub path: String,
    /// Exact retained byte count.
    pub size: u64,
    /// Immutable SHA256 payload revision.
    pub revision: String,
}

/// Platform folder/replica capabilities; callbacks run outside SQLite locks.
#[uniffi::export(with_foreign)]
pub trait FacetVaultFiles: Send + Sync {
    /// Return logical paths, excluding private host backup/application directories.
    ///
    /// # Errors
    /// Returns capability, permission, or provider failures.
    fn list_files(&self, profile_id: String) -> Result<Vec<String>, FacetHostError>;
    /// Capture an immutable read image, or return absence for a missing regular file.
    ///
    /// # Errors
    /// Returns capability, permission, or provider failures.
    fn open_file_snapshot(
        &self,
        profile_id: String,
        path: String,
    ) -> Result<Option<FacetFileSnapshot>, FacetHostError>;
    /// Open one exact retained predecessor without loading its bytes.
    ///
    /// # Errors
    /// Returns wrong-owner, missing, changed or inaccessible backup failures.
    fn open_displaced_snapshot(
        &self,
        profile_id: String,
        backup_id: String,
    ) -> Result<FacetFileSnapshot, FacetHostError>;
    /// Read one exact immutable range of at most one MiB.
    ///
    /// # Errors
    /// Returns wrong-owner, stale handle, invalid range or provider failures.
    fn read_snapshot_chunk(
        &self,
        profile_id: String,
        snapshot_id: String,
        offset: u64,
        length: u32,
    ) -> Result<Vec<u8>, FacetHostError>;
    /// Release only a temporary image; never acknowledge a durable predecessor.
    ///
    /// # Errors
    /// Returns unknown/wrong-owner handles or durable cleanup failures.
    fn close_snapshot(&self, profile_id: String, snapshot_id: String)
    -> Result<(), FacetHostError>;
    /// Persist or resume an exact staged intent, retaining its contiguous prefix.
    ///
    /// # Errors
    /// Returns changed intent, unsupported durability or provider failures.
    fn begin_replacement(
        &self,
        profile_id: String,
        operation_id: String,
        path: String,
        expected_revision: Option<String>,
        size: u64,
        revision: String,
    ) -> Result<FacetReplacementStage, FacetHostError>;
    /// Commit at most one MiB or verify an exact already-committed prefix retry.
    ///
    /// # Errors
    /// Returns changed/gapped/overlapping chunks or durable provider failures.
    fn write_replacement_chunk(
        &self,
        profile_id: String,
        stage_id: String,
        offset: u64,
        bytes: Vec<u8>,
    ) -> Result<FacetReplacementStage, FacetHostError>;
    /// Verify the exact declared size/hash and retain an immutable sealed source.
    ///
    /// # Errors
    /// Returns incomplete/corrupt/unknown stages or durable provider failures.
    fn seal_replacement(
        &self,
        profile_id: String,
        stage_id: String,
    ) -> Result<FacetReplacementStage, FacetHostError>;
    /// Exchange a sealed stage/tombstone or replay its original durable outcome.
    ///
    /// # Errors
    /// Returns unsupported atomic capabilities or durable I/O failures.
    fn compare_exchange_staged(
        &self,
        profile_id: String,
        operation_id: String,
        path: String,
        expected_revision: Option<String>,
        stage_id: Option<String>,
    ) -> Result<FacetStagedExchange, FacetHostError>;
    /// Retire source/slot bytes after durable disposition, retaining exact receipts.
    ///
    /// # Errors
    /// Returns unknown/wrong-owner stages or unresolved predecessor/durability failures.
    fn discard_replacement(
        &self,
        profile_id: String,
        stage_id: String,
    ) -> Result<(), FacetHostError>;
    /// Recover unacknowledged captured versions after process relaunch.
    ///
    /// # Errors
    /// Returns unavailable/corrupt backup storage failures.
    fn displaced_metadata(
        &self,
        profile_id: String,
        after_id: Option<String>,
        limit: u32,
    ) -> Result<Vec<FacetDisplacedMetadata>, FacetHostError>;
    /// Remove a backup only after Rust has retained/committed it durably.
    ///
    /// # Errors
    /// Returns backup permission, identity, or durable I/O failures.
    fn acknowledge_displaced(&self, profile_id: String, id: String) -> Result<(), FacetHostError>;
}

struct Files(Arc<dyn FacetVaultFiles>);

impl From<FacetFileSnapshot> for FileSnapshot {
    fn from(snapshot: FacetFileSnapshot) -> Self {
        Self {
            id: snapshot.id,
            size: snapshot.size,
            revision: snapshot.revision,
        }
    }
}
impl From<FacetReplacementStage> for ReplacementStage {
    fn from(stage: FacetReplacementStage) -> Self {
        Self {
            id: stage.id,
            operation_id: stage.operation_id,
            path: stage.path,
            size: stage.size,
            revision: stage.revision,
            written: stage.written,
            sealed: stage.sealed,
        }
    }
}
impl From<FacetDisplacedMetadata> for DisplacedMetadata {
    fn from(metadata: FacetDisplacedMetadata) -> Self {
        Self {
            id: metadata.id,
            path: metadata.path,
            size: metadata.size,
            revision: metadata.revision,
        }
    }
}
impl VaultFiles for Files {
    fn list_files(&self, id: &str) -> tasknotes_runtime::Result<Vec<String>> {
        self.0.list_files(id.to_owned()).map_err(host_error)
    }
    fn open_file_snapshot(
        &self,
        id: &str,
        path: &str,
    ) -> tasknotes_runtime::Result<Option<FileSnapshot>> {
        self.0
            .open_file_snapshot(id.to_owned(), path.to_owned())
            .map(|snapshot| snapshot.map(Into::into))
            .map_err(host_error)
    }
    fn open_displaced_snapshot(
        &self,
        id: &str,
        backup_id: &str,
    ) -> tasknotes_runtime::Result<FileSnapshot> {
        self.0
            .open_displaced_snapshot(id.to_owned(), backup_id.to_owned())
            .map(Into::into)
            .map_err(host_error)
    }
    fn read_snapshot_chunk(
        &self,
        id: &str,
        snapshot_id: &str,
        offset: u64,
        length: u32,
    ) -> tasknotes_runtime::Result<Vec<u8>> {
        self.0
            .read_snapshot_chunk(id.to_owned(), snapshot_id.to_owned(), offset, length)
            .map_err(host_error)
    }
    fn close_snapshot(&self, id: &str, snapshot_id: &str) -> tasknotes_runtime::Result<()> {
        self.0
            .close_snapshot(id.to_owned(), snapshot_id.to_owned())
            .map_err(host_error)
    }
    fn begin_replacement(
        &self,
        id: &str,
        operation_id: &str,
        path: &str,
        expected: Option<&str>,
        size: u64,
        revision: &str,
    ) -> tasknotes_runtime::Result<ReplacementStage> {
        self.0
            .begin_replacement(
                id.to_owned(),
                operation_id.to_owned(),
                path.to_owned(),
                expected.map(str::to_owned),
                size,
                revision.to_owned(),
            )
            .map(Into::into)
            .map_err(host_error)
    }
    fn write_replacement_chunk(
        &self,
        id: &str,
        stage_id: &str,
        offset: u64,
        bytes: &[u8],
    ) -> tasknotes_runtime::Result<ReplacementStage> {
        self.0
            .write_replacement_chunk(id.to_owned(), stage_id.to_owned(), offset, bytes.to_vec())
            .map(Into::into)
            .map_err(host_error)
    }
    fn seal_replacement(
        &self,
        id: &str,
        stage_id: &str,
    ) -> tasknotes_runtime::Result<ReplacementStage> {
        self.0
            .seal_replacement(id.to_owned(), stage_id.to_owned())
            .map(Into::into)
            .map_err(host_error)
    }
    fn compare_exchange_staged(
        &self,
        id: &str,
        operation_id: &str,
        path: &str,
        expected: Option<&str>,
        stage_id: Option<&str>,
    ) -> tasknotes_runtime::Result<StagedExchange> {
        let exchange = self
            .0
            .compare_exchange_staged(
                id.to_owned(),
                operation_id.to_owned(),
                path.to_owned(),
                expected.map(str::to_owned),
                stage_id.map(str::to_owned),
            )
            .map_err(host_error)?;
        Ok(StagedExchange {
            applied: exchange.applied,
            displaced: exchange.displaced.map(Into::into),
        })
    }
    fn discard_replacement(&self, id: &str, stage_id: &str) -> tasknotes_runtime::Result<()> {
        self.0
            .discard_replacement(id.to_owned(), stage_id.to_owned())
            .map_err(host_error)
    }
    fn displaced_metadata(
        &self,
        id: &str,
        after_id: Option<&str>,
        limit: u32,
    ) -> tasknotes_runtime::Result<Vec<DisplacedMetadata>> {
        Ok(self
            .0
            .displaced_metadata(id.to_owned(), after_id.map(str::to_owned), limit)
            .map_err(host_error)?
            .into_iter()
            .map(|version| DisplacedMetadata {
                id: version.id,
                path: version.path,
                size: version.size,
                revision: version.revision,
            })
            .collect())
    }
    fn acknowledge_displaced(&self, id: &str, backup_id: &str) -> tasknotes_runtime::Result<()> {
        self.0
            .acknowledge_displaced(id.to_owned(), backup_id.to_owned())
            .map_err(host_error)
    }
}
fn host_error(error: FacetHostError) -> RuntimeError {
    match error {
        FacetHostError::Contract { detail } => RuntimeError::HostContract(detail),
        FacetHostError::Unavailable { detail }
        | FacetHostError::PermissionDenied { detail }
        | FacetHostError::Io { detail } => RuntimeError::Host(detail),
    }
}

/// Rust-owned durable standalone engine. Hosts call it on their serial worker.
#[derive(uniffi::Object)]
pub struct FfiFacetEngine {
    inner: Engine,
}

impl FfiFacetEngine {
    pub(crate) fn runtime(&self) -> &Engine {
        &self.inner
    }

    #[cfg(test)]
    pub(crate) fn from_runtime(inner: Engine) -> Arc<Self> {
        Arc::new(Self { inner })
    }
}

#[uniffi::export]
impl FfiFacetEngine {
    /// Return the nonsecret durable SQLite owner namespace before opening capabilities.
    ///
    /// # Errors
    /// Returns Closed after engine shutdown begins.
    pub fn identity(&self) -> Result<String, FacetEngineError> {
        Ok(self.runtime().identity()?.to_owned())
    }

    /// Reject new operations and wait for active callbacks before retiring this engine.
    /// Durable journals and staged recovery receipts remain for the next engine.
    ///
    /// # Errors
    /// Returns coordinator/storage failures; shutdown never discards pending state.
    pub fn close_runtime(&self) -> Result<(), FacetEngineError> {
        self.runtime().close().map_err(Into::into)
    }
    /// Open/create the app-private SQLite database.
    ///
    /// # Errors
    /// Returns storage failures; vault capabilities are checked when opened.
    #[uniffi::constructor]
    pub fn new(
        database_path: &str,
        files: Arc<dyn FacetVaultFiles>,
    ) -> Result<Arc<Self>, FacetEngineError> {
        Ok(Arc::new(Self {
            inner: Engine::open(database_path, Arc::new(Files(files)))?,
        }))
    }

    /// Register a versioned profile JSON document.
    ///
    /// # Errors
    /// Rejects malformed identities, unsupported schemas, or category changes.
    pub fn register_profile(&self, profile_json: &str) -> Result<String, FacetEngineError> {
        encode(
            &self
                .inner
                .register_profile(decode::<Profile>(profile_json)?)?,
        )
    }

    /// Return registered profiles as JSON.
    ///
    /// # Errors
    /// Returns storage/corrupt-state failures.
    pub fn profiles_json(&self) -> Result<String, FacetEngineError> {
        encode(&serde_json::json!({"profiles":self.inner.profiles()?}))
    }

    /// Remove an empty profile without deleting user-owned vault files.
    ///
    /// # Errors
    /// Rejects pending work or unresolved conflicts.
    pub fn remove_profile(&self, profile_id: &str) -> Result<(), FacetEngineError> {
        self.inner.remove_profile(profile_id).map_err(Into::into)
    }

    /// Recover interrupted writes and index provider changes.
    ///
    /// # Errors
    /// Returns provider, configuration, or durable-state failures.
    pub fn refresh(&self, profile_id: &str) -> Result<String, FacetEngineError> {
        encode(&self.inner.refresh(profile_id)?)
    }

    /// Return a paged durable snapshot with shared filter/sort/group semantics.
    ///
    /// # Errors
    /// Rejects invalid query/schema values or unavailable index state.
    pub fn snapshot_json(
        &self,
        profile_id: &str,
        query_json: &str,
    ) -> Result<String, FacetEngineError> {
        encode(
            &self
                .inner
                .snapshot(profile_id, &decode::<Query>(query_json)?)?,
        )
    }

    /// Read shared capture, timing and configuration projections.
    ///
    /// # Errors
    /// Returns validation, configuration, capability and storage failures.
    pub fn features_json(
        &self,
        profile_id: &str,
        request_json: &str,
    ) -> Result<String, FacetEngineError> {
        Ok(self.inner.features_json(profile_id, request_json)?)
    }

    /// Execute an idempotent command and return its durable receipt.
    ///
    /// # Errors
    /// Returns validation, conflict, capability, or storage failures.
    pub fn execute(
        &self,
        profile_id: &str,
        command_json: &str,
    ) -> Result<String, FacetEngineError> {
        encode(
            &self
                .inner
                .execute(profile_id, &decode::<Mutation>(command_json)?)?,
        )
    }

    /// Execute an immutable command using a sealed owner-scoped payload handle.
    ///
    /// # Errors
    /// Rejects missing/misplaced payloads, reused identities and stale revisions.
    pub fn execute_payload_id_json(
        &self,
        profile_id: &str,
        mutation_json: &str,
        payload: Option<Arc<crate::facet_payload::FfiFacetPayload>>,
    ) -> Result<String, FacetEngineError> {
        let mutation = decode::<Mutation>(mutation_json)?;
        let receipt = match payload {
            Some(payload) => payload.execute(self, profile_id, &mutation)?,
            None => self
                .inner
                .execute_with_payload_id(profile_id, &mutation, None)?,
        };
        encode(&receipt)
    }

    /// Return conflict versions stored outside TaskNotes indexing.
    ///
    /// # Errors
    /// Returns profile/storage failures.
    pub fn conflicts_json(&self, profile_id: &str) -> Result<String, FacetEngineError> {
        self.conflicts_page_json(profile_id, None, 128)
    }

    /// Read bounded conflict metadata without binary JSON expansion.
    ///
    /// # Errors
    /// Returns invalid page, profile, and storage failures.
    #[expect(
        clippy::needless_pass_by_value,
        reason = "UniFFI owns nullable strings; borrowed nullable string ABI is unsupported"
    )]
    pub fn conflicts_page_json(
        &self,
        profile_id: &str,
        after_id: Option<String>,
        limit: u32,
    ) -> Result<String, FacetEngineError> {
        let conflicts = self
            .inner
            .conflict_metadata(profile_id, after_id.as_deref(), limit)?;
        let next_cursor = if conflicts.len()
            == usize::try_from(limit).map_err(|_| FacetEngineError::Validation {
                detail: "invalid conflict page limit".to_owned(),
            })? {
            conflicts
                .last()
                .and_then(|value| value.get("id"))
                .and_then(Value::as_str)
        } else {
            None
        };
        encode(&serde_json::json!({"conflicts":conflicts,"nextCursor":next_cursor}))
    }

    /// Return immutable upload receipts, omitting paths with conflicts.
    ///
    /// # Errors
    /// Returns profile/storage failures.
    pub fn pending_uploads_json(&self, profile_id: &str) -> Result<String, FacetEngineError> {
        encode(&serde_json::json!({"uploads":self.inner.pending_upload_metadata(profile_id)?}))
    }

    /// Commit an exact service acknowledgement without replacing newer edits.
    ///
    /// # Errors
    /// Rejects unknown receipts and storage failures.
    pub fn acknowledge_upload(
        &self,
        profile_id: &str,
        mutation_id: &str,
        revision: &str,
    ) -> Result<(), FacetEngineError> {
        self.inner
            .acknowledge_upload(profile_id, mutation_id, revision)
            .map_err(Into::into)
    }

    /// Read the last durable protocol cursor document.
    ///
    /// # Errors
    /// Returns profile/storage failures.
    pub fn load_checkpoint(&self, profile_id: &str) -> Result<Option<String>, FacetEngineError> {
        self.inner.load_checkpoint(profile_id).map_err(Into::into)
    }

    /// Persist a full protocol cursor before acknowledging its barrier.
    ///
    /// # Errors
    /// Rejects invalid JSON and storage failures.
    pub fn save_checkpoint(
        &self,
        profile_id: &str,
        checkpoint_json: &str,
    ) -> Result<(), FacetEngineError> {
        self.inner
            .save_checkpoint(profile_id, checkpoint_json)
            .map_err(Into::into)
    }

    /// Persist a normalized protocol delta before acknowledging its barrier.
    ///
    /// # Errors
    /// Rejects invalid/cursor-regressing deltas and storage failures.
    pub fn apply_sync_checkpoint_delta(
        &self,
        profile_id: &str,
        delta_json: &str,
    ) -> Result<(), FacetEngineError> {
        self.inner
            .apply_checkpoint_delta(profile_id, delta_json)
            .map_err(Into::into)
    }
}

fn decode<T: serde::de::DeserializeOwned>(json: &str) -> Result<T, FacetEngineError> {
    let mut value: Value =
        serde_json::from_str(json).map_err(|_| FacetEngineError::Validation {
            detail: "JSON violates its schema".to_owned(),
        })?;
    if let Some(object) = value.as_object_mut()
        && object.remove("schemaVersion").is_some_and(|version| {
            !tasknotes_vault::json_boundary::unsigned(&version).is_ok_and(|v| v == 1)
        })
    {
        return Err(FacetEngineError::Validation {
            detail: "unsupported engine schema version".to_owned(),
        });
    }
    if let Some(object) = value.as_object_mut() {
        for key in ["offset", "limit", "upcomingDays"] {
            if let Some(number) = object.get_mut(key) {
                normalize_integer(number)?;
            }
        }
    }
    serde_json::from_value(value).map_err(|_| FacetEngineError::Validation {
        detail: "JSON violates its schema".to_owned(),
    })
}

fn normalize_integer(value: &mut Value) -> Result<(), FacetEngineError> {
    tasknotes_vault::json_boundary::normalize_unsigned(value).map_err(|_| {
        FacetEngineError::Validation {
            detail: "integer must be exact, nonnegative, and within range".to_owned(),
        }
    })
}

fn encode<T: serde::Serialize>(value: &T) -> Result<String, FacetEngineError> {
    let mut value = serde_json::to_value(value).map_err(|_| FacetEngineError::Storage {
        detail: "engine state cannot be serialized".to_owned(),
    })?;
    if let Some(object) = value.as_object_mut() {
        object.insert("schemaVersion".to_owned(), Value::from(1));
    }
    serde_json::to_string(&value).map_err(|_| FacetEngineError::Storage {
        detail: "engine state cannot be serialized".to_owned(),
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use tasknotes_runtime::types::{Command, ConflictResolution};

    pub(crate) struct EmptyVault;
    impl FacetVaultFiles for EmptyVault {
        fn list_files(&self, _: String) -> Result<Vec<String>, FacetHostError> {
            Ok(Vec::new())
        }
        fn open_file_snapshot(
            &self,
            _: String,
            _: String,
        ) -> Result<Option<FacetFileSnapshot>, FacetHostError> {
            Ok(None)
        }
        fn open_displaced_snapshot(
            &self,
            _: String,
            _: String,
        ) -> Result<FacetFileSnapshot, FacetHostError> {
            Err(unavailable())
        }
        fn read_snapshot_chunk(
            &self,
            _: String,
            _: String,
            _: u64,
            _: u32,
        ) -> Result<Vec<u8>, FacetHostError> {
            Err(unavailable())
        }
        fn close_snapshot(&self, _: String, _: String) -> Result<(), FacetHostError> {
            Err(unavailable())
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
            Err(unavailable())
        }
        fn write_replacement_chunk(
            &self,
            _: String,
            _: String,
            _: u64,
            _: Vec<u8>,
        ) -> Result<FacetReplacementStage, FacetHostError> {
            Err(unavailable())
        }
        fn seal_replacement(
            &self,
            _: String,
            _: String,
        ) -> Result<FacetReplacementStage, FacetHostError> {
            Err(unavailable())
        }
        fn compare_exchange_staged(
            &self,
            _: String,
            _: String,
            _: String,
            _: Option<String>,
            _: Option<String>,
        ) -> Result<FacetStagedExchange, FacetHostError> {
            Err(FacetHostError::Unavailable {
                detail: "contract provider is read-only".to_owned(),
            })
        }
        fn discard_replacement(&self, _: String, _: String) -> Result<(), FacetHostError> {
            Err(unavailable())
        }
        fn displaced_metadata(
            &self,
            _: String,
            _: Option<String>,
            _: u32,
        ) -> Result<Vec<FacetDisplacedMetadata>, FacetHostError> {
            Ok(Vec::new())
        }
        fn acknowledge_displaced(&self, _: String, _: String) -> Result<(), FacetHostError> {
            Err(FacetHostError::Unavailable {
                detail: "contract provider has no retained versions".to_owned(),
            })
        }
    }

    fn unavailable() -> FacetHostError {
        FacetHostError::Unavailable {
            detail: "contract provider has no staged or snapshot handles".to_owned(),
        }
    }

    #[test]
    fn durable_identity_reopens_and_close_is_idempotent_and_rejects_late_calls()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = tempfile::tempdir()?;
        let database = directory.path().join("identity.sqlite");
        let database = database
            .to_str()
            .ok_or("test database path must be UTF-8")?;
        let engine = FfiFacetEngine::new(database, Arc::new(EmptyVault))?;
        let identity = engine.identity()?;
        assert_eq!(identity.len(), 64);
        assert!(
            identity
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        );
        engine.close_runtime()?;
        engine.close_runtime()?;
        assert!(matches!(engine.identity(), Err(FacetEngineError::Closed)));
        assert!(matches!(
            engine.profiles_json(),
            Err(FacetEngineError::Closed)
        ));
        let reopened = FfiFacetEngine::new(database, Arc::new(EmptyVault))?;
        assert_eq!(reopened.identity()?, identity);
        reopened.close_runtime()?;
        drop(reopened);
        drop(engine);
        directory.close()?;
        Ok(())
    }

    #[test]
    fn bounded_records_preserve_exact_metadata_and_absence_is_not_a_zero_byte_stage()
    -> Result<(), Box<dyn std::error::Error>> {
        let source = FacetFileSnapshot {
            id: "opaque-snapshot".into(),
            size: u64::MAX,
            revision: "a".repeat(64),
        };
        let snapshot = FileSnapshot::from(source);
        assert_eq!(snapshot.id, "opaque-snapshot");
        assert_eq!(snapshot.size, u64::MAX);
        assert_eq!(snapshot.revision, "a".repeat(64));
        let source = FacetReplacementStage {
            id: "opaque-stage".into(),
            operation_id: format!("facet-write:{}", "b".repeat(64)),
            path: "nested/zero.bin".into(),
            size: 0,
            revision: "c".repeat(64),
            written: 0,
            sealed: true,
        };
        let stage = ReplacementStage::from(source);
        assert_eq!(stage.id, "opaque-stage");
        assert_eq!(
            stage.operation_id,
            format!("facet-write:{}", "b".repeat(64))
        );
        assert_eq!(stage.path, "nested/zero.bin");
        assert_eq!(stage.size, 0);
        assert_eq!(stage.written, 0);
        assert_eq!(stage.revision, "c".repeat(64));
        assert!(stage.sealed);
        let files = Files(Arc::new(EmptyVault));
        assert_eq!(files.read_file("a", "absent.md")?, None);
        assert!(matches!(
            files.read_file("a", "attachment.bin"),
            Err(RuntimeError::Validation(_))
        ));
        assert!(matches!(
            files.compare_exchange_staged(
                "a",
                &stage.operation_id,
                &stage.path,
                None,
                Some(&stage.id)
            ),
            Err(RuntimeError::Host(_))
        ));
        assert!(matches!(
            files.compare_exchange_staged("a", &stage.operation_id, &stage.path, None, None),
            Err(RuntimeError::Host(_))
        ));
        Ok(())
    }

    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Profiles {
        profiles: Vec<Profile>,
    }

    #[test]
    fn raw_numeric_contract_never_rounds_fractional_typed_fields()
    -> Result<(), Box<dyn std::error::Error>> {
        let cases: Value = serde_json::from_str(include_str!(
            "../../../../tasknotes-fixtures/vault/facet-raw-contract.json"
        ))?;
        for case in cases["cases"].as_array().unwrap() {
            assert_eq!(case["definition"], "query");
            let raw = case["raw"].as_str().unwrap();
            assert_eq!(
                decode::<Query>(raw).is_ok(),
                case["valid"].as_bool().unwrap(),
                "{}",
                case["id"]
            );
        }
        let value = decode::<Mutation>(
            r#"{"mutationId":"precise","at":"2026-10-03T12:00:00Z","command":{"kind":"create","properties":{"title":"Precision","vendor":1.0000000000000000001}}}"#,
        )?;
        let Command::Create { properties, .. } = value.command else {
            panic!("expected creation");
        };
        assert_eq!(properties["vendor"].to_string(), "1.0000000000000000001");
        Ok(())
    }

    #[test]
    fn shared_contract_cases_exercise_the_real_decoder_and_query_seam()
    -> Result<(), Box<dyn std::error::Error>> {
        let corpus: Value = serde_json::from_str(include_str!(
            "../../../../tasknotes-fixtures/vault/facet-contract.json"
        ))?;
        let engine = FfiFacetEngine::new(":memory:", Arc::new(EmptyVault))?;
        engine.register_profile(
            r#"{"id":"a","name":"Example","kind":"local_folder","approveStandard":true}"#,
        )?;
        engine.refresh("a")?;
        let cases = corpus.get("cases").and_then(Value::as_array).unwrap();
        for case in cases {
            let json = serde_json::to_string(&case["value"])?;
            let accepted = match case["definition"].as_str().unwrap() {
                "profile" => engine.register_profile(&json).is_ok(),
                "query" => engine.snapshot_json("a", &json).is_ok(),
                "mutation" => decode::<Mutation>(&json)
                    .map(|m| m.command.validate_contract())
                    .is_ok_and(|result| result.is_ok()),
                "resolution" => decode::<ConflictResolution>(&json).is_ok(),
                "featureRequest" => engine.features_json("a", &json).is_ok(),
                "receipt" => decode::<tasknotes_runtime::types::Receipt>(&json).is_ok(),
                "payloadInfo" => decode::<tasknotes_runtime::types::PayloadInfo>(&json)
                    .is_ok_and(|info| info.validate_contract().is_ok()),
                "engineError" => decode::<FacetEngineError>(&json).is_ok(),
                "profiles" => decode::<Profiles>(&json)
                    .map(|value| value.profiles.len())
                    .is_ok(),
                definition => panic!("unhandled corpus definition {definition}"),
            };
            assert_eq!(
                accepted,
                case["valid"].as_bool().unwrap(),
                "case {}",
                case["id"]
            );
        }
        assert_eq!(cases.len(), 130);
        let registered:Value=serde_json::from_str(&engine.register_profile(r#"{"schemaVersion":1.0,"id":"a","name":"Example","kind":"local_folder","approveStandard":true}"#)?)?;
        assert_eq!(registered["schemaVersion"], 1);
        let profiles: Value = serde_json::from_str(&engine.profiles_json()?)?;
        assert_eq!(profiles["schemaVersion"], 1);
        assert!(profiles["profiles"][0].get("schemaVersion").is_none());
        let preserved = decode::<Mutation>(
            r#"{"mutationId":"numeric","at":"2026-10-03T12:00:00Z","command":{"kind":"create","properties":{"title":"Numeric","vendor":1.0}}}"#,
        )?;
        let Command::Create { properties, .. } = preserved.command else {
            panic!("expected create")
        };
        assert!(properties["vendor"].is_f64());
        Ok(())
    }
}
