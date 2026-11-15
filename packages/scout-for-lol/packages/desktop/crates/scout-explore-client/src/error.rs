//! Typed failures of the Explore client, with every contract refusal mapped
//! to what the desktop should do about it.

use std::time::Duration;

use scout_client_core::credentials::CredentialError;
use scout_client_core::desktop_api::{DesktopApiError, DesktopApiErrorCode};
use scout_client_core::diagnostics::sanitize_detail;
use scout_client_core::protocol::{CLIENT_UPGRADE_REQUIRED_STATUS, ClientUpgradeRequired};
use thiserror::Error;

use crate::contract::refusal_status;

/// What the desktop should do about a refusal.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Recovery {
    /// The device credential is gone or lacks the `explore` scope: pair this
    /// device again (`unauthorized`, `scope_required`).
    RePair,
    /// The owner's Discord login expired: sign in to Scout on the web again
    /// (`reauthorize_required`). The device itself stays paired.
    SignInOnWeb,
    /// This build is older than the server accepts: update Scout Desktop
    /// (`contract_unsupported`, or a 426 `client_upgrade_required`).
    UpgradeApp,
    /// Explore in Scout Desktop is switched off for this owner
    /// (`feature_disabled`).
    FeatureDisabled,
    /// The owner shares no server that may use Explore (`explore_forbidden`).
    ExploreForbidden,
    /// The conversation or run does not exist for this owner (`not_found`).
    NotFound,
    /// The conversation already has an answer running (`conversation_busy`).
    ConversationBusy,
    /// Wait and try again (`rate_limited`, `quota_exceeded`, `stream_limit`,
    /// `unavailable`); `after` is the server's `Retry-After` when it sent one.
    RetryLater {
        /// How long the server asked the client to wait.
        after: Option<Duration>,
    },
    /// The request cannot succeed as sent (`invalid_request`, `invalid_turn`).
    FixRequest,
}

/// A typed refusal from a desktop route, at the status the contract gives it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Refusal {
    /// The refusal code.
    pub code: DesktopApiErrorCode,
    /// The server's explanation, safe to show.
    pub message: String,
    /// The `Retry-After` header, when the server sent one.
    pub retry_after: Option<Duration>,
}

impl Refusal {
    /// What the desktop should do about this refusal.
    #[must_use]
    pub const fn recovery(&self) -> Recovery {
        match self.code {
            DesktopApiErrorCode::Unauthorized | DesktopApiErrorCode::ScopeRequired => {
                Recovery::RePair
            }
            DesktopApiErrorCode::ReauthorizeRequired => Recovery::SignInOnWeb,
            DesktopApiErrorCode::ContractUnsupported => Recovery::UpgradeApp,
            DesktopApiErrorCode::FeatureDisabled => Recovery::FeatureDisabled,
            DesktopApiErrorCode::ExploreForbidden => Recovery::ExploreForbidden,
            DesktopApiErrorCode::NotFound => Recovery::NotFound,
            DesktopApiErrorCode::ConversationBusy => Recovery::ConversationBusy,
            DesktopApiErrorCode::RateLimited
            | DesktopApiErrorCode::QuotaExceeded
            | DesktopApiErrorCode::StreamLimit
            | DesktopApiErrorCode::Unavailable => Recovery::RetryLater {
                after: self.retry_after,
            },
            // The runtime reads this refusal itself and never surfaces it; it
            // means the request was already satisfied, not that it can retry.
            DesktopApiErrorCode::InvalidRequest
            | DesktopApiErrorCode::InvalidTurn
            | DesktopApiErrorCode::ScopeAlreadyGranted => Recovery::FixRequest,
        }
    }
}

/// An Explore client failure.
#[derive(Debug, Error)]
pub enum ExploreClientError {
    /// The configured backend is not a safe origin.
    #[error("Scout backend must be an HTTPS origin (loopback HTTP is allowed for development)")]
    Origin,
    /// This device holds no credential for the backend.
    #[error("this device is not paired with Scout")]
    NotPaired,
    /// The operating-system credential store failed.
    #[error(transparent)]
    Credential(#[from] CredentialError),
    /// The request never got an answer: DNS, TLS, connect, or a timeout.
    #[error("Scout backend request failed: {0}")]
    Transport(#[source] reqwest::Error),
    /// The server refused with a typed contract refusal.
    #[error("Scout refused the request ({code:?}): {message}", code = .0.code, message = .0.message)]
    Refused(Refusal),
    /// The server refused this build as older than it accepts.
    #[error("Update Scout Desktop to keep using Explore: {message}")]
    UpgradeRequired {
        /// The server's explanation.
        message: String,
    },
    /// The server answered outside the contract: an unknown status, a body
    /// that is not a refusal, or a refusal at a status the contract does not
    /// give it.
    #[error("Scout backend answered HTTP {status} outside the desktop contract: {detail}")]
    Unexpected {
        /// HTTP status.
        status: u16,
        /// The bounded, sanitized body.
        detail: String,
    },
    /// A success body does not match the contract.
    #[error("Scout backend sent a body that does not match the desktop contract: {0}")]
    Decode(#[source] serde_json::Error),
}

impl ExploreClientError {
    /// What the desktop should do, when the failure is a contract refusal.
    #[must_use]
    pub const fn recovery(&self) -> Option<Recovery> {
        match self {
            Self::Refused(refusal) => Some(refusal.recovery()),
            Self::UpgradeRequired { .. } => Some(Recovery::UpgradeApp),
            Self::NotPaired => Some(Recovery::RePair),
            _ => None,
        }
    }

    /// The refusal, when the server sent one.
    #[must_use]
    pub const fn refusal(&self) -> Option<&Refusal> {
        match self {
            Self::Refused(refusal) => Some(refusal),
            _ => None,
        }
    }
}

/// Map a non-success answer to its typed failure.
///
/// A refusal is typed only when its body is exactly the contract's
/// `{ error, message }` and the status is the one the contract gives that
/// code; anything else is a broken contract and stays visible as
/// [`ExploreClientError::Unexpected`].
pub(crate) fn classify_rejection(
    status: u16,
    body: &str,
    retry_after: Option<Duration>,
) -> ExploreClientError {
    if let Ok(refusal) = serde_json::from_str::<DesktopApiError>(body)
        && refusal_status(refusal.error) == status
    {
        if refusal.error == DesktopApiErrorCode::ContractUnsupported {
            return ExploreClientError::UpgradeRequired {
                message: refusal.message,
            };
        }
        return ExploreClientError::Refused(Refusal {
            code: refusal.error,
            message: refusal.message,
            retry_after,
        });
    }
    // The capture surface's own upgrade refusal, answered by a backend that
    // gates every Scout Client route on the app version.
    if status == CLIENT_UPGRADE_REQUIRED_STATUS
        && let Some(upgrade) = ClientUpgradeRequired::from_body(body)
    {
        return ExploreClientError::UpgradeRequired {
            message: format!(
                "Scout needs Scout Desktop {} or newer.",
                upgrade.minimum_version
            ),
        };
    }
    ExploreClientError::Unexpected {
        status,
        detail: sanitize_detail(body.trim()),
    }
}

/// Parse a `Retry-After` given in seconds. The server never sends a date.
pub(crate) fn retry_after(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    headers
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse::<u64>()
        .ok()
        .map(Duration::from_secs)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use scout_client_core::desktop_api::DesktopApiErrorCode;
    use serde_json::Value;

    use super::{ExploreClientError, Recovery, classify_rejection};

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    const ERRORS: &str =
        include_str!("../../../../data/src/scout-client/desktop-fixtures/errors.json");

    fn expected_recovery(code: DesktopApiErrorCode, after: Option<Duration>) -> Recovery {
        match code {
            DesktopApiErrorCode::Unauthorized | DesktopApiErrorCode::ScopeRequired => {
                Recovery::RePair
            }
            DesktopApiErrorCode::ReauthorizeRequired => Recovery::SignInOnWeb,
            DesktopApiErrorCode::ContractUnsupported => Recovery::UpgradeApp,
            DesktopApiErrorCode::FeatureDisabled => Recovery::FeatureDisabled,
            DesktopApiErrorCode::ExploreForbidden => Recovery::ExploreForbidden,
            DesktopApiErrorCode::NotFound => Recovery::NotFound,
            DesktopApiErrorCode::ConversationBusy => Recovery::ConversationBusy,
            DesktopApiErrorCode::RateLimited
            | DesktopApiErrorCode::QuotaExceeded
            | DesktopApiErrorCode::StreamLimit
            | DesktopApiErrorCode::Unavailable => Recovery::RetryLater { after },
            DesktopApiErrorCode::InvalidRequest
            | DesktopApiErrorCode::InvalidTurn
            | DesktopApiErrorCode::ScopeAlreadyGranted => Recovery::FixRequest,
        }
    }

    #[test]
    fn every_golden_refusal_maps_to_its_typed_error() -> TestResult {
        let fixtures: Value = serde_json::from_str(ERRORS)?;
        let fixtures = fixtures["errors"].as_array().ok_or("error fixtures")?;
        assert_eq!(fixtures.len(), 15);
        let after = Some(Duration::from_secs(60));
        for fixture in fixtures {
            let status = u16::try_from(fixture["status"].as_u64().ok_or("status")?)?;
            let body = fixture["body"].to_string();
            let code: DesktopApiErrorCode =
                serde_json::from_value(fixture["body"]["error"].clone())?;
            let error = classify_rejection(status, &body, after);
            assert_eq!(
                error.recovery(),
                Some(expected_recovery(code, after)),
                "{code:?}"
            );
            match (&error, code) {
                (
                    ExploreClientError::UpgradeRequired { message },
                    DesktopApiErrorCode::ContractUnsupported,
                ) => {
                    assert_eq!(message, "Update Scout Desktop to keep using Explore.");
                }
                (ExploreClientError::Refused(refusal), _) => {
                    assert_eq!(refusal.code, code);
                    assert_eq!(
                        Value::from(refusal.message.as_str()),
                        fixture["body"]["message"]
                    );
                    assert_eq!(refusal.retry_after, after);
                }
                (other, _) => return Err(format!("{code:?} mapped to {other:?}").into()),
            }
        }
        Ok(())
    }

    #[test]
    fn the_named_refusals_get_their_own_recovery() {
        let recover = |status: u16, error: &str| {
            classify_rejection(
                status,
                &serde_json::json!({ "error": error, "message": "x" }).to_string(),
                None,
            )
            .recovery()
        };
        assert_eq!(recover(403, "scope_required"), Some(Recovery::RePair));
        assert_eq!(recover(401, "unauthorized"), Some(Recovery::RePair));
        assert_eq!(
            recover(401, "reauthorize_required"),
            Some(Recovery::SignInOnWeb)
        );
        assert_eq!(
            recover(503, "feature_disabled"),
            Some(Recovery::FeatureDisabled)
        );
        assert_eq!(
            recover(429, "stream_limit"),
            Some(Recovery::RetryLater { after: None })
        );
        assert_eq!(
            recover(426, "contract_unsupported"),
            Some(Recovery::UpgradeApp)
        );
    }

    #[test]
    fn a_426_client_upgrade_required_body_is_an_upgrade() {
        let error = classify_rejection(
            426,
            r#"{"error":"client_upgrade_required","minimumVersion":"0.3.0"}"#,
            None,
        );
        assert_eq!(error.recovery(), Some(Recovery::UpgradeApp));
        assert!(error.to_string().contains("0.3.0"), "{error}");
    }

    #[test]
    fn a_refusal_at_the_wrong_status_is_a_broken_contract() {
        let error = classify_rejection(
            500,
            r#"{"error":"not_found","message":"Run not found."}"#,
            None,
        );
        assert!(
            matches!(error, ExploreClientError::Unexpected { status: 500, .. }),
            "{error:?}"
        );
        assert_eq!(error.recovery(), None);
    }

    #[test]
    fn a_body_with_extra_fields_is_not_a_refusal() {
        let error = classify_rejection(
            404,
            r#"{"error":"not_found","message":"Gone.","detail":"x"}"#,
            None,
        );
        assert!(matches!(
            error,
            ExploreClientError::Unexpected { status: 404, .. }
        ));
    }

    #[test]
    fn a_proxy_page_is_unexpected_and_keeps_its_status() {
        let error = classify_rejection(502, "<html>Bad Gateway</html>", None);
        assert!(matches!(
            error,
            ExploreClientError::Unexpected { status: 502, .. }
        ));
    }
}
