pub mod console_manager;
pub mod errors;
pub mod events;
pub mod manager;
pub mod session;

pub use errors::{BackendError, SessionError};
pub use events::Event;
pub use manager::SessionManager;
pub use session::{
    AccessMode, AgentType, BackendType, BlockerDetails, CheckStatus, ClaudeWorkingStatus,
    ReviewDecision, Session, SessionConfig, SessionRepository, SessionStatus, WorkflowStage,
};
