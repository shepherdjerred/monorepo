/// Binary version and build information.
pub mod binary_info;
/// Daemon process management (start, check, wait).
pub mod daemon;
/// Directory listing and path normalization.
pub mod directory;
/// External editor integration for prompt editing.
pub mod editor;
/// Git operations (worktrees, branches, status).
pub mod git;
/// Log file cleanup and rotation.
pub mod log_cleanup;
/// AI-powered session name generation.
pub mod name_generator;
/// Standard filesystem paths (database, sockets, worktrees).
pub mod paths;
/// Random session name generation (adjective-noun pairs).
pub mod random;
/// Terminal query sequence parsing (DSR, DA).
pub mod terminal_queries;

pub use daemon::{ensure_daemon_running, is_daemon_running, wait_for_daemon};
pub use directory::{expand_tilde, normalize_path, read_directories};
pub use name_generator::{SessionMetadata, generate_session_name_ai};
pub use paths::{console_socket_path, database_path, socket_path, worktree_path};
pub use random::generate_session_name;
