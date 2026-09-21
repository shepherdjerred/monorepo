//! Versioned client-to-Scout observation protocol.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

include!(concat!(env!("OUT_DIR"), "/protocol_contract.rs"));

/// Maximum serialized observation size accepted by the local outbox.
pub const MAX_OBSERVATION_BYTES: usize = MAX_OBSERVATION_BATCH_BYTES - 19;

/// Wire envelope sent by the client and validated again by the backend.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObservationEnvelope {
    /// Protocol version understood by both endpoints.
    pub protocol_version: u16,
    /// Schema version for this observation family.
    pub schema_version: u16,
    /// Device-scoped idempotency key.
    pub observation_id: Uuid,
    /// Monotonic sequence assigned by the local outbox.
    pub sequence: u64,
    /// Time at which League was observed.
    pub captured_at: DateTime<Utc>,
    /// Client build version.
    pub app_version: String,
    /// Observation family.
    pub kind: ObservationKind,
    /// League patch reported by LCU, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub league_patch: Option<String>,
    /// Riot platform route, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub platform_id: Option<String>,
    /// Current local account PUUID, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_puuid: Option<String>,
    /// Stable lobby identity, when exposed by LCU.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lobby_id: Option<String>,
    /// Platform-local numeric game identity, represented losslessly.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub game_id: Option<String>,
    /// Curated LCU/Live Client payload.
    pub payload: Value,
}

impl ObservationEnvelope {
    /// Construct and validate an observation before it enters the durable outbox.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError`] if the supplied envelope fields or payload
    /// exceed the protocol's safety bounds.
    pub fn new(
        sequence: u64,
        kind: ObservationKind,
        app_version: impl Into<String>,
        payload: Value,
    ) -> Result<Self, ProtocolError> {
        let envelope = Self {
            protocol_version: PROTOCOL_VERSION,
            schema_version: OBSERVATION_SCHEMA_VERSION,
            observation_id: Uuid::new_v4(),
            sequence,
            captured_at: Utc::now(),
            app_version: app_version.into(),
            kind,
            league_patch: None,
            platform_id: None,
            local_puuid: None,
            lobby_id: None,
            game_id: None,
            payload,
        };
        envelope.validate()?;
        Ok(envelope)
    }

    /// Validate local resource bounds before serialization or persistence.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError`] for unsupported versions, malformed bounded
    /// fields, unsafe JSON keys, or excessive payload resource use.
    pub fn validate(&self) -> Result<(), ProtocolError> {
        if self.protocol_version != PROTOCOL_VERSION {
            return Err(ProtocolError::UnsupportedProtocol(self.protocol_version));
        }
        if self.schema_version != OBSERVATION_SCHEMA_VERSION {
            return Err(ProtocolError::UnsupportedObservationSchema(
                self.schema_version,
            ));
        }
        bounded_string("appVersion", &self.app_version, APP_VERSION_MAX_BYTES)?;
        for (name, value, limit) in [
            (
                "leaguePatch",
                self.league_patch.as_deref(),
                LEAGUE_PATCH_MAX_BYTES,
            ),
            (
                "platformId",
                self.platform_id.as_deref(),
                PLATFORM_ID_MAX_BYTES,
            ),
            (
                "localPuuid",
                self.local_puuid.as_deref(),
                LOCAL_PUUID_MAX_BYTES,
            ),
            ("lobbyId", self.lobby_id.as_deref(), LOBBY_ID_MAX_BYTES),
            ("gameId", self.game_id.as_deref(), GAME_ID_MAX_BYTES),
        ] {
            if let Some(value) = value {
                bounded_string(name, value, limit)?;
            }
        }
        validate_json(&self.payload, 0)?;
        let encoded = serde_json::to_vec(self).map_err(ProtocolError::Serialize)?;
        if encoded.len() > MAX_OBSERVATION_BYTES {
            return Err(ProtocolError::TooLarge(encoded.len()));
        }
        Ok(())
    }

    /// Serialize the validated canonical JSON form stored in the outbox.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError`] when validation or JSON serialization fails.
    pub fn to_bytes(&self) -> Result<Vec<u8>, ProtocolError> {
        self.validate()?;
        serde_json::to_vec(self).map_err(ProtocolError::Serialize)
    }
}

fn bounded_string(name: &'static str, value: &str, maximum: usize) -> Result<(), ProtocolError> {
    if value.is_empty() || value.len() > maximum {
        return Err(ProtocolError::InvalidString {
            name,
            actual: value.len(),
            maximum,
        });
    }
    Ok(())
}

fn validate_json(value: &Value, depth: usize) -> Result<(), ProtocolError> {
    if depth > MAX_JSON_DEPTH {
        return Err(ProtocolError::JsonDepth(depth));
    }
    match value {
        Value::Null | Value::Bool(_) | Value::Number(_) => Ok(()),
        Value::String(value) => {
            if value.len() > MAX_STRING_BYTES {
                return Err(ProtocolError::JsonString(value.len()));
            }
            Ok(())
        }
        Value::Array(values) => {
            if values.len() > MAX_ARRAY_ITEMS {
                return Err(ProtocolError::JsonArray(values.len()));
            }
            for value in values {
                validate_json(value, depth + 1)?;
            }
            Ok(())
        }
        Value::Object(values) => {
            if values.len() > MAX_OBJECT_KEYS {
                return Err(ProtocolError::JsonObject(values.len()));
            }
            for (key, value) in values {
                if key.is_empty()
                    || key.len() > MAX_KEY_BYTES
                    || UNSAFE_KEYS.contains(&key.as_str())
                {
                    return Err(ProtocolError::JsonKey(key.clone()));
                }
                validate_json(value, depth + 1)?;
            }
            Ok(())
        }
    }
}

/// Server response for one observation in a batch.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObservationReceipt {
    /// Observation idempotency key.
    pub observation_id: Uuid,
    /// Durable disposition.
    pub outcome: ObservationOutcome,
    /// Typed reason when the durable disposition is quarantine.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quarantine_reason: Option<ObservationQuarantineReason>,
}

/// Durable server disposition of an observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservationOutcome {
    /// First durable receipt.
    Accepted,
    /// Identical idempotent retry.
    AlreadyAccepted,
    /// Accepted for storage but excluded from effects pending review.
    Quarantined,
}

/// Batch request body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObservationBatch {
    /// Ordered observations, bounded to one hundred by both sides.
    pub observations: Vec<ObservationEnvelope>,
}

impl ObservationBatch {
    /// Select the largest ordered prefix that fits the backend wire limit.
    ///
    /// # Errors
    ///
    /// Returns [`ProtocolError`] if a durable observation no longer validates.
    pub fn bounded(
        observations: impl IntoIterator<Item = ObservationEnvelope>,
    ) -> Result<Self, ProtocolError> {
        let mut selected = Vec::new();
        let mut encoded_bytes = 19_usize;
        for observation in observations.into_iter().take(MAX_OBSERVATION_BATCH_ITEMS) {
            let observation_bytes = observation.to_bytes()?.len();
            let separator_bytes = usize::from(!selected.is_empty());
            if encoded_bytes + separator_bytes + observation_bytes > MAX_OBSERVATION_BATCH_BYTES {
                break;
            }
            encoded_bytes += separator_bytes + observation_bytes;
            selected.push(observation);
        }
        Ok(Self {
            observations: selected,
        })
    }
}

/// Authenticated device-version refresh sent before observation delivery.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckInRequest {
    /// Running client build version.
    pub app_version: String,
    /// Wire protocol version.
    pub protocol_version: u16,
}

/// Check-in acknowledgement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CheckInResponse {
    /// Whether the device record was refreshed.
    pub accepted: bool,
    /// First sequence not already retained by the backend for this device.
    pub next_sequence: u64,
}

/// Device self-revocation acknowledgement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RevokeDeviceResponse {
    /// Whether the backend accepted the revocation request.
    pub revoked: bool,
}

/// Batch response body.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObservationBatchReceipt {
    /// Receipt per submitted observation.
    pub receipts: Vec<ObservationReceipt>,
    /// Backend wall-clock time used to correct a clock-skewed observation.
    pub server_time: DateTime<Utc>,
}

/// Pairing creation request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreatePairingRequest {
    /// Friendly device name.
    pub device_name: String,
    /// `windows` or `macos`.
    pub platform: String,
    /// CPU architecture.
    pub architecture: String,
    /// Client build version.
    pub app_version: String,
    /// Wire protocol version.
    pub protocol_version: u16,
}

/// Pairing creation response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreatePairingResponse {
    /// Public pairing identifier.
    pub pairing_id: Uuid,
    /// One-time polling secret.
    pub pairing_secret: String,
    /// Browser approval URL.
    pub approval_url: String,
    /// RFC3339 expiry.
    pub expires_at: DateTime<Utc>,
}

/// Pairing exchange request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExchangePairingRequest {
    /// One-time polling secret returned at creation.
    pub pairing_secret: String,
}

/// Pairing exchange state.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ExchangePairingResponse {
    /// Browser approval has not happened yet.
    Pending,
    /// Device credential was issued exactly once.
    Approved {
        /// Device identifier embedded in the bearer token.
        #[serde(rename = "deviceId")]
        device_id: Uuid,
        /// Secret bearer credential; persist in the OS keychain.
        token: String,
    },
    /// The approved pairing credential was already exchanged.
    Consumed,
    /// Pairing expired before approval/exchange.
    Expired,
}

/// Protocol validation failure.
#[derive(Debug, Error)]
pub enum ProtocolError {
    /// Unsupported envelope protocol version.
    #[error("unsupported protocol version {0}")]
    UnsupportedProtocol(u16),
    /// Unsupported observation envelope schema version.
    #[error("unsupported observation schema version {0}")]
    UnsupportedObservationSchema(u16),
    /// A bounded envelope string was empty or too long.
    #[error("{name} length {actual} is outside 1..={maximum}")]
    InvalidString {
        /// Field name.
        name: &'static str,
        /// Actual byte count.
        actual: usize,
        /// Accepted byte count.
        maximum: usize,
    },
    /// Observation exceeds the maximum serialized size.
    #[error("observation is {0} bytes, exceeding the 4 MiB limit")]
    TooLarge(usize),
    /// Payload nesting is excessive.
    #[error("JSON payload depth {0} exceeds the limit")]
    JsonDepth(usize),
    /// Payload array is excessive.
    #[error("JSON payload array contains {0} entries")]
    JsonArray(usize),
    /// Payload object is excessive.
    #[error("JSON payload object contains {0} keys")]
    JsonObject(usize),
    /// Payload string is excessive.
    #[error("JSON payload string contains {0} bytes")]
    JsonString(usize),
    /// Payload key is unsafe or excessive.
    #[error("JSON payload contains unsafe key {0:?}")]
    JsonKey(String),
    /// JSON serialization failed.
    #[error("failed to serialize observation: {0}")]
    Serialize(serde_json::Error),
}

/// Stable map type used when deterministic ordering matters in protocol fixtures.
pub type ProtocolMap<T> = BTreeMap<String, T>;

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        MAX_OBSERVATION_BATCH_BYTES, OBSERVATION_SCHEMA_VERSION, ObservationBatch,
        ObservationBatchReceipt, ObservationEnvelope, ObservationKind, ObservationOutcome,
        ObservationQuarantineReason, ProtocolError,
    };

    #[test]
    fn accepts_a_bounded_gameplay_observation() -> Result<(), ProtocolError> {
        let observation = ObservationEnvelope::new(
            1,
            ObservationKind::Gameflow,
            "0.1.0",
            json!({ "phase": "Lobby" }),
        )?;
        observation.validate()
    }

    #[test]
    fn rejects_prototype_pollution_keys() {
        let result = ObservationEnvelope::new(
            1,
            ObservationKind::Lobby,
            "0.1.0",
            json!({ "__proto__": { "admin": true } }),
        );
        assert!(matches!(result, Err(ProtocolError::JsonKey(_))));
    }

    #[test]
    fn rejects_an_incompatible_persisted_schema() -> Result<(), ProtocolError> {
        let mut observation = ObservationEnvelope::new(
            1,
            ObservationKind::Gameflow,
            "0.1.0",
            json!({ "phase": "Lobby" }),
        )?;
        observation.schema_version = OBSERVATION_SCHEMA_VERSION + 1;

        assert!(matches!(
            observation.validate(),
            Err(ProtocolError::UnsupportedObservationSchema(_))
        ));
        Ok(())
    }

    #[test]
    fn rejects_excessive_depth() {
        let mut value = json!(true);
        for _ in 0..18 {
            value = json!({ "value": value });
        }
        let result = ObservationEnvelope::new(1, ObservationKind::Gameflow, "0.1.0", value);
        assert!(matches!(result, Err(ProtocolError::JsonDepth(_))));
    }

    #[test]
    fn parses_a_typed_clock_quarantine_receipt() -> Result<(), Box<dyn std::error::Error>> {
        let receipt: ObservationBatchReceipt = serde_json::from_value(json!({
            "receipts": [{
                "observationId": "018f47ef-3588-7b4e-b9b5-7b08091540df",
                "outcome": "quarantined",
                "quarantineReason": "future_timestamp"
            }],
            "serverTime": "2026-09-21T12:00:00Z"
        }))?;

        assert_eq!(receipt.receipts[0].outcome, ObservationOutcome::Quarantined);
        assert_eq!(
            receipt.receipts[0].quarantine_reason,
            Some(ObservationQuarantineReason::FutureTimestamp)
        );
        Ok(())
    }

    #[test]
    fn splits_an_ordered_batch_before_the_wire_limit() -> Result<(), ProtocolError> {
        let observations = (0..100)
            .map(|sequence| {
                ObservationEnvelope::new(
                    sequence,
                    ObservationKind::Challenges,
                    "0.1.0",
                    json!({ "values": vec!["x".repeat(16 * 1024); 3] }),
                )
            })
            .collect::<Result<Vec<_>, _>>()?;

        let batch = ObservationBatch::bounded(observations)?;
        let encoded = serde_json::to_vec(&batch).map_err(ProtocolError::Serialize)?;

        assert!(!batch.observations.is_empty());
        assert!(batch.observations.len() < 100);
        assert!(encoded.len() <= MAX_OBSERVATION_BATCH_BYTES);
        Ok(())
    }
}
