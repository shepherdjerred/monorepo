//! The microphone loop on its own thread, with a scripted microphone the
//! test feeds chunk by chunk and simple fakes for the detectors. No audio
//! device is opened; every wait has a deadline.

use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender, channel};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use scout_voice::{
    AudioFormat, AudioInput, EndReason, EngineCommand, EngineEvent, KeywordHit, KeywordSpotter,
    Microphone, Trigger, Verification, VoiceActivity, VoiceCascade, VoiceEngine, VoiceError,
    VoicePipeline, VoiceState, WakeVerifier,
};

type TestResult = Result<(), Box<dyn std::error::Error>>;

const DEADLINE: Duration = Duration::from_secs(5);
/// 20 ms at 16 kHz.
const CHUNK: usize = 320;

fn loud(samples: &[f32]) -> bool {
    samples.iter().any(|sample| sample.abs() > 0.5)
}

/// Fires on the first loud frame.
#[derive(Default)]
struct LoudSpotter {
    fired: bool,
}

impl KeywordSpotter for LoudSpotter {
    fn accept(&mut self, samples: &[f32]) -> Result<Option<KeywordHit>, VoiceError> {
        if loud(samples) && !self.fired {
            self.fired = true;
            return Ok(Some(KeywordHit {
                fragment: "HEY_SCOUT".to_owned(),
                fragment_end_seconds: None,
            }));
        }
        Ok(None)
    }

    fn reset(&mut self) {
        self.fired = false;
    }
}

/// Speech is loud; it completes after any quiet frame once heard.
#[derive(Default)]
struct LoudVad {
    active: bool,
    heard: bool,
    quiet: bool,
}

impl VoiceActivity for LoudVad {
    fn accept(&mut self, samples: &[f32]) {
        self.active = loud(samples);
        self.heard |= self.active;
        self.quiet = !self.active;
    }

    fn speech_active(&self) -> bool {
        self.active
    }

    fn completed_speech(&self) -> bool {
        self.heard && self.quiet
    }

    fn reset(&mut self) {
        *self = Self::default();
    }
}

struct AlwaysVerifies;

impl WakeVerifier for AlwaysVerifies {
    fn verify(&mut self, _samples: &[f32]) -> Result<Verification, VoiceError> {
        Ok(Verification {
            accepted: true,
            score: 0.9,
        })
    }
}

/// An input that delivers what the test sends, silence every 20 ms while the
/// test sends nothing, as a live device does, and ends when the test drops
/// its sender.
struct ScriptedInput(Receiver<Vec<f32>>);

impl AudioInput for ScriptedInput {
    fn format(&self) -> AudioFormat {
        AudioFormat {
            sample_rate_hz: 16_000,
            channels: 1,
        }
    }

    fn next_chunk(&mut self) -> Result<Option<Vec<f32>>, VoiceError> {
        match self.0.recv_timeout(Duration::from_millis(20)) {
            Ok(chunk) => Ok(Some(chunk)),
            Err(RecvTimeoutError::Timeout) => Ok(Some(vec![0.0; CHUNK])),
            Err(RecvTimeoutError::Disconnected) => Ok(None),
        }
    }
}

/// Hands out one scripted input per open, and counts the opens.
#[derive(Clone, Default)]
struct ScriptedMicrophone {
    inputs: Arc<Mutex<Vec<Receiver<Vec<f32>>>>>,
    opens: Arc<Mutex<u32>>,
}

impl ScriptedMicrophone {
    /// Queue an input for the next open; the returned sender feeds it.
    fn plug_in(&self) -> Sender<Vec<f32>> {
        let (sender, receiver) = channel();
        self.inputs
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(receiver);
        sender
    }

    fn opens(&self) -> u32 {
        *self.opens.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl Microphone for ScriptedMicrophone {
    fn open(&mut self) -> Result<Box<dyn AudioInput>, VoiceError> {
        *self.opens.lock().unwrap_or_else(PoisonError::into_inner) += 1;
        let mut inputs = self.inputs.lock().unwrap_or_else(PoisonError::into_inner);
        if inputs.is_empty() {
            return Err(VoiceError::Device("no input device".to_owned()));
        }
        Ok(Box::new(ScriptedInput(inputs.remove(0))))
    }
}

struct Running {
    engine: VoiceEngine,
    events: Receiver<EngineEvent>,
    microphone: ScriptedMicrophone,
}

fn start() -> Result<Running, Box<dyn std::error::Error>> {
    let microphone = ScriptedMicrophone::default();
    let engine_microphone = microphone.clone();
    let (sender, events) = channel();
    let engine = VoiceEngine::spawn(
        move || {
            let pipeline = VoicePipeline::new(
                VoiceCascade::shared()?,
                LoudSpotter::default(),
                LoudVad::default(),
                AlwaysVerifies,
            );
            Ok((pipeline, engine_microphone))
        },
        move |event| {
            let _ = sender.send(event);
        },
    )?;
    let running = Running {
        engine,
        events,
        microphone,
    };
    running.expect(&EngineEvent::Ready)?;
    running.expect_state(VoiceState::Idle, false)?;
    Ok(running)
}

impl Running {
    fn next(&self) -> Result<EngineEvent, Box<dyn std::error::Error>> {
        Ok(self.events.recv_timeout(DEADLINE)?)
    }

    fn expect(&self, expected: &EngineEvent) -> TestResult {
        let event = self.next()?;
        if &event == expected {
            Ok(())
        } else {
            Err(format!("expected {expected:?}, got {event:?}").into())
        }
    }

    fn expect_state(&self, state: VoiceState, microphone_open: bool) -> TestResult {
        self.expect(&EngineEvent::State {
            state,
            microphone_open,
        })
    }
}

const PUSH_TO_TALK: VoiceState = VoiceState::Capturing {
    trigger: Trigger::PushToTalk,
    verified: true,
};

#[test]
fn the_engine_starts_idle_with_the_microphone_closed() -> TestResult {
    let running = start()?;
    assert_eq!(running.microphone.opens(), 0);
    Ok(())
}

#[test]
fn push_to_talk_opens_the_microphone_and_release_delivers_the_utterance() -> TestResult {
    let running = start()?;
    let feed = running.microphone.plug_in();
    running.engine.send(EngineCommand::PushToTalk(true));
    running.expect_state(PUSH_TO_TALK, false)?;
    running.expect_state(PUSH_TO_TALK, true)?;
    for _ in 0..10 {
        feed.send(vec![0.2; CHUNK])?;
    }
    // The release is read after the chunks already queued.
    std::thread::sleep(Duration::from_millis(100));
    running.engine.send(EngineCommand::PushToTalk(false));
    let event = running.next()?;
    let EngineEvent::Utterance(utterance) = event else {
        return Err(format!("expected the utterance, got {event:?}").into());
    };
    assert_eq!(utterance.trigger, Trigger::PushToTalk);
    assert_eq!(utterance.reason, EndReason::PushToTalkReleased);
    let spoken = utterance
        .samples
        .iter()
        .filter(|sample| **sample > 0.1)
        .count();
    assert_eq!(spoken, 10 * CHUNK);
    // The microphone closes while the answer is fetched and spoken.
    running.expect_state(
        VoiceState::Ended {
            trigger: Trigger::PushToTalk,
            reason: EndReason::PushToTalkReleased,
        },
        false,
    )?;
    running.engine.send(EngineCommand::FinishTurn);
    running.expect_state(VoiceState::Idle, false)?;
    assert_eq!(running.microphone.opens(), 1);
    Ok(())
}

#[test]
fn conversation_mode_holds_the_microphone_open_until_it_closes() -> TestResult {
    let running = start()?;
    let _feed = running.microphone.plug_in();
    running.engine.send(EngineCommand::Conversation(true));
    running.expect_state(VoiceState::Armed, false)?;
    running.expect_state(VoiceState::Armed, true)?;
    running.engine.send(EngineCommand::Conversation(false));
    running.expect_state(VoiceState::Idle, false)?;
    Ok(())
}

#[test]
fn a_wake_word_question_ends_in_silence_and_listening_resumes_after_the_turn() -> TestResult {
    let running = start()?;
    let first = running.microphone.plug_in();
    running.engine.send(EngineCommand::Conversation(true));
    running.expect_state(VoiceState::Armed, false)?;
    running.expect_state(VoiceState::Armed, true)?;
    // "hey scout" and a question: a second of sound, then quiet.
    for index in 0..150 {
        let level = if index < 50 { 0.9 } else { 0.0 };
        if first.send(vec![level; CHUNK]).is_err() {
            break;
        }
    }
    let mut utterance = None;
    while utterance.is_none() {
        match running.next()? {
            EngineEvent::Utterance(heard) => utterance = Some(heard),
            EngineEvent::State { .. } => {}
            other => return Err(format!("unexpected {other:?}").into()),
        }
    }
    let utterance = utterance.ok_or("no utterance")?;
    assert_eq!(utterance.trigger, Trigger::Wake);
    assert_eq!(utterance.reason, EndReason::EndOfSpeech);
    running.expect_state(
        VoiceState::Ended {
            trigger: Trigger::Wake,
            reason: EndReason::EndOfSpeech,
        },
        false,
    )?;
    // Finishing the turn reopens the microphone for the next question.
    let _second = running.microphone.plug_in();
    running.engine.send(EngineCommand::FinishTurn);
    running.expect_state(VoiceState::Armed, false)?;
    running.expect_state(VoiceState::Armed, true)?;
    assert_eq!(running.microphone.opens(), 2);
    Ok(())
}

#[test]
fn a_microphone_that_will_not_open_fails_once_and_rests() -> TestResult {
    let running = start()?;
    running.engine.send(EngineCommand::Conversation(true));
    running.expect_state(VoiceState::Armed, false)?;
    running.expect(&EngineEvent::Failed(
        "audio device error: no input device".to_owned(),
    ))?;
    running.expect_state(VoiceState::Idle, false)?;
    assert_eq!(running.microphone.opens(), 1);
    Ok(())
}

#[test]
fn a_microphone_that_stops_mid_capture_fails_and_discards_the_audio() -> TestResult {
    let running = start()?;
    let feed = running.microphone.plug_in();
    running.engine.send(EngineCommand::PushToTalk(true));
    running.expect_state(PUSH_TO_TALK, false)?;
    running.expect_state(PUSH_TO_TALK, true)?;
    feed.send(vec![0.2; CHUNK])?;
    drop(feed);
    running.expect(&EngineEvent::Failed(
        "audio device error: the microphone stopped".to_owned(),
    ))?;
    running.expect_state(VoiceState::Idle, false)?;
    Ok(())
}

#[test]
fn models_that_fail_to_load_are_reported() -> TestResult {
    let (sender, events) = channel();
    let _engine = VoiceEngine::spawn(
        || -> Result<
            (
                VoicePipeline<LoudSpotter, LoudVad, AlwaysVerifies>,
                ScriptedMicrophone,
            ),
            VoiceError,
        > { Err(VoiceError::MissingModel("kws/encoder.onnx".into())) },
        move |event| {
            let _ = sender.send(event);
        },
    )?;
    assert_eq!(
        events.recv_timeout(DEADLINE)?,
        EngineEvent::Failed("voice model file is missing: kws/encoder.onnx".to_owned())
    );
    Ok(())
}
