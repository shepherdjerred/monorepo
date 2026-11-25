use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use base64::Engine;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CiIdentity {
    Main,
    PullRequest,
}

#[derive(Debug, Clone)]
pub struct BasicCredentials {
    pub write_user: String,
    pub write_password: Option<String>,
    pub read_user: String,
    pub read_password: Option<String>,
}

/// Constant-time string comparison by hashing both sides with SHA-256 first so
/// differing secret lengths never leak timing information.
pub fn constant_time_str_eq(candidate: &str, expected: &str) -> bool {
    if expected.is_empty() {
        return false;
    }
    let left = Sha256::digest(candidate.as_bytes());
    let right = Sha256::digest(expected.as_bytes());
    bool::from(left.ct_eq(&right))
}

pub fn verify_bearer(headers: &HeaderMap, expected_token: Option<&str>) -> bool {
    let Some(expected) = expected_token.filter(|tok| !tok.is_empty()) else {
        return false;
    };
    let Some(raw) = headers
        .get(header::AUTHORIZATION)
        .and_then(|val| val.to_str().ok())
    else {
        return false;
    };
    let Some(token) = raw
        .strip_prefix("Bearer ")
        .or_else(|| raw.strip_prefix("bearer "))
    else {
        return false;
    };
    constant_time_str_eq(token.trim(), expected)
}

pub fn verify_basic(headers: &HeaderMap, creds: &BasicCredentials) -> Option<CiIdentity> {
    let raw = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let encoded = raw
        .strip_prefix("Basic ")
        .or_else(|| raw.strip_prefix("basic "))?
        .trim();
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()?;
    let decoded_str = std::str::from_utf8(&decoded).ok()?;
    let (username, password) = decoded_str.split_once(':')?;

    let main_match = creds.write_password.as_deref().is_some_and(|expected_pw| {
        let user_ok = constant_time_str_eq(username, &creds.write_user);
        let pass_ok = constant_time_str_eq(password, expected_pw);
        user_ok & pass_ok
    });

    let pr_match = creds.read_password.as_deref().is_some_and(|expected_pw| {
        let user_ok = constant_time_str_eq(username, &creds.read_user);
        let pass_ok = constant_time_str_eq(password, expected_pw);
        user_ok & pass_ok
    });

    if main_match {
        Some(CiIdentity::Main)
    } else if pr_match {
        Some(CiIdentity::PullRequest)
    } else {
        None
    }
}

pub fn bearer_unauthorized_response() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        [(
            header::WWW_AUTHENTICATE,
            HeaderValue::from_static("Bearer realm=\"ci-cache\""),
        )],
        axum::Json(serde_json::json!({ "error": "unauthorized" })),
    )
        .into_response()
}

pub fn basic_unauthorized_response(realm: &'static str) -> Response {
    let header_val = format!("Basic realm=\"{realm}\"");
    let mut response = (StatusCode::UNAUTHORIZED, "unauthorized\n").into_response();
    if let Ok(parsed) = HeaderValue::from_str(&header_val) {
        response
            .headers_mut()
            .insert(header::WWW_AUTHENTICATE, parsed);
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_time_comparison_rejects_empty_and_mismatched_values() {
        assert!(!constant_time_str_eq("secret", ""));
        assert!(!constant_time_str_eq("", ""));
        assert!(!constant_time_str_eq("secret-a", "secret-b"));
        assert!(constant_time_str_eq("secret-token-123", "secret-token-123"));
    }

    #[test]
    fn verifies_basic_main_and_pr_identities() {
        let creds = BasicCredentials {
            write_user: "ci-main".to_owned(),
            write_password: Some("write-secret".to_owned()),
            read_user: "ci-pull-request".to_owned(),
            read_password: Some("read-secret".to_owned()),
        };

        let mut headers = HeaderMap::new();
        let main_b64 = base64::engine::general_purpose::STANDARD.encode("ci-main:write-secret");
        if let Ok(val) = HeaderValue::from_str(&format!("Basic {main_b64}")) {
            headers.insert(header::AUTHORIZATION, val);
        }
        assert_eq!(verify_basic(&headers, &creds), Some(CiIdentity::Main));

        let pr_b64 =
            base64::engine::general_purpose::STANDARD.encode("ci-pull-request:read-secret");
        if let Ok(val) = HeaderValue::from_str(&format!("Basic {pr_b64}")) {
            headers.insert(header::AUTHORIZATION, val);
        }
        assert_eq!(
            verify_basic(&headers, &creds),
            Some(CiIdentity::PullRequest)
        );

        let wrong_b64 =
            base64::engine::general_purpose::STANDARD.encode("ci-pull-request:write-secret");
        if let Ok(val) = HeaderValue::from_str(&format!("Basic {wrong_b64}")) {
            headers.insert(header::AUTHORIZATION, val);
        }
        assert_eq!(verify_basic(&headers, &creds), None);
    }
}
