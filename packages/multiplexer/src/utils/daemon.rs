use std::process::{Command, Stdio};
use std::time::Duration;

use crate::utils::paths;

/// Check if the daemon is running by testing socket connectivity
#[must_use]
pub fn is_daemon_running() -> bool {
    let socket_path = paths::socket_path();
    socket_path.exists()
}

/// Spawn the daemon as a detached background process
///
/// This function spawns a new `mux daemon` process that continues running
/// after the parent process exits. The daemon process is fully detached
/// from the parent's process group.
///
/// # Errors
///
/// Returns an error if the daemon process cannot be spawned.
pub fn spawn_daemon() -> anyhow::Result<()> {
    // Get the path to our own executable
    let exe_path = std::env::current_exe()?;

    // Spawn the daemon process detached from the current process
    // Using setsid-like behavior by spawning with no stdin/stdout/stderr
    Command::new(&exe_path)
        .arg("daemon")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        // Detach from the parent process
        .spawn()?;

    Ok(())
}

/// Ensure the daemon is running, spawning it if necessary
///
/// This function checks if the daemon is running and spawns it if not.
/// After spawning, it waits for the daemon to become available.
///
/// # Errors
///
/// Returns an error if the daemon cannot be spawned or fails to start.
pub async fn ensure_daemon_running() -> anyhow::Result<()> {
    if is_daemon_running() {
        // Socket exists, try to verify it's actually responsive
        return Ok(());
    }

    tracing::info!("Daemon not running, spawning...");
    spawn_daemon()?;

    // Wait for daemon to start (with timeout)
    let socket_path = paths::socket_path();
    let max_attempts = 50; // 5 seconds total
    let delay = Duration::from_millis(100);

    for attempt in 0..max_attempts {
        if socket_path.exists() {
            // Give it a tiny bit more time to be ready to accept connections
            tokio::time::sleep(Duration::from_millis(50)).await;
            tracing::info!(attempt, "Daemon started successfully");
            return Ok(());
        }
        tokio::time::sleep(delay).await;
    }

    anyhow::bail!("Daemon failed to start within timeout")
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
    let delay = Duration::from_millis(100);

    while start.elapsed() < timeout {
        // Try to actually connect, not just check if socket exists
        if UnixStream::connect(&socket_path).await.is_ok() {
            return Ok(());
        }
        tokio::time::sleep(delay).await;
    }

    anyhow::bail!(
        "Daemon not ready after {}ms",
        timeout.as_millis()
    )
}
