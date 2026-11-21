//! What voice does next, as a pure function of what happened.
//!
//! The [`Controller`] holds the player's choices (consent, conversation
//! mode, push-to-talk, mute), the gameflow, the microphone engine's state and
//! the spoken turn in flight. Each [`Input`] returns the [`Effect`]s the
//! service carries out, so every rule here is tested without a device, a
//! thread or a socket.
//!
//! The rules that matter:
//!
//! - Nothing opens the microphone until the player has agreed. Asking for
//!   voice first (a game starting in conversation mode, or the push-to-talk
//!   key) shows the first-use question instead.
//! - Conversation mode listens only from `GameStart` until the game ends,
//!   and never while muted.
//! - The microphone is closed while an answer is fetched and spoken; the
//!   engine holds the utterance's turn until the controller finishes it.
//! - In the beta profile only, Scout may speak a proactive answer it noticed
//!   on the scoreboard: only in conversation mode, during a game, unmuted,
//!   with nothing else running, and labelled as Scout's own. The microphone
//!   closes while it plays, and the player's push-to-talk or mute cuts it off.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use scout_client_core::live::gameflow::GameflowPhase;
use scout_client_core::settings::VoiceSettings;
use scout_desktop_ipc::{
    VoiceCommand, VoiceConsent, VoiceSettings as WireSettings, VoiceSnapshot, VoiceState,
    VoiceTurnView,
};
use scout_explore_client::voice::{SpeechEncoding, VoiceTurnEvent};
use scout_voice::conversation::conversation_open;
use scout_voice::playback::pcm_s16le;
use scout_voice::{EngineCommand, EngineEvent, Utterance};
use uuid::Uuid;

use crate::hotkeys::{HotkeyBindings, HotkeyEvent, validate};

/// What a spoken turn reported.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TurnUpdate {
    /// One event of the answer's stream.
    Event(VoiceTurnEvent),
    /// The turn could not start (no credential, a refusal, a recording the
    /// route would not take); safe to show.
    Refused(String),
    /// The stream broke before `done`; safe to show.
    Broken(String),
}

/// Something that happened.
#[derive(Debug)]
pub enum Input {
    /// The gameflow phase changed.
    Phase(GameflowPhase),
    /// A global key.
    Hotkey(HotkeyEvent),
    /// A choice from the window.
    Window(VoiceCommand),
    /// The microphone engine.
    Engine(EngineEvent),
    /// The spoken turn.
    Turn(TurnUpdate),
    /// The spoken answer finished playing.
    Drained,
    /// A proactive turn answered; its run may be spoken. Beta profile only.
    #[cfg(scout_proactive_coach)]
    ProactiveAnswer(Uuid),
    /// The speech fetched for it, or why there is none. Beta profile only.
    #[cfg(scout_proactive_coach)]
    ProactiveSpeech(Result<scout_explore_client::proactive::ProactiveSpeech, String>),
}

/// Something the service must do.
#[derive(Debug, PartialEq)]
pub enum Effect {
    /// Load the models and start the microphone engine.
    StartEngine,
    /// Tell the engine.
    Engine(EngineCommand),
    /// Persist the choices.
    Save(VoiceSettings),
    /// Register these keys.
    Bind(HotkeyBindings),
    /// Send this utterance to Scout.
    Ask(Utterance),
    /// Queue speech.
    Play {
        /// Samples per second.
        sample_rate_hz: u32,
        /// Mono samples.
        pcm: Vec<i16>,
    },
    /// Fall silent.
    StopPlayback,
    /// Report [`Input::Drained`] once queued speech has played.
    AwaitDrain,
    /// Bring the window forward for the first-use question.
    ShowWindow,
    /// Show this conversation, which now holds the spoken turn.
    OpenConversation(Uuid),
    /// Fetch the speech of this proactive turn's answer. Beta profile only.
    #[cfg(scout_proactive_coach)]
    FetchProactiveSpeech(Uuid),
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum EngineStatus {
    /// Not started: the player has not agreed yet.
    Stopped,
    /// Loading the models.
    Starting,
    /// Taking commands.
    Ready,
    /// The models or the thread failed; voice cannot run.
    Unavailable(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Turn {
    Idle,
    /// The utterance was sent; waiting for the answer.
    Thinking,
    /// The answer is playing; `done` says whether the stream has ended.
    Speaking {
        done: bool,
    },
    /// Scout is saying a proactive answer on its own: fetching its speech,
    /// then `playing` it. Beta profile only.
    #[cfg(scout_proactive_coach)]
    Announcing {
        playing: bool,
    },
}

/// What the engine last reported about the microphone.
#[derive(Debug, Clone, Copy)]
struct Microphone {
    state: scout_voice::VoiceState,
    open: bool,
    /// The device failed; hands-free listening waits for the next game,
    /// unmute or settings change.
    failed: bool,
}

/// What the engine was last told.
#[derive(Debug, Clone, Copy, Default)]
struct Told {
    listening: bool,
    push_to_talk: bool,
}

/// Voice's state.
#[derive(Debug)]
pub struct Controller {
    settings: VoiceSettings,
    /// Why the stored settings could not be read; voice stays off.
    settings_problem: Option<String>,
    engine: EngineStatus,
    microphone: Microphone,
    told: Told,
    consent_requested: bool,
    muted: bool,
    in_game: bool,
    turn: Turn,
    conversation: Option<Uuid>,
    error: Option<String>,
    view: Option<VoiceTurnView>,
}

/// The settings as the window shows them.
#[must_use]
pub fn wire_settings(settings: &VoiceSettings) -> WireSettings {
    WireSettings {
        conversation_mode: settings.conversation_mode,
        push_to_talk: settings.push_to_talk,
        push_to_talk_key: settings.push_to_talk_key.clone(),
        mute_key: settings.mute_key.clone(),
    }
}

impl Controller {
    /// A controller for the stored choices, or for a settings file that
    /// could not be read (`stored` is the error), which keeps voice off.
    /// Returns the effects to start with: binding the keys, and starting
    /// the engine when the player already agreed.
    #[must_use]
    pub fn new(stored: Result<VoiceSettings, String>) -> (Self, Vec<Effect>) {
        let (settings, settings_problem) = match stored {
            Ok(settings) => (settings, None),
            Err(problem) => (
                VoiceSettings {
                    consent: Some(false),
                    ..VoiceSettings::default()
                },
                Some(format!(
                    "Voice is off: Scout could not read its settings ({problem})."
                )),
            ),
        };
        let mut controller = Self {
            settings,
            settings_problem,
            engine: EngineStatus::Stopped,
            microphone: Microphone {
                state: scout_voice::VoiceState::Idle,
                open: false,
                failed: false,
            },
            told: Told::default(),
            consent_requested: false,
            muted: false,
            in_game: false,
            turn: Turn::Idle,
            conversation: None,
            error: None,
            view: None,
        };
        let mut effects = vec![Effect::Bind(controller.bindings())];
        controller.start_engine_if_agreed(&mut effects);
        (controller, effects)
    }

    const fn agreed(&self) -> bool {
        matches!(self.settings.consent, Some(true)) && self.settings_problem.is_none()
    }

    fn bindings(&self) -> HotkeyBindings {
        // A player who declined voice gets their keys back. Before anyone
        // asked, push-to-talk is bound, because pressing it is how voice is
        // first asked for.
        if self.settings_problem.is_some() || self.settings.consent == Some(false) {
            return HotkeyBindings::default();
        }
        HotkeyBindings {
            push_to_talk: self
                .settings
                .push_to_talk
                .then(|| self.settings.push_to_talk_key.clone()),
            mute: Some(self.settings.mute_key.clone()),
        }
    }

    fn start_engine_if_agreed(&mut self, effects: &mut Vec<Effect>) {
        if self.agreed() && self.engine == EngineStatus::Stopped {
            self.engine = EngineStatus::Starting;
            effects.push(Effect::StartEngine);
        }
    }

    fn ask_for_consent(&mut self, effects: &mut Vec<Effect>) {
        if self.settings.consent.is_none()
            && self.settings_problem.is_none()
            && !self.consent_requested
        {
            self.consent_requested = true;
            effects.push(Effect::ShowWindow);
        }
    }

    /// Whether hands-free listening should be on now.
    fn wants_listening(&self) -> bool {
        self.conversation_mode_live() && !self.announcing()
    }

    /// Conversation mode is on and may listen: agreed, ready, in a game,
    /// unmuted and working.
    fn conversation_mode_live(&self) -> bool {
        self.agreed()
            && self.engine == EngineStatus::Ready
            && self.settings.conversation_mode
            && self.in_game
            && !self.muted
            && !self.microphone.failed
    }

    /// Whether Scout is saying a proactive answer. Never in a stable build.
    #[cfg(scout_proactive_coach)]
    const fn announcing(&self) -> bool {
        matches!(self.turn, Turn::Announcing { .. })
    }

    /// Whether Scout is saying a proactive answer. Never in a stable build.
    #[cfg(not(scout_proactive_coach))]
    #[expect(clippy::unused_self, reason = "the beta build reads the turn")]
    const fn announcing(&self) -> bool {
        false
    }

    /// Cut off a proactive answer being said; the microphone may open again.
    fn stop_announcing(&mut self, effects: &mut Vec<Effect>) {
        if self.announcing() {
            effects.push(Effect::StopPlayback);
            self.turn = Turn::Idle;
        }
    }

    /// Tell the engine about any change in what it should be doing.
    fn sync(&mut self, effects: &mut Vec<Effect>) {
        let wants = self.wants_listening();
        if wants != self.told.listening {
            self.told.listening = wants;
            effects.push(Effect::Engine(EngineCommand::Conversation(wants)));
        }
    }

    fn release_push_to_talk(&mut self, effects: &mut Vec<Effect>) {
        if self.told.push_to_talk {
            self.told.push_to_talk = false;
            effects.push(Effect::Engine(EngineCommand::PushToTalk(false)));
        }
    }

    fn finish_turn(&mut self, effects: &mut Vec<Effect>) {
        self.turn = Turn::Idle;
        effects.push(Effect::Engine(EngineCommand::FinishTurn));
        if let Some(conversation) = self.conversation.take() {
            effects.push(Effect::OpenConversation(conversation));
        }
    }

    /// Apply one input.
    pub fn handle(&mut self, input: Input) -> Vec<Effect> {
        let mut effects = Vec::new();
        match input {
            Input::Phase(phase) => self.phase(&phase, &mut effects),
            Input::Hotkey(event) => self.hotkey(event, &mut effects),
            Input::Window(command) => self.window(command, &mut effects),
            Input::Engine(event) => self.engine(event, &mut effects),
            Input::Turn(update) => self.turn(update, &mut effects),
            Input::Drained => {
                if self.turn == (Turn::Speaking { done: true }) {
                    self.finish_turn(&mut effects);
                }
                #[cfg(scout_proactive_coach)]
                if self.turn == (Turn::Announcing { playing: true }) {
                    // Nothing of the player's was recorded, so there is no
                    // engine turn to finish.
                    self.turn = Turn::Idle;
                }
            }
            #[cfg(scout_proactive_coach)]
            Input::ProactiveAnswer(run_id) => self.proactive_answer(run_id, &mut effects),
            #[cfg(scout_proactive_coach)]
            Input::ProactiveSpeech(speech) => self.proactive_speech(speech, &mut effects),
        }
        self.sync(&mut effects);
        effects
    }

    fn phase(&mut self, phase: &GameflowPhase, effects: &mut Vec<Effect>) {
        let in_game = conversation_open(phase);
        if in_game != self.in_game {
            self.in_game = in_game;
            self.microphone.failed = false;
        }
        if !in_game {
            self.stop_announcing(effects);
        }
        if in_game && self.settings.conversation_mode {
            self.ask_for_consent(effects);
        }
    }

    fn hotkey(&mut self, event: HotkeyEvent, effects: &mut Vec<Effect>) {
        match event {
            HotkeyEvent::PushToTalk(true) => self.press_push_to_talk(effects),
            HotkeyEvent::PushToTalk(false) => self.release_push_to_talk(effects),
            HotkeyEvent::ToggleMute => self.set_muted(!self.muted, effects),
            HotkeyEvent::BindFailed(message) => self.error = Some(message),
        }
    }

    fn press_push_to_talk(&mut self, effects: &mut Vec<Effect>) {
        if !self.settings.push_to_talk || self.told.push_to_talk {
            return;
        }
        if !self.agreed() {
            self.ask_for_consent(effects);
            return;
        }
        if self.muted || self.engine != EngineStatus::Ready || self.turn == Turn::Thinking {
            return;
        }
        // The player's question comes before anything Scout says on its own.
        self.stop_announcing(effects);
        if matches!(self.turn, Turn::Speaking { .. }) {
            // Talking over the answer cuts it off and asks again.
            effects.push(Effect::StopPlayback);
            self.finish_turn(effects);
        }
        self.microphone.failed = false;
        self.error = None;
        self.told.push_to_talk = true;
        effects.push(Effect::Engine(EngineCommand::PushToTalk(true)));
    }

    fn set_muted(&mut self, muted: bool, effects: &mut Vec<Effect>) {
        if muted == self.muted {
            return;
        }
        self.muted = muted;
        if muted {
            self.release_push_to_talk(effects);
            self.stop_announcing(effects);
        } else {
            self.microphone.failed = false;
        }
    }

    fn save(&self, effects: &mut Vec<Effect>) {
        effects.push(Effect::Save(self.settings.clone()));
        effects.push(Effect::Bind(self.bindings()));
    }

    fn window(&mut self, command: VoiceCommand, effects: &mut Vec<Effect>) {
        if self.settings_problem.is_some() {
            // Nothing is saved over a file Scout could not read.
            return;
        }
        match command {
            VoiceCommand::Consent { accepted } => {
                self.consent_requested = false;
                self.settings.consent = Some(accepted);
                if !accepted {
                    self.release_push_to_talk(effects);
                }
                self.save(effects);
                self.start_engine_if_agreed(effects);
            }
            VoiceCommand::SetMuted { muted } => self.set_muted(muted, effects),
            VoiceCommand::SetSettings { settings } => {
                if let Err(problem) = validate(&settings.push_to_talk_key, &settings.mute_key) {
                    self.error = Some(problem);
                    return;
                }
                self.error = None;
                self.microphone.failed = false;
                self.settings = VoiceSettings {
                    consent: self.settings.consent,
                    conversation_mode: settings.conversation_mode,
                    push_to_talk: settings.push_to_talk,
                    push_to_talk_key: settings.push_to_talk_key,
                    mute_key: settings.mute_key,
                };
                if !self.settings.push_to_talk {
                    self.release_push_to_talk(effects);
                }
                self.save(effects);
            }
        }
    }

    fn engine(&mut self, event: EngineEvent, effects: &mut Vec<Effect>) {
        match event {
            EngineEvent::Ready => self.engine = EngineStatus::Ready,
            EngineEvent::State {
                state,
                microphone_open,
            } => {
                self.microphone.state = state;
                self.microphone.open = microphone_open;
            }
            EngineEvent::Utterance(utterance) => {
                if self.muted || self.turn != Turn::Idle || !self.agreed() {
                    // Muted mid-question, or a turn already running: the
                    // recording is dropped, never sent.
                    effects.push(Effect::Engine(EngineCommand::FinishTurn));
                    return;
                }
                self.told.push_to_talk = false;
                self.error = None;
                self.turn = Turn::Thinking;
                self.view = Some(VoiceTurnView::default());
                effects.push(Effect::Ask(utterance));
            }
            EngineEvent::Failed(message) => {
                self.told.push_to_talk = false;
                // The engine has put itself to rest.
                self.told.listening = false;
                if self.engine == EngineStatus::Ready {
                    self.microphone.failed = true;
                    self.error = Some(format!("The microphone stopped: {message}"));
                } else {
                    self.engine = EngineStatus::Unavailable(format!(
                        "Voice could not start on this computer: {message}"
                    ));
                }
            }
        }
    }

    fn turn(&mut self, update: TurnUpdate, effects: &mut Vec<Effect>) {
        // Only a question of the player's has a stream to follow.
        if self.turn == Turn::Idle || self.announcing() {
            return;
        }
        let view = self.view.get_or_insert_with(VoiceTurnView::default);
        match update {
            TurnUpdate::Event(VoiceTurnEvent::Transcript { text, .. }) => view.heard = Some(text),
            TurnUpdate::Event(VoiceTurnEvent::Run {
                conversation_id, ..
            }) => self.conversation = Some(conversation_id),
            TurnUpdate::Event(VoiceTurnEvent::Answer { text, .. }) => view.answer = Some(text),
            TurnUpdate::Event(VoiceTurnEvent::Audio {
                encoding: SpeechEncoding::PcmS16le,
                sample_rate_hz,
                base64,
                ..
            }) => match STANDARD
                .decode(base64.as_bytes())
                .map_err(|error| error.to_string())
                .and_then(|bytes| pcm_s16le(&bytes).map_err(|error| error.to_string()))
            {
                Ok(pcm) => {
                    self.turn = Turn::Speaking { done: false };
                    effects.push(Effect::Play {
                        sample_rate_hz,
                        pcm,
                    });
                }
                Err(problem) => {
                    view.error = Some(format!("Scout's answer could not be played: {problem}"));
                }
            },
            TurnUpdate::Event(VoiceTurnEvent::Error { message, .. }) => {
                view.error = Some(message);
            }
            TurnUpdate::Event(VoiceTurnEvent::Done { .. }) => {
                if matches!(self.turn, Turn::Speaking { .. }) {
                    self.turn = Turn::Speaking { done: true };
                    effects.push(Effect::AwaitDrain);
                } else {
                    self.finish_turn(effects);
                }
            }
            TurnUpdate::Refused(message) | TurnUpdate::Broken(message) => {
                view.error = Some(message);
                if matches!(self.turn, Turn::Speaking { .. }) {
                    self.turn = Turn::Speaking { done: true };
                    effects.push(Effect::AwaitDrain);
                } else {
                    self.finish_turn(effects);
                }
            }
        }
    }

    /// A proactive turn answered. Say it only in conversation mode, during a
    /// game, unmuted, with no turn of the player's running or being
    /// recorded; otherwise it stays a card in the window.
    #[cfg(scout_proactive_coach)]
    fn proactive_answer(&mut self, run_id: Uuid, effects: &mut Vec<Effect>) {
        let recording = self.told.push_to_talk
            || matches!(
                self.microphone.state,
                scout_voice::VoiceState::Capturing { .. }
            );
        if !self.conversation_mode_live() || self.turn != Turn::Idle || recording {
            return;
        }
        self.turn = Turn::Announcing { playing: false };
        self.error = None;
        self.view = Some(VoiceTurnView {
            app_initiated: true,
            ..VoiceTurnView::default()
        });
        effects.push(Effect::FetchProactiveSpeech(run_id));
    }

    /// The proactive answer's speech arrived, or could not be had. A failure
    /// says nothing: the answer is still in the window.
    #[cfg(scout_proactive_coach)]
    fn proactive_speech(
        &mut self,
        speech: Result<scout_explore_client::proactive::ProactiveSpeech, String>,
        effects: &mut Vec<Effect>,
    ) {
        if self.turn != (Turn::Announcing { playing: false }) {
            // Cut off, or superseded by the player's own question.
            return;
        }
        let decoded = speech.and_then(|speech| {
            pcm_s16le(&speech.pcm)
                .map(|pcm| (speech, pcm))
                .map_err(|error| error.to_string())
        });
        let Ok((speech, pcm)) = decoded else {
            self.turn = Turn::Idle;
            self.view = None;
            return;
        };
        self.turn = Turn::Announcing { playing: true };
        if let Some(view) = self.view.as_mut() {
            view.answer = Some(speech.spoken_text);
        }
        effects.push(Effect::Play {
            sample_rate_hz: speech.sample_rate_hz,
            pcm,
        });
        effects.push(Effect::AwaitDrain);
    }

    /// What the window shows.
    #[must_use]
    pub fn snapshot(&self) -> VoiceSnapshot {
        let consent = match self.settings.consent {
            None => VoiceConsent::NotAsked,
            Some(true) => VoiceConsent::Accepted,
            Some(false) => VoiceConsent::Declined,
        };
        let unavailable = match &self.engine {
            EngineStatus::Unavailable(message) => Some(message.clone()),
            _ => None,
        };
        let detail = self
            .settings_problem
            .clone()
            .or(unavailable)
            .or_else(|| self.error.clone());
        let state = if self.settings_problem.is_some() {
            VoiceState::Error
        } else if !self.agreed() {
            VoiceState::Off
        } else if matches!(self.turn, Turn::Speaking { .. }) || self.saying(true) {
            VoiceState::Speaking
        } else if self.turn == Turn::Thinking || self.saying(false) {
            VoiceState::Thinking
        } else if self.muted {
            VoiceState::Muted
        } else if matches!(
            self.microphone.state,
            scout_voice::VoiceState::Capturing { .. }
        ) && self.microphone.open
        {
            VoiceState::Capturing
        } else if detail.is_some() {
            VoiceState::Error
        } else if self.microphone.state == scout_voice::VoiceState::Armed && self.microphone.open {
            VoiceState::Listening
        } else {
            VoiceState::Off
        };
        VoiceSnapshot {
            state,
            consent,
            consent_requested: self.consent_requested,
            muted: self.muted,
            settings: Some(wire_settings(&self.settings)),
            detail,
        }
    }

    /// Whether Scout is fetching (`false`) or playing (`true`) a proactive
    /// answer.
    #[cfg(scout_proactive_coach)]
    fn saying(&self, playing: bool) -> bool {
        self.turn == (Turn::Announcing { playing })
    }

    /// Whether Scout is saying a proactive answer: never in a stable build.
    #[cfg(not(scout_proactive_coach))]
    #[expect(clippy::unused_self, reason = "the beta build reads the turn")]
    const fn saying(&self, _playing: bool) -> bool {
        false
    }

    /// The spoken turn the window shows.
    #[must_use]
    pub fn turn_view(&self) -> Option<VoiceTurnView> {
        self.view.clone()
    }
}

#[cfg(test)]
mod tests;
