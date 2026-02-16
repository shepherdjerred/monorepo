//! Binary version tracking for daemon auto-restart
//!
//! This module tracks the binary's modification time when the daemon starts,
//! allowing clients to detect when the binary has been recompiled and
//! automatically restart the daemon.

use std::fs;
use std::path::PathBuf;
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use crate::utils::paths;

/// Path to the daemon info file
fn daemon_info_path() -> PathBuf {
    paths::base_dir().join("daemon.info")
}

/// Information about the running daemon
#[derive(Debug, Copy, Clone, Serialize, Deserialize)]
pub struct DaemonInfo {
    /// PID of the daemon process
    pub pid: u32,
    /// Modification time of the binary when daemon started (as Unix timestamp)
    pub binary_mtime_secs: u64,
    /// Start time of the daemon (as Unix timestamp)
    pub started_at_secs: u64,
}

impl DaemonInfo {
    /// Create DaemonInfo for the current process
    ///
    /// # Errors
    ///
    /// Returns an error if the executable path, metadata, or system time cannot be accessed.
    pub fn current() -> anyhow::Result<Self> {
        let exe_path = std::env::current_exe()?;
        let metadata = fs::metadata(&exe_path)?;
        let mtime = metadata.modified()?;
        let mtime_secs = mtime.duration_since(SystemTime::UNIX_EPOCH)?.as_secs();
        let now_secs = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)?
            .as_secs();

        Ok(Self {
            pid: std::process::id(),
            binary_mtime_secs: mtime_secs,
            started_at_secs: now_secs,
        })
    }

    /// Write daemon info to file
    ///
    /// # Errors
    ///
    /// Returns an error if the file cannot be written or the directory cannot be created.
    pub fn write(&self) -> anyhow::Result<()> {
        let path = daemon_info_path();

        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }

        let json = serde_json::to_string(self)?;
        fs::write(&path, json)?;
        Ok(())
    }

    /// Read daemon info from file
    ///
    /// # Errors
    ///
    /// Returns an error if the file exists but cannot be read or parsed.
    pub fn read() -> anyhow::Result<Option<Self>> {
        let path = daemon_info_path();
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)?;
        let info: Self = serde_json::from_str(&content)?;
        Ok(Some(info))
    }

    /// Remove the daemon info file
    ///
    /// # Errors
    ///
    /// Returns an error if the file exists but cannot be removed.
    pub fn remove() -> anyhow::Result<()> {
        let path = daemon_info_path();
        if path.exists() {
            fs::remove_file(&path)?;
        }
        Ok(())
    }
}

/// Get the current binary's modification time
///
/// # Errors
///
/// Returns an error if the executable path, metadata, or modification time cannot be accessed.
pub fn current_binary_mtime() -> anyhow::Result<u64> {
    let exe_path = std::env::current_exe()?;
    let metadata = fs::metadata(&exe_path)?;
    let mtime = metadata.modified()?;
    Ok(mtime.duration_since(SystemTime::UNIX_EPOCH)?.as_secs())
}

/// Check if the current binary is newer than when the daemon was started
///
/// # Errors
///
/// Returns an error if the daemon info or binary modification time cannot be read.
pub fn is_binary_newer_than_daemon() -> anyhow::Result<bool> {
    let daemon_info = DaemonInfo::read()?;
    let Some(info) = daemon_info else {
        return Ok(false);
    };

    let current_mtime = current_binary_mtime()?;
    Ok(current_mtime > info.binary_mtime_secs)
}

/// Kill the daemon process if running
///
/// # Errors
///
/// Returns an error if the daemon info cannot be read or the process cannot be killed.
pub fn kill_daemon() -> anyhow::Result<()> {
    let daemon_info = DaemonInfo::read()?;
    let Some(info) = daemon_info else {
        return Ok(());
    };

    tracing::info!(pid = info.pid, "Killing old daemon process");

    // Send SIGTERM to the daemon process
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let status = std::process::Command::new("kill")
            .arg("-TERM")
            .arg(info.pid.to_string())
            .status();

        match status {
            Ok(s) if s.success() => {
                tracing::debug!(pid = info.pid, "SIGTERM sent successfully");
            }
            Ok(s) => {
                tracing::debug!(
                    pid = info.pid,
                    exit_code = ?s.code(),
                    "kill command exited with non-zero status (process may already be dead)"
                );
            }
            Err(e) => {
                tracing::debug!(pid = info.pid, error = %e, "Failed to send SIGTERM");
            }
        }
    }

    // Give daemon time to shut down gracefully
    std::thread::sleep(std::time::Duration::from_millis(500));

    // Clean up the socket file if daemon didn't
    let socket_path = paths::socket_path();
    if socket_path.exists() {
        let _ = fs::remove_file(&socket_path);
    }
    let console_socket_path = paths::console_socket_path();
    if console_socket_path.exists() {
        let _ = fs::remove_file(&console_socket_path);
    }

    // Clean up info file
    DaemonInfo::remove()?;

    Ok(())
}
