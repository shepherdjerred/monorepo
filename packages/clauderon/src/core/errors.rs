//! Core error types with rich context for debugging.

use std::path::PathBuf;
use thiserror::Error;
use uuid::Uuid;

use super::session::BackendType;

/// Errors related to session operations.
#[derive(Debug, Error)]
pub enum SessionError {
    /// Session not found.
    #[error("Session {session_id} not found")]
    NotFound {
        /// The session ID that was not found.
        session_id: Uuid,
    },

    /// Backend failed to start a session.
    #[error("Backend {backend:?} failed to start session {session_id}: {source}")]
    BackendStartFailed {
        /// The session that failed to start.
        session_id: Uuid,
        /// The backend that failed.
        backend: BackendType,
        /// The underlying error.
        #[source]
        source: anyhow::Error,
    },

    /// Backend failed to stop a session.
    #[error("Backend {backend:?} failed to stop session {session_id}: {source}")]
    BackendStopFailed {
        /// The session that failed to stop.
        session_id: Uuid,
        /// The backend that failed.
        backend: BackendType,
        /// The underlying error.
        #[source]
        source: anyhow::Error,
    },

    /// Git worktree creation failed.
    #[error("Git worktree creation failed for session {session_id} at {path}: {source}")]
    WorktreeCreationFailed {
        /// The session ID.
        session_id: Uuid,
        /// The worktree path that failed.
        path: PathBuf,
        /// The underlying error.
        #[source]
        source: anyhow::Error,
    },

    /// Git worktree removal failed.
    #[error("Git worktree removal failed for session {session_id} at {path}: {source}")]
    WorktreeRemovalFailed {
        /// The session ID.
        session_id: Uuid,
        /// The worktree path that failed.
        path: PathBuf,
        /// The underlying error.
        #[source]
        source: anyhow::Error,
    },

    /// Session name conflict.
    #[error("Session name '{name}' already exists")]
    NameConflict {
        /// The conflicting name.
        name: String,
    },

    /// Failed to generate unique session name.
    #[error("Failed to generate unique session name after {attempts} attempts")]
    NameGenerationFailed {
        /// Number of attempts made.
        attempts: usize,
    },

    /// Invalid repository path.
    #[error("Invalid repository path '{path}': {reason}")]
    InvalidRepoPath {
        /// The invalid path.
        path: String,
        /// Why the path is invalid.
        reason: String,
    },

    /// Session is in invalid state for operation.
    #[error(
        "Session {session_id} is in invalid state for operation '{operation}': current state is {current_state:?}"
    )]
    InvalidState {
        /// The session ID.
        session_id: Uuid,
        /// The attempted operation.
        operation: String,
        /// The current session state.
        current_state: String,
    },

    /// History directory creation failed.
    #[error("Failed to create history directory for session {session_id} at {path}: {source}")]
    HistoryDirectoryCreationFailed {
        /// The session ID.
        session_id: Uuid,
        /// The directory path.
        path: PathBuf,
        /// The underlying IO error.
        #[source]
        source: std::io::Error,
    },

    /// Store operation failed.
    #[error("Store operation failed for session {session_id}: {source}")]
    StoreFailed {
        /// The session ID.
        session_id: Uuid,
        /// The underlying error.
        #[source]
        source: anyhow::Error,
    },
}

/// Errors related to backend operations.
#[derive(Debug, Error)]
pub enum BackendError {
    /// Backend is not available.
    #[error("Backend {backend:?} is not available: {reason}")]
    Unavailable {
        /// The unavailable backend.
        backend: BackendType,
        /// Why the backend is unavailable.
        reason: String,
    },

    /// Command execution failed.
    #[error("Command '{command}' failed for backend {backend:?}: {source}")]
    CommandFailed {
        /// The backend that failed.
        backend: BackendType,
        /// The command that failed.
        command: String,
        /// The underlying IO error.
        #[source]
        source: std::io::Error,
    },

    /// Resource not found.
    #[error("Resource '{resource}' not found for backend {backend:?}")]
    ResourceNotFound {
        /// The backend type.
        backend: BackendType,
        /// The resource identifier.
        resource: String,
    },

    /// Resource already exists.
    #[error("Resource '{resource}' already exists for backend {backend:?}")]
    ResourceExists {
        /// The backend type.
        backend: BackendType,
        /// The resource identifier.
        resource: String,
    },

    /// Configuration error.
    #[error("Backend {backend:?} configuration error: {message}")]
    ConfigurationError {
        /// The backend type.
        backend: BackendType,
        /// Error message.
        message: String,
    },

    /// Timeout waiting for operation.
    #[error("Timeout waiting for {operation} on backend {backend:?} after {timeout_ms}ms")]
    Timeout {
        /// The backend type.
        backend: BackendType,
        /// The operation that timed out.
        operation: String,
        /// Timeout duration in milliseconds.
        timeout_ms: u64,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_error_not_found() {
        let id = Uuid::new_v4();
        let err = SessionError::NotFound { session_id: id };
        let msg = err.to_string();
        assert!(msg.contains(&id.to_string()));
        assert!(msg.contains("not found"));
    }

    #[test]
    fn test_session_error_backend_start_failed() {
        let id = Uuid::new_v4();
        let err = SessionError::BackendStartFailed {
            session_id: id,
            backend: BackendType::Docker,
            source: anyhow::anyhow!("connection refused"),
        };
        let msg = err.to_string();
        assert!(msg.contains(&id.to_string()));
        assert!(msg.contains("Docker"));
    }

    #[test]
    fn test_backend_error_unavailable() {
        let err = BackendError::Unavailable {
            backend: BackendType::Kubernetes,
            reason: "not installed".to_owned(),
        };
        let msg = err.to_string();
        assert!(msg.contains("Kubernetes"));
        assert!(msg.contains("not installed"));
    }
}
