//! Voice's view models: the microphone indicator every page shows, the
//! first-use question, the Settings section, and the spoken turn on the chat
//! page.
//!
//! The window never opens the microphone. Every control here sends a
//! [`VoiceCommand`] and the supervisor's next [`VoiceSnapshot`] shows the
//! result.

use scout_desktop_ipc::{
    VoiceCommand, VoiceConsent, VoiceSettings, VoiceSnapshot, VoiceState, VoiceTurnView,
    WindowMessage,
};

/// How the indicator reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MicTone {
    /// Closed.
    Idle,
    /// Open: listening or recording.
    Live,
    /// Scout is working on, or speaking, an answer.
    Busy,
    /// Muted, or failed.
    Alert,
}

/// The microphone indicator, at the top of the sidebar on every page.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MicIndicator {
    /// What it says.
    pub label: &'static str,
    /// How it reads.
    pub tone: MicTone,
    /// Clicking mutes or unmutes; none before the player agreed to voice.
    pub toggle: Option<WindowMessage>,
}

fn voice(command: VoiceCommand) -> WindowMessage {
    WindowMessage::Voice { command }
}

impl MicIndicator {
    /// The indicator for `snapshot`, or none when this build has no voice.
    #[must_use]
    pub fn new(snapshot: &VoiceSnapshot) -> Option<Self> {
        snapshot.settings.as_ref()?;
        let (label, tone) = match snapshot.state {
            VoiceState::Off => ("Mic off", MicTone::Idle),
            VoiceState::Listening => ("Listening", MicTone::Live),
            VoiceState::Capturing => ("Recording", MicTone::Live),
            VoiceState::Thinking => ("Thinking", MicTone::Busy),
            VoiceState::Speaking => ("Speaking", MicTone::Busy),
            VoiceState::Muted => ("Muted", MicTone::Alert),
            VoiceState::Error => ("Mic error", MicTone::Alert),
        };
        let toggle = (snapshot.consent == VoiceConsent::Accepted).then(|| {
            voice(VoiceCommand::SetMuted {
                muted: !snapshot.muted,
            })
        });
        Some(Self {
            label,
            tone,
            toggle,
        })
    }
}

/// A labelled control and the message it sends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceAction {
    /// A stable element id.
    pub id: &'static str,
    /// What it says.
    pub label: &'static str,
    /// What it sends.
    pub message: WindowMessage,
}

/// The first-use question's title.
pub const CONSENT_TITLE: &str = "Talk to Scout?";
/// What the player agrees to, in plain words.
pub const CONSENT_BODY: &str = "Scout listens on this computer for \"hey scout\" while a game is loading or in progress, and while you hold the push-to-talk key. The microphone never streams: only the question you ask is sent to Scout, as one recording, and Scout speaks its answer. You can mute it with a key, and turn voice off in Settings.";

/// The first-use question, shown over the window.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConsentDialog {
    /// The title.
    pub title: &'static str,
    /// What voice does with the microphone.
    pub body: &'static str,
    /// Turn voice on.
    pub accept: VoiceAction,
    /// Leave it off.
    pub decline: VoiceAction,
}

impl ConsentDialog {
    /// The question, when the supervisor asked for it.
    #[must_use]
    pub fn new(snapshot: &VoiceSnapshot) -> Option<Self> {
        snapshot.consent_requested.then(|| Self {
            title: CONSENT_TITLE,
            body: CONSENT_BODY,
            accept: VoiceAction {
                id: "voice-consent-accept",
                label: "Turn on voice",
                message: voice(VoiceCommand::Consent { accepted: true }),
            },
            decline: VoiceAction {
                id: "voice-consent-decline",
                label: "Not now",
                message: voice(VoiceCommand::Consent { accepted: false }),
            },
        })
    }
}

/// One key the player can pick.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct KeyOption {
    /// A stable element id.
    pub id: String,
    /// The key as it reads, such as `Alt+V`.
    pub label: String,
    /// Whether it is the key now.
    pub selected: bool,
    /// What picking it sends.
    pub message: WindowMessage,
}

/// The push-to-talk keys offered, all unbound in League by default.
pub const PUSH_TO_TALK_KEYS: [&str; 5] = ["F8", "F9", "F10", "Alt+KeyV", "Backquote"];
/// The mute keys offered.
pub const MUTE_KEYS: [&str; 4] = ["Shift+F8", "Shift+F9", "Shift+F10", "Alt+KeyM"];

/// An accelerator as a player reads it: `Alt+KeyV` is `Alt+V`.
#[must_use]
pub fn key_label(accelerator: &str) -> String {
    accelerator
        .split('+')
        .map(|token| match token {
            "Backquote" => "`".to_owned(),
            token => token
                .strip_prefix("Key")
                .filter(|letter| letter.len() == 1)
                .or_else(|| token.strip_prefix("Digit").filter(|digit| digit.len() == 1))
                .unwrap_or(token)
                .to_owned(),
        })
        .collect::<Vec<_>>()
        .join("+")
}

/// The Settings page's voice section.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceSettingsModel {
    /// Whether voice is on, in words.
    pub status: String,
    /// Turn voice on or off.
    pub consent: VoiceAction,
    /// Whether conversation mode is on, and the message flipping it.
    pub conversation_mode: (bool, WindowMessage),
    /// Whether push-to-talk is on, and the message flipping it.
    pub push_to_talk: (bool, WindowMessage),
    /// The push-to-talk keys.
    pub push_to_talk_keys: Vec<KeyOption>,
    /// The mute keys.
    pub mute_keys: Vec<KeyOption>,
    /// Why voice failed or is unavailable.
    pub detail: Option<String>,
}

/// The note under the voice controls.
pub const VOICE_NOTE: &str = "Only the question you ask leaves this computer, as one recording sent to Scout when you finish speaking. The push-to-talk and mute keys work in every app, League included.";

fn key_options(
    id: &'static str,
    offered: &[&str],
    current: &str,
    change: impl Fn(&str) -> VoiceSettings,
) -> Vec<KeyOption> {
    let mut keys: Vec<&str> = offered.to_vec();
    if !keys.contains(&current) {
        // A key set in the settings file shows too.
        keys.push(current);
    }
    keys.into_iter()
        .map(|key| KeyOption {
            id: format!("{id}-{key}"),
            label: key_label(key),
            selected: key == current,
            message: voice(VoiceCommand::SetSettings {
                settings: change(key),
            }),
        })
        .collect()
}

impl VoiceSettingsModel {
    /// The section for `snapshot`, or none when this build has no voice.
    #[must_use]
    pub fn new(snapshot: &VoiceSnapshot) -> Option<Self> {
        let settings = snapshot.settings.as_ref()?;
        let with = |change: &dyn Fn(&mut VoiceSettings)| {
            let mut changed = settings.clone();
            change(&mut changed);
            voice(VoiceCommand::SetSettings { settings: changed })
        };
        let on = snapshot.consent == VoiceConsent::Accepted;
        Some(Self {
            status: match snapshot.consent {
                VoiceConsent::Accepted => "Voice is on.".to_owned(),
                VoiceConsent::NotAsked => {
                    "Voice is off. Scout asks the first time you use it.".to_owned()
                }
                VoiceConsent::Declined => "Voice is off.".to_owned(),
            },
            consent: VoiceAction {
                id: "voice-consent",
                label: if on {
                    "Turn off voice"
                } else {
                    "Turn on voice"
                },
                message: voice(VoiceCommand::Consent { accepted: !on }),
            },
            conversation_mode: (
                settings.conversation_mode,
                with(&|changed| changed.conversation_mode = !changed.conversation_mode),
            ),
            push_to_talk: (
                settings.push_to_talk,
                with(&|changed| changed.push_to_talk = !changed.push_to_talk),
            ),
            push_to_talk_keys: key_options(
                "push-to-talk-key",
                &PUSH_TO_TALK_KEYS,
                &settings.push_to_talk_key,
                |key| VoiceSettings {
                    push_to_talk_key: key.to_owned(),
                    ..settings.clone()
                },
            ),
            mute_keys: key_options("mute-key", &MUTE_KEYS, &settings.mute_key, |key| {
                VoiceSettings {
                    mute_key: key.to_owned(),
                    ..settings.clone()
                }
            }),
            detail: snapshot.detail.clone(),
        })
    }
}

/// The conversation-mode switch's label.
pub const CONVERSATION_MODE_LABEL: &str = "Listen for \"hey scout\" during games";
/// The push-to-talk switch's label.
pub const PUSH_TO_TALK_LABEL: &str = "Push-to-talk";

/// The spoken turn, above the chat transcript.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceTurnModel {
    /// "You asked: …", or, until the transcript arrives, that Scout is
    /// listening to it; none when the turn ended before Scout heard it.
    pub heard: Option<String>,
    /// Scout's answer, once it arrives.
    pub answer: Option<String>,
    /// Why it stopped short.
    pub error: Option<String>,
}

impl VoiceTurnModel {
    /// The strip for the latest spoken turn, if there has been one.
    #[must_use]
    pub fn new(turn: Option<&VoiceTurnView>) -> Option<Self> {
        let turn = turn?;
        let waiting = turn.answer.is_none() && turn.error.is_none();
        Some(Self {
            heard: match &turn.heard {
                Some(heard) => Some(format!("You asked: {heard}")),
                None => waiting.then(|| "Scout is listening to your question…".to_owned()),
            },
            answer: turn.answer.clone(),
            error: turn.error.clone(),
        })
    }
}

#[cfg(test)]
mod tests {
    use scout_desktop_ipc::{
        VoiceCommand, VoiceConsent, VoiceSettings, VoiceSnapshot, VoiceState, VoiceTurnView,
        WindowMessage,
    };

    use super::{
        ConsentDialog, MicIndicator, MicTone, VoiceSettingsModel, VoiceTurnModel, key_label,
    };

    fn settings() -> VoiceSettings {
        VoiceSettings {
            conversation_mode: true,
            push_to_talk: true,
            push_to_talk_key: "F8".to_owned(),
            mute_key: "Shift+F8".to_owned(),
        }
    }

    fn snapshot(state: VoiceState, consent: VoiceConsent) -> VoiceSnapshot {
        VoiceSnapshot {
            state,
            consent,
            settings: Some(settings()),
            ..VoiceSnapshot::default()
        }
    }

    #[test]
    fn the_indicator_names_every_state_and_hides_without_voice() {
        assert_eq!(MicIndicator::new(&VoiceSnapshot::default()), None);
        let labels: Vec<(&str, MicTone)> = [
            VoiceState::Off,
            VoiceState::Listening,
            VoiceState::Capturing,
            VoiceState::Thinking,
            VoiceState::Speaking,
            VoiceState::Muted,
            VoiceState::Error,
        ]
        .into_iter()
        .filter_map(|state| MicIndicator::new(&snapshot(state, VoiceConsent::Accepted)))
        .map(|indicator| (indicator.label, indicator.tone))
        .collect();
        assert_eq!(
            labels,
            [
                ("Mic off", MicTone::Idle),
                ("Listening", MicTone::Live),
                ("Recording", MicTone::Live),
                ("Thinking", MicTone::Busy),
                ("Speaking", MicTone::Busy),
                ("Muted", MicTone::Alert),
                ("Mic error", MicTone::Alert),
            ]
        );
    }

    #[test]
    fn the_indicator_mutes_only_once_voice_is_on() {
        let off = MicIndicator::new(&snapshot(VoiceState::Off, VoiceConsent::NotAsked));
        assert_eq!(off.and_then(|indicator| indicator.toggle), None);
        let listening = MicIndicator::new(&snapshot(VoiceState::Listening, VoiceConsent::Accepted));
        assert_eq!(
            listening.and_then(|indicator| indicator.toggle),
            Some(WindowMessage::Voice {
                command: VoiceCommand::SetMuted { muted: true }
            })
        );
        let muted = MicIndicator::new(&VoiceSnapshot {
            muted: true,
            ..snapshot(VoiceState::Muted, VoiceConsent::Accepted)
        });
        assert_eq!(
            muted.and_then(|indicator| indicator.toggle),
            Some(WindowMessage::Voice {
                command: VoiceCommand::SetMuted { muted: false }
            })
        );
    }

    #[test]
    fn the_first_use_question_shows_only_when_asked_and_answers_both_ways() {
        assert_eq!(
            ConsentDialog::new(&snapshot(VoiceState::Off, VoiceConsent::NotAsked)),
            None
        );
        let dialog = ConsentDialog::new(&VoiceSnapshot {
            consent_requested: true,
            ..snapshot(VoiceState::Off, VoiceConsent::NotAsked)
        });
        let dialog = dialog.as_ref();
        assert_eq!(
            dialog.map(|dialog| &dialog.accept.message),
            Some(&WindowMessage::Voice {
                command: VoiceCommand::Consent { accepted: true }
            })
        );
        assert_eq!(
            dialog.map(|dialog| &dialog.decline.message),
            Some(&WindowMessage::Voice {
                command: VoiceCommand::Consent { accepted: false }
            })
        );
        assert!(dialog.is_some_and(|dialog| dialog.body.contains("never streams")));
    }

    #[test]
    fn keys_read_as_a_player_types_them() {
        assert_eq!(key_label("Alt+KeyV"), "Alt+V");
        assert_eq!(key_label("Shift+F8"), "Shift+F8");
        assert_eq!(key_label("Backquote"), "`");
        assert_eq!(key_label("Ctrl+Digit1"), "Ctrl+1");
    }

    #[test]
    fn settings_flip_one_choice_at_a_time_and_offer_the_stored_key() -> Result<(), &'static str> {
        let model = VoiceSettingsModel::new(&snapshot(VoiceState::Off, VoiceConsent::Accepted))
            .ok_or("a build with voice shows the section")?;
        assert_eq!(model.consent.label, "Turn off voice");
        assert_eq!(
            model.conversation_mode.1,
            WindowMessage::Voice {
                command: VoiceCommand::SetSettings {
                    settings: VoiceSettings {
                        conversation_mode: false,
                        ..settings()
                    }
                }
            }
        );
        let selected: Vec<&str> = model
            .push_to_talk_keys
            .iter()
            .filter(|key| key.selected)
            .map(|key| key.label.as_str())
            .collect();
        assert_eq!(selected, ["F8"]);
        assert_eq!(model.push_to_talk_keys.len(), 5);
        assert_eq!(
            model.mute_keys.last().map(|key| &key.message),
            Some(&WindowMessage::Voice {
                command: VoiceCommand::SetSettings {
                    settings: VoiceSettings {
                        mute_key: "Alt+KeyM".to_owned(),
                        ..settings()
                    }
                }
            })
        );
        // A key chosen in the file, not offered here, still shows as chosen.
        let custom = VoiceSettingsModel::new(&VoiceSnapshot {
            settings: Some(VoiceSettings {
                push_to_talk_key: "Ctrl+KeyT".to_owned(),
                ..settings()
            }),
            ..snapshot(VoiceState::Off, VoiceConsent::Declined)
        });
        let custom = custom.map(|model| {
            (
                model.consent.label,
                model
                    .push_to_talk_keys
                    .last()
                    .map(|key| (key.label.clone(), key.selected)),
            )
        });
        assert_eq!(
            custom,
            Some(("Turn on voice", Some(("Ctrl+T".to_owned(), true))))
        );
        assert_eq!(VoiceSettingsModel::new(&VoiceSnapshot::default()), None);
        Ok(())
    }

    #[test]
    fn the_spoken_turn_reads_as_a_question_and_its_answer() {
        assert_eq!(VoiceTurnModel::new(None), None);
        let waiting = VoiceTurnModel::new(Some(&VoiceTurnView::default()));
        assert_eq!(
            waiting.and_then(|model| model.heard),
            Some("Scout is listening to your question…".to_owned())
        );
        let refused = VoiceTurnModel::new(Some(&VoiceTurnView {
            error: Some("Scout did not hear a question.".to_owned()),
            ..VoiceTurnView::default()
        }));
        assert_eq!(refused.and_then(|model| model.heard), None);
        let answered = VoiceTurnModel::new(Some(&VoiceTurnView {
            heard: Some("What should I build?".to_owned()),
            answer: Some("Zhonya's Hourglass.".to_owned()),
            error: None,
        }));
        assert_eq!(
            answered.map(|model| (model.heard, model.answer)),
            Some((
                Some("You asked: What should I build?".to_owned()),
                Some("Zhonya's Hourglass.".to_owned())
            ))
        );
    }
}
