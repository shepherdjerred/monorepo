use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use chrono::{Duration, Utc};
use serde_json::json;
use sqlx::SqlitePool;
use uuid::Uuid;
use webauthn_rs::prelude::*;

use super::{
    session::SessionStore,
    types::{
        AuthStatus, AuthUser, LoginFinishRequest, LoginFinishResponse, LoginStartRequest,
        LoginStartResponse, PasskeyRow, RegistrationFinishRequest, RegistrationFinishResponse,
        RegistrationStartRequest, RegistrationStartResponse, UserRow, WebAuthnChallengeRow,
    },
    webauthn::WebAuthnHandler,
};

/// Shared state for auth handlers
#[derive(Clone)]
pub struct AuthState {
    pub pool: SqlitePool,
    pub webauthn: WebAuthnHandler,
    pub session_store: SessionStore,
    pub requires_auth: bool,
}

/// Custom error type for auth handlers
#[derive(Debug)]
pub enum AuthError {
    Database(anyhow::Error),
    NotFound(String),
    BadRequest(String),
    Unauthorized(String),
}

impl From<anyhow::Error> for AuthError {
    fn from(err: anyhow::Error) -> Self {
        Self::Database(err)
    }
}

impl From<sqlx::Error> for AuthError {
    fn from(err: sqlx::Error) -> Self {
        Self::Database(err.into())
    }
}

impl From<serde_json::Error> for AuthError {
    fn from(err: serde_json::Error) -> Self {
        Self::Database(err.into())
    }
}

impl From<chrono::ParseError> for AuthError {
    fn from(err: chrono::ParseError) -> Self {
        Self::Database(err.into())
    }
}

impl From<uuid::Error> for AuthError {
    fn from(err: uuid::Error) -> Self {
        Self::Database(err.into())
    }
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        let (status, error_message) = match self {
            Self::Database(err) => {
                tracing::error!("Database error: {}", err);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Internal error: {}", err),
                )
            }
            Self::NotFound(msg) => (StatusCode::NOT_FOUND, msg),
            Self::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg),
            Self::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg),
        };

        let body = Json(json!({
            "error": error_message,
        }));

        (status, body).into_response()
    }
}

/// GET /api/auth/status
///
/// Returns authentication status (always public)
pub async fn auth_status(
    State(state): State<AuthState>,
    jar: CookieJar,
) -> Result<Json<AuthStatus>, AuthError> {
    // Check if any users exist
    let user_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&state.pool)
        .await?;

    let has_users = user_count > 0;

    // Try to get current user from session cookie
    let current_user = if let Some(session_cookie) = jar.get("clauderon_session") {
        if let Ok(session_id) = Uuid::parse_str(session_cookie.value()) {
            if let Ok(Some(session)) = state.session_store.get_session(session_id).await {
                // Get user from database
                let user_row: Option<UserRow> = sqlx::query_as::<_, UserRow>(
                    "SELECT id, username, display_name, created_at FROM users WHERE id = ?",
                )
                .bind(session.user_id.to_string())
                .fetch_optional(&state.pool)
                .await?;

                user_row.map(AuthUser::from)
            } else {
                None
            }
        } else {
            None
        }
    } else {
        None
    };

    Ok(Json(AuthStatus {
        requires_auth: state.requires_auth,
        has_users,
        current_user,
    }))
}

/// POST /api/auth/register/start
///
/// Start passkey registration
pub async fn register_start(
    State(state): State<AuthState>,
    Json(request): Json<RegistrationStartRequest>,
) -> Result<Json<RegistrationStartResponse>, AuthError> {
    // Check if username already exists
    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM users WHERE username = ?")
        .bind(&request.username)
        .fetch_optional(&state.pool)
        .await?;

    if existing.is_some() {
        return Err(AuthError::BadRequest("Username already exists".to_string()));
    }

    // Generate new user ID
    let user_id = Uuid::new_v4();

    // Start WebAuthn registration
    let (challenge, passkey_registration) = state
        .webauthn
        .start_registration(&request.username, &user_id)?;

    // Store challenge in database (expires in 5 minutes)
    let challenge_id = Uuid::new_v4();
    let now = Utc::now();
    let expires_at = now + Duration::minutes(5);
    let challenge_json = serde_json::to_string(&passkey_registration)?;

    sqlx::query(
        r"
        INSERT INTO webauthn_challenges (id, username, challenge_json, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
        ",
    )
    .bind(challenge_id.to_string())
    .bind(&request.username)
    .bind(&challenge_json)
    .bind(expires_at.to_rfc3339())
    .bind(now.to_rfc3339())
    .execute(&state.pool)
    .await?;

    // Convert challenge to JSON
    let options = serde_json::to_value(&challenge)?;

    Ok(Json(RegistrationStartResponse {
        challenge_id: challenge_id.to_string(),
        options,
    }))
}

/// POST /api/auth/register/finish
///
/// Finish passkey registration and create user
pub async fn register_finish(
    State(state): State<AuthState>,
    jar: CookieJar,
    Json(request): Json<RegistrationFinishRequest>,
) -> Result<(CookieJar, Json<RegistrationFinishResponse>), AuthError> {
    // Get challenge from database using the specific challenge ID
    let challenge_row: Option<WebAuthnChallengeRow> = sqlx::query_as::<_, WebAuthnChallengeRow>(
        "SELECT id, username, challenge_json, expires_at, created_at FROM webauthn_challenges WHERE id = ? AND username = ?",
    )
    .bind(&request.challenge_id)
    .bind(&request.username)
    .fetch_optional(&state.pool)
    .await?;

    let Some(challenge_row) = challenge_row else {
        return Err(AuthError::BadRequest(
            "No registration challenge found".to_string(),
        ));
    };

    // Check if expired
    let expires_at = chrono::DateTime::parse_from_rfc3339(&challenge_row.expires_at)?;
    if expires_at < Utc::now() {
        // Delete expired challenge
        sqlx::query("DELETE FROM webauthn_challenges WHERE id = ?")
            .bind(&challenge_row.id)
            .execute(&state.pool)
            .await?;
        return Err(AuthError::BadRequest(
            "Registration challenge expired".to_string(),
        ));
    }

    // Parse challenge state
    let passkey_registration: PasskeyRegistration =
        serde_json::from_str(&challenge_row.challenge_json)?;

    // Parse credential from request
    let credential: RegisterPublicKeyCredential = serde_json::from_value(request.credential)?;

    // Verify and finish registration
    let passkey = state
        .webauthn
        .finish_registration(&credential, &passkey_registration)?;

    // Delete challenge (single-use)
    sqlx::query("DELETE FROM webauthn_challenges WHERE id = ?")
        .bind(&challenge_row.id)
        .execute(&state.pool)
        .await?;

    // Create user
    let user_id = Uuid::new_v4();
    let now = Utc::now();

    sqlx::query(
        r"
        INSERT INTO users (id, username, display_name, created_at)
        VALUES (?, ?, ?, ?)
        ",
    )
    .bind(user_id.to_string())
    .bind(&request.username)
    .bind(&request.username) // Use username as display_name by default
    .bind(now.to_rfc3339())
    .execute(&state.pool)
    .await?;

    // Store passkey
    let passkey_id = Uuid::new_v4();
    let credential_id = passkey.cred_id().clone();
    let public_key = serde_json::to_vec(&passkey)?;
    let transports = serde_json::to_string(&Vec::<String>::new())?; // Empty transports for now

    sqlx::query(
        r"
        INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports, device_name, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ",
    )
    .bind(passkey_id.to_string())
    .bind(user_id.to_string())
    .bind(credential_id.as_ref() as &[u8])
    .bind(&public_key)
    .bind(0i64)
    .bind(&transports)
    .bind(&request.device_name)
    .bind(now.to_rfc3339())
    .execute(&state.pool)
    .await?;

    // Create session
    let session_id = state.session_store.create_session(user_id).await?;

    // Set session cookie
    let mut cookie = Cookie::new("clauderon_session", session_id.to_string());
    cookie.set_http_only(true);
    cookie.set_same_site(SameSite::Strict);
    cookie.set_path("/");
    cookie.set_max_age(time::Duration::days(30));

    // Only set Secure flag if not localhost
    if state.requires_auth {
        cookie.set_secure(true);
    }

    let jar = jar.add(cookie);

    // Return user
    let user = AuthUser {
        id: user_id.to_string(),
        username: request.username.clone(),
        display_name: Some(request.username),
        created_at: now.to_rfc3339(),
    };

    Ok((jar, Json(RegistrationFinishResponse { user })))
}

/// POST /api/auth/login/start
///
/// Start passkey authentication
pub async fn login_start(
    State(state): State<AuthState>,
    Json(request): Json<LoginStartRequest>,
) -> Result<Json<LoginStartResponse>, AuthError> {
    // Get user
    let user_row: Option<UserRow> = sqlx::query_as::<_, UserRow>(
        "SELECT id, username, display_name, created_at FROM users WHERE username = ?",
    )
    .bind(&request.username)
    .fetch_optional(&state.pool)
    .await?;

    let Some(user_row) = user_row else {
        return Err(AuthError::NotFound("User not found".to_string()));
    };

    // Get user's passkeys
    let passkey_rows: Vec<PasskeyRow> = sqlx::query_as::<_, PasskeyRow>(
        "SELECT id, user_id, credential_id, public_key, counter, transports, device_name, created_at FROM passkeys WHERE user_id = ?",
    )
    .bind(&user_row.id)
    .fetch_all(&state.pool)
    .await?;

    if passkey_rows.is_empty() {
        return Err(AuthError::BadRequest("User has no passkeys".to_string()));
    }

    // Convert to Passkey objects
    let passkeys: Vec<Passkey> = passkey_rows
        .iter()
        .filter_map(|row| serde_json::from_slice(&row.public_key).ok())
        .collect();

    if passkeys.is_empty() {
        return Err(AuthError::BadRequest("Failed to load passkeys".to_string()));
    }

    // Start WebAuthn authentication
    let (challenge, passkey_authentication) = state.webauthn.start_authentication(&passkeys)?;

    // Store challenge in database (expires in 5 minutes)
    let challenge_id = Uuid::new_v4();
    let now = Utc::now();
    let expires_at = now + Duration::minutes(5);
    let challenge_json = serde_json::to_string(&passkey_authentication)?;

    sqlx::query(
        r"
        INSERT INTO webauthn_challenges (id, username, challenge_json, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)
        ",
    )
    .bind(challenge_id.to_string())
    .bind(&request.username)
    .bind(&challenge_json)
    .bind(expires_at.to_rfc3339())
    .bind(now.to_rfc3339())
    .execute(&state.pool)
    .await?;

    // Convert challenge to JSON
    let options = serde_json::to_value(&challenge)?;

    Ok(Json(LoginStartResponse {
        challenge_id: challenge_id.to_string(),
        options,
    }))
}

/// POST /api/auth/login/finish
///
/// Finish passkey authentication and create session
pub async fn login_finish(
    State(state): State<AuthState>,
    jar: CookieJar,
    Json(request): Json<LoginFinishRequest>,
) -> Result<(CookieJar, Json<LoginFinishResponse>), AuthError> {
    // Get challenge from database using the specific challenge ID
    let challenge_row: Option<WebAuthnChallengeRow> = sqlx::query_as::<_, WebAuthnChallengeRow>(
        "SELECT id, username, challenge_json, expires_at, created_at FROM webauthn_challenges WHERE id = ? AND username = ?",
    )
    .bind(&request.challenge_id)
    .bind(&request.username)
    .fetch_optional(&state.pool)
    .await?;

    let Some(challenge_row) = challenge_row else {
        return Err(AuthError::BadRequest(
            "No authentication challenge found".to_string(),
        ));
    };

    // Check if expired
    let expires_at = chrono::DateTime::parse_from_rfc3339(&challenge_row.expires_at)?;
    if expires_at < Utc::now() {
        // Delete expired challenge
        sqlx::query("DELETE FROM webauthn_challenges WHERE id = ?")
            .bind(&challenge_row.id)
            .execute(&state.pool)
            .await?;
        return Err(AuthError::BadRequest(
            "Authentication challenge expired".to_string(),
        ));
    }

    // Parse challenge state
    let passkey_authentication: PasskeyAuthentication =
        serde_json::from_str(&challenge_row.challenge_json)?;

    // Parse credential from request
    let credential: PublicKeyCredential = serde_json::from_value(request.credential)?;

    // Verify and finish authentication
    let result = state
        .webauthn
        .finish_authentication(&credential, &passkey_authentication)?;

    // Delete challenge (single-use)
    sqlx::query("DELETE FROM webauthn_challenges WHERE id = ?")
        .bind(&challenge_row.id)
        .execute(&state.pool)
        .await?;

    // Get user
    let user_row: Option<UserRow> = sqlx::query_as::<_, UserRow>(
        "SELECT id, username, display_name, created_at FROM users WHERE username = ?",
    )
    .bind(&request.username)
    .fetch_optional(&state.pool)
    .await?;

    let Some(user_row) = user_row else {
        return Err(AuthError::NotFound("User not found".to_string()));
    };

    let user_id = Uuid::parse_str(&user_row.id)?;

    // Update passkey counter to prevent replay attacks
    // The counter should increment with each use
    sqlx::query("UPDATE passkeys SET counter = ? WHERE credential_id = ? AND user_id = ?")
        .bind(i64::from(result.counter()))
        .bind(result.cred_id().as_slice())
        .bind(user_id.to_string())
        .execute(&state.pool)
        .await?;

    // Create session
    let session_id = state.session_store.create_session(user_id).await?;

    // Set session cookie
    let mut cookie = Cookie::new("clauderon_session", session_id.to_string());
    cookie.set_http_only(true);
    cookie.set_same_site(SameSite::Strict);
    cookie.set_path("/");
    cookie.set_max_age(time::Duration::days(30));

    // Only set Secure flag if not localhost
    if state.requires_auth {
        cookie.set_secure(true);
    }

    let jar = jar.add(cookie);

    // Return user
    let user = AuthUser::from(user_row);

    Ok((jar, Json(LoginFinishResponse { user })))
}

/// POST /api/auth/logout
///
/// Delete current session
pub async fn logout(
    State(state): State<AuthState>,
    jar: CookieJar,
) -> Result<(CookieJar, StatusCode), AuthError> {
    // Get session cookie
    if let Some(session_cookie) = jar.get("clauderon_session") {
        if let Ok(session_id) = Uuid::parse_str(session_cookie.value()) {
            // Delete session from database
            state.session_store.delete_session(session_id).await?;
        }
    }

    // Remove cookie
    let jar = jar.remove(Cookie::from("clauderon_session"));

    Ok((jar, StatusCode::NO_CONTENT))
}

// Implement FromRow for database row types
impl sqlx::FromRow<'_, sqlx::sqlite::SqliteRow> for UserRow {
    fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(Self {
            id: row.try_get("id")?,
            username: row.try_get("username")?,
            display_name: row.try_get("display_name")?,
            created_at: row.try_get("created_at")?,
        })
    }
}

impl sqlx::FromRow<'_, sqlx::sqlite::SqliteRow> for PasskeyRow {
    fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(Self {
            id: row.try_get("id")?,
            user_id: row.try_get("user_id")?,
            credential_id: row.try_get("credential_id")?,
            public_key: row.try_get("public_key")?,
            counter: row.try_get("counter")?,
            transports: row.try_get("transports")?,
            device_name: row.try_get("device_name")?,
            created_at: row.try_get("created_at")?,
        })
    }
}

impl sqlx::FromRow<'_, sqlx::sqlite::SqliteRow> for WebAuthnChallengeRow {
    fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Self, sqlx::Error> {
        use sqlx::Row;
        Ok(Self {
            id: row.try_get("id")?,
            username: row.try_get("username")?,
            challenge_json: row.try_get("challenge_json")?,
            expires_at: row.try_get("expires_at")?,
            created_at: row.try_get("created_at")?,
        })
    }
}
