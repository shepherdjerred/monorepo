//! Typed projections of the League client's gameflow resources.

use serde::Deserialize;
use serde_json::Value;
use thiserror::Error;

/// Gameflow phase as the League client reports it.
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
    /// The phase named by one of the client's labels.
    #[must_use]
    pub fn from_label(label: &str) -> Self {
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

    /// Whether live game data is available: only while a game is in progress.
    #[must_use]
    pub fn is_in_progress(&self) -> bool {
        matches!(self, Self::InProgress)
    }
}

/// A gameflow payload that is not shaped as documented.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum GameflowError {
    /// The phase resource was not a JSON string.
    #[error("the gameflow phase was not a string")]
    PhaseNotAString,
    /// The session did not decode.
    #[error("the gameflow session was malformed: {0}")]
    Session(String),
}

/// The phase resource: a bare JSON string.
///
/// # Errors
///
/// [`GameflowError::PhaseNotAString`] for any other JSON.
pub fn parse_phase(value: &Value) -> Result<GameflowPhase, GameflowError> {
    value
        .as_str()
        .map(GameflowPhase::from_label)
        .ok_or(GameflowError::PhaseNotAString)
}

/// What Scout reads of the gameflow session: the phase and the queue, never
/// the teams, summoner names or IDs the session also carries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GameflowSession {
    /// The phase.
    pub phase: GameflowPhase,
    /// The queue's ID.
    pub queue_id: Option<i64>,
    /// The mode, such as `CLASSIC`.
    pub game_mode: Option<String>,
    /// The map's ID.
    pub map_id: Option<i64>,
}

#[derive(Deserialize)]
struct RawSession {
    phase: String,
    #[serde(rename = "gameData", default)]
    game_data: Option<RawGameData>,
    #[serde(default)]
    map: Option<RawMap>,
}

#[derive(Deserialize)]
struct RawGameData {
    #[serde(default)]
    queue: Option<RawQueue>,
}

#[derive(Deserialize)]
struct RawQueue {
    id: Option<i64>,
}

#[derive(Deserialize)]
struct RawMap {
    id: Option<i64>,
    #[serde(rename = "gameMode")]
    game_mode: Option<String>,
}

/// Project `/lol-gameflow/v1/session`.
///
/// # Errors
///
/// [`GameflowError::Session`] when the payload has no string `phase`.
pub fn parse_session(value: &Value) -> Result<GameflowSession, GameflowError> {
    let raw: RawSession = serde_json::from_value(value.clone())
        .map_err(|error| GameflowError::Session(error.to_string()))?;
    Ok(GameflowSession {
        phase: GameflowPhase::from_label(&raw.phase),
        queue_id: raw
            .game_data
            .and_then(|data| data.queue)
            .and_then(|queue| queue.id),
        game_mode: raw.map.as_ref().and_then(|map| map.game_mode.clone()),
        map_id: raw.map.and_then(|map| map.id),
    })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{GameflowError, GameflowPhase, parse_phase, parse_session};

    #[test]
    fn labels_map_to_phases_and_unknown_ones_are_carried() {
        assert_eq!(
            GameflowPhase::from_label("InProgress"),
            GameflowPhase::InProgress
        );
        assert!(GameflowPhase::InProgress.is_in_progress());
        assert!(!GameflowPhase::Reconnect.is_in_progress());
        assert_eq!(
            GameflowPhase::from_label("Brand New"),
            GameflowPhase::Unrecognized("Brand New".to_owned())
        );
    }

    #[test]
    fn the_phase_resource_is_a_string() {
        assert_eq!(parse_phase(&json!("Lobby")), Ok(GameflowPhase::Lobby));
        assert_eq!(
            parse_phase(&json!({"phase": "Lobby"})),
            Err(GameflowError::PhaseNotAString)
        );
    }

    #[test]
    fn the_session_keeps_phase_and_queue_and_nothing_identifying() {
        let session = parse_session(&json!({
            "phase": "InProgress",
            "gameData": {
                "queue": {"id": 420, "gameMode": "CLASSIC"},
                "teamOne": [{"summonerName": "Someone", "puuid": "secret"}]
            },
            "map": {"id": 11, "gameMode": "CLASSIC"}
        }));
        assert_eq!(
            session.map(|session| (
                session.phase,
                session.queue_id,
                session.game_mode,
                session.map_id
            )),
            Ok((
                GameflowPhase::InProgress,
                Some(420),
                Some("CLASSIC".to_owned()),
                Some(11)
            ))
        );
        assert!(matches!(
            parse_session(&json!({"gameData": {}})),
            Err(GameflowError::Session(_))
        ));
    }
}
