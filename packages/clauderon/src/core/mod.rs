pub mod console_manager;
pub mod errors;
pub mod events;
pub mod manager;
pub mod session;
pub mod user_preferences;

pub use errors::{BackendError, SessionError};
pub use events::Event;
pub use manager::SessionManager;
pub use session::{
    AccessMode, AgentType, BackendType, CheckStatus, ClaudeWorkingStatus, Session, SessionConfig,
    SessionRepository, SessionStatus,
};
pub use user_preferences::{ExperienceLevel, UserPreferences};
