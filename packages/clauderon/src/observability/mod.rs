//! Observability infrastructure for Clauderon.
//!
//! This module provides:
//! - Correlation ID tracking for operations
//! - Structured logging utilities
//! - Error context helpers

pub mod correlation;

pub use correlation::{CorrelationId, OperationContext};
