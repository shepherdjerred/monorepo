//! Tests for observability infrastructure.

use clauderon::observability::{CorrelationId, OperationContext};
use uuid::Uuid;

#[test]
fn test_correlation_id_generation() {
    let id1 = CorrelationId::new();
    let id2 = CorrelationId::new();

    // IDs should be unique
    assert_ne!(id1, id2);

    // IDs should be valid UUIDs
    let uuid: Uuid = id1.into();
    assert!(!uuid.to_string().is_empty());
}

#[test]
fn test_correlation_id_display() {
    let id = CorrelationId::new();
    let display = format!("{}", id);

    // UUID format is 36 characters
    assert_eq!(display.len(), 36);

    // Should be parseable as UUID
    assert!(Uuid::parse_str(&display).is_ok());
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

    assert_eq!(ctx.operation, "test_op");
    assert_eq!(ctx.session_id, Some(session_id));
}

#[test]
fn test_operation_context_elapsed() {
    let ctx = OperationContext::new("timing_test");

    // Sleep a small amount to ensure time passes
    std::thread::sleep(std::time::Duration::from_millis(10));

    let elapsed = ctx.elapsed_ms();
    assert!(elapsed >= 10, "Expected at least 10ms elapsed, got {}", elapsed);
}

#[test]
fn test_correlation_id_roundtrip() {
    let id = CorrelationId::new();
    let uuid: Uuid = id.into();
    let id2: CorrelationId = uuid.into();

    assert_eq!(id, id2);
}
