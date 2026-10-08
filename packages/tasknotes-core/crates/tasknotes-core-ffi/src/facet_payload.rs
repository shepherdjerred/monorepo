//! Profile/lifetime fenced bounded payload handles, with no whole-array API.

use crate::facet::{FacetEngineError, FfiFacetEngine};
use std::sync::{
    Arc, Weak,
    atomic::{AtomicBool, Ordering},
};
use tasknotes_runtime::types::PAYLOAD_CHUNK_BYTES;

/// One opaque owner-scoped SQLite image. Close drops only this handle; explicit
/// discard releases incoming bytes only when no durable owner references them.
#[derive(uniffi::Object)]
pub struct FfiFacetPayload {
    engine: Weak<FfiFacetEngine>,
    profile: String,
    lifetime: String,
    id: String,
    readonly: bool,
    closed: AtomicBool,
}

impl FfiFacetPayload {
    fn new(
        engine: &Arc<FfiFacetEngine>,
        profile: String,
        lifetime: String,
        id: String,
        readonly: bool,
    ) -> Arc<Self> {
        Arc::new(Self {
            engine: Arc::downgrade(engine),
            profile,
            lifetime,
            id,
            readonly,
            closed: AtomicBool::new(false),
        })
    }

    fn engine(&self) -> Result<Arc<FfiFacetEngine>, FacetEngineError> {
        if self.closed.load(Ordering::Acquire) {
            return Err(FacetEngineError::Closed);
        }
        let engine = self.engine.upgrade().ok_or(FacetEngineError::Closed)?;
        engine.runtime().identity()?;
        Ok(engine)
    }

    fn writable(&self) -> Result<(), FacetEngineError> {
        if self.readonly {
            return Err(FacetEngineError::Validation {
                detail: "Retained runtime versions are immutable".to_owned(),
            });
        }
        Ok(())
    }

    pub(crate) fn execute(
        &self,
        engine: &FfiFacetEngine,
        profile: &str,
        mutation: &tasknotes_runtime::types::Mutation,
    ) -> Result<tasknotes_runtime::types::Receipt, FacetEngineError> {
        let owner = self.engine()?;
        if !std::ptr::eq(engine, owner.as_ref()) || self.profile != profile {
            return Err(FacetEngineError::Validation {
                detail: "Payload belongs to a different engine or profile".to_owned(),
            });
        }
        engine
            .runtime()
            .execute_payload_handle(profile, &self.lifetime, mutation, &self.id)
            .map_err(Into::into)
    }
}

#[uniffi::export]
impl FfiFacetPayload {
    /// Return metadata only, including the exact durable staging prefix.
    ///
    /// # Errors
    /// Rejects expired owners/handles or corrupt retained metadata.
    pub fn info_json(&self) -> Result<String, FacetEngineError> {
        let engine = self.engine()?;
        encode_info(engine.runtime().payload_handle_info(
            &self.profile,
            &self.lifetime,
            &self.id,
        )?)
    }

    /// Read an exact immutable range at most one MiB, including zero at EOF.
    ///
    /// # Errors
    /// Rejects invalid ranges, unsealed bytes or expired owners/handles.
    pub fn read_chunk(&self, offset: u64, length: u32) -> Result<Vec<u8>, FacetEngineError> {
        let length = usize::try_from(length).map_err(|_| chunk_error())?;
        if length > PAYLOAD_CHUNK_BYTES {
            return Err(chunk_error());
        }
        let engine = self.engine()?;
        let mut bytes = vec![0; length];
        engine.runtime().read_payload_handle(
            &self.profile,
            &self.lifetime,
            &self.id,
            offset,
            &mut bytes,
        )?;
        Ok(bytes)
    }

    /// Write a contiguous durable prefix or verify an exact bounded retry.
    ///
    /// # Errors
    /// Rejects retained images, changed chunks, invalid bounds or stale owners.
    pub fn write_chunk(&self, offset: u64, bytes: Vec<u8>) -> Result<String, FacetEngineError> {
        self.writable()?;
        if bytes.len() > PAYLOAD_CHUNK_BYTES {
            return Err(chunk_error());
        }
        let engine = self.engine()?;
        let info = engine.runtime().write_payload_handle(
            &self.profile,
            &self.lifetime,
            &self.id,
            offset,
            &bytes,
        )?;
        drop(bytes);
        encode_info(info)
    }

    /// Verify the complete digest and durably make this image immutable.
    ///
    /// # Errors
    /// Rejects incomplete/mismatched data, retained images or expired owners.
    pub fn seal(&self) -> Result<String, FacetEngineError> {
        self.writable()?;
        let engine = self.engine()?;
        encode_info(engine.runtime().seal_payload_handle(
            &self.profile,
            &self.lifetime,
            &self.id,
        )?)
    }

    /// Release only unreferenced incoming image bytes. The retired immutable ID
    /// remains, so changed/repeated operations cannot revive its former payload.
    ///
    /// # Errors
    /// Rejects retained/durable references and expired owners/handles.
    pub fn discard(&self) -> Result<(), FacetEngineError> {
        self.writable()?;
        self.engine()?
            .runtime()
            .discard_payload_handle(&self.profile, &self.lifetime, &self.id)
            .map_err(Into::into)
    }

    /// Retire this transient handle without deleting any durable bytes.
    pub fn close_handle(&self) {
        self.closed.store(true, Ordering::Release);
    }
}

#[uniffi::export]
impl FfiFacetEngine {
    /// Begin/resume an immutable incoming image. No complete file crosses FFI.
    ///
    /// # Errors
    /// Rejects changed/reserved IDs, size/hash bounds or unavailable profiles.
    pub fn begin_payload(
        self: Arc<Self>,
        profile_id: String,
        payload_id: String,
        size: u64,
        revision: &str,
    ) -> Result<Arc<FfiFacetPayload>, FacetEngineError> {
        let (lifetime, _) =
            self.runtime()
                .begin_payload_handle(&profile_id, &payload_id, size, revision)?;
        Ok(FfiFacetPayload::new(
            &self, profile_id, lifetime, payload_id, false,
        ))
    }

    /// Restore one caller-owned incoming handle after process restart.
    ///
    /// # Errors
    /// Rejects runtime-owned identities, absent profiles/images or stale storage.
    pub fn open_payload(
        self: Arc<Self>,
        profile_id: String,
        payload_id: String,
    ) -> Result<Arc<FfiFacetPayload>, FacetEngineError> {
        if payload_id.starts_with("blob:") || payload_id.starts_with("sync:") {
            return Err(FacetEngineError::Validation {
                detail: "Runtime images require a retained-version handle".to_owned(),
            });
        }
        let (lifetime, _) = self
            .runtime()
            .open_payload_handle(&profile_id, &payload_id)?;
        Ok(FfiFacetPayload::new(
            &self, profile_id, lifetime, payload_id, false,
        ))
    }

    /// Open one retained conflict/archive image for bounded lazy reads. A null
    /// result denotes an actual tombstone, distinct from a sealed empty image.
    ///
    /// # Errors
    /// Rejects unknown roles, missing conflicts or invalid retained metadata.
    pub fn conflict_payload(
        self: Arc<Self>,
        profile_id: String,
        conflict_id: &str,
        version: &str,
    ) -> Result<Option<Arc<FfiFacetPayload>>, FacetEngineError> {
        let lifetime = self.runtime().profile_lifetime(&profile_id)?;
        let info = self
            .runtime()
            .conflict_payload_info(&profile_id, conflict_id, version)?;
        if let Some(info) = &info {
            self.runtime()
                .payload_handle_info(&profile_id, &lifetime, &info.id)?;
        }
        Ok(info.map(|info| FfiFacetPayload::new(&self, profile_id, lifetime, info.id, true)))
    }
}

fn chunk_error() -> FacetEngineError {
    FacetEngineError::Validation {
        detail: "File chunks must be at most one MiB".to_owned(),
    }
}

fn encode_info(info: tasknotes_runtime::types::PayloadInfo) -> Result<String, FacetEngineError> {
    info.validate_contract()
        .map_err(|_| FacetEngineError::Storage {
            detail: "Invalid payload metadata".to_owned(),
        })?;
    let mut value = serde_json::to_value(info).map_err(|_| FacetEngineError::Storage {
        detail: "Invalid payload metadata".to_owned(),
    })?;
    value
        .as_object_mut()
        .ok_or_else(|| FacetEngineError::Storage {
            detail: "Invalid payload metadata".to_owned(),
        })?
        .insert("schemaVersion".to_owned(), serde_json::Value::from(1));
    serde_json::to_string(&value).map_err(|_| FacetEngineError::Storage {
        detail: "Invalid payload metadata".to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::facet::tests::EmptyVault;
    use serde_json::{Value, json};
    use tasknotes_vault::document::ContentRevision;

    type TestResult = Result<(), Box<dyn std::error::Error>>;
    const PROFILE: &str = r#"{"schemaVersion":1,"id":"a","name":"Test","kind":"obsidian_sync","approveStandard":false}"#;

    #[test]
    fn bounded_ffi_payload_restart_retains_exact_prefix_and_sealed_identity() -> TestResult {
        let directory = tempfile::tempdir()?;
        let path = directory.path().join("payload.db");
        let path = path.to_str().ok_or("Invalid path")?;
        let bytes = vec![37; PAYLOAD_CHUNK_BYTES + 3];
        let revision = ContentRevision::of(&bytes);
        let engine = FfiFacetEngine::new(path, Arc::new(EmptyVault))?;
        engine.register_profile(PROFILE)?;
        let handle = engine.clone().begin_payload(
            "a".into(),
            "draft:original".into(),
            u64::try_from(bytes.len())?,
            revision.as_str(),
        )?;
        let metadata: Value = serde_json::from_str(
            &handle.write_chunk(
                0,
                bytes
                    .get(..PAYLOAD_CHUNK_BYTES)
                    .ok_or("Missing prefix")?
                    .to_vec(),
            )?,
        )?;
        assert_eq!(metadata.get("written"), Some(&json!(PAYLOAD_CHUNK_BYTES)));
        assert!(matches!(
            handle.read_chunk(0, 1),
            Err(FacetEngineError::Conflict)
        ));
        assert!(matches!(
            handle.write_chunk(0, vec![0]),
            Err(FacetEngineError::Conflict)
        ));
        handle.close_handle();
        assert!(matches!(handle.info_json(), Err(FacetEngineError::Closed)));
        engine.close_runtime()?;
        let engine = FfiFacetEngine::new(path, Arc::new(EmptyVault))?;
        let handle = engine
            .clone()
            .open_payload("a".into(), "draft:original".into())?;
        handle.write_chunk(u64::try_from(PAYLOAD_CHUNK_BYTES)?, vec![37; 3])?;
        let info: Value = serde_json::from_str(&handle.seal()?)?;
        assert_eq!(
            info,
            json!({"schemaVersion":1,"id":"draft:original","size":bytes.len(),"revision":revision.as_str(),"written":bytes.len(),"state":"sealed"})
        );
        assert_eq!(
            handle.read_chunk(u64::try_from(PAYLOAD_CHUNK_BYTES)?, 3)?,
            vec![37; 3]
        );
        assert_eq!(
            handle.read_chunk(u64::try_from(bytes.len())?, 0)?,
            Vec::<u8>::new()
        );
        assert!(matches!(
            handle.read_chunk(0, u32::try_from(PAYLOAD_CHUNK_BYTES + 1)?),
            Err(FacetEngineError::Validation { .. })
        ));
        handle.discard()?;
        handle.discard()?;
        assert!(matches!(
            handle.read_chunk(0, 1),
            Err(FacetEngineError::NotFound)
        ));
        assert!(
            engine
                .clone()
                .begin_payload(
                    "a".into(),
                    "draft:original".into(),
                    u64::try_from(bytes.len())?,
                    revision.as_str()
                )
                .is_err()
        );
        Ok(())
    }

    #[test]
    fn ffi_payload_generation_and_weak_engine_prevent_lifetime_revival() -> TestResult {
        let engine = FfiFacetEngine::new(":memory:", Arc::new(EmptyVault))?;
        engine.register_profile(PROFILE)?;
        let revision = ContentRevision::of(b"");
        let handle =
            engine
                .clone()
                .begin_payload("a".into(), "draft:empty".into(), 0, revision.as_str())?;
        handle.seal()?;
        handle.discard()?;
        engine.remove_profile("a")?;
        engine.register_profile(PROFILE)?;
        let replacement =
            engine
                .clone()
                .begin_payload("a".into(), "draft:empty".into(), 0, revision.as_str())?;
        replacement.seal()?;
        assert!(matches!(handle.info_json(), Err(FacetEngineError::Closed)));
        assert!(matches!(handle.discard(), Err(FacetEngineError::Closed)));
        assert_eq!(replacement.read_chunk(0, 0)?, Vec::<u8>::new());
        for reserved in ["blob:reserved", "sync:reserved"] {
            assert!(matches!(
                engine
                    .clone()
                    .begin_payload("a".into(), reserved.into(), 0, revision.as_str()),
                Err(FacetEngineError::Validation { .. })
            ));
        }
        drop(engine);
        assert!(matches!(
            replacement.info_json(),
            Err(FacetEngineError::Closed)
        ));
        Ok(())
    }

    #[test]
    fn runtime_retained_payload_is_readonly_and_contract_errors_stay_permanent() -> TestResult {
        let engine = FfiFacetEngine::new(":memory:", Arc::new(EmptyVault))?;
        engine.register_profile(PROFILE)?;
        let revision = ContentRevision::of(b"x");
        let writable = engine.clone().begin_payload(
            "a".into(),
            "draft:version".into(),
            1,
            revision.as_str(),
        )?;
        writable.write_chunk(0, b"x".to_vec())?;
        writable.seal()?;
        let readonly = FfiFacetPayload::new(
            &engine,
            "a".into(),
            writable.lifetime.clone(),
            writable.id.clone(),
            true,
        );
        assert_eq!(readonly.read_chunk(0, 1)?, b"x");
        assert!(matches!(
            readonly.write_chunk(0, b"x".to_vec()),
            Err(FacetEngineError::Validation { .. })
        ));
        assert!(matches!(
            readonly.discard(),
            Err(FacetEngineError::Validation { .. })
        ));
        assert!(matches!(
            FacetEngineError::from(tasknotes_runtime::RuntimeError::Busy),
            FacetEngineError::Busy
        ));
        assert!(matches!(
            FacetEngineError::from(tasknotes_runtime::RuntimeError::HostContract(
                "stage_owner".into()
            )),
            FacetEngineError::HostContract { .. }
        ));
        engine.close_runtime()?;
        assert!(matches!(
            readonly.info_json(),
            Err(FacetEngineError::Closed)
        ));
        Ok(())
    }
}
