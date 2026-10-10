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
pub mod updates;

#[cfg(windows)]
mod windows_installer;

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

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
