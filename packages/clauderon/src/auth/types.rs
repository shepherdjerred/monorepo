use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use typeshare::typeshare;
use uuid::Uuid;

/// User account
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct AuthUser {
    /// Unique user identifier.
    pub id: String,
    /// Login username.
    pub username: String,
    /// Optional display name.
    pub display_name: Option<String>,
    /// Account creation timestamp (ISO 8601).
    pub created_at: String,
}

/// User's passkey credential
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct UserPasskey {
    /// Unique passkey identifier.
    pub id: String,
    /// Owner user ID.
    pub user_id: String,
    /// Optional device name for the passkey.
    pub device_name: Option<String>,
    /// Passkey registration timestamp (ISO 8601).
    pub created_at: String,
}

/// Authentication status response
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct AuthStatus {
    /// Whether authentication is required for this instance
    pub requires_auth: bool,
    /// Whether any users exist in the database
    pub has_users: bool,
    /// Currently authenticated user (if any)
    pub current_user: Option<AuthUser>,
}

/// Request to start passkey registration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct RegistrationStartRequest {
    /// Desired username.
    pub username: String,
    /// Optional display name.
    pub display_name: Option<String>,
}

/// Response from registration start
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct RegistrationStartResponse {
    /// Server-generated challenge identifier.
    pub challenge_id: String,
    /// WebAuthn credential creation options.
    #[typeshare(typescript(type = "any"))]
    pub options: serde_json::Value, // PublicKeyCredentialCreationOptions
}

/// Request to finish passkey registration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct RegistrationFinishRequest {
    /// Username being registered.
    pub username: String,
    /// Challenge ID from the start response.
    pub challenge_id: String,
    /// WebAuthn credential from the browser.
    #[typeshare(typescript(type = "any"))]
    pub credential: serde_json::Value, // PublicKeyCredential
    /// Optional name for the authenticator device.
    pub device_name: Option<String>,
}

/// Response from registration finish
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct RegistrationFinishResponse {
    /// The newly created user.
    pub user: AuthUser,
}

/// Request to start passkey authentication
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct LoginStartRequest {
    /// Username to authenticate.
    pub username: String,
}

/// Response from login start
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct LoginStartResponse {
    /// Server-generated challenge identifier.
    pub challenge_id: String,
    /// WebAuthn credential request options.
    #[typeshare(typescript(type = "any"))]
    pub options: serde_json::Value, // PublicKeyCredentialRequestOptions
}

/// Request to finish passkey authentication
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct LoginFinishRequest {
    /// Username being authenticated.
    pub username: String,
    /// Challenge ID from the start response.
    pub challenge_id: String,
    /// WebAuthn credential from the browser.
    #[typeshare(typescript(type = "any"))]
    pub credential: serde_json::Value, // PublicKeyCredential
}

/// Response from login finish
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct LoginFinishResponse {
    /// The authenticated user.
    pub user: AuthUser,
}

/// Internal database models (not exposed to TypeScript)
/// User row from database
#[derive(Debug, Clone)]
pub(super) struct UserRow {
    pub id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub created_at: String,
}

impl From<UserRow> for AuthUser {
    fn from(row: UserRow) -> Self {
        Self {
            id: row.id,
            username: row.username,
            display_name: row.display_name,
            created_at: row.created_at,
        }
    }
}

/// Passkey row from database
#[derive(Debug, Clone)]
pub(super) struct PasskeyRow {
    pub id: String,
    pub user_id: String,
    pub credential_id: Vec<u8>,
    pub public_key: Vec<u8>,
    pub counter: i64,
    pub transports: String,
    pub device_name: Option<String>,
    pub created_at: String,
}

/// Auth session row from database
#[derive(Debug, Clone)]
pub(super) struct AuthSessionRow {
    pub id: String,
    pub user_id: String,
    pub expires_at: String,
    pub created_at: String,
}

/// WebAuthn challenge row from database
#[derive(Debug, Clone)]
pub(super) struct WebAuthnChallengeRow {
    pub id: String,
    pub username: String,
    pub challenge_json: String,
    pub expires_at: String,
    pub created_at: String,
}

/// Internal auth session (parsed from database)
#[derive(Debug, Clone, Copy)]
pub struct AuthSession {
    /// Session ID.
    pub id: Uuid,
    /// Owner user ID.
    pub user_id: Uuid,
    /// When this session expires.
    pub expires_at: DateTime<Utc>,
    /// When this session was created.
    pub created_at: DateTime<Utc>,
}

impl TryFrom<AuthSessionRow> for AuthSession {
    type Error = anyhow::Error;

    fn try_from(row: AuthSessionRow) -> Result<Self, Self::Error> {
        Ok(Self {
            id: Uuid::parse_str(&row.id)?,
            user_id: Uuid::parse_str(&row.user_id)?,
            expires_at: DateTime::parse_from_rfc3339(&row.expires_at)?.into(),
            created_at: DateTime::parse_from_rfc3339(&row.created_at)?.into(),
        })
    }
}
