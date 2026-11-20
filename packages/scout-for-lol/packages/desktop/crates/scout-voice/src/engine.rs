//! The microphone loop: one thread that owns the input device and the
//! cascade, driven by commands and reporting what it did.
//!
//! The app's supervisor runs this; the window process never opens the
//! microphone. The device is open only while the cascade wants it: listening
//! for the wake word in conversation mode, or recording an utterance. Between
//! turns, while an answer is being fetched and spoken, and whenever
//! conversation mode is off, the input is dropped, which closes the device.
//!
//! The models and the input are created on the engine's own thread, so
//! neither needs to be `Send`.

use std::sync::mpsc::{Receiver, Sender, TryRecvError, channel};
use std::thread::JoinHandle;

use crate::audio::AudioInput;
use crate::detect::{KeywordSpotter, VoiceActivity, WakeVerifier};
use crate::error::VoiceError;
use crate::pipeline::VoicePipeline;
use crate::resample::MonoResampler;
use crate::state::VoiceState;
use crate::utterance::Utterance;

/// Opens the input device. Production opens the default microphone through
/// cpal; tests play a file.
pub trait Microphone {
    /// Open and start the device.
    ///
    /// # Errors
    ///
    /// Returns why the device could not be opened.
    fn open(&mut self) -> Result<Box<dyn AudioInput>, VoiceError>;
}

/// What the app asks the engine to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EngineCommand {
    /// Hands-free listening on or off.
    Conversation(bool),
    /// The push-to-talk key went down (`true`) or up (`false`).
    PushToTalk(bool),
    /// The last utterance's turn is over; listening may resume.
    FinishTurn,
    /// End the thread.
    Stop,
}

/// What the engine reports.
#[derive(Debug, Clone, PartialEq)]
pub enum EngineEvent {
    /// The models loaded and the engine takes commands.
    Ready,
    /// The cascade's state, and whether the input device is open. Sent
    /// whenever either changes.
    State {
        /// Where the cascade is.
        state: VoiceState,
        /// Whether the microphone is open.
        microphone_open: bool,
    },
    /// A finished utterance. The engine holds the cascade in
    /// [`VoiceState::Ended`], with the microphone closed, until
    /// [`EngineCommand::FinishTurn`].
    Utterance(Utterance),
    /// The device or a detector failed. Listening and any capture stop;
    /// the next command that wants the microphone tries again.
    Failed(String),
}

/// The handle on the engine's thread. Dropping it stops the thread.
#[derive(Debug)]
pub struct VoiceEngine {
    commands: Sender<EngineCommand>,
    thread: Option<JoinHandle<()>>,
}

impl VoiceEngine {
    /// Start the engine on its own thread. `build` runs there and loads the
    /// cascade and the microphone; when it fails, `on_event` hears
    /// [`EngineEvent::Failed`] and the thread ends.
    ///
    /// # Errors
    ///
    /// Returns the operating system's refusal to start a thread.
    pub fn spawn<K, V, W, M, B, F>(build: B, mut on_event: F) -> std::io::Result<Self>
    where
        K: KeywordSpotter,
        V: VoiceActivity,
        W: WakeVerifier,
        M: Microphone,
        B: FnOnce() -> Result<(VoicePipeline<K, V, W>, M), VoiceError> + Send + 'static,
        F: FnMut(EngineEvent) + Send + 'static,
    {
        let (commands, receiver) = channel();
        let thread = std::thread::Builder::new()
            .name("scout-voice".to_owned())
            .spawn(move || match build() {
                Ok((pipeline, microphone)) => {
                    on_event(EngineEvent::Ready);
                    run(pipeline, microphone, &receiver, &mut on_event);
                }
                Err(error) => on_event(EngineEvent::Failed(error.to_string())),
            })?;
        Ok(Self {
            commands,
            thread: Some(thread),
        })
    }

    /// Send one command. A stopped engine drops it.
    pub fn send(&self, command: EngineCommand) {
        let _stopped = self.commands.send(command);
    }
}

impl Drop for VoiceEngine {
    fn drop(&mut self) {
        self.send(EngineCommand::Stop);
        if let Some(thread) = self.thread.take() {
            // A panic on the engine thread was already recorded by the
            // process's panic hook; joining only waits for the device to close.
            let _panicked = thread.join();
        }
    }
}

struct OpenInput {
    input: Box<dyn AudioInput>,
    resampler: MonoResampler,
}

fn open_input<M: Microphone>(microphone: &mut M) -> Result<OpenInput, VoiceError> {
    let input = microphone.open()?;
    let resampler = MonoResampler::new(input.format())?;
    Ok(OpenInput { input, resampler })
}

/// Put the cascade back to rest after a failure: no hands-free listening, no
/// capture in progress, and no utterance held.
fn rest<K: KeywordSpotter, V: VoiceActivity, W: WakeVerifier>(
    pipeline: &mut VoicePipeline<K, V, W>,
) {
    pipeline.set_conversation_open(false);
    if matches!(pipeline.state(), VoiceState::Capturing { .. }) {
        // Releasing ends a push-to-talk capture; the audio is discarded.
        let _discarded = pipeline.push_to_talk(false);
    }
    pipeline.finish_turn();
}

/// Apply one command. Returns `false` on [`EngineCommand::Stop`].
fn apply<K: KeywordSpotter, V: VoiceActivity, W: WakeVerifier>(
    pipeline: &mut VoicePipeline<K, V, W>,
    command: EngineCommand,
    on_event: &mut dyn FnMut(EngineEvent),
) -> bool {
    match command {
        EngineCommand::Conversation(open) => pipeline.set_conversation_open(open),
        EngineCommand::PushToTalk(pressed) => {
            if let Some(utterance) = pipeline.push_to_talk(pressed) {
                on_event(EngineEvent::Utterance(utterance));
            }
        }
        EngineCommand::FinishTurn => pipeline.finish_turn(),
        EngineCommand::Stop => return false,
    }
    true
}

/// Run the loop on the calling thread until [`EngineCommand::Stop`] or every
/// sender is gone.
pub fn run<K, V, W, M>(
    mut pipeline: VoicePipeline<K, V, W>,
    mut microphone: M,
    commands: &Receiver<EngineCommand>,
    on_event: &mut dyn FnMut(EngineEvent),
) where
    K: KeywordSpotter,
    V: VoiceActivity,
    W: WakeVerifier,
    M: Microphone,
{
    let mut input: Option<OpenInput> = None;
    let mut reported = None;
    loop {
        if !pipeline.wants_microphone() {
            // Dropping the input closes the device.
            input = None;
        }
        let now = (pipeline.state(), input.is_some());
        if reported != Some(now) {
            reported = Some(now);
            on_event(EngineEvent::State {
                state: now.0,
                microphone_open: now.1,
            });
        }
        if !pipeline.wants_microphone() {
            match commands.recv() {
                Ok(command) if apply(&mut pipeline, command, on_event) => continue,
                _ => return,
            }
        }
        match commands.try_recv() {
            Ok(command) => {
                if apply(&mut pipeline, command, on_event) {
                    continue;
                }
                return;
            }
            Err(TryRecvError::Disconnected) => return,
            Err(TryRecvError::Empty) => {}
        }
        let Some(open) = input.as_mut() else {
            // Report the open device before blocking on its first chunk.
            match open_input(&mut microphone) {
                Ok(opened) => input = Some(opened),
                Err(error) => {
                    on_event(EngineEvent::Failed(error.to_string()));
                    rest(&mut pipeline);
                }
            }
            continue;
        };
        let heard = match open.input.next_chunk() {
            Ok(Some(chunk)) => open
                .resampler
                .process(&chunk)
                .and_then(|mono| pipeline.accept(&mono)),
            Ok(None) => Err(VoiceError::Device("the microphone stopped".to_owned())),
            Err(error) => Err(error),
        };
        match heard {
            Ok(Some(utterance)) => on_event(EngineEvent::Utterance(utterance)),
            Ok(None) => {}
            Err(error) => {
                input = None;
                on_event(EngineEvent::Failed(error.to_string()));
                rest(&mut pipeline);
            }
        }
    }
}
