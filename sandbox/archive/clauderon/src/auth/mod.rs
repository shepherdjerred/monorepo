/// WebAuthn registration and login HTTP handlers.
pub mod handlers;
/// Authentication middleware for protected routes.
pub mod middleware;
/// Cookie-based session management.
pub mod session;
/// Auth request/response types and database models.
pub mod types;
/// WebAuthn configuration and challenge handling.
pub mod webauthn;

// Re-export commonly used types
pub use handlers::{
    AuthState, auth_status, login_finish, login_start, logout, register_finish, register_start,
};
pub use middleware::{AuthMiddlewareState, auth_middleware};
pub use session::SessionStore;
pub use types::{AuthStatus, AuthUser, UserPasskey};
pub use webauthn::WebAuthnHandler;
