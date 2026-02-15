/// HTTP handlers for authentication endpoints.
pub mod handlers;
/// Authentication middleware for protecting routes.
pub mod middleware;
/// Session store for managing auth sessions.
pub mod session;
/// Auth type definitions and database models.
pub mod types;
/// WebAuthn handler for passkey operations.
pub mod webauthn;

// Re-export commonly used types
pub use handlers::{
    AuthState, auth_status, login_finish, login_start, logout, register_finish, register_start,
};
pub use middleware::{AuthMiddlewareState, auth_middleware};
pub use session::SessionStore;
pub use types::{AuthStatus, AuthUser, UserPasskey};
pub use webauthn::WebAuthnHandler;
