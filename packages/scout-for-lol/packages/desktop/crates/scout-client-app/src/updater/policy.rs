//! When the updater may check, and when it may install.

use std::time::Duration;

use scout_client_runtime::runtime::GameflowPhase;

/// Whether an installer may start in `phase`.
///
/// An allow-list, so a phase this build has never seen cannot install. Only
/// "no League client", an idle client, and a lobby that is not queueing
/// qualify; matchmaking, ready check, champion select, loading, a game, a
/// reconnect, and every end-of-game phase do not. Installing replaces the
/// executable and restarts collection, and nothing may do that while a game
/// is being observed or its result is still being reported.
#[must_use]
pub fn install_allowed(phase: &GameflowPhase) -> bool {
    matches!(
        phase,
        GameflowPhase::Disconnected | GameflowPhase::None | GameflowPhase::Lobby
    )
}

/// The updater's tunables. They are product behaviour, so they live here as
/// typed values rather than environment variables. The client cannot reach the
/// backend's Flags service, so a change is a release.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UpdateConfig {
    /// How long after start the first check waits, so it never competes with
    /// startup.
    pub first_check_delay: Duration,
    /// How often the channel is checked afterwards.
    pub check_interval: Duration,
    /// How long the window must stay closed, with no game phase in the way,
    /// before a downloaded update installs without waiting for a quit.
    pub idle_install_after: Duration,
}

impl UpdateConfig {
    /// The shipped configuration.
    pub const DEFAULT: Self = Self {
        first_check_delay: Duration::from_secs(30),
        check_interval: Duration::from_hours(6),
        idle_install_after: Duration::from_mins(10),
    };

    /// The shortest interval the channel is polled at.
    pub const MIN_CHECK_INTERVAL: Duration = Duration::from_mins(15);

    /// Refuse a configuration that would hammer the release bucket.
    ///
    /// # Errors
    ///
    /// A description of the rule it breaks.
    pub fn validate(self) -> Result<Self, &'static str> {
        if self.check_interval < Self::MIN_CHECK_INTERVAL {
            return Err("the update check interval is shorter than 15 minutes");
        }
        Ok(self)
    }
}

impl Default for UpdateConfig {
    fn default() -> Self {
        Self::DEFAULT
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use scout_client_runtime::runtime::GameflowPhase;

    use super::{UpdateConfig, install_allowed};

    #[test]
    fn nothing_installs_while_a_game_or_its_aftermath_is_live() {
        for phase in [
            GameflowPhase::Matchmaking,
            GameflowPhase::CheckedIntoTournament,
            GameflowPhase::ReadyCheck,
            GameflowPhase::ChampSelect,
            GameflowPhase::GameStart,
            GameflowPhase::FailedToLaunch,
            GameflowPhase::InProgress,
            GameflowPhase::Reconnect,
            GameflowPhase::WaitingForStats,
            GameflowPhase::PreEndOfGame,
            GameflowPhase::EndOfGame,
            GameflowPhase::TerminatedInError,
            GameflowPhase::Unrecognized("SomethingNew".to_owned()),
        ] {
            assert!(!install_allowed(&phase), "{phase:?}");
        }
    }

    #[test]
    fn an_idle_client_may_install() {
        for phase in [
            GameflowPhase::Disconnected,
            GameflowPhase::None,
            GameflowPhase::Lobby,
        ] {
            assert!(install_allowed(&phase), "{phase:?}");
        }
    }

    #[test]
    fn the_shipped_configuration_is_valid_and_checks_every_few_hours() {
        let config = UpdateConfig::DEFAULT;
        assert_eq!(config.validate(), Ok(config));
        assert!(config.check_interval >= Duration::from_hours(2));
        assert!(config.check_interval <= Duration::from_hours(12));
    }

    #[test]
    fn a_hot_polling_interval_is_refused() {
        let config = UpdateConfig {
            check_interval: Duration::from_secs(30),
            ..UpdateConfig::DEFAULT
        };
        assert!(config.validate().is_err());
    }
}
