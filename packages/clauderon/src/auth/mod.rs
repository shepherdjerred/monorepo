pub mod handlers;
pub mod middleware;
pub mod session;
pub mod types;
pub mod webauthn;

// Re-export commonly used types
pub use handlers::{
    auth_status, login_finish, login_start, logout, register_finish, register_start, AuthState,
};
pub use middleware::{auth_middleware, AuthMiddlewareState};
pub use session::SessionStore;
pub use types::{AuthStatus, AuthUser, Passkey};
pub use webauthn::WebAuthnHandler;
