//! Installation and client adapters for the Windows Glitter Boys launcher.

pub mod archive;
pub mod catalog;
pub mod diagnostics;
pub mod download;
pub mod install;
pub mod launch;
pub mod prerequisites;
pub mod problem;
pub mod scheduler;
pub mod state;
pub mod storage;
pub mod support;
pub mod updates;

#[cfg(windows)]
mod windows_installer;

use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

/// The installation step a filesystem or process failure happened in. Allow-listed so it
/// can be reported without free text.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Step {
    CreateClients,
    UnpackClient,
    CopyClient,
    SpawnUpdater,
    WaitUpdater,
    CheckFiles,
    RestoreSaves,
    WriteReceipt,
    Promote,
}

impl Step {
    pub fn label(self) -> &'static str {
        match self {
            Self::CreateClients => "Creating the client folder",
            Self::UnpackClient => "Unpacking the game launcher",
            Self::CopyClient => "Copying the game launcher",
            Self::SpawnUpdater => "Starting the game updater",
            Self::WaitUpdater => "Waiting for the game updater",
            Self::CheckFiles => "Checking game files",
            Self::RestoreSaves => "Restoring saves",
            Self::WriteReceipt => "Recording the installation",
            Self::Promote => "Moving the game into place",
        }
    }
}

impl std::fmt::Display for Step {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.label())
    }
}

/// Errors at the filesystem, network, archive, and client boundaries.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{next_step}")]
    ActionRequired {
        title: &'static str,
        next_step: &'static str,
    },
    #[error("{0}")]
    Invalid(String),
    #[error("Paused. Your downloaded files are saved; choose Resume to continue.")]
    Paused,
    #[error("{step} failed for {}: {source}", path.display())]
    Step {
        step: Step,
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },
    #[error("File operation failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("Download failed: {0}")]
    Network(#[from] reqwest::Error),
    #[error("Invalid data: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Archive could not be read: {0}")]
    Archive(#[from] zip::result::ZipError),
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    /// The OS-level error behind a filesystem or process failure, when there is one.
    pub fn io(&self) -> Option<&std::io::Error> {
        match self {
            Self::Io(source) | Self::Step { source, .. } => Some(source),
            _ => None,
        }
    }
    pub fn step(&self) -> Option<Step> {
        match self {
            Self::Step { step, .. } => Some(*step),
            _ => None,
        }
    }
}

/// Attach the installation step and path to an I/O failure.
pub trait StepExt<T> {
    fn step(self, step: Step, path: &Path) -> Result<T>;
}

impl<T> StepExt<T> for std::io::Result<T> {
    fn step(self, step: Step, path: &Path) -> Result<T> {
        self.map_err(|source| Error::Step {
            step,
            path: path.to_path_buf(),
            source,
        })
    }
}

impl<T> StepExt<T> for Result<T> {
    fn step(self, step: Step, path: &Path) -> Result<T> {
        self.map_err(|error| match error {
            Error::Io(source) => Error::Step {
                step,
                path: path.to_path_buf(),
                source,
            },
            other => other,
        })
    }
}

/// Cooperative pause signal. Archive extraction resumes from a fresh staging directory.
#[derive(Clone, Default)]
pub struct Cancellation(Arc<AtomicBool>);

impl Cancellation {
    pub fn pause(&self) {
        self.0.store(true, Ordering::Release);
    }
    pub fn check(&self) -> Result<()> {
        if self.0.load(Ordering::Acquire) {
            Err(Error::Paused)
        } else {
            Ok(())
        }
    }
}

/// Bounded, credential-free progress sent from the worker to the GUI.
#[derive(Clone, Debug)]
pub struct Progress {
    pub phase: &'static str,
    pub completed: u64,
    pub total: u64,
}

#[cfg(test)]
fn test_tempdir() -> std::io::Result<tempfile::TempDir> {
    // macOS's default temporary path includes /var, a symlink to /private/var.
    // Fixtures must satisfy the same link-free library contract as real installs.
    tempfile::tempdir_in(std::env::temp_dir().canonicalize()?)
}
