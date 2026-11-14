//! The published runtime snapshot and its typed gameflow phase.

use scout_client_core::settings::PrivacySettings;
use tokio::sync::watch;

/// Gameflow phase as the League client reports it, for subscribers that react
/// to phase changes (an overlay, a coach) and need nothing else.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum GameflowPhase {
    /// No signed-in League client is reachable.
    #[default]
    Disconnected,
    /// The client is open and idle.
    None,
    /// In a lobby.
    Lobby,
    /// Searching for a match.
    Matchmaking,
    /// Checked into a tournament.
    CheckedIntoTournament,
    /// A match was found and awaits acceptance.
    ReadyCheck,
    /// Champion select.
    ChampSelect,
    /// Loading into the game.
    GameStart,
    /// The game failed to launch.
    FailedToLaunch,
    /// In a game.
    InProgress,
    /// Reconnecting to a game.
    Reconnect,
    /// Waiting for end-of-game stats.
    WaitingForStats,
    /// Just before the end-of-game screen.
    PreEndOfGame,
    /// The end-of-game screen.
    EndOfGame,
    /// The game ended in error.
    TerminatedInError,
    /// A phase this build does not know, carried verbatim.
    Unrecognized(String),
}

impl GameflowPhase {
    fn from_label(label: &str) -> Self {
        match label {
            "None" => Self::None,
            "Lobby" => Self::Lobby,
            "Matchmaking" => Self::Matchmaking,
            "CheckedIntoTournament" => Self::CheckedIntoTournament,
            "ReadyCheck" => Self::ReadyCheck,
            "ChampSelect" => Self::ChampSelect,
            "GameStart" => Self::GameStart,
            "FailedToLaunch" => Self::FailedToLaunch,
            "InProgress" => Self::InProgress,
            "Reconnect" => Self::Reconnect,
            "WaitingForStats" => Self::WaitingForStats,
            "PreEndOfGame" => Self::PreEndOfGame,
            "EndOfGame" => Self::EndOfGame,
            "TerminatedInError" => Self::TerminatedInError,
            other => Self::Unrecognized(other.to_owned()),
        }
    }

    fn of(snapshot: &RuntimeState) -> Self {
        snapshot
            .gameflow_phase
            .as_deref()
            .map_or(Self::Disconnected, Self::from_label)
    }
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
    /// Pending durable observations.
    pub pending_observations: usize,
    /// Last successful upload time.
    pub last_upload_at: Option<String>,
    /// Last typed boundary error.
    pub last_error: Option<String>,
    last_runtime_error: Option<String>,
    last_replay_error: Option<String>,
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
        let next = GameflowPhase::of(snapshot);
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
