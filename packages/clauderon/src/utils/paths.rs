use std::path::PathBuf;

/// Get the base directory for clauderon data
///
/// # Panics
///
/// Panics if the home directory cannot be determined.
#[must_use]
pub fn base_dir() -> PathBuf {
    dirs::home_dir()
        .expect("Could not find home directory")
        .join(".clauderon")
}

/// Get the path to the `SQLite` database
#[must_use]
pub fn database_path() -> PathBuf {
    base_dir().join("db.sqlite")
}

/// Get the path to the Unix socket
#[must_use]
pub fn socket_path() -> PathBuf {
    base_dir().join("clauderon.sock")
}

/// Get the path to the hooks Unix socket
#[must_use]
pub fn hooks_socket_path() -> PathBuf {
    base_dir().join("hooks.sock")
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
    base_dir().join("logs").join("clauderon.log")
}

/// Get the path to the config file
#[must_use]
pub fn config_path() -> PathBuf {
    base_dir().join("config.toml")
}
