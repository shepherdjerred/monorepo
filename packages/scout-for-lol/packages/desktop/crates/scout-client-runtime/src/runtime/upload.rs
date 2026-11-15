//! Delivering outbox batches and applying the backend receipts.

use scout_client_core::backend::{BackendError, RecordingRefusal, ScoutBackendClient};
use scout_client_core::credentials::DeviceCredential;
use scout_client_core::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, Diagnostics,
};
use scout_client_core::live::recording::{RECORDINGS_FILE, RecordingStore};
use scout_client_core::outbox::ObservationOutbox;
use scout_client_core::protocol::ObservationBatch;
use scout_client_core::protocol::ObservationEnvelope;
use scout_client_core::protocol::ObservationKind;
use scout_client_core::protocol::ObservationOutcome;
use scout_client_core::protocol::ObservationQuarantineReason;
use scout_client_core::protocol::ObservationReceipt;
use scout_client_core::telemetry::UsageEvent;
use serde_json::Value;
use std::collections::HashMap;
use uuid::Uuid;

use super::paths::data_directory;
use super::replay::record_backend_outcome;
use super::state::{StateHub, clear_runtime_error, observe_upgrade_requirement, update_state};
use super::usage::UsageQueue;

pub(super) async fn upload_pending(
    state: &StateHub,
    backend: &ScoutBackendClient,
    outbox: &ObservationOutbox,
    credential: &DeviceCredential,
    diagnostics: &Diagnostics,
    usage: &UsageQueue,
) -> Result<(), String> {
    let recordings = data_directory().map(|directory| directory.join(RECORDINGS_FILE));
    upload_pending_with(
        state,
        backend,
        outbox,
        credential,
        diagnostics,
        usage,
        recordings.as_deref(),
    )
    .await
}

async fn upload_pending_with(
    state: &StateHub,
    backend: &ScoutBackendClient,
    outbox: &ObservationOutbox,
    credential: &DeviceCredential,
    diagnostics: &Diagnostics,
    usage: &UsageQueue,
    recordings: Option<&std::path::Path>,
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
    if let Err(BackendError::RecordingRefused(refusal)) = &outcome {
        drop_refused_recording(outbox, refusal, diagnostics, recordings)?;
        return Ok(());
    }
    observe_upgrade_requirement(state, &outcome);
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
            if observation.kind == ObservationKind::PostGame
                && item.outcome == ObservationOutcome::Accepted
            {
                usage.push(UsageEvent::PostGameReported);
            }
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

/// The server refused one recording for good. Take that entry out of the queue
/// so the observations behind it go out on the next tick, and remember the
/// reason beside the recording. Nothing else of the batch was stored, so it is
/// simply sent again without the refused entry.
fn drop_refused_recording(
    outbox: &ObservationOutbox,
    refusal: &RecordingRefusal,
    diagnostics: &Diagnostics,
    recordings: Option<&std::path::Path>,
) -> Result<(), String> {
    outbox
        .acknowledge(refusal.observation_id)
        .map_err(|error| error.to_string())?;
    let observation_id = refusal.observation_id.to_string();
    let marked = recordings
        .filter(|path| path.exists())
        .map(|path| mark_refused(path, &observation_id, refusal.reason.as_str()));
    mark_outcome(diagnostics, refusal, marked.unwrap_or(Ok(false)));
    Ok(())
}

fn mark_refused(
    path: &std::path::Path,
    observation_id: &str,
    reason: &str,
) -> Result<bool, String> {
    RecordingStore::open_shared(path)
        .and_then(|mut store| store.mark_upload_refused(observation_id, reason))
        .map_err(|error| error.to_string())
}

fn mark_outcome(
    diagnostics: &Diagnostics,
    refusal: &RecordingRefusal,
    marked: Result<bool, String>,
) {
    // The shape of what happened, never the recording or an identity.
    let mut detail = format!(
        "the server refused a live game recording: {}",
        refusal.reason.as_str()
    );
    if let Err(error) = marked {
        detail = format!("{detail}; could not mark it refused locally: {error}");
    }
    diagnostics.record(
        DiagnosticEvent::new(
            DiagnosticLevel::Warn,
            DiagnosticCategory::Backend,
            "upload_live_recording",
            DiagnosticOutcome::Failed,
        )
        .with_status(422)
        .with_detail(detail),
    );
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
    use scout_client_core::diagnostics::Diagnostics;
    use scout_client_core::outbox::ObservationOutbox;
    use scout_client_core::protocol::ObservationEnvelope;
    use scout_client_core::protocol::ObservationKind;
    use scout_client_core::protocol::ObservationOutcome;
    use scout_client_core::protocol::ObservationQuarantineReason;
    use scout_client_core::protocol::ObservationReceipt;
    use serde_json::json;

    use uuid::Uuid;

    /// Serve `answers` in order, one per request, and return each request body.
    async fn serve(
        answers: Vec<(u16, String)>,
    ) -> Result<(String, tokio::task::JoinHandle<Vec<String>>), Box<dyn std::error::Error>> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
        let origin = format!("http://{}", listener.local_addr()?);
        let task = tokio::spawn(async move {
            let mut bodies = Vec::new();
            for (status, body) in answers {
                let Ok((mut stream, _)) = listener.accept().await else {
                    break;
                };
                let mut received = Vec::new();
                let mut chunk = [0_u8; 8192];
                while let Ok(read) = stream.read(&mut chunk).await {
                    received.extend_from_slice(&chunk[..read]);
                    let text = String::from_utf8_lossy(&received).into_owned();
                    if let Some((head, rest)) = text.split_once("\r\n\r\n") {
                        let length = head
                            .lines()
                            .find_map(|line| {
                                line.to_lowercase()
                                    .strip_prefix("content-length:")
                                    .and_then(|value| value.trim().parse::<usize>().ok())
                            })
                            .unwrap_or(0);
                        if rest.len() >= length || read == 0 {
                            bodies.push(rest.to_owned());
                            break;
                        }
                    } else if read == 0 {
                        break;
                    }
                }
                let reply = format!(
                    "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(reply.as_bytes()).await;
            }
            bodies
        });
        Ok((origin, task))
    }

    #[tokio::test]
    async fn a_refused_recording_leaves_the_queue_and_the_bundle_behind_it_uploads()
    -> Result<(), Box<dyn std::error::Error>> {
        let directory = std::env::temp_dir().join(format!("scout-refusal-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&directory)?;
        let outbox = ObservationOutbox::open(directory.join("outbox.db"))?;
        let recording = ObservationEnvelope::new(
            outbox.next_sequence()?,
            ObservationKind::LiveGameRecording,
            "test",
            json!({ "resource": "live_game_recording", "data": {} }),
        )?;
        let bundle = ObservationEnvelope::new(
            outbox.next_sequence()?,
            ObservationKind::PostGame,
            "test",
            json!({ "resource": "post_game", "data": {} }),
        )?;
        outbox.enqueue(&recording)?;
        outbox.enqueue(&bundle)?;

        // The recordings database remembers which game the observation was.
        let recordings = directory.join(RECORDINGS_FILE);
        let mut store = RecordingStore::open(&recordings)?;
        let id = store.begin_game(chrono::Utc::now())?;
        store.finish_game(id, chrono::Utc::now())?;
        store.mark_upload_queued(
            id,
            &recording.observation_id.to_string(),
            chrono::Utc::now(),
        )?;
        drop(store);

        let refusal = json!({
            "error": "live_game_recording_refused",
            "reason": "too_large",
            "observationId": recording.observation_id,
            "detail": "2000000 bytes",
        })
        .to_string();
        let receipts = json!({
            "receipts": [{ "observationId": bundle.observation_id, "outcome": "accepted" }],
            "serverTime": "2026-11-14T12:00:00Z",
        })
        .to_string();
        let (origin, server) = serve(vec![(422, refusal), (200, receipts)]).await?;
        let backend = ScoutBackendClient::new(&origin)?;
        let credential = DeviceCredential {
            device_id: Uuid::new_v4(),
            token: "token".to_owned(),
        };
        let state = StateHub::default();
        let diagnostics = Diagnostics::in_memory();
        let usage = UsageQueue::default();

        // First pass: the server refuses the recording. The pass is not an
        // error, the recording is gone from the queue, the bundle is not.
        upload_pending_with(
            &state,
            &backend,
            &outbox,
            &credential,
            &diagnostics,
            &usage,
            Some(&recordings),
        )
        .await?;
        let pending = outbox.pending(10)?;
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].observation_id, bundle.observation_id);
        let store = RecordingStore::open_shared(&recordings)?;
        assert_eq!(
            store.games()?[0].upload_refused_reason.as_deref(),
            Some("too_large")
        );
        drop(store);

        // Second pass: the bundle uploads.
        upload_pending_with(
            &state,
            &backend,
            &outbox,
            &credential,
            &diagnostics,
            &usage,
            Some(&recordings),
        )
        .await?;
        assert_eq!(outbox.pending(10)?.len(), 0);
        let bodies = server.await?;
        assert_eq!(bodies.len(), 2);
        assert!(bodies[0].contains("live_game_recording"));
        assert!(!bodies[1].contains("live_game_recording"));
        assert!(bodies[1].contains("post_game"));
        drop(outbox);
        std::fs::remove_dir_all(directory)?;
        Ok(())
    }

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
