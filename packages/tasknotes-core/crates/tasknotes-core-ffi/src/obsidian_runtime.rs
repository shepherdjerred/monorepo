//! Ownership and lifetime projection only; runtime owns storage/application.

use crate::{facet::FfiFacetEngine, obsidian::ObsidianBoundaryError};
use obsidian_sync::session::{Download, Session};
use std::sync::{Arc, Weak};
use tasknotes_runtime::{RuntimeError, engine::PreparedDownload};

pub(crate) struct RuntimeBinding {
    pub(crate) engine: Weak<FfiFacetEngine>,
    pub(crate) profile: String,
    pub(crate) epoch: String,
    pub(crate) vault: String,
    pub(crate) binding_epoch: String,
}

impl RuntimeBinding {
    pub(crate) fn engine(&self) -> Result<Arc<FfiFacetEngine>, ObsidianBoundaryError> {
        let engine = self
            .engine
            .upgrade()
            .ok_or_else(|| runtime_error(RuntimeError::Closed))?;
        engine.runtime().identity().map_err(runtime_error)?;
        if engine
            .runtime()
            .sync_binding_identity(&self.profile, &self.vault)
            .map_err(runtime_error)?
            != self.binding_epoch
        {
            return Err(ObsidianBoundaryError::Request);
        }
        Ok(engine)
    }
}

pub(crate) struct OwnedDownload {
    pub(crate) id: String,
    pub(crate) uid: u64,
    pub(crate) frame: Option<Download>,
    pub(crate) prepared: Option<Arc<PreparedDownload>>,
    pub(crate) applied: bool,
}

impl OwnedDownload {
    pub(crate) fn prepare(
        &mut self,
        binding: &RuntimeBinding,
        session: &Session,
    ) -> Result<(), ObsidianBoundaryError> {
        let engine = binding.engine()?;
        if self.applied {
            return Ok(());
        }
        if self.prepared.is_none() {
            let frame = self.frame.as_ref().ok_or(ObsidianBoundaryError::Request)?;
            self.prepared = Some(Arc::new(
                engine
                    .runtime()
                    .prepare_authenticated_download_fenced(
                        &binding.profile,
                        &binding.binding_epoch,
                        session,
                        frame,
                    )
                    .map_err(runtime_error)?,
            ));
            // The immutable SQLite receipt now owns these bytes. Drop the entire
            // protocol allocation before native staged CAS or text projection.
            drop(self.frame.take());
        }
        Ok(())
    }
}

pub(crate) fn runtime_error(error: RuntimeError) -> ObsidianBoundaryError {
    if matches!(error, RuntimeError::Busy) {
        return ObsidianBoundaryError::Busy;
    }
    let code = match &error {
        RuntimeError::Storage(_) => "runtime_storage",
        RuntimeError::Host(_) => "runtime_host",
        RuntimeError::HostContract(_) => "runtime_host_contract",
        RuntimeError::Validation(_) => "runtime_validation",
        RuntimeError::Configuration(_) => "runtime_configuration",
        RuntimeError::Conflict => "runtime_conflict",
        RuntimeError::NotFound => "runtime_not_found",
        RuntimeError::Closed => "engine_closed",
        RuntimeError::Busy => "runtime_busy",
    };
    ObsidianBoundaryError::Boundary {
        code: code.to_owned(),
        detail: crate::facet::FacetEngineError::from(error).to_string(),
    }
}
