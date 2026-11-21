//! Voice: the microphone's state and the spoken turn, supervisor to window,
//! and the player's voice choices, window to supervisor.
//!
//! The supervisor owns the microphone; the window only shows where it is and
//! sends what the player chose. No audio crosses this link.

use serde::{Deserialize, Serialize};

/// Where the microphone is, as the window shows it at all times.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceState {
    /// The microphone is closed: voice is not turned on, no game is running
    /// in conversation mode, and push-to-talk is not held.
    #[default]
    Off,
    /// Listening on this computer for "hey scout". Nothing leaves it.
    Listening,
    /// Recording a question.
    Capturing,
    /// The question was sent; Scout is answering.
    Thinking,
    /// Scout is speaking its answer.
    Speaking,
    /// The player muted the microphone.
    Muted,
    /// Voice failed; the detail says why.
    Error,
}

/// Whether the player has agreed to voice. Nothing opens the microphone
/// until they accept.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VoiceConsent {
    /// Never asked.
    #[default]
    NotAsked,
    /// Accepted.
    Accepted,
    /// Declined; voice stays off until they turn it on in Settings.
    Declined,
}

/// The player's voice settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VoiceSettings {
    /// Listen for "hey scout" while a game is loading or in progress.
    pub conversation_mode: bool,
    /// Hold a key to ask.
    pub push_to_talk: bool,
    /// The push-to-talk key, as an accelerator such as `F8` or `Alt+KeyV`.
    pub push_to_talk_key: String,
    /// The key that mutes and unmutes the microphone.
    pub mute_key: String,
}

/// The window's view of voice.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VoiceSnapshot {
    /// Where the microphone is.
    pub state: VoiceState,
    /// Whether the player agreed to voice.
    pub consent: VoiceConsent,
    /// Show the first-use question: the player asked for voice (a game
    /// started in conversation mode, or they pressed push-to-talk) before
    /// agreeing to it.
    pub consent_requested: bool,
    /// Whether the player muted the microphone.
    pub muted: bool,
    /// The settings, as stored; none when this build has no voice.
    pub settings: Option<VoiceSettings>,
    /// Why voice failed or is unavailable, safe to show.
    pub detail: Option<String>,
}

/// The spoken turn in progress or just finished: what Scout heard and what
/// it answered.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VoiceTurnView {
    /// The question as the server transcribed it, once it has.
    pub heard: Option<String>,
    /// The answer's text, once it arrives.
    pub answer: Option<String>,
    /// Why the turn stopped short, safe to show.
    pub error: Option<String>,
    /// Scout started this one: it is speaking something it noticed on the
    /// scoreboard, not answering a question. Beta profile only.
    #[cfg(scout_proactive_coach)]
    #[serde(default)]
    pub app_initiated: bool,
}

/// A voice choice from the window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum VoiceCommand {
    /// The answer to the first-use question, or turning voice on or off in
    /// Settings.
    Consent {
        /// Whether the player agrees.
        accepted: bool,
    },
    /// Mute or unmute the microphone.
    SetMuted {
        /// Whether it is muted.
        muted: bool,
    },
    /// Replace the voice settings: conversation mode, push-to-talk and its
    /// key, and the mute key.
    SetSettings {
        /// The new settings.
        settings: VoiceSettings,
    },
}
