//! Core session management logic and domain types.

/// Console PTY management for web terminal sessions.
pub mod console_manager;
/// Domain error types with rich context.
pub mod errors;
/// Event sourcing types for session state changes.
pub mod events;
/// Session health checking service.
pub mod health;
/// Session lifecycle manager.
pub mod manager;
/// Session domain model and related types.
pub mod session;

pub use errors::{BackendError, SessionError};
pub use events::Event;
pub use health::HealthService;
pub use manager::SessionManager;
pub use session::{
    AccessMode, AgentType, AvailableAction, BackendType, BlockerDetails, CheckStatus,
    ClaudeWorkingStatus, HealthCheckResult, MergeMethod, PrReviewStatus, RecreateBlockedError,
    RecreateResult, ResourceState, ReviewDecision, Session, SessionConfig, SessionHealthReport,
    SessionRepository, SessionStatus, WorkflowStage,
};
