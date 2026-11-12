//! Messages between the Scout Client supervisor and its window process.
//!
//! The supervisor owns collection and never touches the GPU. It runs the
//! window as a child process and talks to it over the child's stdio: one JSON
//! object per line, tagged by `type`. The supervisor writes
//! [`SupervisorMessage`]s to the child's stdin; the window writes
//! [`WindowMessage`]s to its stdout.
//!
//! Each side opens with `hello`, carrying [`PROTOCOL_VERSION`]. Both processes
//! are the same executable, so a mismatch means the binary on disk changed
//! under a running supervisor (an update), not a peer to negotiate with.
//!
//! Decoding is strict. An unknown `type`, a missing field, or an unknown field
//! on a message that carries fields is an error, because the two ends are built
//! together and a message neither understands is a broken contract rather than
//! something to skip. (serde ignores extra keys on a field-less message such as
//! `quit`; the `type` alone decides it.)

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// The version both ends must announce in their `hello`.
pub const PROTOCOL_VERSION: u32 = 1;

/// A message from the supervisor to the window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum SupervisorMessage {
    /// The first message on every connection.
    Hello {
        /// The supervisor's [`PROTOCOL_VERSION`].
        protocol: u32,
        /// Whether a tray icon can reopen the window. Without one, closing the
        /// window quits Scout, since nothing else could bring it back.
        tray_available: bool,
    },
    /// The latest runtime snapshot.
    State {
        /// What the window renders.
        state: StateSnapshot,
    },
    /// The typed gameflow phase, sent when it changes.
    Phase {
        /// The current phase.
        phase: GameflowPhase,
    },
    /// The shareable diagnostics bundle, in answer to
    /// [`WindowMessage::RequestDiagnostics`].
    DiagnosticsBundle {
        /// Allow-listed counters and events, as JSONL.
        text: String,
    },
    /// Bring the window to the front (the tray's "Open" while it is running).
    Show,
    /// Scout is quitting: close the window and exit.
    Close,
}

/// A message from the window to the supervisor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum WindowMessage {
    /// The first message on every connection.
    Hello {
        /// The window's [`PROTOCOL_VERSION`].
        protocol: u32,
    },
    /// Begin browser pairing.
    Pair,
    /// Delete the local credential and stop uploading.
    Disconnect,
    /// Open a web page in the default browser.
    OpenUrl {
        /// An `http` or `https` URL; the supervisor refuses anything else.
        url: String,
    },
    /// Open the diagnostics log folder.
    OpenLogFolder,
    /// Ask for [`SupervisorMessage::DiagnosticsBundle`].
    RequestDiagnostics,
    /// Change the start-at-login registration.
    SetStartAtLogin {
        /// Whether Scout Client starts at login.
        enabled: bool,
    },
    /// The user quit Scout: stop collection and the window.
    Quit,
}

/// The runtime snapshot as the window renders it. It holds no bearer, LCU
/// credential, PUUID, or raw payload.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StateSnapshot {
    /// Whether a League lockfile is currently reachable.
    pub league_connected: bool,
    /// Gameflow phase label as League reports it.
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
    pub pending_observations: u64,
    /// Last successful upload time.
    pub last_upload_at: Option<String>,
    /// Last typed boundary error.
    pub last_error: Option<String>,
    /// What the Diagnostics page shows.
    pub diagnostics: DiagnosticsSnapshot,
}

/// The Diagnostics page's view of the supervisor's diagnostics.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DiagnosticsSnapshot {
    /// Whether the JSONL log folder exists, so "Open log folder" can work.
    pub log_folder_available: bool,
    /// Every counter and its value.
    pub counters: Vec<CounterReading>,
    /// The most recent event summaries, newest first.
    pub recent_events: Vec<String>,
}

/// A diagnostics counter and its value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CounterReading {
    /// The counter name.
    pub name: String,
    /// Its value.
    pub value: u64,
}

/// The gameflow phase, mirroring the runtime's typed phase.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
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

/// Why a line could not be encoded or decoded.
#[derive(Debug, thiserror::Error)]
pub enum CodecError {
    /// The line is not a message this protocol defines.
    #[error("invalid Scout desktop IPC message: {0}")]
    Invalid(#[from] serde_json::Error),
}

/// The peer announced a different [`PROTOCOL_VERSION`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("Scout desktop IPC protocol mismatch: this side speaks {ours}, the peer speaks {theirs}")]
pub struct ProtocolMismatch {
    /// This side's version.
    pub ours: u32,
    /// The peer's version.
    pub theirs: u32,
}

/// Check a peer's `hello` version against [`PROTOCOL_VERSION`].
///
/// # Errors
/// [`ProtocolMismatch`] when the versions differ.
pub fn check_protocol(theirs: u32) -> Result<(), ProtocolMismatch> {
    if theirs == PROTOCOL_VERSION {
        Ok(())
    } else {
        Err(ProtocolMismatch {
            ours: PROTOCOL_VERSION,
            theirs,
        })
    }
}

/// Encode a message as one line, newline included.
///
/// # Errors
/// [`CodecError`] when the message cannot be serialized.
pub fn encode_line<T: Serialize>(message: &T) -> Result<String, CodecError> {
    let mut line = serde_json::to_string(message)?;
    line.push('\n');
    Ok(line)
}

/// Decode one line. A trailing newline (or `\r\n`) is ignored.
///
/// # Errors
/// [`CodecError`] when the line is not exactly one known message.
pub fn decode_line<T: DeserializeOwned>(line: &str) -> Result<T, CodecError> {
    Ok(serde_json::from_str(line.trim_end_matches(['\n', '\r']))?)
}

#[cfg(test)]
mod tests {
    use super::{
        CounterReading, DiagnosticsSnapshot, GameflowPhase, PROTOCOL_VERSION, StateSnapshot,
        SupervisorMessage, WindowMessage, check_protocol, decode_line, encode_line,
    };

    fn sample_state() -> StateSnapshot {
        StateSnapshot {
            league_connected: true,
            gameflow_phase: Some("ChampSelect".to_owned()),
            account_label: Some("Scout#NA1".to_owned()),
            paired: true,
            start_at_login: false,
            pairing_status: None,
            approval_url: Some("https://beta.scout-for-lol.com/pair/abc".to_owned()),
            pending_observations: 4,
            last_upload_at: Some("2026-11-11T10:00:00Z".to_owned()),
            last_error: Some("League unavailable\nReplay capture: relay".to_owned()),
            diagnostics: DiagnosticsSnapshot {
                log_folder_available: true,
                counters: vec![CounterReading {
                    name: "observations_uploaded".to_owned(),
                    value: 12,
                }],
                recent_events: vec!["info runtime start ok".to_owned()],
            },
        }
    }

    #[test]
    fn every_supervisor_message_round_trips_as_one_line() -> Result<(), super::CodecError> {
        let messages = [
            SupervisorMessage::Hello {
                protocol: PROTOCOL_VERSION,
                tray_available: true,
            },
            SupervisorMessage::State {
                state: sample_state(),
            },
            SupervisorMessage::Phase {
                phase: GameflowPhase::ChampSelect,
            },
            SupervisorMessage::Phase {
                phase: GameflowPhase::Unrecognized("SomethingNew".to_owned()),
            },
            SupervisorMessage::DiagnosticsBundle {
                text: "# observations_uploaded 12\n{\"level\":\"info\"}\n".to_owned(),
            },
            SupervisorMessage::Show,
            SupervisorMessage::Close,
        ];
        for message in messages {
            let line = encode_line(&message)?;
            assert!(line.ends_with('\n'));
            assert_eq!(line.matches('\n').count(), 1, "one message per line");
            assert_eq!(decode_line::<SupervisorMessage>(&line)?, message);
        }
        Ok(())
    }

    #[test]
    fn every_window_message_round_trips_as_one_line() -> Result<(), super::CodecError> {
        let messages = [
            WindowMessage::Hello {
                protocol: PROTOCOL_VERSION,
            },
            WindowMessage::Pair,
            WindowMessage::Disconnect,
            WindowMessage::OpenUrl {
                url: "https://beta.scout-for-lol.com/pair/abc".to_owned(),
            },
            WindowMessage::OpenLogFolder,
            WindowMessage::RequestDiagnostics,
            WindowMessage::SetStartAtLogin { enabled: true },
            WindowMessage::Quit,
        ];
        for message in messages {
            let line = encode_line(&message)?;
            assert_eq!(line.matches('\n').count(), 1, "one message per line");
            assert_eq!(decode_line::<WindowMessage>(&line)?, message);
        }
        Ok(())
    }

    #[test]
    fn the_wire_shape_is_tagged_by_type() -> Result<(), super::CodecError> {
        assert_eq!(
            encode_line(&WindowMessage::SetStartAtLogin { enabled: false })?,
            "{\"type\":\"set_start_at_login\",\"enabled\":false}\n"
        );
        assert_eq!(
            encode_line(&SupervisorMessage::Phase {
                phase: GameflowPhase::InProgress
            })?,
            "{\"type\":\"phase\",\"phase\":\"in_progress\"}\n"
        );
        assert_eq!(
            decode_line::<WindowMessage>("{\"type\":\"quit\"}\r\n")?,
            WindowMessage::Quit
        );
        Ok(())
    }

    #[test]
    fn unknown_message_types_are_rejected() {
        assert!(decode_line::<WindowMessage>("{\"type\":\"format_disk\"}").is_err());
        assert!(decode_line::<SupervisorMessage>("{\"type\":\"pair\"}").is_err());
        assert!(decode_line::<WindowMessage>("{\"type\":\"show\"}").is_err());
        assert!(decode_line::<WindowMessage>("{\"kind\":\"quit\"}").is_err());
    }

    #[test]
    fn unknown_or_missing_fields_are_rejected() {
        assert!(
            decode_line::<WindowMessage>(
                "{\"type\":\"set_start_at_login\",\"enabled\":true,\"x\":1}"
            )
            .is_err()
        );
        assert!(decode_line::<WindowMessage>("{\"type\":\"set_start_at_login\"}").is_err());
        assert!(decode_line::<SupervisorMessage>("{\"type\":\"hello\",\"protocol\":1}").is_err());
        assert!(
            decode_line::<SupervisorMessage>(
                "{\"type\":\"phase\",\"phase\":\"champ_select\",\"since\":3}"
            )
            .is_err()
        );
    }

    #[test]
    fn malformed_lines_are_rejected() {
        assert!(decode_line::<WindowMessage>("").is_err());
        assert!(decode_line::<WindowMessage>("not json").is_err());
        assert!(decode_line::<WindowMessage>("{\"type\":\"pair\"}{\"type\":\"pair\"}").is_err());
    }

    #[test]
    fn the_handshake_accepts_only_this_version() {
        assert!(check_protocol(PROTOCOL_VERSION).is_ok());
        let mismatch = check_protocol(PROTOCOL_VERSION + 1);
        assert_eq!(
            mismatch.map_err(|error| error.theirs),
            Err(PROTOCOL_VERSION + 1)
        );
    }
}
