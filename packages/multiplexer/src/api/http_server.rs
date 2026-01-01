use crate::core::manager::SessionManager;
use crate::api::protocol::CreateSessionRequest;
use crate::api::static_files::serve_static;
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
    state.session_manager.delete_session(&id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Archive a session
async fn archive_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<StatusCode, AppError> {
    state.session_manager.archive_session(&id).await?;
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
    state
        .session_manager
        .update_access_mode(&id, request.access_mode)
        .await?;
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

/// Custom error type for HTTP handlers
#[derive(Debug)]
pub enum AppError {
    SessionManager(anyhow::Error),
    NotFound(String),
    NotImplemented(String),
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
        };

        let body = Json(json!({
            "error": error_message,
        }));

        (status, body).into_response()
    }
}
