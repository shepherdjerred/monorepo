use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use typeshare::typeshare;
use uuid::Uuid;

/// User account.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct AuthUser {
    /// User ID.
    pub id: String,
    /// Username for login.
    pub username: String,
    /// Optional display name.
    pub display_name: Option<String>,
    /// Account creation timestamp.
    pub created_at: String,
}

/// User's passkey credential.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct UserPasskey {
    /// Passkey ID.
    pub id: String,
    /// Owner user ID.
    pub user_id: String,
    /// Human-readable device name.
    pub device_name: Option<String>,
    /// Passkey creation timestamp.
    pub created_at: String,
}

/// Authentication status response.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct AuthStatus {
    /// Whether authentication is required for this instance.
    pub requires_auth: bool,
    /// Whether any users exist in the database.
    pub has_users: bool,
    /// Currently authenticated user (if any).
    pub current_user: Option<AuthUser>,
}

/// Request to start passkey registration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct RegistrationStartRequest {
    /// Desired username.
    pub username: String,
    /// Optional display name.
    pub display_name: Option<String>,
}

/// Response from registration start.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct RegistrationStartResponse {
    /// Challenge ID for completing registration.
    pub challenge_id: String,
    /// WebAuthn public key credential creation options.
    #[typeshare(typescript(type = "any"))]
    pub options: serde_json::Value, // PublicKeyCredentialCreationOptions
}

/// Request to finish passkey registration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct RegistrationFinishRequest {
    /// Username being registered.
    pub username: String,
    /// Challenge ID from registration start.
    pub challenge_id: String,
    /// WebAuthn public key credential response.
    #[typeshare(typescript(type = "any"))]
    pub credential: serde_json::Value, // PublicKeyCredential
    /// Human-readable device name for the passkey.
    pub device_name: Option<String>,
}

/// Response from registration finish.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct RegistrationFinishResponse {
    /// Created user account.
    pub user: AuthUser,
}

/// Request to start passkey authentication.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct LoginStartRequest {
    /// Username to authenticate.
    pub username: String,
}

/// Response from login start.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct LoginStartResponse {
    /// Challenge ID for completing login.
    pub challenge_id: String,
    /// WebAuthn public key credential request options.
    #[typeshare(typescript(type = "any"))]
    pub options: serde_json::Value, // PublicKeyCredentialRequestOptions
}

/// Request to finish passkey authentication.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct LoginFinishRequest {
    /// Username being authenticated.
    pub username: String,
    /// Challenge ID from login start.
    pub challenge_id: String,
    /// WebAuthn public key credential response.
    #[typeshare(typescript(type = "any"))]
    pub credential: serde_json::Value, // PublicKeyCredential
}

/// Response from login finish.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[typeshare]
pub struct LoginFinishResponse {
    /// Authenticated user account.
    pub user: AuthUser,
}

/// Internal database models (not exposed to TypeScript).
/// User row from database.
#[derive(Debug, Clone)]
pub(super) struct UserRow {
    /// User ID.
    pub id: String,
    /// Username.
    pub username: String,
    /// Optional display name.
    pub display_name: Option<String>,
    /// Creation timestamp.
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

/// Passkey row from database.
#[derive(Debug, Clone)]
pub(super) struct PasskeyRow {
    /// Passkey ID.
    pub id: String,
    /// Owner user ID.
    pub user_id: String,
    /// Raw credential ID bytes.
    pub credential_id: Vec<u8>,
    /// Serialized public key data.
    pub public_key: Vec<u8>,
    /// Signature counter for replay protection.
    pub counter: i64,
    /// Serialized transport types.
    pub transports: String,
    /// Human-readable device name.
    pub device_name: Option<String>,
    /// Creation timestamp.
    pub created_at: String,
}

/// Auth session row from database.
#[derive(Debug, Clone)]
pub(super) struct AuthSessionRow {
    /// Session ID.
    pub id: String,
    /// Owner user ID.
    pub user_id: String,
    /// Session expiration timestamp.
    pub expires_at: String,
    /// Session creation timestamp.
    pub created_at: String,
}

/// WebAuthn challenge row from database.
#[derive(Debug, Clone)]
pub(super) struct WebAuthnChallengeRow {
    /// Challenge ID.
    pub id: String,
    /// Associated username.
    pub username: String,
    /// Serialized challenge JSON.
    pub challenge_json: String,
    /// Challenge expiration timestamp.
    pub expires_at: String,
    /// Challenge creation timestamp.
    pub created_at: String,
}

/// Internal auth session (parsed from database).
#[derive(Debug, Clone, Copy)]
pub struct AuthSession {
    /// Session ID.
    pub id: Uuid,
    /// Owner user ID.
    pub user_id: Uuid,
    /// Session expiration time.
    pub expires_at: DateTime<Utc>,
    /// Session creation time.
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
