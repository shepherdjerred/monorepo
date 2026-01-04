//! Correlation ID infrastructure for tracking operations across boundaries.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

/// Correlation ID for tracking operations through the system.
///
/// This ID is propagated through:
/// - Tracing spans
/// - API requests/responses
/// - WebSocket events
/// - Audit logs
/// - Error context
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CorrelationId(Uuid);

impl CorrelationId {
    /// Generate a new correlation ID.
    #[must_use]
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    /// Get the underlying UUID.
    #[must_use]
    pub const fn as_uuid(&self) -> &Uuid {
        &self.0
    }
}

impl Default for CorrelationId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for CorrelationId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl From<Uuid> for CorrelationId {
    fn from(uuid: Uuid) -> Self {
        Self(uuid)
    }
}

impl From<CorrelationId> for Uuid {
    fn from(id: CorrelationId) -> Self {
        id.0
    }
}

/// Context for an operation, used for structured logging and error tracking.
#[derive(Debug, Clone)]
pub struct OperationContext {
    /// Unique correlation ID for this operation.
    pub correlation_id: CorrelationId,
    /// Associated session ID, if applicable.
    pub session_id: Option<Uuid>,
    /// Operation name (e.g., "create_session", "attach_backend").
    pub operation: String,
    /// When this operation started.
    pub started_at: DateTime<Utc>,
}

impl OperationContext {
    /// Create a new operation context.
    #[must_use]
    pub fn new(operation: impl Into<String>) -> Self {
        Self {
            correlation_id: CorrelationId::new(),
            session_id: None,
            operation: operation.into(),
            started_at: Utc::now(),
        }
    }

    /// Create a new operation context with a session ID.
    #[must_use]
    pub fn with_session(operation: impl Into<String>, session_id: Uuid) -> Self {
        Self {
            correlation_id: CorrelationId::new(),
            session_id: Some(session_id),
            operation: operation.into(),
            started_at: Utc::now(),
        }
    }

    /// Get the elapsed time since this operation started.
    #[must_use]
    pub fn elapsed(&self) -> chrono::Duration {
        Utc::now() - self.started_at
    }

    /// Get elapsed milliseconds.
    #[must_use]
    pub fn elapsed_ms(&self) -> i64 {
        self.elapsed().num_milliseconds()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_correlation_id_generation() {
        let id1 = CorrelationId::new();
        let id2 = CorrelationId::new();
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_correlation_id_display() {
        let id = CorrelationId::new();
        let display = format!("{}", id);
        assert!(!display.is_empty());
        assert_eq!(display.len(), 36); // UUID format
    }

    #[test]
    fn test_operation_context_creation() {
        let ctx = OperationContext::new("test_operation");
        assert_eq!(ctx.operation, "test_operation");
        assert!(ctx.session_id.is_none());
        assert!(ctx.elapsed_ms() >= 0);
    }

    #[test]
    fn test_operation_context_with_session() {
        let session_id = Uuid::new_v4();
        let ctx = OperationContext::with_session("test_op", session_id);
        assert_eq!(ctx.session_id, Some(session_id));
    }
}
