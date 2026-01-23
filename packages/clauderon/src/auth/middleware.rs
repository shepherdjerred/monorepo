use axum::{
    body::Body,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::Response,
};
use axum_extra::extract::cookie::CookieJar;
use uuid::Uuid;

use super::session::SessionStore;

/// Extension key for storing the authenticated user ID
#[derive(Clone)]
pub struct AuthenticatedUserId(pub Uuid);

/// Auth middleware state
#[derive(Clone)]
pub struct AuthMiddlewareState {
    pub session_store: SessionStore,
}

/// Middleware to require authentication
///
/// Validates the `clauderon_session` cookie and inserts the user ID into request extensions
///
/// Returns 401 if the session is invalid or missing
///
/// # Errors
/// Returns a 401 status code if the session cookie is missing, invalid, or expired
pub async fn auth_middleware(
    State(state): State<AuthMiddlewareState>,
    jar: CookieJar,
    mut request: Request<Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    // Extract session cookie
    let session_cookie = jar
        .get("clauderon_session")
        .ok_or(StatusCode::UNAUTHORIZED)?;

    // Parse session ID
    let session_id = Uuid::parse_str(session_cookie.value()).map_err(|_| {
        tracing::warn!("Invalid session ID format");
        StatusCode::UNAUTHORIZED
    })?;

    // Validate session
    let session = state
        .session_store
        .get_session(session_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to get session: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?
        .ok_or_else(|| {
            tracing::debug!("Session not found or expired: {}", session_id);
            StatusCode::UNAUTHORIZED
        })?;

    // Insert user ID into request extensions
    request
        .extensions_mut()
        .insert(AuthenticatedUserId(session.user_id));

    Ok(next.run(request).await)
}
