pub mod console_manager;
pub mod errors;
pub mod events;
pub mod health;
pub mod manager;
pub mod session;

pub use errors::{BackendError, SessionError};
pub use events::Event;
pub use health::HealthService;
pub use manager::SessionManager;
pub use session::{
    AccessMode, AgentType, AvailableAction, BackendType, BlockerDetails, CheckStatus,
    ClaudeWorkingStatus, HealthCheckResult, RecreateBlockedError, RecreateResult, ResourceState,
    ReviewDecision, Session, SessionConfig, SessionHealthReport, SessionRepository, SessionStatus,
    WorkflowStage,
};
