//! The collector tick loop: commands, pairing, observation, and upload cadence.

use scout_client_core::backend::ScoutBackendClient;
use scout_client_core::credentials::DeviceCredential;
use scout_client_core::diagnostics::DiagnosticCategory;
use scout_client_core::diagnostics::DiagnosticEvent;
use scout_client_core::diagnostics::DiagnosticLevel;
use scout_client_core::diagnostics::DiagnosticOutcome;
use scout_client_core::diagnostics::Diagnostics;
use scout_client_core::lcu::LiveClient;
use scout_client_core::outbox::ObservationOutbox;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::sync::watch;
use uuid::Uuid;

use super::RuntimeCommand;
use super::collection;
use super::gameflow::collect_once;
use super::pairing::{PendingPairing, handle_command, poll_pairing};
use super::paths::outbox_path;
use super::replay::{
    ReplayUploadTask, cancel_replay_upload, finish_replay_upload, record_backend_outcome,
    start_replay_upload,
};
use super::state::{StateHub, set_error, update_state};
use super::upload::upload_pending;
use crate::startup;

pub(super) async fn run_collector(
    state: Arc<StateHub>,
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
    let mut collection_workers = collection::CollectionWorkers::default();
    let mut ticker = tokio::time::interval(Duration::from_secs(2));

    loop {
        tokio::select! {
            changed = shutdown.changed() => {
                if changed.is_err() || *shutdown.borrow() {
                    cancel_replay_upload(&mut replay_upload_task);
                    collection_workers.stop();
                    return;
                }
            }
            command = commands.recv() => {
                if let Some(command) = command {
                    if matches!(&command, RuntimeCommand::Disconnect) {
                        cancel_replay_upload(&mut replay_upload_task);
                        collection_workers.stop();
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
                collection_workers.tick(&state, &outbox, &diagnostics, tick_number, credential.as_ref().is_some_and(|credential| checked_in_device == Some(credential.device_id))).await;
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

pub(super) struct ObservationTickContext<'a> {
    state: &'a StateHub,
    backend: &'a ScoutBackendClient,
    outbox: &'a ObservationOutbox,
    credential: &'a DeviceCredential,
    checked_in_device: &'a mut Option<Uuid>,
    payloads: &'a mut HashMap<String, Vec<u8>>,
    live_client: Option<&'a LiveClient>,
    tick_number: u64,
    diagnostics: &'a Diagnostics,
}

pub(super) async fn collect_and_upload_observations(
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

pub(super) fn collector_resources(
    state: &StateHub,
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

pub(super) fn load_startup_state(state: &StateHub, backend_origin: &str) {
    match startup::is_enabled(backend_origin) {
        Ok(enabled) => update_state(state, |snapshot| snapshot.start_at_login = enabled),
        Err(error) => set_error(
            state,
            format!("Could not read start-at-login setting: {error}"),
        ),
    }
}

pub(super) async fn ensure_checked_in(
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

pub(super) fn create_live_client(state: &StateHub) -> Option<LiveClient> {
    match LiveClient::new() {
        Ok(client) => Some(client),
        Err(error) => {
            set_error(state, error.to_string());
            None
        }
    }
}
