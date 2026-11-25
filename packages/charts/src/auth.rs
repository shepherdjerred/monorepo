use axum::extract::FromRequestParts;
use axum::http::header;
use axum::http::request::Parts;
use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use sha2::{Digest as _, Sha256};
use subtle::ConstantTimeEq as _;

use crate::error::AppError;
use crate::routes::AppState;

#[derive(Clone)]
pub struct BasicAuthCredentials {
    user_sha256: [u8; 32],
    pass_sha256: [u8; 32],
}

impl std::fmt::Debug for BasicAuthCredentials {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("BasicAuthCredentials")
            .field("configured", &true)
            .finish()
    }
}

impl BasicAuthCredentials {
    pub fn new(username: &str, password: &str) -> Self {
        Self {
            user_sha256: sha256_bytes(username.as_bytes()),
            pass_sha256: sha256_bytes(password.as_bytes()),
        }
    }

    pub fn verify_header(&self, authorization_value: &str) -> bool {
        let Some(encoded) = strip_basic_scheme(authorization_value) else {
            return false;
        };
        let Ok(decoded) = STANDARD.decode(encoded.trim()) else {
            return false;
        };
        let Ok(credentials) = std::str::from_utf8(&decoded) else {
            return false;
        };
        let Some((provided_user, provided_pass)) = credentials.split_once(':') else {
            return false;
        };

        let user_hash = sha256_bytes(provided_user.as_bytes());
        let pass_hash = sha256_bytes(provided_pass.as_bytes());

        let user_ok = user_hash.ct_eq(&self.user_sha256);
        let pass_ok = pass_hash.ct_eq(&self.pass_sha256);
        bool::from(user_ok & pass_ok)
    }
}

fn strip_basic_scheme(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    let (scheme, rest) = trimmed.split_once(' ')?;
    if scheme.eq_ignore_ascii_case("basic") {
        Some(rest)
    } else {
        None
    }
}

fn sha256_bytes(input: &[u8]) -> [u8; 32] {
    let digest = Sha256::digest(input);
    let mut out = [0_u8; 32];
    out.copy_from_slice(&digest);
    out
}

/// Extractor that verifies HTTP Basic Auth before consuming any request body bytes.
pub struct RequireBasicAuth;

impl FromRequestParts<AppState> for RequireBasicAuth {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let Some(credentials) = &state.basic_auth else {
            return Err(AppError::Unauthorized);
        };
        let Some(raw_header) = parts.headers.get(header::AUTHORIZATION) else {
            return Err(AppError::Unauthorized);
        };
        let Ok(header_str) = raw_header.to_str() else {
            return Err(AppError::Unauthorized);
        };
        if !credentials.verify_header(header_str) {
            return Err(AppError::Unauthorized);
        }
        Ok(Self)
    }
}

#[cfg(test)]
mod tests {
    use super::BasicAuthCredentials;

    #[test]
    fn verifies_matching_and_rejects_mismatching_credentials() {
        let creds = BasicAuthCredentials::new("publisher", "s3cr3t:with:colons");
        let valid = format!(
            "Basic {}",
            base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                "publisher:s3cr3t:with:colons"
            )
        );
        let wrong_pass = format!(
            "Basic {}",
            base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                "publisher:wrong"
            )
        );
        let wrong_user = format!(
            "Basic {}",
            base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                "other:s3cr3t:with:colons"
            )
        );

        assert!(creds.verify_header(&valid));
        assert!(creds.verify_header(&valid.replacen("Basic", "basic", 1)));
        assert!(!creds.verify_header(&wrong_pass));
        assert!(!creds.verify_header(&wrong_user));
        assert!(!creds.verify_header("Bearer token"));
        assert!(!creds.verify_header("Basic !!!not-base64!!!"));
    }
}
