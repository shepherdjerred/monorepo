use crate::api::protocol::{CreateSessionRequest, Event};
use crate::api::static_files::serve_static;
use crate::api::ws_events::{EventBroadcaster, broadcast_event};
use crate::auth::{self, AuthState};
use crate::core::manager::SessionManager;
use crate::core::session::AccessMode;
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    middleware::from_fn_with_state,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
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
    pub auth_state: Option<AuthState>,
}

/// Create the HTTP router with all endpoints (without state)
/// The caller should add WebSocket routes and then call `with_state()`
///
/// If `auth_state` is provided, protected routes will require authentication
pub fn create_router(auth_state: &Option<AuthState>) -> Router<AppState> {
    // Configure CORS for development
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // Create protected routes (sessions and related endpoints)
    let mut protected_routes = Router::new()
        .route("/api/sessions", get(list_sessions))
        .route("/api/sessions", post(create_session))
        .route("/api/sessions/{id}", get(get_session))
        .route("/api/sessions/{id}", delete(delete_session))
        .route("/api/sessions/{id}/archive", post(archive_session))
        .route("/api/sessions/{id}/access-mode", post(update_access_mode))
        .route("/api/sessions/{id}/history", get(get_session_history))
        .route("/api/recent-repos", get(get_recent_repos))
        .route("/api/status", get(get_system_status))
        .route("/api/credentials", post(update_credential));

    // Apply auth middleware to protected routes if authentication is enabled
    if let Some(auth_state) = auth_state {
        protected_routes = protected_routes.route_layer(from_fn_with_state(
            crate::auth::AuthMiddlewareState {
                session_store: auth_state.session_store.clone(),
            },
            crate::auth::auth_middleware,
        ));
    }

    Router::new()
        // Auth endpoints (always public)
        .route("/api/auth/status", get(auth_status_wrapper))
        .route("/api/auth/register/start", post(register_start_wrapper))
        .route("/api/auth/register/finish", post(register_finish_wrapper))
        .route("/api/auth/login/start", post(login_start_wrapper))
        .route("/api/auth/login/finish", post(login_finish_wrapper))
        .route("/api/auth/logout", post(logout_wrapper))
        // Merge protected routes
        .merge(protected_routes)
        // WebSocket endpoints will be added by caller
        // Serve static files for all non-API routes (SPA fallback)
        .fallback(serve_static)
        .layer(cors)
}

// Wrapper handlers to extract AuthState from AppState
// These wrappers preserve error context by using AuthError's IntoResponse implementation
async fn auth_status_wrapper(
    State(state): State<AppState>,
    jar: axum_extra::extract::cookie::CookieJar,
) -> Response {
    let Some(auth_state) = state.auth_state else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Authentication not enabled"})),
        )
            .into_response();
    };
    match auth::auth_status(State(auth_state), jar).await {
        Ok(response) => response.into_response(),
        Err(e) => e.into_response(),
    }
}

async fn register_start_wrapper(
    State(state): State<AppState>,
    Json(request): Json<crate::auth::types::RegistrationStartRequest>,
) -> Response {
    let Some(auth_state) = state.auth_state else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Authentication not enabled"})),
        )
            .into_response();
    };
    match auth::register_start(State(auth_state), Json(request)).await {
        Ok(response) => response.into_response(),
        Err(e) => e.into_response(),
    }
}

async fn register_finish_wrapper(
    State(state): State<AppState>,
    jar: axum_extra::extract::cookie::CookieJar,
    Json(request): Json<crate::auth::types::RegistrationFinishRequest>,
) -> Response {
    let Some(auth_state) = state.auth_state else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Authentication not enabled"})),
        )
            .into_response();
    };
    match auth::register_finish(State(auth_state), jar, Json(request)).await {
        Ok(response) => response.into_response(),
        Err(e) => e.into_response(),
    }
}

async fn login_start_wrapper(
    State(state): State<AppState>,
    Json(request): Json<crate::auth::types::LoginStartRequest>,
) -> Response {
    let Some(auth_state) = state.auth_state else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Authentication not enabled"})),
        )
            .into_response();
    };
    match auth::login_start(State(auth_state), Json(request)).await {
        Ok(response) => response.into_response(),
        Err(e) => e.into_response(),
    }
}

async fn login_finish_wrapper(
    State(state): State<AppState>,
    jar: axum_extra::extract::cookie::CookieJar,
    Json(request): Json<crate::auth::types::LoginFinishRequest>,
) -> Response {
    let Some(auth_state) = state.auth_state else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Authentication not enabled"})),
        )
            .into_response();
    };
    match auth::login_finish(State(auth_state), jar, Json(request)).await {
        Ok(response) => response.into_response(),
        Err(e) => e.into_response(),
    }
}

async fn logout_wrapper(
    State(state): State<AppState>,
    jar: axum_extra::extract::cookie::CookieJar,
) -> Response {
    let Some(auth_state) = state.auth_state else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({"error": "Authentication not enabled"})),
        )
            .into_response();
    };
    match auth::logout(State(auth_state), jar).await {
        Ok(response) => response.into_response(),
        Err(e) => e.into_response(),
    }
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

    let session = state
        .session_manager
        .get_session(&id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("Session not found: {id}")))?;
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
    broadcast_event(
        &state.event_broadcaster,
        Event::SessionCreated(session.clone()),
    )
    .await;

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

/// Query parameters for session history endpoint
#[derive(Debug, Deserialize)]
struct HistoryQueryParams {
    /// Start reading from this line number (1-indexed, for incremental updates)
    since_line: Option<u64>,
    /// Maximum number of lines to return
    limit: Option<usize>,
}

/// Response for session history endpoint
#[derive(Debug, Serialize)]
struct HistoryResponse {
    /// Raw JSONL lines from the history file
    lines: Vec<String>,
    /// Total number of lines in the file
    total_lines: u64,
    /// Whether the history file exists
    file_exists: bool,
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
    let repos_dto: Vec<crate::api::protocol::RecentRepoDto> = repos
        .iter()
        .map(|r| crate::api::protocol::RecentRepoDto {
            repo_path: r.repo_path.to_string_lossy().to_string(),
            last_used: r.last_used.to_rfc3339(),
        })
        .collect();

    Ok(Json(json!({ "repos": repos_dto })))
}

/// Get system status (credentials and proxies)
async fn get_system_status(
    State(state): State<AppState>,
) -> Result<Json<crate::api::protocol::SystemStatus>, AppError> {
    let status = state.session_manager.get_system_status().await?;
    Ok(Json(status))
}

/// Update a credential
async fn update_credential(
    State(state): State<AppState>,
    Json(request): Json<crate::api::protocol::UpdateCredentialRequest>,
) -> Result<StatusCode, AppError> {
    state
        .session_manager
        .update_credential(&request.service_id, &request.value)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}

/// Get session history from Claude Code's JSONL file
///
/// Query parameters:
/// - `since_line`: Optional line number to start from (for incremental updates)
/// - `limit`: Optional max number of lines to return (default: all)
async fn get_session_history(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(params): Query<HistoryQueryParams>,
) -> Result<Json<HistoryResponse>, AppError> {
    validate_session_id(&id)?;

    let session = state
        .session_manager
        .get_session(&id)
        .await
        .ok_or_else(|| AppError::NotFound(format!("Session not found: {id}")))?;

    let history_path = session
        .history_file_path
        .ok_or_else(|| AppError::NotFound("History file path not configured".to_string()))?;

    // Security: Validate path is within worktree bounds and matches expected pattern
    if !history_path.starts_with(&session.worktree_path) {
        return Err(AppError::BadRequest(
            "Invalid history file path: outside worktree".to_string(),
        ));
    }

    // Verify path matches expected pattern (defense in depth)
    let expected_path =
        crate::core::session::get_history_file_path(&session.worktree_path, &session.id);
    if history_path != expected_path {
        return Err(AppError::BadRequest(
            "Invalid history file path: pattern mismatch".to_string(),
        ));
    }

    // Check if file exists
    if !history_path.exists() {
        return Ok(Json(HistoryResponse {
            lines: vec![],
            total_lines: 0,
            file_exists: false,
        }));
    }

    // Read file with optional offset
    let file = tokio::fs::File::open(&history_path)
        .await
        .map_err(|e| AppError::BadRequest(format!("Failed to read history: {e}")))?;

    let reader = tokio::io::BufReader::new(file);
    let mut lines_stream = tokio::io::AsyncBufReadExt::lines(reader);

    let mut lines = Vec::new();
    let mut line_num = 0u64;
    let since_line = params.since_line.unwrap_or(0);
    let limit = params.limit.unwrap_or(usize::MAX);

    while let Some(line) = lines_stream
        .next_line()
        .await
        .map_err(|e| AppError::BadRequest(format!("Failed to read line: {e}")))?
    {
        line_num += 1;

        // Skip lines before since_line
        if line_num <= since_line {
            continue;
        }

        lines.push(line);

        if lines.len() >= limit {
            break;
        }
    }

    Ok(Json(HistoryResponse {
        lines,
        total_lines: line_num,
        file_exists: true,
    }))
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
        return Err(AppError::BadRequest(
            "Invalid session ID length".to_string(),
        ));
    }

    // Check for path traversal attempts
    if id.contains("..") || id.contains('/') || id.contains('\\') || id.contains('\0') {
        return Err(AppError::BadRequest(
            "Invalid session ID format".to_string(),
        ));
    }

    // Check for control characters
    if id.chars().any(char::is_control) {
        return Err(AppError::BadRequest(
            "Invalid session ID format".to_string(),
        ));
    }

    // Session IDs should only contain alphanumeric, hyphens, and underscores
    if !id
        .chars()
        .all(|c| c.is_alphanumeric() || c == '-' || c == '_')
    {
        return Err(AppError::BadRequest(
            "Invalid session ID format".to_string(),
        ));
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
        Self::SessionManager(err)
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, error_message) = match self {
            Self::SessionManager(err) => {
                tracing::error!("Session manager error: {err}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Internal error: {err}"),
                )
            }
            Self::NotFound(msg) => (StatusCode::NOT_FOUND, msg),
            Self::NotImplemented(msg) => (StatusCode::NOT_IMPLEMENTED, msg),
            Self::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
        };

        let body = Json(json!({
            "error": error_message,
        }));

        (status, body).into_response()
    }
}
