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

use std::collections::BTreeMap;

mod chat;
mod chat_visuals;
mod voice;

pub use chat::{
    ChatAttachment, ChatAvailability, ChatCoach, ChatCoachKind, ChatCoachOption, ChatCommand,
    ChatComposer, ChatConversation, ChatDraft, ChatDraftState, ChatMessage, ChatModelOption,
    ChatParts, ChatRole, ChatStatus, ChatToolStatus, ChatToolStep, ChatTranscript, ChatTurn,
    ChatVersion,
};
pub use chat_visuals::{
    ChatIcon, ChatImage, ChatLoadoutCard, ChatMatchCard, ChatMatchPlayer, ChatMatchTeam, ChatTable,
    ChatTableLayout, ChatVisual, ChatVisuals,
};
pub use voice::{
    VoiceCommand, VoiceConsent, VoiceSettings, VoiceSnapshot, VoiceState, VoiceTurnView,
};

/// The version both ends must announce in their `hello`.
pub const PROTOCOL_VERSION: u32 = 11;

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
    /// Where the self-update stands, sent when it changes.
    Update {
        /// What the window shows.
        update: UpdateSnapshot,
    },
    /// Whether chat works, and the connection and notice lines.
    ChatStatus {
        /// The chat status.
        status: ChatStatus,
    },
    /// The owner's conversations, most recent first.
    ChatConversations {
        /// The sidebar list.
        conversations: Vec<ChatConversation>,
    },
    /// The open conversation's branch, or none for a blank conversation.
    ChatTranscript {
        /// The transcript.
        transcript: Option<ChatTranscript>,
    },
    /// The in-flight turn, or none when nothing is running.
    ChatTurn {
        /// The turn.
        turn: Option<ChatTurn>,
    },
    /// Where each picture the transcript names stands, by key.
    ChatImages {
        /// The pictures.
        images: BTreeMap<String, ChatImage>,
    },
    /// The composer's images and model choice.
    ChatComposer {
        /// The composer.
        composer: ChatComposer,
    },
    /// The coach panel, or none when it is not showing.
    ChatCoach {
        /// The panel.
        coach: Option<ChatCoach>,
    },
    /// The local player's live game, or none when no game is in progress.
    /// Sent when it changes.
    LiveGame {
        /// The allowlisted summary.
        live: Option<LiveGameSnapshot>,
    },
    /// Where the microphone is, and the voice settings. Sent when it changes.
    Voice {
        /// What the window shows.
        voice: VoiceSnapshot,
    },
    /// The spoken turn, or none before the first one. Sent when it changes.
    VoiceTurn {
        /// What Scout heard and answered.
        turn: Option<VoiceTurnView>,
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
    /// A chat request, answered with chat parts.
    Chat {
        /// What to do.
        command: ChatCommand,
    },
    /// Change the start-at-login registration.
    SetStartAtLogin {
        /// Whether Scout Client starts at login.
        enabled: bool,
    },
    /// A voice choice: consent, mute, or settings.
    Voice {
        /// What the player chose.
        command: VoiceCommand,
    },
    /// Change the two privacy switches. Both are sent together so the
    /// supervisor never has to merge a half-known state.
    SetPrivacy {
        /// Whether crash and error reports may be sent.
        send_error_reports: bool,
        /// Whether product events may be sent.
        send_usage_data: bool,
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
    /// The user's two privacy switches.
    pub privacy: PrivacySnapshot,
    /// Human-readable pairing state.
    pub pairing_status: Option<String>,
    /// Browser approval URL while pairing is pending.
    pub approval_url: Option<String>,
    /// The code the approval page shows beside this pairing request.
    pub pairing_match_code: Option<String>,
    /// Pending durable observations.
    pub pending_observations: u64,
    /// Last successful upload time.
    pub last_upload_at: Option<String>,
    /// Last typed boundary error.
    pub last_error: Option<String>,
    /// What the Diagnostics page shows.
    pub diagnostics: DiagnosticsSnapshot,
}

/// The window's view of the game in progress: the local player's line and the
/// clock. It carries only what the allowlisted live snapshot keeps, so no
/// Riot ID, summoner name or skin can reach the window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LiveGameSnapshot {
    /// Whole seconds on the game clock.
    pub game_time_secs: u32,
    /// The local player's champion.
    pub champion: String,
    /// The local player's level.
    pub level: u8,
    /// Kills.
    pub kills: u32,
    /// Deaths.
    pub deaths: u32,
    /// Assists.
    pub assists: u32,
    /// Creep score.
    pub creep_score: u32,
}

impl LiveGameSnapshot {
    /// The one line the Overview page shows, such as
    /// "Ahri, level 10, 4/2/7, 42 CS, 7:01".
    #[must_use]
    pub fn summary(&self) -> String {
        format!(
            "{}, level {}, {}/{}/{}, {} CS, {}:{:02}",
            self.champion,
            self.level,
            self.kills,
            self.deaths,
            self.assists,
            self.creep_score,
            self.game_time_secs / 60,
            self.game_time_secs % 60
        )
    }
}

/// Where an update stands.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateStatus {
    /// This build does not update itself (a development build, or a platform
    /// without an installer the updater can run).
    #[default]
    Disabled,
    /// Waiting for the next check.
    Idle,
    /// Asking the release channel for a newer version.
    Checking,
    /// The build is current.
    UpToDate,
    /// A newer version is downloading.
    Downloading,
    /// A newer version is verified and waits for a quit or an idle moment.
    Ready,
    /// The last check or download failed; the cause is in the diagnostics.
    Failed,
}

/// The window's view of the updater. It carries no URL, path or free text.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UpdateSnapshot {
    /// Where the update stands.
    pub status: UpdateStatus,
    /// The version being downloaded or waiting to install.
    pub version: Option<String>,
    /// Whether this build is below the channel's minimum version.
    pub required: bool,
}

impl UpdateSnapshot {
    /// The one line both windows show.
    #[must_use]
    pub fn summary(&self) -> String {
        let version = self.version.as_deref().unwrap_or("a newer version");
        match self.status {
            UpdateStatus::Disabled => "Not available in this build".to_owned(),
            UpdateStatus::Idle => "Waiting for the next check".to_owned(),
            UpdateStatus::Checking => "Checking for updates".to_owned(),
            UpdateStatus::UpToDate => "Up to date".to_owned(),
            UpdateStatus::Downloading => format!("Downloading {version}"),
            UpdateStatus::Ready if self.required => {
                format!("{version} is required and installs when no game is running")
            }
            UpdateStatus::Ready => format!("{version} installs when you quit Scout"),
            UpdateStatus::Failed => "The last update check failed".to_owned(),
        }
    }
}

/// The two opt-out switches. The window uses `send_error_reports` to open or
/// close its own error reporter, so an opt-out reaches both processes.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PrivacySnapshot {
    /// Whether crash and error reports may be sent.
    pub send_error_reports: bool,
    /// Whether product events may be sent.
    pub send_usage_data: bool,
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
    use uuid::Uuid;

    use super::{
        ChatAttachment, ChatAvailability, ChatCoach, ChatCoachKind, ChatCoachOption, ChatCommand,
        ChatComposer, ChatConversation, ChatDraft, ChatDraftState, ChatImage, ChatMessage,
        ChatModelOption, ChatRole, ChatStatus, ChatToolStatus, ChatToolStep, ChatTranscript,
        ChatTurn, ChatVersion, ChatVisual, ChatVisuals, CounterReading, DiagnosticsSnapshot,
        GameflowPhase, LiveGameSnapshot, PROTOCOL_VERSION, PrivacySnapshot, StateSnapshot,
        SupervisorMessage, UpdateSnapshot, UpdateStatus, VoiceCommand, VoiceConsent, VoiceSettings,
        VoiceSnapshot, VoiceState, VoiceTurnView, WindowMessage, check_protocol, decode_line,
        encode_line,
    };

    fn voice_settings() -> VoiceSettings {
        VoiceSettings {
            conversation_mode: true,
            push_to_talk: true,
            push_to_talk_key: "F8".to_owned(),
            mute_key: "Shift+F8".to_owned(),
        }
    }

    const CONVERSATION: Uuid = Uuid::from_u128(0x0b5e_4a1c_7f00_4e5a_9c1d_2f3e_4a5b_6c7d);

    fn chat_messages() -> Vec<SupervisorMessage> {
        let step = ChatToolStep {
            summary: "Ran a Scout report query.".to_owned(),
            status: ChatToolStatus::Succeeded,
            duration_ms: Some(1_240),
        };
        vec![
            SupervisorMessage::ChatStatus {
                status: ChatStatus::default(),
            },
            SupervisorMessage::ChatStatus {
                status: ChatStatus {
                    availability: ChatAvailability::Unavailable {
                        message: "Scout is unreachable.".to_owned(),
                    },
                    open_conversation: Some(CONVERSATION),
                    reconnecting: true,
                    notice: Some("That question is too long.".to_owned()),
                },
            },
            SupervisorMessage::ChatConversations {
                conversations: vec![ChatConversation {
                    id: CONVERSATION,
                    title: "Jinx win rate".to_owned(),
                }],
            },
            SupervisorMessage::ChatTranscript {
                transcript: Some(ChatTranscript {
                    conversation_id: CONVERSATION,
                    title: "Jinx win rate".to_owned(),
                    messages: vec![ChatMessage {
                        id: CONVERSATION,
                        role: ChatRole::Assistant,
                        content: "**54%** over 40 games.\n\n| a | b |".to_owned(),
                        tools: vec![step.clone()],
                        caveats: vec!["Ranked solo only.".to_owned()],
                        coach_options: vec![ChatCoachOption {
                            label: "Ornn".to_owned(),
                            rationale: "Adds the frontline your team lacks.".to_owned(),
                        }],
                        visuals: ChatVisuals {
                            visual: Some(ChatVisual::Chart {
                                image: "chart:a:b".to_owned(),
                                label: "Bar chart: Jinx win rate".to_owned(),
                                description: "Week 1: 54%".to_owned(),
                            }),
                            match_cards: Vec::new(),
                            loadout_cards: Vec::new(),
                        },
                        version: Some(ChatVersion {
                            position: 2,
                            count: 3,
                            previous: Some(Uuid::from_u128(1)),
                            next: Some(Uuid::from_u128(3)),
                        }),
                        attachments: vec![ChatAttachment {
                            id: Uuid::from_u128(9),
                            media_type: "image/png".to_owned(),
                            thumbnail: Some("/tmp/scout/build.png".to_owned()),
                        }],
                    }],
                    web_url: "https://scout-for-lol.com/app/explore/abc".to_owned(),
                    share_url: Some("https://scout-for-lol.com/app/explore/s/abc".to_owned()),
                }),
            },
            SupervisorMessage::ChatTranscript { transcript: None },
            SupervisorMessage::ChatTurn {
                turn: Some(ChatTurn {
                    stoppable: true,
                    question: Some("How is my Jinx?".to_owned()),
                    attachments: Vec::new(),
                    answer: Some("Your Jinx".to_owned()),
                    activity: Some("Running the query".to_owned()),
                    stopping: false,
                    tools: vec![ChatToolStep {
                        status: ChatToolStatus::Running,
                        duration_ms: None,
                        ..step
                    }],
                    error: None,
                }),
            },
            SupervisorMessage::ChatTurn { turn: None },
        ]
        .into_iter()
        .chain(chat_picture_and_composer_messages())
        .collect()
    }

    fn chat_picture_and_composer_messages() -> Vec<SupervisorMessage> {
        vec![
            SupervisorMessage::ChatImages {
                images: [
                    ("chart:a:b".to_owned(), ChatImage::Loading),
                    (
                        "https://ddragon.leagueoflegends.com/cdn/16.22.1/img/item/3031.png"
                            .to_owned(),
                        ChatImage::Failed {
                            message: "offline".to_owned(),
                        },
                    ),
                ]
                .into(),
            },
            SupervisorMessage::ChatCoach {
                coach: Some(ChatCoach {
                    kind: ChatCoachKind::ChampSelect,
                    message_id: Uuid::from_u128(9),
                }),
            },
            SupervisorMessage::ChatCoach { coach: None },
            SupervisorMessage::ChatComposer {
                composer: ChatComposer {
                    drafts: vec![
                        ChatDraft {
                            key: Uuid::from_u128(5),
                            name: "build.png".to_owned(),
                            thumbnail: "/tmp/scout/build.png".to_owned(),
                            state: ChatDraftState::Ready,
                        },
                        ChatDraft {
                            key: Uuid::from_u128(6),
                            name: "huge.png".to_owned(),
                            thumbnail: "/tmp/scout/huge.png".to_owned(),
                            state: ChatDraftState::Failed {
                                message: "Images can be at most 10 MiB.".to_owned(),
                            },
                        },
                    ],
                    max_images: 4,
                    switching: false,
                    models: vec![ChatModelOption {
                        id: "gpt-6-luna".to_owned(),
                        label: "GPT-6 Luna · High".to_owned(),
                    }],
                    model: Some("gpt-6-luna".to_owned()),
                },
            },
        ]
    }

    fn sample_state() -> StateSnapshot {
        StateSnapshot {
            league_connected: true,
            gameflow_phase: Some("ChampSelect".to_owned()),
            account_label: Some("Scout#NA1".to_owned()),
            paired: true,
            start_at_login: false,
            privacy: PrivacySnapshot {
                send_error_reports: true,
                send_usage_data: false,
            },
            pairing_status: None,
            approval_url: Some("https://beta.scout-for-lol.com/pair/abc".to_owned()),
            pairing_match_code: Some("K7Q-2M".to_owned()),
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
            SupervisorMessage::Update {
                update: UpdateSnapshot {
                    status: UpdateStatus::Ready,
                    version: Some("0.2.0".to_owned()),
                    required: false,
                },
            },
            SupervisorMessage::LiveGame { live: None },
            SupervisorMessage::LiveGame {
                live: Some(LiveGameSnapshot {
                    game_time_secs: 421,
                    champion: "Ahri".to_owned(),
                    level: 10,
                    kills: 4,
                    deaths: 2,
                    assists: 7,
                    creep_score: 87,
                }),
            },
            SupervisorMessage::Voice {
                voice: VoiceSnapshot::default(),
            },
            SupervisorMessage::Voice {
                voice: VoiceSnapshot {
                    state: VoiceState::Error,
                    consent: VoiceConsent::Accepted,
                    consent_requested: false,
                    muted: true,
                    settings: Some(voice_settings()),
                    detail: Some("No microphone is connected.".to_owned()),
                },
            },
            SupervisorMessage::VoiceTurn { turn: None },
            SupervisorMessage::VoiceTurn {
                turn: Some(VoiceTurnView {
                    heard: Some("What should I build next?".to_owned()),
                    answer: Some("Zhonya's Hourglass.".to_owned()),
                    error: None,
                }),
            },
            SupervisorMessage::Show,
            SupervisorMessage::Close,
        ]
        .into_iter()
        .chain(chat_messages());
        for message in messages {
            let line = encode_line(&message)?;
            assert!(line.ends_with('\n'));
            assert_eq!(line.matches('\n').count(), 1, "one message per line");
            assert_eq!(decode_line::<SupervisorMessage>(&line)?, message);
        }
        Ok(())
    }

    #[test]
    fn the_live_game_line_names_the_player_and_the_clock() {
        let live = LiveGameSnapshot {
            game_time_secs: 421,
            champion: "Ahri".to_owned(),
            level: 10,
            kills: 4,
            deaths: 2,
            assists: 7,
            creep_score: 87,
        };
        assert_eq!(live.summary(), "Ahri, level 10, 4/2/7, 87 CS, 7:01");
        assert_eq!(
            PROTOCOL_VERSION, 11,
            "a new message or field bumps the protocol"
        );
    }

    #[test]
    fn a_live_game_refuses_a_field_the_allowlist_does_not_name() {
        let line = r#"{"type":"live_game","live":{"game_time_secs":1,"champion":"Ahri","level":1,"kills":0,"deaths":0,"assists":0,"creep_score":0,"summoner_name":"x"}}"#;
        assert!(decode_line::<SupervisorMessage>(line).is_err());
    }

    #[test]
    fn the_update_line_says_what_will_happen() {
        let ready = UpdateSnapshot {
            status: UpdateStatus::Ready,
            version: Some("0.2.0".to_owned()),
            required: false,
        };
        assert_eq!(ready.summary(), "0.2.0 installs when you quit Scout");
        assert!(
            UpdateSnapshot {
                required: true,
                ..ready
            }
            .summary()
            .contains("required")
        );
        assert_eq!(
            UpdateSnapshot::default().summary(),
            "Not available in this build"
        );
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
            WindowMessage::Chat {
                command: ChatCommand::Refresh,
            },
            WindowMessage::Chat {
                command: ChatCommand::Open {
                    conversation_id: CONVERSATION,
                },
            },
            WindowMessage::Chat {
                command: ChatCommand::New,
            },
            WindowMessage::Chat {
                command: ChatCommand::Send {
                    question: "Line one\nline two".to_owned(),
                    live_game: true,
                },
            },
            WindowMessage::Chat {
                command: ChatCommand::Stop,
            },
            WindowMessage::Chat {
                command: ChatCommand::Edit {
                    message_id: CONVERSATION,
                    question: "Who carries in October?".to_owned(),
                },
            },
            WindowMessage::Chat {
                command: ChatCommand::Regenerate {
                    message_id: CONVERSATION,
                },
            },
            WindowMessage::Chat {
                command: ChatCommand::SwitchVersion {
                    message_id: CONVERSATION,
                },
            },
            WindowMessage::Chat {
                command: ChatCommand::Attach {
                    path: "/tmp/scout/build.png".to_owned(),
                },
            },
            WindowMessage::Chat {
                command: ChatCommand::RemoveAttachment { key: CONVERSATION },
            },
            WindowMessage::Chat {
                command: ChatCommand::Share,
            },
            WindowMessage::Chat {
                command: ChatCommand::RevokeShare,
            },
            WindowMessage::Chat {
                command: ChatCommand::ChooseModel {
                    model: Some("gpt-6.1-sol".to_owned()),
                },
            },
            WindowMessage::Chat {
                command: ChatCommand::ChooseModel { model: None },
            },
            WindowMessage::Voice {
                command: VoiceCommand::Consent { accepted: true },
            },
            WindowMessage::Voice {
                command: VoiceCommand::SetMuted { muted: true },
            },
            WindowMessage::Voice {
                command: VoiceCommand::SetSettings {
                    settings: voice_settings(),
                },
            },
            WindowMessage::SetStartAtLogin { enabled: true },
            WindowMessage::SetPrivacy {
                send_error_reports: false,
                send_usage_data: true,
            },
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
    fn the_chat_action_commands_have_a_fixed_wire_shape() -> Result<(), super::CodecError> {
        assert_eq!(
            encode_line(&WindowMessage::Chat {
                command: ChatCommand::SwitchVersion {
                    message_id: Uuid::nil()
                }
            })?,
            "{\"type\":\"chat\",\"command\":{\"action\":\"switch_version\",\"message_id\":\"00000000-0000-0000-0000-000000000000\"}}\n"
        );
        assert_eq!(
            encode_line(&WindowMessage::Chat {
                command: ChatCommand::Share
            })?,
            "{\"type\":\"chat\",\"command\":{\"action\":\"share\"}}\n"
        );
        Ok(())
    }

    #[test]
    fn chat_parts_have_a_fixed_wire_shape() -> Result<(), super::CodecError> {
        assert_eq!(
            encode_line(&WindowMessage::Chat {
                command: ChatCommand::Send {
                    question: "Hi".to_owned(),
                    live_game: false,
                }
            })?,
            "{\"type\":\"chat\",\"command\":{\"action\":\"send\",\"question\":\"Hi\",\"live_game\":false}}\n"
        );
        assert_eq!(
            encode_line(&SupervisorMessage::ChatStatus {
                status: ChatStatus {
                    availability: ChatAvailability::TurnedOff,
                    open_conversation: None,
                    reconnecting: false,
                    notice: None,
                }
            })?,
            "{\"type\":\"chat_status\",\"status\":{\"availability\":{\"state\":\"turned_off\"},\"open_conversation\":null,\"reconnecting\":false,\"notice\":null}}\n"
        );
        assert_eq!(
            encode_line(&SupervisorMessage::ChatTurn { turn: None })?,
            "{\"type\":\"chat_turn\",\"turn\":null}\n"
        );
        Ok(())
    }

    #[test]
    fn chat_parts_refuse_what_the_contract_does_not_name() {
        // An unknown command, a stray field, a malformed id and a missing
        // field all break the link.
        for line in [
            r#"{"type":"chat","command":{"action":"export"}}"#,
            r#"{"type":"chat","command":{"action":"send","question":"x","live_game":false,"model":"sol"}}"#,
            // The window never sends a game, only whether to attach one.
            r#"{"type":"chat","command":{"action":"send","question":"x","live_game":{"champion":"Ahri"}}}"#,
            r#"{"type":"chat","command":{"action":"send","question":"x"}}"#,
            r#"{"type":"chat","command":{"action":"open","conversation_id":"not-a-uuid"}}"#,
            r#"{"type":"chat","command":{"action":"send"}}"#,
        ] {
            assert!(decode_line::<WindowMessage>(line).is_err(), "{line}");
        }
        // An unknown availability or tool status, a raw payload, and a field
        // the sidebar does not carry are refused on the supervisor's side too.
        for line in [
            r#"{"type":"chat_status","status":{"availability":{"state":"maybe"},"open_conversation":null,"reconnecting":false,"notice":null}}"#,
            r#"{"type":"chat_turn","turn":{"stoppable":true,"question":null,"attachments":[],"answer":null,"activity":null,"stopping":false,"tools":[{"summary":"x","status":"paused","duration_ms":null}],"error":null}}"#,
            r#"{"type":"chat_turn","turn":{"stoppable":true,"question":null,"attachments":[],"answer":null,"activity":null,"stopping":false,"tools":[],"error":null,"raw":"{}"}}"#,
            r#"{"type":"chat_conversations","conversations":[{"id":"0b5e4a1c-7f00-4e5a-9c1d-2f3e4a5b6c7d","title":"x","origin":"web"}]}"#,
        ] {
            assert!(decode_line::<SupervisorMessage>(line).is_err(), "{line}");
        }
    }

    #[test]
    fn voice_messages_have_a_fixed_wire_shape_and_carry_no_audio() -> Result<(), super::CodecError>
    {
        assert_eq!(
            encode_line(&WindowMessage::Voice {
                command: VoiceCommand::SetMuted { muted: true }
            })?,
            "{\"type\":\"voice\",\"command\":{\"action\":\"set_muted\",\"muted\":true}}\n"
        );
        assert_eq!(
            encode_line(&SupervisorMessage::Voice {
                voice: VoiceSnapshot::default()
            })?,
            "{\"type\":\"voice\",\"voice\":{\"state\":\"off\",\"consent\":\"not_asked\",\"consent_requested\":false,\"muted\":false,\"settings\":null,\"detail\":null}}\n"
        );
        for line in [
            // An unknown state, a recording, and a stray settings field.
            r#"{"type":"voice","voice":{"state":"streaming","consent":"accepted","consent_requested":false,"muted":false,"settings":null,"detail":null}}"#,
            r#"{"type":"voice_turn","turn":{"heard":null,"answer":null,"error":null,"audio":"UklGRg=="}}"#,
        ] {
            assert!(decode_line::<SupervisorMessage>(line).is_err(), "{line}");
        }
        for line in [
            r#"{"type":"voice","command":{"action":"set_settings","settings":{"conversation_mode":true,"push_to_talk":true,"push_to_talk_key":"F8","mute_key":"F9","wake_word":"hey"}}}"#,
            r#"{"type":"voice","command":{"action":"record"}}"#,
            r#"{"type":"voice","command":{"action":"consent"}}"#,
        ] {
            assert!(decode_line::<WindowMessage>(line).is_err(), "{line}");
        }
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
