//! A scripted [`Updater`] shared by the service and supervisor tests.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use semver::Version;

use super::manifest::{Artifact, ArtifactFormat};
use super::{AvailableUpdate, StagedUpdate, UpdateError, Updater};

pub fn version(text: &str) -> Version {
    Version::parse(text).unwrap_or(Version::new(0, 0, 0))
}

fn artifact() -> Artifact {
    Artifact {
        url: "https://download.scout-for-lol.com/releases/0.2.0/x.exe".to_owned(),
        sha256: "0".repeat(64),
        size: 1,
        signature: "A".repeat(16),
        format: ArtifactFormat::Nsis,
    }
}

pub fn available(text: &str, required: bool) -> AvailableUpdate {
    AvailableUpdate {
        version: version(text),
        notes: String::new(),
        required,
        artifact: artifact(),
        file_name: "x.exe".to_owned(),
    }
}

/// An updater whose answers are scripted and whose calls are counted.
#[derive(Default)]
pub struct FakeUpdater {
    offer: Mutex<Option<AvailableUpdate>>,
    /// The status every check fails with, when it fails.
    fail_check: Mutex<Option<u16>>,
    pub checks: AtomicU32,
    pub downloads: AtomicU32,
    installs: Mutex<Vec<(Version, bool)>>,
}

impl FakeUpdater {
    pub fn offering(update: Option<AvailableUpdate>) -> Arc<Self> {
        Arc::new(Self {
            offer: Mutex::new(update),
            ..Self::default()
        })
    }

    pub fn failing_checks(&self) {
        self.failing_with(503);
    }

    /// The channel has no manifest: nothing has been published on it.
    pub fn unpublished(&self) {
        self.failing_with(404);
    }

    fn failing_with(&self, status: u16) {
        *self
            .fail_check
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = Some(status);
    }

    pub fn checks(&self) -> u32 {
        self.checks.load(Ordering::SeqCst)
    }

    pub fn install_count(&self) -> usize {
        self.installs
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len()
    }

    pub fn installs(&self) -> Vec<(Version, bool)> {
        self.installs
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

impl Updater for FakeUpdater {
    async fn check(&self, _current: &Version) -> Result<Option<AvailableUpdate>, UpdateError> {
        self.checks.fetch_add(1, Ordering::SeqCst);
        // A real updater awaits the network; yield like one.
        tokio::task::yield_now().await;
        if let Some(status) = *self
            .fail_check
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
        {
            return Err(UpdateError::Status(status));
        }
        Ok(self
            .offer
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone())
    }

    async fn download(&self, update: &AvailableUpdate) -> Result<StagedUpdate, UpdateError> {
        self.downloads.fetch_add(1, Ordering::SeqCst);
        tokio::task::yield_now().await;
        Ok(StagedUpdate {
            version: update.version.clone(),
            required: update.required,
            path: "staged.exe".into(),
            artifact: update.artifact.clone(),
        })
    }

    fn install(&self, staged: &StagedUpdate, restart: bool) -> Result<(), UpdateError> {
        self.installs
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push((staged.version.clone(), restart));
        Ok(())
    }
}
