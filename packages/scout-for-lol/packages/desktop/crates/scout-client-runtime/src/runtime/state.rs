//! The published runtime snapshot and its typed gameflow phase.

use scout_client_core::backend::BackendError;
use scout_client_core::live::champ_select::ChampSelectSnapshot;
use scout_client_core::live::game_settings::GameWindowMode;
use scout_client_core::live::snapshot::LiveSnapshot;
use scout_client_core::settings::PrivacySettings;
use tokio::sync::watch;

pub use scout_client_core::live::gameflow::GameflowPhase;

fn phase_of(snapshot: &RuntimeState) -> GameflowPhase {
    snapshot
        .gameflow_phase
        .as_deref()
        .map_or(GameflowPhase::Disconnected, GameflowPhase::from_label)
}

/// The two watch channels the collector publishes through.
pub(super) struct StateHub {
    snapshot: watch::Sender<RuntimeState>,
    phase: watch::Sender<GameflowPhase>,
}

impl Default for StateHub {
    fn default() -> Self {
        Self {
            snapshot: watch::channel(RuntimeState::default()).0,
            phase: watch::channel(GameflowPhase::default()).0,
        }
    }
}

impl StateHub {
    pub(super) fn subscribe(&self) -> watch::Receiver<RuntimeState> {
        self.snapshot.subscribe()
    }

    pub(super) fn subscribe_phase(&self) -> watch::Receiver<GameflowPhase> {
        self.phase.subscribe()
    }

    pub(super) fn current_phase(&self) -> GameflowPhase {
        self.phase.borrow().clone()
    }
}

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
    /// The user's error-report and usage-data switches.
    pub privacy: PrivacySettings,
    /// Human-readable pairing state.
    pub pairing_status: Option<String>,
    /// Browser approval URL while pairing is pending.
    pub approval_url: Option<String>,
    /// The code the approval page shows beside the pending pairing request.
    pub pairing_match_code: Option<String>,
    /// Pending durable observations.
    pub pending_observations: usize,
    /// Last successful upload time.
    pub last_upload_at: Option<String>,
    /// Last typed boundary error.
    pub last_error: Option<String>,
    /// The oldest build Scout accepts, while it refuses this one as too old.
    /// Observations stay queued until an upgraded build checks in.
    pub upgrade_required: Option<String>,
    /// The allowlisted live game state while a game is in progress and
    /// serving data.
    pub live_game: Option<LiveSnapshot>,
    /// What the champion-select screen shows, while gameflow is in champion
    /// select. It has no summoner or Riot identity.
    pub champ_select: Option<ChampSelectSnapshot>,
    /// The window mode the game will start in, read while gameflow is in
    /// champion select so Scout can warn that exclusive fullscreen hides the
    /// in-game overlay. None outside champion select.
    pub game_window_mode: Option<GameWindowMode>,
    last_runtime_error: Option<String>,
    last_replay_error: Option<String>,
}

/// Publish whether the backend refused this build as too old.
///
/// A success clears the requirement; any other failure leaves it as it was,
/// since an outage says nothing about the running build.
pub(super) fn observe_upgrade_requirement<T>(state: &StateHub, outcome: &Result<T, BackendError>) {
    let upgrade_required = match outcome {
        Ok(_) => None,
        Err(error) => match error.upgrade_required() {
            Some(refusal) => Some(refusal.minimum_version.clone()),
            None => return,
        },
    };
    update_state(state, |snapshot| {
        snapshot.upgrade_required = upgrade_required;
    });
}

pub(super) fn set_error(state: &StateHub, message: String) {
    update_state(state, |snapshot| set_runtime_error(snapshot, message));
}

pub(super) fn set_runtime_error(snapshot: &mut RuntimeState, message: String) {
    snapshot.last_runtime_error = Some(message);
    synchronize_last_error(snapshot);
}

pub(super) fn set_replay_error(state: &StateHub, message: String) {
    update_state(state, |snapshot| {
        snapshot.last_replay_error = Some(message);
        synchronize_last_error(snapshot);
    });
}

pub(super) fn clear_runtime_error(snapshot: &mut RuntimeState) {
    snapshot.last_runtime_error = None;
    synchronize_last_error(snapshot);
}

pub(super) fn clear_replay_error(snapshot: &mut RuntimeState) {
    snapshot.last_replay_error = None;
    synchronize_last_error(snapshot);
}

pub(super) fn synchronize_last_error(snapshot: &mut RuntimeState) {
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

pub(super) fn update_state(state: &StateHub, update: impl FnOnce(&mut RuntimeState)) {
    state.snapshot.send_modify(|snapshot| {
        update(snapshot);
        let next = phase_of(snapshot);
        state.phase.send_if_modified(|current| {
            if *current == next {
                return false;
            }
            *current = next;
            true
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_collection_success_does_not_clear_a_replay_error() {
        let state = StateHub::default();
        let receiver = state.subscribe();
        set_replay_error(&state, "relay unavailable".to_owned());
        set_error(&state, "League unavailable".to_owned());

        update_state(&state, clear_runtime_error);
        assert_eq!(
            receiver.borrow().last_error.as_deref(),
            Some("Replay capture: relay unavailable")
        );

        update_state(&state, clear_replay_error);
        assert!(receiver.borrow().last_error.is_none());
    }

    fn upgrade_refusal() -> BackendError {
        BackendError::UpgradeRequired(scout_client_core::protocol::ClientUpgradeRequired {
            error: scout_client_core::protocol::CLIENT_UPGRADE_REQUIRED_ERROR.to_owned(),
            minimum_version: "0.2.0".to_owned(),
        })
    }

    #[test]
    fn an_upgrade_refusal_stays_in_the_status_until_a_request_succeeds() {
        let state = StateHub::default();
        let receiver = state.subscribe();
        observe_upgrade_requirement::<()>(&state, &Err(upgrade_refusal()));
        assert_eq!(receiver.borrow().upgrade_required.as_deref(), Some("0.2.0"));

        // An outage says nothing about the build, so the requirement stays.
        observe_upgrade_requirement::<()>(&state, &Err(BackendError::CheckInReceipt));
        assert_eq!(receiver.borrow().upgrade_required.as_deref(), Some("0.2.0"));

        observe_upgrade_requirement(&state, &Ok(()));
        assert!(receiver.borrow().upgrade_required.is_none());
    }

    #[test]
    fn the_gameflow_phase_watch_follows_the_snapshot() {
        let state = StateHub::default();
        let phase = state.subscribe_phase();
        assert_eq!(*phase.borrow(), GameflowPhase::Disconnected);

        update_state(&state, |snapshot| {
            snapshot.gameflow_phase = Some("ChampSelect".to_owned());
        });
        assert_eq!(*phase.borrow(), GameflowPhase::ChampSelect);

        update_state(&state, |snapshot| {
            snapshot.gameflow_phase = Some("SomethingNew".to_owned());
        });
        assert_eq!(
            *phase.borrow(),
            GameflowPhase::Unrecognized("SomethingNew".to_owned())
        );

        update_state(&state, |snapshot| snapshot.gameflow_phase = None);
        assert_eq!(*phase.borrow(), GameflowPhase::Disconnected);
    }

    #[test]
    fn an_unchanged_phase_does_not_wake_phase_subscribers() {
        let state = StateHub::default();
        let mut phase = state.subscribe_phase();
        update_state(&state, |snapshot| snapshot.pending_observations = 3);
        assert!(matches!(phase.has_changed(), Ok(false)));
        update_state(&state, |snapshot| {
            snapshot.gameflow_phase = Some("Lobby".to_owned());
        });
        assert!(matches!(phase.has_changed(), Ok(true)));
        phase.mark_unchanged();
        update_state(&state, |snapshot| snapshot.pending_observations = 4);
        assert!(matches!(phase.has_changed(), Ok(false)));
    }
}
