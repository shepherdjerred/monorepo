//! Account HTTP messages from the pinned official client's `z`, `As`, `Ts`,
//! and `Zr` functions. Hosts execute these requests outside engine locks.

use std::{collections::BTreeMap, fmt};

use serde::Deserialize;
use serde_json::{Value, json};
use zeroize::Zeroizing;

use crate::{
    Result, SyncError,
    crypto::{EncryptionVersion, VaultCipher, VaultKey},
};

/// The fixed account API destination used by the official client.
pub const ACCOUNT_ORIGIN: &str = "https://api.obsidian.md";

/// A secret-bearing account request. Debug never prints headers or body.
pub struct AuthRequest {
    path: &'static str,
    body: Zeroizing<String>,
    kind: RequestKind,
    preflight: bool,
}

#[derive(Clone, Copy)]
enum RequestKind {
    SignIn,
    SignOut,
    UserInfo,
    Vaults,
    Access,
}

impl fmt::Debug for AuthRequest {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AuthRequest")
            .field("path", &self.path)
            .finish_non_exhaustive()
    }
}

impl AuthRequest {
    /// Build email/password authentication. An empty MFA string matches the
    /// reference's initial request. Passwords are not retained after encoding.
    #[must_use]
    pub fn sign_in(email: &str, password: &str, mfa: &str) -> Self {
        Self::build(
            "/user/signin",
            json!({"email":email,"password":password,"mfa":mfa}),
            RequestKind::SignIn,
            true,
        )
    }

    /// Invalidate the existing remote account session.
    #[must_use]
    pub fn sign_out(token: &str) -> Self {
        Self::build(
            "/user/signout",
            json!({"token":token}),
            RequestKind::SignOut,
            false,
        )
    }

    /// Validate an existing secure-storage token and load account metadata.
    #[must_use]
    pub fn user_info(token: &str) -> Self {
        Self::build(
            "/user/info",
            json!({"token":token}),
            RequestKind::UserInfo,
            false,
        )
    }

    /// List owned and shared vaults, negotiating versions through version 3.
    #[must_use]
    pub fn list_vaults(token: &str) -> Self {
        Self::build(
            "/vault/list",
            json!({"token":token,"supported_encryption_version":3}),
            RequestKind::Vaults,
            false,
        )
    }

    /// Validate a derived vault key before configuring the private replica.
    #[must_use]
    pub fn vault_access(token: &str, vault: &RemoteVault, cipher: &VaultCipher) -> Self {
        Self::build(
            "/vault/access",
            json!({"token":token,"vault_uid":vault.id,"keyhash":cipher.key_hash(),"host":vault.host,"encryption_version":vault.encryption_version}),
            RequestKind::Access,
            false,
        )
    }

    fn build(path: &'static str, body: Value, kind: RequestKind, preflight: bool) -> Self {
        Self {
            path,
            body: crate::sensitive_json(body),
            kind,
            preflight,
        }
    }

    /// Destination for the POST and, when required, OPTIONS request.
    #[must_use]
    pub fn url(&self) -> String {
        format!("{ACCOUNT_ORIGIN}{}", self.path)
    }

    /// The native transport must issue an OPTIONS request first for sign-in.
    #[must_use]
    pub fn requires_preflight(&self) -> bool {
        self.preflight
    }

    /// Header values contain no credentials; POST bodies carry the token.
    #[must_use]
    pub fn headers(&self) -> BTreeMap<String, String> {
        let mut headers = BTreeMap::from([("Content-Type".into(), "application/json".into())]);
        if self.preflight {
            headers.insert("Origin".into(), "https://obsidian.md".into());
        }
        headers
    }

    /// Borrow secret-bearing JSON solely for sending through the transport.
    #[must_use]
    pub fn body(&self) -> &str {
        &self.body
    }

    /// Decode the matching response without including response text in errors.
    ///
    /// # Errors
    /// Rejects non-success HTTP status, malformed schemas, or account errors.
    pub fn decode_response(&self, status: u16, body: &str) -> Result<AuthResponse> {
        if !(200..300).contains(&status) {
            return Err(SyncError::Http(status));
        }
        let value: Value = serde_json::from_str(body).map_err(|_| SyncError::Protocol)?;
        if let Some(error) = value.get("error") {
            let text = error.as_str().ok_or(SyncError::Protocol)?;
            if matches!(self.kind, RequestKind::SignIn) && text.contains("2FA code") {
                return Ok(if text.contains("2FA code is incorrect") {
                    AuthResponse::MfaRejected
                } else {
                    AuthResponse::MfaRequired
                });
            }
            return Err(SyncError::AccountRejected);
        }
        match self.kind {
            RequestKind::SignIn => {
                let response: SignInBody =
                    serde_json::from_value(value).map_err(|_| SyncError::Protocol)?;
                if response.token.is_empty() {
                    return Err(SyncError::Protocol);
                }
                Ok(AuthResponse::SignedIn(AccountSession {
                    token: Zeroizing::new(response.token),
                    name: response.name,
                    email: response.email,
                }))
            }
            RequestKind::UserInfo => {
                if !value.is_object() {
                    return Err(SyncError::Protocol);
                }
                Ok(AuthResponse::UserInfo(value))
            }
            RequestKind::Vaults => {
                let list: VaultList =
                    serde_json::from_value(value).map_err(|_| SyncError::Protocol)?;
                for vault in list.vaults.iter().chain(&list.shared) {
                    vault.validate()?;
                }
                Ok(AuthResponse::Vaults(list))
            }
            RequestKind::Access => {
                if !value.is_object() {
                    return Err(SyncError::Protocol);
                }
                Ok(AuthResponse::AccessGranted)
            }
            RequestKind::SignOut => {
                if !value.is_object() {
                    return Err(SyncError::Protocol);
                }
                Ok(AuthResponse::SignedOut)
            }
        }
    }
}

#[derive(Deserialize)]
struct SignInBody {
    token: String,
    name: String,
    email: String,
}

/// Parsed account response. Secret-bearing variants have redacted Debug.
pub enum AuthResponse {
    /// A newly authenticated token for platform secure storage.
    SignedIn(AccountSession),
    /// Existing account metadata, retaining unfamiliar service fields.
    UserInfo(Value),
    /// Owned and shared vault metadata.
    Vaults(VaultList),
    /// The service accepted the vault key proof.
    AccessGranted,
    /// The remote token was invalidated.
    SignedOut,
    /// Repeat sign-in with the user's one-time code.
    MfaRequired,
    /// The submitted code was rejected; permit a fresh user-supplied code.
    MfaRejected,
}

impl fmt::Debug for AuthResponse {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match self {
            Self::SignedIn(_) => "SignedIn",
            Self::UserInfo(_) => "UserInfo",
            Self::Vaults(_) => "Vaults",
            Self::AccessGranted => "AccessGranted",
            Self::SignedOut => "SignedOut",
            Self::MfaRequired => "MfaRequired",
            Self::MfaRejected => "MfaRejected",
        };
        formatter.write_str(name)
    }
}

/// The account token is never persisted by this crate or serialized to JSON.
pub struct AccountSession {
    token: Zeroizing<String>,
    /// Display name from the account service.
    pub name: String,
    /// Account email from the account service.
    pub email: String,
}

impl fmt::Debug for AccountSession {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AccountSession([REDACTED])")
    }
}

impl AccountSession {
    /// Borrow the token for secure storage or another account request.
    #[must_use]
    pub fn token(&self) -> &str {
        &self.token
    }
}

/// Both lists are required by the pinned service contract.
#[derive(Debug, Deserialize)]
pub struct VaultList {
    /// Vaults owned by the authenticated account.
    pub vaults: Vec<RemoteVault>,
    /// Vaults shared with the authenticated account.
    pub shared: Vec<RemoteVault>,
}

/// Service metadata. Managed encryption supplies a password in this response;
/// end-to-end encrypted vaults require a user-supplied password instead.
#[derive(Deserialize)]
pub struct RemoteVault {
    /// Stable remote vault identifier.
    pub id: String,
    /// Display name; selection always uses the identifier to disambiguate.
    pub name: String,
    /// Regional WebSocket host selected by the service.
    pub host: String,
    /// Service region identifier.
    pub region: String,
    /// Key derivation salt, using the service's exact string bytes.
    pub salt: String,
    /// Negotiated encryption version (0, 2, or 3).
    pub encryption_version: u8,
    #[serde(default)]
    password: Option<String>,
    /// Unrecognized metadata, including future permission/capability fields.
    /// No permission is inferred when the service does not publish one.
    #[serde(flatten)]
    pub metadata: BTreeMap<String, Value>,
}

impl fmt::Debug for RemoteVault {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("RemoteVault")
            .field("encryption_version", &self.encryption_version)
            .finish_non_exhaustive()
    }
}

impl Drop for RemoteVault {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        if let Some(password) = &mut self.password {
            password.zeroize();
        }
    }
}

impl RemoteVault {
    /// Whether the service manages the vault's encryption password.
    #[must_use]
    pub fn is_managed(&self) -> bool {
        self.password
            .as_deref()
            .is_some_and(|password| !password.is_empty())
    }

    /// Derive and initialize the correct cipher. Managed vaults use the service
    /// password; end-to-end vaults require the explicit user input.
    ///
    /// # Errors
    /// Rejects unsafe hosts, unsupported versions, or absent encryption input.
    pub fn cipher(&self, password: Option<&str>) -> Result<VaultCipher> {
        let key = self.derive_key(password)?;
        VaultCipher::new(
            EncryptionVersion::try_from(self.encryption_version)?,
            &key,
            &self.salt,
        )
    }

    /// Derive the vault key for platform secure storage. Neither password nor
    /// key is serialized into vault/profile preferences by this crate.
    ///
    /// # Errors
    /// Rejects unsafe hosts, unsupported versions, or absent encryption input.
    pub fn derive_key(&self, password: Option<&str>) -> Result<VaultKey> {
        self.validate()?;
        let password = self
            .password
            .as_deref()
            .filter(|password| !password.is_empty())
            .or(password)
            .ok_or(SyncError::Key)?;
        if password.is_empty() {
            return Err(SyncError::Key);
        }
        VaultKey::derive(password, &self.salt)
    }

    fn validate(&self) -> Result<()> {
        if self.id.is_empty() {
            return Err(SyncError::Protocol);
        }
        super::session::server_url(&self.host)?;
        EncryptionVersion::try_from(self.encryption_version)?;
        Ok(())
    }
}
