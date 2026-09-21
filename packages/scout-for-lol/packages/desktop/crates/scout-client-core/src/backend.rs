//! Bounded Scout backend client for pairing and durable observation delivery.

use std::path::Path;
use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::Deserialize;
use thiserror::Error;
use url::Url;
use uuid::Uuid;

use crate::credentials::DeviceCredential;
use crate::protocol::{
    CheckInRequest, CheckInResponse, CreatePairingRequest, CreatePairingResponse,
    ExchangePairingRequest, ExchangePairingResponse, ObservationBatch, ObservationBatchReceipt,
    PROTOCOL_VERSION, RevokeDeviceResponse,
};

const REPLAY_UPLOAD_TIMEOUT: Duration = Duration::from_hours(1);

/// HTTP client restricted to a single validated Scout origin.
#[derive(Debug, Clone)]
pub struct ScoutBackendClient {
    http: Client,
    origin: Url,
}

/// Durable replay relay receipt.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplayUploadOutcome {
    /// First completed upload.
    Accepted,
    /// Content-addressed replay was already present.
    AlreadyAccepted,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReplayUploadReceipt {
    outcome: ReplayUploadOutcome,
    digest: String,
    bytes: u64,
}

impl ScoutBackendClient {
    /// Construct a client for an HTTPS Scout origin or loopback HTTP in local development.
    ///
    /// # Errors
    ///
    /// Returns [`BackendError::Origin`] for non-origin URLs, insecure remote
    /// HTTP, or a client-construction failure.
    pub fn new(origin: &str) -> Result<Self, BackendError> {
        let mut parsed = Url::parse(origin).map_err(|_| BackendError::Origin)?;
        let is_loopback = parsed
            .host_str()
            .is_some_and(|host| matches!(host, "localhost" | "127.0.0.1" | "::1"));
        if parsed.cannot_be_a_base()
            || parsed.query().is_some()
            || parsed.fragment().is_some()
            || (parsed.scheme() != "https" && !(parsed.scheme() == "http" && is_loopback))
        {
            return Err(BackendError::Origin);
        }
        parsed.set_path("");
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(BackendError::Request)?;
        Ok(Self {
            http,
            origin: parsed,
        })
    }

    /// Normalized backend origin used to scope operating-system credentials.
    #[must_use]
    pub fn credential_scope(&self) -> &str {
        self.origin.as_str()
    }

    fn endpoint(&self, path: &str) -> Result<Url, BackendError> {
        self.origin.join(path).map_err(|_| BackendError::Origin)
    }

    /// Create a short-lived browser pairing request.
    ///
    /// # Errors
    ///
    /// Returns a typed transport or server-status error.
    pub async fn create_pairing(
        &self,
        request: &CreatePairingRequest,
    ) -> Result<CreatePairingResponse, BackendError> {
        self.http
            .post(self.endpoint("/api/scout-client/v1/pairings")?)
            .json(request)
            .send()
            .await
            .map_err(BackendError::Request)?
            .error_for_status()
            .map_err(BackendError::Request)?
            .json()
            .await
            .map_err(BackendError::Request)
    }

    /// Poll a pairing request exactly until approval or terminal state.
    ///
    /// # Errors
    ///
    /// Returns a typed transport or server-status error.
    pub async fn exchange_pairing(
        &self,
        pairing_id: Uuid,
        pairing_secret: &str,
    ) -> Result<ExchangePairingResponse, BackendError> {
        let response = self
            .http
            .post(self.endpoint(&format!(
                "/api/scout-client/v1/pairings/{pairing_id}/exchange"
            ))?)
            .json(&ExchangePairingRequest {
                pairing_secret: pairing_secret.to_owned(),
            })
            .send()
            .await
            .map_err(BackendError::Request)?;
        if response.status() == StatusCode::CONFLICT {
            return Ok(ExchangePairingResponse::Consumed);
        }
        response
            .error_for_status()
            .map_err(BackendError::Request)?
            .json()
            .await
            .map_err(BackendError::Request)
    }

    /// Deliver one bounded observation batch with the paired bearer token.
    ///
    /// # Errors
    ///
    /// Returns a typed transport or server-status error.
    pub async fn upload_observations(
        &self,
        credential: &DeviceCredential,
        batch: &ObservationBatch,
    ) -> Result<ObservationBatchReceipt, BackendError> {
        self.http
            .post(self.endpoint("/api/scout-client/v1/observations/batch")?)
            .bearer_auth(&credential.token)
            .json(batch)
            .send()
            .await
            .map_err(BackendError::Request)?
            .error_for_status()
            .map_err(BackendError::Request)?
            .json()
            .await
            .map_err(BackendError::Request)
    }

    /// Refresh the paired device's running build before sending observations.
    ///
    /// # Errors
    ///
    /// Returns a typed transport, server-status, or invalid-receipt error.
    pub async fn check_in(
        &self,
        credential: &DeviceCredential,
        app_version: &str,
    ) -> Result<u64, BackendError> {
        let receipt: CheckInResponse = self
            .http
            .post(self.endpoint("/api/scout-client/v1/check-ins")?)
            .bearer_auth(&credential.token)
            .json(&CheckInRequest {
                app_version: app_version.to_owned(),
                protocol_version: PROTOCOL_VERSION,
            })
            .send()
            .await
            .map_err(BackendError::Request)?
            .error_for_status()
            .map_err(BackendError::Request)?
            .json()
            .await
            .map_err(BackendError::Request)?;
        if !receipt.accepted {
            return Err(BackendError::CheckInReceipt);
        }
        Ok(receipt.next_sequence)
    }

    /// Revoke this bearer before removing it from the operating-system store.
    ///
    /// An unauthorized response means the credential is already unusable and
    /// is therefore safe to delete locally.
    ///
    /// # Errors
    ///
    /// Returns a typed transport, server-status, or invalid-receipt error.
    pub async fn revoke_device(&self, credential: &DeviceCredential) -> Result<(), BackendError> {
        let response = self
            .http
            .post(self.endpoint("/api/scout-client/v1/devices/current/revoke")?)
            .bearer_auth(&credential.token)
            .send()
            .await
            .map_err(BackendError::Request)?;
        if revocation_is_complete_without_receipt(response.status()) {
            return Ok(());
        }
        let receipt: RevokeDeviceResponse = response
            .error_for_status()
            .map_err(BackendError::Request)?
            .json()
            .await
            .map_err(BackendError::Request)?;
        if !receipt.revoked {
            return Err(BackendError::RevokeReceipt);
        }
        Ok(())
    }

    /// Stream one completed ROFL through the Scout backend relay.
    ///
    /// # Errors
    ///
    /// Returns a typed file, transport, or server-status error.
    pub async fn upload_replay(
        &self,
        credential: &DeviceCredential,
        game_id: &str,
        digest: &str,
        path: &Path,
    ) -> Result<ReplayUploadOutcome, BackendError> {
        let file = tokio::fs::File::open(path)
            .await
            .map_err(BackendError::ReplayFile)?;
        let bytes = file
            .metadata()
            .await
            .map_err(BackendError::ReplayFile)?
            .len();
        let receipt: ReplayUploadReceipt = self
            .http
            .put(self.endpoint(&format!("/api/scout-client/v1/replays/{game_id}"))?)
            .bearer_auth(&credential.token)
            .header("Content-Type", "application/vnd.riot.rofl")
            .header("Content-Length", bytes)
            .header("X-Scout-SHA256", digest)
            .body(reqwest::Body::from(file))
            .timeout(REPLAY_UPLOAD_TIMEOUT)
            .send()
            .await
            .map_err(BackendError::Request)?
            .error_for_status()
            .map_err(BackendError::Request)?
            .json()
            .await
            .map_err(BackendError::Request)?;
        if receipt.digest != digest || receipt.bytes != bytes {
            return Err(BackendError::ReplayReceipt);
        }
        Ok(receipt.outcome)
    }
}

/// Scout backend boundary failure.
#[derive(Debug, Error)]
pub enum BackendError {
    /// Configured backend is not a safe origin.
    #[error("Scout backend must be an HTTPS origin (loopback HTTP is allowed for development)")]
    Origin,
    /// HTTP request or response decoding failed.
    #[error("Scout backend request failed: {0}")]
    Request(reqwest::Error),
    /// Local replay could not be opened or inspected.
    #[error("local replay file could not be read: {0}")]
    ReplayFile(std::io::Error),
    /// Server acknowledged different replay metadata.
    #[error("Scout backend returned inconsistent replay metadata")]
    ReplayReceipt,
    /// Server returned a syntactically valid but negative check-in receipt.
    #[error("Scout backend did not accept the device check-in")]
    CheckInReceipt,
    /// Server returned a syntactically valid but negative revocation receipt.
    #[error("Scout backend did not revoke the device")]
    RevokeReceipt,
}

impl BackendError {
    /// Whether this replay should be deferred while the scan continues.
    #[must_use]
    pub fn replay_should_be_deferred(&self) -> bool {
        let Self::Request(error) = self else {
            return false;
        };
        error.status().is_some_and(replay_status_should_be_deferred)
    }

    /// Statuses that permanently reject one replay rather than the credential or service.
    #[must_use]
    pub fn terminal_replay_rejection_status(&self) -> Option<u16> {
        let Self::Request(error) = self else {
            return None;
        };
        let status = error.status()?;
        matches!(
            status,
            StatusCode::BAD_REQUEST
                | StatusCode::FORBIDDEN
                | StatusCode::PAYLOAD_TOO_LARGE
                | StatusCode::UNSUPPORTED_MEDIA_TYPE
        )
        .then(|| status.as_u16())
    }
}

fn replay_status_should_be_deferred(status: StatusCode) -> bool {
    status == StatusCode::CONFLICT
}

fn revocation_is_complete_without_receipt(status: StatusCode) -> bool {
    status == StatusCode::UNAUTHORIZED
}

#[cfg(test)]
mod tests {
    use reqwest::StatusCode;

    use super::{
        BackendError, ScoutBackendClient, replay_status_should_be_deferred,
        revocation_is_complete_without_receipt,
    };

    #[test]
    fn defers_replay_conflicts_without_hiding_terminal_rejections() {
        assert!(replay_status_should_be_deferred(StatusCode::CONFLICT));
        assert!(!replay_status_should_be_deferred(StatusCode::BAD_REQUEST));
        assert!(!replay_status_should_be_deferred(
            StatusCode::PAYLOAD_TOO_LARGE
        ));
    }

    #[test]
    fn credential_scope_uses_the_normalized_backend_origin() -> Result<(), BackendError> {
        let backend = ScoutBackendClient::new("https://scout.sjer.red/ignored/path")?;

        assert_eq!(backend.credential_scope(), "https://scout.sjer.red/");
        Ok(())
    }

    #[test]
    fn treats_an_unauthorized_revocation_as_already_complete() {
        assert!(revocation_is_complete_without_receipt(
            StatusCode::UNAUTHORIZED
        ));
        assert!(!revocation_is_complete_without_receipt(
            StatusCode::INTERNAL_SERVER_ERROR
        ));
    }
}
