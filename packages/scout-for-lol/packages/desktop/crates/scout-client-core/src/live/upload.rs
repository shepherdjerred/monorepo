//! Uploading a finished game's recording as a `live_game_recording`
//! observation.
//!
//! The payload is the recording's samples in the [`LiveSnapshot`] allowlist
//! shape, so it carries no Riot ID, summoner name, skin, ward score, cooldown or
//! position by construction. [`queue_recording`] checks that again against the
//! shared contract's forbidden key list and size cap before anything reaches
//! the outbox, because a payload the server refuses would otherwise sit at the
//! head of the queue.
//!
//! Delivery is the existing outbox's: it retries, and de-duplicates by
//! observation id. The recordings database is marked at the moment the outbox
//! holds the observation, so a game is queued once.

use std::sync::{Arc, Mutex, PoisonError};

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

use super::recording::{
    GameStatus, RecordedGame, RecordedSample, RecordingError, RecordingHandoff, RecordingStore,
    SampleTrigger,
};
use super::snapshot::LiveSnapshot;
use crate::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, Diagnostics,
};
use crate::outbox::{ObservationOutbox, OutboxError};
use crate::protocol::{
    LIVE_GAME_RECORDING_FORBIDDEN_KEY_FRAGMENTS, LIVE_GAME_RECORDING_MAX_PAYLOAD_BYTES,
    ObservationEnvelope, ObservationKind, ProtocolError,
};

/// The `resource` of the payload, as the server's schema expects.
pub const RESOURCE: &str = "live_game_recording";

/// The observation's payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordingPayload {
    /// Always [`RESOURCE`].
    pub resource: String,
    /// The recording.
    pub data: RecordingData,
}

/// A recording: when it ran and its samples, oldest first.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RecordingData {
    /// When recording began.
    pub started_at: String,
    /// When recording ended.
    pub ended_at: String,
    /// The samples.
    pub samples: Vec<SamplePayload>,
}

/// One sample on the wire.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SamplePayload {
    /// The game clock, in whole seconds.
    pub game_time_secs: u32,
    /// Why it was taken.
    pub trigger: SampleTrigger,
    /// When it was taken.
    pub recorded_at: String,
    /// What it holds.
    pub snapshot: LiveSnapshot,
}

/// Why a recording was not queued.
#[derive(Debug, Error)]
pub enum UploadError {
    /// The recordings database failed.
    #[error(transparent)]
    Recording(#[from] RecordingError),
    /// The outbox refused the observation.
    #[error(transparent)]
    Outbox(#[from] OutboxError),
    /// The envelope was not valid.
    #[error(transparent)]
    Protocol(#[from] ProtocolError),
    /// The payload would not encode.
    #[error("the recording could not be encoded: {0}")]
    Json(#[from] serde_json::Error),
    /// A key name the contract forbids. Reaching this is a bug in the
    /// allowlist, so it is an error, never a silent drop.
    #[error("the recording holds the forbidden key {0:?}")]
    ForbiddenKey(String),
    /// Even two samples exceed the contract's payload cap.
    #[error("the recording does not fit the {LIVE_GAME_RECORDING_MAX_PAYLOAD_BYTES} byte cap")]
    TooLarge,
}

/// Why a finished recording was left on this device.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SkipReason {
    /// This device is not paired, so nothing is uploaded.
    NotPaired,
    /// The game did not end normally.
    NotFinished,
    /// It holds no samples.
    Empty,
    /// It was queued before, or the server already refused it.
    AlreadyQueued,
}

/// What [`queue_recording`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QueueOutcome {
    /// The outbox now holds the observation.
    Queued,
    /// The recording stays local.
    Skipped(SkipReason),
}

/// What the collector knows that a recording does not: the outbox of the paired
/// device (absent when unpaired), and which account and game it is playing.
/// Shared with the handoff, which runs inside the session's poll. The outbox
/// is looked up at hand-off time because pairing replaces it.
#[derive(Debug, Clone, Default)]
pub struct UploadContext {
    inner: Arc<Mutex<ContextState>>,
}

#[derive(Debug, Clone, Default)]
struct ContextState {
    outbox: Option<ObservationOutbox>,
    local_puuid: Option<String>,
    game_id: Option<String>,
}

impl UploadContext {
    /// The paired device's outbox, or `None` when no credential exists.
    /// Recordings are never queued without one.
    pub fn set_outbox(&self, outbox: Option<ObservationOutbox>) {
        self.state().outbox = outbox;
    }

    /// Remember the observer and the game in progress. A missing value keeps
    /// the last one, because the game id is gone by the time the game ends.
    pub fn observe(&self, local_puuid: Option<&str>, game_id: Option<&str>) {
        let mut state = self.state();
        if let Some(puuid) = local_puuid {
            state.local_puuid = Some(puuid.to_owned());
        }
        if let Some(game_id) = game_id {
            state.game_id = Some(game_id.to_owned());
        }
    }

    fn state(&self) -> std::sync::MutexGuard<'_, ContextState> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn read(&self) -> ContextState {
        self.state().clone()
    }
}

fn stamp(time: DateTime<Utc>) -> String {
    time.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn payload_for(game: &RecordedGame, samples: &[&RecordedSample]) -> RecordingPayload {
    let ended_at = game
        .ended_at
        .or_else(|| samples.last().map(|sample| sample.recorded_at))
        .unwrap_or(game.started_at);
    RecordingPayload {
        resource: RESOURCE.to_owned(),
        data: RecordingData {
            started_at: stamp(game.started_at),
            ended_at: stamp(ended_at),
            samples: samples
                .iter()
                .map(|sample| SamplePayload {
                    game_time_secs: sample.game_time_secs,
                    trigger: sample.trigger,
                    recorded_at: stamp(sample.recorded_at),
                    snapshot: sample.snapshot.clone(),
                })
                .collect(),
        },
    }
}

/// The recording's payload, thinned until it fits the contract's cap.
///
/// The store already holds a game to about a megabyte of snapshots, but the
/// wire form adds each sample's envelope fields. When the result is over the
/// cap, every second sample is dropped (never the first or the last) until it
/// fits.
///
/// # Errors
///
/// [`UploadError::TooLarge`] when even the first and last sample do not fit,
/// [`UploadError::ForbiddenKey`] when a key name is on the contract's list.
pub fn build_payload(
    game: &RecordedGame,
    samples: &[RecordedSample],
) -> Result<Value, UploadError> {
    let mut kept: Vec<&RecordedSample> = samples.iter().collect();
    loop {
        let value = serde_json::to_value(payload_for(game, &kept))?;
        if serde_json::to_vec(&value)?.len() <= LIVE_GAME_RECORDING_MAX_PAYLOAD_BYTES {
            forbid_keys(&value)?;
            return Ok(value);
        }
        if kept.len() <= 2 {
            return Err(UploadError::TooLarge);
        }
        let last = kept.len() - 1;
        let mut index = 0;
        kept.retain(|_| {
            let keep = index % 2 == 0 || index == last;
            index += 1;
            keep
        });
    }
}

fn forbid_keys(value: &Value) -> Result<(), UploadError> {
    match value {
        Value::Object(map) => {
            for (key, inner) in map {
                let lowered = key.to_lowercase();
                if LIVE_GAME_RECORDING_FORBIDDEN_KEY_FRAGMENTS
                    .iter()
                    .any(|fragment| lowered.contains(fragment))
                {
                    return Err(UploadError::ForbiddenKey(key.clone()));
                }
                forbid_keys(inner)?;
            }
            Ok(())
        }
        Value::Array(items) => items.iter().try_for_each(forbid_keys),
        _ => Ok(()),
    }
}

/// Queue a finished game's recording in `outbox` and mark it queued in
/// `store`.
///
/// # Errors
///
/// [`UploadError`] when the samples cannot be read, the payload cannot be
/// built, or the outbox refuses it. The game is left unmarked on failure.
pub fn queue_recording(
    store: &mut RecordingStore,
    game: &RecordedGame,
    context: &UploadContext,
    app_version: &str,
    now: DateTime<Utc>,
) -> Result<QueueOutcome, UploadError> {
    let state = context.read();
    let Some(outbox) = &state.outbox else {
        return Ok(QueueOutcome::Skipped(SkipReason::NotPaired));
    };
    if game.status != GameStatus::Finished {
        return Ok(QueueOutcome::Skipped(SkipReason::NotFinished));
    }
    // Read the stored game, not the caller's copy, so a second offer of the
    // same game sees that the first one marked it.
    let stored = store.game(game.id)?;
    if stored
        .as_ref()
        .is_some_and(|g| g.upload_queued_at.is_some())
    {
        return Ok(QueueOutcome::Skipped(SkipReason::AlreadyQueued));
    }
    let samples = store.samples(game.id)?;
    if samples.is_empty() {
        return Ok(QueueOutcome::Skipped(SkipReason::Empty));
    }
    let payload = build_payload(game, &samples)?;
    let mut observation = ObservationEnvelope::new(
        outbox.next_sequence()?,
        ObservationKind::LiveGameRecording,
        app_version,
        payload,
    )?;
    observation.local_puuid.clone_from(&state.local_puuid);
    // A replayed or unnamed game has no usable id; the envelope accepts only
    // digits, and the recording is still worth keeping without one.
    observation.game_id = state
        .game_id
        .clone()
        .filter(|id| !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit()));
    outbox.enqueue(&observation)?;
    store.mark_upload_queued(game.id, &observation.observation_id.to_string(), now)?;
    Ok(QueueOutcome::Queued)
}

/// Queues each finished recording in the outbox as it ends.
pub struct OutboxHandoff {
    context: UploadContext,
    app_version: &'static str,
    diagnostics: Arc<Diagnostics>,
}

impl OutboxHandoff {
    /// Hand recordings to the outbox `context` names, as the account it names.
    #[must_use]
    pub fn new(
        context: UploadContext,
        app_version: &'static str,
        diagnostics: Arc<Diagnostics>,
    ) -> Self {
        Self {
            context,
            app_version,
            diagnostics,
        }
    }
}

impl RecordingHandoff for OutboxHandoff {
    fn finished(&self, recording: &RecordedGame, store: &mut RecordingStore) {
        let outcome = queue_recording(
            store,
            recording,
            &self.context,
            self.app_version,
            Utc::now(),
        );
        let (event_outcome, detail) = match outcome {
            Ok(QueueOutcome::Queued) => (DiagnosticOutcome::Succeeded, None),
            Ok(QueueOutcome::Skipped(_)) => return,
            Err(error) => (DiagnosticOutcome::Failed, Some(error.to_string())),
        };
        let event = DiagnosticEvent::new(
            DiagnosticLevel::Warn,
            DiagnosticCategory::Outbox,
            "queue_live_recording",
            event_outcome,
        );
        self.diagnostics.record(match detail {
            Some(detail) => event.with_detail(detail),
            None => event,
        });
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, TimeZone, Utc};
    use serde_json::Value;

    use super::{
        QueueOutcome, RecordingPayload, SkipReason, UploadContext, UploadError, build_payload,
        queue_recording,
    };
    use crate::live::recording::{RecordedGame, RecordingStore, SampleTrigger};
    use crate::live::snapshot::tests::fixture_snapshot;
    use crate::outbox::ObservationOutbox;
    use crate::protocol::{
        LIVE_GAME_RECORDING_FORBIDDEN_KEY_FRAGMENTS, LIVE_GAME_RECORDING_MAX_PAYLOAD_BYTES,
        ObservationEnvelope, ObservationKind,
    };

    const FIXTURE: &str =
        include_str!("../../../../../data/src/scout-client/live-game-recording.fixtures.json");

    fn start() -> chrono::DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 11, 14, 12, 0, 0)
            .single()
            .unwrap_or_default()
    }

    fn outbox() -> Result<(ObservationOutbox, std::path::PathBuf), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!("scout-upload-{}.db", uuid::Uuid::new_v4()));
        Ok((ObservationOutbox::open(&path)?, path))
    }

    fn paired_context(outbox: &ObservationOutbox) -> UploadContext {
        let context = UploadContext::default();
        context.set_outbox(Some(outbox.clone()));
        context.observe(Some("puuid-1"), Some("5653248720"));
        context
    }

    /// A finished game of `steps` six-second samples.
    fn finished_game(
        steps: u32,
    ) -> Result<(RecordingStore, RecordedGame), Box<dyn std::error::Error>> {
        let base = fixture_snapshot()?;
        let mut store = RecordingStore::open_in_memory()?;
        let id = store.begin_game(start())?;
        for step in 0..steps {
            let mut snapshot = base.clone();
            snapshot.game.game_time_secs = step * 6;
            let at = start() + Duration::seconds(i64::from(step) * 6);
            store.append(id, &snapshot, SampleTrigger::Interval, at)?;
        }
        let game = store.finish_game(id, start() + Duration::seconds(i64::from(steps) * 6))?;
        Ok((store, game))
    }

    #[test]
    fn a_finished_game_is_queued_once_and_marked() -> Result<(), Box<dyn std::error::Error>> {
        let (outbox, path) = outbox()?;
        let (mut store, game) = finished_game(5)?;
        let context = paired_context(&outbox);

        let queued = queue_recording(&mut store, &game, &context, "test", start())?;
        assert_eq!(queued, QueueOutcome::Queued);
        let again = queue_recording(&mut store, &game, &context, "test", start())?;
        assert_eq!(again, QueueOutcome::Skipped(SkipReason::AlreadyQueued));

        let pending = outbox.pending(10)?;
        assert_eq!(pending.len(), 1, "one game is one observation");
        let sent: ObservationEnvelope = serde_json::from_slice(&pending[0].body)?;
        assert_eq!(sent.kind, ObservationKind::LiveGameRecording);
        assert_eq!(sent.local_puuid.as_deref(), Some("puuid-1"));
        assert_eq!(sent.game_id.as_deref(), Some("5653248720"));
        assert_eq!(sent.payload["resource"], "live_game_recording");
        assert_eq!(
            sent.payload["data"]["samples"].as_array().map(Vec::len),
            Some(store.samples(game.id)?.len())
        );
        assert!(
            store
                .game(game.id)?
                .is_some_and(|g| g.upload_queued_at.is_some())
        );
        drop(outbox);
        std::fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn an_unpaired_device_keeps_the_recording_local() -> Result<(), Box<dyn std::error::Error>> {
        let (outbox, path) = outbox()?;
        let (mut store, game) = finished_game(3)?;
        let context = UploadContext::default();
        let outcome = queue_recording(&mut store, &game, &context, "test", start())?;
        assert_eq!(outcome, QueueOutcome::Skipped(SkipReason::NotPaired));
        assert_eq!(outbox.pending(10)?.len(), 0);
        assert!(
            store
                .game(game.id)?
                .is_some_and(|g| g.upload_queued_at.is_none())
        );
        drop(outbox);
        std::fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn an_interrupted_game_is_not_uploaded() -> Result<(), Box<dyn std::error::Error>> {
        let (outbox, path) = outbox()?;
        let (mut store, mut game) = finished_game(3)?;
        game.status = crate::live::recording::GameStatus::Interrupted;
        let outcome =
            queue_recording(&mut store, &game, &paired_context(&outbox), "test", start())?;
        assert_eq!(outcome, QueueOutcome::Skipped(SkipReason::NotFinished));
        drop(outbox);
        std::fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn a_game_with_no_usable_id_is_still_queued_without_one()
    -> Result<(), Box<dyn std::error::Error>> {
        let (outbox, path) = outbox()?;
        let (mut store, game) = finished_game(3)?;
        let context = UploadContext::default();
        context.set_outbox(Some(outbox.clone()));
        context.observe(None, Some("not-a-number"));
        queue_recording(&mut store, &game, &context, "test", start())?;
        let sent: ObservationEnvelope = serde_json::from_slice(&outbox.pending(10)?[0].body)?;
        assert_eq!(sent.game_id, None);
        assert_eq!(sent.local_puuid, None);
        drop(outbox);
        std::fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn a_long_game_is_thinned_to_fit_the_cap_and_keeps_its_ends()
    -> Result<(), Box<dyn std::error::Error>> {
        let (store, game) = finished_game(1_200)?;
        let samples = store.samples(game.id)?;
        let payload = build_payload(&game, &samples)?;
        assert!(serde_json::to_vec(&payload)?.len() <= LIVE_GAME_RECORDING_MAX_PAYLOAD_BYTES);
        let sent = payload["data"]["samples"].as_array().ok_or("samples")?;
        assert_eq!(
            sent.first().and_then(|s| s["game_time_secs"].as_u64()),
            samples.first().map(|s| u64::from(s.game_time_secs))
        );
        assert_eq!(
            sent.last().and_then(|s| s["game_time_secs"].as_u64()),
            samples.last().map(|s| u64::from(s.game_time_secs))
        );
        Ok(())
    }

    #[test]
    fn no_name_riot_id_or_other_forbidden_key_leaves_the_device()
    -> Result<(), Box<dyn std::error::Error>> {
        let (store, game) = finished_game(4)?;
        let payload = build_payload(&game, &store.samples(game.id)?)?;
        let mut keys = Vec::new();
        collect_keys(&payload, &mut keys);
        for key in keys {
            let lowered = key.to_lowercase();
            assert!(
                !LIVE_GAME_RECORDING_FORBIDDEN_KEY_FRAGMENTS
                    .iter()
                    .any(|fragment| lowered.contains(fragment)),
                "{key} is forbidden"
            );
        }
        Ok(())
    }

    fn collect_keys(value: &Value, into: &mut Vec<String>) {
        match value {
            Value::Object(map) => {
                for (key, inner) in map {
                    into.push(key.clone());
                    collect_keys(inner, into);
                }
            }
            Value::Array(items) => items.iter().for_each(|item| collect_keys(item, into)),
            _ => {}
        }
    }

    #[test]
    fn the_shared_fixture_is_exactly_what_the_client_writes()
    -> Result<(), Box<dyn std::error::Error>> {
        let fixture: Value = serde_json::from_str(FIXTURE)?;
        let recording = fixture.get("recording").ok_or("recording")?.clone();
        let typed: RecordingPayload = serde_json::from_value(recording.clone())?;
        assert_eq!(serde_json::to_value(&typed)?, recording);
        assert_eq!(typed.resource, "live_game_recording");
        assert_eq!(typed.data.samples.len(), 2);
        Ok(())
    }

    #[test]
    fn a_payload_with_a_forbidden_key_would_not_encode() {
        let error = super::forbid_keys(&serde_json::json!({ "a": [{ "summonerName": "x" }] }));
        assert!(matches!(error, Err(UploadError::ForbiddenKey(key)) if key == "summonerName"));
    }
}
