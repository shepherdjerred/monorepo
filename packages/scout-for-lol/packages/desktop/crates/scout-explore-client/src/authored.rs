//! Text the player wrote themselves.
//!
//! Scout answers a question from the game in progress only when the player
//! asked it: Riot's policy prohibits unprompted alerts from live state, so a
//! turn the app starts on its own may never carry it. [`PlayerAuthored`] is how
//! this crate tells the two apart. Its only constructor is crate-private and
//! is called in exactly one place: where the relay reads the composer's
//! `send`, the text the player typed in the window. A game context rides only
//! on a question of this type ([`crate::session::ChatSession::submit_with_game`]),
//! so nothing else in the supervisor (a follow-up chip, an app-initiated
//! trigger) can start a turn that carries live state without adding a
//! constructor of its own, with its own proof, here.
//!
//! A spoken turn ([`crate::voice`]) is the one other carrier. Its request holds
//! audio and no text, and the server transcribes it itself, refusing a
//! wake-word turn whose transcript does not open with the wake phrase. On this
//! side the recording is a `PlayerAuthored<Utterance>` too, minted only where
//! the supervisor's voice capture hands over what the microphone recorded
//! after a wake word or push-to-talk ([`PlayerAuthored::from_voice_capture`]),
//! and [`crate::ExploreClient::start_voice_turn`] takes nothing else.
//!
//! The tests below hold that boundary over the whole desktop workspace.

use crate::voice::Utterance;

/// A value the player typed. It can be read, never minted, outside this crate.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlayerAuthored<T>(T);

impl<T> PlayerAuthored<T> {
    /// Text that arrived as the composer's `send`. Only the relay calls this.
    pub(crate) const fn from_composer(value: T) -> Self {
        Self(value)
    }

    /// The value.
    #[must_use]
    pub const fn get(&self) -> &T {
        &self.0
    }
}

impl PlayerAuthored<Utterance> {
    /// A recording the player started, by saying the wake word or holding
    /// push-to-talk. Only the supervisor's voice capture calls this, where
    /// the microphone engine hands over a finished utterance; the test below
    /// keeps it that way.
    #[must_use]
    pub const fn from_voice_capture(utterance: Utterance) -> Self {
        Self(utterance)
    }
}

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use super::PlayerAuthored;

    type TestResult = Result<(), Box<dyn std::error::Error>>;

    /// Every Rust source file under the desktop workspace's crates.
    fn sources(directory: &Path, found: &mut Vec<PathBuf>) -> std::io::Result<()> {
        for entry in std::fs::read_dir(directory)? {
            let path = entry?.path();
            if path.is_dir() {
                if path.file_name().is_some_and(|name| name == "target") {
                    continue;
                }
                sources(&path, found)?;
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                found.push(path);
            }
        }
        Ok(())
    }

    /// The files, relative to `crates/`, whose text contains `needle`.
    fn files_naming(needle: &str) -> Result<Vec<String>, Box<dyn std::error::Error>> {
        let crates = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .ok_or("the crate has no parent directory")?;
        let mut found = Vec::new();
        sources(crates, &mut found)?;
        let mut naming = Vec::new();
        for path in found {
            if std::fs::read_to_string(&path)?.contains(needle) {
                naming.push(
                    path.strip_prefix(crates)?
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            }
        }
        naming.sort();
        Ok(naming)
    }

    #[test]
    fn only_the_relay_mints_player_text() -> TestResult {
        // The constructor's definition and this test, and the relay.
        let needle = ["from_", "composer("].concat();
        assert_eq!(
            files_naming(&needle)?,
            [
                "scout-explore-client/src/authored.rs",
                "scout-explore-client/src/relay.rs"
            ]
        );
        Ok(())
    }

    #[test]
    fn only_voice_capture_mints_a_spoken_turn() -> TestResult {
        // The constructor's definition and this test, the supervisor's voice
        // capture, and the route's own HTTP test.
        let needle = ["from_", "voice_capture("].concat();
        assert_eq!(
            files_naming(&needle)?,
            [
                "scout-client-app/src/voice/capture.rs",
                "scout-explore-client/src/authored.rs",
                "scout-explore-client/tests/http/voice.rs"
            ]
        );
        Ok(())
    }

    #[test]
    fn only_the_session_puts_a_game_on_a_turn() -> TestResult {
        // The field's declaration, the one typed-turn builder that sets it,
        // and the spoken turn, whose proof the server makes from its audio.
        let needle = ["game_context", ": "].concat();
        assert_eq!(
            files_naming(&needle)?,
            [
                "scout-client-core/src/desktop_api.rs",
                "scout-explore-client/src/session.rs",
                "scout-explore-client/src/voice.rs"
            ]
        );
        Ok(())
    }

    #[test]
    fn the_value_reads_back_unchanged() {
        let typed = PlayerAuthored::from_composer("What should I build?".to_owned());
        assert_eq!(typed.get(), "What should I build?");
    }

    #[test]
    fn a_typed_question_carries_the_game_and_a_plain_one_never_does() -> TestResult {
        use scout_client_core::coach_context::{GameContext, PostgameContext};
        use scout_client_core::desktop_api::ConversationListResponse;

        use crate::session::ChatSession;

        let game = GameContext {
            postgame: Some(PostgameContext {
                match_id: "NA1_5663121007".to_owned(),
            }),
            ..GameContext::default()
        };
        let mut session = ChatSession::new();
        session.listed(ConversationListResponse {
            conversations: Vec::new(),
        });
        let typed = PlayerAuthored::from_composer("How did that go?".to_owned());
        let request = session
            .submit_with_game(&typed, game.clone())
            .ok_or("the session refused a typed question")?;
        assert_eq!(request.question.as_deref(), Some("How did that go?"));
        assert_eq!(request.game_context, Some(game));

        let mut session = ChatSession::new();
        session.listed(ConversationListResponse {
            conversations: Vec::new(),
        });
        let plain = session
            .submit("How did that go?")
            .ok_or("the session refused a question")?;
        assert_eq!(plain.game_context, None);
        Ok(())
    }
}
