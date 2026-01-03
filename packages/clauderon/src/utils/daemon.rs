use std::fs::{File, OpenOptions};
use std::io::Write;
use std::os::unix::process::CommandExt;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use fs2::FileExt;

use crate::utils::paths;

/// Default timeout for waiting for the daemon to become ready
const DEFAULT_DAEMON_TIMEOUT: Duration = Duration::from_secs(5);

/// Polling interval when waiting for daemon
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Brief delay after spawn to check if process is still alive
const SPAWN_HEALTH_CHECK_DELAY: Duration = Duration::from_millis(200);

/// Get the path to the lock file used to prevent race conditions
fn lock_file_path() -> std::path::PathBuf {
    paths::base_dir().join("daemon.lock")
}

/// Check if the daemon is running by testing socket connectivity
///
/// This function attempts an actual connection to verify the daemon
/// is responsive, not just that the socket file exists.
#[must_use]
pub fn is_daemon_running() -> bool {
    use std::os::unix::net::UnixStream;

    let socket_path = paths::socket_path();

    // Try to actually connect, not just check if socket exists
    // A stale socket file from a crashed daemon would fail here
    UnixStream::connect(&socket_path).is_ok()
}

/// RAII guard for the spawn lock that cleans up the lock file on drop
struct SpawnLockGuard {
    _file: File,
    path: std::path::PathBuf,
}

impl Drop for SpawnLockGuard {
    fn drop(&mut self) {
        // Clean up the lock file when the guard is dropped
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Acquire an exclusive lock for daemon spawning
///
/// Returns a guard that holds the lock. The lock is released and the
/// lock file is cleaned up when the guard is dropped.
fn acquire_spawn_lock() -> anyhow::Result<SpawnLockGuard> {
    let lock_path = lock_file_path();

    // Ensure parent directory exists
    if let Some(parent) = lock_path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Open the lock file
    let file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&lock_path)?;

    // Try to acquire exclusive lock (non-blocking)
    // fs2 provides safe cross-platform file locking
    file.try_lock_exclusive()
        .map_err(|_| anyhow::anyhow!("Another process is already spawning the daemon"))?;

    // Write our PID to the lock file for debugging
    let mut file = file;
    writeln!(file, "{}", std::process::id())?;

    Ok(SpawnLockGuard {
        _file: file,
        path: lock_path,
    })
}

/// Spawn the daemon as a detached background process
///
/// This function spawns a new `clauderon daemon` process that continues running
/// after the parent process exits. The daemon process is fully detached
/// by creating a new process group, which prevents signals (like SIGTERM
/// or Ctrl+C) from the parent from propagating to the daemon.
///
/// Returns the child process handle for health checking.
///
/// # Errors
///
/// Returns an error if the daemon process cannot be spawned.
fn spawn_daemon_process() -> anyhow::Result<Child> {
    let exe_path = std::env::current_exe()?;

    let child = Command::new(&exe_path)
        .arg("daemon")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        // Create a new process group so signals don't propagate from parent
        .process_group(0)
        .spawn()?;

    Ok(child)
}

/// Spawn the daemon with a health check to detect immediate crashes
///
/// # Errors
///
/// Returns an error if the daemon cannot be spawned or crashes immediately.
pub fn spawn_daemon() -> anyhow::Result<()> {
    let mut child = spawn_daemon_process()?;

    // Brief delay to let the process initialize
    std::thread::sleep(SPAWN_HEALTH_CHECK_DELAY);

    // Check if process is still running
    match child.try_wait()? {
        Some(status) => {
            // Process exited - this is a failure
            anyhow::bail!("Daemon process exited immediately with status: {status}");
        }
        None => {
            // Process still running - success
            // Note: we intentionally don't wait() here to detach
            Ok(())
        }
    }
}

/// Ensure the daemon is running, spawning it if necessary
///
/// This function uses file locking to prevent race conditions when
/// multiple clients try to spawn the daemon simultaneously.
///
/// # Errors
///
/// Returns an error if the daemon cannot be spawned or fails to start.
pub async fn ensure_daemon_running() -> anyhow::Result<()> {
    // Fast path: daemon is already running
    if is_daemon_running() {
        return Ok(());
    }

    // Try to acquire the spawn lock
    // If another process holds it, they're spawning - just wait for daemon
    let _lock = match acquire_spawn_lock() {
        Ok(lock) => lock,
        Err(_) => {
            // Another process is spawning, wait for daemon to be ready
            tracing::info!("Another process is spawning daemon, waiting...");
            return wait_for_daemon(DEFAULT_DAEMON_TIMEOUT).await;
        }
    };

    // Double-check after acquiring lock (another process may have just finished)
    if is_daemon_running() {
        return Ok(());
    }

    tracing::info!("Daemon not running, spawning...");
    spawn_daemon()?;

    // Wait for daemon to be ready to accept connections
    wait_for_daemon(DEFAULT_DAEMON_TIMEOUT).await
}

/// Wait for daemon to be ready to accept connections
///
/// # Errors
///
/// Returns an error if the daemon doesn't become ready within the timeout.
pub async fn wait_for_daemon(timeout: Duration) -> anyhow::Result<()> {
    use tokio::net::UnixStream;

    let socket_path = paths::socket_path();
    let start = std::time::Instant::now();

    while start.elapsed() < timeout {
        // Try to actually connect to verify daemon is responsive
        if UnixStream::connect(&socket_path).await.is_ok() {
            tracing::info!(
                elapsed_ms = start.elapsed().as_millis() as u64,
                "Daemon is ready"
            );
            return Ok(());
        }
        tokio::time::sleep(POLL_INTERVAL).await;
    }

    anyhow::bail!("Daemon not ready after {}ms", timeout.as_millis())
}
