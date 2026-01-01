use crate::core::manager::SessionManager;
use crate::api::protocol::{CreateSessionRequest, Event};
use crate::api::static_files::serve_static;
use crate::api::ws_events::{broadcast_event, EventBroadcaster};
use crate::core::session::AccessMode;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};

/// Shared state for HTTP handlers
#[derive(Clone)]
pub struct AppState {
    pub session_manager: Arc<SessionManager>,
    pub event_broadcaster: EventBroadcaster,
}

/// Create the HTTP router with all endpoints (without state)
/// The caller should add WebSocket routes and then call with_state()
pub fn create_router() -> Router<AppState> {
    // Configure CORS for development
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        // Session endpoints
        .route("/api/sessions", get(list_sessions))
        .route("/api/sessions", post(create_session))
        .route("/api/sessions/:id", get(get_session))
        .route("/api/sessions/:id", delete(delete_session))
        .route("/api/sessions/:id/archive", post(archive_session))
        .route(
            "/api/sessions/:id/access-mode",
            post(update_access_mode),
        )
        // Other endpoints
        .route("/api/recent-repos", get(get_recent_repos))
        // WebSocket endpoints will be added by caller
        // Serve static files for all non-API routes (SPA fallback)
        .fallback(serve_static)
        .layer(cors)
}

/// List all sessions
async fn list_sessions(State(state): State<AppState>) -> Result<Json<serde_json::Value>, AppError> {
    let sessions = state.session_manager.list_sessions().await;
    Ok(Json(json!({ "sessions": sessions })))
}

/// Get a specific session by ID or name
async fn get_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Validate session ID to prevent path traversal attacks
    validate_session_id(&id)?;

    let session = state.session_manager
        .get_session(&id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("Session not found: {}", id)))?;
    Ok(Json(json!({ "session": session })))
}

/// Create a new session
async fn create_session(
    State(state): State<AppState>,
    Json(request): Json<CreateSessionRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let (session, warnings) = state
        .session_manager
        .create_session(
            request.name,
            request.repo_path,
            request.initial_prompt,
            request.backend,
            request.agent,
            request.dangerous_skip_checks,
            request.print_mode,
            request.plan_mode,
            request.access_mode,
            request.images,
        )
        .await?;

    // Broadcast session created event
    broadcast_event(&state.event_broadcaster, Event::SessionCreated(session.clone())).await;

    Ok(Json(json!({
        "id": session.id.to_string(),
        "warnings": warnings,
    })))
}

/// Delete a session
async fn delete_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    validate_session_id(&id)?;
    state.session_manager.delete_session(&id).await?;

    // Broadcast session deleted event
    broadcast_event(&state.event_broadcaster, Event::SessionDeleted { id }).await;

    Ok(StatusCode::NO_CONTENT)
}

/// Archive a session
async fn archive_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    validate_session_id(&id)?;
    state.session_manager.archive_session(&id).await?;

    // Broadcast session updated event (status changed to Archived)
    if let Some(session) = state.session_manager.get_session(&id).await {
        broadcast_event(&state.event_broadcaster, Event::SessionUpdated(session)).await;
    }

    Ok(StatusCode::NO_CONTENT)
}

/// Request to update access mode
#[derive(Debug, Deserialize, Serialize)]
struct UpdateAccessModeRequest {
    access_mode: AccessMode,
}

/// Update session access mode
async fn update_access_mode(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<UpdateAccessModeRequest>,
) -> Result<StatusCode, AppError> {
    validate_session_id(&id)?;
    state
        .session_manager
        .update_access_mode(&id, request.access_mode)
        .await?;

    // Broadcast session updated event
    if let Some(session) = state.session_manager.get_session(&id).await {
        broadcast_event(&state.event_broadcaster, Event::SessionUpdated(session)).await;
    }

    Ok(StatusCode::NO_CONTENT)
}

/// Get recent repositories
async fn get_recent_repos(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let repos = state.session_manager.get_recent_repos().await?;

    // Convert RecentRepo to RecentRepoDto
    use crate::api::protocol::RecentRepoDto;
    let repos_dto: Vec<RecentRepoDto> = repos
        .iter()
        .map(|r| RecentRepoDto {
            repo_path: r.repo_path.to_string_lossy().to_string(),
            last_used: r.last_used.to_rfc3339(),
        })
        .collect();

    Ok(Json(json!({ "repos": repos_dto })))
}

/// Validate session ID to prevent path traversal and injection attacks
///
/// Session IDs can be either:
/// - UUIDs (8-4-4-4-12 hex digits separated by hyphens)
/// - Session names (alphanumeric with hyphens and underscores)
///
/// We reject anything with:
/// - Path separators (/, \)
/// - Parent directory references (..)
/// - Null bytes
/// - Control characters
fn validate_session_id(id: &str) -> Result<(), AppError> {
    // Check length (reasonable bounds)
    if id.is_empty() || id.len() > 128 {
        return Err(AppError::BadRequest("Invalid session ID length".to_string()));
    }

    // Check for path traversal attempts
    if id.contains("..") || id.contains('/') || id.contains('\\') || id.contains('\0') {
        return Err(AppError::BadRequest("Invalid session ID format".to_string()));
    }

    // Check for control characters
    if id.chars().any(|c| c.is_control()) {
        return Err(AppError::BadRequest("Invalid session ID format".to_string()));
    }

    // Session IDs should only contain alphanumeric, hyphens, and underscores
    if !id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_') {
        return Err(AppError::BadRequest("Invalid session ID format".to_string()));
    }

    Ok(())
}

/// Custom error type for HTTP handlers
#[derive(Debug)]
pub enum AppError {
    SessionManager(anyhow::Error),
    NotFound(String),
    NotImplemented(String),
    BadRequest(String),
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        AppError::SessionManager(err)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error_message) = match self {
            AppError::SessionManager(err) => {
                tracing::error!("Session manager error: {}", err);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Internal error: {}", err),
                )
            }
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg),
            AppError::NotImplemented(msg) => (StatusCode::NOT_IMPLEMENTED, msg),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
        };

        let body = Json(json!({
            "error": error_message,
        }));

        (status, body).into_response()
    }
}
