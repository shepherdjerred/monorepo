/// PTY-based console session management for terminal multiplexing.
pub mod console_manager;
/// Structured error types for session and backend operations.
pub mod errors;
/// Event sourcing types for session state changes.
pub mod events;
/// Health monitoring service for backend resources.
pub mod health;
/// Core session manager coordinating backends, storage, and events.
pub mod manager;
/// Session model, configuration, and status types.
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
