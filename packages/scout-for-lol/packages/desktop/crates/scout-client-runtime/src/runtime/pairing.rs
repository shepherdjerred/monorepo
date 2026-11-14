//! Browser pairing, disconnect, and start-at-login commands.

use scout_client_core::backend::ScoutBackendClient;
use scout_client_core::credentials::DeviceCredential;
use scout_client_core::outbox::ObservationOutbox;
use scout_client_core::protocol::CreatePairingRequest;
use scout_client_core::protocol::ExchangePairingResponse;
use std::collections::HashMap;
use uuid::Uuid;

use super::RuntimeCommand;
use super::paths::outbox_path;
use super::state::{StateHub, clear_runtime_error, set_error, set_runtime_error, update_state};
use super::usage::UsageQueue;
use crate::startup;
use scout_client_core::telemetry::UsageEvent;

pub(super) struct PendingPairing {
    id: Uuid,
    secret: String,
}

pub(super) async fn handle_command(
    command: RuntimeCommand,
    state: &StateHub,
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

pub(super) async fn disconnect(
    state: &StateHub,
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
            set_runtime_error(
                snapshot,
                format!(
                    "Could not revoke the server credential; it remains stored locally: {error}"
                ),
            );
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

pub(super) async fn poll_pairing(
    state: &StateHub,
    backend: &ScoutBackendClient,
    outbox: &mut ObservationOutbox,
    payloads: &mut HashMap<String, Vec<u8>>,
    credential: &mut Option<DeviceCredential>,
    pending_pairing: &mut Option<PendingPairing>,
    usage: &UsageQueue,
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
            usage.push(UsageEvent::DevicePaired);
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
