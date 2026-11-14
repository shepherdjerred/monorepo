//! Single-instance guard: two clients must not read one outbox.

use std::fs::{File, OpenOptions, TryLockError};
use std::path::{Path, PathBuf};

use crate::runtime::data_directory;

const LOCK_FILE_NAME: &str = "scout-client.lock";

/// Why the instance lock could not be taken.
#[derive(Debug)]
pub enum InstanceLockError {
    /// Another Scout Client process holds the lock.
    AlreadyRunning(PathBuf),
    /// The lock file could not be opened or locked.
    Io(PathBuf, std::io::Error),
}

impl std::fmt::Display for InstanceLockError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AlreadyRunning(path) => write!(
                formatter,
                "Scout Client is already running (lock held on {}). Close the other instance first.",
                path.display()
            ),
            Self::Io(path, error) => write!(
                formatter,
                "Could not take the Scout Client instance lock {}: {error}",
                path.display()
            ),
        }
    }
}

impl std::error::Error for InstanceLockError {}

/// An exclusive advisory lock held for the life of the process. The operating
/// system releases it when the holder exits, even after a crash, so a stale
/// lock file never blocks a launch.
#[derive(Debug)]
pub struct InstanceLock {
    _file: File,
}

impl InstanceLock {
    /// Take the lock in the per-user data directory that holds the outbox.
    ///
    /// # Errors
    /// [`InstanceLockError::AlreadyRunning`] when another process holds it.
    pub fn acquire() -> Result<Self, InstanceLockError> {
        let directory = data_directory().unwrap_or_else(std::env::temp_dir);
        Self::acquire_in(&directory)
    }

    /// Take the lock in `directory`.
    ///
    /// # Errors
    /// [`InstanceLockError::AlreadyRunning`] when another process holds it.
    pub fn acquire_in(directory: &Path) -> Result<Self, InstanceLockError> {
        let path = directory.join(LOCK_FILE_NAME);
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&path)
            .map_err(|error| InstanceLockError::Io(path.clone(), error))?;
        match file.try_lock() {
            Ok(()) => Ok(Self { _file: file }),
            Err(TryLockError::WouldBlock) => Err(InstanceLockError::AlreadyRunning(path)),
            Err(TryLockError::Error(error)) => Err(InstanceLockError::Io(path, error)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{InstanceLock, InstanceLockError};

    fn scratch_directory() -> Result<std::path::PathBuf, std::io::Error> {
        let directory = std::env::temp_dir().join(format!("scout-lock-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&directory)?;
        Ok(directory)
    }

    #[test]
    fn a_second_instance_in_the_same_directory_is_refused() -> Result<(), Box<dyn std::error::Error>>
    {
        let directory = scratch_directory()?;

        let first = InstanceLock::acquire_in(&directory)?;
        let second = InstanceLock::acquire_in(&directory);
        assert!(matches!(second, Err(InstanceLockError::AlreadyRunning(_))));
        assert!(
            second
                .err()
                .is_some_and(|error| error.to_string().contains("already running"))
        );

        drop(first);
        let again = InstanceLock::acquire_in(&directory);
        assert!(again.is_ok(), "the lock is released when its holder drops");

        drop(again);
        std::fs::remove_dir_all(&directory)?;
        Ok(())
    }

    #[test]
    fn different_data_directories_do_not_contend() -> Result<(), Box<dyn std::error::Error>> {
        let first = scratch_directory()?;
        let second = scratch_directory()?;

        let held = InstanceLock::acquire_in(&first)?;
        let other = InstanceLock::acquire_in(&second)?;

        drop((held, other));
        std::fs::remove_dir_all(&first)?;
        std::fs::remove_dir_all(&second)?;
        Ok(())
    }
}
