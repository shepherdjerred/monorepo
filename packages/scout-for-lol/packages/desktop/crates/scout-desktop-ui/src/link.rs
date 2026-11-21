//! The window's end of the stdio link to the supervisor.
//!
//! The supervisor writes [`SupervisorMessage`]s to this process's stdin and
//! reads [`WindowMessage`]s from its stdout, one JSON object per line. Nothing
//! here knows about GPUI: the window feeds each incoming line to
//! [`WindowState::receive`] and renders the result.

use std::io::{BufRead, Write};
use std::sync::{Arc, Mutex, PoisonError};

use scout_desktop_ipc::{
    ChatParts, GameflowPhase, LiveGameSnapshot, PROTOCOL_VERSION, StateSnapshot, SupervisorMessage,
    UpdateSnapshot, VoiceSnapshot, VoiceTurnView, WindowMessage, check_protocol, decode_line,
    encode_line,
};

/// What the supervisor has told the window so far.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WindowState {
    /// Whether a tray can reopen the window; unknown until `hello`.
    pub tray_available: Option<bool>,
    /// The latest runtime snapshot.
    pub state: StateSnapshot,
    /// The latest gameflow phase.
    pub phase: GameflowPhase,
    /// Where the self-update stands.
    pub update: UpdateSnapshot,
    /// The game in progress, while there is one.
    pub live_game: Option<LiveGameSnapshot>,
    /// Explore chat, as the supervisor relays it.
    pub chat: ChatParts,
    /// Where the microphone is, and the voice settings.
    pub voice: VoiceSnapshot,
    /// The spoken turn, once there has been one.
    pub voice_turn: Option<VoiceTurnView>,
    /// Whether any snapshot has arrived, so a default snapshot is never
    /// mistaken for the user's privacy choice.
    pub state_received: bool,
}

/// What a message asks the window to do beyond re-rendering.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Effect {
    /// Only the rendered state changed.
    Render,
    /// Put the diagnostics bundle on the clipboard.
    CopyBundle(String),
    /// Bring the window to the front.
    Show,
    /// Show the chat page and bring the window to the front.
    ShowChat,
    /// Close the window: Scout is quitting.
    Close,
}

impl WindowState {
    /// Whether closing the window should quit Scout. Until the supervisor's
    /// `hello` says a tray exists, assume none, so closing never strands a
    /// user with no way back.
    #[must_use]
    pub fn tray_available(&self) -> bool {
        self.tray_available.unwrap_or(false)
    }

    /// Apply one line from the supervisor.
    ///
    /// # Errors
    /// A description when the line is not a message this protocol defines or
    /// the supervisor speaks another protocol version. Either breaks the link.
    pub fn receive(&mut self, line: &str) -> Result<Effect, String> {
        let message = decode_line::<SupervisorMessage>(line).map_err(|error| error.to_string())?;
        Ok(match message {
            SupervisorMessage::Hello {
                protocol,
                tray_available,
            } => {
                check_protocol(protocol).map_err(|mismatch| mismatch.to_string())?;
                self.tray_available = Some(tray_available);
                Effect::Render
            }
            SupervisorMessage::State { state } => {
                self.state = state;
                self.state_received = true;
                Effect::Render
            }
            SupervisorMessage::Phase { phase } => {
                self.phase = phase;
                Effect::Render
            }
            SupervisorMessage::Update { update } => {
                self.update = update;
                Effect::Render
            }
            SupervisorMessage::LiveGame { live } => {
                self.live_game = live;
                Effect::Render
            }
            SupervisorMessage::Voice { voice } => {
                self.voice = voice;
                Effect::Render
            }
            SupervisorMessage::VoiceTurn { turn } => {
                self.voice_turn = turn;
                Effect::Render
            }
            SupervisorMessage::DiagnosticsBundle { text } => Effect::CopyBundle(text),
            SupervisorMessage::Show => Effect::Show,
            SupervisorMessage::ShowChat => Effect::ShowChat,
            SupervisorMessage::Close => Effect::Close,
            chat @ (SupervisorMessage::ChatStatus { .. }
            | SupervisorMessage::ChatConversations { .. }
            | SupervisorMessage::ChatTranscript { .. }
            | SupervisorMessage::ChatTurn { .. }
            | SupervisorMessage::ChatImages { .. }
            | SupervisorMessage::ChatComposer { .. }
            | SupervisorMessage::ChatCoach { .. }) => {
                self.chat.receive(chat);
                Effect::Render
            }
        })
    }
}

/// An event from the supervisor's side of the link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Incoming {
    /// One line, newline removed.
    Line(String),
    /// stdin closed or failed: the supervisor quit or died.
    Closed(Option<String>),
}

/// Read `input` line by line on the calling thread, handing each to
/// `deliver`, until it ends or `deliver` returns `false`.
pub fn read_lines(input: impl BufRead, mut deliver: impl FnMut(Incoming) -> bool) {
    for line in input.lines() {
        let incoming = match line {
            Ok(line) => Incoming::Line(line),
            Err(error) => {
                deliver(Incoming::Closed(Some(format!(
                    "could not read the supervisor: {error}"
                ))));
                return;
            }
        };
        if !deliver(incoming) {
            return;
        }
    }
    deliver(Incoming::Closed(None));
}

/// Writes [`WindowMessage`]s to the supervisor and remembers the first
/// failure, which the window reports as its exit status.
#[derive(Debug)]
pub struct Outbound<W> {
    writer: Arc<Mutex<W>>,
    failure: Arc<Mutex<Option<String>>>,
}

// Clones share one writer, so `W` itself need not be `Clone`.
impl<W> Clone for Outbound<W> {
    fn clone(&self) -> Self {
        Self {
            writer: Arc::clone(&self.writer),
            failure: Arc::clone(&self.failure),
        }
    }
}

impl<W: Write> Outbound<W> {
    /// Write to `writer`.
    pub fn new(writer: W) -> Self {
        Self {
            writer: Arc::new(Mutex::new(writer)),
            failure: Arc::new(Mutex::new(None)),
        }
    }

    /// Announce this window's protocol version.
    #[must_use]
    pub fn hello(&self) -> bool {
        self.send(&WindowMessage::Hello {
            protocol: PROTOCOL_VERSION,
        })
    }

    /// Send one message. Returns `false`, and records why, when the
    /// supervisor is gone.
    #[must_use]
    pub fn send(&self, message: &WindowMessage) -> bool {
        let written = encode_line(message)
            .map_err(|error| error.to_string())
            .and_then(|line| {
                let mut writer = self.writer.lock().unwrap_or_else(PoisonError::into_inner);
                writer
                    .write_all(line.as_bytes())
                    .and_then(|()| writer.flush())
                    .map_err(|error| format!("could not write to the supervisor: {error}"))
            });
        match written {
            Ok(()) => true,
            Err(failure) => {
                self.fail(failure);
                false
            }
        }
    }

    /// Record a broken link; the first failure wins.
    pub fn fail(&self, failure: String) {
        self.failure
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get_or_insert(failure);
    }

    /// Why the link broke, if it did.
    #[must_use]
    pub fn failure(&self) -> Option<String> {
        self.failure
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use scout_desktop_ipc::{
        ChatTurn, GameflowPhase, PROTOCOL_VERSION, StateSnapshot, SupervisorMessage, WindowMessage,
        decode_line, encode_line,
    };

    use super::{Effect, Incoming, Outbound, WindowState, read_lines};

    fn line(message: &SupervisorMessage) -> Result<String, scout_desktop_ipc::CodecError> {
        encode_line(message)
    }

    #[test]
    fn supervisor_messages_update_the_state() -> Result<(), Box<dyn std::error::Error>> {
        let mut window = WindowState::default();
        assert!(!window.tray_available());
        assert_eq!(
            window.receive(&line(&SupervisorMessage::Hello {
                protocol: PROTOCOL_VERSION,
                tray_available: true,
            })?)?,
            Effect::Render
        );
        assert!(window.tray_available());
        let state = StateSnapshot {
            paired: true,
            pending_observations: 2,
            ..StateSnapshot::default()
        };
        window.receive(&line(&SupervisorMessage::State {
            state: state.clone(),
        })?)?;
        window.receive(&line(&SupervisorMessage::Phase {
            phase: GameflowPhase::Lobby,
        })?)?;
        assert_eq!(window.state, state);
        assert_eq!(window.phase, GameflowPhase::Lobby);
        assert_eq!(
            window.receive(&line(&SupervisorMessage::DiagnosticsBundle {
                text: "bundle".to_owned()
            })?)?,
            Effect::CopyBundle("bundle".to_owned())
        );
        assert_eq!(
            window.receive(&line(&SupervisorMessage::ChatTurn {
                turn: Some(ChatTurn {
                    answer: Some("Jinx".to_owned()),
                    ..ChatTurn::default()
                }),
            })?)?,
            Effect::Render
        );
        assert_eq!(
            window
                .chat
                .turn
                .as_ref()
                .and_then(|turn| turn.answer.as_deref()),
            Some("Jinx")
        );
        assert_eq!(
            window.receive(&line(&SupervisorMessage::Show)?)?,
            Effect::Show
        );
        assert_eq!(
            window.receive(&line(&SupervisorMessage::ShowChat)?)?,
            Effect::ShowChat
        );
        assert_eq!(
            window.receive(&line(&SupervisorMessage::Close)?)?,
            Effect::Close
        );
        Ok(())
    }

    #[test]
    fn the_live_game_arrives_and_clears() -> Result<(), Box<dyn std::error::Error>> {
        let mut window = WindowState::default();
        let live = scout_desktop_ipc::LiveGameSnapshot {
            game_time_secs: 60,
            champion: "Ahri".to_owned(),
            level: 3,
            kills: 0,
            deaths: 0,
            assists: 0,
            creep_score: 12,
        };
        let sent = SupervisorMessage::LiveGame {
            live: Some(live.clone()),
        };
        assert_eq!(window.receive(&line(&sent)?)?, Effect::Render);
        assert_eq!(window.live_game, Some(live));
        window.receive(&line(&SupervisorMessage::LiveGame { live: None })?)?;
        assert_eq!(window.live_game, None);
        Ok(())
    }

    #[test]
    fn a_mismatched_or_unknown_message_breaks_the_link() -> Result<(), Box<dyn std::error::Error>> {
        let mut window = WindowState::default();
        let hello = line(&SupervisorMessage::Hello {
            protocol: PROTOCOL_VERSION + 1,
            tray_available: true,
        })?;
        assert!(window.receive(&hello).is_err());
        assert_eq!(window.tray_available, None);
        assert!(window.receive("{\"type\":\"reformat\"}").is_err());
        Ok(())
    }

    #[test]
    fn lines_are_delivered_until_stdin_closes() {
        let mut seen = Vec::new();
        read_lines(Cursor::new("one\ntwo\n"), |incoming| {
            seen.push(incoming);
            true
        });
        assert_eq!(
            seen,
            [
                Incoming::Line("one".to_owned()),
                Incoming::Line("two".to_owned()),
                Incoming::Closed(None),
            ]
        );

        let mut first = Vec::new();
        read_lines(Cursor::new("one\ntwo\n"), |incoming| {
            first.push(incoming);
            false
        });
        assert_eq!(first, [Incoming::Line("one".to_owned())]);
    }

    #[test]
    fn commands_go_out_as_one_line_each() -> Result<(), Box<dyn std::error::Error>> {
        let outbound = Outbound::new(Vec::new());
        assert!(outbound.hello());
        assert!(outbound.send(&WindowMessage::SetStartAtLogin { enabled: true }));
        let written = String::from_utf8(
            outbound
                .writer
                .lock()
                .map_err(|error| error.to_string())?
                .clone(),
        )?;
        let messages = written
            .lines()
            .map(decode_line::<WindowMessage>)
            .collect::<Result<Vec<_>, _>>()?;
        assert_eq!(
            messages,
            [
                WindowMessage::Hello {
                    protocol: PROTOCOL_VERSION
                },
                WindowMessage::SetStartAtLogin { enabled: true },
            ]
        );
        assert_eq!(outbound.failure(), None);
        Ok(())
    }

    #[test]
    fn a_failed_write_is_remembered() {
        struct Closed;
        impl std::io::Write for Closed {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::Error::from(std::io::ErrorKind::BrokenPipe))
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let outbound = Outbound::new(Closed);
        assert!(!outbound.send(&WindowMessage::Quit));
        outbound.fail("later".to_owned());
        assert!(
            outbound
                .failure()
                .is_some_and(|failure| failure.starts_with("could not write"))
        );
    }
}
