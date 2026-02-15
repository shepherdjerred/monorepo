use std::path::PathBuf;

/// Get the base directory for clauderon data
///
/// # Panics
///
/// Panics if the home directory cannot be determined.
#[must_use]
pub fn base_dir() -> PathBuf {
    #[expect(clippy::expect_used, reason = "home directory is required for operation")]
    dirs::home_dir()
        .expect("Could not find home directory")
        .join(".clauderon")
}

/// Get the path to the `SQLite` database
#[must_use]
pub fn database_path() -> PathBuf {
    base_dir().join("db.sqlite")
}

/// Get the path to the Unix socket (for CLI client communication)
#[must_use]
pub fn socket_path() -> PathBuf {
    base_dir().join("clauderon.sock")
}

/// Get the path to the console Unix socket (for TUI streaming)
#[must_use]
pub fn console_socket_path() -> PathBuf {
    base_dir().join("clauderon-console.sock")
}

/// Get the directory for worktrees
#[must_use]
pub fn worktrees_dir() -> PathBuf {
    base_dir().join("worktrees")
}

/// Get the path for a specific worktree
#[must_use]
pub fn worktree_path(session_name: &str) -> PathBuf {
    worktrees_dir().join(session_name)
}

/// Get the directory for log files
#[must_use]
pub fn logs_dir() -> PathBuf {
    base_dir().join("logs")
}

/// Get the path to the log file (deprecated: use logs_dir with timestamped filename)
#[must_use]
pub fn log_path() -> PathBuf {
    logs_dir().join("clauderon.log")
}

/// Get the path to the config file
#[must_use]
pub fn config_path() -> PathBuf {
    base_dir().join("config.toml")
}

/// Translate host image paths to container paths for use with container backends
///
/// This function converts absolute paths in the clauderon uploads directory from
/// their host location (`~/.clauderon/uploads/...`) to their container mount location
/// (`/workspace/.clauderon/uploads/...`).
///
/// Paths that are not in the uploads directory are returned unchanged.
///
/// # Arguments
///
/// * `host_path` - The image path on the host system
///
/// # Returns
///
/// The translated container path if the input is an uploads path, otherwise the original path
///
/// # Examples
///
/// ```
/// use clauderon::utils::paths::translate_image_path_to_container;
///
/// // Set HOME to a known value for the test
/// unsafe {
///     std::env::set_var("HOME", "/home/user");
/// }
///
/// let host_path = "/home/user/.clauderon/uploads/session-id/image.png";
/// let container_path = translate_image_path_to_container(host_path);
/// assert_eq!(container_path, "/workspace/.clauderon/uploads/session-id/image.png");
///
/// let relative_path = "relative/path/image.png";
/// let unchanged = translate_image_path_to_container(relative_path);
/// assert_eq!(unchanged, "relative/path/image.png");
/// ```
#[must_use]
pub fn translate_image_path_to_container(host_path: &str) -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/root".to_owned());
    let host_uploads_prefix = format!("{home}/.clauderon/uploads");

    if host_path.starts_with(&host_uploads_prefix) {
        // Replace host prefix with container prefix
        host_path.replace(&host_uploads_prefix, "/workspace/.clauderon/uploads")
    } else {
        // Path not in uploads dir - pass through unchanged (e.g., relative paths to workspace)
        host_path.to_owned()
    }
}
