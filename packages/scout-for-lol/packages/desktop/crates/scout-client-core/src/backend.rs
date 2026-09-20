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
    CreatePairingRequest, CreatePairingResponse, ExchangePairingRequest, ExchangePairingResponse,
    ObservationBatch, ObservationBatchReceipt,
};

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
}
