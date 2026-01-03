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
    NotFound { session_id: Uuid },

    /// Backend failed to start a session.
    #[error("Backend {backend:?} failed to start session {session_id}: {source}")]
    BackendStartFailed {
        session_id: Uuid,
        backend: BackendType,
        #[source]
        source: anyhow::Error,
    },

    /// Backend failed to stop a session.
    #[error("Backend {backend:?} failed to stop session {session_id}: {source}")]
    BackendStopFailed {
        session_id: Uuid,
        backend: BackendType,
        #[source]
        source: anyhow::Error,
    },

    /// Git worktree creation failed.
    #[error("Git worktree creation failed for session {session_id} at {path}: {source}")]
    WorktreeCreationFailed {
        session_id: Uuid,
        path: PathBuf,
        #[source]
        source: anyhow::Error,
    },

    /// Git worktree removal failed.
    #[error("Git worktree removal failed for session {session_id} at {path}: {source}")]
    WorktreeRemovalFailed {
        session_id: Uuid,
        path: PathBuf,
        #[source]
        source: anyhow::Error,
    },

    /// Session name conflict.
    #[error("Session name '{name}' already exists")]
    NameConflict { name: String },

    /// Failed to generate unique session name.
    #[error("Failed to generate unique session name after {attempts} attempts")]
    NameGenerationFailed { attempts: usize },

    /// Invalid repository path.
    #[error("Invalid repository path '{path}': {reason}")]
    InvalidRepoPath { path: String, reason: String },

    /// Session is in invalid state for operation.
    #[error("Session {session_id} is in invalid state for operation '{operation}': current state is {current_state:?}")]
    InvalidState {
        session_id: Uuid,
        operation: String,
        current_state: String,
    },

    /// History directory creation failed.
    #[error("Failed to create history directory for session {session_id} at {path}: {source}")]
    HistoryDirectoryCreationFailed {
        session_id: Uuid,
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    /// Store operation failed.
    #[error("Store operation failed for session {session_id}: {source}")]
    StoreFailed {
        session_id: Uuid,
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
        backend: BackendType,
        reason: String,
    },

    /// Command execution failed.
    #[error("Command '{command}' failed for backend {backend:?}: {source}")]
    CommandFailed {
        backend: BackendType,
        command: String,
        #[source]
        source: std::io::Error,
    },

    /// Resource not found.
    #[error("Resource '{resource}' not found for backend {backend:?}")]
    ResourceNotFound {
        backend: BackendType,
        resource: String,
    },

    /// Resource already exists.
    #[error("Resource '{resource}' already exists for backend {backend:?}")]
    ResourceExists {
        backend: BackendType,
        resource: String,
    },

    /// Configuration error.
    #[error("Backend {backend:?} configuration error: {message}")]
    ConfigurationError {
        backend: BackendType,
        message: String,
    },

    /// Timeout waiting for operation.
    #[error("Timeout waiting for {operation} on backend {backend:?} after {timeout_ms}ms")]
    Timeout {
        backend: BackendType,
        operation: String,
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
            reason: "not installed".to_string(),
        };
        let msg = err.to_string();
        assert!(msg.contains("Kubernetes"));
        assert!(msg.contains("not installed"));
    }
}
