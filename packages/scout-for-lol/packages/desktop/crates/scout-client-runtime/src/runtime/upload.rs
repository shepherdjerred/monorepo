//! Delivering outbox batches and applying the backend receipts.

use scout_client_core::backend::ScoutBackendClient;
use scout_client_core::credentials::DeviceCredential;
use scout_client_core::diagnostics::Diagnostics;
use scout_client_core::outbox::ObservationOutbox;
use scout_client_core::protocol::ObservationBatch;
use scout_client_core::protocol::ObservationEnvelope;
use scout_client_core::protocol::ObservationKind;
use scout_client_core::protocol::ObservationOutcome;
use scout_client_core::protocol::ObservationQuarantineReason;
use scout_client_core::protocol::ObservationReceipt;
use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;

use super::replay::record_backend_outcome;
use super::state::{StateHub, clear_runtime_error, update_state};

pub(super) async fn upload_pending(
    state: &StateHub,
    backend: &ScoutBackendClient,
    outbox: &ObservationOutbox,
    credential: &DeviceCredential,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    let pending = outbox.pending(100).map_err(|error| error.to_string())?;
    if pending.is_empty() {
        return Ok(());
    }
    let observations = pending
        .iter()
        .map(|row| serde_json::from_slice::<ObservationEnvelope>(&row.body))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Could not decode durable observation: {error}"))?;
    let batch = ObservationBatch::bounded(observations)
        .map_err(|error| format!("Could not build bounded observation batch: {error}"))?;
    if batch.observations.is_empty() {
        return Err("Durable observation does not fit the ingress wire limit".to_owned());
    }
    let submitted: HashMap<Uuid, ObservationEnvelope> = batch
        .observations
        .iter()
        .cloned()
        .map(|observation| (observation.observation_id, observation))
        .collect();
    let submitted_count = submitted.len() as u64;
    let started = std::time::Instant::now();
    let outcome = backend.upload_observations(credential, &batch).await;
    let receipt = record_backend_outcome(
        diagnostics,
        "upload_observations",
        started,
        outcome,
        Some(submitted_count),
    )?;
    diagnostics.counters().observation_uploaded(submitted_count);
    for item in receipt.receipts {
        if let Some(observation) = submitted.get(&item.observation_id) {
            apply_observation_receipt(outbox, observation, &item, &receipt.server_time)?;
        }
    }
    let remaining = outbox.pending(100).map_err(|error| error.to_string())?;
    update_state(state, |snapshot| {
        snapshot.pending_observations = remaining.len();
        snapshot.last_upload_at = Some(chrono::Utc::now().to_rfc3339());
        clear_runtime_error(snapshot);
    });
    Ok(())
}

pub(super) fn apply_observation_receipt(
    outbox: &ObservationOutbox,
    observation: &ObservationEnvelope,
    receipt: &ObservationReceipt,
    server_time: &chrono::DateTime<chrono::Utc>,
) -> Result<(), String> {
    if receipt.outcome == ObservationOutcome::Quarantined {
        let reason = receipt
            .quarantine_reason
            .ok_or_else(|| "Quarantine receipt omitted its typed reason".to_owned())?;
        if reason == ObservationQuarantineReason::FutureTimestamp {
            let mut replacement = observation.clone();
            replacement.observation_id = Uuid::new_v4();
            replacement.sequence = outbox.next_sequence().map_err(|error| error.to_string())?;
            if replacement.kind == ObservationKind::PostGame {
                let clock_delta_millis = server_time
                    .timestamp_millis()
                    .checked_sub(observation.captured_at.timestamp_millis())
                    .ok_or_else(|| "Clock correction exceeds the supported range".to_owned())?;
                adjust_post_game_timing(&mut replacement.payload, clock_delta_millis)?;
            }
            replacement.captured_at = *server_time;
            replacement.validate().map_err(|error| error.to_string())?;
            // The corrected payload is durable before the quarantined head is
            // removed, so a crash cannot lose ephemeral post-game evidence.
            outbox
                .enqueue(&replacement)
                .map_err(|error| error.to_string())?;
        }
    }
    outbox
        .acknowledge(receipt.observation_id)
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub(super) fn adjust_post_game_timing(
    payload: &mut Value,
    clock_delta_millis: i64,
) -> Result<(), String> {
    let Some(timing) = payload
        .get_mut("data")
        .and_then(|data| data.get_mut("timing"))
        .and_then(Value::as_object_mut)
    else {
        return Ok(());
    };
    for key in ["gameStartTimestamp", "gameEndTimestamp"] {
        let Some(timestamp) = timing.get_mut(key) else {
            continue;
        };
        let current = timestamp
            .as_i64()
            .ok_or_else(|| format!("Post-game {key} is not an integer timestamp"))?;
        *timestamp = Value::from(
            current
                .checked_add(clock_delta_millis)
                .ok_or_else(|| format!("Post-game {key} exceeds the supported range"))?,
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use scout_client_core::outbox::ObservationOutbox;
    use scout_client_core::protocol::ObservationEnvelope;
    use scout_client_core::protocol::ObservationKind;
    use scout_client_core::protocol::ObservationOutcome;
    use scout_client_core::protocol::ObservationQuarantineReason;
    use scout_client_core::protocol::ObservationReceipt;
    use serde_json::json;

    use uuid::Uuid;

    #[test]
    fn clock_quarantine_requeues_before_removing_the_original()
    -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!("scout-runtime-{}.db", Uuid::new_v4()));
        let outbox = ObservationOutbox::open(&path)?;
        let mut observation = ObservationEnvelope::new(
            outbox.next_sequence()?,
            ObservationKind::PostGame,
            "test",
            json!({
                "resource": "post_game",
                "data": {
                    "timing": {
                        "gameStartTimestamp": 1_795_257_000_000_i64,
                        "gameEndTimestamp": 1_795_257_300_000_i64,
                    },
                },
            }),
        )?;
        observation.captured_at = "2026-09-21T12:10:00Z".parse()?;
        let original_id = observation.observation_id;
        outbox.enqueue(&observation)?;
        let server_time = "2026-09-21T12:00:00Z".parse()?;

        apply_observation_receipt(
            &outbox,
            &observation,
            &ObservationReceipt {
                observation_id: original_id,
                outcome: ObservationOutcome::Quarantined,
                quarantine_reason: Some(ObservationQuarantineReason::FutureTimestamp),
            },
            &server_time,
        )?;

        let pending = outbox.pending(100)?;
        assert_eq!(pending.len(), 1);
        assert_ne!(pending[0].observation_id, original_id);
        assert_eq!(pending[0].sequence, 2);
        let replacement: ObservationEnvelope = serde_json::from_slice(&pending[0].body)?;
        assert_eq!(replacement.captured_at, server_time);
        assert_eq!(
            replacement.payload["data"]["timing"]["gameStartTimestamp"],
            json!(1_795_256_400_000_i64)
        );
        assert_eq!(
            replacement.payload["data"]["timing"]["gameEndTimestamp"],
            json!(1_795_256_700_000_i64)
        );

        drop(outbox);
        std::fs::remove_file(path)?;
        Ok(())
    }
}
