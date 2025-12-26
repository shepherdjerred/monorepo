use std::path::PathBuf;

/// Get the base directory for multiplexer data
///
/// # Panics
///
/// Panics if the home directory cannot be determined.
#[must_use]
pub fn base_dir() -> PathBuf {
    dirs::home_dir()
        .expect("Could not find home directory")
        .join(".multiplexer")
}

/// Get the path to the `SQLite` database
#[must_use]
pub fn database_path() -> PathBuf {
    base_dir().join("db.sqlite")
}

/// Get the path to the Unix socket
#[must_use]
pub fn socket_path() -> PathBuf {
    base_dir().join("mux.sock")
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

/// Get the path to the log file
#[must_use]
pub fn log_path() -> PathBuf {
    base_dir().join("logs").join("multiplexer.log")
}

/// Get the path to the config file
#[must_use]
pub fn config_path() -> PathBuf {
    base_dir().join("config.toml")
}
