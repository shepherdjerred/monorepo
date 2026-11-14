//! Replay file scanning, offers, and upload.

use scout_client_core::backend::BackendError;
use scout_client_core::backend::ReplayOffer;
use scout_client_core::backend::ReplayOfferDecision;
use scout_client_core::backend::ScoutBackendClient;
use scout_client_core::credentials::DeviceCredential;
use scout_client_core::diagnostics::DiagnosticCategory;
use scout_client_core::diagnostics::DiagnosticEvent;
use scout_client_core::diagnostics::DiagnosticLevel;
use scout_client_core::diagnostics::DiagnosticOutcome;
use scout_client_core::diagnostics::Diagnostics;
use scout_client_core::lcu::LcuClient;
use scout_client_core::lcu::LcuEndpoint;
use scout_client_core::lcu::discover_lockfile;
use scout_client_core::outbox::ObservationOutbox;
use scout_client_core::protocol::ObservationKind;
use sha2::Digest as _;
use sha2::Sha256;
use std::collections::HashMap;
use std::io::Read as _;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use std::time::UNIX_EPOCH;
use tokio::task::JoinHandle;

use super::gameflow::optional_lockfile;
use super::observe::{ObservationSlot, enqueue_resource_if_changed};
use super::state::{StateHub, clear_replay_error, set_replay_error, update_state};

pub(super) type ReplayUploadTask = JoinHandle<Result<(), String>>;

pub(super) fn start_replay_upload(
    backend: &ScoutBackendClient,
    outbox: &ObservationOutbox,
    credential: &DeviceCredential,
    diagnostics: &Arc<Diagnostics>,
) -> ReplayUploadTask {
    let backend = backend.clone();
    let outbox = outbox.clone();
    let credential = credential.clone();
    let diagnostics = Arc::clone(diagnostics);
    tokio::spawn(
        async move { upload_new_replays(&backend, &outbox, &credential, &diagnostics).await },
    )
}

pub(super) fn cancel_replay_upload(task: &mut Option<ReplayUploadTask>) {
    if let Some(active) = task.take() {
        active.abort();
    }
}

pub(super) async fn finish_replay_upload(state: &StateHub, task: &mut Option<ReplayUploadTask>) {
    if !task.as_ref().is_some_and(JoinHandle::is_finished) {
        return;
    }
    let Some(finished) = task.take() else {
        return;
    };
    match finished.await {
        Ok(Ok(())) => update_state(state, clear_replay_error),
        Ok(Err(error)) => set_replay_error(state, error),
        Err(error) => set_replay_error(state, format!("Replay upload task failed: {error}")),
    }
}

pub(super) async fn upload_new_replays(
    backend: &ScoutBackendClient,
    outbox: &ObservationOutbox,
    credential: &DeviceCredential,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    // Collected rather than returned on sight: a failure on one file must not
    // skip every replay behind it in the directory.
    let mut scan_error: Option<String> = None;
    let Some(lockfile) = optional_lockfile(discover_lockfile())? else {
        return Ok(());
    };
    let client = LcuClient::new(&lockfile).map_err(|error| error.to_string())?;
    let replay_path = client
        .get(LcuEndpoint::ReplayPath)
        .await
        .map_err(|error| error.to_string())?
        .and_then(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .or_else(|| value.get("path")?.as_str().map(str::to_owned))
        });
    let Some(replay_path) = replay_path else {
        return Ok(());
    };
    for entry in std::fs::read_dir(replay_path).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        match scan_replay_entry(backend, outbox, credential, diagnostics, &entry).await? {
            ReplayDelivery::Settled | ReplayDelivery::Deferred => {}
            ReplayDelivery::Unresolved(detail) => {
                scan_error.get_or_insert(detail);
            }
        }
    }
    match scan_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

/// Consider one directory entry, and deliver it when it is a settled replay.
///
/// Entries that are not finished replays are reported as `Settled`: there is
/// nothing to deliver and nothing to report.
pub(super) async fn scan_replay_entry(
    backend: &ScoutBackendClient,
    outbox: &ObservationOutbox,
    credential: &DeviceCredential,
    diagnostics: &Diagnostics,
    entry: &std::fs::DirEntry,
) -> Result<ReplayDelivery, String> {
    {
        if !entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            return Ok(ReplayDelivery::Settled);
        }
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("rofl") {
            return Ok(ReplayDelivery::Settled);
        }
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if metadata.len() == 0 || metadata.len() > 512 * 1024 * 1024 {
            return Ok(ReplayDelivery::Settled);
        }
        let is_stable = metadata
            .modified()
            .ok()
            .and_then(|modified| modified.elapsed().ok())
            .is_some_and(|age| age >= Duration::from_secs(30));
        if !is_stable {
            return Ok(ReplayDelivery::Settled);
        }
        let platform_id = replay_platform_id(&path);
        let Some(game_id) = replay_game_id(&path) else {
            return Ok(ReplayDelivery::Settled);
        };
        let path_key = path.to_string_lossy().into_owned();
        let bytes = i64::try_from(metadata.len())
            .map_err(|_| "Replay size is outside the supported range".to_owned())?;
        let modified_at_millis = i64::try_from(
            metadata
                .modified()
                .map_err(|error| error.to_string())?
                .duration_since(UNIX_EPOCH)
                .map_err(|error| error.to_string())?
                .as_millis(),
        )
        .map_err(|_| "Replay modification time is outside the supported range".to_owned())?;
        if outbox
            .replay_file_handled(&path_key, bytes, modified_at_millis)
            .map_err(|error| error.to_string())?
        {
            return Ok(ReplayDelivery::Settled);
        }
        let digest = replay_sha256(path.clone()).await?;
        if outbox
            .replay_handled(&digest)
            .map_err(|error| error.to_string())?
        {
            outbox
                .mark_replay_file_handled(&path_key, bytes, modified_at_millis, &digest)
                .map_err(|error| error.to_string())?;
            return Ok(ReplayDelivery::Settled);
        }
        if !outbox
            .replay_retry_due(&digest, chrono::Utc::now().timestamp_millis())
            .map_err(|error| error.to_string())?
        {
            return Ok(ReplayDelivery::Deferred);
        }
        match deliver_replay(
            backend,
            outbox,
            credential,
            diagnostics,
            &ReplayCandidate {
                game_id: &game_id,
                platform_id: platform_id.as_deref(),
                digest: &digest,
                path: &path,
                bytes: metadata.len(),
            },
        )
        .await?
        {
            // A deferral leaves the file unhandled on purpose, so the next
            // scan offers it again.
            ReplayDelivery::Deferred => return Ok(ReplayDelivery::Deferred),
            ReplayDelivery::Unresolved(detail) => {
                return Ok(ReplayDelivery::Unresolved(detail));
            }
            ReplayDelivery::Settled => {}
        }
        outbox
            .mark_replay_file_handled(&path_key, bytes, modified_at_millis, &digest)
            .map_err(|error| error.to_string())?;
        Ok(ReplayDelivery::Settled)
    }
}

/// Number of deferrals after which a replay is worth a warning.
pub(super) const REPLAY_DEFERRAL_ATTENTION_ATTEMPTS: i64 = 5;

/// What the offer settled, before any bytes are read.
pub(super) enum ReplayOfferOutcome {
    /// The server wants it; upload.
    Send,
    /// Nothing more to do for this file, now or ever.
    Settled,
    /// Ask again on a later scan.
    Deferred,
    /// The offer itself failed; record it and move to the next file.
    Unresolved(String),
}

/// Record one Scout backend call and hand back its result as a message.
///
/// The client used to stringify a `BackendError` at the first call boundary,
/// which threw away the status before anything could count or branch on it.
/// Every caller now goes through here, so the counters and the log agree about
/// what the server said.
pub(super) fn record_backend_outcome<T>(
    diagnostics: &Diagnostics,
    operation: &'static str,
    started: std::time::Instant,
    outcome: Result<T, BackendError>,
    bytes: Option<u64>,
) -> Result<T, String> {
    let elapsed = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let status = outcome.as_ref().err().and_then(BackendError::status);
    diagnostics
        .counters()
        .http_response(outcome.as_ref().map_or(status, |_| Some(200)));
    let (level, result) = match &outcome {
        Ok(_) => (DiagnosticLevel::Info, DiagnosticOutcome::Succeeded),
        // The server asked for this retry; below Error, so no sink reports it.
        Err(error) if error.is_designed_retry() => {
            (DiagnosticLevel::Warn, DiagnosticOutcome::Deferred)
        }
        Err(_) => (DiagnosticLevel::Error, DiagnosticOutcome::Failed),
    };
    let mut event = DiagnosticEvent::new(level, DiagnosticCategory::Backend, operation, result)
        .with_duration_ms(elapsed);
    if let Some(status) = status {
        event = event.with_status(status);
    }
    if let Some(bytes) = bytes {
        event = event.with_bytes(bytes);
    }
    if let Err(error) = &outcome {
        event = event.with_detail(
            error
                .server_message()
                .map_or_else(|| error.to_string(), str::to_owned),
        );
    }
    diagnostics.record(event);
    outcome.map_err(|error| error.to_string())
}

/// Ask before sending, and record what the server said.
pub(super) async fn offer_replay(
    backend: &ScoutBackendClient,
    outbox: &ObservationOutbox,
    credential: &DeviceCredential,
    diagnostics: &Diagnostics,
    candidate: &ReplayCandidate<'_>,
) -> Result<ReplayOfferOutcome, String> {
    let started = std::time::Instant::now();
    let outcome = backend
        .offer_replay(
            credential,
            candidate.game_id,
            &ReplayOffer {
                digest: candidate.digest,
                bytes: candidate.bytes,
                platform_id: candidate.platform_id,
            },
        )
        .await;
    let duration_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let status = outcome.as_ref().err().and_then(BackendError::status);
    diagnostics.counters().http_response(status);

    let decision = match outcome {
        Ok(decision) => decision,
        // A backend that predates the offer route has no opinion to give, so
        // fall back to the behaviour that existed before it: upload and let
        // the server refuse. This keeps a client that ships ahead of its
        // server working rather than stalling every replay on a 404.
        Err(error) if status == Some(404) => {
            record_replay_event(
                diagnostics,
                ReplayEvent {
                    level: DiagnosticLevel::Info,
                    operation: "offer_replay",
                    outcome: DiagnosticOutcome::Skipped,
                    status,
                    duration_ms,
                    bytes: candidate.bytes,
                    detail: Some("backend does not accept offers yet".to_owned()),
                },
            );
            let _ = error;
            return Ok(ReplayOfferOutcome::Send);
        }
        Err(error) => {
            let detail = error
                .server_message()
                .map_or_else(|| error.to_string(), str::to_owned);
            record_replay_event(
                diagnostics,
                ReplayEvent {
                    level: DiagnosticLevel::Error,
                    operation: "offer_replay",
                    outcome: DiagnosticOutcome::Failed,
                    status,
                    duration_ms,
                    bytes: candidate.bytes,
                    detail: Some(detail.clone()),
                },
            );
            return Ok(ReplayOfferOutcome::Unresolved(detail));
        }
    };

    let (level, result, detail) = match decision {
        ReplayOfferDecision::Want => (
            DiagnosticLevel::Info,
            DiagnosticOutcome::Succeeded,
            "wanted",
        ),
        ReplayOfferDecision::Have => (
            DiagnosticLevel::Info,
            DiagnosticOutcome::Skipped,
            "already stored",
        ),
        ReplayOfferDecision::Never => (
            DiagnosticLevel::Warn,
            DiagnosticOutcome::Failed,
            "refused for good",
        ),
        ReplayOfferDecision::Later => (
            DiagnosticLevel::Info,
            DiagnosticOutcome::Deferred,
            "no evidence yet",
        ),
    };
    record_replay_event(
        diagnostics,
        ReplayEvent {
            level,
            operation: "offer_replay",
            outcome: result,
            status,
            duration_ms,
            bytes: candidate.bytes,
            detail: Some(detail.to_owned()),
        },
    );
    apply_offer_decision(outbox, diagnostics, candidate, decision, duration_ms)
}

/// Turn the server's answer into a durable local receipt.
pub(super) fn apply_offer_decision(
    outbox: &ObservationOutbox,
    diagnostics: &Diagnostics,
    candidate: &ReplayCandidate<'_>,
    decision: ReplayOfferDecision,
    duration_ms: u64,
) -> Result<ReplayOfferOutcome, String> {
    match decision {
        ReplayOfferDecision::Want => Ok(ReplayOfferOutcome::Send),
        ReplayOfferDecision::Have => {
            outbox
                .mark_replay_uploaded(candidate.digest, candidate.game_id)
                .map_err(|error| error.to_string())?;
            Ok(ReplayOfferOutcome::Settled)
        }
        ReplayOfferDecision::Never => {
            diagnostics.counters().replay_abandoned();
            abandon_replay(outbox, candidate)?;
            Ok(ReplayOfferOutcome::Settled)
        }
        ReplayOfferDecision::Later => {
            diagnostics.counters().replay_deferred();
            let attempts = outbox
                .record_replay_deferral(candidate.digest, candidate.game_id)
                .map_err(|error| error.to_string())?;
            if attempts == REPLAY_DEFERRAL_ATTENTION_ATTEMPTS {
                record_replay_event(
                    diagnostics,
                    ReplayEvent {
                        level: DiagnosticLevel::Warn,
                        operation: "offer_replay",
                        outcome: DiagnosticOutcome::Deferred,
                        status: None,
                        duration_ms,
                        bytes: candidate.bytes,
                        detail: Some(format!(
                            "still no evidence after {attempts} offers; remains retryable"
                        )),
                    },
                );
            }
            Ok(ReplayOfferOutcome::Deferred)
        }
    }
}

/// Write the terminal receipt that stops a replay being offered ever again.
pub(super) fn abandon_replay(
    outbox: &ObservationOutbox,
    candidate: &ReplayCandidate<'_>,
) -> Result<(), String> {
    outbox
        .mark_replay_rejected(candidate.digest, candidate.game_id, 409)
        .map_err(|error| error.to_string())
}

/// One discovered replay, ready to offer to the backend.
pub(super) struct ReplayCandidate<'a> {
    game_id: &'a str,
    /// Platform the filename named, when it carried one.
    platform_id: Option<&'a str>,
    digest: &'a str,
    path: &'a Path,
    bytes: u64,
}

/// What one upload attempt settled.
pub(super) enum ReplayDelivery {
    /// Stored or permanently rejected; the file needs no further attention.
    Settled,
    /// The backend said "not yet"; leave the file for a later scan.
    Deferred,
    /// Neither: the scan records the reason and moves to the next file.
    Unresolved(String),
}

/// Offer one replay to the backend and classify what came back.
///
/// Returns `Err` only when the local outbox cannot record the outcome, which
/// is a broken local invariant rather than a delivery result.
pub(super) async fn deliver_replay(
    backend: &ScoutBackendClient,
    outbox: &ObservationOutbox,
    credential: &DeviceCredential,
    diagnostics: &Diagnostics,
    candidate: &ReplayCandidate<'_>,
) -> Result<ReplayDelivery, String> {
    match offer_replay(backend, outbox, credential, diagnostics, candidate).await? {
        ReplayOfferOutcome::Send => {}
        ReplayOfferOutcome::Settled => return Ok(ReplayDelivery::Settled),
        ReplayOfferOutcome::Deferred => return Ok(ReplayDelivery::Deferred),
        ReplayOfferOutcome::Unresolved(detail) => {
            return Ok(ReplayDelivery::Unresolved(detail));
        }
    }
    diagnostics.counters().replay_attempted();
    let started = std::time::Instant::now();
    let outcome = backend
        .upload_replay(
            credential,
            candidate.game_id,
            candidate.digest,
            candidate.platform_id,
            candidate.path,
        )
        .await;
    let elapsed = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
    let status = outcome.as_ref().err().and_then(BackendError::status);
    diagnostics.counters().http_response(status);

    let Err(error) = outcome else {
        diagnostics.counters().replay_uploaded();
        record_replay_event(
            diagnostics,
            ReplayEvent {
                level: DiagnosticLevel::Info,
                operation: "upload_replay",
                outcome: DiagnosticOutcome::Succeeded,
                status,
                duration_ms: elapsed,
                bytes: candidate.bytes,
                detail: None,
            },
        );
        outbox
            .mark_replay_uploaded(candidate.digest, candidate.game_id)
            .map_err(|error| error.to_string())?;
        return Ok(ReplayDelivery::Settled);
    };

    // The server's own words when it gave them, since a bare status has
    // repeatedly proven to be the least useful half of the answer.
    let detail = error
        .server_message()
        .map_or_else(|| error.to_string(), str::to_owned);

    if error.replay_should_be_deferred() {
        // The offer already cleared this replay, so a 409 here is a race —
        // another device holding the claim — not missing evidence. It is not
        // counted against the evidence tally the offer keeps.
        diagnostics.counters().replay_deferred();
        record_replay_event(
            diagnostics,
            ReplayEvent {
                level: DiagnosticLevel::Info,
                operation: "upload_replay",
                outcome: DiagnosticOutcome::Deferred,
                status,
                duration_ms: elapsed,
                bytes: candidate.bytes,
                detail: Some(detail),
            },
        );
        return Ok(ReplayDelivery::Deferred);
    }

    let Some(terminal) = error.terminal_replay_rejection_status() else {
        // Anything else used to return, which skipped every remaining replay
        // in the directory. One unhappy file must not decide the fate of the
        // whole scan.
        record_replay_event(
            diagnostics,
            ReplayEvent {
                level: DiagnosticLevel::Error,
                operation: "upload_replay",
                outcome: DiagnosticOutcome::Failed,
                status,
                duration_ms: elapsed,
                bytes: candidate.bytes,
                detail: Some(detail.clone()),
            },
        );
        return Ok(ReplayDelivery::Unresolved(detail));
    };

    diagnostics.counters().replay_rejected();
    record_replay_event(
        diagnostics,
        ReplayEvent {
            level: DiagnosticLevel::Error,
            operation: "upload_replay",
            outcome: DiagnosticOutcome::Failed,
            status: Some(terminal),
            duration_ms: elapsed,
            bytes: candidate.bytes,
            detail: Some(detail),
        },
    );
    outbox
        .mark_replay_rejected(candidate.digest, candidate.game_id, terminal)
        .map_err(|outbox_error| outbox_error.to_string())?;
    Ok(ReplayDelivery::Settled)
}

/// One thing that happened to one replay.
///
/// The game id and digest are deliberately absent: they identify a player's
/// match, and the counters plus status already answer what diagnostics are for.
pub(super) struct ReplayEvent {
    level: DiagnosticLevel,
    operation: &'static str,
    outcome: DiagnosticOutcome,
    status: Option<u16>,
    duration_ms: u64,
    bytes: u64,
    detail: Option<String>,
}

pub(super) fn record_replay_event(diagnostics: &Diagnostics, event: ReplayEvent) {
    let mut record = DiagnosticEvent::new(
        event.level,
        DiagnosticCategory::Replay,
        event.operation,
        event.outcome,
    )
    .with_duration_ms(event.duration_ms)
    .with_bytes(event.bytes);
    if let Some(status) = event.status {
        record = record.with_status(status);
    }
    if let Some(detail) = event.detail {
        record = record.with_detail(detail);
    }
    diagnostics.record(record);
}

pub(super) fn replay_game_id(path: &Path) -> Option<String> {
    path.file_stem()?
        .to_str()?
        .split(|character: char| !character.is_ascii_digit())
        .filter(|part| part.len() >= 5)
        .max_by_key(|part| part.len())
        .map(str::to_owned)
}

/// The platform a replay filename names, as in the `NA1` of `NA1-123456.rofl`.
///
/// Riot names a match `NA1_123456`, but the upload route carries only the
/// digits. Dropping the prefix leaves the server unable to build the canonical
/// match id it needs to look the game up, so it is recovered here and sent
/// alongside. A stem without one is not an error — the server falls back to the
/// regions the account has registered.
pub(super) fn replay_platform_id(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    let head = stem.split(['-', '_']).next()?;
    let letters = head.chars().take_while(char::is_ascii_alphabetic).count();
    let digits = head.get(letters..)?;
    let shaped = (2..=4).contains(&letters)
        && digits.len() <= 2
        && digits.chars().all(|character| character.is_ascii_digit());
    shaped.then(|| head.to_ascii_uppercase())
}

pub(super) async fn replay_sha256(path: PathBuf) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        let mut file = std::fs::File::open(path).map_err(|error| error.to_string())?;
        let mut hasher = Sha256::new();
        let mut buffer = vec![0_u8; 64 * 1024].into_boxed_slice();
        loop {
            let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
            if count == 0 {
                break;
            }
            hasher.update(&buffer[..count]);
        }
        Ok(hex::encode(hasher.finalize()))
    })
    .await
    .map_err(|error| format!("Replay hashing task failed: {error}"))?
}

/// Replays reported to the server in one inventory observation.
pub(super) const REPLAY_INVENTORY_LIMIT: u32 = 100;

/// Tell the server which replays this device holds.
///
/// The server cannot see a machine's disk. Until it is told, a replay exists
/// only in the moment the device happens to offer it, so a game that could not
/// be vouched for at that moment is forgotten rather than revisited. Reporting
/// the inventory turns that into something the server can come back to once
/// Riot archives the match.
///
/// Carries the content digest and the game id — both already cross the wire on
/// every upload — and no path, because where a file sits on disk is not the
/// server's business.
pub(super) fn report_replay_inventory(
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    local_puuid: Option<&str>,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    let inventory = outbox
        .replay_inventory(REPLAY_INVENTORY_LIMIT)
        .map_err(|error| error.to_string())?;
    if inventory.is_empty() {
        return Ok(());
    }
    let payload = serde_json::json!({
        "replays": inventory
            .iter()
            .map(|row| {
                serde_json::json!({
                    "gameId": row.game_id,
                    "digest": row.digest,
                    "state": row.state,
                })
            })
            .collect::<Vec<_>>(),
    });
    enqueue_resource_if_changed(
        outbox,
        payloads,
        ObservationSlot::named("replay_status", ObservationKind::ReplayStatus),
        &payload,
        local_puuid,
        diagnostics,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    use scout_client_core::backend::BackendError;
    use scout_client_core::diagnostics::DiagnosticLevel;
    use scout_client_core::diagnostics::DiagnosticOutcome;
    use scout_client_core::diagnostics::Diagnostics;

    use uuid::Uuid;

    #[test]
    fn a_pending_binding_retry_is_recorded_below_error_and_still_fails_the_call() {
        let diagnostics = Diagnostics::in_memory();
        let pending = BackendError::Rejected {
            status: 503,
            message:
                r#"{"error":"binding_reconciliation_pending","message":"retry reconciliation"}"#
                    .to_owned(),
        };
        let unavailable = BackendError::Rejected {
            status: 503,
            message: "Service Unavailable".to_owned(),
        };
        for error in [pending, unavailable] {
            let outcome: Result<(), BackendError> = Err(error);
            // Still an error to the caller, so the outbox keeps and resends the batch.
            assert!(
                record_backend_outcome(
                    &diagnostics,
                    "upload_observations",
                    std::time::Instant::now(),
                    outcome,
                    None,
                )
                .is_err()
            );
        }
        let recorded: Vec<_> = diagnostics
            .events()
            .into_iter()
            .map(|event| (event.level, event.outcome, event.status))
            .collect();
        assert_eq!(
            recorded,
            [
                (
                    DiagnosticLevel::Warn,
                    DiagnosticOutcome::Deferred,
                    Some(503)
                ),
                (DiagnosticLevel::Error, DiagnosticOutcome::Failed, Some(503)),
            ]
        );
    }

    #[test]
    fn recovers_the_platform_a_replay_filename_names() {
        // Riot names a match NA1_123456 but the upload route carries only the
        // digits, so the prefix has to travel separately or the server cannot
        // build the canonical match id.
        assert_eq!(
            replay_platform_id(Path::new("NA1-5565990955.rofl")),
            Some("NA1".to_owned())
        );
        assert_eq!(
            replay_platform_id(Path::new("euw1-123456.rofl")),
            Some("EUW1".to_owned())
        );
        assert_eq!(
            replay_platform_id(Path::new("RU_987654.rofl")),
            Some("RU".to_owned())
        );
    }

    #[test]
    fn a_nameless_replay_reports_no_platform_rather_than_a_wrong_one() {
        // Absence is fine: the server falls back to the regions the account
        // has registered. A guess would not be.
        assert_eq!(replay_platform_id(Path::new("5565990955.rofl")), None);
        assert_eq!(replay_platform_id(Path::new("replay.rofl")), None);
        assert_eq!(replay_platform_id(Path::new("TOOLONG1-123.rofl")), None);
    }

    #[tokio::test]
    async fn replay_digests_are_lowercase_sha256_hex() -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!("scout-replay-{}.rofl", Uuid::new_v4()));
        std::fs::write(&path, b"scout replay fixture")?;
        let digest = replay_sha256(path.clone()).await;
        std::fs::remove_file(&path)?;

        assert_eq!(
            digest?,
            "f19101066a2b69c3f27c11a55b3b9dc753e5ede5feccb37e41170ea6dcdfb33f"
        );
        Ok(())
    }
}
