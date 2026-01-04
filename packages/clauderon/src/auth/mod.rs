pub mod handlers;
pub mod middleware;
pub mod session;
pub mod types;
pub mod webauthn;

// Re-export commonly used types
pub use handlers::{
    AuthState, auth_status, login_finish, login_start, logout, register_finish, register_start,
};
pub use middleware::{AuthMiddlewareState, auth_middleware};
pub use session::SessionStore;
pub use types::{AuthStatus, AuthUser, UserPasskey};
pub use webauthn::WebAuthnHandler;
