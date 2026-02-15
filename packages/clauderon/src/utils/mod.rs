/// Build-time binary metadata.
pub mod binary_info;
/// Daemon lifecycle management (spawn, health check, wait).
pub mod daemon;
/// Directory expansion and normalization.
pub mod directory;
/// External editor launching.
pub mod editor;
/// Git repository and worktree utilities.
pub mod git;
/// Old log file cleanup.
pub mod log_cleanup;
/// AI-powered session name generation.
pub mod name_generator;
/// Standard filesystem paths for clauderon data.
pub mod paths;
/// Random name and branch name generation.
pub mod random;
/// Terminal query sequence parsing (DSR/DA).
pub mod terminal_queries;

pub use daemon::{ensure_daemon_running, is_daemon_running, wait_for_daemon};
pub use directory::{expand_tilde, normalize_path, read_directories};
pub use name_generator::{SessionMetadata, generate_session_name_ai};
pub use paths::{console_socket_path, database_path, socket_path, worktree_path};
pub use random::generate_session_name;
