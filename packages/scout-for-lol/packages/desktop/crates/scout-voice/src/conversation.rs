//! Conversation mode follows League's gameflow.

use scout_client_core::live::gameflow::GameflowPhase;

/// Whether hands-free listening is on in `phase`: from the loading screen
/// (`GameStart`) until the game ends. Every other phase, including
/// `WaitingForStats`, `PreEndOfGame` and `EndOfGame`, closes it, and so does a
/// reconnect.
#[must_use]
pub fn conversation_open(phase: &GameflowPhase) -> bool {
    matches!(phase, GameflowPhase::GameStart | GameflowPhase::InProgress)
}

#[cfg(test)]
mod tests {
    use scout_client_core::live::gameflow::GameflowPhase;

    use super::conversation_open;

    #[test]
    fn only_a_game_loading_or_in_progress_opens_the_microphone() {
        let closed = [
            GameflowPhase::Disconnected,
            GameflowPhase::None,
            GameflowPhase::Lobby,
            GameflowPhase::Matchmaking,
            GameflowPhase::CheckedIntoTournament,
            GameflowPhase::ReadyCheck,
            GameflowPhase::ChampSelect,
            GameflowPhase::FailedToLaunch,
            GameflowPhase::Reconnect,
            GameflowPhase::WaitingForStats,
            GameflowPhase::PreEndOfGame,
            GameflowPhase::EndOfGame,
            GameflowPhase::TerminatedInError,
            GameflowPhase::Unrecognized("Practice".to_owned()),
        ];
        for phase in &closed {
            assert!(!conversation_open(phase), "{phase:?} opened the microphone");
        }
        assert!(conversation_open(&GameflowPhase::GameStart));
        assert!(conversation_open(&GameflowPhase::InProgress));
    }

    #[test]
    fn a_game_opens_then_closes_it() {
        let phases = [
            "ChampSelect",
            "GameStart",
            "InProgress",
            "WaitingForStats",
            "EndOfGame",
        ];
        let open: Vec<bool> = phases
            .iter()
            .map(|label| conversation_open(&GameflowPhase::from_label(label)))
            .collect();
        assert_eq!(open, [false, true, true, false, false]);
    }
}
