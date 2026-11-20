//! Voice in the supervisor: the microphone, the global keys, the spoken turn
//! and the answer's playback.
//!
//! The supervisor owns the microphone; the window process never opens it and
//! never sees audio. This service runs on the supervisor's runtime. Its
//! [`Controller`] decides; the ports carry the decisions out:
//!
//! - the microphone engine (`scout-voice`) on its own thread, holding the
//!   device open only while listening or recording;
//! - the global push-to-talk and mute keys, registered on the tray's event
//!   loop;
//! - Scout's `coach/voice/turns` route, which receives one finished WAV per
//!   question, with the live game when one is running;
//! - the speaker, for the answer's audio.
//!
//! The window sees a [`VoiceSnapshot`] and the [`VoiceTurnView`], and sends
//! [`VoiceCommand`]s.

pub mod capture;
pub mod controller;
#[cfg(any(target_os = "windows", target_os = "macos"))]
pub mod device;
pub mod turns;

use std::time::Duration;

use scout_client_core::settings::{SettingsStore, VoiceSettings};
use scout_client_runtime::runtime::{PhaseReceiver, StateReceiver};
use scout_desktop_ipc::{ChatCommand, VoiceCommand, VoiceSnapshot, VoiceTurnView};
use scout_explore_client::relay::ChatRelay;
use scout_voice::{EngineCommand, EngineEvent, SpeechOutput};
use tokio::sync::{mpsc, watch};
use tokio::time::Instant;

use self::capture::spoken_turn;
use self::controller::{Controller, Effect, Input, TurnUpdate};
use self::turns::{TurnHandle, TurnRunner};
use crate::hotkeys::{HotkeyEvent, HotkeyPort};
use crate::supervisor::Control;

/// How often finished speech is checked for having played out.
const DRAIN_POLL: Duration = Duration::from_millis(50);
/// How long past its expected end speech may take before it is cut off: a
/// lost output device never drains.
const DRAIN_GRACE: Duration = Duration::from_secs(2);

/// Commands to the microphone engine.
pub trait EnginePort: Send {
    /// Send one command.
    fn send(&self, command: EngineCommand);
}

impl EnginePort for scout_voice::VoiceEngine {
    fn send(&self, command: EngineCommand) {
        Self::send(self, command);
    }
}

/// Starts the microphone engine once the player agrees.
pub trait EngineStarter: Send {
    /// Load the models and start the engine, reporting on `events`.
    fn start(&mut self, events: mpsc::UnboundedSender<EngineEvent>) -> Box<dyn EnginePort>;
}

/// Where the voice choices are kept.
pub trait VoiceStore: Send {
    /// The stored choices.
    ///
    /// # Errors
    ///
    /// Why the file could not be read.
    fn load(&self) -> Result<VoiceSettings, String>;

    /// Keep `settings`.
    ///
    /// # Errors
    ///
    /// Why the file could not be written.
    fn save(&self, settings: &VoiceSettings) -> Result<(), String>;
}

/// The settings file, beside the privacy switches.
#[derive(Debug, Clone)]
pub struct FileStore(pub Option<SettingsStore>);

impl VoiceStore for FileStore {
    fn load(&self) -> Result<VoiceSettings, String> {
        self.0
            .as_ref()
            .ok_or_else(|| "there is no settings folder".to_owned())?
            .load_voice()
            .map_err(|error| error.to_string())
    }

    fn save(&self, settings: &VoiceSettings) -> Result<(), String> {
        self.0
            .as_ref()
            .ok_or_else(|| "there is no settings folder".to_owned())?
            .save_voice(settings)
            .map_err(|error| error.to_string())
    }
}

/// What voice acts through.
pub struct VoicePorts {
    /// The microphone engine.
    pub engine: Box<dyn EngineStarter>,
    /// The voice route.
    pub turns: Box<dyn TurnRunner>,
    /// The speaker.
    pub speaker: Box<dyn SpeechOutput>,
    /// The settings file.
    pub store: Box<dyn VoiceStore>,
    /// The global keys, when the platform event loop could create them.
    pub hotkeys: Option<Box<dyn HotkeyPort>>,
}

/// What voice listens to.
pub struct VoiceInputs {
    /// The gameflow phase.
    pub phase: PhaseReceiver,
    /// The runtime snapshot, for the live game.
    pub state: StateReceiver,
    /// Global key presses.
    pub hotkeys: mpsc::UnboundedReceiver<HotkeyEvent>,
    /// Chat, to continue its open conversation and show the spoken turn in it.
    pub chat: Option<ChatRelay>,
    /// The supervisor's controls, to bring the window forward.
    pub control: mpsc::UnboundedSender<Control>,
}

/// The supervisor's handle on voice.
#[derive(Debug, Clone)]
pub struct VoiceHandle {
    commands: mpsc::UnboundedSender<VoiceCommand>,
    snapshot: watch::Receiver<VoiceSnapshot>,
    turn: watch::Receiver<Option<VoiceTurnView>>,
}

impl VoiceHandle {
    /// Pass a window's choice on.
    pub fn send(&self, command: VoiceCommand) {
        // Fails only once the service ended with the supervisor's runtime.
        let _stopped = self.commands.send(command);
    }

    /// Follow what the window shows.
    #[must_use]
    pub fn snapshot(&self) -> watch::Receiver<VoiceSnapshot> {
        self.snapshot.clone()
    }

    /// Follow the spoken turn.
    #[must_use]
    pub fn turn(&self) -> watch::Receiver<Option<VoiceTurnView>> {
        self.turn.clone()
    }
}

/// Start voice on the current runtime.
#[must_use]
pub fn spawn(ports: VoicePorts, inputs: VoiceInputs) -> VoiceHandle {
    let (controller, effects) = Controller::new(ports.store.load());
    let (commands, receiver) = mpsc::unbounded_channel();
    let (snapshot, snapshot_receiver) = watch::channel(controller.snapshot());
    let (turn, turn_receiver) = watch::channel(controller.turn_view());
    let (engine_events, engine_receiver) = mpsc::unbounded_channel();
    let (turn_updates, turn_receiver_updates) = mpsc::unbounded_channel();
    let mut service = Service {
        controller,
        ports,
        engine: None,
        engine_events,
        turn_updates,
        running_turn: None,
        drain_deadline: None,
        chat: inputs.chat.clone(),
        state: inputs.state.clone(),
        control: inputs.control.clone(),
        snapshot,
        turn,
    };
    service.apply(effects);
    tokio::spawn(service.run(inputs, receiver, engine_receiver, turn_receiver_updates));
    VoiceHandle {
        commands,
        snapshot: snapshot_receiver,
        turn: turn_receiver,
    }
}

struct Service {
    controller: Controller,
    ports: VoicePorts,
    engine: Option<Box<dyn EnginePort>>,
    engine_events: mpsc::UnboundedSender<EngineEvent>,
    turn_updates: mpsc::UnboundedSender<TurnUpdate>,
    /// The turn being answered; replacing or dropping it stops that request.
    running_turn: Option<TurnHandle>,
    /// While speech plays out: when to give up waiting for it.
    drain_deadline: Option<Instant>,
    chat: Option<ChatRelay>,
    state: StateReceiver,
    control: mpsc::UnboundedSender<Control>,
    snapshot: watch::Sender<VoiceSnapshot>,
    turn: watch::Sender<Option<VoiceTurnView>>,
}

impl Service {
    async fn run(
        mut self,
        inputs: VoiceInputs,
        mut commands: mpsc::UnboundedReceiver<VoiceCommand>,
        mut engine: mpsc::UnboundedReceiver<EngineEvent>,
        mut turns: mpsc::UnboundedReceiver<TurnUpdate>,
    ) {
        let VoiceInputs {
            mut phase,
            mut hotkeys,
            ..
        } = inputs;
        let current = phase.borrow_and_update().clone();
        self.step(Input::Phase(current));
        loop {
            // What already happened (the engine, the turn, the game) is
            // applied before new requests (a key, a window choice), so each
            // request is judged against the latest state.
            let input = tokio::select! {
                biased;
                Some(event) = engine.recv() => Input::Engine(event),
                Some(update) = turns.recv() => Input::Turn(update),
                Ok(()) = phase.changed() => Input::Phase(phase.borrow_and_update().clone()),
                Some(event) = hotkeys.recv() => Input::Hotkey(event),
                command = commands.recv() => match command {
                    Some(command) => Input::Window(command),
                    // The supervisor dropped its handle: Scout is quitting.
                    None => break,
                },
                () = tokio::time::sleep(DRAIN_POLL), if self.drain_deadline.is_some() => {
                    if !self.drained() {
                        continue;
                    }
                    Input::Drained
                }
            };
            self.step(input);
        }
        self.ports.speaker.stop();
        if let Some(engine) = self.engine.take() {
            engine.send(EngineCommand::Stop);
        }
    }

    /// Whether the answer finished playing, or ran so far past its end that
    /// the device must be gone.
    fn drained(&mut self) -> bool {
        let Some(deadline) = self.drain_deadline else {
            return false;
        };
        if self.ports.speaker.pending().is_zero() {
            self.drain_deadline = None;
            return true;
        }
        if Instant::now() >= deadline {
            tracing::warn!("the spoken answer never finished playing; cutting it off");
            self.ports.speaker.stop();
            self.drain_deadline = None;
            return true;
        }
        false
    }

    fn step(&mut self, input: Input) {
        let effects = self.controller.handle(input);
        self.apply(effects);
        let snapshot = self.controller.snapshot();
        self.snapshot.send_if_modified(|current| {
            let changed = *current != snapshot;
            *current = snapshot;
            changed
        });
        let view = self.controller.turn_view();
        self.turn.send_if_modified(|current| {
            let changed = *current != view;
            *current = view;
            changed
        });
    }

    fn apply(&mut self, effects: Vec<Effect>) {
        for effect in effects {
            self.carry_out(effect);
        }
    }

    fn carry_out(&mut self, effect: Effect) {
        match effect {
            Effect::StartEngine => {
                if self.engine.is_none() {
                    self.engine = Some(self.ports.engine.start(self.engine_events.clone()));
                }
            }
            Effect::Engine(command) => {
                if let Some(engine) = &self.engine {
                    engine.send(command);
                }
            }
            Effect::Save(settings) => {
                if let Err(error) = self.ports.store.save(&settings) {
                    tracing::warn!(%error, "could not save the voice settings");
                }
            }
            Effect::Bind(bindings) => {
                if let Some(hotkeys) = &self.ports.hotkeys {
                    hotkeys.bind(bindings);
                }
            }
            Effect::Ask(recorded) => {
                let conversation = self
                    .chat
                    .as_ref()
                    .and_then(|chat| chat.subscribe().borrow().status.open_conversation);
                let live = self.state.borrow().live_game.clone();
                match spoken_turn(&recorded, conversation, live.as_ref()) {
                    Ok(turn) => {
                        self.running_turn =
                            Some(self.ports.turns.run(turn, self.turn_updates.clone()));
                    }
                    Err(message) => {
                        let _ = self.turn_updates.send(TurnUpdate::Refused(message));
                    }
                }
            }
            Effect::Play {
                sample_rate_hz,
                pcm,
            } => {
                if let Err(error) = self.ports.speaker.enqueue(sample_rate_hz, &pcm) {
                    tracing::warn!(%error, "could not play Scout's answer");
                }
            }
            Effect::StopPlayback => {
                self.ports.speaker.stop();
                self.drain_deadline = None;
                // Talking over the answer also ends its request.
                self.running_turn = None;
            }
            Effect::AwaitDrain => {
                self.drain_deadline =
                    Some(Instant::now() + self.ports.speaker.pending() + DRAIN_GRACE);
            }
            Effect::ShowWindow => {
                let _ = self.control.send(Control::OpenWindow);
            }
            Effect::OpenConversation(conversation_id) => {
                if let Some(chat) = &self.chat {
                    chat.send(ChatCommand::Open { conversation_id });
                    chat.send(ChatCommand::Refresh);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
