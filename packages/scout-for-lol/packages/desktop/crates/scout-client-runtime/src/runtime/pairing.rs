//! Browser pairing, disconnect, and start-at-login commands.

use chrono::{DateTime, Utc};
use scout_client_core::backend::{BackendError, ScopeUpgradeOutcome, ScoutBackendClient};
use scout_client_core::credentials::DeviceCredential;
use scout_client_core::desktop_api::{ChatApprovalRoute, DeviceScope};
use scout_client_core::diagnostics::{
    DiagnosticCategory, DiagnosticEvent, DiagnosticLevel, DiagnosticOutcome, Diagnostics,
};
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

/// What the browser approval the collector is waiting on will do.
pub(super) enum PendingPairing {
    /// A new device: polled by exchanging the pairing secret.
    Fresh { id: Uuid, secret: String },
    /// Chat for the device already paired here: the same device and token,
    /// polled by asking the server whether the scope has arrived.
    ScopeUpgrade { expires_at: DateTime<Utc> },
}

fn pairing_request() -> CreatePairingRequest {
    CreatePairingRequest {
        device_name: format!("{} Scout Client", std::env::consts::OS),
        platform: std::env::consts::OS.to_owned(),
        architecture: std::env::consts::ARCH.to_owned(),
        app_version: env!("CARGO_PKG_VERSION").to_owned(),
        protocol_version: scout_client_core::protocol::PROTOCOL_VERSION,
    }
}

/// Publish a waiting approval and open its page in the browser.
fn wait_for_approval(state: &StateHub, status: &str, url: &str) {
    update_state(state, |snapshot| {
        snapshot.pairing_status = Some(status.to_owned());
        snapshot.approval_url = Some(url.to_owned());
        clear_runtime_error(snapshot);
    });
    if let Err(error) = open::that(url) {
        set_error(state, format!("Could not open approval page: {error}"));
    }
}

/// Get the `explore` scope onto this computer for the chat window.
///
/// Paired already: ask for the scope on the existing device, so its id, its
/// token and the outbox keyed by them are untouched and uploads still queued
/// under them are delivered. Not paired: start a fresh `pairings/v2` pairing.
async fn start_chat_approval(
    state: &StateHub,
    backend: &ScoutBackendClient,
    credential: Option<&DeviceCredential>,
    pending_pairing: &mut Option<PendingPairing>,
) {
    match (
        ChatApprovalRoute::for_paired(credential.is_some()),
        credential,
    ) {
        (ChatApprovalRoute::ScopeUpgrade, Some(device)) => {
            match backend
                .request_scope_upgrade(device, &[DeviceScope::Explore])
                .await
            {
                Ok(ScopeUpgradeOutcome::Requested(request)) => {
                    *pending_pairing = Some(PendingPairing::ScopeUpgrade {
                        expires_at: request.expires_at,
                    });
                    update_state(state, |snapshot| {
                        snapshot.pairing_match_code = Some(request.match_code.clone());
                    });
                    wait_for_approval(
                        state,
                        "Waiting for chat approval on the web",
                        &request.approval_url,
                    );
                }
                Ok(ScopeUpgradeOutcome::AlreadyGranted) => complete_scope_upgrade(state),
                // The stored token is no longer accepted (the device was revoked
                // on the web), so there is no device to upgrade: pair afresh.
                Err(BackendError::Rejected { status: 401, .. }) => {
                    start_fresh_pairing(state, backend, pending_pairing).await;
                }
                Err(error) => set_error(state, error.to_string()),
            }
        }
        _ => start_fresh_pairing(state, backend, pending_pairing).await,
    }
}

/// A desktop pairing asks for uploads and Explore chat together, so one
/// approval covers both, and shows the match code beside the request.
async fn start_fresh_pairing(
    state: &StateHub,
    backend: &ScoutBackendClient,
    pending_pairing: &mut Option<PendingPairing>,
) {
    match backend.create_desktop_pairing(&pairing_request()).await {
        Ok(pairing) => {
            *pending_pairing = Some(PendingPairing::Fresh {
                id: pairing.pairing_id,
                secret: pairing.pairing_secret,
            });
            update_state(state, |snapshot| {
                snapshot.pairing_match_code = Some(pairing.match_code.clone());
            });
            wait_for_approval(state, "Waiting for browser approval", &pairing.approval_url);
        }
        Err(error) => set_error(state, error.to_string()),
    }
}

/// The scope arrived on the device already here. Nothing else changes: the
/// credential and the outbox are not touched.
fn complete_scope_upgrade(state: &StateHub) {
    update_state(state, |snapshot| {
        snapshot.pairing_status = Some("Chat approved".to_owned());
        snapshot.approval_url = None;
        snapshot.pairing_match_code = None;
        clear_runtime_error(snapshot);
    });
}

/// What a runtime command acts on, apart from the credential and the pending
/// approval it may replace.
#[derive(Clone, Copy)]
pub(super) struct CommandContext<'a> {
    pub(super) state: &'a StateHub,
    pub(super) backend: &'a ScoutBackendClient,
    pub(super) backend_origin: &'a str,
    pub(super) outbox: &'a ObservationOutbox,
    pub(super) diagnostics: &'a Diagnostics,
}

pub(super) async fn handle_command(
    command: RuntimeCommand,
    context: CommandContext<'_>,
    credential: &mut Option<DeviceCredential>,
    pending_pairing: &mut Option<PendingPairing>,
) {
    let CommandContext {
        state,
        backend,
        backend_origin,
        outbox,
        diagnostics,
    } = context;
    match command {
        RuntimeCommand::StartPairing => {
            start_chat_approval(state, backend, credential.as_ref(), pending_pairing).await;
        }
        RuntimeCommand::Disconnect => {
            disconnect(
                state,
                backend,
                credential,
                pending_pairing,
                outbox,
                diagnostics,
            )
            .await;
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

/// What Disconnect says about uploads still queued under the device it drops.
///
/// Those uploads are keyed by the old device id and cannot be moved to the next
/// one the server issues, so they are never sent. Say so rather than let them
/// vanish quietly.
fn discarded_uploads_status(queued: u64) -> String {
    match queued {
        0 => "Disconnected".to_owned(),
        1 => "Disconnected; 1 queued upload was discarded".to_owned(),
        count => format!("Disconnected; {count} queued uploads were discarded"),
    }
}

pub(super) async fn disconnect(
    state: &StateHub,
    backend: &ScoutBackendClient,
    credential: &mut Option<DeviceCredential>,
    pending_pairing: &mut Option<PendingPairing>,
    outbox: &ObservationOutbox,
    diagnostics: &Diagnostics,
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
    // Counted before the credential goes; the file itself stays on disk.
    let queued = outbox.pending_count();
    match DeviceCredential::delete(backend.credential_scope()) {
        Ok(()) => {
            *credential = None;
            *pending_pairing = None;
            let queued = match queued {
                Ok(count) => count,
                Err(error) => {
                    diagnostics.record(
                        DiagnosticEvent::new(
                            DiagnosticLevel::Warn,
                            DiagnosticCategory::Runtime,
                            "disconnect_count_queued",
                            DiagnosticOutcome::Failed,
                        )
                        .with_detail(error.to_string()),
                    );
                    0
                }
            };
            if queued > 0 {
                diagnostics.record(
                    DiagnosticEvent::new(
                        DiagnosticLevel::Warn,
                        DiagnosticCategory::Runtime,
                        "disconnect_discarded_uploads",
                        DiagnosticOutcome::Succeeded,
                    )
                    .with_detail(format!(
                        "{queued} queued observations were keyed by the disconnected device and will not be uploaded"
                    )),
                );
            }
            update_state(state, |snapshot| {
                snapshot.paired = false;
                snapshot.pairing_status = Some(discarded_uploads_status(queued));
                snapshot.approval_url = None;
                snapshot.pairing_match_code = None;
                snapshot.pending_observations = 0;
                clear_runtime_error(snapshot);
            });
        }
        Err(error) => set_error(state, error.to_string()),
    }
}

/// Ask the server whether the owner has approved chat for this device yet.
async fn poll_scope_upgrade(
    state: &StateHub,
    backend: &ScoutBackendClient,
    credential: Option<&DeviceCredential>,
    expires_at: DateTime<Utc>,
    pending_pairing: &mut Option<PendingPairing>,
) -> Result<(), String> {
    let Some(device) = credential else {
        *pending_pairing = None;
        return Ok(());
    };
    if Utc::now() >= expires_at {
        *pending_pairing = None;
        update_state(state, |snapshot| {
            snapshot.pairing_status = Some("Chat approval expired; start again".to_owned());
            snapshot.approval_url = None;
            snapshot.pairing_match_code = None;
        });
        return Ok(());
    }
    if backend
        .explore_scope_granted(device)
        .await
        .map_err(|error| error.to_string())?
    {
        *pending_pairing = None;
        complete_scope_upgrade(state);
    }
    Ok(())
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
    if let Some(PendingPairing::ScopeUpgrade { expires_at }) = pending_pairing {
        let expires_at = *expires_at;
        return poll_scope_upgrade(
            state,
            backend,
            credential.as_ref(),
            expires_at,
            pending_pairing,
        )
        .await;
    }
    let Some(PendingPairing::Fresh { id, secret }) = pending_pairing else {
        return Ok(());
    };
    let (id, secret) = (*id, secret.clone());
    match backend
        .exchange_pairing(id, &secret)
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
                snapshot.pairing_match_code = None;
                clear_runtime_error(snapshot);
            });
            Ok(())
        }
        ExchangePairingResponse::Expired | ExchangePairingResponse::Consumed => {
            *pending_pairing = None;
            update_state(state, |snapshot| {
                snapshot.pairing_status = Some("Pairing expired; start again".to_owned());
                snapshot.approval_url = None;
                snapshot.pairing_match_code = None;
            });
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use scout_client_core::credentials::DeviceCredential;
    use scout_client_core::desktop_api::ChatApprovalRoute;
    use scout_client_core::outbox::ObservationOutbox;
    use scout_client_core::protocol::{ObservationEnvelope, ObservationKind};
    use serde_json::json;
    use uuid::Uuid;

    use super::super::paths::outbox_file_name;
    use super::super::state::StateHub;
    use super::{complete_scope_upgrade, discarded_uploads_status};

    #[test]
    fn disconnect_says_how_many_queued_uploads_it_discards() {
        assert_eq!(discarded_uploads_status(0), "Disconnected");
        assert_eq!(
            discarded_uploads_status(1),
            "Disconnected; 1 queued upload was discarded"
        );
        assert_eq!(
            discarded_uploads_status(7),
            "Disconnected; 7 queued uploads were discarded"
        );
    }

    #[test]
    fn chat_approval_upgrades_a_paired_device_and_pairs_an_unpaired_one() {
        assert_eq!(
            ChatApprovalRoute::for_paired(true),
            ChatApprovalRoute::ScopeUpgrade
        );
        assert_eq!(
            ChatApprovalRoute::for_paired(false),
            ChatApprovalRoute::FreshPairing
        );
    }

    #[test]
    fn the_outbox_survives_a_scope_upgrade() -> Result<(), Box<dyn std::error::Error>> {
        let origin = "https://scout.invalid/";
        let device_id = Uuid::new_v4();
        let path = std::env::temp_dir().join(outbox_file_name(origin, Some(device_id)));
        let outbox = ObservationOutbox::open(&path)?;
        outbox.enqueue(&ObservationEnvelope::new(
            1,
            ObservationKind::Gameflow,
            "test",
            json!({ "phase": "Lobby" }),
        )?)?;
        let credential = DeviceCredential {
            device_id,
            token: "sct_unchanged".to_owned(),
        };
        let before = credential.clone();
        let state = StateHub::default();

        complete_scope_upgrade(&state);

        // The upgrade neither replaces the credential nor reopens the outbox,
        // and the file a later start opens is the same one, keyed by device.
        assert_eq!(credential, before);
        assert_eq!(outbox.pending_count()?, 1);
        assert_eq!(
            outbox_file_name(origin, Some(credential.device_id)),
            outbox_file_name(origin, Some(device_id))
        );
        assert_ne!(
            outbox_file_name(origin, Some(Uuid::new_v4())),
            outbox_file_name(origin, Some(device_id)),
            "a fresh pairing is what changes the outbox"
        );
        assert_eq!(
            state.subscribe().borrow().pairing_status.as_deref(),
            Some("Chat approved")
        );
        let _ = std::fs::remove_file(path);
        Ok(())
    }
}
