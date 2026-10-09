//! Background League observation, pairing, and upload runtime.

use std::collections::HashMap;
use std::io::Read as _;
use std::path::Path;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant, UNIX_EPOCH};

use directories::ProjectDirs;
use scout_client_core::backend::{
    BackendError, ReplayOffer, ReplayOfferDecision, ScoutBackendClient,
};
use scout_client_core::credentials::DeviceCredential;
use scout_client_core::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, Diagnostics, FileSink,
};
use scout_client_core::lcu::{
    ClashBracketId, ClashRosterId, ClashTournamentId, GameId, LcuClient, LcuEndpoint, LcuError,
    LcuResource, LeagueLockfile, LiveClient, discover_lockfile,
};
use scout_client_core::outbox::{LobbyBinding, ObservationOutbox};
use scout_client_core::protocol::{
    CreatePairingRequest, ExchangePairingResponse, ObservationBatch, ObservationEnvelope,
    ObservationKind, ObservationOutcome, ObservationQuarantineReason, ObservationReceipt,
};
use scout_client_core::reporting::{
    BugsinkSink, ReportingGuard, reporting_environment, reporting_status, start_error_reporting,
};
use serde_json::Value;
use sha2::{Digest as _, Sha256};
use tokio::runtime::Runtime;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;
use tracing::{error, info};
use uuid::Uuid;

use crate::startup;

/// Snapshot rendered by egui. It contains no bearer, LCU credential, PUUID, or raw payload.
#[derive(Debug, Clone, Default)]
pub struct RuntimeState {
    /// Whether a League lockfile is currently reachable.
    pub league_connected: bool,
    /// Current gameflow phase.
    pub gameflow_phase: Option<String>,
    /// Redacted current account label.
    pub account_label: Option<String>,
    /// Whether the device has a credential in the OS store.
    pub paired: bool,
    /// Whether Scout Client is registered to start for the current user.
    pub start_at_login: bool,
    /// Human-readable pairing state.
    pub pairing_status: Option<String>,
    /// Browser approval URL while pairing is pending.
    pub approval_url: Option<String>,
    /// Pending durable observations.
    pub pending_observations: usize,
    /// Last successful upload time.
    pub last_upload_at: Option<String>,
    /// Last typed boundary error.
    pub last_error: Option<String>,
    last_runtime_error: Option<String>,
    last_replay_error: Option<String>,
}

enum RuntimeCommand {
    StartPairing,
    Disconnect,
    SetStartAtLogin(bool),
}

struct PendingPairing {
    id: Uuid,
    secret: String,
}

type ReplayUploadTask = JoinHandle<Result<(), String>>;

/// Handle owned by the egui application.
pub struct ClientRuntime {
    /// Latest immutable UI snapshot.
    pub state: Arc<RwLock<RuntimeState>>,
    diagnostics: Arc<Diagnostics>,
    log_directory: Option<PathBuf>,
    /// Flushes queued error reports when the runtime is dropped.
    _reporting: Option<ReportingGuard>,
    commands: mpsc::UnboundedSender<RuntimeCommand>,
    shutdown: watch::Sender<bool>,
    thread: std::thread::JoinHandle<()>,
}

impl ClientRuntime {
    /// Spawn the async collector on a dedicated thread.
    #[must_use]
    pub fn start(backend_origin: String) -> Self {
        let state = Arc::new(RwLock::new(RuntimeState::default()));
        let log_directory = log_directory();
        let mut diagnostics = Diagnostics::in_memory();
        if let Some(sink) = log_directory.clone().and_then(FileSink::new) {
            diagnostics = diagnostics.with_sink(Box::new(sink));
        }
        // Only when this build has somewhere to report to; the guard must
        // outlive the process, so it is held here.
        let reporting = start_error_reporting(reporting_environment(&backend_origin));
        if reporting.is_some() {
            diagnostics = diagnostics.with_sink(Box::new(BugsinkSink));
        }
        let diagnostics = Arc::new(diagnostics);
        diagnostics.record(reporting_status());
        let (shutdown, shutdown_receiver) = watch::channel(false);
        let (commands, command_receiver) = mpsc::unbounded_channel();
        let worker_state = Arc::clone(&state);
        let worker_diagnostics = Arc::clone(&diagnostics);
        let thread = std::thread::spawn(move || {
            let runtime = match Runtime::new() {
                Ok(runtime) => runtime,
                Err(error) => {
                    worker_diagnostics.record(
                        DiagnosticEvent::new(
                            DiagnosticLevel::Critical,
                            DiagnosticCategory::Runtime,
                            "start_collector",
                            DiagnosticOutcome::Failed,
                        )
                        .with_detail(error.to_string()),
                    );
                    set_error(
                        &worker_state,
                        format!("Could not start background runtime: {error}"),
                    );
                    return;
                }
            };
            runtime.block_on(run_collector(
                worker_state,
                worker_diagnostics,
                shutdown_receiver,
                command_receiver,
                backend_origin,
            ));
        });
        Self {
            state,
            diagnostics,
            log_directory,
            _reporting: reporting,
            commands,
            shutdown,
            thread,
        }
    }

    /// The diagnostics this client is accumulating.
    #[must_use]
    pub fn diagnostics(&self) -> &Arc<Diagnostics> {
        &self.diagnostics
    }

    /// Where JSONL records are being written, when a file sink opened.
    #[must_use]
    pub fn log_directory(&self) -> Option<&Path> {
        self.log_directory.as_deref()
    }

    /// Begin a new browser pairing request.
    pub fn start_pairing(&self) {
        if self.commands.send(RuntimeCommand::StartPairing).is_err() {
            info!("Scout Client collector had already stopped");
        }
    }

    /// Delete the local credential and stop uploading until re-paired.
    pub fn disconnect(&self) {
        if self.commands.send(RuntimeCommand::Disconnect).is_err() {
            info!("Scout Client collector had already stopped");
        }
    }

    /// Change the current-user start-at-login registration.
    pub fn set_start_at_login(&self, enabled: bool) {
        if self
            .commands
            .send(RuntimeCommand::SetStartAtLogin(enabled))
            .is_err()
        {
            info!("Scout Client collector had already stopped");
        }
    }

    /// Request graceful background shutdown.
    pub fn shutdown(&self) {
        if self.shutdown.send(true).is_err() {
            info!("Scout Client collector had already stopped");
        }
    }

    /// Shut the collector down and wait for its thread to finish, so another
    /// collector can take over the outbox.
    pub fn stop(self) {
        self.shutdown();
        if self.thread.join().is_err() {
            info!("Scout Client collector thread had panicked");
        }
    }
}

async fn run_collector(
    state: Arc<RwLock<RuntimeState>>,
    diagnostics: Arc<Diagnostics>,
    mut shutdown: watch::Receiver<bool>,
    mut commands: mpsc::UnboundedReceiver<RuntimeCommand>,
    backend_origin: String,
) {
    diagnostics.record(DiagnosticEvent::new(
        DiagnosticLevel::Info,
        DiagnosticCategory::Runtime,
        "start_collector",
        DiagnosticOutcome::Succeeded,
    ));
    let Some((backend, mut credential, mut outbox)) = collector_resources(&state, &backend_origin)
    else {
        diagnostics.record(
            DiagnosticEvent::new(
                DiagnosticLevel::Critical,
                DiagnosticCategory::Runtime,
                "open_resources",
                DiagnosticOutcome::Failed,
            )
            .with_detail("backend client, credential store, or outbox unavailable"),
        );
        return;
    };
    update_state(&state, |snapshot| snapshot.paired = credential.is_some());
    load_startup_state(&state, &backend_origin);
    let mut pending_pairing: Option<PendingPairing> = None;
    let mut payloads = HashMap::new();
    let live_client = create_live_client(&state);
    let mut tick_number = 0_u64;
    let mut checked_in_device: Option<Uuid> = None;
    let mut replay_upload_task: Option<ReplayUploadTask> = None;
    let mut ticker = tokio::time::interval(Duration::from_secs(2));

    loop {
        tokio::select! {
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() {
                    cancel_replay_upload(&mut replay_upload_task);
                    return;
                }
            }
            command = commands.recv() => {
                if let Some(command) = command {
                    if matches!(&command, RuntimeCommand::Disconnect) {
                        cancel_replay_upload(&mut replay_upload_task);
                    }
                    handle_command(
                        command,
                        &state,
                        &backend,
                        &backend_origin,
                        &mut credential,
                        &mut pending_pairing,
                    ).await;
                }
            }
            _ = ticker.tick() => {
                tick_number = tick_number.saturating_add(1);
                finish_replay_upload(&state, &mut replay_upload_task).await;
                if let Err(error) = poll_pairing(
                    &state,
                    &backend,
                    &mut outbox,
                    &mut payloads,
                    &mut credential,
                    &mut pending_pairing,
                ).await {
                    set_error(&state, error);
                }
                if let Some(active_credential) = &credential
                    && let Err(error) = collect_and_upload_observations(ObservationTickContext {
                        state: &state,
                        backend: &backend,
                        outbox: &outbox,
                        credential: active_credential,
                        checked_in_device: &mut checked_in_device,
                        payloads: &mut payloads,
                        live_client: live_client.as_ref(),
                        tick_number,
                        diagnostics: &diagnostics,
                    }).await
                {
                    set_error(&state, error);
                }
                if tick_number % 15 == 1
                    && replay_upload_task.is_none()
                    && let Some(active_credential) = &credential
                    && checked_in_device == Some(active_credential.device_id)
                {
                    replay_upload_task = Some(start_replay_upload(
                        &backend,
                        &outbox,
                        active_credential,
                        &diagnostics,
                    ));
                }
            }
        }
    }
}

struct ObservationTickContext<'a> {
    state: &'a Arc<RwLock<RuntimeState>>,
    backend: &'a ScoutBackendClient,
    outbox: &'a ObservationOutbox,
    credential: &'a DeviceCredential,
    checked_in_device: &'a mut Option<Uuid>,
    payloads: &'a mut HashMap<String, Vec<u8>>,
    live_client: Option<&'a LiveClient>,
    tick_number: u64,
    diagnostics: &'a Diagnostics,
}

async fn collect_and_upload_observations(
    context: ObservationTickContext<'_>,
) -> Result<(), String> {
    let mut tick_error = None;
    let upload_ready = if let Err(error) = ensure_checked_in(
        context.backend,
        context.outbox,
        context.credential,
        context.checked_in_device,
        context.diagnostics,
    )
    .await
    {
        tick_error.get_or_insert(error);
        false
    } else {
        true
    };
    let collection_ready = if upload_ready {
        true
    } else {
        match context.outbox.sequence_is_synchronized() {
            Ok(synchronized) => synchronized,
            Err(error) => {
                tick_error.get_or_insert(error.to_string());
                false
            }
        }
    };
    // Collection is local and durable once this database has learned the
    // paired device's backend sequence floor. A recreated outbox must wait for
    // its first check-in; an initialized one keeps preserving ephemeral LCU
    // evidence throughout a later backend outage.
    if collection_ready
        && let Err(error) = collect_once(
            context.state,
            context.outbox,
            context.payloads,
            context.live_client,
            context.tick_number,
            context.diagnostics,
        )
        .await
    {
        // A collection failure drops an observation before it is ever durable,
        // so it leaves no trace anywhere else. An envelope the contract
        // refuses — an empty platformId, say — looks from the outside exactly
        // like a quiet client.
        context.diagnostics.counters().observation_rejected();
        context.diagnostics.record(
            DiagnosticEvent::new(
                DiagnosticLevel::Warn,
                DiagnosticCategory::Protocol,
                "collect_observations",
                DiagnosticOutcome::Failed,
            )
            .with_detail(&error),
        );
        tick_error.get_or_insert(error);
    }
    if upload_ready
        && let Err(error) = upload_pending(
            context.state,
            context.backend,
            context.outbox,
            context.credential,
            context.diagnostics,
        )
        .await
    {
        tick_error.get_or_insert(error);
    }
    tick_error.map_or(Ok(()), Err)
}

fn collector_resources(
    state: &Arc<RwLock<RuntimeState>>,
    backend_origin: &str,
) -> Option<(
    ScoutBackendClient,
    Option<DeviceCredential>,
    ObservationOutbox,
)> {
    let backend = ScoutBackendClient::new(backend_origin)
        .map_err(|error| set_error(state, error.to_string()))
        .ok()?;
    let credential = match DeviceCredential::load(backend.credential_scope()) {
        Ok(value) => value,
        Err(error) => {
            set_error(state, error.to_string());
            None
        }
    };
    let outbox = ObservationOutbox::open(outbox_path(
        backend.credential_scope(),
        credential.as_ref().map(|value| value.device_id),
    ))
    .map_err(|error| set_error(state, format!("Could not open durable outbox: {error}")))
    .ok()?;
    Some((backend, credential, outbox))
}

fn start_replay_upload(
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

fn cancel_replay_upload(task: &mut Option<ReplayUploadTask>) {
    if let Some(active) = task.take() {
        active.abort();
    }
}

async fn finish_replay_upload(
    state: &Arc<RwLock<RuntimeState>>,
    task: &mut Option<ReplayUploadTask>,
) {
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

fn load_startup_state(state: &Arc<RwLock<RuntimeState>>, backend_origin: &str) {
    match startup::is_enabled(backend_origin) {
        Ok(enabled) => update_state(state, |snapshot| snapshot.start_at_login = enabled),
        Err(error) => set_error(
            state,
            format!("Could not read start-at-login setting: {error}"),
        ),
    }
}

async fn ensure_checked_in(
    backend: &ScoutBackendClient,
    outbox: &ObservationOutbox,
    credential: &DeviceCredential,
    checked_in_device: &mut Option<Uuid>,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    if *checked_in_device == Some(credential.device_id) {
        return Ok(());
    }
    let started = std::time::Instant::now();
    let outcome = backend
        .check_in(credential, env!("CARGO_PKG_VERSION"))
        .await;
    let next_sequence = record_backend_outcome(diagnostics, "check_in", started, outcome, None)?;
    outbox
        .ensure_next_sequence_at_least(next_sequence)
        .map_err(|error| error.to_string())?;
    *checked_in_device = Some(credential.device_id);
    Ok(())
}

fn create_live_client(state: &Arc<RwLock<RuntimeState>>) -> Option<LiveClient> {
    match LiveClient::new() {
        Ok(client) => Some(client),
        Err(error) => {
            set_error(state, error.to_string());
            None
        }
    }
}

async fn upload_new_replays(
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
async fn scan_replay_entry(
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
const REPLAY_DEFERRAL_ATTENTION_ATTEMPTS: i64 = 5;
/// Deferrals after which a replay stops being offered at all.
///
/// A game nobody can vouch for is usually a game nobody ever will: it was
/// played before this account had a client watching, and it has already aged
/// out of the twenty-game match history the client can read. Retrying it every
/// scan forever costs a request each time and buries everything else in the
/// diagnostics.
const REPLAY_DEFERRAL_LIMIT: i64 = 12;

/// What the offer settled, before any bytes are read.
enum ReplayOfferOutcome {
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
fn record_backend_outcome<T>(
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
async fn offer_replay(
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
fn apply_offer_decision(
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
            if attempts < REPLAY_DEFERRAL_LIMIT {
                if attempts >= REPLAY_DEFERRAL_ATTENTION_ATTEMPTS {
                    // Still retryable, but long enough to be worth noticing.
                    record_replay_event(
                        diagnostics,
                        ReplayEvent {
                            level: DiagnosticLevel::Warn,
                            operation: "offer_replay",
                            outcome: DiagnosticOutcome::Deferred,
                            status: None,
                            duration_ms,
                            bytes: candidate.bytes,
                            detail: Some(format!("still no evidence after {attempts} offers")),
                        },
                    );
                }
                return Ok(ReplayOfferOutcome::Deferred);
            }
            diagnostics.counters().replay_abandoned();
            record_replay_event(
                diagnostics,
                ReplayEvent {
                    level: DiagnosticLevel::Warn,
                    operation: "abandon_replay",
                    outcome: DiagnosticOutcome::Failed,
                    status: None,
                    duration_ms,
                    bytes: candidate.bytes,
                    detail: Some(format!("no evidence after {attempts} offers")),
                },
            );
            abandon_replay(outbox, candidate)?;
            Ok(ReplayOfferOutcome::Settled)
        }
    }
}

/// Write the terminal receipt that stops a replay being offered ever again.
fn abandon_replay(
    outbox: &ObservationOutbox,
    candidate: &ReplayCandidate<'_>,
) -> Result<(), String> {
    outbox
        .mark_replay_rejected(candidate.digest, candidate.game_id, 409)
        .map_err(|error| error.to_string())
}

/// One discovered replay, ready to offer to the backend.
struct ReplayCandidate<'a> {
    game_id: &'a str,
    /// Platform the filename named, when it carried one.
    platform_id: Option<&'a str>,
    digest: &'a str,
    path: &'a Path,
    bytes: u64,
}

/// What one upload attempt settled.
enum ReplayDelivery {
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
async fn deliver_replay(
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
struct ReplayEvent {
    level: DiagnosticLevel,
    operation: &'static str,
    outcome: DiagnosticOutcome,
    status: Option<u16>,
    duration_ms: u64,
    bytes: u64,
    detail: Option<String>,
}

fn record_replay_event(diagnostics: &Diagnostics, event: ReplayEvent) {
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

fn optional_lockfile(
    discovered: Result<(PathBuf, LeagueLockfile), LcuError>,
) -> Result<Option<LeagueLockfile>, String> {
    match discovered {
        Ok((_, lockfile)) => Ok(Some(lockfile)),
        Err(LcuError::NotRunning) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn replay_game_id(path: &Path) -> Option<String> {
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
fn replay_platform_id(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?;
    let head = stem.split(['-', '_']).next()?;
    let letters = head.chars().take_while(char::is_ascii_alphabetic).count();
    let digits = head.get(letters..)?;
    let shaped = (2..=4).contains(&letters)
        && digits.len() <= 2
        && digits.chars().all(|character| character.is_ascii_digit());
    shaped.then(|| head.to_ascii_uppercase())
}

async fn replay_sha256(path: PathBuf) -> Result<String, String> {
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

async fn handle_command(
    command: RuntimeCommand,
    state: &Arc<RwLock<RuntimeState>>,
    backend: &ScoutBackendClient,
    backend_origin: &str,
    credential: &mut Option<DeviceCredential>,
    pending_pairing: &mut Option<PendingPairing>,
) {
    match command {
        RuntimeCommand::StartPairing => {
            let request = CreatePairingRequest {
                device_name: format!("{} Scout Client", std::env::consts::OS),
                platform: std::env::consts::OS.to_owned(),
                architecture: std::env::consts::ARCH.to_owned(),
                app_version: env!("CARGO_PKG_VERSION").to_owned(),
                protocol_version: scout_client_core::protocol::PROTOCOL_VERSION,
            };
            match backend.create_pairing(&request).await {
                Ok(pairing) => {
                    let url = pairing.approval_url.clone();
                    *pending_pairing = Some(PendingPairing {
                        id: pairing.pairing_id,
                        secret: pairing.pairing_secret,
                    });
                    update_state(state, |snapshot| {
                        snapshot.pairing_status = Some("Waiting for browser approval".to_owned());
                        snapshot.approval_url = Some(url.clone());
                        clear_runtime_error(snapshot);
                    });
                    if let Err(error) = open::that(&url) {
                        set_error(state, format!("Could not open approval page: {error}"));
                    }
                }
                Err(error) => set_error(state, error.to_string()),
            }
        }
        RuntimeCommand::Disconnect => {
            disconnect(state, backend, credential, pending_pairing).await;
        }
        RuntimeCommand::SetStartAtLogin(enabled) => {
            match startup::set_enabled(backend_origin, enabled) {
                Ok(()) => update_state(state, |snapshot| {
                    snapshot.start_at_login = enabled;
                    clear_runtime_error(snapshot);
                }),
                Err(error) => set_error(state, format!("Could not change start-at-login: {error}")),
            }
        }
    }
}

async fn disconnect(
    state: &Arc<RwLock<RuntimeState>>,
    backend: &ScoutBackendClient,
    credential: &mut Option<DeviceCredential>,
    pending_pairing: &mut Option<PendingPairing>,
) {
    if let Some(active_credential) = credential.as_ref()
        && let Err(error) = backend.revoke_device(active_credential).await
    {
        // A 401 does not reach this branch: revoke_device treats an already
        // revoked server credential as success so it can be deleted locally.
        update_state(state, |snapshot| {
            snapshot.paired = true;
            snapshot.pairing_status = Some("Disconnect failed; retry to revoke device".to_owned());
            snapshot.last_runtime_error = Some(format!(
                "Could not revoke the server credential; it remains stored locally: {error}"
            ));
            synchronize_last_error(snapshot);
        });
        return;
    }
    match DeviceCredential::delete(backend.credential_scope()) {
        Ok(()) => {
            *credential = None;
            *pending_pairing = None;
            update_state(state, |snapshot| {
                snapshot.paired = false;
                snapshot.pairing_status = Some("Disconnected".to_owned());
                snapshot.approval_url = None;
                clear_runtime_error(snapshot);
            });
        }
        Err(error) => set_error(state, error.to_string()),
    }
}

async fn poll_pairing(
    state: &Arc<RwLock<RuntimeState>>,
    backend: &ScoutBackendClient,
    outbox: &mut ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    credential: &mut Option<DeviceCredential>,
    pending_pairing: &mut Option<PendingPairing>,
) -> Result<(), String> {
    let Some(pairing) = pending_pairing else {
        return Ok(());
    };
    match backend
        .exchange_pairing(pairing.id, &pairing.secret)
        .await
        .map_err(|error| error.to_string())?
    {
        ExchangePairingResponse::Pending => Ok(()),
        ExchangePairingResponse::Approved { device_id, token } => {
            let issued = DeviceCredential { device_id, token };
            let device_outbox =
                ObservationOutbox::open(outbox_path(backend.credential_scope(), Some(device_id)))
                    .map_err(|error| format!("Could not open paired device outbox: {error}"))?;
            issued
                .save(backend.credential_scope())
                .map_err(|error| error.to_string())?;
            *outbox = device_outbox;
            payloads.clear();
            *credential = Some(issued);
            *pending_pairing = None;
            update_state(state, |snapshot| {
                snapshot.paired = true;
                snapshot.pairing_status = Some("Paired".to_owned());
                snapshot.approval_url = None;
                clear_runtime_error(snapshot);
            });
            Ok(())
        }
        ExchangePairingResponse::Expired | ExchangePairingResponse::Consumed => {
            *pending_pairing = None;
            update_state(state, |snapshot| {
                snapshot.pairing_status = Some("Pairing expired; start again".to_owned());
                snapshot.approval_url = None;
            });
            Ok(())
        }
    }
}

async fn upload_pending(
    state: &Arc<RwLock<RuntimeState>>,
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

fn apply_observation_receipt(
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

fn adjust_post_game_timing(payload: &mut Value, clock_delta_millis: i64) -> Result<(), String> {
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

async fn collect_once(
    state: &Arc<RwLock<RuntimeState>>,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    live_client: Option<&LiveClient>,
    tick_number: u64,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    let Some(lockfile) = optional_lockfile(discover_lockfile())? else {
        update_state(state, |snapshot| {
            snapshot.league_connected = false;
            snapshot.gameflow_phase = None;
            snapshot.account_label = None;
            snapshot.pending_observations = outbox.pending(100).map_or(0, |pending| pending.len());
        });
        return Ok(());
    };
    let client = LcuClient::new(&lockfile).map_err(|error| error.to_string())?;
    let account = client
        .get(LcuEndpoint::CurrentSummoner)
        .await
        .map_err(|error| error.to_string())?;
    let local_puuid = account
        .as_ref()
        .and_then(|value| value.get("puuid"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    let account_label = account.as_ref().and_then(|value| {
        let game_name = value.get("gameName")?.as_str()?;
        let tag_line = value.get("tagLine")?.as_str()?;
        Some(format!("{game_name}#{tag_line}"))
    });

    let Some(local_puuid) = local_puuid else {
        let pending = outbox.pending(100).map_err(|error| error.to_string())?;
        update_state(state, |snapshot| {
            snapshot.league_connected = true;
            snapshot.gameflow_phase = None;
            snapshot.account_label = account_label;
            snapshot.pending_observations = pending.len();
            clear_runtime_error(snapshot);
        });
        return Ok(());
    };

    if let Some(payload) = account {
        enqueue_if_changed(
            outbox,
            payloads,
            "account_profile",
            ObservationKind::AccountProfile,
            &payload,
            Some(&local_puuid),
            diagnostics,
        )?;
    }

    let phase = observe_endpoint(
        &client,
        outbox,
        payloads,
        LcuEndpoint::GameflowPhase,
        ObservationSlot::named("gameflow_phase", ObservationKind::Gameflow),
        Some(&local_puuid),
        diagnostics,
    )
    .await?;
    collect_match_state(
        &client,
        outbox,
        payloads,
        Some(&local_puuid),
        tick_number,
        diagnostics,
    )
    .await?;

    collect_live_frame(live_client, outbox, payloads, Some(&local_puuid)).await?;
    bind_observed_lobby(outbox, payloads, Some(&local_puuid), diagnostics)?;
    remember_game_start(outbox, payloads)?;

    if tick_number % 15 == 1 {
        // Preserve the post-game bundle before querying optional profile
        // surfaces: one unavailable mastery, Challenge, or Clash endpoint must
        // not let a Riot-invisible match age out of recent history.
        collect_recent_matches(&client, outbox, payloads, Some(&local_puuid), diagnostics).await?;
        collect_profile_snapshots(&client, outbox, payloads, Some(&local_puuid), diagnostics)
            .await?;
        report_replay_inventory(outbox, payloads, Some(&local_puuid), diagnostics)?;
    }

    let phase_label = phase
        .as_ref()
        .and_then(Value::as_str)
        .unwrap_or("None")
        .to_owned();
    let pending = outbox.pending(100).map_err(|error| error.to_string())?;
    update_state(state, |snapshot| {
        snapshot.league_connected = true;
        snapshot.gameflow_phase = Some(phase_label);
        snapshot.account_label = account_label;
        snapshot.pending_observations = pending.len();
        clear_runtime_error(snapshot);
    });
    Ok(())
}

async fn collect_match_state(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    local_puuid: Option<&str>,
    tick_number: u64,
    diagnostics: &Diagnostics,
) -> Result<Option<Value>, String> {
    for (endpoint, key, kind) in [
        (
            LcuEndpoint::GameflowSession,
            "gameflow_session",
            ObservationKind::Gameflow,
        ),
        (
            LcuEndpoint::ChampSelect,
            "champ_select",
            ObservationKind::ChampSelect,
        ),
    ] {
        observe_endpoint(
            client,
            outbox,
            payloads,
            endpoint,
            ObservationSlot::named(key, kind),
            local_puuid,
            diagnostics,
        )
        .await?;
    }
    let previous_lobby = payloads.get("lobby").cloned();
    let lobby = observe_endpoint(
        client,
        outbox,
        payloads,
        LcuEndpoint::Lobby,
        ObservationSlot::named("lobby", ObservationKind::Lobby),
        local_puuid,
        diagnostics,
    )
    .await?;
    if let Some(lobby) = &lobby {
        let body = serde_json::to_vec(lobby).map_err(|error| error.to_string())?;
        if should_refresh_lobby(previous_lobby.as_deref(), &body, tick_number) {
            enqueue_coalesced_snapshot(
                outbox,
                "lobby_refresh",
                "lobby",
                ObservationKind::Lobby,
                lobby,
                local_puuid,
                diagnostics,
            )?;
        }
    }
    let end_of_game = observe_endpoint(
        client,
        outbox,
        payloads,
        LcuEndpoint::EndOfGame,
        END_OF_GAME_SLOT,
        local_puuid,
        diagnostics,
    )
    .await?;
    if let Some(payload) = &end_of_game {
        remember_end_of_game(outbox, payload)?;
        return Ok(end_of_game);
    }
    let end_of_game = observe_endpoint(
        client,
        outbox,
        payloads,
        LcuEndpoint::GameClientEndOfGame,
        GAME_CLIENT_END_OF_GAME_SLOT,
        local_puuid,
        diagnostics,
    )
    .await?;
    if let Some(payload) = &end_of_game {
        remember_end_of_game(outbox, payload)?;
    }
    Ok(end_of_game)
}

fn remember_end_of_game(outbox: &ObservationOutbox, payload: &Value) -> Result<(), String> {
    let Some(game_id) = find_string(payload, &["gameId", "reportGameId"]) else {
        return Ok(());
    };
    let body = serde_json::to_vec(payload).map_err(|error| error.to_string())?;
    outbox
        .remember_game_end(&game_id, chrono::Utc::now().timestamp_millis())
        .map_err(|error| error.to_string())?;
    outbox
        .remember_end_of_game(&game_id, &body)
        .map_err(|error| error.to_string())
}

/// Record the lobby-to-game join that only this client is in a position to see.
///
/// LCU answers `partyId` on the lobby and a real `gameId` only once the game is
/// in progress, and the in-progress session carries no lobby identity at all —
/// a live capture across all four phases found no field shared between them.
/// So nothing downstream can reconstruct which lobby a game came from, and the
/// lobby is where the full roster lives: bots, custom teams, everyone Riot's
/// spectator API will not report. Remembering the lobby while it is visible and
/// claiming it when a game starts is what lets the server attach that roster to
/// a real match.
///
/// Both sides are durable, so this survives a client restart between champion
/// select and the game.
fn bind_observed_lobby(
    outbox: &ObservationOutbox,
    payloads: &HashMap<String, Vec<u8>>,
    local_puuid: Option<&str>,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    let observed_at_millis = chrono::Utc::now().timestamp_millis();
    remember_current_lobby(outbox, payloads, observed_at_millis)?;
    let Some(session) = payloads.get("gameflow_session") else {
        return Ok(());
    };
    let session = serde_json::from_slice::<Value>(session).map_err(|error| error.to_string())?;
    if find_string(&session, &["phase"]).as_deref() != Some("InProgress") {
        return Ok(());
    }
    let Some(game_id) = find_string(&session, &["gameId"]) else {
        return Ok(());
    };
    // League reports `gameId: 0` for "no game", and the phase can flip before
    // `gameData` is filled in. Binding that would spend this game's one
    // recorded outcome on a placeholder.
    if game_id == "0" {
        return Ok(());
    }
    // `InProgress` is read on every tick for the length of a match. The outbox
    // records one outcome per game so this reports the decision exactly once,
    // rather than repeating it a few hundred times and burying the rest.
    let (outcome, detail) = match outbox
        .bind_game_to_lobby(&game_id, observed_at_millis)
        .map_err(|error| error.to_string())?
    {
        LobbyBinding::AlreadyRecorded => return Ok(()),
        LobbyBinding::Bound(_) => {
            // The in-game session was enqueued earlier this tick, before the
            // join existed, and an unchanged session is never sent again. Send
            // it once more now that `create_observation` can stamp it, or the
            // server would not learn the game's lobby until post-game — after
            // prematch needed it. Keyed per game so an offline client cannot
            // coalesce one game's join away under the next one's.
            enqueue_coalesced_snapshot(
                outbox,
                &format!("lobby_binding:{game_id}"),
                "gameflow_session",
                ObservationKind::Gameflow,
                &session,
                local_puuid,
                diagnostics,
            )?;
            diagnostics.counters().lobby_bound();
            (DiagnosticOutcome::Succeeded, "bound to the observed lobby")
        }
        LobbyBinding::Unwitnessed => (
            DiagnosticOutcome::Skipped,
            "no lobby was observed for this game",
        ),
    };
    diagnostics.record(
        DiagnosticEvent::new(
            DiagnosticLevel::Info,
            DiagnosticCategory::Protocol,
            "bind_lobby",
            outcome,
        )
        // The lobby and game ids are deliberately absent: a diagnostic carries
        // the shape of what happened, never an identity.
        .with_detail(detail),
    );
    Ok(())
}

/// Keep the lobby the player is in, so the next game to start can claim it.
fn remember_current_lobby(
    outbox: &ObservationOutbox,
    payloads: &HashMap<String, Vec<u8>>,
    observed_at_millis: i64,
) -> Result<(), String> {
    let Some(lobby) = payloads.get("lobby") else {
        return Ok(());
    };
    let lobby = serde_json::from_slice::<Value>(lobby).map_err(|error| error.to_string())?;
    let Some(lobby_id) = find_string(&lobby, &["partyId", "lobbyId"]) else {
        return Ok(());
    };
    outbox
        .remember_observed_lobby(&lobby_id, observed_at_millis)
        .map_err(|error| error.to_string())
}

fn remember_game_start(
    outbox: &ObservationOutbox,
    payloads: &HashMap<String, Vec<u8>>,
) -> Result<(), String> {
    let (Some(session), Some(frame)) = (
        payloads.get("gameflow_session"),
        payloads.get("live_game_frame"),
    ) else {
        return Ok(());
    };
    let session = serde_json::from_slice::<Value>(session).map_err(|error| error.to_string())?;
    let frame = serde_json::from_slice::<Value>(frame).map_err(|error| error.to_string())?;
    let Some((game_id, started_at_millis)) =
        game_start_evidence(&session, &frame, chrono::Utc::now().timestamp_millis())
    else {
        return Ok(());
    };
    outbox
        .remember_game_start(&game_id, started_at_millis)
        .map_err(|error| error.to_string())
}

fn game_start_evidence(
    session: &Value,
    frame: &Value,
    observed_at_millis: i64,
) -> Option<(String, i64)> {
    if find_string(session, &["phase"]).as_deref() != Some("InProgress") {
        return None;
    }
    let game_id = find_string(session, &["gameId"])?;
    let game_time = frame.get("gameData")?.get("gameTime")?.as_f64()?;
    if !game_time.is_finite() || !(0.0..=86_400.0).contains(&game_time) {
        return None;
    }
    let elapsed = Duration::try_from_secs_f64(game_time).ok()?;
    let elapsed_millis = i64::try_from(elapsed.as_millis()).ok()?;
    let started_at_millis = observed_at_millis.checked_sub(elapsed_millis)?;
    (started_at_millis > 0).then_some((game_id, started_at_millis))
}

fn should_refresh_lobby(previous: Option<&[u8]>, current: &[u8], tick_number: u64) -> bool {
    tick_number % 15 == 1 && previous == Some(current)
}

async fn collect_live_frame(
    live_client: Option<&LiveClient>,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    local_puuid: Option<&str>,
) -> Result<(), String> {
    let Some(live_client) = live_client else {
        return Ok(());
    };
    if let Some(payload) = live_client
        .all_game_data()
        .await
        .map_err(|error| error.to_string())?
    {
        let body = serde_json::to_vec(&payload).map_err(|error| error.to_string())?;
        if should_emit_live_game_frame(payloads.get("live_game_frame").map(Vec::as_slice)) {
            let observation = create_observation(
                outbox,
                "live_game_frame",
                ObservationKind::LiveGameFrame,
                &payload,
                local_puuid,
            )?;
            outbox
                .enqueue_coalesced("live_game_frame", &observation)
                .map_err(|error| error.to_string())?;
        }
        // Keep the newest frame locally for game-start timing without turning
        // continuously advancing gameTime into a durable server observation.
        payloads.insert("live_game_frame".to_owned(), body);
    } else {
        payloads.remove("live_game_frame");
    }
    Ok(())
}

fn should_emit_live_game_frame(previous: Option<&[u8]>) -> bool {
    previous.is_none()
}

/// The profile resources every pass reads: (endpoint, cache key, kind).
const PROFILE_SNAPSHOT_ENDPOINTS: &[(LcuEndpoint, &str, ObservationKind)] = &[
    (
        LcuEndpoint::ChampionMastery,
        "champion_mastery",
        ObservationKind::ChampionMastery,
    ),
    (
        LcuEndpoint::ChampionMasteryMilestones,
        "champion_mastery_milestones",
        ObservationKind::ChampionMastery,
    ),
    (
        LcuEndpoint::Challenges,
        "challenges",
        ObservationKind::Challenges,
    ),
    (
        LcuEndpoint::ChallengeSummary,
        "challenge_summary",
        ObservationKind::Challenges,
    ),
    (
        LcuEndpoint::ClashPlayer,
        "clash_player",
        ObservationKind::Clash,
    ),
    (
        LcuEndpoint::ClashTournaments,
        "clash_tournaments",
        ObservationKind::Clash,
    ),
    (
        LcuEndpoint::ClashSummary,
        "clash_summary",
        ObservationKind::Clash,
    ),
    (
        LcuEndpoint::ClashCheckinAllowed,
        "clash_checkin_allowed",
        ObservationKind::Clash,
    ),
    (
        LcuEndpoint::ClashCurrentTournamentIds,
        "clash_current_tournament_ids",
        ObservationKind::Clash,
    ),
    (
        LcuEndpoint::ClashHistoryAndWinners,
        "clash_history_and_winners",
        ObservationKind::Clash,
    ),
    (
        LcuEndpoint::ClashPlayerHistory,
        "clash_player_history",
        ObservationKind::Clash,
    ),
    (
        LcuEndpoint::ClashRewards,
        "clash_rewards",
        ObservationKind::Clash,
    ),
    (
        LcuEndpoint::ClashStateFlags,
        "clash_state_flags",
        ObservationKind::Clash,
    ),
    (
        LcuEndpoint::ClashTournamentState,
        "clash_tournament_state",
        ObservationKind::Clash,
    ),
    (
        LcuEndpoint::ClashInvitedRosters,
        "clash_invited_rosters",
        ObservationKind::Clash,
    ),
];

async fn collect_profile_snapshots(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    local_puuid: Option<&str>,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    let deadline = Instant::now() + PROFILE_PASS_BUDGET;
    let mut first_failure = None;
    let mut any_payload = false;
    for &(endpoint, key, kind) in PROFILE_SNAPSHOT_ENDPOINTS {
        if out_of_budget(deadline, diagnostics) {
            return first_failure.filter(|_| !any_payload).map_or(Ok(()), Err);
        }
        // One endpoint failing — Clash's are off outside a tournament window —
        // must not cost the rest. Failing to keep what was read is another
        // matter, and ends the pass.
        match noted_lcu_read(client.get(endpoint).await, diagnostics, key) {
            Ok(payload) => {
                any_payload |= payload.is_some();
                record_endpoint_payload(
                    outbox,
                    payloads,
                    ObservationSlot::named(key, kind),
                    payload.as_ref(),
                    local_puuid,
                    diagnostics,
                )?;
            }
            Err(error) => {
                first_failure.get_or_insert(error.to_string());
            }
        }
    }
    collect_clash_details(
        client,
        outbox,
        payloads,
        (local_puuid, diagnostics),
        deadline,
    )
    .await?;
    // Only a pass where nothing was read is a failed tick; a 404 is no read.
    first_failure.filter(|_| !any_payload).map_or(Ok(()), Err)
}

/// How long one profile pass may spend reading. A League client that stalls
/// rather than refusing costs each read its full five-second timeout; past
/// this budget the remaining reads wait for the next pass.
const PROFILE_PASS_BUDGET: Duration = Duration::from_secs(20);

/// Whether the pass's read budget is spent, recording it when it is.
fn out_of_budget(deadline: Instant, diagnostics: &Diagnostics) -> bool {
    let spent = Instant::now() >= deadline;
    if spent {
        diagnostics.record(
            DiagnosticEvent::new(
                DiagnosticLevel::Warn,
                DiagnosticCategory::Lcu,
                "profile_pass",
                DiagnosticOutcome::Deferred,
            )
            .with_detail("read budget spent; remaining reads wait for the next pass"),
        );
    }
    spent
}

/// The Clash resources only an ID reaches: the player's own roster, its
/// record, its bracket, and its tournament.
///
/// Only the player's own roster is followed. Ingress keeps one snapshot per
/// player and resource, so a second roster (an invitation, say) read into the
/// same slot would replace it. For the same reason the bracket and tournament
/// IDs come from the roster payload just read, never from the cache, which can
/// hold an earlier roster; the player payload stands in for a bracket the
/// roster doesn't name.
///
/// Built from the League client's field names as best known (`rosterId`,
/// `bracketId`, `tournamentId`). A name that never appears reads nothing, and
/// every read is best-effort: each failure is recorded and the rest still
/// run. A failure to keep what was read is returned.
async fn collect_clash_details(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    observer: (Option<&str>, &Diagnostics),
    deadline: Instant,
) -> Result<(), String> {
    let diagnostics = observer.1;
    let Some(roster) = ids_from(payloads, &["clash_player"], &["rosterId"])
        .iter()
        .find_map(|id| ClashRosterId::parse(id))
    else {
        return Ok(());
    };
    if out_of_budget(deadline, diagnostics) {
        return Ok(());
    }
    let read = (LcuResource::ClashRoster(roster), "clash_roster");
    let roster_payload = observe_clash_resource(client, outbox, payloads, read, observer).await?;
    let from_roster = |key: &str| {
        roster_payload
            .as_ref()
            .and_then(|value| first_value(value, key))
    };
    let mut reads = vec![(LcuResource::ClashRosterStats(roster), "clash_roster_stats")];
    let bracket = from_roster("bracketId")
        .into_iter()
        .chain(ids_from(payloads, &["clash_player"], &["bracketId"]))
        .find_map(|id| ClashBracketId::parse(&id));
    if let Some(bracket) = bracket {
        reads.push((LcuResource::ClashBracket(bracket), "clash_bracket"));
    }
    if let Some(tournament) =
        from_roster("tournamentId").and_then(|id| ClashTournamentId::parse(&id))
    {
        reads.push((LcuResource::ClashTournament(tournament), "clash_tournament"));
    }
    for read in reads {
        if out_of_budget(deadline, diagnostics) {
            return Ok(());
        }
        observe_clash_resource(client, outbox, payloads, read, observer).await?;
    }
    Ok(())
}

/// Read one ID-addressed Clash resource into its slot, returning what was
/// read. A failed read is recorded, under the resource name rather than its
/// ID, and reads as nothing.
async fn observe_clash_resource(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    (resource, name): (LcuResource, &str),
    (local_puuid, diagnostics): (Option<&str>, &Diagnostics),
) -> Result<Option<Value>, String> {
    let Ok(payload) = noted_lcu_read(client.get_resource(resource).await, diagnostics, name) else {
        return Ok(None);
    };
    record_endpoint_payload(
        outbox,
        payloads,
        ObservationSlot::named(name, ObservationKind::Clash),
        payload.as_ref(),
        local_puuid,
        diagnostics,
    )?;
    Ok(payload)
}

/// The first non-empty value of `key` in `value`, searched depth-first.
fn first_value(value: &Value, key: &str) -> Option<String> {
    let mut found = Vec::new();
    collect_values(value, &[key], &mut found);
    found.into_iter().next()
}

/// Every value of `keys` in the cached payloads named `sources`, plus any
/// scalar a source holds as a bare list (the League client answers some ID
/// lists as `[123, 456]`). Deduplicated, in the order found.
fn ids_from(payloads: &HashMap<String, Vec<u8>>, sources: &[&str], keys: &[&str]) -> Vec<String> {
    let mut found = Vec::new();
    for source in sources {
        let Some(value) = payloads
            .get(*source)
            .and_then(|body| serde_json::from_slice::<Value>(body).ok())
        else {
            continue;
        };
        if let Value::Array(items) = &value {
            found.extend(items.iter().filter_map(scalar_id));
        }
        collect_values(&value, keys, &mut found);
    }
    let mut seen = std::collections::HashSet::new();
    found.retain(|id| seen.insert(id.clone()));
    found
}

fn scalar_id(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.is_empty() => Some(text.clone()),
        Value::Number(number) => number.as_u64().map(|id| id.to_string()),
        _ => None,
    }
}

/// Every non-empty value of `keys`, searched depth-first.
fn collect_values(value: &Value, keys: &[&str], found: &mut Vec<String>) {
    match value {
        Value::Object(object) => {
            for (key, child) in object {
                if keys.contains(&key.as_str())
                    && let Some(id) = scalar_id(child)
                {
                    found.push(id);
                }
                collect_values(child, keys, found);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_values(item, keys, found);
            }
        }
        _ => {}
    }
}

async fn collect_recent_matches(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    local_puuid: Option<&str>,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    let Some(history) = client
        .get(LcuEndpoint::MatchHistoryRecent)
        .await
        .map_err(|error| error.to_string())?
    else {
        return Ok(());
    };
    let Some(games) = history
        .get("games")
        .and_then(|value| value.get("games"))
        .and_then(Value::as_array)
    else {
        return Ok(());
    };
    for game in games {
        let Some(game_id) = find_string(game, &["gameId"]) else {
            continue;
        };
        let key = format!("match_history_game:{game_id}");
        enqueue_if_changed(
            outbox,
            payloads,
            &key,
            ObservationKind::PostGame,
            game,
            local_puuid,
            diagnostics,
        )?;
        if let Some(end_of_game) = outbox
            .pending_end_of_game(&game_id)
            .map_err(|error| error.to_string())?
            && let Some(timing) = outbox
                .pending_game_timing(&game_id)
                .map_err(|error| error.to_string())?
        {
            let Some(parsed_id) = GameId::parse(&game_id) else {
                continue;
            };
            // Wait for the full game rather than send the one-player list row:
            // the end-of-game bundle stays pending and the next pass retries.
            let Some(full) = read_full_post_game(client, parsed_id, diagnostics).await else {
                continue;
            };
            let end_of_game =
                serde_json::from_slice::<Value>(&end_of_game).map_err(|error| error.to_string())?;
            let mut bundle = serde_json::json!({
                "matchHistory": full.game,
                "endOfGame": end_of_game,
                "timing": {
                    "gameStartTimestamp": timing.started_at_millis,
                    "gameEndTimestamp": timing.ended_at_millis,
                },
            });
            if let (Some(timeline), Some(fields)) = (full.timeline, bundle.as_object_mut()) {
                fields.insert("timeline".to_owned(), timeline);
            }
            enqueue_resource_if_changed(
                outbox,
                payloads,
                ObservationSlot {
                    cache_key: &format!("post_game_bundle:{game_id}"),
                    resource: "post_game",
                    kind: ObservationKind::PostGame,
                },
                &bundle,
                local_puuid,
                diagnostics,
            )?;
            outbox
                .forget_end_of_game(&game_id)
                .map_err(|error| error.to_string())?;
            outbox
                .forget_game_timing(&game_id)
                .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

/// One finished game as the League client's own match history holds it.
struct FullPostGame {
    /// `games/{id}`: every participant, where the history list holds only the
    /// local player.
    game: Value,
    /// `game-timelines/{id}`, when the League client has one.
    timeline: Option<Value>,
}

/// Read a finished game's full roster and timeline by ID.
///
/// `None` while the full game is unavailable, so the caller retries on its
/// next pass. A missing or failed timeline read never holds the game back: a
/// game without a timeline still has a result.
async fn read_full_post_game(
    client: &LcuClient,
    game_id: GameId,
    diagnostics: &Diagnostics,
) -> Option<FullPostGame> {
    let game = client
        .get_resource(LcuResource::MatchHistoryGame(game_id))
        .await;
    let Ok(Some(game)) = game else {
        record_post_game_read(
            diagnostics,
            match game {
                Err(_) => DiagnosticOutcome::Failed,
                Ok(_) => DiagnosticOutcome::Skipped,
            },
            "full game not available yet; retrying next pass",
        );
        return None;
    };
    let timeline = client
        .get_resource(LcuResource::MatchTimeline(game_id))
        .await;
    let (outcome, detail) = match &timeline {
        Ok(Some(_)) => (DiagnosticOutcome::Succeeded, "full game and timeline"),
        Ok(None) => (DiagnosticOutcome::Succeeded, "full game; no timeline"),
        Err(_) => (DiagnosticOutcome::Failed, "full game; timeline read failed"),
    };
    // Shape only: the game id and payloads stay out of diagnostics.
    record_post_game_read(diagnostics, outcome, detail);
    Some(FullPostGame {
        game,
        timeline: timeline.ok().flatten(),
    })
}

fn record_post_game_read(diagnostics: &Diagnostics, outcome: DiagnosticOutcome, detail: &str) {
    let level = if outcome == DiagnosticOutcome::Failed {
        DiagnosticLevel::Warn
    } else {
        DiagnosticLevel::Info
    };
    diagnostics.record(
        DiagnosticEvent::new(
            level,
            DiagnosticCategory::Protocol,
            "read_post_game",
            outcome,
        )
        .with_detail(detail),
    );
}

/// The League client's end-of-game block.
///
/// It and the game client's block both travel as `post_game`, but each needs
/// its own change-detection key. With one shared key, every pass where this
/// block was absent cleared the key and the game client's block looked new,
/// so it was sent again every two seconds — 366 copies of one Arena game.
const END_OF_GAME_SLOT: ObservationSlot<'static> = ObservationSlot {
    cache_key: "post_game_end_of_game",
    resource: "post_game",
    kind: ObservationKind::PostGame,
};

/// The game client's own end-of-game block, read when the League client's
/// is absent. See [`END_OF_GAME_SLOT`].
const GAME_CLIENT_END_OF_GAME_SLOT: ObservationSlot<'static> = ObservationSlot {
    cache_key: "post_game_game_client",
    resource: "post_game",
    kind: ObservationKind::PostGame,
};

/// What a collected payload is filed as.
///
/// These three always travel together — the loops below already group them as
/// a tuple — so naming them keeps the call signatures within budget.
#[derive(Clone, Copy)]
struct ObservationSlot<'a> {
    /// Key used to detect that a payload changed.
    cache_key: &'a str,
    /// Resource name carried on the wire.
    resource: &'a str,
    kind: ObservationKind,
}

impl<'a> ObservationSlot<'a> {
    /// A slot whose cache key and resource name are the same.
    const fn named(name: &'a str, kind: ObservationKind) -> Self {
        Self {
            cache_key: name,
            resource: name,
            kind,
        }
    }
}

async fn observe_endpoint(
    client: &LcuClient,
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    endpoint: LcuEndpoint,
    slot: ObservationSlot<'_>,
    local_puuid: Option<&str>,
    diagnostics: &Diagnostics,
) -> Result<Option<Value>, String> {
    let payload = noted_lcu_read(client.get(endpoint).await, diagnostics, slot.cache_key)
        .map_err(|error| error.to_string())?;
    record_endpoint_payload(
        outbox,
        payloads,
        slot,
        payload.as_ref(),
        local_puuid,
        diagnostics,
    )?;
    Ok(payload)
}

/// `read`, with a failure recorded under `name`.
fn noted_lcu_read<T>(
    read: Result<T, LcuError>,
    diagnostics: &Diagnostics,
    name: &str,
) -> Result<T, LcuError> {
    if let Err(error) = &read {
        record_lcu_read_failure(diagnostics, name, error);
    }
    read
}

/// Record a League client read that failed.
///
/// The League client is the other half of every observation, and a failure
/// to read it used to be invisible: the typed `LcuError` was flattened to a
/// string and never recorded, so a client that had quietly stopped seeing
/// games looked identical to one with nothing to report.
fn record_lcu_read_failure(diagnostics: &Diagnostics, name: &str, error: &LcuError) {
    diagnostics.counters().lcu_error();
    diagnostics.record(
        DiagnosticEvent::new(
            DiagnosticLevel::Warn,
            DiagnosticCategory::Lcu,
            "lcu_read",
            DiagnosticOutcome::Failed,
        )
        // The name travels in the detail rather than the operation because a
        // slot borrows it; both are bounded text.
        .with_detail(format!("{name}: {error}")),
    );
}

/// File one endpoint read: queue the payload if it changed since this slot
/// last saw it, or forget the slot when the endpoint has nothing, so a payload
/// that comes back is sent again.
fn record_endpoint_payload(
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    slot: ObservationSlot<'_>,
    payload: Option<&Value>,
    local_puuid: Option<&str>,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    if let Some(value) = payload {
        return enqueue_resource_if_changed(
            outbox,
            payloads,
            slot,
            value,
            local_puuid,
            diagnostics,
        );
    }
    payloads.remove(slot.cache_key);
    Ok(())
}

fn enqueue_if_changed(
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    key: &str,
    kind: ObservationKind,
    payload: &Value,
    local_puuid: Option<&str>,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    enqueue_resource_if_changed(
        outbox,
        payloads,
        ObservationSlot::named(key, kind),
        payload,
        local_puuid,
        diagnostics,
    )
}

fn enqueue_resource_if_changed(
    outbox: &ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    slot: ObservationSlot<'_>,
    payload: &Value,
    local_puuid: Option<&str>,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    let (cache_key, resource, kind) = (slot.cache_key, slot.resource, slot.kind);
    let body = serde_json::to_vec(&payload).map_err(|error| error.to_string())?;
    if payloads.get(cache_key) == Some(&body) {
        return Ok(());
    }
    let observation = create_observation(outbox, resource, kind, payload, local_puuid)?;
    let stored = if kind == ObservationKind::LiveGameFrame {
        outbox.enqueue_coalesced(resource, &observation)
    } else {
        outbox.enqueue(&observation)
    };
    if let Err(error) = stored {
        // The outbox is what makes an observation survive a network failure.
        // If the write itself fails the evidence is simply gone, which is the
        // one outbox outcome worth a record of its own.
        diagnostics.record(
            DiagnosticEvent::new(
                DiagnosticLevel::Error,
                DiagnosticCategory::Outbox,
                "enqueue_observation",
                DiagnosticOutcome::Failed,
            )
            .with_detail(error.to_string()),
        );
        return Err(error.to_string());
    }
    payloads.insert(cache_key.to_owned(), body);
    Ok(())
}

fn enqueue_coalesced_snapshot(
    outbox: &ObservationOutbox,
    coalesce_key: &str,
    resource: &str,
    kind: ObservationKind,
    payload: &Value,
    local_puuid: Option<&str>,
    diagnostics: &Diagnostics,
) -> Result<(), String> {
    let observation = create_observation(outbox, resource, kind, payload, local_puuid)?;
    if let Err(error) = outbox.enqueue_coalesced(coalesce_key, &observation) {
        diagnostics.record(
            DiagnosticEvent::new(
                DiagnosticLevel::Error,
                DiagnosticCategory::Outbox,
                "enqueue_observation",
                DiagnosticOutcome::Failed,
            )
            .with_detail(error.to_string()),
        );
        return Err(error.to_string());
    }
    Ok(())
}

/// Replays reported to the server in one inventory observation.
const REPLAY_INVENTORY_LIMIT: u32 = 100;

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
fn report_replay_inventory(
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

fn create_observation(
    outbox: &ObservationOutbox,
    resource: &str,
    kind: ObservationKind,
    payload: &Value,
    local_puuid: Option<&str>,
) -> Result<ObservationEnvelope, String> {
    let sequence = outbox.next_sequence().map_err(|error| error.to_string())?;
    let mut observation = ObservationEnvelope::new(
        sequence,
        kind,
        env!("CARGO_PKG_VERSION"),
        serde_json::json!({ "resource": resource, "data": payload }),
    )
    .map_err(|error| error.to_string())?;
    observation.local_puuid = local_puuid.map(str::to_owned);
    observation.game_id = find_string(&observation.payload, &["gameId"]);
    observation.lobby_id = match find_string(&observation.payload, &["lobbyId", "partyId"]) {
        // The lobby says which party it is; nothing else does. An in-game
        // observation names a game whose lobby only this device witnessed, so
        // fall back to the join recorded when that game started — otherwise the
        // roster and the match it belongs to never meet.
        None => match observation.game_id.as_deref() {
            Some(game_id) => outbox
                .lobby_for_game(game_id)
                .map_err(|error| error.to_string())?,
            None => None,
        },
        found => found,
    };
    observation.platform_id = find_string(&observation.payload, &["platformId"]);
    observation.league_patch = find_string(&observation.payload, &["gameVersion"]);
    observation.validate().map_err(|error| error.to_string())?;
    Ok(observation)
}

/// The first non-empty value for any of `keys`, searched depth-first.
///
/// An empty string counts as ABSENT rather than as a value. The League client
/// answers `""` for a field it has no value for yet — `platformId` before a
/// game is assigned, for instance — and every envelope field filled from here
/// is an `Option` that `ObservationEnvelope::validate` is happy to see unset
/// but rejects at length zero. Returning `Some("")` therefore failed the whole
/// observation, and a post-game observation that never validates is one that
/// never reaches Scout at all. Skipping the empty value also lets the search
/// continue into nested objects, where the real value usually is.
fn find_string(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(object) => {
            for key in keys {
                if let Some(candidate) = object.get(*key) {
                    if let Some(value) = candidate.as_str() {
                        if !value.is_empty() {
                            return Some(value.to_owned());
                        }
                    } else if let Some(value) = candidate.as_u64() {
                        return Some(value.to_string());
                    }
                }
            }
            object.values().find_map(|item| find_string(item, keys))
        }
        Value::Array(items) => items.iter().find_map(|item| find_string(item, keys)),
        _ => None,
    }
}

fn outbox_file_name(backend_origin: &str, device_id: Option<Uuid>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(backend_origin.as_bytes());
    hasher.update([0]);
    if let Some(device_id) = device_id {
        hasher.update(device_id.as_bytes());
    }
    format!("outbox-{}.db", hex::encode(hasher.finalize()))
}

/// The per-user directory holding the outbox and the diagnostics log.
fn data_directory() -> Option<PathBuf> {
    let project = ProjectDirs::from("com", "Scout", "Scout Client")?;
    let directory = project.data_local_dir().to_path_buf();
    if let Err(error) = std::fs::create_dir_all(&directory) {
        error!(%error, "could not create Scout Client data directory");
        return None;
    }
    Some(directory)
}

/// Where rotated JSONL diagnostics are written.
fn log_directory() -> Option<PathBuf> {
    Some(data_directory()?.join("logs"))
}

fn outbox_path(backend_origin: &str, device_id: Option<Uuid>) -> PathBuf {
    let file_name = outbox_file_name(backend_origin, device_id);
    data_directory().map_or_else(
        || std::env::temp_dir().join(&file_name),
        |directory| directory.join(&file_name),
    )
}

fn set_error(state: &Arc<RwLock<RuntimeState>>, message: String) {
    update_state(state, |snapshot| {
        snapshot.last_runtime_error = Some(message);
        synchronize_last_error(snapshot);
    });
}

fn set_replay_error(state: &Arc<RwLock<RuntimeState>>, message: String) {
    update_state(state, |snapshot| {
        snapshot.last_replay_error = Some(message);
        synchronize_last_error(snapshot);
    });
}

fn clear_runtime_error(snapshot: &mut RuntimeState) {
    snapshot.last_runtime_error = None;
    synchronize_last_error(snapshot);
}

fn clear_replay_error(snapshot: &mut RuntimeState) {
    snapshot.last_replay_error = None;
    synchronize_last_error(snapshot);
}

fn synchronize_last_error(snapshot: &mut RuntimeState) {
    snapshot.last_error = match (
        snapshot.last_runtime_error.as_deref(),
        snapshot.last_replay_error.as_deref(),
    ) {
        (Some(runtime), Some(replay)) => Some(format!("{runtime}\nReplay capture: {replay}")),
        (Some(runtime), None) => Some(runtime.to_owned()),
        (None, Some(replay)) => Some(format!("Replay capture: {replay}")),
        (None, None) => None,
    };
}

fn update_state(state: &Arc<RwLock<RuntimeState>>, update: impl FnOnce(&mut RuntimeState)) {
    match state.write() {
        Ok(mut snapshot) => update(&mut snapshot),
        Err(error) => error!(%error, "Scout Client UI state lock was poisoned"),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::{Arc, RwLock};

    use scout_client_core::lcu::LcuError;
    use serde_json::json;
    use uuid::Uuid;

    use scout_client_core::outbox::ObservationOutbox;
    use scout_client_core::protocol::{
        ObservationEnvelope, ObservationKind, ObservationOutcome, ObservationQuarantineReason,
        ObservationReceipt,
    };

    use super::{
        END_OF_GAME_SLOT, GAME_CLIENT_END_OF_GAME_SLOT, RuntimeState, apply_observation_receipt,
        bind_observed_lobby, clear_replay_error, clear_runtime_error, find_string,
        game_start_evidence, ids_from, optional_lockfile, outbox_file_name,
        record_endpoint_payload, replay_platform_id, replay_sha256, set_error, set_replay_error,
        should_emit_live_game_frame, should_refresh_lobby, update_state,
    };
    use scout_client_core::diagnostics::Diagnostics;
    use std::collections::HashMap;

    fn lobby_bindings(diagnostics: &Diagnostics) -> Option<u64> {
        diagnostics
            .counters()
            .readings()
            .into_iter()
            .find_map(|(name, value)| (name == "lobby_bindings").then_some(value))
    }

    fn in_progress_session() -> Result<Vec<u8>, serde_json::Error> {
        serde_json::to_vec(&json!({
            "phase": "InProgress",
            "gameData": { "gameId": 5_653_248_720_u64 },
        }))
    }

    #[test]
    fn clash_ids_come_from_the_payloads_already_read() -> Result<(), serde_json::Error> {
        let mut payloads = HashMap::new();
        payloads.insert(
            "clash_player".to_owned(),
            serde_json::to_vec(&json!({
                "summonerId": 1,
                "rosterId": "f1c2a7d0-4b9e-4a17-9c3e-2d8f6a5b1c0e",
            }))?,
        );
        payloads.insert(
            "clash_current_tournament_ids".to_owned(),
            serde_json::to_vec(&json!([3021, 3022, 3021]))?,
        );
        payloads.insert(
            "clash_roster".to_owned(),
            serde_json::to_vec(&json!({ "members": [], "bracketId": 18276 }))?,
        );
        payloads.insert(
            "lobby".to_owned(),
            serde_json::to_vec(&json!({ "rosterId": "not-from-a-clash-source" }))?,
        );

        assert_eq!(
            ids_from(&payloads, &["clash_player"], &["rosterId"]),
            vec!["f1c2a7d0-4b9e-4a17-9c3e-2d8f6a5b1c0e".to_owned()]
        );
        assert_eq!(
            ids_from(&payloads, &["clash_current_tournament_ids"], &["id"]),
            vec!["3021".to_owned(), "3022".to_owned()]
        );
        assert_eq!(
            ids_from(&payloads, &["clash_roster"], &["bracketId"]),
            vec!["18276".to_owned()]
        );
        Ok(())
    }

    #[test]
    fn an_unchanged_game_client_end_of_game_block_is_sent_once()
    -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!("scout-runtime-{}.db", Uuid::new_v4()));
        let outbox = ObservationOutbox::open(&path)?;
        let diagnostics = Diagnostics::in_memory();
        let mut payloads = HashMap::new();
        let block = json!({ "gameId": 5_654_767_039_u64, "queueType": "CHERRY" });

        // Each pass after an Arena game: the League client has no end-of-game
        // block, so the game client's is read instead — and it doesn't change.
        for _ in 0..3 {
            record_endpoint_payload(
                &outbox,
                &mut payloads,
                END_OF_GAME_SLOT,
                None,
                Some("puuid"),
                &diagnostics,
            )?;
            record_endpoint_payload(
                &outbox,
                &mut payloads,
                GAME_CLIENT_END_OF_GAME_SLOT,
                Some(&block),
                Some("puuid"),
                &diagnostics,
            )?;
        }

        let pending = outbox.pending(100)?;
        assert_eq!(pending.len(), 1, "an unchanged block is sent once");
        let sent: ObservationEnvelope = serde_json::from_slice(&pending[0].body)?;
        assert_eq!(sent.kind, ObservationKind::PostGame);
        assert_eq!(sent.payload["resource"], "post_game");

        let _ = std::fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn a_started_game_is_sent_again_carrying_the_lobby_it_came_from()
    -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!("scout-runtime-{}.db", Uuid::new_v4()));
        let outbox = ObservationOutbox::open(&path)?;
        let diagnostics = Diagnostics::in_memory();
        let mut payloads = HashMap::new();

        // Champion select: the lobby is visible, and no game exists yet.
        payloads.insert(
            "lobby".to_owned(),
            serde_json::to_vec(&json!({ "partyId": "party-1" }))?,
        );
        bind_observed_lobby(&outbox, &payloads, Some("puuid"), &diagnostics)?;
        assert_eq!(outbox.pending(100)?.len(), 0);

        // In game: LCU drops the lobby and names the game, with no link back.
        payloads.remove("lobby");
        payloads.insert("gameflow_session".to_owned(), in_progress_session()?);
        bind_observed_lobby(&outbox, &payloads, Some("puuid"), &diagnostics)?;

        let pending = outbox.pending(100)?;
        assert_eq!(pending.len(), 1, "the join must reach the server in-game");
        let sent: ObservationEnvelope = serde_json::from_slice(&pending[0].body)?;
        assert_eq!(sent.kind, ObservationKind::Gameflow);
        assert_eq!(sent.game_id.as_deref(), Some("5653248720"));
        assert_eq!(sent.lobby_id.as_deref(), Some("party-1"));
        assert_eq!(lobby_bindings(&diagnostics), Some(1));

        // Every later tick of the match reads the same session.
        bind_observed_lobby(&outbox, &payloads, Some("puuid"), &diagnostics)?;
        assert_eq!(outbox.pending(100)?.len(), 1);
        assert_eq!(lobby_bindings(&diagnostics), Some(1));

        let _ = std::fs::remove_file(&path);
        Ok(())
    }

    #[test]
    fn a_game_with_no_witnessed_lobby_sends_nothing_extra() -> Result<(), Box<dyn std::error::Error>>
    {
        // A client started mid-game never saw the lobby, so it has no join to
        // report; the ordinary session observation is all there is.
        let path = std::env::temp_dir().join(format!("scout-runtime-{}.db", Uuid::new_v4()));
        let outbox = ObservationOutbox::open(&path)?;
        let diagnostics = Diagnostics::in_memory();
        let mut payloads = HashMap::new();
        payloads.insert("gameflow_session".to_owned(), in_progress_session()?);

        bind_observed_lobby(&outbox, &payloads, Some("puuid"), &diagnostics)?;

        assert_eq!(outbox.pending(100)?.len(), 0);
        assert_eq!(lobby_bindings(&diagnostics), Some(0));
        let _ = std::fs::remove_file(&path);
        Ok(())
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

    #[test]
    fn empty_league_strings_are_absent_rather_than_zero_length_values() {
        // The League client answers "" for a field it has no value for yet.
        // Reporting that as Some("") failed envelope validation and dropped the
        // whole observation, so every field filled by find_string is affected.
        for key in ["platformId", "gameId", "lobbyId", "gameVersion"] {
            assert_eq!(find_string(&json!({ key: "" }), &[key]), None, "{key}");
        }
    }

    #[test]
    fn an_empty_value_does_not_hide_a_nested_one() {
        let payload = json!({
            "platformId": "",
            "gameData": { "platformId": "NA1" },
        });
        assert_eq!(
            find_string(&payload, &["platformId"]),
            Some("NA1".to_owned())
        );
    }

    #[test]
    fn present_values_are_still_found_in_either_spelling() {
        assert_eq!(
            find_string(&json!({ "platformId": "EUW1" }), &["platformId"]),
            Some("EUW1".to_owned())
        );
        assert_eq!(
            find_string(&json!({ "gameId": 5_565_990_955_u64 }), &["gameId"]),
            Some("5565990955".to_owned())
        );
        assert_eq!(
            find_string(&json!({ "lobbyId": "abc" }), &["lobbyId", "partyId"]),
            Some("abc".to_owned())
        );
    }

    #[test]
    fn an_empty_post_game_platform_id_still_yields_a_valid_envelope() {
        // The exact shape observed in the field: a post_game payload whose
        // platformId is blank must validate, not be rejected at length zero.
        let constructed = ObservationEnvelope::new(
            1,
            ObservationKind::PostGame,
            "0.1.0",
            json!({ "resource": "end_of_game", "data": { "platformId": "", "gameId": 5_565_990_955_u64 } }),
        );
        let Ok(mut envelope) = constructed else {
            unreachable!("a post_game envelope must construct")
        };
        envelope.platform_id = find_string(&envelope.payload, &["platformId"]);
        envelope.game_id = find_string(&envelope.payload, &["gameId"]);
        assert_eq!(envelope.platform_id, None);
        assert_eq!(envelope.game_id, Some("5565990955".to_owned()));
        assert!(envelope.validate().is_ok());
    }

    #[test]
    fn stopped_league_is_not_a_replay_upload_error() {
        assert!(matches!(
            optional_lockfile(Err(LcuError::NotRunning)),
            Ok(None)
        ));
    }

    #[test]
    fn invalid_league_lockfile_remains_an_actionable_error() {
        assert!(matches!(
            optional_lockfile(Err(LcuError::InvalidLockfile)),
            Err(message) if message == "League lockfile is invalid"
        ));
    }

    #[test]
    fn durable_outbox_files_are_backend_and_device_scoped() {
        let first_device = Uuid::new_v4();
        let second_device = Uuid::new_v4();
        let production = outbox_file_name("https://scout.sjer.red/", Some(first_device));

        assert_eq!(
            production,
            outbox_file_name("https://scout.sjer.red/", Some(first_device))
        );
        assert_ne!(
            production,
            outbox_file_name("https://scout.sjer.red/", Some(second_device))
        );
        assert_ne!(
            production,
            outbox_file_name("https://beta.scout.sjer.red/", Some(first_device))
        );
        assert_ne!(
            production,
            outbox_file_name("http://127.0.0.1:3000/", Some(first_device))
        );
        assert_ne!(
            production,
            outbox_file_name("https://scout.sjer.red/", None)
        );
    }

    #[test]
    fn outbox_file_names_match_persisted_databases() -> Result<(), uuid::Error> {
        let device = Uuid::parse_str("00000000-0000-4000-8000-000000000001")?;

        assert_eq!(
            outbox_file_name("https://scout.sjer.red/", Some(device)),
            "outbox-40889348c35a9742e33afe72090bb52b06193e3200cfa3181b3e6198e4922c81.db"
        );
        assert_eq!(
            outbox_file_name("https://scout.sjer.red/", None),
            "outbox-c0946c92d24dd4e6623c7d20a280d2d4dbe353ae2ec788d10824fc54711af925.db"
        );
        Ok(())
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

    #[test]
    fn only_unchanged_lobbies_are_periodically_reobserved() {
        assert!(!should_refresh_lobby(Some(&[1]), &[1], 2));
        assert!(should_refresh_lobby(Some(&[1]), &[1], 16));
        assert!(!should_refresh_lobby(Some(&[1]), &[2], 16));
        assert!(!should_refresh_lobby(None, &[1], 16));
    }

    #[test]
    fn emits_one_live_frame_per_live_client_session() {
        assert!(should_emit_live_game_frame(None));
        assert!(!should_emit_live_game_frame(Some(&[1])));
        assert!(!should_emit_live_game_frame(Some(&[2])));
    }

    #[test]
    fn ordinary_collection_success_does_not_clear_a_replay_error() {
        let state = Arc::new(RwLock::new(RuntimeState::default()));
        set_replay_error(&state, "relay unavailable".to_owned());
        set_error(&state, "League unavailable".to_owned());

        update_state(&state, clear_runtime_error);
        assert!(matches!(
            state.read(),
            Ok(snapshot)
                if snapshot.last_error.as_deref()
                    == Some("Replay capture: relay unavailable")
        ));

        update_state(&state, clear_replay_error);
        assert!(matches!(state.read(), Ok(snapshot) if snapshot.last_error.is_none()));
    }

    #[test]
    fn derives_playable_start_from_live_game_time() {
        let session = json!({
            "phase": "InProgress",
            "gameData": { "gameId": 12345 },
        });
        let frame = json!({ "gameData": { "gameTime": 12.5 } });

        assert_eq!(
            game_start_evidence(&session, &frame, 20_000),
            Some(("12345".to_owned(), 7_500))
        );
        assert_eq!(
            game_start_evidence(
                &json!({ "phase": "Lobby", "gameData": { "gameId": 12345 } }),
                &frame,
                20_000,
            ),
            None
        );
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
