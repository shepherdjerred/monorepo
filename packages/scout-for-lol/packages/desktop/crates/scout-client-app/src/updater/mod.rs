//! Self-update for Scout Desktop.
//!
//! The supervisor checks its release channel on start and every few hours,
//! downloads a newer signed installer in the background, verifies it, and runs
//! it when the user quits or when the app has been idle. It never installs
//! while League is in champion select or a game (see [`policy`]).
//!
//! Everything here runs on the supervisor's async runtime and its blocking
//! pool, never on the UI event loop (the tray owns the main thread) or in the
//! window process.
//!
//! The mechanism is `cargo-packager`'s own: installers are signed with
//! `cargo packager` (minisign), and this build verifies them against the
//! channel's public key compiled in from the release profile. The
//! `cargo-packager-updater` crate is not used; see the desktop README for why.
//! [`Updater`] is the seam, so the service logic is tested without a network.

pub mod http;
pub mod install;
pub mod manifest;
pub mod policy;
pub mod service;
#[cfg(test)]
pub mod testing;
pub mod verify;

use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;

use directories::ProjectDirs;
use manifest::{Artifact, ManifestError, Platform};
use scout_client_core::diagnostics::Diagnostics;
use scout_client_core::profile::ReleaseProfile;
use semver::Version;
use verify::VerifyError;

use self::http::{HttpUpdater, UpdateEndpoint};
use self::install::Installer;
use self::policy::UpdateConfig;
use self::service::{UpdateHandle, UpdateService};

/// A release newer than the running build, not yet downloaded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AvailableUpdate {
    /// The version it would install.
    pub version: Version,
    /// Release notes, plain text.
    pub notes: String,
    /// Whether the running build is below the channel's minimum version.
    pub required: bool,
    /// The installer to download and verify.
    pub artifact: Artifact,
    /// The installer's file name inside its release directory.
    pub file_name: String,
}

/// A downloaded installer that passed verification.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StagedUpdate {
    /// The version it installs.
    pub version: Version,
    /// Whether the running build is below the channel's minimum version.
    pub required: bool,
    /// Where the verified installer is.
    pub path: PathBuf,
    /// The artifact it was verified against, so it is verified again right
    /// before it runs.
    pub artifact: Artifact,
}

/// Why an update step failed.
#[derive(Debug, thiserror::Error)]
pub enum UpdateError {
    /// The release channel or bucket could not be reached or refused.
    #[error("the release channel request failed: {0}")]
    Network(String),
    /// The release channel answered with an unexpected status.
    #[error("the release channel answered HTTP {0}")]
    Status(u16),
    /// A body was larger than the contract allows.
    #[error("the release channel sent more than the contract allows")]
    TooLarge,
    /// The manifest is not a valid one for this channel.
    #[error(transparent)]
    Manifest(#[from] ManifestError),
    /// The download is not trusted.
    #[error(transparent)]
    Verify(#[from] VerifyError),
    /// Staging or starting the installer failed.
    #[error("the update could not be staged or started: {0}")]
    Io(#[from] std::io::Error),
}

/// A source of updates and the means to install one.
///
/// The production implementation is [`http::HttpUpdater`]. Callers run these
/// on the supervisor's runtime, never on a UI thread.
pub trait Updater: Send + Sync + 'static {
    /// Ask the channel for a release newer than `current`. `None` when the
    /// build is current or the newest release has no installer for this
    /// platform. A release at or below `current` is never offered, so the
    /// channel cannot downgrade a build.
    fn check(
        &self,
        current: &Version,
    ) -> impl Future<Output = Result<Option<AvailableUpdate>, UpdateError>> + Send;

    /// Download and verify the installer.
    fn download(
        &self,
        update: &AvailableUpdate,
    ) -> impl Future<Output = Result<StagedUpdate, UpdateError>> + Send;

    /// Verify the staged installer once more and start it. With `restart` the
    /// new version starts when it finishes. The caller decides when this is
    /// allowed; see [`policy::install_allowed`].
    ///
    /// # Errors
    ///
    /// Verification or process-start failures.
    fn install(&self, staged: &StagedUpdate, restart: bool) -> Result<(), UpdateError>;
}

#[cfg(windows)]
fn production_installer() -> Option<Arc<dyn Installer>> {
    Some(Arc::new(install::NsisInstaller))
}

#[cfg(not(windows))]
fn production_installer() -> Option<Arc<dyn Installer>> {
    None
}

/// Start the updater for this build, or `None` when it must not update.
///
/// Only a packaged build updates: a development build defaults to the beta
/// profile and would otherwise replace itself with a published installer. A
/// build pointed at another backend with `--server` does not either, and
/// neither does a platform without an installer the updater can run. Call
/// this from inside the supervisor's tokio runtime.
#[must_use]
pub fn start_for_this_build(
    server_overridden: bool,
    diagnostics: Arc<Diagnostics>,
) -> Option<UpdateHandle> {
    if !ReleaseProfile::is_packaged() || server_overridden {
        return None;
    }
    let platform = Platform::current()?;
    let installer = production_installer()?;
    let profile = ReleaseProfile::compiled();
    let staging = ProjectDirs::from(
        profile.data_qualifier,
        profile.data_organization,
        profile.data_application,
    )?
    .data_local_dir()
    .join("updates");
    let current = match Version::parse(env!("CARGO_PKG_VERSION")) {
        Ok(version) => version,
        Err(error) => {
            tracing::error!(%error, "the build version is not semantic; updates are off");
            return None;
        }
    };
    let endpoint = UpdateEndpoint {
        origin: profile.update_origin.to_owned(),
        channel: profile.channel.to_owned(),
    };
    let updater = match HttpUpdater::new(
        endpoint,
        profile.update_public_key,
        platform,
        staging,
        installer,
    ) {
        Ok(updater) => updater,
        Err(error) => {
            tracing::error!(%error, "the updater could not start; updates are off");
            return None;
        }
    };
    let config = match UpdateConfig::DEFAULT.validate() {
        Ok(config) => config,
        Err(error) => {
            tracing::error!(%error, "the update configuration is invalid; updates are off");
            return None;
        }
    };
    Some(UpdateService::start(
        Arc::new(updater),
        config,
        current,
        diagnostics,
    ))
}
